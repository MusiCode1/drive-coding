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
  // ─── mic retry ─── (slice sessions-inline)
  "mic.retry": "Try again",

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
  "sessions.label": "Select session",
  "sessions.startNew": "New",
  "sessions.error": "Failed to load",
  // ─── sessions-refresh ─── (ui-polish-batch · C11)
  "sessions.refresh": "Refresh",
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
  "agentOptions.model.other": "Other",
  "agentOptions.agent.label": "Agent",
  "agentOptions.mode.label": "Mode",
  // CLI-provided config-option name translations (identity in English).
  "configName.agent": "Agent",
  "configName.mode": "Mode",
  "configName.sessionMode": "Session Mode",
  "configName.approvalPreset": "Approval Preset",
  "configName.model": "Model",
  "configName.effort": "Effort",
  "configName.reasoningEffort": "Reasoning Effort",
  // ─── smart-scroll ─── (redesign-7)
  "chat.jumpDown": "New messages",
  // ─── modals ─── (redesign-6)
  "modal.sessions.title": "Recent sessions",
  "modal.sessions.refresh": "Refresh",
  "modal.sessions.new": "New session",
  "modal.sessions.loading": "Loading sessions…",
  "modal.sessions.error": "Failed to load sessions",
  "modal.sessions.empty": "No sessions",
  "modal.folder.title": "Select folder",
  "modal.folder.pick": "Choose this folder",
  "modal.folder.up": "Up",
  "modal.folder.loading": "Loading…",
  "modal.folder.error": "Failed to load folders",
  "modal.folder.showHidden": "Show hidden folders",
  "modal.close": "Close",
  // ─── record-footer ─── (redesign-4)
  "record.tab.record": "Record",
  "record.tab.type": "Type",
  "record.tab.hide": "Hidden",
  "record.status.idle": "Tap to record",
  "record.send": "Send",
  "record.placeholder": "Type a prompt…",
  "record.reconnect": "Reconnect",
  "record.reconnecting": "Reconnecting…",
  "record.reconnectAttempt": "attempt",
  "mic.stop": "Stop",
  // ─── settings-redesign ─── (redesign-3)
  "settings.connection": "Connection",
  "settings.voiceSpeech": "Voice & Speech",
  "settings.folder.label": "Working directory",
  "settings.folder.pick": "Browse…",
  "settings.model.label": "Model",
  "settings.session.label": "Session",
  "settings.voice.label": "TTS Voice",
  "settings.toggle.speakThoughts": "Speak model thoughts",
  "settings.toggle.narrateTools": "Narrate tool actions",
  "settings.toggle.translateThoughts": "Translate thoughts to Hebrew",
  "settings.toggle.carMode": "Car mode (Play on Bluetooth = record)",
  "settings.reset": "Reset",
  "settings.saveOpen": "Save & Open",
  // ─── language ─── (rtl-ltr-bidi)
  "settings.language.label": "Interface language",
  "settings.language.he": "Hebrew",
  "settings.language.en": "English",
  // ─── layout/header ─── (redesign-2)
  "header.menu": "Menu",
  "header.settings": "Settings",
  "header.connected": "Connected",
  "header.disconnect": "Disconnect",
  "header.audioOn": "Mute audio",
  "header.audioOff": "Unmute audio",
  "sidebar.collapse": "Collapse panel",
  "sidebar.agentOptions": "Agent options",
  "sidebar.sessions": "Sessions",
  "sidebar.refresh": "Refresh",
  "sidebar.newSession": "New session",
  "sheet.handle": "Drag to open",
  // ─── bubble-play ─── (msr-v2)
  "bubble.play": "Play",
  "bubble.stop": "Stop playback",
  // ─── bubble-copy ─── (ui-polish-batch · C3)
  "bubble.copy": "Copy",
  "bubble.copied": "Copied!",
  // ─── model-status ─── (msr-v2)
  "modelStatus.waiting": "Waiting…",
  "modelStatus.thinking": "Thinking…",
  "modelStatus.responding": "Responding…",
  "modelStatus.callingTool": "Running tool…",
  "modelStatus.pendingTts": "Preparing audio…",
  "modelStatus.speaking": "Speaking…",
  // ─── theme ─── (palettes-expansion)
  "settings.theme.label": "Theme",
  "settings.theme.ember": "Ember",
  "settings.theme.forest": "Forest",
  "settings.theme.plum": "Plum",
  "settings.theme.teal": "Teal",
  "settings.theme.midnight": "Midnight",
  "settings.theme.rose": "Rose",
  "settings.theme.slate": "Slate",
  "settings.theme.daylight": "Daylight",
  // ─── active-agents ─── (slice active-agents-widget)
  "connect.agents.title": "Active processes",
  "connect.agents.empty": "No active processes",
  "connect.agents.refresh": "Refresh",
  "connect.agents.reconnect": "Reconnect",
  "connect.agents.kill": "Kill",
  "connect.agents.killConfirm": "Sure?",
  "connect.agents.inUse": "Open in another tab",
  // ─── agent-busy-indicator ─── (slice agent-busy-indicator)
  "connect.agents.working": "working…",
  // ─── agent-last-message-ui ─── (slice agent-last-message-ui)
  "connect.agents.lastMessage": "Last activity",
  // ─── מסך / wake-lock ─── (slice-wake-lock)
  "settings.screen.label": "Screen",
  "settings.toggle.keepScreenOn": "Keep screen on",
  // ─── chat display prefs ─── (display-toggle-consistency)
  "settings.chatDisplay": "Chat display",
  "settings.toggle.showThoughts": "Show thoughts by default",
  "settings.toggle.showTools": "Show tools by default",
  // ─── Enter toggle ─── (slice-enter-toggle)
  "settings.toggle.enterToSend": "Enter sends message",
  // ─── content-viewer ─── (slice content-viewer)
  "contentViewer.title": "View",
  "contentViewer.expand": "Expand",
  "contentViewer.close": "Close",
  // ─── TTS provider ─── (V4a-gemini-tts-pcm-playback)
  "settings.ttsProvider.label": "TTS provider",
  "settings.ttsProvider.elevenlabs": "ElevenLabs",
  "settings.ttsProvider.gemini": "Gemini",
}
