/**
 * speaker.producer.test.svelte.ts — TDD tests for Speaker as SegmentProducer.
 *
 * R3 Commit 2: Speaker implements SegmentProducer.
 * R4a Commit 0: seam אמיתי — הזרקת job דרך _seedJobForTest (test-only seam).
 *
 * הסבר: $effect.root לא רץ בסביבת vitest/node, ולכן flushSync אינו יכול
 * להזריק job דרך ה-flow הרגיל. הפתרון: _seedJobForTest קורא ל-#enqueue ישירות
 * ומחזיר segId — seam מינימלי (מוגדר ב-R4a ונמחק ב-Commit 3 יחד עם refetchSegment).
 *
 * Tests:
 *   1. fetchState: job חדש (pending/fetching) → in-flight
 *   2. fetchState: job אחרי synthesize resolve → in-flight (עדיין fetching)
 *   3. fetchState: synthesize reject → failed
 *   4. fetchState: job מוכן (prepareSegment + markReady) → idle
 *   5. fetchState: unknown segmentId → idle
 *   6. ensureFetch: idempotent על fetching job — reserve לא נקרא שנית
 *   7. ensureFetch: idempotent על ready job — reserve לא נקרא שנית
 *   8. cancelFetch: מסמן canceled=true + abort signal
 *   9. ghost (קריטי): cancelFetch בזמן prepareSegment תלוי → markReady לא נקרא
 *  10. ghost-catch: cancelFetch → synthesize reject → markError לא נקרא
 *  11. Speaker implements SegmentProducer — all 3 methods present
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Speaker } from "./speaker.svelte"
import type { AgentSession } from "./agent-session.svelte"
import type { Settings } from "./settings.svelte"
import type { AudioSink } from "$lib/engines/audio-sink"
import type { AudioPlaylist } from "$lib/engines/audio-playlist.svelte"

// ─── mocks ────────────────────────────────────────────────────────────────────

let mockSynthesize = vi.fn().mockResolvedValue(new ReadableStream())

vi.mock("$lib/adapters/voice/tts-resolve", () => ({
  resolveTts: vi.fn(() => ({
    provider: {
      synthesize: (...args: unknown[]) => mockSynthesize(...args),
      format: "mp3",
    },
    voiceId: "voice-test",
    modelId: "model-test",
  })),
}))

vi.mock("$lib/adapters/voice/translate", () => ({
  translate: vi.fn().mockResolvedValue(null),
}))

vi.mock("$lib/adapters/voice/narrate", () => ({
  narrate: vi.fn().mockResolvedValue(null),
}))

vi.mock("$lib/view-models/capabilities.svelte", () => ({
  ttsCapabilities: {
    isAvailable: vi.fn(() => true),
  },
}))

vi.mock("@drive-coding/core/voice/cache-key", () => ({
  cacheKeyFor: vi.fn().mockResolvedValue("hash-mock"),
}))

vi.mock("@drive-coding/core/voice/sentence-boundary", () => ({
  splitIntoSentences: vi.fn((_text: string) => ({ sentences: [_text], remaining: "" })),
}))

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeSession(): AgentSession {
  return {
    status: "idle",
    turnState: "idle",
    bubbles: [],
    isLoadingHistory: false,
    lastUserMessage: "",
    recentAssistantMessages: () => [],
  } as unknown as AgentSession
}

function makeSettings(): Settings {
  return {
    muted: false,
    ttsProvider: "elevenlabs",
    voiceId: "test-voice",
    geminiVoice: "Kore",
    speakThoughts: false,
    narrateTools: false,
    translateThoughts: false,
    setMuted: vi.fn(),
  } as unknown as Settings
}

function makeAudioSink(): AudioSink {
  return {
    prepareSegment: vi.fn().mockResolvedValue(undefined),
    play: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
    clear: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    isComplete: vi.fn(() => false),
    stopCurrent: vi.fn(),
  } as unknown as AudioSink
}

function makePlaylist(): {
  playlist: AudioPlaylist
  markReadyCalls: string[]
  markErrorCalls: string[]
  reserveCalls: Array<[string, unknown, string, unknown]>
} {
  const markReadyCalls: string[] = []
  const markErrorCalls: string[] = []
  const reserveCalls: Array<[string, unknown, string, unknown]> = []

  const playlist = {
    state: "idle" as const,
    transport: "playing" as const,
    items: [],
    currentSegmentId: null,
    cursor: 0,
    reserve: vi.fn((...args: [string, unknown, string, unknown]) => {
      reserveCalls.push(args)
    }),
    markReady: vi.fn((id: string) => {
      markReadyCalls.push(id)
    }),
    markError: vi.fn((id: string) => {
      markErrorCalls.push(id)
    }),
    setOnPlaybackStart: vi.fn(),
    stop: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
    jumpTo: vi.fn(),
    jumpToBubble: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    prepareSegmentForBubble: vi.fn().mockResolvedValue(undefined),
  } as unknown as AudioPlaylist

  return { playlist, markReadyCalls, markErrorCalls, reserveCalls }
}

// ─── SpeakerWithSeam helper type ──────────────────────────────────────────────

type SpeakerWithSeam = Speaker & {
  _seedJobForTest(text: string): string
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Speaker as SegmentProducer", () => {
  let session: AgentSession
  let settings: Settings
  let sink: AudioSink
  let pm: ReturnType<typeof makePlaylist>
  let speaker: SpeakerWithSeam

  const SEED_TEXT = "This is a full narration sentence for testing."

  beforeEach(() => {
    vi.useFakeTimers()
    mockSynthesize = vi.fn().mockResolvedValue(new ReadableStream())
    session = makeSession()
    settings = makeSettings()
    sink = makeAudioSink()
    pm = makePlaylist()
    speaker = new Speaker({
      session,
      settings,
      playlist: pm.playlist,
      audioStream: sink,
    }) as SpeakerWithSeam
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── fetchState ───────────────────────────────────────────────────────────────

  it("(1) fetchState: pending/fetching job → in-flight", () => {
    // synthesize לעולם לא resolves → job נשאר pending/fetching
    mockSynthesize = vi.fn().mockReturnValue(new Promise<ReadableStream>(() => undefined))
    const segId = speaker._seedJobForTest(SEED_TEXT)

    // job נוצר ויש לו status pending או fetching (תלוי בmicrotask timing)
    // בשני המקרים fetchState → "in-flight"
    expect(speaker.fetchState(segId)).toBe("in-flight")
  })

  it("(2) fetchState: job ב-fetching (אחרי pumpFetchLoop) → in-flight", async () => {
    mockSynthesize = vi.fn().mockReturnValue(new Promise<ReadableStream>(() => undefined))
    const segId = speaker._seedJobForTest(SEED_TEXT)

    // אפשר ל-#pumpFetchLoop לרוץ → job.status=fetching
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()

    expect(speaker.fetchState(segId)).toBe("in-flight")
  })

  it("(3) fetchState: synthesize reject → failed", async () => {
    mockSynthesize = vi.fn().mockRejectedValue(new Error("TTS error"))
    const segId = speaker._seedJobForTest(SEED_TEXT)

    // תן ל-#fetchJob לסיים:
    // #pumpFetchLoop → #fetchJob → cacheKeyFor(await) → synthesize(rejects) → catch → job.status=error
    // runAllTimersAsync מנקה timers + microtasks, לולאת Promise.resolve מנקה את שרשרת ה-await
    await vi.runAllTimersAsync()
    for (let i = 0; i < 10; i++) await Promise.resolve()

    expect(speaker.fetchState(segId)).toBe("failed")
  })

  it("(4) fetchState: synthesize+prepareSegment resolve → idle (ready)", async () => {
    mockSynthesize = vi.fn().mockResolvedValue(new ReadableStream())
    const segId = speaker._seedJobForTest(SEED_TEXT)

    // תן ל-#fetchJob לסיים:
    // #pumpFetchLoop → #fetchJob → cacheKeyFor(await) → synthesize(resolves) →
    // prepareSegment(resolves) → markReady → job.status=ready
    await vi.runAllTimersAsync()
    for (let i = 0; i < 10; i++) await Promise.resolve()

    // ready → idle (product handed to sink)
    expect(speaker.fetchState(segId)).toBe("idle")
    // markReady נקרא
    expect(pm.markReadyCalls).toContain(segId)
  })

  it("(5) fetchState: unknown segmentId → idle", () => {
    expect(speaker.fetchState("completely-unknown")).toBe("idle")
  })

  // ── ensureFetch idempotency ────────────────────────────────────────────────

  it("(6) ensureFetch: idempotent על fetching job — reserve לא נקרא שנית", () => {
    // synthesize never resolves → job נשאר pending/fetching
    mockSynthesize = vi.fn().mockReturnValue(new Promise<ReadableStream>(() => undefined))
    const segId = speaker._seedJobForTest(SEED_TEXT)
    const reserveCountBefore = pm.reserveCalls.length // 1 (מה-seedJob)

    // job ב-fetching → ensureFetch no-op (fetching/ready → return)
    speaker.ensureFetch(segId)

    // reserve לא נקרא שנית (idempotency)
    expect(pm.reserveCalls.length).toBe(reserveCountBefore)
  })

  it("(7) ensureFetch: idempotent על ready job — reserve לא נקרא שנית", async () => {
    mockSynthesize = vi.fn().mockResolvedValue(new ReadableStream())
    const segId = speaker._seedJobForTest(SEED_TEXT)

    // המתן לסיום → job.status=ready
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()

    const reserveCountBefore = pm.reserveCalls.length

    speaker.ensureFetch(segId)

    // ready → no-op, reserve לא נקרא שנית
    expect(pm.reserveCalls.length).toBe(reserveCountBefore)
  })

  // ── cancelFetch ───────────────────────────────────────────────────────────

  it("(8) cancelFetch: מסמן job.canceled ומבטיח שmarkReady לא נקרא", async () => {
    mockSynthesize = vi.fn().mockReturnValue(new Promise<ReadableStream>(() => undefined))
    const segId = speaker._seedJobForTest(SEED_TEXT)

    speaker.cancelFetch(segId)

    // תן זמן ל-#fetchJob לסיים (אם יסיים)
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()

    // markReady לא נקרא (ghost-guard הגן)
    expect(pm.markReadyCalls).not.toContain(segId)
  })

  it("(9) ghost (קריטי): cancelFetch בזמן prepareSegment תלוי → markReady לא נקרא", async () => {
    // synthesize resolves מיד, prepareSegment תלוי (חלון ל-cancelFetch)
    mockSynthesize = vi.fn().mockResolvedValue(new ReadableStream())
    let resolvePrepare!: () => void
    const preparePromise = new Promise<void>((resolve) => {
      resolvePrepare = resolve
    })
    ;(sink as unknown as { prepareSegment: ReturnType<typeof vi.fn> }).prepareSegment = vi.fn(
      async () => { await preparePromise },
    )

    const segId = speaker._seedJobForTest(SEED_TEXT)

    // תן ל-synthesize לסיים (prepareSegment עדיין תלוי — ghost window)
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    await Promise.resolve()

    // cancelFetch בזמן prepareSegment תלוי
    speaker.cancelFetch(segId)

    // שחרר prepareSegment — #fetchJob יגיע ל-guard job.canceled → return
    resolvePrepare()
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // guard [speaker.ts:507]: job.canceled → return, לא קורא markReady
    expect(pm.markReadyCalls).not.toContain(segId)
  })

  it("(10) ghost-catch: cancelFetch → synthesize reject → markError לא נקרא", async () => {
    let rejectSynth!: (e: Error) => void
    mockSynthesize = vi.fn().mockReturnValue(
      new Promise<ReadableStream>((_resolve, reject) => {
        rejectSynth = reject
      }),
    )

    const segId = speaker._seedJobForTest(SEED_TEXT)

    // תן ל-#fetchJob להתחיל
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()

    // cancelFetch לפני reject
    speaker.cancelFetch(segId)

    // reject synthesize → catch
    rejectSynth(new Error("aborted"))
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()

    // guard [speaker.ts:513]: job.canceled → return מה-catch, לא קורא markError
    expect(pm.markErrorCalls).not.toContain(segId)
  })

  // ── implements SegmentProducer interface ──────────────────────────────────

  it("(11) Speaker implements SegmentProducer — all 3 methods present", () => {
    expect(typeof speaker.fetchState).toBe("function")
    expect(typeof speaker.ensureFetch).toBe("function")
    expect(typeof speaker.cancelFetch).toBe("function")
  })
})
