/**
 * Speaker — "פיו" של הסוכן.
 *
 * מנוי ל-AgentSession.bubbles. עבור כל מקטע חדש של בועת הודעה או
 * מחשבה:
 *   1. צובר טקסט לתוך buffer פר-בועה
 *   2. מריץ `splitIntoSentences` לחילוץ משפטים שלמים
 *   3. מכניס לתור TTS job לכל משפט
 *   4. לולאת ה-fetch מכבדת lookahead של LOOKAHEAD fetches מקביליים
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

import { createI18n, detectLocale } from "@drive-coding/core/i18n"
import { cacheKeyFor } from "@drive-coding/core/voice/cache-key"
import { DEFAULT_VOICE_CONFIG } from "@drive-coding/core/voice/capabilities"
import type { NarrateContext, ToolCallForNarrate } from "@drive-coding/core/voice/narration-prompt"
import { select } from "@drive-coding/core/voice/select"
import { splitIntoSentences } from "@drive-coding/core/voice/sentence-boundary"
import {
  type SpeakableLabels,
  splitStreamable,
  toSpeakable,
} from "@drive-coding/core/voice/speakable"
import type { OrderAllocator, OrderKey } from "@drive-coding/core/voice/tts-queue"
import { untrack } from "svelte"
import { registerSpeaker, type SpeakerDebugInfo } from "$lib/debug/playback-registry"
import type { ThoughtBubble, ToolBubble } from "$lib/types/bubble"
import { safeUUID } from "$lib/util/uuid"
import { narrate } from "../adapters/voice/narrate"
import { translate } from "../adapters/voice/translate"
import { resolveTts } from "../adapters/voice/tts-resolve"
import type { AudioPlaylist, SegmentOwner } from "../engines/audio-playlist.svelte"
import type { AudioSink } from "../engines/audio-sink"
import type { CuesEngine } from "../engines/cues"
import type { AgentSession, AgentSessionStatus, TurnState } from "./agent-session.svelte"
import { ttsCapabilities } from "./capabilities.svelte"
import type { Settings } from "./settings.svelte"

const TARGET_LANG = "he" as const
const MIN_CHARS = 20
const MAX_CHARS = 200
const LOOKAHEAD = 2

export type TtsJobStatus = "pending" | "fetching" | "ready" | "error" | "stale"

/** תוצאת #fetchJob — כל מסלול חייב לדווח (אין return שקט). */
export type FetchOutcome =
  | { kind: "ready" }
  /** ננטש ביוזמת הפלייליסט (ניווט/עצירה) — הפריט נשאר reserved וניתן לשחזור. */
  | { kind: "abandoned" }
  /** כשל אמיתי — markError, הפריט מדולג. */
  | { kind: "error"; reason: "narration-null" | "provider-unavailable" | "synthesize-failed" }

export type TtsJob = {
  segmentId: string
  kind: "message" | "thought" | "tool" // slice 22: הוסף "tool"
  messageId: string | null
  text: string
  status: TtsJobStatus
  abort: AbortController
  /** Slice 4: מזהה בועה, בשימוש jobs של מחשבות לכתיבת טקסט מתורגם חזרה. */
  bubbleId?: string
  // ─── slice 22 ───
  orderKey: OrderKey // (seq, segmentIndex)
  /** ל-tool: toolCallId לכתיבת narration חזרה לבועה אחרי ה-fetch. */
  toolCallId?: string
}

type BubbleState = {
  processedSegments: number
  /** טקסט **גולמי** שטרם עובר. לעולם לא מכיל תוצר של `toSpeakable`. */
  buffer: string
  /** טקסט **מעובד** שטרם השלים משפט. לעולם לא מעובד שוב. */
  speakPending: string
}

export class Speaker implements SegmentOwner {
  // ui-polish-batch C8: מאותחל מ-settings.muted (false = מופעל, true = מושתק)
  enabled: boolean = $state(true)

  readonly #session: AgentSession
  readonly #settings: Settings
  readonly #audioStream: AudioSink
  readonly #player: AudioPlaylist
  readonly #cues?: CuesEngine
  // slice 6: guard — מונע ניגון חוזר של cue "speaking" באותו תור (re-entry סדרתי)
  #spokeThisTurn = false

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
  /** ─── slice playback-observability ─── טבעת של הטקסטים האחרונים שנשלחו. */
  #recentTexts: string[] = []
  /** ─── slice replay-quiet Commit 0 ─── מקבל משמעות ב-Commit 2. */
  #seenHistoryEpoch = 0
  /** ─── slice replay-quiet Commit 0 ─── תור מקביל ל-#recentTexts. */
  #recentSources: string[] = []
  /** msr-v2: ספירת jobs ממתינים + בהבאה — reactive ($state) כדי ש-hasPendingNarration יהיה reactive. */
  #pendingCount = $state(0)

