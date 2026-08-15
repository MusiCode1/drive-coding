/**
 * safeUUID — מחולל UUIDv4 בטוח לרשת/דפדפן.
 * משתמש ב-crypto.randomUUID() בסביבות מאובטחות (HTTPS / localhost),
 * ונופל חזרה ל-crypto.getRandomValues() / Math.random() בסביבות HTTP לא-מאובטחות (למשל IP חיצוני).
 */
export function safeUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  const bytes =
    typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function"
      ? crypto.getRandomValues(new Uint8Array(16))
      : Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))

  // RFC4122 variant + version 4 bits
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
