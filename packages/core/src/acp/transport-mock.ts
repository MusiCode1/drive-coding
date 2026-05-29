/**
 * transport-mock.ts — MockAcpTransport לבדיקות.
 *
 * מספק AcpTransport בזיכרון המאפשר לבדיקות:
 *   1. פליטת frames "מהסוכן" דרך emitFrame(json).
 *   2. בחינת frames שנשלחו "לסוכן" דרך sentFrames.
 *   3. הדמיית סגירה שלא ביוזמת הקורא דרך simulateClose(code, reason).
 *
 * ללא טיימרים, ללא רשת — פליטה סינכרונית לחלוטין. בדיקות שצריכות
 * להמתין להשפעות במורד הזרם (ה-SDK שמפרש את ה-frame, ושולח
 * למטפל הלקוח) בדרך כלל עדיין זקוקות ל-await Promise.resolve() או דומה
 * כדי לשחרר את ה-microtasks.
 *
 * ממוקם ב-core/ (ולא ב-tests/) כי הוא חלק מחוזה הבדיקות:
 * חבילות במורד הזרם (frontend, backend) משתמשות במק-זהה כדי לבדוק
 * את צרכני ה-AcpClient שלהן.
 */

import type { AcpTransport } from "./transport.js"

export class MockAcpTransport implements AcpTransport {
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>

  /**
   * Frames שנלכדו ונכתבו על-ידי ה-SDK לתעבורה. כל כניסה היא שורת
   * NDJSON אחת (ללא ה-\n בסופה). כתיבות מרובות-שורות מפוצלות.
   */
  readonly sentFrames: string[] = []

  #readableController: ReadableStreamDefaultController<Uint8Array> | undefined
  #closed = false
  #closeListeners: Array<(code: number, reason: string) => void> = []
  readonly #encoder = new TextEncoder()
  readonly #decoder = new TextDecoder()

  constructor() {
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.#readableController = controller
      },
    })

    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        const text = this.#decoder.decode(chunk)
        // ה-SDK כותב NDJSON: אובייקט JSON אחד לכל שורה המסתיימת ב-\n.
        // פיצול ושמירת שורות לא-ריקות; זה תואם למה שתעבורת WS
        // אמיתית הייתה שולחת כ-frames נפרדים.
        for (const line of text.split("\n")) {
          if (line.trim().length > 0) {
            this.sentFrames.push(line)
          }
        }
      },
    })
  }

  /**
   * דחיפת NDJSON frame "מהסוכן" לזרם הקריא.
   * ה-\n בסופה מתווסף אוטומטית (ה-SDK דורש אותו כגבול הודעה
   * — ראה למידות מ-2026-05-16).
   *
   * @throws אם התעבורה כבר נסגרה.
   */
  emitFrame(json: string): void {
    if (this.#closed) {
      throw new Error("MockAcpTransport: cannot emit after close")
    }
    if (!this.#readableController) {
      throw new Error("MockAcpTransport: not initialized")
    }
    this.#readableController.enqueue(this.#encoder.encode(`${json}\n`))
  }

  /**
   * הדמיית סגירה שלא ביוזמת הקורא (ניתוק תעבורה, קריסת סוכן).
   * מפעיל את ה-callbacks הרשומים של onClose וסוגר את הזרם הקריא.
   * אידמפוטנטי.
   */
  simulateClose(code = 1000, reason = ""): void {
    if (this.#closed) return
    this.#closed = true
    try {
      this.#readableController?.close()
    } catch {
      // כבר נסגר
    }
    for (const cb of this.#closeListeners.slice()) {
      cb(code, reason)
    }
  }

  close(): void {
    this.simulateClose(1000, "client closed")
  }

  onClose(cb: (code: number, reason: string) => void): void {
    this.#closeListeners.push(cb)
  }
}
