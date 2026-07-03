/**
 * capabilities.svelte.ts — VM for TTS provider capabilities.
 *
 * Slice: tts-provider-availability, Commit 2 + Commit 3 (capability-gate).
 *
 * Holds the result of GET /api/tts/capabilities.
 * Called from +layout.svelte (app-init, race-fix) and SettingsScreen.svelte (on mount).
 *
 * Commit 3: added isAvailable() gate + optimistic-on-error catch.
 */

import { fetchTtsCapabilities, type ProviderCapabilities } from "$lib/adapters/tts-capabilities"

export type { ProviderCapabilities }

const OPTIMISTIC_CAPS: ProviderCapabilities = {
  elevenlabs: { available: true, reason: "ok" },
  google: { available: true, reason: "ok" },
}

class TtsCapabilitiesVM {
  caps = $state<ProviderCapabilities | undefined>(undefined)
  #loading = $state(false)

  async refresh(): Promise<void> {
    if (this.#loading) return
    this.#loading = true
    try {
      this.caps = await fetchTtsCapabilities()
    } catch {
      // On error: set optimistic-defined caps so the reactive $effect in VoicePicker
      // can proceed (undefined = never triggers loadVoices; optimistic = no over-gating).
      // The local BE endpoint is nearly always reachable, so this is a safe default.
      this.caps = OPTIMISTIC_CAPS
    } finally {
      this.#loading = false
    }
  }

  /**
   * Returns true when the provider should be allowed to make requests.
   * undefined caps → optimistic (true) so the app works before first probe.
   * available===false → false (blocked).
   */
  isAvailable(provider: "elevenlabs" | "google"): boolean {
    return this.caps?.[provider]?.available !== false
  }
}

// Singleton — shared across all consumers in the same page lifecycle.
export const ttsCapabilities = new TtsCapabilitiesVM()
