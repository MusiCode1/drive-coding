/**
 * connect-in-process.ts — connectCodexInProcess (moved from connection/connect-codex-in-process.ts): ProviderConnection wrapping
 * the codex ACP agent in-process via the @musicode1/codex-acp fork.
 *
 * Architecture:
 *   FE ←[wire: string onLine/write]→ PassThrough pair ←[NDJSON]→ startCodexAcp → codex-acp
 *
 * Key difference from connectInProcess (claude):
 *   - codex fork uses Node NDJSON streams (createJsonStream over Readable/Writable),
 *     NOT Web Streams AnyMessage objects.
 *   - Therefore we do NOT use createStreamBridge (which is an ACP-SDK Web Streams adapter).
 *   - Wire bridge is simpler: PassThrough ↔ string lines, split on '\n'.
 *
 * onFrame/turn: same as connectInProcess — decodeWireLine + createTurnTracker.
 * capabilities: staticCapsFor("codex") — static, no runtime discovery.
 * ext: undefined — codex has no ext channel; `_drive/voice/*` is mapped on the wire (voice-streams.ts).
 * pid: null — the codex child is managed inside startAcpServer (not directly visible).
 *
 * close(): serverIn.end() → triggers readable.on("close") inside startAcpServer,
 * which kills codex child after 2s (built into the fork).
 */

import { PassThrough } from "node:stream"
import { extractPromptCaps } from "@drive-coding/core/acp/extract-prompt-caps"
import { resolveCodexPath } from "./codex-path.js"
import { createCodexVoiceStreams } from "./voice-streams.js"
import { createTurnTracker } from "../../shared/turn-tracker.js"
import { decodeWireLine } from "../../shared/wire-decode.js"
import type { BridgeCrashInfo } from "../../spawn/index.js"
import type { NormalizedCapabilities } from "../../types.js"
import { staticCapsFor } from "../../connection/capabilities-static.js"
import { startCodexAcp } from "../../connection/codex-acp-startup.js"
import type { ConnectOpts, ProviderConnection, WireFrame } from "../../connection/types.js"

export { resolveCodexPath }

