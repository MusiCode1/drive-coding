/**
 * cues.test.ts — structural tests for CuesEngine.
 *
 * Runs in Node environment (no real Web Audio). AudioContext is mocked via
 * vi.stubGlobal. Tests verify shape + behaviour, not actual sound output.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CuesEngine } from "./cues"

// ─── AudioContext mock ───────────────────────────────────────────────────────

/**
 * Build a realistic AudioContext mock instance.
 * osc.connect() must return an object with connect() to allow chaining:
 *   osc.connect(gain).connect(ctx.destination)
 */
function makeMockCtxInstance(state: AudioContextState = "running") {
  const destination = { connect: vi.fn() }

  // gain.connect returns destination (for the final chain step)
  const gain = {
    gain: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn().mockReturnValue(destination),
  }

  // osc.connect returns gain
  const osc = {
    frequency: {
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    type: "sine" as OscillatorType,
    connect: vi.fn().mockReturnValue(gain),
    start: vi.fn(),
    stop: vi.fn(),
  }

  return {
    state,
    currentTime: 0,
    destination,
    createOscillator: vi.fn().mockReturnValue(osc),
    createGain: vi.fn().mockReturnValue(gain),
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CuesEngine", () => {
  let ctxInstance: ReturnType<typeof makeMockCtxInstance>
  let MockAudioContextCtor: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.unstubAllGlobals()
    ctxInstance = makeMockCtxInstance()
    // Use mockImplementation with a regular function so `new` works correctly.
    // Arrow functions cannot be used as constructors.
    MockAudioContextCtor = vi.fn().mockImplementation(function () {
      return ctxInstance
    })
    vi.stubGlobal("AudioContext", MockAudioContextCtor)
  })

  // Test 1: initial state — enabled=true, no AudioContext yet
  it("creates instance with enabled=true and no AudioContext yet", () => {
    const cues = new CuesEngine()
    expect(cues.enabled).toBe(true)
    // AudioContext not created until first play()
    expect(MockAudioContextCtor).not.toHaveBeenCalled()
  })

  // Test 2: play() creates AudioContext + calls createOscillator
  it("play('recordingStart') creates AudioContext and calls createOscillator", () => {
    const cues = new CuesEngine()
    cues.play("recordingStart")
    expect(MockAudioContextCtor).toHaveBeenCalledTimes(1)
    expect(ctxInstance.createOscillator).toHaveBeenCalled()
  })

  // Test 3: enabled=false → no-op
  it("enabled=false → play() is a no-op (AudioContext not created)", () => {
    const cues = new CuesEngine()
    cues.enabled = false
    cues.play("recordingStart")
    expect(MockAudioContextCtor).not.toHaveBeenCalled()
  })

  // Test 4: SSR safety
  it("AudioContext=undefined → play() does not throw", () => {
    vi.unstubAllGlobals()
    vi.stubGlobal("AudioContext", undefined)
    const cues = new CuesEngine()
    expect(() => cues.play("thinking")).not.toThrow()
  })

  // Test 5: second play reuses same AudioContext (constructor called once)
  it("second play() reuses same AudioContext (constructor called exactly once)", () => {
    const cues = new CuesEngine()
    cues.play("recordingStart")
    cues.play("recordingStop")
    expect(MockAudioContextCtor).toHaveBeenCalledTimes(1)
  })

  // Test 6: suspended context → resume() is called
  it("play() with suspended AudioContext calls resume()", () => {
    vi.unstubAllGlobals()
    const suspendedInstance = makeMockCtxInstance("suspended")
    const SuspendedCtor = vi.fn().mockImplementation(function () {
      return suspendedInstance
    })
    vi.stubGlobal("AudioContext", SuspendedCtor)

    const cues = new CuesEngine()
    cues.play("speaking")
    expect(suspendedInstance.resume).toHaveBeenCalled()
  })

  // Test 7: close() calls ctx.close() when context exists
  it("close() calls ctx.close() when AudioContext exists", async () => {
    const cues = new CuesEngine()
    cues.play("thinking")
    await cues.close()
    expect(ctxInstance.close).toHaveBeenCalled()
  })

  // Test 7b: close() no-op if context never created
  it("close() is a no-op when AudioContext was never created", async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal("AudioContext", undefined)
    const cues = new CuesEngine()
    await expect(cues.close()).resolves.toBeUndefined()
  })

  // Bonus: all 5 cue IDs play without throwing
  it.each(["recordingStart", "recordingStop", "thinking", "speaking", "error"] as const)(
    "play('%s') does not throw",
    (cueId) => {
      const cues = new CuesEngine()
      expect(() => cues.play(cueId)).not.toThrow()
    },
  )
})
