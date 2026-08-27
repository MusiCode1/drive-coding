/**
 * live-search.ts — search session bubbles in RAM (pure, no IO).
 *
 * Slice: live-context, Commit 1.
 */

import type { LiveSeedBubble } from "./live-seed.js"

export type SearchHit = {
  /** Subset of LiveSeedBubble["kind"] — excludes "status". */
  role: "user" | "assistant" | "tool"
  turnIndex: number
  snippet: string
}

const DEFAULT_LIMIT = 5
const DEFAULT_SNIPPET_CHARS = 200

const WORD_TOKEN = /[a-zA-Z0-9_]+/g

function tokenizeQuery(query: string): string[] {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []

  const tokens: string[] = []
  let m: RegExpExecArray | null

  const hebrewRe = /[\u0590-\u05FF]+/gu
  m = hebrewRe.exec(trimmed)
  while (m !== null) {
    tokens.push(m[0].toLowerCase())
    m = hebrewRe.exec(trimmed)
  }

  const wordRe = new RegExp(WORD_TOKEN.source, "g")
  m = wordRe.exec(trimmed)
  while (m !== null) {
    tokens.push(m[0].toLowerCase())
    m = wordRe.exec(trimmed)
  }

  return tokens
}

function searchableRole(kind: LiveSeedBubble["kind"]): SearchHit["role"] | null {
  if (kind === "status") return null
  return kind
}

function haystackForBubble(bubble: LiveSeedBubble): string {
  return bubble.text.toLowerCase()
}

function matchesTokens(haystack: string, tokens: readonly string[]): boolean {
  return tokens.every((t) => haystack.includes(t))
}

function snippetAround(text: string, tokens: readonly string[], maxChars: number): string {
  const lower = text.toLowerCase()
  let anchor = 0
  for (const t of tokens) {
    const idx = lower.indexOf(t)
    if (idx >= 0) {
      anchor = idx
      break
    }
  }

  const chars = [...text]
  const budget = Math.max(1, maxChars)
  const start = Math.max(0, anchor - Math.floor(budget / 4))
  const end = Math.min(chars.length, start + budget)
  let slice = chars.slice(start, end).join("")
  if (start > 0 && slice.length > 1) {
    slice = `\u2026${slice.slice(1)}`
  }
  if (end < chars.length && [...slice].length >= budget) {
    const codepoints = [...slice]
    slice = `${codepoints.slice(0, budget - 1).join("")}\u2026`
  }
  return [...slice].length <= budget ? slice : [...slice].slice(0, budget).join("")
}

export function searchSessionBubbles(
  bubbles: readonly LiveSeedBubble[],
  query: string,
  opts?: { limit?: number; snippetChars?: number },
): { hits: readonly SearchHit[]; totalMatches: number } {
  const tokens = tokenizeQuery(query)
  if (tokens.length === 0) {
    return { hits: [], totalMatches: 0 }
  }

  const limit = opts?.limit ?? DEFAULT_LIMIT
  const snippetChars = opts?.snippetChars ?? DEFAULT_SNIPPET_CHARS

  const allMatches: SearchHit[] = []
  for (const bubble of bubbles) {
    const role = searchableRole(bubble.kind)
    if (role === null) continue

    const haystack = haystackForBubble(bubble)
    if (!matchesTokens(haystack, tokens)) continue

    allMatches.push({
      role,
      turnIndex: bubble.turnIndex,
      snippet: snippetAround(bubble.text, tokens, snippetChars),
    })
  }

  return {
    hits: allMatches.slice(0, limit),
    totalMatches: allMatches.length,
  }
}
