/**
 * settings.test.svelte.ts — טסטים ליחידה (unit tests) עבור ה-Settings view-model.
 *
 * למה סיומת `.svelte.ts` על קובץ טסט:
 *   ה-preprocessor של Vite-plugin-svelte רץ רק על קבצי `*.svelte`, `*.svelte.ts`,
 *   `*.svelte.js`. אנחנו לא באמת צריכים runes בטסט עצמו, אבל
 *   מיקום משותף של הסיומת עם ה-SUT (הקובץ settings.svelte.ts הנבדק) מונע
 *   הפתעות אם טסט עתידי אי פעם ישתמש ישירות ב-`$state`. זה גם הופך את
 *   ה-glob של הכללה (include glob) בקובץ vitest.config.ts לפשוט יותר.
 *
 * כיסוי:
 *   1. ברירת המחדל voiceId = שרה (Sarah) כש-localStorage ריק.
 *   2. המתודה setVoiceId כותבת ל-localStorage.
 *   3. פעולת New Settings() קוראת את ה-voiceId השמור.
 *   4. פעולת loadVoices מאכלסת את availableVoices + מניעה מצב loading/error.
 *   5. אידמפוטנטיות (Idempotency): שתי קריאות loadVoices רצופות → קריאה אחת לאדפטר.
 *   6. ניסיון חוזר בשגיאה: קריאה נכשלה → קריאה שנייה מבקשת מחדש (refetches).
 *   7. מקביליות: שתי קריאות loadVoices שלא המתינו להן → קריאה אחת לאדפטר (שומר loading guard).
 */

import { beforeEach, describe, expect, test, vi } from "vitest"

// צור Mock לאדפטר של ה-voices לפני ייבוא Settings. הקריאה `vi.mock` מקודמת מעלה (hoisted).
vi.mock("../adapters/voice/voices", () => ({
  listVoices: vi.fn(),
}))

import { Settings } from "./settings.svelte"
import { listVoices } from "../adapters/voice/voices"

const SARAH_ID = "EXAVITQu4vr4xnSDxMaL"
const STORAGE_KEY = "drive-coding-v2-settings"

const voicesFixture = [
  { voice_id: "v1", name: "Test Voice 1" },
  { voice_id: "v2", name: "Test Voice 2" },
]

function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  })
  return store
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(listVoices).mockReset()
})

describe("Settings — persisted voice", () => {
  test("default voiceId = Sarah when localStorage empty", () => {
    installLocalStorage()
    const s = new Settings()
    expect(s.voiceId).toBe(SARAH_ID)
  })

  test("setVoiceId writes to localStorage", () => {
    const store = installLocalStorage()
    const s = new Settings()
    s.setVoiceId("v2")
    expect(s.voiceId).toBe("v2")
    const raw = store.get(STORAGE_KEY)
    expect(raw).toBeDefined()
    const parsed = JSON.parse(raw as string)
    expect(parsed.voiceId).toBe("v2")
  })

  test("new Settings() reads the persisted voiceId from localStorage", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ cliKind: "opencode", lastCwd: "", voiceId: "v2" }))
    const s = new Settings()
    expect(s.voiceId).toBe("v2")
  })
})

