/**
 * Settings — העדפות המשתמש. נשמר (Persists) ל-localStorage.
 *
 * ─── עיצוב תוספתי בטוח למקביליות (docs/conventions/parallel-safe-code.md) ───
 *
 * הוספת שדה שמור חדש:
 *   1. הוסף אותו בסוף הטיפוס `Persisted` למטה.
 *   2. הוסף את ערך ברירת המחדל שלו ל-`DEFAULTS`.
 *   3. הוסף שדה `$state` + מתודת set (setter) בבלוק ה-`// ─── domain ───`
 *      המתאים של המחלקה. מתודת ה-set חייבת לקרוא ל-`save()`.
 *
 * שדות שלא נשמרים (למשל מטמונים שנטענים מ-API) נכנסים לבלוק ה-domain
 * הרלוונטי ללא מתודת set שכותבת ל-localStorage.
 */

import type { CliKind } from "@drive-coding/core"
import { DEFAULT_LOCALE, detectLocale, type Locale } from "@drive-coding/core/i18n"
import { listVoices, type Voice } from "../adapters/voice/voices"
import { setBeUrlBase } from "../util/be-url"
import { DEFAULT_GEMINI_VOICE } from "../adapters/voice/voices-gemini"

const STORAGE_KEY = "drive-coding-v2-settings"

const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL" // Sarah, ElevenLabs

type Persisted = {
  cliKind: CliKind
  lastCwd: string
  voiceId: string
  beUrl: string
  // ─── דיבור ─── (redesign-3 / 9a)
  speakThoughts: boolean
  narrateTools: boolean
  translateThoughts: boolean
  // ─── רכב ─── (redesign-3, חיווט מלא: slice 7)
  carMode: boolean
  // ─── שפה ─── (rtl-ltr-bidi)
  locale: Locale
  // ─── השתקה ─── (ui-polish-batch · C7)
  muted: boolean
  // ─── מסך ─── (slice-wake-lock)
  screenWakeLock: boolean
  // ─── תצוגת צ'אט ─── (display-toggle-consistency — פולריות חיובית: ON=מציג)
  showThoughts: boolean
  showTools: boolean
  // ─── Enter toggle ─── (slice-enter-toggle)
  enterToSend: boolean
  // ─── config אחרון פר-CLI ─── (slice-restore-last-config)
  // מפה: cliKind → { configId/category → value }
  lastConfig: Record<string, Record<string, string | boolean>>
  // ─── TTS provider ─── (V4a-gemini-tts-pcm-playback)
  ttsProvider: "elevenlabs" | "google"
  // ─── תיקיות אחרונות ─── (slice recent-projects-controls)
  recentCollapsed: boolean
  // ─── leave-running (runtime-gate fixes) ───
  suppressLeaveWarning: boolean
  // ─── קול Gemini ─── (V4b-gemini-voice-picker)
  geminiVoice: string
}

const DEFAULTS: Persisted = {
  cliKind: "opencode",
  // Slice 24: lastCwd נשלף מ-GET /api/options.homeDir ב-+page.svelte (async, אחרי init).
  // ריק עד אז — המשתמש ימלא ידנית אם ה-fetch נכשל.
  lastCwd: "",
  voiceId: DEFAULT_VOICE_ID,
  beUrl: "",
  // ─── דיבור ─── (redesign-3 / 9a)
  speakThoughts: true,
  narrateTools: true,
  translateThoughts: true,
  // ─── רכב ───
  carMode: false,
  // ─── שפה ─── (rtl-ltr-bidi) — DEFAULT_LOCALE="he"; detectLocale() רץ רק כש-localStorage ריק
  locale: DEFAULT_LOCALE,
  // ─── השתקה ─── (ui-polish-batch · C7)
  muted: false,
  // ─── מסך ─── (slice-wake-lock)
  screenWakeLock: false,
  // ─── תצוגת צ'אט ─── (display-toggle-consistency) — ברירות מחדל = התנהגות נוכחית (מחשבות פתוחות, כלים סגורים)
  showThoughts: true,
  showTools: false,
  // ─── Enter toggle ─── (slice-enter-toggle) — ברירת מחדל = התנהגות נוכחית (Enter שולח)
  enterToSend: true,
  // ─── config אחרון פר-CLI ─── (slice-restore-last-config)
  lastConfig: {},
  // ─── TTS provider ─── (V4a) — ברירת מחדל = ElevenLabs (Q1=לא flip)
  ttsProvider: "elevenlabs" as const,
  // ─── תיקיות אחרונות ─── (slice recent-projects-controls)
  recentCollapsed: false,
  // ─── leave-running (runtime-gate fixes) ───
  suppressLeaveWarning: false,
  // ─── קול Gemini ─── (V4b-gemini-voice-picker)
  geminiVoice: DEFAULT_GEMINI_VOICE,
}

