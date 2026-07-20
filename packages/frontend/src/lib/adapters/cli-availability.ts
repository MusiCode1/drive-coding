/**
 * cli-availability.ts — adapter עבור GET /api/cli-availability (slice cli-availability).
 *
 * מביא אילו CLIs מותקנים בסביבת הריצה של השרת, כדי שה-dropdown ב-`/` יסנן אליהם.
 */

import type { CliKind } from "@drive-coding/core"
import { beUrl } from "$lib/util/be-url"

export type CliAvailabilityDetails = {
  found: boolean
  path?: string
  source: "path" | "override" | "not-found"
}

export type CliAvailabilityResult = {
  available: CliKind[]
  details: Record<CliKind, CliAvailabilityDetails>
}

/**
 * מביא את מצב הזמינות מהשרת. זורק אם הבקשה נכשלת (ה-VM קולט ומפעיל fallback).
 */
export async function fetchCliAvailability(): Promise<CliAvailabilityResult> {
  const res = await fetch(beUrl("/api/cli-availability"))
  if (!res.ok) throw new Error(`/api/cli-availability ${res.status}`)
  return res.json() as Promise<CliAvailabilityResult>
}
