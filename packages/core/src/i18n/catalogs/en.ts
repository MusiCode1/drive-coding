import type { Catalog } from "../keys.js"

/**
 * קטלוג אנגלית — שלד. התרגומים הם placeholder; לשפר כאשר
 * נשלח ממשק משתמש באנגלית בפועל. הקטלוג חייב להיות שלם (כל המפתחות
 * נוכחים) כדי שמערכת הטיפוסים תוכל לאכוף כיסוי בזמן קומפילציה.
 *
 * הוסף מפתחות חדשים בבלוקי domain למטה — ראה
 * docs/conventions/parallel-safe-code.md (טכניקה #4: קטלוגים append-only).
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
  // ─── slice 16 (ACP content) ───
  "chat.tool.raw": "Raw output",
  "chat.tool.locations": "Files",
  "chat.tool.content": "Content",
  "chat.tool.terminal": "Terminal",
  "chat.tool.diff.added": "Added",
  "chat.tool.diff.removed": "Removed",
  // ─── audio-cues ─── (slice 6)
  // ─── car-mode ─── (slice 7)
  // ─── sessions ─── (slice 8)
  "sessions.loadButton": "Load recent sessions",
  "sessions.loading": "Loading…",
  "sessions.label": "Existing session",
  "sessions.startNew": "New",
  "sessions.error": "Failed to load",
  // ─── settings ─── (slice 9)
  "settings.title": "Settings",
  "settings.beUrl.label": "Backend URL",
  "settings.beUrl.help":
    "Leave empty in dev mode. In production (Cloudflare) enter the full BE URL.",
  "settings.beUrl.invalid": "Invalid URL",
  "settings.beUrl.saved": "Saved ✓",
  "settings.back": "Back",
  // ─── recordings ─── (slice 10)
  // ─── agent-options ─── (slice 23)
  "agentOptions.title": "Session options",
  "agentOptions.model.label": "Model",
  "agentOptions.agent.label": "Agent",
}
