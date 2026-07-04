/**
 * BubblePlayer — VM (entity) להשמעת בועה בודדת.
 *
 * toggle(bubbleId) — לחיצה שנייה על אותה בועה עוצרת.
 * guard: no-op אם session.turnState !== "idle" (לא להשמיע בזמן שהסוכן עונה) — §9 Q3.
 * user bubble → playUserRecording (דרך <audio>).
 * message/thought → אם הבועה כבר בפלייליסט → jumpToBubble;
 *                   אחרת (היסטוריה) → split + reserveFromText לכל משפט → jumpToBubble.
 * tool bubble → אין ▶.
 *
 * ─── A4 Commit 3 ───
 * איחוד עם AudioPlaylist המשותף (מ-Commit 2):
 *   - #sink הפרטי הוסר — TTS דרך playlist.#audioStream (sharedAudioStream מ-+layout)
 *   - reserveFromText: reserve→prepareSegment→markReady ב-playlist
 *   - stop() מאצילה ל-playlist.stop() במקום #sink.cancel()
 *
 * BUG-1 carry: bubbles ready-שלא-נוגנו-חי (state=ready/reserved) חשופות לניווט
 *   (jumpToBubble) — לא מניחים שכל פריט מאחורי cursor=done.
 *
 * אין $effect — toggle הוא method ישיר (§8.10).
 */

import type { FetchState } from "@drive-coding/core/voice/playlist-decision"
import { splitIntoSentences } from "@drive-coding/core/voice/sentence-boundary"
import { OrderAllocator } from "@drive-coding/core/voice/tts-queue"
import type { AgentSession } from "./agent-session.svelte"
import type { Settings } from "./settings.svelte"
import type { AudioPlaylist } from "$lib/engines/audio-playlist.svelte"
import type { SegmentProducer } from "$lib/engines/segment-producer"
import type { Bubble } from "$lib/types/bubble"
import { playUserRecording } from "$lib/adapters/voice/play-bubble"
import { resolveTts } from "$lib/adapters/voice/tts-resolve"

// ─── קבועים לחיתוך משפטים (זהה ל-Speaker) ──────────────────────────────────
const MIN_CHARS = 20
const MAX_CHARS = 200

/** R3: job record for BubblePlayer — parallel to TtsJob in Speaker but simpler (no kind/messageId). */
type BubbleJob = {
  text: string
  provider: { synthesize: (opts: { text: string; voiceId: string; modelId: string; signal: AbortSignal }) => Promise<ReadableStream<Uint8Array>> }
  voiceId: string
  modelId: string
  abort: AbortController
  status: "pending" | "fetching" | "ready" | "error"
  canceled: boolean
}

export class BubblePlayer implements SegmentProducer {
  playingBubbleId: string | null = $state(null)

  readonly #session: AgentSession
  readonly #settings: Settings
  /** A4: פלייליסט משותף עם Speaker. */
  readonly #playlist: AudioPlaylist
  #audioEl: HTMLAudioElement | null = null
  #abortCtrl: AbortController | null = null
  /** A4: OrderAllocator לסגמנטים שלנו — seq נפרד מ-Speaker. */
  readonly #orderAlloc = new OrderAllocator()
  /** R3: job-map for SegmentProducer — keyed by segmentId. */
  #jobs = new Map<string, BubbleJob>()

  constructor(opts: { session: AgentSession; settings: Settings; playlist: AudioPlaylist }) {
    this.#session = opts.session
    this.#settings = opts.settings
    this.#playlist = opts.playlist
  }

