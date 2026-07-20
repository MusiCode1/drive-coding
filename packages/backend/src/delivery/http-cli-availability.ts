/**
 * http-cli-availability.ts — HTTP endpoint לגילוי CLIs מותקנים בסביבה.
 *
 * GET /api/cli-availability → 200 CliAvailabilityResult (JSON)
 *
 * ממזג CLI_SPECS (core) עם override מהקובץ (getCliSpec — provider/config), מזהה אילו
 * kind-ים קיבלו override.bin, ומעביר את המיפוי הממוזג + overrideKinds ל-detectAvailableClis
 * (core, pure) כדי ש-core ישאר ללא תלות בקבצים.
 *
 * slice: cli-availability
 */

import type { CliKind, CliSpec } from "@drive-coding/core"
import { CLI_KINDS, CLI_SPECS, detectAvailableClis } from "@drive-coding/core"
import { getCliSpec } from "@drive-coding/provider/config"
import type { Hono } from "hono"

export function registerCliAvailabilityHttp(app: Hono): void {
  // GET /api/cli-availability — { available: CliKind[], details: Record<CliKind, ...> }
  app.get("/api/cli-availability", (c) => {
    const mergedSpecs = {} as Record<CliKind, CliSpec>
    const overrideKinds: CliKind[] = []

    for (const kind of CLI_KINDS) {
      const spec = getCliSpec(kind, process.env)
      if (spec === undefined) continue // לא אמור לקרות — יש base לכל kind ב-CLI_KINDS
      if (spec.bin !== CLI_SPECS[kind].bin) overrideKinds.push(kind)
      mergedSpecs[kind] = spec
    }

    const result = detectAvailableClis(mergedSpecs, process.env, overrideKinds)
    return c.json(result)
  })
}
