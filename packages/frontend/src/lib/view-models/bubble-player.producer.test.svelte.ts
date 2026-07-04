/**
 * bubble-player.producer.test.svelte.ts — TDD tests for BubblePlayer as SegmentProducer.
 *
 * R3 Commit 3: BubblePlayer implements SegmentProducer.
 * R4a Commit 1: seam אמיתי — הזרקת job דרך toggle() (flow-based injection).
 *
 * הסבר: ה-jobs נוצרים ב-#reserveAndPlay שנקרא מ-toggle(). מספיק להריץ toggle() על
 * bubble היסטורית (items=[] במock-playlist → ענף "היסטורי") ואז לתפוס את ה-segId
 * מ-playlist.reserveCalls[i][0]. prepareSegmentForBubble מחזיר מיידי ב-מצב ברירת-מחדל.
 *
 * ⚠️ שימו לב ל-timing: #reserveAndPlay הוא async. reserve נקרא sync בתוכו, אבל
 * synthesize נקרא אחרי כן. לכן:
 * - אחרי toggle() + await Promise.resolve() — reserveCalls מאוכלס (reserve sync)
 * - כדי לחכות לסיום synthesize — שלטו דרך mockSynthesize (החזקה/שחרור Promise)
 *
 * Tests:
 *  1. fetchState: pending job → in-flight (לפני synthesize resolve)
 *  2. fetchState: synthesize+prepareSegment resolve → idle (ready)
 *  3. fetchState: synthesize reject → failed
 *  4. fetchState: unknown segmentId → idle
 *  5. ensureFetch: idempotent על fetching job — synthesize לא נקרא שנית
 *  6. ensureFetch: idempotent על ready job — synthesize לא נקרא שנית
 *  7. cancelFetch: מסמן canceled=true + abort signal
 *  8. ghost (קריטי): cancelFetch בזמן synthesize תלוי → markReady לא נקרא
 *  9. ghost-catch: cancelFetch → synthesize reject → markError לא נקרא
 * 10. stop(): מנקה את כל ה-jobs (aborts + clears)
 * 11. reserve מעביר this כ-producer (לא thunk)
 * 12. BubblePlayer implements SegmentProducer — all 3 methods present
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BubblePlayer } from "./bubble-player.svelte"
import type { AgentSession } from "./agent-session.svelte"
import type { Settings } from "./settings.svelte"
import type { AudioPlaylist } from "$lib/engines/audio-playlist.svelte"
import type { SegmentProducer } from "$lib/engines/segment-producer"

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

vi.mock("@drive-coding/core/voice/sentence-boundary", () => ({
  splitIntoSentences: vi.fn((_text: string) => ({
    // מחזיר שני משפטים כדי שנוכל לבדוק כמה segIds נוצרו
    sentences: ["sentence one is here.", "sentence two is here."],
    remaining: "",
  })),
}))

vi.mock("$lib/adapters/voice/play-bubble", () => ({
  playUserRecording: vi.fn().mockResolvedValue(undefined),
}))

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeSession(): AgentSession & { bubbles: { id: string; kind: "message"; segments: { text: string }[] }[] } {
  return {
    status: "idle",
    turnState: "idle",
    bubbles: [
      {
        id: "bubble-1",
        kind: "message" as const,
        segments: [{ text: "This is a full narration sentence for testing bubble player." }],
      },
    ],
    isLoadingHistory: false,
    lastUserMessage: "",
    recentAssistantMessages: () => [],
  } as unknown as AgentSession & { bubbles: { id: string; kind: "message"; segments: { text: string }[] }[] }
}

function makeSettings(): Settings {
  return {
    ttsProvider: "elevenlabs",
    voiceId: "test-voice",
    geminiVoice: "Kore",
    muted: false,
  } as unknown as Settings
}

type MockPlaylist = AudioPlaylist & {
  markReadyCalls: string[]
  markErrorCalls: string[]
  reserveCalls: Array<[string, unknown, string, unknown]>
}

function makePlaylist(): MockPlaylist {
  const markReadyCalls: string[] = []
  const markErrorCalls: string[] = []
  const reserveCalls: Array<[string, unknown, string, unknown]> = []

  const playlist = {
    state: "idle" as const,
    transport: "playing" as const,
    // items=[] → toggle יכנס לענף "היסטורי" (alreadyInPlaylist=false)
    items: [] as unknown[],
    currentSegmentId: null,
    cursor: 0,
    markReadyCalls,
    markErrorCalls,
    reserveCalls,
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
  } as unknown as MockPlaylist

  return playlist
}

/**
 * מזריק job דרך toggle(). מחזיר segIds שנוצרו.
 *
 * ⚠️ splitIntoSentences mock מחזיר 2 משפטים → 2 segIds.
 * אחרי toggle() + await Promise.resolve() — reserveCalls מאוכלס (reserve sync).
 * synthesize עדיין תלוי (controlled במשתנה המוחזר).
 */
