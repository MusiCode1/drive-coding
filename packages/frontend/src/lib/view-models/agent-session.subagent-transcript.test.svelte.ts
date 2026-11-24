/**
 * agent-session.subagent-transcript.test.svelte.ts — VM integration (Commit 3,
 * slice subagent-transcript-data-v2). Replay של fixture חי (spike Gate-1) דרך
 * the session host reducer and the SSE view.
 *
 * מכסה (§5/§6 DoD):
 *   1. subFrames מתמלא על בועת ה-Task, task metadata (prompt/summary/status) מאוכלס.
 *   2. bubbles הראשי לא גדל מעיבוד ה-_claude/sdkMessage (רק מ-ACP session/update).
 *   3. top-level assistant/session-update ללא שינוי (regression — ACP bubbles כרגיל).
 *   4. counter (0→14) נשאר ירוק (finding #1).
 *
 */

import { readFileSync } from "node:fs"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { afterEach, describe, expect, it } from "vitest"
import type { Bubble, ToolBubble } from "$lib/types/bubble"

// ─── fixture loading ────────────────────────────────────────────────────────

type FixtureEntry = {
  dir: string
  channel: string
  frame: { method?: string; params?: unknown }
}

const fixturePath = new URL(
  "../../../../core/tests/fixtures/subagent-task-single.json",
  import.meta.url,
)
const fixture: FixtureEntry[] = JSON.parse(readFileSync(fixturePath, "utf-8"))

const TASK_TOOL_CALL_ID = "toolu_01GiSAsvUBjALq1WGBB2xQ1K"

/** רק entries נכנסים (dir="in") — אלה שה-VM היה מקבל באמת מהחוט. */
const inbound = fixture.filter((e) => e.dir === "in")
const acpUpdateEntries = inbound.filter(
  (e) => e.channel === "acp" && e.frame.method === "session/update",
)
const rawSdkEntries = inbound.filter(
  (e) => e.channel === "raw" && e.frame.method === "_claude/sdkMessage",
)

import { isSubagentTask } from "$lib/components/chat/bubbles/bubble-rendering"
import { hostSessionView } from "./__fixtures__/host-session-view"
import { AgentSession } from "./agent-session.svelte"

type Host = ReturnType<typeof hostSessionView>
const hosts: Host[] = []

async function open() {
  const host = hostSessionView()
  hosts.push(host)
  await host.view.connect()
  return { ...host, session: new AgentSession({ view: host.view }) }
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(({ view }) => view.close()))
})

async function replay(host: Host, entries: FixtureEntry[]): Promise<void> {
  for (const { channel, frame } of entries) {
    if (channel === "acp" && frame.method === "session/update") {
      host.send((frame.params as SessionNotification).update)
    } else if (channel === "raw" && frame.method === "_claude/sdkMessage") {
      host.send({
        sessionUpdate: "_drive/ext_notification",
        method: frame.method,
        params: frame.params,
      })
    }
  }
  await host.settle()
}