describe("Settings — speech toggles (redesign-3 / 9a)", () => {
  test("default values: all 3 speech flags true, carMode false", () => {
    installLocalStorage()
    const s = new Settings()
    expect(s.speakThoughts).toBe(true)
    expect(s.narrateTools).toBe(true)
    expect(s.translateThoughts).toBe(true)
    expect(s.carMode).toBe(false)
  })

  test("setSpeakThoughts(false) writes to localStorage", () => {
    const store = installLocalStorage()
    const s = new Settings()
    s.setSpeakThoughts(false)
    expect(s.speakThoughts).toBe(false)
    const parsed = JSON.parse(store.get(STORAGE_KEY) as string)
    expect(parsed.speakThoughts).toBe(false)
  })

  test("setNarrateTools(false) writes to localStorage", () => {
    const store = installLocalStorage()
    const s = new Settings()
    s.setNarrateTools(false)
    expect(s.narrateTools).toBe(false)
    const parsed = JSON.parse(store.get(STORAGE_KEY) as string)
    expect(parsed.narrateTools).toBe(false)
  })

  test("setTranslateThoughts(false) writes to localStorage", () => {
    const store = installLocalStorage()
    const s = new Settings()
    s.setTranslateThoughts(false)
    expect(s.translateThoughts).toBe(false)
    const parsed = JSON.parse(store.get(STORAGE_KEY) as string)
    expect(parsed.translateThoughts).toBe(false)
  })

  test("new Settings() reads persisted speech flags", () => {
    const store = installLocalStorage()
    store.set(
      STORAGE_KEY,
      JSON.stringify({ speakThoughts: false, narrateTools: false, translateThoughts: false }),
    )
    const s = new Settings()
    expect(s.speakThoughts).toBe(false)
    expect(s.narrateTools).toBe(false)
    expect(s.translateThoughts).toBe(false)
  })

  test("backward-compat: localStorage without speech flags → defaults to true", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ cliKind: "opencode", voiceId: "v1", beUrl: "" }))
    const s = new Settings()
    expect(s.speakThoughts).toBe(true)
    expect(s.narrateTools).toBe(true)
    expect(s.translateThoughts).toBe(true)
  })
})

describe("Settings — muted (ui-polish-batch · C7)", () => {
  test("default muted = false when localStorage empty", () => {
    installLocalStorage()
    const s = new Settings()
    expect(s.muted).toBe(false)
  })

  test("setMuted(true) writes to localStorage", () => {
    const store = installLocalStorage()
    const s = new Settings()
    s.setMuted(true)
    expect(s.muted).toBe(true)
    const parsed = JSON.parse(store.get(STORAGE_KEY) as string)
    expect(parsed.muted).toBe(true)
  })

  test("setMuted(false) writes false to localStorage", () => {
    const store = installLocalStorage()
    const s = new Settings()
    s.setMuted(true)
    s.setMuted(false)
    expect(s.muted).toBe(false)
    const parsed = JSON.parse(store.get(STORAGE_KEY) as string)
    expect(parsed.muted).toBe(false)
  })

  test("new Settings() reads persisted muted=true from localStorage", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ muted: true }))
    const s = new Settings()
    expect(s.muted).toBe(true)
  })

  test("backward-compat: localStorage without muted → defaults to false", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ cliKind: "opencode", voiceId: "v1" }))
    const s = new Settings()
    expect(s.muted).toBe(false)
  })
})

describe("Settings — screenWakeLock (slice-wake-lock)", () => {
  test("default screenWakeLock = false when localStorage empty", () => {
    installLocalStorage()
    const s = new Settings()
    expect(s.screenWakeLock).toBe(false)
  })

  test("setScreenWakeLock(true) writes to localStorage", () => {
    const store = installLocalStorage()
    const s = new Settings()
    s.setScreenWakeLock(true)
    expect(s.screenWakeLock).toBe(true)
    const parsed = JSON.parse(store.get(STORAGE_KEY) as string)
    expect(parsed.screenWakeLock).toBe(true)
  })

  test("setScreenWakeLock(false) writes false to localStorage", () => {
    const store = installLocalStorage()
    const s = new Settings()
    s.setScreenWakeLock(true)
    s.setScreenWakeLock(false)
    expect(s.screenWakeLock).toBe(false)
    const parsed = JSON.parse(store.get(STORAGE_KEY) as string)
    expect(parsed.screenWakeLock).toBe(false)
  })

  test("new Settings() reads persisted screenWakeLock=true from localStorage", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ screenWakeLock: true }))
    const s = new Settings()
    expect(s.screenWakeLock).toBe(true)
  })

  test("backward-compat: localStorage without screenWakeLock → defaults to false", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ cliKind: "opencode", voiceId: "v1" }))
    const s = new Settings()
    expect(s.screenWakeLock).toBe(false)
  })
})

