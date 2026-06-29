/**
 * audio-playlist.nav.test.ts — integration tests לניווט ב-AudioPlaylist (A4).
 *
 * מאמת:
 *   1. next() — cursor מתקדם; הסגמנט הבא מתנגן
 *   2. prev() — cursor חוזר; re-fetch (mock sink — markReady מחדש)
 *   3. jumpTo(index) — cursor קופץ לindex הנכון
 *   4. jumpToBubble(bubbleId) — cursor קופץ ל-item הראשון של הבועה
 *   5. reserveFromText flow — item נוסף עם bubbleId, מתנגן בתורו
 *   6. BUG-1 carry: ניווט לבועה ready-שלא-נוגן-חי (not done) — re-fetch + ניגון
 *
 * mock AudioSink: play() מחזיר Promise שמתממש רק כשקוראים לו resolvePlay(segmentId).
 * WebAudio לא נגעת — בדיקה טהורה של לוגיקת ה-playlist.
 */

import type { OrderKey } from "@drive-coding/core/voice/tts-queue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AudioPlaylist } from "./audio-playlist.svelte"
import type { AudioSink, SegmentOpts } from "./audio-sink"

// ─── Mock AudioSink ──────────────────────────────────────────────────────────

type MockSink = AudioSink & {
  playOrder: string[]
  resolvePlay: (segmentId: string) => void
  preparedSegments: Set<string>
}

