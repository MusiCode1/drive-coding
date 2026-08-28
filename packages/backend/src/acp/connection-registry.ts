/**
 * connection-registry.ts — BE registry of live ProviderConnections (CUT-3b-ii).
 *
 * Replaces createBridgeManager singleton. Manages a Map<agentId, ConnEntry>
 * where each entry holds a ProviderConnection + connection-set (UI concern,
 * BE-side) + WireRecorder session.
 *
 * slice connection-set C0: single-owner model replaced by a per-viewer
 * connection set (`connections: Map<connectionId, row>`). `attached` derives
 * from set size; `via` derives from row transports (ws wins over http).
 */

import type { CliKind } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { loadCliSpecsOverride } from "@drive-coding/provider/config"
import type { ConnectOpts, ProviderConnection } from "@drive-coding/provider/connection"
import {
  connectCodexInProcess,
  connectInProcess,
  connectSpawn,
  decodeWireLine,
} from "@drive-coding/provider/connection"
import type { SpawnBridgeInput } from "@drive-coding/provider/spawn"
import { httpCacheInvalidateAll } from "../delivery/http-cache.js"
import type { WireRecorder, WireSession } from "../delivery/wire-recorder.js"

const wireLog = createLogger("backend.acp.wire")
const cfgLog = createLogger("backend.acp.config")

const IN_PROCESS_CONNECTORS = {
  claude: connectInProcess,
  codex: connectCodexInProcess,
} satisfies Partial<Record<CliKind, (opts: ConnectOpts) => Promise<ProviderConnection>>>

export function overrideHasBinOrArgs(kind: string): boolean {
  const o = loadCliSpecsOverride()[kind]
  return o?.bin !== undefined || o?.args !== undefined
}

export function overrideHasEnv(kind: string): boolean {
  const o = loadCliSpecsOverride()[kind]
  return o?.setEnv !== undefined || o?.unsetEnv !== undefined
}

export type ConnectionVia = "ws" | "http"

export type ConnectionRow = {
  via: ConnectionVia
  lastSeenAt: number
  stream?: ReadableStream<unknown>
}

type ConnEntry = {
  conn: ProviderConnection
  connections: Map<string, ConnectionRow>
  attached: boolean
  ownershipEpoch: number
  rec: WireSession
  unsubs: Array<() => void>
  cwd: string
  cliKind: string
}

function syncAttached(e: ConnEntry): void {
  e.attached = e.connections.size > 0
}

function deriveVia(e: ConnEntry): ConnectionVia | null {
  for (const row of e.connections.values()) {
    if (row.via === "ws") return "ws"
  }
  for (const row of e.connections.values()) {
    if (row.via === "http") return "http"
  }
  return null
}

function deriveLastSeenAt(e: ConnEntry): number | null {
  if (e.connections.size === 0) return null
  let max = 0
  for (const row of e.connections.values()) {
    if (row.lastSeenAt > max) max = row.lastSeenAt
  }
  return max
}

export type ConnectionRegistry = {
  connect(
    agentId: string,
    cliKind: SpawnBridgeInput["cliKind"],
    opts: ConnectOpts,
  ): Promise<ProviderConnection>

  get(agentId: string): ProviderConnection | undefined
  getCwd(agentId: string): string | undefined
  getCliKind(agentId: string): string | undefined
  list(): string[]

  addConnection(
    agentId: string,
    connectionId: string,
    via: ConnectionVia,
    stream?: ReadableStream<unknown>,
  ): void
  removeConnection(
    agentId: string,
    connectionId: string,
    opts?: { onlyIfStream?: unknown },
  ): void
  touchConnection(agentId: string, connectionId: string): void
  clearAllConnections(agentId: string): void
  getConnectionCount(agentId: string): number

  isAttached(agentId: string): boolean
  getEpoch(agentId: string): number
  isOwnedByWs(agentId: string): boolean

  getRuntimeInfo(agentId: string): {
    pid: number | null
    attached: boolean
    busy: boolean
    lastMessageAt: number | null
    lastSeenAt: number | null
    via: ConnectionVia | null
  } | null

  getLastSeenAt(agentId: string): number | null
  listHttpConnectionIds(
    agentId: string,
  ): Array<{ connectionId: string; lastSeenAt: number; stream?: ReadableStream<unknown> }>

  close(agentId: string): Promise<void>
  onCrash(
    cb: (agentId: string, info: import("@drive-coding/provider/spawn").BridgeCrashInfo) => void,
  ): () => void

  /** slice connection-set C1: injected from ws-agent — activeFeWs.has, not the set. */
  setWsSocketChecker(checker: (agentId: string) => boolean): void
}

