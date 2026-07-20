/**
 * resize-drag.ts — Svelte action לגרירת ידית שינוי-גובה (Pointer Events).
 *
 * מכניקה (דפוס BottomSheet.svelte): `pointerdown` קובע נקודת-פתיחה + `setPointerCapture`;
 * `pointermove` מחשב גובה חדש (clamp) וקורא ל-`onMove` (transient, ללא persist);
 * `pointerup`/`pointercancel` קוראים ל-`onEnd` (persist) + `releasePointerCapture`.
 *
 * Pointer Events מכסים mouse+touch+pen — לא צריך handlers נפרדים ל-touch.
 * `touch-action: none` על הידית (ב-CSS של הקורא) מונע scroll תוך גרירה.
 *
 * ─── slice connect-panel-resize ───
 */

export interface ResizeDragParams {
  getStart: () => number // גובה נוכחי (px) בתחילת גרירה
  onMove: (px: number) => void // גובה חי בזמן גרירה (local $state — ללא persist)
  onEnd: (px: number) => void // גובה סופי ב-pointerup (persist)
  min?: number // ברירת מחדל 120
  max?: () => number // ברירת מחדל () => Math.min(600, window.innerHeight * 0.7)
}

const DEFAULT_MIN = 120

function defaultMax(): number {
  return Math.min(600, window.innerHeight * 0.7)
}

/** פונקציה טהורה — clamp ערך בין min ל-max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function resizeDrag(
  node: HTMLElement,
  params: ResizeDragParams,
): { update(p: ResizeDragParams): void; destroy(): void } {
  let current = params

  let startY = 0
  let startH = 0
  let lastClamped = 0

  function bounds(): { min: number; max: number } {
    return {
      min: current.min ?? DEFAULT_MIN,
      max: current.max ? current.max() : defaultMax(),
    }
  }

  function onPointerDown(e: PointerEvent): void {
    startY = e.clientY
    startH = current.getStart()
    lastClamped = startH
    node.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent): void {
    if (!node.hasPointerCapture(e.pointerId)) return
    const { min, max } = bounds()
    lastClamped = clamp(startH + (e.clientY - startY), min, max)
    current.onMove(lastClamped)
  }

  function onPointerUp(e: PointerEvent): void {
    if (!node.hasPointerCapture(e.pointerId)) return
    node.releasePointerCapture(e.pointerId)
    current.onEnd(lastClamped)
  }

  function onPointerCancel(e: PointerEvent): void {
    if (!node.hasPointerCapture(e.pointerId)) return
    node.releasePointerCapture(e.pointerId)
    current.onEnd(lastClamped)
  }

  node.addEventListener("pointerdown", onPointerDown)
  node.addEventListener("pointermove", onPointerMove)
  node.addEventListener("pointerup", onPointerUp)
  node.addEventListener("pointercancel", onPointerCancel)

  return {
    update(p: ResizeDragParams): void {
      current = p
    },
    destroy(): void {
      node.removeEventListener("pointerdown", onPointerDown)
      node.removeEventListener("pointermove", onPointerMove)
      node.removeEventListener("pointerup", onPointerUp)
      node.removeEventListener("pointercancel", onPointerCancel)
    },
  }
}