describe("AgentSession — subagent transcript replay (slice subagent-transcript-data-v2)", () => {
  it("bubbles הראשי גדל רק מ-ACP session/update entries — עיבוד raw sdkMessage לא מוסיף בועות", async () => {
    // סשן A: ACP-only replay — baseline לספירת בועות.
    const hostA = await open()
    const { session: sessionA } = hostA
    await replay(hostA, acpUpdateEntries)
    const baselineCount = sessionA.bubbles.length
    expect(baselineCount).toBeGreaterThan(0)

    // סשן B: ACP+raw interleaved (סדר-מקורי מהפיקסצ'ר) — צריך אותה ספירה בדיוק.
    const hostB = await open()
    const { session: sessionB } = hostB
    await replay(hostB, inbound)

    expect(sessionB.bubbles.length).toBe(baselineCount)
  })

  it("subFrames מתמלא על בועת ה-Task אחרי replay מלא", async () => {
    const host = await open()
    const { session } = host
    await replay(host, inbound)

    const taskBubble = session.bubbles.find(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === TASK_TOOL_CALL_ID,
    )
    expect(taskBubble).toBeDefined()
    if (taskBubble?.kind !== "tool") throw new Error("expected tool bubble")
    expect(taskBubble.subFrames).toBeDefined()
    expect(taskBubble.subFrames?.length).toBeGreaterThan(0)
  })

  it("task metadata (prompt/summary/status) מאוכלס אחרי replay מלא", async () => {
    const host = await open()
    const { session } = host
    await replay(host, inbound)

    const taskBubble = session.bubbles.find(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === TASK_TOOL_CALL_ID,
    )
    if (taskBubble?.kind !== "tool") throw new Error("expected tool bubble")
    expect(taskBubble.toolCall.task?.prompt).toContain("STEP ONE")
    expect(taskBubble.toolCall.task?.summary).toContain("STEP TWO done")
    expect(taskBubble.toolCall.task?.status).toBe("completed")
    expect(taskBubble.toolCall.task?.subagentType).toBe("general-purpose")
  })

  // slice subagent-tool-nesting (re-scope 2026-07-19): התנהגות ישנה הוחלפה — קינון-הבועה-העשירה
  // במקום דיכוי/flat. בעבר הטסט הזה ציפה ל-top-level flat; עכשיו הכלי מקונן ב-subFrames של ה-Task.
  it("Bash tool_call המקונן (ACP session/update רגיל, לא raw) מקונן ב-subFrames של ה-Task — לא top-level", async () => {
    const host = await open()
    const { session } = host
    await replay(host, inbound)

    const bashBubbleTopLevel = session.bubbles.find(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === "toolu_01RcvmgbihnkJJnFJnk9ksRc",
    )
    expect(bashBubbleTopLevel).toBeUndefined() // אין יותר בועת top-level (re-scope: קינון, לא דיכוי)

    const taskBubble = session.bubbles.find(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === TASK_TOOL_CALL_ID,
    )
    if (taskBubble?.kind !== "tool") throw new Error("expected tool bubble")
    const nestedBash = taskBubble.subFrames?.find(
      (sf) => sf.kind === "tool" && sf.toolCall.toolCallId === "toolu_01RcvmgbihnkJJnFJnk9ksRc",
    )
    expect(nestedBash).toBeDefined() // בועה עשירה מקוננת (§3 — לא דיכוי, לא טקסט חלקי)
    if (nestedBash?.kind !== "tool") throw new Error("expected nested tool bubble")
    expect(nestedBash.toolCall.title).toBe("echo hello-from-subagent")
    // tool_call_update (idx 24 בפיקסצ'ר) מעדכן את הבועה המקוננת בתוך subFrames — status+output.
    expect(nestedBash.toolCall.status).toBe("completed")
    expect(nestedBash.toolCall.result).toBe("hello-from-subagent")

    // מניעת כפילות מול B1 (אביגיל #4): ה-subFrame הטקסטואלי (MessageBubble) לא מכיל
    // [tool_use: ...]/[tool_result] — הכלי מיוצג רק ע"י ה-ToolBubble המקונן, לא כטקסט.
    const flattenedText = (taskBubble.subFrames ?? [])
      .filter((sf) => sf.kind === "message")
      .flatMap((sf) => sf.segments.map((s) => s.text))
      .join(" ")
    expect(flattenedText).not.toContain("[tool_use:")
    expect(flattenedText).not.toContain("[tool_result]")
  })

  it("כלי top-level אמיתי (בלי parentToolUseId, למשל ה-Task tool_call עצמו) — נשאר top-level (רגרסיה)", async () => {
    const host = await open()
    const { session } = host
    await replay(host, inbound)

    const taskBubble = session.bubbles.find(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === TASK_TOOL_CALL_ID,
    )
    expect(taskBubble).toBeDefined() // ה-Task tool_call עצמו (Agent, בלי parentToolUseId) נשאר top-level
  })

  it("counter (_claude/sdkMessage) שווה למספר ה-raw entries בפיקסצ'ר — finding #1 נשמר", async () => {
    const host = await open()
    const { session } = host
    expect(session.claudeRawSdkMessageCount).toBe(0)
    await replay(host, inbound)
    expect(session.claudeRawSdkMessageCount).toBe(rawSdkEntries.length)
  })
})

// ─── slice meta-passthrough Commit 3: approach B on tool_call_update ─────────

/** Collect every toolCallId in the bubble tree (top-level + subFrames). */
function allToolCallIds(bubbles: Bubble[]): string[] {
  const out: string[] = []
  for (const b of bubbles) {
    if (b.kind === "tool") {
      out.push(b.toolCall.toolCallId)
      for (const sf of b.subFrames ?? []) {
        if (sf.kind === "tool") out.push(sf.toolCall.toolCallId)
      }
    }
  }
  return out
}

describe("AgentSession — meta-passthrough tool_call_update nesting (approach B)", () => {
  it("tool_call_update child nests via _meta when map misses and parent exists (HTTP path)", async () => {
    const host = await open()
    const { session } = host

    host.send({
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu_PARENT",
      title: "Task",
      kind: "other",
      status: "in_progress",
      rawInput: {},
    })
    host.send({
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu_CHILD",
      title: "echo hello-from-subagent",
      kind: "execute",
      status: "pending",
      rawInput: {},
      _meta: { claudeCode: { parentToolUseId: "toolu_PARENT" } },
    })

    await host.settle()
    const parent = session.bubbles.find(
      (b): b is ToolBubble => b.kind === "tool" && b.toolCall.toolCallId === "toolu_PARENT",
    )
    expect(parent).toBeDefined()
    expect(parent?.subFrames?.length).toBe(1)
    expect(parent?.subFrames?.[0]?.kind === "tool" && parent.subFrames[0].toolCall.toolCallId).toBe(
      "toolu_CHILD",
    )

    const topLevelChild = session.bubbles.find(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === "toolu_CHILD",
    )
    expect(topLevelChild).toBeUndefined()
  })

  it("out-of-order child→parent→child: toolCallId appears once in the bubble tree", async () => {
    const host = await open()
    const { session } = host

    host.send({
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu_CHILD",
      title: "echo",
      kind: "execute",
      status: "pending",
      rawInput: {},
      _meta: { claudeCode: { parentToolUseId: "toolu_PARENT" } },
    })
    host.send({
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu_PARENT",
      title: "Task",
      kind: "other",
      status: "in_progress",
      rawInput: {},
    })
    host.send({
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu_CHILD",
      status: "completed",
      rawOutput: "done",
      _meta: { claudeCode: { parentToolUseId: "toolu_PARENT" } },
    })

    await host.settle()
    const ids = allToolCallIds(session.bubbles)
    expect(ids.filter((id) => id === "toolu_CHILD")).toHaveLength(1)
  })
})

