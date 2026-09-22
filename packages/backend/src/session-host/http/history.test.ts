/**
 * history.test.ts — TDD tests for GET /api/agents/:id/history.
 *
 * Testing: tdd (בריף `history-get` §4 C1)
 *
 * ⚠️ **רתמת-המוקים כאן היא עותק מכוון של זו שב-`state.test.ts`**, וזו הכרעה
 * ולא עצלות. ‏`state.test.ts` אינו מייצא כלום, וזו המוסכמה בתיקייה כולה
 * (‏`events` / `reply` / `rpc` / `presence` — כל אחד מחזיק עותק, ואין בריפו
 * אף ייבוא מקובץ-`.test`). ייצוא וייבוא ממנו היו מריצים את בלוקי ה-`describe`
 * שלו **פעמיים** — סמנטיקת-מודולים, לא סגנון. חילוץ ל-`__testing__/` הוא
 * הנכון לטווח-ארוך אבל דורש שכתוב של `state.test.ts` — מחוץ ל-scope.
 *
 * 🔴 **`getOrCreateHost: vi.fn()` חייב להופיע ברתמה** — אבל לא מהסיבה שנכתבה
 * בבריף. שם נטען שברתמה בלי השדה האסרציה
 * `expect(registry.getOrCreateHost).not.toHaveBeenCalled()` **עוברת בשקט**.
 * נמדד כאן (‏22/09/2026, שער-המוטציה §5 שורה 4) — **זה אינו נכון בסטאק הזה**:
 * ‏vitest 4 זורק `TypeError: undefined is not a spy or a call to a spy!` גם תחת
 * ‏`.not`, כלומר האסרציה שומרת על עצמה ושתי השורות מאדימות.
 *
 * השדה נשאר, ועדיין נכון שיישאר: הרתמה אמורה לשקף את הצורה האמיתית של
 * ‏`AgentSessionRegistry` (‏`vi.fn()` אינו מטופס, ולכן צורה שגויה כאן עוברת
 * בלי שהטיפוסים יתלוננו — אותו נימוק שכתוב ב-`state.test.ts`). מה שהשתנה הוא
 * הנימוק, לא ההכרעה.
 */

import type { SessionState, WireSessionUpdate } from "@drive-coding/core/session"
import {
  createInitialSessionState,
  recordCarried,
  snapshotFrame,
  snapshotPayload,
} from "@drive-coding/core/session"
import { Hono } from "hono"
import { describe, expect, it, vi } from "vitest"
import type { AgentSessionRegistry, HostResult } from "../registry.js"
import type { ExtendedSessionHost } from "../session-host.js"
import { registerHistoryRoute } from "./history.js"

// ── mock helpers (עותק מ-state.test.ts — ר' הערת-הראש) ───────────────────────

function makeMockState(overrides: Partial<SessionState> = {}): SessionState {
  return { ...createInitialSessionState({ sessionId: null }), ...overrides }
}

function makeMockHost(state: SessionState): ExtendedSessionHost {
  return {
    state,
    patches: new ReadableStream({ start() {} }),
    prompt: vi.fn().mockResolvedValue(undefined),
    newSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
    loadSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
    cancel: vi.fn().mockResolvedValue(undefined),
    setMode: vi.fn().mockResolvedValue(undefined),
    setConfigOption: vi.fn().mockResolvedValue(undefined),
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    extMethod: vi.fn().mockResolvedValue({}),
    emitExtNotification: vi.fn(),
    respondPermission: vi.fn(),
    respondElicitation: vi.fn(),
    isScopeRequest: () => false,
    requestScopePermission: vi.fn().mockResolvedValue("deny"),
    listSessions: vi.fn().mockResolvedValue({}),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    agentCapabilities: {},
    getTurnStartedAt: () => 0,
    getStallReported: () => false,
    markStallReported: () => {},
  }
}

