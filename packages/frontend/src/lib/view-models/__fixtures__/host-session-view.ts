import {
  createInitialSessionState,
  reduce,
  type SessionState,
  serializeFrame,
  snapshotFrame,
  snapshotPayload,
  updateFrame,
} from "@drive-coding/core/session"
import { createRemoteSessionView } from "$lib/session/create-session-view"

/** A fake host using the production reducer and SSE framing. */
export function hostSessionView(initial: Partial<SessionState> = {}) {
  let state = { ...createInitialSessionState({ sessionId: "test-session" }), ...initial }
  const encoder = new TextEncoder()
  const replies: unknown[] = []
  let output: ReadableStreamDefaultController<Uint8Array> | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      output = controller
      controller.enqueue(encoder.encode(serializeFrame(snapshotFrame(state, undefined, "meta"))))
    },
  })
  const view = createRemoteSessionView("test-agent", "http://be.local", {
    _fetch: async (url, init) => {
      const path = new URL(url, "http://be.local").pathname
      if (path.endsWith("/events")) {
        return new Response(stream, { headers: { "content-type": "text/event-stream" } })
      }
      if (path.endsWith("/history")) {
        const body = snapshotPayload(state, undefined, { range: { tail: true, maxBytes: 262_144 } })
        return Response.json(body, { status: 200 })
      }
      if (path.endsWith("/reply") && typeof init?.body === "string") {
        replies.push(JSON.parse(init.body))
        return Response.json({ ok: true })
      }
      throw new Error(`Unexpected test host request: ${url}`)
    },
  })

  function send(update: unknown): number {
    const result = reduce(state, update)
    state = result.state
    let emitted = 0
    for (const patch of result.patches) {
      const frame = updateFrame(state, patch)
      if (frame) {
        output?.enqueue(encoder.encode(serializeFrame(frame)))
        emitted++
      }
    }
    return emitted
  }

  // Drain the in-memory SSE stream and the view's patch stream before asserting.
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  return { view, send, settle, replies }
}
