/**
 * voice-preview.ts — plays a voice's sample clip (engines layer, slice codex-voice-poc).
 * One clip at a time; the returned function stops it.
 *
 * `onEnd` gets the reason when the clip could not play (a media error, or a rejected `play()`),
 * and nothing when it ended or was stopped — a failing sample must not look like a short one.
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
  audio.onerror = () => {
    const err = audio.error
    const kind = err ? (MEDIA_ERRORS[err.code] ?? `code ${err.code}`) : "unknown"
    finish(err?.message ? `${kind}: ${err.message}` : kind)
  }
  audio.play().catch((e: unknown) => {
    finish(e instanceof Error ? `${e.name}: ${e.message}` : String(e))
  })
  return () => {
    audio.pause()
    audio.src = ""
    finish()
  }
}
