/**
 * agent-session.subagent-transcript.test.svelte.ts — VM integration (Commit 3,
 * slice subagent-transcript-data-v2). Replay של fixture חי (spike Gate-1) דרך
 * #onExtNotification + #onSessionUpdate האמיתיים.
 *
 * מכסה (§5/§6 DoD):
 *   1. subFrames מתמלא על בועת ה-Task, task metadata (prompt/summary/status) מאוכלס.
 *   2. bubbles הראשי לא גדל מעיבוד ה-_claude/sdkMessage (רק מ-ACP session/update).
 *   3. top-level assistant/session-update ללא שינוי (regression — ACP bubbles כרגיל).
 *   4. counter (0→14) נשאר ירוק (finding #1).
 *
 * דפוס: agent-session.capabilities.test.svelte.ts (מוק createAcpClient, לוכד callbacks).
 */

import { readFileSync } from "node:fs"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { AcpClient } from "@drive-coding/provider/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
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

// ─── Module-level mocks (דפוס agent-session.capabilities.test.svelte.ts) ──────

let capturedOnUpdate: ((n: SessionNotification) => void) | null = null
let capturedExtNotification: ((method: string, params: Record<string, unknown>) => void) | null =
  null

function makeMockClient(): AcpClient {
  return {
    conn: {} as AcpClient["conn"],
    capabilities: {} as AcpClient["capabilities"],
    newSession: vi.fn().mockResolvedValue({ sessionId: "session-subagent-test" }),
    loadSession: vi.fn().mockResolvedValue({}),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    prompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    setSessionConfigOption: vi.fn(),
    setSessionMode: vi.fn(),
    setSessionModel: vi.fn(),
    extMethod: vi.fn().mockResolvedValue({ ok: true }),
  } as unknown as AcpClient
}

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn(
      (
        _transport: unknown,
        callbacks: {
          onUpdate: (n: SessionNotification) => void
          onExtNotification?: (m: string, p: Record<string, unknown>) => void
        },
      ) => {
        capturedOnUpdate = callbacks.onUpdate
        capturedExtNotification = callbacks.onExtNotification ?? null
        return Promise.resolve(makeMockClient())
      },
    ),
  }
})

