/**
 * tts-status.svelte.ts — VM for TTS status card.
 *
 * Slice: tts-status-ui, Commit 1.
 *
 * Aggregates three data sources:
 *   1. ttsCapabilities.caps (reason — from existing singleton, pre-fetched)
 *   2. fetchElevenLabsSubscription() → quota display
 *   3. fetchUsageSummary() → usage + cost display
 *
 * Adapter failures → undefined fields → card shows "—", never crashes.
 * Non-blocking: refresh() fetches in parallel, swallows errors.
 */

import type { ElevenLabsSubscription } from "$lib/adapters/voice/subscription"
import { fetchElevenLabsSubscription } from "$lib/adapters/voice/subscription"
import { fetchUsageSummary, type UsageSummary } from "$lib/adapters/usage"

class TtsStatusVM {
  subscription = $state<ElevenLabsSubscription | undefined>(undefined)
  usage = $state<UsageSummary | undefined>(undefined)
  loading = $state(false)

  async refresh(): Promise<void> {
    if (this.loading) return
    this.loading = true
    try {
      const [sub, usageResult] = await Promise.allSettled([
        fetchElevenLabsSubscription(),
        fetchUsageSummary(),
      ])
      this.subscription = sub.status === "fulfilled" ? sub.value : undefined
      this.usage = usageResult.status === "fulfilled" ? usageResult.value : undefined
    } finally {
      this.loading = false
    }
  }
}

// Singleton — shared across all consumers in the same page lifecycle.
export const ttsStatus = new TtsStatusVM()
