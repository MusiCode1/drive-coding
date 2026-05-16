/**
 * car-mode.svelte.ts — Slice 7 Drive-First UX
 *
 * createCarMode: manages Media Session API integration for car bluetooth
 * button → toggles recording via play/pause hardware media keys.
 *
 * Spec: D19, §9.6 "Media Session API — bluetooth car button"
 * Reference: v1 index.html:1878-2019
 *
 * Slice 7 fix: previoustrack handler now calls onReplayLast callback
 * instead of setting null (which cleared the handler).
 */

export interface CarModeControls {
  startRecording: () => void
  stopRecording: () => void
  isRecording: () => boolean
  onReplayLast?: () => void
}

export interface CarModePublic {
  readonly isActive: boolean
  enable(controls: CarModeControls): void
  setPlaybackState(playing: boolean): void
}

export function createCarMode(): CarModePublic {
  let active = $state(false)

  function hasMediaSession(): boolean {
    return typeof navigator !== "undefined" && "mediaSession" in navigator
  }

  function enable(controls: CarModeControls): void {
    if (active) return
    if (!hasMediaSession()) return

    // Set metadata so car display shows something meaningful
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "voice-acp",
        artist: "ACP voice interface",
      })
    } catch {
      // MediaMetadata may not be available in all environments
    }

    // play → toggle recording (same logic as pause — both are "do something")
    navigator.mediaSession.setActionHandler("play", () => {
      if (controls.isRecording()) {
        controls.stopRecording()
      } else {
        controls.startRecording()
      }
    })

    navigator.mediaSession.setActionHandler("pause", () => {
      if (controls.isRecording()) {
        controls.stopRecording()
      } else {
        controls.startRecording()
      }
    })

    // previoustrack → replay last audio (v1 behaviour)
    try {
      navigator.mediaSession.setActionHandler("previoustrack", () => {
        controls.onReplayLast?.()
      })
    } catch {
      // Not all browsers support the previoustrack action
    }

    active = true
    navigator.mediaSession.playbackState = "playing"
  }

  function setPlaybackState(playing: boolean): void {
    if (!active || !hasMediaSession()) return
    navigator.mediaSession.playbackState = playing ? "playing" : "paused"
  }

  return {
    get isActive() {
      return active
    },
    enable,
    setPlaybackState,
  }
}
