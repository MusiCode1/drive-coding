<script lang="ts">
/**
 * TtsStatusCard — displays TTS provider status, quota, and usage totals.
 *
 * Slice: tts-status-ui, Commit 1.
 * Updated: tts-quota-refine, Commit 2 — effective-limit + clear quota labels + shared ttsReasonMessage.
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
import { ttsReasonMessage } from "$lib/util/tts-reason"

const t = getI18n().t

// Format cost: $X.XXXX
function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`
}

// Derived: ElevenLabs caps
const elCaps = $derived(ttsCapabilities.caps?.elevenlabs)
const goCaps = $derived(ttsCapabilities.caps?.google)

// Derived: subscription quota
const sub = $derived(ttsStatus.subscription)

// Effective limit = base + extension (when canExtend && maxExtension > 0)
const effectiveLimit = $derived(
  sub !== undefined
    ? sub.canExtend === true && sub.maxExtension !== undefined && sub.maxExtension > 0
      ? sub.characterLimit + sub.maxExtension
      : sub.characterLimit
    : 0,
)

// quotaExhausted: against effective limit
const quotaExhausted = $derived(
  sub !== undefined && effectiveLimit > 0 && sub.characterCount >= effectiveLimit,
)

// isOverage: count exceeded base but within effective limit
const isOverage = $derived(
  sub !== undefined && sub.characterCount > sub.characterLimit && !quotaExhausted,
)

// Progress bar: against effective limit (or base if no extension)
const quotaPercent = $derived(
  sub && effectiveLimit > 0
    ? Math.min((sub.characterCount / effectiveLimit) * 100, 100)
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
        {ttsReasonMessage(elCaps.reason, t)}
      </span>
    </div>
  {/if}
  {#if goCaps && !goCaps.available}
    <div class="flex items-start gap-2 rounded-xl p-2" style="background:var(--bg-card)">
      <span class="text-[11px] font-semibold uppercase tracking-wide" style="color:var(--fg-muted)">
        Gemini
      </span>
      <span class="text-[12px]" style="color:var(--recording)">
        {ttsReasonMessage(goCaps.reason, t)}
      </span>
    </div>
  {/if}

  <!-- ElevenLabs quota -->
  <div class="flex flex-col gap-1.5">
    <span class="text-[11px] font-semibold uppercase tracking-wide" style="color:var(--fg-muted)">
      {t("settings.ttsStatus.quota.label")}
    </span>
    {#if sub !== undefined}
      <!-- Clear labels: "נוצל: X · מכסה: Y · חריגה" format -->
      <div class="flex items-center gap-2 flex-wrap">
        <span
          class="text-[13px] font-mono"
          style="color:{quotaExhausted ? 'var(--recording)' : 'var(--fg)'}"
          dir="ltr"
        >
          {t("settings.ttsStatus.quota.used")}: {sub.characterCount.toLocaleString()}
          &nbsp;·&nbsp;
          {t("settings.ttsStatus.quota.limitLabel")}: {sub.characterLimit.toLocaleString()}
        </span>
        {#if quotaExhausted}
          <span class="text-[11px]" style="color:var(--recording)">
            {t("settings.ttsStatus.quota.exhausted")}
          </span>
        {:else if isOverage}
          <span class="text-[11px]" style="color:var(--accent)">
            {t("settings.ttsStatus.quota.overage")}
          </span>
        {/if}
      </div>
      <!-- Progress bar (against effective limit) -->
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
