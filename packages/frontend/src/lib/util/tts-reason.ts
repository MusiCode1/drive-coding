/**
 * tts-reason.ts — shared utility for mapping ProbeReason → i18n message string.
 *
 * Slice: tts-quota-refine, Commit 2.
 *
 * Extracted from TtsStatusCard.svelte so the same mapping can be reused in
 * SettingsScreen.svelte (description on disabled TTS provider option in Select).
 */

import type { ProbeReason } from "@drive-coding/core/tts/probe-status"
import type { MessageKey } from "@drive-coding/core/i18n/keys"

/**
 * Returns the i18n key for a given ProbeReason, or null when there is no reason
 * to display (reason is "ok" or undefined).
 */
function reasonI18nKey(reason: ProbeReason | undefined): MessageKey | null {
  switch (reason) {
    case "quota":
      return "settings.ttsStatus.reason.quota"
    case "no-key":
      return "settings.ttsStatus.reason.noKey"
    case "forbidden":
      return "settings.ttsStatus.reason.forbidden"
    case "error":
      return "settings.ttsStatus.reason.error"
    default:
      return null
  }
}

/**
 * Maps a ProbeReason to a translated message string using the provided t() function.
 * Returns an empty string when reason is "ok" or undefined.
 */
export function ttsReasonMessage(
  reason: ProbeReason | undefined,
  t: (key: MessageKey) => string,
): string {
  const key = reasonI18nKey(reason)
  return key ? t(key) : ""
}
