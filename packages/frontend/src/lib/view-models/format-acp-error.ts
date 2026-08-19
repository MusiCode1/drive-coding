/**
 * format-acp-error.ts — מחלץ את ההודעה המשמעותית ביותר משגיאת ACP client (JSON-RPC).
 * (Commit 0, slice surface-real-error)
 *
 * JSON-RPC envelope טיפוסי: { code:-32603, message:"Internal error",
 *   data:{ details:"Cannot find module…" } } — ה-message הגנרי מסתיר את הסיבה
 * האמיתית ב-data.details. סדר עדיפויות: data.details → data.message → message → String(e).
 */

/** מחלץ שדה מחרוזת לא-ריק מאובייקט לא-ידוע, בבטחה מול any shape. */
function nonEmptyString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined
}

export function formatAcpError(e: unknown): string {
  if (e && typeof e === "object") {
    const err = e as { message?: unknown; data?: unknown }
    if (err.data && typeof err.data === "object") {
      const data = err.data as { details?: unknown; message?: unknown }
      const details = nonEmptyString(data.details)
      if (details) return details
      const dataMessage = nonEmptyString(data.message)
      if (dataMessage) return dataMessage
    }
    const message = nonEmptyString(err.message)
    if (message) return message
  }
  return String(e)
}