function makeMockSink(): MockSink {
  const playOrder: string[] = []
  const playResolvers = new Map<string, () => void>()
  const preparedSegments = new Set<string>()

  const resolvePlay = (segmentId: string) => {
    const r = playResolvers.get(segmentId)
    if (r !== undefined) {
      r()
      playResolvers.delete(segmentId)
    }
  }

  const sink: MockSink = {
    playOrder,
    resolvePlay,
    preparedSegments,
    prepareSegment: async (
      segmentId: string,
      _stream: ReadableStream<Uint8Array>,
      _ac: AbortController,
      _opts?: SegmentOpts,
    ) => {
      preparedSegments.add(segmentId)
    },
    play: (segmentId: string) => {
      playOrder.push(segmentId)
      return new Promise<void>((resolve) => {
        playResolvers.set(segmentId, resolve)
      })
    },
    cancel: (segmentId: string) => {
      // פתור play promise אם תקוע — cancel מסמן סיום מוקדם
      resolvePlay(segmentId)
    },
    clear: () => {
      playResolvers.clear()
    },
    pause: () => {},
    resume: () => {},
  }

  return sink
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const key = (seq: number, segmentIndex = 0): OrderKey => ({ seq, segmentIndex })

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AudioPlaylist — ניווט (A4)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Test 1: next() — cursor מתקדם ──────────────────────────────────────────

  it("next() במהלך ניגון s0 → s1 מתנגן במקומו", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    playlist.reserve("s0", key(0), "bubble-A")
    playlist.reserve("s1", key(1), "bubble-A")
    playlist.reserve("s2", key(2), "bubble-A")

    playlist.markReady("s0")
    playlist.markReady("s1")
    playlist.markReady("s2")

    // אפשר ל-playLoop להתחיל ולנגן s0
    await vi.advanceTimersByTimeAsync(0)
    expect(sink.playOrder).toContain("s0")

    // next() בזמן שs0 מנגן → s1 יתנגן במקום
    playlist.next()
    // נדרש מספר microtask ticks: cancel→race-resolve→#playWithNav-returns→#playLoop-continues→s1-play
    // כל await מייצר microtask — נותנים מספיק ticks לכל ה-chain
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // s1 אמור להיות הבא (אחרי שs0 בוטל)
    expect(sink.playOrder).toContain("s1")

    sink.resolvePlay("s1")
    await vi.advanceTimersByTimeAsync(0)

    // s2 — ממשיך לנגן בסדר
    expect(sink.playOrder).toContain("s2")
    sink.resolvePlay("s2")
    await vi.advanceTimersByTimeAsync(0)

    expect(playlist.state).toBe("idle")
  })

  // ── Test 2: prev() — חוזר לסגמנט קודם, re-fetch ────────────────────────────

  it("prev() אחרי s0 סיים → cursor חוזר ל-s0 ב-reserved (re-fetch)", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    playlist.reserve("s0", key(0), "bubble-A")
    playlist.reserve("s1", key(1), "bubble-A")

    playlist.markReady("s0")
    playlist.markReady("s1")

    await vi.advanceTimersByTimeAsync(0)
    expect(sink.playOrder).toContain("s0")

    // s1 מתחיל לנגן אחרי שs0 מסיים
    sink.resolvePlay("s0")
    await vi.advanceTimersByTimeAsync(0)
    expect(sink.playOrder).toContain("s1")

    // prev() בזמן s1 מנגן → cursor חוזר ל-s0 (reserved)
    playlist.prev()
    await vi.advanceTimersByTimeAsync(0)

    // s0 חוזר ל-reserved — #playLoop ממתין ל-markReady
    const s0Item = playlist.items.find((it) => it.segmentId === "s0")
    expect(s0Item?.state).toBe("reserved")

    // simulate re-fetch: markReady שוב
    playlist.markReady("s0")
    await vi.advanceTimersByTimeAsync(0)

    // s0 מנגן שוב
    const s0Plays = sink.playOrder.filter((id) => id === "s0")
    expect(s0Plays.length).toBeGreaterThanOrEqual(2) // ניגן פעמיים (חי + אחרי prev)

    sink.resolvePlay("s0")
    await vi.advanceTimersByTimeAsync(0)
    sink.resolvePlay("s1")
    await vi.advanceTimersByTimeAsync(0)
  })

  // ── Test 3: jumpTo(index) — קפיצה לindex ──────────────────────────────────

  it("jumpTo(2) ב-3-item playlist → s2 מתנגן ראשון", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    playlist.reserve("s0", key(0), "bubble-A")
    playlist.reserve("s1", key(1), "bubble-A")
    playlist.reserve("s2", key(2), "bubble-A")

    playlist.markReady("s0")
    playlist.markReady("s1")
    playlist.markReady("s2")

    await vi.advanceTimersByTimeAsync(0)
    // s0 מתחיל לנגן
    expect(sink.playOrder).toContain("s0")

    // קפוץ ל-s2
    playlist.jumpTo(2)
    await vi.advanceTimersByTimeAsync(0)

    // s2 מסומן reserved (בגלל cancel ב-navigate); צריך markReady שוב
    const s2Item = playlist.items.find((it) => it.segmentId === "s2")
    expect(s2Item?.state).toBe("reserved")

    playlist.markReady("s2")
    await vi.advanceTimersByTimeAsync(0)

    expect(sink.playOrder).toContain("s2")
    sink.resolvePlay("s2")
    await vi.advanceTimersByTimeAsync(0)

    expect(playlist.state).toBe("idle")
  })

  // ── Test 4: jumpToBubble(bubbleId) ─────────────────────────────────────────

  it("jumpToBubble('bubble-B') → cursor קופץ ל-item הראשון של bubble-B", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    // bubble-A: s0, s1; bubble-B: s2, s3
    playlist.reserve("s0", key(0), "bubble-A")
    playlist.reserve("s1", key(1), "bubble-A")
    playlist.reserve("s2", key(2), "bubble-B")
    playlist.reserve("s3", key(3), "bubble-B")

    playlist.markReady("s0")
    playlist.markReady("s1")
    playlist.markReady("s2")
    playlist.markReady("s3")

    await vi.advanceTimersByTimeAsync(0)
    expect(sink.playOrder).toContain("s0")

    // קפוץ ל-bubble-B (index 2)
    playlist.jumpToBubble("bubble-B")
    await vi.advanceTimersByTimeAsync(0)

    // s2 חוזר ל-reserved (cancel); צריך markReady שוב
    const s2Item = playlist.items.find((it) => it.segmentId === "s2")
    expect(s2Item?.state).toBe("reserved")

    playlist.markReady("s2")
    await vi.advanceTimersByTimeAsync(0)

    expect(sink.playOrder).toContain("s2")
    sink.resolvePlay("s2")
    await vi.advanceTimersByTimeAsync(0)

    expect(sink.playOrder).toContain("s3")
    sink.resolvePlay("s3")
    await vi.advanceTimersByTimeAsync(0)

    expect(playlist.state).toBe("idle")
  })

  // ── Test 5: reserveFromText flow (via prepareSegmentForBubble) ─────────────

  it("prepareSegmentForBubble + reserve + markReady → item מתנגן", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    // reserve item חדש עם bubbleId
    playlist.reserve("s-bubble", key(0), "bubble-history")
    // simulate prepareSegment דרך wrapper
    const dummyStream = new ReadableStream<Uint8Array>()
    const ac = new AbortController()
    await playlist.prepareSegmentForBubble("s-bubble", dummyStream, ac)
    // prepareSegment נקרא ב-sink
    expect(sink.preparedSegments.has("s-bubble")).toBe(true)

    // markReady → יתחיל לנגן
    playlist.markReady("s-bubble")
    await vi.advanceTimersByTimeAsync(0)

    expect(sink.playOrder).toContain("s-bubble")
    sink.resolvePlay("s-bubble")
    await vi.advanceTimersByTimeAsync(0)

    expect(playlist.state).toBe("idle")
  })

  // ── Test 6: BUG-1 carry — ניווט לבועה ready-שלא-נוגן-חי ──────────────────

  it("BUG-1: ניווט prev ל-item ב-state=ready (לא done) → re-fetch + ניגון", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    // s0: done (כבר ניגן), s1: ready (late-early — ready אבל לא ניגן חי)
    playlist.reserve("s0", key(0), "bubble-A")
    playlist.reserve("s1", key(1), "bubble-A") // late-early segment

    playlist.markReady("s0")
    // s1 מסומן ready (flush late)
    playlist.markReady("s1")

    await vi.advanceTimersByTimeAsync(0)
    // s0 מנגן
    expect(sink.playOrder).toContain("s0")
    sink.resolvePlay("s0")
    await vi.advanceTimersByTimeAsync(0)

    // s1 מנגן (late-early — ready, עכשיו מנגן בסדר רגיל)
    expect(sink.playOrder).toContain("s1")
    // prev() לפני שs1 מסיים
    playlist.prev()
    await vi.advanceTimersByTimeAsync(0)

    // s0 חוזר ל-reserved (re-fetch נדרש — cancel מחק מה-sink)
    const s0Item = playlist.items.find((it) => it.segmentId === "s0")
    expect(s0Item?.state).toBe("reserved")

    // re-fetch s0
    playlist.markReady("s0")
    await vi.advanceTimersByTimeAsync(0)

    // s0 ניגן שוב
    const s0Plays = sink.playOrder.filter((id) => id === "s0")
    expect(s0Plays.length).toBeGreaterThanOrEqual(2)

    sink.resolvePlay("s0")
    await vi.advanceTimersByTimeAsync(0)
    sink.resolvePlay("s1")
    await vi.advanceTimersByTimeAsync(0)
  })

  // ── Test 7: cursor getter חשוף ─────────────────────────────────────────────

  it("playlist.cursor מעודכן אחרי next()", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    playlist.reserve("s0", key(0), "bubble-A")
    playlist.reserve("s1", key(1), "bubble-A")
    playlist.markReady("s0")
    playlist.markReady("s1")

    await vi.advanceTimersByTimeAsync(0)
    expect(sink.playOrder).toContain("s0")
    expect(playlist.cursor).toBe(0)

    playlist.next()
    await vi.advanceTimersByTimeAsync(0)

    // cursor עבר ל-1
    expect(playlist.cursor).toBe(1)

    playlist.markReady("s1") // re-fetch
    await vi.advanceTimersByTimeAsync(0)

    sink.resolvePlay("s1")
    await vi.advanceTimersByTimeAsync(0)
    expect(playlist.state).toBe("idle")
  })
})
