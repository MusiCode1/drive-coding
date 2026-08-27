/**
 * MessageKey — מקור האמת היחיד לכל מחרוזות ה-UI.
 *
 * הוספת מחרוזת חדשה:
 *   1. הוסף את המפתח לבלוק `// ─── <domain> ───` המתאים למטה.
 *      אם אין בלוק מתאים, הוסף בלוק חדש **בסוף** האיחוד (union).
 *   2. הוסף את התרגום ב-catalogs/he.ts (חובה) וב-catalogs/en.ts
 *      (פלייסולדר מספיק) — באותו בלוק דומיין.
 *   3. השתמש באמצעות `t("your.key")`.
 *
 * לעולם אל תשלב עברית (או כל טקסט UI אחר) ישירות בקוד. סקריפט ה-lint
 * `scripts/lint-no-hebrew-in-code.sh` אוכף זאת.
 *
 * ─── עיצוב תוספתי בטוח למקביליות ───
 * שני slices שמוסיפים מפתחות נוחתים בבלוקים שונים → git auto-merge.
 */

export type Locale = "he" | "en"

export const LOCALES: readonly Locale[] = ["he", "en"]

export type MessageKey =
  // ─── connect ─── (slice 0)
  | "connect.title"
  | "connect.subtitle"
  | "connect.cli.label"
  // slice cli-availability: מצב טעינה + fallback ב-dropdown הספקים
  | "connect.cli.loading"
  | "connect.cli.showAll"
  // slice cli-availability (re-scope): תווית ל-option disabled בדropdown (לא מותקן)
  | "connect.cli.notInstalled"
  // slice cli-specs-hot-reload: refresh button label next to the CLI dropdown
  | "connect.cli.refresh"
  | "connect.cwd.label"
  | "connect.cwd.placeholder"
  | "connect.submit"
  | "connect.submitting"
  | "connect.error.prefix"
  // ─── chat ─── (slice 0.5 + slice 2)
  | "chat.bubble.user"
  | "chat.bubble.thought"
  | "chat.bubble.agent"
  | "chat.empty"
  | "chat.error.dismiss"
  | "chat.prompt.placeholder"
  | "chat.send"
  | "chat.disconnect"
  | "chat.audioToggle"
  // ─── voice picker ─── (slice 9 — voice selection)
  | "chat.voicePicker.label"
  | "chat.voicePicker.loading"
  | "chat.voicePicker.error"
  // ─── mic ─── (slice 3)
  | "mic.error.permission"
  | "mic.error.notFound"
  | "mic.error.transcribe"
  | "mic.error.generic"
  // ─── mic retry ─── (slice sessions-inline)
  | "mic.retry"
  // ─── voice-mode ─── (slice 3)
  | "voiceMode.status.idle"
  | "voiceMode.status.recording"
  | "voiceMode.status.transcribing"
  | "voiceMode.status.thinking"
  | "voiceMode.status.speaking"
  | "voiceMode.status.cancelling"
  // ─── tool-bubble ─── (slice 4)
  | "chat.tool.status.pending"
  | "chat.tool.status.in_progress"
  | "chat.tool.status.completed"
  | "chat.tool.status.failed"
  | "chat.tool.args"
  | "chat.tool.result"
  | "chat.tool.loading_narration"
  // ─── slice 16 (ACP content) ───
  | "chat.tool.raw"
  | "chat.tool.locations"
  | "chat.tool.content"
  | "chat.tool.terminal"
  | "chat.tool.diff.added"
  | "chat.tool.diff.removed"
  // ─── subagent-bubble ─── (slice subagent-transcript-render)
  | "chat.subagent.status.pending"
  | "chat.subagent.status.in_progress"
  | "chat.subagent.status.completed"
  | "chat.subagent.status.failed"
  | "chat.subagent.status.unknown"
  | "chat.subagent.prompt"
  | "chat.subagent.summary"
  | "chat.subagent.transcript"
  // ─── audio-cues ─── (slice 6)
  // ─── car-mode ─── (slice 7)
  // ─── sessions ─── (slice 8)
  | "sessions.loadButton"
  | "sessions.loading"
  | "sessions.label"
  | "sessions.startNew"
  | "sessions.error"
  // ─── sessions-refresh ─── (ui-polish-batch · C11)
  | "sessions.refresh"
  // ─── settings ─── (slice 9)
  | "settings.title"
  | "settings.beUrl.label"
  | "settings.beUrl.help"
  | "settings.beUrl.invalid"
  | "settings.beUrl.saved"
  | "settings.back"
  // ─── recordings ─── (slice 10)
  // ─── agent-options ─── (slice 23)
  | "agentOptions.title"
  | "agentOptions.model.label"
  | "agentOptions.model.other"
  | "agentOptions.agent.label"
  | "agentOptions.mode.label"
  | "configName.agent"
  | "configName.mode"
  | "configName.sessionMode"
  | "configName.approvalPreset"
  | "configName.model"
  | "configName.effort"
  | "configName.reasoningEffort"
  // ─── smart-scroll ─── (redesign-7)
  | "chat.jumpDown"
  // ─── modals ─── (redesign-6)
  | "modal.sessions.title"
  | "modal.sessions.refresh"
  | "modal.sessions.new"
  | "modal.sessions.loading"
  | "modal.sessions.error"
  | "modal.sessions.empty"
  | "modal.folder.title"
  | "modal.folder.pick"
  | "modal.folder.up"
  | "modal.folder.loading"
  | "modal.folder.error"
  | "modal.folder.showHidden"
  | "modal.close"
  // ─── record-footer ─── (redesign-4)
  | "record.tab.record"
  | "record.tab.type"
  | "record.tab.hide"
  | "record.status.idle"
  | "record.send"
  | "record.placeholder"
  | "record.reconnect"
  | "record.reconnecting"
  | "record.reconnectAttempt"
  | "mic.stop"
  | "mic.discard"
  // ─── speakable (slice tts-speakable-text) — מה שנאמר במקום קוד/קישור ───
  | "speakable.codeBlock"
  | "speakable.link"
  | "speakable.image"
  // ─── settings-redesign ─── (redesign-3)
  | "settings.connection"
  | "settings.voiceSpeech"
  | "settings.folder.label"
  | "settings.folder.pick"
  | "settings.model.label"
  | "settings.session.label"
  | "settings.voice.label"
  | "settings.toggle.speakThoughts"
  | "settings.toggle.narrateTools"
  | "settings.toggle.translateThoughts"
  | "settings.toggle.carMode"
  | "settings.reset"
  | "settings.saveOpen"
  | "settings.version"
  // ─── language ─── (rtl-ltr-bidi)
  | "settings.language.label"
  | "settings.language.he"
  | "settings.language.en"
  // ─── layout/header ─── (redesign-2)
  | "header.menu"
  | "header.settings"
  | "header.connected"
  | "header.disconnect"
  | "header.audioOn"
  | "header.audioOff"
  | "sidebar.collapse"
  | "sidebar.agentOptions"
  | "sidebar.sessions"
  | "sidebar.refresh"
  | "sidebar.newSession"
  // ─── cli-name-in-chat ─── (slice cli-name-in-chat)
  | "sidebar.runningOn"
  | "sheet.handle"
  // ─── bubble-play ─── (msr-v2)
  | "bubble.play"
  | "bubble.stop"
  // ─── bubble-copy ─── (ui-polish-batch · C3)
  | "bubble.copy"
  | "bubble.copied"
  // ─── model-status ─── (msr-v2)
  | "modelStatus.waiting"
  | "modelStatus.thinking"
  | "modelStatus.responding"
  | "modelStatus.callingTool"
  | "modelStatus.pendingTts"
  | "modelStatus.speaking"
  // ─── theme ─── (palettes-expansion)
  | "settings.theme.label"
  | "settings.theme.ember"
  | "settings.theme.forest"
  | "settings.theme.plum"
  | "settings.theme.teal"
  | "settings.theme.midnight"
  | "settings.theme.rose"
  | "settings.theme.slate"
  | "settings.theme.daylight"
  // ─── active-agents ─── (slice active-agents-widget)
  | "connect.agents.title"
  | "connect.agents.empty"
  | "connect.agents.refresh"
  | "connect.agents.reconnect"
  | "connect.agents.kill"
  | "connect.agents.killConfirm"
  | "connect.agents.inUse"
  // ─── reconnect-ws-takeover Commit 2 ─── (panel takeover-affordance)
  | "connect.agents.takeOver"
  | "connect.agents.takeOverConfirm"
  | "connect.agents.noSession"
  // ─── agent-busy-indicator ─── (slice agent-busy-indicator)
  | "connect.agents.working"
  // ─── agent-last-message-ui ─── (slice agent-last-message-ui)
  | "connect.agents.lastMessage"
  // ─── מסך / wake-lock ─── (slice-wake-lock)
  | "settings.screen.label"
  | "settings.toggle.keepScreenOn"
  // ─── תצוגת צ'אט ─── (chat-render-polish → display-toggle-consistency)
  | "settings.chatDisplay"
  | "settings.toggle.showThoughts"
  | "settings.toggle.showTools"
  // ─── Enter toggle ─── (slice-enter-toggle)
  | "settings.toggle.enterToSend"
  // slice msg-media — התווית אומרת את הסיכון, לא רק את הפיצ'ר
  | "settings.toggle.autoLoadRemoteImages"
  // ─── content-viewer ─── (slice content-viewer)
  | "contentViewer.title"
  | "contentViewer.expand"
  | "contentViewer.close"
  // ─── fs-file-proxy — file viewer (Commit 1) ───
  | "contentViewer.download"
  | "plan.file.view"
  // ─── TTS provider ─── (V4a-gemini-tts-pcm-playback)
  | "settings.ttsProvider.label"
  | "settings.ttsProvider.elevenlabs"
  | "settings.ttsProvider.gemini"
  // ─── session transport ─── (slice transport-polish C4)
  | "settings.sessionTransport.label"
  | "settings.sessionTransport.ws"
  | "settings.sessionTransport.http"
  // ─── image-attach tray ─── (slice-image-paste)
  | "attach.addImage"
  | "attach.remove"
  // ─── image-paste replay (§11) — placeholder for non-text ContentBlocks ───
  // chat.content.attachedFile: param-less (label raw from data, no interpolation needed)
  | "chat.content.attachedFile"
  | "chat.content.loadRemoteImage"
  | "chat.content.unsupported"
  // ─── recent-projects ─── (slice connect-recent-projects)
  | "connect.recent.title"
  | "connect.recent.empty"
  | "connect.recent.refresh"
  // ─── recent-projects controls ─── (slice recent-projects-controls)
  | "connect.recent.remove"
  | "connect.recent.collapse"
  | "connect.recent.expand"
  // ─── leave-running (slice leave-running-background) ───
  | "session.leaveRunning" // תווית כפתור "צא — השאר רץ" (חדש)
  | "session.closeSession" // title כפתור הכיבוי-המלא (Power) — מבדיל מ-leaveRunning
  | "session.leaveWarning.title"
  | "session.leaveWarning.body" // "הריצה תיעצר ברגע שתגיע בקשת-הרשאה..."
  | "session.leaveWarning.confirm"
  | "session.leaveWarning.cancel"
  | "session.leaveWarning.dontShowAgain"
  // ─── playbackControls ─── (slice B1-controls-ui)
  | "playbackControls.stopRun"
  | "playbackControls.stopRun.thinking"
  | "playbackControls.stopRun.responding"
  | "playbackControls.stopRun.callingTool"
  | "playbackControls.stopPlayback"
  | "playbackControls.pause"
  | "playbackControls.resume"
  | "playbackControls.prev"
  | "playbackControls.next"
  | "playbackControls.dock"
  | "playbackControls.interrupted"
  // ─── thinking-tokens ─── (slice FEAT-thinking-live)
  | "agentOptions.thinking.label" // תווית הפקד "חשיבה" / "Thinking"
  | "agentOptions.thinking.off" // ערך כבוי
  | "agentOptions.thinking.low" // ערך נמוך (4000)
  | "agentOptions.thinking.medium" // ערך בינוני (8000)
  | "agentOptions.thinking.high" // ערך גבוה (16000)
  // ─── gemini voice picker ─── (V4b-gemini-voice-picker)
  | "settings.geminiVoice.label"
  | "settings.geminiVoice.desc.Zephyr"
  | "settings.geminiVoice.desc.Puck"
  | "settings.geminiVoice.desc.Charon"
  | "settings.geminiVoice.desc.Kore"
  | "settings.geminiVoice.desc.Fenrir"
  | "settings.geminiVoice.desc.Leda"
  | "settings.geminiVoice.desc.Orus"
  | "settings.geminiVoice.desc.Aoede"
  | "settings.geminiVoice.desc.Callirrhoe"
  | "settings.geminiVoice.desc.Autonoe"
  | "settings.geminiVoice.desc.Enceladus"
  | "settings.geminiVoice.desc.Iapetus"
  | "settings.geminiVoice.desc.Umbriel"
  | "settings.geminiVoice.desc.Algieba"
  | "settings.geminiVoice.desc.Despina"
  | "settings.geminiVoice.desc.Erinome"
  | "settings.geminiVoice.desc.Algenib"
  | "settings.geminiVoice.desc.Rasalgethi"
  | "settings.geminiVoice.desc.Laomedeia"
  | "settings.geminiVoice.desc.Achernar"
  | "settings.geminiVoice.desc.Alnilam"
  | "settings.geminiVoice.desc.Schedar"
  | "settings.geminiVoice.desc.Gacrux"
  | "settings.geminiVoice.desc.Pulcherrima"
  | "settings.geminiVoice.desc.Achird"
  | "settings.geminiVoice.desc.Zubenelgenubi"
  | "settings.geminiVoice.desc.Vindemiatrix"
  | "settings.geminiVoice.desc.Sadachbia"
  | "settings.geminiVoice.desc.Sadaltager"
  | "settings.geminiVoice.desc.Sulafat"
  // ─── tts-provider-availability ─── (slice tts-provider-availability)
  | "settings.ttsProvider.unavailable"
  | "settings.ttsProvider.fallbackNotice"
  | "settings.ttsProvider.allUnavailable"
  // ─── tts-status-ui ─── (slice tts-status-ui)
  | "settings.ttsStatus.title"
  | "settings.ttsStatus.loading"
  | "settings.ttsStatus.reason.quota"
  | "settings.ttsStatus.reason.noKey"
  | "settings.ttsStatus.reason.forbidden"
  | "settings.ttsStatus.reason.error"
  | "settings.ttsStatus.quota.label"
  | "settings.ttsStatus.quota.exhausted"
  | "settings.ttsStatus.quota.used"
  | "settings.ttsStatus.quota.limitLabel"
  | "settings.ttsStatus.quota.overage"
  | "settings.ttsStatus.usage.label"
  | "settings.ttsStatus.usage.elevenlabs"
  | "settings.ttsStatus.usage.gemini"
  | "settings.ttsStatus.usage.cache"
  | "settings.ttsStatus.usage.cost"
  | "settings.ttsStatus.usage.notAvailable"
  | "settings.ttsStatus.refresh"
  // ─── ui-session-polish ─── (slice ui-session-polish)
  | "session.copyId"
  | "modal.loading.session"
  // ─── app-title ─── (slice app-title-build-env)
  | "appTitle.settings"
  | "appTitle.sessions"
  // ─── slash commands ─── (slice-slash-commands)
  | "slash.commandsList"
  // ─── session budget meter ─── (slice session-budget-meter)
  | "sessionBudget.trigger"
  | "sessionBudget.title"
  | "sessionBudget.context.heading"
  | "sessionBudget.context.cost"
  | "sessionBudget.quota.heading"
  | "sessionBudget.quota.loading"
  | "sessionBudget.quota.unavailable"
  | "sessionBudget.quota.used"
  | "sessionBudget.quota.of"
  | "sessionBudget.quota.resetsIn"
  // ─── plan ─── (slice plan-todo-list)
  | "plan.title"
  | "plan.status.pending"
  | "plan.status.in_progress"
  | "plan.status.completed"
  | "plan.openMarkdown"
  | "plan.file.label"
  // ─── projectPrompt ─── (slice project-system-prompt)
  | "projectPrompt.label"
  | "projectPrompt.placeholder"
  | "projectPrompt.hint"
  // ─── projectPrompt capability warning ─── (slice systemprompt-capability)
  | "projectPrompt.unsupported"
  // ─── panel resize handle ─── (slice connect-panel-resize)
  | "connect.panel.resizeHandle"
  // ─── machine-stats ─── (slice-be-machine-stats)
  | "connect.machine.memory"
  | "connect.machine.cpu"
  | "connect.machine.label"
  // ─── session delete ─── (slice session-delete)
  | "session.delete"
  | "session.deleteConfirm"
  // ─── permission ─── (slice-permission-ui-basic)
  | "permission.title"
  | "permission.allowOnce"
  | "permission.allowAlways"
  | "permission.reject"
  | "permission.pending"
  // ─── elicitation ─── (slice-elicitation-ui)
  | "elicitation.accept"
  | "elicitation.decline"
  | "elicitation.cancel"
  | "elicitation.required"
  // ─── auth guidance ─── (slice auth-guidance)
  | "authGuidance.heading"
  | "authGuidance.envVar.setLabel"
  | "authGuidance.envVar.linkLabel"
  // ─── reconnect takeover ─── (slice reconnect-ws-takeover)
  | "session.openedElsewhere"
  // ─── reconnect-ws-takeover Commit 3 ─── (טבעת-חיבור פר-סשן, ActiveProcessesPanel)
  | "connect.agents.connected"
  | "connect.agents.disconnected"
  // ─── gemini directing (קצב/טון) ─── (slice-gemini-tts-directing)
  | "settings.geminiPace.label"
  | "settings.geminiPace.verySlow"
  | "settings.geminiPace.slow"
  | "settings.geminiPace.normal"
  | "settings.geminiPace.fast"
  | "settings.geminiPace.veryFast"
  | "settings.geminiTone.label"
  | "settings.geminiTone.neutral"
  | "settings.geminiTone.calm"
  | "settings.geminiTone.energetic"
  | "settings.geminiTone.formal"
  | "settings.geminiTone.casual"
  // ─── ownership-truth (slice ownership-truth C5) ───
  | "session.heldByOtherTransport"
  // ─── liveness (slice liveness C4) ───
  | "session.reconnecting"
  | "session.cloudflareBlocked"
  | "session.turnStalled"
  | "session.cloudflareRefresh"
  | "session.gone"
  // ─── session-url (slice session-url C2) ───
  | "sessionUrl.resolving"
  | "sessionUrl.notFound.title"
  | "sessionUrl.notFound.body"
  | "sessionUrl.notFound.back"
  | "sessionUrl.takeover.title"
  | "sessionUrl.takeover.body"
  | "sessionUrl.takeover.confirm"
  | "sessionUrl.takeover.cancel"
  // ─── agent-patch-unify C4: ממצא 3 — newSession ב-remote אינו נתמך ───
  | "session.newSessionUnsupportedRemote"
  // ─── sidebar-resize ───
  | "sidebar.resizeHandle"
  // ─── cwd-path-combo ───
  | "connect.cwd.combo.toggle"
  | "connect.cwd.combo.searchPlaceholder"
  | "connect.cwd.combo.empty"
  | "connect.cwd.combo.loadError"
  // ─── tool output (tool-render-fidelity) ───
  | "chat.tool.output.exitCode"
  | "chat.tool.output.stderr"
  | "chat.tool.output.empty"

/**
 * MessageValue — מחרוזת או פונקציה להודעות ממופרמטרות.
 * שלב 1: מחרוזות ליטרליות בלבד. אם נזדקק לפרמטרים בהמשך, נשנה ל:
 *   string | ((params: Record<string, string | number>) => string)
 */
export type MessageValue = string

export type Catalog = Record<MessageKey, MessageValue>
