/**
 * agent-session.reconnect-on-visible.test.svelte.ts — slice reconnect-on-visible.
 *
 * בנייד כל נפילת WS קורית **ברקע**: הדפדפן מקפיא את הטאב וה-OS סוגר את ה-socket,
 * ולכן #handleUnexpectedClose תמיד בחר בענף "רקע: לא אוטו". שום דבר לא חימש אותו
 * מחדש בחזרה לפוקוס, אז הדרך היחידה חזרה הייתה כפתור ה-TEMP-RECONNECT הידני.
 *
 * הטסטים המעניינים כאן הם הענפים השקטים (AGENTS.md: "a fail-open path is not
 * implemented until its silence is pinned"), ובראשם שני המצבים הטרמינליים שיושבים
 * גם הם על status="disconnected": takeover (4409) ו-1008 session-host-active.
 * חימוש שם היה מחזיר את ping-pong ההדחה בין טאבים.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

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
import { watchPageVisibility } from "./page-visibility"

/** stub של document שמחזיק את ה-listener כדי לזמן visibilitychange ידנית. */
function stubDocument(): { fire: (hidden: boolean) => void } {
  const listeners = new Set<() => void>()
  const doc = {
    hidden: false,
    addEventListener: (name: string, fn: () => void) => {
      if (name === "visibilitychange") listeners.add(fn)
    },
    removeEventListener: (name: string, fn: () => void) => {
      if (name === "visibilitychange") listeners.delete(fn)
    },
  }
  vi.stubGlobal("document", doc)
  return {
    fire: (hidden: boolean) => {
      doc.hidden = hidden
      for (const fn of listeners) fn()
    },
  }
}

/** סשן שנפל ברקע: status="disconnected", error נוקה (הנתיב החולף). */
function disconnectedInBackground(): {
  session: AgentSession
  fire: (hidden: boolean) => void
} {
  const { fire } = stubDocument()
  const session = new AgentSession()
  session._setStatusForTest("disconnected")
  session.error = null
  fire(true) // הטאב עבר לרקע
  return { session, fire }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("AgentSession — auto-reconnect on returning to the foreground", () => {
  test("a background drop re-arms the backoff loop when the tab becomes visible", async () => {
    const { session, fire } = disconnectedInBackground()
    expect(session.reconnectAttempt).toBe(0)

    fire(false) // חזרה לפוקוס

    // #runReconnectLoop מקדם את המונה סינכרונית לפני ה-await הראשון, אז החימוש
    // נראה מיד: 1 = "ניסיון ראשון על השעון" (סולם ה-backoff: 1s, 2s, 4s, 8s, 16s).
    expect(session.reconnectAttempt).toBe(1)
    expect(session.status).toBe("disconnected")

    session.detach() // עוצר את הלולאה לפני סוף הטסט
  })

  test("takeover (openedElsewhere) stays parked: error is set, so no reconnect", async () => {
    const { session, fire } = disconnectedInBackground()
    session.error = "session already open elsewhere"

    fire(false)

    await vi.advanceTimersByTimeAsync(5000)
    expect(session.reconnectAttempt).toBe(0)
  })

  test("1008 session-host-active stays parked: error is set, so no reconnect", async () => {
    const { session, fire } = disconnectedInBackground()
    session.error = "held by another transport"

    fire(false)

    await vi.advanceTimersByTimeAsync(5000)
    expect(session.reconnectAttempt).toBe(0)
  })

  test("a connected session is left alone when the tab becomes visible", async () => {
    const { fire } = stubDocument()
    const session = new AgentSession()
    session._setStatusForTest("connected")
    fire(true)

    fire(false)

    await vi.advanceTimersByTimeAsync(5000)
    expect(session.reconnectAttempt).toBe(0)
    expect(session.status).toBe("connected")
  })

  test("after detach() no visibility change reconnects", async () => {
    const { session, fire } = disconnectedInBackground()
    session.detach()

    fire(false)

    await vi.advanceTimersByTimeAsync(5000)
    expect(session.reconnectAttempt).toBe(0)
  })

  test("two visible events do not start two loops", async () => {
    const { session, fire } = disconnectedInBackground()

    fire(false)
    fire(true)
    fire(false)

    // לולאה אחת: iteration 1 מקדם ל-1, ואחרי 1s (#doReconnect חוזר מוקדם בלי
    // sessionId) iteration 2 מקדם ל-2. לולאה מקבילה שנייה הייתה מקדמת מעבר לזה.
    await vi.advanceTimersByTimeAsync(1000)
    expect(session.reconnectAttempt).toBe(2)

    session.detach()
  })

  test("staying hidden does not reconnect", async () => {
    const { session, fire } = disconnectedInBackground()

    fire(true) // עוד ברקע, לא מעבר לפוקוס

    await vi.advanceTimersByTimeAsync(5000)
    expect(session.reconnectAttempt).toBe(0)
  })
})

describe("watchPageVisibility", () => {
  test("without document: hidden=false, dispose is a no-op, nothing throws", () => {
    const onVisible = vi.fn()
    // אין stub ל-document — הענף השקט (SSR/node)
    const visibility = watchPageVisibility(onVisible)

    expect(visibility.hidden).toBe(false)
    expect(() => visibility.dispose()).not.toThrow()
    expect(onVisible).not.toHaveBeenCalled()
  })

  test("hidden tracks document.hidden, and onVisible fires only on hidden→visible", () => {
    const { fire } = stubDocument()
    const onVisible = vi.fn()
    const visibility = watchPageVisibility(onVisible)

    expect(visibility.hidden).toBe(false)

    fire(true)
    expect(visibility.hidden).toBe(true)
    expect(onVisible).not.toHaveBeenCalled() // visible→hidden אינו טריגר

    fire(false)
    expect(visibility.hidden).toBe(false)
    expect(onVisible).toHaveBeenCalledTimes(1)

    fire(false) // visible→visible אינו טריגר
    expect(onVisible).toHaveBeenCalledTimes(1)
  })

  test("dispose stops the callback", () => {
    const { fire } = stubDocument()
    const onVisible = vi.fn()
    const visibility = watchPageVisibility(onVisible)

    fire(true)
    visibility.dispose()
    fire(false)

    expect(onVisible).not.toHaveBeenCalled()
  })
})
