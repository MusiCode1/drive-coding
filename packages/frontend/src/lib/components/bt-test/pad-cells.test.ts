/**
 * pad-cells.test.ts — ‏נועל את המיפוי שנשבר על חומרה אמיתית.
 *
 * ‏הבאג: ▲ ‏ו-▼ ‏נשאו את אותו `lit()` ‏של ◀ ‏ו-▶ ⇒ ‏לחיצה אחת הדליקה שני תאים.
 * ‏המשתמש: "‏כאילו נלחצו בו-זמנית ימינה/‏שמאלה וגם למעלה/‏מטה".
 */
import { describe, expect, it } from "vitest"
import { PAD_CELLS, padCellStates } from "./pad-cells.js"

function cell(hot: Parameters<typeof padCellStates>[0], id: string) {
  const found = padCellStates(hot, null).find((c) => c.id === id)
  if (!found) throw new Error(`no cell ${id}`)
  return found
}

describe("pad-cells", () => {
  it('lit("prev") never lights the volume cell', () => {
    expect(cell("prev", "left").lit).toBe(true)
    // ‏🔴 ‏הבאג המקורי: ▲ ‏נדלק יחד עם ◀
    expect(cell("prev", "up").lit).toBe(false)
    expect(cell("prev", "down").lit).toBe(false)
  })

  it('lit("next") never lights the volume cell', () => {
    expect(cell("next", "right").lit).toBe(true)
    // ‏🔴 ‏הבאג המקורי: ▼ ‏נדלק יחד עם ▶
    expect(cell("next", "down").lit).toBe(false)
    expect(cell("next", "up").lit).toBe(false)
  })

  it("the two volume cells are inert and carry a reason", () => {
    for (const id of ["up", "down"]) {
      const c = cell("center", id)
      expect(c.button).toBeNull()
      expect(c.inertReason).toBeTruthy()
    }
    // ‏אינרטי גם מול `flash`, ‏לא רק מול `hot`
    for (const btn of ["prev", "center", "next"] as const) {
      const states = padCellStates(null, btn)
      expect(states.filter((c) => c.button === null).every((c) => !c.lit)).toBe(true)
    }
  })

  it("each active cell lights only for its own button", () => {
    // ⚠️ ‏מתוחם לשלושת התאים הפעילים בלבד — ‏ר' ‏הבריף §3ב #11.
    const active = [
      { id: "left", button: "prev" },
      { id: "center", button: "center" },
      { id: "right", button: "next" },
    ] as const
    for (const a of active) {
      for (const b of active) {
        expect(cell(b.button, a.id).lit).toBe(a.id === b.id)
      }
    }
  })

  it("exposes exactly five cells with unique ids", () => {
    expect(PAD_CELLS).toHaveLength(5)
    expect(new Set(PAD_CELLS.map((c) => c.id)).size).toBe(5)
  })
})
