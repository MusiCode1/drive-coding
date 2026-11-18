/**
 * live-memory.ts — memory quotas, truncation, overflow policies (pure, no IO).
 *
 * Slice: live-context, Commit 2.
 */

export type MemoryItem = { id: string; text: string }
export type MemoryLayer = "session" | "always"

export type MemoryQuotas = {
  maxItems: number
  maxItemChars: number
  maxTotalChars: number
}

export type MemoryResult = {
  ok: boolean
  items: readonly MemoryItem[]
  full: boolean
}

function truncateText(text: string, maxItemChars: number): string {
  if (maxItemChars <= 0) return ""
  return [...text].slice(0, maxItemChars).join("")
}

function totalChars(items: readonly MemoryItem[]): number {
  return items.reduce((sum, item) => sum + item.text.length, 0)
}

function newId(items: readonly MemoryItem[], text: string): string {
  return `mem-${items.length + 1}-${text.length}`
}

function findDuplicateText(
  items: readonly MemoryItem[],
  text: string,
  excludeId?: string,
): MemoryItem | undefined {
  return items.find((item) => item.text === text && item.id !== excludeId)
}

function fitsQuotas(items: readonly MemoryItem[], quotas: MemoryQuotas): boolean {
  return items.length <= quotas.maxItems && totalChars(items) <= quotas.maxTotalChars
}

function evictOldestUntilFit(items: MemoryItem[], quotas: MemoryQuotas): MemoryItem[] {
  const next = [...items]
  while (next.length > 0 && !fitsQuotas(next, quotas)) {
    next.shift()
  }
  return next
}

export function upsertMemory(
  items: readonly MemoryItem[],
  entry: { text: string; id?: string },
  layer: MemoryLayer,
  quotas: MemoryQuotas,
): MemoryResult {
  const text = truncateText(entry.text, quotas.maxItemChars)

  if (entry.id !== undefined) {
    const idx = items.findIndex((item) => item.id === entry.id)
    if (idx >= 0) {
      const next = items.map((item) => (item.id === entry.id ? { id: entry.id, text } : item))
      return { ok: true, items: next, full: false }
    }
  }

  const duplicate = entry.id === undefined ? findDuplicateText(items, text, entry.id) : undefined
  if (duplicate !== undefined) {
    return { ok: true, items, full: false }
  }

  const newItem: MemoryItem = { id: entry.id ?? newId(items, text), text }
  const candidate = [...items, newItem]

  if (layer === "session") {
    const trimmed = evictOldestUntilFit(candidate, quotas)
    return { ok: true, items: trimmed, full: false }
  }

  if (!fitsQuotas(candidate, quotas)) {
    return { ok: false, items, full: true }
  }

  return { ok: true, items: candidate, full: false }
}

export function formatMemoryForPrompt(items: readonly MemoryItem[]): string {
  if (items.length === 0) return ""
  return items.map((item, index) => `${index + 1}. [${item.id}] ${item.text}`).join("\n")
}
