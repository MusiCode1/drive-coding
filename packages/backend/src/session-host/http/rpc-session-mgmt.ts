/**
 * rpc-session-mgmt.ts — blocking session/list|load|new|delete RPC branches (extracted from rpc.ts).
 */

import { createLogger } from "@drive-coding/core/log"
import { RPC_METHODS } from "@drive-coding/core/session"
import { type } from "arktype"
import type { Context } from "hono"
import { getSelfBaseUrl } from "../../instances.js"
import type { AgentSessionRegistry } from "../registry.js"
import type { ExtendedSessionHost } from "../session-host.js"
import { buildSessionInitBase } from "../session-meta.js"
import { codeOf, messageOf } from "./rpc-respond-wait.js"

const log = createLogger("backend.session-host.rpc")

export const LoadSessionParams = type({ sessionId: "string", "cwd?": "string" })
export const NewSessionParams = type({ "cwd?": "string" })
export const DeleteSessionParams = type({ sessionId: "string" })

export async function tryDispatchBlockingSessionRpc(
  c: Context,
  method: string | undefined,
  params: Record<string, unknown>,
  host: ExtendedSessionHost,
  registry: AgentSessionRegistry,
  agentId: string,
): Promise<Response | undefined> {
  switch (method) {
    case RPC_METHODS.listSessions: {
      try {
        const r = await host.listSessions()
        const sessions = Array.isArray(r.sessions) ? r.sessions : []
        return c.json(
          {
            sessions,
            sessionCapabilities: host.agentCapabilities?.sessionCapabilities ?? null,
          },
          200,
        )
      } catch (e) {
        if (codeOf(e) === -32601) {
          return c.json(
            {
              sessions: [],
              sessionCapabilities: host.agentCapabilities?.sessionCapabilities ?? null,
            },
            200,
          )
        }
        const code = codeOf(e)
        return c.json(
          code === undefined ? { error: messageOf(e) } : { error: messageOf(e), code },
          502,
        )
      }
    }
    case RPC_METHODS.loadSession: {
      const p = LoadSessionParams(params)
      if (p instanceof type.errors) return c.json({ error: p.summary }, 400)
      const cwd = p.cwd ?? registry.getCwd(agentId)
      if (!cwd) return c.json({ error: "no cwd available" }, 400)
      try {
        const cliKind = registry.getCliKind(agentId) ?? "unknown"
        const base = buildSessionInitBase(
          cliKind,
          agentId,
          cwd,
          host.agentCapabilities,
          getSelfBaseUrl,
        )
        const r = await host.loadSession({
          ...base,
          sessionId: p.sessionId,
        })
        try {
          await registry.notifySessionAttached(agentId, r.sessionId, cwd)
        } catch (err) {
          log.warn({ err, agentId }, "notifySessionAttached after loadSession failed")
        }
        return c.json({ sessionId: r.sessionId, version: host.state.version }, 200)
      } catch (e) {
        const code = codeOf(e)
        return c.json(
          code === undefined ? { error: messageOf(e) } : { error: messageOf(e), code },
          502,
        )
      }
    }
    case RPC_METHODS.newSession: {
      const p = NewSessionParams(params)
      if (p instanceof type.errors) return c.json({ error: p.summary }, 400)
      const cwd = p.cwd ?? registry.getCwd(agentId)
      if (!cwd) return c.json({ error: "no cwd available" }, 400)
      try {
        const cliKind = registry.getCliKind(agentId) ?? "unknown"
        const r = await host.newSession(
          buildSessionInitBase(cliKind, agentId, cwd, host.agentCapabilities, getSelfBaseUrl),
        )
        try {
          await registry.notifySessionAttached(agentId, r.sessionId, cwd)
        } catch (err) {
          log.warn({ err, agentId }, "notifySessionAttached after newSession failed")
        }
        return c.json({ sessionId: r.sessionId, version: host.state.version }, 200)
      } catch (e) {
        const code = codeOf(e)
        return c.json(
          code === undefined ? { error: messageOf(e) } : { error: messageOf(e), code },
          502,
        )
      }
    }
    case RPC_METHODS.deleteSession: {
      const p = DeleteSessionParams(params)
      if (p instanceof type.errors) return c.json({ error: p.summary }, 400)
      try {
        await host.deleteSession(p.sessionId)
        return c.json({ ok: true }, 200)
      } catch (e) {
        if (codeOf(e) === -32601) return c.json({ ok: false, unsupported: true }, 200)
        const code = codeOf(e)
        return c.json(
          code === undefined ? { error: messageOf(e) } : { error: messageOf(e), code },
          502,
        )
      }
    }
    default:
      return undefined
  }
}