  /** msr-v2: האם יש TTS jobs בתהליך. משמש את ModelStatus לשלב pending-tts. */
  get hasPendingNarration(): boolean {
    return this.#pendingCount > 0
  }

  #prevStatus: AgentSessionStatus = "idle"
  #prevTurnState: TurnState = "idle"
  /** Slice 4: עוקב כמה מקטעים של כל ThoughtBubble תורגמו. */
  #translatedSegByBubble: Map<string, number> = new Map()
  // slice 22: #narratingCallIds הוסר — #processedNarrationCallIds הוא ה-guard
  /** קריאות tool שכבר סוּפרו או דולגו בכוונה (השמעה חוזרת של היסטוריה / כשל narrate). */
  #processedNarrationCallIds: Set<string> = new Set()
  /** slice 22: מקצה orderKey לבועות. לוגיקה ב-core (נבדק unit). */
  readonly #orderAlloc: OrderAllocator

  // מוגדר על ידי הבנאי — נשמר כדי שה-destroy() יוכל לעצור את ה-effect.
  #disposeEffect: (() => void) | null = null

  constructor(opts: {
    session: AgentSession
    settings: Settings
    cues?: CuesEngine
    /**
     * A4: פלייליסט משותף + sink — יוצרים ב-+layout ומוזרקים גם לBubblePlayer.
     * ה-Speaker עוד מחזיק ref ל-audioStream (לצרכי prepareSegment + clear).
     */
    playlist: AudioPlaylist
    audioStream: AudioSink
    orderAlloc: OrderAllocator
  }) {
    this.#orderAlloc = opts.orderAlloc
    this.#session = opts.session
    this.#settings = opts.settings
    this.#cues = opts.cues
    // ui-polish-batch C8: אתחל enabled מ-settings.muted + סנכרן cues
    this.enabled = !opts.settings.muted
    if (opts.cues) opts.cues.enabled = !opts.settings.muted
    // A4: audioStream + playlist מוזרקים מ-+layout (לא נוצרים כאן)
    this.#audioStream = opts.audioStream
    this.#player = opts.playlist
    // A4: רשום callback onPlaybackStart (cue "speaking") —
    // dependency order ב-+layout מחייב שה-playlist נוצר לפני Speaker,
    // אז Speaker מרשם את ה-callback בעצמו אחרי init.
    this.#player.setOnPlaybackStart(() => {
      if (this.#spokeThisTurn) return
      this.#spokeThisTurn = true
      this.#cues?.play("speaking")
    })

