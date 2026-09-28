/**
 * client.elicitation-wire.test.ts — ‏ה-method `elicitation/create` עוברת דרך ה-SDK **‏האמיתי**.
 *
 * 🔴 **‏למה הטסט הזה קיים.** ‏`client.create-elicitation.test.ts` ‏קורא לשדה ישירות
 * (`impl.createElicitation?.(…)`), ‏ולכן הוא ירוק **‏גם כשה-SDK ‏לא רושם ‏handler בכלל**.
 * ‏בדיוק זה קרה: ‏SDK ‏1.4.0 ‏הסיר את הקידומת `unstable_` ‏מ-`createElicitation`,
 * ‏`legacyClientApp` ‏עושה ‏`if (implementation.createElicitation)`, ‏התנאי נכשל בשקט,
 * ‏ו-`elicitation/create` ‏חזרה `-32601 Method not found` ‏מ-22/09/2026 ‏עד שתוקן —
 * ‏בזמן שהטסט ההוא הראה ‏3/3 ‏ירוקים.
 *
 * ‏הטסט הזה מזרים frame אמיתי דרך `ClientSideConnection` ‏ובודק את **‏התשובה על החוט**.
 * ‏שינוי-שם נוסף ב-upstream יפיל אותו מיָד.
 *
 * ‏ר' `AGENTS.md` §"A fail-open path is not implemented until its silence is pinned".
 */

import { describe, expect, it } from "vitest"
import type { AcpTransport } from "../transport/types.js"
import { createAttachedAcpClient } from "./client.js"

const ELICITATION_PARAMS = {
  sessionId: "sess-1",
  mode: "form",
  message: "בחר אחת",
  requestedSchema: { type: "object", properties: {} },
} as const

/** transport double עם readable שניתן להזרים אליו — ‏כמו `client.attached.test.ts`, ‏רק דו-כיווני. */
function makeDuplexTransportDouble() {
  const written: string[] = []
  const dec = new TextDecoder()
  const enc = new TextEncoder()
  let push: (frame: unknown) => void = () => {}

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      written.push(dec.decode(chunk))
    },
  })
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (frame) => controller.enqueue(enc.encode(`${JSON.stringify(frame)}\n`))
    },
  })

  const transport: AcpTransport = { readable, writable, close() {}, onClose(_cb) {} }
  return { transport, written, push: (f: unknown) => push(f) }
}

/** ממתין עד שנכתבה תשובה ל-`id` ‏שנשלח, ‏או נכשל אחרי מספר ticks. */
async function awaitResponse(written: string[], id: number): Promise<Record<string, unknown>> {
  for (let i = 0; i < 200; i++) {
    for (const chunk of written.join("").split("\n")) {
      if (chunk.trim() === "") continue
      const parsed = JSON.parse(chunk) as Record<string, unknown>
      if (parsed.id === id) return parsed
    }
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error(`אין תשובה ל-id=${id}. נכתב: ${JSON.stringify(written)}`)
}

describe("elicitation/create על החוט — דרך ה-SDK האמיתי", () => {
  it("עם handler → מחזיר את תשובת ה-handler, ולא method-not-found", async () => {
    const { transport, written, push } = makeDuplexTransportDouble()
    createAttachedAcpClient(transport, {
      onUpdate: () => {},
      onCreateElicitation: async () => ({ action: "accept", content: { pick: "א" } }) as never,
    })

    push({ jsonrpc: "2.0", id: 7, method: "elicitation/create", params: ELICITATION_PARAMS })
    const res = await awaitResponse(written, 7)

    // 🔑 זו השורה שתופסת שינוי-שם ב-SDK: handler שלא נרשם ⇒ error -32601.
    expect(res.error).toBeUndefined()
    expect(res.result).toMatchObject({ action: "accept" })
  })

  it("בלי handler → default cancel על החוט, ולא method-not-found", async () => {
    const { transport, written, push } = makeDuplexTransportDouble()
    createAttachedAcpClient(transport, { onUpdate: () => {} })

    push({ jsonrpc: "2.0", id: 8, method: "elicitation/create", params: ELICITATION_PARAMS })
    const res = await awaitResponse(written, 8)

    expect(res.error).toBeUndefined()
    expect(res.result).toMatchObject({ action: "cancel" })
  })
})
