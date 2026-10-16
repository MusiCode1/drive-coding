import { afterEach, expect, it, vi } from "vitest"
import { deferred, HttpStream, hostState, textUpdate } from "./__contract__/http-recovery-fixture"
import type { RemoteStreamEvent } from "./remote-stream-events"
import { SSEReader } from "./sse-reader"

const readers: SSEReader[] = []
afterEach(() => {
  for (const reader of readers.splice(0)) reader.close()
})
function make(fetch: (url: string, init?: RequestInit) => Promise<Response>) {
  const reader = new SSEReader("http://be.local/events", { _fetch: fetch, _sleep: async () => {} })
  readers.push(reader)
  return reader
}
async function all(stream: ReadableStream<RemoteStreamEvent>) {
  const out: RemoteStreamEvent[] = []
  const reader = stream.getReader()
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      out.push(item.value)
    }
  } finally {
    reader.releaseLock()
  }
  return out
}
it.each([undefined, "", 9])("rejects invalid opening identity %s", async (host) => {
  const stream = new HttpStream(hostState(), host)
  // Explicit undefined is the missing-field control, not the fixture default.
  if (host === undefined) {
    stream.end()
    const bad = new Response(
      'event: snapshot\ndata: {"sessionId":"same-sid","version":1,"updates":[]}\n\n',
    )
    await expect(make(async () => bad).connect()).rejects.toThrow("invalid snapshot")
    return
  }
  await expect(make(async () => stream.response).connect()).rejects.toThrow("invalid snapshot")
  stream.end()
})
it.each(["taken-over", "other", "malformed"])(
  "409 payload %s selects terminal or transient retry",
  async (kind) => {
    let calls = 0
    const first = new HttpStream(hostState())
    first.end()
    const reader = make(async () => {
      calls++
      if (calls === 1) return first.response
      if (calls === 2)
        return kind === "malformed"
          ? new Response("{", { status: 409 })
          : Response.json({ error: kind }, { status: 409 })
      return new Response(null, { status: 404 })
    })
    const { events } = await reader.connect()
    const out = await all(events)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      kind: "terminal",
      reason: kind === "taken-over" ? "taken-over" : "unavailable",
    })
    expect(calls).toBe(kind === "taken-over" ? 2 : 3)
  },
)
it("obsolete 409 JSON await cannot terminate a newer reader run", async () => {
  const json = deferred<unknown>()
  const first = new HttpStream(hostState())
  first.end()
  const next = new HttpStream(hostState(13), "host-B")
  let calls = 0
  const reader = make(async () => {
    if (++calls === 1) return first.response
    if (calls === 2) return { ok: false, status: 409, json: () => json.promise } as Response
    return next.response
  })
  await reader.connect()
  await vi.waitFor(() => expect(calls).toBe(2))
  reader.close()
  const current = await reader.connect()
  json.resolve({ error: "taken-over" })
  next.update(14, textUpdate("new-run"))
  const r = current.events.getReader()
  expect((await r.read()).value).toMatchObject({
    kind: "update",
    source: { hostIncarnation: "host-B" },
  })
  expect(reader.terminalFact).toBeUndefined()
  r.releaseLock()
  next.end()
})
it("queues old update, recreated snapshot, new update in wire order with distinct sources", async () => {
  const first = new HttpStream(hostState())
  first.update(44, textUpdate("old"))
  first.end()
  const second = new HttpStream(hostState(13), "host-B")
  second.update(17, textUpdate("new"))
  second.frame("taken-over", {})
  let calls = 0
  const reader = make(async () => (++calls === 1 ? first.response : second.response))
  const { initial, events } = await reader.connect()
  const out = await all(events)
  expect(out.map((event) => event.kind)).toEqual(["update", "snapshot", "update", "terminal"])
  expect(out[0]?.source).toBe(initial.source)
  expect(out[1]?.source).toBe(out[2]?.source)
  expect(out[1]?.source).not.toBe(initial.source)
  expect(reader.terminalFact).toBe(out[3])
  second.end()
})
it("invalid reconnect identity is protocol terminal, initial 404 is setup rejection", async () => {
  const first = new HttpStream(hostState())
  first.end()
  const second = new HttpStream(hostState(13), "")
  let calls = 0
  const reader = make(async () => (++calls === 1 ? first.response : second.response))
  const { events } = await reader.connect()
  expect(await all(events)).toMatchObject([{ kind: "terminal", reason: "protocol-error" }])
  await expect(make(async () => new Response(null, { status: 404 })).connect()).rejects.toThrow(
    "404",
  )
  second.end()
})
it("late opening fetch from a closed run cannot inject snapshot into the new run", async () => {
  const late = deferred<Response>()
  const old = new HttpStream(hostState(43)),
    fresh = new HttpStream(hostState(13), "host-B")
  let calls = 0
  const reader = make(async () => (++calls === 1 ? late.promise : fresh.response))
  const stale = reader.connect().catch((error: unknown) => error)
  reader.close()
  const current = await reader.connect()
  late.resolve(old.response)
  expect(await stale).toBeInstanceOf(Error)
  expect(current.initial.source.hostIncarnation).toBe("host-B")
  fresh.update(17, textUpdate("current"))
  const r = current.events.getReader()
  expect((await r.read()).value).toMatchObject({ kind: "update", batch: { version: 17 } })
  r.releaseLock()
  old.end()
  fresh.end()
})

it.each(["snapshot-json", "snapshot-envelope", "http409-json"])(
  "reconnect %s has the contracted terminal classification",
  async (kind) => {
    const first = new HttpStream(hostState(43))
    first.end()
    let calls = 0
    const reader = new SSEReader("http://synthetic.invalid/events", {
      _sleep: async () => {},
      _fetch: async () => {
        calls++
        if (calls === 1) return first.response
        if (calls === 2) {
          if (kind === "http409-json") return new Response("{", { status: 409 })
          return new Response(
            `event: snapshot\ndata: ${kind === "snapshot-json" ? "{" : JSON.stringify({ sessionId: "same-sid", version: 13, updates: [] })}\n\n`,
            { headers: { "content-type": "text/event-stream" } },
          )
        }
        return new Response(null, { status: 404 })
      },
    })
    readers.push(reader)
    const { events } = await reader.connect()
    const stream = events.getReader()
    const received: RemoteStreamEvent[] = []
    try {
      while (true) {
        const item = await stream.read()
        if (item.done) break
        received.push(item.value)
      }
    } finally {
      stream.releaseLock()
    }
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      kind: "terminal",
      reason: kind === "http409-json" ? "unavailable" : "protocol-error",
    })
    expect(calls).toBe(kind === "http409-json" ? 3 : 2)
  },
)

it("initial malformed snapshot rejects setup without retry", async () => {
  let calls = 0
  const reader = make(async () => {
    calls++
    return new Response("event: snapshot\ndata: {\n\n")
  })
  await expect(reader.connect()).rejects.toThrow("invalid snapshot JSON")
  expect(calls).toBe(1)
})

it("reconnect transport SyntaxError stays transient rather than protocol terminal", async () => {
  const first = new HttpStream(hostState(43))
  first.end()
  let calls = 0
  const reader = make(async () => {
    calls++
    if (calls === 1) return first.response
    if (calls === 2)
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new SyntaxError("transport failure"))
          },
        }),
      )
    return new Response(null, { status: 404 })
  })
  const { events } = await reader.connect()
  expect(await all(events)).toMatchObject([{ kind: "terminal", reason: "unavailable" }])
  expect(calls).toBe(3)
})
