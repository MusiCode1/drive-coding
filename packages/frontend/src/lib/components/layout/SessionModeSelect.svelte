<script lang="ts">
import type { SessionConfigOption, SessionModeState } from "@agentclientprotocol/sdk"
import Select from "$lib/components/ui/Select.svelte"
import { getI18n } from "$lib/context"
import {
  flattenSelectOptions,
  localizeConfigName,
  toSelectOptions,
} from "$lib/util/session-config-options"

let {
  configOptions,
  modes,
  onChange,
}: {
  configOptions: SessionConfigOption[]
  modes: SessionModeState | null
  onChange: (id: string, value: string) => void
} = $props()

const t = getI18n().t
const config = $derived(configOptions.find((option) => option.category === "mode"))
const label = $derived(
  config?.name ? localizeConfigName(config.name, t) : t("agentOptions.mode.label"),
)
const selector = $derived.by(() => {
  if (config?.type === "select") {
    return { id: config.id, value: config.currentValue, choices: flattenSelectOptions(config) }
  }
  if (config || !modes?.availableModes.length) return undefined
  return {
    id: "mode",
    value: modes.currentModeId,
    choices: modes.availableModes.map(({ id, name, description }) => ({
      value: id,
      name,
      description,
    })),
  }
})
</script>

{#if selector && selector.choices.length > 0}
  {@const { id, value, choices } = selector}
  <label class="flex flex-col gap-1 min-w-0">
    <span class="text-[11px] px-1" style="color:var(--fg-dim)">{label}</span>
    <Select {value} options={toSelectOptions(choices)} title={label} ariaLabel={label} onchange={(value) => onChange(id, value)} />
  </label>
{/if}
