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
  // slice cli-availability
  "connect.cli.loading": "Checking availability…",
  "connect.cli.showAll": "Couldn't check availability — showing all CLIs",
  // slice cli-availability (re-scope)
  "connect.cli.notInstalled": "(not installed)",
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
  // ─── subagent-bubble ─── (slice subagent-transcript-render)
  "chat.subagent.status.pending": "Pending",
  "chat.subagent.status.in_progress": "In progress",
  "chat.subagent.status.completed": "Completed",
  "chat.subagent.status.failed": "Failed",
  "chat.subagent.status.unknown": "Unknown",
  "chat.subagent.prompt": "Task",
  "chat.subagent.summary": "Summary",
  "chat.subagent.transcript": "Subagent activity",
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
  "settings.version": "Version:",
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
  // ─── cli-name-in-chat ─── (slice cli-name-in-chat)
  "sidebar.runningOn": "Running on",
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
  // ─── image-attach tray ─── (slice-image-paste)
  "attach.addImage": "Add image",
  "attach.remove": "Remove",
  // ─── image-paste replay (§11) — placeholder for non-text ContentBlocks ───
  "chat.content.attachedFile": "Attached file",
  "chat.content.unsupported": "Unsupported content",
  // ─── recent-projects ─── (slice connect-recent-projects)
  "connect.recent.title": "Recent folders",
  "connect.recent.empty": "No recent folders",
  "connect.recent.refresh": "Refresh",
  // ─── recent-projects controls ─── (slice recent-projects-controls)
  "connect.recent.remove": "Remove from list",
  "connect.recent.collapse": "Collapse",
  "connect.recent.expand": "Expand",
  // ─── leave-running (slice leave-running-background) ───
  "session.leaveRunning": "Leave — keep running",
  "session.closeSession": "Shut the process down completely",
  "session.leaveWarning.title": "Agent will keep running",
  "session.leaveWarning.body":
    "The run will stall when a permission request arrives, because the browser is the ACP client. To prevent stalling: switch to bypass-permissions mode before leaving.",
  "session.leaveWarning.confirm": "Leave anyway",
  "session.leaveWarning.cancel": "Cancel",
  "session.leaveWarning.dontShowAgain": "Don't show this message again",
  // ─── thinking-tokens ─── (slice FEAT-thinking-live)
  "agentOptions.thinking.label": "Thinking",
  "agentOptions.thinking.off": "Off",
  "agentOptions.thinking.low": "Low",
  "agentOptions.thinking.medium": "Medium",
  "agentOptions.thinking.high": "High",
  // ─── gemini voice picker ─── (V4b-gemini-voice-picker)
  "settings.geminiVoice.label": "Gemini voice",
  "settings.geminiVoice.desc.Zephyr": "Bright",
  "settings.geminiVoice.desc.Puck": "Upbeat",
  "settings.geminiVoice.desc.Charon": "Informative",
  "settings.geminiVoice.desc.Kore": "Firm",
  "settings.geminiVoice.desc.Fenrir": "Excitable",
  "settings.geminiVoice.desc.Leda": "Youthful",
  "settings.geminiVoice.desc.Orus": "Firm",
  "settings.geminiVoice.desc.Aoede": "Breezy",
  "settings.geminiVoice.desc.Callirrhoe": "Easy-going",
  "settings.geminiVoice.desc.Autonoe": "Bright",
  "settings.geminiVoice.desc.Enceladus": "Breathy",
  "settings.geminiVoice.desc.Iapetus": "Clear",
  "settings.geminiVoice.desc.Umbriel": "Easy-going",
  "settings.geminiVoice.desc.Algieba": "Smooth",
  "settings.geminiVoice.desc.Despina": "Smooth",
  "settings.geminiVoice.desc.Erinome": "Clear",
  "settings.geminiVoice.desc.Algenib": "Gravelly",
  "settings.geminiVoice.desc.Rasalgethi": "Informative",
  "settings.geminiVoice.desc.Laomedeia": "Upbeat",
  "settings.geminiVoice.desc.Achernar": "Soft",
  "settings.geminiVoice.desc.Alnilam": "Firm",
  "settings.geminiVoice.desc.Schedar": "Even",
  "settings.geminiVoice.desc.Gacrux": "Mature",
  "settings.geminiVoice.desc.Pulcherrima": "Forward",
  "settings.geminiVoice.desc.Achird": "Friendly",
  "settings.geminiVoice.desc.Zubenelgenubi": "Casual",
  "settings.geminiVoice.desc.Vindemiatrix": "Gentle",
  "settings.geminiVoice.desc.Sadachbia": "Lively",
  "settings.geminiVoice.desc.Sadaltager": "Knowledgeable",
  "settings.geminiVoice.desc.Sulafat": "Warm",
  // ─── tts-provider-availability ─── (slice tts-provider-availability)
  "settings.ttsProvider.unavailable": "This provider is unavailable (missing or invalid key)",
  "settings.ttsProvider.fallbackNotice": "Switched to the available provider",
  "settings.ttsProvider.allUnavailable": "No TTS provider available — check your keys",
  // ─── tts-status-ui ─── (slice tts-status-ui)
  "settings.ttsStatus.title": "TTS Status",
  "settings.ttsStatus.loading": "Loading...",
  "settings.ttsStatus.reason.quota": "Quota exhausted",
  "settings.ttsStatus.reason.noKey": "Missing API key",
  "settings.ttsStatus.reason.forbidden": "Key not authorized",
  "settings.ttsStatus.reason.error": "Connection error",
  "settings.ttsStatus.quota.label": "ElevenLabs quota",
  "settings.ttsStatus.quota.exhausted": "Exhausted",
  "settings.ttsStatus.quota.used": "Used",
  "settings.ttsStatus.quota.limitLabel": "Limit",
  "settings.ttsStatus.quota.overage": "Overage",
  "settings.ttsStatus.usage.label": "Usage (total since startup)",
  "settings.ttsStatus.usage.elevenlabs": "ElevenLabs",
  "settings.ttsStatus.usage.gemini": "Gemini",
  "settings.ttsStatus.usage.cache": "Cache hits",
  "settings.ttsStatus.usage.cost": "Est. cost",
  "settings.ttsStatus.usage.notAvailable": "—",
  "settings.ttsStatus.refresh": "Refresh",
  // ─── ui-session-polish ─── (slice ui-session-polish)
  "session.copyId": "Copy session ID",
  "modal.loading.session": "Loading session…",
  // ─── app-title ─── (slice app-title-build-env)
  "appTitle.settings": "Settings",
  "appTitle.sessions": "Sessions",
  // ─── slash commands ─── (slice-slash-commands)
  "slash.commandsList": "Slash commands",
  // ─── session budget meter ─── (slice session-budget-meter)
  "sessionBudget.trigger": "Session budget",
  "sessionBudget.title": "Session budget",
  "sessionBudget.context.heading": "Context",
  "sessionBudget.context.cost": "Cost",
  "sessionBudget.quota.heading": "Quota",
  "sessionBudget.quota.loading": "Loading…",
  "sessionBudget.quota.unavailable": "No quota data",
  "sessionBudget.quota.used": "Used",
  "sessionBudget.quota.of": "of",
  "sessionBudget.quota.resetsIn": "Resets",
  // ─── plan ─── (slice plan-todo-list)
  "plan.title": "Plan",
  "plan.status.pending": "Pending",
  "plan.status.in_progress": "In progress",
  "plan.status.completed": "Completed",
  "plan.openMarkdown": "Open plan",
  "plan.file.label": "Plan file",
  // ─── projectPrompt ─── (slice project-system-prompt)
  "projectPrompt.label": "Project system prompt",
  "projectPrompt.placeholder": "e.g. Always reply concisely, and open every answer in Hebrew...",
  "projectPrompt.hint": "Appended to the agent's default instructions. Takes effect from the next session.",
  // ─── panel resize handle ─── (slice connect-panel-resize)
  "connect.panel.resizeHandle": "Drag to resize",
  // ─── machine-stats ─── (slice-be-machine-stats)
  "connect.machine.memory": "Memory",
  "connect.machine.cpu": "CPU",
  "connect.machine.label": "Machine load",
  // ─── session delete ─── (slice session-delete)
  "session.delete": "Delete",
  "session.deleteConfirm": "Sure? Delete session",
  // ─── permission ─── (slice-permission-ui-basic)
  "permission.title": "Permission request",
  "permission.allowOnce": "Allow once",
  "permission.allowAlways": "Always allow",
  "permission.reject": "Reject",
  "permission.pending": "Awaiting decision",
  // ─── elicitation ─── (slice-elicitation-ui)
  "elicitation.accept": "Submit",
  "elicitation.decline": "Decline",
  "elicitation.cancel": "Cancel",
  "elicitation.required": "Required",
  // ─── auth guidance ─── (slice auth-guidance)
  "authGuidance.heading": "How to authenticate with",
  "authGuidance.envVar.setLabel": "Set:",
  "authGuidance.envVar.linkLabel": "Get credentials",
}
