<script lang="ts">
/**
 * PalettePicker — בורר ערכת צבעים (chips).
 *
 * leaf component: קורא getTheme() מהקונטקסט, מציג chip לכל פלטה מ-PALETTES.
 * onclick מאציל ל-theme.setPalette (שמחיל data-palette על <html> + שומר ב-localStorage).
 * ריאקטיביות: theme.palette הוא $state ב-ThemeVM → ה-chip הפעיל מתעדכן אוטומטית.
 *
 * ─── palettes-expansion ───
 */
import { getTheme, getI18n } from "$lib/context"
import { PALETTES, type Palette } from "$lib/view-models/theme.svelte"

const theme = getTheme()
const t = $derived(getI18n().t)

// אימוג'י פר-פלטה (מ-#palette-bar במוקאפ; החדשות בעקביות)
const EMOJI: Record<Palette, string> = {
  ember: "🔥", forest: "🌲", plum: "🍇", teal: "🪸",
  midnight: "🌙", rose: "🌹", slate: "🪨", daylight: "☀️",
}
</script>

<div class="flex flex-wrap gap-2">
  {#each PALETTES as p (p)}
    <button
      onclick={() => theme.setPalette(p)}
      aria-pressed={theme.palette === p}
      class="px-3 py-1.5 rounded-full text-[13px] font-semibold border"
      style={theme.palette === p
        ? "background:var(--accent-soft); border-color:var(--accent); color:var(--fg)"
        : "background:var(--bg-card); border-color:var(--border); color:var(--fg-dim)"}
    >
      {EMOJI[p]} {t(`settings.theme.${p}`)}
    </button>
  {/each}
</div>