export function createConnectionRegistry(opts?: {
  wireRecorder?: WireRecorder
  isWsSocketActive?: (agentId: string) => boolean
}): ConnectionRegistry {
  const wireRecorder = opts?.wireRecorder
  let wsSocketChecker = opts?.isWsSocketActive ?? (() => false)
  const map = new Map<string, ConnEntry>()
  const crashListeners = new Set<
    (agentId: string, info: import("@drive-coding/provider/spawn").BridgeCrashInfo) => void
  >()
  const pending = new Map<string, { cancelled: boolean }>()

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
    setWsSocketChecker(checker) {
      wsSocketChecker = checker
    },

    async connect(agentId, cliKind, connectOpts) {
      if (map.has(agentId)) {
        throw new Error(`connection-registry: agentId already live: ${agentId}`)
      }
      if (pending.has(agentId)) {
        throw new Error(`connection-registry: agentId already connecting: ${agentId}`)
      }
      const token = { cancelled: false }
      pending.set(agentId, token)

      try {
        const rec = wireRecorder?.open(agentId) ?? { record() {}, close() {} }

        if (cliKind in IN_PROCESS_CONNECTORS && overrideHasBinOrArgs(cliKind)) {
          cfgLog.warn({ cliKind }, "cli-specs override.bin/args ignored for in-process cliKind")
        }
        if (cliKind in IN_PROCESS_CONNECTORS && overrideHasEnv(cliKind)) {
          cfgLog.warn(
            { cliKind },
            "cli-specs override env vars are not supported by the in-process bridge",
          )
        }
        const inProcess = IN_PROCESS_CONNECTORS[cliKind as keyof typeof IN_PROCESS_CONNECTORS]
        const conn = inProcess
          ? await inProcess(connectOpts)
          : await connectSpawn(cliKind, connectOpts)

        if (token.cancelled) {
          rec.close()
          await conn.close().catch(() => {})
          throw new Error(`connection-registry: connect cancelled by concurrent close: ${agentId}`)
        }

        const unsubFrame = conn.onFrame((frame) => {
          try {
            const s = decodeWireLine(frame.raw)
            const type =
              s.sessionUpdate ?? s.method ?? s.responseKind ?? (s.unparsed ? "unparsed" : "unknown")
            wireLog.debug({ agentId, dir: frame.dir, type, id: s.id }, "wire")
            if (!s.unparsed)
              wireLog.trace({ agentId, dir: frame.dir, frame: s.parsed }, "wire-full")
          } catch {
            /* silent */
          }
          rec.record(frame.dir, frame.raw)
        })

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
          connections: new Map(),
          attached: false,
          ownershipEpoch: 0,
          rec,
          unsubs: [unsubFrame, unsubCrash],
          cwd: connectOpts.cwd,
          cliKind,
        })
        return conn
      } finally {
        pending.delete(agentId)
      }
    },

    get(agentId) {
      return map.get(agentId)?.conn
    },

    getCwd(agentId) {
      return map.get(agentId)?.cwd
    },

    getCliKind(agentId) {
      return map.get(agentId)?.cliKind
    },

    list() {
      return [...map.keys()]
    },

    addConnection(agentId, connectionId, via, stream) {
      const e = map.get(agentId)
      if (!e) return

      const hadHttp = [...e.connections.values()].some((row) => row.via === "http")
      const existing = e.connections.get(connectionId)

      if (existing) {
        existing.lastSeenAt = Date.now()
        if (stream !== undefined) existing.stream = stream
      } else {
        e.connections.set(connectionId, {
          via,
          lastSeenAt: Date.now(),
          ...(stream !== undefined ? { stream } : {}),
        })
        if (via === "http" && !hadHttp) e.ownershipEpoch++
        if (via === "ws") e.ownershipEpoch++
      }

      syncAttached(e)
      httpCacheInvalidateAll()
    },

    removeConnection(agentId, connectionId, opts) {
      const e = map.get(agentId)
      if (!e) return
      const row = e.connections.get(connectionId)
      if (!row) return
      if (opts?.onlyIfStream !== undefined && row.stream !== opts.onlyIfStream) return

      e.connections.delete(connectionId)
      syncAttached(e)
      httpCacheInvalidateAll()
    },

    touchConnection(agentId, connectionId) {
      const e = map.get(agentId)
      if (!e) return
      const row = e.connections.get(connectionId)
      if (!row) return
      row.lastSeenAt = Date.now()
    },

    clearAllConnections(agentId) {
      const e = map.get(agentId)
      if (!e) return
      e.connections.clear()
      syncAttached(e)
      httpCacheInvalidateAll()
    },

    getConnectionCount(agentId) {
      return map.get(agentId)?.connections.size ?? 0
    },

    isAttached(agentId) {
      return map.get(agentId)?.attached ?? false
    },

    getEpoch(agentId) {
      return map.get(agentId)?.ownershipEpoch ?? 0
    },

    isOwnedByWs(agentId) {
      return wsSocketChecker(agentId)
    },

    getLastSeenAt(agentId) {
      const e = map.get(agentId)
      if (!e) return null
      return deriveLastSeenAt(e)
    },

    listHttpConnectionIds(agentId) {
      const e = map.get(agentId)
      if (!e) return []
      const out: Array<{
        connectionId: string
        lastSeenAt: number
        stream?: ReadableStream<unknown>
      }> = []
      for (const [connectionId, row] of e.connections) {
        if (row.via === "http")
          out.push({ connectionId, lastSeenAt: row.lastSeenAt, stream: row.stream })
      }
      return out
    },

    getRuntimeInfo(agentId) {
      const e = map.get(agentId)
      if (!e) return null
      return {
        pid: e.conn.pid,
        attached: e.attached,
        busy: e.conn.turn.isBusy(),
        lastMessageAt: e.conn.turn.lastActivityAt(),
        lastSeenAt: deriveLastSeenAt(e),
        via: deriveVia(e),
      }
    },

    async close(agentId) {
      const pend = pending.get(agentId)
      if (pend) pend.cancelled = true
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
