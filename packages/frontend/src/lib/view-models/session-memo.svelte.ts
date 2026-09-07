/**
 * session-memo.svelte.ts — פתק ממו לכל סשן: תזכורות או תקציר על נושא הסשן.
 * (slice session-memo-pad)
 *
 * למה זה entity ולא state של מסך (חוק זהב #2): הממו מתאר את **הסשן**, לא את
 * המסך שפתוח עליו. הוא שורד ניווט, רענון, וסגירת המסך; הוא נטען מחדש כשחוזרים
 * לאותו סשן. הפרסיסטנס בנוי על התבנית של `ComposerDraft` — localStorage,
 * debounce, best-effort — אבל עם מפתח לכל סשן במקום מפתח יחיד.
 *
 * ה-VM לא מחזיק גאומטריה (מיקום/גודל). הפתק ממוקם קבוע ב-CSS: המוצר הוא
 * voice-first ומשמש בנהיגה, ופתק נגרר היה מוסיף כוונון עדין בדיוק במצב שבו
 * אי אפשר לכוון. "צף" כאן = overlay קבוע מעל הצ'אט.
 */

const STORAGE_PREFIX = "dc:session-memo:"
const DEBOUNCE_MS = 300

type PersistedMemo = {
  text: string
  minimized: boolean
}

/** מפתח האחסון לסשן. `null` = אין סשן פעיל ⇒ אין מה לטעון ואין מה לשמור. */
export function memoStorageKey(sessionId: string | null): string | null {
  if (!sessionId) return null
  return `${STORAGE_PREFIX}${sessionId}`
}

/**
 * פענוח blob שמור. סובלני לכל קלט — מפתח חסר, JSON קטוע, צורה ישנה — ונופל
 * לברירות מחדל שדה-שדה במקום לזרוק. ממו שנעלם כי האחסון שלו התקלקל גרוע
 * בהרבה מממו שנפתח ריק.
 */
export function parseMemo(raw: string | null): PersistedMemo {
  if (!raw) return { text: "", minimized: true }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedMemo>
    return {
      text: typeof parsed.text === "string" ? parsed.text : "",
      // כל מה שאינו false מפורש = מצומצם. ברירת המחדל היא לא להפריע.
      minimized: parsed.minimized !== false,
    }
  } catch {
    return { text: "", minimized: true }
  }
}

function loadMemo(sessionId: string | null): PersistedMemo {
  const key = memoStorageKey(sessionId)
  if (!key || typeof localStorage === "undefined") return { text: "", minimized: true }
  try {
    return parseMemo(localStorage.getItem(key))
  } catch {
    return { text: "", minimized: true }
  }
}

function saveMemo(sessionId: string | null, memo: PersistedMemo): void {
  const key = memoStorageKey(sessionId)
  if (!key || typeof localStorage === "undefined") return
  try {
    // ממו ריק ומצומצם אינו מידע — לא משאירים רשומה שתצטבר לכל סשן שנפתח אי פעם.
    if (memo.text.length === 0 && memo.minimized) {
      localStorage.removeItem(key)
      return
    }
    localStorage.setItem(key, JSON.stringify(memo satisfies PersistedMemo))
  } catch {
    // best-effort (מכסה חרגה / מצב פרטי)
  }
}

/**
 * מה שה-VM צריך מהסשן — טיפוס מבני צר, בלי תלות ב-AgentSession עצמו.
 *
 * `status`/`agentId` הם ה-**טריגר** בלבד: `sessionId` הוא getter מעל שדה פרטי
 * רגיל (`#sessionId`) ולא $state, ולכן קריאה שלו אינה נרשמת כתלות reactive.
 * effect שקורא רק אותו לא היה רץ שוב לעולם, הממו היה נשאר בלי מפתח, ושום דבר
 * לא היה נשמר — כשל שקט שהטסטים לא תופסים (הם מזריקים sessionId ידנית) והתגלה
 * רק בבדיקת דפדפן. שני השדות האלה כן reactive ומתעדכנים בדיוק כשסשן נטען או
 * מוחלף.
 */
export type MemoSessionSource = {
  readonly status: unknown
  readonly agentId: string | null
  readonly sessionId: string | null
}

export class SessionMemoVM {
  text = $state("")
  /** ברירת המחדל מצומצם: הפתק לא חוסם את הצ'אט עד שביקשו אותו. */
  minimized = $state(true)

  /** הסשן שהתוכן הנוכחי שייך לו. plain field, לא $state — ראה persist למטה. */
  #loadedId: string | null = null

  /**
   * `source` אופציונלי: בלעדיו ה-VM מונע-סשן ידנית (`setSessionId`), וכך הטסטים
   * שולטים במפתח בלי להרים AgentSession שלם.
   */
  constructor(source?: MemoSessionSource) {
    // חוק זהב #4 — ה-effect יושב אצל מי שמחזיק את ה-state, לא ב-composition root.
    if (source) {
      $effect(() => {
        void source.status
        void source.agentId
        this.setSessionId(source.sessionId)
      })
    }

    $effect(() => {
      const snapshot: PersistedMemo = { text: this.text, minimized: this.minimized }
      const timer = setTimeout(() => {
        // #loadedId נקרא בזמן השמירה ולא בזמן התזמון, ולכן הוא תמיד הסשן
        // שהתוכן שייך לו. הוא בכוונה לא $state — אחרת מעבר-סשן היה מפעיל את
        // ה-effect מחדש ושומר את התוכן הישן תחת המפתח החדש.
        saveMemo(this.#loadedId, snapshot)
      }, DEBOUNCE_MS)
      return () => clearTimeout(timer)
    })
  }

  /**
   * מיתוג לסשן אחר: שומר מיָדית את התוכן הנוכחי תחת המפתח הישן, ואז טוען את
   * הממו של החדש. הכתיבה המיָדית היא הנקודה הקריטית — בלעדיה מעבר-סשן בתוך
   * חלון ה-debounce היה מאבד את מה שהוקלד הרגע.
   */
  setSessionId(sessionId: string | null): void {
    if (sessionId === this.#loadedId) return
    if (this.#loadedId !== null) {
      saveMemo(this.#loadedId, { text: this.text, minimized: this.minimized })
    }
    this.#loadedId = sessionId
    const loaded = loadMemo(sessionId)
    this.text = loaded.text
    this.minimized = loaded.minimized
  }

  setText(value: string): void {
    this.text = value
  }

  /**
   * צמצום והרחבה בלבד — **אין סגירה, במכוון.** הפתק מחזיק רשומות של סשן, ומחווה
   * אחת שמוחקת אותן היא כשל שאין ממנו חזרה. צמצום הוא הדרך היחידה להרחיק אותו.
   */
  setMinimized(value: boolean): void {
    if (this.minimized === value) return
    this.minimized = value
    // כתיבה מיָדית: הצמצום הוא לרוב הפעולה האחרונה לפני מעבר מסך או ניתוק.
    saveMemo(this.#loadedId, { text: this.text, minimized: value })
  }

  toggle(): void {
    this.setMinimized(!this.minimized)
  }

  /** האם יש תוכן — לסימון ויזואלי על הגלולה המצומצמת. */
  get hasContent(): boolean {
    return this.text.trim().length > 0
  }
}
