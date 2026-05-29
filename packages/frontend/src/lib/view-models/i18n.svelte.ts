/**
 * I18n view-model — מעטפת ריאקטיבית סביב @drive-coding/core/i18n.
 *
 * מספק את הפונקציה `t(key)` עבור קומפוננטות. ה-locale נבחר פעם אחת בזמן הבנייה
 * (מה-navigator + Settings) וניתן לשנותו דרך `setLocale()`.
 *
 * ריאקטיביות: `t` הוא מתודת $derived getter כך שהקומפוננטות ירונדרו מחדש כשה-locale משתנה.
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
   * t(key) — תרגום מפתח הודעה. ריאקטיבי: קומפוננטות שקוראות לזה
   * מתוך טמפלייט / $derived ירונדרו מחדש כשה-locale משתנה.
   */
  t = (key: MessageKey): string => this.#i18n.t(key)

  setLocale = (locale: Locale): void => {
    this.locale = locale
  }
}
