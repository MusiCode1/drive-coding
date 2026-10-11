/**
 * ElevenLabs voice catalog loading — extracted from Settings (slice mic-device-selection).
 */
import { listVoices, type Voice } from "../adapters/voice/voices"
import { ttsCapabilities } from "./capabilities.svelte"

export class SettingsVoices {
  /** Loaded asynchronously from ElevenLabs via `loadVoices()`. Empty until then. */
  availableVoices = $state<Voice[]>([])
  voicesLoading = $state<boolean>(false)
  voicesError = $state<string | null>(null)
  /** Consecutive failure count — feeds exponential backoff. Reset on success / force. */
  #voicesRetries = 0
  /** Scheduled retry timer (null = none pending). */
  #voicesRetryTimer: ReturnType<typeof setTimeout> | null = null

  loadVoices = async (force = false): Promise<void> => {
    if (!ttsCapabilities.isAvailable("elevenlabs")) {
      this.#clearVoicesRetry()
      return
    }
    if (this.voicesLoading) return
    if (this.availableVoices.length > 0 && this.voicesError === null) return

    if (force) {
      this.#clearVoicesRetry()
      this.#voicesRetries = 0
    } else if (this.#voicesRetryTimer !== null) {
      return
    }

    this.voicesLoading = true
    this.voicesError = null
    try {
      const voices = await listVoices()
      this.availableVoices = voices
      this.#voicesRetries = 0
    } catch (e) {
      this.voicesError = e instanceof Error ? e.message : String(e)
      this.#scheduleVoicesRetry()
    } finally {
      this.voicesLoading = false
    }
  }

  static #VOICES_MAX_RETRIES = 6
  static #VOICES_BASE_DELAY_MS = 2000
  static #VOICES_MAX_DELAY_MS = 30_000

  #scheduleVoicesRetry(): void {
    if (!ttsCapabilities.isAvailable("elevenlabs")) return
    if (this.#voicesRetries >= SettingsVoices.#VOICES_MAX_RETRIES) return
    const delay = Math.min(
      SettingsVoices.#VOICES_BASE_DELAY_MS * 2 ** this.#voicesRetries,
      SettingsVoices.#VOICES_MAX_DELAY_MS,
    )
    this.#voicesRetries += 1
    this.#clearVoicesRetry()
    this.#voicesRetryTimer = setTimeout(() => {
      this.#voicesRetryTimer = null
      void this.loadVoices()
    }, delay)
  }

  #clearVoicesRetry(): void {
    if (this.#voicesRetryTimer !== null) {
      clearTimeout(this.#voicesRetryTimer)
      this.#voicesRetryTimer = null
    }
  }
}
