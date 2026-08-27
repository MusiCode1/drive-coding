/**
 * NBug17 regression: `connect()` must always settle.
 *
 * The failure this guards against is not abstract. The SDK reports a socket that
 * never comes up through `onerror`/`onclose`, which emit our events but do not
 * release the promise it returned. A caller that awaits `connect()` then waits
 * forever — a driver pressing "start" on a flaky network, UI stuck on
 * "connecting…", no error and no way out.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { geminiLive } from "./gemini.js"

const connectSpy = vi.fn()

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    live = { connect: connectSpy }
  },
}))

const baseOpts = {
  credential: "tok",
  model: "gemini-3.1-flash-live-preview",
  providerConfig: {},
  onEvent: () => {},
}

describe("geminiLive.connect() always settles", () => {
  beforeEach(() => {
    connectSpy.mockReset()
  })

  it("rejects when the socket never comes up (SDK promise never settles)", async () => {
    connectSpy.mockImplementation(() => new Promise(() => {}))
    await expect(geminiLive.connect({ ...baseOpts, connectTimeoutMs: 20 })).rejects.toThrow(
      /timed out/,
    )
  })

  it("rejects as soon as onclose fires before the session is ready", async () => {
    connectSpy.mockImplementation(({ callbacks }) => {
      queueMicrotask(() => callbacks.onclose({ reason: "API key not valid" }))
      return new Promise(() => {})
    })
    await expect(geminiLive.connect({ ...baseOpts, connectTimeoutMs: 5_000 })).rejects.toThrow(
      /API key not valid/,
    )
  })

  it("rejects as soon as onerror fires before the session is ready", async () => {
    connectSpy.mockImplementation(({ callbacks }) => {
      queueMicrotask(() => callbacks.onerror(new Error("socket refused")))
      return new Promise(() => {})
    })
    await expect(geminiLive.connect({ ...baseOpts, connectTimeoutMs: 5_000 })).rejects.toThrow(
      /socket refused/,
    )
  })

  it("a close AFTER a healthy connect is an event, not an unhandled rejection", async () => {
    let captured: { onclose: (e: { reason?: string }) => void } | undefined
    connectSpy.mockImplementation(({ callbacks }) => {
      captured = callbacks
      return Promise.resolve({ close: () => {}, sendRealtimeInput: () => {} })
    })
    const events: { type: string }[] = []
    const session = await geminiLive.connect({ ...baseOpts, onEvent: (e) => events.push(e) })
    expect(session).toBeDefined()
    captured?.onclose({ reason: "normal shutdown" })
    expect(events.some((e) => e.type === "closed")).toBe(true)
  })
})