vi.mock("@drive-coding/acp-wire/browser", () => ({
  WsAcpTransport: vi.fn(function mockWsTransport() {
    return {
      onClose: vi.fn(),
      waitForOpen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      closeAndWait: vi.fn().mockResolvedValue(undefined),
    }
  }),
}))

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-subagent-test" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
  // slice session-title-in-process-list: #pushTitleToServer קורא ל-patchAgent
  patchAgent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("$lib/adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

vi.mock("$lib/adapters/ext", () => ({
  createExtClient: vi.fn(() => ({
    setThinkingTokens: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })
let uuidCounter = 0
vi.stubGlobal("crypto", { randomUUID: () => `test-uuid-${uuidCounter++}` })

// ─── Import after mocks ───────────────────────────────────────────────────────

import { AgentSession } from "./agent-session.svelte"

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** מריץ entries דרך ה-callbacks האמיתיים שנתפסו, בסדר-ההופעה המקורי בפיקסצ'ר. */
function replay(entries: FixtureEntry[]): void {
  for (const e of entries) {
    if (e.channel === "acp" && e.frame.method === "session/update") {
      capturedOnUpdate?.(e.frame.params as SessionNotification)
    } else if (e.channel === "raw" && e.frame.method === "_claude/sdkMessage") {
      capturedExtNotification?.("_claude/sdkMessage", e.frame.params as Record<string, unknown>)
    }
  }
}

describe("AgentSession — subagent transcript replay (slice subagent-transcript-data-v2)", () => {
  beforeEach(() => {
    capturedOnUpdate = null
    capturedExtNotification = null
    uuidCounter = 0
  })

  it("bubbles הראשי גדל רק מ-ACP session/update entries — עיבוד raw sdkMessage לא מוסיף בועות", async () => {
    // סשן A: ACP-only replay — baseline לספירת בועות.
    const sessionA = new AgentSession()
    await sessionA.attach({ cwd: "/proj", cliKind: "claude" })
    replay(acpUpdateEntries)
    const baselineCount = sessionA.bubbles.length
    expect(baselineCount).toBeGreaterThan(0)

    // סשן B: ACP+raw interleaved (סדר-מקורי מהפיקסצ'ר) — צריך אותה ספירה בדיוק.
    capturedOnUpdate = null
    capturedExtNotification = null
    const sessionB = new AgentSession()
    await sessionB.attach({ cwd: "/proj", cliKind: "claude" })
    replay(inbound)

    expect(sessionB.bubbles.length).toBe(baselineCount)
  })

  it("subFrames מתמלא על בועת ה-Task אחרי replay מלא", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/proj", cliKind: "claude" })
    replay(inbound)

    const taskBubble = session.bubbles.find(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === TASK_TOOL_CALL_ID,
    )
    expect(taskBubble).toBeDefined()
    if (taskBubble?.kind !== "tool") throw new Error("expected tool bubble")
    expect(taskBubble.subFrames).toBeDefined()
    expect(taskBubble.subFrames?.length).toBeGreaterThan(0)
  })

  it("task metadata (prompt/summary/status) מאוכלס אחרי replay מלא", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/proj", cliKind: "claude" })
    replay(inbound)

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
    const session = new AgentSession()
    await session.attach({ cwd: "/proj", cliKind: "claude" })
    replay(inbound)

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
    const session = new AgentSession()
    await session.attach({ cwd: "/proj", cliKind: "claude" })
    replay(inbound)

    const taskBubble = session.bubbles.find(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === TASK_TOOL_CALL_ID,
    )
    expect(taskBubble).toBeDefined() // ה-Task tool_call עצמו (Agent, בלי parentToolUseId) נשאר top-level
  })

  it("counter (_claude/sdkMessage) שווה למספר ה-raw entries בפיקסצ'ר — finding #1 נשמר", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/proj", cliKind: "claude" })
    expect(session.claudeRawSdkMessageCount).toBe(0)
    replay(inbound)
    expect(session.claudeRawSdkMessageCount).toBe(rawSdkEntries.length)
  })
})

// ─── slice meta-passthrough Commit 3: approach B on tool_call_update ─────────

function emitSessionUpdate(update: Record<string, unknown>): void {
  capturedOnUpdate?.({ update } as SessionNotification)
}

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
  beforeEach(() => {
    capturedOnUpdate = null
    capturedExtNotification = null
    uuidCounter = 0
  })

  it("tool_call_update child nests via _meta when map misses and parent exists (HTTP path)", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/proj", cliKind: "claude" })

    emitSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu_PARENT",
      title: "Task",
      kind: "other",
      status: "in_progress",
      rawInput: {},
    })
    emitSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu_CHILD",
      title: "echo hello-from-subagent",
      kind: "execute",
      status: "pending",
      rawInput: {},
      _meta: { claudeCode: { parentToolUseId: "toolu_PARENT" } },
    })

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
    const session = new AgentSession()
    await session.attach({ cwd: "/proj", cliKind: "claude" })

    emitSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu_CHILD",
      title: "echo",
      kind: "execute",
      status: "pending",
      rawInput: {},
      _meta: { claudeCode: { parentToolUseId: "toolu_PARENT" } },
    })
    emitSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu_PARENT",
      title: "Task",
      kind: "other",
      status: "in_progress",
      rawInput: {},
    })
    emitSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu_CHILD",
      status: "completed",
      rawOutput: "done",
      _meta: { claudeCode: { parentToolUseId: "toolu_PARENT" } },
    })

    const ids = allToolCallIds(session.bubbles)
    expect(ids.filter((id) => id === "toolu_CHILD")).toHaveLength(1)
  })
})
