/**
 * connection-registry.ts — BE registry of live ProviderConnections (CUT-3b-ii).
 *
 * Replaces createBridgeManager singleton. Manages a Map<agentId, ConnEntry>
 * where each entry holds a ProviderConnection + attached-state (UI concern,
 * BE-side) + WireRecorder session.
 *
 * Design decisions:
 *   - dedup guard (NBug1): connect(agentId) checks Map.has(agentId) BEFORE
 *     connectSpawn — never clobbers a live connection.
 *   - attached-state lives here (not in ws-agent) because getRuntimeInfo needs it
 *     and http-agents reads it (§9#2 from brief).
 *   - wireRecorder session opened in connect, closed in close/onCrash cleanup.
 *   - onFrame registered once per connection in connect (in+out) — not duplicated.
 *   - Routing (CUT-3b-iii-2): cliKind==="claude" → connectInProcess; else → connectSpawn.
 *     pid may be null for in-process connections; getRuntimeInfo handles this gracefully.
 */

import { createLogger } from "@drive-coding/core/log"
import type { ConnectOpts, ProviderConnection } from "@drive-coding/provider/connection"
import { connectCodexInProcess, connectInProcess, connectSpawn, decodeWireLine } from "@drive-coding/provider/connection"
import type { SpawnBridgeInput } from "@drive-coding/provider/spawn"
import type { WireRecorder, WireSession } from "../delivery/wire-recorder.js"

const wireLog = createLogger("backend.acp.wire")

type ConnEntry = {
  conn: ProviderConnection
  attached: boolean
  rec: WireSession
  unsubs: Array<() => void>
}

export type ConnectionRegistry = {
  /**
   * connect — spawn + register. Dedup: if agentId already in Map, throws.
   * This is the NBug1 guard (moved from bridge-manager.spawnInternal).
   */
  connect(
    agentId: string,
    cliKind: SpawnBridgeInput["cliKind"],
    opts: ConnectOpts,
  ): Promise<ProviderConnection>

  get(agentId: string): ProviderConnection | undefined

  /** list — כל ה-agentIds החיים (לכיבוי-מסודר, be-shutdown-hardening Commit 1). */
  list(): string[]

  markAttached(agentId: string): void
  markDetached(agentId: string): void

  /**
   * getRuntimeInfo — composes conn.turn + conn.pid + attached-state.
   * Returns null if agentId not in registry.
   * pid may be null for in-process connections (e.g. claude in-process, CUT-3b-iii-2).
   */
  getRuntimeInfo(
    agentId: string,
  ): { pid: number | null; attached: boolean; busy: boolean; lastMessageAt: number | null } | null

  /**
   * close — kill child + remove from Map + close wireRecorder session.
   */
  close(agentId: string): Promise<void>

  /**
   * onCrash — subscribe to crashes from ANY registered connection.
   * Aggregate: per-conn onCrash → calls cb(agentId, info).
   * Returns unsubscribe.
   */
  onCrash(
    cb: (agentId: string, info: import("@drive-coding/provider/spawn").BridgeCrashInfo) => void,
  ): () => void
}

export function createConnectionRegistry(opts?: {
  wireRecorder?: WireRecorder
}): ConnectionRegistry {
  const wireRecorder = opts?.wireRecorder
  const map = new Map<string, ConnEntry>()
  const crashListeners = new Set<
    (agentId: string, info: import("@drive-coding/provider/spawn").BridgeCrashInfo) => void
  >()

  function cleanup(agentId: string): void {
    const entry = map.get(agentId)
    if (!entry) return
    for (const unsub of entry.unsubs) {
      try {
        unsub()
      } catch {
        /* ignore */
      }
    }
    entry.rec.close()
    map.delete(agentId)
  }

  return {
    async connect(agentId, cliKind, connectOpts) {
      // ── NBug1 dedup guard (🔴 avigail): check BEFORE connectSpawn ──
      if (map.has(agentId)) {
        throw new Error(`connection-registry: agentId already live: ${agentId}`)
      }

      const rec = wireRecorder?.open(agentId) ?? { record() {}, close() {} }

      // ── Routing (CUT-3b-iii-2 + codex-inprocess): ──
      // claude → connectInProcess (acp-sdk Web Streams, Model 2)
      // codex  → connectCodexInProcess (NDJSON PassThrough, startAcpServer fork)
      // else   → connectSpawn (opencode/gemini/qoder)
      // cliKinds: opencode/claude/gemini/codex/qoder (core/src/schemas/agent.ts:30).
      const conn =
        cliKind === "claude"
          ? await connectInProcess(connectOpts)
          : cliKind === "codex"
            ? await connectCodexInProcess(connectOpts)
            : await connectSpawn(cliKind, connectOpts)

      // Register onFrame once (in+out) for wire-observability.
      // Must NOT decode in wire.write separately — this is the single decode point.
      const unsubFrame = conn.onFrame((frame) => {
        try {
          const s = decodeWireLine(frame.raw)
          const type =
            s.sessionUpdate ?? s.method ?? s.responseKind ?? (s.unparsed ? "unparsed" : "unknown")
          wireLog.debug({ agentId, dir: frame.dir, type, id: s.id }, "wire")
          if (!s.unparsed) wireLog.trace({ agentId, dir: frame.dir, frame: s.parsed }, "wire-full")
        } catch {
          /* silent — must not break the pipe */
        }
        rec.record(frame.dir, frame.raw)
      })

      // onCrash: notify aggregate listeners + cleanup entry.
      const unsubCrash = conn.onCrash((info) => {
        for (const cb of crashListeners) {
          try {
            cb(agentId, info)
          } catch {
            /* ignore */
          }
        }
        cleanup(agentId)
      })

      map.set(agentId, {
        conn,
        attached: false,
        rec,
        unsubs: [unsubFrame, unsubCrash],
      })

      return conn
    },

    get(agentId) {
      return map.get(agentId)?.conn
    },

    list() {
      return [...map.keys()]
    },

    markAttached(agentId) {
      const e = map.get(agentId)
      if (e) e.attached = true
    },

    markDetached(agentId) {
      const e = map.get(agentId)
      if (e) e.attached = false
    },

    getRuntimeInfo(agentId) {
      const e = map.get(agentId)
      if (!e) return null
      // pid may be null for in-process connections (claude in-process, CUT-3b-iii-2).
      // We must NOT short-circuit on null — attached/busy/lastMessageAt are still valid.
      return {
        pid: e.conn.pid,
        attached: e.attached,
        busy: e.conn.turn.isBusy(),
        lastMessageAt: e.conn.turn.lastActivityAt(),
      }
    },

    async close(agentId) {
      const e = map.get(agentId)
      if (!e) return
      cleanup(agentId)
      try {
        await e.conn.close()
      } catch {
        /* child may already be dead */
      }
    },

    onCrash(cb) {
      crashListeners.add(cb)
      return () => {
        crashListeners.delete(cb)
      }
    },
  }
}
