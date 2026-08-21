/**
 * media-session-keepalive.test.ts — TDD ללולאת WAV + MediaSession handlers + watchdog.
 */
import { describe, expect, it, vi } from "vitest"
import {
  type AudioLike,
  BEAT_INTERVAL_MS,
  LOOP_AMPLITUDE,
  LOOP_SAMPLE_RATE,
  LOOP_SECONDS,
  MEDIA_ACTIONS,
  MediaSessionKeepalive,
  type MediaSessionLike,
  makeNoiseWav,
} from "./media-session-keepalive.js"

function mockAudio(overrides: Partial<AudioLike> = {}): AudioLike {
  return {
    paused: false,
    currentTime: 0,
    play: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function mockMediaSession(
  overrides: Partial<MediaSessionLike> & {
    throwOn?: Set<MediaSessionAction>
  } = {},
): MediaSessionLike & { handlers: Map<MediaSessionAction, (() => void) | null> } {
  const handlers = new Map<MediaSessionAction, (() => void) | null>()
  const throwOn = overrides.throwOn ?? new Set<MediaSessionAction>()
  return {
    handlers,
    playbackState: "none",
    setActionHandler(action, handler) {
      if (throwOn.has(action)) throw new DOMException("not supported", "NotSupportedError")
      handlers.set(action, handler)
    },
    ...overrides,
  }
}

describe("media-session-keepalive", () => {
  it("generates a WAV of at least the Chromium minimum duration", async () => {
    expect(LOOP_SECONDS).toBeGreaterThanOrEqual(5)
    const blob = makeNoiseWav(LOOP_SECONDS, LOOP_SAMPLE_RATE, LOOP_AMPLITUDE)
    expect(blob.type).toBe("audio/wav")
    expect(blob.size).toBe(44 + LOOP_SECONDS * LOOP_SAMPLE_RATE * 2)

    const buf = await blob.arrayBuffer()
    const view = new DataView(buf)
    const riff = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3),
    )
    const wave = String.fromCharCode(
      view.getUint8(8),
      view.getUint8(9),
      view.getUint8(10),
      view.getUint8(11),
    )
    expect(riff).toBe("RIFF")
    expect(wave).toBe("WAVE")
  })

  it("restarts the loop when the watchdog finds it paused", async () => {
    const audio = mockAudio({ paused: true })
    const keepalive = new MediaSessionKeepalive({
      audio,
      mediaSession: null,
      now: () => 1000,
    })
    const events = await keepalive.pump(1000)
    expect(audio.play).toHaveBeenCalled()
    expect(events).toContainEqual({ kind: "state-change", paused: true })
    expect(events).toContainEqual({ kind: "resume-ok" })
  })

  it("reports resume-failed instead of throwing", async () => {
    const audio = mockAudio({
      paused: true,
      play: vi.fn().mockRejectedValue(new Error("autoplay blocked")),
    })
    const keepalive = new MediaSessionKeepalive({
      audio,
      mediaSession: null,
      now: () => 0,
    })
    const events = await keepalive.pump(0)
    expect(events).toContainEqual({ kind: "resume-failed", error: "autoplay blocked" })
  })

  it("the pause action handler restarts the loop immediately", () => {
    const audio = mockAudio({ paused: true })
    const ms = mockMediaSession()
    const keepalive = new MediaSessionKeepalive({
      audio,
      mediaSession: ms,
      now: () => 42,
    })
    const onAction = vi.fn()
    keepalive.registerActionHandlers(onAction)
    const handler = ms.handlers.get("pause")
    expect(handler).toBeTypeOf("function")
    handler?.()
    expect(onAction).toHaveBeenCalledWith("pause", 42)
    expect(audio.play).toHaveBeenCalled()
    expect(ms.playbackState).toBe("playing")
  })

  it("keeps registering after one action throws NotSupportedError", () => {
    const ms = mockMediaSession({ throwOn: new Set<MediaSessionAction>(["seekto"]) })
    const keepalive = new MediaSessionKeepalive({
      audio: mockAudio(),
      mediaSession: ms,
      now: () => 0,
    })
    const count = keepalive.registerActionHandlers(() => {})
    expect(count).toBe(MEDIA_ACTIONS.length - 1)
    expect(ms.handlers.has("nexttrack")).toBe(true)
    expect(ms.handlers.has("seekto")).toBe(false)
  })

  it("emits beat events on BEAT_INTERVAL_MS cadence", async () => {
    const keepalive = new MediaSessionKeepalive({
      audio: mockAudio(),
      mediaSession: null,
      now: () => 0,
    })
    const first = await keepalive.pump(0)
    expect(first.some((e) => e.kind === "beat")).toBe(true)
    const second = await keepalive.pump(BEAT_INTERVAL_MS - 1)
    expect(second.some((e) => e.kind === "beat")).toBe(false)
    const third = await keepalive.pump(BEAT_INTERVAL_MS)
    expect(third.some((e) => e.kind === "beat")).toBe(true)
  })

  it("dispose clears all handlers without throwing", () => {
    const ms = mockMediaSession()
    const keepalive = new MediaSessionKeepalive({
      audio: mockAudio(),
      mediaSession: ms,
      now: () => 0,
    })
    keepalive.registerActionHandlers(() => {})
    keepalive.dispose()
    for (const action of MEDIA_ACTIONS) {
      expect(ms.handlers.get(action)).toBeNull()
    }
  })

  it("registerActionHandlers is no-op when mediaSession is null", () => {
    const keepalive = new MediaSessionKeepalive({
      audio: mockAudio(),
      mediaSession: null,
      now: () => 0,
    })
    expect(keepalive.registerActionHandlers(() => {})).toBe(0)
  })
})