function makeMockRegistry(host?: ExtendedSessionHost): AgentSessionRegistry {
  const result: HostResult = host
    ? {
        ok: true,
        entry: { host, broadcaster: {
          subscribe: vi.fn(),
          unsubscribe: vi.fn(),
          close: vi.fn(),
          // slice history-cursor C2: חבר חדש בחוזה PatchesBroadcaster.
          oldestBufferedVersion: vi.fn().mockReturnValue(undefined),
        } },
      }
    : { ok: false, reason: "not-found" }
  return {
    getHost: vi.fn().mockReturnValue(host),
    isHeld: vi.fn().mockReturnValue(Boolean(host)),
    // 🔴 מרגל, לא מילוי — ר' הערת-הראש: בלעדיו האסרציה מאדימה כ-TypeError,
    // ולא "עוברת בשקט" כפי שהבריף הניח.
    getOrCreateHost: vi.fn().mockResolvedValue(result),
    getCwd: vi.fn(),
    getCliKind: vi.fn(),
    getEpoch: vi.fn().mockReturnValue(0),
    touchConnection: vi.fn(),
    getRuntimeInfo: vi.fn().mockReturnValue(null),
    getConnectionCount: vi.fn().mockReturnValue(0),
    stop: vi.fn(),
    getBroadcaster: vi.fn().mockReturnValue(undefined),
    unregisterHost: vi.fn(),
    notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  }
}

function makeApp(registry: AgentSessionRegistry): Hono {
  const app = new Hono()
  registerHistoryRoute(app, registry)
  return app
}

// ── fixtures ──────────────────────────────────────────────────────────────────

type HistoryBody = {
  sessionId: string | null
  version: number
  epoch?: number
  updates: WireSessionUpdate[]
}

function stateWithMessage(overrides: Partial<SessionState> = {}): SessionState {
  return makeMockState({
    sessionId: "sess-1",
    version: 12,
    messages: [
      {
        id: "m_0",
        role: "assistant",
        messageId: "msg-a",
        segments: [{ id: "s_0", text: "שלום" }],
      },
    ],
    nextMessageSeq: 1,
    nextSegmentSeq: 1,
    ...overrides,
  })
}

async function getHistory(state: SessionState): Promise<{ res: Response; body: HistoryBody }> {
  const registry = makeMockRegistry(makeMockHost(state))
  const res = await makeApp(registry).request("/api/agents/agent-1/history")
  return { res, body: (await res.json()) as HistoryBody }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/agents/:id/history", () => {
  describe("404 כשאין host חי", () => {
    it("‏מחזיר 404 ואת אותו גוף כמו /state כש-getHost מחזיר undefined", async () => {
      const registry = makeMockRegistry()
      const res = await makeApp(registry).request("/api/agents/missing/history")

      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: "Agent connection not found" })
    })
  })

  describe("200 — המטען", () => {
    it("‏מחזיר sessionId · version · updates כמערך", async () => {
      const { res, body } = await getHistory(stateWithMessage())

      expect(res.status).toBe(200)
      expect(body.sessionId).toBe("sess-1")
      expect(body.version).toBe(12)
      expect(Array.isArray(body.updates)).toBe(true)
    })

    it("‏הודעה ב-state יוצאת כ-agent_message עם אותו messageId", async () => {
      const { body } = await getHistory(stateWithMessage())

      const msg = body.updates.find((u) => u.sessionUpdate === "agent_message")
      expect(msg).toBeDefined()
      expect(msg?.messageId).toBe("msg-a")
    })

    it("‏חותמת-הזמן של סלייס A נוסעת עם ההודעה", async () => {
      const state = stateWithMessage({
        messages: [
          {
            id: "m_0",
            role: "assistant",
            messageId: "msg-a",
            segments: [{ id: "s_0", text: "שלום" }],
            timestamp: "2026-09-22T10:00:00.000Z",
          },
        ],
      })
      const { body } = await getHistory(state)

      const msg = body.updates.find((u) => u.sessionUpdate === "agent_message") as
        | { _meta?: Record<string, unknown> }
        | undefined
      expect(msg?._meta?.["_drive/timestamp"]).toBe("2026-09-22T10:00:00.000Z")
    })

    it("‏`carried` של סלייס A מגיע גם ב-pull — הוכחת ה-carry", async () => {
      const state = recordCarried(stateWithMessage(), {
        sessionUpdate: "plan",
        entries: [{ content: "צעד", priority: "high", status: "pending" }],
      })
      const { body } = await getHistory(state)

      expect(body.updates.map((u) => u.sessionUpdate)).toContain("plan")
    })

    it("‏אין `epoch` בתשובה — משיכה אינה בעלות על הזרם", async () => {
      const { body } = await getHistory(stateWithMessage())
      expect("epoch" in body).toBe(false)
    })

    it("‏content-type הוא application/json", async () => {
      const { res } = await getHistory(stateWithMessage())
      expect(res.headers.get("content-type")).toContain("application/json")
    })
  })

  describe("משיכת-קריאה אינה יוצרת host", () => {
    it("‏קורא ל-getHost עם ה-agentId מה-URL", async () => {
      const registry = makeMockRegistry(makeMockHost(stateWithMessage()))
      await makeApp(registry).request("/api/agents/my-agent/history")

      expect(registry.getHost).toHaveBeenCalledWith("my-agent")
    })

    it("‏**אינו** קורא ל-getOrCreateHost — לא יוצר host, לא מפנה בעלים, לא נוגע ב-epoch", async () => {
      const registry = makeMockRegistry(makeMockHost(stateWithMessage()))
      await makeApp(registry).request("/api/agents/agent-1/history")

      expect(registry.getOrCreateHost).not.toHaveBeenCalled()
    })

    it("‏גם במסלול ה-404 אינו קורא ל-getOrCreateHost", async () => {
      const registry = makeMockRegistry()
      await makeApp(registry).request("/api/agents/missing/history")

      expect(registry.getOrCreateHost).not.toHaveBeenCalled()
    })
  })
})

