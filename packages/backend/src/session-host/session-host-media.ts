import { enrichStreamUpdateWithMedia } from "@drive-coding/core/fs/media-catalog"
import type { Patch, SessionConfigOption, SessionState } from "@drive-coding/core/session"
import { applyPatch, reduce } from "@drive-coding/core/session"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { createMediaStatFn } from "../delivery/media-stat.js"
import type { TurnEndedInfo } from "./agent-events-turn.js"

const mediaStat = createMediaStatFn(process.env.FS_FILE_ALLOWED_BASE)

const TEXT_CHUNK_KINDS = new Set(["agent_message_chunk", "agent_thought_chunk"])

let sessionCwd: string | null = null

export function seedSessionHostCwd(cwd: string | null): void {
  sessionCwd = cwd
}

export function captureSessionHostCwd(cwd: string): void {
  sessionCwd = cwd
}

function mediaHoldKey(update: Record<string, unknown>): string | null {
  const kind = update.sessionUpdate
  if (typeof kind !== "string" || !TEXT_CHUNK_KINDS.has(kind)) return null
  const mid = typeof update.messageId === "string" ? update.messageId : ""
  return `${kind}:${mid}`
}

export type MediaHold = {
  clear(): void
  reduce(
    state: SessionState,
    notification: SessionNotification,
    cwd: string | null,
  ): { state: SessionState; patches: Patch[] }
}

export function createMediaHold(): MediaHold {
  const holds = new Map<string, string>()

  return {
    clear() {
      holds.clear()
    },
    reduce(state, notification, cwd) {
      const raw = notification.update as Record<string, unknown>
      const key = mediaHoldKey(raw)
      const prevHeld = key !== null ? (holds.get(key) ?? "") : ""
      const { update, held: nextHeld } = enrichStreamUpdateWithMedia(raw, prevHeld, cwd, mediaStat)
      if (key !== null) {
        if (nextHeld === "") holds.delete(key)
        else holds.set(key, nextHeld)
      }
      return reduce(state, update)
    },
  }
}

export function reduceSessionNotificationUpdate(
  state: SessionState,
  notification: SessionNotification,
  mediaHold: MediaHold,
  cwd: string | null = sessionCwd,
): { state: SessionState; patches: Patch[] } {
  return mediaHold.reduce(state, notification, cwd)
}

export type MediaHostBinding = {
  hold: MediaHold
  reduce(
    state: SessionState,
    notification: SessionNotification,
    cwd?: string | null,
  ): { state: SessionState; patches: Patch[] }
  clear(): void
}

export function bindSessionMedia(): MediaHostBinding {
  const hold = createMediaHold()
  return {
    hold,
    reduce(state, notification, cwd = sessionCwd) {
      return reduceSessionNotificationUpdate(state, notification, hold, cwd)
    },
    clear() {
      hold.clear()
    },
  }
}

export function wrapTurnEndClear<T extends { state: SessionState; patches: Patch[] }>(
  media: MediaHostBinding,
  emitTurnEnd: (r: T, info: TurnEndedInfo) => void,
): (r: T, info: TurnEndedInfo) => void {
  return (r, info) => {
    media.clear()
    emitTurnEnd(r, info)
  }
}

export function emitSessionSwitchResetMedia(
  media: MediaHostBinding,
  getState: () => SessionState,
  setState: (state: SessionState) => void,
  emitPatches: (patches: Patch[]) => void,
): { oldSessionId: string | null; preResetConfigOptions: SessionConfigOption[] } {
  media.clear()
  const snap = getState()
  const oldSessionId = snap.sessionId
  const preResetConfigOptions = snap.configOptions
  const resetPatch: Patch = {
    op: "reset",
    version: snap.version + 1,
    messages: [],
    nextMessageSeq: 0,
    nextSegmentSeq: 0,
  }
  setState(applyPatch(snap, resetPatch))
  emitPatches([resetPatch])
  return { oldSessionId, preResetConfigOptions }
}

