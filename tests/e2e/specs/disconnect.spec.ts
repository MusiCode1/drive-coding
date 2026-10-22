/**
 * disconnect.spec.ts — רגרסיה ל-Bug D1: `WS closed (1005)` מדומה אחרי ניתוק.
 *
 * ההיסטוריה: לחיצה על ניתוק קוראת ל-`AgentSession.detach()`, שסוגר את ה-WS
 * ומנווט חזרה ל-`/`. הדפדפן סוגר את ה-WS אסינכרונית, ובלי שומר ה-`#detached`
 * (`agent-session.svelte.ts:58/73/88/117`) ה-`onClose` נוחת **אחרי** שה-state
 * נוקה, קובע `session.error = "WS closed (1005)"`, ודף החיבור מציג באנר שגיאה.
 *
 * מקור: `tests/smoke/disconnect.mjs`. מה שונה כאן:
 *   • העוגן אינו `button.disconnect` — **המחלקה הזאת אינה קיימת יותר**
 *     (`SessionOptionsPanel.svelte:291` נושא מחלקות Tailwind בלבד).
 *   • באנר השגיאה נבדק דרך `role="alert"` (`+page.svelte:240`) ולא `[class*="error"]`.
 */
import { connect } from "../fixtures/connect.ts"
import { expect, test } from "../fixtures/index.ts"

/** שהיה אחרי הניתוק — ה-WS close המדומה נוחת בתוך ~שנייה מה-detach. */
const SETTLE_MS = 3000

test("ניתוק חוזר ל-/ בלי באנר שגיאה ובלי שגיאות קונסול", async ({
  page,
  app,
  consoleErrors,
}) => {
  // ‏t נגזר מהשפה שהדף באמת עלה בה — ראו i18nForPage.
  const t = await connect(page, app.baseURL, { cwd: process.cwd() })

  // מרגע זה והלאה — כל שגיאה חדשה היא רגרסיה.
  const errorsBefore = consoleErrors.length

  await page.getByLabel(t("session.closeSession"), { exact: true }).click()

  await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 })
  await page.waitForTimeout(SETTLE_MS)

  expect(new URL(page.url()).pathname, "חזרה לדף החיבור").toBe("/")

  await expect(page.getByRole("alert"), "אין באנר שגיאה בדף החיבור").toHaveCount(0)

  const fresh = consoleErrors.slice(errorsBefore)
  expect(fresh, `שגיאות חדשות מאז הניתוק:\n${fresh.join("\n")}`).toEqual([])
})
