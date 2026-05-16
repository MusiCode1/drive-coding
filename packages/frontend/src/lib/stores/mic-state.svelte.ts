/**
 * mic-state.svelte.ts — Slice 7 Drive-First UX
 *
 * deriveMicState: pure function — given the raw boolean states of the voice
 * pipeline, returns the canonical 5-state MicState for the big button.
 *
 * Priority order (highest first):
 *  1. cancelling — explicit cancel in progress
 *  2. recording  — actively recording microphone input
 *  3. speaking   — audio is playing back (TTS)
 *  4. processing — STT + ACP thinking (waiting for first audio chunk)
 *  5. idle       — nothing happening
 *
 * Note: when both isThinking and isAudioPlaying are true, we show "speaking"
 * because the model already produced audio — visually most informative.
 */

export type MicState = "idle" | "recording" | "processing" | "speaking" | "cancelling"

export interface MicStateInput {
  isRecording: boolean
  isThinking: boolean
  isAudioPlaying: boolean
  isCancelling: boolean
}

export function deriveMicState(input: MicStateInput): MicState {
  const { isRecording, isThinking, isAudioPlaying, isCancelling } = input

  if (isCancelling) return "cancelling"
  if (isRecording) return "recording"
  if (isAudioPlaying) return "speaking"
  if (isThinking) return "processing"
  return "idle"
}

/** Status text shown below the mic button. */
export const MIC_STATUS_TEXT: Record<MicState, string> = {
  idle: "לחצי על הכפתור כדי לדבר",
  recording: "מקליט...",
  processing: "מעבד...",
  speaking: "מקריא תשובה",
  cancelling: "מבטל...",
}

/** Emoji icons for each mic state. */
export const MIC_ICONS: Record<MicState, string> = {
  idle: "🎙",
  recording: "⏺",
  processing: "🌀",
  speaking: "🔊",
  cancelling: "✕",
}
