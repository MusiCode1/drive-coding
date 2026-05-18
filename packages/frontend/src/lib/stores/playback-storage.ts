/**
 * playback-storage.ts — localStorage persistence for playback state.
 *
 * TTL: 24h. Saved on currentSegmentIndex change (debounced 1s).
 * Loaded on agent mount.
 *
 * Key: "voice-acp:playback:<agentId>"
 */

const KEY_PREFIX = "voice-acp:playback:"
const TTL_MS = 24 * 60 * 60 * 1000

export type PlaybackState = {
  agentId: string
  sessionId: string | null
  currentSegmentIndex: number
  playedSegmentIds: string[]
  updatedAt: number
}

export function loadPlaybackState(agentId: string): PlaybackState | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + agentId)
    if (!raw) return null
    const state = JSON.parse(raw) as PlaybackState
    if (Date.now() - state.updatedAt > TTL_MS) {
      localStorage.removeItem(KEY_PREFIX + agentId)
      return null
    }
    return state
  } catch {
    return null
  }
}

export function savePlaybackState(state: PlaybackState): void {
  try {
    localStorage.setItem(
      KEY_PREFIX + state.agentId,
      JSON.stringify({ ...state, updatedAt: Date.now() }),
    )
  } catch {
    // quota exceeded or storage unavailable — ignore
  }
}

export function clearPlaybackState(agentId: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + agentId)
  } catch {
    // ignore
  }
}

/**
 * createPlaybackStorageSync — debounced sync between player index and localStorage.
 * Returns a function to call when currentIndex changes, and a cleanup function.
 */
export function createPlaybackStorageSync(agentId: string, sessionId: () => string | null) {
  let timer: ReturnType<typeof setTimeout> | null = null

  function sync(currentSegmentIndex: number, playedSegmentIds: string[]): void {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      savePlaybackState({
        agentId,
        sessionId: sessionId(),
        currentSegmentIndex,
        playedSegmentIds,
        updatedAt: Date.now(),
      })
    }, 1000)
  }

  function destroy(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  return { sync, destroy }
}
