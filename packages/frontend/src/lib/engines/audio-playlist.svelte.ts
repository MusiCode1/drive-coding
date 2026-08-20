/**
 * audio-playlist.svelte.ts — פלייליסט-מקטעים עם reserve-on-enqueue.
 *
 * refactor מ-player.svelte.ts (slice A2). ה-API החדש:
 *   reserve(segmentId, orderKey, bubbleId, refetch?)  ← Speaker.#enqueue (מיד — לפני fetch)
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
 *
 * nav-retain: פלייליסט ממומש — retain-and-replay.
 * ניווט ל-item שה-sink כבר מחזיק (isComplete=true) → replay מיידי, ללא re-fetch.
 * ניווט ל-item שעדיין ב-fetch (isComplete=false) → skip-cancel: abort + reserved.
 * idle-park: כשה-loop מגיע לסוף → ממתין על #navResolve (לא יוצא), state=idle.
 * refetch thunk פר-item: reserved-ללא-fetch → owner.refetch?.() → re-synthesize.
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
  /**
   * nav-retain: thunk לסינתוז-מחדש.
   * נקרא כש-item נמצא ב-reserved ללא fetch חי (דולג ב-skip-cancel, נכשל).
   * owner מעביר אותו ב-reserve(); מייצר stream→prepareSegment→markReady/markError.
   */
  refetch?: () => void
  /**
   * nav-retain fix: אמת רק כשה-item **נזרק** (skip-cancel) או נכשל וצריך סינתוז-מחדש.
   * item שנוצר ב-reserve() רגיל (זרם חי) — הדגל כבוי; ה-fetch החי מגיע דרך Speaker.
   * בלי הדגל, ה-#playLoop היה קורא refetch() על כל item רגיל → סופת-fetch → קקפוניה/שקט.
   */
  needsRefetch?: boolean
}

export type AudioPlaylistState = "idle" | "playing"

/** A3: מצב transport — לצד state, לא במקומו (ראה הערה בראש הקובץ). */
export type AudioPlaylistTransport = "playing" | "paused" | "stopped"

