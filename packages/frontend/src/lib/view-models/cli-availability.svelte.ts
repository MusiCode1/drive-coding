/**
 * cli-availability.svelte.ts — VM לזמינות CLIs במסך ה-connect (slice cli-availability;
 * הורחב ל-registry+details ב-slice open-cli-registry-fe, Commit 1).
 *
 * מנהל: טעינה (loading/error), רשימת available (ה-disabled flag), registry (הרג'יסטרי
 * האפקטיבי המלא מה-BE — מקור ה-options בדרופדאון, ר' Commit 2), details (פר-kind).
 *
 * §6 Risks:
 *  - Race (dropdown נטען לפני שה-endpoint עונה): available+registry מאותחלים ל-CLI_KINDS
 *    המלא — ה-dropdown תמיד יש לו options תקינים, גם לפני שה-load() הראשון מסתיים.
 *  - Fallback ל"Show all": קריאה שנכשלת (endpoint לא מדווח זמינות) → available+registry
 *    חוזרים ל-CLI_KINDS המלא, details={}, error מאוכלס (ל-אינדיקציה חלשה ב-UI, §9 Q3).
 *    סמנטיקת ה-fallback ("הצג הכול + אינדיקציה חלשה") לא משתנה (הוכרע ב-slice
 *    cli-availability; open-cli-registry-fe §4 C1 מפרש זאת מפורשות).
 */
import { CLI_KINDS } from "@drive-coding/core"
import { type CliAvailabilityDetails, fetchCliAvailability } from "$lib/adapters/cli-availability"

export class CliAvailability {
  loading = $state(true)
  error = $state<string | null>(null)
  /** מותקנים בפועל (found===true). נשאר לצורך ה-disabled flag. */
  available = $state<string[]>([...CLI_KINDS])
  /** הרג'יסטרי האפקטיבי המלא, כולל CLIs שלא נמצאו. מקורו ב-Object.keys(details). */
  registry = $state<string[]>([...CLI_KINDS])
  /** פרטי-זמינות פר-kind, ל-description/tooltip. */
  details = $state<Record<string, CliAvailabilityDetails>>({})
  /** נפתר אחרי ה-load() הראשון (הצלחה או כשל). לצרכנים שצריכים registry מאוכלס. */
  readonly ready: Promise<void>

  #resolveReady!: () => void

  constructor() {
    this.ready = new Promise((resolve) => {
      this.#resolveReady = resolve
    })
  }

  load = async (): Promise<void> => {
    this.loading = true
    this.error = null
    try {
      const result = await fetchCliAvailability()
      this.available = [...result.available]
      this.details = result.details
      this.registry = Object.keys(result.details)
    } catch (e) {
      // fallback: ה-BE לא מדווח זמינות → מציגים הכול (§2, §6)
      this.error = e instanceof Error ? e.message : String(e)
      this.available = [...CLI_KINDS]
      this.registry = [...CLI_KINDS]
      this.details = {}
    } finally {
      this.loading = false
      this.#resolveReady()
    }
  }

  /**
   * Quiet background refresh (no loading spinner). Used by the config-change WS
   * broadcast and the manual refresh button (slice cli-specs-hot-reload).
   */
  reload = async (): Promise<void> => {
    try {
      const result = await fetchCliAvailability()
      this.available = [...result.available]
      this.details = result.details
      this.registry = Object.keys(result.details)
      this.error = null
    } catch (e) {
      console.warn("[CliAvailability] reload failed:", e)
    }
  }
}
