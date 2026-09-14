/**
 * connection/sidecar.ts — connectSidecar: a ProviderConnection over a Unix socket.
 *
 * Same shape as `connectSpawn`, different other end. Instead of owning a child
 * process and its pipes, this owns a socket to a sidecar that owns the child —
 * which is the entire difference between an agent that dies with the backend and
 * one that does not.
 *
 * ```
 *   connectSidecar ──socket──▶ [ sidecar (own systemd unit) ] ──stdio──▶ CLI
 * ```
 *
 * ─── Two things that are NOT what they look like ─────────────────────────────
 *
 * 🔴 `pid` is the **sidecar's** pid, not the CLI's. Anything reading it to send
 * a signal would be signalling the wrong process — the CLI is the sidecar's
 * child, one level further down. It is exposed at all because the UI shows it
 * and because it identifies the process a human would look for in `systemd-cgls`.
 *
 * 🔴 `close()` means **disconnect**, not kill. It closes the socket and leaves
 * the sidecar running. That is the whole point of the disconnect/kill split: the
 * backend's own shutdown path calls `close()` on every connection, and if that
 * meant "kill" then a restart would still take every agent down. Ending an agent
 * for good is a separate act (stopping its unit), owned by the backend.
 *
 * ⚠️ `onCrash` therefore fires on **socket loss**, which is not the same event
 * as the agent dying. A sidecar that exits does close the socket, so a real
 * crash is reported; but so is a network-level disconnect, and the two are
 * indistinguishable from here. Confirming which happened means probing the
 * socket again — the backend has `probeAgentSocket` for exactly that.
 */

import { connectUnix } from "@drive-coding/acp-wire/node"
import { extractPromptCaps } from "@drive-coding/core/acp/extract-prompt-caps"
import { createLogger } from "@drive-coding/core/log"
import { createTurnTracker } from "../shared/turn-tracker.js"
import { decodeWireLine } from "../shared/wire-decode.js"
import type { BridgeCrashInfo, SpawnBridgeInput } from "../spawn/index.js"
import type { NormalizedCapabilities } from "../types.js"
import { staticCapsFor } from "./capabilities-static.js"
import type { ProviderConnection, WireFrame } from "./types.js"

const log = createLogger("provider.connect-sidecar")

export type SidecarConnectOpts = {
  /** Path of the sidecar's listening socket. The backend resolves this. */
  socketPath: string
  cliKind: SpawnBridgeInput["cliKind"]
  /** The sidecar's own pid, from the launcher or a ping. Null if unknown. */
  sidecarPid?: number | null
}

/**
 * connectSidecar — attach to a running sidecar and expose it as a ProviderConnection.
 *
 * Does not start anything: launching (or deciding that a live one already
 * exists) belongs to the backend, which owns the socket directory and the
 * systemd units. Provider is handed a path.
 */
export async function connectSidecar(opts: SidecarConnectOpts): Promise<ProviderConnection> {
  const transport = await connectUnix(opts.socketPath)

  const lineListeners = new Set<(line: string) => void>()
  const frameListeners = new Set<(f: WireFrame) => void>()
  const crashListeners = new Set<(info: BridgeCrashInfo) => void>()
  const changeListeners = new Set<(busy: boolean) => void>()
  const tracker = createTurnTracker()
  let caps = staticCapsFor(opts.cliKind)
  let lastBusy = false
  let closed = false

  const encoder = new TextEncoder()
  const writer = transport.writable.getWriter()

  function emitBusyChange(): void {
    const nowBusy = tracker.isBusy(Date.now())
    if (nowBusy === lastBusy) return
    lastBusy = nowBusy
    for (const cb of changeListeners) {
      try {
        cb(nowBusy)
      } catch {
        /* a listener must not break the pipe */
      }
    }
  }

  /** Identical frame handling to connectSpawn — same decode, same turn rules. */
  function observe(dir: "in" | "out", rawLine: string): void {
    const normalized = rawLine.endsWith("\n") ? rawLine.slice(0, -1) : rawLine
    const s = decodeWireLine(normalized)

    if (dir === "in") {
      tracker.observe(s, Date.now())
      emitBusyChange()
      const promptCaps = extractPromptCaps(s.parsed)
      if (promptCaps) caps = { ...caps, image: promptCaps.image === true }
    }

    const frame: WireFrame = {
      dir,
      type: s.sessionUpdate ?? s.method ?? s.responseKind ?? (s.unparsed ? "unparsed" : "unknown"),
      id: s.id,
      raw: normalized,
      parsed: s.parsed,
    }
    for (const cb of frameListeners) {
      try {
        cb(frame)
      } catch {
        /* same */
      }
    }
  }

  function reportLoss(): void {
    if (closed) return
    closed = true
    // exitCode/signal are unknowable from this side — the process is not ours.
    // Saying so explicitly beats inventing a 0.
    const info: BridgeCrashInfo = { exitCode: null, signal: null }
    for (const cb of crashListeners) {
      try {
        cb(info)
      } catch {
        /* same */
      }
    }
  }

  transport.onClose(() => {
    log.info({ socketPath: opts.socketPath }, "sidecar socket closed")
    reportLoss()
  })

  // Reader loop: bytes → lines. The sidecar relays NDJSON verbatim, so framing
  // is ours to reassemble; a chunk boundary lands mid-line often enough that
  // splitting per chunk would corrupt roughly every large frame.
  void (async () => {
    const reader = transport.readable.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let nl = buf.indexOf("\n")
        while (nl !== -1) {
          const line = buf.slice(0, nl)
          buf = buf.slice(nl + 1)
          if (line !== "") {
            for (const cb of lineListeners) {
              try {
                cb(line)
              } catch {
                /* a subscriber must not break the pipe */
              }
            }
            observe("in", line)
          }
          nl = buf.indexOf("\n")
        }
      }
    } catch {
      /* socket went away — onClose already reported it */
    } finally {
      reader.releaseLock()
      reportLoss()
    }
  })()

  return {
    wire: {
      onLine(cb: (line: string) => void): () => void {
        lineListeners.add(cb)
        return () => {
          lineListeners.delete(cb)
        }
      },
      write(line: string): boolean {
        if (closed) return false
        void writer.write(encoder.encode(line)).catch(() => {
          /* the peer vanished mid-write; onClose reports it */
        })
        observe("out", line)
        return true
      },
    },

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
      isBusy: () => tracker.isBusy(Date.now()),
      lastActivityAt: () => tracker.getLastActivityAt(),
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

    /** 🔴 Disconnect. The sidecar and its CLI keep running — see the header. */
    async close(): Promise<void> {
      closed = true
      try {
        writer.releaseLock()
      } catch {
        /* already released */
      }
      transport.close()
    },

    ext: undefined,

    get pid(): number | null {
      return opts.sidecarPid ?? null
    },
  }
}
