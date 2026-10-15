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

const { events, warmClient } = vi.hoisted(() => ({
  events: [] as string[],
  warmClient: {
    loadSession: vi.fn(),
    close: vi.fn(),
    extMethod: vi.fn().mockResolvedValue({ ok: true }),
  },
}))

// mock adapters שנדרשים ע"י AgentSession (נייבא מ-import עמוק)
vi.mock("../adapters/agents-api", () => ({
  createAgent: vi.fn(),
  deleteAgent: vi.fn(),
  notifySessionAttached: vi.fn(),
  listAgents: vi.fn(() => {
    events.push("listAgents")
    return Promise.resolve([])
  }),
  getAgent: vi.fn(),
}))

vi.mock("@drive-coding/acp-wire/browser", () => ({
  WsAcpTransport: class {
    constructor() {
      events.push("WsAcpTransport")
    }
    onClose = vi.fn()
    waitForOpen = vi.fn(async () => {})
    close = vi.fn()
    closeAndWait = vi.fn(async () => {})
  },
}))

vi.mock("@drive-coding/provider/client", async (importActual) => ({
  ...(await importActual<typeof import("@drive-coding/provider/client")>()),
  createAttachedAcpClient: vi.fn(() => warmClient),
}))

vi.mock("$lib/session/create-session-view", () => ({
  createRemoteView: vi.fn(),
}))

vi.mock("../adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

import { createInitialSessionState } from "@drive-coding/core/session"
import { createAttachedAcpClient } from "@drive-coding/provider/client"
import { createAgent, listAgents, notifySessionAttached } from "$lib/adapters/agents-api"
import { createRemoteView } from "$lib/session/create-session-view"
import { WsConnection } from "$lib/session/ws-connection"
import { AgentSession } from "./agent-session.svelte"

vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })
vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("test-uuid") })

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })
  vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("test-uuid") })
  vi.clearAllMocks()
  events.length = 0
  warmClient.loadSession.mockReset().mockResolvedValue({ sessionId: "sess-1" })
  vi.mocked(listAgents).mockImplementation(async () => {
    events.push("listAgents")
    return []
  })
  vi.mocked(createAgent).mockResolvedValue({ agentId: "new-agent", status: "running" })
  vi.mocked(notifySessionAttached).mockResolvedValue(undefined)
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