describe("Settings — enterToSend (slice-enter-toggle)", () => {
  test("default enterToSend = true when localStorage empty", () => {
    installLocalStorage()
    const s = new Settings()
    expect(s.enterToSend).toBe(true)
  })

  test("setEnterToSend(false) writes false to localStorage", () => {
    const store = installLocalStorage()
    const s = new Settings()
    s.setEnterToSend(false)
    expect(s.enterToSend).toBe(false)
    const parsed = JSON.parse(store.get(STORAGE_KEY) as string)
    expect(parsed.enterToSend).toBe(false)
  })

  test("new Settings() reads persisted enterToSend=false from localStorage (round-trip)", () => {
    const store = installLocalStorage()
    const s1 = new Settings()
    s1.setEnterToSend(false)
    // instance חדש — טוען מה-localStorage
    const s2 = new Settings()
    expect(s2.enterToSend).toBe(false)
    const parsed = JSON.parse(store.get(STORAGE_KEY) as string)
    expect(parsed.enterToSend).toBe(false)
  })

  test("backward-compat: localStorage without enterToSend → defaults to true", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ cliKind: "opencode", voiceId: "v1" }))
    const s = new Settings()
    expect(s.enterToSend).toBe(true)
  })
})

describe("Settings — showThoughts / showTools (display-toggle-consistency)", () => {
  test("default showThoughts = true when localStorage empty", () => {
    installLocalStorage()
    const s = new Settings()
    expect(s.showThoughts).toBe(true)
  })

  test("default showTools = false when localStorage empty", () => {
    installLocalStorage()
    const s = new Settings()
    expect(s.showTools).toBe(false)
  })

  test("setShowThoughts(false) round-trip via localStorage", () => {
    const store = installLocalStorage()
    const s = new Settings()
    s.setShowThoughts(false)
    expect(s.showThoughts).toBe(false)
    const s2 = new Settings()
    expect(s2.showThoughts).toBe(false)
    const parsed = JSON.parse(store.get(STORAGE_KEY) as string)
    expect(parsed.showThoughts).toBe(false)
  })

  test("setShowTools(true) round-trip via localStorage", () => {
    const store = installLocalStorage()
    const s = new Settings()
    s.setShowTools(true)
    expect(s.showTools).toBe(true)
    const s2 = new Settings()
    expect(s2.showTools).toBe(true)
    const parsed = JSON.parse(store.get(STORAGE_KEY) as string)
    expect(parsed.showTools).toBe(true)
  })

  test("migration: collapseThoughts:true → showThoughts:false", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ collapseThoughts: true }))
    const s = new Settings()
    expect(s.showThoughts).toBe(false)
  })

  test("migration: collapseThoughts:false → showThoughts:true", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ collapseThoughts: false }))
    const s = new Settings()
    expect(s.showThoughts).toBe(true)
  })

  test("migration: expandTools:true → showTools:true", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ expandTools: true }))
    const s = new Settings()
    expect(s.showTools).toBe(true)
  })

  test("migration: expandTools:false → showTools:false", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ expandTools: false }))
    const s = new Settings()
    expect(s.showTools).toBe(false)
  })

  test("migration: new key wins over old key when both present", () => {
    const store = installLocalStorage()
    // showThoughts מוגדר — לא אמור להידרס ע"י collapseThoughts
    store.set(STORAGE_KEY, JSON.stringify({ showThoughts: true, collapseThoughts: true }))
    const s = new Settings()
    expect(s.showThoughts).toBe(true)
  })
})

