/**
 * live-session.test.ts — integration tests for LiveSessionEngine.
 *
 * Slice: live-ears, Commit 4. DoD 13: connect rejection → error state.
 */

import type { LiveProvider, LiveSession } from "@drive-coding/core/voice/live-types"
import { describe, expect, it, vi } from "vitest"
import { LiveSessionEngine } from "./live-session"

function mockFrames() {
  let frameHandler: ((f: Float32Array) => void) | null = null
  return {
    on(_event: "frame", h: (f: Float32Array) => void) {
      frameHandler = h
      return () => {
        frameHandler = null
      }
    },
    emitFrame(f: Float32Array) {
      frameHandler?.(f)
    },
    stop: vi.fn(async () => {}),
  }
}

function mockProvider(session: Partial<LiveSession> = {}): LiveProvider {
  return {
    id: "mock",
    inputSampleRate: 16_000,
    outputSampleRate: 24_000,
    supportsSilentContext: true,
    connect: vi.fn(async () => ({
      send: vi.fn(),
      close: vi.fn(),
      ...session,
    })),
  }
}

describe("LiveSessionEngine", () => {
  it("open() success → state open, forwards PCM on frame", async () => {
    const frames = mockFrames()
    const send = vi.fn()
    const provider = mockProvider({ send })
    const engine = new LiveSessionEngine({
      connector: {
        fetchToken: async () => ({ token: "t", model: "m", sessionConfig: {} }),
        provider,
      },
      frames,
    })

    await engine.open()
    expect(engine.state).toBe("open")
    frames.emitFrame(new Float32Array([0.5, -0.5]))
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "audio" }))
  })

  it("DoD 13: connect() rejection → state error", async () => {
    const frames = mockFrames()
    const provider: LiveProvider = {
      id: "mock",
      inputSampleRate: 16_000,
      outputSampleRate: 24_000,
      supportsSilentContext: true,
      connect: vi.fn(async () => {
        throw new Error("socket refused")
      }),
    }
    const engine = new LiveSessionEngine({
      connector: {
        fetchToken: async () => ({ token: "t", model: "m", sessionConfig: {} }),
        provider,
      },
      frames,
    })

    await engine.open()
    expect(engine.state).toBe("error")
  })

  it("accumulates transcript chunks for same role", async () => {
    const frames = mockFrames()
    let onEvent: ((e: import("@drive-coding/core/voice/live-types").LiveEvent) => void) | undefined
    const provider: LiveProvider = {
      id: "mock",
      inputSampleRate: 16_000,
      outputSampleRate: 24_000,
      supportsSilentContext: true,
      connect: vi.fn(async (opts) => {
        onEvent = opts.onEvent
        return { send: vi.fn(), close: vi.fn() }
      }),
    }
    const engine = new LiveSessionEngine({
      connector: {
        fetchToken: async () => ({ token: "t", model: "m", sessionConfig: {} }),
        provider,
      },
      frames,
    })

    await engine.open()
    onEvent?.({ type: "transcript", role: "user", text: "hello ", final: false })
    onEvent?.({ type: "transcript", role: "user", text: "world", final: false })
    expect(engine.transcript).toHaveLength(1)
    expect(engine.transcript[0]?.text).toBe("hello world")
  })

  it("DoD 17: audio event enqueues PCM on sink", async () => {
    const frames = mockFrames()
    const enqueue = vi.fn()
    let onEvent: ((e: import("@drive-coding/core/voice/live-types").LiveEvent) => void) | undefined
    const provider: LiveProvider = {
      id: "mock",
      inputSampleRate: 16_000,
      outputSampleRate: 24_000,
      supportsSilentContext: true,
      connect: vi.fn(async (opts) => {
        onEvent = opts.onEvent
        return { send: vi.fn(), close: vi.fn() }
      }),
    }
    const engine = new LiveSessionEngine({
      connector: {
        fetchToken: async () => ({ token: "t", model: "m", sessionConfig: {} }),
        provider,
      },
      frames,
      audioSink: { enqueue, stop: vi.fn() },
    })

    await engine.open()
    const pcm = new Uint8Array([0, 0, 1, 0])
    onEvent?.({ type: "audio", pcm })
    expect(enqueue).toHaveBeenCalledWith(pcm)
  })

  it("interrupted event stops sink", async () => {
    const frames = mockFrames()
    const stop = vi.fn()
    let onEvent: ((e: import("@drive-coding/core/voice/live-types").LiveEvent) => void) | undefined
    const provider: LiveProvider = {
      id: "mock",
      inputSampleRate: 16_000,
      outputSampleRate: 24_000,
      supportsSilentContext: true,
      connect: vi.fn(async (opts) => {
        onEvent = opts.onEvent
        return { send: vi.fn(), close: vi.fn() }
      }),
    }
    const engine = new LiveSessionEngine({
      connector: {
        fetchToken: async () => ({ token: "t", model: "m", sessionConfig: {} }),
        provider,
      },
      frames,
      audioSink: { enqueue: vi.fn(), stop },
    })

    await engine.open()
    onEvent?.({ type: "interrupted" })
    expect(stop).toHaveBeenCalled()
  })
})
