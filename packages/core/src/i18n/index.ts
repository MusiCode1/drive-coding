/**
 * i18n — שכבת תרגום מינימלית.
 *
 * `createI18n({ locale })` מחזירה:
 *   - t(key): string — תרגום, נופל ל-"he" אם חסר ב-locale הנוכחי.
 *   - locale: Locale (לקריאה בלבד — כדי לשנות, צור מופע חדש או השתמש ב-view-model).
 *
 * ה-FE עוטף את זה ב-view-model של Svelte (view-models/i18n.svelte.ts) ש-
 * חושף את `t` באופן ריאקטיבי. צרכנים אחרים (BE, בדיקות) יכולים להשתמש בזה ישירות.
 *
 * זיהוי Locale (detectLocale()) מחזיר "he" אם navigator.language מתחיל
 * ב-"he", אחרת "en". נופל ל-"he" כאשר navigator אינו זמין (SSR/בדיקות).
 */

import { en } from "./catalogs/en.js"
import { he } from "./catalogs/he.js"
import type { Catalog, Locale, MessageKey } from "./keys.js"

export type { Locale, MessageKey } from "./keys.js"

const CATALOGS: Record<Locale, Catalog> = { he, en }

/**
 * ברירת המחדל ל-locale — עברית. בשימוש כאשר:
 *   - הקטלוג של ה-locale המבוקש חסר מפתח (fallback).
 *   - detectLocale() לא יכול לקרוא את navigator.
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
 * detectLocale — מאמץ מיטבי לזיהוי locale מהעדפת הדפדפן.
 * מחזיר DEFAULT_LOCALE כאשר navigator אינו זמין.
 */
export function detectLocale(): Locale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE
  const lang = navigator.language ?? ""
  return lang.toLowerCase().startsWith("he") ? "he" : "en"
}
