import {
  closeCodeForStatus,
  createInitialSessionState,
  encodeWsFrame,
  HISTORY_PAGE_BYTES_DEFAULT,
  reduce,
  type SessionState,
  type SseFrame,
  serializeFrame,
  snapshotFrame,
  snapshotPayload,
  updateFrame,
} from "@drive-coding/core/session"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeSessionSockets } from "./__contract__/fake-session-socket"
import { createRemoteView } from "./create-session-view"
import type { RemoteSessionView } from "./remote-session-view"
import type { SessionTransport } from "./session-transport"
import type { ViewEmission } from "./session-view"

const base = "http://host.test"
const session = (id = "first") => createInitialSessionState({ sessionId: id })
const fail = (status = 503) => new Response(null, { status })
const tail = (state: SessionState, maxBytes = HISTORY_PAGE_BYTES_DEFAULT) =>
  Response.json(snapshotPayload(state, undefined, { range: { tail: true, maxBytes } }))

function addMessage(seed: SessionState, text: string) {
  return reduce(seed, {
    sessionUpdate: "user_message",
    messageId: text,
    content: { type: "text", text },
  })
}

function updated(seed: SessionState, text: string) {
  const result = addMessage(seed, text)
  const patch = result.patches[0]
  if (!patch) throw new Error("missing message patch")
  const frame = updateFrame(result.state, patch, "meta")
  if (!frame) throw new Error("missing update frame")
  return { state: result.state, frame }
}

function resetFrame(state: SessionState) {
  const frame = updateFrame(
    state,
    {
      op: "reset",
      version: state.version,
      messages: [],
      nextMessageSeq: 0,
      nextSegmentSeq: 0,
    },
    "meta",
  )
  if (!frame) throw new Error("missing reset frame")
  return frame
}

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

function rig(transport: SessionTransport) {
  const sockets = fakeSessionSockets()
  let opening = snapshotFrame(session(), undefined, "meta")
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  let ended = false
  const encoder = new TextEncoder()
  const requests: Array<{ url: URL; signal?: AbortSignal }> = []
  let responses: Array<Response | Promise<Response>> = []
  const metadata = vi.fn(() => Response.json({ agent: { status: "crashed", crashReason: "gone" } }))
  const history = (...values: Array<Response | Promise<Response>>) => {
    responses = values
  }
  const feed = (frame: SseFrame) => {
    if (transport === "ws") sockets.latest().receive(encodeWsFrame(frame))
    else stream?.enqueue(encoder.encode(serializeFrame(frame)))
  }
  const openSocket = () => {
    if (transport !== "ws") return
    if (ended) sockets.latest().close(closeCodeForStatus(404))
    else {
      sockets.latest().connect()
      feed(opening)
    }
  }
  const connect = (state: SessionState, mode: "meta" | "full" = "meta") => {
    opening = snapshotFrame(state, undefined, mode)
    const connected = createRemoteView({
      agentId: "history-fixture",
      transport,
      baseUrl: base,
      _WebSocket: sockets.WebSocket,
      async _fetch(input, init) {
        const url = new URL(input, base)
        if (url.pathname.endsWith("/history")) {
          requests.push({ url, signal: init?.signal ?? undefined })
          return responses.shift() ?? fail()
        }
        if (url.pathname.endsWith("/events")) {
          if (ended) return fail(404)
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                stream = controller
                feed(opening)
              },
            }),
          )
        }
        return metadata()
      },
    })
    void connected.catch(() => {})
    openSocket()
    return connected
  }
  const disconnect = async () => {
    if (transport === "ws") sockets.latest().close(1006)
    else stream?.close()
    await tick(1000)
    openSocket()
    await tick()
  }
  return {
    connect,
    feed,
    history,
    metadata,
    requests,
    async reconnect(state: SessionState) {
      opening = snapshotFrame(state, undefined, "meta")
      await disconnect()
    },
    async end() {
      ended = true
      await disconnect()
    },
  }
}

