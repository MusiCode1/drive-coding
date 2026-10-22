/**
 * i18n-anchors.spec.ts — מאמת את מכניזם העיגון עצמו, בלי דפדפן.
 *
 * למה זו בדיקה ולא הערה: הבדיקות עוגנות על **מפתחות** i18n ולא על מחלקות CSS
 * ולא על `data-testid`, כי ה-`aria-label` ב-FE עוברים `t(...)` ולכן תלויי-שפה.
 * אם המפתח ישונה או יימחק — הקובץ הזה לא יעבור typecheck, וזו בדיוק ההגנה
 * שאין ל-`data-testid`. הבדיקה כאן מוודאת שהמפתחות שהבדיקות נשענות עליהם
 * אכן פותרים למחרוזת לא-ריקה, בשתי השפות.
 */
import { createI18n } from "@drive-coding/core/i18n"
import { expect, test } from "@playwright/test"

/** המפתחות שבדיקות הדפדפן נשענות עליהם. להוסיף כאן כשמוסיפים עוגן. */
const ANCHOR_KEYS = [
  // דף החיבור — fixtures/connect.ts
  "connect.cli.label",
  "connect.cwd.placeholder",
  "connect.submit",
  // סשן חי — disconnect.spec.ts
  "session.closeSession",
  "session.leaveRunning",
  // פאנל האפשרויות — model-picker.spec.ts
  "header.settings",
  "agentOptions.model.label",
] as const

test("מפתחות העיגון פותרים למחרוזת לא-ריקה בעברית ובאנגלית", () => {
  for (const locale of ["he", "en"] as const) {
    const { t } = createI18n({ locale })
    for (const key of ANCHOR_KEYS) {
      const value = t(key)
      expect(value, `${locale} / ${key}`).toBeTruthy()
      expect(value.trim().length, `${locale} / ${key} אינו ריק`).toBeGreaterThan(0)
    }
  }
})

test("העוגן של כפתור ה-disconnect הוא session.closeSession", () => {
  // SessionOptionsPanel.svelte:295 — aria-label={t("session.closeSession")} על
  // הכפתור שמחובר ל-onDisconnect. זו הזהות שהבדיקה disconnect.spec.ts מניחה.
  const { t } = createI18n({ locale: "he" })
  expect(t("session.closeSession")).toBe("כבה לגמרי את התהליך")
})
