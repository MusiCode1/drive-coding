import type { AudioPlaylist } from "../engines/audio-playlist.svelte"
import { MediaSessionPlaylistBridge } from "../engines/media-session-playlist"
import type { AgentSession } from "../view-models/agent-session.svelte"
import type { BubblePlayer } from "../view-models/bubble-player.svelte"

export function createMediaSessionPlaylistBridge({
  session,
  playlist,
  bubblePlayer,
}: {
  session: AgentSession
  playlist: AudioPlaylist
  bubblePlayer: BubblePlayer
}): MediaSessionPlaylistBridge {
  return new MediaSessionPlaylistBridge({
    controls: {
      next: () => playlist.next(),
      prev: () => playlist.prev(),
      pause: () => playlist.pause(),
      resume: () => playlist.resume(),
    },
    onStop: () => bubblePlayer.stop(),
    getState: () => playlist.state,
    getTransport: () => playlist.transport,
    getCursor: () => playlist.cursor,
    getItemCount: () => playlist.items.length,
    getTitle: () => {
      const item = playlist.items[playlist.cursor]
      if (!item) return undefined
      const bubble = session.renderBubbles.find((b) => b.id === item.bubbleId)
      if (!bubble || (bubble.kind !== "message" && bubble.kind !== "thought")) return undefined
      return (
        bubble.segments
          .map((s) => s.text)
          .join("")
          .slice(0, 80) || undefined
      )
    },
  })
}
