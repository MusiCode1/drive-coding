import type { AudioPlaylistState, AudioPlaylistTransport } from "./audio-playlist.svelte.js"
import { MEDIA_ACTIONS } from "./media-session-keepalive.js"

/** פקודות playlist שה-bridge מבצע (לא כל 9 ה-MEDIA actions). */
export type PlaylistMediaCommand = "next" | "prev" | "resume" | "pause" | "stop" | "noop"

/** controls מינימליים — bridge לא תלוי ב-AudioPlaylist class ישירות ב-tests. */
export type PlaylistMediaControls = {
  next(): void
  prev(): void
  pause(): void
  resume(): void
}

export type MediaSessionLike = {
  setActionHandler(
    action: MediaSessionAction,
    handler: ((details: MediaSessionActionDetails) => void) | null,
  ): void
  metadata: MediaMetadata | null
  playbackState: MediaSessionPlaybackState
}

export type MediaSessionPlaylistDeps = {
  controls: PlaylistMediaControls
  onStop: () => void
  getState: () => AudioPlaylistState
  getTransport: () => AudioPlaylistTransport
  getCursor: () => number
  getItemCount: () => number
  /** כותרת ל-MediaMetadata — e.g. bubble text או "TTS" */
  getTitle: () => string | undefined
  /** injectable for tests; defaults to navigator.mediaSession when omitted */
  mediaSession?: MediaSessionLike | null
}

type MediaMetadataCtor = new (init: MediaMetadataInit) => MediaMetadata

const COMMAND_BY_ACTION: Record<MediaSessionAction, PlaylistMediaCommand> = {
  nexttrack: "next",
  previoustrack: "prev",
  play: "resume",
  pause: "pause",
  stop: "stop",
  seekbackward: "noop",
  seekforward: "noop",
  seekto: "noop",
  skipad: "noop",
}

export function playlistCommandForMediaAction(action: MediaSessionAction): PlaylistMediaCommand {
  return COMMAND_BY_ACTION[action]
}

export function applyPlaylistMediaCommand(
  controls: PlaylistMediaControls,
  onStop: () => void,
  command: PlaylistMediaCommand,
): void {
  switch (command) {
    case "next":
      controls.next()
      break
    case "prev":
      controls.prev()
      break
    case "pause":
      controls.pause()
      break
    case "resume":
      controls.resume()
      break
    case "stop":
      onStop()
      break
    case "noop":
      break
  }
}

export function playbackStateForPlaylist(
  state: AudioPlaylistState,
  transport: AudioPlaylistTransport,
): MediaSessionPlaybackState {
  if (transport === "stopped") return "none"
  if (transport === "paused") return "paused"
  if (state === "idle") return "paused"
  return "playing"
}

export class MediaSessionPlaylistBridge {
  readonly #deps: MediaSessionPlaylistDeps
  readonly #mediaSession: MediaSessionLike | null
  readonly #MediaMetadata: MediaMetadataCtor
  #attached = false

  constructor(deps: MediaSessionPlaylistDeps, MediaMetadataImpl?: MediaMetadataCtor) {
    this.#deps = deps
    this.#mediaSession =
      deps.mediaSession !== undefined
        ? deps.mediaSession
        : typeof navigator !== "undefined" && "mediaSession" in navigator
          ? (navigator.mediaSession as MediaSessionLike)
          : null
    this.#MediaMetadata = MediaMetadataImpl ?? globalThis.MediaMetadata
  }

  /** רושם handlers לכל 9 MEDIA_ACTIONS — idempotent */
  attach(): number {
    if (this.#mediaSession === null || this.#attached) {
      if (this.#mediaSession !== null && this.#attached) return MEDIA_ACTIONS.length
      return 0
    }

    let registered = 0
    for (const action of MEDIA_ACTIONS) {
      try {
        this.#mediaSession.setActionHandler(action, () => {
          const command = playlistCommandForMediaAction(action)
          applyPlaylistMediaCommand(this.#deps.controls, this.#deps.onStop, command)
        })
        registered++
      } catch {
        // NotSupportedError per-action — continue with the rest
      }
    }
    this.#attached = true
    return registered
  }

  /** metadata + playbackState */
  sync(): void {
    if (this.#mediaSession === null || !this.#attached) return

    const cursor = this.#deps.getCursor()
    const count = this.#deps.getItemCount()
    const state = this.#deps.getState()
    const transport = this.#deps.getTransport()

    if (this.#MediaMetadata) {
      this.#mediaSession.metadata = new this.#MediaMetadata({
        title: this.#deps.getTitle() ?? "drive-coding",
        artist: "TTS",
        album: `segment ${cursor + 1}/${count}`,
      })
    }

    this.#mediaSession.playbackState = playbackStateForPlaylist(state, transport)
  }

  /** מסיר handlers + metadata=null */
  detach(): void {
    if (this.#mediaSession === null) return

    for (const action of MEDIA_ACTIONS) {
      try {
        this.#mediaSession.setActionHandler(action, null)
      } catch {
        // never throws outward
      }
    }
    this.#mediaSession.metadata = null
    this.#attached = false
  }
}
