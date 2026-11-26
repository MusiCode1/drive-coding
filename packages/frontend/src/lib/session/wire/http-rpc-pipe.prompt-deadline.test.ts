import { describe, expect, it, vi } from "vitest"
import { PROMPT_DISPATCH_TIMEOUT_MS } from "../prompt-dispatch"
import { createHttpRpcPipe } from "./http-rpc-pipe"
import type { SSEReaderOptions } from "./reader-types"

const agentUrl = "https://example.test/api/agents/agent"
const body = { method: "session/prompt", params: { sessionId: "A", content: "hello" } }
const options = { timeoutMs: PROMPT_DISPATCH_TIMEOUT_MS, statusOnlyOn: 202 }

function setup() {
  const fetcher = vi.fn<NonNullable<SSEReaderOptions["_fetch"]>>()
  return { fetcher, pipe: createHttpRpcPipe(agentUrl, { _fetch: fetcher }) }
}

describe("HTTP owned prompt delivery", () => {
  it.each(["unavailable", "pending", "rejected"])(
    "accepts 202 from the headers with %s body cleanup and never reads JSON",
    async (mode) => {
      vi.useFakeTimers()
      try {
        const { fetcher, pipe } = setup()
        const json = vi.fn(() => new Promise<unknown>(() => {}))
        const cancel = vi.fn(() =>
          mode === "rejected"
            ? Promise.reject(new Error("Cannot cancel body"))
            : new Promise<void>(() => {}),
        )
        fetcher.mockResolvedValueOnce({
          status: 202,
          body: mode === "unavailable" ? null : { cancel },
          json,
        } as unknown as Response)

        const settled = vi.fn()
        const result = pipe.call("rpc", body, options).then(settled, settled)
        await vi.advanceTimersByTimeAsync(0)
        expect(settled).toHaveBeenCalledExactlyOnceWith({ status: 202, body: undefined })
        expect(json).not.toHaveBeenCalled()
        expect(cancel).toHaveBeenCalledTimes(mode === "unavailable" ? 0 : 1)
        expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
        expect(vi.getTimerCount()).toBe(0)
        await result
      } finally {
        vi.useRealTimers()
      }
    },
  )

  it("uses one deadline for headers and a body reader that ignores abort", async () => {
    vi.useFakeTimers()
    try {
      const { fetcher, pipe } = setup()
      let deliverHeaders: (response: Response) => void = () => {}
      fetcher.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            deliverHeaders = resolve
          }),
      )
      const json = vi.fn(() => new Promise<unknown>(() => {}))
      const settled = vi.fn()
      const result = pipe.call("rpc", body, options).then(settled, settled)
      const signal = fetcher.mock.calls[0]?.[1]?.signal
      expect(signal).toBeInstanceOf(AbortSignal)

      await vi.advanceTimersByTimeAsync(25_000)
      deliverHeaders({ status: 409, json } as unknown as Response)
      await vi.advanceTimersByTimeAsync(4_999)
      expect(json).toHaveBeenCalledOnce()
      expect(settled).not.toHaveBeenCalled()
      expect(signal?.aborted).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          name: "PipeError",
          status: 0,
          message: "HTTP session RPC timed out",
        }),
      )
      expect(signal?.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
      await result
    } finally {
      vi.useRealTimers()
    }
  })

  it("bounds a fetch that ignores abort and discards headers that arrive after the deadline", async () => {
    vi.useFakeTimers()
    try {
      const { fetcher, pipe } = setup()
      let deliverHeaders: (response: Response) => void = () => {}
      fetcher.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            deliverHeaders = resolve
          }),
      )
      const settled = vi.fn()
      const result = pipe.call("rpc", body, options).then(settled, settled)
      await vi.advanceTimersByTimeAsync(PROMPT_DISPATCH_TIMEOUT_MS)
      expect(settled).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 0 }))
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)

      const cancel = vi.fn().mockResolvedValue(undefined)
      const json = vi.fn().mockResolvedValue({ version: 1 })
      deliverHeaders({ status: 202, body: { cancel }, json } as unknown as Response)
      await vi.advanceTimersByTimeAsync(0)
      expect(cancel).toHaveBeenCalledOnce()
      expect(json).not.toHaveBeenCalled()
      expect(settled).toHaveBeenCalledOnce()
      await result
    } finally {
      vi.useRealTimers()
    }
  })

  it("returns the parsed 409 body, or undefined if the body is unreadable", async () => {
    const { fetcher, pipe } = setup()
    const mismatch = { error: "Conflict", code: "prompt_session_mismatch" }
    fetcher
      .mockResolvedValueOnce(new Response(JSON.stringify(mismatch), { status: 409 }))
      .mockResolvedValueOnce(new Response("{", { status: 409 }))
    await expect(pipe.call("rpc", body, options)).resolves.toEqual({ status: 409, body: mismatch })
    await expect(pipe.call("rpc", body, options)).resolves.toEqual({ status: 409, body: undefined })
  })

  it("leaves legacy RPCs waiting for the JSON body without a delivery deadline", async () => {
    vi.useFakeTimers()
    try {
      const { fetcher, pipe } = setup()
      let deliverBody: (value: { version: number }) => void = () => {}
      const json = vi.fn(
        () =>
          new Promise<{ version: number }>((resolve) => {
            deliverBody = resolve
          }),
      )
      fetcher.mockResolvedValueOnce({ status: 202, json } as unknown as Response)
      const settled = vi.fn()
      const result = pipe.call("rpc", body).then(settled, settled)
      await vi.advanceTimersByTimeAsync(PROMPT_DISPATCH_TIMEOUT_MS * 2)
      expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty("signal")
      expect(json).toHaveBeenCalledOnce()
      expect(settled).not.toHaveBeenCalled()
      deliverBody({ version: 1 })
      await result
      expect(settled).toHaveBeenCalledExactlyOnceWith({ status: 202, body: { version: 1 } })
    } finally {
      vi.useRealTimers()
    }
  })
})