function load(): Persisted {
  if (typeof localStorage === "undefined") return { ...DEFAULTS, locale: detectLocale() }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    // ללא ערך שמור: locale נגזר מהדפדפן (detectLocale), שאר ה-DEFAULTS.
    if (!raw) return { ...DEFAULTS, locale: detectLocale() }
    const parsed = JSON.parse(raw) as Partial<Persisted> & {
      collapseThoughts?: boolean
      expandTools?: boolean
    }
    // migration (display-toggle-consistency): מפתחות ישנים → פולריות חיובית.
    // נשמר רק אם המפתח החדש עדיין לא קיים (לא לדרוס בחירה חדשה).
    if (parsed.showThoughts === undefined && parsed.collapseThoughts !== undefined) {
      parsed.showThoughts = !parsed.collapseThoughts
    }
    if (parsed.showTools === undefined && parsed.expandTools !== undefined) {
      parsed.showTools = parsed.expandTools
    }
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS, locale: detectLocale() }
  }
}

function save(s: Persisted): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // מכסה (quota) / אחסון מושבת — דלג בשקט
  }
}

export class Settings {
  // ─── טופס חיבור ───
  cliKind = $state<CliKind>(DEFAULTS.cliKind)
  lastCwd = $state(DEFAULTS.lastCwd)

  // ─── קול ───
  voiceId = $state<string>(DEFAULTS.voiceId)
  /** נטען אסינכרונית מ-ElevenLabs דרך `loadVoices()`. ריק עד אז. */
  availableVoices = $state<Voice[]>([])
  voicesLoading = $state<boolean>(false)
  voicesError = $state<string | null>(null)
  /** מונה נסיונות כושלים רצופים — מזין את ה-backoff. מתאפס בהצלחה / force. */
  #voicesRetries = 0
  /** ה-timer של הנסיון החוזר המתוזמן (null = אין retry ממתין). */
  #voicesRetryTimer: ReturnType<typeof setTimeout> | null = null

  // ─── שרת ───
  beUrl = $state<string>(DEFAULTS.beUrl)

  // ─── דיבור ─── (redesign-3 / 9a)
  speakThoughts = $state<boolean>(DEFAULTS.speakThoughts)
  narrateTools = $state<boolean>(DEFAULTS.narrateTools)
  translateThoughts = $state<boolean>(DEFAULTS.translateThoughts)

  // ─── רכב ─── (redesign-3; חיווט מלא: slice 7)
  carMode = $state<boolean>(DEFAULTS.carMode)

  // ─── שפה ─── (rtl-ltr-bidi)
  locale = $state<Locale>(DEFAULTS.locale)

  // ─── השתקה ─── (ui-polish-batch · C7)
  muted = $state<boolean>(DEFAULTS.muted)

  // ─── מסך ─── (slice-wake-lock)
  screenWakeLock = $state<boolean>(DEFAULTS.screenWakeLock)

  // ─── תצוגת צ'אט ─── (display-toggle-consistency — פולריות חיובית: ON=מציג)
  showThoughts = $state<boolean>(DEFAULTS.showThoughts)
  showTools = $state<boolean>(DEFAULTS.showTools)

  // ─── Enter toggle ─── (slice-enter-toggle)
  enterToSend = $state<boolean>(DEFAULTS.enterToSend)

  // ─── config אחרון פר-CLI ─── (slice-restore-last-config)
  lastConfig = $state<Record<string, Record<string, string | boolean>>>(DEFAULTS.lastConfig)

  // ─── TTS provider ─── (V4a-gemini-tts-pcm-playback)
  ttsProvider = $state<"elevenlabs" | "google">(DEFAULTS.ttsProvider)

  // ─── תיקיות אחרונות ─── (slice recent-projects-controls)
  recentCollapsed = $state<boolean>(DEFAULTS.recentCollapsed)
  // ─── leave-running (runtime-gate fixes) ───
  suppressLeaveWarning = $state<boolean>(DEFAULTS.suppressLeaveWarning)

  // ─── קול Gemini ─── (V4b-gemini-voice-picker)
  geminiVoice = $state<string>(DEFAULTS.geminiVoice)

