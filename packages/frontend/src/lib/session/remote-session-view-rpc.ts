import { RPC_METHODS, type SessionListQuery, type SessionState } from "@drive-coding/core/session"
import type { PromptBlocks } from "@drive-coding/provider/client"
import { normalizeSessionInfo, type SessionListPage } from "$lib/adapters/sessions"
import {
  classifyPromptDispatch,
  PROMPT_DISPATCH_TIMEOUT_MS,
  type PromptDispatchOutcome,
} from "./prompt-dispatch"
import { resultOf, type RpcPipe, type SessionPipe } from "./wire/pipe"

const RETURN_VALUE_EXT_METHODS = new Set<string>(["_drive/getQuota"])
const NOT_SUPPORTED_EXT_RETURN_VALUE = "not supported in remote mode — use state instead"

export type RemoteSessionRpcDeps = {
  pipe: SessionPipe
  getState: () => SessionState
  setState: (state: SessionState) => void
  getSessionId: () => string | null
  setSessionId: (id: string | null) => void
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function decodeSessionPage(body: unknown): SessionListPage {
  if (!isObject(body) || !Array.isArray(body.sessions)) {
    throw new Error("RemoteSessionView: invalid session list response")
  }
  const sessions = body.sessions.filter(isObject).map(normalizeSessionInfo)
  const caps = body.capabilities
  if (caps === undefined) {
    return {
      sessions,
      capabilities: null,
      legacyCanDelete:
        isObject(body.sessionCapabilities) && body.sessionCapabilities.delete != null,
    }
  }
  if (
    !isObject(caps) ||
    typeof caps.list !== "boolean" ||
    typeof caps.filterByCwd !== "boolean" ||
    typeof caps.delete !== "boolean"
  ) {
    throw new Error("RemoteSessionView: invalid session list capabilities")
  }
  return {
    sessions,
    capabilities: { list: caps.list, filterByCwd: caps.filterByCwd, delete: caps.delete },
    legacyCanDelete: false,
    ...(typeof body.nextCursor === "string" && { nextCursor: body.nextCursor }),
  }
}

export async function remoteListSessions(
  deps: RemoteSessionRpcDeps,
  { cwd, cursor }: SessionListQuery = {},
): Promise<SessionListPage> {
  const body = await rpc(deps, RPC_METHODS.listSessions, {
    paged: true,
    ...(cwd !== undefined && { cwd }),
    ...(cursor !== undefined && { cursor }),
  })
  if (isObject(body) && body.legacyOnly === true) {
    if (cursor === undefined)
      return decodeSessionPage(await rpc(deps, RPC_METHODS.listSessions, {}))
    return { ...decodeSessionPage(body), sessions: [], nextCursor: undefined }
  }
  return decodeSessionPage(body)
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

export async function remotePromptTo(
  pipe: RpcPipe,
  sessionId: string,
  content: string | PromptBlocks,
  meta?: Record<string, unknown>,
): Promise<PromptDispatchOutcome> {
  try {
    const response = await pipe.call(
      "rpc",
      { method: RPC_METHODS.prompt, params: { sessionId, content, meta } },
      { timeoutMs: PROMPT_DISPATCH_TIMEOUT_MS, statusOnlyOn: 202 },
    )
    return classifyPromptDispatch(response)
  } catch {
    // Transport errors cannot establish whether the host received the prompt.
    return { kind: "unknown" }
  }
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
