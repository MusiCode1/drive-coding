/**
 * ws-transport.ts — מימוש WebSocket בדפדפן עבור AcpTransport.
 *
 * עוטף `WebSocket` יחד עם צינור הזרמים (`wsToWebStreams`) ומוסיף
 * keepalive לטובת NAT (שליחת $/ping כל 25 שניות) — עניין ספציפי ל-WS שלא
 * חל על תעבורת stdio או mock.
 *
 * מחזור חיים (Lifecycle):
 *   new WsAcpTransport(url)
 *     → ה-WS במצב CONNECTING, הזרמים כבר מחוברים
 *   await transport.waitForOpen()
 *     → משלים (resolves) כשה-WS מגיע ל-OPEN (ה-heartbeat מתחיל אוטומטית)
 *     → דוחה (rejects) באירוע "error"
 *   מעבירים ל-createAcpClient(transport, onUpdate)
 *
 * close() / ה-WS נסגר מהצד השני → ה-heartbeat נעצר, ה-onClose listeners מופעלים.
 */

import type { AcpTransport } from "@drive-coding/core/acp"
import { wsToWebStreams } from "./ws-to-streams.js"

const HEARTBEAT_INTERVAL_MS = 25_000

export class WsAcpTransport implements AcpTransport {
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>

  readonly #ws: WebSocket
  readonly #closeListeners: Array<(code: number, reason: string) => void> = []
  #heartbeatTimer: ReturnType<typeof setInterval> | undefined

  constructor(url: string, ws?: WebSocket) {
    // הפרמטר `ws` מיועד לטסטים — קוד הייצור מעביר רק את ה-URL.
    this.#ws = ws ?? new WebSocket(url)
    // ה-BE עשוי להעביר מסגרות בינאריות של `Buffer` מה-stdout של הילד (בתי NDJSON).
    // ללא binaryType=arraybuffer, הדפדפן יעביר אותם כ-Blob — מה שקשה יותר
    // לפענח בצורה סינכרונית בצינור הזרם. arraybuffer שומר על נתיב פיענוח אחיד.
    this.#ws.binaryType = "arraybuffer"

    // מתחיל את פעימות הלב (heartbeat) ברגע שהחיבור פתוח. אנחנו רושמים את
    // המאזין ללא תנאי בבנאי (constructor) כדי שהקוראים לא יצטרכו
    // לקרוא ל-waitForOpen() כדי לקבל התנהגות keepalive.
    this.#ws.addEventListener(
      "open",
      () => {
        this.#startHeartbeat()
      },
      { once: true },
    )

    this.#ws.addEventListener("close", (ev: CloseEvent) => {
      this.#stopHeartbeat()
      for (const cb of this.#closeListeners.slice()) {
        cb(ev.code, ev.reason)
      }
    })

    const streams = wsToWebStreams(this.#ws)
    this.readable = streams.readable
    this.writable = streams.writable
  }

  /**
   * מסתיים כשה-WebSocket מגיע למצב OPEN. נדחה באירוע "error".
   * בטוח לקריאה מספר פעמים — אידמפוטנטי כשהוא כבר פתוח.
   *
   * קוראים חייבים להמתין על זה לפני העברת ה-transport אל `createAcpClient`,
   * אחרת הכתיבה הראשונית של ה-SDK תיכשל.
   */
  async waitForOpen(): Promise<void> {
    if (this.#ws.readyState === WebSocket.OPEN) return
    await new Promise<void>((resolve, reject) => {
      this.#ws.addEventListener("open", () => resolve(), { once: true })
      this.#ws.addEventListener("error", () => reject(new Error("WS connect failed")), {
        once: true,
      })
    })
  }

  close(): void {
    this.#stopHeartbeat()
    try {
      this.#ws.close()
    } catch {
      // כבר סגור
    }
  }

  onClose(cb: (code: number, reason: string) => void): void {
    this.#closeListeners.push(cb)
  }

  /**
   * סוגר את ה-WS וממתין לאירוע close (או מתרצה מיד אם כבר סגור).
   * משמש את ה-VM לסגירת WS חי לפני פתיחת WS חדש ב-warm reconnect —
   * מונע race של 1008 "second tab" + agent יתום קבוע (NBug2 root fix).
   *
   * timeout fallback (ברירת מחדל: 1000ms) מונע hang אם close event לא מגיע.
   * ⚠️ חובה לרשום listener לפני close() — מבטיח שלא מפספסים את האירוע.
   */
  async closeAndWait(timeoutMs = 1000): Promise<void> {
    if (this.#ws.readyState === WebSocket.CLOSED) return
    const closed = new Promise<void>((resolve) => {
      this.#closeListeners.push(() => resolve())
    })
    this.close()   // קורא ws.close() — close event יגיע אסינכרונית
    await Promise.race([
      closed,
      new Promise<void>((r) => setTimeout(r, timeoutMs)),
    ])
  }

  #startHeartbeat(): void {
    if (this.#heartbeatTimer !== undefined) return
    this.#heartbeatTimer = setInterval(() => {
      if (this.#ws.readyState === WebSocket.OPEN) {
        try {
          this.#ws.send(`${JSON.stringify({ jsonrpc: "2.0", method: "$/ping" })}\n`)
        } catch {
          // ה-WS עובר למצב סגור — בדיקת האינטרוול הבאה תדלג על כך
        }
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  #stopHeartbeat(): void {
    if (this.#heartbeatTimer !== undefined) {
      clearInterval(this.#heartbeatTimer)
      this.#heartbeatTimer = undefined
    }
  }
}
