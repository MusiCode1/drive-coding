/**
 * player.svelte.ts — Phase 3 playlist navigation store with orchestrator callbacks.
 *
 * Manages the ordered audio segment playlist for navigation.
 * Phase 3 additions:
 *   - onAdvance(cb): callback when player advances to next segment (pumpQueue)
 *   - onJump(cb): callback when user jumps to a segment (cancel in-flight fetches)
 *   - advance(): move to next and fire onAdvance callbacks
 */

export type PlaylistItem = {
  segmentId: string
  kind: "message" | "thought" | "narration"
  /** messageId of the bubble this segment belongs to (null if unknown). */
  messageId: string | null
}

/**
 * createPlayerStore — manages ordered audio playlist for navigation.
 *
 * Usage: add segments as they arrive, navigate, and register callbacks.
 */
export function createPlayerStore() {
  /** Ordered playlist of segment IDs as they arrived. */
  let playlist = $state<PlaylistItem[]>([])
  /** Index in playlist of the currently/last-played segment. */
  let currentIndex = $state(-1)

  // Orchestrator callbacks
  const advanceCallbacks: Array<(newIndex: number) => void> = []
  const jumpCallbacks: Array<(newIndex: number) => void> = []

  function addSegment(
    segmentId: string,
    kind: "message" | "thought" | "narration",
    messageId: string | null = null,
  ): void {
    // Avoid duplicates
    if (playlist.some((s) => s.segmentId === segmentId)) return
    playlist = [...playlist, { segmentId, kind, messageId }]
  }

  function jumpToSegment(segmentId: string): number {
    const idx = playlist.findIndex((s) => s.segmentId === segmentId)
    if (idx < 0) return -1
    const prev = currentIndex
    currentIndex = idx
    if (idx !== prev) {
      for (const cb of jumpCallbacks) cb(idx)
    }
    return idx
  }

  function goNext(): PlaylistItem | null {
    const nextIdx = currentIndex + 1
    if (nextIdx >= playlist.length) return null
    currentIndex = nextIdx
    for (const cb of advanceCallbacks) cb(nextIdx)
    return playlist[nextIdx] ?? null
  }

  function goPrev(): PlaylistItem | null {
    const prevIdx = currentIndex - 1
    if (prevIdx < 0) return null
    currentIndex = prevIdx
    for (const cb of jumpCallbacks) cb(prevIdx)
    return playlist[prevIdx] ?? null
  }

  /**
   * advance() — called by orchestrator after a segment finishes playing.
   * Moves currentIndex to next segment and fires onAdvance callbacks.
   */
  function advance(): PlaylistItem | null {
    return goNext()
  }

  /** Find index of first segment belonging to a given kind after optional startIdx. */
  function findFirstOfKind(kind: "message" | "thought" | "narration", startIdx = 0): number {
    for (let i = startIdx; i < playlist.length; i++) {
      if (playlist[i]?.kind === kind) return i
    }
    return -1
  }

  /**
   * Jump to the first segment of a given bubble (by messageId).
   * Returns the PlaylistItem to start from, or null if not found.
   */
  function jumpToBubble(messageId: string): PlaylistItem | null {
    const idx = playlist.findIndex((s) => s.messageId === messageId)
    if (idx < 0) return null
    const prev = currentIndex
    currentIndex = idx
    if (idx !== prev) {
      for (const cb of jumpCallbacks) cb(idx)
    }
    return playlist[idx] ?? null
  }

  /**
   * true if the currently-playing segment belongs to the given bubble.
   */
  function isPlayingBubble(messageId: string): boolean {
    const current = playlist[currentIndex]
    return current !== undefined && current.messageId === messageId
  }

  /**
   * replayLast: jump back to the first message-kind segment.
   * Returns the item to start playback from, or null if none.
   */
  function replayLastResponse(): PlaylistItem | null {
    const idx = findFirstOfKind("message", 0)
    if (idx < 0) return null
    const prev = currentIndex
    currentIndex = idx
    if (idx !== prev) {
      for (const cb of jumpCallbacks) cb(idx)
    }
    return playlist[idx] ?? null
  }

  function clear(): void {
    playlist = []
    currentIndex = -1
  }

  /** Register a callback to be called when player advances (segment finished). */
  function onAdvance(cb: (newIndex: number) => void): void {
    advanceCallbacks.push(cb)
  }

  /** Register a callback to be called when user jumps (cancel in-flight fetches > newIndex). */
  function onJump(cb: (newIndex: number) => void): void {
    jumpCallbacks.push(cb)
  }

  return {
    get playlist() {
      return playlist
    },
    get currentIndex() {
      return currentIndex
    },
    get currentItem(): PlaylistItem | null {
      return playlist[currentIndex] ?? null
    },
    get hasNext(): boolean {
      return currentIndex < playlist.length - 1
    },
    get hasPrev(): boolean {
      return currentIndex > 0
    },
    addSegment,
    jumpToSegment,
    jumpToBubble,
    isPlayingBubble,
    goNext,
    goPrev,
    advance,
    replayLastResponse,
    onAdvance,
    onJump,
    clear,
  }
}
