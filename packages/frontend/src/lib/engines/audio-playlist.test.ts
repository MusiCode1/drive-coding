/**
 * audio-playlist.test.ts — integration tests for AudioPlaylist.
 *
 * מאמת:
 *   1. סדר-ניגון הפוך: markReady(s1) לפני markReady(s0) → s0 מתנגן קודם
 *   2. timeout → item skipped, המשך לבא
 *   3. error → item מדולג, המשך לבא
 *   4. stop() באמצע → לא ממשיך
 *   5. onPlaybackStart callback
 *   6. sorted-insert
 *   7. re-entrancy guard
 *
 * mock AudioSink: play() resolves via resolvePlay(); isComplete after markReady or prepareSegment.
 * WebAudio לא נגעת — בדיקה טהורה של לוגיקת ה-playlist.
 */

import type { OrderKey } from "@drive-coding/core/voice/tts-queue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AudioPlaylist } from "./audio-playlist.svelte"
import { flush, installSyncInvariantChecks } from "./audio-playlist-invariants"
import type { AudioSink } from "./audio-sink"

// ─── Mock AudioSink ──────────────────────────────────────────────────────────

type MockSink = AudioSink & {
  playOrder: string[]
  resolvePlay: (segmentId: string) => void
  preparedSegments: Set<string>
  bufferedSegments: Set<string>
  isComplete: (id: string) => boolean
  noteBuffered: (segmentId: string) => void
}

function makeMockSink(): MockSink {
  const playOrder: string[] = []
  const playResolvers = new Map<string, () => void>()
  const preparedSegments = new Set<string>()
  const bufferedSegments = new Set<string>()

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
    bufferedSegments,
    noteBuffered: (segmentId: string) => {
      bufferedSegments.add(segmentId)
    },
    isComplete: (id: string) => preparedSegments.has(id) || bufferedSegments.has(id),
    prepareSegment: async (segmentId: string) => {
      preparedSegments.add(segmentId)
    },
    play: (segmentId) => {
      playOrder.push(segmentId)
      return new Promise<void>((resolve) => {
        playResolvers.set(segmentId, resolve)
      })
    },
    cancel: (segmentId) => {
      preparedSegments.delete(segmentId)
      bufferedSegments.delete(segmentId)
      resolvePlay(segmentId)
    },
    clear: () => {
      playResolvers.clear()
    },
    pause: () => {
      // no-op — בדיקה ב-JSDOM; התנהגות אמיתית (AudioContext.suspend) לא נבדקת כאן
    },
    resume: () => {
      // no-op
    },
  }

  return sink
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const key = (seq: number, segmentIndex = 0): OrderKey => ({ seq, segmentIndex })

