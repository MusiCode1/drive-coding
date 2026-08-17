/**
 * cli-availability.ts — adapter עבור GET /api/cli-availability (slice cli-availability;
 * הורחב ל-string ב-slice open-cli-registry-fe, Commit 1 — היישר לחוזה של core
 * (`core/src/cli-availability.ts:22-25`), שכבר `readonly string[]` / `Record<string, …>`).
 *
 * מביא אילו CLIs מותקנים בסביבת הריצה של השרת, כדי שה-dropdown ב-`/` יסנן אליהם.
 */

import { beUrl } from "$lib/util/be-url"

export type CliAvailabilityDetails = {
  found: boolean
  path?: string
  source: "path" | "override" | "not-found"
  /** שם-תצוגה (slice cli-branding). חסר → ה-FE מציג את המזהה. */
  displayName?: string
  /** נתיב-לוגו (slice cli-branding). נקרא בלבד; ההגשה בסלייס cli-logo-serving. */
  logo?: string
}

export type CliAvailabilityResult = {
  available: string[]
  details: Record<string, CliAvailabilityDetails>
}

/**
 * מביא את מצב הזמינות מהשרת. זורק אם הבקשה נכשלת (ה-VM קולט ומפעיל fallback).
 */
export async function fetchCliAvailability(): Promise<CliAvailabilityResult> {
  const res = await fetch(beUrl("/api/cli-availability"))
  if (!res.ok) throw new Error(`/api/cli-availability ${res.status}`)
  return res.json() as Promise<CliAvailabilityResult>
}

/**
 * Manual reload backup (slice cli-specs-hot-reload): POST /api/reload-config,
 * which invalidates the BE cache and broadcasts config_changed back to the FE.
 */
export async function postReloadConfig(): Promise<void> {
  await fetch(beUrl("/api/reload-config"), { method: "POST" })
}
