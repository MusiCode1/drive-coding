/**
 * image-attachment engine — לכידה, דחיסה, ו-base64 לתמונות מהמשתמש.
 *
 * Browser-only: משתמש ב-createImageBitmap / OffscreenCanvas / canvas.toBlob.
 * צורך את planResize מ-@drive-coding/core (מתמטיקה טהורה).
 *
 * ─── image ─── (slice-image-paste Commit 1)
 */
import { planResize } from "@drive-coding/core"

export type ImageAttachment = {
  id: string
  mimeType: string      // אחרי דחיסה: בד"כ "image/jpeg"
  dataBase64: string    // base64 גולמי (ללא prefix data:) — כפי ש-ACP ImageContent מצפה
  previewUrl: string    // object URL ל-thumbnail (להחזיק עד revokeAttachment)
  bytes: number
}

/**
 * מקבל File/Blob (מ-paste/drop/picker), דוחס לפי planResize, מחזיר attachment.
 * זורק שגיאה אם mimeType אינו image/*.
 */
export async function fileToImageAttachment(file: File | Blob): Promise<ImageAttachment> {
  const mimeType = file.type

  // וידוא שזו תמונה
  if (!mimeType.startsWith("image/")) {
    throw new Error(`Unsupported file type: ${mimeType}`)
  }

  // קבלת מימדים ו-bytes
  const bytes = file.size
  const imageBitmap = await createImageBitmap(file)
  const { width, height } = imageBitmap

  // חישוב תוכנית הדחיסה
  const plan = planResize({ width, height, bytes, mimeType })

  let resultBlob: Blob
  let resultMimeType: string

  if (!plan.shouldReencode) {
    // no re-encode — הפוך ישירות ל-blob (שמור mimeType מקורי)
    resultBlob = file instanceof Blob ? file : new Blob([file], { type: mimeType })
    resultMimeType = mimeType
  } else {
    // דחיסה דרך OffscreenCanvas
    const canvas = new OffscreenCanvas(plan.targetWidth, plan.targetHeight)
    const ctx = canvas.getContext("2d")
    if (!ctx) {
      imageBitmap.close()
      throw new Error("Could not get 2d context from OffscreenCanvas")
    }
    ctx.drawImage(imageBitmap, 0, 0, plan.targetWidth, plan.targetHeight)

    // encode ל-JPEG תמיד (מ-CodeNomad; PNG→JPEG מאבד alpha אך זול)
    const targetMime = "image/jpeg"
    const blob = await canvas.convertToBlob({ type: targetMime, quality: 0.85 })
    resultBlob = blob
    resultMimeType = targetMime
  }

  imageBitmap.close()

  // base64
  const arrayBuffer = await resultBlob.arrayBuffer()
  const uint8 = new Uint8Array(arrayBuffer)
  let binary = ""
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i] as number)
  }
  const dataBase64 = btoa(binary)

  // preview object URL (להחזיק עד revokeAttachment)
  const previewUrl = URL.createObjectURL(resultBlob)

  return {
    id: crypto.randomUUID(),
    mimeType: resultMimeType,
    dataBase64,
    previewUrl,
    bytes: resultBlob.size,
  }
}

/**
 * שחרור ה-object URL. יש לקרוא ב-onremove וב-onsend.
 */
export function revokeAttachment(a: ImageAttachment): void {
  URL.revokeObjectURL(a.previewUrl)
}
