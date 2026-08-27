/**
 * presence-poller.test.svelte.ts — סקר presence (slice liveness C3/C4, DoD #14-17).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
  _resetPageVisibilityForTest,
  _setPageHiddenForTest,
} from "$lib/util/page-visibility.svelte"
import {
  PRESENCE_BANNER_DELAY_MS,
  PRESENCE_INTERVAL_MS,
  PresencePoller,
} from "./presence-poller.svelte.js"

const mocks = vi.hoisted(() => ({
  postPresence: vi.fn(),
  notifySessionAttached: vi.fn(),
}))

vi.mock("$lib/adapters/agents-api", () => ({
  postPresence: mocks.postPresence,
  notifySessionAttached: mocks.notifySessionAttached,
}))

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    status: "connected",
    agentId: "agent-1",
    sessionState: { sessionId: "sess-1" },
    ...overrides,
  } as import("./agent-session.svelte.js").AgentSession
}

describe("PresencePoller", () => {
  let poller: PresencePoller

  beforeEach(() => {
    vi.useFakeTimers()
    _resetPageVisibilityForTest()
    _setPageHiddenForTest(false)
    mocks.postPresence.mockReset()
    mocks.notifySessionAttached.mockReset()
    mocks.postPresence.mockResolvedValue({
      ok: true,
      agent: { attached: true, lastSeenAt: Date.now() },
      machine: null,
    })
    mocks.notifySessionAttached.mockResolvedValue(undefined)
    poller = new PresencePoller(makeSession())
    poller.init()
  })

  afterEach(() => {
    poller.dispose()
    vi.useRealTimers()
  })

  test("in-session visible: one request per tick, not in background", async () => {
    poller.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await Promise.resolve()
    expect(mocks.postPresence).toHaveBeenCalledTimes(1)

    mocks.postPresence.mockClear()
    _setPageHiddenForTest(true)
    poller.sync({ inSession: true, agentId: "agent-1", hidden: true })
    await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS * 2)
    expect(mocks.postPresence).not.toHaveBeenCalled()
  })

  test("interval fires every 12s while visible in session", async () => {
    poller.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await Promise.resolve()
    mocks.postPresence.mockClear()

    await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS)
    expect(mocks.postPresence).toHaveBeenCalledTimes(1)
  })

  test("focus (visible) triggers immediate tick", async () => {
    // ⚠️ אימות עצמאי (מרדכי): הגרסה הקודמת קראה `poller.tick("focus")` **ידנית**,
    // כלומר בדקה שהמתודה עובדת — לא שה**מאזין מחווט אליה**. אומת במוטציה:
    // הסרת `void this.tick("focus")` מ-`init()` השאירה 9/9 ירוקים.
    // ⇒ הטסט חייב להסתמך על אירוע-הנראות בלבד. `_setPageHiddenForTest(false)`
    // מפעיל `notifyVisible()` (page-visibility.svelte.ts:50), ולכן זה מספיק.
    poller.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await Promise.resolve()
    await Promise.resolve()
    mocks.postPresence.mockClear()

    _setPageHiddenForTest(true)
    poller.sync({ inSession: true, agentId: "agent-1", hidden: true })

    // חזרה לפוקוס — **בלי** קריאה ידנית ל-tick
    _setPageHiddenForTest(false)
    poller.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    expect(mocks.postPresence).toHaveBeenCalledTimes(1)
  })

  test("retakes ownership when attached=false after presence", async () => {
    mocks.postPresence.mockResolvedValue({
      ok: true,
      agent: { attached: false, lastSeenAt: null },
      machine: null,
    })
    poller.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await Promise.resolve()

    expect(mocks.notifySessionAttached).toHaveBeenCalledWith("agent-1", "sess-1", {
      replace: true,
    })
  })

  test("fast recovery: no banner within 5s", async () => {
    mocks.postPresence.mockRejectedValueOnce(new Error("network down"))
    poller.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await Promise.resolve()

    mocks.postPresence.mockResolvedValueOnce({
      ok: true,
      agent: { attached: true, lastSeenAt: Date.now() },
      machine: null,
    })
    await poller.tick("focus")
    await vi.advanceTimersByTimeAsync(PRESENCE_BANNER_DELAY_MS)
    expect(poller.banner).toBeNull()
  })

  test("failure >5s shows reconnecting banner", async () => {
    mocks.postPresence.mockRejectedValue(new Error("network down"))
    poller.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(PRESENCE_BANNER_DELAY_MS)
    expect(poller.banner).toBe("reconnecting")
  })

  test("crashReason survives — banner is separate from session.error", async () => {
    const session = makeSession({ error: "ENOENT: claude binary not found" })
    const p = new PresencePoller(session)
    mocks.postPresence.mockRejectedValue(new Error("network down"))
    p.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(PRESENCE_BANNER_DELAY_MS)
    expect(p.banner).toBe("reconnecting")
    expect(session.error).toBe("ENOENT: claude binary not found")
    p.dispose()
  })

  test("not in session: no requests (panel closed scenario — poller at layout level)", async () => {
    poller.sync({ inSession: false, agentId: null, hidden: false })
    await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS * 3)
    expect(mocks.postPresence).not.toHaveBeenCalled()
  })

  test("טרנספורט שנפל מדליק את הבאנר — בלי POST", async () => {
    // 🔴 סבב-תיקונים liveness: קודם היה כאן `return` סתמי כש-status!=="connected",
    // ולכן הבאנר השתתק בדיוק ברגע שנועד להופיע. מוטציה: החזרת ה-`return`
    // הישן מפילה את הטסט הזה בלבד.
    const session = makeSession({ status: "disconnected" })
    const p = new PresencePoller(session)
    p.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await Promise.resolve()

    expect(mocks.postPresence).not.toHaveBeenCalled() // אין למי לפנות
    expect(p.banner).toBeNull() // חסד של 5 שניות — חזרה מהירה עוברת בשקט

    await vi.advanceTimersByTimeAsync(PRESENCE_BANNER_DELAY_MS)
    expect(p.banner).toBe("reconnecting")
    p.dispose()
  })

  test("onSseReconnected clears banner", async () => {
    mocks.postPresence.mockRejectedValue(new Error("network down"))
    poller.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(PRESENCE_BANNER_DELAY_MS)
    expect(poller.banner).toBe("reconnecting")

    poller.onSseReconnected()
    expect(poller.banner).toBeNull()
  })
})

// ── סוכן שאיננו: 200 עם agent:null ──────────────────────────────────────────

/**
 * 🔴 הבאג שדווח. `POST /presence` על סוכן שאינו קיים מחזיר **200
 * `{ok:true, agent:null}`**, וה-FE נפל רק על `!res.ok` ⇒ `clearBanner()` רץ
 * ו**אישר בשקר** שהכל תקין. זה בדיוק התסמין.
 */
