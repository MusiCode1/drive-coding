/**
 * connect-codex-in-process.ts — connectCodexInProcess: ProviderConnection wrapping
 * the codex ACP agent in-process via the @agentclientprotocol/codex-acp fork.
 *
 * Architecture:
 *   FE ←[wire: string onLine/write]→ PassThrough pair ←[NDJSON]→ startAcpServer(codex)
 *
 * Key difference from connectInProcess (claude):
 *   - codex fork uses Node NDJSON streams (createJsonStream over Readable/Writable),
 *     NOT Web Streams AnyMessage objects.
 *   - Therefore we do NOT use createStreamBridge (which is an ACP-SDK Web Streams adapter).
 *   - Wire bridge is simpler: PassThrough ↔ string lines, split on '\n'.
 *
 * onFrame/turn: same as connectInProcess — decodeWireLine + createTurnTracker.
 * capabilities: staticCapsFor("codex") — static, no runtime discovery.
 * ext: undefined — codex has no ext channel.
 * pid: null — the codex child is managed inside startAcpServer (not directly visible).
 *
 * close(): serverIn.end() → triggers readable.on("close") inside startAcpServer,
 * which kills codex child after 2s (built into the fork).
 */

import { PassThrough } from "node:stream"
import { startAcpServer } from "@agentclientprotocol/codex-acp/lib"
import { createTurnTracker } from "../shared/turn-tracker.js"
import { decodeWireLine } from "../shared/wire-decode.js"
import type { ConnectOpts, ProviderConnection, WireFrame } from "./types.js"
import { staticCapsFor } from "./capabilities-static.js"
import type { BridgeCrashInfo } from "../spawn/index.js"

/**
 * resolveCodexPath — finds the native codex binary.
 *
 * Strategy:
 *   1. CODEX_PATH env var (explicit override, required on Windows).
 *   2. Otherwise: return undefined — startAcpServer falls back to process.env.CODEX_PATH.
 *      On Linux/Termux the bundled binary shipped with @openai/codex works;
 *      on Windows the bundled binary is broken (exit 1), so CODEX_PATH must be set.
 */
export function resolveCodexPath(): string | undefined {
  return process.env["CODEX_PATH"]
}

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

  // PassThrough pair:
  //   serverIn  — FE→agent (we write lines here; startAcpServer reads from it)
  //   serverOut — agent→FE (startAcpServer writes lines here; we read from it)
  const serverIn = new PassThrough()
  const serverOut = new PassThrough()

  // Start the codex ACP server in-process.
  // modelOverride is intentionally NOT passed — model selection is FE-driven via the wire
  // (session/new params / setSessionModel). codex does not accept modelOverride in opts.
  const codexPath = resolveCodexPath()
  startAcpServer(serverIn, serverOut, { codexPath })

  // Line buffer for serverOut — accumulate bytes until '\n'.
  let lineBuffer = ""

  // Closed flag — used to prevent double-close.
  let closed = false

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
    const info: BridgeCrashInfo = { exitCode: null, signal: null }
    for (const cb of crashListeners) {
      try {
        cb(info)
      } catch {
        /* listener must not break the pipe */
      }
    }
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

  // capabilities: staticCapsFor("codex") — static, no runtime discovery.
  const capabilities = staticCapsFor("codex")

  const connection: ProviderConnection = {
    wire,
    capabilities,

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
