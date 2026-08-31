<script lang="ts">
/**
 * BottomSheet — sheet מובייל עם גרירה רציפה + 3 נקודות עצירה (peek/half/full).
 *
 * האצבע גוררת רציף; בשחרור — snap לנקודה הקרובה. קליק על הידית = peek↔full.
 * backdrop (מוצג כשלא-peek) = חזרה ל-peek.
 *
 * detents (גובה גלוי מלמטה):
 *   peek = 28px (רק הידית) · half = 45vh · full = 80vh.
 * הרקע/הצל/התוכן דוהים בהדרגה לפי הגובה הגלוי (לא קפיצה).
 *
 * ─── redesign-2 · detents: redesign-fix · peek clears the safe-area: mobile-parity ───
 */
import { getI18n, getResponsive, getUiShell } from "$lib/context"
import type { SheetDetent } from "$lib/view-models/ui-shell.svelte"
import { detentHeight } from "$lib/util/viewport-insets"
import SessionOptionsPanel from "./SessionOptionsPanel.svelte"

const uiShell = getUiShell()
const responsive = getResponsive()
const t = getI18n().t

const SHEET_VH = 0.8 // גובה ה-sheet עצמו = 80vh

// גובה החלון (reactive — מתעדכן ב-resize)
let winH = $state(typeof window !== "undefined" ? window.innerHeight : 800)
$effect(() => {
  const onResize = () => (winH = window.innerHeight)
  window.addEventListener("resize", onResize)
  return () => window.removeEventListener("resize", onResize)
})

const sheetPx = $derived(winH * SHEET_VH) // גובה ה-sheet בפיקסלים

/** גובה גלוי (px מלמטה) לכל detent. peek כולל את ה-safe-area (mobile-parity). */
function detentVisible(d: SheetDetent): number {
  return detentHeight(d, winH, sheetPx, responsive.safeBottomPx)
}
const PEEK_PX = $derived(detentVisible("peek"))

// הגובה הגלוי הנוכחי: בזמן גרירה — sheetDragPx; אחרת — לפי ה-detent.
const visiblePx = $derived(
  uiShell.sheetDragPx ?? detentVisible(uiShell.sheetDetent),
)

// openness: 0 ב-peek, 1 ב-full — לשימוש ב-backdrop (כהות הדרגתית).
const openness = $derived(
  Math.max(0, Math.min(1, (visiblePx - PEEK_PX) / (sheetPx - PEEK_PX))),
)

// fill: אטימות הרקע/צל/תוכן של ה-sheet עצמו. מגיע ל-1 כבר ב-half (לא ב-full),
// כך שב-detent האמצעי ה-sheet אטום ולא שקוף-למחצה. מתחיל שקוף ב-peek, אטום מ-half.
const halfPx = $derived(detentVisible("half"))
const fill = $derived(
  Math.max(0, Math.min(1, (visiblePx - PEEK_PX) / (halfPx - PEEK_PX))),
)

// ─── גרירה (משתני-עזר לא-ריאקטיביים — בלי $state) ───
let dragStartY = $state(0)
let dragStartVisible = $state(0)
let dragging = $state(false)

function onPointerDown(e: PointerEvent) {
  dragging = true
  dragStartY = e.clientY
  dragStartVisible = detentVisible(uiShell.sheetDetent)
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!dragging) return
  // גרירה כלפי מעלה (clientY יורד) → יותר גלוי
  const delta = dragStartY - e.clientY
  const next = Math.max(PEEK_PX, Math.min(sheetPx, dragStartVisible + delta))
  uiShell.sheetDragPx = next
}

function onPointerUp() {
  if (!dragging) return
  dragging = false
  const current = uiShell.sheetDragPx
  uiShell.sheetDragPx = null
  if (current === null) {
    // קליק (בלי תזוזה) → toggle
    uiShell.toggleSheet()
    return
  }
  // snap ל-detent הקרוב ביותר לפי הגובה הגלוי
  const detents: SheetDetent[] = ["peek", "half", "full"]
  let best: SheetDetent = "peek"
  let bestDist = Infinity
  for (const d of detents) {
    const dist = Math.abs(detentVisible(d) - current)
    if (dist < bestDist) {
      bestDist = dist
      best = d
    }
  }
  uiShell.setDetent(best)
}
</script>

<!-- backdrop — מוצג כשלא-peek (פתוח חלקית/מלא) -->
{#if uiShell.sheetOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-30 transition-opacity duration-200"
    style="background:rgba(0,0,0,{0.4 * openness})"
    onclick={() => uiShell.closeSheet()}
  ></div>
{/if}

<!-- sheet — גובה קבוע (full), ה-translateY קובע כמה גלוי. רקע/צל דוהים לפי openness. -->
<div
  class="fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl"
  class:transition-transform={!dragging}
  style="height:{sheetPx}px;
         transform:translateY({sheetPx - visiblePx}px);
         transition-duration:300ms;
         background:color-mix(in srgb, var(--bg-elev) {fill * 100}%, transparent);
         border-top:1px solid color-mix(in srgb, var(--border) {fill * 100}%, transparent);
         box-shadow:0 -8px 24px rgba(0,0,0,{0.35 * fill})"
>
  <!-- ידית גרירה -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="flex items-center justify-center py-2.5 shrink-0 cursor-grab touch-none"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    aria-label={t("sheet.handle")}
    role="button"
    tabindex="0"
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') uiShell.toggleSheet() }}
  >
    <div class="w-12 h-1.5 rounded-full" style="background:var(--border-str)"></div>
  </div>

  <!-- תוכן — דוהה לפי openness, ללא אינטראקציה כשכמעט-סגור.
       overflow-hidden: הגלילה מנוהלת בתוך SessionOptionsPanel (אזור גלילה מאוחד), לא כאן — מונע scroll כפול. -->
  <div
    class="flex flex-col gap-4 px-4 pt-2 flex-1 min-h-0 overflow-hidden"
    style="opacity:{fill}; pointer-events:{fill > 0.1 ? 'auto' : 'none'};
           padding-bottom:calc(1.5rem + var(--safe-b))"
  >
    <SessionOptionsPanel />
  </div>
</div>
