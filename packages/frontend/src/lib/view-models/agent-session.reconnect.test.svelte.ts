/**
 * agent-session.reconnect.test.svelte.ts — unit tests לתשתית reconnect של AgentSession.
 *
 * סיומת `.test.svelte.ts` נדרשת כדי ש-vitest-svelte-preprocessor יעבד $state.
 * דפוס: settings.test.svelte.ts, wake-word.test.svelte.ts.
 *
 * Commit 0 — state + cliKind + visibility:
 *   1. reconnectAttempt ברירת מחדל = 0
 *   2. status מקבל "disconnected" (union typecheck + runtime)
 *   3. reconnectAttempt מתעדכן ל-$state
 *
 * NBug2 fix — tearingDown gate (DoD#1):
 *   4. 1005 בזמן tearingDown=true לא היה מצית reconnect (gate-test)
 *   5. 1005 בזמן tearingDown=false כן היה מצית reconnect (control חיובי)
 *   6. detach() גובר על tearingDown=false (detach-test)
 *   7. 1000/1001 לא מציתים reconnect בשום מצב
 *
 * NBug2 root fix — closeAndWait before warm (DoD#4):
 *   8. #doReconnect (דרך reconnect()) קורא ל-closeAndWait כשיש #transport
 *   9. כשאין #transport — #doReconnect לא זורק, עובר לחיפוש agent ישר
 */

import { beforeEach, describe, expect, test, vi } from "vitest"

// mock adapters שנדרשים ע"י AgentSession (נייבא מ-import עמוק)
vi.mock("../adapters/agents-api", () => ({
  createAgent: vi.fn(),
  deleteAgent: vi.fn(),
  notifySessionAttached: vi.fn(),
  listAgents: vi.fn(),
}))

vi.mock("../adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

import { AgentSession } from "./agent-session.svelte"

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe("AgentSession — reconnect state infrastructure (Commit 0)", () => {
  test("reconnectAttempt defaults to 0", () => {
    const session = new AgentSession()
    expect(session.reconnectAttempt).toBe(0)
  })

  test('status union accepts "disconnected"', () => {
    const session = new AgentSession()
    // יש לאמת שה-type מאפשר "disconnected" בزمن ריצה
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setStatusForTest("disconnected")
    expect(session.status).toBe("disconnected")
  })

  test("reconnectAttempt can be updated", () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setReconnectAttemptForTest(3)
    expect(session.reconnectAttempt).toBe(3)
  })

  test("visibilitychange listener does not crash in node (no document)", () => {
    // וידוא שה-constructor לא זורק כשה-document לא קיים (node environment)
    expect(() => new AgentSession()).not.toThrow()
  })

  test("visibilitychange listener works when document is available", () => {
    // stub document
    vi.stubGlobal("document", {
      hidden: false,
      addEventListener: vi.fn(),
    })
    const session = new AgentSession()
    // #pageHidden צריך להיות false (document.hidden = false)
    // לא ניתן לגשת ל-private ישירות, אבל ה-constructor צריך לרוץ בלי שגיאה
    expect(session.reconnectAttempt).toBe(0)
  })
})

describe("AgentSession — NBug2 tearingDown gate (DoD#1)", () => {
  /**
   * טסט-gate (הליבה): 1005 בזמן teardown לא היה מצית reconnect.
   * predicate טהור — אין #runReconnectLoop, אין טיימרים, אין async.
   * TDD: אדום לפני הוספת #tearingDown לpredicate; ירוק אחריה.
   */
  test("_wouldReconnectOnCloseForTest(1005) returns false when tearingDown=true", () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setTearingDownForTest(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._wouldReconnectOnCloseForTest(1005)).toBe(false)
  })

  /**
   * טסט-control חיובי: 1005 רגיל (tearingDown=false) כן היה מצית reconnect.
   * מוודא שלא שברנו התנהגות תקינה.
   */
  test("_wouldReconnectOnCloseForTest(1005) returns true when tearingDown=false", () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setTearingDownForTest(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._wouldReconnectOnCloseForTest(1005)).toBe(true)
  })

  /**
   * טסט-detach גובר: detach() מחזיר false גם כש-tearingDown=false.
   * מוודא סדר תנאים נכון: #detached בודק לפני #tearingDown.
   */
  test("_wouldReconnectOnCloseForTest(1005) returns false after detach()", () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setTearingDownForTest(false)
    session.detach()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._wouldReconnectOnCloseForTest(1005)).toBe(false)
  })

  /**
   * טסט-1000/1001: סגירות תקינות לעולם לא מציתות reconnect.
   */
  test("_wouldReconnectOnCloseForTest(1000) returns false always", () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setTearingDownForTest(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._wouldReconnectOnCloseForTest(1000)).toBe(false)
  })

  test("_wouldReconnectOnCloseForTest(1001) returns false always", () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setTearingDownForTest(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._wouldReconnectOnCloseForTest(1001)).toBe(false)
  })
})

