/**
 * create-session-view.test.ts — TDD עבור createRemoteView() (C2).
 *
 * Testing: tdd (brief §C2)
 *
 * createRemoteView עוטף createRemoteSessionView (חתימה לא-תואמת: baseUrl אופציונלי
 * כאן, פרמטר-מיקום נדרש שם) + await connect() — הקורא מקבל view מחובר.
 *
 * ─── slice view-switch C2 (TDD) ───
 */

import {
  createInitialSessionState,
  decodeWsClientMessage,
  encodeWsFrame,
  encodeWsServerResponse,
  serializeFrame,
  snapshotFrame,
} from "@drive-coding/core/session"
import { toWireText } from "@drive-coding/core/session/testing"
import { afterEach, describe, expect, it, vi } from "vitest"
import { fakeSessionSockets } from "./__contract__/fake-session-socket"
import { createRemoteView } from "./create-session-view.js"
import { RemoteSessionView } from "./remote-session-view.js"

const encoder = new TextEncoder()

describe("reply failure through RemoteSessionView", () => {
  const pendingSnapshot = snapshotFrame({
    ...createInitialSessionState({ sessionId: "sess-1" }),
    pending: { permission: { requestId: 7, params: {} as never }, elicitation: null },
  })
  const reply = { outcome: { outcome: "cancelled" } }
  const failure = { status: 500, body: { error: "reply failed" } }

  it("HTTP retains the error message and the configured connection ID", async () => {
    const fetchReply = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json(failure.body, { status: failure.status }),
    )
    const mockFetch = (url: string, init?: RequestInit) =>
      url.endsWith("/events")
        ? Promise.resolve(new Response(serializeFrame(pendingSnapshot)))
        : fetchReply(url, init)
    const view = await createRemoteView({
      agentId: "agent-1",
      baseUrl: "https://be.local",
      headers: { "Acp-Connection-Id": "tab / 1" },
      _fetch: mockFetch,
    })
    try {
      await expect(view.respond(7, reply)).rejects.toThrow(
        "RemoteSessionView: POST https://be.local/api/agents/agent-1/reply failed with status 500 (reply failed)",
      )
      expect(fetchReply).toHaveBeenCalledWith(
        expect.stringContaining("/reply"),
        expect.objectContaining({
          headers: expect.objectContaining({ "Acp-Connection-Id": "tab / 1" }),
        }),
      )
    } finally {
      await view.close()
    }
  })

  it("WS rejects the same reply and uses the HTTP connection ID in the query", async () => {
    const sockets = fakeSessionSockets()
    const unexpectedFetch = vi.fn(async () => {
      throw new Error("Unexpected HTTP request")
    })
    const connected = createRemoteView({
      transport: "ws",
      agentId: "agent-1",
      baseUrl: "https://be.local/",
      headers: { "Acp-Connection-Id": "tab / 1" },
      _WebSocket: sockets.WebSocket,
      _fetch: unexpectedFetch,
    })
    void connected.catch(() => {})
    const socket = sockets.latest()
    const url = new URL(socket.url)
    expect(url.origin + url.pathname).toBe("wss://be.local/ws/session/agent-1")
    expect([...url.searchParams]).toEqual([["connectionId", "tab / 1"]])
    const send = socket.send.bind(socket)
    vi.spyOn(socket, "send").mockImplementation((data) => {
      send(data)
      const message = decodeWsClientMessage(data)
      if (message?.kind === "request") {
        socket.receive(encodeWsServerResponse(message.request.id, failure))
      }
    })
    socket.connect()
    socket.receive(encodeWsFrame(pendingSnapshot))
    const view = await connected
    try {
      await expect(view.respond(7, reply)).rejects.toThrow(
        "RemoteSessionView: WS reply failed with status 500 (reply failed)",
      )
    } finally {
      await view.close()
    }
    expect(socket.readyState).toBe(3)
    expect(unexpectedFetch).not.toHaveBeenCalled()
  })
})

function sseResponse(): Response {
  const snapshot = createInitialSessionState({ sessionId: "sess-1" })
  const text = toWireText([{ event: "snapshot", data: JSON.stringify(snapshot) }])
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(encoder.encode(text))
      ctrl.close()
    },
  })
  return { ok: true, status: 200, body } as unknown as Response
}

describe("createRemoteView()", () => {
  it("בונה RemoteSessionView מחובר (connect() כבר רץ)", async () => {
    const calls: string[] = []
    const mockFetch = async (url: string): Promise<Response> => {
      calls.push(url)
      return sseResponse()
    }

    const view = await createRemoteView({
      agentId: "agent-1",
      baseUrl: "http://be.local",
      _fetch: mockFetch,
      _sleep: () => Promise.resolve(),
    } as never)

    expect(view).toBeInstanceOf(RemoteSessionView)
    expect(view.state.sessionId).toBe("sess-1")
    expect(calls[0]).toBe("http://be.local/api/agents/agent-1/events")
    await view.close()
  })

  it("baseUrl אופציונלי -> נופל ל-beUrl('') (same-origin)", async () => {
    const calls: string[] = []
    const mockFetch = async (url: string): Promise<Response> => {
      calls.push(url)
      return sseResponse()
    }

    const view = await createRemoteView({
      agentId: "agent-2",
      _fetch: mockFetch,
      _sleep: () => Promise.resolve(),
    } as never)

    // beUrl("") ב-SSR/vitest (אין location) מחזיר את הנתיב כפי שהוא — ⇒ ה-URL
    // מתחיל ב-/api/agents/agent-2/events (בלי host קשיח).
    expect(calls[0]).toContain("/api/agents/agent-2/events")
    await view.close()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("regression (C4 preview): baseUrl מפורש עם לוכסן-סוגר לא מייצר לוכסן כפול", async () => {
    const calls: string[] = []
    const mockFetch = async (url: string): Promise<Response> => {
      calls.push(url)
      return sseResponse()
    }

    const view = await createRemoteView({
      agentId: "agent-3",
      baseUrl: "http://be.local/",
      _fetch: mockFetch,
      _sleep: () => Promise.resolve(),
    } as never)

    expect(calls[0]).toBe("http://be.local/api/agents/agent-3/events")
    expect(calls[0]).not.toContain("//api/agents")
    await view.close()
  })

  it("regression (C4 preview): beUrl('') דרך location.origin אמיתי (עם לוכסן-סוגר) לא מייצר לוכסן כפול", async () => {
    // beUrl("") מחזיר `${location.origin}/` (path="" -> normalized="/") — בדיוק המקרה
    // שנתפס אמפירית ב-preview: RemoteSessionView#eventsUrl הוסיף /api/agents/... על
    // גבי baseUrl-עם-לוכסן-סוגר וייצר // (לוכסן כפול) שגרם לכשל-מהיר על sessionId===null.
    vi.stubGlobal("location", { origin: "https://preview.tuns.sh" })
    const calls: string[] = []
    const mockFetch = async (url: string): Promise<Response> => {
      calls.push(url)
      return sseResponse()
    }

    const view = await createRemoteView({
      agentId: "agent-4",
      _fetch: mockFetch,
      _sleep: () => Promise.resolve(),
    } as never)

    expect(calls[0]).toBe("https://preview.tuns.sh/api/agents/agent-4/events")
    expect(calls[0]).not.toContain("//api/agents")
    await view.close()
  })
})
