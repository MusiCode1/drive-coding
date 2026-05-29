/**
 * Speaker — "פיו" של הסוכן.
 *
 * מנוי ל-AgentSession.bubbles. עבור כל מקטע חדש של בועת הודעה או
 * מחשבה:
 *   1. צובר טקסט לתוך buffer פר-בועה
 *   2. מריץ `splitIntoSentences` לחילוץ משפטים שלמים
 *   3. מכניס לתור TTS job לכל משפט
 *   4. לולאת ה-fetch מכבדת lookahead של LOOKAHEAD fetches מקביליים
 *   5. כל fetch שהושלם מועבר ל-`Player` דרך `AudioStream`
 *
 * מחשבות עוברות תרגום Gemini לעברית לפני TTS. הודעות מושמעות כמות שהן
 * (הסוכן כבר מקבל הוראה להגיב בעברית).
 *
 * Slice 2: Speaker מחזיק את מזהה הקול כ-`const`. Slice 9 יחבר אותו
 * דרך Settings — אותו שדה, פשוט הופך ל-getter דינמי.
 *
 * כללי ריאקטיביות (Svelte 5):
 *   - קריאות מ-`session.bubbles[*].segments` הן בתוך ה-effect וכן נעקבות.
 *     זה מה שגורם ל-Speaker לרוץ מחדש כשמקטעים מגיעים.
 *   - כתיבות ל-`#bubbleStates` ו-`#jobs` הן מבני נתונים רגילים (לא state)
 *     ולא מפעילות מחדש. כתיבות state (`state`, `currentSegmentId`)
 *     עוברות דרך `untrack` בזהירות (learnings 2026-05-16).
 */

import { splitIntoSentences } from "@drive-coding/core/voice/sentence-boundary"
import { untrack } from "svelte"
import type { AgentSession, AgentSessionStatus } from "./agent-session.svelte"
import type { Settings } from "./settings.svelte"
import type { ThoughtBubble, ToolBubble } from "$lib/types/bubble"
import { AudioStream } from "../engines/audio-stream"
import { Player } from "../engines/player.svelte"
import { synthesizeStreaming } from "../adapters/voice/tts"
import { translate } from "../adapters/voice/translate"
import { narrate } from "../adapters/voice/narrate"
import type { NarrateContext, ToolCallForNarrate } from "@drive-coding/core/voice/narration-prompt"

const TARGET_LANG = "he" as const
const MIN_CHARS = 20
const MAX_CHARS = 200
const LOOKAHEAD = 2

export type TtsJobStatus = "pending" | "fetching" | "ready" | "error"

export type TtsJob = {
  segmentId: string
  kind: "message" | "thought"
  messageId: string | null
  text: string
  status: TtsJobStatus
  abort: AbortController
  /** Slice 4: מזהה בועה, בשימוש jobs של מחשבות לכתיבת טקסט מתורגם חזרה. */
  bubbleId?: string
}

type BubbleState = {
  processedSegments: number
  buffer: string
}

export class Speaker {
  enabled: boolean = $state(true)

  readonly #session: AgentSession
  readonly #settings: Settings
  readonly #audioStream: AudioStream
  readonly #player: Player

  /**
   * נגזר מ-`#player.state`. מיושם כ-getter ולא כשדה `$derived`
   * כדי שההפניה ל-`#player` תוערך lazily אחרי שהבנאי רץ
   * (TypeScript לא מאפשר הפניה קדמית לשדות פרטיים מ-field initializer).
   * ה-getter עדיין נעקב: קריאה של `#player.state` בתוכו מושכת
   * את תלות ה-`$state` הבסיסית.
   */
  get state(): "idle" | "speaking" {
    return this.#player.state === "playing" ? "speaking" : "idle"
  }

  #bubbleStates: Map<string, BubbleState> = new Map()
  #jobs: TtsJob[] = []
  #activeFetches = 0
  #prevStatus: AgentSessionStatus = "idle"
  /** Slice 4: עוקב כמה מקטעים של כל ThoughtBubble תורגמו. */
  #translatedSegByBubble: Map<string, number> = new Map()
  /** Slice 4: toolCallIds שמסופרים כעת (מונע כפילות narrations בטיסה). */
  #narratingCallIds: Set<string> = new Set()
  /** קריאות tool שכבר סוּפרו או דולגו בכוונה (השמעה חוזרת של היסטוריה / כשל narrate). */
  #processedNarrationCallIds: Set<string> = new Set()

