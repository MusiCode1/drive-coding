/**
 * player.svelte.ts — Phase 7 playlist navigation store.
 *
 * Wraps voice-session's segmentCache + playlist for navigation:
 *   - jumpToSegment(segmentId): pause current, start from segmentId
 *   - prev() / next(): by playlist order
 *   - replayLast(): go back to last user message + play all messages from there
 *
 * This is a thin reactive wrapper — actual audio playback remains in AudioQueue.
 * The store provides `currentSegmentIndex` and navigation logic.
 */

export type PlaylistItem = {
  segmentId: string
  kind: "message" | "thought" | "narration"
  /** Phase 8: messageId of the bubble this segment belongs to (null if unknown). */
  messageId: string | null
}

/**
 * createPlayerStore — manages ordered audio playlist for navigation.
 *
 * Usage: add segments as they arrive from audio_chunk events, then navigate.
 */
export function createPlayerStore() {
  /** Ordered playlist of segment IDs as they arrived. */
  let playlist = $state<PlaylistItem[]>([])
  /** Index in playlist of the currently/last-played segment. */
  let currentIndex = $state(-1)

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
    currentIndex = idx
    return idx
  }

  function goNext(): PlaylistItem | null {
    const nextIdx = currentIndex + 1
    if (nextIdx >= playlist.length) return null
    currentIndex = nextIdx
    return playlist[nextIdx] ?? null
  }

  function goPrev(): PlaylistItem | null {
    const prevIdx = currentIndex - 1
    if (prevIdx < 0) return null
    currentIndex = prevIdx
    return playlist[prevIdx] ?? null
  }

  /** Find index of first segment belonging to a given kind after optional startIdx. */
  function findFirstOfKind(kind: "message" | "thought" | "narration", startIdx = 0): number {
    for (let i = startIdx; i < playlist.length; i++) {
      if (playlist[i]?.kind === kind) return i
    }
    return -1
  }

  /**
   * Phase 8: jump to the first segment of a given bubble (by messageId).
   * Returns the PlaylistItem to start from, or null if not found.
   */
  function jumpToBubble(messageId: string): PlaylistItem | null {
    const idx = playlist.findIndex((s) => s.messageId === messageId)
    if (idx < 0) return null
    currentIndex = idx
    return playlist[idx] ?? null
  }

  /**
   * Phase 8: true if the currently-playing segment belongs to the given bubble.
   */
  function isPlayingBubble(messageId: string): boolean {
    const current = playlist[currentIndex]
    return current !== undefined && current.messageId === messageId
  }

  /**
   * replayLast: jump back to the first message-kind segment that came after
   * the last "user" break (i.e., the most recent assistant response start).
   * Returns the segmentId to start playback from, or null if none.
   */
  function replayLastResponse(): PlaylistItem | null {
    // Find the first message segment (simplistic: last assistant turn starts at index 0 if single turn)
    // For multi-turn support, find the last "message" segment boundary.
    // For now: find first "message" kind in playlist.
    const idx = findFirstOfKind("message", 0)
    if (idx < 0) return null
    currentIndex = idx
    return playlist[idx] ?? null
  }

  function clear(): void {
    playlist = []
    currentIndex = -1
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
    replayLastResponse,
    clear,
  }
}
