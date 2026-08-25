/**
 * pdf-render-support.ts — זיהוי תמיכת PDF-inline בדפדפן (slice fs-file-proxy).
 *
 * `navigator.pdfViewerEnabled` (Chromium/Firefox) — אם `false`, ה-iframe יציג
 * "download prompt" ריק במקום PDF; אם השדה לא קיים (Safari ישן) מניחים תמיכה.
 * iOS Safari מטופל בנפרד: גלילת-iframe שבורה שם גם כשה-viewer "קיים".
 */
export function canRenderPdfInline(): boolean {
  if (typeof navigator === "undefined") return false
  if (typeof (navigator as { pdfViewerEnabled?: boolean }).pdfViewerEnabled === "boolean") {
    if (!(navigator as { pdfViewerEnabled: boolean }).pdfViewerEnabled) return false
  }
  // iOS Safari: iframe PDF גלילה שבורה → פתח בטאב חדש
  const ua = navigator.userAgent.toLowerCase()
  if (/iphone|ipad/.test(ua)) return false
  return true
}
