/**
 * voice-preview.ts — plays a voice's sample clip (engines layer, slice codex-voice-poc).
 * One clip at a time; the returned function stops it.
 *
 * `onEnd` gets the reason when the clip could not play (a media error, or a rejected `play()`),
 * and nothing when it ended, was stopped or was paused — a failing sample must not look like a
 * short one.
 *
 * Whether the clip is playing is told by the element's own events, not by the `play()` promise:
 * measured 18/11/2026, a user's Chrome rejected it with `AbortError: The play() request was
 * interrupted because the media was removed from the document` while the clip went on playing
 * (not reproduced in the GUI container's Chrome). An element that really stopped fires `pause`.
 */

const MEDIA_ERRORS: Readonly<Record<number, string>> = {
  1: "aborted",
  2: "network",
  3: "decode",
  4: "unsupported source",
}

export function playVoicePreview(url: string, onEnd: (error?: string) => void): () => void {
  const audio = new Audio(url)
  let done = false
  const finish = (error?: string) => {
    if (done) return
    done = true
    if (error !== undefined) console.warn("[voice-preview]", url, error)
    onEnd(error)
  }
  audio.onended = () => finish()
  // paused by the browser or the OS (media keys, another app) — not only by `stop` below
  audio.onpause = () => finish()
  audio.onerror = () => {
    const err = audio.error
    const kind = err ? (MEDIA_ERRORS[err.code] ?? `code ${err.code}`) : "unknown"
    finish(err?.message ? `${kind}: ${err.message}` : kind)
  }
  audio.play().catch((e: unknown) => {
    if (e instanceof Error && e.name === "AbortError") return
    finish(e instanceof Error ? `${e.name}: ${e.message}` : String(e))
  })
  return () => {
    audio.pause()
    audio.src = ""
    finish()
  }
}
