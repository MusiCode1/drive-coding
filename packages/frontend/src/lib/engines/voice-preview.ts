/**
 * voice-preview.ts — plays a voice's sample clip (engines layer, slice codex-voice-poc).
 * One clip at a time; the returned function stops it.
 */

export function playVoicePreview(url: string, onEnd: () => void): () => void {
  const audio = new Audio(url)
  let done = false
  const finish = () => {
    if (done) return
    done = true
    onEnd()
  }
  audio.onended = finish
  audio.onerror = finish
  void audio.play().catch(finish)
  return () => {
    audio.pause()
    audio.src = ""
    finish()
  }
}
