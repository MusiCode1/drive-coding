/**
 * rpc-session-mgmt.ts — blocking session/list|load|new|delete RPC branches (extracted from rpc.ts).
 */

import { createLogger } from "@drive-coding/core/log"
import { type ChannelResponse, RPC_METHODS } from "@drive-coding/core/session"
import { type } from "arktype"
import { getSelfBaseUrl } from "../../instances.js"
import type { AgentSessionRegistry } from "../registry.js"
import type { ExtendedSessionHost } from "../session-host.js"
import { buildSessionInitBase } from "../session-meta.js"
import { SessionBusyError } from "../session-switch.js"
import { codeOf, messageOf } from "./rpc-respond-wait.js"

const log = createLogger("backend.session-host.rpc")

export const LoadSessionParams = type({ sessionId: "string", "cwd?": "string" })
export const NewSessionParams = type({ "cwd?": "string" })
export const DeleteSessionParams = type({ sessionId: "string" })

export async function tryDispatchBlockingSessionRpc(
  method: string | undefined,
  params: Record<string, unknown>,
  host: ExtendedSessionHost,
  registry: AgentSessionRegistry,
  agentId: string,
): Promise<ChannelResponse | undefined> {
  switch (method) {
    case RPC_METHODS.listSessions: {
      try {
        const r = await host.listSessions()
        const sessions = Array.isArray(r.sessions) ? r.sessions : []
        return {
          status: 200,
          body: {
            sessions,
            sessionCapabilities: host.agentCapabilities?.sessionCapabilities ?? null,
          },
        }
      } catch (e) {
        if (codeOf(e) === -32601) {
          return {
            status: 200,
            body: {
              sessions: [],
              sessionCapabilities: host.agentCapabilities?.sessionCapabilities ?? null,
            },
          }
        }
        const code = codeOf(e)
        return {
          status: 502,
          body: code === undefined ? { error: messageOf(e) } : { error: messageOf(e), code },
        }
      }
    }
    case RPC_METHODS.loadSession: {
      const p = LoadSessionParams(params)
      if (p instanceof type.errors) return { status: 400, body: { error: p.summary } }
      const cwd = p.cwd ?? registry.getCwd(agentId)
      if (!cwd) return { status: 400, body: { error: "no cwd available" } }
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
        return { status: 200, body: { sessionId: r.sessionId, version: host.state.version } }
      } catch (e) {
        if (e instanceof SessionBusyError) {
          return { status: 409, body: { error: e.message, code: "session_busy" } }
        }
        const code = codeOf(e)
        return {
          status: 502,
          body: code === undefined ? { error: messageOf(e) } : { error: messageOf(e), code },
        }
      }
    }
    case RPC_METHODS.newSession: {
      const p = NewSessionParams(params)
      if (p instanceof type.errors) return { status: 400, body: { error: p.summary } }
      const cwd = p.cwd ?? registry.getCwd(agentId)
      if (!cwd) return { status: 400, body: { error: "no cwd available" } }
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
        return { status: 200, body: { sessionId: r.sessionId, version: host.state.version } }
      } catch (e) {
        const code = codeOf(e)
        return {
          status: 502,
          body: code === undefined ? { error: messageOf(e) } : { error: messageOf(e), code },
        }
      }
    }
    case RPC_METHODS.deleteSession: {
      const p = DeleteSessionParams(params)
      if (p instanceof type.errors) return { status: 400, body: { error: p.summary } }
      try {
        await host.deleteSession(p.sessionId)
        return { status: 200, body: { ok: true } }
      } catch (e) {
        if (codeOf(e) === -32601) return { status: 200, body: { ok: false, unsupported: true } }
        const code = codeOf(e)
        return {
          status: 502,
          body: code === undefined ? { error: messageOf(e) } : { error: messageOf(e), code },
        }
      }
    }
    default:
      return undefined
  }
}
