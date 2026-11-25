/**
 * rpc-session-mgmt.ts — blocking session/list|load|new|delete RPC branches (extracted from rpc.ts).
 */

import { createLogger } from "@drive-coding/core/log"
import {
  type ChannelResponse,
  RPC_METHODS,
  type SessionListCapabilities,
  type SessionListQuery,
} from "@drive-coding/core/session"
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

// Absolute POSIX, drive-rooted Windows, or UNC with both server and share.
const absoluteCwd = /^(?:\/|[a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/
export const ListSessionsParams = type({
  "paged?": "true",
  "cwd?": absoluteCwd,
  "cursor?": "string",
})

function isCapabilityDeclaration(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function dispatchListSessions(
  host: ExtendedSessionHost,
  { paged, cwd, cursor }: typeof ListSessionsParams.infer,
): Promise<ChannelResponse> {
  const wantsPage = paged === true || cwd !== undefined || cursor !== undefined
  const declaration = host.agentCapabilities?.sessionCapabilities
  const sessionCapabilities = isCapabilityDeclaration(declaration) ? declaration : null
  const list = isCapabilityDeclaration(sessionCapabilities?.list)
  const canDelete = isCapabilityDeclaration(sessionCapabilities?.delete)
  const warmLegacy = host.sessionCapabilitiesSource === "warm-legacy"

  function listResult(
    sessions: unknown[],
    listAvailable: boolean,
    nextCursor?: string,
  ): ChannelResponse {
    const capabilities: SessionListCapabilities = {
      list: listAvailable,
      filterByCwd: listAvailable,
      delete: canDelete,
    }
    return {
      status: 200,
      body: {
        sessions,
        sessionCapabilities,
        ...(wantsPage && { capabilities }),
        ...(nextCursor !== undefined && { nextCursor }),
      },
    }
  }

  if (wantsPage && warmLegacy) {
    return {
      status: 200,
      body: {
        sessions: [],
        sessionCapabilities: null,
        capabilities: { list: false, filterByCwd: false, delete: false },
        legacyOnly: true,
      },
    }
  }
  if (!list && !warmLegacy) return listResult([], false)

  const query: SessionListQuery = {
    ...(cwd !== undefined && { cwd }),
    ...(cursor !== undefined && { cursor }),
  }
  try {
    const result = wantsPage ? await host.listSessions(query) : await host.listSessions()
    const sessions = Array.isArray(result.sessions) ? result.sessions : []
    const nextCursor =
      wantsPage && typeof result.nextCursor === "string" ? result.nextCursor : undefined
    return listResult(sessions, list, nextCursor)
  } catch (err) {
    if (codeOf(err) === -32601) return listResult([], false)
    return providerFailure(err)
  }
}

export async function dispatchDeleteSession(
  host: ExtendedSessionHost,
  { sessionId }: typeof DeleteSessionParams.infer,
): Promise<ChannelResponse> {
  const unsupported = { status: 200, body: { ok: false, unsupported: true } } as const
  if (
    host.sessionCapabilitiesSource !== "warm-legacy" &&
    !isCapabilityDeclaration(host.agentCapabilities?.sessionCapabilities?.delete)
  ) {
    return unsupported
  }
  try {
    await host.deleteSession(sessionId)
    return { status: 200, body: { ok: true } }
  } catch (err) {
    if (codeOf(err) === -32601) return unsupported
    return providerFailure(err)
  }
}

function providerFailure(err: unknown): ChannelResponse {
  const code = codeOf(err)
  return {
    status: 502,
    body: code === undefined ? { error: messageOf(err) } : { error: messageOf(err), code },
  }
}

export async function tryDispatchBlockingSessionRpc(
  method: string | undefined,
  params: Record<string, unknown>,
  host: ExtendedSessionHost,
  registry: AgentSessionRegistry,
  agentId: string,
): Promise<ChannelResponse | undefined> {
  switch (method) {
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
        return providerFailure(e)
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
        return providerFailure(e)
      }
    }
    default:
      return undefined
  }
}
