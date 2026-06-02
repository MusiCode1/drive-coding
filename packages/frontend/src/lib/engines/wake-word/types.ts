/**
 * types.ts — טיפוסים ו-ArkType schemas עבור wake-word engine.
 */

import { type } from "arktype"

// ─── Config ──────────────────────────────────────────────────────────────────

export const WakeWordConfigSchema = type({
  keywords: "string[]",
  baseAssetUrl: "string",
  "thresholds?": type({
    "detect?": "number",
    "vad?": "number",
  }),
  "cooldownMs?": "number",
  "vadHangoverFrames?": "number",
  "gain?": "number",
})

export type WakeWordConfig = typeof WakeWordConfigSchema.infer

// ─── Model file map (רק keywords שנתמכים — לא timer/weather) ─────────────────

export const MODEL_FILE_MAP: Record<string, string> = {
  alexa: "alexa_v0.1.onnx",
  hey_mycroft: "hey_mycroft_v0.1.onnx",
  hey_jarvis: "hey_jarvis_v0.1.onnx",
  hey_rhasspy: "hey_rhasspy_v0.1.onnx",
} as const

// ─── Event payload types ──────────────────────────────────────────────────────

export interface DetectEvent {
  keyword: string
  score: number
  sinceVadStart: number | null
}

export interface VadEndEvent {
  frames: number | null
}

export type WakeWordEventMap = {
  ready: void
  frame: Float32Array
  level: number
  vadStart: void
  vadEnd: VadEndEvent
  detect: DetectEvent
  score: { scores: Record<string, number> }
  error: Error
}
