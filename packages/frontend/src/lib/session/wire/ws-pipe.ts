import {
  type ChannelFrame,
  type ChannelResponse,
  decodeWsServerMessage,
  encodeWsClientRequest,
  encodeWsControl,
  statusForCloseCode,
  WS_REPLY_METHOD,
  WS_RPC_METHOD,
} from "@drive-coding/core/session"
import { PRESENCE_INTERVAL_MS } from "$lib/engines/liveness-thresholds"
import { PipeError, type RpcKind, type SessionPipe } from "./pipe"
import type { ClearIntervalFn, IntervalId, SetIntervalFn } from "./reader-types"

type WsOptions = {
  _WebSocket?: typeof WebSocket
  _setInterval?: SetIntervalFn
  _clearInterval?: ClearIntervalFn
}

function readErrorBody(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    return data
  }
}

function closedError(): PipeError {
  return new PipeError(0, undefined, "WS session socket is closed")
}

type PendingRequest = {
  resolve: (response: ChannelResponse) => void
  reject: (error: PipeError) => void
}

export function createWsSessionPipe(url: string, opts: WsOptions = {}): SessionPipe {
  const schedule = opts._setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms))
  const unschedule = opts._clearInterval ?? ((id) => globalThis.clearInterval(id))
  let active: ReturnType<typeof connect> | undefined

  function connect(Socket: typeof WebSocket, signal: AbortSignal) {
    const socket = new Socket(url)
    const listeners = new AbortController()
    const pending = new Map<number, PendingRequest>()
    let nextId = 0
    let snapshotReceived = false
    let takeoverReceived = false
    let errorBody: unknown
    let timer: IntervalId | undefined
    let ended = false
    let frames!: ReadableStreamDefaultController<ChannelFrame>
    const stream = new ReadableStream<ChannelFrame>({
      start(controller) {
        frames = controller
      },
    })

    function finish(error?: PipeError): void {
      ended = true
      listeners.abort()
      if (timer !== undefined) unschedule(timer)
      for (const request of pending.values()) request.reject(error ?? closedError())
      pending.clear()
      if (error) frames.error(error)
      else frames.close()
    }

    function stop(): void {
      if (ended) return
      finish()
      socket.close()
    }

    function ping(): void {
      if (socket.readyState !== Socket.OPEN) return
      try {
        socket.send(encodeWsControl("$/ping"))
      } catch {
        stop()
      }
    }

    const listenerOptions = { signal: listeners.signal }
    socket.addEventListener(
      "open",
      () => {
        timer = schedule(ping, PRESENCE_INTERVAL_MS)
        ping()
      },
      listenerOptions,
    )

    socket.addEventListener(
      "message",
      (event) => {
        if (typeof event.data !== "string") return
        const message = decodeWsServerMessage(event.data)
        if (message?.kind === "frame") {
          const { frame } = message
          if (frame.event === "snapshot") snapshotReceived = true
          if (frame.event === "taken-over") takeoverReceived = true
          if (frame.event === "error") errorBody = readErrorBody(frame.data)
          frames.enqueue(frame)
        } else if (message?.kind === "response") {
          const { id, result } = message.response
          const request = pending.get(id)
          pending.delete(id)
          request?.resolve(result)
        }
      },
      listenerOptions,
    )

    socket.addEventListener(
      "close",
      (event) => {
        const status = statusForCloseCode(event.code)
        if (!snapshotReceived && status !== undefined) {
          finish(
            new PipeError(
              status,
              errorBody,
              `WS session connection closed with code ${event.code}`,
            ),
          )
          return
        }
        if (snapshotReceived && status === 409 && !takeoverReceived) {
          frames.enqueue({ event: "taken-over", data: "{}" })
        }
        finish()
      },
      listenerOptions,
    )
    signal.addEventListener("abort", stop, listenerOptions)

    const iterable: AsyncIterable<ChannelFrame> = {
      async *[Symbol.asyncIterator]() {
        const reader = stream.getReader()
        try {
          while (true) {
            const next = await reader.read()
            if (next.done) return
            yield next.value
          }
        } finally {
          reader.releaseLock()
          stop()
        }
      },
    }

    function call(kind: RpcKind, body: unknown): Promise<ChannelResponse> {
      if (ended || socket.readyState !== Socket.OPEN) return Promise.reject(closedError())
      return new Promise((resolve, reject) => {
        const id = ++nextId
        pending.set(id, { resolve, reject })
        try {
          socket.send(
            encodeWsClientRequest({
              jsonrpc: "2.0",
              id,
              method: kind === "rpc" ? WS_RPC_METHOD : WS_REPLY_METHOD,
              params: body,
            }),
          )
        } catch (error) {
          pending.delete(id)
          reject(error)
        }
      })
    }

    return { iterable, call, stop }
  }

  return {
    frames: {
      describe: url,
      async open(signal) {
        if (signal.aborted) throw closedError()
        active?.stop()
        active = connect(opts._WebSocket ?? WebSocket, signal)
        return active.iterable
      },
    },
    rpc: {
      call: (kind, body) => active?.call(kind, body) ?? Promise.reject(closedError()),
      label: (kind) => `WS ${kind}`,
    },
    close() {
      active?.stop()
      active = undefined
    },
  }
}
