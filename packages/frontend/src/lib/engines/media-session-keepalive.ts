/** §3.4 + Chromium kMinimumContentDurationSecs = 5. 30 כמו בדף של 27/07. */
export const LOOP_SECONDS = 30
export const LOOP_SAMPLE_RATE = 8000
/** רעש-לבן שקט-כמעט. לא muted — מושתק = אין MediaSession. */
export const LOOP_AMPLITUDE = 0.015
/** §3.5: ה-watchdog שהחזיר את הלולאה תוך <3 שניות. */
export const WATCHDOG_INTERVAL_MS = 2000
/** פעימת-חיים — מבדילה "הכפתור לא הגיע" מ-"הדף הוקפא". */
export const BEAT_INTERVAL_MS = 10_000

/** 9 הפעולות. זהה בדיוק לאיחוד MediaSessionAction ב-lib.dom. */
export const MEDIA_ACTIONS: readonly MediaSessionAction[] = [
  "nexttrack",
  "pause",
  "play",
  "previoustrack",
  "seekbackward",
  "seekforward",
  "seekto",
  "skipad",
  "stop",
]

export type AudioLike = {
  paused: boolean
  currentTime: number
  play(): Promise<void>
}

export type MediaSessionLike = {
  setActionHandler(
    action: MediaSessionAction,
    handler: ((details: MediaSessionActionDetails) => void) | null,
  ): void
  playbackState: MediaSessionPlaybackState
}

export type KeepaliveEvent =
  | { kind: "state-change"; paused: boolean }
  | { kind: "resume-ok" }
  | { kind: "resume-failed"; error: string }
  | { kind: "beat"; paused: boolean; currentTime: number }

/** WAV PCM 16-bit mono. טהור — אין DOM. */
export function makeNoiseWav(seconds: number, sampleRate: number, amplitude: number): Blob {
  const numSamples = Math.floor(seconds * sampleRate)
  const dataBytes = numSamples * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeStr(0, "RIFF")
  view.setUint32(4, 36 + dataBytes, true)
  writeStr(8, "WAVE")
  writeStr(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, "data")
  view.setUint32(40, dataBytes, true)

  for (let i = 0; i < numSamples; i++) {
    const sample = (Math.random() * 2 - 1) * amplitude * 32767
    view.setInt16(44 + i * 2, sample, true)
  }

  return new Blob([buffer], { type: "audio/wav" })
}

const REVIVE_ACTIONS = new Set<MediaSessionAction>(["play", "pause", "stop"])

export class MediaSessionKeepalive {
  #audio: AudioLike
  #mediaSession: MediaSessionLike | null
  #now: () => number
  #lastBeatAt: number | null = null

  constructor(deps: {
    audio: AudioLike
    mediaSession: MediaSessionLike | null
    now: () => number
  }) {
    this.#audio = deps.audio
    this.#mediaSession = deps.mediaSession
    this.#now = deps.now
  }

  registerActionHandlers(onAction: (action: MediaSessionAction, at: number) => void): number {
    if (this.#mediaSession === null) return 0

    let registered = 0
    for (const action of MEDIA_ACTIONS) {
      try {
        this.#mediaSession.setActionHandler(action, () => {
          const at = this.#now()
          onAction(action, at)
          if (REVIVE_ACTIONS.has(action)) {
            if (this.#audio.paused) void this.#audio.play()
            if (this.#mediaSession) this.#mediaSession.playbackState = "playing"
          }
        })
        registered++
      } catch {
        // NotSupportedError per-action — continue with the rest
      }
    }
    return registered
  }

  async pump(now: number): Promise<KeepaliveEvent[]> {
    const events: KeepaliveEvent[] = []

    if (this.#audio.paused) {
      events.push({ kind: "state-change", paused: true })
      try {
        await this.#audio.play()
        events.push({ kind: "resume-ok" })
      } catch (e: unknown) {
        events.push({
          kind: "resume-failed",
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }

    if (this.#lastBeatAt === null || now - this.#lastBeatAt >= BEAT_INTERVAL_MS) {
      this.#lastBeatAt = now
      events.push({
        kind: "beat",
        paused: this.#audio.paused,
        currentTime: this.#audio.currentTime,
      })
    }

    return events
  }

  dispose(): void {
    if (this.#mediaSession === null) return
    for (const action of MEDIA_ACTIONS) {
      try {
        this.#mediaSession.setActionHandler(action, null)
      } catch {
        // never throws outward
      }
    }
  }
}