describe("AgentSession — Connection consumer", () => {
  test("attachToLiveAgent uses owner warm replay and clears old error", async () => {
    const session = new AgentSession()
    session.error = "previous error"
    await session.attachToLiveAgent({
      agentId: "agent-1",
      sessionId: "sess-1",
      cwd: "/repo",
      cliKind: "claude",
    })
    expect(session.status).toBe("connected")
    expect(session.error).toBeNull()
    expect(createAttachedAcpClient).toHaveBeenCalledOnce()
    expect(createAgent).not.toHaveBeenCalled()
  })

  test("attachToLiveAgent reports a failed warm replay without cold spawn", async () => {
    const session = new AgentSession()
    warmClient.loadSession.mockRejectedValueOnce(new Error("replay failed"))
    await session.attachToLiveAgent({
      agentId: "agent-1",
      sessionId: "sess-1",
      cwd: "/repo",
      cliKind: "claude",
    })
    expect(session.status).toBe("error")
    expect(session.error).toBeTruthy()
    expect(createAgent).not.toHaveBeenCalled()
  })

  test("attachToLiveAgent applies manual title before warm client creation", async () => {
    const session = new AgentSession()
    let capturedSession: string | null = null
    let capturedCwd: string | null = null
    vi.mocked(createAttachedAcpClient).mockImplementationOnce(() => {
      capturedSession = session._getSessionIdForTest()
      capturedCwd = session.cwd
      return warmClient as unknown as ReturnType<typeof createAttachedAcpClient>
    })
    await session.attachToLiveAgent({
      agentId: "agent-1",
      sessionId: "sess-1",
      cwd: "/repo",
      cliKind: "claude",
      title: "kept",
      titleManual: true,
    })
    expect(capturedSession).toBe("sess-1")
    expect(capturedCwd).toBe("/repo")
    expect(session.sessionTitle).toBe("kept")
    expect(session.titleManual).toBe(true)
  })

  test("attachToLiveAgent closes an owned WS before constructing the warm WS", async () => {
    const session = new AgentSession()
    session._setTransportForTest({
      closeAndWait: vi.fn(async () => {
        events.push("oldCloseDone")
      }),
    })
    await session.attachToLiveAgent({
      agentId: "agent-1",
      sessionId: "sess-1",
      cwd: "/repo",
      cliKind: "claude",
    })
    expect(events.indexOf("oldCloseDone")).toBeLessThan(events.indexOf("WsAcpTransport"))
  })

  test("public reconnect closes an owned WS before looking up agents", async () => {
    const session = new AgentSession()
    session._setSessionContextForTest({ sessionId: "sess-1", cwd: "/repo", cliKind: "claude" })
    session._setTransportForTest({
      closeAndWait: vi.fn(async () => {
        events.push("oldCloseDone")
      }),
    })
    vi.mocked(createAgent).mockRejectedValueOnce(new Error("offline"))
    await session.reconnect()
    expect(events.indexOf("oldCloseDone")).toBeLessThan(events.indexOf("listAgents"))
  })

  test("public reconnect with no owned WS still reaches the cold attempt", async () => {
    const session = new AgentSession()
    session._setSessionContextForTest({ sessionId: "sess-1", cwd: "/repo", cliKind: "claude" })
    vi.mocked(createAgent).mockRejectedValueOnce(new Error("offline"))
    await session.reconnect()
    expect(listAgents).toHaveBeenCalledOnce()
    expect(createAgent).toHaveBeenCalledOnce()
  })

  test("public reconnect with no session context does not open a WS or agent", async () => {
    const session = new AgentSession()
    await session.reconnect()
    expect(listAgents).not.toHaveBeenCalled()
    expect(createAgent).not.toHaveBeenCalled()
    expect(events).not.toContain("WsAcpTransport")
  })

  test("public reconnect selects a reusable agent and completes warm replay", async () => {
    const session = new AgentSession()
    session._setSessionContextForTest({ sessionId: "sess-1", cwd: "/repo", cliKind: "claude" })
    vi.mocked(listAgents).mockResolvedValueOnce([
      { id: "agent-1", acpSessionId: "sess-1", cwd: "/repo", status: "ready" },
    ] as Awaited<ReturnType<typeof listAgents>>)
    await session.reconnect()
    expect(session.status).toBe("connected")
    expect(session.agentId).toBe("agent-1")
    expect(createAttachedAcpClient).toHaveBeenCalledOnce()
    expect(createAgent).not.toHaveBeenCalled()
  })

  test("public reconnect invokes the Connection policy rather than a VM fallback", async () => {
    const session = new AgentSession()
    session._setSessionContextForTest({ sessionId: "sess-1", cwd: "/repo", cliKind: "claude" })
    const reconnect = vi
      .spyOn(WsConnection.prototype, "reconnect")
      .mockRejectedValueOnce(new Error("owner policy reached"))
    try {
      await expect(session.reconnect()).rejects.toThrow("owner policy reached")
      expect(reconnect).toHaveBeenCalledOnce()
      expect(listAgents).not.toHaveBeenCalled()
    } finally {
      reconnect.mockRestore()
    }
  })

  test("failed warm replay can be retried through the public consumer", async () => {
    const session = new AgentSession()
    session._setSessionContextForTest({ sessionId: "sess-1", cwd: "/repo", cliKind: "claude" })
    vi.mocked(listAgents).mockResolvedValue([
      { id: "agent-1", acpSessionId: "sess-1", cwd: "/repo", status: "ready" },
    ] as Awaited<ReturnType<typeof listAgents>>)
    warmClient.loadSession.mockRejectedValueOnce(new Error("offline"))
    vi.mocked(createAgent).mockRejectedValueOnce(new Error("offline"))
    await session.reconnect()
    expect(session.status).toBe("disconnected")
    await session.reconnect()
    expect(session.status).toBe("connected")
  })

  test("manual reconnect resets an existing attempt indicator", async () => {
    const session = new AgentSession()
    session._setSessionContextForTest({ sessionId: "sess-1", cwd: "/repo", cliKind: "claude" })
    session._setReconnectAttemptForTest(3)
    vi.mocked(createAgent).mockRejectedValueOnce(new Error("offline"))
    await session.reconnect()
    expect(session.reconnectAttempt).toBe(0)
  })

  test("an active HTTP session reconnects without constructing a WS", async () => {
    const session = new AgentSession()
    vi.mocked(createRemoteView).mockResolvedValueOnce({
      state: createInitialSessionState({ sessionId: "remote-1" }),
      patches: new ReadableStream({ start: (controller) => controller.close() }),
      close: vi.fn(async () => {}),
    } as unknown as Awaited<ReturnType<typeof createRemoteView>>)
    await session.attachRemoteToLiveAgent({
      agentId: "remote-agent",
      cwd: "/repo",
      cliKind: "claude",
    })
    expect(session.status).toBe("connected")
    await session.reconnect()
    expect(events).not.toContain("WsAcpTransport")
    expect(createAgent).not.toHaveBeenCalled()
  })
})
