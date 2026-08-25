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

describe("AudioPlaylist — יתומים, וסדר-ההשמעה", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  // 🔴 נמדד חי בטלפון (21/08): `cursor: 4 / items: 4` עם
  // `byState: {done: 3, ready: 1}` — פריט מוכן שאיש לא ניגן. באג #47.
  it("זנב שנוסף בסוף אחרי שהלולאה חנתה — מתנגן", async () => {
    const sink = makeMockSink()
    const pl = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    await playOneTurn(pl, sink, "m0", 0)
    await playOneTurn(pl, sink, "m1", 1)
    expect(sink.playOrder).toEqual(["m0", "m1"])

    // הזנב של m1 מגיע אחרי שהתור נסגר — ממוין אחרון, ולכן מותר וצריך.
    pl.reserve("tail1", { seq: 1, segmentIndex: 1 }, "b-m1")
    await settle()
    await sink.prepareSegment("tail1", new ReadableStream(), new AbortController())
    pl.markReady("tail1")
    await settle()
    sink.resolvePlay("tail1")
    await settle()

    expect(sink.playOrder).toEqual(["m0", "m1", "tail1"])
  })

  // ⚠️ **הכלל שהמשתמש הגדיר, והוא ההפך מהאינטואיציה הראשונה שלי.**
  // "אם התחלנו כבר את קטע 33, לעולם לא לחזור ל-32."
  //
  // כתבתי כאן קודם טסט שציפה שיתום כזה **כן** ינוגן — וזו הייתה טעות:
  // השמעת משפט מוקדם אחרי שמאוחר ממנו כבר נשמע היא ערבוב-סדר, וזה גרוע
  // מהשמטה. הלולאה אוספת יתומים **קדימה בלבד**, מעבר לגבוה שכבר נוגן.
  it("יתום שממוין לפני מה שכבר נוגן — נזנח, ולא מערבב סדר", async () => {
    const sink = makeMockSink()
    const pl = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 1000 })

    await playOneTurn(pl, sink, "later", 5)
    expect(sink.playOrder).toEqual(["later"])

    // מגיע קטע שממוין **לפני** מה שכבר הושמע.
    pl.reserve("stale", { seq: 1, segmentIndex: 0 }, "b-stale")
    await settle()
    await sink.prepareSegment("stale", new ReadableStream(), new AbortController())
    pl.markReady("stale")
    await vi.advanceTimersByTimeAsync(1500)
    await settle()

    expect(sink.playOrder).toEqual(["later"])
  })

  it("קטע שכבר נוגן אינו מושמע שוב בזחילה קדימה", async () => {
    // נמדד: `a, x, a` — חזרה אחורה השמיעה שוב את מה שנוגן בדרך.
    const sink = makeMockSink()
    const pl = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 1000 })
    await playOneTurn(pl, sink, "one", 0)
    await playOneTurn(pl, sink, "two", 1)
    await settle()
    expect(sink.playOrder).toEqual(["one", "two"])
  })
})

describe("AudioPlaylist — שומר-epoch על markError/markAbandoned", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  // 🔴 code review: `markReady` מוגן ב-epoch, ‏`markError`/`markAbandoned` לא.
  //
  // ⚠️ **ההנחה הראשונה שלי הייתה שגויה, והטסט הפריך אותה:** חשבתי
  // ש-`markAbandoned` מעלה epoch. הוא לא — רק `#notifyOwnerInvalidate`
  // מעלה, והוא נקרא **אך ורק מתוך `#navigate`** (שלושה מוקדים). לכן
  // התרחיש האמיתי הוא **ניווט**, ורק כך הטסט בודק משהו אמיתי.
  it("כשל מאוחר של fetch שבוטל בניווט אינו הורג את הפריט", async () => {
    const sink = makeMockSink()
    const pl = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })

    // ⚠️ **owner חובה כאן.** `#notifyOwnerInvalidate` מעלה epoch **רק אם
    // `owner !== undefined`** — בלעדיו ה-epoch לעולם לא זז, והטסט היה
    // "נכשל" על תרחיש שאינו קיים. גם זו הנחה שלי שהטסט הפריך.
    const owner = { refetch: vi.fn(), invalidate: vi.fn() }
    pl.reserve("s0", key(0), "b0", owner)
    pl.reserve("s1", key(1), "b1", owner)
    await settle()
    pl.markReady("s0")
    await settle()

    // ניווט קדימה בזמן ש-s0 מנגן ואינו שלם → invalidate → epoch עולה
    pl.next()
    await settle()

    // ה-fetch הישן של s0 נכשל **עכשיו**, אחרי שה-epoch כבר התקדם
    pl.markError("s0")
    await settle()

    const item = pl.items.find((it) => it.segmentId === "s0")
    expect(item?.state).not.toBe("error")
  })
})
