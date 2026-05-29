/**
 * bubble.exhaustive.ts — בדיקת מיצוי (exhaustiveness) בזמן קומפילציה לאיחוד ה-Bubble.
 *
 * מלווה ל-`BubbleRenderer.svelte` (הרכיב שמחלק את קריאות הבועות). אם slice עתידי
 * יוסיף סוג חדש ל-`Bubble` (למשל `SystemBubble`) אבל ישכח לעדכן את
 * `BubbleRenderer.svelte`, ה-switch בזמן ריצה יתעלם מהסוג החדש — רגרסיה שקטה.
 *
 * קובץ זה מכריח את TypeScript לסמן השמטה כזו בזמן typecheck:
 *
 *   1. `kindCheck` מונה כל סוג דרך `switch (b.kind)` ומקצה
 *      את `b` אחרי ה-switch ל-`never`. אם יתווסף סוג חדש ללא
 *      `case` תואם, `b` יהיה הסוג החסר (ולא `never`) ו-
 *      ההקצאה תיכשל.
 *
 *   2. `kindLiteral` הוא איחוד כל הליטרלים של `Bubble["kind"]` כפי
 *      שהוא קיים כעת; ה-`KnownKind` המקומי לידו מונה את
 *      הסוגים שאנחנו *מצפים* לטפל בהם. עוזר ה-`Equals` דורש ששניהם
 *      יהיו זהים, מה שמכריח את הקובץ הזה להתעדכן יחד עם האיחוד.
 *
 * מגבלה: זה מבטיח ש-`Bubble` הוא איחוד סגור ושכל
 * סוג נמנה *כאן*. זה לא מאמת ישירות ש-
 * `BubbleRenderer.svelte` מטפל בכל סוג — ה-`svelte-check` של Svelte
 * כבר עושה את זה עבור שרשרת ה-`{:else if bubble.kind === "X"}`. ה-
 * שילוב של שניהם אומר שכל סוג חדש חייב לגעת בשני הקבצים.
 *
 * לא מורץ בזמן אמת (runtime). שומר רק ברמת ה-type. לא מיובא לשום מקום.
 */

import type { Bubble } from "./bubble"

// ─── 1. בדיקת מיצוי של Switch על bubble.kind ──────────────────────────────────

function kindCheck(b: Bubble): string {
  switch (b.kind) {
    case "user":
      return "user"
    case "message":
      return "message"
    case "thought":
      return "thought"
    case "tool":
      return "tool"
    default: {
      // אם נוסף סוג (variant) חדש ל-`Bubble`, ה-`b` כאן יהיה הסוג הזה
      // (ולא `never`), וההקצאה הזו תיכשל ב-typecheck.
      const _exhaustive: never = b
      return _exhaustive
    }
  }
}
void kindCheck

// ─── 2. שוויון Literal-union מול הרשימה המפורשת של הסוגים ────────────────

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false

/** כל סוג שאנחנו יודעים כרגע איך לרנדר. הוספת סוג חדש ל-`Bubble`
 *  דורשת הוספה גם כאן — אחרת `_kindsMatch` הופך ל-`false`
 *  ואנוטציית ה-`: true` תדחה אותו. */
type KnownKind = "user" | "message" | "thought" | "tool"

// אם השורה הזו מחזירה שגיאת "Type 'false' is not assignable to type 'true'",
// כנראה שנוסף סוג bubble חדש ללא עדכון הקובץ הזה (וכנראה גם
// ללא עדכון BubbleRenderer.svelte).
const _kindsMatch: Equals<Bubble["kind"], KnownKind> = true
void _kindsMatch
