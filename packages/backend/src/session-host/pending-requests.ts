/**
 * pending-requests.ts — PendingRequests (C3).
 *
 * Generic promise registry for request_permission / elicitation/create.
 * Stores Map<requestId, {resolve, reject, timer}>.
 *
 * Usage:
 *   const pending = createPendingRequests({ timeoutMs: 30_000 })
 *   const result = await pending.request(requestId)   // resolves or rejects
 *   pending.respond(requestId, value)                 // resolve from ACP handler
 *
 * Timeout: if respond() is not called within timeoutMs, the promise:
 *   - rejects with Error("Request timed out") if no defaultValue provided
 *   - resolves with defaultValue if provided
 *
 * ─── slice session-host-core C3 (TDD) ───
 */

// ─── Public API ─────────────────────────────────────────────────────────────

export type PendingRequestsOptions<T> = {
  timeoutMs: number
  /**
   * Optional default value returned on timeout instead of rejecting.
   * When provided, timeout resolves with defaultValue rather than throwing.
   */
  defaultValue?: T
}

export type PendingRequests<T = unknown> = {
  /**
   * Register a new pending request by requestId.
   * Returns a promise that resolves with the response or rejects on timeout.
   */
  request(requestId: number): Promise<T>

  /**
   * Resolve the pending request with the given result.
   * If requestId is unknown (already timed out or never registered), no-op.
   */
  respond(requestId: number, result: T): void
}

type PendingEntry<T> = {
  resolve: (value: T) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
  settled: boolean
}

/**
 * createPendingRequests — factory for a typed pending-request registry.
 *
 * @example
 * // permission requests (auto-deny after 30s)
 * const permPending = createPendingRequests<RequestPermissionResponse>({
 *   timeoutMs: 30_000,
 *   defaultValue: { outcome: "deny" }
 * })
 */
export function createPendingRequests<T>(options: PendingRequestsOptions<T>): PendingRequests<T> {
  const { timeoutMs, defaultValue } = options
  const hasDefault = Object.hasOwn(options, "defaultValue")

  const map = new Map<number, PendingEntry<T>>()

  function request(requestId: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const entry = map.get(requestId)
        if (!entry || entry.settled) return
        entry.settled = true
        map.delete(requestId)

        if (hasDefault) {
          resolve(defaultValue as T)
        } else {
          reject(new Error(`Request ${requestId} timeout after ${timeoutMs}ms`))
        }
      }, timeoutMs)

      map.set(requestId, { resolve, reject, timer, settled: false })
    })
  }

  function respond(requestId: number, result: T): void {
    const entry = map.get(requestId)
    if (!entry || entry.settled) return
    entry.settled = true
    clearTimeout(entry.timer)
    map.delete(requestId)
    entry.resolve(result)
  }

  return { request, respond }
}
