<script lang="ts">
/**
 * VoicePicker — רכיב <select> חשוף שמחובר ל-Settings.voiceId.
 *
 * אגנוסטי לפריסה (Layout-agnostic): אב הרכיב עוטף אותו באיזו תווית / מיכל
 * שמתאימים לטופס שמסביב. בשימוש על ידי:
 *   - routes/+page.svelte (טופס התחברות, עם תווית בסגנון טופס)
 *
 * בעת טעינה (mount), מפעיל את `settings.loadVoices()` (אידמפוטנטי). כשלון משאיר
 * את ה-voiceId הנוכחי כאפשרות חלופית (fallback) כדי שתהליך ה-TTS לא יישבר.
 *
 * לפי parallel-safe-code.md, ה-VM (View Model) מחזיק את הנתונים; הרכיב הזה
 * הוא קצה (leaf) דק שקורא + כותב שדה אחד בלבד.
 */
import { getI18n, getSettings } from "$lib/context"
import Select, { type SelectOption } from "$lib/components/ui/Select.svelte"

const settings = getSettings()
const t = getI18n().t

$effect(() => {
  // אידמפוטנטי — מוגן בתוך Settings.loadVoices.
  void settings.loadVoices()
})

const hasVoices = $derived(settings.availableVoices.length > 0)

// אפשרויות ל-Select. כשהקטלוג ריק — אפשרות יחידה עם ה-voiceId הנוכחי (fallback),
// כדי שתהליך ה-TTS לא יישבר ול-Select תמיד יהיה ערך תקף.
const voiceOptions = $derived<SelectOption[]>(
  hasVoices
    ? settings.availableVoices.map((v) => ({ value: v.voice_id, label: v.name }))
    : [
        {
          value: settings.voiceId,
          label: settings.voicesLoading
            ? t("chat.voicePicker.loading")
            : settings.voicesError !== null
              ? t("chat.voicePicker.error")
              : settings.voiceId,
        },
      ],
)
</script>

<Select
  value={settings.voiceId}
  options={voiceOptions}
  title={t("chat.voicePicker.label")}
  ariaLabel={t("chat.voicePicker.label")}
  disabled={settings.voicesLoading && !hasVoices}
  onchange={(v) => settings.setVoiceId(v)}
/>
