/**
 * pending-capture.ts — pure types for failed/pending voice capture persistence.
 * (slice voice-pending-persistence, Commit 0)
 */
import { type } from "arktype"
import type { MessageKey } from "../i18n/keys.js"

export const pendingCaptureSource = type("'mic' | 'dictate'")
export type PendingCaptureSource = typeof pendingCaptureSource.infer

export const pendingCaptureSchema = type({
  id: "string",
  source: pendingCaptureSource,
  mimeType: "string",
  createdAt: "string",
  recordingId: "string",
  "transcribedText?": "string",
  "lastError?": "string",
})

export type PendingCapture = {
  id: string
  source: PendingCaptureSource
  mimeType: string
  createdAt: string
  recordingId: string
  transcribedText?: string
  lastError?: MessageKey
}

export function parsePendingCapture(value: unknown): PendingCapture | null {
  const result = pendingCaptureSchema(value)
  if (result instanceof type.errors) return null
  return result as PendingCapture
}

export type PendingCaptureStore = {
  load(): Promise<{ capture: PendingCapture; blob: Blob } | null>
  save(capture: PendingCapture, blob: Blob): Promise<void>
  updateMeta(id: string, patch: Partial<PendingCapture>): Promise<void>
  remove(id: string): Promise<void>
}
