/**
 * i18n — minimal translation layer.
 *
 * `createI18n({ locale })` returns:
 *   - t(key): string — translate, falls back to "he" if missing in current locale.
 *   - locale: Locale (read-only — to change, create a new instance or use the view-model).
 *
 * The FE wraps this in a Svelte view-model (`view-models/i18n.svelte.ts`) that
 * exposes `t` reactively. Other consumers (BE, tests) can use this directly.
 *
 * Locale detection (`detectLocale()`) returns "he" if `navigator.language` starts
 * with "he", else "en". Defaults to "he" when navigator is unavailable (SSR/tests).
 */

import { en } from "./catalogs/en.js"
import { he } from "./catalogs/he.js"
import type { Catalog, Locale, MessageKey } from "./keys.js"

export type { Locale, MessageKey } from "./keys.js"

const CATALOGS: Record<Locale, Catalog> = { he, en }

/**
 * Default locale — Hebrew. Used when:
 *   - The requested locale's catalog is missing a key (fallback).
 *   - detectLocale() can't read navigator.
 */
export const DEFAULT_LOCALE: Locale = "he"

export type I18n = {
  readonly locale: Locale
  t: (key: MessageKey) => string
}

export function createI18n(opts: { locale: Locale }): I18n {
  const catalog = CATALOGS[opts.locale]
  const fallback = CATALOGS[DEFAULT_LOCALE]
  return {
    locale: opts.locale,
    t: (key) => catalog[key] ?? fallback[key],
  }
}

/**
 * detectLocale — best-effort locale detection from browser preference.
 * Returns DEFAULT_LOCALE when navigator is unavailable.
 */
export function detectLocale(): Locale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE
  const lang = navigator.language ?? ""
  return lang.toLowerCase().startsWith("he") ? "he" : "en"
}
