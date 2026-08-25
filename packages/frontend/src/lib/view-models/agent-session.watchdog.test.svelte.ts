/**
 * agent-session.watchdog.test.svelte.ts — integration tests ל-watchdog (slice-A5-watchdog).
 *
 * מכסה (§5 DoD):
 *   1. שתיקה > WATCHDOG_MS → idle כפוי + turnInterrupted=true
 *   2. activity לפני timeout → watchdog מאופס, idle לא נורה
 *   3. RESP תקין → watchdog מנוקה, turnInterrupted נשאר false
 *   4. cancelTurn → watchdog מנוקה, turnInterrupted=false
 *
 * Testing: integration (mock timers + captured-listener)
 * Commit 1 ב-slice-A5-watchdog.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"
import type { SessionNotification } from "@agentclientprotocol/sdk"

// ─── Module-level mocks ───────────────────────────────────────────────────────

let capturedListener: ((n: SessionNotification) => void) | null = null
let mockPromptResolve: (() => void) | null = null

const mockClient = {
  prompt: vi.fn(),
  cancel: vi.fn().mockResolvedValue(undefined),
  newSession: vi.fn().mockResolvedValue({ sessionId: "session-wd-1" }),
  loadSession: vi.fn().mockResolvedValue({ sessionId: "session-wd-1" }),
  listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  setSessionConfigOption: vi.fn(),
  setSessionModel: vi.fn(),
  setSessionMode: vi.fn(),
  close: vi.fn(),
}

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-wd-1" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock("$lib/engines/ws-transport", () => ({
  // eslint-disable-next-line prefer-arrow-callback
  WsAcpTransport: vi.fn().mockImplementation(function MockTransport() {
    return {
      onClose: vi.fn(),
      waitForOpen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      closeAndWait: vi.fn().mockResolvedValue(undefined),
    }
  }),
}))

vi.mock("$lib/adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

// post-cutover (v0.8.0): המודול הוא @drive-coding/provider/client, ו-createAcpClient
// מקבל callbacks כאובייקט { onUpdate } (לא listener פוזיציוני). ר' reconcile 2026-07-01.
vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn().mockImplementation(
      (
        _transport: unknown,
        callbacks:
          | ((n: SessionNotification) => void)
          | { onUpdate: (n: SessionNotification) => void },
      ) => {
        capturedListener =
          typeof callbacks === "function" ? callbacks : callbacks.onUpdate
        return Promise.resolve(mockClient)
      },
    ),
  }
})

vi.stubGlobal("location", {
  protocol: "http:",
  host: "localhost:5173",
  search: "",
})

vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("test-uuid-wd") })

// ─── Import after mocks ───────────────────────────────────────────────────────

import { AgentSession } from "./agent-session.svelte"

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** יצירת AgentSession מחובר */
async function buildConnectedSession(): Promise<AgentSession> {
  const session = new AgentSession()
  await session.attach({ cwd: "/tmp", cliKind: "opencode" })
  if (session.status !== "connected") {
    throw new Error(`attach failed: status=${session.status} error=${session.error}`)
  }
  return session
}

/** הגדרת prompt() כ-Promise שניתן לשחרר ידנית */
function setupPromptMock(): { resolve: () => void } {
  const promise = new Promise<void>((res) => {
    mockPromptResolve = res
  })
  mockClient.prompt.mockReturnValueOnce(promise)
  return { resolve: () => mockPromptResolve?.() }
}

/** הזרקת SessionNotification דרך ה-captured listener */
function inject(update: Record<string, unknown>): void {
  if (!capturedListener) throw new Error("listener not captured — attach() not called?")
  capturedListener({ update } as unknown as SessionNotification)
}

