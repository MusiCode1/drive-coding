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
  snapshotPayload,
} from "@drive-coding/core/session"
import { afterEach, describe, expect, it, vi } from "vitest"
import { fakeSessionSockets } from "./__contract__/fake-session-socket"
import { createRemoteView } from "./create-session-view.js"
import { RemoteSessionView } from "./remote-session-view.js"

const encoder = new TextEncoder()

describe("reply failure through RemoteSessionView", () => {
  const openingState = {
    ...createInitialSessionState({ sessionId: "sess-1" }),
    pending: { permission: { requestId: 7, params: {} as never }, elicitation: null },
  }
  const pendingSnapshot = snapshotFrame(openingState, undefined, "meta")
  const reply = { outcome: { outcome: "cancelled" } }
  const failure = { status: 500, body: { error: "reply failed" } }

  it("HTTP retains the error message and the configured connection ID", async () => {
    const fetchReply = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json(failure.body, { status: failure.status }),
    )
    const mockFetch = (url: string, init?: RequestInit) => {
      const path = new URL(url, "https://be.local").pathname
      if (path.endsWith("/events")) {
        return Promise.resolve(new Response(serializeFrame(pendingSnapshot)))
      }
      if (path.endsWith("/history")) {
        const body = snapshotPayload(openingState, undefined, { history: "omit" })
        return Promise.resolve(Response.json(body, { status: 200 }))
      }
      return fetchReply(url, init)
    }
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
    let historyFetches = 0
    const unexpectedFetch = vi.fn(async (_url: string) => {
      throw new Error("Unexpected HTTP request")
    })
    const connected = createRemoteView({
      transport: "ws",
      agentId: "agent-1",
      baseUrl: "https://be.local/",
      headers: { "Acp-Connection-Id": "tab / 1" },
      _WebSocket: sockets.WebSocket,
      _fetch: async (url) => {
        if (String(url).includes("/history")) {
          historyFetches++
          const body = snapshotPayload(openingState, undefined, { history: "omit" })
          return Response.json(body, { status: 200 })
        }
        return unexpectedFetch(url)
      },
    })
    void connected.catch(() => {})
    const socket = sockets.latest()
    const url = new URL(socket.url)
    expect(url.origin + url.pathname).toBe("wss://be.local/ws/session/agent-1")
    expect([...url.searchParams.entries()]).toEqual(
      expect.arrayContaining([
        ["connectionId", "tab / 1"],
        ["snapshot", "meta"],
      ]),
    )
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
    expect(historyFetches).toBe(1)
  })
})

function sseResponse(): Response {
  const snapshot = createInitialSessionState({ sessionId: "sess-1" })
  const frame = snapshotFrame(snapshot, undefined, "meta")
  const text = serializeFrame(frame)
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
      const path = new URL(url, "http://be.local").pathname
      if (path.endsWith("/history")) {
        const body = snapshotPayload(
          createInitialSessionState({ sessionId: "sess-1" }),
          undefined,
          { range: { tail: true, maxBytes: 262_144 } },
        )
        return Response.json(body, { status: 200 })
      }
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
    expect(calls.some((u) => u.includes("/events?snapshot=meta"))).toBe(true)
    expect(calls.some((u) => u.includes("/history"))).toBe(true)
    await view.close()
  })

  it("baseUrl אופציונלי -> נופל ל-beUrl('') (same-origin)", async () => {
    const calls: string[] = []
    const mockFetch = async (url: string): Promise<Response> => {
      calls.push(url)
      const path = new URL(url, "http://be.local").pathname
      if (path.endsWith("/history")) {
        const body = snapshotPayload(
          createInitialSessionState({ sessionId: "sess-1" }),
          undefined,
          { range: { tail: true, maxBytes: 262_144 } },
        )
        return Response.json(body, { status: 200 })
      }
      return sseResponse()
    }

    const view = await createRemoteView({
      agentId: "agent-2",
      _fetch: mockFetch,
      _sleep: () => Promise.resolve(),
    } as never)

    // beUrl("") ב-SSR/vitest (אין location) מחזיר את הנתיב כפי שהוא — ⇒ ה-URL
    // מתחיל ב-/api/agents/agent-2/events (בלי host קשיח).
    expect(calls.some((u) => u.includes("/api/agents/agent-2/events"))).toBe(true)
    await view.close()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("regression (C4 preview): baseUrl מפורש עם לוכסן-סוגר לא מייצר לוכסן כפול", async () => {
    const calls: string[] = []
    const mockFetch = async (url: string): Promise<Response> => {
      calls.push(url)
      const path = new URL(url, "http://be.local").pathname
      if (path.endsWith("/history")) {
        const body = snapshotPayload(
          createInitialSessionState({ sessionId: "sess-1" }),
          undefined,
          { range: { tail: true, maxBytes: 262_144 } },
        )
        return Response.json(body, { status: 200 })
      }
      return sseResponse()
    }

    const view = await createRemoteView({
      agentId: "agent-3",
      baseUrl: "http://be.local/",
      _fetch: mockFetch,
      _sleep: () => Promise.resolve(),
    } as never)

    const eventsUrl = calls.find((u) => u.includes("/events?snapshot=meta"))
    expect(eventsUrl).toBe("http://be.local/api/agents/agent-3/events?snapshot=meta")
    expect(eventsUrl).not.toContain("//api/agents")
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
      const path = new URL(url, "http://be.local").pathname
      if (path.endsWith("/history")) {
        const body = snapshotPayload(
          createInitialSessionState({ sessionId: "sess-1" }),
          undefined,
          { range: { tail: true, maxBytes: 262_144 } },
        )
        return Response.json(body, { status: 200 })
      }
      return sseResponse()
    }

    const view = await createRemoteView({
      agentId: "agent-4",
      _fetch: mockFetch,
      _sleep: () => Promise.resolve(),
    } as never)

    const eventsUrl = calls.find((u) => u.includes("/events?snapshot=meta"))
    expect(eventsUrl).toBe("https://preview.tuns.sh/api/agents/agent-4/events?snapshot=meta")
    expect(eventsUrl).not.toContain("//api/agents")
    await view.close()
  })
})
