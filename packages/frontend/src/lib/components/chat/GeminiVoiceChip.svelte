<script lang="ts">
/** GeminiVoiceChip — the Live voice (Gemini) as a compact chip (slice codex-voice-poc). */
import { GEMINI_VOICES } from "$lib/adapters/voice/voices-gemini"
import { getI18n, getSettings } from "$lib/context"
import VoiceChip from "./VoiceChip.svelte"

const settings = getSettings()
const t = getI18n().t
const options = GEMINI_VOICES.map((v) => ({ value: v.id, label: v.id, detail: t(v.descKey) }))
</script>

<VoiceChip
  value={settings.liveVoice}
  {options}
  ariaLabel={t("settings.liveVoice.label")}
  onchange={(v) => settings.setLiveVoice(v)}
/>
