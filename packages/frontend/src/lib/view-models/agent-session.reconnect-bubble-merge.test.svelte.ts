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
 *   4. (fix preview 2026-07-22, DoD#11): loadSession נכשל (throw/ACP closed) →
 *      renderBubbles עדיין מחזיר את הבועות הישנות (לא [], לא נעלמות). ה-snapshot
 *      לא משתחרר בכשל — רק בהצלחה.
 *   5. (fix preview 2026-07-22, DoD#12): אחרי כשל — ניסיון-חוזר שמצליח משחרר את
 *      ה-snapshot ומגלה את הרשימה הטרייה (chokepoint משותף ל-warm/cold ב-#setStatus).
 *   6. (תיקון-במקום 2, calev NO-GO r2 2026-07-22, DoD#12b): ניתוק-רשת מוחלט —
 *      listAgents() (#findReusableAgent) נכשל → #doReconnect מדלג על warm לגמרי
 *      ונכנס ישר ל-cold-ישיר → loadSession (createAgent) נכשל גם הוא → renderBubbles
 *      עדיין מחזיר את הבועות הישנות (לא []). זה הבאג שה-fix הראשון (9c0ac8f, שהקפיא
 *      רק בתוך #warmReconnect) לא כיסה — ההקפאה עברה לראש #doReconnect.
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

  test("BUG preview 2026-07-22 (DoD#11): loadSession נכשל → renderBubbles נשאר על הבועות הישנות (לא נעלם ל-[])", async () => {
    const session = new AgentSession()
    const oldBubbles = [makeMessage("old-1", "hello")]
    session.bubbles = oldBubbles

    // loadSession זורק — מדמה "ACP connection closed" בזמן ניתוק-מתמשך
    mockAttachedClient.loadSession.mockReset()
    mockAttachedClient.loadSession.mockRejectedValueOnce(new Error("ACP connection closed"))

    await session.attachToLiveAgent({
      agentId: "agent-1",
      sessionId: "sess-1",
      cwd: "/tmp",
      cliKind: "opencode",
    })

    // warm נכשל (throw בלי 1008 → ניסיון יחיד) → attachToLiveAgent קובע error
    expect(session.status).toBe("error")
    expect(session.bubbles).toEqual([]) // append path כבר איפס — כצפוי
    // ← זה הבאג: לפני התיקון ה-finally שחרר את ה-snapshot גם בכשל, אז renderBubbles===[]
    expect(session.renderBubbles).toEqual(oldBubbles)
    expect(session.isReconnectReplay).toBe(true) // עדיין קפוא — לא reveal בכשל
  })

  test("DoD#12: אחרי כשל — ניסיון-חוזר שמצליח משחרר את ה-snapshot (chokepoint משותף warm/cold)", async () => {
    const session = new AgentSession()
    const oldBubbles = [makeMessage("old-1", "hello")]
    session.bubbles = oldBubbles

    mockAttachedClient.loadSession.mockReset()
    mockAttachedClient.loadSession.mockRejectedValueOnce(new Error("ACP connection closed"))

    await session.attachToLiveAgent({
      agentId: "agent-1",
      sessionId: "sess-1",
      cwd: "/tmp",
      cliKind: "opencode",
    })
    expect(session.status).toBe("error")
    expect(session.renderBubbles).toEqual(oldBubbles) // עדיין קפוא אחרי הכשל הראשון

    // ניסיון-חוזר מצליח (warm שני, מדמה גם warm→cold מבחינת ה-chokepoint המשותף ב-#setStatus)
    mockAttachedClient.loadSession.mockReset()
    mockAttachedClient.loadSession.mockResolvedValueOnce({ sessionId: "sess-1" })

    await session.attachToLiveAgent({
      agentId: "agent-1",
      sessionId: "sess-1",
      cwd: "/tmp",
      cliKind: "opencode",
    })

    expect(session.status).toBe("connected")
    expect(session.isReconnectReplay).toBe(false) // עכשיו כן משתחרר — הצליח
    expect(session.renderBubbles).toBe(session.bubbles)
  })

  test("BUG calev NO-GO r2 (DoD#12b): ניתוק-רשת מוחלט → cold-ישיר → renderBubbles נשאר על הבועות הישנות", async () => {
    const session = new AgentSession()
    const oldBubbles = [makeMessage("old-1", "hello")]
    session.bubbles = oldBubbles
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setSessionContextForTest({
      sessionId: "sess-1",
      cwd: "/tmp",
      cliKind: "opencode",
    })

    // ניתוק-רשת מוחלט: גם listAgents (#findReusableAgent) וגם createAgent (בתוך
    // #coldReconnect→loadSession) נכשלים — "Failed to fetch". #findReusableAgent
    // בולע את השגיאה ומחזיר null → #doReconnect מדלג על warm לגמרי ונכנס ישר ל-cold.
    const { listAgents, createAgent } = await import("$lib/adapters/agents-api")
    vi.mocked(listAgents).mockRejectedValueOnce(new Error("Failed to fetch"))
    vi.mocked(createAgent).mockRejectedValueOnce(new Error("Failed to fetch"))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._doReconnectForTest()

    // loadSession (הקוד הקיים, לא-נוגעים) עדיין מאפס bubbles=[] בתחילתו — כצפוי.
    expect(session.status).toBe("error")
    expect(session.bubbles).toEqual([])
    // ← זה הבאג: לפני התיקון (הקפאה רק בתוך #warmReconnect) renderBubbles===[] כאן,
    // כי cold-ישיר מדלג על #warmReconnect לגמרי ואף אחד לא הקפיא.
    expect(session.renderBubbles).toEqual(oldBubbles)
    expect(session.isReconnectReplay).toBe(true) // עדיין קפוא — לא reveal בכשל
  })
})
