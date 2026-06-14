/**
 * play-bubble.ts — ניגון בועה בודדת (הקלטת-משתמש / TTS מחדש לסוכן).
 *
 * אל תיגע ב-Player/Speaker/AudioStream — נתיב <audio> פשוט להשמעה חד-פעמית.
 *
 * ─── msr-v2 (Commit 5) ───
 */

import { recordingUrl } from "./recordings"
import { synthesizeStreaming } from "./tts"

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

/**
 * מסנתז TTS לטקסט בועת-סוכן ומנגן.
 * stream → Blob → objectURL → <audio>. URL.revokeObjectURL חובה אחרי ended/abort (§8.9).
 */
export async function playAgentText(
  text: string,
  voiceId: string,
  audioEl: HTMLAudioElement,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const stream = await synthesizeStreaming({ text, voiceId, signal: opts?.signal })
  const blob = await new Response(stream).blob()
  const url = URL.createObjectURL(blob)
  try {
    await new Promise<void>((resolve, reject) => {
      audioEl.src = url
      const onEnded = () => {
        audioEl.removeEventListener("ended", onEnded)
        audioEl.removeEventListener("error", onError)
        resolve()
      }
      const onError = () => {
        audioEl.removeEventListener("ended", onEnded)
        audioEl.removeEventListener("error", onError)
        reject(new Error("audio error"))
      }
      audioEl.addEventListener("ended", onEnded)
      audioEl.addEventListener("error", onError)
      void audioEl.play().catch(reject)

      // abort signal → עצור ניגון
      opts?.signal?.addEventListener("abort", () => {
        audioEl.pause()
        audioEl.removeEventListener("ended", onEnded)
        audioEl.removeEventListener("error", onError)
        resolve()
      }, { once: true })
    })
  } finally {
    // §8.9: חובה לשחרר objectURL אחרי ended/stop/abort
    URL.revokeObjectURL(url)
  }
}
