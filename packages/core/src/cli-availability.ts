/**
 * cli-availability.ts — pure discovery of which CLI_KINDS are installed locally.
 *
 * Reuses resolveCliBinary (fs.existsSync + env only, no spawn). Does not run the CLI —
 * only checks binary existence, mirroring the priority order of getCliCommand
 * (override.bin > envVar > PATH/pm-global-bins/knownPaths) so a CLI reachable through
 * an override isn't wrongly filtered out.
 *
 * slice: cli-availability
 */

import type { CliKind, CliSpec } from "./schemas/agent.js"
import { CLI_SPECS } from "./schemas/agent.js"
import { resolveCliBinary } from "./cli-resolve.js"

export interface CliAvailabilityDetails {
  found: boolean
  path?: string
  source: "path" | "override" | "not-found"
}

export interface CliAvailabilityResult {
  available: readonly CliKind[]
  details: Readonly<Record<CliKind, CliAvailabilityDetails>>
}

/**
 * מגלה אילו CLI_KINDS זמינים בסביבת הריצה.
 * @param specs מיפוי CliKind → CliSpec (ברירת מחדל CLI_SPECS; ה-backend מעביר מיפוי
 *   ממוזג עם override קובץ, כדי ש-core ישאר טהור ולא ייגע בקבצים).
 * @param env process.env אופציונלי (למען טסטים; ברירת מחדל process.env בתוך resolveCliBinary).
 * @param overrideKinds רשימת kind-ים שה-bin שלהם מגיע מ-override — עבורם envVar מדולג
 *   כדי לשקף את סדר העדיפויות של getCliCommand (override.bin קודם ל-envVar).
 */
export function detectAvailableClis(
  specs: Readonly<Record<CliKind, CliSpec>> = CLI_SPECS,
  env?: NodeJS.ProcessEnv,
  overrideKinds?: readonly CliKind[],
): CliAvailabilityResult {
  const available: CliKind[] = []
  const details = {} as Record<CliKind, CliAvailabilityDetails>

  for (const kind of Object.keys(specs) as CliKind[]) {
    const spec = specs[kind]
    const isOverride = overrideKinds?.includes(kind) ?? false

    const resolved = isOverride
      ? resolveCliBinary({ bin: spec.bin }, env)
      : resolveCliBinary({ bin: spec.detectBin ?? spec.bin, envVar: spec.envVar }, env)

    const found = resolved !== undefined
    const source: CliAvailabilityDetails["source"] = found
      ? isOverride
        ? "override"
        : "path"
      : "not-found"

    details[kind] = found ? { found, path: resolved, source } : { found, source }
    if (found) available.push(kind)
  }

  return { available, details }
}
