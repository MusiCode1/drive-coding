/**
 * live-read-recent.ts — last-N session bubbles in RAM (pure, no IO).
 *
 * Pull without a search query. Caps count so this is not a history dump.
 */

import type { LiveSeedBubble } from "./live-seed.js"

export type RecentMessage = {
  role: "user" | "assistant" | "tool"
  turnIndex: number
  text: string
}

export const READ_RECENT_DEFAULT_COUNT = 8
export const READ_RECENT_MAX_COUNT = 20
export const READ_RECENT_MAX_CHARS = 600

function messageRole(kind: LiveSeedBubble["kind"]): RecentMessage["role"] | null {
  if (kind === "status") return null
  return kind
}

function clipText(text: string, maxChars: number): string {
  const chars = [...text]
  if (chars.length <= maxChars) return text
  return `${chars.slice(0, maxChars - 1).join("")}\u2026`
}

export function clampRecentCount(n: number): number {
  if (!Number.isFinite(n)) return READ_RECENT_DEFAULT_COUNT
  return Math.min(READ_RECENT_MAX_COUNT, Math.max(1, Math.floor(n)))
}

/** Coerce Gemini/Live args (number or numeric string) to a count. */
export function parseRecentCount(raw: unknown): number {
  if (typeof raw === "number") return clampRecentCount(raw)
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw)
    if (Number.isFinite(n)) return clampRecentCount(n)
  }
  return READ_RECENT_DEFAULT_COUNT
}

export function readRecentBubbles(
  bubbles: readonly LiveSeedBubble[],
  opts?: { count?: number; maxChars?: number },
): { messages: readonly RecentMessage[]; total: number; returned: number } {
  const count = clampRecentCount(opts?.count ?? READ_RECENT_DEFAULT_COUNT)
  const maxChars = opts?.maxChars ?? READ_RECENT_MAX_CHARS

  const eligible: RecentMessage[] = []
  for (const bubble of bubbles) {
    const role = messageRole(bubble.kind)
    if (role === null) continue
    eligible.push({
      role,
      turnIndex: bubble.turnIndex,
      text: clipText(bubble.text, maxChars),
    })
  }

  const messages = eligible.slice(-count)
  return {
    messages,
    total: eligible.length,
    returned: messages.length,
  }
}
