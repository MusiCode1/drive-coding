<script lang="ts">
/**
 * AgentVoicePicker — voice of the agent's built-in Live, as a compact chip whose popup lists the
 * voices with a sample button each (slice codex-voice-poc). The list and per-voice details
 * (accent, description, sample) come from the provider (`_drive/voice/listVoices`).
 */
import { getAgentVoice, getI18n } from "$lib/context"
import VoiceChip from "./VoiceChip.svelte"

const agentVoice = getAgentVoice()
const t = getI18n().t

const options = $derived(
  agentVoice.voices.map((id) => {
    const d = agentVoice.voiceDetails[id]
    const isDefault = id === agentVoice.defaultVoice ? t("agentVoice.defaultVoice") : undefined
    const detail = [d?.accent, d?.description, isDefault].filter(Boolean).join(" · ")
    return { value: id, label: id, sample: !!d?.previewUrl, ...(detail ? { detail } : {}) }
  }),
)
</script>

<VoiceChip
  value={agentVoice.effectiveVoice ?? ""}
  {options}
  ariaLabel={t("settings.liveVoice.label")}
  disabled={options.length === 0}
  previewing={agentVoice.previewing}
  previewError={agentVoice.previewError}
  onchange={(v) => agentVoice.setVoice(v)}
  onPreview={(v) => agentVoice.togglePreview(v)}
  onPreviewStop={() => agentVoice.stopPreview()}
/>
