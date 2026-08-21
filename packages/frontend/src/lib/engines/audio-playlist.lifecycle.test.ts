/**
 * audio-playlist.lifecycle.test.ts — האם הפלייליסט **מתאושש**.
 *
 * ─── נכתב מתוך תצפית-שדה, לא מתוך קריאת-קוד ───
 *
 * 🔴 **הפער שהטסט הזה סוגר.** ‏2,671 טסטים עברו ירוק בעוד ההקראה בטלפון
 * הפסיקה לעבוד באמצע סשן. הסיבה שאף אחד מהם לא תפס זאת: כולם בודקים
 * **מחזור אחד** — reserve, play, assert. אף אחד לא בודק את התור ה**שני**.
 *
 * החתימה שנמדדה חיה (‏Edge/Android, ‏21/08): ‏`AudioBufferSourceNode.start`
 * נקרא **655 פעמים** ואז **אפס**, בעוד `AudioContext.createBuffer` המשיך
 * לרוץ לאלפים. כלומר: הבייטים המשיכו להגיע ולהתפענח, והנגן פשוט חדל
 * להתקדם. אפס שגיאות, אפס אזהרות.
 *
 * מחזור-החיים נשלט בשלושה שדות פרטיים — `#playing`, `#loopGeneration`,
 * `#parkResolve` — ו-`reserve()` מסתמך עליהם כדי להכריע בין *"התנע לולאה
 * חדשה"* ל-*"העירי את הקיימת"*. אם הם יוצאים מסנכרון, `reserve()` הופך
 * ל-**no-op שקט**: הפריט נכנס לרשימה, אף אחד לא מנגן אותו, ואין למי
 * להתלונן. הטסטים כאן מקבעים את ההתאוששות בכל אחד מהמעברים.
 */

import type { OrderKey } from "@drive-coding/core/voice/tts-queue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AudioPlaylist } from "./audio-playlist.svelte"
import type { AudioSink } from "./audio-sink"

type MockSink = AudioSink & {
  playOrder: string[]
  resolvePlay: (segmentId: string) => void
  prepared: Set<string>
  isComplete: (id: string) => boolean
}

function makeMockSink(): MockSink {
  const playOrder: string[] = []
  const playResolvers = new Map<string, () => void>()
  const prepared = new Set<string>()
  const resolvePlay = (segmentId: string) => {
    const r = playResolvers.get(segmentId)
    if (r !== undefined) {
      r()
      playResolvers.delete(segmentId)
    }
  }
  return {
    playOrder,
    resolvePlay,
    prepared,
    isComplete: (id) => prepared.has(id),
    prepareSegment: async (segmentId: string) => {
      prepared.add(segmentId)
    },
    play: (segmentId) => {
      playOrder.push(segmentId)
      return new Promise<void>((resolve) => {
        playResolvers.set(segmentId, resolve)
      })
    },
    cancel: (segmentId) => {
      prepared.delete(segmentId)
      resolvePlay(segmentId)
    },
    clear: () => playResolvers.clear(),
    pause: () => {},
    resume: () => {},
  }
}

const key = (seq: number, segmentIndex = 0): OrderKey => ({ seq, segmentIndex })

/** מריץ timers + microtasks עד שהלולאה מתייצבת. */
async function settle(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await vi.advanceTimersByTimeAsync(1)
    await Promise.resolve()
  }
}

/** תור שלם: הזמנה → מוכן → ניגון → סיום. */
async function playOneTurn(pl: AudioPlaylist, sink: MockSink, id: string, seq: number) {
  pl.reserve(id, key(seq), `b-${id}`)
  await settle()
  await sink.prepareSegment(id, new ReadableStream(), new AbortController())
  pl.markReady(id)
  await settle()
  sink.resolvePlay(id)
  await settle()
}

describe("AudioPlaylist — התאוששות בין תורים", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  // 🔴 הטסט המרכזי. זו בדיוק החתימה שנמדדה בטלפון.
  it("תור שני אחרי שהראשון הסתיים — חייב להתנגן", async () => {
    const sink = makeMockSink()
    const pl = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    await playOneTurn(pl, sink, "s0", 0)
    expect(sink.playOrder).toEqual(["s0"])

    // הלולאה חנתה ב-idle-park. תור חדש חייב להעיר אותה.
    await playOneTurn(pl, sink, "s1", 1)
    expect(sink.playOrder).toEqual(["s0", "s1"])
  })

  it("תור שלישי ורביעי — ההתאוששות אינה חד-פעמית", async () => {
    // ⚠️ מחזור אחד עובר גם כשהמכונה שבורה: הראשון תמיד מתנע לולאה חדשה
    // (`#playing === false`). רק מהשני והלאה נבחן מסלול ה-*העירי-את-הקיימת*,
    // ורק מהשלישי מתגלה מצב שנשאר מלוכלך מהמעבר הקודם.
    const sink = makeMockSink()
    const pl = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })
    for (let i = 0; i < 4; i++) await playOneTurn(pl, sink, `s${i}`, i)
    expect(sink.playOrder).toEqual(["s0", "s1", "s2", "s3"])
  })

  it("stop() באמצע ניגון — התור הבא עדיין מתנגן", async () => {
    // ‏`stop()` מעלה את #loopGeneration ומאפס #playing. אם אחד מהשניים
    // נשאר לא-מסונכרן, `reserve()` הבא הופך ל-no-op שקט.
    const sink = makeMockSink()
    const pl = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    pl.reserve("a0", key(0), "b-a")
    await settle()
    await sink.prepareSegment("a0", new ReadableStream(), new AbortController())
    pl.markReady("a0")
    await settle()
    expect(sink.playOrder).toEqual(["a0"])

    pl.stop()
    await settle()

    await playOneTurn(pl, sink, "a1", 1)
    expect(sink.playOrder).toContain("a1")
  })

  it("פריט שדולג ב-timeout אינו מרעיל את התור הבא", async () => {
    // בטלפון הבייטים כן הגיעו — אבל אם markReady מאחר, ה-item מדולג.
    // השאלה שהטסט שואל: האם הדילוג משאיר את המכונה שפויה.
    const sink = makeMockSink()
    const pl = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 1000 })

    pl.reserve("t0", key(0), "b-t")
    await vi.advanceTimersByTimeAsync(1500) // timeout → skipped
    await settle()
    expect(sink.playOrder).toEqual([])

    await playOneTurn(pl, sink, "t1", 1)
    expect(sink.playOrder).toEqual(["t1"])
  })

  it("הזמנה בזמן שהקודם עדיין מנגן — שניהם מתנגנים, בסדר", async () => {
    const sink = makeMockSink()
    const pl = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    pl.reserve("p0", key(0), "b-p")
    await settle()
    await sink.prepareSegment("p0", new ReadableStream(), new AbortController())
    pl.markReady("p0")
    await settle()
    expect(sink.playOrder).toEqual(["p0"])

    // p0 עדיין מנגן (לא resolved) — מגיע סגמנט נוסף
    pl.reserve("p1", key(1), "b-p")
    await sink.prepareSegment("p1", new ReadableStream(), new AbortController())
    pl.markReady("p1")
    await settle()
    // ⚠️ p1 אסור שיתחיל לפני ש-p0 סיים — אחרת קקפוניה.
    expect(sink.playOrder).toEqual(["p0"])

    sink.resolvePlay("p0")
    await settle()
    expect(sink.playOrder).toEqual(["p0", "p1"])
  })
})
