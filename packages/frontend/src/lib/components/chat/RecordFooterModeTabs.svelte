<script lang="ts">
import type { MessageKey } from "@drive-coding/core/i18n"
import EyeOffIcon from "@lucide/svelte/icons/eye-off"
import KeyboardIcon from "@lucide/svelte/icons/keyboard"
import MicIcon from "@lucide/svelte/icons/mic"
import RadioIcon from "@lucide/svelte/icons/radio"
import type { Component } from "svelte"
import { getI18n, getLive, getResponsive, getSettings, getUiShell } from "$lib/context"
import type { InputMode } from "$lib/view-models/ui-shell.svelte"

const t = getI18n().t
const responsive = getResponsive()
const uiShell = getUiShell()
const live = getLive()
const settings = getSettings()

/** Hug-content pill. Mobile = icon-only + ≥44px tap; desktop = icon+label. */
const MODE_TABS: ReadonlyArray<{
  mode: InputMode
  labelKey: MessageKey
  Icon: Component<{ size?: number; strokeWidth?: number }>
}> = [
  { mode: "record", labelKey: "record.tab.record", Icon: MicIcon },
  { mode: "typing", labelKey: "record.tab.type", Icon: KeyboardIcon },
  { mode: "live", labelKey: "record.tab.live", Icon: RadioIcon },
  { mode: "hidden", labelKey: "record.tab.hide", Icon: EyeOffIcon },
]

const tabIconSize = $derived(responsive.isMobile ? 22 : 13)
function switchInputMode(mode: InputMode): void {
  if (uiShell.inputMode === "live" && mode !== "live" && live.isOpen) {
    void live.toggle()
  }
  uiShell.setInputMode(mode)
  settings.setInputMode(mode)
}
</script>

<!-- mode toggle: כדורית hug-content (לא רוחב-מסך). מובייל = אייקון בלבד + יעד ≥44px. -->
<div
  class="mode-tabs inline-flex items-center gap-1 p-1 rounded-full text-xs"
  style="background:var(--bg-card)"
>
  {#each MODE_TABS as tab (tab.mode)}
    {@const label = t(tab.labelKey)}
    <button
      type="button"
      class="mode-tab inline-flex items-center justify-center gap-1.5 rounded-full font-semibold transition-all"
      class:mode-tab--mobile={responsive.isMobile}
      style={uiShell.inputMode === tab.mode
        ? "background:var(--accent); color:white"
        : "color:var(--fg-dim)"}
      onclick={() => switchInputMode(tab.mode)}
      aria-label={label}
      aria-pressed={uiShell.inputMode === tab.mode}
    >
      <tab.Icon size={tabIconSize} strokeWidth={2} />
      {#if !responsive.isMobile}
        {label}
      {/if}
    </button>
  {/each}
</div>

<style>
  /* דסקטופ: אייקון + תווית (כמו לפני live-input-mode). */
  .mode-tab {
    padding: 0.375rem 1rem; /* py-1.5 px-4 */
  }

  /* מובייל: אייקון בלבד, יעד לחיצה ≥44×44 (HIG) — הכדורית נשארת hug-content. */
  .mode-tab--mobile {
    min-width: 44px;
    min-height: 44px;
    padding: 0;
  }
</style>
