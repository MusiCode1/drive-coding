/**
 * claude-subagent-parse.ts — שכבת-נתונים טהורה לתעתיק תת-סוכן (slice subagent-transcript-data-v2, B1).
 *
 * מקור: `_claude/sdkMessage` ext notification (raw Claude Agent SDK messages), דרך
 * `#onExtNotification` ב-agent-session.svelte.ts. ר' docs/plans/slice-subagent-transcript-data-v2.md.
 *
 * שלושה חלקים טהורים (ללא IO, ללא Date.now()/random בזמן ריצה של הטסטים):
 *   1. `parseClaudeSdkMessage` — unknown → ClaudeSubagentEvent (guards ממוקדים, לא `as SDKMessage`).
 *      [Commit 1]
 *   2. `createSubagentIndex` — taskId→toolUseId (task_started בונה, task_updated קורא). [Commit 2]
 *   3. `reduceSubagent` — (ToolBubble, ClaudeSubagentEvent) → ToolBubble (immutable). [Commit 2]
 *
 * הכרעת-עיצוב (B1 = שכבת-נתונים בלבד, אין רינדור): SubFrame לכל block-group מיוצג
 * כ-MessageBubble (kind:"message") — כל content-block (text/thinking/tool_use/tool_result)
 * מומר ל-Segment עם ייצוג טקסטואלי. B2 (renderer) יכול לעדן את זה בעתיד; ה-shape
 * (MessageBubble) כבר מוכן ל-reuse דרך BubbleRenderer (§9 Q3).
 */

import type {
  MessageBubble,
  Segment,
  SubagentTaskStatus,
  SubFrame,
  TaskMeta,
  ToolBubble,
} from "$lib/types/bubble"

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

// ─── 1. parser ───────────────────────────────────────────────────────────────

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

// ─── 2. index (taskId → toolUseId) ──────────────────────────────────────────

export type SubagentIndex = {
  /** מחזיר את ה-parentToolUseId (ACP toolCallId) של האירוע, או undefined אם לא ניתן לפתור. */
  resolve(event: ClaudeSubagentEvent): string | undefined
}

/**
 * בונה index טהור (state מקומי סגור-מעל, לא $state) בין taskId ל-toolUseId.
 * task_started נושא את שניהם → קובע את המיפוי. task_updated נושא רק taskId → נפתר דרך המיפוי.
 */
export function createSubagentIndex(): SubagentIndex {
  const taskIdToToolUseId = new Map<string, string>()
  return {
    resolve(event: ClaudeSubagentEvent): string | undefined {
      if (event.kind === "task") {
        if (event.toolUseId !== undefined) {
          taskIdToToolUseId.set(event.taskId, event.toolUseId)
          return event.toolUseId
        }
        return taskIdToToolUseId.get(event.taskId)
      }
      if (event.kind === "assistantDelta" || event.kind === "toolResult") {
        return event.parentToolUseId
      }
      return undefined
    },
  }
}

// ─── 3. reducer ──────────────────────────────────────────────────────────────

function mapStatus(raw: string): SubagentTaskStatus {
  if (raw === "completed" || raw === "failed" || raw === "in_progress" || raw === "pending") {
    return raw
  }
  return "unknown"
}

/** hash דטרמיניסטי קצר (djb2) — לזיהוי-דדופ יציב של content-blocks, בלי Date.now()/random. */
function stableHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i)
  }
  return (h >>> 0).toString(36)
}

function blockToText(block: unknown): string {
  if (!isRecord(block)) return ""
  if (block.type === "text" && typeof block.text === "string") return block.text
  if (block.type === "thinking" && typeof block.thinking === "string") return block.thinking
  if (block.type === "tool_use") {
    const name = typeof block.name === "string" ? block.name : "tool"
    return `[tool_use: ${name}]`
  }
  if (block.type === "tool_result") {
    const content = block.content
    if (typeof content === "string") return content
    if (Array.isArray(content)) {
      return content
        .map((c) => (isRecord(c) && typeof c.text === "string" ? c.text : ""))
        .filter((t) => t.length > 0)
        .join("\n")
    }
    return ""
  }
  return ""
}