    // ה-effect היחיד שמניע הכל: קורא bubbles + status + enabled.
    // כתיבות עטופות ב-`untrack` (gotcha §6 #5).
    this.#disposeEffect = $effect.root(() => {
      $effect(() => {
        // ── קריאות (נעקבות) ────────────────────────────────────────────
        const status = this.#session.status
        const turnState = this.#session.turnState
        const enabled = this.enabled
        // redesign-3 / slice 9a: העדפות הקראה (reactive — toggle מפעיל את ה-effect מחדש)
        const speakThoughts = this.#settings.speakThoughts
        const narrateTools = this.#settings.narrateTools
        // translateThoughts נקרא ב-#fetchJob (async, לא tracked כאן)
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
        const historyEpoch = this.#session.historyEpoch ?? 0
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
          this.#applyHistoryMark(historyEpoch)
          this.#processBubbles(bubbles, enabled, isLoadingHistory, speakThoughts, turnState)
          this.#processToolBubbles(bubbles, enabled, isLoadingHistory, narrateTools)
          this.#handleStatusTransition(status, turnState, enabled, speakThoughts)
          this.#prevStatus = status
          this.#prevTurnState = turnState
        })
      })
    })
    registerSpeaker(this)
  }

  /**
   * מחליף הפעלת קול. כיבוי מנקה את התור ועוצר הפעלה.
   * הפעלה מחדש **אינה** משחזרת היסטוריה — רק מקטעים חדשים שמגיעים מושמעים.
   *
   * ui-polish-batch C8: מסנכרן settings.muted + cues.enabled.
   */
  toggle(): void {
    this.enabled = !this.enabled
    // C8: שמור מצב muted ב-settings (round-trip persist)
    this.#settings.setMuted(!this.enabled)
    // C8: סנכרן CuesEngine
    if (this.#cues) this.#cues.enabled = this.enabled
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

  #applyHistoryMark(epoch: number): void {
    if (epoch === this.#seenHistoryEpoch) return
    this.#seenHistoryEpoch = epoch
    const mark = this.#session.historyMark
    if (!mark) return
    for (const [bubbleId, count] of mark.segmentCounts) {
      const state = this.#bubbleStates.get(bubbleId) ?? {
        processedSegments: 0,
        buffer: "",
        speakPending: "",
      }
      if (count <= state.processedSegments) continue
      state.processedSegments = count
      state.buffer = ""
      state.speakPending = ""
      this.#bubbleStates.set(bubbleId, state)
    }
    for (const id of mark.toolCallIds) this.#processedNarrationCallIds.add(id)
  }

  #processBubbles(
    bubbles: AgentSession["bubbles"],
    enabled: boolean,
    isLoadingHistory: boolean,
    speakThoughts: boolean,
    /** נדרש כדי לזהות "התור כבר נגמר" — ר' ה-flush בסוף הלולאה. */
    turnState: TurnState,
  ): void {
    // Slice 4: בזמן ש-loadSession() משחזר היסטוריה, מסמן בועות כמעובדות
    // ללא הכנסת TTS jobs לתור. ה-effect רץ מחדש ברגע שה-isLoadingHistory → false,
    // ובאותה נקודה מקטעים חיים חדשים חוזרים לזרום TTS רגיל.
    if (isLoadingHistory) {
      for (const bubble of bubbles) {
        if (bubble.kind !== "message" && bubble.kind !== "thought") continue
        let state = this.#bubbleStates.get(bubble.id)
        if (state === undefined) {
          state = { processedSegments: 0, buffer: "", speakPending: "" }
          this.#bubbleStates.set(bubble.id, state)
        }
        state.processedSegments = bubble.segments.length
        state.buffer = ""
        // ⚠️ **גם `speakPending`.** הוא חדש, וכל אתר שמנקה `buffer` בלבד
        // משאיר טקסט מעובד שיֵאמר בתור הבא. ההערות בענפים האלה כבר הצהירו
        // את הכוונה — הקוד פשוט הפסיק לקיים אותה.
        state.speakPending = ""
      }
      return
    }

    for (const bubble of bubbles) {
      if (bubble.kind !== "message" && bubble.kind !== "thought") continue

      // redesign-3 / slice 9a: הקראת מחשבות כבויה → סמן מעובד ודלג (בלי TTS job).
      // סימון processedSegments מבטיח שהדלקה מחדש לא תשגר תוכן ישן.
      const segArr = bubble.segments
      let state = this.#bubbleStates.get(bubble.id)
      if (state === undefined) {
        state = { processedSegments: 0, buffer: "", speakPending: "" }
        this.#bubbleStates.set(bubble.id, state)
      }
      if (bubble.kind === "thought" && !speakThoughts) {
        state.processedSegments = segArr.length
        state.buffer = ""
        state.speakPending = "" // ר' ההערה למעלה
        continue
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
        state.speakPending = ""
        continue
      }

      // ─── slice tts-speakable-text ───
      // ⚠️ **שני חוצצים, וזה העיקר.** `buffer` נשאר **גולמי לנצח**; טקסט
      // מעובד לעולם לא חוזר אליו. `speakPending` מחזיק טקסט שכבר עובר
      // ומחכה להשלים משפט.
      //
      // 🔴 גרסה קודמת החזירה טקסט מעובד לחוצץ ועיבדה אותו שוב — וכל סיבוב
      // שבר מבנה במקום אחר: ה-`trim` אכל את הרווח שלפני ה-chunk הבא
      // (מילים נדבקו), והשרשור איבד את השורה-החדשה שלפני הגדר הבאה (הקוד
      // דלף להקראה). כאן כל קטע-גולמי מעובד **בדיוק פעם אחת**.
      state.buffer += newChunks
      const { ready, held } = splitStreamable(state.buffer)
      state.buffer = held
      if (ready.length > 0) {
        state.speakPending += toSpeakable(ready, this.#speakableLabels(), { stream: true })
      }
      const { sentences, remaining } = splitIntoSentences(state.speakPending, {
        minChars: MIN_CHARS,
        maxChars: MAX_CHARS,
      })
      // ⚠️ **אין כאן עיכוב.** גרסה קודמת החזיקה מקטע קצר-מהרצפה לסיבוב הבא
      // (כדי ש-Gemini לא יקבל פרגמנט בודד) — וזה עיכב **בדיוק את הזנב**,
      // שהוא הקצר ביותר. התסמין: "שומעים את ההודעה, לא את סופה". מדוד.
      // ⇒ עדיף פרגמנט שאולי לא ייאמר מאשר זנב שנעלם.
      state.speakPending = remaining

      for (const sentence of sentences) {
        this.#enqueue(bubble.kind, bubble.messageId, sentence, bubble.id)
      }

      // ─── slice tts-tail-after-idle ───
      // ⚠️ **אחרי לולאת המשפטים, לא לפניה.** ‏`OrderAllocator` מקצה
      // `segmentIndex` עולה לפי סדר הקריאה — ולכן פליטת הזנב לפני הלולאה
      // נתנה לו מפתח **נמוך** מהמשפטים שקדמו לו, והפלייליסט השמיע אותו
      // **ראשון**. תיקון ה"סוף לא נשמע" הפך ל"סוף נשמע ראשון". נתפס
      // ב-code review, בדיוק במקרה שבשבילו נכתב.
      // 🔴 **התור כבר הסתיים? אין מי שיפלוש אחרינו — לפלוש כאן.**
      //
      // `justFinished` יורה **פעם אחת בלבד** (מעבר `!== idle` → `idle`).
      // ב-HTTP הפריים `state_update: idle` והצ'אנק האחרון יכולים להגיע
      // באותה מנה, וה-flush רץ ב-`$effect` נפרד מהזרימה. אם הוא מקדים,
      // הזנב שמגיע אחריו נתקע לנצח. זה #47.
      //
      // ⚠️ הסרתי את זה פעם אחת בחשד שגוי (חשבתי שהוא מרוקן חוצץ בין
      // הודעות) — והריוויו הראה שההסרה **החזירה** את הבאג. השורש היה
      // במקום אחר לגמרי (בדיקת ה-`[`). מוחזר.
      if (turnState === "idle") {
        const finalTail = (
          state.speakPending + toSpeakable(state.buffer, this.#speakableLabels(), { stream: true })
        ).trim()
        state.buffer = ""
        state.speakPending = ""
        if (finalTail.length > 0) {
          this.#enqueue(bubble.kind, bubble.messageId, finalTail, bubble.id)
        }
      }
    }
    this.#pumpFetchLoop()
  }

  #handleStatusTransition(
    status: AgentSessionStatus,
    turnState: TurnState,
    enabled: boolean,
    speakThoughts: boolean,
  ): void {
    // msr-v2: תור דיבור חדש מתחיל כש-turnState עובר מ-idle → אפס את ה-cue guard.
    // reset כאן (turn-start) ולא ב-#stopAndClear (לא רץ בסוף תור רגיל).
    if (turnState !== "idle" && this.#prevTurnState === "idle") {
      this.#spokeThisTurn = false
    }

    // התור הסתיים? פלוש כל buffer פר-בועה כמקטע אחרון.
    // msr-v2: טריגר = #prevTurnState !== "idle" && turnState === "idle"
    const justFinished = this.#prevTurnState !== "idle" && turnState === "idle"
    if (justFinished && enabled) {
      for (const [bubbleId, state] of this.#bubbleStates) {
        if (state.buffer.trim().length === 0 && state.speakPending.trim().length === 0) continue
        const bubble = this.#session.bubbles.find((b) => b.id === bubbleId)
        if (bubble === undefined) continue
        if (bubble.kind !== "message" && bubble.kind !== "thought") continue
        // redesign-3 / slice 9a: אל תפלוש buffer של thought כשהקראת מחשבות כבויה.
        if (bubble.kind === "thought" && !speakThoughts) {
          state.buffer = ""
          state.speakPending = ""
          continue
        }
        // ⚠️ גם כאן — הזנב יכול להיות בלוק שלא נסגר (הסוכן סיים באמצע גדר),
        // ובלי הצמצום הוא ייקרא מילה במילה. `toSpeakable` מטפל בגדר-פתוחה.
        // הזנב = מה שכבר עובר + מה שנשאר גולמי (למשל גדר שלא נסגרה).
        // ⚠️ `{ stream: true }` — בלעדיו ה-trim של `toSpeakable` אוכל את
        // הרווח **שבין** `speakPending` לשארית הגולמית: "…2" + " * 3" הפך
        // ל-"2* 3". זה בדיוק מה ש-`SpeakableOpts.stream` נועד למנוע, ושני
        // מוקדי ה-flush פספסו אותו. ה-trim היחיד הוא על התוצאה המחוברת.
        const tail = (
          state.speakPending + toSpeakable(state.buffer, this.#speakableLabels(), { stream: true })
        ).trim()
        state.buffer = ""
        state.speakPending = ""
        if (tail.length === 0) continue
        this.#enqueue(bubble.kind, bubble.messageId, tail, bubble.id)
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
    const bid = bubbleId ?? messageId ?? safeUUID()
    // slice 22: הקצה orderKey דטרמיניסטי — seq יציב פר-bubble, segmentIndex עולה
    const orderKey = this.#orderAlloc.next(bid)
    // A2 (אביגיל #2): extract segmentId לפני push כדי להעביר ל-reserve
    const segmentId = safeUUID()
    this.#jobs.push({
      segmentId,
      kind,
      messageId,
      text,
      status: "pending",
      abort: new AbortController(),
      bubbleId,
      orderKey,
    })
    // A2: reserve-on-enqueue — הסגמנט נכנס לפלייליסט מיד (לפני fetch)
    // A4: העבר bubbleId (bid) כדי ש-PlaylistItem יכיל אותו לניווט jumpToBubble
    // nav-retain: refetch thunk — מאפשר re-fetch בביקור מפורש אחרי skip
    this.#player.reserve(segmentId, orderKey, bid, this)
    this.#pendingCount += 1
    // תצפית בלבד — טבעת קצרה, מוגבלת באורך כדי לא להחזיק תמלילים שלמים.
    this.#recentTexts.push(text.slice(0, 60))
    if (this.#recentTexts.length > 8) this.#recentTexts.shift()
    if (bubbleId !== undefined) {
      this.#recentSources.push(bubbleId)
      if (this.#recentSources.length > 8) this.#recentSources.shift()
    }
  }

  /**
   * nav-retain: refetch thunk שמועבר ל-PlaylistItem.
   * נקרא ע"י AudioPlaylist כשמנווטים ל-item reserved (שדולג/נכשל).
   * מוצא את ה-TtsJob לפי segmentId, יוצר AbortController חדש (finding #5),
   * מאפס status=pending ומריץ את לולאת ה-fetch.
   */
  refetch(segmentId: string): void {
    this.refetchSegment(segmentId)
  }

  /**
   * הפריט נזנח — ה-fetch שלו כבר אינו רלוונטי.
   *
   * ⚠️ **מבטל את ה-fetch החי, לא רק מסמן.** גרסה קודמת רק שינתה `status`,
   * וה-fetch המשיך לרוץ ברקע: כשהוא נגמר הוא קרא `markReady`/`markError`
   * על פריט שכבר הוזמן-מחדש, והפך אותו ל-`error` לצמיתות.
   */
  invalidate(segmentId: string): void {
    const job = this.#jobs.find((j) => j.segmentId === segmentId)
    if (job === undefined) return
    if (job.status === "pending") {
      if (this.#pendingCount > 0) this.#pendingCount -= 1
    }
    // ⚠️ **`ready` נכלל.** ‏`invalidate` הוא ההודעה ש"הסגמנט אינו שמיש
    // עוד" — ה-sink פירק אותו. job שנשאר `ready` היה חוסם כל refetch
    // עתידי, והפלייליסט המתין את מלוא 20 השניות של `#reserveTimeoutMs`
    // ואז סימן `skipped`. משפט שלם נעלם אחרי המתנה ארוכה.
    if (job.status === "pending" || job.status === "fetching" || job.status === "ready") {
      job.status = "stale"
      try {
        job.abort.abort()
      } catch {
        // כבר בוטל
      }
    }
  }

  refetchSegment(segmentId: string): void {
    const job = this.#jobs.find((j) => j.segmentId === segmentId)
    if (job === undefined) return

    // ⚠️ **‏`ready` נחסם — וזו לא הצנזורה שגרמה לבאג.**
    //
    // ניסיון ראשון שלי התיר refetch ל-job מוכן, וזו הייתה רגרסיה: הפלייליסט
    // קורא `refetch` יותר מפעם אחת, וכל קריאה ייצרה fetch נוסף — `markReady`
    // נקרא **חמש פעמים** במקום אחת (נתפס ב-`speaker.test.svelte.ts`).
    //
    // המקום הנכון הוא `invalidate()`, שמוריד `ready` ל-`stale` כשה-sink
    // באמת איבד את הסגמנט. ‏job שנשאר `ready` **אינו** זקוק ל-fetch.
    if (job.status === "fetching" || job.status === "ready") return

    // ⚠️ **בלי אתחול-כפול של ה-abort.** הענף המת `if (status === "stale")`
    // הציב controller חדש ואז השורה שאחריו הציבה עוד אחד — ה-fetch הקודם
    // נשאר מחזיק את השני-לפני-אחרון ולא היה לו איך לדעת שבוטל. עכשיו
    // `invalidate()` מבטל בעצמו, וכאן רק פותחים דף חדש.
    job.abort = new AbortController()
    job.status = "pending"
    this.#pendingCount += 1
    this.#pumpFetchLoop()
  }

  /**
   * תוויות ההקראה מ-i18n — השפה נשארת בשכבת-ה-i18n, לא בליבה הטהורה.
   * ⚠️ אותו דפוס כמו `agent-session.svelte.ts` (‏`createI18n` לפי
   * `settings.locale`) — כדי לא להוסיף תלות-בנאי חדשה ל-Speaker, שהיא
   * שינוי invasive שנוגע בכל אתרי-הבנייה ובכל המוקים.
   */
  #speakableLabels(): SpeakableLabels {
    const t = createI18n({ locale: this.#settings.locale ?? detectLocale() }).t
    return {
      codeBlock: t("speakable.codeBlock"),
      // ⚠️ הרכבה ולא אינטרפולציה — `t()` מקבל מפתח בלבד (‏i18n/index.ts:32),
      // ושינוי החתימה שלו בשביל תווית אחת הוא שינוי invasive בקובץ משותף.
      codeBlockWithLang: (lang) => `${t("speakable.codeBlock")} ${lang}`,
      link: t("speakable.link"),
      image: t("speakable.image"),
    }
  }

  /**
   * ─── slice playback-observability ───
   * ⭐ `inFlight` הוא מה שחסר כדי לקרוא את התור נכון: פריט ב-`reserved`
   * יכול להיות "ממתין ל-TTS" או "נזנח" — והמספר הזה מבדיל ביניהם.
   */
  debugInfo(): SpeakerDebugInfo {
    return {
      inFlight: this.#activeFetches,
      queued: this.#jobs.filter((j) => j.status === "pending").length,
      lookahead: LOOKAHEAD,
      recent: [...this.#recentTexts].reverse(),
      bubbleStates: Object.fromEntries(
        [...this.#bubbleStates].map(([id, s]) => [id, s.processedSegments]),
      ),
      historyEpoch: this.#seenHistoryEpoch,
      recentSources: [...this.#recentSources].reverse(),
    }
  }

  #pumpFetchLoop(): void {
    while (this.#activeFetches < LOOKAHEAD) {
      const job = this.#jobs.find((j) => j.status === "pending")
      if (job === undefined) break
      job.status = "fetching"
      this.#activeFetches += 1
      void this.#fetchJob(job)
        .then((outcome) => {
          this.#applyFetchOutcome(job.segmentId, outcome)
        })
        .finally(() => {
          this.#activeFetches -= 1
          this.#pumpFetchLoop()
        })
    }
  }

  #applyFetchOutcome(segmentId: string, outcome: FetchOutcome): void {
    switch (outcome.kind) {
      case "ready":
        this.#player.markReady(segmentId)
        break
      case "error":
        this.#player.markError(segmentId)
        break
      case "abandoned":
        this.#player.markAbandoned(segmentId)
        break
    }
  }

  async #fetchJob(job: TtsJob): Promise<FetchOutcome> {
    try {
      let text = job.text

      if (job.kind === "thought") {
        // redesign-3 / slice 9a: תרגום מחשבות מותנה ב-toggle.
        // כבוי → הקרא טקסט מקורי (אנגלית). נקרא ברגע ה-fetch (לא tracked).
        if (this.#settings.translateThoughts) {
          // Slice 24: מעביר messageId כ-metadata לקאש (UNSTABLE, אופציונלי)
          const result = await translate(
            text,
            TARGET_LANG,
            select("translate", DEFAULT_VOICE_CONFIG),
            job.abort.signal,
            job.messageId,
          )
          if (result !== null && result.status === "translated") {
            // Slice 4: כתיבה חזרה למקטע כדי ש-ThoughtBubble יוכל להציג HE+EN.
            if (job.bubbleId !== undefined) {
              this.#persistThoughtTranslation(job.bubbleId, job.text, result.text)
            }
            text = result.text
          }
          // already_in_target או null → שמור טקסט מקורי (originalText נשאר undefined)
        }
      } else if (job.kind === "tool") {
        // slice 22: narration נוצר כאן (best-effort). null → דלג על ה-job.
        const narrationText = await this.#narrateForJob(job)
        if (narrationText === null) {
          job.status = "error"
          return { kind: "error", reason: "narration-null" }
        }
        text = narrationText
      }

      if (job.abort.signal.aborted) {
        job.status = "error"
        return { kind: "abandoned" }
      }

      // V4a-unify: בחר ספק דרך resolveTts (מקור-אמת יחיד); V4b: העברת geminiVoice
      const { provider, voiceId, modelId } = resolveTts(
        this.#settings.ttsProvider,
        this.#settings.voiceId,
        this.#settings.geminiVoice,
      )
      // Commit 4 capability-gate: אל תנסה synthesize לספק לא-זמין.
      // undefined caps → optimistic (true) → ממשיך (לא חוסם בהתחלה).
      if (!ttsCapabilities.isAvailable(this.#settings.ttsProvider)) {
        job.status = "error"
        console.warn("[Speaker] TTS provider unavailable, skipping segment", {
          provider: this.#settings.ttsProvider,
          id: job.segmentId,
        })
        return { kind: "error", reason: "provider-unavailable" }
      }
      // slice 22: חשב textHash על הטקסט שמסונתז (provenance)
      const textHash = await cacheKeyFor(text, voiceId, modelId)
      // Slice 24: מעביר messageId כ-metadata לקאש (UNSTABLE, אופציונלי)
      const stream = await provider.synthesize({
        text,
        voiceId,
        modelId,
        messageId: job.messageId,
        signal: job.abort.signal,
        directing: { pace: this.#settings.geminiPace, tone: this.#settings.geminiTone },
      })
      await this.#audioStream.prepareSegment(job.segmentId, stream, job.abort, {
        messageId: job.messageId,
        textHash,
        format: provider.format,
      })
      job.status = "ready"
      return { kind: "ready" }
    } catch (e) {
      if (job.abort.signal.aborted) {
        job.status = "error"
        return { kind: "abandoned" }
      }
      // MIN-5: דלג + המשך, אל תזרוק.
      job.status = "error"
      console.warn("TTS job failed, skipping segment", {
        id: job.segmentId,
        err: e instanceof Error ? e.message : String(e),
      })
      return { kind: "error", reason: "synthesize-failed" }
    } finally {
      // msr-v2: הפחת ספירה (job הסתיים — גם אם שגיאה)
      if (this.#pendingCount > 0) this.#pendingCount -= 1
    }
  }

  /**
   * Slice 4: עבור כל ToolBubble שהושלמה שחסרה narration, צור TTS job עם orderKey.
   * נקרא מ-untrack() — כתיבות אסינכרוניות חוזרות דרך proxy של $state (בסדר).
   * slice 22: הסיר #narratingCallIds (היה memory leak potential). Guard: #processedNarrationCallIds.
   */
  #processToolBubbles(
    bubbles: AgentSession["bubbles"],
    enabled: boolean,
    isLoadingHistory: boolean,
    narrateTools: boolean,
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
      // fix-mute-tool-narration: ה-mute הראשי חוסם גם קריינות כלים.
      // סמן processed ודלג כדי שהדלקה מחדש לא תשמיע narration ישן.
      if (!enabled) {
        this.#processedNarrationCallIds.add(tc.toolCallId)
        continue
      }
      // redesign-3 / slice 9a: קריינות כלים כבויה → סמן processed ודלג (בלי narrate/TTS).
      if (!narrateTools) {
        this.#processedNarrationCallIds.add(tc.toolCallId)
        continue
      }
      // slice 22: ה-#narratingCallIds Set הוסר. guard: #processedNarrationCallIds בלבד.
      this.#processedNarrationCallIds.add(tc.toolCallId)

      // slice 22: הקצה orderKey כרונולוגי לבועת ה-tool (כמו message/thought),
      // דרך אותו OrderAllocator — לכן ה-seq של ה-tool נכון יחסית למשפטים סביבו.
      const bid = bubble.id
      const orderKey = this.#orderAlloc.next(bid)
      // A2 (אביגיל #2): extract segmentId לפני push כדי להעביר ל-reserve
      const segmentId = safeUUID()

      this.#jobs.push({
        segmentId,
        kind: "tool",
        messageId: null,
        text: "", // יתמלא ב-#narrateForJob
        status: "pending",
        abort: new AbortController(),
        bubbleId: bid,
        toolCallId: tc.toolCallId,
        orderKey,
      })
      // A2: reserve-on-enqueue
      // A4: העבר bubbleId כדי ש-PlaylistItem יכיל אותו לניווט jumpToBubble
      // nav-retain: refetch thunk — re-fetch בביקור מפורש אחרי skip
      this.#player.reserve(segmentId, orderKey, bid, this)
      this.#pendingCount += 1
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
    const text = await narrate(ctx, tool, select("narrate", DEFAULT_VOICE_CONFIG), job.abort.signal)
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
      i === segIdx ? { ...seg, text: translatedHebrew, originalText: originalEnglish } : seg,
    )
    // החלף בועה שלמה (ריאקטיביות Svelte 5 — השמת index מפעילה עדכון).
    this.#session.bubbles[idx] = { ...bubble, segments: updatedSegments }
    this.#translatedSegByBubble.set(bubbleId, segIdx + 1)
  }

  #stopAndClear(): void {
    // slice 6: reset משני — לcancel/toggle-off (לא רץ בסוף תור רגיל)
    this.#spokeThisTurn = false
    for (const job of this.#jobs) {
      if (job.status === "fetching" || job.status === "pending" || job.status === "stale") {
        try {
          job.abort.abort()
        } catch {
          // כבר בוטל
        }
      }
    }
    this.#jobs = []
    this.#pendingCount = 0 // msr-v2: אפס ספירה (jobs בוטלו)
    this.#player.stop()
    this.#audioStream.clear()
    // slice 22: נקה את ה-allocator (seq גלובלי לא מתאפס — מונוטוני בין שיחות)
    // 🔴 **לא מנקים את ה-OrderAllocator.**
    //
    // דווח מהשדה: "הודעה ישנה נדחפה לסוף, אחרי שלוש ההודעות החדשות".
    //
    // המנגנון: `next(bubbleId)` מקצה `seq` **חדש** לכל bubbleId שאינו
    // במפה, וה-`seq` הגלובלי מונוטוני ולא מתאפס. ⇒ אחרי `clear()`, בועה
    // **ישנה** שמקבלת עוד מקטע (זנב, refetch, השמעה-חוזרת) מאבדת את ה-seq
    // המקורי שלה ומקבלת אחד **גבוה מכולם** — ולכן מתנגנת **אחרונה**.
    //
    // המפה היא **הזיכרון של סדר-הבועות**, לא מצב-ריצה. עצירה אינה משנה
    // איזו בועה קדמה לאיזו, ולכן אין סיבה לשכוח זאת. הזיכרון חסום
    // ממילא ע"י מספר הבועות בשיחה.
    //
    // (‏`clear()` נשאר ב-API להחלפת-סשן אמיתית ולבדיקות.)
    // סמן כל בועה קיימת כמעובדת לחלוטין כך שהפעלה מחדש לא תשחזר.
    for (const bubble of this.#session.bubbles) {
      if (bubble.kind !== "message" && bubble.kind !== "thought") continue
      const state = this.#bubbleStates.get(bubble.id) ?? {
        processedSegments: 0,
        buffer: "",
        speakPending: "",
      }
      state.processedSegments = bubble.segments.length
      state.buffer = ""
      // ⚠️ `#stopAndClear` — בלי זה, טקסט מעובד מתור **שבוטל או הושתק**
      // נאמר בתור הבא.
      state.speakPending = ""
      this.#bubbleStates.set(bubble.id, state)
    }
  }
}