  constructor() {
    const loaded = load()
    this.cliKind = loaded.cliKind
    this.lastCwd = loaded.lastCwd
    this.voiceId = loaded.voiceId
    this.beUrl = loaded.beUrl
    setBeUrlBase(this.beUrl)
    // ─── דיבור ───
    this.speakThoughts = loaded.speakThoughts
    this.narrateTools = loaded.narrateTools
    this.translateThoughts = loaded.translateThoughts
    // ─── רכב ───
    this.carMode = loaded.carMode
    // ─── שפה ───
    this.locale = loaded.locale
    // ─── השתקה ───
    this.muted = loaded.muted
    // ─── מסך ───
    this.screenWakeLock = loaded.screenWakeLock
    // ─── תצוגת צ'אט ───
    this.showThoughts = loaded.showThoughts
    this.showTools = loaded.showTools
    // ─── Enter toggle ───
    this.enterToSend = loaded.enterToSend
    // ─── config אחרון פר-CLI ───
    this.lastConfig = loaded.lastConfig
    // ─── TTS provider ───
    this.ttsProvider = loaded.ttsProvider
    // ─── תיקיות אחרונות ───
    this.recentCollapsed = loaded.recentCollapsed
    // ─── leave-running ───
    this.suppressLeaveWarning = loaded.suppressLeaveWarning
    // ─── קול Gemini ───
    this.geminiVoice = loaded.geminiVoice
  }

  // ─── טופס חיבור ───

  setCliKind = (k: CliKind): void => {
    this.cliKind = k
    this.#persist()
  }

  setLastCwd = (cwd: string): void => {
    this.lastCwd = cwd
    this.#persist()
  }

  // ─── קול ───

  setVoiceId = (id: string): void => {
    this.voiceId = id
    this.#persist()
  }

  /**
   * מביא את קטלוג הקולות מ-ElevenLabs (דרך פרוקסי BE + רכיב OneCLI).
   *
   * retry עם exponential backoff: בכשל מתזמן נסיון חוזר (2s,4s,8s,16s,cap 30s)
   * עד #VOICES_MAX_RETRIES, ואז עוצר. הצלחה / `force=true` מאפסים backoff ו-timer.
   *
   * חשוב: ה-retry מתוזמן כאן (setTimeout), **לא** מ-$effect של הקורא — אחרת
   * הכתיבה ל-voicesError הייתה מפעילה את ה-$effect מחדש בקצב event-loop (DDoS).
   * הקורא (VoicePicker) מפעיל פעם אחת ב-mount עטוף ב-untrack. שגיאות → voicesError.
   */
  loadVoices = async (force = false): Promise<void> => {
    if (this.voicesLoading) return
    // טעינה מוצלחת קיימת — אל תטען שוב.
    if (this.availableVoices.length > 0 && this.voicesError === null) return

    if (force) {
      // רענון מפורש (כפתור / beUrl השתנה) — בטל retry ממתין ואפס backoff.
      this.#clearVoicesRetry()
      this.#voicesRetries = 0
    } else if (this.#voicesRetryTimer !== null) {
      // כבר יש retry מתוזמן — אל תכפיל קריאות.
      return
    }

    this.voicesLoading = true
    this.voicesError = null
    try {
      const voices = await listVoices()
      this.availableVoices = voices
      this.#voicesRetries = 0
    } catch (e) {
      this.voicesError = e instanceof Error ? e.message : String(e)
      this.#scheduleVoicesRetry()
    } finally {
      this.voicesLoading = false
    }
  }

  static #VOICES_MAX_RETRIES = 6
  static #VOICES_BASE_DELAY_MS = 2000
  static #VOICES_MAX_DELAY_MS = 30_000

