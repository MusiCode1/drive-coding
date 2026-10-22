/**
 * model-picker.spec.ts — בורר המודלים מציג את מה שהסוכן מפרסם.
 *
 * מה שהניע את הבדיקה: ב-19/10 נדרשה בדיקה **בעיניים** מצילום מסך כדי לוודאי
 * שהרשימה התעדכנה אחרי שדרוג גשר ה-ACP. זה מה שמוחלף כאן.
 *
 * 🛑 הבדיקה **אינה** קובעת "חייב להיות Haiku 5.5". התוויות באות מהגשר
 * (`SessionOptionsPanel.svelte:444` → `availableModels[].name`), והן משתנות עם
 * גרסת הגשר — אסרשן כזה היה נכשל על `edge` של היום ועובר רק אחרי מיזוג.
 * ⇒ מה שנבדק הוא ה**אינווריאנטה**: הבורר מאוכלס, התוויות הן שמות קריאים
 * ולא מזהי-מודל גולמיים, והנבחר הוא אחד מהם. לאסרשן על גרסה ספציפית יש
 * `E2E_EXPECT_MODEL`.
 *
 * עוגנים (מהמקור):
 *   SessionOptionsPanel.svelte:331  aria-label={t("header.settings")}        ← פתיחת הפאנל
 *   SessionOptionsPanel.svelte:444  ariaLabel={t("agentOptions.model.label")} ← הבורר
 */
import { connect, readSelectOptions, t } from "../fixtures/connect.ts"
import { expect, test } from "../fixtures/index.ts"

/** תווית שנראית כמו מזהה-מודל גולמי ולא כמו שם לאדם. */
const LOOKS_LIKE_RAW_ID = /^claude-[a-z]+-[\d-]|-20\d{6}$|^[a-z0-9]+(-[a-z0-9]+){2,}$/

test("בורר המודלים מאוכלס בשמות קריאים, בלי שגיאות קונסול", async ({
  page,
  app,
  consoleErrors,
}) => {
  await connect(page, app.baseURL, { cwd: process.cwd(), cli: /claude/i })

  await page.getByLabel(t("header.settings"), { exact: true }).click()

  const trigger = page.getByLabel(t("agentOptions.model.label"), { exact: true })
  await expect(
    trigger,
    "בורר המודלים נעדר — ל-claude הגשר מפרסם מודלים, ולכן היעדרו הוא רגרסיה",
  ).toBeVisible()

  const selected = (await trigger.innerText()).trim()
  const labels = await readSelectOptions(page, t("agentOptions.model.label"))

  console.log(`  ↳ נבחר: ${selected}`)
  console.log(`  ↳ ${labels.length} אפשרויות: ${labels.join(" · ")}`)

  expect(labels.length, "הרשימה אינה טריוויאלית").toBeGreaterThanOrEqual(2)

  for (const label of labels) {
    expect(label.trim().length, `תווית ריקה ברשימה: ${JSON.stringify(labels)}`).toBeGreaterThan(0)
    expect(
      label,
      `התווית נראית כמו מזהה גולמי ולא כמו שם — סימן שה-FE נפל ל-modelId: ${label}`,
    ).not.toMatch(LOOKS_LIKE_RAW_ID)
  }

  expect(labels, "הבחירה הנוכחית אינה ברשימה").toContain(selected)

  // ברירת-מחדל: לא קובעים גרסה. אחרי מיזוג שמשנה את הגשר — E2E_EXPECT_MODEL="Haiku 5.5"
  const expected = process.env.E2E_EXPECT_MODEL
  if (expected) {
    expect(labels, `E2E_EXPECT_MODEL=${expected} לא נמצא ברשימה`).toContain(expected)
  }

  expect(consoleErrors, `שגיאות קונסול:\n${consoleErrors.join("\n")}`).toEqual([])
})
