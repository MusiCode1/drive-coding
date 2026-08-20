/**
 * audio-playlist.nav.test.ts — integration tests לניווט ב-AudioPlaylist.
 *
 * מאמת (A4 — קיים):
 *   1. next() — cursor מתקדם; הסגמנט הבא מתנגן
 *   2. prev() — cursor חוזר; re-fetch (mock sink — markReady מחדש)
 *   3. jumpTo(index) — cursor קופץ לindex הנכון
 *   4. jumpToBubble(bubbleId) — cursor קופץ ל-item הראשון של הבועה
 *   5. reserveFromText flow — item נוסף עם bubbleId, מתנגן בתורו
 *   6. BUG-1 carry: ניווט לבועה ready-שלא-נוגן-חי (not done) — re-fetch + ניגון
 *   7. cursor getter חשוף
 *
 * מאמת (nav-retain — RED tests לפני שינוי הקוד):
 *   8. next ל-item done — מנגן מיידית (אין markReady חוזר)
 *   9. item שנווט אליו (done) נשאר done (לא מאופס ל-reserved)
 *  10. skip-cancel: skip על item ב-loading → sink.cancel נקרא
 *  11. idle-park: ניווט אחרי שה-loop הגיע לסוף
 *  12. refetch thunk: reserved-ללא-fetch → refetch() נקרא
 *
 * mock AudioSink: play() מחזיר Promise שמתממש רק כשקוראים לו resolvePlay(segmentId).
 * isComplete() — mock: מחזיר true אחרי play הראשון (שדה preparedSegments).
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
  cancelledSegments: string[]
  /** nav-retain: מחקה isComplete — true אחרי שה-segment נוגן לפחות פעם אחת */
  completedSegments: Set<string>
  isComplete: (id: string) => boolean
}

