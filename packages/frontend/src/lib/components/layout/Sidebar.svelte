<script lang="ts">
/**
 * Sidebar — aside דסקטופ (w-72).
 * עוטף SessionOptionsPanel. collapse ע"י UiShellVM.sidebarCollapsed.
 *
 * ─── redesign-2 ───
 */
import ChevronRightIcon from "@lucide/svelte/icons/chevron-right"
import { getI18n, getUiShell } from "$lib/context"
import SessionOptionsPanel from "./SessionOptionsPanel.svelte"

const uiShell = getUiShell()
const t = getI18n().t
</script>

<aside
  class="flex flex-col shrink-0 border-s overflow-hidden transition-all duration-300 pt-16 pb-4 px-3 gap-4"
  style="border-color:var(--border); background:var(--bg-elev); width:{uiShell.sidebarCollapsed ? '0' : '18rem'}; opacity:{uiShell.sidebarCollapsed ? '0' : '1'}; padding:{uiShell.sidebarCollapsed ? '0' : undefined}"
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
</aside>
