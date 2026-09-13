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

import { createI18n, detectLocale } from "@drive-coding/core/i18n"
import type { AudioEmbedRef } from "@drive-coding/core/voice/audio-embed"
import { toSpeakableParts } from "@drive-coding/core/voice/speakable"
import type { OrderAllocator } from "@drive-coding/core/voice/tts-queue"
import { playUserRecording } from "$lib/adapters/voice/play-bubble"
import { resolveTts } from "$lib/adapters/voice/tts-resolve"
import type { AudioPlaylist, SegmentOwner } from "$lib/engines/audio-playlist.svelte"
import type { AudioSink } from "$lib/engines/audio-sink"
import type { Bubble } from "$lib/types/bubble"
import { bubbleInlineAudioHooks, fetchInlineAudioForBubble } from "$lib/adapters/voice/inline-audio-fetch"
import { buildInlineAudioQueue } from "$lib/engines/inline-audio-queue"
import { safeUUID } from "$lib/util/uuid"
import type { AgentSession } from "./agent-session.svelte"
import { ttsCapabilities } from "./capabilities.svelte"
import type { Settings } from "./settings.svelte"

// ─── קבועים לחיתוך משפטים (זהה ל-Speaker) ──────────────────────────────────
const MIN_CHARS = 20
const MAX_CHARS = 200

export class BubblePlayer implements SegmentOwner {
  playingBubbleId: string | null = $state(null)

  readonly #session: AgentSession
  readonly #settings: Settings
  /** A4: פלייליסט משותף עם Speaker. */
  readonly #playlist: AudioPlaylist
  readonly #audioStream: AudioSink
  #audioEl: HTMLAudioElement | null = null
  #abortCtrl: AbortController | null = null
  /** A4: OrderAllocator לסגמנטים שלנו — seq נפרד מ-Speaker. */
  readonly #orderAlloc: OrderAllocator
  readonly #refetchBySegment = new Map<string, () => void>()

  constructor(opts: {
    session: AgentSession
    settings: Settings
    playlist: AudioPlaylist
    audioStream: AudioSink
    orderAlloc: OrderAllocator
  }) {
    this.#orderAlloc = opts.orderAlloc
    this.#session = opts.session
    this.#settings = opts.settings
    this.#playlist = opts.playlist
    this.#audioStream = opts.audioStream
  }

