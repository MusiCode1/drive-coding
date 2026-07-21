/**
 * agent-session.reconnect-bubble-merge.test.svelte.ts — integration test ל-frozen-display
 * snapshot בזמן warm-reconnect (slice reconnect-bubble-merge, Commit 1: approach=integration).
 *
 * הכיסוי החי (הפלת WS אמיתית, follow/turn-boundary בדפדפן) הוא runtime-gate של כלב —
 * ר' §5 DoD#4/#5/#7/#8 בבריף. כאן: הוכחת מנגנון ה-snapshot עצמו דרך #warmReconnect
 * (לא מוקד לחלוטין — מריצים אותו במלואו עם transport/client מדומים).
 *
 * מכסה:
 *   1. במהלך replay (loadSession עדיין pending): renderBubbles קפוא על הרשימה הישנה
 *      (isReconnectReplay=true) בעוד bubbles כבר התאפס ([]).
 *   2. אחרי שה-replay מסתיים (loadSession resolves): isReconnectReplay=false,
 *      renderBubbles === bubbles (חשוף, לא קפוא).
 *   3. regression: session חדש (לפני כל attach) — isReconnectReplay=false כברירת מחדל,
 *      renderBubbles === bubbles.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-test-1" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock("$lib/adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

// ws-transport: waitForOpen נפתר מיידית (warm "מצליח" לפתוח את ה-WS)
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

let loadSessionResolve: (() => void) | null = null

const mockAttachedClient = {
  loadSession: vi.fn(),
  close: vi.fn(),
}

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    // createAttachedAcpClient סינכרוני (per client.attached.test.ts) — לא Promise
    createAttachedAcpClient: vi.fn().mockImplementation(() => mockAttachedClient),
  }
})

vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })
vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("test-uuid") })

import type { Bubble } from "$lib/types/bubble"
import { AgentSession } from "./agent-session.svelte"

function makeMessage(id: string, text: string): Bubble {
  return {
    id,
    messageId: null,
    createdAt: 0,
    kind: "message",
    segments: [{ id: `${id}-seg`, text }],
  }
}

beforeEach(() => {
  loadSessionResolve = null
  mockAttachedClient.loadSession.mockReset()
  mockAttachedClient.loadSession.mockImplementation(
    () =>
      new Promise<{ sessionId: string }>((res) => {
        loadSessionResolve = () => res({ sessionId: "sess-1" })
      }),
  )
})

describe("AgentSession — frozen display snapshot ב-warm-reconnect (Commit 1)", () => {
  test("במהלך replay: renderBubbles קפוא על bubbles הישנות, bubbles כבר []", async () => {
    const session = new AgentSession()
    const oldBubbles = [makeMessage("old-1", "hello")]
    session.bubbles = oldBubbles

    const attachPromise = session.attachToLiveAgent({
      agentId: "agent-1",
      sessionId: "sess-1",
      cwd: "/tmp",
      cliKind: "opencode",
    })

    // חכה עד ש-loadSession נקרא (הקוד הסינכרוני של #warmReconnect — freeze + bubbles=[] — כבר רץ)
    await vi.waitFor(() => {
      expect(mockAttachedClient.loadSession).toHaveBeenCalled()
    })

    expect(session.isReconnectReplay).toBe(true)
    expect(session.renderBubbles).toBe(oldBubbles) // אותו array reference — קפוא
    expect(session.bubbles).toEqual([]) // append path כבר איפס ל-[]

    // שחרר את ה-replay
    loadSessionResolve?.()
    await attachPromise

    expect(session.isReconnectReplay).toBe(false)
    expect(session.renderBubbles).toBe(session.bubbles) // חשוף — snapshot=null
    expect(session.status).toBe("connected")
  })

  test("regression: session חדש — isReconnectReplay=false, renderBubbles===bubbles", () => {
    const session = new AgentSession()
    expect(session.isReconnectReplay).toBe(false)
    expect(session.renderBubbles).toBe(session.bubbles)
  })
})
