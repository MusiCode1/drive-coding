/**
 * live.test.svelte.ts — integration tests for Live VM wiring.
 *
 * Slice: live-ears, Commit 5.
 */

import { describe, expect, it, vi } from "vitest"
import type { Mic } from "./mic.svelte"
import { Live } from "./live.svelte"

vi.mock("../adapters/voice/live-token", () => ({
  fetchLiveToken: vi.fn(async () => ({
    token: "tok",
    model: "m",
    sessionConfig: {},
    expiresAt: "2099",
  })),
}))

vi.mock("../adapters/voice/live/gemini", () => ({
  geminiLive: {
    id: "gemini",
    inputSampleRate: 16_000,
    outputSampleRate: 24_000,
    supportsSilentContext: true,
    connect: vi.fn(async () => ({ send: vi.fn(), close: vi.fn() })),
  },
}))

vi.mock("../engines/mic-frames", () => ({
  MicFrames: class {
    sampleRate = 16_000
    start = vi.fn(async () => {})
    stop = vi.fn(async () => {})
    on(_event: "frame", _h: (f: Float32Array) => void) {
      return () => {}
    }
    get level() {
      return 0
    }
  },
}))

function mockMic(state: "idle" | "recording" | "transcribing" = "idle") {
  return { state } as unknown as Mic
}

describe("Live.canOpen", () => {
  it("false when mic is recording", () => {
    const mic = mockMic("recording")
    const live = new Live({ mic })
    expect(live.canOpen).toBe(false)
  })

  it("true when mic is idle and live closed", () => {
    const mic = mockMic("idle")
    const live = new Live({ mic })
    expect(live.canOpen).toBe(true)
  })
})
