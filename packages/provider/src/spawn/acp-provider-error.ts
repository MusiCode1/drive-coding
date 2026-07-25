/**
 * פונקציית עזר טהורה — מחלצת הודעת שגיאת ספק מ-stderr של opencode acp.
 *
 * כאשר ספק ה-LLM (Anthropic/Google/וכו') מחזיר שגיאות 400/401/429,
 * opencode acp לפעמים מחזיר stopReason=end_turn עם הודעה ריקה,
 * ומבלע את השגיאה האמיתית. הסיבה האמיתית נרשמת ל-stderr בשני
 * פורמטים אפשריים:
 *
 *   1. JSON `"message":"..."` מ-AI_APICallError של ה-AI SDK (responseBody).
 *      מקבלים כל מחרוזת עם אחד מהמילות המפתח: credit, invalid,
 *      unauthor, forbid, rate, limit, key.
 *
 *   2. שורות ERROR של opencode עצמו: `ERROR ... error=<text> [stack=...]`.
 *      מחלצים עד ל-`stack=` הנגרר (או סוף שורה) ומגבילים ל-200 תווים.
 *
 * מחזיר `null` אם לא נמצא דפוס שגיאה מוכר.
 *
 * הפונקציה סורקת 30 השורות האחרונות (דפוס 1) או 50 שורות (דפוס 2).
 * משמשת לאחר שפרומפט חוזר עם 0 תווים ב-`message` —
 * התוצאה מוצגת למשתמש כסיבה האמיתית.
 */
export function extractProviderError(stderrLines: string[]): string | null {
  // דפוס 1: "message":"..." עם מילת מפתח רלוונטית, סריקת 30 השורות האחרונות.
  for (let i = stderrLines.length - 1; i >= 0 && i >= stderrLines.length - 30; i--) {
    const line = stderrLines[i]
    const m = line?.match(/"message":"([^"]{10,400})"/)
    if (m?.[1] && /credit|invalid|unauthor|forbid|rate|limit|key/i.test(m[1])) {
      return m[1]
    }
  }
  // דפוס 2: שורת ERROR של opencode, סריקת 50 השורות האחרונות.
  for (let i = stderrLines.length - 1; i >= 0 && i >= stderrLines.length - 50; i--) {
    const line = stderrLines[i]
    const m = line?.match(/ERROR.*?error=(.+?)(?:\s+stack=|$)/)
    if (m?.[1]) return m[1].slice(0, 200)
  }
  return null
}
