/**
 * I18n view-model — מעטפת ריאקטיבית סביב @drive-coding/core/i18n.
 *
 * מספק את הפונקציה `t(key)` עבור קומפוננטות. ה-locale נגזר מ-Settings (מקור-אמת
 * persisted יחיד), וניתן לשנותו דרך `setLocale()` שמאציל ל-Settings.
 *
 * ריאקטיביות: `t` הוא מתודת $derived getter כך שהקומפוננטות ירונדרו מחדש כשה-locale משתנה.
 *
 * (rtl-ltr-bidi) refactor: locale עבר מ-$state עצמאי → getter שקורא settings.locale.
 * zero external callers — grep הוכיח שה-refactor zero-risk.
 */

import { createI18n, type I18n, type Locale, type MessageKey } from "@drive-coding/core/i18n"
import type { Settings } from "./settings.svelte"

export class I18nVM {
  #settings: Settings

  constructor(opts: { settings: Settings }) {
    this.#settings = opts.settings
  }

  /** locale נגזר מ-Settings (persisted). getter ריאקטיבי — קורא $state של Settings. */
  get locale(): Locale {
    return this.#settings.locale
  }

  #i18n = $derived<I18n>(createI18n({ locale: this.locale }))

  /**
   * t(key) — תרגום מפתח הודעה. ריאקטיבי: קומפוננטות שקוראות לזה
   * מתוך טמפלייט / $derived ירונדרו מחדש כשה-locale משתנה.
   */
  t = (key: MessageKey): string => this.#i18n.t(key)

  /** מאציל ל-Settings.setLocale — שומר את ה-API החיצוני */
  setLocale = (locale: Locale): void => {
    this.#settings.setLocale(locale)
  }
}
