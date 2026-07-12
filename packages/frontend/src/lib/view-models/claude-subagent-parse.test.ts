/**
 * claude-subagent-parse.test.ts — TDD (Commit 1+2, slice subagent-transcript-data-v2).
 *
 * Commit 1: table tests לפרסר, על גבי fixture חי (spike Gate-1).
 * Commit 2: unit tests ל-index + reducer (append/dedup/isolation).
 */

import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { ToolBubble } from "$lib/types/bubble"
import {
  type ClaudeSubagentEvent,
  createSubagentIndex,
  parseClaudeSdkMessage,
  reduceSubagent,
} from "./claude-subagent-parse"

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

// ─── Commit 2: index + reducer unit tests ──────────────────────────────────

function makeTaskBubble(toolCallId: string): ToolBubble {
  return {
    id: `bubble-${toolCallId}`,
    kind: "tool",
    messageId: null,
    createdAt: 0,
    toolCall: { toolCallId, name: "think", args: {}, status: "pending" },
    segments: [],
  }
}

describe("createSubagentIndex", () => {
  it("task_started קובע taskId→toolUseId; task_updated (בלי toolUseId) נפתר דרך המיפוי", () => {
    const index = createSubagentIndex()
    const started: ClaudeSubagentEvent = {
      kind: "task",
      subtype: "task_started",
      taskId: "task-1",
      toolUseId: "toolu-A",
      meta: {},
    }
    expect(index.resolve(started)).toBe("toolu-A")

    const updated: ClaudeSubagentEvent = {
      kind: "task",
      subtype: "task_updated",
      taskId: "task-1",
      meta: { status: "completed" },
    }
    expect(index.resolve(updated)).toBe("toolu-A")
  })

  it("task_updated לפני task_started (אין מיפוי) → undefined", () => {
    const index = createSubagentIndex()
    const updated: ClaudeSubagentEvent = {
      kind: "task",
      subtype: "task_updated",
      taskId: "task-unknown",
      meta: {},
    }
    expect(index.resolve(updated)).toBeUndefined()
  })

  it("assistantDelta/toolResult נפתרים ישירות דרך parentToolUseId", () => {
    const index = createSubagentIndex()
    const ev: ClaudeSubagentEvent = {
      kind: "assistantDelta",
      parentToolUseId: "toolu-B",
      messageId: "msg-1",
      blocks: [],
    }
    expect(index.resolve(ev)).toBe("toolu-B")
  })
})

describe("reduceSubagent — assistantDelta append (Q1 DELTAS)", () => {
  it("3 frames אותו messageId → SubFrame אחד עם 3 segments (לא 3 SubFrames)", () => {
    let bubble = makeTaskBubble("toolu-A")
    const mk = (text: string): ClaudeSubagentEvent => ({
      kind: "assistantDelta",
      parentToolUseId: "toolu-A",
      messageId: "msg-1",
      blocks: [{ type: "text", text }],
    })
    bubble = reduceSubagent(bubble, mk("part 1"), 1000)
    bubble = reduceSubagent(bubble, mk("part 2"), 1001)
    bubble = reduceSubagent(bubble, mk("part 3"), 1002)

    expect(bubble.subFrames).toHaveLength(1)
    const frame = bubble.subFrames?.[0]
    expect(frame?.kind).toBe("message")
    if (frame?.kind !== "message") throw new Error("expected message frame")
    expect(frame.segments).toHaveLength(3)
    expect(frame.segments.map((s) => s.text)).toEqual(["part 1", "part 2", "part 3"])
  })

  it("dedup — אותו frame פעמיים לא יוצר כפילות", () => {
    let bubble = makeTaskBubble("toolu-A")
    const ev: ClaudeSubagentEvent = {
      kind: "assistantDelta",
      parentToolUseId: "toolu-A",
      messageId: "msg-1",
      blocks: [{ type: "text", text: "hello" }],
    }
    bubble = reduceSubagent(bubble, ev, 1000)
    bubble = reduceSubagent(bubble, ev, 1000) // אותו frame בדיוק, שוב
    expect(bubble.subFrames).toHaveLength(1)
    expect(bubble.subFrames?.[0]?.kind === "message" && bubble.subFrames[0].segments).toHaveLength(
      1,
    )
  })

  it("שני Tasks מקבילים (interleaved) לא מתערבבים", () => {
    let bubbleA = makeTaskBubble("toolu-A")
    let bubbleB = makeTaskBubble("toolu-B")
    const mk = (parent: string, text: string): ClaudeSubagentEvent => ({
      kind: "assistantDelta",
      parentToolUseId: parent,
      messageId: `msg-${parent}`,
      blocks: [{ type: "text", text }],
    })
    bubbleA = reduceSubagent(bubbleA, mk("toolu-A", "A1"), 1000)
    bubbleB = reduceSubagent(bubbleB, mk("toolu-B", "B1"), 1001)
    bubbleA = reduceSubagent(bubbleA, mk("toolu-A", "A2"), 1002)
    bubbleB = reduceSubagent(bubbleB, mk("toolu-B", "B2"), 1003)

    expect(bubbleA.subFrames).toHaveLength(1)
    expect(bubbleB.subFrames).toHaveLength(1)
    const frameA = bubbleA.subFrames?.[0]
    const frameB = bubbleB.subFrames?.[0]
    if (frameA?.kind !== "message" || frameB?.kind !== "message")
      throw new Error("expected message frames")
    expect(frameA.segments.map((s) => s.text)).toEqual(["A1", "A2"])
    expect(frameB.segments.map((s) => s.text)).toEqual(["B1", "B2"])
  })
})

