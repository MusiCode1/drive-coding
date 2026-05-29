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
 * כיסוי (ממופה ל-docs/plans/testing-coverage.md סעיף §4 Commit 5 טסטים 1–7):
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

  test("retry on error: failed first call → second call refetches", async () => {
    installLocalStorage()
    vi.mocked(listVoices)
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(voicesFixture)
    const s = new Settings()

    await s.loadVoices()
    expect(s.voicesError).toBe("network down")
    expect(s.availableVoices).toEqual([])
    expect(vi.mocked(listVoices)).toHaveBeenCalledTimes(1)

    await s.loadVoices()
    expect(s.voicesError).toBeNull()
    expect(s.availableVoices).toEqual(voicesFixture)
    expect(vi.mocked(listVoices)).toHaveBeenCalledTimes(2)
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
