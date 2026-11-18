<script lang="ts">
/**
 * AgentVoicePicker — voice of the agent's built-in Live (slice codex-voice-poc).
 * Same <Select> as GeminiVoicePicker; the list comes from the provider (`_drive/voice/listVoices`).
 */

import Select, { type SelectOption } from "$lib/components/ui/Select.svelte"
import { getAgentVoice, getI18n } from "$lib/context"

const agentVoice = getAgentVoice()
const t = getI18n().t

const options: SelectOption[] = $derived(
  agentVoice.voices.map((id) => ({
    value: id,
    label: id,
    description: id === agentVoice.defaultVoice ? t("agentVoice.defaultVoice") : null,
  })),
)
</script>

<Select
  value={agentVoice.effectiveVoice ?? ""}
  {options}
  title={t("settings.liveVoice.label")}
  ariaLabel={t("settings.liveVoice.label")}
  disabled={options.length === 0}
  onchange={(v) => agentVoice.setVoice(v)}
/>