function makeMockSink(): MockSink {
  const playOrder: string[] = []
  const playResolvers = new Map<string, () => void>()
  const preparedSegments = new Set<string>()
  const cancelledSegments: string[] = []
  const completedSegments = new Set<string>()

  const resolvePlay = (segmentId: string) => {
    completedSegments.add(segmentId) // mark as complete when resolved
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
    cancelledSegments,
    completedSegments,
    isComplete: (id: string) => completedSegments.has(id),
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
      cancelledSegments.push(segmentId)
      // פתור play promise אם תקוע — cancel מסמן סיום מוקדם
      const r = playResolvers.get(segmentId)
      if (r !== undefined) {
        r()
        playResolvers.delete(segmentId)
      }
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

  // ── Test 2: prev() — חוזר לסגמנט קודם (nav-retain: replay מיידי אם isComplete) ──

  it("prev() אחרי s0 סיים → s0 מנגן שוב מיידית (isComplete=true → retain-replay)", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    playlist.reserve("s0", key(0), "bubble-A")
    playlist.reserve("s1", key(1), "bubble-A")

    playlist.markReady("s0")
    playlist.markReady("s1")

    await vi.advanceTimersByTimeAsync(0)
    expect(sink.playOrder).toContain("s0")

    // s0 סיים — isComplete=true (completedSegments.add("s0") ב-resolvePlay)
    sink.resolvePlay("s0")
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    expect(sink.playOrder).toContain("s1")

    // prev() בזמן s1 מנגן → cursor חוזר ל-s0 (done, isComplete=true)
    playlist.prev()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // nav-retain: s0 הוא done + isComplete=true → replay מיידי (לא re-fetch!)
    // s0 אמור לנגן שוב (ללא markReady)
    const s0Plays = sink.playOrder.filter((id) => id === "s0")
    expect(s0Plays.length).toBeGreaterThanOrEqual(2) // ניגן פעמיים (חי + אחרי prev)

    sink.resolvePlay("s0")
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
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

  // ── Test 6: nav-retain — ניווט לs0 done (isComplete=true) → replay מיידי ──────

  it("nav-retain: ניווט prev ל-item done (isComplete=true) → replay מיידי ללא re-fetch", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    // s0: done (כבר ניגן ו-resolvePlay נקרא → isComplete=true)
    // s1: נמצא ב-playing
    playlist.reserve("s0", key(0), "bubble-A")
    playlist.reserve("s1", key(1), "bubble-A")

    playlist.markReady("s0")
    playlist.markReady("s1")

    await vi.advanceTimersByTimeAsync(0)
    // s0 מנגן
    expect(sink.playOrder).toContain("s0")
    // s0 מסיים — isComplete=true
    sink.resolvePlay("s0")
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()

    // s1 מנגן
    expect(sink.playOrder).toContain("s1")
    // prev() לפני שs1 מסיים
    playlist.prev()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // nav-retain: s0 הוא done + isComplete=true → replay מיידי (לא re-fetch)
    const s0Plays = sink.playOrder.filter((id) => id === "s0")
    expect(s0Plays.length).toBeGreaterThanOrEqual(2)

    sink.resolvePlay("s0")
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Tests 8-12: nav-retain RED tests (פלייליסט ממומש)
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Test 8: next ל-item done — ניגון מיידי (אין markReady חוזר) ────────────

  it("(retain-8) next ל-item done → מנגן מיידית בלי markReady חוזר", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    playlist.reserve("s0", key(0), "bubble-A")
    playlist.reserve("s1", key(1), "bubble-A")
    playlist.reserve("s2", key(2), "bubble-A")

    playlist.markReady("s0")
    playlist.markReady("s1")
    playlist.markReady("s2")

    // הניגון מתחיל
    await vi.advanceTimersByTimeAsync(0)
    expect(sink.playOrder).toContain("s0")

    // ניגן s0 + s1 עד סיום
    sink.resolvePlay("s0")
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    expect(sink.playOrder).toContain("s1")
    sink.resolvePlay("s1")
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    // s2 מתנגן עכשיו
    expect(sink.playOrder).toContain("s2")

    // s1 עכשיו done (ניגן וסיים). נחזור אליו עם prev()
    // prev() ל-s1 (done) — לפי ה-retain: צריך לנגן מיידית בלי markReady
    playlist.prev()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // בקוד החדש: s1 אמור להתנגן שוב (isComplete=true → replay, לא reset)
    // בקוד הישן: s1 מאופס ל-reserved → #playLoop מחכה ל-markReady → 20 שניות timeout
    const s1Plays = sink.playOrder.filter((id) => id === "s1")
    expect(s1Plays.length).toBeGreaterThanOrEqual(2) // ניגן פעמיים

    sink.resolvePlay("s1")
    sink.resolvePlay("s2")
    await vi.advanceTimersByTimeAsync(0)
  })

  // ── Test 9: item שנווט אליו (done) → לא מאופס ל-reserved, מנגן מחדש ──────────

  it("(retain-9) prev ל-done item — לא מאופס ל-reserved (retain-replay, לא re-fetch)", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    playlist.reserve("s0", key(0), "bubble-A")
    playlist.reserve("s1", key(1), "bubble-A")
    playlist.reserve("s2", key(2), "bubble-A")

    playlist.markReady("s0")
    playlist.markReady("s1")
    playlist.markReady("s2")

    await vi.advanceTimersByTimeAsync(0)
    // ניגן s0 + s1 עד סיום
    sink.resolvePlay("s0")
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    expect(sink.playOrder).toContain("s1")
    sink.resolvePlay("s1")
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    // s2 מתנגן
    expect(sink.playOrder).toContain("s2")

    // s0, s1 הם done + isComplete=true
    const s0Item = playlist.items.find((it) => it.segmentId === "s0")
    const s1Item = playlist.items.find((it) => it.segmentId === "s1")
    expect(s0Item?.state).toBe("done")
    expect(s1Item?.state).toBe("done")

    // prev() → s1. בקוד החדש: s1 isComplete=true → אל ישנה ל-reserved
    playlist.prev()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // nav-retain: s1 לא הוחזר ל-reserved — replay ישיר
    // state עובר ל-playing בעת הניגון, ואחריו חזרה ל-done
    // בכל מקרה — reserved אסור
    expect(s1Item?.state).not.toBe("reserved")

    // s1 אמור לנגן שוב (replay)
    const s1Plays = sink.playOrder.filter((id) => id === "s1")
    expect(s1Plays.length).toBeGreaterThanOrEqual(2)

    sink.resolvePlay("s1")
    sink.resolvePlay("s2")
    await vi.advanceTimersByTimeAsync(0)
  })

  // ── Test 10: skip-cancel — cancel נקרא על item ב-loading ──────────────────

  it("(retain-10) skip (next) על item ב-loading → sink.cancel נקרא", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 30000 })

    // s0: ready מיד. s1: loading (fetch ארוך בכוונה — reserveTimeoutMs גדול)
    playlist.reserve("s0", key(0), "bubble-A")
    playlist.reserve("s1", key(1), "bubble-A") // loading — לא נקרא markReady
    playlist.reserve("s2", key(2), "bubble-A")
    playlist.markReady("s2")

    playlist.markReady("s0")
    // s1 נשאר reserved/loading

    await vi.advanceTimersByTimeAsync(0)
    // s0 מתנגן
    expect(sink.playOrder).toContain("s0")
    sink.resolvePlay("s0")
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    // עכשיו #playLoop מחכה על s1 (loading/reserved) — timeout 30s

    // next() → מדלג על s1 (שנמצא ב-reserved/loading)
    // בקוד החדש: skip-cancel — isComplete(s1)=false → cancel נקרא
    // בקוד הישן: cancel תמיד קורה על הנוכחי (s0, כבר done)
    playlist.next()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // sink.cancel צריך להיקרא על s1 (item שנמצא ב-loading)
    expect(sink.cancelledSegments).toContain("s1")

    // s1 חוזר ל-reserved (לצורך re-fetch בביקור עתידי)
    const s1Item = playlist.items.find((it) => it.segmentId === "s1")
    expect(s1Item?.state).toBe("reserved")

    // s2 מתנגן (אחרי skip s1)
    playlist.markReady("s2") // re-mark (בקוד הישן jump reset אותו)
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    sink.resolvePlay("s2")
    await vi.advanceTimersByTimeAsync(0)
  })

  // ── Test 11: idle-park — ניווט אחרי שה-loop הגיע לסוף ─────────────────────

  it("(retain-11) ניווט prev אחרי סיום כל הפלייליסט — עדיין עובד", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    playlist.reserve("s0", key(0), "bubble-A")
    playlist.reserve("s1", key(1), "bubble-A")

    playlist.markReady("s0")
    playlist.markReady("s1")

    await vi.advanceTimersByTimeAsync(0)
    sink.resolvePlay("s0")
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    sink.resolvePlay("s1")
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()

    // #playLoop הגיע לסוף הפלייליסט
    // בקוד הישן: state=idle, #playing=false → prev() no-op (if (!this.#playing) return)
    // בקוד החדש: idle-park — #playing=true, state=idle, ממתין על #navResolve

    // prev() אחרי סוף → s1 (done) צריך לנגן שוב
    playlist.prev()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // s1 צריך לנגן שוב (retain — isComplete=true → replay מיידי)
    const s1Plays = sink.playOrder.filter((id) => id === "s1")
    expect(s1Plays.length).toBeGreaterThanOrEqual(2)

    sink.resolvePlay("s1")
    await vi.advanceTimersByTimeAsync(0)
  })

  // ── Test 12: refetch thunk נקרא על reserved-ללא-fetch ─────────────────────

  it("(retain-12) refetch לא נקרא על reserved רגיל — רק על item שנזרק (needsRefetch)", async () => {
    // תיקון סופת-fetch: item שנוצר ב-reserve() רגיל (זרם חי) חייב להמתין ל-markReady
    // החיצוני של Speaker, ולא להפעיל refetch. refetch שמור ל-item שנזרק ב-skip-cancel.
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    let refetchCount = 0
    const owner = {
      refetch: () => {
        refetchCount++
      },
      invalidate: () => {},
    }

    // s0: reserved עם owner (הזרם החי בדרך — לא נזרק). s1: ready.
    playlist.reserve("s0", key(0), "bubble-A", owner)
    playlist.reserve("s1", key(1), "bubble-A")
    playlist.markReady("s1")

    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()

    // ✅ הליבה: s0 reserved אך needsRefetch כבוי → refetch לא נקרא
    expect(refetchCount).toBe(0)

    // הזרם החי מגיע (כמו Speaker.#fetchJob) → markReady חיצוני, לא refetch
    playlist.markReady("s0")
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()

    expect(refetchCount).toBe(0) // עדיין 0 — אף פעם לא refetch על reserved רגיל
    expect(sink.playOrder).toContain("s0")

    sink.resolvePlay("s0")
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    sink.resolvePlay("s1")
    await vi.advanceTimersByTimeAsync(0)
  })

  // ── lifecycle commit 1: SegmentOwner + invalidate ───────────────────────────

  it("(lifecycle-1) invalidate נקרא על skip-cancel", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })
    const invalidate = vi.fn()
    const owner = { refetch: vi.fn(), invalidate }

    playlist.reserve("s0", key(0), "bubble-A", owner)
    playlist.reserve("s1", key(1), "bubble-A")
    playlist.markReady("s1")

    await vi.advanceTimersByTimeAsync(0)
    playlist.next()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    await Promise.resolve()

    expect(invalidate).toHaveBeenCalledWith("s0")
  })

  it("(lifecycle-2) markReady מאוחר אחרי invalidate — לא הופך ל-ready", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })
    const owner = { refetch: vi.fn(), invalidate: vi.fn() }

    playlist.reserve("s0", key(0), "bubble-A", owner)
    playlist.reserve("s1", key(1), "bubble-A")
    playlist.next()
    await vi.advanceTimersByTimeAsync(0)

    playlist.markReady("s0")
    const item = playlist.items.find((it) => it.segmentId === "s0")
    expect(item?.state).toBe("reserved")
  })

  it("(lifecycle-3) invalidate על completed — לא נקרא", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })
    const invalidate = vi.fn()
    const owner = { refetch: vi.fn(), invalidate }

    playlist.reserve("s0", key(0), "bubble-A", owner)
    playlist.markReady("s0")
    sink.completedSegments.add("s0")

    playlist.reserve("s1", key(1), "bubble-A")
    playlist.markReady("s1")
    await vi.advanceTimersByTimeAsync(0)

    playlist.next()
    await vi.advanceTimersByTimeAsync(0)

    expect(invalidate).not.toHaveBeenCalled()
  })


  it("(lifecycle-4b) stop()+reserve() → loop אחד בלבד", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    playlist.reserve("s0", key(0), "bubble-A")
    playlist.markReady("s0")
    await vi.advanceTimersByTimeAsync(0)

    playlist.stop()
    playlist.reserve("s1", key(1), "bubble-A")
    playlist.markReady("s1")
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    await Promise.resolve()

    expect(sink.playOrder.filter((id) => id === "s1").length).toBeLessThanOrEqual(1)
  })

  it("(lifecycle-4c) insert לפני cursor בזמן ניגון — cursor עוקב אחרי segmentId", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    playlist.reserve("s0", key(0), "bubble-A")
    playlist.reserve("s1", key(2), "bubble-A")
    playlist.markReady("s0")
    playlist.markReady("s1")
    await vi.advanceTimersByTimeAsync(0)

    const playingId = playlist.items[playlist.cursor]?.segmentId
    expect(playingId).toBe("s0")

    playlist.reserve("sX", key(1), "bubble-A")
    playlist.markReady("sX")
    await vi.advanceTimersByTimeAsync(0)

    expect(playlist.items[playlist.cursor]?.segmentId).toBe(playingId)
  })

})
