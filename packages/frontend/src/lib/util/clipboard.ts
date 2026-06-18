/**
 * clipboard.ts — עזר לכתיבת טקסט ללוח (Clipboard API).
 *
 * ui-polish-batch · C1
 */

/**
 * מעתיק טקסט ללוח הגזירים של המערכת.
 * מחזיר true בהצלחה, false בכשל (ה-API לא זמין / נדחתה הרשאה).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
