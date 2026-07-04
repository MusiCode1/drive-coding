/**
 * playlist-decision.ts — pure decision core for the audio playlist.
 * No IO, no browser globals, no timers. The FE engine builds a snapshot
 * and interprets the returned action.
 */

export type FetchState = "idle" | "in-flight" | "failed"

export type SegmentFacts = {
  readonly segmentId: string
  /** Production status — derived by the shell (R1: from item.state+needsRefetch). */
  readonly fetch: FetchState
  /** Sink has enough buffer to start playing (pcm: first chunk; mp3: complete). */
  readonly playable: boolean
  /** Sink holds the full buffer — replay without re-fetch. */
  readonly buffered: boolean
  /** Finished a full natural playback at least once (display / future smart-advance). */
  readonly playedToEnd: boolean
  /** Shell-measured: waited on this fetch longer than the reserve timeout. */
  readonly waitedTooLong: boolean
}

export type PlaylistTransport = "playing" | "paused" | "stopped"

export type PlaylistSnapshot = {
  readonly items: readonly SegmentFacts[]
  readonly cursor: number
  readonly transport: PlaylistTransport
  /** True when the cursor landed here via explicit navigation (retry failed items). */
  readonly explicitVisit: boolean
}

export type PlaylistAction =
  | { kind: "exit" }                          // transport stopped — loop terminates
  | { kind: "wait" }                          // paused — sleep until change
  | { kind: "park" }                          // cursor past end — idle-park until change
  | { kind: "play"; index: number }           // sink.play(items[index])
  | { kind: "request-fetch"; index: number }  // ask producer to (re)synthesize, then wait
  | { kind: "wait-fetch"; index: number }     // fetch in flight — sleep until change/timeout
  | { kind: "skip"; index: number }           // give up on item — advance cursor

/**
 * Decide what the playlist loop should do next.
 * Rules are checked in strict priority order (1–9).
 */
export function decidePlaylistAction(s: PlaylistSnapshot): PlaylistAction {
  // Rule 1: transport=stopped → exit
  if (s.transport === "stopped") return { kind: "exit" }

  // Rule 2: transport=paused → wait
  if (s.transport === "paused") return { kind: "wait" }

  // Rule 3: cursor past end (or empty) → park
  if (s.cursor >= s.items.length) return { kind: "park" }

  // Rule 4: item at cursor is undefined (sparse array) → skip
  const item = s.items[s.cursor]
  if (item === undefined) return { kind: "skip", index: s.cursor }

  // Rule 5: playable or buffered → play (covers first-play and replay)
  if (item.playable || item.buffered) return { kind: "play", index: s.cursor }

  // Rule 6: playedToEnd but buffer gone → skip (auto-advance)
  // Note: explicit re-visit is handled by applyNavigation.resetToPending, not here.
  if (item.playedToEnd) return { kind: "skip", index: s.cursor }

  // Rule 7: fetch in-flight → wait or skip on timeout
  if (item.fetch === "in-flight") {
    if (item.waitedTooLong) return { kind: "skip", index: s.cursor }
    return { kind: "wait-fetch", index: s.cursor }
  }

  // Rule 8: fetch failed → retry if explicit visit, else skip
  if (item.fetch === "failed") {
    if (s.explicitVisit) return { kind: "request-fetch", index: s.cursor }
    return { kind: "skip", index: s.cursor }
  }

  // Rule 9: fetch=idle, nothing special → start fetching
  return { kind: "request-fetch", index: s.cursor }
}

export type NavigationDecision = {
  readonly cursor: number
  /** Segment ids whose sink buffers / live fetches must be cancelled (skip-cancel). */
  readonly cancel: readonly string[]
  /** Segment ids to mark "needs re-synthesis on next visit" (R1: reserved+needsRefetch). */
  readonly resetToPending: readonly string[]
}

/**
 * Decide what happens to segments when the cursor jumps to a new position.
 *
 * - target out of range → no-op (cursor unchanged, nothing cancelled).
 * - current item (at s.cursor): if !buffered → cancel + resetToPending.
 * - target item (if resetTarget && target !== current): if !buffered → cancel + resetToPending.
 * - cursor = target.
 *
 * Semantics: next → resetTarget=false; prev/jumpTo/jumpToBubble → resetTarget=true.
 */
export function applyNavigation(
  s: PlaylistSnapshot,
  target: number,
  resetTarget: boolean,
): NavigationDecision {
  // Out-of-range target → no-op
  if (target < 0 || target >= s.items.length) {
    return { cursor: s.cursor, cancel: [], resetToPending: [] }
  }

  const cancel: string[] = []
  const resetToPending: string[] = []

  // Self-navigation (target === cursor): no-op — nothing to cancel or reset
  if (target === s.cursor) {
    return { cursor: target, cancel: [], resetToPending: [] }
  }

  const currentItem = s.items[s.cursor]
  const targetItem = s.items[target]

  // Current item: if not buffered → cancel + reset
  if (currentItem !== undefined) {
    if (!currentItem.buffered) {
      cancel.push(currentItem.segmentId)
      resetToPending.push(currentItem.segmentId)
    }
  }

  // Target item: only if resetTarget=true
  if (targetItem !== undefined && resetTarget) {
    if (!targetItem.buffered) {
      cancel.push(targetItem.segmentId)
      resetToPending.push(targetItem.segmentId)
    }
  }

  return { cursor: target, cancel, resetToPending }
}