function observe(view: RemoteSessionView) {
  const emissions: ViewEmission[] = []
  const reader = view.patches.getReader()
  void (async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      emissions.push(value)
    }
    reader.releaseLock()
  })()
  return emissions
}

describe.each(["http", "ws"] as const)("history transport contract — %s", (transport) => {
  let host: ReturnType<typeof rig>
  let view: RemoteSessionView | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    host = rig(transport)
  })
  afterEach(async () => {
    await view?.close()
    view = undefined
    vi.useRealTimers()
  })

  it("rejects after three opening GET failures, closes the reader and emits no terminal", async () => {
    host.history(fail(), fail(), fail())
    const connecting = host.connect(session())
    await tick(3000)
    await expect(connecting).rejects.toThrow("history tail fetch failed")
    expect(host.requests).toHaveLength(3)
    expect(host.metadata).not.toHaveBeenCalled()
    await tick(30_000)
    expect(host.requests).toHaveLength(3)
  })

  it("retries a pre-opening 404 that arrives after the opening frame", async () => {
    const first = Promise.withResolvers<Response>()
    const state = session()
    host.history(first.promise, tail(state))
    const connecting = host.connect(state)
    await tick()
    first.resolve(fail(404))
    view = await connecting
    expect(host.requests).toHaveLength(2)
  })

  it("treats a post-opening or reload 404 as final", async () => {
    host.history(fail(404), fail(404))
    const connecting = host.connect(session())
    await expect(connecting).rejects.toThrow("history tail fetch failed")
    expect(host.requests).toHaveLength(2)

    const state = session()
    host.history(tail(state))
    view = await host.connect(state)
    host.history(fail(404))
    host.feed(resetFrame({ ...state, version: 2 }))
    await tick(30_000)
    expect(host.requests).toHaveLength(4)
    expect(view.history.error).toContain("reload failed")
  })

  it("cancels a full load when the stream requests a reload", async () => {
    const full = Promise.withResolvers<Response>()
    const initial = session()
    host.history(tail(initial))
    view = await host.connect(initial)
    const newer = updated({ ...initial, version: 2 }, "replacement").state
    host.history(full.promise, tail(newer))
    const loading = view.history.loadFull()
    host.feed(resetFrame({ ...newer, version: 2 }))
    await tick()
    expect(host.requests[1]?.signal?.aborted).toBe(true)
    full.resolve(Response.json(snapshotPayload(initial)))
    await loading
    expect(view.state.messages).toEqual(newer.messages)
  })

  it("refetches when the first page has V < S", async () => {
    const initial = session()
    const latest = updated(initial, "latest").state
    host.history(tail(initial), tail(latest))
    view = await host.connect(latest)
    expect(host.requests).toHaveLength(2)
    expect(view.state.messages).toEqual(latest.messages)
  })

  it("aborts the unused history GET and folds the whole legacy snapshot", async () => {
    const initial = updated(session(), "legacy transcript").state
    const pending = Promise.withResolvers<Response>()
    host.history(pending.promise)
    const connecting = host.connect(initial, "full")
    let completed = false
    void connecting.then(() => {
      completed = true
    })
    await tick()
    try {
      expect(completed).toBe(true)
      view = await connecting
      expect(host.requests[0]?.signal?.aborted).toBe(true)
      expect(view.state.messages).toEqual(initial.messages)
      expect(view.history.window.hasMore).toBe(false)
    } finally {
      pending.resolve(fail())
      view ??= await connecting
    }
  })

  it("discards a queued batch from a replaced connection even above the new watermark", async () => {
    const full = Promise.withResolvers<Response>()
    const initial = { ...session(), version: 50 }
    const replacement = updated(session("replacement"), "correct").state
    host.history(tail(initial))
    view = await host.connect(initial)
    host.history(full.promise, tail(replacement))
    const loading = view.history.loadFull()
    host.feed(updated(initial, "stale batch").frame)
    await tick()
    await host.reconnect(replacement)
    full.resolve(Response.json(snapshotPayload(initial)))
    await loading
    expect(view.state.messages).toEqual(replacement.messages)
    expect(view.state.sessionId).toBe("replacement")
  })

  it("applies only the latest of two overlapping reload GETs", async () => {
    const one = Promise.withResolvers<Response>()
    const two = Promise.withResolvers<Response>()
    const initial = session()
    host.history(tail(initial))
    view = await host.connect(initial)
    host.history(one.promise, two.promise)
    host.feed(resetFrame({ ...initial, version: 1 }))
    await tick()
    host.feed(resetFrame({ ...initial, version: 2 }))
    await tick()
    expect(host.requests[1]?.signal?.aborted).toBe(true)
    const correct = updated({ ...initial, version: 2 }, "latest").state
    two.resolve(tail(correct))
    await tick()
    one.resolve(tail(updated({ ...initial, version: 1 }, "superseded").state))
    await tick()
    expect(view.state.messages).toEqual(correct.messages)
    expect(view.state.version).toBe(correct.version)
  })

  it("discards out-of-window updates, warns once and still emits activity", async () => {
    const old = updated(session(), "first").state
    const initial = updated(old, "tail").state
    host.history(tail(initial, 1))
    view = await host.connect(initial)
    const observable = observe(view)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const stale = updated({ ...session(), version: initial.version }, "outside")
      host.feed(stale.frame)
      host.feed(updated({ ...session(), version: stale.state.version }, "outside again").frame)
      await tick()
      expect(view.state.messages.map(({ id }) => id)).toEqual(["m_1"])
      expect(observable.filter(({ activity }) => activity)).toHaveLength(2)
      expect(
        warn.mock.calls.filter(([message]) => String(message).includes("outside-window")),
      ).toHaveLength(1)
    } finally {
      warn.mockRestore()
    }
  })

  it("exposes an error after five failed reloads, then retries without leaking the gate", async () => {
    const initial = session()
    host.history(tail(initial))
    view = await host.connect(initial)
    const next = updated({ ...initial, version: 1 }, "after retry")
    host.feed(resetFrame({ ...initial, version: 1 }))
    host.feed(next.frame)
    await tick(15_001)
    expect(host.requests).toHaveLength(6)
    expect(view.history.reloading).toBe(false)
    expect(view.history.error).toContain("reload failed")
    expect(view.state.messages).toHaveLength(0)
    host.history(tail({ ...initial, version: 1 }))
    await view.history.retry()
    expect(view.history.error).toBeNull()
    expect(view.state.messages).toEqual(next.state.messages)
  })

  it("handles a replacement connection before the initial history page arrives", async () => {
    const pending = Promise.withResolvers<Response>()
    const initial = session()
    const newer = updated(session("replacement"), "after reconnect").state
    host.history(pending.promise, tail(newer))
    const connecting = host.connect(initial)
    await tick()
    await host.reconnect(newer)
    pending.resolve(tail(initial))
    view = await connecting
    await tick()
    expect(view.state.messages).toEqual(newer.messages)
    expect(view.state.sessionId).toBe("replacement")
  })

  it("adopts the sessionId of the opening page when V >= S", async () => {
    const initial = { ...session("placeholder"), version: 1 }
    const adopted = { ...session("adopted"), version: 2 }
    host.history(tail(adopted))
    view = await host.connect(initial)
    expect(view.state.sessionId).toBe("adopted")
    expect(view.debugInfo().sessionId).toBe("adopted")
    expect(host.requests).toHaveLength(1)
  })

  it("ignores Load all while a reload is in progress", async () => {
    const initial = session()
    const pending = Promise.withResolvers<Response>()
    host.history(tail(initial))
    view = await host.connect(initial)
    const next = { ...initial, version: 1 }
    host.history(pending.promise)
    host.feed(resetFrame(next))
    await tick()
    expect(view.history.reloading).toBe(true)
    await view.history.loadFull()
    expect(host.requests).toHaveLength(2)
    pending.resolve(tail(next))
    await tick()
    expect(view.history.reloading).toBe(false)
  })

  it("enforces the tail URL and applies only batches strictly newer than V", async () => {
    const initial = session()
    const first = updated(initial, "from page")
    const next = updated(first.state, "after page")
    const pending = Promise.withResolvers<Response>()
    host.history(pending.promise)
    const connecting = host.connect(initial)
    host.feed(first.frame)
    host.feed(next.frame)
    pending.resolve(tail(first.state))
    view = await connecting
    await tick()
    const url = host.requests[0]?.url
    expect(url?.searchParams.get("tail")).toBe("1")
    expect(url?.searchParams.get("maxBytes")).toBe(String(HISTORY_PAGE_BYTES_DEFAULT))
    expect(view.state.messages).toEqual(next.state.messages)
  })

  it("does not reload on a reset frame from a legacy connection", async () => {
    const state = session()
    host.history(tail(state))
    view = await host.connect(state, "full")
    host.feed(resetFrame({ ...state, version: 1 }))
    await tick()
    expect(host.requests).toHaveLength(1)
    expect(view.state.version).toBe(1)
  })

  it.each([true, false])(
    "handles stream termination across reload (success=%s)",
    async (success) => {
      const initial = session()
      const pending = Promise.withResolvers<Response>()
      host.history(tail(initial))
      view = await host.connect(initial)
      const emissions = observe(view)
      const version = 1
      const latest = updated({ ...initial, version }, "queued")
      host.history(pending.promise)
      host.feed(resetFrame({ ...initial, version }))
      host.feed(latest.frame)
      await tick()
      await host.end()
      expect(host.metadata).not.toHaveBeenCalled()
      pending.resolve(success ? tail({ ...initial, version }) : fail())
      await tick(success ? 0 : 15_001)
      expect(emissions.at(-1)).toMatchObject({ terminal: true, terminalError: "gone" })
      expect(host.metadata).toHaveBeenCalledOnce()
      expect(view.state.messages).toEqual(success ? latest.state.messages : [])
    },
  )

  it.each(["meta", "full"] as const)(
    "ends normally started %s streams exactly once",
    async (mode) => {
      const initial = session()
      host.history(tail(initial))
      view = await host.connect(initial, mode)
      const emissions = observe(view)
      await host.end()
      expect(emissions.filter(({ terminal }) => terminal)).toHaveLength(1)
      expect(host.metadata).toHaveBeenCalledOnce()
    },
  )

  it("emits terminal if the stream ends after entering the reload error state", async () => {
    const initial = session()
    host.history(tail(initial))
    view = await host.connect(initial)
    const emissions = observe(view)
    host.feed(resetFrame({ ...initial, version: 1 }))
    host.feed(updated({ ...initial, version: 1 }, "discarded").frame)
    await tick(15_001)
    expect(view.history.error).not.toBeNull()
    await host.end()
    expect(emissions.at(-1)).toMatchObject({ terminal: true })
    expect(view.state.messages).toEqual([])
  })

  it("closes cleanly while batches are queued behind a reload", async () => {
    const initial = session()
    const pending = Promise.withResolvers<Response>()
    host.history(tail(initial))
    view = await host.connect(initial)
    const emissions = observe(view)
    host.history(pending.promise)
    host.feed(resetFrame({ ...initial, version: 1 }))
    host.feed(updated({ ...initial, version: 1 }, "discarded").frame)
    await tick()
    await view.close()
    expect(host.requests[1]?.signal?.aborted).toBe(true)
    pending.resolve(tail({ ...initial, version: 1 }))
    await tick(15_001)
    expect(emissions.some(({ terminal }) => terminal)).toBe(false)
    expect(host.metadata).not.toHaveBeenCalled()
  })
})
