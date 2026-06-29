/**
 * audio-playlist.svelte.ts — פלייליסט-מקטעים עם reserve-on-enqueue.
 *
 * refactor מ-player.svelte.ts (slice A2). ה-API החדש:
 *   reserve(segmentId, orderKey)  ← Speaker.#enqueue (מיד — לפני fetch)
 *   markReady(segmentId)          ← Speaker.#fetchJob (אחרי prepareSegment)
 *   markError(segmentId)          ← Speaker.#fetchJob (catch)
 *
 * ה-#playLoop נע על cursor ($state); ממתין על item עד ready/error/timeout → play(id)
 * דרך AudioSink. cursor-based (לא takeNext) — מאפשר prev/next ב-A4.
 *
 * מה לא משתנה: AudioSink ממשק (play/prepareSegment/cancel/clear) נשאר זהה.
 * dead-code שלא הועבר: jumpToSegment (אביגיל #1 — 0 צרכנים).
 *
 * A3: הוסף transport (pause/resume/stop). ⚠️ state ("idle"|"playing") לא נוגעים —
 * Speaker.get state קורא #player.state==="playing" (speaker.svelte.ts:98).
 * transport הוא שדה נוסף ונפרד.
 *
 * A4: cursor קודם לשדה $state (היה local variable ב-#playLoop) + #navSignal/resolver
 * לקטיעת ה-await play הנוכחי בעת ניווט.
 * next()/prev()/jumpTo(index): 3 צעדים — cancel current + cursor=newIndex + navSignal.
 * prev/jump תמיד דורשים re-fetch (cancel() מוחק מה-sink — §9 Q2 נעול).
 */

import { compareOrderKey, type OrderKey } from "@drive-coding/core/voice/tts-queue"
import type { AudioSink } from "./audio-sink"

export type PlaylistItemState =
  | "reserved"
  | "loading"
  | "ready"
  | "playing"
  | "done"
  | "error"
  | "skipped"

export type PlaylistItem = {
  orderKey: OrderKey
  segmentId: string
  state: PlaylistItemState
  /** A4: מזהה הבועה שממנה נגזר הסגמנט. מאפשר jumpToBubble + on-demand TTS. */
  bubbleId: string
}

export type AudioPlaylistState = "idle" | "playing"

/** A3: מצב transport — לצד state, לא במקומו (ראה הערה בראש הקובץ). */
export type AudioPlaylistTransport = "playing" | "paused" | "stopped"

export class AudioPlaylist {
  // ⚠️ A3: state ("idle"|"playing") מ-A2 — **נשאר כפי שהוא!**
  // Speaker.get state קורא #player.state==="playing" (speaker.svelte.ts:98).
  // ב-paused: state נשאר "playing" (יש תוכן פעיל), transport="paused".
  state: AudioPlaylistState = $state("idle")
  /** A3: transport — שדה נוסף. default "playing" (ניגון מיידי ברוב המקרים). */
  transport: AudioPlaylistTransport = $state("playing")
  currentSegmentId: string | null = $state(null)
  items: PlaylistItem[] = $state([]) // ממוין לפי orderKey; reactive לתצוגה עתידית

  readonly #audioStream: AudioSink
  // A4: לא-readonly — מאפשר ל-Speaker לרשום callback אחרי init (בגלל dependency order ב-+layout)
  #onPlaybackStart?: () => void
  readonly #reserveTimeoutMs: number
  #playing = false // re-entrancy guard
  #stopped = false // אמת כש-stop() נקרא — #playLoop בודק אחרי כל await
  // לכל item ממתין — פונקציה שמפעילה אותו (נקראת כש-markReady/markError)
  #itemResolvers: Map<string, () => void> = new Map()
  // A3: resolver לשחרור pause — נקרא ע"י resume()
  #pauseResolve: (() => void) | null = null
  // A4: cursor כשדה $state — מאפשר next/prev/jumpTo לשנות אותו מחוץ ל-#playLoop.
  // #navSignal/resolver — מעיר את ה-#playLoop מה-await play הנוכחי בעת ניווט.
  #cursor: number = $state(0)
  #navResolve: (() => void) | null = null

