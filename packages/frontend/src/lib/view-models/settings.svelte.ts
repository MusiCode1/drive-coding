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
import { listVoices, type Voice } from "../adapters/voice/voices"
import { setBeUrlBase } from "../util/be-url"

const STORAGE_KEY = "drive-coding-v2-settings"

const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL" // Sarah, ElevenLabs

type Persisted = {
  cliKind: CliKind
  lastCwd: string
  voiceId: string
  beUrl: string
}

const DEFAULTS: Persisted = {
  cliKind: "opencode",
  // TODO: לבקש את ה-home dir מהשרת במקום לקבע אותו. ה-endpoint GET /api/options
  // כבר קיים (packages/backend/src/delivery/http-options.ts) ומשתמש ב-os.homedir()
  // פנימית — רק להוסיף לו שדה `homeDir` בתגובה ולמשוך אותו ב-FE כ-default ל-lastCwd
  // (כש-localStorage ריק). הקיבוע הזה ספציפי-למכונה; ה-endpoint יהפוך אותו לנייד.
  lastCwd: "/home/user",
  voiceId: DEFAULT_VOICE_ID,
  beUrl: "",
}

function load(): Persisted {
  if (typeof localStorage === "undefined") return { ...DEFAULTS }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Persisted>) }
  } catch {
    return { ...DEFAULTS }
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

  // ─── שרת ───
  beUrl = $state<string>(DEFAULTS.beUrl)

  constructor() {
    const loaded = load()
    this.cliKind = loaded.cliKind
    this.lastCwd = loaded.lastCwd
    this.voiceId = loaded.voiceId
    this.beUrl = loaded.beUrl
    setBeUrlBase(this.beUrl)
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
   * אידמפוטנטי (Idempotent): קריאות עוקבות עושות שימוש חוזר ב-`availableVoices` אם כבר נטען
   * ואינו בטעינה כרגע (in-flight). שגיאות נשמרות ב-`voicesError`.
   */
  loadVoices = async (): Promise<void> => {
    if (this.voicesLoading) return
    if (this.availableVoices.length > 0 && this.voicesError === null) return
    this.voicesLoading = true
    this.voicesError = null
    try {
      const voices = await listVoices()
      this.availableVoices = voices
    } catch (e) {
      this.voicesError = e instanceof Error ? e.message : String(e)
    } finally {
      this.voicesLoading = false
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

  // ─── פרטי ───

  #persist(): void {
    save({
      cliKind: this.cliKind,
      lastCwd: this.lastCwd,
      voiceId: this.voiceId,
      beUrl: this.beUrl,
    })
  }
}