describe("Settings — loadVoices", () => {
  test("populates availableVoices and drives loading/error", async () => {
    installLocalStorage()
    vi.mocked(listVoices).mockResolvedValueOnce(voicesFixture)
    const s = new Settings()

    expect(s.availableVoices).toEqual([])
    expect(s.voicesLoading).toBe(false)
    expect(s.voicesError).toBeNull()

    const inflight = s.loadVoices()
    // סינכרונית אחרי הקריאה: דגל ה-loading מוגדר לפני ה-await.
    expect(s.voicesLoading).toBe(true)

    await inflight

    expect(s.voicesLoading).toBe(false)
    expect(s.voicesError).toBeNull()
    expect(s.availableVoices).toEqual(voicesFixture)
  })

  test("idempotent: 2 sequential calls → adapter invoked once", async () => {
    installLocalStorage()
    vi.mocked(listVoices).mockResolvedValue(voicesFixture)
    const s = new Settings()

    await s.loadVoices()
    await s.loadVoices()

    expect(vi.mocked(listVoices)).toHaveBeenCalledTimes(1)
    expect(s.availableVoices).toEqual(voicesFixture)
  })

  test("after error: extra plain call while retry pending does NOT fire immediately", async () => {
    installLocalStorage()
    vi.useFakeTimers()
    try {
      vi.mocked(listVoices).mockRejectedValue(new Error("network down"))
      const s = new Settings()

      await s.loadVoices()
      expect(s.voicesError).toBe("network down")
      expect(vi.mocked(listVoices)).toHaveBeenCalledTimes(1)

      // קריאה רגילה נוספת בזמן ש-retry כבר מתוזמן → לא יורה מיד (מונע DDoS).
      await s.loadVoices()
      expect(vi.mocked(listVoices)).toHaveBeenCalledTimes(1)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  test("error → exponential backoff retry, then success resets", async () => {
    installLocalStorage()
    vi.useFakeTimers()
    try {
      vi.mocked(listVoices)
        .mockRejectedValueOnce(new Error("down"))
        .mockResolvedValueOnce(voicesFixture)
      const s = new Settings()

      await s.loadVoices() // נסיון 1 נכשל → מתזמן retry ב-2s
      expect(vi.mocked(listVoices)).toHaveBeenCalledTimes(1)
      expect(s.voicesError).toBe("down")

      // לפני 2s — אין נסיון חוזר
      await vi.advanceTimersByTimeAsync(1999)
      expect(vi.mocked(listVoices)).toHaveBeenCalledTimes(1)

      // אחרי 2s — הנסיון החוזר יורה ומצליח
      await vi.advanceTimersByTimeAsync(1)
      expect(vi.mocked(listVoices)).toHaveBeenCalledTimes(2)
      expect(s.voicesError).toBeNull()
      expect(s.availableVoices).toEqual(voicesFixture)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  test("backoff caps after max retries (no infinite retry)", async () => {
    installLocalStorage()
    vi.useFakeTimers()
    try {
      vi.mocked(listVoices).mockRejectedValue(new Error("down"))
      const s = new Settings()

      await s.loadVoices() // נסיון 1
      // הרץ הרבה זמן — כל ה-retries (6) ייצרו לכל היותר 7 קריאות, ואז עוצר.
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      const calls = vi.mocked(listVoices).mock.calls.length
      expect(calls).toBeLessThanOrEqual(7)
      expect(calls).toBeGreaterThan(1)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  test("force=true: explicit refresh refetches immediately, resets backoff", async () => {
    installLocalStorage()
    vi.useFakeTimers()
    try {
      vi.mocked(listVoices)
        .mockRejectedValueOnce(new Error("down"))
        .mockResolvedValueOnce(voicesFixture)
      const s = new Settings()

      await s.loadVoices()
      expect(vi.mocked(listVoices)).toHaveBeenCalledTimes(1)

      // רענון מפורש — מנסה מיד (לא מחכה ל-backoff).
      await s.loadVoices(true)
      expect(vi.mocked(listVoices)).toHaveBeenCalledTimes(2)
      expect(s.voicesError).toBeNull()
      expect(s.availableVoices).toEqual(voicesFixture)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  test("concurrent: 2 unawaited calls → adapter invoked once (loading guard)", async () => {
    installLocalStorage()
    // השאר את הקריאה הראשונה פתוחה כדי שהשנייה תוכל להיתקל ב-loading guard.
    let resolveFirst!: (v: typeof voicesFixture) => void
    vi.mocked(listVoices).mockImplementationOnce(
      () => new Promise<typeof voicesFixture>((r) => (resolveFirst = r)),
    )
    const s = new Settings()

    const p1 = s.loadVoices()
    const p2 = s.loadVoices() // אמור לעצור (bail) כי `voicesLoading === true`
    expect(vi.mocked(listVoices)).toHaveBeenCalledTimes(1)

    resolveFirst(voicesFixture)
    await Promise.all([p1, p2])

    expect(vi.mocked(listVoices)).toHaveBeenCalledTimes(1)
    expect(s.availableVoices).toEqual(voicesFixture)
  })
})
