/**
 * media-session-playlist.test.ts — TDD ל-Media Session ↔ AudioPlaylist (ללא keepalive).
 */
import { describe, expect, it, vi } from "vitest"
import type { AudioPlaylistState, AudioPlaylistTransport } from "./audio-playlist.svelte.js"
import { MEDIA_ACTIONS } from "./media-session-keepalive.js"
import {
  applyPlaylistMediaCommand,
  type MediaSessionLike,
  MediaSessionPlaylistBridge,
  type PlaylistMediaCommand,
  type PlaylistMediaControls,
  playbackStateForPlaylist,
  playlistCommandForMediaAction,
} from "./media-session-playlist.js"

function mockControls(): PlaylistMediaControls & {
  next: ReturnType<typeof vi.fn>
  prev: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  resume: ReturnType<typeof vi.fn>
} {
  return {
    next: vi.fn(),
    prev: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  }
}

function mockMediaSession(
  overrides: Partial<MediaSessionLike> & {
    throwOn?: Set<MediaSessionAction>
  } = {},
): MediaSessionLike & {
  handlers: Map<MediaSessionAction, ((details: MediaSessionActionDetails) => void) | null>
  metadata: MediaMetadata | null
} {
  const handlers = new Map<
    MediaSessionAction,
    ((details: MediaSessionActionDetails) => void) | null
  >()
  const throwOn = overrides.throwOn ?? new Set<MediaSessionAction>()
  return {
    handlers,
    metadata: null,
    playbackState: "none",
    setActionHandler(action, handler) {
      if (throwOn.has(action)) throw new DOMException("not supported", "NotSupportedError")
      handlers.set(action, handler)
    },
    ...overrides,
  }
}

describe("playlistCommandForMediaAction", () => {
  const cases: [MediaSessionAction, PlaylistMediaCommand][] = [
    ["nexttrack", "next"],
    ["previoustrack", "prev"],
    ["play", "resume"],
    ["pause", "pause"],
    ["stop", "stop"],
    ["seekbackward", "noop"],
    ["seekforward", "noop"],
    ["seekto", "noop"],
    ["skipad", "noop"],
  ]

  it.each(cases)("maps %s → %s", (action, command) => {
    expect(playlistCommandForMediaAction(action)).toBe(command)
  })

  it("covers all 9 MEDIA_ACTIONS", () => {
    for (const action of MEDIA_ACTIONS) {
      expect(playlistCommandForMediaAction(action)).toBeDefined()
    }
  })
})

describe("applyPlaylistMediaCommand", () => {
  it("dispatches next/prev/pause/resume to controls", () => {
    const controls = mockControls()
    const onStop = vi.fn()
    applyPlaylistMediaCommand(controls, onStop, "next")
    applyPlaylistMediaCommand(controls, onStop, "prev")
    applyPlaylistMediaCommand(controls, onStop, "pause")
    applyPlaylistMediaCommand(controls, onStop, "resume")
    expect(controls.next).toHaveBeenCalledOnce()
    expect(controls.prev).toHaveBeenCalledOnce()
    expect(controls.pause).toHaveBeenCalledOnce()
    expect(controls.resume).toHaveBeenCalledOnce()
    expect(onStop).not.toHaveBeenCalled()
  })

  it("stop calls onStop", () => {
    const controls = mockControls()
    const onStop = vi.fn()
    applyPlaylistMediaCommand(controls, onStop, "stop")
    expect(onStop).toHaveBeenCalledOnce()
  })

  it("noop is a no-op", () => {
    const controls = mockControls()
    const onStop = vi.fn()
    applyPlaylistMediaCommand(controls, onStop, "noop")
    expect(controls.next).not.toHaveBeenCalled()
    expect(onStop).not.toHaveBeenCalled()
  })
})

describe("playbackStateForPlaylist", () => {
  const cases: [AudioPlaylistState, AudioPlaylistTransport, MediaSessionPlaybackState][] = [
    ["playing", "playing", "playing"],
    ["playing", "paused", "paused"],
    ["idle", "playing", "paused"],
    ["idle", "paused", "paused"],
    ["playing", "stopped", "none"],
    ["idle", "stopped", "none"],
  ]

  it.each(cases)("state=%s transport=%s → %s", (state, transport, expected) => {
    expect(playbackStateForPlaylist(state, transport)).toBe(expected)
  })
})

