/**
 * map-acp-notification.ts — מיפוי טהור SessionNotification (ACP) → ProviderEvent (קנוני).
 *
 * מקור-האמת ל-shapes: agent-session.svelte.ts:
 *   #onSessionUpdate:947, #handleToolCall:996, #handleToolCallUpdate:1034,
 *   #mapToolContent:855, #mapLocations:895.
 * החלטות עיצוב: P1b/§3 + §9.
 *
 * tool_call + tool_call_update → אירוע tool_call יחיד עם status (החלטה 2);
 * ה-consumer ממזג לפי id (drive-coding כבר עושה זאת ב-#handleToolCallUpdate).
 */
import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { PlanEntry, ProviderEvent, ToolCallLocation, ToolContent, Usage } from "./events.js"
import { classifyToolKind } from "./tool-kind.js"

/** צורת ה-update הגולמי (super-set של כל ה-variants). 1:1 מ-#onSessionUpdate:950. */
type AcpUpdate = {
  sessionUpdate?: string
  content?: unknown
  messageId?: string | null
  toolCallId?: string
  title?: string
  kind?: string
  rawInput?: unknown
  rawOutput?: unknown
  status?: string
  locations?: unknown[] | null
  entries?: unknown[] // plan
  used?: number // usage_update
  size?: number
  cost?: unknown // {amount,currency} object (אביגיל r3)
}

export function mapAcpNotification(n: SessionNotification): ProviderEvent | null {
  const u = (n?.update ?? undefined) as AcpUpdate | undefined
  if (!u) return raw(n)

  switch (u.sessionUpdate) {
    case "tool_call":
    case "tool_call_update":
      return {
        type: "tool_call",
        // toolCallId חובה בקנוני; ב-update מינימלי ניפול ל-"" (לא צפוי ב-fixtures)
        id: u.toolCallId ?? "",
        // 1:1 מ-#handleToolCall:1017 — kind ?? title ?? "tool"
        name: u.kind ?? u.title ?? "tool",
        input: u.rawInput ?? {},
        kind: classifyToolKind(u.kind ?? ""),
        status: mapStatus(u.status), // undefined → "pending"
        locations: mapLocations(u.locations),
        // ⚠️ content מ-update.content (ToolContent array), לא rawOutput
        content: mapContent(u.content),
      }
    case "agent_message_chunk":
      return { type: "message.delta", role: "assistant", text: textOf(u.content) }
    case "agent_thought_chunk":
      return { type: "thinking.delta", text: textOf(u.content) }
    case "plan":
      return { type: "plan.update", entries: mapPlanEntries(u.entries) }
    case "usage_update":
      return { type: "usage", usage: mapUsage(u) }
    // available_commands_update / user_message_chunk / unknown → raw (lossless)
    default:
      return raw(n)
  }
}

function raw(frame: unknown): ProviderEvent {
  return { type: "raw", provider: "acp", frame }
}

/**
 * ACP status אופציונלי, P1a status חובה ("pending"|"in_progress"|"completed"|"failed").
 * undefined → "pending" (1:1 מ-#handleToolCall:1020). ערך לא-מוכר עובר as-is
 * (ACP ו-P1a חולקים את אותם 4 ערכים).
 */
function mapStatus(status: string | undefined): "pending" | "in_progress" | "completed" | "failed" {
  return (status ?? "pending") as "pending" | "in_progress" | "completed" | "failed"
}

/**
 * ToolContent[] מ-update.content. 1:1 מ-#mapToolContent:855.
 * ACP item = { type:"content", content:{ type:"text", text } } → קנוני { kind:"text", text }
 * (discriminant type→kind). diff/terminal → MVP text-only (§9 #3): פריט לא-טקסט מסונן.
 * החזרה undefined כשאין content (כדי לא לזהם tool_call ראשוני בלי content).
 */
function mapContent(raw: unknown): ToolContent[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: ToolContent[] = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue
    const t = (item as { type?: string }).type
    if (t === "content") {
      const cb = (item as { content?: { type?: string; text?: string } }).content
      if (cb?.type === "text" && typeof cb.text === "string") {
        out.push({ kind: "text", text: cb.text })
      }
    } else if (t === "diff") {
      const d = item as { path?: string; oldText?: string | null; newText?: string }
      if (typeof d.path === "string" && typeof d.newText === "string") {
        out.push({ kind: "diff", path: d.path, oldText: d.oldText ?? undefined, newText: d.newText })
      }
    } else if (t === "terminal") {
      const term = item as { terminalId?: string }
      if (typeof term.terminalId === "string") {
        out.push({ kind: "terminal", terminalId: term.terminalId })
      }
    }
    // פריט לא-מוכר/לא-תקין → מסונן (אין kind:"other" בקנוני)
  }
  return out
}

/** ToolCallLocation[] מ-update.locations. 1:1 מ-#mapLocations:895 — דורש path:string. */
function mapLocations(raw: unknown): ToolCallLocation[] {
  if (!Array.isArray(raw)) return []
  const out: ToolCallLocation[] = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue
    const l = item as { path?: string; line?: number }
    if (typeof l.path === "string") {
      out.push(l.line === undefined ? { path: l.path } : { path: l.path, line: l.line })
    }
  }
  return out
}

/**
 * Usage passthrough. shape ACP usage_update = {used,size,cost}; cost = {amount,currency} object.
 * Usage קנוני פתוח ([k]:unknown) — אין tokens ב-ACP usage_update (§9 #5).
 */
function mapUsage(u: AcpUpdate): Usage {
  return { used: u.used, size: u.size, cost: u.cost }
}

/**
 * PlanEntry[] מ-update.entries. ACP plan entry = {content,priority,status} (אביגיל r3).
 * → קנוני {title: content, status}. priority נדחה (אין שדה קנוני, §9 #6).
 */
function mapPlanEntries(entries: unknown[] | undefined): PlanEntry[] {
  if (!Array.isArray(entries)) return []
  const out: PlanEntry[] = []
  for (const e of entries) {
    if (typeof e !== "object" || e === null) continue
    const entry = e as { content?: string; status?: string }
    out.push({ title: entry.content, status: entry.status })
  }
  return out
}

/** טקסט מ-ContentBlock יחיד. 1:1 מ-#onSessionUpdate:977 — content.type==="text" ? text : "". */
function textOf(content: unknown): string {
  if (typeof content !== "object" || content === null) return ""
  const c = content as { type?: string; text?: string }
  return c.type === "text" ? (c.text ?? "") : ""
}
