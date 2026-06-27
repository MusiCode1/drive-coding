/**
 * ws-to-streams.test.ts — סינון control-frames ($/pong) ב-readable.
 *
 * ה-heartbeat שולח $/ping; ה-BE מחזיר $/pong כ-frame עצמאי. הוא אסור שידלוף
 * לספריית לקוח ה-ACP החיצונית — wsToWebStreams מסנן אותו לפני הזרם.
 * הטסטים מוודאים: $/pong מסונן, הודעות ACP אמיתיות עוברות, frames חלקיים נשמרים.
 */

import { describe, expect, test } from "vitest"
import { wsToWebStreams } from "./ws-to-streams.js"

// ─── WebSocket stub מינימלי (message/close/error בלבד) ───────────────────────

function makeWsStub() {
  const listeners = new Map<string, Array<(ev: unknown) => void>>()
  return {
    addEventListener(event: string, cb: (ev: unknown) => void) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event)!.push(cb)
    },
    send() {},
    close() {},
    _fire(event: string, ev: unknown) {
      for (const cb of listeners.get(event) ?? []) cb(ev)
    },
  }
}

/** קורא frame בודד מה-readable ומחזיר את הבתים שהונפקו (או null אם הזרם נסגר). */
async function collectReadable(
  ws: ReturnType<typeof makeWsStub>,
  frames: Array<string | ArrayBuffer>,
): Promise<string[]> {
  const { readable } = wsToWebStreams(ws as unknown as WebSocket)
  const reader = readable.getReader()
  const decoder = new TextDecoder()

  for (const f of frames) ws._fire("message", { data: f })
  ws._fire("close", {})

  const out: string[] = []
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) out.push(decoder.decode(value))
  }
  return out
}

// ─── בדיקות ──────────────────────────────────────────────────────────────────

describe("wsToWebStreams — סינון control-frames", () => {
  test("$/pong מסונן ולא מגיע לזרם", async () => {
    const ws = makeWsStub()
    const out = await collectReadable(ws, [
      `${JSON.stringify({ jsonrpc: "2.0", method: "$/pong" })}\n`,
    ])
    expect(out).toEqual([])
  })

  test("$/ping (notification) מסונן גם הוא", async () => {
    const ws = makeWsStub()
    const out = await collectReadable(ws, [
      `${JSON.stringify({ jsonrpc: "2.0", method: "$/ping" })}\n`,
    ])
    expect(out).toEqual([])
  })

  test("$/pong מסונן גם כשהוא מגיע כ-ArrayBuffer (נתיב production binaryType)", async () => {
    // production מגדיר ws.binaryType = "arraybuffer" — מסגרות בינאריות מגיעות כ-ArrayBuffer.
    // ws-to-streams מפענח אותן עם TextDecoder; ודאים שהסינון חל גם על הנתיב הזה.
    const ws = makeWsStub()
    const bytes = new TextEncoder().encode(
      `${JSON.stringify({ jsonrpc: "2.0", method: "$/pong" })}\n`,
    )
    const out = await collectReadable(ws, [bytes.buffer])
    expect(out).toEqual([])
  })

  test("הודעת sessionUpdate אמיתית עוברת ללא שינוי", async () => {
    const ws = makeWsStub()
    const frame = `${JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionUpdate: "agent_message_chunk" },
    })}\n`
    const out = await collectReadable(ws, [frame])
    expect(out).toEqual([frame])
  })

  test("request עם id (גם אם method מתחיל ב-$/) עובר — לא notification בקרה", async () => {
    const ws = makeWsStub()
    const frame = `${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "$/cancelRequest" })}\n`
    const out = await collectReadable(ws, [frame])
    expect(out).toEqual([frame])
  })

  test("frame חלקי (JSON לא שלם) עובר הלאה — לא נשבר ה-buffering", async () => {
    const ws = makeWsStub()
    const partial = '{"jsonrpc":"2.0","method":"session/'
    const out = await collectReadable(ws, [partial])
    expect(out).toEqual([partial])
  })

  test("ערבוב: $/pong מסונן, הודעה אמיתית באותו רצף עוברת", async () => {
    const ws = makeWsStub()
    const real = `${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: {} })}\n`
    const out = await collectReadable(ws, [
      `${JSON.stringify({ jsonrpc: "2.0", method: "$/pong" })}\n`,
      real,
    ])
    expect(out).toEqual([real])
  })

  // fast-path correctness: frame שמכיל "$/" בתוך ה-payload (לא כ-method) חייב
  // לעבור — ה-substring guard מאיץ אך אסור שיסנן הודעה אמיתית.
  test('הודעה אמיתית שמכילה "$/" בתוכן עוברת (fast-path לא over-filtering)', async () => {
    const ws = makeWsStub()
    const real = `${JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionUpdate: "agent_message_chunk", text: "use $/ping for keepalive" },
    })}\n`
    const out = await collectReadable(ws, [real])
    expect(out).toEqual([real])
  })
})