  /**
   * לחיצה שנייה על אותה בועה → עוצר. אחרת מנגן.
   * no-op אם turnState !== "idle" (§9 Q3 — שמור guard כמו היום).
   */
  #bubbleHasPlayableItems(bubbleId: string): boolean {
    return this.#playlist.items.some(
      (it) =>
        it.bubbleId === bubbleId &&
        (it.state === "ready" ||
          it.state === "playing" ||
          it.state === "done" ||
          (it.state === "reserved" && it.needsRefetch === true)),
    )
  }

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
  /** אותו דפוס כמו ב-Speaker: createI18n לפי settings.locale, בלי תלות-בנאי חדשה. */
  #t(key: Parameters<ReturnType<typeof createI18n>["t"]>[0]): string {
    return createI18n({ locale: this.#settings.locale ?? detectLocale() }).t(key)
  }

  async #reserveAndPlay(bubbleId: string, text: string, abortCtrl: AbortController): Promise<void> {
    const labels = {
      codeBlock: this.#t("speakable.codeBlock"),
      codeBlockWithLang: (lang: string) => `${this.#t("speakable.codeBlock")} ${lang}`,
      link: this.#t("speakable.link"),
      image: this.#t("speakable.image"),
    }
    const parts = toSpeakableParts(text, labels, { cwd: this.#session.cwd })
    const queue = buildInlineAudioQueue(parts, {
      minChars: MIN_CHARS,
      maxChars: MAX_CHARS,
      autoPlayInlineAudio: this.#settings.autoPlayInlineAudio,
    })

    // V4b: העברת geminiVoice לresolveTts (נשמר מ-dev בזמן reconcile)
    const { provider, voiceId, modelId } = resolveTts(
      this.#settings.ttsProvider,
      this.#settings.voiceId,
      this.#settings.geminiVoice,
    )
    // Commit 4 capability-gate: אל תנסה synthesize לספק לא-זמין.
    if (!ttsCapabilities.isAvailable(this.#settings.ttsProvider)) {
      console.warn("[BubblePlayer] TTS provider unavailable, skipping bubble", {
        provider: this.#settings.ttsProvider,
        bubbleId,
      })
      this.playingBubbleId = null
      return
    }

    // שלב 1: reserve כל הסגמנטים לפלייליסט (reserve-on-enqueue)
    // nav-retain: כל reserve מקבל refetch thunk עם הטקסט + provider בסקופ (finding #1)
    const segmentIds: string[] = []
    for (const part of queue) {
      const segmentId = safeUUID()
      const orderKey = this.#orderAlloc.next(bubbleId)
      if (part.kind === "text") {
        const partText = part.text
        this.#refetchBySegment.set(segmentId, () => {
          const freshAc = new AbortController()
          void (async () => {
            try {
              const stream = await provider.synthesize({
                text: partText,
                voiceId,
                modelId,
                signal: freshAc.signal,
                directing: { pace: this.#settings.geminiPace, tone: this.#settings.geminiTone },
              })
              await this.#playlist.prepareSegmentForBubble(segmentId, stream, freshAc, {
                format: provider.format,
              })
              this.#playlist.markReady(segmentId)
            } catch {
              if (freshAc.signal.aborted) {
                this.#playlist.markAbandoned(segmentId)
              } else {
                this.#playlist.markError(segmentId)
              }
            }
          })()
        })
      } else {
        const fileRef: AudioEmbedRef = {
          title: part.file.title,
          href: part.file.href,
          uri: part.file.uri,
        }
        this.#refetchBySegment.set(segmentId, () => {
          const freshAc = new AbortController()
          void fetchInlineAudioForBubble(
            segmentId,
            fileRef,
            freshAc,
            provider,
            voiceId,
            modelId,
            { pace: this.#settings.geminiPace, tone: this.#settings.geminiTone },
            bubbleInlineAudioHooks(this.#playlist, this.#audioStream),
          )
        })
      }
      this.#playlist.reserve(segmentId, orderKey, bubbleId, this)
      segmentIds.push(segmentId)
    }

    const fetchPromises = queue.map(async (part, i) => {
      const segId = segmentIds[i]
      if (segId === undefined) return
      try {
        if (abortCtrl.signal.aborted) {
          this.#playlist.markAbandoned(segId)
          return
        }
        if (part.kind === "file") {
          const fileRef: AudioEmbedRef = {
            title: part.file.title,
            href: part.file.href,
            uri: part.file.uri,
          }
          return fetchInlineAudioForBubble(
            segId,
            fileRef,
            abortCtrl,
            provider,
            voiceId,
            modelId,
            { pace: this.#settings.geminiPace, tone: this.#settings.geminiTone },
            bubbleInlineAudioHooks(this.#playlist, this.#audioStream),
          )
        }
        const stream = await provider.synthesize({
          text: part.text,
          voiceId,
          modelId,
          signal: abortCtrl.signal,
          directing: { pace: this.#settings.geminiPace, tone: this.#settings.geminiTone },
        })
        await this.#playlist.prepareSegmentForBubble(segId, stream, abortCtrl, {
          format: provider.format,
        })
        this.#playlist.markReady(segId)
      } catch {
        if (abortCtrl.signal.aborted) {
          this.#playlist.markAbandoned(segId)
        } else {
          this.#playlist.markError(segId)
        }
      }
    })

    // ⚠️ **הקפיצה אחרי שיגור ה-fetches, לא לפניו.**
    //
    // 🔴 `#navigate` מסמן את פריט-היעד `needsRefetch = true` כשהוא אינו
    // שלם — וכשהקפיצה קדמה ל-fetch, הפריט **תמיד** לא היה שלם. אז
    // `#playLoop` קרא `owner.refetch()`, והמשפט הראשון סונתז **פעמיים
    // במקביל**; ה-`prepareSegment` השני פירק את הראשון — כלומר חתך את
    // המשפט באמצע מילה. אומת ב-probe של ה-review.
    this.#playlist.jumpToBubble(bubbleId)

    await Promise.allSettled(fetchPromises)
    // ⚠️ **אין כאן איפוס של `playingBubbleId`.**
    //
    // ‏`fetchPromises` הן `prepareSegment` + `markReady` — כלומר **סינתזה**,
    // לא השמעה. האיפוס כאן כיבה את חיווי-הניגון וגם את מסלול
    // "לחיצה-שנייה-עוצרת" **באמצע** ההשמעה, כי הפלייליסט רק אז מתחיל.
    // מי שמסיים באמת הוא הפלייליסט; האיפוס נשאר ל-`stop()` ולניווט.
    // ⚠️ **מנקים רק את שלנו.** גרסה קודמת קראה `#pruneRefetch(segmentIds)`
    // שמחקה כל מפתח שאינו ברשימה **שלנו** — כולל thunks שהפעלה **חדשה**
    // יותר כבר רשמה. השמעה A ואז B: הפרונינג המאוחר של A מחק את אלה של B,
    // ואז `refetch` על B הפך ל-no-op שקט → המתנה של 20 שניות → `skipped`.
    // אומת ב-code review.
    for (const id of segmentIds) this.#refetchBySegment.delete(id)
  }

  /** עוצר כל ניגון פעיל. */
  refetch(segmentId: string): void {
    this.#refetchBySegment.get(segmentId)?.()
  }

  invalidate(_segmentId: string): void {
    // BubblePlayer: אין TtsJob table — invalidate הוא no-op (מונה-דור ב-playlist)
  }

  stop(): void {
    this.#playlist.stop()
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
    this.playingBubbleId = null
  }
}