  /** מתזמן נסיון חוזר עם exponential backoff, עד תקרת הנסיונות. */
  #scheduleVoicesRetry(): void {
    if (this.#voicesRetries >= Settings.#VOICES_MAX_RETRIES) return
    const delay = Math.min(
      Settings.#VOICES_BASE_DELAY_MS * 2 ** this.#voicesRetries,
      Settings.#VOICES_MAX_DELAY_MS,
    )
    this.#voicesRetries += 1
    this.#clearVoicesRetry()
    this.#voicesRetryTimer = setTimeout(() => {
      this.#voicesRetryTimer = null
      void this.loadVoices()
    }, delay)
  }

  #clearVoicesRetry(): void {
    if (this.#voicesRetryTimer !== null) {
      clearTimeout(this.#voicesRetryTimer)
      this.#voicesRetryTimer = null
    }
  }

  // ─── שרת ───

  /**
   * מאמת (Validates) ומגדיר את ה-URL הבסיסי של ה-BE. מחרוזת ריקה מבטלת את הדריסה
   * (חוזר ל-same-origin / פרוקסי של Vite). מחזיר ערך דמוי Result כך ש
   * טופס ההגדרות יוכל לרנדר שגיאות וולידציה מבלי לזרוק שגיאות (throwing).
   */
  setBeUrl = (value: string): { ok: true } | { ok: false; error: string } => {
    const trimmed = value.trim().replace(/\/$/, "")
    if (trimmed === "") {
      this.beUrl = ""
      setBeUrlBase(this.beUrl)
      this.#persist()
      return { ok: true }
    }
    try {
      const u = new URL(trimmed)
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return { ok: false, error: "scheme must be http or https" }
      }
      this.beUrl = trimmed
      setBeUrlBase(this.beUrl)
      this.#persist()
      return { ok: true }
    } catch {
      return { ok: false, error: "malformed URL" }
    }
  }

  // ─── דיבור ─── (redesign-3 / 9a)

  setSpeakThoughts = (v: boolean): void => {
    this.speakThoughts = v
    this.#persist()
  }

  setNarrateTools = (v: boolean): void => {
    this.narrateTools = v
    this.#persist()
  }

  setTranslateThoughts = (v: boolean): void => {
    this.translateThoughts = v
    this.#persist()
  }

  // ─── רכב ─── (redesign-3)

  setCarMode = (v: boolean): void => {
    this.carMode = v
    this.#persist()
  }

  // ─── שפה ─── (rtl-ltr-bidi)

  setLocale = (l: Locale): void => {
    this.locale = l
    this.#persist()
  }

  // ─── השתקה ─── (ui-polish-batch · C7)

  setMuted = (v: boolean): void => {
    this.muted = v
    this.#persist()
  }

  // ─── מסך ─── (slice-wake-lock)

  setScreenWakeLock = (v: boolean): void => {
    this.screenWakeLock = v
    this.#persist()
  }

  // ─── תצוגת צ'אט ─── (display-toggle-consistency — פולריות חיובית: ON=מציג)

  setShowThoughts = (v: boolean): void => {
    this.showThoughts = v
    this.#persist()
  }

  setShowTools = (v: boolean): void => {
    this.showTools = v
    this.#persist()
  }

  // ─── Enter toggle ─── (slice-enter-toggle)

  setEnterToSend = (v: boolean): void => {
    this.enterToSend = v
    this.#persist()
  }

  // ─── config אחרון פר-CLI ─── (slice-restore-last-config)

  /**
   * שומר את הערך האחרון שהמשתמשת בחרה עבור configId, per-cliKind.
   * ממזג עם ה-map הקיים (לא מחליף).
   */
  setLastConfig = (cliKind: string, configId: string, value: string | boolean): void => {
    this.lastConfig = {
      ...this.lastConfig,
      [cliKind]: {
        ...(this.lastConfig[cliKind] ?? {}),
        [configId]: value,
      },
    }
    this.#persist()
  }

  // ─── TTS provider ─── (V4a-gemini-tts-pcm-playback)

  setTtsProvider = (v: "elevenlabs" | "google"): void => {
    this.ttsProvider = v
    this.#persist()
  }

  // ─── תיקיות אחרונות ─── (slice recent-projects-controls)

  setRecentCollapsed = (v: boolean): void => {
    this.recentCollapsed = v
    this.#persist()
  }

  // ─── leave-running (runtime-gate fixes) ───

  setSuppressLeaveWarning = (v: boolean): void => {
    this.suppressLeaveWarning = v
    this.#persist()
  }

  // ─── קול Gemini ─── (V4b-gemini-voice-picker)

  setGeminiVoice = (v: string): void => {
    this.geminiVoice = v
    this.#persist()
  }

  // ─── פרטי ───

  #persist(): void {
    save({
      cliKind: this.cliKind,
      lastCwd: this.lastCwd,
      voiceId: this.voiceId,
      beUrl: this.beUrl,
      speakThoughts: this.speakThoughts,
      narrateTools: this.narrateTools,
      translateThoughts: this.translateThoughts,
      carMode: this.carMode,
      locale: this.locale,
      muted: this.muted,
      screenWakeLock: this.screenWakeLock,
      showThoughts: this.showThoughts,
      showTools: this.showTools,
      enterToSend: this.enterToSend,
      lastConfig: this.lastConfig,
      ttsProvider: this.ttsProvider,
      recentCollapsed: this.recentCollapsed,
      suppressLeaveWarning: this.suppressLeaveWarning,
      geminiVoice: this.geminiVoice,
    })
  }
}
