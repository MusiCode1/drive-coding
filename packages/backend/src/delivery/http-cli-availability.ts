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
import { CLI_SPECS } from "@drive-coding/core"
import { detectAvailableClis } from "@drive-coding/core/cli-availability"
import { getBinaryCache, getCliSpec, getEffectiveCliKinds } from "@drive-coding/provider/config"
import type { Hono } from "hono"

export function registerCliAvailabilityHttp(app: Hono, env: NodeJS.ProcessEnv): void {
  // GET /api/cli-availability — { available: string[], details: Record<string, ...> }
  app.get("/api/cli-availability", (c) => {
    const mergedSpecs: Record<string, CliSpec> = {}
    const overrideKinds: string[] = []

    for (const kind of getEffectiveCliKinds(env)) {
      const spec = getCliSpec(kind, env)
      if (spec === undefined) continue
      const base = CLI_SPECS[kind as CliKind]
      if (base === undefined || spec.bin !== base.bin) overrideKinds.push(kind)
      mergedSpecs[kind] = spec
    }

    const result = detectAvailableClis(mergedSpecs, env, overrideKinds, getBinaryCache())
    return c.json(result)
  })
}
