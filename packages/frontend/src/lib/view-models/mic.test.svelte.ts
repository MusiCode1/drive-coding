/**
 * mic.test.svelte.ts — pending capture recovery wiring for Mic.
 * (slice voice-pending-persistence, Commit 2)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { RecordTarget } from "../engines/pending-capture-wiring"

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

import { transcribe } from "../adapters/voice/transcribe"
import { _resetForTests, setBeUrlBase } from "../util/be-url"
import { Mic } from "./mic.svelte"

const fakeSession = { sendPrompt: vi.fn().mockResolvedValue(undefined) }
const initialTarget = {
  ownerKey: "test-owner",
  agentId: "test-agent",
  backendBaseUrl: "https://record.local",
  generation: 1,
  view: {} as RecordTarget["view"],
}
let target: RecordTarget | null

function createMic(getInputDeviceId?: () => string | null) {
  return new Mic({
    session: fakeSession,
    targets: {
      current: () => target,
      isCurrent: (candidate) => candidate === target,
    },
    getInputDeviceId,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(transcribe).mockReset()
  target = initialTarget
  setBeUrlBase(initialTarget.backendBaseUrl)
  mockStart.mockResolvedValue(undefined)
  mockStop.mockResolvedValue({ blob: new Blob(["audio"]), mimeType: "audio/webm" })
})

afterEach(() => {
  _resetForTests()
  vi.unstubAllGlobals()
})

describe("Mic pending capture", () => {
  it("keeps the explicit empty recordingId on existing scoped Record callers", async () => {
    vi.mocked(transcribe).mockResolvedValueOnce({ text: "synthetic transcript", recordingId: "" })
    const mic = createMic()
    await mic.toggle()
    await mic.toggle()
    expect(fakeSession.sendPrompt).toHaveBeenCalledWith("synthetic transcript", { recordingId: "" })
  })

  it("quarantines ownerless Record and skips both STT and sending", async () => {
    target = null
    const mic = createMic()
    await mic.toggle()
    target = initialTarget
    await mic.toggle()
    expect(transcribe).not.toHaveBeenCalled()
    expect(fakeSession.sendPrompt).not.toHaveBeenCalled()
    expect(mic.canRetry).toBe(false)
    expect(mic.state).toBe("idle")
  })

  it("shows late stop failures only under the entry that owns the device operation", async () => {
    const stopped = Promise.withResolvers<never>()
    mockStop.mockReturnValueOnce(stopped.promise)
    const mic = createMic()
    await mic.toggle()
    const finishing = mic.toggle()
    target = { ...initialTarget, ownerKey: "another-owner", generation: 2 }
    stopped.reject(new Error("device stopped unexpectedly"))
    await finishing
    expect(mic.error).toBeNull()
    expect(mic.state).toBe("idle")
  })

  it("preserves audio when the backend changes before STT and retries at the verified base", async () => {
    const mic = createMic()
    await mic.toggle()
    setBeUrlBase("https://different.local")
    await mic.toggle()
    expect(transcribe).not.toHaveBeenCalled()
    expect(mic.pendingRestored).toBe(true)
    expect(mic.canRetry).toBe(true)
    setBeUrlBase(initialTarget.backendBaseUrl)
    vi.mocked(transcribe).mockResolvedValueOnce({ text: "fixture", recordingId: "fixture-id" })
    await mic.bindPendingActions().onRetry()
    expect(transcribe).toHaveBeenCalledWith(expect.any(Blob), {
      recordSttProxyBaseUrl: "https://record.local/proxy/google/",
    })
    expect(fakeSession.sendPrompt).toHaveBeenCalledWith("fixture", { recordingId: "fixture-id" })
  })

  it("NotAllowedError flags permissionDenied and shows no text error", async () => {
    mockStart.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"))
    const mic = createMic()

    await mic.toggle()

    expect(mic.state).toBe("idle")
    expect(mic.permissionDenied).toBe(true)
    expect(mic.error).toBeNull()
    expect(mic.permissionHint).toBeNull()
    expect(mic.canRetry).toBe(false)
  })

  it("goes through requesting before recording when start succeeds", async () => {
    let resolveStart!: () => void
    mockStart.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveStart = resolve
      }),
    )
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn().mockResolvedValue({ state: "granted" }),
      },
    })
    const mic = createMic()

    const p = mic.toggle()
    expect(mic.state).toBe("requesting")
    // probe runs in parallel — start must not wait on Permissions API
    expect(mockStart).toHaveBeenCalledOnce()
    expect(mic.awaitingPermissionDialog).toBe(false)

    resolveStart()
    await p

    expect(mic.state).toBe("recording")
    expect(mic.permissionHint).toBeNull()
    expect(mic.awaitingPermissionDialog).toBe(false)
  })

  it("starts recorder without waiting for a slow permission probe", async () => {
    let resolveProbe!: (value: { state: string }) => void
    mockStart.mockResolvedValueOnce(undefined)
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn(
          () =>
            new Promise<{ state: string }>((resolve) => {
              resolveProbe = resolve
            }),
        ),
      },
    })
    const mic = createMic()

    const p = mic.toggle()
    expect(mockStart).toHaveBeenCalledOnce()
    resolveProbe({ state: "granted" })
    await p
    expect(mic.state).toBe("recording")
  })

  it("awaitingPermissionDialog is true while requesting when permission is prompt", async () => {
    let resolveStart!: () => void
    mockStart.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveStart = resolve
      }),
    )
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn().mockResolvedValue({ state: "prompt" }),
      },
    })
    const mic = createMic()

    const p = mic.toggle()
    expect(mockStart).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(mic.awaitingPermissionDialog).toBe(true))
    expect(mic.state).toBe("requesting")

    resolveStart()
    await p

    expect(mic.state).toBe("recording")
    expect(mic.awaitingPermissionDialog).toBe(false)
  })

  it("refreshPermissionHint sets mic.hint.needsAllow on prompt", async () => {
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn().mockResolvedValue({ state: "prompt" }),
      },
    })
    const mic = createMic()

    await mic.refreshPermissionHint()

    expect(mic.permissionHint).toBe("mic.hint.needsAllow")
  })
})

describe("Mic input device (mic-device-selection)", () => {
  it("passes getInputDeviceId to recorder.start", async () => {
    mockStart.mockResolvedValue(undefined)
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn().mockResolvedValue({ state: "granted" }),
      },
    })
    const mic = createMic(() => "mic-x")
    await mic.toggle()
    expect(mockStart).toHaveBeenCalledWith("mic-x")
  })

  it("recorder.start receives null without getInputDeviceId", async () => {
    mockStart.mockResolvedValue(undefined)
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn().mockResolvedValue({ state: "granted" }),
      },
    })
    const mic = createMic()
    await mic.toggle()
    expect(mockStart).toHaveBeenCalledWith(null)
  })
})
