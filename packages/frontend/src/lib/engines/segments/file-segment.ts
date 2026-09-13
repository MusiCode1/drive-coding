/**
 * file-segment.ts — inline audio file via native <audio src> + Range proxy.
 */

import type { AudioEmbedRef } from "@drive-coding/core/voice/audio-embed"
import { beUrl } from "$lib/util/be-url"
import type { PlayableSegment } from "./playable-segment"

type FileState = "ready" | "playing" | "ended" | "cancelled"

export class FileSegment implements PlayableSegment {
  readonly segmentId: string
  readonly #file: AudioEmbedRef
  #audio: HTMLAudioElement
  #state: FileState = "ready"

  constructor(segmentId: string, file: AudioEmbedRef) {
    this.segmentId = segmentId
    this.#file = file
    this.#audio = new Audio()
    this.#audio.src = beUrl(`/api/fs/file?uri=${encodeURIComponent(file.uri)}`)
    this.#audio.title = file.title
  }

  /** Src is set in constructor — ready immediately (no duration wait). */
  markReady(): void {
    this.#state = "ready"
  }

  prepare(_stream: ReadableStream<Uint8Array>, _ac: AbortController): void {
    // no-op — not MediaSource
  }

  async play(): Promise<void> {
    if (this.#state === "cancelled") return
    if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.#file.title.length > 0 ? this.#file.title : "Audio",
      })
    }
    this.#state = "playing"
    await this.#audio.play()
    await new Promise<void>((resolve, reject) => {
      const onEnded = () => {
        this.#state = "ended"
        resolve()
      }
      const onError = () => {
        reject(new Error(`FileSegment play failed: ${this.segmentId}`))
      }
      this.#audio.addEventListener("ended", onEnded, { once: true })
      this.#audio.addEventListener("error", onError, { once: true })
    })
  }

  pause(): void {
    this.#audio.pause()
  }

  resume(): void {
    void this.#audio.play()
  }

  stop(): void {
    this.#audio.pause()
    this.#audio.currentTime = 0
  }

  isComplete(): boolean {
    return this.#state === "ready" || this.#state === "playing" || this.#state === "ended"
  }

  dispose(): void {
    this.#state = "cancelled"
    this.#audio.pause()
    this.#audio.removeAttribute("src")
    this.#audio.load()
  }
}
