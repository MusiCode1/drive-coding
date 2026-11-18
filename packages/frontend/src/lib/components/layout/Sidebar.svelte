<script lang="ts">
/**
 * Sidebar — aside דסקטופ (resizable, default 18rem).
 * עוטף SessionOptionsPanel. collapse ע"י UiShellVM.sidebarCollapsed.
 *
 * ─── redesign-2 ───
 * ─── sidebar-resize ───
 */
import ChevronRightIcon from "@lucide/svelte/icons/chevron-right"
import { onMount } from "svelte"
import { getI18n, getSettings, getUiShell } from "$lib/context"
import {
  clampSidebarWidth,
  MAX_REM,
  MIN_REM,
  pxToRem,
  remToPx,
  sidebarResizeSign,
} from "$lib/util/sidebar-width"
import { resizeDrag } from "$lib/util/resize-drag"
import SessionOptionsPanel from "./SessionOptionsPanel.svelte"

const uiShell = getUiShell()
const settings = getSettings()
const i18n = getI18n()
const t = i18n.t

let dragWidthRem = $state<number | null>(null)
let dragging = $state(false)
let rootFontSizePx = $state(16)

const displayWidthRem = $derived(
  clampSidebarWidth(dragWidthRem ?? settings.sidebarWidthRem),
)

function rootFontSize(): number {
  if (typeof document === "undefined") return rootFontSizePx
  const px = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(px) && px > 0 ? px : rootFontSizePx
}

function sidebarBoundsPx(): { min: number; max: number } {
  const fontPx = rootFontSize()
  return {
    min: remToPx(MIN_REM, fontPx),
    max: remToPx(MAX_REM, fontPx),
  }
}

onMount(() => {
  rootFontSizePx = rootFontSize()
})
</script>

<aside
  class="sidebar-aside flex flex-col shrink-0 border-s overflow-hidden pt-16 pb-4 px-3 gap-4"
  class:sidebar-aside--dragging={dragging}
  class:sidebar-aside--animating={!dragging}
  style="border-color:var(--border); background:var(--bg-elev); width:{uiShell.sidebarCollapsed ? '0' : `${displayWidthRem}rem`}; opacity:{uiShell.sidebarCollapsed ? '0' : '1'}; padding:{uiShell.sidebarCollapsed ? '0' : undefined}"
  aria-hidden={uiShell.sidebarCollapsed}
>
  <!-- כפתור קיפול -->
  <div class="flex items-center justify-end shrink-0">
    <button
      class="size-7 grid place-items-center rounded-lg"
      style="color:var(--fg-dim)"
      onclick={() => uiShell.toggleSidebar()}
      title={t("sidebar.collapse")}
      aria-label={t("sidebar.collapse")}
    >
      <ChevronRightIcon size={16} strokeWidth={2} />
    </button>
  </div>

  <SessionOptionsPanel />

  {#if !uiShell.sidebarCollapsed}
    <div
      class="resize-handle"
      use:resizeDrag={{
        axis: "x",
        deltaSign: sidebarResizeSign(i18n.dir),
        min: sidebarBoundsPx().min,
        max: () => sidebarBoundsPx().max,
        getStart: () => remToPx(displayWidthRem, rootFontSize()),
        onMove: (px) => {
          dragging = true
          dragWidthRem = pxToRem(px, rootFontSize())
        },
        onEnd: (px) => {
          settings.setSidebarWidthRem(pxToRem(px, rootFontSize()))
          dragWidthRem = null
          dragging = false
        },
      }}
      role="separator"
      aria-orientation="vertical"
      aria-label={t("sidebar.resizeHandle")}
    ></div>
  {/if}
</aside>

<style>
  .sidebar-aside {
    position: relative;
  }

  .sidebar-aside--animating {
    transition: all 300ms;
  }

  .sidebar-aside--dragging {
    transition: opacity 300ms, padding 300ms;
  }

  .resize-handle {
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    width: 6px;
    cursor: ew-resize;
    touch-action: none;
    z-index: 1;
  }

  .resize-handle::after {
    content: "";
    position: absolute;
    inset-block: 40%;
    inset-inline-start: 50%;
    width: 3px;
    transform: translateX(-50%);
    border-radius: 2px;
    background: var(--border-str);
    transition: background 0.15s;
  }

  :global([dir="rtl"]) .resize-handle::after {
    transform: translateX(50%);
  }

  .resize-handle:hover::after,
  .resize-handle:active::after {
    background: var(--accent);
  }
</style>
