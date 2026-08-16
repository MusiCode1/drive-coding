/**
 * agent-session.reconnect-after-transient-error.test.svelte.ts — TDD (Commit 4, calev-heavy §10.2).
 *
 * calev-heavy phase-1 finding (Finding 3 / §9 Q1): הגישה המקורית `status==="error"` כ-guard
 * ב-#handleUnexpectedClose משתיקה auto-reconnect גם אחרי כשל switchSession/newSession —
 * שהם קובעים status="error" אבל **משאירים את ה-WS חי** (בלי #cleanup). אם החיבור-החי הזה
 * נופל מאוחר יותר, ה-guard הישן היה חוזר מוקדם → אין reconnect, וההודעה הישנה
 * ("switchSession failed…") נתקעת לנצח.
 *
 * ההכרעה (מרדכי, §10.2): guard חדש דרך flag ייעודי `#errorSurfaced` — מוצת רק ב-catch
 * טרמינלי (attach/loadSession), *לא* ב-switchSession/newSession. הטסט כאן מוכיח את
 * ההתנהגות המתוקנת: switchSession-fail (WS חי, #errorSurfaced=false) → drop לא-צפוי →
 * reconnect כן מוצת (status→disconnected) + ההודעה הישנה מוחלפת ב-WS closed.
 *
 * pageHidden=false (document.hidden=false, בפוקוס) — כדי ש-#handleUnexpectedClose *כן*
 * יגיע ל-#scheduleReconnect (לא ל-ענף הרקע "disconnected" המוקדם). vi.useFakeTimers()
 * מונע מ-#runReconnectLoop להשאיר setTimeout אמיתי תלוי אחרי הטסט (BACKOFF_MS[0]=1000ms).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("../adapters/agents-api", () => ({
  createAgent: vi.fn(),
  deleteAgent: vi.fn(),
  notifySessionAttached: vi.fn(),
  listAgents: vi.fn(),
  getAgent: vi.fn(),
}))

vi.mock("../adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

import { AgentSession } from "./agent-session.svelte"

beforeEach(() => {
  vi.unstubAllGlobals()
  // בפוקוס (לא ברקע) — כדי שה-guard הרלוונטי (#errorSurfaced) יגיע להיבדק לפני #scheduleReconnect,
  // ולא ייחסם מוקדם ע"י ענף ה-pageHidden.
  vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn() })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe("AgentSession — reconnect אחרי כשל switchSession/newSession חולף (calev-heavy §10.2, Commit 4)", () => {
  test("switchSession fail (WS חי, #errorSurfaced=false) → drop לא-צפוי → reconnect מוצת, ההודעה מוחלפת", async () => {
    const session = new AgentSession()
    // מדמה את מצב ה-VM מיד אחרי switchSession catch: status="error" + הודעה ספציפית,
    // אך #errorSurfaced *נשאר false* (switchSession לא מדליק אותו — §10.2).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setStatusForTest("error")
    session.error = "switchSession failed: boom"

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._handleUnexpectedCloseForTest(1006, "abnormal closure")

    // ההודעה הישנה הוחלפה — anti-clobber לא חסם (לא #errorSurfaced)
    // סבב-תיקונים liveness: ניתוק חולף כבר **אינו** כותב מחרוזת גולמית — הבאנר
    // (DisconnectBanner) הוא בעל-הבית של מצב-החיבור, ו-this.error מתנקה.
    // ההבחנה שהטסט בודק נשמרת: "נחסם" ⇒ ההודעה הישנה שורדת; "לא נחסם" ⇒ null.
    expect(session.error).toBeNull()
    // reconnect אכן מוצת: #scheduleReconnect קובע status="disconnected" באופן סינכרוני
    // (לפני תחילת ה-backoff loop) — מוכיח שלא נתקענו על status="error".
    expect(session.status).toBe("disconnected")
  })

  test("newSession fail (WS חי, #errorSurfaced=false) → drop לא-צפוי → reconnect מוצת, ההודעה מוחלפת", async () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setStatusForTest("error")
    session.error = "newSession failed: boom"

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._handleUnexpectedCloseForTest(1011, "server error")

    // סבב-תיקונים liveness: ניתוק חולף כבר **אינו** כותב מחרוזת גולמית — הבאנר
    // (DisconnectBanner) הוא בעל-הבית של מצב-החיבור, ו-this.error מתנקה.
    // ההבחנה שהטסט בודק נשמרת: "נחסם" ⇒ ההודעה הישנה שורדת; "לא נחסם" ⇒ null.
    expect(session.error).toBeNull()
    expect(session.status).toBe("disconnected")
  })

  test("control: attach/loadSession fail (#errorSurfaced=true) → drop לא-צפוי → לא מוצת, ההודעה שורדת", async () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setStatusForTest("error")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setErrorSurfacedForTest(true) // מדמה attach/loadSession catch טרמינלי
    session.error = "Cannot find module '@anthropic-ai/claude-agent-sdk'"

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._handleUnexpectedCloseForTest(1011, "server error")

    // anti-clobber חוסם — ההודעה הטרמינלית שורדת, status לא זז מ-error (לא מוצת reconnect)
    expect(session.error).toBe("Cannot find module '@anthropic-ai/claude-agent-sdk'")
    expect(session.status).toBe("error")
  })
})
