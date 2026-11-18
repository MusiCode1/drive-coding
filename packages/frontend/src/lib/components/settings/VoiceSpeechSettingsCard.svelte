<script lang="ts">
import { onMount } from "svelte"
import type { ElevenLabsTtsModelId, GeminiTtsModelId } from "$lib/adapters/voice/tts-resolve"
import GeminiVoicePicker from "$lib/components/chat/GeminiVoicePicker.svelte"
import VoicePicker from "$lib/components/chat/VoicePicker.svelte"
import Select from "$lib/components/ui/Select.svelte"
import { getI18n, getSettings } from "$lib/context"
import { ttsCapabilities } from "$lib/view-models/capabilities.svelte"
import GeminiDirectingControls from "./GeminiDirectingControls.svelte"
import SettingsCard from "./SettingsCard.svelte"
import SettingToggle from "./SettingToggle.svelte"
import {
  applyTtsProviderFallback,
  buildElevenLabsModelOptions,
  buildGeminiModelOptions,
  buildTtsProviderOptions,
} from "./tts-speech-options"

interface Props {
  translateDisabled: boolean
  onSpeakThoughtsChange: (v: boolean) => void
}

const { translateDisabled, onSpeakThoughtsChange }: Props = $props()

const settings = getSettings()
const t = getI18n().t
const caps = $derived(ttsCapabilities.caps)
const ttsProviderOptions = $derived(buildTtsProviderOptions(t, caps))
const elevenModelOptions = $derived(buildElevenLabsModelOptions(t))
const geminiModelOptions = $derived(buildGeminiModelOptions(t))
const currentUnavailable = $derived(
  caps !== undefined && caps[settings.ttsProvider]?.available === false,
)
const allUnavailable = $derived(
  caps !== undefined &&
    caps["elevenlabs"]?.available === false &&
    caps["google"]?.available === false,
)

onMount(() => void ttsCapabilities.refresh())
$effect(() => applyTtsProviderFallback(caps, settings.ttsProvider, settings.setTtsProvider))
</script>

<SettingsCard title={t("settings.voiceSpeech")}>
  <label class="flex flex-col gap-1.5">
    <span class="text-[13px]" style="color:var(--fg-dim)">{t("settings.ttsProvider.label")}</span>
    <Select
      options={ttsProviderOptions}
      value={settings.ttsProvider}
      title={t("settings.ttsProvider.label")}
      onchange={(v) => settings.setTtsProvider(v as "elevenlabs" | "google")}
    />
    {#if allUnavailable}
      <span class="text-[12px]" style="color:var(--recording)">{t("settings.ttsProvider.allUnavailable")}</span>
    {:else if currentUnavailable}
      <span class="text-[12px]" style="color:var(--accent)">{t("settings.ttsProvider.fallbackNotice")}</span>
    {/if}
  </label>

  <label class="flex flex-col gap-1.5">
    <span class="text-[13px]" style="color:var(--fg-dim)">{t("settings.ttsModel.label")}</span>
    {#if settings.ttsProvider === "elevenlabs"}
      <Select
        options={elevenModelOptions}
        value={settings.elevenLabsModelId}
        title={t("settings.ttsModel.label")}
        onchange={(v) => settings.setElevenLabsModelId(v as ElevenLabsTtsModelId)}
      />
    {:else}
      <Select
        options={geminiModelOptions}
        value={settings.geminiModelId}
        title={t("settings.ttsModel.label")}
        onchange={(v) => settings.setGeminiModelId(v as GeminiTtsModelId)}
      />
    {/if}
  </label>

  {#if settings.ttsProvider === "elevenlabs"}
    <label class="flex flex-col gap-1.5">
      <span class="text-[13px]" style="color:var(--fg-dim)">{t("settings.voice.label")}</span>
      <VoicePicker />
    </label>
  {:else if settings.ttsProvider === "google"}
    <label class="flex flex-col gap-1.5">
      <span class="text-[13px]" style="color:var(--fg-dim)">{t("settings.geminiVoice.label")}</span>
      <GeminiVoicePicker />
    </label>
    <GeminiDirectingControls />
  {/if}

  <div class="flex flex-col divide-y" style="border-color:var(--border)">
    <SettingToggle
      label={t("settings.toggle.speakThoughts")}
      checked={settings.speakThoughts}
      onCheckedChange={onSpeakThoughtsChange}
    />
    <SettingToggle
      label={t("settings.toggle.narrateTools")}
      checked={settings.narrateTools}
      onCheckedChange={(v) => settings.setNarrateTools(v)}
    />
    <SettingToggle
      label={t("settings.toggle.translateThoughts")}
      checked={settings.translateThoughts}
      onCheckedChange={(v) => settings.setTranslateThoughts(v)}
      disabled={translateDisabled}
    />
    <SettingToggle
      label={t("settings.toggle.carMode")}
      checked={settings.carMode}
      onCheckedChange={(v) => settings.setCarMode(v)}
      disabled
    />
  </div>
</SettingsCard>
