/**
 * live-memory-store.ts — session RAM + always localStorage for Live secretary.
 *
 * Separate key from settings blob (F.7). Pure quotas live in core; IO here.
 */

import {
  type MemoryItem,
  type MemoryQuotas,
  upsertMemory,
} from "@drive-coding/core/voice/live-memory"

export const LIVE_ALWAYS_MEMORY_KEY = "drive-coding-live-memory-always"

/** Starting quotas — F.7 left exact numbers to a spike; ~2k chars total budget. */
export const SESSION_MEMORY_QUOTAS: MemoryQuotas = {
  maxItems: 20,
  maxItemChars: 200,
  maxTotalChars: 2000,
}

export const ALWAYS_MEMORY_QUOTAS: MemoryQuotas = {
  maxItems: 15,
  maxItemChars: 200,
  maxTotalChars: 2000,
}

export function loadAlwaysMemory(): MemoryItem[] {
  if (typeof localStorage === "undefined") return []
  try {
    const raw = localStorage.getItem(LIVE_ALWAYS_MEMORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isMemoryItem)
  } catch {
    return []
  }
}

export function saveAlwaysMemory(items: readonly MemoryItem[]): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(LIVE_ALWAYS_MEMORY_KEY, JSON.stringify(items))
  } catch {
    /* quota / private mode — ignore */
  }
}

function isMemoryItem(value: unknown): value is MemoryItem {
  if (typeof value !== "object" || value === null) return false
  const rec = value as Record<string, unknown>
  return typeof rec.id === "string" && typeof rec.text === "string"
}

export function rememberSession(
  items: readonly MemoryItem[],
  entry: { text: string; id?: string },
) {
  return upsertMemory(items, entry, "session", SESSION_MEMORY_QUOTAS)
}

export function rememberAlways(
  items: readonly MemoryItem[],
  entry: { text: string; id?: string },
) {
  return upsertMemory(items, entry, "always", ALWAYS_MEMORY_QUOTAS)
}
