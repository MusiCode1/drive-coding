/**
 * Stateless HTTP dispatch helpers extracted from RemoteSessionView (slice state-http-viewer-detach-1a).
 * No lifecycle, timers, or owned state — callers pass delivery/ingress guards per dispatch.
 */

import type { SessionViewDelivery } from "./session-view-delivery"

export type RemoteHttpPostContext = {
  doFetch: (url: string, init?: RequestInit) => Promise<Response>
  headers: Record<string, string>
  assertCurrent: () => void
}

export async function remoteHttpPost(
  ctx: RemoteHttpPostContext,
  url: string,
  body: unknown,
): Promise<unknown> {
  const res = await ctx.doFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ctx.headers },
    body: JSON.stringify(body),
  })
  ctx.assertCurrent()
  if (!res.ok) {
    let payload: { error?: unknown; code?: unknown } | undefined
    if (res.json) {
      try {
        payload = (await res.json()) as { error?: unknown; code?: unknown }
      } catch {
        payload = undefined
      }
    }
    ctx.assertCurrent()
    const detail =
      payload && typeof payload.error === "string" && payload.error.length > 0
        ? ` (${payload.error})`
        : ""
    const err = new Error(
      `RemoteSessionView: POST ${url} failed with status ${res.status}${detail}`,
    ) as Error & { code?: number }
    if (payload && typeof payload.code === "number") err.code = payload.code
    throw err
  }
  if (!res.json) return undefined
  try {
    const value: unknown = await res.json()
    ctx.assertCurrent()
    return value
  } catch (error) {
    ctx.assertCurrent()
    void error
    return undefined
  }
}

export function resolveRemoteReplyKind(
  delivery: SessionViewDelivery,
  requestId: number,
): "permission" | "elicitation" | undefined {
  if (delivery.state.pending.permission?.requestId === requestId) return "permission"
  if (delivery.state.pending.elicitation?.requestId === requestId) return "elicitation"
  return undefined
}

export async function dispatchRemoteReply(
  ctx: RemoteHttpPostContext,
  delivery: SessionViewDelivery,
  replyUrl: string,
  requestId: number,
  result: unknown,
  ingressClosed: boolean,
  terminalFact: unknown,
): Promise<void> {
  const kind = resolveRemoteReplyKind(delivery, requestId)
  if (kind === undefined) return
  if (ingressClosed && !terminalFact) return
  await remoteHttpPost(ctx, replyUrl, { kind, requestId, result })
}
