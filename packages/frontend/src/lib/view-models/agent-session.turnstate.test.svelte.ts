/**
 * agent-session.turnstate.test.svelte.ts — integration tests ל-turnState (NBug1/cancel/replay).
 *
 * מכסה:
 *   1. NBug1 tail-debounce: chunk אחרי RESP → responding; advanceTimers(1500) → idle.
 *      ה-content של ה-tail-chunk כן נכנס (לא נאבד).
 *   2. before-RESP guard: chunk לפני RESP (#turnEnded=false) → אין debounce, responding נשאר.
 *   3. cancelTurn: turnState=responding → cancelTurn() → idle.
 *   4. NBug3 replay reset: loadMockSession → turnState=idle בסוף (לא נתקע ב-responding).
 *
 * Testing: integration
 * Commit 7 ב-slice-msr-v2.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"
import type { SessionNotification } from "@agentclientprotocol/sdk"

// ─── Mocks לפני ייבוא AgentSession ───────────────────────────────────────────

// 1. agents-api: createAgent + deleteAgent + notifySessionAttached
vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-test-1" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
}))

// 2. ws-transport: WsAcpTransport — מדמה open מיידי (חובה regular function ל-new)
vi.mock("@drive-coding/provider/transport/ws", () => ({
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

// 3. sessions adapter (לרשימת סשנים ב-AgentSession)
vi.mock("$lib/adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

// 4. createAcpClient — מחזיר mock client; תופס את ה-listener (onSessionUpdate)
let capturedListener: ((n: SessionNotification) => void) | null = null
let mockPromptResolve: (() => void) | null = null

const mockClient = {
  prompt: vi.fn(),
  cancel: vi.fn().mockResolvedValue(undefined),
  newSession: vi.fn().mockResolvedValue({ sessionId: "session-1" }),
  loadSession: vi.fn().mockResolvedValue({ sessionId: "session-1" }),
  listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  setSessionConfigOption: vi.fn(),
  setSessionModel: vi.fn(),
  setSessionMode: vi.fn(),
  close: vi.fn(),
}

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn().mockImplementation(
      (_transport: unknown, listener: (n: SessionNotification) => void) => {
        capturedListener = listener
        return Promise.resolve(mockClient)
      },
    ),
  }
})

// 5. fetch global — לfixtures (NBug3/replay test)
const mockFixture = {
  updates: [
    {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "hello from replay" },
      messageId: "m1",
    },
  ],
}
vi.stubGlobal(
  "fetch",
  vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(mockFixture),
  }),
)

// 6. location (נדרש ע"י attach + #loadMockSession)
vi.stubGlobal("location", {
  protocol: "http:",
  host: "localhost:5173",
  search: "",
})

// 7. crypto.randomUUID
vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("test-uuid") })

import { AgentSession } from "./agent-session.svelte"

// ─── helpers ─────────────────────────────────────────────────────────────────

/** מגדיר prompt() כ-Promise שניתן לשחרר ידנית */
function setupPromptMock(): { resolve: () => void } {
  const promise = new Promise<void>((res) => {
    mockPromptResolve = res
  })
  mockClient.prompt.mockReturnValueOnce(promise)
  return { resolve: () => mockPromptResolve?.() }
}

/** יצירת AgentSession מחובר */
async function buildConnectedSession(): Promise<AgentSession> {
  const session = new AgentSession()
  await session.attach({ cwd: "/tmp", cliKind: "opencode" })
  if (session.status !== "connected") {
    throw new Error(`attach failed: status=${session.status} error=${session.error}`)
  }
  return session
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
  mockClient.newSession.mockResolvedValue({ sessionId: "session-1" })
  mockClient.loadSession.mockResolvedValue({ sessionId: "session-1" })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AgentSession — turnState flow (NBug1 tail-debounce + cancel + replay)", () => {
  test("1. NBug1 tail: chunk אחרי RESP → responding; אחרי 1500ms → idle; content לא נאבד", async () => {
    vi.useFakeTimers()
    try {
      const session = await buildConnectedSession()
      const ctrl = setupPromptMock()

      const promptPromise = session.sendPrompt("hello")
      expect(session.turnState).toBe("waiting")

      // שחרר RESP
      ctrl.resolve()
      await promptPromise
      expect(session.turnState).toBe("idle")

      // הזרק tail chunk (אחרי RESP → #turnEnded=true)
      inject({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "tail content" },
        messageId: "m-tail",
      })
      expect(session.turnState).toBe("responding")

      // content ה-tail כן נכנס (לא נאבד) — לפחות בועה אחת עם הטקסט
      const hasContent = session.bubbles.some(
        (b) =>
          b.kind === "message" &&
          b.segments.some((s) => s.text === "tail content"),
      )
      expect(hasContent).toBe(true)

      // לפני 1500ms — עדיין responding
      vi.advanceTimersByTime(1499)
      expect(session.turnState).toBe("responding")

      // אחרי 1500ms — idle
      vi.advanceTimersByTime(1)
      expect(session.turnState).toBe("idle")
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  test("2. before-RESP guard: chunk לפני RESP (#turnEnded=false) → אין debounce, responding נשאר", async () => {
    vi.useFakeTimers()
    try {
      const session = await buildConnectedSession()
      const ctrl = setupPromptMock()

      void session.sendPrompt("hello")
      expect(session.turnState).toBe("waiting")

      // הזרק chunk לפני RESP — #turnEnded=false → אין #scheduleIdle()
      inject({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "live chunk" },
        messageId: "m-live",
      })
      expect(session.turnState).toBe("responding")

      // אחרי 1500ms — עדיין responding (טיימר לא תוזמן כי #turnEnded=false)
      vi.advanceTimersByTime(2000)
      expect(session.turnState).toBe("responding")

      // נקה
      ctrl.resolve()
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  test("3. cancelTurn: turnState=responding → cancelTurn() → idle", async () => {
    vi.useFakeTimers()
    try {
      const session = await buildConnectedSession()
      const ctrl = setupPromptMock()

      void session.sendPrompt("hello")
      // הזרק chunk להכנסת responding
      inject({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "mid-turn" },
        messageId: "m-mid",
      })
      expect(session.turnState).toBe("responding")

      // ביטול התור
      await session.cancelTurn()
      expect(session.turnState).toBe("idle")

      // וודא ש-cancel נקרא ב-ACP
      expect(mockClient.cancel).toHaveBeenCalled()

      // נקה
      ctrl.resolve()
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  test("4. NBug3 replay reset: loadMockSession → turnState=idle בסוף (לא נתקע ב-responding)", async () => {
    // mock session טעינה: loadSession עם sessionId "mock:greeting" — DEV path
    // ב-vitest: import.meta.env.DEV = true כברירת מחדל → #loadMockSession ירוץ
    const session = new AgentSession()
    await session.loadSession({ sessionId: "mock:greeting", cwd: "/tmp", cliKind: "opencode" })

    // turnState חייב להיות idle — לא responding (NBug3)
    expect(session.turnState).toBe("idle")

    // ודא שיש בועות מה-fixture (לפחות בועה אחת)
    expect(session.bubbles.length).toBeGreaterThan(0)
  })
})
