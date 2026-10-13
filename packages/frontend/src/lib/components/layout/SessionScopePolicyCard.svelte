<script lang="ts">
import type { MessageKey } from "@drive-coding/core/i18n"
import type { ScopeAction, ScopePolicySource } from "@drive-coding/core/schemas/scope-policy"
import Select, { type SelectOption } from "$lib/components/ui/Select.svelte"
import { getI18n, getSessionScopePolicy } from "$lib/context"
import {
  SCOPE_POLICY_INHERIT,
  type ScopePolicySelectValue,
} from "$lib/view-models/session-scope-policy.svelte"

const vm = getSessionScopePolicy()
const t = getI18n().t

const actions: ScopeAction[] = ["message", "update", "close"]

const actionLabelKeys: Record<ScopeAction, MessageKey> = {
  message: "session.scopePolicy.message",
  update: "session.scopePolicy.update",
  close: "session.scopePolicy.close",
}

const sourceLabelKeys: Record<ScopePolicySource, MessageKey> = {
  agent: "session.scopePolicy.source.agent",
  override: "session.scopePolicy.source.override",
  env: "session.scopePolicy.source.env",
  default: "session.scopePolicy.source.default",
}

const policyOptions = $derived<SelectOption[]>([
  { value: SCOPE_POLICY_INHERIT, label: t("session.scopePolicy.option.inherit") },
  { value: "ask", label: t("settings.scopePolicy.option.ask") },
  { value: "allow", label: t("settings.scopePolicy.option.allow") },
  { value: "deny", label: t("settings.scopePolicy.option.deny") },
])

function onSelect(action: ScopeAction, value: string): void {
  void vm.setPolicy(action, value as ScopePolicySelectValue)
}
</script>

<div class="flex flex-col gap-2 shrink-0 rounded-lg border px-3 py-3" style="border-color:var(--border)">
  <div class="text-[11px] font-semibold uppercase tracking-wider px-0.5" style="color:var(--fg-dim)">
    {t("session.scopePolicy.title")}
  </div>
  <p class="text-[12px] m-0" style="color:var(--fg-muted)">{t("session.scopePolicy.note")}</p>
  {#if vm.error}
    <p class="text-sm m-0" role="alert" style="color:var(--recording)">{t("session.scopePolicy.error")}</p>
  {/if}
  {#if vm.loading && !vm.confirmed}
    <p class="text-sm m-0" style="color:var(--fg-dim)">{t("session.scopePolicy.loading")}</p>
  {:else if vm.confirmed}
    {#each actions as action (action)}
      <label class="flex flex-col gap-1.5">
        <span class="text-[13px]" style="color:var(--fg-dim)">{t(actionLabelKeys[action])}</span>
        {#key `${vm.readbackEpoch}-${action}`}
          <Select
            options={policyOptions}
            value={vm.selectValue(action)}
            disabled={vm.loading || vm.saving}
            title={t(actionLabelKeys[action])}
            onchange={(v) => onSelect(action, v)}
          />
        {/key}
        {#if vm.effectiveSource(action)}
          {@const src = vm.effectiveSource(action)!}
          <span class="text-[11px] px-0.5" style="color:var(--fg-muted)">
            {t("session.scopePolicy.sourceLabel")}: {t(sourceLabelKeys[src])}
          </span>
        {/if}
      </label>
    {/each}
    {#if vm.saving}
      <p class="text-[12px] m-0" style="color:var(--fg-muted)">{t("session.scopePolicy.saving")}</p>
    {/if}
  {:else if !vm.error}
    <p class="text-sm m-0" style="color:var(--fg-dim)">{t("session.scopePolicy.empty")}</p>
  {/if}
  {#if !vm.confirmed && !vm.loading}
    <button
      type="button"
      class="text-sm font-medium self-start"
      style="color:var(--accent)"
      onclick={() => void vm.refresh()}
    >
      {t("session.scopePolicy.retry")}
    </button>
  {/if}
</div>