  constructor(
    audioStream: AudioSink,
    onPlaybackStart?: () => void,
    opts?: { reserveTimeoutMs?: number },
  ) {
    this.#audioStream = audioStream
    this.#onPlaybackStart = onPlaybackStart
    this.#reserveTimeoutMs = opts?.reserveTimeoutMs ?? 20_000
  }

  /**
   * A4: מאפשר ל-Speaker לרשום callback אחרי יצירת ה-playlist (dependency order ב-+layout).
   * נקרא פעם אחת מ-Speaker constructor כשה-playlist הגיע מבחוץ.
   */
  setOnPlaybackStart(cb: () => void): void {
    this.#onPlaybackStart = cb
  }

  /**
   * A4: wrapper ל-#audioStream.prepareSegment — מאפשר ל-BubblePlayer לעשות TTS
   * דרך ה-audioStream המשותף בלי להחזיק ref ישיר אליו.
   * (BubblePlayer לא יודע מה סוג ה-sink — RoutingAudioSink, AudioStream, וכו')
   */
  prepareSegmentForBubble(
    segmentId: string,
    stream: ReadableStream<Uint8Array>,
    ac: AbortController,
  ): Promise<void> {
    return this.#audioStream.prepareSegment(segmentId, stream, ac)
  }

  /**
   * מכניס item ממוין לפי orderKey, state=reserved.
   * מתחיל #playLoop אם idle.
   * A3: אם transport==="stopped" → אפס ל-"playing" (תור חדש אחרי stop ינוגן).
   * A4: bubbleId — מזהה הבועה שממנה נגזר הסגמנט (לניווט jumpToBubble).
   */
  reserve(segmentId: string, orderKey: OrderKey, bubbleId: string): void {
    // A3: תור חדש אחרי stop — חזור למצב ניגון
    if (this.transport === "stopped") {
      this.transport = "playing"
    }

    const newItem: PlaylistItem = { orderKey, segmentId, state: "reserved", bubbleId }
    // sorted-insert לפי compareOrderKey
    let i = this.items.length
    while (i > 0) {
      const prev = this.items[i - 1]
      if (prev === undefined || compareOrderKey(orderKey, prev.orderKey) >= 0) break
      i--
    }
    this.items.splice(i, 0, newItem)

    if (!this.#playing) {
      void this.#playLoop()
    }
  }

  /**
   * ה-stream מוכן ב-AudioSink (prepareSegment הסתיים).
   * reserved/loading → ready, ומאותת ל-#playLoop.
   */
  markReady(segmentId: string): void {
    const item = this.items.find((it) => it.segmentId === segmentId)
    if (item !== undefined && (item.state === "reserved" || item.state === "loading")) {
      item.state = "ready"
    }
    // אות ל-playLoop שמחכה על item זה
    this.#itemResolvers.get(segmentId)?.()
  }

  /**
   * ה-fetch נכשל. reserved/loading → error, ומאותת ל-#playLoop.
   */
  markError(segmentId: string): void {
    const item = this.items.find((it) => it.segmentId === segmentId)
    if (item !== undefined && (item.state === "reserved" || item.state === "loading")) {
      item.state = "error"
    }
    this.#itemResolvers.get(segmentId)?.()
  }

  /**
   * A3: השהיית ניגון. transport=paused; מאציל ל-AudioSink; #playLoop ממתין.
   * state נשאר "playing" (יש תוכן פעיל — Speaker.get state לא משתנה).
   * ⚠️ לאמת חי: pause לא גורם ל-ended/error שמדלג.
   */
  pause(): void {
    if (this.transport !== "playing") return
    this.transport = "paused"
    this.#audioStream.pause()
  }

  /**
   * A3: המשך ניגון אחרי pause. transport=playing; מאציל ל-AudioSink; משחרר #playLoop.
   */
  resume(): void {
    if (this.transport !== "paused") return
    this.transport = "playing"
    this.#audioStream.resume()
    // שחרר את ה-#playLoop שממתין על pause
    const resolve = this.#pauseResolve
    this.#pauseResolve = null
    resolve?.()
  }

  // ──────────────────────────────────────────────────────────────────────
  // A4 — ניווט: next / prev / jumpTo
  // ──────────────────────────────────────────────────────────────────────

