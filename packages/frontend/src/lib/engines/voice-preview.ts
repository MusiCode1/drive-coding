/**
 * voice-preview.ts — plays a voice's sample clip (engines layer, slice codex-voice-poc).
 * One clip at a time; the returned function stops it.
 *
 * `onEnd` gets the reason when the clip could not play (a media error, or a rejected `play()`),
 * and nothing when it ended, was stopped or was paused — a failing sample must not look like a
 * short one.
 *
 * Whether the clip is playing is told by the element's state, not by the `play()` promise or a
 * bare `pause` event. Measured 18/11/2026 in Edge with KDE's Plasma Browser Integration: to put
 * a detached <audio> under the desktop's media controls, the extension appends it to <head> and
 * removes it at once (`registerInDom`), then calls `play()` again (`replayAfterRemoval`). The
 * removal pauses the clip and rejects our `play()` with `AbortError: … the media was removed from
 * the document`, yet the clip goes on — and by the time `pause` is dispatched, `paused` is false.
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
  // paused by the browser or the OS (media keys) — unless something already resumed it (above)
  audio.onpause = () => {
    if (audio.paused) finish()
  }
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
