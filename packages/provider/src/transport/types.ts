/**
 * types.ts — ממשק AcpTransport (byte-transport).
 *
 * תפר היפוך-תלויות (Dependency-inversion) בין הלוגיקה של לקוח ה-ACP (אגנוסטית לתעבורה)
 * לתעבורת הבתים הבסיסית (WebSocket ב-FE, stdio ב-BE, mock בבדיקות).
 *
 * חוזה:
 *   - readable: זרם של בתים נכנסים מהסוכן (NDJSON frames).
 *     ה-ACP SDK קורא את זה דרך ndJsonStream שאוגר על גבולות \n.
 *   - writable: זרם של בתים יוצאים לסוכן. ה-SDK כותב
 *     שורות של {...}\n.
 *   - close(): סיום ביוזמת הקורא.
 *   - onClose(cb): רישום לסיום שלא ביוזמת הקורא
 *     (ניתוק תעבורה, קריסת סוכן, וכו'). עשוי להיקרא 0 או 1 פעמים לכל
 *     מופע של תעבורה.
 *
 * שני הזרמים הם זרמי בתים (Uint8Array) כדי להתאים לחוזה של ה-SDK.
 * תעבורות שעובדות בטקסט (למשל browser WebSocket) חייבות להמיר עם
 * TextEncoder/TextDecoder פנימית.
 *
 * הערה: קיים AcpTransport שני ב-core/src/ports.ts (session-transport:
 * start/prompt/cancel/shutdown) — מושג שונה לחלוטין. לא לאחד.
 */

export interface AcpTransport {
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>
  close(): void
  onClose(cb: (code: number, reason: string) => void): void
}
