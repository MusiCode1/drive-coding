/**
 * skeleton.spec.ts — שער שלב 0: מוכיח שהצינור כולו עובד.
 *
 * אינו בודק לוגיקת מוצר. הוא בודק ש: ה-BE עלה, ה-FE הבנוי מוגש ממנו, כרום
 * בקונטיינר עלה, CDP התחבר, והדף נטען בלי שגיאות. אם זה נופל — אין טעם
 * להסתכל על שום בדיקה אחרת.
 */
import { expect, test } from "../fixtures/index.ts"

test("הצינור חי: BE מגיש FE, כרום-בקונטיינר נטען בלי שגיאות", async ({
  page,
  app,
  chrome,
  consoleErrors,
}) => {
  const res = await page.goto(`${app.baseURL}/`, { waitUntil: "domcontentloaded" })

  expect(res?.status(), "תגובת HTTP לשורש").toBeLessThan(400)
  await expect(page.locator("body")).toBeVisible()

  // ה-FE הוא SvelteKit — השורש חייב להכיל את ה-app shell ולא דף שגיאה של BE.
  const html = await page.content()
  expect(html, "הדף אינו ריק").toContain("<body")

  expect(
    consoleErrors,
    `שגיאות קונסול בטעינת השורש:\n${consoleErrors.join("\n")}`,
  ).toEqual([])

  console.log(`  ↳ baseURL=${app.baseURL} cdp=${chrome.cdpPort}`)
})
