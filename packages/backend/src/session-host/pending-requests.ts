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
 * `timeoutMs: null` disables the timeout entirely — the promise stays pending
 * until respond()/respondAll(). That is the default for permission and
 * elicitation requests: a question the user has not answered yet must not
 * answer itself.
 *
 * ─── slice session-host-core C3 (TDD) ───
 */

// ─── Public API ─────────────────────────────────────────────────────────────

export type PendingRequestsOptions<T> = {
  /**
   * Milliseconds before the request settles on its own, or `null` for no
   * timeout at all.
   *
   * 🛑 `null` means "never call setTimeout" — do NOT express "no timeout" as a
   * huge number. Node coerces any delay above 2_147_483_647 (and Infinity)
   * down to **1ms** with a TimeoutOverflowWarning, so a request meant to wait
   * forever would instead settle immediately: strictly worse than the finite
   * timeout it replaced.
   */
  timeoutMs: number | null
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

  /**
   * slice handoff-foundations C2: resolve ALL pending requests with the given
   * value. Iterates over the internal map (not SessionState.pending, which
   * holds only the last of each kind). Clears timers. Idempotent — a second
   * call is a no-op (map is empty).
   */
  respondAll(result: T): void
}

type PendingEntry<T> = {
  resolve: (value: T) => void
  reject: (err: Error) => void
  /** null when the registry runs without a timeout (timeoutMs === null). */
  timer: ReturnType<typeof setTimeout> | null
  settled: boolean
}

/**
 * createPendingRequests — factory for a typed pending-request registry.
 *
 * @example
 * // permission requests — no timeout (the production default)
 * const permPending = createPendingRequests<RequestPermissionResponse>({
 *   timeoutMs: null,
 *   defaultValue: { outcome: "deny" }
 * })
 */
export function createPendingRequests<T>(options: PendingRequestsOptions<T>): PendingRequests<T> {
  const { timeoutMs, defaultValue } = options
  const hasDefault = Object.hasOwn(options, "defaultValue")

  const map = new Map<number, PendingEntry<T>>()

  function request(requestId: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // No timeout: register the entry and leave the promise pending. Nothing
      // but respond()/respondAll() can settle it.
      if (timeoutMs === null) {
        map.set(requestId, { resolve, reject, timer: null, settled: false })
        return
      }

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
    if (entry.timer !== null) clearTimeout(entry.timer)
    map.delete(requestId)
    entry.resolve(result)
  }

  // slice handoff-foundations C2: resolve ALL pending from the map itself
  // (not SessionState.pending, which holds only the last of each kind).
  // Clears timers. Idempotent — empty map = no-op.
  function respondAll(result: T): void {
    for (const [requestId, entry] of map) {
      if (entry.settled) continue
      entry.settled = true
      if (entry.timer !== null) clearTimeout(entry.timer)
      map.delete(requestId)
      entry.resolve(result)
    }
  }

  return { request, respond, respondAll }
}
