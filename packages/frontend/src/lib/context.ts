/**
 * context.ts — צמדי createContext עבור הסינגלטונים של האפליקציה.
 *
 * צמד אחד לכל view-model ראשי. השתמש ב-`set*` בנקודת ההרכבה (composition root)
 * (+layout.svelte) וב-`get*` בכל רכיב שתחתיו.
 *
 * ─── עיצוב תוספתי בטוח למקביליות (docs/conventions/parallel-safe-code.md) ───
 *
 * הוספת צמד VM חדש: הוסף בלוק `// ─── <domain> ───` חדש בסוף
 * הקובץ. אל תערוך בלוקים קיימים. ייבואים הולכים לבלוק הייבוא
 * למעלה (סדר אלפביתי בתוך קבוצה זה נחמד אבל לא חובה).
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

// ─── הגדרות ──────────────────────────────────────
export const [getSettings, setSettings] = createContext<Settings>()

// ─── סשן ───────────────────────────────────────
export const [getSession, setSession] = createContext<AgentSession>()

// ─── speaker ───────────────────────────────────────
export const [getSpeaker, setSpeaker] = createContext<Speaker>()

// ─── mic ─── (slice 3)
export const [getMic, setMic] = createContext<Mic>()

// ─── voice-mode ─── (slice 3)
export const [getVoiceMode, setVoiceMode] = createContext<VoiceMode>()

// ─── car-mode ─── (slice 7 יוסיף כאן)
