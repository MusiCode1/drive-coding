<script lang="ts">
/**
 * LanguageSelect — בורר שפת ממשק (he / en).
 *
 * leaf component: קורא getI18n() מהקונטקסט, מציג Select עם 2 אפשרויות.
 * ה-onchange מאציל ל-i18n.setLocale (שמאציל ל-Settings → נשמר ב-localStorage).
 * ריאקטיביות: value={i18n.locale} — מגיב אוטומטית לשינויי locale.
 *
 * ─── rtl-ltr-bidi ───
 */
import type { Locale } from "@drive-coding/core/i18n"
import Select from "$lib/components/ui/Select.svelte"
import { getI18n } from "$lib/context"

const i18n = getI18n()
const t = $derived(i18n.t)
</script>

<Select
  value={i18n.locale}
  options={[
    { value: "he", label: t("settings.language.he") },
    { value: "en", label: t("settings.language.en") },
  ]}
  title={t("settings.language.label")}
  onchange={(v) => i18n.setLocale(v as Locale)}
/>