describe("reduceSubagent — toolResult", () => {
  it("מוסיף SubFrame חדש עם ה-blocks", () => {
    let bubble = makeTaskBubble("toolu-A")
    const ev: ClaudeSubagentEvent = {
      kind: "toolResult",
      parentToolUseId: "toolu-A",
      key: "uuid-1",
      blocks: [{ type: "tool_result", content: "output-text", is_error: false }],
    }
    bubble = reduceSubagent(bubble, ev, 2000)
    expect(bubble.subFrames).toHaveLength(1)
    const frame = bubble.subFrames?.[0]
    if (frame?.kind !== "message") throw new Error("expected message frame")
    expect(frame.segments[0]?.text).toBe("output-text")
  })

  it("dedup — אותו key פעמיים לא יוצר SubFrame כפול", () => {
    let bubble = makeTaskBubble("toolu-A")
    const ev: ClaudeSubagentEvent = {
      kind: "toolResult",
      parentToolUseId: "toolu-A",
      key: "uuid-1",
      blocks: [{ type: "tool_result", content: "x", is_error: false }],
    }
    bubble = reduceSubagent(bubble, ev, 2000)
    bubble = reduceSubagent(bubble, ev, 2001)
    expect(bubble.subFrames).toHaveLength(1)
  })
})

describe("reduceSubagent — task metadata merge", () => {
  it("task_started → status in_progress, prompt+subagentType נשמרים", () => {
    let bubble = makeTaskBubble("toolu-A")
    const ev: ClaudeSubagentEvent = {
      kind: "task",
      subtype: "task_started",
      taskId: "task-1",
      toolUseId: "toolu-A",
      meta: { subagentType: "general-purpose", prompt: "do X" },
    }
    bubble = reduceSubagent(bubble, ev, 1000)
    expect(bubble.toolCall.task?.status).toBe("in_progress")
    expect(bubble.toolCall.task?.subagentType).toBe("general-purpose")
    expect(bubble.toolCall.task?.prompt).toBe("do X")
    expect(bubble.toolCall.task?.taskId).toBe("task-1")
  })

  it("task_notification → status completed + summary, בלי לדרוס prompt קיים", () => {
    let bubble = makeTaskBubble("toolu-A")
    bubble = reduceSubagent(
      bubble,
      {
        kind: "task",
        subtype: "task_started",
        taskId: "task-1",
        toolUseId: "toolu-A",
        meta: { prompt: "do X" },
      },
      1000,
    )
    bubble = reduceSubagent(
      bubble,
      {
        kind: "task",
        subtype: "task_notification",
        taskId: "task-1",
        toolUseId: "toolu-A",
        meta: { status: "completed", summary: "done!" },
      },
      2000,
    )
    expect(bubble.toolCall.task?.status).toBe("completed")
    expect(bubble.toolCall.task?.summary).toBe("done!")
    expect(bubble.toolCall.task?.prompt).toBe("do X") // לא נדרס
  })

  it("task_notification עם status לא-מוכר → 'unknown'", () => {
    let bubble = makeTaskBubble("toolu-A")
    bubble = reduceSubagent(
      bubble,
      {
        kind: "task",
        subtype: "task_notification",
        taskId: "task-1",
        toolUseId: "toolu-A",
        meta: { status: "weird-status" },
      },
      1000,
    )
    expect(bubble.toolCall.task?.status).toBe("unknown")
  })
})

describe("reduceSubagent — immutability", () => {
  it("לא נוגע ב-taskBubble המקורי (object-replacement)", () => {
    const original = makeTaskBubble("toolu-A")
    const ev: ClaudeSubagentEvent = {
      kind: "assistantDelta",
      parentToolUseId: "toolu-A",
      messageId: "msg-1",
      blocks: [{ type: "text", text: "x" }],
    }
    const updated = reduceSubagent(original, ev, 1000)
    expect(original.subFrames).toBeUndefined()
    expect(updated).not.toBe(original)
    expect(updated.subFrames).toHaveLength(1)
  })

  it("ignored event → מחזיר את אותו bubble (no-op)", () => {
    const original = makeTaskBubble("toolu-A")
    const updated = reduceSubagent(original, { kind: "ignored" }, 1000)
    expect(updated).toBe(original)
  })
})
