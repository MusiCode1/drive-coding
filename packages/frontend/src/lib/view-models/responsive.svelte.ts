import { ViewportInsetsEngine } from "$lib/engines/viewport-insets"

/**
 * ResponsiveVM — מצב viewport גלובלי (entity: "מצב מכשיר").
 *
 * isMobile = true כאשר רוחב החלון < 768px (Tailwind `md` breakpoint).
 * מאזין ל-matchMedia ומעדכן $state ב-Svelte 5.
 *
 * ─── redesign-2 ───
 *
 * ─── mobile-parity ───
 * The same entity also carries the two insets a phone imposes - they are device-viewport
 * state and nothing else, so one owner rather than one listener per consumer:
 *
 *  · safeBottomPx - the display cutout at the bottom, in px. CSS pays the cutout back
 *    through the `--safe-*` tokens in app.css, but the BottomSheet snaps and drags in
 *    numbers, so that one place needs the inset as a number too.
 *  · keyboardPx - how much the on-screen keyboard covers. Also mirrored into `--kb` on
 *    <html> by the engine, so CSS can spend it directly.
 *
 * The listeners live in ViewportInsetsEngine (view-models may own engines); this class
 * only mirrors its reports into $state. Both stay 0 on desktop and during SSR.
 */
export class ResponsiveVM {
  isMobile = $state(false)
  safeBottomPx = $state(0)
  keyboardPx = $state(0)

  #mql: MediaQueryList | undefined
  #insets: ViewportInsetsEngine

  constructor() {
    this.#insets = new ViewportInsetsEngine((insets) => {
      this.safeBottomPx = insets.safeBottomPx
      this.keyboardPx = insets.keyboardPx
    })
    if (typeof window === "undefined") return
    this.#mql = window.matchMedia("(max-width: 767px)")
    this.isMobile = this.#mql.matches
    this.#mql.addEventListener("change", (e) => {
      this.isMobile = e.matches
    })
    this.#insets.start()
  }

  /** Teardown - releases the viewport listeners. Idempotent. */
  dispose(): void {
    this.#insets.dispose()
  }
}