// ─── slice subagent-identity-gate: שער זהות (Bash לא תת-סוכן) ─────────────────

const BASH_PROBE_ID = "toolu_bash_probe_70"
const BASH_TASK_ID = "task_bash_probe_70"

function sendSdk(host: Host, message: Record<string, unknown>): void {
  host.send({
    sessionUpdate: "_drive/ext_notification",
    method: "_claude/sdkMessage",
    params: { message },
  })
}

describe("AgentSession — subagent identity gate (slice subagent-identity-gate)", () => {
  it("#70: Bash + local_bash task_* — לא מקבל תעתיק תת-סוכן", async () => {
    const host = await open()
    const { session } = host

    host.send({
      sessionUpdate: "tool_call",
      toolCallId: BASH_PROBE_ID,
      kind: "execute",
      title: "Sleep 20",
      status: "in_progress",
      rawInput: { command: "sleep 20 && echo probe" },
      _meta: { claudeCode: { toolName: "Bash" } },
    })

    sendSdk(host, {
      type: "system",
      subtype: "task_started",
      task_type: "local_bash",
      task_id: BASH_TASK_ID,
      tool_use_id: BASH_PROBE_ID,
      description: "Sleep 20",
    })
    sendSdk(host, {
      type: "system",
      subtype: "task_updated",
      task_id: BASH_TASK_ID,
    })
    sendSdk(host, {
      type: "system",
      subtype: "task_notification",
      task_id: BASH_TASK_ID,
      tool_use_id: BASH_PROBE_ID,
      status: "completed",
    })

    await host.settle()

    const bashBubble = session.bubbles.find(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === BASH_PROBE_ID,
    )
    expect(bashBubble?.kind).toBe("tool")
    if (bashBubble?.kind !== "tool") throw new Error("expected bash tool bubble")
    expect(bashBubble.toolCall.task).toBeUndefined()
    expect(bashBubble.subFrames).toBeUndefined()
    expect(isSubagentTask(bashBubble)).toBe(false)
    expect(bashBubble.toolCall.args).toMatchObject({ command: "sleep 20 && echo probe" })
  })

  it("fallback: kind think בלי _meta + task_* — תעתיק מתאכלס (ענף נפילה)", async () => {
    const host = await open()
    const { session } = host
    const thinkId = "toolu_think_fallback"
    const taskId = "task_think_fallback"

    host.send({
      sessionUpdate: "tool_call",
      toolCallId: thinkId,
      kind: "think",
      title: "Think",
      status: "in_progress",
      rawInput: {},
    })

    sendSdk(host, {
      type: "system",
      subtype: "task_started",
      task_id: taskId,
      tool_use_id: thinkId,
    })
    sendSdk(host, {
      type: "system",
      subtype: "task_notification",
      task_id: taskId,
      tool_use_id: thinkId,
      status: "completed",
    })

    await host.settle()

    const bubble = session.bubbles.find(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === thinkId,
    )
    if (bubble?.kind !== "tool") throw new Error("expected tool bubble")
    expect(bubble.toolCall.task?.status).toBe("completed")
  })

  it("רצף מעורב: Bash ללא task, ואז Agent מה-fixture עם תעתיק", async () => {
    const host = await open()
    const { session } = host

    host.send({
      sessionUpdate: "tool_call",
      toolCallId: BASH_PROBE_ID,
      kind: "execute",
      title: "Sleep 20",
      status: "in_progress",
      rawInput: { command: "sleep 20" },
      _meta: { claudeCode: { toolName: "Bash" } },
    })
    sendSdk(host, {
      type: "system",
      subtype: "task_started",
      task_type: "local_bash",
      task_id: BASH_TASK_ID,
      tool_use_id: BASH_PROBE_ID,
    })
    sendSdk(host, {
      type: "system",
      subtype: "task_notification",
      task_id: BASH_TASK_ID,
      tool_use_id: BASH_PROBE_ID,
      status: "completed",
    })

    await replay(host, inbound)

    const bashBubble = session.bubbles.find(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === BASH_PROBE_ID,
    )
    if (bashBubble?.kind !== "tool") throw new Error("expected bash bubble")
    expect(bashBubble.toolCall.task).toBeUndefined()

    const agentBubble = session.bubbles.find(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === TASK_TOOL_CALL_ID,
    )
    if (agentBubble?.kind !== "tool") throw new Error("expected agent bubble")
    expect(agentBubble.toolCall.task?.status).toBe("completed")
    expect(agentBubble.subFrames?.length).toBeGreaterThan(0)
  })
})