describe("MediaSessionPlaylistBridge", () => {
  function makeBridge(
    ms: ReturnType<typeof mockMediaSession>,
    overrides: Partial<Parameters<typeof MediaSessionPlaylistBridge>[0]> = {},
  ) {
    const controls = mockControls()
    const onStop = vi.fn()
    const bridge = new MediaSessionPlaylistBridge(
      {
        controls,
        onStop,
        getState: () => "playing" as AudioPlaylistState,
        getTransport: () => "playing" as AudioPlaylistTransport,
        getCursor: () => 0,
        getItemCount: () => 3,
        getTitle: () => "Hello world",
        mediaSession: ms,
        ...overrides,
      },
      // MediaMetadata mock for jsdom
      class MockMediaMetadata {
        title: string
        artist: string
        album: string
        constructor(init: { title: string; artist: string; album: string }) {
          this.title = init.title
          this.artist = init.artist
          this.album = init.album
        }
      },
    )
    return { bridge, controls, onStop }
  }

  it("attach registers handlers for all 9 actions", () => {
    const ms = mockMediaSession()
    const { bridge } = makeBridge(ms)
    expect(bridge.attach()).toBe(MEDIA_ACTIONS.length)
    for (const action of MEDIA_ACTIONS) {
      expect(ms.handlers.get(action)).toBeTypeOf("function")
    }
  })

  it("attach is idempotent", () => {
    const ms = mockMediaSession()
    const { bridge } = makeBridge(ms)
    bridge.attach()
    const firstHandlers = new Map(ms.handlers)
    bridge.attach()
    for (const action of MEDIA_ACTIONS) {
      expect(ms.handlers.get(action)).toBe(firstHandlers.get(action))
    }
  })

  it("nexttrack handler calls controls.next", () => {
    const ms = mockMediaSession()
    const { bridge, controls } = makeBridge(ms)
    bridge.attach()
    ms.handlers.get("nexttrack")?.({ action: "nexttrack" } as MediaSessionActionDetails)
    expect(controls.next).toHaveBeenCalledOnce()
  })

  it("stop handler calls onStop", () => {
    const ms = mockMediaSession()
    const { bridge, onStop } = makeBridge(ms)
    bridge.attach()
    ms.handlers.get("stop")?.({ action: "stop" } as MediaSessionActionDetails)
    expect(onStop).toHaveBeenCalledOnce()
  })

  it("noop handlers (seek*) return immediately without calling controls", () => {
    const ms = mockMediaSession()
    const { bridge, controls, onStop } = makeBridge(ms)
    bridge.attach()
    for (const action of ["seekbackward", "seekforward", "seekto", "skipad"] as const) {
      ms.handlers.get(action)?.({ action } as MediaSessionActionDetails)
    }
    expect(controls.next).not.toHaveBeenCalled()
    expect(onStop).not.toHaveBeenCalled()
  })

  it("sync sets metadata and playbackState", () => {
    const ms = mockMediaSession()
    const { bridge } = makeBridge(ms, {
      getCursor: () => 1,
      getItemCount: () => 5,
      getTitle: () => "Bubble text",
      getState: () => "playing",
      getTransport: () => "playing",
    })
    bridge.attach()
    bridge.sync()
    expect(ms.metadata).not.toBeNull()
    expect(ms.metadata?.title).toBe("Bubble text")
    expect(ms.metadata?.artist).toBe("TTS")
    expect(ms.metadata?.album).toBe("segment 2/5")
    expect(ms.playbackState).toBe("playing")
  })

  it("sync uses fallback title when getTitle returns undefined", () => {
    const ms = mockMediaSession()
    const { bridge } = makeBridge(ms, { getTitle: () => undefined })
    bridge.attach()
    bridge.sync()
    expect(ms.metadata?.title).toBe("drive-coding")
  })

  it("detach clears handlers and metadata", () => {
    const ms = mockMediaSession()
    const { bridge } = makeBridge(ms)
    bridge.attach()
    bridge.sync()
    bridge.detach()
    for (const action of MEDIA_ACTIONS) {
      expect(ms.handlers.get(action)).toBeNull()
    }
    expect(ms.metadata).toBeNull()
  })

  it("attach returns 0 when mediaSession is null", () => {
    const bridge = new MediaSessionPlaylistBridge({
      controls: mockControls(),
      onStop: vi.fn(),
      getState: () => "idle",
      getTransport: () => "stopped",
      getCursor: () => 0,
      getItemCount: () => 0,
      getTitle: () => undefined,
      mediaSession: null,
    })
    expect(bridge.attach()).toBe(0)
  })

  it("keeps registering after one action throws NotSupportedError", () => {
    const ms = mockMediaSession({ throwOn: new Set<MediaSessionAction>(["seekto"]) })
    const { bridge } = makeBridge(ms)
    expect(bridge.attach()).toBe(MEDIA_ACTIONS.length - 1)
    expect(ms.handlers.has("nexttrack")).toBe(true)
    expect(ms.handlers.has("seekto")).toBe(false)
  })
})
