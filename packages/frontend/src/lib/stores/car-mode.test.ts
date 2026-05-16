import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCarMode } from "./car-mode.svelte"

function makeMediaSessionMock() {
  const handlers: Record<string, (() => void) | null> = {}
  return {
    metadata: null as MediaMetadata | null,
    playbackState: "none" as MediaSessionPlaybackState,
    setActionHandler: vi.fn((action: string, handler: (() => void) | null) => {
      handlers[action] = handler
    }),
    _getHandler: (action: string) => handlers[action] ?? null,
    _triggerAction: (action: string) => handlers[action]?.(),
  }
}

describe("createCarMode", () => {
  let mockSession: ReturnType<typeof makeMediaSessionMock>

  beforeEach(() => {
    mockSession = makeMediaSessionMock()
    vi.stubGlobal("navigator", { mediaSession: mockSession })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("registers play and pause action handlers on enable", () => {
    const cm = createCarMode()
    cm.enable({ startRecording: vi.fn(), stopRecording: vi.fn(), isRecording: () => false })
    expect(mockSession.setActionHandler).toHaveBeenCalledWith("play", expect.any(Function))
    expect(mockSession.setActionHandler).toHaveBeenCalledWith("pause", expect.any(Function))
  })

  it("play handler calls startRecording when not recording", () => {
    const startRecording = vi.fn()
    const cm = createCarMode()
    cm.enable({ startRecording, stopRecording: vi.fn(), isRecording: () => false })
    mockSession._triggerAction("play")
    expect(startRecording).toHaveBeenCalledOnce()
  })

  it("play handler calls stopRecording when currently recording", () => {
    const stopRecording = vi.fn()
    const cm = createCarMode()
    cm.enable({ startRecording: vi.fn(), stopRecording, isRecording: () => true })
    mockSession._triggerAction("play")
    expect(stopRecording).toHaveBeenCalledOnce()
  })

  it("pause handler starts recording when idle", () => {
    const startRecording = vi.fn()
    const cm = createCarMode()
    cm.enable({ startRecording, stopRecording: vi.fn(), isRecording: () => false })
    mockSession._triggerAction("pause")
    expect(startRecording).toHaveBeenCalledOnce()
  })

  it("pause handler stops recording when recording", () => {
    const stopRecording = vi.fn()
    const cm = createCarMode()
    cm.enable({ startRecording: vi.fn(), stopRecording, isRecording: () => true })
    mockSession._triggerAction("pause")
    expect(stopRecording).toHaveBeenCalledOnce()
  })

  it("isActive is false before enable", () => {
    const cm = createCarMode()
    expect(cm.isActive).toBe(false)
  })

  it("isActive is true after enable", () => {
    const cm = createCarMode()
    cm.enable({ startRecording: vi.fn(), stopRecording: vi.fn(), isRecording: () => false })
    expect(cm.isActive).toBe(true)
  })

  it("does nothing if mediaSession unavailable", () => {
    vi.stubGlobal("navigator", {})
    const cm = createCarMode()
    expect(() =>
      cm.enable({ startRecording: vi.fn(), stopRecording: vi.fn(), isRecording: () => false }),
    ).not.toThrow()
    expect(cm.isActive).toBe(false)
  })

  // ── previoustrack handler (Slice 7 fix) ───────────────────────────────────

  it("previoustrack handler is registered (not null) on enable", () => {
    const cm = createCarMode()
    cm.enable({ startRecording: vi.fn(), stopRecording: vi.fn(), isRecording: () => false })
    // Verify setActionHandler was called with previoustrack and a function (not null)
    expect(mockSession.setActionHandler).toHaveBeenCalledWith("previoustrack", expect.any(Function))
  })

  it("previoustrack handler calls onReplayLast when set", () => {
    const onReplayLast = vi.fn()
    const cm = createCarMode()
    cm.enable({
      startRecording: vi.fn(),
      stopRecording: vi.fn(),
      isRecording: () => false,
      onReplayLast,
    })
    mockSession._triggerAction("previoustrack")
    expect(onReplayLast).toHaveBeenCalledOnce()
  })

  it("previoustrack handler is a no-op when onReplayLast not provided", () => {
    const cm = createCarMode()
    cm.enable({ startRecording: vi.fn(), stopRecording: vi.fn(), isRecording: () => false })
    // Should not throw even without onReplayLast
    expect(() => mockSession._triggerAction("previoustrack")).not.toThrow()
  })
})
