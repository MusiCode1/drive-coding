/**
 * agent-session.error-surface.test.svelte.ts — TDD (Commit 1, slice surface-real-error).
 *
 * סיומת `.test.svelte.ts` נדרשת כי הטסטים נוגעים ב-$state (error/status) על מופע אמיתי
 * של AgentSession — ר' agent-session.reconnect.test.svelte.ts לתקדים.
 *
 * DoD#5 (anti-clobber gate): onClose גנרי לא דורס שגיאה ספציפית קיימת.
 * - gate: status="error" + error="X" קיים → onClose(1005) → error נשאר "X" (לא נדרס).
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

import { AgentSession } from "./agent-session.svelte"

beforeEach(() => {
  vi.unstubAllGlobals()
  // pageHidden=true — עוקף את ענף #scheduleReconnect (ר' תיעוד למעלה)
  vi.stubGlobal("document", { hidden: true, addEventListener: vi.fn() })
})

describe("AgentSession — anti-clobber ב-#handleUnexpectedClose (DoD#5, Commit 1)", () => {
  test("gate: שגיאה ספציפית קיימת (status=error, error=X) שורדת onClose(1005)", () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setStatusForTest("error")
    session.error = "Cannot find module '@anthropic-ai/claude-agent-sdk'"

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._handleUnexpectedCloseForTest(1005, "no reason")

    expect(session.error).toBe("Cannot find module '@anthropic-ai/claude-agent-sdk'")
    // anti-clobber מחזיר מוקדם — status לא משתנה ל-disconnected
    expect(session.status).toBe("error")
  })

  test("control: אין error קודם → onClose(1005) מציג WS closed כרגיל", () => {
    const session = new AgentSession()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._handleUnexpectedCloseForTest(1005, "")

    expect(session.error).toBe("WS closed (1005): no reason")
    expect(session.status).toBe("disconnected")
  })

  test("control: status=error אך error=null (קצה) → לא נחסם, מוצג WS closed", () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setStatusForTest("error")
    session.error = null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._handleUnexpectedCloseForTest(1006, "abnormal")

    expect(session.error).toBe("WS closed (1006): abnormal")
  })
})
