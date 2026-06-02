<script lang="ts">
/**
 * BottomSheet — sheet מובייל נגרר (peek → open).
 * גרירה על הידית: pointer events. לחיצה על הידית = toggle. backdrop = סגירה.
 *
 * peek = 60px. open = 80vh.
 * z-index: backdrop z-30, sheet z-40 (מוקאפ).
 *
 * ─── redesign-2 ───
 */
import { getI18n, getUiShell } from "$lib/context"
import SessionOptionsPanel from "./SessionOptionsPanel.svelte"

const uiShell = getUiShell()
const t = getI18n().t

// גרירה
let dragStartY = 0
let dragStartOpen = false

function onPointerDown(e: PointerEvent) {
  dragStartY = e.clientY
  dragStartOpen = uiShell.sheetOpen
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onPointerUp(e: PointerEvent) {
  const deltaY = e.clientY - dragStartY
  // גרירה כלפי מעלה >= 30px → פתח; כלפי מטה >= 30px → סגור
  if (deltaY < -30) {
    uiShell.openSheet()
  } else if (deltaY > 30) {
    uiShell.closeSheet()
  } else {
    // קליק (תזוזה קטנה) → toggle
    uiShell.toggleSheet()
  }
}
</script>

<!-- backdrop — מוצג רק כשפתוח -->
{#if uiShell.sheetOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-30"
    style="background:rgba(0,0,0,0.4)"
    onclick={() => uiShell.closeSheet()}
  ></div>
{/if}

<!-- sheet עצמו -->
<div
  class="fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl transition-transform duration-300"
  style="background:var(--bg-elev); border-top:1px solid var(--border);
         height:80vh;
         transform:translateY({uiShell.sheetOpen ? '0' : 'calc(80vh - 60px)'})"
>
  <!-- ידית גרירה -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="flex items-center justify-center pt-3 pb-2 shrink-0 cursor-grab touch-none"
    onpointerdown={onPointerDown}
    onpointerup={onPointerUp}
    aria-label={t("sheet.handle")}
    role="button"
    tabindex="0"
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') uiShell.toggleSheet() }}
  >
    <div class="w-10 h-1 rounded-full" style="background:var(--border)"></div>
  </div>

  <!-- תוכן -->
  <div class="flex flex-col gap-4 px-4 pt-2 pb-6 flex-1 min-h-0 overflow-y-auto">
    <SessionOptionsPanel />
  </div>
</div>