  /**
   * לחיצה שנייה על אותה בועה → עוצר. אחרת מנגן.
   * no-op אם turnState !== "idle" (§9 Q3 — שמור guard כמו היום).
   */
  toggle(bubbleId: string): void {
    // no-op אם הסוכן עדיין עונה (§9 Q3)
    if (this.#session.turnState !== "idle") return

    // לחיצה שנייה על אותה בועה → עצור
    if (this.playingBubbleId === bubbleId) {
      this.stop()
      return
    }

    // מצא את הבועה
    const bubble = this.#session.bubbles.find((b: Bubble) => b.id === bubbleId)
    if (!bubble) return

    // tool bubble — אין ▶
    if (bubble.kind === "tool") return

    if (bubble.kind === "user") {
      // ענף user-recording — לא נכנס לפלייליסט (§2 scope: future)
      this.stop()
      this.playingBubbleId = bubbleId
      this.#abortCtrl = new AbortController()
      const audioEl = new Audio()
      this.#audioEl = audioEl
      const cleanup = () => {
        this.playingBubbleId = null
        this.#audioEl = null
        this.#abortCtrl = null
      }
      const recordingId = bubble.recordingId
      if (!recordingId) {
        cleanup()
        return
      }
      void playUserRecording(recordingId, audioEl).then(cleanup).catch(cleanup)
      return
    }

    // message / thought — TTS דרך AudioPlaylist המשותף
    const text = bubble.segments.map((s) => s.text).join("")
    if (!text.trim()) return

    // בדוק אם הבועה כבר בפלייליסט (זרם חי / בועה שכבר נוספה)
    const alreadyInPlaylist = this.#playlist.items.some((it) => it.bubbleId === bubbleId)

    if (alreadyInPlaylist) {
      // הבועה בפלייליסט — בדוק אם הפלייליסט מנגן כרגע
      if (this.#playlist.state === "idle") {
        // carry A4 #1: playlist.state=idle + בועה בפלייליסט → jumpToBubble no-op שקט
        // אבל playingBubbleId היה מתעדכן → UI "מתנגן" בלי שמע.
        // תיקון: התחל ניגון מחדש (reserveAndPlay מחדש).
        this.stop()
        this.playingBubbleId = bubbleId
        this.#abortCtrl = new AbortController()
        void this.#reserveAndPlay(bubbleId, text, this.#abortCtrl)
      } else {
        // פלייליסט פעיל — קפוץ לבועה
        this.#playlist.jumpToBubble(bubbleId)
        this.playingBubbleId = bubbleId
      }
    } else {
      // בועה היסטורית — split + reserveFromText לכל משפט → jumpToBubble
      this.stop()
      this.playingBubbleId = bubbleId
      this.#abortCtrl = new AbortController()
      void this.#reserveAndPlay(bubbleId, text, this.#abortCtrl)
    }
  }

  /**
   * A4: on-demand TTS לבועה היסטורית.
   * split → reserve → prepareSegment → markReady לכל משפט → jumpToBubble.
   * §9 Q2 נעול: prev/jump תמיד re-fetch (cancel מוחק sink) — כאן כל הסגמנטים חדשים.
   */
  async #reserveAndPlay(bubbleId: string, text: string, abortCtrl: AbortController): Promise<void> {
    const { sentences } = splitIntoSentences(text, { minChars: MIN_CHARS, maxChars: MAX_CHARS })
    // אם אין משפטים (טקסט קצר) — השתמש בטקסט המלא כסגמנט אחד
    const parts = sentences.length > 0 ? sentences : [text.trim()]

    // V4b: העברת geminiVoice לresolveTts (נשמר מ-dev בזמן reconcile)
    const { provider, voiceId, modelId } = resolveTts(
      this.#settings.ttsProvider,
      this.#settings.voiceId,
      this.#settings.geminiVoice,
    )

    // שלב 1: reserve כל הסגמנטים לפלייליסט (reserve-on-enqueue)
    // R3: רשום job ל-#jobs פר-segmentId ו-reserve עם `this` כ-producer (לא thunk)
    const segmentIds: string[] = []
    for (let i = 0; i < parts.length; i++) {
      const segmentId = crypto.randomUUID()
      const orderKey = this.#orderAlloc.next(bubbleId)
      const partText = parts[i]
      if (partText === undefined) continue
      // R3: רשום job ב-#jobs (dual-write עד Commit 4)
      this.#jobs.set(segmentId, {
        text: partText,
        provider,
        voiceId,
        modelId,
        abort: new AbortController(),
        status: "pending",
        canceled: false,
      })
      // R3: העבר `this` כ-producer (לא thunk); union ב-reserve מקבל את שניהם עד Commit 4
      this.#playlist.reserve(segmentId, orderKey, bubbleId, this)
      segmentIds.push(segmentId)
    }

    // שלב 2: קפוץ לתחילת הבועה (הסגמנט הראשון שלה)
    // playlist מתחיל לנגן אחרי #playLoop — jumpToBubble אם כבר playing
    this.#playlist.jumpToBubble(bubbleId)

    // שלב 3: fetch כל סגמנט ב-parallel (כמו Speaker.#pumpFetchLoop)
    const fetchPromises = parts.map(async (part, i) => {
      const segId = segmentIds[i]
      if (segId === undefined) return
      const job = this.#jobs.get(segId)
      try {
        if (abortCtrl.signal.aborted) {
          if (job !== undefined) { job.status = "error"; job.canceled = true }
          this.#playlist.markError(segId)
          return
        }
        if (job !== undefined) job.status = "fetching"
        const stream = await provider.synthesize({
          text: part,
          voiceId,
          modelId,
          signal: abortCtrl.signal,
        })
        // prepareSegment דרך ה-audioStream של ה-playlist (sharedAudioStream מ-+layout)
        // BubblePlayer לא מחזיק ref ל-audioStream — #playlist מחזיק אותו פנימי.
        // נעשה זאת דרך wrapper method חדש ב-AudioPlaylist.
        await this.#playlist.prepareSegmentForBubble(segId, stream, abortCtrl)
        // R3 ghost-guard (point 1): cancelFetch may have fired during prepareSegmentForBubble await.
        if (job?.canceled === true) return
        if (job !== undefined) job.status = "ready"
        this.#playlist.markReady(segId)
      } catch {
        // R3 ghost-guard (point 2): abort throws into catch; don't call markError.
        if (job?.canceled === true) return
        if (job !== undefined) job.status = "error"
        this.#playlist.markError(segId)
      }
    })

    await Promise.allSettled(fetchPromises)
    // cleanup אחרי שכל הסגמנטים סיימו — playlist ממשיך בעצמו
    if (!abortCtrl.signal.aborted) {
      this.playingBubbleId = null
    }
  }

  // ─── SegmentProducer implementation (R3) ─────────────────────────────────

  /**
   * R3: Current production status for a segment owned by this BubblePlayer.
   * pending/fetching → in-flight; error → failed; ready/missing → idle.
   */
  fetchState(segmentId: string): FetchState {
    const job = this.#jobs.get(segmentId)
    if (job === undefined) return "idle"
    if (job.status === "pending" || job.status === "fetching") return "in-flight"
    if (job.status === "error") return "failed"
    return "idle" // ready ⇒ product handed to sink; no live production
  }

  /**
   * R3: Start (or restart) synthesis for a segment. Idempotent.
   * fetching/ready → no-op. pending/error → synthesize + prepareSegment + markReady/markError.
   */
  ensureFetch(segmentId: string): void {
    const job = this.#jobs.get(segmentId)
    if (job === undefined) return
    if (job.status === "fetching" || job.status === "ready") return // already in-flight or done
    // reset for re-synthesis
    const freshAc = new AbortController()
    job.abort = freshAc
    job.canceled = false
    job.status = "fetching"
    void (async () => {
      try {
        const stream = await job.provider.synthesize({
          text: job.text,
          voiceId: job.voiceId,
          modelId: job.modelId,
          signal: freshAc.signal,
        })
        await this.#playlist.prepareSegmentForBubble(segmentId, stream, freshAc)
        // R3 ghost-guard (point 1): cancelFetch may have fired during prepareSegmentForBubble await.
        if (job.canceled) return
        job.status = "ready"
        this.#playlist.markReady(segmentId)
      } catch {
        // R3 ghost-guard (point 2): abort throws into catch; don't call markError.
        if (job.canceled) return
        job.status = "error"
        this.#playlist.markError(segmentId)
      }
    })()
  }

  /**
   * R3: Abort any live fetch; guarantee no subsequent markReady/markError.
   * Sets job.canceled=true + aborts the AbortController.
   */
  cancelFetch(segmentId: string): void {
    const job = this.#jobs.get(segmentId)
    if (job === undefined) return
    job.canceled = true // ghost-guard
    try {
      job.abort.abort()
    } catch {
      // already aborted
    }
  }

  /** עוצר כל ניגון פעיל. */
  stop(): void {
    if (this.#abortCtrl) {
      this.#abortCtrl.abort()
      this.#abortCtrl = null
    }
    // ענף user-recording: <audio>.pause()
    if (this.#audioEl) {
      try {
        this.#audioEl.pause()
      } catch {
        // כבר עצור
      }
      this.#audioEl = null
    }
    // R3: abort + clear all #jobs
    for (const [, job] of this.#jobs) {
      job.canceled = true
      try {
        job.abort.abort()
      } catch {
        // already aborted
      }
    }
    this.#jobs.clear()
    this.playingBubbleId = null
  }
}
