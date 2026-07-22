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

<!-- itemAlign="center": בורר-השפה הוא חריג — he/en מעורבב-כיוון, לכן יישור-מרכז שרירותי
     (per-content לא הגיוני כאן). ר' Select.svelte prop itemAlign. -->
<Select
  value={i18n.locale}
  options={[
    { value: "he", label: t("settings.language.he") },
    { value: "en", label: t("settings.language.en") },
  ]}
  title={t("settings.language.label")}
  itemAlign="center"
  onchange={(v) => i18n.setLocale(v as Locale)}
/>