describe("PresencePoller — agent:null הוא סוכן שאיננו", () => {
  let poller: PresencePoller

  beforeEach(() => {
    vi.useFakeTimers()
    _resetPageVisibilityForTest()
    _setPageHiddenForTest(false)
    mocks.postPresence.mockReset()
    mocks.notifySessionAttached.mockReset()
    mocks.notifySessionAttached.mockResolvedValue(undefined)
    poller = new PresencePoller(makeSession())
    poller.init()
  })

  afterEach(() => {
    poller.dispose()
    vi.useRealTimers()
  })

  test("🔴 200 עם agent:null ⇒ באנר 'gone', ולא ניקוי-באנר", async () => {
    mocks.postPresence.mockResolvedValue({ ok: true, agent: null, machine: null })

    poller.sync({ inSession: true, agentId: "ghost", hidden: false })
    await Promise.resolve()
    await Promise.resolve()

    expect(poller.banner).toBe("gone")
  })

  test("אינו מנסה לתפוס בעלות על סוכן-רפאים", async () => {
    mocks.postPresence.mockResolvedValue({ ok: true, agent: null, machine: null })

    poller.sync({ inSession: true, agentId: "ghost", hidden: false })
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.notifySessionAttached).not.toHaveBeenCalled()
  })

  test("סוכן קיים ולא-מחובר — עדיין תופס בעלות (לא נשברה ההתנהגות)", async () => {
    mocks.postPresence.mockResolvedValue({
      ok: true,
      agent: {
        pid: 1,
        attached: false,
        busy: false,
        lastMessageAt: 1,
        lastSeenAt: 1,
        via: "http",
      },
      machine: null,
    })

    poller.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.notifySessionAttached).toHaveBeenCalled()
    expect(poller.banner).toBeNull()
  })

  test("gone אינו נדרס כשהטרנספורט נופל אחריו", async () => {
    // 🔴 r2 ממצא 3 — בלי גארד ב-#applyBanner, כשל-טרנספורט אחרי מחיקה
    // מחליף "gone" ב-"מנסה להתחבר". זה התרחיש האמיתי: סוכן שנמחק ⇒ ה-WS נופל.
    const session = makeSession()
    const p = new PresencePoller(session)
    p.init()
    mocks.postPresence.mockResolvedValue({ ok: true, agent: null, machine: null })
    p.sync({ inSession: true, agentId: "ghost", hidden: false })
    await Promise.resolve()
    await Promise.resolve()
    expect(p.banner).toBe("gone")

    session.status = "disconnected"
    await p.tick("interval")
    await vi.advanceTimersByTimeAsync(PRESENCE_BANNER_DELAY_MS)
    expect(p.banner).toBe("gone")
    p.dispose()
  })

  test("ממשיך לסקור אחרי gone — הסקר לא נעצר", async () => {
    mocks.postPresence.mockResolvedValue({ ok: true, agent: null, machine: null })
    poller.sync({ inSession: true, agentId: "ghost", hidden: false })
    await Promise.resolve()
    await Promise.resolve()
    mocks.postPresence.mockClear()

    await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS)
    expect(mocks.postPresence).toHaveBeenCalledTimes(1)
    expect(poller.banner).toBe("gone")
  })
})

