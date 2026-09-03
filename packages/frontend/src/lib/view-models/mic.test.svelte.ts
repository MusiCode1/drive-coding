/**
 * mic.test.svelte.ts — pending capture recovery wiring for Mic.
 * (slice voice-pending-persistence, Commit 2)
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MicPendingRecovery } from "./mic.svelte"

const { mockStart, mockStop } = vi.hoisted(() => ({
  mockStart: vi.fn(),
  mockStop: vi.fn(),
}))

vi.mock("../engines/recorder", () => ({
  Recorder: class MockRecorder {
    start = mockStart
    stop = mockStop
  },
}))

vi.mock("../adapters/voice/transcribe", () => ({
  transcribe: vi.fn(),
}))

import { Mic } from "./mic.svelte"
import type { AgentSession } from "./agent-session.svelte"

const fakeSession = {
  sendPrompt: vi.fn(),
} as unknown as AgentSession

function createRecovery(
  overrides: Partial<MicPendingRecovery> = {},
): MicPendingRecovery {
  return {
    hasPending: false,
    hydrate: vi.fn().mockResolvedValue(null),
    dismiss: vi.fn().mockResolvedValue(undefined),
    processBlob: vi.fn().mockResolvedValue({ ok: true, text: "hello", recordingId: "" }),
    retry: vi.fn().mockResolvedValue({ ok: true, text: "hello", recordingId: "" }),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStart.mockResolvedValue(undefined)
  mockStop.mockResolvedValue({ blob: new Blob(["audio"]), mimeType: "audio/webm" })
})

describe("Mic pending capture", () => {
  it("retryTranscribe delegates to recovery when idle and pending exists", async () => {
    const recovery = createRecovery({ hasPending: true })
    const mic = new Mic({ session: fakeSession, recovery })

    await mic.retryTranscribe()

    expect(recovery.retry).toHaveBeenCalledOnce()
    expect(mic.state).toBe("idle")
  })

  it("dismiss clears error via recovery", async () => {
    const recovery = createRecovery()
    const mic = new Mic({ session: fakeSession, recovery })
    mic.error = "mic.error.transcribe"
    mic.pendingRestored = true

    await mic.dismiss()

    expect(recovery.dismiss).toHaveBeenCalledOnce()
    expect(mic.error).toBeNull()
    expect(mic.pendingRestored).toBe(false)
  })

  it("hydratePending sets restored flag and error from capture", async () => {
    const recovery = createRecovery({
      hydrate: vi.fn().mockResolvedValue({ lastError: "mic.error.transcribe" }),
    })
    const mic = new Mic({ session: fakeSession, recovery })

    await mic.hydratePending()

    expect(mic.pendingRestored).toBe(true)
    expect(mic.error).toBe("mic.error.transcribe")
  })

  it("canRetry reflects recovery.hasPending", () => {
    const recovery = createRecovery()
    const mic = new Mic({ session: fakeSession, recovery })

    expect(mic.canRetry).toBe(false)
    ;(recovery as { hasPending: boolean }).hasPending = true
    expect(mic.canRetry).toBe(true)
  })
})
