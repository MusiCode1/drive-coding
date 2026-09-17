/**
 * page-visibility.ts — slice reconnect-on-visible.
 *
 * מצב הרקע/פוקוס של הטאב, במקום דגל פרטי ב-AgentSession, פלוס הטריגר שהיה חסר:
 * חזרה לפוקוס מחמשת מחדש את ה-reconnect.
 *
 * למה זה קיים בכלל: בנייד **כל** נפילת WS מתרחשת ברקע (הדפדפן מקפיא את הטאב,
 * וה-OS סוגר את ה-socket), ולכן #handleUnexpectedClose תמיד בחר שם בענף
 * "רקע: לא אוטו". שום דבר לא חימש אותו בחזרה לפוקוס, אז הדרך היחידה חזרה הייתה
 * כפתור ה-TEMP-RECONNECT הידני. אין API בדפדפן שמחזיק socket חי בטאב מוקפא,
 * ולכן היעד הוא reconnect מהיר, לא חיבור ששורד את המעבר.
 *
 * `onVisible` נקרא **רק** במעבר hidden→visible, לא בטעינה ולא visible→visible.
 * השומרים (מי כן ומי לא מחמש) נשארים אצל הקורא, כי הם על מצב הסשן.
 */

/** מה שנשאר בידי הקורא אחרי החיווט: קריאת המצב, וניתוק המאזין. */
export type PageVisibility = {
  /** True כשהטאב ברקע (`document.hidden`). False גם כשאין document (SSR/טסטים). */
  readonly hidden: boolean
  /** מסיר את המאזין. אין צורך בו בטאב חי; קיים בשביל טסטים וניקוי מסודר. */
  dispose(): void
}

/**
 * מאזין ל-visibilitychange ומחזיק את `hidden`. בלי document (SSR, node, טסטים
 * בלי stub) מחזיר מצב סטטי לא-מוסתר ו-dispose ריק, בלי לזרוק: זה הענף השקט,
 * והוא מכוסה בטסט (AGENTS.md: "a fail-open path is not implemented until its
 * silence is pinned").
 */
export function watchPageVisibility(onVisible: () => void): PageVisibility {
  if (typeof document === "undefined") {
    return { hidden: false, dispose: () => {} }
  }
  const doc = document
  const state = { hidden: doc.hidden }
  const listener = () => {
    const wasHidden = state.hidden
    state.hidden = doc.hidden
    if (wasHidden && !state.hidden) onVisible()
  }
  doc.addEventListener("visibilitychange", listener)
  return {
    get hidden() {
      return state.hidden
    },
    dispose: () => doc.removeEventListener("visibilitychange", listener),
  }
}
