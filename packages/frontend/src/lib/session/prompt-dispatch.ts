import { type ChannelResponse, RPC_METHODS } from "@drive-coding/core/session"
import type { PromptBlocks } from "@drive-coding/provider/client"
import type { RpcPipe } from "./wire/pipe"

export const PROMPT_DISPATCH_TIMEOUT_MS = 30_000

type PromptRejection =
  | {
      retryable: true
      reason: "session-mismatch" | "scope-denied" | "connection-not-found"
    }
  | { retryable: true; reason: "auth-required"; authMethods: unknown[] }
  | { retryable: false; reason: "invalid-request" }

export type PromptDispatchOutcome =
  | { kind: "not-started" }
  | { kind: "accepted" }
  | ({ kind: "rejected"; error: string } & PromptRejection)
  | { kind: "unknown" }

export async function dispatchOwnedPrompt(
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Trust only response shapes that prove rejection before the host started a turn. */
export function classifyPromptDispatch({ status, body }: ChannelResponse): PromptDispatchOutcome {
  if (status === 202) return { kind: "accepted" }
  if (!isObject(body) || typeof body.error !== "string") return { kind: "unknown" }

  const { error } = body
  const rejection = { kind: "rejected" as const, error }
  if (status === 409 && body.code === "prompt_session_mismatch") {
    return { ...rejection, retryable: true, reason: "session-mismatch" }
  }
  if (
    status === 403 &&
    error === "scope-denied" &&
    typeof body.reason === "string" &&
    typeof body.hint === "string"
  ) {
    return { ...rejection, retryable: true, reason: "scope-denied" }
  }
  if (status === 401 && body.kind === "auth_required" && Array.isArray(body.authMethods)) {
    return {
      ...rejection,
      retryable: true,
      reason: "auth-required",
      authMethods: body.authMethods,
    }
  }
  if (status === 404 && error === "Agent connection not found") {
    return { ...rejection, retryable: true, reason: "connection-not-found" }
  }
  if (status === 400 && (error === "invalid waitMs" || error === "invalid json")) {
    return { ...rejection, retryable: false, reason: "invalid-request" }
  }
  return { kind: "unknown" }
}
