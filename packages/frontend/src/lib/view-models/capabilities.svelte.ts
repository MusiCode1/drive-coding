/**
 * capabilities.svelte.ts — VM for TTS provider capabilities.
 *
 * Slice: tts-provider-availability, Commit 2.
 *
 * Holds the result of GET /api/tts/capabilities.
 * Called from SettingsScreen.svelte via refresh() (non-blocking, called on mount).
 */

import { fetchTtsCapabilities, type ProviderCapabilities } from "$lib/adapters/tts-capabilities"

export type { ProviderCapabilities }

class TtsCapabilitiesVM {
  caps = $state<ProviderCapabilities | undefined>(undefined)
  #loading = $state(false)

  async refresh(): Promise<void> {
    if (this.#loading) return
    this.#loading = true
    try {
      this.caps = await fetchTtsCapabilities()
    } catch {
      // On error: leave caps undefined — UI shows providers as available (optimistic)
    } finally {
      this.#loading = false
    }
  }
}

// Singleton — shared across all consumers in the same page lifecycle.
export const ttsCapabilities = new TtsCapabilitiesVM()
