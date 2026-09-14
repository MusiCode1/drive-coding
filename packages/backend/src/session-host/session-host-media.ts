import { enrichUpdateWithMedia } from "@drive-coding/core/fs/media-catalog"
import type { Patch, SessionState } from "@drive-coding/core/session"
import { reduce } from "@drive-coding/core/session"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { createMediaStatFn } from "../delivery/media-stat.js"

const mediaStat = createMediaStatFn(process.env.FS_FILE_ALLOWED_BASE)

let sessionCwd: string | null = null

export function seedSessionHostCwd(cwd: string | null): void {
  sessionCwd = cwd
}

export function captureSessionHostCwd(cwd: string): void {
  sessionCwd = cwd
}

export function reduceSessionNotificationUpdate(
  state: SessionState,
  notification: SessionNotification,
  cwd: string | null = sessionCwd,
): { state: SessionState; patches: Patch[] } {
  const update = enrichUpdateWithMedia(
    notification.update as Record<string, unknown>,
    cwd,
    mediaStat,
  )
  return reduce(state, update)
}