// ── machine stats from presence (slice machine-stats-in-session) ─────────────

const SAMPLE_MACHINE = {
  totalMemMB: 16384,
  usedMemMB: 8192,
  freeMemMB: 8192,
  memPct: 50,
  loadAvg1: 1.7,
  cpuCount: 4,
  loadPct: 42,
} as const

describe("PresencePoller — machine stats", () => {
  let poller: PresencePoller

  beforeEach(() => {
    vi.useFakeTimers()
    _resetPageVisibilityForTest()
    _setPageHiddenForTest(false)
    mocks.postPresence.mockReset()
    mocks.notifySessionAttached.mockReset()
    mocks.postPresence.mockResolvedValue({
      ok: true,
      agent: { attached: true, lastSeenAt: Date.now() },
      machine: null,
    })
    mocks.notifySessionAttached.mockResolvedValue(undefined)
    poller = new PresencePoller(makeSession())
    poller.init()
  })

  afterEach(() => {
    poller.dispose()
    vi.useRealTimers()
  })

  test("successful tick with machine updates poller.machine", async () => {
    mocks.postPresence.mockResolvedValue({
      ok: true,
      agent: { attached: true, lastSeenAt: Date.now() },
      machine: SAMPLE_MACHINE,
    })
    poller.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await Promise.resolve()

    expect(poller.machine).toEqual(SAMPLE_MACHINE)
  })

  test("failed tick does not reset machine to null", async () => {
    mocks.postPresence.mockResolvedValueOnce({
      ok: true,
      agent: { attached: true, lastSeenAt: Date.now() },
      machine: SAMPLE_MACHINE,
    })
    poller.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await Promise.resolve()
    await Promise.resolve()
    expect(poller.machine).toEqual(SAMPLE_MACHINE)

    mocks.postPresence.mockRejectedValue(new Error("network down"))
    await poller.tick("focus")
    await vi.advanceTimersByTimeAsync(PRESENCE_BANNER_DELAY_MS)

    expect(poller.machine).toEqual(SAMPLE_MACHINE)
  })
})