export class AudioPlaylist {
  // ⚠️ A3: state ("idle"|"playing") מ-A2 — **נשאר כפי שהוא!**
  // Speaker.get state קורא #player.state==="playing" (speaker.svelte.ts:98).
  // ב-paused: state נשאר "playing" (יש תוכן פעיל), transport="paused".
  // nav-retain: idle-park → state="idle" בזמן ההמתנה (כדי שמחוון "מדבר" יהיה נכון).
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
  // nav-retain fix: resolver נפרד ל-idle-park. חייב להיות נפרד מ-#navResolve
  // (של #playWithNav) — אחרת reserve() בזמן נגינה פעילה יקטע את ה-play-race → קקפוניה.
  #parkResolve: (() => void) | null = null

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
   * nav-retain: refetch? — thunk לסינתוז-מחדש (owner-agnostic).
   */
  reserve(segmentId: string, orderKey: OrderKey, bubbleId: string, refetch?: () => void): void {
    // A3: תור חדש אחרי stop — חזור למצב ניגון
    if (this.transport === "stopped") {
      this.transport = "playing"
    }

    const newItem: PlaylistItem = {
      orderKey,
      segmentId,
      state: "reserved",
      bubbleId,
      refetch,
    }
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
    } else {
      // nav-retain fix: אם הלולאה ב-idle-park (סוף פלייליסט) — העירי אותה.
      // ⚠️ רק #parkResolve! לא #navResolve — אחרת reserve בזמן נגינה פעילה יפתור
      //    את ה-#playWithNav race → הלולאה מתקדמת והסגמנט הבא מתחיל בעוד הנוכחי
      //    עדיין מנגן → כל הסגמנטים מנגנים יחד (קקפוניה).
      const resolve = this.#parkResolve
      this.#parkResolve = null
      resolve?.()
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
   * Fetch ננטש (ניווט/עצירה) — הפריט נשאר reserved וניתן לשחזור.
   * משחרר resolver תלוי כדי שלא ימתין 20 שניות.
   */
  markAbandoned(segmentId: string): void {
    const item = this.items.find((it) => it.segmentId === segmentId)
    if (item !== undefined) {
      item.state = "reserved"
      item.needsRefetch = true
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
   * nav-retain: next → לא cancel על target (isComplete→replay; in-fetch→continue).
   */
  next(): void {
    if (!this.#playing) return
    const nextIdx = this.#cursor + 1
    if (nextIdx >= this.items.length) return
    this.#navigate(nextIdx, false) // resetTarget=false: next לא cancel על target
  }

  /**
   * A4: חזור למשפט הקודם (≥ 0).
   * nav-retain: prev → target done/ready → replay (isComplete check ב-#navigate).
   */
  prev(): void {
    if (!this.#playing) return
    const prevIdx = this.#cursor - 1
    if (prevIdx < 0) return
    this.#navigate(prevIdx, true) // resetTarget=true: prev מטפל ב-target
  }

  /**
   * A4: קפוץ ל-index מסוים.
   * nav-retain: jumpTo → target done/ready → replay אם isComplete; reset אם לא.
   */
  jumpTo(index: number): void {
    if (!this.#playing) return
    if (index < 0 || index >= this.items.length) return
    this.#navigate(index, true) // resetTarget=true: jumpTo מטפל ב-target
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
   * nav-retain: לוגיקת-ניווט מעודכנת (retain-and-replay + skip-cancel).
   *
   * (1) ה-item הנוכחי (שמנגן/בטעינה):
   *     - isComplete(current) === true  → נשאר כמו שהוא (done/ready; buffer שמור)
   *     - isComplete(current) === false → skip-cancel: abort + reserved (re-fetch בביקור)
   *
   * (2) item היעד (לפי resetTarget):
   *     false (next): לא cancel על target — replay אם ready/done, המשך אם reserved/loading.
   *     true (prev/jump): אם isComplete(target) → נשאר (replay). אם לא → cancel+reserved.
   *
   * (3) cursor = newIndex.
   * (4) navSignal — מעיר את ה-#playLoop מה-await play.
   */
  #navigate(newIndex: number, resetTarget: boolean): void {
    // (1) ה-item הנוכחי
    const currentItem = this.items[this.#cursor]
    if (currentItem !== undefined) {
      const currentComplete = this.#isComplete(currentItem.segmentId)
      if (!currentComplete) {
        // skip-cancel: item עדיין ב-fetch (או ב-reserved בלי buffer) → abort
        try {
          this.#audioStream.cancel(currentItem.segmentId)
        } catch {
          // כבר בוטל
        }
        // חוזר ל-reserved כדי שביקור עתידי יפעיל refetch
        if (
          currentItem.state === "playing" ||
          currentItem.state === "ready" ||
          currentItem.state === "reserved" ||
          currentItem.state === "loading"
        ) {
          currentItem.state = "reserved"
          currentItem.needsRefetch = true // נזרק → ביקור עתידי יסנתז מחדש
        }
      }
      // אם currentComplete===true: item נשאר כמו שהוא (done/ready — buffer שמור ב-sink)
    }

    // (2) item היעד
    const targetItem = this.items[newIndex]
    if (targetItem !== undefined && targetItem !== currentItem) {
      if (resetTarget) {
        const targetComplete = this.#isComplete(targetItem.segmentId)
        if (!targetComplete) {
          // לא ממומש עדיין → cancel+reserved (prev/jump: re-fetch בביקור)
          if (targetItem.state === "ready" || targetItem.state === "playing") {
            // רק אם ב-ready/playing (sink מחזיק משהו) — cancel
            try {
              this.#audioStream.cancel(targetItem.segmentId)
            } catch {
              // כבר בוטל
            }
          }
          if (
            targetItem.state === "ready" ||
            targetItem.state === "playing" ||
            targetItem.state === "reserved" ||
            targetItem.state === "loading"
          ) {
            targetItem.state = "reserved"
            targetItem.needsRefetch = true // נזרק (לא ממומש) → סינתוז-מחדש בביקור
          }
        }
        // אם targetComplete===true (done/ready עם buffer שמור): נשאר — replay ב-#playLoop
      }
      // next (resetTarget=false): שום שינוי — ready/done → replay מיידי; reserved/loading → ממתין
    }

    // (3) cursor חדש
    this.#cursor = newIndex

    // (4) פתור signals — גם play-race (#navResolve, לקטיעת ה-play הנוכחי)
    //     וגם park (#parkResolve), כי ניווט יכול לקרות בזמן נגינה או בזמן idle-park.
    const navResolve = this.#navResolve
    this.#navResolve = null
    navResolve?.()
    const parkResolve = this.#parkResolve
    this.#parkResolve = null
    parkResolve?.()
  }

  /**
   * nav-retain: בדיקה האם sink מחזיק buffer מוכן לניגון-מחדש.
   * מאציל ל-AudioSink.isComplete(id) אם קיים; אחרת false (backward compat).
   * AudioSink הקיים (RoutingAudioSink/PlayableSink) יממש isComplete.
   * Mock בטסטים: completedSegments.has(id).
   */
  #isComplete(segmentId: string): boolean {
    const sink = this.#audioStream as AudioSink & { isComplete?: (id: string) => boolean }
    return sink.isComplete?.(segmentId) ?? false
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
    // A4: שחרר nav signal + park signal אם תקועים
    const navResolve = this.#navResolve
    this.#navResolve = null
    navResolve?.()
    const parkResolve = this.#parkResolve
    this.#parkResolve = null
    parkResolve?.()
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
      while (true) {
        // בדוק stop() שנקרא תוך כדי await
        if (this.#stopped) break

        // A3: אם paused — ממתין עד resume() או stop()
        if (this.transport === "paused") {
          await this.#waitForResume()
          if (this.#stopped) break
        }
        // A3: אם stopped (stop() נקרא בזמן pause) — יציאה
        if (this.transport === "stopped" || this.#stopped) break

        // nav-retain: idle-park — כשמגיעים לסוף הפלייליסט ממתינים על navSignal
        if (this.#cursor >= this.items.length) {
          // state=idle כדי שמחוון "מדבר" לא יישאר ב-speaking
          this.state = "idle"
          this.currentSegmentId = null
          // ממתינים — #playing נשאר true כדי ש-next()/prev() יוכלו לפעול
          await this.#waitForNav()
          if (this.#stopped) break
          // ניווט/reserve חזר — state חוזר ל-playing, callback מופעל מחדש
          this.state = "playing"
          this.#onPlaybackStart?.()
          continue
        }

        const item = this.items[this.#cursor]
        if (item === undefined) {
          this.#cursor++
          continue
        }

        // nav-retain: item done/ready + isComplete → replay מיידי
        if (
          (item.state === "done" || item.state === "ready") &&
          this.#isComplete(item.segmentId)
        ) {
          // A3: בדוק pause לפני play
          if (this.transport === "paused") {
            await this.#waitForResume()
            if (this.#stopped) break
          }
          const transportAfterResume = this.transport as AudioPlaylistTransport
          if (transportAfterResume === "stopped" || this.#stopped) break

          item.state = "playing"
          this.currentSegmentId = item.segmentId
          try {
            await this.#playWithNav(item.segmentId)
          } catch {
            // בוטל / שגיאה → דלג
          }
          if (this.#stopped) break
          // בדוק אם ניווט שינה cursor
          const navigated = this.items[this.#cursor]?.segmentId !== item.segmentId
          if (!navigated) {
            item.state = "done"
            this.currentSegmentId = null
            this.#cursor++
          } else {
            this.currentSegmentId = null
          }
          continue
        }

        if (item.state === "reserved" || item.state === "loading") {
          // nav-retain fix: קרא refetch **רק** ל-item שנזרק (needsRefetch), לא ל-item
          // רגיל שה-fetch החי שלו בדרך (דרך Speaker.#pumpFetchLoop). אחרת = סופת-fetch.
          if (item.state === "reserved" && item.needsRefetch === true && item.refetch !== undefined) {
            item.needsRefetch = false // חד-פעמי — מונע לולאת refetch
            item.refetch()
            // המשך לחכות ב-#waitForItem (refetch קורא markReady async)
          }

          // המתן עד שה-item ישתנה (markReady/markError) או timeout
          const resolved = await this.#waitForItem(item.segmentId)
          if (this.#stopped) break // stop() נקרא תוך כדי המתנה
          // A4: בדוק אם ניווט שינה את ה-cursor בזמן ה-await
          if (this.items[this.#cursor]?.segmentId !== item.segmentId) {
            continue
          }
          if (!resolved) {
            // timeout
            item.state = "skipped"
            this.#cursor++
            continue
          }
          // markAbandoned משאיר reserved+needsRefetch — חזור לענף reserved (refetch)
          const stateAfterWait = item.state
          if (stateAfterWait === "reserved" && item.needsRefetch === true) {
            continue
          }
        }

        // re-read state אחרי await (TypeScript לא מצר את ה-state אחרי await)
        const currentState = item.state
        if (currentState === "error" || currentState === "skipped") {
          this.#cursor++
          continue
        }

        if (currentState === "ready") {
          // A3: בדוק pause שוב לפני play
          if (this.transport === "paused") {
            await this.#waitForResume()
            if (this.#stopped) break
          }
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
          const navigated = this.items[this.#cursor]?.segmentId !== item.segmentId
          if (!navigated) {
            item.state = "done"
            this.currentSegmentId = null
            this.#cursor++
          } else {
            // ניווט קרה — cursor כבר מצביע על item החדש
            this.currentSegmentId = null
          }
          continue
        }

        // done (ללא isComplete — לא ב-sink) או כל state אחר — המשך
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
      // nav-retain fix: אפס גם park resolver (הגנה)
      this.#parkResolve = null
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
   * nav-retain: ממתין על navSignal (idle-park).
   * נקרא כש-#cursor >= items.length (סוף פלייליסט).
   * מופעל ע"י: next()/prev()/jumpTo()/reserve() (דרך resolve).
   */
  #waitForNav(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.#parkResolve = resolve
    })
  }

  /**
   * A4: עוטף את audioStream.play() כדי שניווט (next/prev/jumpTo) יוכל לבטלו.
   * מחזיר Promise שמתממש כש:
   *   (א) play הסתיים רגיל, OR
   *   (ב) #navSignal הופעל (ניווט קרה — play() בוטל ע"י cancel בתוך #navigate).
   */
  async #playWithNav(segmentId: string): Promise<void> {
    // Promise שנפתרת ע"י #navSignal
    const navPromise = new Promise<void>((resolve) => {
      this.#navResolve = resolve
    })
    // race: play vs nav
    await Promise.race([this.#audioStream.play(segmentId), navPromise])
    // נקה nav resolver — play הסתיים לפני ניווט
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
