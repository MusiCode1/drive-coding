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
const beforePage = (state: SessionState, before: number, maxBytes = 1) =>
  Response.json(snapshotPayload(state, undefined, { range: { before, maxBytes } }))

function transcript(...messages: string[]) {
  return messages.reduce((state, text) => addMessage(state, text).state, session())
}

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

function toolUpdate(state: SessionState, status: "in_progress" | "completed") {
  const result = reduce(state, {
    sessionUpdate: state.messages.some(({ role }) => role === "tool")
      ? "tool_call_update"
      : "tool_call",
    toolCallId: "earlier-tool",
    title: "Earlier tool",
    status,
  })
  const patch = result.patches[0]
  if (!patch) throw new Error("missing tool patch")
  const frame = updateFrame(result.state, patch, "meta")
  if (!frame) throw new Error("missing tool frame")
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
    async reconnect(state: SessionState, mode: "meta" | "full" = "meta") {
      opening = snapshotFrame(state, undefined, mode)
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

  it("cancels an older load when the stream requests a reload", async () => {
    const older = Promise.withResolvers<Response>()
    const initial = transcript("earlier", "tail")
    host.history(tail(initial, 1))
    view = await host.connect(initial)
    const newer = updated({ ...session(), version: initial.version + 1 }, "replacement").state
    host.history(older.promise, tail(newer))
    const loading = view.history.loadOlder()
    await tick()
    host.feed(resetFrame({ ...newer, version: initial.version + 1 }))
    await tick()
    expect(host.requests[1]?.signal?.aborted).toBe(true)
    older.resolve(beforePage(initial, 1))
    await loading
    expect(view.state.messages).toEqual(newer.messages)
    expect(view.history.olderError).toBeNull()
  })

  it("refetches when the first page has V < S", async () => {
    const initial = session()
    const latest = updated(initial, "latest").state
    host.history(tail(initial), tail(latest))
    view = await host.connect(latest)
    expect(host.requests).toHaveLength(2)
    expect(view.state.messages).toEqual(latest.messages)
  })

  it("loads three successive pages and stops at the start", async () => {
    const state = transcript("one", "two", "three", "four")
    host.history(tail(state, 1), beforePage(state, 3), beforePage(state, 2), beforePage(state, 1))
    view = await host.connect(state)
    for (let page = 0; page < 4; page++) await view.history.loadOlder()
    expect(view.state.messages.map(({ id }) => id)).toEqual(["m_0", "m_1", "m_2", "m_3"])
    expect(host.requests.slice(1).map(({ url }) => url.searchParams.get("before"))).toEqual([
      "3",
      "2",
      "1",
    ])
    expect(host.requests[1]?.url.searchParams.get("maxBytes")).toBe(
      String(HISTORY_PAGE_BYTES_DEFAULT),
    )
    expect(view.history.window).toEqual({
      firstSeq: 0,
      lastSeq: 3,
      hasMore: false,
      watermark: state.version,
    })
  })

  it.each([1, 4])("retries a nonadjacent page once (before=%s)", async (before) => {
    const state = transcript("one", "two", "three", "four")
    const invalid = () => beforePage(updated(state, "five").state, before)
    host.history(tail(state, 1), invalid(), invalid())
    view = await host.connect(state)
    const previous = view.state
    const previousWindow = view.history.window
    await view.history.loadOlder()
    expect(host.requests).toHaveLength(3)
    expect(view.history.olderError).toBeTruthy()
    expect(view.state).toBe(previous)
    expect(view.history.window).toBe(previousWindow)
  })

  it("reports an unknown before and retries the same page without losing earlier pages", async () => {
    const state = transcript("one", "two", "three")
    const unknown = Response.json({ error: "unknown before" }, { status: 400 })
    host.history(tail(state, 1), beforePage(state, 2), unknown, beforePage(state, 1))
    view = await host.connect(state)
    await view.history.loadOlder()
    await view.history.loadOlder()
    expect(host.requests).toHaveLength(3)
    expect(view.history.olderError).toBeTruthy()
    expect(view.state.messages.map(({ id }) => id)).toEqual(["m_1", "m_2"])
    await view.history.loadOlder()
    expect(host.requests[3]?.url.searchParams.get("before")).toBe("1")
    expect(view.history.olderError).toBeNull()
    expect(view.state.messages.map(({ id }) => id)).toEqual(["m_0", "m_1", "m_2"])
  })

  it("shares the pending load between two callers", async () => {
    const state = transcript("one", "two")
    const pending = Promise.withResolvers<Response>()
    host.history(tail(state, 1), pending.promise)
    view = await host.connect(state)
    const first = view.history.loadOlder()
    expect(view.history.loadOlder()).toBe(first)
    await tick()
    expect(view.history.loadingOlder).toBe(true)
    expect(host.requests).toHaveLength(2)
    pending.resolve(beforePage(state, 1))
    await first
    expect(view.history.loadingOlder).toBe(false)
  })

  it("keeps V when the earlier page was produced at a later version", async () => {
    const state = transcript("one", "two")
    host.history(tail(state, 1), beforePage({ ...state, version: 10 }, 1))
    view = await host.connect(state)
    await view.history.loadOlder()
    expect(view.state.version).toBe(state.version)
    const live = updated(state, "three")
    host.feed(live.frame)
    await tick()
    expect(view.state.version).toBe(live.state.version)
    expect(view.state.messages.map(({ id }) => id)).toEqual(["m_0", "m_1", "m_2"])
  })

  it("applies a held tool update even after live activity advances V", async () => {
    const tool = toolUpdate(session(), "in_progress")
    const state = updated(tool.state, "tail").state
    const toolFinished = toolUpdate(state, "completed")
    const live = updated(toolFinished.state, "live")
    const pending = Promise.withResolvers<Response>()
    host.history(tail(state, 1), pending.promise)
    view = await host.connect(state)
    const emissions = observe(view)
    const loading = view.history.loadOlder()
    await tick()
    host.feed(toolFinished.frame)
    host.feed(live.frame)
    await tick()
    pending.resolve(beforePage(state, 1))
    await loading
    const earlier = view.state.messages[0]
    expect(earlier?.role === "tool" && earlier.toolCall.status).toBe("completed")
    expect(view.state.version).toBe(live.state.version)
    expect(emissions.filter(({ activity }) => activity)).toHaveLength(1)
    const pageEmissions = emissions.filter(({ history }) => history === "older")
    expect(pageEmissions).toHaveLength(1)
    expect(pageEmissions[0]?.updates).toEqual([])
  })

  it("drops a subsequently delivered tool update already included in the page", async () => {
    const tool = toolUpdate(session(), "in_progress")
    const state = updated(tool.state, "tail").state
    const page = { ...toolUpdate(state, "completed").state, version: state.version + 2 }
    const stale = toolUpdate({ ...tool.state, version: state.version }, "in_progress")
    host.history(tail(state, 1), beforePage(page, 1))
    view = await host.connect(state)
    await view.history.loadOlder()
    host.feed(stale.frame)
    await tick()
    const earlier = view.state.messages[0]
    expect(earlier?.role === "tool" && earlier.toolCall.status).toBe("completed")
  })

  it("retries once when the buffer of held updates fills", async () => {
    const state = transcript("earlier", "tail")
    const pending = [Promise.withResolvers<Response>(), Promise.withResolvers<Response>()]
    host.history(tail(state, 1), ...pending.map(({ promise }) => promise))
    view = await host.connect(state)
    const loading = view.history.loadOlder()
    for (let attempt = 0; attempt < pending.length; attempt++) {
      await tick()
      for (let i = 1; i <= 501; i++) {
        const version = view.state.version + i
        host.feed(updated({ ...session(), version }, "outside").frame)
      }
      await tick()
      pending[attempt]?.resolve(beforePage(state, 1))
    }
    await loading
    expect(host.requests).toHaveLength(3)
    expect(view.history.olderError).toBeTruthy()
    expect(view.state.messages.map(({ id }) => id)).toEqual(["m_1"])
  })

  it.each([false, true])("ends a waiting older load without a GET (close=%s)", async (close) => {
    const state = transcript("earlier", "tail")
    const pending = Promise.withResolvers<Response>()
    host.history(
      tail(state, 1),
      ...(close ? [pending.promise] : Array.from({ length: 5 }, () => fail())),
    )
    view = await host.connect(state)
    host.feed(resetFrame({ ...state, version: state.version + 1 }))
    await tick()
    const loading = view.history.loadOlder()
    if (close) {
      await view.close()
      pending.resolve(fail())
    } else {
      await tick(31_000)
    }
    await loading
    expect(view.history.olderError).toBeNull()
    expect(host.requests).toHaveLength(close ? 2 : 6)
    expect(host.requests.slice(1).every(({ url }) => url.searchParams.has("tail"))).toBe(true)
  })

  it.each([
    "preserve",
    "retry",
    "gap",
    "different identity",
    "unfinished tool",
    "active without user",
    "active prefix",
    "reset",
  ] as const)("handles loaded pages after reconnect (%s)", async (scenario) => {
    const tool =
      scenario === "unfinished tool" ? toolUpdate(session(), "in_progress").state : session()
    const old = ["earlier", "middle", "boundary"].reduce(
      (state, text) => addMessage(state, text).state,
      tool,
    )
    const active = scenario === "active without user" || scenario === "active prefix"
    const initial = {
      ...old,
      turnState: active ? ("responding" as const) : ("idle" as const),
      messages: old.messages.map((message, index) =>
        message.role !== "tool" && (scenario === "active without user" || (active && index !== 0))
          ? { ...message, role: "assistant" as const }
          : message,
      ),
    }
    const boundary = initial.messages.at(-1)
    if (!boundary || boundary.role === "tool") throw new Error("Missing transcript boundary")
    const boundarySeq = Number(boundary.id.slice(2))
    host.history(tail(initial, 1), beforePage(initial, boundarySeq, 4096))
    view = await host.connect(initial)
    await view.history.loadOlder()
    expect(view.state.messages).toHaveLength(initial.messages.length)
    const current = {
      ...initial,
      version: initial.version + 2,
      messages: initial.messages.with(-1, {
        ...boundary,
        messageId: scenario === "different identity" ? "replacement" : boundary.messageId,
        segments: [{ id: "s_0", text: "refreshed boundary" }],
      }),
    }
    const next = scenario === "gap" ? updated(current, "after a gap").state : current
    host.history(scenario === "retry" ? fail(404) : tail(next, 1))
    if (scenario === "reset") {
      host.feed(resetFrame(next))
      await tick()
    } else {
      await host.reconnect(next)
    }
    if (scenario === "retry") {
      expect(view.history.error).toBeTruthy()
      host.history(tail(next, 1))
      await view.history.retry()
    }
    const preserved = scenario === "preserve" || scenario === "retry"
    expect(view.state.messages.map(({ id }) => id)).toEqual(
      (preserved ? initial.messages : next.messages.slice(-1)).map(({ id }) => id),
    )
    expect(view.history.window.hasMore).toBe(!preserved)
    const last = view.state.messages.at(-1)
    if (preserved)
      expect(last?.role !== "tool" && last?.segments[0]?.text).toBe("refreshed boundary")
  })

  it("clears preservation input after a successful reload", async () => {
    const initial = transcript("earlier", "middle", "boundary")
    host.history(tail(initial, 1), beforePage(initial, 2, 4096))
    view = await host.connect(initial)
    await view.history.loadOlder()
    const next = { ...initial, version: initial.version + 1 }
    host.history(tail(next, 1))
    await host.reconnect(next)
    expect(view.state.messages).toHaveLength(3)
    host.history(tail(next, 1))
    await view.history.retry()
    expect(view.state.messages.map(({ id }) => id)).toEqual(["m_2"])
    expect(view.history.window.firstSeq).toBe(2)
  })

  it("uses the actual last live message as the overlap boundary", async () => {
    const initial = transcript("older", "middle", "initial tail")
    host.history(tail(initial, 1), beforePage(initial, 2, 4096))
    view = await host.connect(initial)
    await view.history.loadOlder()
    const live = updated(initial, "live after opening")
    host.feed(live.frame)
    await tick()
    expect(view.history.window.lastSeq).toBe(2)
    const next = { ...live.state, version: live.state.version + 1 }
    host.history(tail(next, 1))
    await host.reconnect(next)
    expect(view.state.messages.map(({ id }) => id)).toEqual(["m_0", "m_1", "m_2", "m_3"])
  })

  it("requests the earlier page after a legacy reconnect keeps the window", async () => {
    const state = transcript("earlier", "tail")
    host.history(tail(state, 1))
    view = await host.connect(state)
    await host.reconnect(state, "full")

    host.history(beforePage(state, 1))
    await view.history.loadOlder()

    expect(host.requests[1]?.url.searchParams.get("before")).toBe("1")
    expect(host.requests[1]?.signal?.aborted).toBe(false)
    expect(view.state.messages.map(({ id }) => id)).toEqual(["m_0", "m_1"])
  })

  it.each(["same version", "replaced", "during reload"] as const)(
    "handles a legacy reconnect (%s)",
    async (mode) => {
      const state = transcript("earlier", "tail")
      host.history(tail(state, 1))
      view = await host.connect(state)
      const emissions = observe(view)
      await tick()
      const waiting = Promise.withResolvers<Response>()
      if (mode === "during reload") {
        host.history(waiting.promise)
        host.feed(resetFrame({ ...state, version: state.version + 1 }))
        await tick()
        expect(view.history.reloading).toBe(true)
      }
      const stateEmissions = () => emissions.filter(({ historyState }) => historyState)
      const previous = stateEmissions().length
      const next = mode === "same version" ? state : { ...state, version: state.version + 2 }
      await host.reconnect(next, "full")
      waiting.resolve(tail(state))
      if (mode === "same version") {
        expect(view.history.window.firstSeq).toBe(1)
        expect(stateEmissions()).toHaveLength(previous)
        return
      }
      expect(view.history.window).toEqual({
        firstSeq: null,
        lastSeq: null,
        hasMore: false,
        watermark: next.version,
      })
      expect(stateEmissions()).toHaveLength(previous + 1)
      expect(stateEmissions().at(-1)?.historyState).toMatchObject({
        reloading: false,
        error: null,
        window: { hasMore: false },
      })
      await view.history.loadOlder()
      expect(host.requests).toHaveLength(mode === "during reload" ? 2 : 1)
      host.feed(updated(next, "live after legacy").frame)
      await tick()
      expect(view.state.messages).toHaveLength(3)
    },
  )

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
    const pending = Promise.withResolvers<Response>()
    const initial = { ...session(), version: 50 }
    const replacement = updated(session("replacement"), "correct").state
    host.history(tail(initial))
    view = await host.connect(initial)
    host.history(pending.promise, tail(replacement))
    const resetting = { ...initial, version: 51 }
    host.feed(resetFrame(resetting))
    await tick()
    host.feed(updated(resetting, "stale batch").frame)
    await tick()
    await host.reconnect(replacement)
    pending.resolve(tail(resetting))
    await tick()
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

  it.each([true, false])(
    "waits for reload and uses the resulting anchor (hasMore=%s)",
    async (hasMore) => {
      const initial = transcript("old", "tail")
      const pending = Promise.withResolvers<Response>()
      host.history(tail(initial, 1))
      view = await host.connect(initial)
      const next = updated(initial, "new tail").state
      host.history(pending.promise, beforePage(next, 2))
      host.feed(resetFrame({ ...next, version: initial.version + 1 }))
      await tick()
      expect(view.history.reloading).toBe(true)
      const loading = view.history.loadOlder()
      await tick()
      expect(host.requests).toHaveLength(2)
      pending.resolve(tail(next, hasMore ? 1 : HISTORY_PAGE_BYTES_DEFAULT))
      await loading
      expect(view.history.reloading).toBe(false)
      expect(view.history.olderError).toBeNull()
      expect(host.requests).toHaveLength(hasMore ? 3 : 2)
      if (hasMore) {
        expect(host.requests[2]?.url.searchParams.get("before")).toBe("2")
        expect(view.state.messages.map(({ id }) => id)).toEqual(["m_1", "m_2"])
      }
    },
  )

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
