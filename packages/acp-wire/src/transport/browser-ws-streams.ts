/**
 * browser-ws-streams.ts — דפדפן WebSocket → { ReadableStream, WritableStream }
 *
 * חוזה (אחרי תיקון F1 — צינור in-process ישיר, ללא עטיפת stdio-to-ws):
 * 1. משתמש ב-WebSocket הטבעי של הדפדפן (ולא בחבילת `ws` של npm).
 * 2. קריאה (Readable): מעביר כל מסגרת (frame) של WS כפי שהיא ל-SDK ללא הוספת \n.
 *    (ה-SDK אוגר מסגרות חלקיות ומנתח אותן בגבול של \n — הוספת \n ל-
 *     מסגרת חלקית תגרום לשגיאת "Unterminated string" ולקריסת הזרם.)
 *    סינון יחיד: control-frames של keepalive ($/pong וכו') מסוננים לפני הזרם —
 *    ר' isAcpControlFrame. כל בית אחר מצינור ה-BE מועבר הלאה כפי שהוא.
 * 3. כתיבה (Writable): מפצל את ה-chunk לפי \n, שולח כל שורה לא ריקה עם סיומת \n
 *    (opencode מצפה לזרם NDJSON מופרד בשורות חדשות).
 */

/**
 * האם ה-frame הוא notification בקרה ($/...) של keepalive ולא הודעת ACP אמיתית.
 *
 * ה-BE מחזיר `{"jsonrpc":"2.0","method":"$/pong"}` כ-frame עצמאי שלם בתגובה
 * ל-$/ping של ה-heartbeat (ר' ws-agent.ts / ws-transport.ts). frame כזה אסור
 * שידלוף לספריית לקוח ה-ACP החיצונית — היא לא מכירה method כזה וזורקת
 * "Method not found" (-32601). מסננים אותו כאן, לפני שהבתים נכנסים לזרם.
 *
 * הבדיקה שמרנית: רק notification (ללא id) עם method שמתחיל ב-"$/" מסונן.
 * frame חלקי / מרובה-הודעות → JSON.parse נכשל → false → מועבר הלאה ללא שינוי,
 * כדי לא לשבור את ה-buffering של ה-SDK על גבולות \n.
 *
 * fast-path ביצועים: control frames זעירים ומכילים תמיד "$/". מסגרות גדולות
 * (chunks של תשובות agent) לא מכילות "$/", ולכן בדיקת substring זולה פוסלת אותן
 * עוד לפני trim()+JSON.parse הכבדים — מונע double-parse של כל frame נכנס
 * (ה-SDK ממילא מנתח שוב), שאחרת מעמיס את ה-message handler של ה-WS.
 */
function isAcpControlFrame(text: string): boolean {
  if (!text.includes("$/")) return false
  const trimmed = text.trim()
  if (!trimmed.startsWith("{")) return false
  let msg: unknown
  try {
    msg = JSON.parse(trimmed)
  } catch {
    return false
  }
  if (typeof msg !== "object" || msg === null) return false
  const m = msg as { method?: unknown; id?: unknown }
  return typeof m.method === "string" && m.method.startsWith("$/") && m.id === undefined
}

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

        // סינון control-frames של keepalive ($/pong) — אסור שידלפו לספריית
        // לקוח ה-ACP החיצונית (זורקת "Method not found"). ר' isAcpControlFrame.
        if (isAcpControlFrame(text)) return

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
