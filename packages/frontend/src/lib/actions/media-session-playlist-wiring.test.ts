import { afterEach, expect, it, vi } from "vitest"
import type { AudioPlaylist } from "../engines/audio-playlist.svelte"
import type { MediaSessionLike } from "../engines/media-session-playlist"
import type { AgentSession } from "../view-models/agent-session.svelte"
import type { BubblePlayer } from "../view-models/bubble-player.svelte"
import { createMediaSessionPlaylistBridge } from "./media-session-playlist-wiring"

afterEach(() => vi.unstubAllGlobals())

it("reads cursor and bubble title after creation and routes all playlist controls", () => {
  const handlers = new Map<
    MediaSessionAction,
    ((details: MediaSessionActionDetails) => void) | null
  >()
  const mediaSession: MediaSessionLike = {
    metadata: null,
    playbackState: "none",
    setActionHandler: (action, handler) => {
      handlers.set(action, handler)
    },
  }
  vi.stubGlobal("navigator", { mediaSession })
  vi.stubGlobal(
    "MediaMetadata",
    class {
      title: string
      album: string
      constructor(init: MediaMetadataInit) {
        this.title = init.title ?? ""
        this.album = init.album ?? ""
      }
    },
  )

  const data = {
    cursor: 0,
    items: [{ bubbleId: "first" }, { bubbleId: "second" }],
    renderBubbles: [
      { id: "first", kind: "message", segments: [{ text: "First" }] },
      { id: "second", kind: "thought", segments: [{ text: "Second" }] },
    ],
  }
  const controls = { next: vi.fn(), prev: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn() }
  const playlist = {
    get cursor() {
      return data.cursor
    },
    items: data.items,
    state: "playing",
    transport: "playing",
    ...controls,
  } as unknown as AudioPlaylist
  const session = {
    get renderBubbles() {
      return data.renderBubbles
    },
  } as unknown as AgentSession
  const bubblePlayer = { stop: controls.stop } as unknown as BubblePlayer
  const bridge = createMediaSessionPlaylistBridge({ session, playlist, bubblePlayer })
  bridge.attach()
  bridge.sync()
  expect(mediaSession.metadata?.title).toBe("First")

  data.cursor = 1
  const secondSegment = data.renderBubbles[1]?.segments[0]
  if (!secondSegment) throw new Error("missing second segment")
  secondSegment.text = "Changed after creation"
  bridge.sync()
  expect(mediaSession.metadata?.title).toBe("Changed after creation")
  expect(mediaSession.metadata?.album).toBe("segment 2/2")

  for (const [action, name] of [
    ["nexttrack", "next"],
    ["previoustrack", "prev"],
    ["pause", "pause"],
    ["play", "resume"],
    ["stop", "stop"],
  ] as const) {
    handlers.get(action)?.({ action })
    expect(controls[name]).toHaveBeenCalledOnce()
  }
})
