/**
 * play-bubble.ts — ניגון הקלטת-משתמש בודדת דרך <audio>.
 *
 * playUserRecording: נתיב <audio> להשמעת הקלטת-משתמש (קובץ-מדיה אמיתי).
 * TTS לבועות-סוכן עבר ל-BubblePlayer → RoutingAudioSink + resolveTts (V4a-unify).
 *
 * ─── V4a-unify (Commit 2) ───
 */

import { recordingUrl } from "./recordings"

/**
 * מנגן הקלטת-משתמש דרך <audio>. resolves כשנגמר/בוטל.
 */
export function playUserRecording(recordingId: string, audioEl: HTMLAudioElement): Promise<void> {
  return new Promise<void>((resolve) => {
    audioEl.src = recordingUrl(recordingId)
    const onEnded = () => {
      audioEl.removeEventListener("ended", onEnded)
      audioEl.removeEventListener("error", onError)
      resolve()
    }
    const onError = () => {
      audioEl.removeEventListener("ended", onEnded)
      audioEl.removeEventListener("error", onError)
      resolve()  // resolve בכל מקרה (best-effort)
    }
    audioEl.addEventListener("ended", onEnded)
    audioEl.addEventListener("error", onError)
    void audioEl.play().catch(() => resolve())
  })
}
