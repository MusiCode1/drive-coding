/**
 * context.ts — createContext pairs for the app singletons.
 *
 * One pair per primary view-model. Use `set*` in the composition root
 * (+layout.svelte) and `get*` in any component below it.
 *
 * ─── Parallel-safe additive design (docs/conventions/parallel-safe-code.md) ───
 *
 * Adding a new VM pair: append a new `// ─── <domain> ───` block AT THE END
 * of the file. Do not edit existing blocks. Imports go in the import block
 * at top (alphabetical within group is nice but not required).
 */

import { createContext } from "svelte"
import type { AgentSession } from "./view-models/agent-session.svelte"
import type { I18nVM } from "./view-models/i18n.svelte"
import type { Mic } from "./view-models/mic.svelte"
import type { Settings } from "./view-models/settings.svelte"
import type { Speaker } from "./view-models/speaker.svelte"
import type { VoiceMode } from "./view-models/derived/voice-mode.svelte"

// ─── i18n ──────────────────────────────────────────
export const [getI18n, setI18n] = createContext<I18nVM>()

// ─── settings ──────────────────────────────────────
export const [getSettings, setSettings] = createContext<Settings>()

// ─── session ───────────────────────────────────────
export const [getSession, setSession] = createContext<AgentSession>()

// ─── speaker ───────────────────────────────────────
export const [getSpeaker, setSpeaker] = createContext<Speaker>()

// ─── mic ─── (slice 3)
export const [getMic, setMic] = createContext<Mic>()

// ─── voice-mode ─── (slice 3)
export const [getVoiceMode, setVoiceMode] = createContext<VoiceMode>()

// ─── car-mode ─── (slice 7 will add here)
