/**
 * context.ts — createContext pairs for the app singletons.
 *
 * One pair per primary view-model. Use `set*` in the composition root
 * (+layout.svelte) and `get*` in any component below it.
 */

import { createContext } from "svelte"
import type { AgentSession } from "./view-models/agent-session.svelte"
import type { Settings } from "./view-models/settings.svelte"

export const [getSession, setSession] = createContext<AgentSession>()
export const [getSettings, setSettings] = createContext<Settings>()
