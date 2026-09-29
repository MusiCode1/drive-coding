import { occludedPx, readSafeBottomPx } from "$lib/util/viewport-insets"

/** What the engine reports on every viewport change. */
export type ViewportInsets = {
  /** `env(safe-area-inset-bottom)` in CSS px - 0 without a display cutout. */
  safeBottomPx: number
  /** How much of the layout viewport the on-screen keyboard covers, in CSS px. */
  keyboardPx: number
}

/**
 * ViewportInsetsEngine - owns the listeners behind the two insets a phone imposes.
 *
 * This is an engine (engines/), not a VM: it owns imperative browser resources
 * (visualViewport + orientationchange listeners, and one custom property on <html>) and
 * holds no $state. ResponsiveVM constructs it and mirrors its reports into $state, which
 * is the sanctioned direction - view-models may import engines.
 * Browser-only; SSR guarded.
 *
 * ─── slice mobile-parity ───
 *
 * Why it exists. `app.css` pins `html, body { height: 100dvh; overflow: hidden }` and
 * AppShell is `h-[100dvh]`. `dvh` follows *browser chrome* (toolbars collapsing on
 * scroll); it does NOT follow the on-screen keyboard. So on a phone, opening the keyboard
 * over TypeArea leaves the layout viewport at full height: the composer and its send
 * button end up behind the keyboard and cannot be scrolled back, because the body is
 * `overflow: hidden`. Typing - one of the four input modes - is blind.
 * `interactive-widget=resizes-content` would fix Chrome/Android, but iOS Safari ignores
 * it, and iOS is also the platform shipping the notch this slice pays back.
 * visualViewport is the one signal both honour.
 *
 * `--kb` is written here rather than passed down so any surface can spend it in plain CSS
 * (AppShell and the connect screen both do), without threading a prop through the tree.
 */
export class ViewportInsetsEngine {
  #onChange: (insets: ViewportInsets) => void
  #vv: VisualViewport | null = null
  #bound: (() => void) | null = null
  #lastKb = -1

  constructor(onChange: (insets: ViewportInsets) => void) {
    this.#onChange = onChange
  }

  /** Idempotent. Attaches listeners and reports once immediately. */
  start(): void {
    if (typeof window === "undefined") return
    if (this.#bound !== null) return

    this.#bound = () => this.#sync()
    // A rotation moves the cutout from the bottom edge to a side, so the safe inset has
    // to be re-measured even when visualViewport is absent.
    window.addEventListener("orientationchange", this.#bound)

    const vv = window.visualViewport
    if (vv) {
      this.#vv = vv
      // "resize" catches the keyboard opening/closing; "scroll" catches iOS shifting the
      // visual viewport inside an otherwise unchanged layout viewport.
      vv.addEventListener("resize", this.#bound)
      vv.addEventListener("scroll", this.#bound)
    }
    this.#sync()
  }

  /** Removes listeners and returns `--kb` to 0px. Safe to call twice. */
  dispose(): void {
    const bound = this.#bound
    if (bound !== null) {
      window.removeEventListener("orientationchange", bound)
      this.#vv?.removeEventListener("resize", bound)
      this.#vv?.removeEventListener("scroll", bound)
    }
    this.#vv = null
    this.#bound = null
    this.#lastKb = -1
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty("--kb", "0px")
    }
  }

  #sync(): void {
    const vv = this.#vv
    const keyboardPx =
      vv === null ? 0 : occludedPx(document.documentElement.clientHeight, vv.height, vv.offsetTop)

    // Write --kb only on a real change: this fires on every scroll frame on iOS, and an
    // unconditional setProperty would force a style recalc each time.
    if (keyboardPx !== this.#lastKb) {
      this.#lastKb = keyboardPx
      document.documentElement.style.setProperty("--kb", `${keyboardPx}px`)
    }
    this.#onChange({ safeBottomPx: readSafeBottomPx(), keyboardPx })
  }
}
