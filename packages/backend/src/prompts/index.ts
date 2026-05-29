/**
 * קטלוג פרומפטים עבור ה-voice-acp backend.
 *
 * כל פרומפט הוא קבוע `string` פשוט. הפלאגין `prompt-injector`
 * לוקח אחד דרך `options.text` בזמן הפעלת הסוכן (agent-spawn, ראה
 * `plugin-config.ts`).
 *
 * הוספת פרומפט חדש = הוספת קובץ חדש כאן + ייצוא מחדש למטה. סלייס עתידי
 * (הגדרות / דריסה פר-סשן) יאפשר למשתמש לבחור איזה מהם פעיל.
 */
export { AUDIO_FRIENDLY_PROMPT } from "./audio-friendly.js"
