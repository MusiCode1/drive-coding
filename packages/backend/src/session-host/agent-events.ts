/**
 * agent-events.ts — in-memory pub/sub for agent lifecycle events (slice be-events-subscribe).
 *
 * Map<targetId, Map<subscriberId, options>> — no persistence. Subscriptions survive subscriber death.
 */

import type { AgentEvent, AgentEventKind } from "@drive-coding/core"

export type { AgentEvent, AgentEventKind }

export const DEFAULT_STALL_SUSPECT_MS = 600_000

export type AgentSubscribeOptions = { includeLastAssistantText: boolean }

const DEFAULT_SUBSCRIBE_OPTIONS: AgentSubscribeOptions = { includeLastAssistantText: false }

function normalizeOptions(options?: AgentSubscribeOptions): AgentSubscribeOptions {
  return {
    includeLastAssistantText: options?.includeLastAssistantText === true,
  }
}

function optionsEqual(a: AgentSubscribeOptions, b: AgentSubscribeOptions): boolean {
  return a.includeLastAssistantText === b.includeLastAssistantText
}

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
  subscribe(targetId: string, subscriberId: string, options?: AgentSubscribeOptions): void
  unsubscribe(targetId: string, subscriberId: string): void
  subscribersOf(targetId: string): readonly string[]
  optionsOf(targetId: string, subscriberId: string): AgentSubscribeOptions | undefined
  emit(event: AgentEvent): void
  onEvent(cb: (e: AgentEvent, subscriberIds: readonly string[]) => void): () => void
}

export function createAgentEventBus(): AgentEventBus {
  const subs = new Map<string, Map<string, AgentSubscribeOptions>>()
  const listeners = new Set<(e: AgentEvent, subscriberIds: readonly string[]) => void>()

  return {
    subscribe(targetId: string, subscriberId: string, options?: AgentSubscribeOptions): void {
      const normalized = normalizeOptions(options)
      let map = subs.get(targetId)
      if (!map) {
        map = new Map()
        subs.set(targetId, map)
      }
      const existing = map.get(subscriberId)
      if (existing !== undefined && optionsEqual(existing, normalized)) {
        return
      }
      map.set(subscriberId, normalized)
    },

    unsubscribe(targetId: string, subscriberId: string): void {
      const map = subs.get(targetId)
      if (!map) return
      map.delete(subscriberId)
      if (map.size === 0) subs.delete(targetId)
    },

    subscribersOf(targetId: string): readonly string[] {
      const map = subs.get(targetId)
      return map ? [...map.keys()] : []
    },

    optionsOf(targetId: string, subscriberId: string): AgentSubscribeOptions | undefined {
      return subs.get(targetId)?.get(subscriberId)
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
