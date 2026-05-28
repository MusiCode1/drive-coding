/**
 * I18n view-model — reactive wrapper around @drive-coding/core/i18n.
 *
 * Provides `t(key)` for components. Locale is selected once at construction
 * (from navigator + Settings) and can be changed via `setLocale()`.
 *
 * Reactive: `t` is a $derived getter so components re-render when locale changes.
 */

import {
  createI18n,
  detectLocale,
  type I18n,
  type Locale,
  type MessageKey,
} from "@drive-coding/core/i18n"

export class I18nVM {
  locale = $state<Locale>(detectLocale())

  #i18n = $derived<I18n>(createI18n({ locale: this.locale }))

  /**
   * t(key) — translate a message key. Reactive: components that call this
   * inside a template / $derived will re-render when locale changes.
   */
  t = (key: MessageKey): string => this.#i18n.t(key)

  setLocale = (locale: Locale): void => {
    this.locale = locale
  }
}
