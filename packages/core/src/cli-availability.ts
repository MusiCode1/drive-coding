/**
 * cli-availability.ts — pure discovery of which CLI_KINDS are installed locally.
 *
 * Reuses resolveCliBinaryCached (fs.existsSync + env only, no spawn — cached so repeat
 * discovery calls don't re-scan PATH). Does not run the CLI — only checks binary
 * existence, mirroring the priority order of getCliCommand (override.bin > envVar >
 * PATH/pm-global-bins/knownPaths/fallbackBins) so a CLI reachable through an override
 * isn't wrongly filtered out.
 *
 * slice: cli-availability
 */

import { resolveCliBinaryCached } from "./cli-resolve.js"
import type { CliKind, CliSpec } from "./schemas/agent.js"
import { CLI_SPECS } from "./schemas/agent.js"

export interface CliAvailabilityDetails {
  found: boolean
  path?: string
  source: "path" | "override" | "not-found"
  /** שם-תצוגה (slice cli-branding). מגיע מ-spec.displayName, לא תלוי ב-found. */
  displayName?: string
  /** נתיב-לוגו (slice cli-branding). מגיע מ-spec.logo, לא תלוי ב-found; לא מוגש עדיין. */
  logo?: string
}

export interface CliAvailabilityResult {
  available: readonly string[]
  details: Readonly<Record<string, CliAvailabilityDetails>>
}

/**
 * מגלה אילו CLIs זמינים בסביבת הריצה — כולל כאלה מהקונפ' שהפרויקט לא מכיר (slice
 * open-cli-registry: specs/overrideKinds/available/details הורחבו ל-string; שלושת
 * ה-locals הפנימיים (available/details/הלולאה) נשארים מוקלדים CliKind בכוונה —
 * חצי-הרחבה שוברת, ר' תיעוד-הבריף).
 * @param specs מיפוי kind → CliSpec (ברירת מחדל CLI_SPECS; ה-backend מעביר מיפוי
 *   ממוזג עם override קובץ, כדי ש-core ישאר טהור ולא ייגע בקבצים).
 * @param env process.env אופציונלי (למען טסטים; ברירת מחדל process.env בתוך resolveCliBinary).
 * @param overrideKinds רשימת kind-ים שה-bin שלהם מגיע מ-override — עבורם envVar מדולג
 *   כדי לשקף את סדר העדיפויות של getCliCommand (override.bin קודם ל-envVar).
 */
export function detectAvailableClis(
  specs: Readonly<Record<string, CliSpec>> = CLI_SPECS,
  env?: NodeJS.ProcessEnv,
  overrideKinds?: readonly string[],
): CliAvailabilityResult {
  const available: CliKind[] = []
  const details = {} as Record<CliKind, CliAvailabilityDetails>

  for (const kind of Object.keys(specs) as CliKind[]) {
    const spec = specs[kind]
    if (spec === undefined) continue
    const isOverride = overrideKinds?.includes(kind) ?? false

    // isOverride: המשתמשת כתבה bin מפורש בקונפיג — בחרה בינארי, אין לנחש fallbacks.
    const resolved = isOverride
      ? resolveCliBinaryCached({ bin: spec.bin }, env)
      : resolveCliBinaryCached(
          {
            bin: spec.detectBin ?? spec.bin,
            envVar: spec.envVar,
            ...(spec.fallbackBins ? { fallbackBins: spec.fallbackBins } : {}),
          },
          env,
        )

    const found = resolved !== undefined
    const source: CliAvailabilityDetails["source"] = found
      ? isOverride
        ? "override"
        : "path"
      : "not-found"

    // displayName/logo (slice cli-branding): מגיעים מה-spec, לא תלויים ב-found —
    // מיתוג עצמאי מזמינות. אתר הפליטה הוא טרנרי (found ? {…} : {…}), לא spread
    // מותנה (זה חי ב-cli-config.ts) — לכן שני הענפים כוללים אותם מפורשות.
    details[kind] = found
      ? {
          found,
          path: resolved,
          source,
          ...(spec.displayName !== undefined ? { displayName: spec.displayName } : {}),
          ...(spec.logo !== undefined ? { logo: spec.logo } : {}),
        }
      : {
          found,
          source,
          ...(spec.displayName !== undefined ? { displayName: spec.displayName } : {}),
          ...(spec.logo !== undefined ? { logo: spec.logo } : {}),
        }
    if (found) available.push(kind)
  }

  return { available, details }
}