// ─── BeforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  capturedListener = null
  mockPromptResolve = null
  mockClient.prompt.mockReset()
  mockClient.cancel.mockResolvedValue(undefined)
  mockClient.newSession.mockResolvedValue({ sessionId: "session-wd-1" })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AgentSession — watchdog (slice-A5)", () => {
  test("1. שתיקה > WATCHDOG_MS → idle כפוי + turnInterrupted=true", async () => {
    vi.useFakeTimers()
    try {
      const session = await buildConnectedSession()
      const ctrl = setupPromptMock()

      // שלח פרומפט — RESP עדיין לא חזר (ctrl.resolve לא נקרא)
      void session.sendPrompt("hello watchdog")
      expect(session.turnState).toBe("waiting")
      expect(session.turnInterrupted).toBe(false)

      // הזרק כמה chunks (כדי לוודא שהם מאפסים את הטיימר)
      inject({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "working..." },
        messageId: "m-wd-1",
      })
      expect(session.turnState).toBe("responding")

      // 44,999ms — עדיין לא נורה
      vi.advanceTimersByTime(44_999)
      expect(session.turnState).toBe("responding")
      expect(session.turnInterrupted).toBe(false)

      // 1ms נוסף (סה"כ 45,000ms אחרי ה-chunk האחרון) — watchdog יורה
      vi.advanceTimersByTime(1)
      expect(session.turnState).toBe("idle")
      expect(session.turnInterrupted).toBe(true)

      // cleanup
      ctrl.resolve()
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  test("2. activity מאפסת את ה-watchdog — idle לא נורה בזמן", async () => {
    vi.useFakeTimers()
    try {
      const session = await buildConnectedSession()
      const ctrl = setupPromptMock()

      void session.sendPrompt("hello watchdog activity")
      expect(session.turnState).toBe("waiting")

      // chunk ראשון ב-t=0
      inject({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "chunk 1" },
        messageId: "m-a1",
      })

      // 30,000ms חלפו — עדיין לא fired
      vi.advanceTimersByTime(30_000)
      expect(session.turnState).toBe("responding")
      expect(session.turnInterrupted).toBe(false)

      // chunk שני ב-t=30,000 — מאפס את הטיימר ל-45,000ms חדשים
      inject({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "chunk 2" },
        messageId: "m-a2",
      })

      // 44,999ms אחרי ה-chunk השני — עדיין לא נורה
      vi.advanceTimersByTime(44_999)
      expect(session.turnState).toBe("responding")
      expect(session.turnInterrupted).toBe(false)

      ctrl.resolve()
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  test("3. tool_call (כלי-שקט) מאפס את ה-watchdog — לא נורה בזמן", async () => {
    vi.useFakeTimers()
    try {
      const session = await buildConnectedSession()
      const ctrl = setupPromptMock()

      void session.sendPrompt("run a silent tool")
      expect(session.turnState).toBe("waiting")

      // 30,000ms ללא chunks
      vi.advanceTimersByTime(30_000)

      // tool_call מגיע — מאפס watchdog (הקריטי ב-§6: כלי-שקט ארוך)
      inject({
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "bash",
        kind: "bash",
        rawInput: {},
        status: "running",
      })

      // עוד 44,999ms אחרי ה-tool_call — עדיין לא נורה
      vi.advanceTimersByTime(44_999)
      expect(session.turnInterrupted).toBe(false)

      ctrl.resolve()
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  test("4. RESP תקין → watchdog מנוקה, turnInterrupted נשאר false", async () => {
    vi.useFakeTimers()
    try {
      const session = await buildConnectedSession()
      const ctrl = setupPromptMock()

      const promptPromise = session.sendPrompt("normal turn")
      expect(session.turnState).toBe("waiting")

      // הזרק chunk
      inject({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "response" },
        messageId: "m-resp-1",
      })
      expect(session.turnState).toBe("responding")

      // RESP חוזר (RESP תקין)
      ctrl.resolve()
      await promptPromise

      // turnState=idle, turnInterrupted=false (RESP תקין, לא watchdog)
      expect(session.turnState).toBe("idle")
      expect(session.turnInterrupted).toBe(false)

      // וגם: הטיימר מנוקה — 45,000ms עוברים בלי לשנות כלום
      vi.advanceTimersByTime(45_000)
      expect(session.turnState).toBe("idle")
      expect(session.turnInterrupted).toBe(false)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  test("5. cancelTurn → watchdog מנוקה, turnInterrupted=false", async () => {
    vi.useFakeTimers()
    try {
      const session = await buildConnectedSession()
      const ctrl = setupPromptMock()

      void session.sendPrompt("cancel me")
      inject({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "mid-response" },
        messageId: "m-cancel-1",
      })
      expect(session.turnState).toBe("responding")

      // בטל את התור
      await session.cancelTurn()
      expect(session.turnState).toBe("idle")
      // cancel מכוון — turnInterrupted לא דולק
      expect(session.turnInterrupted).toBe(false)

      // וגם: הטיימר מנוקה — 45,000ms עוברים בלי שינוי
      vi.advanceTimersByTime(45_000)
      expect(session.turnState).toBe("idle")
      expect(session.turnInterrupted).toBe(false)

      ctrl.resolve()
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  test("6. תור חדש מאפס turnInterrupted מהתור הקודם", async () => {
    vi.useFakeTimers()
    try {
      const session = await buildConnectedSession()

      // תור ראשון — watchdog יורה
      const ctrl1 = setupPromptMock()
      void session.sendPrompt("first turn")
      vi.advanceTimersByTime(45_001)
      expect(session.turnState).toBe("idle")
      expect(session.turnInterrupted).toBe(true)

      ctrl1.resolve()

      // תור שני — turnInterrupted חייב להתאפס
      const ctrl2 = setupPromptMock()
      const p2 = session.sendPrompt("second turn")
      expect(session.turnInterrupted).toBe(false)   // אופן: מאופס בתחילת תור

      ctrl2.resolve()
      await p2
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })
})
