/**
 * rpc-methods.ts — אוצר-המילים של POST /api/agents/:id/rpc.
 *
 * ─── slice acp-method-names (צעד 1 ב-`pre-brief-plan-acp-alignment`) ───
 *
 * המשטח הזה הוא **הפרוטוקול הפרטי שלנו** — ה-FE שלנו מול ה-BE שלנו, ואף אחד
 * אחר לא מדבר אותו. ⇒ שינוי-השמות אינו קונה תאימות, והוא קונה בדיוק שניים:
 *
 *  1. **מחיר-המעבר.** אם/כשה-`AcpServer` של ה-SDK ייכנס מתחת למשטח, משטח
 *     שכבר תואם נכנס כמות שהוא; משטח שאינו תואם דורש שכבת-תרגום פר-מתודה.
 *  2. **אוצר-מילים אחד במקום שניים.** היום קוראים קוד עם `setMode` בצד ה-HTTP
 *     ו-`session/set_mode` בצד החוט-לספק — אותו דבר בדיוק, שני שמות.
 *
 * ⚠️ **מה שהקובץ הזה בכוונה אינו עושה:** הוא אינו מצהיר תאימות ל-ACP. אנחנו
 * לא מכריזים `protocolVersion` על המשטח הזה ולא מנהלים משא-ומתן-יכולות.
 * ההצהרה הזו שייכת לצעד 3 (החוט הופך ל-`session/update`) — ומרגע שחוצים
 * אותה, מבטיחים משהו למישהו אחר. השמות כאן הם החלטה **פנימית והפיכה**.
 */

/**
 * שמונה המתודות שיש להן שם קנוני ב-ACP, ושתיים שאין להן.
 *
 * ⚠️ **התחילית `_` היא הקונבנציה של ACP עצמו** להרחבה תלוית-מימוש — כך אומרת
 * הסכימה במפורש על ערכים לא-מוכרים: *"Values beginning with `_` are reserved
 * for implementation-specific extensions."* ⇒ `_drive/*` אינו "שם זמני" אלא
 * הצורה הנכונה לומר **"זה שלנו, ואינו מתיימר להיות קנוני"**.
 */
export const RPC_METHODS = {
  // ─── קנוניות (‏@agentclientprotocol/sdk, schema.json, שדה x-method) ───
  prompt: "session/prompt",
  cancel: "session/cancel",
  setMode: "session/set_mode",
  setConfigOption: "session/set_config_option",
  loadSession: "session/load",
  newSession: "session/new",
  listSessions: "session/list",
  deleteSession: "session/delete",

  // ─── שלנו — אין מקבילה קנונית ───
  /** מעטפת-הרחבה גנרית: נושאת שם-מתודה פנימי משלה. אין לה מקבילה ב-ACP. */
  extMethod: "_drive/ext",
  /**
   * ⚠️ **מורשת, לא הרחבה שנבחרה.** `session/set_model` היה מתודה קנונית
   * בשושלת `@zed-industries/agent-client-protocol` (≤0.4.5); בשושלת הנוכחית
   * (`@agentclientprotocol/sdk`) הוא **אינו קיים**, ובחירת-מודל היא קטגוריה
   * של config-option (`SessionConfigOptionCategory ∈ {mode, model, …}`).
   *
   * ⇒ היעד הוא **למחוק** אותו ולקפל ל-`session/set_config_option`, אבל זו
   * **הסרה סמנטית ולא שינוי-שם**: היא נוגעת בחוזה `SessionView`, בשני
   * המימושים, ב-`SessionHost`, וב-fallback שנקרא רק כשאין התאמה
   * ב-`configOptions`. ⇒ **מחוץ לתיחום של סלייס-השמות, במכוון.**
   * ה-`_drive/` כאן הוא בדיוק מה שמסמן אותו כמועמד-להסרה.
   */
  setSessionModel: "_drive/set_session_model",
} as const

export type RpcMethodKey = keyof typeof RPC_METHODS
export type RpcMethod = (typeof RPC_METHODS)[RpcMethodKey]

/**
 * השמות הישנים → החדשים, לחלון-המעבר.
 *
 * 🔴 **למה זה נחוץ ולא "היגיינה":** ה-FE הוא נכס-סטטי מצונן. טאב שנפתח לפני
 * הפריסה ממשיך לרוץ עם ה-bundle הישן ולשלוח `prompt`, וגם ה-PWA מגיש גרסה
 * מהמטמון. בלי הקבלה הזו, כל טאב פתוח נשבר ברגע ה-deploy — עם `400 Unknown
 * method`, שהוא **בדיוק כשל שקט מנקודת-מבט המשתמש**: הפרומפט פשוט לא קורה.
 */
export const LEGACY_RPC_METHODS: Readonly<Record<string, RpcMethod>> = Object.freeze(
  // ⚠️ **פרוטוטיפ-null, לא `{}`.** חיפוש `obj[name]` על אובייקט רגיל עולה
  // בשרשרת-הפרוטוטיפ, ולכן `LEGACY["toString"]` היה מחזיר את `Object.prototype
  // .toString` — **פונקציה**, שהייתה עוברת את בדיקת ה-`undefined` וממשיכה
  // הלאה כאילו היא שם-מתודה תקף. קלט חיצוני מגיע לכאן ישירות מגוף-הבקשה.
  // נתפס ב-TDD. אפשר היה לגדר ב-`Object.hasOwn` בנקודת-הקריאה — אבל אז
  // המלכודת נשארת פרוסה לכל צרכן עתידי; כאן היא פשוט אינה קיימת.
  Object.assign(Object.create(null) as Record<string, RpcMethod>, RPC_METHODS),
)

/**
 * מנרמל שם-מתודה נכנס לצורתו הקנונית. מחזיר `undefined` למה שאינו מוכר —
 * הקורא הוא זה שמחליט מה עושים עם זה (‏400), לא הפונקציה הזו.
 *
 * ⚠️ הסדר חשוב: קודם בודקים אם השם **כבר** קנוני, ורק אז את טבלת-המורשת.
 * הפוך היה עובד גם כן היום, אבל שובר ברגע ששם-מורשת יתנגש בשם קנוני.
 */
const CANONICAL = new Set<string>(Object.values(RPC_METHODS))

export function canonicalRpcMethod(method: string | undefined): RpcMethod | undefined {
  if (method === undefined) return undefined
  if (CANONICAL.has(method)) return method as RpcMethod
  return LEGACY_RPC_METHODS[method]
}
