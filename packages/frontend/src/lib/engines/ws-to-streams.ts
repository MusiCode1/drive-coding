/**
 * ws-to-streams.ts — דפדפן WebSocket → { ReadableStream, WritableStream }
 *
 * חוזה (אחרי תיקון F1 — צינור in-process ישיר, ללא עטיפת stdio-to-ws):
 * 1. משתמש ב-WebSocket הטבעי של הדפדפן (ולא בחבילת `ws` של npm).
 * 2. קריאה (Readable): מעביר כל מסגרת (frame) של WS כפי שהיא ל-SDK ללא הוספת \n.
 *    (ה-SDK אוגר מסגרות חלקיות ומנתח אותן בגבול של \n — הוספת \n ל-
 *     מסגרת חלקית תגרום לשגיאת "Unterminated string" ולקריסת הזרם.)
 *    ללא סינון: כל בית שמגיע מצינור ה-BE מועבר הלאה.
 * 3. כתיבה (Writable): מפצל את ה-chunk לפי \n, שולח כל שורה לא ריקה עם סיומת \n
 *    (opencode מצפה לזרם NDJSON מופרד בשורות חדשות).
 */

export function wsToWebStreams(ws: WebSocket): {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
} {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  // ── Readable: מסגרות WS נכנסות → זרם בתים (מועבר כפי שהוא) ────────────
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      ws.addEventListener("message", (ev: MessageEvent) => {
        const text =
          typeof ev.data === "string"
            ? ev.data
            : ev.data instanceof ArrayBuffer
              ? decoder.decode(ev.data)
              : String(ev.data)

        // מעביר כפי שהוא — ה-SDK אוגר ומנתח בגבולות של \n.
        // אל תוסיף \n באופן מלאכותי — הודעת ACP אחת יכולה להיות מחולקת על פני
        // מספר מסגרות WS; הוספת \n למסגרת חלקית תגרום ל-SDK
        // לנתח אותה כהודעה שלמה → שגיאת "Unterminated string" → קריסת הזרם.
        controller.enqueue(encoder.encode(text))
      })

      ws.addEventListener("close", () => {
        try {
          controller.close()
        } catch {
          // כבר סגור
        }
      })

      ws.addEventListener("error", (e) => {
        try {
          controller.error(e)
        } catch {
          // כבר בשגיאה
        }
      })
    },
  })

  // ── Writable: זרם בתים → מסגרות WS יוצאות (מסגרת אחת לכל שורת NDJSON) ─
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      const text = decoder.decode(chunk)
      // ה-SDK כותב שורות `{...}\n` — פצל לפי \n ושלח כל אחת כמסגרת נפרדת.
      // המערכת של opencode (דרך stdio-to-ws) מצפה ל-NDJSON: כל מסגרת WS = הודעת JSON-RPC אחת + \n.
      for (const line of text.split("\n")) {
        if (line.trim().length > 0) {
          try {
            ws.send(`${line}\n`)
          } catch {
            // ה-WS כבר סגור
          }
        }
      }
    },
    close() {
      try {
        ws.close()
      } catch {
        // כבר סגור
      }
    },
    abort(reason) {
      try {
        ws.close(1011, String(reason))
      } catch {
        // כבר סגור
      }
    },
  })

  return { readable, writable }
}
