/**
 * agent-events.ts — in-memory pub/sub for agent lifecycle events (slice be-events-subscribe).
 *
 * Map<targetId, Set<subscriberId>> — no persistence. Subscriptions survive subscriber death.
 */

import type { AgentEvent, AgentEventKind } from "@drive-coding/core/schemas/agent-events.js"

export type { AgentEvent, AgentEventKind }

export const DEFAULT_STALL_SUSPECT_MS = 600_000

/**
 * resolveStallSuspectMs — parses STALL_SUSPECT_MS.
 * Same contract as resolveHttpOwnerTtlMs: missing/blank/NaN/≤0/Infinity → default.
 */
export function resolveStallSuspectMs(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_STALL_SUSPECT_MS
  const trimmed = raw.trim()
  if (trimmed === "") return DEFAULT_STALL_SUSPECT_MS
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_STALL_SUSPECT_MS
  return n
}

export type AgentEventBus = {
  subscribe(targetId: string, subscriberId: string): void
  unsubscribe(targetId: string, subscriberId: string): void
  subscribersOf(targetId: string): readonly string[]
  emit(event: AgentEvent): void
  onEvent(cb: (e: AgentEvent, subscriberIds: readonly string[]) => void): () => void
}

export function createAgentEventBus(): AgentEventBus {
  const subs = new Map<string, Set<string>>()
  const listeners = new Set<(e: AgentEvent, subscriberIds: readonly string[]) => void>()

  return {
    subscribe(targetId: string, subscriberId: string): void {
      let set = subs.get(targetId)
      if (!set) {
        set = new Set()
        subs.set(targetId, set)
      }
      set.add(subscriberId)
    },

    unsubscribe(targetId: string, subscriberId: string): void {
      const set = subs.get(targetId)
      if (!set) return
      set.delete(subscriberId)
      if (set.size === 0) subs.delete(targetId)
    },

    subscribersOf(targetId: string): readonly string[] {
      const set = subs.get(targetId)
      return set ? [...set] : []
    },

    emit(event: AgentEvent): void {
      const subscriberIds = this.subscribersOf(event.agentId)
      for (const cb of listeners) {
        cb(event, subscriberIds)
      }
    },

    onEvent(cb: (e: AgentEvent, subscriberIds: readonly string[]) => void): () => void {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
  }
}
