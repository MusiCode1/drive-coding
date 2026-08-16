<script lang="ts">
/**
 * VoicePicker — רכיב <select> חשוף שמחובר ל-Settings.voiceId.
 *
 * אגנוסטי לפריסה (Layout-agnostic): אב הרכיב עוטף אותו באיזו תווית / מיכל
 * שמתאימים לטופס שמסביב. בשימוש על ידי:
 *   - routes/+page.svelte (טופס התחברות, עם תווית בסגנון טופס)
 *
 * בעת טעינה (mount), מפעיל את `settings.loadVoices()` רק אם ElevenLabs זמין.
 * הזמינות נקבעת על ידי ttsCapabilities.caps (reactive). כשלון משאיר
 * את ה-voiceId הנוכחי כאפשרות חלופית (fallback) כדי שתהליך ה-TTS לא יישבר.
 *
 * ה-VM (View Model) מחזיק את הנתונים; הרכיב הזה הוא קצה (leaf) דק שקורא
 * וכותב שדה אחד בלבד — כך שני slices שנוגעים בו במקביל לא מתנגשים.
 *
 * Commit 3 (capability-gate): ה-$effect ריאקטיבי ל-caps; loadVoices נקרא רק כש-
 * caps ידוע + elevenlabs.available===true → 0 בקשות לספק לא-זמין.
 */
import { untrack } from "svelte"
import { getI18n, getSettings } from "$lib/context"
import { ttsCapabilities } from "$lib/view-models/capabilities.svelte"
import Select, { type SelectOption } from "$lib/components/ui/Select.svelte"

const settings = getSettings()
const t = getI18n().t

$effect(() => {
  // Commit 3 capability-gate: reactive על caps.
  // caps===undefined → עדיין loading → המתן (אל תקרא loadVoices).
  // caps.elevenlabs.available===false → ספק לא-זמין → 0 בקשות.
  // caps.elevenlabs.available===true → זמין → טען קולות (idempotent).
  //
  // חשוב: אין await כאן — loadVoices ב-untrack ממשיך להיות סינכרוני עד ה-await
  // הפנימי שלו, כלומר ה-loading guard (voicesLoading===true) נשאר שלם.
  // זה שומר על test-7 ("concurrent: 2 unawaited → invoked once").
  const caps = ttsCapabilities.caps // tracked → re-run כשmissions מתעדכן
  if (caps === undefined) return // עדיין loading → המתן
  if (caps.elevenlabs.available === false) return // לא-זמין → 0 בקשות
  untrack(() => void settings.loadVoices())
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
