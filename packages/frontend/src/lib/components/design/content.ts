/**
 * design/content — copy + synthetic fixtures for the /design mock gallery (branch design/unslop-mocks).
 * All data is invented; nothing here comes from a real session, path or account.
 */
import en from "./content.en.json"
import he from "./content.he.json"

export type DesignContent = typeof he
export type DesignLang = "he" | "en"

export const SCREENS = ["connect", "chat", "panel", "settings", "usage"] as const
export type DesignScreen = (typeof SCREENS)[number]

export const STATES: Record<DesignScreen, readonly string[]> = {
  connect: ["default", "expanded", "empty", "connecting", "error"],
  chat: [
    "conversation",
    "speaking",
    "permission",
    "reconnecting",
    "empty",
    "typing",
    "live",
    "hidden",
  ],
  panel: ["default"],
  settings: ["default"],
  usage: ["default"],
}

export const PALETTES = [
  "ember",
  "forest",
  "plum",
  "teal",
  "midnight",
  "rose",
  "slate",
  "daylight",
] as const

export function designContent(lang: DesignLang): DesignContent {
  return (lang === "en" ? en : he) as DesignContent
}

export const DEVICES = {
  phone: { w: 390, h: 844 },
  tablet: { w: 820, h: 1180 },
  desktop: { w: 1440, h: 900 },
} as const
export type DesignDevice = keyof typeof DEVICES

/**
 * Screenshots of today's UI, served from static/design-current/ (NOT committed — the folder is
 * filled locally for a preview). Only shots of a throwaway test session are listed; screens whose
 * shots show personal sessions or costs (connect, usage) are deliberately absent.
 */
export const CURRENT: Partial<Record<DesignScreen, Partial<Record<DesignDevice, string>>>> = {
  chat: { phone: "p-run-2.png", tablet: "t-chat.png", desktop: "d-chat.png" },
  panel: { phone: "p-sheet.png" },
  settings: { phone: "p-settings.png", desktop: "d-settings.png" },
}
