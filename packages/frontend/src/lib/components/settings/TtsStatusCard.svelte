<script lang="ts">
/**
 * TtsStatusCard — displays TTS provider status, quota, and usage totals.
 *
 * Slice: tts-status-ui, Commit 1.
 *
 * Data sources:
 *   - ttsCapabilities.caps  → reason (why a provider is unavailable)
 *   - ttsStatus.subscription → ElevenLabs quota (character_count / character_limit)
 *   - ttsStatus.usage        → per-provider usage totals + cost
 *
 * All fields are optional; missing data → "—", never crashes.
 */

import { getI18n } from "$lib/context"
import { ttsCapabilities } from "$lib/view-models/capabilities.svelte"
import { ttsStatus } from "$lib/view-models/tts-status.svelte"
import type { ProbeReason } from "@drive-coding/core/tts/probe-status"

const t = getI18n().t

// Map a ProbeReason to an i18n key
function reasonKey(reason: ProbeReason | undefined): string {
  switch (reason) {
    case "quota":
      return t("settings.ttsStatus.reason.quota")
    case "no-key":
      return t("settings.ttsStatus.reason.noKey")
    case "forbidden":
      return t("settings.ttsStatus.reason.forbidden")
    case "error":
      return t("settings.ttsStatus.reason.error")
    default:
      return ""
  }
}

// Format cost: $X.XXXX
function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`
}

// Derived: ElevenLabs caps
const elCaps = $derived(ttsCapabilities.caps?.elevenlabs)
const goCaps = $derived(ttsCapabilities.caps?.google)

// Derived: subscription quota
const sub = $derived(ttsStatus.subscription)
const quotaExhausted = $derived(
  sub !== undefined && sub.characterLimit > 0 && sub.characterCount >= sub.characterLimit,
)
const quotaPercent = $derived(
  sub && sub.characterLimit > 0
    ? Math.min((sub.characterCount / sub.characterLimit) * 100, 100)
    : 0,
)

// Derived: usage
const usageEl = $derived(ttsStatus.usage?.elevenlabs)
const usageGo = $derived(ttsStatus.usage?.google)
</script>

<div class="flex flex-col gap-3 text-sm">
  <!-- Refresh button -->
  <div class="flex justify-end">
    <button
      class="text-[12px] px-2 py-1 rounded-lg border"
      style="color:var(--fg-dim); border-color:var(--border); background:var(--bg-card)"
      onclick={() => ttsStatus.refresh()}
      disabled={ttsStatus.loading}
    >
      {ttsStatus.loading ? t("settings.ttsStatus.loading") : t("settings.ttsStatus.refresh")}
    </button>
  </div>

  <!-- Provider availability: show only unavailable providers -->
  {#if elCaps && !elCaps.available}
    <div class="flex items-start gap-2 rounded-xl p-2" style="background:var(--bg-card)">
      <span class="text-[11px] font-semibold uppercase tracking-wide" style="color:var(--fg-muted)">
        ElevenLabs
      </span>
      <span class="text-[12px]" style="color:var(--recording)">
        {reasonKey(elCaps.reason)}
      </span>
    </div>
  {/if}
  {#if goCaps && !goCaps.available}
    <div class="flex items-start gap-2 rounded-xl p-2" style="background:var(--bg-card)">
      <span class="text-[11px] font-semibold uppercase tracking-wide" style="color:var(--fg-muted)">
        Gemini
      </span>
      <span class="text-[12px]" style="color:var(--recording)">
        {reasonKey(goCaps.reason)}
      </span>
    </div>
  {/if}

  <!-- ElevenLabs quota -->
  <div class="flex flex-col gap-1.5">
    <span class="text-[11px] font-semibold uppercase tracking-wide" style="color:var(--fg-muted)">
      {t("settings.ttsStatus.quota.label")}
    </span>
    {#if sub !== undefined}
      <div class="flex items-center gap-2">
        <span
          class="text-[13px] font-mono"
          style="color:{quotaExhausted ? 'var(--recording)' : 'var(--fg)'}"
        >
          {sub.characterCount.toLocaleString()} / {sub.characterLimit.toLocaleString()}
        </span>
        {#if quotaExhausted}
          <span class="text-[11px]" style="color:var(--recording)">
            {t("settings.ttsStatus.quota.exhausted")}
          </span>
        {/if}
      </div>
      <!-- Progress bar -->
      <div class="h-1.5 rounded-full overflow-hidden" style="background:var(--border)">
        <div
          class="h-full rounded-full transition-all"
          style="width:{quotaPercent}%; background:{quotaExhausted ? 'var(--recording)' : 'var(--accent)'}"
        ></div>
      </div>
    {:else}
      <span class="text-[13px]" style="color:var(--fg-muted)">
        {t("settings.ttsStatus.usage.notAvailable")}
      </span>
    {/if}
  </div>

  <!-- Usage totals -->
  <div class="flex flex-col gap-1.5">
    <span class="text-[11px] font-semibold uppercase tracking-wide" style="color:var(--fg-muted)">
      {t("settings.ttsStatus.usage.label")}
    </span>

    <!-- ElevenLabs usage -->
    <div class="flex flex-col gap-0.5 rounded-xl p-2" style="background:var(--bg-card)">
      <span class="text-[11px] font-semibold" style="color:var(--fg-dim)">
        {t("settings.ttsStatus.usage.elevenlabs")}
      </span>
      {#if usageEl !== undefined}
        <div dir="ltr" class="text-[12px] font-mono" style="color:var(--fg)">
          {usageEl.chars.toLocaleString()} chars
          {#if usageEl.cacheHits > 0}
            · {t("settings.ttsStatus.usage.cache")}: {usageEl.cacheHits}
          {/if}
          · {t("settings.ttsStatus.usage.cost")}: {formatCost(usageEl.costUsd)}
        </div>
      {:else}
        <span class="text-[12px]" style="color:var(--fg-muted)">
          {t("settings.ttsStatus.usage.notAvailable")}
        </span>
      {/if}
    </div>

    <!-- Gemini usage -->
    <div class="flex flex-col gap-0.5 rounded-xl p-2" style="background:var(--bg-card)">
      <span class="text-[11px] font-semibold" style="color:var(--fg-dim)">
        {t("settings.ttsStatus.usage.gemini")}
      </span>
      {#if usageGo !== undefined}
        <div dir="ltr" class="text-[12px] font-mono" style="color:var(--fg)">
          {usageGo.inputTokens.toLocaleString()} input
          + {usageGo.audioTokens.toLocaleString()} audio tokens
          {#if usageGo.cacheHits > 0}
            · {t("settings.ttsStatus.usage.cache")}: {usageGo.cacheHits}
          {/if}
          · {t("settings.ttsStatus.usage.cost")}: {formatCost(usageGo.costUsd)}
        </div>
      {:else}
        <span class="text-[12px]" style="color:var(--fg-muted)">
          {t("settings.ttsStatus.usage.notAvailable")}
        </span>
      {/if}
    </div>
  </div>
</div>
