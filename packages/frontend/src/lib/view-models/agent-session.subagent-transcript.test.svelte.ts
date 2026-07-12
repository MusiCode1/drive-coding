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

// ─── fixture loading ────────────────────────────────────────────────────────

type FixtureEntry = {
  dir: string
  channel: string
  frame: { method?: string; params?: unknown }
}

const fixturePath = new URL("./__fixtures__/subagent-task-single.json", import.meta.url)
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

vi.mock("$lib/engines/ws-transport", () => ({
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

  it("Bash tool_call המקונן (ACP session/update רגיל, לא raw) נשאר flat top-level — לא בתוך subFrames", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/proj", cliKind: "claude" })
    replay(inbound)

    const bashBubble = session.bubbles.find(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === "toolu_01RcvmgbihnkJJnFJnk9ksRc",
    )
    expect(bashBubble).toBeDefined() // עדיין מגיע דרך #handleToolCall הרגיל (regression check)
  })

  it("counter (_claude/sdkMessage) שווה למספר ה-raw entries בפיקסצ'ר — finding #1 נשמר", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/proj", cliKind: "claude" })
    expect(session.claudeRawSdkMessageCount).toBe(0)
    replay(inbound)
    expect(session.claudeRawSdkMessageCount).toBe(rawSdkEntries.length)
  })
})
