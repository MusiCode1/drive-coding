import { describe, expect, it, vi } from "vitest"
import { FrameReader } from "./frame-reader"
import { PipeError } from "./pipe"
import { createSseFramePipe } from "./sse-pipe"

describe("FrameReader connection failures", () => {
  it.each([
    {
      response: () => Response.json({ authMethods: [{ id: "login" }] }, { status: 401 }),
      status: 401,
      body: { authMethods: [{ id: "login" }] },
    },
    {
      response: () => new Response("temporarily unavailable", { status: 503 }),
      status: 503,
      body: "temporarily unavailable",
    },
    {
      response: () => ({ ok: false, status: 404 }) as Response,
      status: 404,
      body: undefined,
    },
  ])("preserves the SSE denial status and body ($status)", async ({ response, status, body }) => {
    const reader = new FrameReader(
      createSseFramePipe("/events", { _fetch: vi.fn(async () => response()) }),
    )
    const connection = reader.connect()
    await expect(connection).rejects.toBeInstanceOf(PipeError)
    await expect(connection).rejects.toMatchObject({
      status,
      body,
      message: `SSEReader: fetch failed with status ${status}`,
    })
  })

  it("aborts the underlying connection when the snapshot never arrives", async () => {
    const aborted = vi.fn()
    const reader = new FrameReader(
      {
        describe: "test pipe",
        async open(signal) {
          return (async function* () {
            await new Promise<void>((resolve) => {
              signal.addEventListener(
                "abort",
                () => {
                  aborted()
                  resolve()
                },
                { once: true },
              )
            })
            yield { event: "stream-alive", data: "{}" }
          })()
        },
      },
      { _snapshotTimeoutMs: 5 },
    )

    await expect(reader.connect()).rejects.toThrow("timed out waiting for snapshot")
    expect(aborted).toHaveBeenCalledOnce()
  })
})
