// @vitest-environment jsdom
/**
 * pad-drag.test.ts — clamping + the tap/drag split (slice session-memo-drag).
 *
 * שתי הנקודות שנבדקות כאן הן אלה שכשל בהן שקט: פתק שנגרר אל מחוץ לתיבה
 * הופך לבלתי-נגיש (הכותרת היא ידית-הגרירה היחידה, ואין כפתור סגירה), ונגיעה
 * שנספרת בטעות כגרירה מונעת מהגלולה להיפתח בכלל.
 */
import { describe, expect, test, vi } from "vitest"
import { clampToBox, createPadDrag, DRAG_SLOP_PX, reclampElement } from "./pad-drag"

const SIZE = { width: 280, height: 220 }
const BOX = { width: 400, height: 800 }

describe("clampToBox", () => {
  test("a position inside the box is untouched", () => {
    expect(clampToBox({ left: 30, top: 100 }, SIZE, BOX)).toEqual({ left: 30, top: 100 })
  })

  test("past the far edges it is pulled back so the pad stays whole", () => {
    expect(clampToBox({ left: 9999, top: 9999 }, SIZE, BOX)).toEqual({ left: 120, top: 580 })
  })

  test("negative coordinates snap to the origin", () => {
    expect(clampToBox({ left: -50, top: -50 }, SIZE, BOX)).toEqual({ left: 0, top: 0 })
  })

  test("a pad bigger than the box lands at 0,0 — never negative", () => {
    // סיבוב מסך או סייד-בר שנפתח מקטינים את התיבה. left שלילי היה דוחף את
    // הכותרת אל מחוץ למסך, ואיתה את ידית-הגרירה היחידה.
    expect(clampToBox({ left: 50, top: 50 }, { width: 900, height: 1200 }, BOX)).toEqual({
      left: 0,
      top: 0,
    })
  })
})

// ── drag machine ───────────────────────────────────────────────────────────

function makeEl(rect: { left: number; top: number }) {
  const el = {
    offsetWidth: SIZE.width,
    offsetHeight: SIZE.height,
    getBoundingClientRect: () => ({ left: rect.left, top: rect.top }),
    offsetParent: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: BOX.width, height: BOX.height }),
    },
  }
  return el as unknown as HTMLElement
}

