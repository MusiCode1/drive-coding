// @vitest-environment jsdom
/**
 * pad-drag.test.ts — clamping + the tap/drag split (slice session-memo-drag).
 *
 * שתי הנקודות שנבדקות כאן הן אלה שכשל בהן שקט: פתק שנגרר אל מחוץ לתיבה
 * הופך לבלתי-נגיש (הכותרת היא ידית-הגרירה היחידה, ואין כפתור סגירה), ונגיעה
 * שנספרת בטעות כגרירה מונעת מהגלולה להיפתח בכלל.
 */
import { describe, expect, test, vi } from "vitest"
import {
  clampSizeToBox,
  clampToBox,
  createPadDrag,
  createPadResize,
  DRAG_SLOP_PX,
  MIN_PAD_SIZE,
  type Pos,
  reclampElement,
  type Size,
} from "./pad-drag"

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
    stopPropagation: vi.fn(),
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

// ── resize ─────────────────────────────────────────────────────────────────

function makeResizeEl(
  rect: { left: number; top: number; width: number; height: number },
  rtl: boolean,
) {
  const el = {
    offsetWidth: rect.width,
    offsetHeight: rect.height,
    getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width }),
    offsetParent: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: BOX.width, height: BOX.height }),
    },
  }
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    direction: rtl ? "rtl" : "ltr",
  } as unknown as CSSStyleDeclaration)
  return el as unknown as HTMLElement
}

function resizeHarness(
  rect: { left: number; top: number; width: number; height: number },
  rtl: boolean,
) {
  const sizes: { size: Size; pos: Pos | null }[] = []
  const handlers = createPadResize({
    getEl: () => makeResizeEl(rect, rtl),
    onResize: (size, pos) => sizes.push({ size, pos }),
  })
  return { handlers, sizes }
}

describe("clampSizeToBox", () => {
  test("a size that fits is untouched", () => {
    expect(clampSizeToBox({ width: 200, height: 300 }, BOX)).toEqual({ width: 200, height: 300 })
  })

  test("a size larger than the box is cut down to it", () => {
    // חלון שהוקטן: פתק רחב מהמסך היה מכסה את כל הצ'אט, בלי אפשרות סגירה.
    expect(clampSizeToBox({ width: 900, height: 2000 }, BOX)).toEqual({
      width: BOX.width,
      height: BOX.height,
    })
  })

  test("the minimum wins over a box that is smaller still", () => {
    expect(clampSizeToBox({ width: 300, height: 300 }, { width: 50, height: 40 })).toEqual(
      MIN_PAD_SIZE,
    )
  })
})

describe("createPadResize", () => {
  const RECT = { left: 40, top: 30, width: 200, height: 150 }

  test("LTR: dragging the end-side grip outward grows it, position unchanged", () => {
    const { handlers, sizes } = resizeHarness(RECT, false)
    handlers.onpointerdown(makeEvent(240, 180))
    handlers.onpointermove(makeEvent(300, 260))
    expect(sizes.at(-1)).toEqual({ size: { width: 260, height: 230 }, pos: null })
  })

  test("RTL: dragging left grows it and moves left so the anchored edge stays put", () => {
    // ב-RTL הידית בשמאל. בלי הזזת left הפתק היה "בורח" הצידה תוך כדי מתיחה.
    const { handlers, sizes } = resizeHarness(RECT, true)
    handlers.onpointerdown(makeEvent(40, 180))
    handlers.onpointermove(makeEvent(0, 200))
    const last = sizes.at(-1)
    expect(last?.size).toEqual({ width: 240, height: 170 })
    expect(last?.pos).toEqual({ left: 0, top: 30 })
    // הקצה המעוגן (הימני) לא זז: left+width נשאר 240.
    expect((last?.pos?.left ?? 0) + (last?.size.width ?? 0)).toBe(RECT.left + RECT.width)
  })

  test("it never shrinks below the minimum", () => {
    const { handlers, sizes } = resizeHarness(RECT, false)
    handlers.onpointerdown(makeEvent(240, 180))
    handlers.onpointermove(makeEvent(-500, -500))
    expect(sizes.at(-1)?.size).toEqual(MIN_PAD_SIZE)
  })

  test("it never grows past the box edge", () => {
    const { handlers, sizes } = resizeHarness(RECT, false)
    handlers.onpointerdown(makeEvent(240, 180))
    handlers.onpointermove(makeEvent(9999, 9999))
    expect(sizes.at(-1)?.size).toEqual({
      width: BOX.width - RECT.left,
      height: BOX.height - RECT.top,
    })
  })

  test("moves from another pointer are ignored", () => {
    const { handlers, sizes } = resizeHarness(RECT, false)
    handlers.onpointerdown(makeEvent(240, 180))
    const other = makeEvent(400, 400) as { pointerId: number }
    other.pointerId = 2
    handlers.onpointermove(other as unknown as PointerEvent)
    expect(sizes).toHaveLength(0)
  })
})
