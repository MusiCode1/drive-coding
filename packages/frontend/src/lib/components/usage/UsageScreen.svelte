<script lang="ts">
/**
 * UsageScreen — per-CLI usage table + TTS widget (slice usage-per-cli).
 */
import { onMount } from "svelte"
import { type CliUsageRow, fetchCliUsage } from "$lib/adapters/cli-usage"
import SettingsCard from "$lib/components/settings/SettingsCard.svelte"
import TtsStatusCard from "$lib/components/settings/TtsStatusCard.svelte"
import { getI18n } from "$lib/context"
import { ttsStatus } from "$lib/view-models/tts-status.svelte"
import CliUsageTable from "./CliUsageTable.svelte"

const t = getI18n().t
const locale = $derived(getI18n().locale)

let loading = $state(true)
let error = $state(false)
let rows = $state<CliUsageRow[]>([])

async function refresh() {
  loading = true
  error = false
  try {
    rows = await fetchCliUsage()
  } catch {
    rows = []
    error = true
  } finally {
    loading = false
  }
}

onMount(() => {
  void ttsStatus.refresh()
  void refresh()
})
</script>

<div class="flex flex-col gap-4 max-w-4xl mx-auto w-full pb-8">
  <div class="flex items-center justify-between gap-2">
    <h1 class="text-lg font-semibold" style="color:var(--fg)">{t("usage.page.title")}</h1>
    <button
      type="button"
      class="text-[12px] px-2 py-1 rounded-lg border"
      style="color:var(--fg-dim); border-color:var(--border)"
      onclick={() => refresh()}
      disabled={loading}
    >
      {loading ? t("usage.page.loading") : t("usage.page.refresh")}
    </button>
  </div>

  <SettingsCard title={t("settings.ttsStatus.title")}>
    <TtsStatusCard />
  </SettingsCard>

  <SettingsCard title={t("usage.clis.cardTitle")}>
    {#if error}
      <p class="text-sm" style="color:var(--fg-muted)">{t("usage.page.error")}</p>
    {:else if loading}
      <p class="text-sm" style="color:var(--fg-muted)">{t("usage.page.loading")}</p>
    {:else if rows.length === 0}
      <p class="text-sm" style="color:var(--fg-muted)">{t("usage.page.empty")}</p>
    {:else}
      <CliUsageTable {rows} locale={locale} />
    {/if}
  </SettingsCard>
</div>
