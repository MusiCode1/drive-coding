<script lang="ts">
  import Select from "$lib/components/ui/Select.svelte"
  import { getAudioDevices, getI18n, getSettings } from "$lib/context"
  import SettingsCard from "./SettingsCard.svelte"

  const audioDevices = getAudioDevices()
  const settings = getSettings()
  const t = getI18n().t

  const selectValue = $derived(audioDevices.effectiveInputId ?? "")

  const preferenceMissing = $derived(
    settings.inputDeviceId !== null &&
      settings.inputDeviceId !== "" &&
      audioDevices.effectiveInputId === null &&
      !audioDevices.loading,
  )

  function deviceLabel(d: MediaDeviceInfo): string {
    const name = d.label.trim()
    return name.length > 0 ? name : d.deviceId.slice(0, 8)
  }
</script>

<SettingsCard title={t("settings.inputDevice.label")}>
  {#if audioDevices.inputs.length <= 1}
    <p class="text-sm" style="color:var(--fg-dim)">{t("settings.inputDevice.single")}</p>
  {/if}

  <label class="flex flex-col gap-1.5">
    <Select
      options={[
        { value: "", label: t("settings.inputDevice.default") },
        ...audioDevices.inputs.map((d) => ({
          value: d.deviceId,
          label: deviceLabel(d),
        })),
      ]}
      value={selectValue}
      title={t("settings.inputDevice.label")}
      onchange={(v) => audioDevices.select(v === "" ? null : v)}
    />
  </label>

  {#if preferenceMissing}
    <p class="text-sm mt-2" role="status" style="color:var(--accent)">
      {t("settings.inputDevice.missing")}
      {#if settings.inputDeviceLabel}
        ({settings.inputDeviceLabel})
      {/if}
    </p>
  {/if}

  {#if audioDevices.needsPermissionForLabels}
    <button
      type="button"
      class="text-sm font-medium mt-2"
      style="color:var(--accent)"
      onclick={() => void audioDevices.primeLabels()}
    >
      {t("settings.inputDevice.grantLabels")}
    </button>
  {/if}

  <button
    type="button"
    class="text-sm font-medium mt-2"
    style="color:var(--fg-dim)"
    onclick={() => void audioDevices.refresh()}
  >
    {t("settings.inputDevice.refresh")}
  </button>
</SettingsCard>