/** מאפשר micro/macrotask queue לרוץ — אחרי setTimeout/Promise */
const _tick = () => new Promise<void>((r) => setTimeout(r, 0))

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AudioPlaylist", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Test 1: סדר הפוך ─────────────────────────────────────────────────────

  it("markReady(s1) לפני markReady(s0) → s0 מתנגן קודם (race-reversal)", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    installSyncInvariantChecks(playlist, sink)

    playlist.reserve("s0", key(0), "bubble-0")
    playlist.reserve("s1", key(1), "bubble-1")

    // s1 מגיע מוכן לפני s0 — כמו Gemini fetch שחוזר בסדר הפוך
    playlist.markReady("s1")

    // נאפשר מהלך: #playLoop התחיל ומחכה ל-s0
    await flush(playlist, sink)

    // s0 עדיין לא התנגן (ממתין ל-markReady)
    expect(sink.playOrder).toEqual([])

    // עכשיו s0 מגיע
    playlist.markReady("s0")
    await flush(playlist, sink)

    // s0 אמור להיות ראשון בתור ניגון
    expect(sink.playOrder.length).toBeGreaterThanOrEqual(1)
    expect(sink.playOrder[0]).toBe("s0")

    // פתור play של s0 ואפשר s1 לנגן
    sink.resolvePlay("s0")
    await flush(playlist, sink)

    expect(sink.playOrder.length).toBeGreaterThanOrEqual(2)
    expect(sink.playOrder[1]).toBe("s1")

    sink.resolvePlay("s1")
    await flush(playlist, sink)

    expect(playlist.state).toBe("idle")
  })

  // ── Test 2: timeout → skipped ─────────────────────────────────────────────

  it("timeout על s0 → s0 skipped, s1 מתנגן", async () => {
    const sink = makeMockSink()
    const TIMEOUT = 500
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: TIMEOUT })

    installSyncInvariantChecks(playlist, sink)

    playlist.reserve("s0", key(0), "bubble-0")
    playlist.reserve("s1", key(1), "bubble-1")

    // s1 מוכן מיד, s0 לא יגיע אף פעם (timeout)
    playlist.markReady("s1")

    // ממתינים ל-s0 עוד לא הגיע
    await flush(playlist, sink)
    expect(sink.playOrder).toEqual([]) // עדיין מחכה ל-s0

    // מקדמים את הזמן מעבר ל-timeout
    await vi.advanceTimersByTimeAsync(TIMEOUT + 1)

    // s0 אמור להיות skipped, s1 צריך לנגן
    const s0Item = playlist.items.find((it) => it.segmentId === "s0")
    expect(s0Item?.state).toBe("skipped")

    expect(sink.playOrder.length).toBeGreaterThanOrEqual(1)
    expect(sink.playOrder[0]).toBe("s1")

    sink.resolvePlay("s1")
    await flush(playlist, sink)

    expect(playlist.state).toBe("idle")
  })

  // ── Test 3: error → skip ──────────────────────────────────────────────────

  it("markError(s0) → s0 מדולג, s1 מתנגן", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    installSyncInvariantChecks(playlist, sink)

    playlist.reserve("s0", key(0), "bubble-0")
    playlist.reserve("s1", key(1), "bubble-1")

    playlist.markReady("s1")

    // s0 נכשל
    playlist.markError("s0")
    await flush(playlist, sink)

    // s0 לא ניגן (error)
    expect(sink.playOrder).not.toContain("s0")

    // s1 אמור לנגן
    expect(sink.playOrder.length).toBeGreaterThanOrEqual(1)
    expect(sink.playOrder[0]).toBe("s1")

    const s0Item = playlist.items.find((it) => it.segmentId === "s0")
    expect(s0Item?.state).toBe("error")

    sink.resolvePlay("s1")
    await flush(playlist, sink)

    expect(playlist.state).toBe("idle")
  })

  // ── Test 4: stop() באמצע ──────────────────────────────────────────────────

  it("stop() תוך כדי המתנה → playlist עוצר ולא ממשיך", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    installSyncInvariantChecks(playlist, sink)

    playlist.reserve("s0", key(0), "bubble-0")
    playlist.reserve("s1", key(1), "bubble-1")

    // ממתין ל-s0 שלא יגיע
    await flush(playlist, sink)

    // עוצר את ה-playlist
    playlist.stop()
    await flush(playlist, sink)

    // אחרי stop — items ריק, state=idle
    expect(playlist.items).toEqual([])
    expect(playlist.state).toBe("idle")

    // s0 ו-s1 לא ניגנו
    expect(sink.playOrder).toEqual([])
  })

  // ── Test 5: onPlaybackStart callback ─────────────────────────────────────

  it("onPlaybackStart נקרא פעם אחת כש-idle→playing", async () => {
    const sink = makeMockSink()
    const onStart = vi.fn()
    const playlist = new AudioPlaylist(sink, onStart, { reserveTimeoutMs: 1000 })

    installSyncInvariantChecks(playlist, sink)

    playlist.reserve("s0", key(0), "bubble-0")
    playlist.markReady("s0")
    await flush(playlist, sink)

    expect(onStart).toHaveBeenCalledTimes(1)
    sink.resolvePlay("s0")
    await flush(playlist, sink)

    expect(playlist.state).toBe("idle")

    // שני reserve נוסף — onStart נקרא שוב (idle→playing חדש)
    playlist.reserve("s1", key(1), "bubble-1")
    playlist.markReady("s1")
    await flush(playlist, sink)

    expect(onStart).toHaveBeenCalledTimes(2)
    sink.resolvePlay("s1")
    await flush(playlist, sink)
  })

  // ── Test 6: sorted-insert — reserve מחוץ לסדר ───────────────────────────

  it("reserve מחוץ לסדר כרונולוגי → items ממוינים לפי orderKey", () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 1000 })

    installSyncInvariantChecks(playlist, sink)

    // הכנסה בסדר הפוך
    playlist.reserve("s2", key(2), "bubble-2")
    playlist.reserve("s0", key(0), "bubble-0")
    playlist.reserve("s1", key(1), "bubble-1")

    expect(playlist.items.map((it) => it.segmentId)).toEqual(["s0", "s1", "s2"])
    playlist.stop()
  })

  // ── Test 7: re-entrancy guard — reserve כשכבר playing ───────────────────

  it("reserve כשכבר playing — לא מתחיל #playLoop שנייה", async () => {
    const sink = makeMockSink()
    const onStart = vi.fn()
    const playlist = new AudioPlaylist(sink, onStart, { reserveTimeoutMs: 1000 })

    installSyncInvariantChecks(playlist, sink)

    playlist.reserve("s0", key(0), "bubble-0")
    playlist.markReady("s0")
    await flush(playlist, sink)

    // s0 בניגון — הוסף s1 תוך כדי
    playlist.reserve("s1", key(1), "bubble-1")
    playlist.markReady("s1")
    await flush(playlist, sink)

    // onPlaybackStart נקרא פעם אחת בלבד (re-entrancy guard)
    expect(onStart).toHaveBeenCalledTimes(1)

    // פתור s0 → s1 ינגן
    sink.resolvePlay("s0")
    await flush(playlist, sink)

    expect(sink.playOrder).toContain("s1")
    sink.resolvePlay("s1")
    await flush(playlist, sink)

    expect(playlist.state).toBe("idle")
  })

  // ── Test 8: pause() → #playLoop ממתין, resume() → ממשיך מאותו cursor ──────

  it("pause() במהלך ניגון → #playLoop מקפיא; resume() → ממשיך מאותו cursor", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    installSyncInvariantChecks(playlist, sink)

    playlist.reserve("s0", key(0), "bubble-0")
    playlist.reserve("s1", key(1), "bubble-1")
    playlist.markReady("s0")
    playlist.markReady("s1")

    // אפשר ל-playLoop להתחיל ולהגיע ל-play(s0)
    await flush(playlist, sink)
    expect(sink.playOrder).toContain("s0")

    // סיים s0 — loop מתקדם ל-s1
    sink.resolvePlay("s0")
    await flush(playlist, sink)

    // pause לפני שs1 מתחיל (s1 עדיין "ready" — עשוי כבר להתחיל, תלוי ב-tick)
    // הבדיקה: אחרי pause, transport=paused
    playlist.pause()
    expect(playlist.transport).toBe("paused")

    // resume — transport=playing, loop ממשיך
    playlist.resume()
    expect(playlist.transport).toBe("playing")

    // s1 אמור לנגן
    await flush(playlist, sink)
    expect(sink.playOrder).toContain("s1")

    sink.resolvePlay("s1")
    await flush(playlist, sink)
    expect(playlist.state).toBe("idle")
  })

  // ── Test 9: stop() בזמן paused → loop יוצא, transport="stopped" ─────────

  it("stop() בזמן paused → #playLoop יוצא, transport=stopped, state=idle", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    installSyncInvariantChecks(playlist, sink)

    playlist.reserve("s0", key(0), "bubble-0")
    playlist.reserve("s1", key(1), "bubble-1")
    playlist.markReady("s0")
    playlist.markReady("s1")
    await flush(playlist, sink)

    // pause כשs0 מתנגן
    playlist.pause()
    expect(playlist.transport).toBe("paused")

    // stop בזמן pause — שחרר waitForResume ויצא
    playlist.stop()
    await flush(playlist, sink)

    expect(playlist.transport).toBe("stopped")
    expect(playlist.state).toBe("idle")
    expect(playlist.items).toEqual([])
  })

  // ── Test 10: reserve() אחרי stop() → transport מתאפס ל-"playing" ──────────

  it("reserve() אחרי stop() → transport מתאפס ל-playing, תור חדש מנוגן", async () => {
    const sink = makeMockSink()
    const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    installSyncInvariantChecks(playlist, sink)

    // ריצה ראשונה
    playlist.reserve("s0", key(0), "bubble-0")
    playlist.markReady("s0")
    await flush(playlist, sink)
    sink.resolvePlay("s0")
    await flush(playlist, sink)

    // עצור
    playlist.stop()
    expect(playlist.transport).toBe("stopped")

    // תור חדש אחרי stop
    playlist.reserve("s1", key(1), "bubble-1")
    expect(playlist.transport).toBe("playing") // אופס ע"י reserve()

    playlist.markReady("s1")
    await flush(playlist, sink)

    expect(sink.playOrder).toContain("s1")
    sink.resolvePlay("s1")
    await flush(playlist, sink)

    expect(playlist.state).toBe("idle")
  })
})