async function seedJobs(
  player: BubblePlayer,
  playlist: MockPlaylist,
  bubbleId = "bubble-1",
): Promise<{ segIds: string[] }> {
  player.toggle(bubbleId)
  // allow sync phase of #reserveAndPlay (jobs.set + reserve) to run
  await Promise.resolve()

  const segIds = playlist.reserveCalls.map((call) => call[0] as string)
  if (segIds.length === 0) {
    throw new Error("seedJobs: no jobs created — toggle didn't trigger #reserveAndPlay")
  }
  return { segIds }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("BubblePlayer as SegmentProducer", () => {
  let session: ReturnType<typeof makeSession>
  let settings: Settings
  let playlist: MockPlaylist
  let player: BubblePlayer

  beforeEach(() => {
    vi.useFakeTimers()
    mockSynthesize = vi.fn().mockReturnValue(new Promise<ReadableStream>(() => undefined)) // never resolves by default
    session = makeSession()
    settings = makeSettings()
    playlist = makePlaylist()
    player = new BubblePlayer({ session, settings, playlist })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── fetchState ───────────────────────────────────────────────────────────────

  it("(1) fetchState: pending job (לפני synthesize resolve) → in-flight", async () => {
    // synthesize never resolves → jobs stay pending/fetching
    const { segIds } = await seedJobs(player, playlist)
    const segId = segIds[0]!

    // fetchState מיד → in-flight (fetching)
    expect(player.fetchState(segId)).toBe("in-flight")
  })

  it("(2) fetchState: synthesize+prepareSegment resolve → idle (ready)", async () => {
    mockSynthesize = vi.fn().mockResolvedValue(new ReadableStream())

    const { segIds } = await seedJobs(player, playlist)
    const segId = segIds[0]!

    // תן לsynthesisize ולprepareSegmentForBubble לסיים
    await vi.runAllTimersAsync()
    for (let i = 0; i < 10; i++) await Promise.resolve()

    // ready → idle + markReady נקרא
    expect(player.fetchState(segId)).toBe("idle")
    expect(playlist.markReadyCalls).toContain(segId)
  })

  it("(3) fetchState: synthesize reject → failed", async () => {
    mockSynthesize = vi.fn().mockRejectedValue(new Error("TTS error"))

    const { segIds } = await seedJobs(player, playlist)
    const segId = segIds[0]!

    // תן לsynthesisize לנפול → catch → job.status=error
    await vi.runAllTimersAsync()
    for (let i = 0; i < 10; i++) await Promise.resolve()

    expect(player.fetchState(segId)).toBe("failed")
  })

  it("(4) fetchState: unknown segmentId → idle", () => {
    expect(player.fetchState("completely-unknown")).toBe("idle")
  })

  // ── ensureFetch idempotency ────────────────────────────────────────────────

  it("(5) ensureFetch: idempotent על fetching job — synthesize לא נקרא שנית", async () => {
    // synthesize never resolves → job נשאר fetching
    const { segIds } = await seedJobs(player, playlist)
    const segId = segIds[0]!

    const synthCountBefore = mockSynthesize.mock.calls.length

    // job ב-fetching → ensureFetch no-op (fetching → return)
    player.ensureFetch(segId)
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()

    // synthesize לא נקרא שנית
    expect(mockSynthesize.mock.calls.length).toBe(synthCountBefore)
  })

  it("(6) ensureFetch: idempotent על ready job — synthesize לא נקרא שנית", async () => {
    mockSynthesize = vi.fn().mockResolvedValue(new ReadableStream())

    const { segIds } = await seedJobs(player, playlist)
    const segId = segIds[0]!

    // המתן לסיום → job.status=ready
    await vi.runAllTimersAsync()
    for (let i = 0; i < 10; i++) await Promise.resolve()

    const synthCountBefore = mockSynthesize.mock.calls.length

    // ready → ensureFetch no-op
    player.ensureFetch(segId)
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()

    expect(mockSynthesize.mock.calls.length).toBe(synthCountBefore)
  })

  // ── cancelFetch ───────────────────────────────────────────────────────────

  it("(7) cancelFetch: מסמן canceled=true + abort signal", async () => {
    const { segIds } = await seedJobs(player, playlist)
    const segId = segIds[0]!

    player.cancelFetch(segId)

    // markReady לא נקרא (ghost-guard הגן)
    await vi.runAllTimersAsync()
    for (let i = 0; i < 10; i++) await Promise.resolve()

    expect(playlist.markReadyCalls).not.toContain(segId)
  })

  it("(8) ghost (קריטי): cancelFetch בזמן synthesize תלוי → markReady לא נקרא", async () => {
    // synthesize never resolves → חלון ל-cancelFetch
    const { segIds } = await seedJobs(player, playlist)
    const segId = segIds[0]!

    // cancelFetch בזמן synthesize עדיין תלוי
    player.cancelFetch(segId)

    // אפשר לflow לסיים (אם ה-guard נכשל → markReady יקרא)
    await vi.runAllTimersAsync()
    for (let i = 0; i < 10; i++) await Promise.resolve()

    // guard [bubble-player.svelte.ts:209]: job.canceled → return, לא קורא markReady
    expect(playlist.markReadyCalls).not.toContain(segId)
  })

  it("(9) ghost-catch: cancelFetch → synthesize reject → markError לא נקרא", async () => {
    let rejectSynth!: (e: Error) => void
    mockSynthesize = vi.fn().mockReturnValue(
      new Promise<ReadableStream>((_resolve, reject) => {
        rejectSynth = reject
      }),
    )

    const { segIds } = await seedJobs(player, playlist)
    const segId = segIds[0]!

    // cancelFetch לפני reject
    player.cancelFetch(segId)

    // reject synthesize → catch
    rejectSynth(new Error("aborted"))
    await vi.runAllTimersAsync()
    for (let i = 0; i < 10; i++) await Promise.resolve()

    // guard [bubble-player.svelte.ts:214]: job.canceled → return מה-catch, לא קורא markError
    expect(playlist.markErrorCalls).not.toContain(segId)
  })

  // ── stop() ────────────────────────────────────────────────────────────────

  it("(10) stop(): מנקה את כל ה-jobs + playingBubbleId=null", async () => {
    const { segIds } = await seedJobs(player, playlist)

    expect(segIds.length).toBeGreaterThan(0)
    expect(player.playingBubbleId).toBe("bubble-1")

    // stop() → jobs.clear + playingBubbleId=null
    player.stop()

    // fetchState על כל ה-segIds → idle (jobs נמחקו)
    for (const segId of segIds) {
      expect(player.fetchState(segId)).toBe("idle")
    }
    expect(player.playingBubbleId).toBeNull()
  })

  // ── reserve passes `this` ──────────────────────────────────────────────────

  it("(11) reserve מעביר this כ-producer (לא thunk)", async () => {
    const { segIds } = await seedJobs(player, playlist)
    expect(segIds.length).toBeGreaterThan(0)

    // הארגומנט הרביעי של reserve הוא ה-player עצמו (SegmentProducer), לא function
    const firstCall = playlist.reserveCalls[0]
    const fourthArg = firstCall?.[3]

    expect(typeof fourthArg).not.toBe("function")
    expect(typeof (fourthArg as unknown as SegmentProducer).fetchState).toBe("function")
    expect(typeof (fourthArg as unknown as SegmentProducer).ensureFetch).toBe("function")
    expect(typeof (fourthArg as unknown as SegmentProducer).cancelFetch).toBe("function")
    // הביקורת: הarg הוא בדיוק player
    expect(fourthArg).toBe(player)
  })

  // ── implements SegmentProducer ────────────────────────────────────────────

  it("(12) BubblePlayer implements SegmentProducer — all 3 methods present", () => {
    expect(typeof player.fetchState).toBe("function")
    expect(typeof player.ensureFetch).toBe("function")
    expect(typeof player.cancelFetch).toBe("function")
  })
})
