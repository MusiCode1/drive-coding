/**
 * shared-audio-output.ts — בעלים יחיד של HTMLAudioElement לכל TTS.
 *
 * כל משפט הוא קובץ נפרד (MP3 / WAV). מחליפים `src` על **אותו** אלמנט
 * וממתינים ל-ended — תבנית Chrome / web.dev. לא מאחדים MP3 ל-MSE אחד:
 * כל תשובת-TTS מתחילה מ-PTS 0, ואיחוד חותך ומערבב משפטים.
 */

export type OutputFormat = "mse" | "blob"

export class SharedAudioOutput {
  readonly #audio: HTMLAudioElement
  /** דור-ניגון: src חדש מבטל המתנה ישנה בלי תלות ב-ended. */
  #playGen = 0
  #activeResolve: (() => void) | null = null

  constructor(audio?: HTMLAudioElement) {
    this.#audio = audio ?? new Audio()
  }

  get audio(): HTMLAudioElement {
    return this.#audio
  }

  /**
   * מחליף src על האלמנט המשותף ומנגן עד ended.
   * קריאה חוזרת מבטלת את ההמתנה הקודמת (ניווט / משפט הבא).
   */
  async playBlob(blobUrl: string): Promise<void> {
    this.#activeResolve?.()
    this.#activeResolve = null

    const gen = ++this.#playGen
    this.#audio.src = blobUrl

    return new Promise<void>((resolve, reject) => {
      let settled = false
      const finishOk = () => {
        if (settled) return
        settled = true
        this.#audio.removeEventListener("ended", onEnded)
        this.#audio.removeEventListener("error", onError)
        if (this.#playGen === gen) this.#activeResolve = null
        resolve()
      }
      const onEnded = () => finishOk()
      const onError = (e: Event) => {
        if (settled) return
        settled = true
        this.#audio.removeEventListener("ended", onEnded)
        this.#audio.removeEventListener("error", onError)
        if (this.#playGen === gen) this.#activeResolve = null
        if (gen !== this.#playGen) {
          resolve()
          return
        }
        reject(e)
      }
      this.#activeResolve = finishOk
      this.#audio.addEventListener("ended", onEnded, { once: true })
      this.#audio.addEventListener("error", onError, { once: true })
      this.#audio.play().catch((e) => {
        if (gen !== this.#playGen) {
          finishOk()
          return
        }
        onError(e as Event)
      })
    })
  }

  pause(): void {
    this.#audio.pause()
  }

  resume(): void {
    void this.#audio.play()
  }

  /** pause על אותו אלמנט — בלי new Audio(). */
  reset(): void {
    this.#playGen++
    this.#activeResolve?.()
    this.#activeResolve = null
    this.#audio.pause()
  }

  /** mp3 ו-pcm שניהם src-swap על אותו אלמנט. */
  switchFormat(_format: OutputFormat): void {
    this.#audio.pause()
  }
}
