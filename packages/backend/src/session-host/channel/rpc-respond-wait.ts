/**
 * rpc-respond-wait.ts — JSON-RPC error mapping + wait response bodies for rpc.ts.
 */

import { raceKeepRunning } from "./rpc-wait.js"

export function codeOf(e: unknown): number | undefined {
  if (typeof e === "object" && e !== null) {
    const code = (e as { code?: unknown }).code
    if (typeof code === "number") return code
  }
  return undefined
}

export function messageOf(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    const message = (e as { message?: unknown }).message
    if (typeof message === "string" && message.length > 0) return message
  }
  return String(e)
}

function rpcWaitErrorField(error: unknown): { message: string; code?: number } {
  const code = codeOf(error)
  const message = messageOf(error)
  return code === undefined ? { message } : { message, code }
}

export async function respondRpcWait<T>(
  host: { state: { version: number } },
  work: Promise<T>,
  waitMs: number,
  onLateSettle: (error: unknown) => void,
  onSuccess?: (value: T) => Record<string, unknown>,
): Promise<{ status: 200; body: Record<string, unknown> }> {
  const raced = await raceKeepRunning(work, waitMs, onLateSettle)
  if (raced.outcome === "timedOut") {
    return { status: 200, body: { version: host.state.version, ok: false, timedOut: true } }
  }
  if (raced.outcome === "rejected") {
    return {
      status: 200,
      body: {
        version: host.state.version,
        ok: false,
        timedOut: false,
        error: rpcWaitErrorField(raced.error),
      },
    }
  }
  const extra = onSuccess ? onSuccess(raced.value) : {}
  return {
    status: 200,
    body: { version: host.state.version, ok: true, timedOut: false, ...extra },
  }
}
