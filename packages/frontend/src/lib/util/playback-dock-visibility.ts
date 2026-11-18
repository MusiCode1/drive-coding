/**
 * playback-dock-visibility.ts — pure gate for playback control dock (slice playback-dock-scope).
 */
import type { InputMode } from "$lib/view-models/ui-shell.svelte"

export function shouldShowPlaybackDock(params: {
  inputMode: InputMode
  playlistItemCount: number
  isRunActive: boolean
}): boolean {
  if (params.inputMode !== "record") return false
  return params.playlistItemCount > 0 || params.isRunActive
}