  // מוגדר על ידי הבנאי — נשמר כדי שה-destroy() יוכל לעצור את ה-effect.
  #disposeEffect: (() => void) | null = null

  constructor(opts: { session: AgentSession; settings: Settings }) {
    this.#session = opts.session
    this.#settings = opts.settings
    this.#audioStream = new AudioStream()
    this.#player = new Player(this.#audioStream)

    // ה-effect היחיד שמניע הכל: קורא bubbles + status + enabled.
    // כתיבות עטופות ב-`untrack` (gotcha §6 #5).
    this.#disposeEffect = $effect.root(() => {
      $effect(() => {
        // ── קריאות (נעקבות) ────────────────────────────────────────────
        const status = this.#session.status
        const enabled = this.enabled
        // עוברים על bubbles → קוראים bubble.kind, bubble.id, bubble.messageId,
        // bubble.segments (ודרך שומר ספירת המקטעים, bubble.segments.length)
        const bubbles = this.#session.bubbles
        // נועל ריאקטיביות על segments.length של כל בועה כדי ש-`push` ל-
        // segments יפעיל את ה-effect (gotcha §6 #2).
        const _segCounts = bubbles
          .filter((b) => b.kind === "message" || b.kind === "thought")
          .map((b) => (b as { segments: { id: string }[] }).segments.length)
        void _segCounts
        // Slice 4: נעקב כדי ש-$effect ירוץ מחדש כאשר loadSession() מסיים
        // ומנקה את הדגל — מאפשר למקטעים חיים חדשים לזרום ל-TTS.
        const isLoadingHistory = this.#session.isLoadingHistory
        // Slice 4: נועל ריאקטיביות על סטטוס בועת tool + narration כדי להבחין
        // כאשר קריאת tool מושלמת או narration נכתב חזרה.
        const _toolStatus = bubbles
          .filter((b) => b.kind === "tool")
          .map((b) => {
            const tc = (b as ToolBubble).toolCall
            return `${tc.toolCallId}:${tc.status}:${tc.narration ?? ""}`
          })
        void _toolStatus

        // ── כתיבות (לא-נעקבות) ─────────────────────────────────────────
        untrack(() => {
          this.#processBubbles(bubbles, enabled, isLoadingHistory)
          this.#processToolBubbles(bubbles, isLoadingHistory)
          this.#handleStatusTransition(status, enabled)
          this.#prevStatus = status
        })
      })
    })
  }

  /**
   * מחליף הפעלת קול. כיבוי מנקה את התור ועוצר הפעלה.
   * הפעלה מחדש **אינה** משחזרת היסטוריה — רק מקטעים חדשים שמגיעים מושמעים.
   */
  toggle(): void {
    this.enabled = !this.enabled
    if (!this.enabled) this.#stopAndClear()
  }

  /**
   * עוצר הפעלה + מנקה TTS jobs ממתינים, ללא שינוי של `enabled`.
   * בניגוד ל-toggle(): toggle גם מעיף את enabled. stop() רק עוצר.
   * בשימוש ע"י: VoiceMode.cancel() (slice 3).
   */
  stop(): void {
    this.#stopAndClear()
  }

  destroy(): void {
    this.#disposeEffect?.()
    this.#disposeEffect = null
    this.#stopAndClear()
  }

  // ──────────────────────────────────────────────────────────────────────
  // פנימיות
  // ──────────────────────────────────────────────────────────────────────

  #processBubbles(
    bubbles: AgentSession["bubbles"],
    enabled: boolean,
    isLoadingHistory: boolean,
  ): void {
    // Slice 4: בזמן ש-loadSession() משחזר היסטוריה, מסמן בועות כמעובדות
    // ללא הכנסת TTS jobs לתור. ה-effect רץ מחדש ברגע שה-isLoadingHistory → false,
    // ובאותה נקודה מקטעים חיים חדשים חוזרים לזרום TTS רגיל.
    if (isLoadingHistory) {
      for (const bubble of bubbles) {
        if (bubble.kind !== "message" && bubble.kind !== "thought") continue
        let state = this.#bubbleStates.get(bubble.id)
        if (state === undefined) {
          state = { processedSegments: 0, buffer: "" }
          this.#bubbleStates.set(bubble.id, state)
        }
        state.processedSegments = bubble.segments.length
        state.buffer = ""
      }
      return
    }

    for (const bubble of bubbles) {
      if (bubble.kind !== "message" && bubble.kind !== "thought") continue
      const segArr = bubble.segments
      let state = this.#bubbleStates.get(bubble.id)
      if (state === undefined) {
        state = { processedSegments: 0, buffer: "" }
        this.#bubbleStates.set(bubble.id, state)
      }

      if (state.processedSegments >= segArr.length) continue

      const newChunks = segArr
        .slice(state.processedSegments)
        .map((s) => s.text)
        .join("")
      state.processedSegments = segArr.length

      if (!enabled) {
        // מושלך — כשמופעל שוב לאחר מכן לא רוצים לשגר תוכן ישן.
        state.buffer = ""
        continue
      }

      state.buffer += newChunks
      const { sentences, remaining } = splitIntoSentences(state.buffer, {
        minChars: MIN_CHARS,
        maxChars: MAX_CHARS,
      })
      state.buffer = remaining

      for (const sentence of sentences) {
        this.#enqueue(bubble.kind, bubble.messageId, sentence, bubble.id)
      }
    }
    this.#pumpFetchLoop()
  }

  #handleStatusTransition(status: AgentSessionStatus, enabled: boolean): void {
    // התור הסתיים? פלוש כל buffer פר-בועה כמקטע אחרון.
    const justFinished =
      this.#prevStatus === "thinking" && (status === "connected" || status === "error")
    if (justFinished && enabled) {
      for (const [bubbleId, state] of this.#bubbleStates) {
        if (state.buffer.trim().length === 0) continue
        const bubble = this.#session.bubbles.find((b) => b.id === bubbleId)
        if (bubble === undefined) continue
        if (bubble.kind !== "message" && bubble.kind !== "thought") continue
        this.#enqueue(bubble.kind, bubble.messageId, state.buffer.trim(), bubble.id)
        state.buffer = ""
      }
      this.#pumpFetchLoop()
    }
  }

  #enqueue(
    kind: "message" | "thought",
    messageId: string | null,
    text: string,
    bubbleId?: string,
  ): void {
    if (text.length === 0) return
    this.#jobs.push({
      segmentId: crypto.randomUUID(),
      kind,
      messageId,
      text,
      status: "pending",
      abort: new AbortController(),
      bubbleId,
    })
  }

  #pumpFetchLoop(): void {
    while (this.#activeFetches < LOOKAHEAD) {
      const job = this.#jobs.find((j) => j.status === "pending")
      if (job === undefined) break
      job.status = "fetching"
      this.#activeFetches += 1
      void this.#fetchJob(job).finally(() => {
        this.#activeFetches -= 1
        this.#pumpFetchLoop()
      })
    }
  }

  async #fetchJob(job: TtsJob): Promise<void> {
    try {
      let text = job.text
      if (job.kind === "thought") {
        const result = await translate(text, TARGET_LANG, job.abort.signal)
        if (result !== null && result.status === "translated") {
          // Slice 4: כתיבה חזרה למקטע כדי ש-ThoughtBubble יוכל להציג HE+EN.
          if (job.bubbleId !== undefined) {
            this.#persistThoughtTranslation(job.bubbleId, job.text, result.text)
          }
          text = result.text
        }
        // already_in_target או null → שמור טקסט מקורי (originalText נשאר undefined)
      }

      if (job.abort.signal.aborted) {
        job.status = "error"
        return
      }

      const stream = await synthesizeStreaming({
        text,
        voiceId: this.#settings.voiceId,
        signal: job.abort.signal,
      })
      await this.#audioStream.prepareSegment(job.segmentId, stream, job.abort)
      this.#player.addSegment(job.segmentId)
      job.status = "ready"
    } catch (e) {
      // MIN-5: דלג + המשך, אל תזרוק.
      job.status = "error"
      console.warn("TTS job failed, skipping segment", {
        id: job.segmentId,
        err: e instanceof Error ? e.message : String(e),
      })
    }
  }

  /**
   * Slice 4: עבור כל ToolBubble שהושלמה שחסרה narration, פתח narrate() בשריפה-ושכח.
   * נקרא מ-untrack() — כתיבות אסינכרוניות חוזרות דרך proxy של $state (בסדר).
   */
  #processToolBubbles(
    bubbles: AgentSession["bubbles"],
    isLoadingHistory: boolean,
  ): void {
    for (const bubble of bubbles) {
      if (bubble.kind !== "tool") continue
      const tc = (bubble as ToolBubble).toolCall
      if (isLoadingHistory) {
        this.#processedNarrationCallIds.add(tc.toolCallId)
        continue
      }
      if (tc.status !== "completed") continue
      if (tc.narration !== undefined) {
        this.#processedNarrationCallIds.add(tc.toolCallId)
        continue
      }
      if (this.#processedNarrationCallIds.has(tc.toolCallId)) continue
      if (this.#narratingCallIds.has(tc.toolCallId)) continue  // בטיסה

      this.#narratingCallIds.add(tc.toolCallId)
      this.#processedNarrationCallIds.add(tc.toolCallId)

      const ctx: NarrateContext = {
        userMessage: this.#session.lastUserMessage,
        recentMessages: this.#session.recentAssistantMessages(3),
      }
      const tool: ToolCallForNarrate = {
        toolCallId: tc.toolCallId,
        kind: tc.kind,
        title: tc.title ?? tc.name,
      }
      const bubbleId = bubble.id

      void narrate(ctx, tool).then((text) => {
        if (text === null) return
        const idx = this.#session.bubbles.findIndex((b) => b.id === bubbleId)
        if (idx === -1) return
        const maybeBubble = this.#session.bubbles[idx]
        if (maybeBubble === undefined || maybeBubble.kind !== "tool") return
        const old: ToolBubble = maybeBubble
        // החלף בועה שלמה (ריאקטיביות Svelte 5).
        this.#session.bubbles[idx] = {
          ...old,
          toolCall: { ...old.toolCall, narration: text },
        }
      }).finally(() => {
        this.#narratingCallIds.delete(tc.toolCallId)
      })
    }
  }

  /**
   * Slice 4: כתיבת תוצאת תרגום חזרה למקטע של ThoughtBubble.
   *
   * כל TtsJob עבור בועת מחשבה תואם למשפט אחד מה-buffer המצטבר.
   * ממפים jobs ברצף למקטעים (מונה segIdx פר-בועה). הערת דיוק: גבולות משפט
   * אינם מתואמים בדיוק עם גבולות מקטע ACP — התרגום המוצג הוא ברמת משפט, לא
   * ברמת מקטע. מקובל למטרות תצוגת MVP.
   *
   * אחרי עדכון: seg.text = עברית (בולטת), seg.originalText = אנגלית (קטנה).
   * Svelte 5: החלף אובייקט בועה שלם כדי להפעיל ריאקטיביות.
   */
  #persistThoughtTranslation(
    bubbleId: string,
    originalEnglish: string,
    translatedHebrew: string,
  ): void {
    const idx = this.#session.bubbles.findIndex((b) => b.id === bubbleId)
    if (idx === -1) return
    const maybeBubble = this.#session.bubbles[idx]
    if (maybeBubble === undefined || maybeBubble.kind !== "thought") return
    const bubble: ThoughtBubble = maybeBubble

    const segIdx = this.#translatedSegByBubble.get(bubbleId) ?? 0
    if (segIdx >= bubble.segments.length) {
      // יותר משפטים ממקטעים — אין מקטע לעדכן.
      return
    }

    // החלף את המקטע ב-segIdx: החלף text → עברית, originalText → אנגלית.
    const updatedSegments: ThoughtBubble["segments"] = bubble.segments.map((seg, i) =>
      i === segIdx
        ? { ...seg, text: translatedHebrew, originalText: originalEnglish }
        : seg,
    )
    // החלף בועה שלמה (ריאקטיביות Svelte 5 — השמת index מפעילה עדכון).
    this.#session.bubbles[idx] = { ...bubble, segments: updatedSegments }
    this.#translatedSegByBubble.set(bubbleId, segIdx + 1)
  }

  #stopAndClear(): void {
    for (const job of this.#jobs) {
      if (job.status === "fetching" || job.status === "pending") {
        try {
          job.abort.abort()
        } catch {
          // כבר בוטל
        }
      }
    }
    this.#jobs = []
    this.#player.stop()
    this.#audioStream.clear()
    // סמן כל בועה קיימת כמעובדת לחלוטין כך שהפעלה מחדש לא תשחזר.
    for (const bubble of this.#session.bubbles) {
      if (bubble.kind !== "message" && bubble.kind !== "thought") continue
      const state = this.#bubbleStates.get(bubble.id) ?? {
        processedSegments: 0,
        buffer: "",
      }
      state.processedSegments = bubble.segments.length
      state.buffer = ""
      this.#bubbleStates.set(bubble.id, state)
    }
  }
}
