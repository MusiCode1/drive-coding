/**
 * resize-plan — חישוב scale-to-fit לתמונה לפני שליחה.
 *
 * מתמטיקה טהורה — אין browser globals, אין canvas, אין IO.
 * ה-encoding בפועל (canvas) נמצא ב-engine (FE-only).
 *
 * ─── image ─── (slice-image-paste Commit 0)
 */

const DEFAULT_MAX_DIM = 2048
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024 // 8MB

export type ResizePlan = {
  targetWidth: number
  targetHeight: number
  /** האם לקודד מחדש (re-encode). אם false — אפשר לשלוח as-is (רק base64). */
  shouldReencode: boolean
}

export function planResize(
  src: { width: number; height: number; bytes: number; mimeType: string },
  limits?: { maxDim?: number; maxBytes?: number },
): ResizePlan {
  const maxDim = limits?.maxDim ?? DEFAULT_MAX_DIM
  const maxBytes = limits?.maxBytes ?? DEFAULT_MAX_BYTES

  const needsScale = src.width > maxDim || src.height > maxDim
  const needsReencode = needsScale || src.bytes > maxBytes

  if (!needsScale) {
    return {
      targetWidth: src.width,
      targetHeight: src.height,
      shouldReencode: needsReencode,
    }
  }

  // scale-to-fit: ה-scale factor מבוסס על המימד הגדול יותר
  const scaleFactor = maxDim / Math.max(src.width, src.height)
  const targetWidth = Math.round(src.width * scaleFactor)
  const targetHeight = Math.round(src.height * scaleFactor)

  return {
    targetWidth,
    targetHeight,
    shouldReencode: true,
  }
}
