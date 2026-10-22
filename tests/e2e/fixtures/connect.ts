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

export const { t } = createI18n({ locale: "he" })

/** בוחר ערך בבורר מסוג bits-ui לפי ה-aria-label של ה-trigger וטקסט האפשרות. */
export async function pickFromSelect(page: Page, ariaLabel: string, optionText: string | RegExp) {
  await page.getByLabel(ariaLabel, { exact: true }).click()
  await page.getByRole("button", { name: optionText }).click()
}

/** קורא את תוויות האפשרויות של בורר, ומשאיר אותו פתוח. */
export async function readSelectOptions(page: Page, ariaLabel: string): Promise<string[]> {
  await page.getByLabel(ariaLabel, { exact: true }).click()
  // האפשרויות הן כפתורים בתוך ה-Popover/Dialog (`ui/Select.svelte:165`).
  const items = page.getByRole("dialog").getByRole("button")
  const fallback = page.getByRole("button")
  const scope = (await items.count()) > 0 ? items : fallback
  return (await scope.allInnerTexts()).map((s) => s.trim()).filter(Boolean)
}

export type ConnectOpts = {
  cwd: string
  /** תווית התצוגה של ה-CLI (למשל /claude/i). בלי זה — נשארים בברירת המחדל. */
  cli?: string | RegExp
}

/** מחבר סשן ומחזיר כשה-chat נטען. אינו שולח prompt ⇒ אפס טוקנים. */
export async function connect(page: Page, baseURL: string, opts: ConnectOpts): Promise<void> {
  await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" })
  await expect(page.locator("#connect-form")).toBeVisible()

  if (opts.cli) await pickFromSelect(page, t("connect.cli.label"), opts.cli)

  await page.getByPlaceholder(t("connect.cwd.placeholder")).fill(opts.cwd)

  const submit = page.getByRole("button", { name: t("connect.submit") })
  await expect(submit, "כפתור השליחה מושבת עד שיש cwd").toBeEnabled()
  await submit.click()

  await page.waitForURL("**/chat", { timeout: 120_000 })
  // ⚠️ "חיבור" נמדד לפי כפתור הניתוק שמופיע רק בסשן חי, ולא לפי class של status.
  await expect(page.getByLabel(t("session.closeSession"), { exact: true })).toBeVisible({
    timeout: 120_000,
  })
}
