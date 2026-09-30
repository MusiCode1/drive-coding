/**
 * agent-session.reconnect-recovery.test.svelte.ts — TDD (slice reconnect-recovery, Commit 0).
 *
 * מכסה את §4 Commit 0 של הבריף: `loadSession(input, { preserveContextOnError })` +
 * `#cleanup({ keepContext })` + reset `#errorSurfaced` ב-`#warmReconnect`.
 *
 * הבעיה שהתיקון פותר: כשל cold-reconnect (loadSession שנקרא מ-#coldReconnect) היה
 * מריץ `#cleanup()` מלא — מוחק `#sessionId`/`agentId` — כך ש-`reconnect()` הציבורי
 * (guard :1271) עושה early-return לנצח (dead-end). התיקון: `#coldReconnect` מעביר
 * `{ preserveContextOnError: true }`; נתיב-השימור ב-loadSession קורא ל-`#cleanup({keepContext:true})`
 * (כל ה-teardown הקנוני, בלי לאבד את הקשר-הסשן) ומדליק `#errorSurfaced=true` (guard 601 —
 * מגן על ה-async WS-close שרץ אחרי ש-#tearingDown כבר חזר ל-false).
 *
 * דפוס מוקים: agent-session.permission.test.svelte.ts (createAcpClient) +
 * agent-session.reconnect-bubble-merge.test.svelte.ts (WsAcpTransport, createAttachedAcpClient).
 *
 * Tests (§4 Commit 0):
 *   1. preserve: loadSession נכשל (createAcpClient.loadSession דוחה) → #sessionId/cwd/#cliKind
 *      נשמרים, status="disconnected" → reconnect() לא early-return (מגיע ל-#doReconnect).
 *   2. teardown מלא בנתיב-השימור: pending permission/elicitation נפתרו (cancelled),
 *      #sessionId+agentId נשמרים, deleteAgent של #cleanup לא נקרא.
 *   3. regression #cleanup: קריאה ללא keepContext (detach) → מאפסת sessionId/agentId וקוראת deleteAgent.
 *   4. regression loadSession: טעינה-ראשונית שנכשלת (בלי opts) → #cleanup() מלא + status="error"
 *      + #errorSurfaced=true (כמו היום) — כולל deleteAgent (agentId כבר הוקצה).
 *   5. #errorSurfaced guard (התנהגותי, כמו error-surface.test.svelte.ts): preserve שנכשל →
 *      onClose לא-צפוי לא דורס את השגיאה (anti-clobber guard 601 פעיל).
 *   6. reset ב-warm: אחרי #warmReconnect מוצלח → #errorSurfaced===false (guard 601 לא חוסם
 *      auto-reconnect עתידי) — מוכח דרך אותה טכניקת anti-clobber-probe.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn(),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
  getAgent: vi.fn().mockRejectedValue(new Error("not relevant to these tests")),
}))

vi.mock("$lib/adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

const waitForOpenBehaviors = vi.hoisted(() => [] as Array<() => Promise<void>>)

vi.mock("@drive-coding/acp-wire/browser", () => ({
  // eslint-disable-next-line prefer-arrow-callback
  WsAcpTransport: vi.fn().mockImplementation(function MockTransport() {
    return {
      onClose: vi.fn(),
      waitForOpen: vi.fn(async () => {
        await waitForOpenBehaviors.shift()?.()
      }),
      close: vi.fn(),
      closeAndWait: vi.fn().mockResolvedValue(undefined),
      sendRaw: vi.fn(),
    }
  }),
}))

// client "cold" (loadSession רגיל — נקרא מ-createAcpClient) — loadSession מתוזמן פר-טסט
// client "warm" (attach reattach — נקרא מ-createAttachedAcpClient, סינכרוני)
// vi.hoisted: vi.mock מרים את הגוף שלו מעל imports — צריך למנוע ReferenceError (TDZ)
const { mockColdClient, mockAttachedClient } = vi.hoisted(() => ({
  mockColdClient: {
    loadSession: vi.fn(),
    close: vi.fn(),
    extMethod: vi.fn().mockResolvedValue({ ok: true }),
  },
  mockAttachedClient: {
    loadSession: vi.fn().mockResolvedValue({ sessionId: "sess-1" }),
    close: vi.fn(),
    extMethod: vi.fn().mockResolvedValue({ ok: true }),
  },
}))

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn().mockResolvedValue(mockColdClient),
    createAttachedAcpClient: vi.fn().mockImplementation(() => mockAttachedClient),
  }
})

vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })
vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("test-uuid") })

import { createAgent, deleteAgent, getAgent, listAgents } from "$lib/adapters/agents-api"
import { AgentSession } from "./agent-session.svelte"

beforeEach(() => {
  vi.clearAllMocks()
  waitForOpenBehaviors.length = 0
  vi.mocked(createAgent).mockResolvedValue({ agentId: "agent-1", status: "running" })
  vi.mocked(deleteAgent).mockResolvedValue(undefined)
  // getAgent נקרא מ-#handleUnexpectedClose דרך `.catch(() => null)` — לא נדרש כאן, ה-reject
  // ממופה ל-null ע"י ה-catch (getAgent עצמו אף פעם לא resolve-ל-null בטיפוס האמיתי שלו).
  vi.mocked(getAgent).mockRejectedValue(new Error("not relevant to these tests"))
  mockColdClient.loadSession.mockReset()
  mockAttachedClient.loadSession.mockReset().mockResolvedValue({ sessionId: "sess-1" })
  // pageHidden=true (כמו agent-session.error-surface.test.svelte.ts) — עוקף את
  // ענף #scheduleReconnect/#runReconnectLoop (backoff אמיתי) בטסטים 4/5/6 שקוראים
  // ל-_handleUnexpectedCloseForTest; אנחנו בודקים רק את שכבת ה-anti-clobber/state,
  // לא את לולאת ה-backoff.
  vi.stubGlobal("document", { hidden: true, addEventListener: vi.fn() })
})

describe("AgentSession — preserveContextOnError (slice reconnect-recovery, Commit 0)", () => {
  test("1. preserve: loadSession נכשל → #sessionId/cwd/#cliKind נשמרים, status=disconnected, reconnect() לא early-return", async () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setSessionContextForTest({
      sessionId: "sess-existing",
      cwd: "/tmp/project",
      cliKind: "opencode",
    })

    mockColdClient.loadSession.mockRejectedValueOnce(new Error("Failed to fetch"))

    await session.loadSession(
      { sessionId: "sess-existing", cwd: "/tmp/project", cliKind: "opencode" },
      { preserveContextOnError: true },
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._getSessionIdForTest()).toBe("sess-existing")
    expect(session.cwd).toBe("/tmp/project")
    expect(session.cliKind).toBe("opencode")
    expect(session.status).toBe("disconnected")

    // The public reconnect reaches the connection owner after the failed cold load.
    vi.mocked(listAgents).mockResolvedValueOnce([])
    vi.mocked(createAgent).mockRejectedValueOnce(new Error("cold retry reached"))
    await session.reconnect()
    expect(createAgent).toHaveBeenCalledTimes(2)
  })

  test("2. teardown מלא בנתיב-השימור: pending permission/elicitation נפתרו, context נשמר, deleteAgent של #cleanup לא נקרא", async () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setSessionContextForTest({
      sessionId: "sess-existing",
      cwd: "/tmp/project",
      cliKind: "opencode",
    })
    session.agentId = "agent-old"

    const permissionResolve = vi.fn()
    session.pendingPermission = {
      params: {
        sessionId: "sess-existing",
        toolCall: { toolCallId: "t1", title: "Write" },
        options: [],
      },
      resolve: permissionResolve,
    }
    const elicitationResolve = vi.fn()
    session.pendingElicitation = {
      params: {
        sessionId: "sess-existing",
        mode: "form",
        message: "What is your name?",
        requestedSchema: { type: "object", properties: { name: { type: "string" } } },
      },
      resolve: elicitationResolve,
    }

    mockColdClient.loadSession.mockRejectedValueOnce(new Error("Failed to fetch"))

    await session.loadSession(
      { sessionId: "sess-existing", cwd: "/tmp/project", cliKind: "opencode" },
      { preserveContextOnError: true },
    )

    expect(session.pendingPermission).toBeNull()
    expect(permissionResolve).toHaveBeenCalledWith({ outcome: { outcome: "cancelled" } })
    expect(session.pendingElicitation).toBeNull()
    expect(elicitationResolve).toHaveBeenCalledWith({ action: "cancel" })

    // context נשמר — total-outage: agentId שמור → #coldReconnect:749 no-op (prevAgentId===agentId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._getSessionIdForTest()).toBe("sess-existing")
    expect(session.agentId).toBe("agent-old") // failed replay does not replace the preserved owner identity

    // deleteAgent של #cleanup עצמו לא נקרא (keepContext מדלג עליו)
    expect(deleteAgent).not.toHaveBeenCalled()
  })
})

describe("AgentSession — regressions (§4 Commit 0, DoD#5/#6)", () => {
  test("3. regression #cleanup ללא keepContext (detach): עדיין מאפסת sessionId/agentId וקוראת deleteAgent", async () => {
    const session = new AgentSession()
    mockColdClient.loadSession.mockResolvedValueOnce({ sessionId: "sess-a" })

    await session.loadSession({ sessionId: "sess-a", cwd: "/tmp", cliKind: "opencode" })
    expect(session.status).toBe("connected")
    expect(session.agentId).toBe("agent-1")

    session.detach() // detach() קורא ל-#cleanup() ללא opts (ללא שינוי מהיום)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._getSessionIdForTest()).toBeNull()
    expect(session.agentId).toBeNull()
    expect(deleteAgent).toHaveBeenCalledWith("agent-1")
  })

  test("4. regression loadSession: טעינה-ראשונית שנכשלת (בלי opts) → #cleanup() מלא + status=error + errorSurfaced (+ deleteAgent)", async () => {
    const session = new AgentSession()
    mockColdClient.loadSession.mockRejectedValueOnce(new Error("Failed to fetch"))

    await session.loadSession({ sessionId: "sess-initial", cwd: "/tmp", cliKind: "opencode" })

    expect(session.status).toBe("error")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._getSessionIdForTest()).toBeNull()
    expect(session.agentId).toBeNull()
    // agentId כבר הוקצה (createAgent הצליח) לפני שה-client.loadSession נכשל → #cleanup המלא מוחק אותו
    expect(deleteAgent).toHaveBeenCalledWith("agent-1")

    // #errorSurfaced===true (כמו היום): anti-clobber guard 601 שורד onClose לא-צפוי
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._handleUnexpectedCloseForTest(1006, "abnormal")
    expect(session.error).toContain("loadSession failed")
    expect(session.status).toBe("error") // anti-clobber מחזיר מוקדם — לא עובר ל-disconnected
  })

  test("5. #errorSurfaced guard (🔴 r3): preserve שנכשל → anti-clobber מגן על ה-async close", async () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setSessionContextForTest({
      sessionId: "sess-existing",
      cwd: "/tmp",
      cliKind: "opencode",
    })
    mockColdClient.loadSession.mockRejectedValueOnce(new Error("Failed to fetch"))

    await session.loadSession(
      { sessionId: "sess-existing", cwd: "/tmp", cliKind: "opencode" },
      { preserveContextOnError: true },
    )
    expect(session.status).toBe("disconnected")
    const preserveError = session.error

    // WS close אסינכרוני שמגיע *אחרי* ש-#coldReconnect כבר איפס #tearingDown=false —
    // guard 601 (#errorSurfaced, לא #tearingDown) חייב לחסום את זה.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._handleUnexpectedCloseForTest(1006, "abnormal")

    expect(session.error).toBe(preserveError) // לא נדרס
    expect(session.status).toBe("disconnected") // anti-clobber מחזיר מוקדם — לא scheduleReconnect
  })

  test("6. reset ב-#warmReconnect (🔴 r2): אחרי warm מוצלח → #errorSurfaced===false, guard 601 לא חוסם auto-reconnect עתידי", async () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setSessionContextForTest({
      sessionId: "sess-existing",
      cwd: "/tmp",
      cliKind: "opencode",
    })
    // מדמה כשל טרמינלי-קודם שהדליק את הדגל (למשל loadSession רגיל שנכשל בעבר)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setErrorSurfacedForTest(true)
    session.error = "old terminal error"

    vi.mocked(listAgents).mockResolvedValueOnce([
      { id: "agent-1", acpSessionId: "sess-existing", cwd: "/tmp", status: "ready" },
    ] as Awaited<ReturnType<typeof listAgents>>)
    await session.reconnect()

    expect(session.status).toBe("connected")

    // 🔴 סבב-תיקונים liveness — הטענה השתנתה, הכוונה לא.
    // קודם: ה-close הלא-צפוי היה **דורס** את השגיאה הישנה במחרוזת גולמית
    // ("WS closed (1006): dropped again"), וזו הייתה ההוכחה ש-anti-clobber לא חסם.
    // היום המחרוזת הגולמית ירדה מהמסך (הבאנר הוא בעל-הבית), ולכן ההוכחה היא
    // שהשגיאה הישנה **נעלמה** — warm מוצלח מנקה (#onReconnectSuccess), ו-close
    // חולף אחריו לא מחזיר אותה. לו #errorSurfaced נשאר true, "old terminal error"
    // היה שורד את שניהם.
    expect(session.error).toBeNull() // ניקוי אחרי warm מוצלח
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._handleUnexpectedCloseForTest(1006, "dropped again")
    expect(session.error).toBeNull() // ניתוק חולף — אין מחרוזת גולמית למשתמש
    expect(session.error).not.toBe("old terminal error")
  })
})

describe("AgentSession — cold reconnect through the Connection owner", () => {
  test("failed replay preserves the old agent and owner; manual retry deletes old only after success", async () => {
    const session = new AgentSession()
    session._setSessionContextForTest({
      sessionId: "sess-existing",
      cwd: "/tmp",
      cliKind: "opencode",
    })
    session.agentId = "agent-old"
    session.historyEpoch = 7
    const owner = session._getConnectionForTest()
    vi.mocked(createAgent)
      .mockResolvedValueOnce({ agentId: "agent-failed", status: "running" })
      .mockResolvedValueOnce({ agentId: "agent-good", status: "running" })
    mockColdClient.loadSession
      .mockRejectedValueOnce(new Error("replay failed"))
      .mockResolvedValueOnce({ sessionId: "sess-existing" })

    await session.reconnect()
    expect(session.status).toBe("disconnected")
    expect(session.agentId).toBe("agent-old")
    expect(session.historyEpoch).toBe(7)
    expect(session._getConnectionForTest()).toBe(owner)
    expect(deleteAgent).toHaveBeenCalledWith("agent-failed")
    expect(deleteAgent).not.toHaveBeenCalledWith("agent-old")

    await session.reconnect()
    expect(session.status).toBe("connected")
    expect(session.agentId).toBe("agent-good")
    expect(session._getConnectionForTest()).toBe(owner)
    expect(deleteAgent).toHaveBeenCalledWith("agent-old")
  })

  test("cold transport is adopted before waitForOpen settles", async () => {
    const session = new AgentSession()
    session._setSessionContextForTest({
      sessionId: "sess-existing",
      cwd: "/tmp",
      cliKind: "opencode",
    })
    const owner = session._getConnectionForTest()
    let releaseOpen!: () => void
    waitForOpenBehaviors.push(
      () =>
        new Promise<void>((resolve) => {
          releaseOpen = resolve
        }),
    )
    mockColdClient.loadSession.mockResolvedValueOnce({ sessionId: "sess-existing" })
    const pending = session.reconnect()
    await vi.waitFor(() => expect(releaseOpen).toBeTypeOf("function"))
    expect(owner).toBe(session._getConnectionForTest())
    expect((owner as import("$lib/session/ws-connection").WsConnection).transport).not.toBeNull()
    releaseOpen()
    await pending
    expect(session.status).toBe("connected")
  })

  test("detach during pending listAgents cancels the consumer without a later agent", async () => {
    const session = new AgentSession()
    session._setSessionContextForTest({
      sessionId: "sess-existing",
      cwd: "/tmp",
      cliKind: "opencode",
    })
    let releaseAgents!: (agents: Awaited<ReturnType<typeof listAgents>>) => void
    vi.mocked(listAgents).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseAgents = resolve
        }),
    )
    const pending = session.reconnect()
    await vi.waitFor(() => expect(listAgents).toHaveBeenCalledOnce())
    session.detach()
    releaseAgents([])
    await pending
    expect(createAgent).not.toHaveBeenCalled()
    expect(session.status).toBe("idle")
  })

  test("detach during cold waitForOpen closes the late WS and does not restore status", async () => {
    const session = new AgentSession()
    session._setSessionContextForTest({
      sessionId: "sess-existing",
      cwd: "/tmp",
      cliKind: "opencode",
    })
    let releaseOpen!: () => void
    waitForOpenBehaviors.push(
      () =>
        new Promise<void>((resolve) => {
          releaseOpen = resolve
        }),
    )
    const pending = session.reconnect()
    await vi.waitFor(() => expect(releaseOpen).toBeTypeOf("function"))
    session.detach()
    releaseOpen()
    await pending
    await vi.waitFor(() => expect(deleteAgent).toHaveBeenCalledWith("agent-1"))
    expect(session.status).toBe("idle")
    expect(session._getConnectionForTest()).toBeNull()
  })
})
