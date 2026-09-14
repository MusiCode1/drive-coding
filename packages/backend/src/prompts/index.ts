/**
 * קטלוג פרומפטים עבור ה-voice-acp backend.
 *
 * כל פרומפט הוא קבוע `string` פשוט (או בונה טהור). הפלאגין `prompt-injector`
 * לוקח טקסט דרך `options.text` בזמן הפעלת הסוכן (agent-spawn, ראה
 * `plugin-config.ts`).
 *
 * Surface prompts are modular — compose with `buildSurfacePrompt` before inject
 * (HTTP `/api/agent-prompt` + provider hooks). הוספת פרומפט חדש = קובץ/תיקייה
 * כאן + ייצוא למטה.
 */
export { AUDIO_FRIENDLY_PROMPT } from "./audio-friendly.js"
export {
  SURFACE_ABOUT,
  SURFACE_CAPABILITIES,
  SURFACE_DISPLAY,
  SURFACE_PROMPT_PIECES,
  buildFsFileUrl,
  buildSurfacePrompt,
  buildSurfaceRuntime,
  resolveSurfaceRuntimeEnv,
  type BuildSurfacePromptOptions,
  type SurfacePromptPiece,
  type SurfaceRuntimeEnv,
  type SurfaceRuntimeInfo,
} from "./surface/index.js"
