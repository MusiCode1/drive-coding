/**
 * be-url.ts — כתובת URL בסיסית של ה-Backend ברמת המודול (module-level) לכל קריאות ה-FE → BE.
 *
 * לא קונטקסט של Svelte: אדפטרים (למשל sdks.ts) קוראים את זה במהלך אתחול המודול
 * שלהם, שקורה מחוץ לכל הקמת קומפוננטה — `getSettings()` 
 * יזרוק שם שגיאת `lifecycle_outside_component`. לכן אנחנו שומרים משתנה
 * מודול רגיל, שמתעדכן על ידי ה-Settings VM בטעינה + בשמירה של המשתמש.
 *
 * בסיס ריק → משתמש ב-location.origin (פרוקסי של Vite מטפל בנתיבי same-origin ב-
 * dev; בפרודקשן ה-BE הוא גם same-origin אלא אם כן נדרס).
 * בסיס מוגדר → בסיס absolute חוצה-מקורות (cross-origin) (דורש CORS — ראה slice 15a).
 */

let _beUrl = ""

/**
 * נקרא על ידי ה-Settings VM בעת בנייה (מערך שנשמר) ובכל
 * שמירה של משתמש. לוכסן סוגר (Trailing slash) מוסר לצורך שרשור עקבי.
 */
export function setBeUrlBase(value: string): void {
  _beUrl = value.replace(/\/$/, "")
}

/**
 * בונה כתובת BE מוחלטת (absolute URL) עבור קריאות `fetch()`.
 *
 * בסיס ריק → `location.origin` + הנתיב (Vite proxy / same-origin).
 * בסיס מוגדר → הבסיס הזה + הנתיב (cross-origin).
 * SSR (אין `location`) → מחזיר את הנתיב כפי שהוא (לא קורה fetch ב-SSR).
 */
export function beUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`
  if (_beUrl !== "") return `${_beUrl}${normalized}`
  if (typeof location === "undefined") return normalized
  return `${location.origin}${normalized}`
}

/**
 * בונה כתובת BE ל-WebSocket. אותה לוגיקת בסיס, רק http → ws ו-https → wss.
 */
export function beWsUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`
  if (_beUrl !== "") return _beUrl.replace(/^http/, "ws") + normalized
  if (typeof location === "undefined") return `ws://ssr-stub${normalized}`
  const proto = location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${location.host}${normalized}`
}

/** לטסטים בלבד — מאפס מצב פנימי (internal state) בין טסטים. */
export function _resetForTests(): void {
  _beUrl = ""
}
