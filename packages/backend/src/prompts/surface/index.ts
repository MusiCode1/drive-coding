/**
 * Modular surface prompts — tell ACP agents what drive-coding is and can show.
 * Compose with \`buildSurfacePrompt({ pieces, runtime })\`; injection is separate.
 */

export { SURFACE_ABOUT } from "./about.js"
export { SURFACE_CAPABILITIES } from "./capabilities.js"
export { SURFACE_DISPLAY } from "./display.js"
export {
  buildFsFileUrl,
  buildSurfaceRuntime,
  resolveSurfaceRuntimeEnv,
  type SurfaceRuntimeEnv,
  type SurfaceRuntimeInfo,
} from "./runtime.js"
export {
  SURFACE_PROMPT_PIECES,
  buildSurfacePrompt,
  type BuildSurfacePromptOptions,
  type SurfacePromptPiece,
} from "./compose.js"
