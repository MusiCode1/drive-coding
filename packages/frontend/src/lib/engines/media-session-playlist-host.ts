import type { AudioPlaylist } from "./audio-playlist.svelte"
import { MediaSessionPlaylistBridge } from "./media-session-playlist.js"
import type { AgentSession } from "../view-models/agent-session.svelte"

export function titleForCurrentPlaylistSegment(
  audioPlaylist: AudioPlaylist,
  session: AgentSession,
): string | undefined {
  const item = audioPlaylist.items[audioPlaylist.cursor]
  if (!item) return undefined
  const bubble = session.renderBubbles.find((b) => b.id === item.bubbleId)
  if (!bubble || (bubble.kind !== "message" && bubble.kind !== "thought")) return undefined
  const text = bubble.segments.map((s) => s.text).join("")
  return text.slice(0, 80) || undefined
}

export function createMediaSessionPlaylistBridge(
  audioPlaylist: AudioPlaylist,
  session: AgentSession,
  onStop: () => void,
): MediaSessionPlaylistBridge {
  return new MediaSessionPlaylistBridge({
    controls: {
      next: () => audioPlaylist.next(),
      prev: () => audioPlaylist.prev(),
      pause: () => audioPlaylist.pause(),
      resume: () => audioPlaylist.resume(),
    },
    onStop,
    getState: () => audioPlaylist.state,
    getTransport: () => audioPlaylist.transport,
    getCursor: () => audioPlaylist.cursor,
    getItemCount: () => audioPlaylist.items.length,
    getTitle: () => titleForCurrentPlaylistSegment(audioPlaylist, session),
  })
}
