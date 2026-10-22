/**
 * connect.ts — טופס החיבור. העוגנים נגזרו מהמקור, לא מניחוש:
 *
 *   routes/+page.svelte:171  <form id="connect-form">
 *   routes/+page.svelte:202  <Select ariaLabel={t("connect.cli.label")}>   ← בורר CLI
 *   routes/+page.svelte:229  <CwdPathCombo placeholder={t("connect.cwd.placeholder")}>
 *   routes/+page.svelte:250  <button type="submit" form="connect-form">{t("connect.submit")}</button>
 *   routes/+page.svelte:240  <div class="error" role="alert">            ← באנר שגיאה
 *
 * 🛑 ה-`Select` הוא רכיב bits-ui ולא `<select>` נייטיב (`ui/Select.svelte:195`),
 * ולכן `selectOption` לא יעבוד: לוחצים על ה-trigger ואז על האפשרות.
 */
import { expect, type Page } from "@playwright/test"
import { createI18n } from "@drive-coding/core/i18n"
import type { Locale, MessageKey } from "@drive-coding/core/i18n"

export type T = (key: MessageKey) => string

/**
 * 🛑 ה-locale נקרא **מהדף**, לא מונח.
 *
 * ‏`settings-persistence.ts:128` קובע שבלי ערך שמור ה-locale הוא
 * `detectLocale()`, שנגזר מ-`navigator.language`. בכרום headless זה `en-US`
 * ⇒ ה-UI עולה באנגלית אף ש-`app.html` מצהיר `lang="he"` ואף שהעברנו `--lang=he`
 * (נמדד: שניהם לא שינו דבר). ⇒ בדיקה שמניחה עברית מחפשת "חבר" בדף שמציג
 * "Connect". קוראים את מה שיש, ומיישמים את אותו כלל שהמוצר מיישם.
 */
export async function i18nForPage(page: Page): Promise<{ t: T; locale: Locale }> {
  const lang = await page.evaluate(() => navigator.language ?? "")
  const locale: Locale = lang.toLowerCase().startsWith("he") ? "he" : "en"
  return { ...createI18n({ locale }), locale }
}

/**
 * פותח בורר bits-ui ומחזיר locator **מתוחם לתוכן שנפתח**.
 *
 * 🛑 התיחום אינו קוסמטי. בלעדיו `getByRole("button", {name: /claude/i})` התאים
 * ל-**118 אלמנטים** (נמדד), כי בדף החיבור יש רשימת "תיקיות אחרונות" שבה כל
 * פריט נקרא "Claude Code <פרויקט> · לפני X ימים /נתיב".
 *
 * הסדר: `aria-controls` של ה-trigger (ה-ARIA התקני ל-popover) → `role="dialog"`
 * (מסלול ה-Dialog במובייל, `ui/Select.svelte:209`) → ויתור מפורש.
 */
async function openSelect(page: Page, ariaLabel: string) {
  const trigger = page.getByLabel(ariaLabel, { exact: true }).first()
  await trigger.click()

  const controls = await trigger.getAttribute("aria-controls")
  // בורר-מאפיין ולא `#id` — id עם תווים מיוחדים שובר סלקטור CSS, ו-CSS.escape
  // אינו קיים ב-Node שבו נבנית המחרוזת.
  if (controls) return page.locator(`[id="${controls.replace(/"/g, '\\"')}"]`)

  const dialog = page.getByRole("dialog")
  if ((await dialog.count()) > 0) return dialog.first()

  throw new Error(
    `לא נמצא מיכל לבורר "${ariaLabel}" — אין aria-controls ואין role=dialog. ` +
      `בלי תיחום אסור לחפש אפשרויות, כי הדף מכיל מאות כפתורים דומים.`,
  )
}

/** בוחר ערך בבורר לפי ה-aria-label של ה-trigger וטקסט האפשרות. */
export async function pickFromSelect(page: Page, ariaLabel: string, optionText: string | RegExp) {
  const content = await openSelect(page, ariaLabel)
  await content.getByRole("button", { name: optionText }).first().click()
}

/** קורא את תוויות האפשרויות של בורר. */
export async function readSelectOptions(page: Page, ariaLabel: string): Promise<string[]> {
  const content = await openSelect(page, ariaLabel)
  const texts = await content.getByRole("button").allInnerTexts()
  return texts.map((s) => s.trim()).filter(Boolean)
}

export type ConnectOpts = {
  cwd: string
  /** תווית התצוגה של ה-CLI (למשל /claude/i). בלי זה — נשארים בברירת המחדל. */
  cli?: string | RegExp
}

/** מחבר סשן ומחזיר כשה-chat נטען. אינו שולח prompt ⇒ אפס טוקנים. */
export async function connect(page: Page, baseURL: string, opts: ConnectOpts): Promise<T> {
  await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" })
  const { t } = await i18nForPage(page)
  await expect(page.locator("#connect-form")).toBeVisible()

  if (opts.cli) await pickFromSelect(page, t("connect.cli.label"), opts.cli)

  await page.getByPlaceholder(t("connect.cwd.placeholder")).fill(opts.cwd)

  const submit = page.getByRole("button", { name: t("connect.submit") })
  await expect(submit, "כפתור השליחה מושבת עד שיש cwd").toBeEnabled()
  await submit.click()

  // ⚠️ לא `"**/chat"` — הגלוב הזה מתאים רק לנתיב שמסתיים ב-/chat, והכתובת
  // בפועל היא `/chat/<cli>/<sessionId>` (נמדד: /chat/opencode/ses_...).
  // זה מה שהפיל את `tests/smoke/disconnect.mjs:70` בלי שאיש הבחין.
  await page.waitForURL(/\/chat\//, { timeout: 120_000 })
  // ⚠️ "חיבור" נמדד לפי כפתור הניתוק שמופיע רק בסשן חי, ולא לפי class של status.
  await expect(page.getByLabel(t("session.closeSession"), { exact: true })).toBeVisible({
    timeout: 120_000,
  })
  return t
}
