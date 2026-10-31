import {
  createInitialSessionState,
  type SessionState,
  snapshotPayload,
} from "@drive-coding/core/session"
import { afterEach, expect, it, vi } from "vitest"
import { RemoteSessionView } from "./remote-session-view"
import { createProjectionRecorder } from "./session-view-delivery"

const views: RemoteSessionView[] = []
afterEach(async () => {
  for (const view of views.splice(0)) await view.close()
})
const snapshot = (hostIncarnation: string, version: number, extra: Partial<SessionState> = {}) => ({
  ...createInitialSessionState({ sessionId: "same-sid" }),
  hostIncarnation,
  version,
  ...extra,
})
function stream(state: ReturnType<typeof snapshot>, keepOpen = false) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `event: snapshot\ndata: ${JSON.stringify({ ...snapshotPayload(state), hostIncarnation: state.hostIncarnation })}\n\n`,
          ),
        )
        if (!keepOpen) controller.close()
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  )
}
it("F1: same sid admits the recreated host's lower version and live permission", async () => {
  let calls = 0
  const view = new RemoteSessionView("agent", "http://be.local", {
    projection: createProjectionRecorder(() => {}),
    _sleep: async () => {},
    _fetch: async (url) =>
      !url.endsWith("/events")
        ? Response.json({ ok: true })
        : ++calls === 1
          ? stream(snapshot("host-A", 43))
          : stream(
              snapshot("host-B", 13, {
                title: "restored",
                pending: {
                  permission: { requestId: 7, params: {} as never },
                  elicitation: null,
                },
              }),
              true,
            ),
  })
  views.push(view)
  await view.connect()
  await vi.waitFor(() => expect(calls).toBe(2))
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(view.state.version).toBe(13)
  expect(view.state.title).toBe("restored")
  expect(view.state.pending.permission?.requestId).toBe(7)
})
it("F2: reconnect 404 ends canonical turn/pending and keeps transcript without replying", async () => {
  let calls = 0
  const writes: string[] = []
  const initial = snapshot("host-A", 12, {
    status: "connected",
    turnState: "responding",
    pending: { permission: { requestId: 7, params: {} as never }, elicitation: null },
    messages: [
      { id: "m_0", role: "assistant", messageId: "p", segments: [{ id: "s_0", text: "retained" }] },
    ],
  })
  const view = new RemoteSessionView("agent", "http://be.local", {
    projection: createProjectionRecorder(() => {}),
    _sleep: async () => {},
    _fetch: async (url) => {
      if (!url.endsWith("/events")) {
        writes.push(url)
        return Response.json({ ok: true })
      }
      return ++calls === 1 ? stream(initial) : new Response(null, { status: 404 })
    },
  })
  views.push(view)
  await view.connect()
  await vi.waitFor(() => expect(calls).toBe(2))
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(view.state.turnState).toBe("idle")
  expect(view.state.pending.permission).toBeNull()
  expect(view.state.messages).toEqual(initial.messages)
  expect(writes).toEqual([])
})

it("terminal immediately following snapshot closes the bound view and sends no reply", async () => {
  let writes = 0
  const ready = vi.fn(),
    terminal = vi.fn()
  const initial = snapshot("host-A", 12, {
    turnState: "responding",
    pending: { permission: { requestId: 7, params: {} as never }, elicitation: null },
  })
  const view = new RemoteSessionView("agent", "http://be.local", {
    onReady: (view) => {
      ready()
      view.bindProjection(createProjectionRecorder(() => {}))
      return true
    },
    onTerminal: terminal,
    _fetch: async (url) => {
      if (!url.endsWith("/events")) {
        writes++
        return Response.json({ ok: true })
      }
      const text = `event: snapshot\ndata: ${JSON.stringify({ ...snapshotPayload(initial), hostIncarnation: "host-A" })}\n\nevent: taken-over\ndata: {}\n\n`
      return new Response(text, { headers: { "Content-Type": "text/event-stream" } })
    },
  })
  views.push(view)
  await view.connect()
  await vi.waitFor(() => expect(terminal).toHaveBeenCalledTimes(1))
  expect(ready).toHaveBeenCalledTimes(1)
  expect(view.state.turnState).toBe("idle")
  expect(view.state.pending.permission).toBeNull()
  expect(view.hostIncarnation).toBeUndefined()
  await view.close()
  expect(writes).toBe(0)
})

it("sameSID 43 to 13 then live permission 17 is admitted exactly once", async () => {
  const { HttpStream, hostState } = await import("./__contract__/http-recovery-fixture")
  const a = new HttpStream(hostState(43)),
    b = new HttpStream(hostState(13), "host-B")
  let calls = 0,
    frames = 0
  const view = new RemoteSessionView("agent", "http://be.local", {
    projection: createProjectionRecorder(() => {
      frames++
    }),
    _sleep: async () => {},
    _fetch: async (url) =>
      !url.endsWith("/events")
        ? Response.json({ ok: true })
        : ++calls === 1
          ? a.response
          : b.response,
  })
  views.push(view)
  try {
    await view.connect()
    a.end()
    await vi.waitFor(() => expect(view.state.version).toBe(13))
    const update = {
      sessionUpdate: "_drive/session_update",
      changes: { pending: { permission: { requestId: 17, params: {} }, elicitation: null } },
    }
    b.update(17, update)
    await vi.waitFor(() => expect(view.state.pending.permission?.requestId).toBe(17))
    const committed = frames
    b.update(17, update)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(view.state.version).toBe(17)
    expect(frames).toBe(committed)
  } finally {
    a.end()
    b.end()
  }
})
