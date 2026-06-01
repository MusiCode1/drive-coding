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
 * Slice 22: OrderAllocator מקצה orderKey דטרמיניסטי לכל job (seq יציב
 * פר-bubble, segmentIndex עולה פר משפט). Player מנגן לפי סדר זה גם
 * כשfetch מקבילי חוזר בסדר הפוך. קריינות כלים (tool narration) הוכנסה
 * לתור כ-job רגיל עם orderKey כרונולוגי.
 *
 * כללי ריאקטיביות (Svelte 5):
 *   - קריאות מ-`session.bubbles[*].segments` הן בתוך ה-effect וכן נעקבות.
 *     זה מה שגורם ל-Speaker לרוץ מחדש כשמקטעים מגיעים.
 *   - כתיבות ל-`#bubbleStates` ו-`#jobs` הן מבני נתונים רגילים (לא state)
 *     ולא מפעילות מחדש. כתיבות state (`state`, `currentSegmentId`)
 *     עוברות דרך `untrack` בזהירות (learnings 2026-05-16).
 */

import { splitIntoSentences } from "@drive-coding/core/voice/sentence-boundary"
import {
  OrderAllocator,
  type OrderKey,
} from "@drive-coding/core/voice/tts-queue"
import { cacheKeyFor } from "@drive-coding/core/voice/cache-key"
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
  kind: "message" | "thought" | "tool"   // slice 22: הוסף "tool"
  messageId: string | null
  text: string
  status: TtsJobStatus
  abort: AbortController
  /** Slice 4: מזהה בועה, בשימוש jobs של מחשבות לכתיבת טקסט מתורגם חזרה. */
  bubbleId?: string
  // ─── slice 22 ───
  orderKey: OrderKey            // (seq, segmentIndex)
  /** ל-tool: toolCallId לכתיבת narration חזרה לבועה אחרי ה-fetch. */
  toolCallId?: string
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
  // slice 22: #narratingCallIds הוסר — #processedNarrationCallIds הוא ה-guard
  /** קריאות tool שכבר סוּפרו או דולגו בכוונה (השמעה חוזרת של היסטוריה / כשל narrate). */
  #processedNarrationCallIds: Set<string> = new Set()
  /** slice 22: מקצה orderKey לבועות. לוגיקה ב-core (נבדק unit). */
  readonly #orderAlloc = new OrderAllocator()

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
    const bid = bubbleId ?? messageId ?? crypto.randomUUID()
    // slice 22: הקצה orderKey דטרמיניסטי — seq יציב פר-bubble, segmentIndex עולה
    const orderKey = this.#orderAlloc.next(bid)
    this.#jobs.push({
      segmentId: crypto.randomUUID(),
      kind,
      messageId,
      text,
      status: "pending",
      abort: new AbortController(),
      bubbleId,
      orderKey,
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
      } else if (job.kind === "tool") {
        // slice 22: narration נוצר כאן (best-effort). null → דלג על ה-job.
        const narrationText = await this.#narrateForJob(job)
        if (narrationText === null) { job.status = "error"; return }
        text = narrationText
      }

      if (job.abort.signal.aborted) {
        job.status = "error"
        return
      }

      // slice 22: חשב textHash על הטקסט שמסונתז (provenance)
      const textHash = await cacheKeyFor(text, this.#settings.voiceId, "eleven_v3")
      const stream = await synthesizeStreaming({
        text,
        voiceId: this.#settings.voiceId,
        signal: job.abort.signal,
      })
      await this.#audioStream.prepareSegment(job.segmentId, stream, job.abort, {
        messageId: job.messageId,
        textHash,
      })
      this.#player.addSegment(job.segmentId, job.orderKey)
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
   * Slice 4: עבור כל ToolBubble שהושלמה שחסרה narration, צור TTS job עם orderKey.
   * נקרא מ-untrack() — כתיבות אסינכרוניות חוזרות דרך proxy של $state (בסדר).
   * slice 22: הסיר #narratingCallIds (היה memory leak potential). Guard: #processedNarrationCallIds.
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
      // slice 22: ה-#narratingCallIds Set הוסר. guard: #processedNarrationCallIds בלבד.
      this.#processedNarrationCallIds.add(tc.toolCallId)

      // slice 22: הקצה orderKey כרונולוגי לבועת ה-tool (כמו message/thought),
      // דרך אותו OrderAllocator — לכן ה-seq של ה-tool נכון יחסית למשפטים סביבו.
      const bid = bubble.id
      const orderKey = this.#orderAlloc.next(bid)

      this.#jobs.push({
        segmentId: crypto.randomUUID(),
        kind: "tool",
        messageId: null,
        text: "",            // יתמלא ב-#narrateForJob
        status: "pending",
        abort: new AbortController(),
        bubbleId: bid,
        toolCallId: tc.toolCallId,
        orderKey,
      })
      this.#pumpFetchLoop()
    }
  }

  /**
   * slice 22: קוראת narrate(), כותבת את הטקסט חזרה לבועה (לתצוגה),
   * ומחזירה את הטקסט ל-TTS. מאחדת לוגיקה שהייתה ב-.then() הישן.
   */
  async #narrateForJob(job: TtsJob): Promise<string | null> {
    if (job.toolCallId === undefined || job.bubbleId === undefined) return null
    const idx = this.#session.bubbles.findIndex((b) => b.id === job.bubbleId)
    if (idx === -1) return null
    const b = this.#session.bubbles[idx]
    if (b === undefined || b.kind !== "tool") return null
    const tc = b.toolCall

    const ctx: NarrateContext = {
      userMessage: this.#session.lastUserMessage,
      recentMessages: this.#session.recentAssistantMessages(3),
    }
    const tool: ToolCallForNarrate = {
      toolCallId: tc.toolCallId,
      kind: tc.kind,
      title: tc.title ?? tc.name,
    }
    const text = await narrate(ctx, tool, job.abort.signal)
    if (text === null) return null

    // כתוב narration חזרה לבועה (תצוגה) — Svelte 5: החלף בועה שלמה.
    const cur = this.#session.bubbles.findIndex((x) => x.id === job.bubbleId)
    if (cur !== -1) {
      const maybe = this.#session.bubbles[cur]
      if (maybe !== undefined && maybe.kind === "tool") {
        this.#session.bubbles[cur] = {
          ...maybe,
          toolCall: { ...maybe.toolCall, narration: text },
        }
      }
    }
    return text
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
    // slice 22: נקה את ה-allocator (seq גלובלי לא מתאפס — מונוטוני בין שיחות)
    this.#orderAlloc.clear()
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
