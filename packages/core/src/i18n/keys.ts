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
 * ─── עיצוב תוספתי בטוח למקביליות (docs/conventions/parallel-safe-code.md) ───
 * שני slices שמוסיפים מפתחות נוחתים בבלוקים שונים → git auto-merge.
 */

export type Locale = "he" | "en"

export const LOCALES: readonly Locale[] = ["he", "en"]

export type MessageKey =
  // ─── connect ─── (slice 0)
  | "connect.title"
  | "connect.subtitle"
  | "connect.cli.label"
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
  // ─── audio-cues ─── (slice 6)
  // ─── car-mode ─── (slice 7)
  // ─── sessions ─── (slice 8)
  | "sessions.loadButton"
  | "sessions.loading"
  | "sessions.label"
  | "sessions.startNew"
  | "sessions.error"
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
  | "modal.close"
  // ─── record-footer ─── (redesign-4)
  | "record.tab.record"
  | "record.tab.type"
  | "record.tab.hide"
  | "record.status.idle"
  | "record.send"
  | "record.placeholder"
  | "mic.stop"
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
  | "sheet.handle"

/**
 * MessageValue — מחרוזת או פונקציה להודעות ממופרמטרות.
 * שלב 1: מחרוזות ליטרליות בלבד. אם נזדקק לפרמטרים בהמשך, נשנה ל:
 *   string | ((params: Record<string, string | number>) => string)
 */
export type MessageValue = string

export type Catalog = Record<MessageKey, MessageValue>