// ── C2: גלאי-סטייה מול frame-zero ────────────────────────────────────────────

describe("‏C2 — ‏GET history מול frame-zero: גלאי-סטייה", () => {
  /**
   * 🔴 **גלאי-סטייה, לא גלאי-העתק.** שני האגפים קוראים ל-`stateToSessionUpdates`,
   * ולכן ההשוואה יוצאת ירוקה בין אם יש מקור אחד ובין אם שניים — ההעתק **אינו**
   * נתפס כאן ברגע שנוצר, וכלל מקור-אחד נאכף ב-review. מה שכן נתפס הוא הרגע
   * שבו אחד המימושים משתנה והשני לא. לכן השורה השנייה משווה את ה**מטען השלם**
   * ולא רק את `.updates`: שדה חדש שלא יגיע לצד השני מאדים מיד.
   */
  function richState(): SessionState {
    return recordCarried(
      stateWithMessage({
        title: "סטייה",
        messages: [
          {
            id: "m_0",
            role: "user",
            messageId: "msg-u",
            segments: [{ id: "s_0", text: "שאלה" }],
            timestamp: "2026-09-22T09:59:00.000Z",
          },
          {
            id: "m_1",
            role: "assistant",
            messageId: "msg-a",
            segments: [{ id: "s_1", text: "תשובה" }],
            timestamp: "2026-09-22T10:00:00.000Z",
          },
        ],
        nextMessageSeq: 2,
        nextSegmentSeq: 2,
      }),
      {
        sessionUpdate: "plan",
        entries: [{ content: "צעד", priority: "high", status: "pending" }],
      },
    )
  }

  it("‏אותו state — רצף ה-updates של ה-GET זהה לזה של frame-zero", async () => {
    const state = richState()
    const { body } = await getHistory(state)

    const frameUpdates = (JSON.parse(snapshotFrame(state, 0).data) as HistoryBody).updates
    expect(body.updates).toEqual(frameUpdates)
  })

  it("‏המטען השלם: frame-zero ≡ snapshotPayload + epoch — כל שדה, לא רק updates", () => {
    const state = richState()

    expect(JSON.parse(snapshotFrame(state, 7).data)).toEqual({
      ...snapshotPayload(state),
      epoch: 7,
    })
  })
})

