/**
 * claude-subagent-parse.ts — שכבת-נתונים טהורה לתעתיק תת-סוכן (slice subagent-transcript-data-v2, B1).
 *
 * מקור: `_claude/sdkMessage` ext notification (raw Claude Agent SDK messages), דרך
 * `#onExtNotification` ב-agent-session.svelte.ts. ר' docs/plans/slice-subagent-transcript-data-v2.md.
 *
 * Commit 1 — פרסר טהור (guards ממוקדים, לא `as SDKMessage`):
 *   `parseClaudeSdkMessage` — unknown → ClaudeSubagentEvent.
 *
 * (index + reducer מתווספים ב-Commit 2.)
 */

// ─── event types (parser output) ──────────────────────────────────────────────

export type SubagentTaskEvent = {
  kind: "task"
  subtype: "task_started" | "task_progress" | "task_notification" | "task_updated"
  taskId: string
  /** נוכח ב-started/progress/notification. נעדר ב-task_updated (Q3 — index פותר). */
  toolUseId?: string
  meta: {
    subagentType?: string
    prompt?: string
    lastToolName?: string
    summary?: string
    /** raw status string (task_notification.status / task_updated.patch.status) — לא ממופה עדיין. */
    status?: string
  }
}

export type AssistantDeltaEvent = {
  kind: "assistantDelta"
  parentToolUseId: string
  messageId: string
  /** raw content blocks (unknown[]) — text/thinking/tool_use וכו'. הפרסר לא מפרש אותם. */
  blocks: unknown[]
}

export type ToolResultEvent = {
  kind: "toolResult"
  parentToolUseId: string
  /** מפתח-זיהוי: message.uuid, fallback ל-tool_use_id של הבלוק הראשון. */
  key: string
  blocks: unknown[]
}

export type IgnoredEvent = { kind: "ignored" }

export type ClaudeSubagentEvent =
  | SubagentTaskEvent
  | AssistantDeltaEvent
  | ToolResultEvent
  | IgnoredEvent

// ─── guards ────────────────────────────────────────────────────────────────────

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x)
}

const IGNORED: IgnoredEvent = { kind: "ignored" }

const TASK_SUBTYPES = new Set([
  "task_started",
  "task_progress",
  "task_notification",
  "task_updated",
])

// ─── parser ───────────────────────────────────────────────────────────────

/**
 * ממיר את ה-params הגולמיים של `_claude/sdkMessage` ל-ClaudeSubagentEvent.
 * `unknown` בכניסה — ה-SDK unions רחבים/משתנים (§9 Q2); guards ממוקדים, לא `as SDKMessage`.
 * מחזיר `{kind:"ignored"}` על כל צורה לא-מוכרת/top-level (ללא parent) — לא זורק.
 */
export function parseClaudeSdkMessage(params: unknown): ClaudeSubagentEvent {
  if (!isRecord(params)) return IGNORED
  const message = params.message
  if (!isRecord(message)) return IGNORED

  const type = message.type
  if (type === "system") return parseSystemMessage(message)
  if (type === "assistant") return parseAssistantMessage(message)
  if (type === "user") return parseUserMessage(message)
  return IGNORED
}

function parseSystemMessage(message: Record<string, unknown>): ClaudeSubagentEvent {
  const subtype = message.subtype
  if (typeof subtype !== "string" || !TASK_SUBTYPES.has(subtype)) return IGNORED
  const taskId = message.task_id
  if (typeof taskId !== "string") return IGNORED

  const toolUseId = typeof message.tool_use_id === "string" ? message.tool_use_id : undefined
  const meta: SubagentTaskEvent["meta"] = {}
  if (typeof message.subagent_type === "string") meta.subagentType = message.subagent_type
  if (typeof message.prompt === "string") meta.prompt = message.prompt
  if (typeof message.last_tool_name === "string") meta.lastToolName = message.last_tool_name
  if (typeof message.summary === "string") meta.summary = message.summary
  if (typeof message.status === "string") meta.status = message.status
  // task_updated: הסטטוס נמצא ב-patch.status, לא ברמה העליונה
  if (subtype === "task_updated" && isRecord(message.patch)) {
    const patchStatus = message.patch.status
    if (typeof patchStatus === "string") meta.status = patchStatus
  }

  return {
    kind: "task",
    subtype: subtype as SubagentTaskEvent["subtype"],
    taskId,
    ...(toolUseId !== undefined && { toolUseId }),
    meta,
  }
}

function parseAssistantMessage(message: Record<string, unknown>): ClaudeSubagentEvent {
  const parentToolUseId = message.parent_tool_use_id
  if (typeof parentToolUseId !== "string") return IGNORED // top-level (ACP path כבר מטפל)

  const inner = message.message
  if (!isRecord(inner)) return IGNORED
  const messageId = inner.id
  if (typeof messageId !== "string") return IGNORED
  const content = inner.content
  const blocks = Array.isArray(content) ? content : []

  return { kind: "assistantDelta", parentToolUseId, messageId, blocks }
}

function parseUserMessage(message: Record<string, unknown>): ClaudeSubagentEvent {
  const parentToolUseId = message.parent_tool_use_id
  if (typeof parentToolUseId !== "string") return IGNORED // top-level (סיכום התוצאה של ה-Task ל-parent)

  const inner = message.message
  if (!isRecord(inner)) return IGNORED
  const content = inner.content
  const blocks = Array.isArray(content) ? content : []

  const uuid = typeof message.uuid === "string" ? message.uuid : undefined
  const fallbackKey = firstToolUseId(blocks)
  const key = uuid ?? fallbackKey
  if (key === undefined) return IGNORED // אין מפתח יציב — לא צפוי, defensive

  return { kind: "toolResult", parentToolUseId, key, blocks }
}

function firstToolUseId(blocks: unknown[]): string | undefined {
  for (const b of blocks) {
    if (isRecord(b) && b.type === "tool_result" && typeof b.tool_use_id === "string") {
      return b.tool_use_id
    }
  }
  return undefined
}
