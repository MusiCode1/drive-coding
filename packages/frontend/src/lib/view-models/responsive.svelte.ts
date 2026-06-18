/**
 * ResponsiveVM — מצב viewport גלובלי (entity: "מצב מכשיר").
 *
 * isMobile = true כאשר רוחב החלון < 768px (Tailwind `md` breakpoint).
 * מאזין ל-matchMedia ומעדכן $state ב-Svelte 5.
 *
 * ─── redesign-2 ───
 */
export class ResponsiveVM {
  isMobile = $state(false)

  /**
   * navigator.userAgentData.mobile — הצהרת הדפדפן שזה מכשיר נייד. קבוע פר-מכשיר
   * (Chromium בלבד; ב-Safari/Firefox האובייקט undefined → false). נקרא פעם אחת.
   */
  readonly #uaMobile: boolean = readUaMobile()

  #mql: MediaQueryList | undefined

  constructor() {
    if (typeof window === "undefined") return
    this.#mql = window.matchMedia("(max-width: 767px)")
    this.isMobile = this.#mql.matches
    this.#mql.addEventListener("change", (e) => {
      this.isMobile = e.matches
    })
  }

  /**
   * מכשיר נייד לצורך התנהגות קלט: הדפדפן מצהיר mobile (userAgentData) **או**
   * המסך צר (<768px). משמש כדי להחליט אם Enter שולח (דסקטופ בלבד) — במובייל
   * Enter = שורה חדשה והשליחה דרך כפתור ה-send. ─── ui-polish-batch-2 · Enter ───
   */
  get isMobileDevice(): boolean {
    return this.#uaMobile || this.isMobile
  }
}

/** קריאה בטוחה ל-navigator.userAgentData.mobile (לא בטיפוסי lib.dom הסטנדרטיים). */
function readUaMobile(): boolean {
  if (typeof navigator === "undefined") return false
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  return nav.userAgentData?.mobile === true
}
