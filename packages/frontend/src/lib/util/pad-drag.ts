/**
 * pad-drag.ts — גרירת אלמנט צף בתוך ה-offsetParent שלו (slice session-memo-drag).
 *
 * הוצא מ-`SessionMemoPad.svelte` כדי שהקומפוננטה תישאר leaf דק (חוק זהב #3,
 * תקציב 50 שורות `<script>`): כאן יושבת מכונת-המצבים, ושם נשארת רק החיווט.
 *
 * העבודה היא ב-Pointer Events ולא בזוגות mouse+touch: מסלול קוד אחד לאצבע,
 * לעכבר ולעט, ו-`setPointerCapture` שומר על הגרירה חיה גם כשהמצביע יוצא
 * מהידית הקטנה — בלעדיו גרירה מהירה "נשמטת" באמצע.
 */

export type Pos = { left: number; top: number }
export type Box = { width: number; height: number }

/** מתחת לזה — נגיעה, לא גרירה. בלי סף כזה כל טפיחה זזה פיקסל ולא נחשבת קליק. */
export const DRAG_SLOP_PX = 4

/** סימון לצאצאים שהם פקדים ולא ידית — ראה `onpointerdown`. */
export const NO_DRAG_SELECTOR = "[data-no-drag]"

/**
 * מצמיד לתוך התיבה. נקרא בכל גרירה ובכל שינוי-מידות: הכותרת היא ידית-הגרירה
 * היחידה, ולכן פתק שיצא מהתיבה (סיבוב מסך, פתיחת סייד-בר) היה נשאר
 * בלתי-נגיש. `Math.max(0, …)` מחזיק אפס גם כשהאלמנט גדול מהתיבה.
 */
export function clampToBox(pos: Pos, size: Box, box: Box): Pos {
  return {
    left: Math.min(Math.max(0, pos.left), Math.max(0, box.width - size.width)),
    top: Math.min(Math.max(0, pos.top), Math.max(0, box.height - size.height)),
  }
}

/**
 * מצמיד מחדש מיקום קיים למידות הנוכחיות של האלמנט, ומחזיר `null` כשאין מה
 * לתקן (כדי שהקורא לא יכתוב state בכל רינדור ויסתובב בלולאה).
 *
 * נחוץ כי המיקום נשמר אחד לשני המצבים: גוררים גלולה ברוחב ~47px, ואז פורשים
 * לכרטיס ברוחב 320px — ההצמדה שנעשתה בזמן הגרירה כבר לא תקפה, והכרטיס גולש
 * מחוץ למסך. נמדד בדפדפן: נגרר ל-left=226 ברוחב-תיבה 420, ואחרי פתיחה חצי
 * מהכרטיס היה חתוך.
 */
export function reclampElement(el: HTMLElement | null, pos: Pos | null): Pos | null {
  const parent = el?.offsetParent?.getBoundingClientRect()
  if (!el || !parent || !pos) return null
  const next = clampToBox(pos, { width: el.offsetWidth, height: el.offsetHeight }, parent)
  return next.left === pos.left && next.top === pos.top ? null : next
}

type PadDragOptions = {
  /** האלמנט הנגרר. פונקציה ולא ערך — ה-`bind:this` מתמלא אחרי היצירה. */
  getEl: () => HTMLElement | null
  /** מיקום חדש, כבר מוצמד, יחסית ל-offsetParent. */
  onPos: (pos: Pos) => void
}

export type PadDragHandlers = {
  onpointerdown: (e: PointerEvent) => void
  onpointermove: (e: PointerEvent) => void
  onpointerup: (e: PointerEvent) => void
  onpointercancel: (e: PointerEvent) => void
}

export type PadDrag = PadDragHandlers & {
  /**
   * האם המחווה האחרונה הייתה גרירה — ומאפסת את הדגל.
   *
   * הפתיחה נשארת ב-`onclick` נייטיב ולא ב-pointerup, כי `click` הוא מה
   * שמקלדת מייצרת (Enter/Space); קשירה ל-pointer בלבד הופכת את הגלולה
   * לבלתי-נגישה למקלדת. אבל גרירה שמסתיימת על האלמנט מייצרת גם היא `click`,
   * ולכן ה-handler שואל קודם כאן ומתעלם ממנו.
   */
  consumeDrag: () => boolean
}

export function createPadDrag(opts: PadDragOptions): PadDrag {
  let drag: { id: number; dx: number; dy: number; x: number; y: number; moved: boolean } | null =
    null
  let lastMoved = false

  function geometry() {
    const el = opts.getEl()
    const parent = el?.offsetParent?.getBoundingClientRect()
    if (!el || !parent) return null
    return { el, parent, size: { width: el.offsetWidth, height: el.offsetHeight } }
  }

  function end(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return
    lastMoved = drag.moved
    drag = null
    if (e.currentTarget instanceof HTMLElement && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return {
    onpointerdown(e) {
      // כפתורים בתוך ידית-הגרירה מסומנים `data-no-drag` ואינם מתחילים גרירה.
      // בלי זה `setPointerCapture` על הידית חוטף את ה-pointerup, הדפדפן לא
      // מייצר `click` על הכפתור המקונן, וכפתור הצמצום פשוט מת (נמדד בדפדפן).
      if (e.target instanceof Element && e.target.closest(NO_DRAG_SELECTOR)) return
      const g = geometry()
      if (!g) return
      const r = g.el.getBoundingClientRect()
      drag = {
        id: e.pointerId,
        dx: e.clientX - r.left,
        dy: e.clientY - r.top,
        x: e.clientX,
        y: e.clientY,
        moved: false,
      }
      if (e.currentTarget instanceof HTMLElement) e.currentTarget.setPointerCapture(e.pointerId)
      e.preventDefault()
    },
    onpointermove(e) {
      const g = geometry()
      if (!drag || e.pointerId !== drag.id || !g) return
      if (
        !drag.moved &&
        Math.abs(e.clientX - drag.x) < DRAG_SLOP_PX &&
        Math.abs(e.clientY - drag.y) < DRAG_SLOP_PX
      ) {
        return
      }
      drag.moved = true
      const raw = {
        left: e.clientX - drag.dx - g.parent.left,
        top: e.clientY - drag.dy - g.parent.top,
      }
      opts.onPos(clampToBox(raw, g.size, g.parent))
    },
    onpointerup: end,
    onpointercancel: end,
    consumeDrag() {
      const moved = lastMoved
      lastMoved = false
      return moved
    },
  }
}
