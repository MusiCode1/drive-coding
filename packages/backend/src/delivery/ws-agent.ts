/**
 * ws-agent.ts — browser WebSocket pipe for /ws/agent/:id (CUT-3b-ii rewire)
 *
 * slice connection-set: one live feWs per agentId (activeFeWs). Connection rows
 * live in connectionRegistry; isOwnedByWs reads activeFeWs.has, not the set.
 */

import { randomUUID } from "node:crypto"
import { enrichStreamUpdateWithMedia } from "@drive-coding/core/fs/media-catalog"
import { createLogger } from "@drive-coding/core/log"
import type { WebSocket } from "ws"
import type { ConnectionRegistry } from "../acp/connection-registry.js"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
import { createMediaStatFn } from "./media-stat.js"
import type { EvictionController } from "./eviction-controller.js"

const log = createLogger("backend.ws.agent")

export const TAKEOVER_CODE = 4409

export type AgentWsData = {
  kind: "agent"
  agentId: string
  bridgeWs?: undefined
  pendingFromFe: Array<string | Buffer>
  bridgeOpen: boolean
}

const STALE_MS = 60_000

type ActiveFeWsEntry = {
  ws: WebSocket
  lastPingAt: number
  connectionId: string
}

const TEXT_CHUNK_KINDS = new Set(["agent_message_chunk", "agent_thought_chunk"])

function streamHoldKey(agentId: string, update: Record<string, unknown>): string | null {
  const kind = update.sessionUpdate
  if (typeof kind !== "string" || !TEXT_CHUNK_KINDS.has(kind)) return null
  const mid = typeof update.messageId === "string" ? update.messageId : ""
  return `${agentId}:${kind}:${mid}`
}

function enrichFeLine(
  line: string,
  agentId: string,
  connectionRegistry: ConnectionRegistry,
  mediaStat: (uri: string) => { bytes: number } | null,
  streamHolds: Map<string, string>,
): string {
  try {
    const envelope = JSON.parse(line) as Record<string, unknown>
    if (envelope.method !== "session/update") return line
    const params =
      typeof envelope.params === "object" && envelope.params !== null
        ? (envelope.params as Record<string, unknown>)
        : undefined
    if (params === undefined) return line
    const inner = params.update
    if (typeof inner !== "object" || inner === null) return line
    const cwd = connectionRegistry.getCwd(agentId) ?? null
    const key = streamHoldKey(agentId, inner as Record<string, unknown>)
    const prevHeld = key !== null ? (streamHolds.get(key) ?? "") : ""
    const { update, held: nextHeld } = enrichStreamUpdateWithMedia(
      inner as Record<string, unknown>,
      prevHeld,
      cwd,
      mediaStat,
    )
    if (key !== null) {
      if (nextHeld === "") streamHolds.delete(key)
      else streamHolds.set(key, nextHeld)
    }
    params.update = update
    return JSON.stringify(envelope)
  } catch {
    return line
  }
}

