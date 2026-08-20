/**
 * agent-session.reconnect-takeover.test.svelte.ts — slice reconnect-ws-takeover, Commit 1.
 *
 * BE takeover (Commit 0, ws-agent.ts): כשחיבור WS חדש לאותו agentId מדיח ישן, הישן
 * מקבל close(TAKEOVER_CODE=4409). ה-FE המודח **חייב לא** לנסות auto-reconnect — אחרת
 * הוא ידיח את החדש בחזרה → ping-pong אינסופי (§3 architecture diagram, §6 risks).
 *
 * מכסה:
 *   1. onClose(4409) → אין #scheduleReconnect (status נשאר "disconnected", לא נכנס
 *      ללולאת ניסיונות), + הודעה "נפתח במקום אחר".
 *   2. regression: onClose(1006, drop רגיל) → עדיין מצית reconnect (status="disconnected"
 *      + הודעת "WS closed" הרגילה) — לא נשבר ע"י השינוי.
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

import { createI18n, detectLocale } from "@drive-coding/core/i18n"
import { getAgent } from "$lib/adapters/agents-api"
import { AgentSession } from "./agent-session.svelte"

// אין #settings מוזרק בטסטים האלה (AgentSession נבנה בלי opts) → הקוד נופל ל-detectLocale(),
// שבסביבת-בדיקה (jsdom, ללא Settings.locale) תלוי ב-navigator.language של סביבת ה-CI/dev
// (לרוב en-US). לכן מחשבים את ההודעה הצפויה דינמית — לא תלוי-locale קשיח.
const expectedTakeoverMessage = createI18n({ locale: detectLocale() }).t("session.openedElsewhere")

beforeEach(() => {
  vi.unstubAllGlobals()
  // בפוקוס — כדי שנוכל להבדיל בין "לא הוצת reconnect בגלל takeover" לבין "לא הוצת כי ברקע".
  vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn() })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe("AgentSession — takeover close code (slice reconnect-ws-takeover, Commit 1)", () => {
  test("onClose(4409) → status='disconnected' + הודעת 'נפתח במקום אחר', ואין reconnect loop", async () => {
    const session = new AgentSession()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._handleUnexpectedCloseForTest(4409, "taken over by new connection")

    expect(session.status).toBe("disconnected")
    expect(session.error).toBe(expectedTakeoverMessage)
    // #runReconnectLoop (אם רץ) מעלה reconnectAttempt ל-1 *סינכרונית* (לפני ה-await הראשון
    // שלו על setTimeout) — ר' #scheduleReconnect→#runReconnectLoop. אם takeover דילג על
    // #scheduleReconnect, reconnectAttempt נשאר 0. זה ה-discriminator: "האם מוצת reconnect".
    expect(session.reconnectAttempt).toBe(0)

    // getAgent לא נקרא כלל — takeover אינו crash-path, אין סיבה לשאול על הסוכן.
    expect(getAgent).not.toHaveBeenCalled()

    // מוודאים שאין timer תלוי (backoff) שנוצר — advance ואין שינוי סטטוס/ניסיון.
    await vi.advanceTimersByTimeAsync(40_000)
    expect(session.status).toBe("disconnected")
    expect(session.reconnectAttempt).toBe(0)
  })

  test("regression: onClose(1006, drop רגיל) → עדיין מצית reconnect כרגיל", async () => {
    const session = new AgentSession()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._handleUnexpectedCloseForTest(1006, "abnormal closure")

    // סבב-תיקונים liveness: ניתוק חולף כבר **אינו** כותב מחרוזת גולמית — הבאנר
    // (DisconnectBanner) הוא בעל-הבית של מצב-החיבור, ו-this.error מתנקה.
    // ההבחנה שהטסט בודק נשמרת: "נחסם" ⇒ ההודעה הישנה שורדת; "לא נחסם" ⇒ null.
    expect(session.error).toBeNull()
    expect(session.status).toBe("disconnected")
    // reconnect כן מוצת: reconnectAttempt הועלה ל-1 סינכרונית (בניגוד למקרה 4409 למעלה).
    expect(session.reconnectAttempt).toBe(1)
  })
})
