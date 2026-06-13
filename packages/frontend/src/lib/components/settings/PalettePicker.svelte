<script lang="ts">
/**
 * PalettePicker — בורר ערכת צבעים (Select).
 *
 * leaf component: קורא getTheme() מהקונטקסט, עוטף את Select עם פריט לכל פלטה מ-PALETTES.
 * onchange מאציל ל-theme.setPalette (שמחיל data-palette על <html> + שומר ב-localStorage).
 * ריאקטיביות: theme.palette הוא $state ב-ThemeVM → value מתעדכן אוטומטית.
 *
 * ─── palettes-expansion · palette-select ───
 */
import { getTheme, getI18n } from "$lib/context"
import { PALETTES, type Palette } from "$lib/view-models/theme.svelte"
import Select from "$lib/components/ui/Select.svelte"

const theme = getTheme()
const t = $derived(getI18n().t)

// אימוג'י פר-פלטה (מ-#palette-bar במוקאפ; החדשות בעקביות)
const EMOJI: Record<Palette, string> = {
  ember: "🔥", forest: "🌲", plum: "🍇", teal: "🪸",
  midnight: "🌙", rose: "🌹", slate: "🪨", daylight: "☀️",
}

const options = $derived(
  PALETTES.map((p) => ({ value: p, label: `${EMOJI[p]} ${t(`settings.theme.${p}`)}` })),
)
</script>

<Select
  value={theme.palette}
  options={options}
  title={t("settings.theme.label")}
  onchange={(v) => theme.setPalette(v as Palette)}
/>
