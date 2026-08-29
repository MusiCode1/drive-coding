/**
 * live-read-recent.ts — last-N session bubbles in RAM (pure, no IO).
 *
 * Pull without a search query. Caps count so this is not a history dump.
 * Default: user/assistant text + tool names. Thoughts and full tool payloads
 * are opt-in flags so the voice secretary can ask for one, the other, or both.
 */

export type RecentRole = "user" | "assistant" | "tool" | "thought"

export type RecentToolDetail = {
  name: string
  status: string
  args?: string
  output?: string
}

export type RecentItem = {
  role: RecentRole
  turnIndex: number
  text: string
  tool?: RecentToolDetail
}

export type RecentMessage = {
  role: RecentRole
  turnIndex: number
  text: string
  tool?: RecentToolDetail
}

export type ReadRecentOpts = {
  count?: number
  maxChars?: number
  /** User/assistant text and name-only tools. Default true. */
  messages?: boolean
  /** Include thought traces. Default false. */
  thoughts?: boolean
  /** Include full tool args/output instead of name-only. Default false. */
  toolCalls?: boolean
}

export const READ_RECENT_DEFAULT_COUNT = 8
export const READ_RECENT_MAX_COUNT = 20
export const READ_RECENT_MAX_CHARS = 600

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

/** Coerce Gemini/Live args (boolean or "true"/"false") to a flag. */
export function parseRecentBool(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") return raw
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase()
    if (s === "true" || s === "1") return true
    if (s === "false" || s === "0") return false
  }
  return undefined
}

function keepItem(
  item: RecentItem,
  opts: { messages: boolean; thoughts: boolean; toolCalls: boolean },
): boolean {
  switch (item.role) {
    case "thought":
      return opts.thoughts
    case "user":
    case "assistant":
      return opts.messages
    case "tool":
      return opts.toolCalls || opts.messages
  }
}

function emitItem(item: RecentItem, toolCalls: boolean, maxChars: number): RecentMessage {
  const text = clipText(item.text, maxChars)
  if (item.role !== "tool" || !item.tool) {
    return { role: item.role, turnIndex: item.turnIndex, text }
  }
  if (!toolCalls) {
    return { role: "tool", turnIndex: item.turnIndex, text }
  }
  const tool: RecentToolDetail = {
    name: item.tool.name,
    status: item.tool.status,
  }
  if (item.tool.args) tool.args = clipText(item.tool.args, maxChars)
  if (item.tool.output) tool.output = clipText(item.tool.output, maxChars)
  return { role: "tool", turnIndex: item.turnIndex, text, tool }
}

export function readRecentBubbles(
  items: readonly RecentItem[],
  opts?: ReadRecentOpts,
): { messages: readonly RecentMessage[]; total: number; returned: number } {
  const count = clampRecentCount(opts?.count ?? READ_RECENT_DEFAULT_COUNT)
  const maxChars = opts?.maxChars ?? READ_RECENT_MAX_CHARS
  const flags = {
    messages: opts?.messages ?? true,
    thoughts: opts?.thoughts ?? false,
    toolCalls: opts?.toolCalls ?? false,
  }

  const eligible: RecentMessage[] = []
  for (const item of items) {
    if (!keepItem(item, flags)) continue
    eligible.push(emitItem(item, flags.toolCalls, maxChars))
  }

  const messages = eligible.slice(-count)
  return {
    messages,
    total: eligible.length,
    returned: messages.length,
  }
}
