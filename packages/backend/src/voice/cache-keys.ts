/**
 * עזרי גיבוב (Hashing) לייצור מפתחות מטמון.
 * משתמש ב-Web Crypto API (זמין ב-Node 22+ וב-Bun).
 */

/** מחזיר תקציר SHA-256 מקודד כ-hex של המחרוזת הנכנסת. */
export async function sha256Key(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest("SHA-256", buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
