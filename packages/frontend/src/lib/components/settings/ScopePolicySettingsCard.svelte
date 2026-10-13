<script lang="ts">
import type { ScopeAction, ScopePolicy } from "@drive-coding/core/schemas/scope-policy"
import { onMount } from "svelte"
import Select, { type SelectOption } from "$lib/components/ui/Select.svelte"
import { getI18n, getSettings } from "$lib/context"
import SettingsCard from "./SettingsCard.svelte"

const settings = getSettings()
const vm = settings.scopePolicy
const t = getI18n().t

const actions: ScopeAction[] = ["message", "update", "close"]

const policyOptions = $derived<SelectOption[]>([
  { value: "ask", label: t("settings.scopePolicy.option.ask") },
  { value: "allow", label: t("settings.scopePolicy.option.allow") },
  { value: "deny", label: t("settings.scopePolicy.option.deny") },
])

function labelKey(action: ScopeAction): string {
  if (action === "message") return "settings.scopePolicy.message"
  if (action === "update") return "settings.scopePolicy.update"
  return "settings.scopePolicy.close"
}

function currentValue(action: ScopeAction): ScopePolicy | "" {
  return vm.confirmed?.policies[action] ?? ""
}

onMount(() => {
  void vm.refresh()
})
</script>

<SettingsCard title={t("settings.scopePolicy.title")}>
  <p class="text-[12px] mb-3" style="color:var(--fg-muted)">{t("settings.scopePolicy.note")}</p>
  {#if vm.error}
    <p class="text-sm mb-2" role="alert" style="color:var(--recording)">{t("settings.scopePolicy.error")}</p>
  {/if}
  {#if vm.loading && !vm.confirmed}
    <p class="text-sm" style="color:var(--fg-dim)">{t("settings.scopePolicy.loading")}</p>
  {:else if vm.confirmed}
    {#each actions as action (action)}
      <label class="flex flex-col gap-1.5 mb-3">
        <span class="text-[13px]" style="color:var(--fg-dim)">{t(labelKey(action))}</span>
        {#key `${vm.readbackEpoch}-${action}`}
          <Select
            options={policyOptions}
            value={currentValue(action)}
            disabled={vm.loading || vm.saving}
            title={t(labelKey(action))}
            onchange={(v) => void vm.setPolicy(action, v as ScopePolicy)}
          />
        {/key}
      </label>
    {/each}
    {#if vm.saving}
      <p class="text-[12px]" style="color:var(--fg-muted)">{t("settings.scopePolicy.saving")}</p>
    {/if}
  {/if}
</SettingsCard>
