import type { Catalog } from "../keys.js"

/**
 * Hebrew catalog. Append new keys in domain blocks below — see
 * docs/conventions/parallel-safe-code.md (technique #4: append-only catalogs).
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

  // ─── voice-mode ─── (slice 3)
  "voiceMode.status.idle": "מיקרופון",
  "voiceMode.status.recording": "מקליט…",
  "voiceMode.status.transcribing": "מתמלל…",
  "voiceMode.status.thinking": "חושב…",
  "voiceMode.status.speaking": "מדבר…",
  "voiceMode.status.cancelling": "מבטל…",
  // ─── tool-bubble ─── (slice 4)
  // ─── audio-cues ─── (slice 6)
  // ─── car-mode ─── (slice 7)
  // ─── sessions ─── (slice 8)
  "sessions.loadButton": "טען סשנים אחרונים",
  "sessions.loading": "טוען…",
  "sessions.label": "סשן קיים",
  "sessions.startNew": "חדש",
  "sessions.error": "שגיאה בטעינה",
  // ─── settings ─── (slice 9)
  "settings.title": "הגדרות",
  "settings.beUrl.label": "כתובת השרת (BE URL)",
  "settings.beUrl.help": "השאר ריק במצב פיתוח. בפרודקשן (Cloudflare) הזן את הכתובת המלאה של ה-BE.",
  "settings.beUrl.invalid": "כתובת לא תקינה",
  "settings.beUrl.saved": "נשמר ✓",
  "settings.back": "חזרה",
  // ─── recordings ─── (slice 10)
}
