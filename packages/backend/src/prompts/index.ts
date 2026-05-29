/**
 * Prompt catalog for the voice-acp backend.
 *
 * Each prompt is a plain `string` constant. The `prompt-injector` plugin
 * picks one up via `options.text` at agent-spawn time (see
 * `plugin-config.ts`).
 *
 * Adding a new prompt = add a new file here + re-export below. A future
 * slice (Settings / per-session override) will let the user pick which
 * one is active.
 */
export { AUDIO_FRIENDLY_PROMPT } from "./audio-friendly.js"