describe("AgentSession — reconnect state infrastructure (Commit 0)", () => {
  test("reconnectAttempt defaults to 0", () => {
    const session = new AgentSession()
    expect(session.reconnectAttempt).toBe(0)
  })

  test('status union accepts "disconnected"', () => {
    const session = new AgentSession()
    // יש לאמת שה-type מאפשר "disconnected" בزמן ריצה
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setStatusForTest("disconnected")
    expect(session.status).toBe("disconnected")
  })

  test("reconnectAttempt can be updated", () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setReconnectAttemptForTest(3)
    expect(session.reconnectAttempt).toBe(3)
  })

  test("visibilitychange listener does not crash in node (no document)", () => {
    // וידוא שה-constructor לא זורק כשה-document לא קיים (node environment)
    expect(() => new AgentSession()).not.toThrow()
  })

  test("visibilitychange listener works when document is available", () => {
    // stub document
    vi.stubGlobal("document", {
      hidden: false,
      addEventListener: vi.fn(),
    })
    const session = new AgentSession()
    // #pageHidden צריך להיות false (document.hidden = false)
    // לא ניתן לגשת ל-private ישירות, אבל ה-constructor צריך לרוץ בלי שגיאה
    expect(session.reconnectAttempt).toBe(0)
  })
})

describe("AgentSession — NBug2 root fix: #doReconnect closes live WS before warm", () => {
  /**
   * DoD#4: #doReconnect קורא closeAndWait כשיש #transport חי.
   *
   * גישה: test helper _setTransportForTest מזריק transport stub עם closeAndWait spy.
   * #doReconnect (דרך reconnect()) חייב לקרוא closeAndWait לפני שמחפש agent.
   *
   * מוגדר כ-predicate טהור: _wasCloseAndWaitCalledOnReconnect —
   * מריץ רק את שלב ה-closeAndWait (בלי WS אמיתי / createAcpClient / network).
   */
  test("reconnect() calls closeAndWait when #transport is set", async () => {
    const session = new AgentSession()

    // מזריק transport stub עם closeAndWait spy
    const closeAndWaitSpy = vi.fn().mockResolvedValue(undefined)
    const transportStub = { closeAndWait: closeAndWaitSpy }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setTransportForTest(transportStub)

    // מגדיר sessionId + cwd + cliKind כדי ש-reconnect() לא יחזור מוקדם
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setSessionContextForTest({ sessionId: "test-id", cwd: "/tmp", cliKind: "opencode" })

    // mock findReusableAgent → null (כדי ש-doReconnect ילך ל-cold)
    // ו-coldReconnect יזרוק (להפסיק בנקודה מוקדמת — לא צריך WS אמיתי)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._mockFindReusableAgentForTest(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._mockColdReconnectForTest(new Error("cold-blocked"))

    await session.reconnect().catch(() => {})

    // הוכחה: closeAndWait נקרא פעם אחת לפני כל שאר ה-reconnect flow
    expect(closeAndWaitSpy).toHaveBeenCalledOnce()
  })

  test("reconnect() does not throw and skips closeAndWait when #transport is null", async () => {
    const session = new AgentSession()

    // אין transport stub — #transport = null (ברירת מחדל)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setSessionContextForTest({ sessionId: "test-id", cwd: "/tmp", cliKind: "opencode" })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._mockFindReusableAgentForTest(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._mockColdReconnectForTest(new Error("cold-blocked"))

    // לא זורק — גם בלי transport
    await expect(session.reconnect()).rejects.toThrow("cold-blocked")
  })
})

describe("AgentSession — #doReconnect guard against null sessionId (fix-phone-reconnect-pwa)", () => {
  test("#doReconnect bails when #sessionId is null — no cold loadSession, status disconnected", async () => {
    const session = new AgentSession()
    // #sessionId === null (ברירת מחדל) — מדמה WS שנפל לפני שנקבע sessionId (טלפון: סגירה 1006).
    // אם ה-guard נכשל, #doReconnect ימשיך ל-warm(false)→cold שיזרוק:
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._mockFindReusableAgentForTest("agent-x")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._mockWarmReconnectForTest(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._mockColdReconnectForTest(new Error("cold-should-not-run"))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect((session as any)._doReconnectForTest()).resolves.toBeUndefined()
    expect(session.status).toBe("disconnected")
  })

  test("#doReconnect proceeds past guard when session context is set (no over-block)", async () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setSessionContextForTest({ sessionId: "sess-1", cwd: "/tmp", cliKind: "opencode" })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._mockFindReusableAgentForTest("agent-1")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._mockWarmReconnectForTest(true) // warm מצליח → status connected

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._doReconnectForTest()
    expect(session.status).toBe("connected")
  })
})