  /** A4: cursor (קריאה בלבד). #playLoop מסתנכרן עם שדה זה. */
  get cursor(): number {
    return this.#cursor
  }

  /**
   * A4: דלג למשפט הבא. אם אין הבא — no-op.
   * 3 צעדים: cancel current → cursor++ → navSignal (מעיר את ה-#playLoop).
   * שומר transport: אם paused — לא מתחיל אוטומטית (pause נשאר).
   * ⚠️ next לא מבצע cancel על item היעד — item הבא נשאר ב-sink (ניגון ישיר אם ready).
   */
  next(): void {
    if (!this.#playing) return
    const nextIdx = this.#cursor + 1
    if (nextIdx >= this.items.length) return
    this.#navigate(nextIdx, false) // resetTarget=false: next לא cancel על target
  }

  /**
   * A4: חזור למשפט הקודם (≥ 0). re-fetch חובה אם done (cancel מוחק מה-sink).
   * 3 צעדים: cancel current → cursor-- → navSignal.
   */
  prev(): void {
    if (!this.#playing) return
    const prevIdx = this.#cursor - 1
    if (prevIdx < 0) return
    this.#navigate(prevIdx, true) // resetTarget=true: prev מבצע cancel על target אם done/ready
  }

  /**
   * A4: קפוץ ל-index מסוים. תוספת-נטו (jumpToSegment נמחק ב-A2).
   * 3 צעדים: cancel current → cursor=index → navSignal.
   * resetTarget=true: cancel על item היעד (§9 Q2 — re-fetch תמיד בקפיצה).
   */
  jumpTo(index: number): void {
    if (!this.#playing) return
    if (index < 0 || index >= this.items.length) return
    this.#navigate(index, true) // resetTarget=true: jumpTo מבצע cancel על target
  }

  /**
   * A4: קפוץ ל-item הראשון של הבועה עם bubbleId נתון.
   * אם הבועה לא בפלייליסט — no-op (BubblePlayer יוסיף אותה דרך reserveFromText).
   */
  jumpToBubble(bubbleId: string): void {
    if (!this.#playing) return
    const idx = this.items.findIndex((it) => it.bubbleId === bubbleId)
    if (idx === -1) return
    this.#navigate(idx, true) // resetTarget=true: קפיצה לבועה = jumpTo
  }

  /**
   * A4: לוגיקת-ניווט משותפת ל-next/prev/jumpTo.
   * (1) cancel ה-item הנוכחי (מוחק מה-sink; prev/jump תמיד re-fetch).
   * (2) cursor = newIndex.
   * (3) navSignal — מעיר את ה-#playLoop מה-await play.
   * item שמדלגים עליו (הנוכחי) חוזר ל-"reserved" כדי שה-#playLoop יבצע re-fetch.
   */
  /**
   * A4: לוגיקת-ניווט משותפת ל-next/prev/jumpTo.
   * (1) cancel ה-item הנוכחי (מוחק מה-sink; item חוזר ל-reserved לצורך re-fetch).
   * (2) reset item היעד לפי resetTarget:
   *     false (next): לא cancel על target — item הבא נשאר ב-sink (ניגון ישיר אם ready).
   *     true (prev/jump): cancel+reserved על target אם done/ready/playing.
   *     "done" תמיד מאופס ל-reserved (לא ב-sink בכל מקרה).
   * (3) cursor = newIndex.
   * (4) navSignal — מעיר את ה-#playLoop מה-await play.
   */
  #navigate(newIndex: number, resetTarget: boolean): void {
    // (1) cancel ואיפוס ה-item הנוכחי (הנוגן כרגע)
    const currentItem = this.items[this.#cursor]
    if (currentItem !== undefined) {
      try {
        this.#audioStream.cancel(currentItem.segmentId)
      } catch {
        // כבר בוטל
      }
      // item חוזר ל-reserved — #playLoop יבצע re-fetch (markReady/markError חדש נדרש)
      if (currentItem.state === "playing" || currentItem.state === "ready") {
        currentItem.state = "reserved"
      }
    }

    // (2) טיפול ב-item היעד
    const targetItem = this.items[newIndex]
    if (targetItem !== undefined && targetItem !== currentItem) {
      if (targetItem.state === "done") {
        // "done" = לא ב-sink בשום מקרה → אפס ל-reserved לצורך re-fetch
        targetItem.state = "reserved"
      } else if (resetTarget) {
        // prev/jumpTo: cancel + reserved על ready/playing (§9 Q2 — re-fetch בקפיצה)
        if (targetItem.state === "ready" || targetItem.state === "playing") {
          try {
            this.#audioStream.cancel(targetItem.segmentId)
          } catch {
            // כבר בוטל
          }
          targetItem.state = "reserved"
        }
      }
      // next (resetTarget=false): ready/playing/reserved/loading → ללא שינוי (ניגון ישיר)
    }

    // (3) הגדר cursor חדש — #playLoop יקרא אותו אחרי שיתעורר
    this.#cursor = newIndex

    // (4) פתור את ה-#navSignal כדי לשחרר את ה-await play ב-#playLoop
    const resolve = this.#navResolve
    this.#navResolve = null
    resolve?.()
  }

  /**
   * עצירה: מבטל את כל ה-items הממתינים, מנקה items + cursor.
   * A3: מוסיף transport="stopped".
   */
  stop(): void {
    this.#stopped = true
    this.transport = "stopped"
    // שחרר pause אם תקוע
    const pauseResolve = this.#pauseResolve
    this.#pauseResolve = null
    pauseResolve?.()
    // A4: שחרר nav signal אם תקוע
    const navResolve = this.#navResolve
    this.#navResolve = null
    navResolve?.()
    // בטל סגמנטים שכבר ב-AudioSink (playing/ready/reserved)
    for (const item of this.items) {
      if (item.state !== "done" && item.state !== "error" && item.state !== "skipped") {
        try {
          this.#audioStream.cancel(item.segmentId)
        } catch {
          // כבר בוטל
        }
      }
    }
    // פתור את כל ה-resolvers כדי לשחרר המתנות תקועות (#playLoop יבדוק #stopped)
    for (const resolve of this.#itemResolvers.values()) {
      resolve()
    }
    this.#itemResolvers.clear()
    this.items = []
    this.#playing = false
    this.#stopped = false // אפס כדי לאפשר reserve() עתידי
    this.state = "idle"
    this.currentSegmentId = null
    this.#cursor = 0 // A4: אפס cursor
    // transport נשאר "stopped" — reserve() יאפס ל-"playing" בתור הבא
  }

  // ──────────────────────────────────────────────────────────────────────
  // פנימי — #playLoop
  // ──────────────────────────────────────────────────────────────────────

  async #playLoop(): Promise<void> {
    if (this.#playing) return
    this.#playing = true
    this.state = "playing"
    this.#onPlaybackStart?.()

    try {
      // A4: cursor הוא עכשיו שדה $state (#cursor) — לא local variable.
      // אתחל ל-0 בהתחלת loop חדש (stop() מאפס, reserve() מחדש מתחיל מ-0).
      this.#cursor = 0
      while (this.#cursor < this.items.length) {
        // בדוק stop() שנקרא תוך כדי await
        if (this.#stopped) break

        // A3: אם paused — ממתין עד resume() או stop()
        if (this.transport === "paused") {
          await this.#waitForResume()
          if (this.#stopped) break
        }
        // A3: אם stopped (stop() נקרא בזמן pause) — יציאה
        if (this.transport === "stopped" || this.#stopped) break

        const item = this.items[this.#cursor]
        if (item === undefined) {
          this.#cursor++
          continue
        }

        if (item.state === "reserved" || item.state === "loading") {
          // המתן עד שה-item ישתנה (markReady/markError) או timeout
          const resolved = await this.#waitForItem(item.segmentId)
          if (this.#stopped) break // stop() נקרא תוך כדי המתנה
          // A4: בדוק אם ניווט שינה את ה-cursor בזמן ה-await
          // אם כן, items[#cursor] מצביע על item אחר — חזור ל-while
          if (this.items[this.#cursor]?.segmentId !== item.segmentId) {
            continue
          }
          if (!resolved) {
            // timeout
            item.state = "skipped"
            this.#cursor++
            continue
          }
          // לאחר המתנה — בדוק מחדש
        }

        // re-read state אחרי await (TypeScript לא מצר את ה-state אחרי await)
        const currentState = item.state
        if (currentState === "error" || currentState === "skipped") {
          this.#cursor++
          continue
        }

        if (currentState === "ready") {
          // A3: בדוק pause שוב לפני play (ייתכן שהגיע בזמן ה-await של waitForItem)
          if (this.transport === "paused") {
            await this.#waitForResume()
            if (this.#stopped) break
          }
          // re-read אחרי await — TS מצר transport ל-"playing"|"paused" מתוך הענף; cast מפורש
          // מאפשר לבדוק "stopped" (stop() נקרא בזמן pause → שחרר ה-waitForResume)
          const transportAfterResume = this.transport as AudioPlaylistTransport
          if (transportAfterResume === "stopped" || this.#stopped) break

          item.state = "playing"
          this.currentSegmentId = item.segmentId
          try {
            // A4: עטוף play ב-#playWithNav — מאפשר ניווט לבטל את ה-await
            await this.#playWithNav(item.segmentId)
          } catch {
            // MIN-5: בוטל / שגיאה → דלג, המשך לבא בתור (best-effort)
          }
          if (this.#stopped) break // stop() נקרא תוך כדי play
          // A4: בדוק אם ניווט שינה את ה-cursor בזמן ה-play
          // אם #cursor שונה — #navigate שינה אותו, item.state=reserved (re-fetch)
          const navigated = this.items[this.#cursor]?.segmentId !== item.segmentId
          if (!navigated) {
            item.state = "done"
            this.currentSegmentId = null
            this.#cursor++
          } else {
            // ניווט קרה — cursor כבר מצביע על item החדש, item הנוכחי ב-reserved
            this.currentSegmentId = null
          }
          continue
        }

        // done או כל state אחר — המשך
        this.#cursor++
      }
    } finally {
      this.#playing = false
      this.state = "idle"
      this.currentSegmentId = null
      // A3: אפס pause resolver אם נשאר (לא צפוי — הגנה)
      this.#pauseResolve = null
      // A4: אפס nav resolver אם נשאר (הגנה)
      this.#navResolve = null
    }
  }

  /**
   * A3: ממתין עד ש-transport יצא מ-paused (ע"י resume() או stop()).
   * resume() — פותר; stop() — שחרר ויציאה.
   */
  #waitForResume(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.#pauseResolve = resolve
    })
  }

  /**
   * A4: עוטף את audioStream.play() כדי שניווט (next/prev/jumpTo) יוכל לבטלו.
   * מחזיר Promise שמתממש כש:
   *   (א) play הסתיים רגיל, OR
   *   (б) #navSignal הופעל (ניווט קרה — play() בוטל ע"י cancel בתוך #navigate).
   * ה-play ממשיך לרוץ ב-sink (cancel נשלח ב-#navigate לפני resolve) — race race OK
   * כי cancel() יגרום ל-play() לזרוק/לחזור מוקדם.
   */
  async #playWithNav(segmentId: string): Promise<void> {
    // Promise שנפתרת ע"י #navSignal
    const navPromise = new Promise<void>((resolve) => {
      this.#navResolve = resolve
    })
    // race: play vs nav
    await Promise.race([this.#audioStream.play(segmentId), navPromise])
    // נקה nav resolver — play הסתיים לפני ניווט (הסתיים רגיל)
    // (אם ניווט קרה ראשון, resolver כבר נוקה ב-#navigate)
    this.#navResolve = null
  }

  /**
   * ממתין עד שה-item מסומן ready/error (ע"י markReady/markError),
   * עד stop() שקורא לכל resolver, או עד timeout.
   * מחזיר true אם ה-item קיבל resolution, false אם timeout.
   */
  #waitForItem(segmentId: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let done = false

      const onReady = () => {
        if (done) return
        done = true
        this.#itemResolvers.delete(segmentId)
        clearTimeout(timer)
        resolve(true)
      }

      const timer = setTimeout(() => {
        if (done) return
        done = true
        this.#itemResolvers.delete(segmentId)
        resolve(false)
      }, this.#reserveTimeoutMs)

      this.#itemResolvers.set(segmentId, onReady)
    })
  }
}