export async function connectCodexInProcess(opts: ConnectOpts): Promise<ProviderConnection> {
  // Listeners for onFrame — broadcast decoded frames.
  const frameListeners = new Set<(f: WireFrame) => void>()

  // turn-tracker — pull-based busy indicator.
  const tracker = createTurnTracker()

  // onChange: last busy state emitted (used to detect transitions).
  let lastBusy = false
  const changeListeners = new Set<(busy: boolean) => void>()

  /** Emit onChange if busy state changed since last frame. */
  function emitBusyChange(): void {
    const nowBusy = tracker.isBusy(Date.now())
    if (nowBusy !== lastBusy) {
      lastBusy = nowBusy
      for (const cb of changeListeners) {
        try {
          cb(nowBusy)
        } catch {
          /* listener must not break the pipe */
        }
      }
    }
  }

  /** Decode a raw line and emit to frameListeners. */
  function handleLine(dir: "in" | "out", rawLine: string): void {
    const normalized = rawLine.endsWith("\n") ? rawLine.slice(0, -1) : rawLine
    if (normalized.length === 0) return
    const s = decodeWireLine(normalized)

    // turn-tracker: observed on dir="in" only (agent→FE, matches bridge-manager convention).
    if (dir === "in") {
      tracker.observe(s, Date.now())
      emitBusyChange()

      // slice reattach-state-sync Commit 1 — tap the initialize response for the real
      // promptCapabilities (structural: responseKind==="result" + agentCapabilities present).
      const promptCaps = extractPromptCaps(s.parsed)
      if (promptCaps) {
        caps = { ...caps, image: promptCaps.image === true }
      }
    }

    // Derive type label (same as connectInProcess/connectSpawn).
    const type =
      s.sessionUpdate ?? s.method ?? s.responseKind ?? (s.unparsed ? "unparsed" : "unknown")

    const frame: WireFrame = {
      dir,
      type,
      id: s.id,
      raw: normalized,
      parsed: s.parsed,
    }

    for (const cb of frameListeners) {
      try {
        cb(frame)
      } catch {
        /* listener must not break the pipe */
      }
    }
  }

  // onCrash listeners — codex child is managed by startAcpServer.
  // We detect "crash" by watching serverOut close event.
  const crashListeners = new Set<(info: BridgeCrashInfo) => void>()
  let pendingCrash: BridgeCrashInfo | undefined

  function emitCrash(info: BridgeCrashInfo): void {
    if (crashListeners.size === 0) {
      pendingCrash = info
      return
    }
    for (const cb of crashListeners) {
      try {
        cb(info)
      } catch {
        /* listener must not break the pipe */
      }
    }
  }

  // PassThrough pair:
  //   serverIn  — FE→agent (we write lines here; startAcpServer reads from it)
  //   serverOut — agent→FE (startAcpServer writes lines here; we read from it)
  const serverIn = new PassThrough()
  const serverOut = new PassThrough()

  // Closed flag — must be declared before startCodexAcp (TDZ when instructions empty).
  let closed = false

  const codexPath = resolveCodexPath()
  const instructions = opts.agentPrompt ?? opts.systemPrompt ?? undefined

  // codex `developer_instructions` override **replaces** the effective config value (not append).
  // Measured 2026-10-09 — see codex-acp-startup.integration.test.ts (live config/read probe).
  // startCodexAcp reads the effective user instructions and composes them with the surface prompt.
  // `_drive/voice/*` ↔ codex-acp realtime (providers/codex), between us and the agent.
  const voice = createCodexVoiceStreams()
  voice.fromAgent.pipe(serverOut)
  startCodexAcp({
    serverIn: serverIn.pipe(voice.toAgent),
    serverOut: voice.fromAgent,
    cwd: opts.cwd,
    codexPath,
    instructions,
    isClosed: () => closed,
    onStartupError: (err) => {
      emitCrash({
        exitCode: null,
        signal: null,
        spawnError: {
          message: err instanceof Error ? err.message : String(err),
        },
      })
    },
  })

  // Line buffer for serverOut — accumulate bytes until '\n'.
  let lineBuffer = ""

  // Wire line listeners (agent→FE direction).
  const lineListeners = new Set<(line: string) => void>()

  // Subscribe to serverOut data events — split by '\n' and emit lines.
  serverOut.on("data", (chunk: Buffer | string) => {
    lineBuffer += typeof chunk === "string" ? chunk : chunk.toString("utf8")
    let idx: number
    while ((idx = lineBuffer.indexOf("\n")) !== -1) {
      const line = lineBuffer.slice(0, idx)
      lineBuffer = lineBuffer.slice(idx + 1)
      if (line.length === 0) continue
      // Emit to all line listeners (wire.onLine subscribers).
      for (const cb of lineListeners) {
        try {
          cb(line)
        } catch {
          /* listener must not break the pipe */
        }
      }
      // Tap for onFrame (dir="in" = agent→FE direction).
      handleLine("in", line)
    }
  })

  // onCrash: notify when serverOut closes unexpectedly.
  serverOut.on("close", () => {
    if (closed) return
    emitCrash({ exitCode: null, signal: null })
  })

  // Build the wire interface.
  const wire: ProviderConnection["wire"] = {
    onLine(cb: (line: string) => void): () => void {
      lineListeners.add(cb)
      return () => {
        lineListeners.delete(cb)
      }
    },
    write(line: string): boolean {
      if (closed) return false
      // Tap FE→agent direction for onFrame (dir="out").
      handleLine("out", line)
      // Write NDJSON line to serverIn (with newline terminator).
      const data = line.endsWith("\n") ? line : `${line}\n`
      return serverIn.write(data)
    },
  }

  // caps: staticCapsFor("codex") — static baseline. mutable — slice reattach-state-sync
  // Commit 1: the init-frame tap (handleLine, dir="in") updates `image` in place once it
  // observes a real initialize response.
  let caps = staticCapsFor("codex")

  const connection: ProviderConnection = {
    wire,
    get capabilities(): NormalizedCapabilities {
      return caps
    },

    onFrame(cb: (f: WireFrame) => void): () => void {
      frameListeners.add(cb)
      return () => {
        frameListeners.delete(cb)
      }
    },

    turn: {
      isBusy(): boolean {
        return tracker.isBusy(Date.now())
      },
      lastActivityAt(): number | null {
        return tracker.getLastActivityAt()
      },
      onChange(cb: (busy: boolean) => void): () => void {
        changeListeners.add(cb)
        return () => {
          changeListeners.delete(cb)
        }
      },
    },

    onCrash(cb: (info: BridgeCrashInfo) => void): () => void {
      crashListeners.add(cb)
      if (pendingCrash !== undefined) {
        const pending = pendingCrash
        pendingCrash = undefined
        queueMicrotask(() => {
          try {
            cb(pending)
          } catch {
            /* listener must not break the pipe */
          }
        })
      }
      return () => {
        crashListeners.delete(cb)
      }
    },

    async close(): Promise<void> {
      if (closed) return
      closed = true
      // Closing serverIn signals end-of-stream to startAcpServer.
      // The fork's readable.on("close") handler will then kill the codex child after 2s.
      serverIn.end()
      // Clear all listeners.
      frameListeners.clear()
      changeListeners.clear()
      crashListeners.clear()
      pendingCrash = undefined
      lineListeners.clear()
    },

    ext: undefined,

    // pid: null — the codex child process is managed inside startAcpServer,
    // not directly accessible from this side.
    get pid(): null {
      return null
    },
  }

  return connection
}
