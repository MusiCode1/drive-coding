/**
 * eviction-controller.ts — EvictionController (ownership-handoff C4).
 *
 * Shared controller injected into both ws-agent (fills it) and
 * AgentSessionRegistry (calls it). Allows HTTP to evict the active WS
 * for an agentId and wait until detach is complete before taking the wire.
 *
 * Design (brief option B): ws-agent remains a plain onConnect function;
 * server.ts creates the controller and passes it to both sides.
 *
 * evictAndWait(agentId, code):
 *   - Sends ws.close(code) to the currently registered WS for agentId
 *   - Returns a Promise that resolves only after onDetach() is called
 *     (after unsub + unsubCrash complete in the ws-agent close handler)
 *   - Timeout: if onDetach not called within timeoutMs → reject
 *   - No-op if no WS registered for agentId (resolves immediately)
 *
 * ─── slice ownership-handoff C4 ───
 */

import { createLogger } from "@drive-coding/core/log"

const log = createLogger("backend.eviction-controller")

export type EvictionController = {
  /**
   * Register a WebSocket for an agentId.
   * Returns a notify function — call it from the WS detach handler AFTER
   * cleanup is complete; this signals evictAndWait to resolve.
   */
  register(
    agentId: string,
    ws: { close(code: number, reason?: string): void },
  ): { notifyDetached: () => void }

  /**
   * Evict the registered WS for agentId (if any) and wait for its
   * notifyDetached callback to be called (cleanup complete).
   * Resolves immediately if nothing is registered.
   * Rejects with timeout error if detach takes longer than timeoutMs.
   */
  evictAndWait(agentId: string, code: number, timeoutMs?: number): Promise<void>
}

const DEFAULT_EVICT_TIMEOUT_MS = 5_000

export function createEvictionController(): EvictionController {
  type Entry = {
    ws: { close(code: number, reason?: string): void }
    // resolve callbacks waiting on this WS's detach
    waiters: Array<() => void>
    timersByWaiter: Set<ReturnType<typeof setTimeout>>
  }

  const registry = new Map<string, Entry>()

  return {
    register(agentId, ws) {
      // Overwrite any prior entry (new WS for same agent)
      registry.set(agentId, { ws, waiters: [], timersByWaiter: new Set() })

      return {
        notifyDetached() {
          const entry = registry.get(agentId)
          if (!entry || entry.ws !== ws) return
          registry.delete(agentId)
          for (const timer of entry.timersByWaiter) clearTimeout(timer)
          for (const resolve of entry.waiters) resolve()
        },
      }
    },

    evictAndWait(agentId, code, timeoutMs = DEFAULT_EVICT_TIMEOUT_MS) {
      const entry = registry.get(agentId)
      if (!entry) return Promise.resolve()

      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          const e = registry.get(agentId)
          if (e) {
            const idx = e.waiters.indexOf(resolve)
            if (idx !== -1) e.waiters.splice(idx, 1)
            e.timersByWaiter.delete(timer)
          }
          reject(new Error(`EvictionController: evictAndWait timeout for agentId=${agentId}`))
        }, timeoutMs)

        entry.waiters.push(resolve)
        entry.timersByWaiter.add(timer)

        try {
          log.info({ agentId, code }, "evicting WS for HTTP takeover")
          entry.ws.close(code, "taken over by HTTP")
        } catch {
          /* WS already closed — notifyDetached will resolve on close event */
        }
      })
    },
  }
}