function makeEvent(x: number, y: number, target?: Element) {
  const el = target ?? document.createElement("div")
  const capture = {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: () => true,
  }
  Object.setPrototypeOf(capture, HTMLElement.prototype)
  return {
    pointerId: 1,
    clientX: x,
    clientY: y,
    target: el,
    currentTarget: capture,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent
}

function harness(rect = { left: 0, top: 0 }) {
  const positions: { left: number; top: number }[] = []
  const handlers = createPadDrag({ getEl: () => makeEl(rect), onPos: (p) => positions.push(p) })
  return { handlers, positions }
}

describe("createPadDrag", () => {
  test("press and release without moving is not a drag — the click is left alone", () => {
    const { handlers, positions } = harness()
    handlers.onpointerdown(makeEvent(50, 50))
    handlers.onpointerup(makeEvent(50, 50))
    expect(positions).toHaveLength(0)
    expect(handlers.consumeDrag()).toBe(false)
  })

  test("movement below the slop threshold still counts as a click", () => {
    // אצבע רועדת על מסך מגע: בלי סף, הגלולה לא הייתה נפתחת אף פעם.
    const { handlers, positions } = harness()
    handlers.onpointerdown(makeEvent(50, 50))
    handlers.onpointermove(makeEvent(50 + DRAG_SLOP_PX - 1, 50))
    handlers.onpointerup(makeEvent(50 + DRAG_SLOP_PX - 1, 50))
    expect(positions).toHaveLength(0)
    expect(handlers.consumeDrag()).toBe(false)
  })

  test("a real drag is flagged so the trailing click can be swallowed", () => {
    // בלי זה, גרירה שמסתיימת על הגלולה גם פותחת אותה.
    const { handlers, positions } = harness()
    handlers.onpointerdown(makeEvent(50, 50))
    handlers.onpointermove(makeEvent(120, 300))
    handlers.onpointerup(makeEvent(120, 300))
    expect(positions.at(-1)).toEqual({ left: 70, top: 250 })
    expect(handlers.consumeDrag()).toBe(true)
  })

  test("consumeDrag resets — a drag suppresses exactly one click", () => {
    const { handlers } = harness()
    handlers.onpointerdown(makeEvent(50, 50))
    handlers.onpointermove(makeEvent(120, 300))
    handlers.onpointerup(makeEvent(120, 300))
    expect(handlers.consumeDrag()).toBe(true)
    expect(handlers.consumeDrag()).toBe(false)
  })

  test("the grab offset is preserved — the pad does not jump to the cursor", () => {
    // נלחץ 40px פנימה מהפינה. היעד נבחר בתוך הגבולות בכוונה, כדי שהבדיקה
    // תבודד את שמירת ההיסט ולא תימדד מול ההצמדה: קפיצה-לסמן הייתה נותנת 150.
    const { handlers, positions } = harness({ left: 10, top: 20 })
    handlers.onpointerdown(makeEvent(50, 60))
    handlers.onpointermove(makeEvent(150, 400))
    expect(positions.at(-1)).toEqual({ left: 110, top: 360 })
  })

  test("a drag is clamped to the box while it happens", () => {
    const { handlers, positions } = harness()
    handlers.onpointerdown(makeEvent(0, 0))
    handlers.onpointermove(makeEvent(5000, 5000))
    expect(positions.at(-1)).toEqual({ left: 120, top: 580 })
  })

  test("moves from a different pointer are ignored", () => {
    // מולטי-טאץ': אצבע שנייה על המסך לא אמורה לחטוף את הגרירה.
    const { handlers, positions } = harness()
    handlers.onpointerdown(makeEvent(50, 50))
    const other = makeEvent(300, 300) as { pointerId: number }
    other.pointerId = 2
    handlers.onpointermove(other as unknown as PointerEvent)
    expect(positions).toHaveLength(0)
  })

  test("pointercancel ends the drag without leaving it stuck", () => {
    const { handlers, positions } = harness()
    handlers.onpointerdown(makeEvent(50, 50))
    handlers.onpointermove(makeEvent(120, 300))
    handlers.onpointercancel(makeEvent(120, 300))
    const count = positions.length
    handlers.onpointermove(makeEvent(200, 400))
    expect(positions).toHaveLength(count)
  })

  test("a press starting on a [data-no-drag] control never begins a drag", () => {
    // כפתור הצמצום יושב בתוך ידית-הגרירה. בלי החרגה, pointer-capture על הידית
    // בולע את ה-click והכפתור מת — נמדד בדפדפן לפני שהתווסף ה-guard.
    const { handlers, positions } = harness()
    const btn = document.createElement("button")
    btn.setAttribute("data-no-drag", "")
    handlers.onpointerdown(makeEvent(50, 50, btn))
    handlers.onpointermove(makeEvent(200, 400, btn))
    handlers.onpointerup(makeEvent(200, 400, btn))
    expect(positions).toHaveLength(0)
    expect(handlers.consumeDrag()).toBe(false)
  })
})

describe("reclampElement", () => {
  test("returns null when the position is already inside", () => {
    expect(reclampElement(makeEl({ left: 0, top: 0 }), { left: 10, top: 10 })).toBeNull()
  })

  test("null element or null position is a no-op", () => {
    expect(reclampElement(null, { left: 10, top: 10 })).toBeNull()
    expect(reclampElement(makeEl({ left: 0, top: 0 }), null)).toBeNull()
  })

  test("a position valid for the pill is pulled back once the card expands", () => {
    // התרחיש שנמדד: נגרר כגלולה ל-left=226 בתיבה ברוחב 400, ואז נפרש לכרטיס
    // ברוחב 280 — בלי הצמדה מחדש חצי מהכרטיס יוצא מהמסך.
    expect(reclampElement(makeEl({ left: 226, top: 0 }), { left: 226, top: 10 })).toEqual({
      left: 120,
      top: 10,
    })
  })
})
