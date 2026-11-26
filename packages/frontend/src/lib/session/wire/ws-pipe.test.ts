import {
  createInitialSessionState,
  decodeWsClientMessage,
  encodeWsFrame,
  encodeWsServerResponse,
  snapshotFrame,
} from "@drive-coding/core/session"
import { describe, expect, it, vi } from "vitest"
import { PRESENCE_INTERVAL_MS } from "$lib/engines/liveness-thresholds"
import { fakeSessionSockets } from "../__contract__/fake-session-socket"
import { FrameReader } from "./frame-reader"
import { createWsSessionPipe } from "./ws-pipe"

const snapshot = encodeWsFrame(snapshotFrame(createInitialSessionState({ sessionId: "s1" })))

function setup() {
  const sockets = fakeSessionSockets()
  const pipe = createWsSessionPipe("ws://be.local/ws/session/a1", { _WebSocket: sockets.WebSocket })
  const onReconnected = vi.fn()
  const onTakenOver = vi.fn()
  const reader = new FrameReader(pipe.frames, { _sleep: () => Promise.resolve() })
  reader.onReconnected = onReconnected
  reader.onTakenOver = onTakenOver
  return { sockets, pipe, reader, onReconnected, onTakenOver }
}

describe("WS session pipe", () => {
  it("routes out-of-order RPC and reply responses to their respective callers", async () => {
    const { pipe, sockets } = setup()
    await pipe.frames.open(new AbortController().signal)
    const socket = sockets.latest()
    socket.connect()
    const rpc = pipe.rpc.call("rpc", { method: "session/cancel" })
    const reply = pipe.rpc.call("reply", { requestId: 1 })
    const outgoing = socket.sent.map(decodeWsClientMessage)
    expect(outgoing.every(Boolean)).toBe(true)
    const requests = outgoing.filter((message) => message?.kind === "request")
    expect(requests.map((message) => message.request.method)).toEqual([
      "_drive/rpc",
      "_drive/reply",
    ])
    const [rpcRequest, replyRequest] = requests
    if (!rpcRequest || !replyRequest) throw new Error("Expected two WS requests")
    socket.receive(encodeWsServerResponse(replyRequest.request.id, { status: 200, body: "reply" }))
    socket.receive(encodeWsServerResponse(rpcRequest.request.id, { status: 500, body: "rpc" }))
    await expect(rpc).resolves.toEqual({ status: 500, body: "rpc" })
    await expect(reply).resolves.toEqual({ status: 200, body: "reply" })
    pipe.close()
  })

  it("expires only the missing ACK and ignores it when a later RPC uses the same socket", async () => {
    vi.useFakeTimers()
    const { pipe, sockets } = setup()
    try {
      await pipe.frames.open(new AbortController().signal)
      const socket = sockets.latest()
      socket.connect()
      const takeLastRequestId = () => {
        const message = decodeWsClientMessage(socket.sent.at(-1) ?? "")
        if (message?.kind !== "request") throw new Error("Expected a WS request")
        return message.request.id
      }
      const connectionTimers = vi.getTimerCount()
      const prompt = pipe.rpc.call("rpc", { method: "session/prompt" }, { timeoutMs: 30_000 })
      const timedOut = expect(prompt).rejects.toThrow("WS session RPC timed out")
      const promptId = takeLastRequestId()
      const legacy = pipe.rpc.call("rpc", { method: "session/cancel" })
      const legacyId = takeLastRequestId()

      expect(vi.getTimerCount()).toBe(connectionTimers + 1)
      await vi.advanceTimersByTimeAsync(30_000)
      await timedOut
      expect(vi.getTimerCount()).toBe(connectionTimers)
      expect(socket.readyState).toBe(1)

      const later = pipe.rpc.call("reply", { requestId: 5 }, { timeoutMs: 30_000 })
      const laterId = takeLastRequestId()
      expect(laterId).not.toBe(promptId)
      const settled = vi.fn()
      const laterResult = later.then(settled, settled)
      socket.receive(encodeWsServerResponse(promptId, { status: 202, body: { version: 1 } }))
      await vi.advanceTimersByTimeAsync(0)
      expect(vi.getTimerCount()).toBe(connectionTimers + 1)
      expect(settled).not.toHaveBeenCalled()
      socket.receive(encodeWsServerResponse(legacyId, { status: 202, body: { version: 2 } }))
      socket.receive(encodeWsServerResponse(laterId, { status: 200, body: { ok: true } }))
      await expect(legacy).resolves.toEqual({ status: 202, body: { version: 2 } })
      await laterResult
      expect(settled).toHaveBeenCalledExactlyOnceWith({ status: 200, body: { ok: true } })
      expect(vi.getTimerCount()).toBe(connectionTimers)
      expect(sockets.instances).toHaveLength(1)
    } finally {
      pipe.close()
      vi.useRealTimers()
    }
  })

  it.each(["close", "stop", "abort"] as const)("clears timed requests on %s", async (action) => {
    vi.useFakeTimers()
    const { pipe, sockets } = setup()
    try {
      const abort = new AbortController()
      const frames = await pipe.frames.open(abort.signal)
      const socket = sockets.latest()
      socket.connect()
      socket.receive(snapshot)
      const pending = pipe.rpc.call("rpc", {}, { timeoutMs: 30_000 })
      const closed = expect(pending).rejects.toMatchObject({ status: 0 })
      const end = {
        close: () => socket.close(4409),
        stop: () => pipe.close(),
        abort: () => abort.abort(),
      }
      end[action]()
      await closed
      expect(vi.getTimerCount()).toBe(0)
      for await (const frame of frames) {
        expect(["snapshot", "taken-over"]).toContain(frame.event)
      }
    } finally {
      pipe.close()
      vi.useRealTimers()
    }
  })

  it("clears the timed request when send throws", async () => {
    vi.useFakeTimers()
    const { pipe, sockets } = setup()
    try {
      await pipe.frames.open(new AbortController().signal)
      const socket = sockets.latest()
      socket.connect()
      const connectionTimers = vi.getTimerCount()
      vi.spyOn(socket, "send").mockImplementationOnce(() => {
        throw new Error("send failed")
      })
      await expect(pipe.rpc.call("rpc", {}, { timeoutMs: 30_000 })).rejects.toThrow("send failed")
      expect(vi.getTimerCount()).toBe(connectionTimers)
    } finally {
      pipe.close()
      vi.useRealTimers()
    }
  })

  it.each([1000, 1001])("ends frames and rejects pending RPC equally on close %i", async (code) => {
    const { pipe, sockets } = setup()
    await expect(pipe.rpc.call("rpc", {})).rejects.toMatchObject({ status: 0 })
    const frames = await pipe.frames.open(new AbortController().signal)
    await expect(pipe.rpc.call("rpc", {})).rejects.toMatchObject({ status: 0 })
    const socket = sockets.latest()
    socket.connect()
    const pending = pipe.rpc.call("rpc", {})
    socket.close(code)
    await expect(pending).rejects.toMatchObject({ status: 0 })
    await expect(frames[Symbol.asyncIterator]().next()).resolves.toMatchObject({ done: true })
  })

  it("aborts the socket, ends the iterator and rejects outstanding calls", async () => {
    const { pipe, sockets } = setup()
    const abort = new AbortController()
    const frames = await pipe.frames.open(abort.signal)
    const socket = sockets.latest()
    socket.connect()
    const pending = pipe.rpc.call("rpc", {})
    const next = frames[Symbol.asyncIterator]().next()
    abort.abort()
    expect(socket.readyState).toBe(3)
    await expect(next).resolves.toMatchObject({ done: true })
    await expect(pending).rejects.toMatchObject({ status: 0 })
  })

  it("passes a denial before snapshot through as a typed error with its body", async () => {
    const { reader, sockets, onTakenOver } = setup()
    const connect = reader.connect()
    const socket = sockets.latest()
    socket.connect()
    socket.receive(encodeWsFrame({ event: "error", data: '{"error":"taken-over","epoch":2}' }))
    socket.close(4409)
    await expect(connect).rejects.toMatchObject({
      name: "PipeError",
      status: 409,
      body: { error: "taken-over", epoch: 2 },
    })
    expect(onTakenOver).not.toHaveBeenCalled()
  })

  it("ends the reader when a reconnect is denied with 4404 before snapshot", async () => {
    const { reader, sockets } = setup()
    const connect = reader.connect()
    const socket = sockets.latest()
    socket.connect()
    socket.receive(snapshot)
    const { updates } = await connect
    socket.close(4404)
    await vi.waitFor(() => expect(sockets.instances).toHaveLength(2))
    sockets.latest().close(4404)
    await expect(updates.getReader().read()).resolves.toMatchObject({ done: true })
    expect(sockets.instances).toHaveLength(2)
  })

  it("retries 4503 and reconnects once on the next snapshot", async () => {
    const { reader, sockets, onReconnected } = setup()
    const connect = reader.connect()
    const socket = sockets.latest()
    socket.connect()
    socket.receive(snapshot)
    await connect
    socket.close(1006)
    await vi.waitFor(() => expect(sockets.instances).toHaveLength(2))
    sockets.latest().close(4503)
    await vi.waitFor(() => expect(sockets.instances).toHaveLength(3))
    sockets.latest().connect()
    sockets.latest().receive("malformed")
    sockets.latest().receive(snapshot)
    await vi.waitFor(() =>
      expect(onReconnected).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ sessionId: "s1" }),
      ),
    )
    reader.close()
  })

  it("turns 4409 after snapshot into a single terminal takeover", async () => {
    const { reader, sockets, onTakenOver } = setup()
    const connect = reader.connect()
    const socket = sockets.latest()
    socket.connect()
    socket.receive(snapshot)
    const { updates } = await connect
    socket.close(4409)
    await expect(updates.getReader().read()).resolves.toMatchObject({ done: true })
    expect(onTakenOver).toHaveBeenCalledOnce()
    expect(sockets.instances).toHaveLength(1)
  })

  it("sends a valid ping at open and at intervals shorter than 60 seconds, then stops on close", async () => {
    vi.useFakeTimers()
    try {
      const { pipe, sockets } = setup()
      await pipe.frames.open(new AbortController().signal)
      const socket = sockets.latest()
      socket.connect()
      expect(PRESENCE_INTERVAL_MS).toBeLessThan(60_000)
      expect(socket.sent.map(decodeWsClientMessage)).toEqual([{ kind: "ping" }])
      await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS * 2)
      expect(socket.sent.map(decodeWsClientMessage)).toEqual([
        { kind: "ping" },
        { kind: "ping" },
        { kind: "ping" },
      ])
      pipe.close()
      await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS)
      expect(socket.sent).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })
})
