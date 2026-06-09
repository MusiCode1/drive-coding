/**
 * agent-session.test.svelte.ts — integration tests ל-AgentSession (NBug1/2/3).
 *
 * מכסה (§4 Commit 3 ב-brief):
 *   1. resolve → idle: אחרי prompt() resolve, turnState=idle ו-#turnEnded=true.
 *   2. tail simulation (NBug1): chunk אחרי RESP → responding, advanceTimers(TAIL_MS) → idle.
 *   3. before-RESP (without debounce): chunk לפני resolve (#turnEnded=false) → אין טיימר.
 *   4. replay → idle (NBug3 guard): loadMockSession → turnState=idle בסוף.
 *
 * Testing: integration (approach: integration — Commit 3)
 */

import { beforeEach, describe, expect, test, vi } from "vitest"
import type { SessionNotification } from "@agentclientprotocol/sdk"

// ─── Mocks לפני ייבוא AgentSession ───────────────────────────────────────────

// 1. agents-api: createAgent + deleteAgent + notifySessionAttached
vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-test-1" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
}))

// 2. ws-transport: WsAcpTransport — מדמה open מיידי (חובה regular function ל-new)
vi.mock("$lib/engines/ws-transport", () => ({
  // eslint-disable-next-line prefer-arrow-callback
  WsAcpTransport: vi.fn().mockImplementation(function MockTransport() {
    return {
      onClose: vi.fn(),
      waitForOpen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    }
  }),
}))

// 3. sessions adapter (לרשימת סשנים)
vi.mock("$lib/adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

// 4. createAcpClient — מחזיר mock client; תופס את ה-listener (onSessionUpdate)
let capturedListener: ((n: SessionNotification) => void) | null = null
let mockPromptResolve: (() => void) | null = null
let mockPromptReject: ((e: Error) => void) | null = null

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

vi.mock("@drive-coding/core/acp/client", () => ({
  createAcpClient: vi.fn().mockImplementation(
    (_transport: unknown, listener: (n: SessionNotification) => void) => {
      capturedListener = listener
      return Promise.resolve(mockClient)
    },
  ),
}))

// 5. fetch global — לfixtures
const mockFixture = {
  updates: [
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" }, messageId: "m1" },
  ],
}
vi.stubGlobal(
  "fetch",
  vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(mockFixture),
  }),
)

// 6. location (לURL params ב-#loadMockSession)
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
function setupPromptMock(): { resolve: () => void; reject: (e: Error) => void } {
  const promise = new Promise<void>((res, rej) => {
    mockPromptResolve = res
    mockPromptReject = rej
  })
  mockClient.prompt.mockReturnValueOnce(promise)
  return {
    resolve: () => mockPromptResolve?.(),
    reject: (e) => mockPromptReject?.(e),
  }
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
  mockPromptReject = null
  mockClient.prompt.mockReset()
  mockClient.newSession.mockResolvedValue({ sessionId: "session-1" })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AgentSession — turnState flow (NBug1/2/3 fix)", () => {
  test("1. resolve → idle: prompt() resolve → turnState=idle", async () => {
    vi.useFakeTimers()
    try {
      const session = await buildConnectedSession()
      const ctrl = setupPromptMock()

      const promptPromise = session.sendPrompt("hello")
      expect(session.turnState).toBe("waiting")

      ctrl.resolve()
      await promptPromise

      expect(session.turnState).toBe("idle")
    } finally {
      vi.useRealTimers()
    }
  })

  test("2. tail simulation (NBug1): chunk after RESP -> responding, after TAIL_MS -> idle", async () => {
    vi.useFakeTimers()
    try {
      const session = await buildConnectedSession()
      const ctrl = setupPromptMock()

      const promptPromise = session.sendPrompt("hello")

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

      // לפני TAIL_MS — עדיין responding
      vi.advanceTimersByTime(1499)
      expect(session.turnState).toBe("responding")

      // אחרי TAIL_MS — idle
      vi.advanceTimersByTime(1)
      expect(session.turnState).toBe("idle")
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  test("3. before-RESP: chunk before resolve (#turnEnded=false) -> no debounce, responding stays", async () => {
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

      // אחרי TAIL_MS — עדיין responding (טיימר לא תוזמן)
      vi.advanceTimersByTime(2000)
      expect(session.turnState).toBe("responding")

      // נקה בלי לחכות
      ctrl.resolve()
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  test("4. replay -> idle (NBug3): loadMockSession resets turnState=idle after history load", async () => {
    // mock session טעינה: buildConnectedSession + שנה sessionId ל-"mock:greeting"
    const session = new AgentSession()
    // קרא loadSession עם sessionId mock:greeting (DEV path)
    // loadSession בודק import.meta.env.DEV + "mock:" prefix
    // ב-vitest: import.meta.env.DEV = true כברירת מחדל
    await session.loadSession({ sessionId: "mock:greeting", cwd: "/tmp", cliKind: "opencode" })
    expect(session.turnState).toBe("idle")
    // ודא שיש bubbles מהfixture (לפחות בועה אחת)
    expect(session.bubbles.length).toBeGreaterThan(0)
  })

  test("4b. stale tail timer cleared on switchSession: opencode turn + immediate switch -> no phantom idle", async () => {
    vi.useFakeTimers()
    try {
      const session = await buildConnectedSession()
      const ctrl = setupPromptMock()

      const promptPromise = session.sendPrompt("hello")
      ctrl.resolve()
      await promptPromise
      expect(session.turnState).toBe("idle")

      // הזרק tail chunk — מתזמן timer
      inject({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "tail" },
        messageId: "m-t",
      })
      expect(session.turnState).toBe("responding")

      // מיד עובר לסשן אחר (warm switch) — צריך לנקות את הtimer (#resetTurnTracking)
      // switchSession עובד כשstatus="connected" ו-#client חי
      // sessionId ללא "mock:" prefix כדי שה-DEV branch לא יפנה ל-loadSession הכבד
      await session.switchSession({ sessionId: "session-old-1", cwd: "/tmp", cliKind: "opencode" })
      expect(session.turnState).toBe("idle")

      // אחרי TAIL_MS — הtimer היתום לא יורה
      vi.advanceTimersByTime(2000)
      expect(session.turnState).toBe("idle")
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })
})
