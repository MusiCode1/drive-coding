/**
 * claude-subagent-parse.test.ts — TDD (Commit 1, slice subagent-transcript-data-v2).
 *
 * Commit 1: table tests לפרסר, על גבי fixture חי (spike Gate-1).
 * (Commit 2 מוסיף: unit tests ל-index + reducer.)
 */

import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { parseClaudeSdkMessage } from "./claude-subagent-parse"

// ─── fixture loading ────────────────────────────────────────────────────────
// readFileSync+JSON.parse (לא `import ... from ".json"`) — resolveJsonModule לא מוגדר
// ב-tsconfig הפרויקט; קריאת-קובץ בזמן-ריצה עוקפת את זה בלי לגעת בקונפיג המשותף.

type FixtureEntry = { channel: string; frame: { method?: string; params?: unknown } }

const fixturePath = new URL("./__fixtures__/subagent-task-single.json", import.meta.url)
const fixture: FixtureEntry[] = JSON.parse(readFileSync(fixturePath, "utf-8"))

/** כל ה-params הגולמיים (frame.params) של הודעות _claude/sdkMessage, בסדר-הופעה. */
const rawParams: unknown[] = fixture
  .filter((e) => e.channel === "raw" && e.frame.method === "_claude/sdkMessage")
  .map((e) => e.frame.params)

function rawParamsWhere(pred: (msg: Record<string, unknown>) => boolean): unknown {
  const found = rawParams.find((p) => {
    const message = (p as { message?: unknown })?.message
    return (
      typeof message === "object" && message !== null && pred(message as Record<string, unknown>)
    )
  })
  if (found === undefined) throw new Error("fixture entry not found")
  return found
}

// ─── Commit 1: parser table tests ──────────────────────────────────────────

describe("parseClaudeSdkMessage — table (fixture)", () => {
  it("system task_started → task event עם taskId+toolUseId+meta", () => {
    const params = rawParamsWhere((m) => m.type === "system" && m.subtype === "task_started")
    const ev = parseClaudeSdkMessage(params)
    expect(ev.kind).toBe("task")
    if (ev.kind !== "task") throw new Error("expected task")
    expect(ev.subtype).toBe("task_started")
    expect(ev.taskId).toBe("ad36e85f15e4a56a9")
    expect(ev.toolUseId).toBe("toolu_01GiSAsvUBjALq1WGBB2xQ1K")
    expect(ev.meta.subagentType).toBe("general-purpose")
    expect(ev.meta.prompt).toContain("STEP ONE")
  })

  it("system task_progress → task event עם lastToolName", () => {
    const params = rawParamsWhere((m) => m.type === "system" && m.subtype === "task_progress")
    const ev = parseClaudeSdkMessage(params)
    expect(ev.kind).toBe("task")
    if (ev.kind !== "task") throw new Error("expected task")
    expect(ev.subtype).toBe("task_progress")
    expect(ev.toolUseId).toBe("toolu_01GiSAsvUBjALq1WGBB2xQ1K")
    expect(ev.meta.lastToolName).toBe("Bash")
  })

  it("system task_notification → task event עם status+summary", () => {
    const params = rawParamsWhere((m) => m.type === "system" && m.subtype === "task_notification")
    const ev = parseClaudeSdkMessage(params)
    expect(ev.kind).toBe("task")
    if (ev.kind !== "task") throw new Error("expected task")
    expect(ev.subtype).toBe("task_notification")
    expect(ev.meta.status).toBe("completed")
    expect(ev.meta.summary).toContain("STEP TWO done")
  })

  it("system task_updated → task event בלי toolUseId, status מ-patch", () => {
    const params = rawParamsWhere((m) => m.type === "system" && m.subtype === "task_updated")
    const ev = parseClaudeSdkMessage(params)
    expect(ev.kind).toBe("task")
    if (ev.kind !== "task") throw new Error("expected task")
    expect(ev.subtype).toBe("task_updated")
    expect(ev.toolUseId).toBeUndefined()
    expect(ev.meta.status).toBe("completed")
  })

  it("assistant + parent_tool_use_id → assistantDelta עם messageId+blocks", () => {
    const params = rawParamsWhere(
      (m) => m.type === "assistant" && m.parent_tool_use_id === "toolu_01GiSAsvUBjALq1WGBB2xQ1K",
    )
    const ev = parseClaudeSdkMessage(params)
    expect(ev.kind).toBe("assistantDelta")
    if (ev.kind !== "assistantDelta") throw new Error("expected assistantDelta")
    expect(ev.parentToolUseId).toBe("toolu_01GiSAsvUBjALq1WGBB2xQ1K")
    expect(typeof ev.messageId).toBe("string")
    expect(ev.blocks.length).toBeGreaterThan(0)
  })

  it("user + parent_tool_use_id → toolResult עם key+blocks", () => {
    const params = rawParamsWhere(
      (m) => m.type === "user" && m.parent_tool_use_id === "toolu_01GiSAsvUBjALq1WGBB2xQ1K",
    )
    const ev = parseClaudeSdkMessage(params)
    expect(ev.kind).toBe("toolResult")
    if (ev.kind !== "toolResult") throw new Error("expected toolResult")
    expect(ev.parentToolUseId).toBe("toolu_01GiSAsvUBjALq1WGBB2xQ1K")
    expect(typeof ev.key).toBe("string")
    expect(ev.blocks.length).toBeGreaterThan(0)
  })

  it("assistant top-level (parent_tool_use_id null) → ignored", () => {
    const params = rawParamsWhere((m) => m.type === "assistant" && m.parent_tool_use_id === null)
    const ev = parseClaudeSdkMessage(params)
    expect(ev.kind).toBe("ignored")
  })

  it("user top-level (parent_tool_use_id null) → ignored", () => {
    const params = rawParamsWhere((m) => m.type === "user" && m.parent_tool_use_id === null)
    const ev = parseClaudeSdkMessage(params)
    expect(ev.kind).toBe("ignored")
  })

  it("malformed params (לא record) → ignored, לא throw", () => {
    expect(parseClaudeSdkMessage(null).kind).toBe("ignored")
    expect(parseClaudeSdkMessage(undefined).kind).toBe("ignored")
    expect(parseClaudeSdkMessage("string").kind).toBe("ignored")
    expect(parseClaudeSdkMessage(42).kind).toBe("ignored")
    expect(parseClaudeSdkMessage([]).kind).toBe("ignored")
  })

  it("message חסר → ignored", () => {
    expect(parseClaudeSdkMessage({}).kind).toBe("ignored")
    expect(parseClaudeSdkMessage({ message: null }).kind).toBe("ignored")
  })

  it("system עם subtype לא-מוכר → ignored, לא throw", () => {
    const ev = parseClaudeSdkMessage({
      message: { type: "system", subtype: "background_tasks_changed" },
    })
    expect(ev.kind).toBe("ignored")
  })

  it("system task_started בלי task_id → ignored (defensive)", () => {
    const ev = parseClaudeSdkMessage({
      message: { type: "system", subtype: "task_started", tool_use_id: "x" },
    })
    expect(ev.kind).toBe("ignored")
  })

  it("type לא-מוכר לגמרי (למשל result) → ignored", () => {
    const ev = parseClaudeSdkMessage({ message: { type: "result" } })
    expect(ev.kind).toBe("ignored")
  })
})
