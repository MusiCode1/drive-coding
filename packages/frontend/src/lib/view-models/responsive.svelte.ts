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

  #mql: MediaQueryList | undefined

  constructor() {
    if (typeof window === "undefined") return
    this.#mql = window.matchMedia("(max-width: 767px)")
    this.isMobile = this.#mql.matches
    this.#mql.addEventListener("change", (e) => {
      this.isMobile = e.matches
    })
  }
}
