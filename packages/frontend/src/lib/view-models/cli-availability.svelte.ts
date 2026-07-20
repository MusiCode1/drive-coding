/**
 * cli-availability.svelte.ts — VM לזמינות CLIs במסך ה-connect (slice cli-availability).
 *
 * מנהל: טעינה (loading/error), רשימת available (מסננת את ה-dropdown ב-+page.svelte).
 *
 * §6 Risks:
 *  - Race (dropdown נטען לפני שה-endpoint עונה): available מאותחל ל-CLI_KINDS המלא —
 *    ה-dropdown תמיד יש לו options תקינים, גם לפני שה-load() הראשון מסתיים.
 *  - Fallback ל"Show all": קריאה שנכשלת (endpoint לא מדווח זמינות) → available חוזר
 *    ל-CLI_KINDS המלא + error מאוכלס (ל-אינדיקציה חלשה ב-UI, §9 Q3).
 */
import { CLI_KINDS, type CliKind } from "@drive-coding/core"
import { fetchCliAvailability } from "$lib/adapters/cli-availability"

export class CliAvailability {
  loading = $state(true)
  error = $state<string | null>(null)
  available = $state<CliKind[]>([...CLI_KINDS])

  load = async (): Promise<void> => {
    this.loading = true
    this.error = null
    try {
      const result = await fetchCliAvailability()
      this.available = [...result.available]
    } catch (e) {
      // fallback: ה-BE לא מדווח זמינות → מציגים הכול (§2, §6)
      this.error = e instanceof Error ? e.message : String(e)
      this.available = [...CLI_KINDS]
    } finally {
      this.loading = false
    }
  }
}
