/**
 * resolve-cli-kind.ts — נפילה ל-cliKind תקף כש-הערך השמור מיושן.
 *
 * slice: open-cli-registry-fe (Commit 4)
 *
 * הבעיה: cliKind שנשמר ב-localStorage (דרך settings.svelte.ts) עשוי להצביע על CLI
 * שהוסר מהקונפיגורציה (cli-specs.jsonc). Select.svelte מרנדר טריגר ריק לגמרי
 * (רק chevron, ר' `selectedLabel = $derived`) על ערך שלא קיים ב-options — המשתמש
 * לוחץ "חבר" ומקבל 400.
 *
 * הפונקציה טהורה ולא נוגעת ב-localStorage בעצמה — הקורא (+page.svelte) מפעיל אותה
 * אחרי ש-cliAvailability.load() מסתיים, ומעדכן רק את ה-state המקומי. אם המשתמש
 * יתחבר, connectAgent ישמור את הערך התקף החדש (setCliKind) — כך שאין מחיקה יזומה
 * של הערך הישן; הוא פשוט נדרס בפעם הבאה שהמשתמש מתחבר בהצלחה.
 */
export function resolveCliKind(
  current: string,
  registry: readonly string[],
  available: readonly string[],
): string {
  // 1. הערך השמור עדיין ברג'יסטרי — השאר.
  if (registry.includes(current)) return current
  // 2. אחרת — הראשון ברג'יסטרי שגם מותקן בפועל.
  const firstAvailable = registry.find((k) => available.includes(k))
  if (firstAvailable !== undefined) return firstAvailable
  // 3. אחרת — הראשון ברג'יסטרי (גם אם לא מותקן).
  // 4. registry ריק — נופל ל-DEFAULT הקיים (settings.svelte.ts DEFAULTS.cliKind).
  return registry[0] ?? "opencode"
}
