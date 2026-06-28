import type { Catalog } from "../keys.js"

/**
 * קטלוג עברית. הוסף מפתחות חדשים בבלוקי domain למטה — ראה
 * docs/conventions/parallel-safe-code.md (טכניקה #4: קטלוגים append-only).
 */
export const he: Catalog = {
  // ─── connect ─── (slice 0)
  "connect.title": "drive-coding v2",
  "connect.subtitle": "חבר ל-CLI agent",
  "connect.cli.label": "CLI",
  "connect.cwd.label": "תיקיית עבודה",
  "connect.cwd.placeholder": "/home/user/projects/X",
  "connect.submit": "חבר",
  "connect.submitting": "מתחבר…",
  "connect.error.prefix": "שגיאה:",

  // ─── chat ─── (slice 0.5 + slice 2)
  "chat.bubble.user": "אני",
  "chat.bubble.thought": "מחשבה",
  "chat.bubble.agent": "סוכן",
  "chat.empty": "התחל לכתוב למטה…",
  "chat.prompt.placeholder": "כתוב prompt…",
  "chat.send": "שלח",
  "chat.disconnect": "נתק",
  "chat.audioToggle": "אודיו",

  // ─── voice picker ─── (slice 9)
  "chat.voicePicker.label": "קול",
  "chat.voicePicker.loading": "טוען קולות…",
  "chat.voicePicker.error": "שגיאה בטעינת קולות",

  // ─── mic ─── (slice 3)
  "mic.error.permission": "הגישה למיקרופון נדחתה. אפשר גישה בהגדרות הדפדפן.",
  "mic.error.notFound": "לא נמצא מיקרופון. חבר מיקרופון ונסה שוב.",
  "mic.error.transcribe": "התמלול נכשל. נסה שוב.",
  "mic.error.generic": "שגיאה במיקרופון. נסה שוב.",
  // ─── mic retry ─── (slice sessions-inline)
  "mic.retry": "נסה שוב",

  // ─── voice-mode ─── (slice 3)
  "voiceMode.status.idle": "מיקרופון",
  "voiceMode.status.recording": "מקליט…",
  "voiceMode.status.transcribing": "מתמלל…",
  "voiceMode.status.thinking": "חושב…",
  "voiceMode.status.speaking": "מדבר…",
  "voiceMode.status.cancelling": "מבטל…",
  // ─── tool-bubble ─── (slice 4)
  "chat.tool.status.pending": "ממתין",
  "chat.tool.status.in_progress": "בתהליך",
  "chat.tool.status.completed": "הושלם",
  "chat.tool.status.failed": "נכשל",
  "chat.tool.args": "קלט",
  "chat.tool.result": "פלט",
  "chat.tool.loading_narration": "...",
  // ─── slice 16 (ACP content) ───
  "chat.tool.raw": "פלט גולמי",
  "chat.tool.locations": "קבצים",
  "chat.tool.content": "תוכן",
  "chat.tool.terminal": "טרמינל",
  "chat.tool.diff.added": "נוסף",
  "chat.tool.diff.removed": "הוסר",
  // ─── audio-cues ─── (slice 6)
  // ─── car-mode ─── (slice 7)
  // ─── sessions ─── (slice 8)
  "sessions.loadButton": "טען סשנים אחרונים",
  "sessions.loading": "טוען…",
  "sessions.label": "בחירת סשן",
  "sessions.startNew": "חדש",
  "sessions.error": "שגיאה בטעינה",
  // ─── sessions-refresh ─── (ui-polish-batch · C11)
  "sessions.refresh": "רענן",
  // ─── settings ─── (slice 9)
  "settings.title": "הגדרות",
  "settings.beUrl.label": "כתובת השרת (BE URL)",
  "settings.beUrl.help": "השאר ריק במצב פיתוח. בפרודקשן (Cloudflare) הזן את הכתובת המלאה של ה-BE.",
  "settings.beUrl.invalid": "כתובת לא תקינה",
  "settings.beUrl.saved": "נשמר ✓",
  "settings.back": "חזרה",
  // ─── recordings ─── (slice 10)
  // ─── agent-options ─── (slice 23)
  "agentOptions.title": "הגדרות סשן",
  "agentOptions.model.label": "מודל",
  "agentOptions.model.other": "אחר",
  "agentOptions.agent.label": "סוכן",
  "agentOptions.mode.label": "מצב",
  // תרגום שמות config-options שמגיעים מה-CLI (אנגלית) → עברית. name לא-מוכר נשאר כפי שהוא.
  "configName.agent": "סוכן",
  "configName.mode": "מצב",
  "configName.sessionMode": "מצב סשן",
  "configName.approvalPreset": "רמת אישורים",
  "configName.model": "מודל",
  "configName.effort": "מאמץ",
  "configName.reasoningEffort": "מאמץ חשיבה",
  // ─── smart-scroll ─── (redesign-7)
  "chat.jumpDown": "הודעות חדשות",
  // ─── modals ─── (redesign-6)
  "modal.sessions.title": "סשנים אחרונים",
  "modal.sessions.refresh": "רענן",
  "modal.sessions.new": "סשן חדש",
  "modal.sessions.loading": "טוען סשנים…",
  "modal.sessions.error": "שגיאה בטעינת סשנים",
  "modal.sessions.empty": "אין סשנים",
  "modal.folder.title": "בחר תיקייה",
  "modal.folder.pick": "בחר תיקייה זו",
  "modal.folder.up": "עלה",
  "modal.folder.loading": "טוען…",
  "modal.folder.error": "שגיאה בטעינת תיקיות",
  "modal.folder.showHidden": "הצג תיקיות מוסתרות",
  "modal.close": "סגור",
  // ─── record-footer ─── (redesign-4)
  "record.tab.record": "הקלטה",
  "record.tab.type": "הקלדה",
  "record.tab.hide": "מוסתר",
  "record.status.idle": "לחץ להקלטה",
  "record.send": "שלח",
  "record.placeholder": "כתוב prompt…",
  "record.reconnect": "התחבר מחדש",
  "record.reconnecting": "מתחבר מחדש…",
  "record.reconnectAttempt": "ניסיון",
  "mic.stop": "עצור",
  // ─── settings-redesign ─── (redesign-3)
  "settings.connection": "חיבור",
  "settings.voiceSpeech": "קול ודיבור",
  "settings.folder.label": "תיקיית עבודה",
  "settings.folder.pick": "בחר…",
  "settings.model.label": "מודל",
  "settings.session.label": "Session",
  "settings.voice.label": "קול ה-TTS",
  "settings.toggle.speakThoughts": "הקראת מחשבות המודל",
  "settings.toggle.narrateTools": "קריינות פעולות (כלים)",
  "settings.toggle.translateThoughts": "תרגום מחשבות לעברית",
  "settings.toggle.carMode": "מצב רכב (Play בבלוטוס = הקלטה)",
  "settings.reset": "איפוס",
  "settings.saveOpen": "שמור ופתח",
  // ─── language ─── (rtl-ltr-bidi)
  "settings.language.label": "שפת ממשק",
  "settings.language.he": "עברית",
  "settings.language.en": "English",
  // ─── layout/header ─── (redesign-2)
  "header.menu": "תפריט",
  "header.settings": "הגדרות",
  "header.connected": "מחובר",
  "header.disconnect": "נתק",
  "header.audioOn": "השתק שמע",
  "header.audioOff": "הפעל שמע",
  "sidebar.collapse": "קפל פאנל",
  "sidebar.agentOptions": "אפשרויות סוכן",
  "sidebar.sessions": "סשנים",
  "sidebar.refresh": "רענן",
  "sidebar.newSession": "סשן חדש",
  "sheet.handle": "גרור לפתיחה",
  // ─── bubble-play ─── (msr-v2)
  "bubble.play": "השמע",
  "bubble.stop": "עצור השמעה",
  // ─── bubble-copy ─── (ui-polish-batch · C3)
  "bubble.copy": "העתק",
  "bubble.copied": "הועתק!",
  // ─── model-status ─── (msr-v2)
  "modelStatus.waiting": "ממתין…",
  "modelStatus.thinking": "חושב…",
  "modelStatus.responding": "מגיב…",
  "modelStatus.callingTool": "מריץ כלי…",
  "modelStatus.pendingTts": "מכין השמעה…",
  "modelStatus.speaking": "מדבר…",
  // ─── theme ─── (palettes-expansion)
  "settings.theme.label": "ערכת נושא",
  "settings.theme.ember": "גחלת",
  "settings.theme.forest": "יער",
  "settings.theme.plum": "שזיף",
  "settings.theme.teal": "טורקיז",
  "settings.theme.midnight": "חצות",
  "settings.theme.rose": "ורד",
  "settings.theme.slate": "צפחה",
  "settings.theme.daylight": "אור יום",
  // ─── active-agents ─── (slice active-agents-widget)
  "connect.agents.title": "תהליכים פעילים",
  "connect.agents.empty": "אין תהליכים פעילים",
  "connect.agents.refresh": "רענן",
  "connect.agents.reconnect": "התחבר מחדש",
  "connect.agents.kill": "הרוג",
  "connect.agents.killConfirm": "בטוח?",
  "connect.agents.inUse": "פעיל בכרטיסייה אחרת",
  // ─── agent-busy-indicator ─── (slice agent-busy-indicator)
  "connect.agents.working": "עובד…",
  // ─── agent-last-message-ui ─── (slice agent-last-message-ui)
  "connect.agents.lastMessage": "פעילות אחרונה",
  // ─── מסך / wake-lock ─── (slice-wake-lock)
  "settings.screen.label": "מסך",
  "settings.toggle.keepScreenOn": "השאר מסך דלוק",
  // ─── תצוגת צ'אט ─── (display-toggle-consistency)
  "settings.chatDisplay": "תצוגת צ'אט",
  "settings.toggle.showThoughts": "הצג מחשבות כברירת מחדל",
  "settings.toggle.showTools": "הצג כלים כברירת מחדל",
  // ─── Enter toggle ─── (slice-enter-toggle)
  "settings.toggle.enterToSend": "Enter שולח הודעה",
  // ─── content-viewer ─── (slice content-viewer)
  "contentViewer.title": "תצוגה",
  "contentViewer.expand": "הרחב",
  "contentViewer.close": "סגור",
  // ─── TTS provider ─── (V4a-gemini-tts-pcm-playback)
  "settings.ttsProvider.label": "ספק TTS",
  "settings.ttsProvider.elevenlabs": "ElevenLabs",
  "settings.ttsProvider.gemini": "Gemini",
  // ─── recent-projects ─── (slice connect-recent-projects)
  "connect.recent.title": "תיקיות אחרונות",
  "connect.recent.empty": "אין תיקיות אחרונות",
  "connect.recent.refresh": "רענן",
  // ─── leave-running (slice leave-running-background) ───
  "session.leaveRunning": "צא — השאר רץ",
  "session.leaveWarning.title": "הסוכן ימשיך לרוץ",
  "session.leaveWarning.body": "הריצה תיעצר ברגע שתגיע בקשת-הרשאה, כי הדפדפן הוא ה-ACP client. למנוע תקיעה: עבור למצב עקיפת-הרשאות לפני שתצא.",
  "session.leaveWarning.confirm": "צא בכל זאת",
  "session.leaveWarning.cancel": "ביטול",
  "session.leaveWarning.dontShowAgain": "אל תציג הודעה זו שוב",
}
