import type { Catalog } from "../keys.js"

/**
 * English catalog — scaffold. Translations are placeholders; refine when
 * we actually ship an English UI. The catalog must be complete (all keys
 * present) so the type system can enforce coverage at compile time.
 *
 * Append new keys in domain blocks below — see
 * docs/conventions/parallel-safe-code.md (technique #4: append-only catalogs).
 */
export const en: Catalog = {
  // ─── connect ─── (slice 0)
  "connect.title": "drive-coding v2",
  "connect.subtitle": "Connect to a CLI agent",
  "connect.cli.label": "CLI",
  "connect.cwd.label": "Working directory",
  "connect.cwd.placeholder": "/home/user/projects/X",
  "connect.submit": "Connect",
  "connect.submitting": "Connecting…",
  "connect.error.prefix": "Error:",

  // ─── chat ─── (slice 0.5 + slice 2)
  "chat.bubble.user": "Me",
  "chat.bubble.thought": "Thought",
  "chat.bubble.agent": "Agent",
  "chat.empty": "Start typing below…",
  "chat.prompt.placeholder": "Type a prompt…",
  "chat.send": "Send",
  "chat.disconnect": "Disconnect",
  "chat.audioToggle": "Audio",

  // ─── voice picker ─── (slice 9)
  "chat.voicePicker.label": "Voice",
  "chat.voicePicker.loading": "Loading voices…",
  "chat.voicePicker.error": "Failed to load voices",

  // ─── mic ─── (slice 3)
  "mic.error.permission": "Microphone access denied. Allow access in browser settings.",
  "mic.error.notFound": "No microphone found. Connect a microphone and try again.",
  "mic.error.transcribe": "Transcription failed. Please try again.",
  "mic.error.generic": "Microphone error. Please try again.",

  // ─── voice-mode ─── (slice 3)
  "voiceMode.status.idle": "Microphone",
  "voiceMode.status.recording": "Recording…",
  "voiceMode.status.transcribing": "Transcribing…",
  "voiceMode.status.thinking": "Thinking…",
  "voiceMode.status.speaking": "Speaking…",
  "voiceMode.status.cancelling": "Cancelling…",
  // ─── tool-bubble ─── (slice 4)
  "chat.tool.status.pending": "Pending",
  "chat.tool.status.in_progress": "In progress",
  "chat.tool.status.completed": "Completed",
  "chat.tool.status.failed": "Failed",
  "chat.tool.args": "Input",
  "chat.tool.result": "Output",
  "chat.tool.loading_narration": "...",
  // ─── audio-cues ─── (slice 6)
  // ─── car-mode ─── (slice 7)
  // ─── sessions ─── (slice 8)
  "sessions.loadButton": "Load recent sessions",
  "sessions.loading": "Loading…",
  "sessions.label": "Existing session",
  "sessions.startNew": "New",
  "sessions.error": "Failed to load",
  // ─── settings ─── (slice 9)
  // ─── recordings ─── (slice 10)
}
