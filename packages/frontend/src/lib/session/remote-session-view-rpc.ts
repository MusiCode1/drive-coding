import { RPC_METHODS, type SessionState } from "@drive-coding/core/session"
import type { PromptBlocks } from "@drive-coding/provider/client"
import { normalizeSessionInfo, type SessionInfo } from "$lib/adapters/sessions"
import type { SessionPipe } from "./wire/pipe"
import { resultOf } from "./wire/pipe"

const RETURN_VALUE_EXT_METHODS = new Set<string>(["_drive/getQuota"])
const NOT_SUPPORTED_EXT_RETURN_VALUE = "not supported in remote mode — use state instead"

export type RemoteSessionRpcDeps = {
  pipe: SessionPipe
  getState: () => SessionState
  setState: (state: SessionState) => void
  getSessionId: () => string | null
  setSessionId: (id: string | null) => void
  getSessionCapabilities: () => { delete?: unknown; [key: string]: unknown } | null
  setSessionCapabilities: (caps: { delete?: unknown; [key: string]: unknown } | null) => void
}

async function rpc(deps: RemoteSessionRpcDeps, method: string, params: Record<string, unknown>) {
  return resultOf(await deps.pipe.rpc.call("rpc", { method, params }), deps.pipe.rpc.label("rpc"))
}

export async function remoteNewSession(deps: RemoteSessionRpcDeps, cwd?: string): Promise<void> {
  const res = (await rpc(deps, RPC_METHODS.newSession, { ...(cwd && { cwd }) })) as
    | { sessionId?: unknown }
    | undefined
  const attached =
    typeof res?.sessionId === "string" && res.sessionId.length > 0 ? res.sessionId : null
  if (!attached) throw new Error("RemoteSessionView: newSession returned no sessionId")
  deps.setSessionId(attached)
  deps.setState({ ...deps.getState(), sessionId: attached })
}

export async function remoteLoadSession(
  deps: RemoteSessionRpcDeps,
  sessionId: string,
  cwd?: string,
): Promise<void> {
  const res = (await rpc(deps, RPC_METHODS.loadSession, {
    sessionId,
    ...(cwd && { cwd }),
  })) as { sessionId?: unknown } | undefined
  const attached =
    typeof res?.sessionId === "string" && res.sessionId.length > 0 ? res.sessionId : sessionId
  deps.setSessionId(attached)
  deps.setState({ ...deps.getState(), sessionId: attached })
}

export async function remoteListSessions(deps: RemoteSessionRpcDeps): Promise<SessionInfo[]> {
  const res = (await rpc(deps, RPC_METHODS.listSessions, {})) as
    | { sessions?: unknown; sessionCapabilities?: unknown }
    | undefined
  deps.setSessionCapabilities(
    (res?.sessionCapabilities as { delete?: unknown; [key: string]: unknown } | null | undefined) ??
      null,
  )
  const sessions = res?.sessions
  const raw = Array.isArray(sessions) ? (sessions as unknown[]) : []
  return raw.map(normalizeSessionInfo)
}

export function remoteSupportsSessionDelete(deps: RemoteSessionRpcDeps): boolean {
  return deps.getSessionCapabilities()?.delete != null
}

export async function remoteDeleteSession(
  deps: RemoteSessionRpcDeps,
  sessionId: string,
): Promise<void> {
  const res = (await rpc(deps, RPC_METHODS.deleteSession, { sessionId })) as
    | { ok?: unknown; unsupported?: unknown }
    | undefined
  if (res?.unsupported === true) {
    const err = new Error(
      "RemoteSessionView: deleteSession is not supported by this CLI",
    ) as Error & { code: number }
    err.code = -32601
    throw err
  }
}

export async function remotePrompt(
  deps: RemoteSessionRpcDeps,
  content: string | PromptBlocks,
  meta?: Record<string, unknown>,
): Promise<void> {
  await rpc(deps, RPC_METHODS.prompt, { sessionId: deps.getSessionId(), content, meta })
}

export async function remoteCancel(deps: RemoteSessionRpcDeps): Promise<void> {
  await rpc(deps, RPC_METHODS.cancel, { sessionId: deps.getSessionId() })
}

export async function remoteSetMode(deps: RemoteSessionRpcDeps, mode: string): Promise<void> {
  await rpc(deps, RPC_METHODS.setMode, { sessionId: deps.getSessionId(), modeId: mode })
}

export async function remoteSetConfigOption(
  deps: RemoteSessionRpcDeps,
  key: string,
  value: unknown,
): Promise<void> {
  await rpc(deps, RPC_METHODS.setConfigOption, {
    sessionId: deps.getSessionId(),
    configId: key,
    value,
  })
}

export async function remoteSetSessionModel(
  deps: RemoteSessionRpcDeps,
  model: string,
): Promise<void> {
  await rpc(deps, RPC_METHODS.setSessionModel, { sessionId: deps.getSessionId(), model })
}

export async function remoteExtMethod(
  deps: RemoteSessionRpcDeps,
  method: string,
  params: unknown,
): Promise<unknown> {
  if (RETURN_VALUE_EXT_METHODS.has(method)) {
    throw new Error(NOT_SUPPORTED_EXT_RETURN_VALUE)
  }
  return rpc(deps, RPC_METHODS.extMethod, { sessionId: deps.getSessionId(), method, params })
}

export async function remoteRespond(
  deps: RemoteSessionRpcDeps,
  requestId: number,
  result: unknown,
): Promise<void> {
  const pending = deps.getState().pending
  const kind =
    pending.permission?.requestId === requestId
      ? "permission"
      : pending.elicitation?.requestId === requestId
        ? "elicitation"
        : undefined
  if (kind === undefined) return
  resultOf(
    await deps.pipe.rpc.call("reply", { kind, requestId, result }),
    deps.pipe.rpc.label("reply"),
  )
}