// ─── slice history-cursor C1: ‏?fromMessage= ─────────────────────────────────

describe("‏C1 — ‏GET history?fromMessage= : חיתוך מהודעה ואילך", () => {
  /** שיחה של שלוש הודעות + `carried` שעוגן על הראשונה. */
  function convo(): SessionState {
    return makeMockState({
      sessionId: "sess-1",
      version: 12,
      title: "כותרת",
      messages: [
        { id: "m_0", role: "user", messageId: "u-0", segments: [{ id: "s_0", text: "אחת" }] },
        { id: "m_1", role: "assistant", messageId: "a-1", segments: [{ id: "s_1", text: "שתיים" }] },
        { id: "m_2", role: "user", messageId: "u-2", segments: [{ id: "s_2", text: "שלוש" }] },
      ],
      nextMessageSeq: 3,
      nextSegmentSeq: 3,
      carried: [{ key: "plan", after: "m_0", update: { sessionUpdate: "plan", id: "at-m0" } }],
    })
  }

  async function get(query: string): Promise<{ res: Response; body: HistoryBody }> {
    const registry = makeMockRegistry(makeMockHost(convo()))
    const res = await makeApp(registry).request(`/api/agents/agent-1/history${query}`)
    return { res, body: (await res.json()) as HistoryBody }
  }

  const msgIds = (u: WireSessionUpdate[]): unknown[] =>
    u.filter((x) => x.sessionUpdate.endsWith("_message")).map((x) => x.messageId)

  it("‏200 — רק ההודעות מ-`fromMessage` ואילך", async () => {
    const { res, body } = await get("?fromMessage=m_1")

    expect(res.status).toBe(200)
    expect(msgIds(body.updates)).toEqual(["a-1", "u-2"])
  })

  it("‏200 — לפי ה-messageId של ACP, אותה תוצאה", async () => {
    const { body } = await get("?fromMessage=a-1")
    expect(msgIds(body.updates)).toEqual(["a-1", "u-2"])
  })

  it("‏ה-`carried` שעוגנו נחתך אינו בפלט, ובלוק המטא-מידע כן", async () => {
    const { body } = await get("?fromMessage=m_1")

    const kinds = body.updates.map((u) => u.sessionUpdate)
    expect(kinds).not.toContain("plan")
    expect(kinds).toContain("session_info_update")
  })

  it("‏`version` ו-`sessionId` נשארים של ה-state, לא של החיתוך", async () => {
    const { body } = await get("?fromMessage=m_2")

    expect(body.version).toBe(12)
    expect(body.sessionId).toBe("sess-1")
    expect("epoch" in body).toBe(false)
  })

  it("🔴 ‏400 על מזהה לא-מוכר — גוף מדויק, לא היסטוריה מלאה בשקט (§4.2)", async () => {
    const { res, body } = await get("?fromMessage=m_999")

    expect(res.status).toBe(400)
    expect(body).toEqual({ error: "unknown fromMessage", fromMessage: "m_999" })
  })

  it("‏בלי הפרמטר — בדיוק המטען של סלייס B", async () => {
    const { res, body } = await get("")

    expect(res.status).toBe(200)
    expect(body).toEqual(snapshotPayload(convo()))
  })

  it("‏`fromMessage` ריק — מתעלמים, כמו בלי הפרמטר (§4.2)", async () => {
    const { res, body } = await get("?fromMessage=")

    expect(res.status).toBe(200)
    expect(body).toEqual(snapshotPayload(convo()))
  })

  it("‏404 קודם ל-400 — אין host, גם עם fromMessage שגוי", async () => {
    const registry = makeMockRegistry()
    const res = await makeApp(registry).request("/api/agents/missing/history?fromMessage=m_999")

    expect(res.status).toBe(404)
  })
})