/** ממיר content blocks ל-Segments, עם id דטרמיניסטי (messageId+hash-תוכן) — מאפשר דדופ לפי id. */
function blocksToSegments(groupKey: string, blocks: unknown[]): Segment[] {
  return blocks.map((block) => ({
    id: `blk:${groupKey}:${stableHash(JSON.stringify(block))}`,
    text: blockToText(block),
  }))
}

function applyTaskEvent(taskBubble: ToolBubble, event: SubagentTaskEvent): ToolBubble {
  const prevTask: TaskMeta = taskBubble.toolCall.task ?? { status: "pending" }
  const nextTask: TaskMeta = { ...prevTask, taskId: prevTask.taskId ?? event.taskId }

  if (event.subtype === "task_started") {
    nextTask.status = "in_progress"
    if (event.meta.subagentType !== undefined) nextTask.subagentType = event.meta.subagentType
    if (event.meta.prompt !== undefined) nextTask.prompt = event.meta.prompt
  } else if (event.subtype === "task_progress") {
    if (event.meta.lastToolName !== undefined) nextTask.lastToolName = event.meta.lastToolName
  } else if (event.subtype === "task_notification") {
    if (event.meta.summary !== undefined) nextTask.summary = event.meta.summary
    if (event.meta.status !== undefined) nextTask.status = mapStatus(event.meta.status)
  } else if (event.subtype === "task_updated") {
    if (event.meta.status !== undefined) nextTask.status = mapStatus(event.meta.status)
  }

  return { ...taskBubble, toolCall: { ...taskBubble.toolCall, task: nextTask } }
}

function applyAssistantDelta(
  taskBubble: ToolBubble,
  event: AssistantDeltaEvent,
  now: number,
): ToolBubble {
  const frameId = `sub:${event.parentToolUseId}:${event.messageId}`
  const existing = taskBubble.subFrames?.find((f) => f.id === frameId)
  const newSegments = blocksToSegments(event.messageId, event.blocks)

  if (existing !== undefined && existing.kind === "message") {
    const existingIds = new Set(existing.segments.map((s) => s.id))
    const toAdd = newSegments.filter((s) => !existingIds.has(s.id))
    if (toAdd.length === 0) return taskBubble // דדופ מלא — snapshot חוזר, אין שינוי
    const updatedFrame: MessageBubble = { ...existing, segments: [...existing.segments, ...toAdd] }
    const subFrames = (taskBubble.subFrames ?? []).map((f) => (f.id === frameId ? updatedFrame : f))
    return { ...taskBubble, subFrames }
  }

  const newFrame: MessageBubble = {
    id: frameId,
    kind: "message",
    messageId: event.messageId,
    createdAt: now,
    segments: newSegments,
  }
  return { ...taskBubble, subFrames: [...(taskBubble.subFrames ?? []), newFrame] }
}

function applyToolResult(taskBubble: ToolBubble, event: ToolResultEvent, now: number): ToolBubble {
  const frameId = `sub:${event.parentToolUseId}:${event.key}`
  const exists = taskBubble.subFrames?.some((f) => f.id === frameId) ?? false
  if (exists) return taskBubble // דדופ — replay של אותו frame

  const newFrame: MessageBubble = {
    id: frameId,
    kind: "message",
    messageId: null,
    createdAt: now,
    segments: blocksToSegments(event.key, event.blocks),
  }
  return { ...taskBubble, subFrames: [...(taskBubble.subFrames ?? []), newFrame] }
}

/**
 * reducer טהור: (ToolBubble, ClaudeSubagentEvent) → ToolBubble (immutable, object-replacement).
 * `now` ניתן להזרקה (ברירת-מחדל Date.now() — לא נקרא בטסטים שמעבירים ערך מפורש; finding #5).
 */
export function reduceSubagent(
  taskBubble: ToolBubble,
  event: ClaudeSubagentEvent,
  now: number = Date.now(),
): ToolBubble {
  if (event.kind === "ignored") return taskBubble
  if (event.kind === "task") return applyTaskEvent(taskBubble, event)
  if (event.kind === "assistantDelta") return applyAssistantDelta(taskBubble, event, now)
  return applyToolResult(taskBubble, event, now)
}

// ─── re-export לשימוש נוח מ-agent-session.svelte.ts (אין default export) ──────
export type { SubagentTaskStatus, SubFrame, TaskMeta }