export function createAgentWsHandler(deps: {
  orchestrator: AgentOrchestrator
  connectionRegistry: ConnectionRegistry
  sessionHostRegistry?: {
    isHeld(agentId: string): boolean
    getHost(agentId: string): { dispose(): Promise<void> } | undefined
    unregisterHost(agentId: string): void
  }
  evictionController?: EvictionController
  fsFileAllowedBase?: string
}): {
  onConnect: (ws: WebSocket, agentId: string, connectionId?: string) => Promise<void>
  isWsSocketActive: (agentId: string) => boolean
  closeLiveSocket: (agentId: string, connectionId: string) => void
} {
  const activeFeWs = new Map<string, ActiveFeWsEntry>()
  const mediaStat = createMediaStatFn(deps.fsFileAllowedBase)

  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [, e] of activeFeWs) {
      if (now - e.lastPingAt > STALE_MS) e.ws.terminate()
    }
  }, 20_000)
  sweep.unref()

  deps.connectionRegistry.setWsSocketChecker((agentId) => activeFeWs.has(agentId))

  function closeLiveSocket(agentId: string, connectionId: string): void {
    const entry = activeFeWs.get(agentId)
    if (!entry || entry.connectionId !== connectionId) return
    entry.ws.close(1000, "connection released")
  }

  async function onConnect(
    feWs: WebSocket,
    agentId: string,
    connectionIdParam?: string,
  ): Promise<void> {
    const childLog = log.child({ agentId })
    const connectionId = connectionIdParam ?? randomUUID()

    const existing = activeFeWs.get(agentId)
    if (existing) {
      childLog.warn(
        {
          existingReadyState: existing.ws.readyState,
          msSinceLastPing: Date.now() - existing.lastPingAt,
        },
        "taking over — evicting existing feWs",
      )
      existing.ws.close(TAKEOVER_CODE, "taken over by new connection")
    }

    const conn = deps.connectionRegistry.get(agentId)
    if (!conn) {
      childLog.warn({}, "agent not found")
      feWs.close(1008, "agent not found")
      return
    }

    if (deps.sessionHostRegistry?.isHeld(agentId)) {
      const host = deps.sessionHostRegistry.getHost(agentId)
      if (host) {
        childLog.info({}, "WS→host eviction: disposing HTTP host and taking over")
        await host.dispose()
        deps.sessionHostRegistry.unregisterHost(agentId)
      } else {
        childLog.warn({}, "session host in-flight for this agent — rejecting WS attach")
        feWs.close(1008, "session-host-active")
        return
      }
    }

    activeFeWs.set(agentId, { ws: feWs, lastPingAt: Date.now(), connectionId })
    deps.connectionRegistry.addConnection(agentId, connectionId, "ws")
    childLog.info({ pid: conn.pid, connectionId }, "WS connect → pipe attached")

    const streamHolds = new Map<string, string>()
    const evictionReg = deps.evictionController?.register(agentId, feWs)

    try {
      const capsFrame = JSON.stringify({
        jsonrpc: "2.0",
        method: "_drive/capabilities",
        params: conn.capabilities,
      })
      feWs.send(`${capsFrame}\n`)
      childLog.debug({ capabilities: conn.capabilities }, "_drive/capabilities sent to FE")
    } catch {
      /* feWs may have closed */
    }

    const unsub = conn.wire.onLine((line) => {
      if (line.length === 0) return
      try {
        const out = enrichFeLine(line, agentId, deps.connectionRegistry, mediaStat, streamHolds)
        feWs.send(`${out}\n`)
      } catch {
        /* feWs closed */
      }
    })

    feWs.on("message", (data) => {
      try {
        const text = data.toString()

        if (text.includes('"$/ping"')) {
          const entry = activeFeWs.get(agentId)
          if (entry) entry.lastPingAt = Date.now()
          deps.connectionRegistry.touchConnection(agentId, connectionId)
          feWs.send(`${JSON.stringify({ jsonrpc: "2.0", method: "$/pong" })}\n`)
          return
        }

        if (text.includes('"$/detach"')) {
          deps.connectionRegistry.removeConnection(agentId, connectionId)
          feWs.close(1000, "client detach")
          return
        }

        const line = text.endsWith("\n") ? text : `${text}\n`
        conn.wire.write(line)
      } catch (err) {
        childLog.warn({ err }, "stdin write failed")
      }
    })

    const unsubCrash = conn.onCrash(() => {
      childLog.info({}, "child crashed — closing feWs")
      try {
        feWs.close(1011, "bridge closed")
      } catch {
        /* already closed */
      }
    })

    let detached = false
    function detach(reason: "close" | "error", err?: unknown): void {
      if (detached) return
      detached = true
      if (reason === "error")
        childLog.warn(
          { err: { code: (err as NodeJS.ErrnoException)?.code, message: String(err) } },
          "WS error — detaching pipe",
        )
      else childLog.info({}, "WS disconnect — detaching pipe")

      if (activeFeWs.get(agentId)?.ws === feWs) {
        activeFeWs.delete(agentId)
        deps.connectionRegistry.removeConnection(agentId, connectionId)
      }
      unsub()
      unsubCrash()
      streamHolds.clear()
      evictionReg?.notifyDetached()
    }

    feWs.on("error", (err) => detach("error", err))
    feWs.on("close", () => detach("close"))
  }

  return { onConnect, isWsSocketActive: (agentId) => activeFeWs.has(agentId), closeLiveSocket }
}
