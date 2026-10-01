/**
 * agent-session.error-surface.test.svelte.ts — TDD (Commit 1, slice surface-real-error).
 * עודכן ב-Commit 4 (calev-heavy §10.2): ה-guard עבר מ-`status==="error"` ל-flag ייעודי
 * `terminal policy` — ר' agent-session.reconnect-after-transient-error.test.svelte.ts
 * לטסט החדש שמכסה את ה-gap ש-calev מצא (switchSession/newSession fail לא אמור להשתיק
 * reconnect מאוחר יותר).
 *
 * סיומת `.test.svelte.ts` נדרשת כי הטסטים נוגעים ב-$state (error/status) על מופע אמיתי
 * של AgentSession — ר' agent-session.reconnect.test.svelte.ts לתקדים.
 *
 * DoD#5 (anti-clobber gate): onClose גנרי לא דורס שגיאה טרמינלית קיימת.
 * - gate: terminal policy=true (attach/loadSession catch) + error="X" קיים →
 *   onClose(1005) → error נשאר "X" (לא נדרס).
 * - control: אין error קודם → onClose(1005) → "WS closed (1005): no reason" (כרגיל).
 *
 * pageHidden=true (document.hidden stub) לפני construct — כך #handleUnexpectedClose
 * נכנס לענף "disconnected" ולא מצית #scheduleReconnect/#runReconnectLoop (async מודלף),
 * באותה גישה כמו agent-session.reconnect.test.svelte.ts (הערה בשורות 442-444 בקוד).
 *
 * DoD#3 (formatAcpError בכל catch): מכוסה בטסטים ייעודיים ל-attach/loadSession/
 * switchSession/newSession — כאן רק ה-anti-clobber (A), לא ה-wiring (B) שנבדק
 * בפועל ב-manual verification (§4 Commit 1) כי ה-catch-ים דורשים mock מלא ל-createAgent.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"

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

import { WsConnection } from "$lib/session/ws-connection"
import { AgentSession } from "./agent-session.svelte"

function spyOnOwnedClose(session: AgentSession) {
  const connection = session._getConnectionForTest()
  if (!(connection instanceof WsConnection)) throw new Error("expected WS connection")
  return vi.spyOn(connection, "onUnexpectedClose")
}

beforeEach(() => {
  vi.unstubAllGlobals()
  // pageHidden=true — עוקף את ענף #scheduleReconnect (ר' תיעוד למעלה)
  vi.stubGlobal("document", { hidden: true, addEventListener: vi.fn() })
})

describe("AgentSession — anti-clobber ב-#handleUnexpectedClose (DoD#5, Commit 1 + calev-heavy §10.2 Commit 4)", () => {
  test("gate: שגיאה טרמינלית קיימת (terminal policy=true, error=X) שורדת onClose(1005)", async () => {
    const session = new AgentSession()
    session._setSessionContextForTest({ sessionId: "sess-1", cwd: "/repo", cliKind: "claude" })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setStatusForTest("error")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setTerminalErrorForTest() // מדמה attach/loadSession catch טרמינלי
    session.error = "Cannot find module '@anthropic-ai/claude-agent-sdk'"
    const ownedClose = spyOnOwnedClose(session)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._handleUnexpectedCloseForTest(1005, "no reason")

    expect(session.error).toBe("Cannot find module '@anthropic-ai/claude-agent-sdk'")
    // anti-clobber מחזיר מוקדם — status לא משתנה ל-disconnected
    expect(session.status).toBe("error")
    expect(ownedClose).not.toHaveBeenCalled()
  })

  test("control: אין error קודם → onClose(1005) מציג WS closed כרגיל", async () => {
    const session = new AgentSession()
    session._setSessionContextForTest({ sessionId: "sess-1", cwd: "/repo", cliKind: "claude" })
    const ownedClose = spyOnOwnedClose(session)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._handleUnexpectedCloseForTest(1005, "")

    // סבב-תיקונים liveness: ניתוק חולף כבר **אינו** כותב מחרוזת גולמית — הבאנר
    // (DisconnectBanner) הוא בעל-הבית של מצב-החיבור, ו-this.error מתנקה.
    // ההבחנה שהטסט בודק נשמרת: "נחסם" ⇒ ההודעה הישנה שורדת; "לא נחסם" ⇒ null.
    expect(session.error).toBeNull()
    expect(session.status).toBe("disconnected")
    expect(ownedClose).toHaveBeenCalledWith(1005, "")
  })

  test("control: status=error אך error=null (קצה) → לא נחסם, מוצג WS closed", () => {
    const session = new AgentSession()
    session._setSessionContextForTest({ sessionId: "sess-1", cwd: "/repo", cliKind: "claude" })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setStatusForTest("error")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setTerminalErrorForTest()
    session.error = null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._handleUnexpectedCloseForTest(1006, "abnormal")

    // סבב-תיקונים liveness: ניתוק חולף כבר **אינו** כותב מחרוזת גולמית — הבאנר
    // (DisconnectBanner) הוא בעל-הבית של מצב-החיבור, ו-this.error מתנקה.
    // ההבחנה שהטסט בודק נשמרת: "נחסם" ⇒ ההודעה הישנה שורדת; "לא נחסם" ⇒ null.
    expect(session.error).toBeNull()
  })

  test("control: status=error אך terminal policy=false (switchSession/newSession fail) → לא נחסם", async () => {
    const session = new AgentSession()
    session._setSessionContextForTest({ sessionId: "sess-1", cwd: "/repo", cliKind: "claude" })
    const ownedClose = spyOnOwnedClose(session)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setStatusForTest("error")
    session.error = "switchSession failed: boom" // כמו switchSession catch — לא מדליק את הדגל

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._handleUnexpectedCloseForTest(1006, "abnormal")

    // סבב-תיקונים liveness: ניתוק חולף כבר **אינו** כותב מחרוזת גולמית — הבאנר
    // (DisconnectBanner) הוא בעל-הבית של מצב-החיבור, ו-this.error מתנקה.
    // ההבחנה שהטסט בודק נשמרת: "נחסם" ⇒ ההודעה הישנה שורדת; "לא נחסם" ⇒ null.
    expect(session.error).toBeNull()
    expect(ownedClose).toHaveBeenCalledWith(1006, "abnormal")
  })

  test("אין context או Connection → close מאוחר שקט", async () => {
    const session = new AgentSession()
    await session._handleUnexpectedCloseForTest(1006, "abnormal")
    expect(session.error).toBeNull()
    expect(session.status).toBe("idle")
    expect(session._getConnectionForTest()).toBeNull()
  })
})
