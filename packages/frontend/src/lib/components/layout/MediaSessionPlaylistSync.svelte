<script lang="ts">
  import { onDestroy } from "svelte"
  import type { AudioPlaylist } from "$lib/engines/audio-playlist.svelte"
  import { createMediaSessionPlaylistBridge } from "$lib/engines/media-session-playlist-host"
  import type { AgentSession } from "$lib/view-models/agent-session.svelte"

  let {
    audioPlaylist,
    session,
    onStop,
  }: {
    audioPlaylist: AudioPlaylist
    session: AgentSession
    onStop: () => void
  } = $props()

  const mediaSessionBridge = createMediaSessionPlaylistBridge(audioPlaylist, session, onStop)

  $effect(() => {
    const hasMediaSession = typeof navigator !== "undefined" && "mediaSession" in navigator
    if (!hasMediaSession) {
      mediaSessionBridge.detach()
      return
    }
    if (audioPlaylist.transport !== "stopped") {
      mediaSessionBridge.attach()
    } else {
      mediaSessionBridge.detach()
    }
  })

  $effect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return
    void audioPlaylist.transport
    void audioPlaylist.state
    void audioPlaylist.cursor
    void audioPlaylist.items.length
    if (audioPlaylist.transport !== "stopped") mediaSessionBridge.sync()
  })

  onDestroy(() => mediaSessionBridge.detach())
</script>
