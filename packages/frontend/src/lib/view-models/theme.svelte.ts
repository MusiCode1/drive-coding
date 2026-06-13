/**
 * theme.svelte.ts — ThemeVM: ניהול פלטת הצבעים הפעילה.
 *
 * מחזיק את הפלטה ב-$state, שומר ב-localStorage, ומפעיל data-palette על <html>.
 * ה-FE כבר SPA-only (ssr=false) — constructor רץ בדפדפן בלבד.
 */

export type Palette =
  | "ember" | "forest" | "plum" | "teal"
  | "midnight" | "rose" | "slate" | "daylight"

export const PALETTES: readonly Palette[] = [
  "ember", "forest", "plum", "teal",
  "midnight", "rose", "slate", "daylight",
]

const STORAGE_KEY = "drive-coding.palette"
const DEFAULT_PALETTE: Palette = "ember"

export class ThemeVM {
  palette = $state<Palette>(DEFAULT_PALETTE)

  constructor() {
    const saved = this.#read()
    if (saved) this.palette = saved
    this.#apply()
  }

  setPalette(p: Palette): void {
    this.palette = p
    this.#persist(p)
    this.#apply()
  }

  #apply(): void {
    document.documentElement.dataset.palette = this.palette
  }

  #read(): Palette | undefined {
    try {
      const v = localStorage.getItem(STORAGE_KEY)
      return PALETTES.includes(v as Palette) ? (v as Palette) : undefined
    } catch { return undefined }
  }

  #persist(p: Palette): void {
    try { localStorage.setItem(STORAGE_KEY, p) } catch { /* ignore */ }
  }
}
