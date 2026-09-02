<script lang="ts">
/**
 * DisplayOptionsRow — compact-activity + show thoughts/tools toggles (slice compact-activity).
 * When Clean reading is on, thoughts/tools toggles do nothing to the grouped
 * row — disable them so the pressed state cannot lie.
 */
import BrainIcon from "@lucide/svelte/icons/brain"
import ListCollapseIcon from "@lucide/svelte/icons/list-collapse"
import WrenchIcon from "@lucide/svelte/icons/wrench"
import { getI18n, getSettings } from "$lib/context"

const t = getI18n().t
const settings = getSettings()
const compactOn = $derived(settings.compactActivity)
</script>

<div class="flex flex-col gap-1.5 shrink-0">
  <div class="text-[11px] font-semibold uppercase tracking-wider px-1" style="color:var(--fg-dim)">
    {t("sidebar.display")}
  </div>
  <div class="flex gap-2">
    <button
      type="button"
      class="flex-1 flex items-center justify-center gap-2 px-2.5 py-2 rounded-lg text-[13px] border min-h-11"
      style="border-color:var(--border); color:{compactOn ? 'var(--accent)' : 'var(--fg-dim)'}"
      onclick={() => settings.setCompactActivity(!settings.compactActivity)}
      aria-pressed={settings.compactActivity}
      aria-label={t("settings.toggle.compactActivity")}
      title={t("settings.toggle.compactActivity")}
    >
      <ListCollapseIcon size={16} strokeWidth={1.75} />
    </button>
    <button
      type="button"
      class="flex-1 flex items-center justify-center gap-2 px-2.5 py-2 rounded-lg text-[13px] border min-h-11 disabled:opacity-40 disabled:cursor-not-allowed"
      style="border-color:var(--border); color:{settings.showThoughts ? 'var(--accent)' : 'var(--fg-dim)'}"
      onclick={() => settings.setShowThoughts(!settings.showThoughts)}
      disabled={compactOn}
      aria-pressed={settings.showThoughts}
      aria-label={t("settings.toggle.showThoughts")}
      title={t("settings.toggle.showThoughts")}
    >
      <BrainIcon size={16} strokeWidth={1.75} />
    </button>
    <button
      type="button"
      class="flex-1 flex items-center justify-center gap-2 px-2.5 py-2 rounded-lg text-[13px] border min-h-11 disabled:opacity-40 disabled:cursor-not-allowed"
      style="border-color:var(--border); color:{settings.showTools ? 'var(--accent)' : 'var(--fg-dim)'}"
      onclick={() => settings.setShowTools(!settings.showTools)}
      disabled={compactOn}
      aria-pressed={settings.showTools}
      aria-label={t("settings.toggle.showTools")}
      title={t("settings.toggle.showTools")}
    >
      <WrenchIcon size={16} strokeWidth={1.75} />
    </button>
  </div>
</div>
