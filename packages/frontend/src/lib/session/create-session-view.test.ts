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

import { createInitialSessionState } from "@drive-coding/core/session"
import { describe, expect, it } from "vitest"
import { createRemoteView } from "./create-session-view.js"
import { RemoteSessionView } from "./remote-session-view.js"

const encoder = new TextEncoder()

function sseResponse(): Response {
  const snapshot = createInitialSessionState({ sessionId: "sess-1" })
  const text = `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`
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
})
