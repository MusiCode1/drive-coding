import type { CliKind, CliSpec } from "@drive-coding/core"
import { CLI_KINDS, CLI_SPECS } from "@drive-coding/core"
import { type BinaryCache, resolveCliBinaryCached } from "@drive-coding/core/cli-resolve"
import { loadCliSpecsOverride } from "./cli-config-file.js"

/**
 * cli-config.ts — resolution של פקודת ההרצה בזמן-ריצה.
 *
 * מקור-האמת ל-CLIs (שמות + bin/args/supportsModelFlag) חי ב-`@drive-coding/core`
 * (CLI_SPECS). כאן ה-resolution התלוי-סביבה:
 *   - opencode: דריסת ה-bin דרך override.bin (קובץ JSONC) ואחריו OPENCODE_BIN (env).
 *     override.bin גובר על OPENCODE_BIN (הקובץ מפורש יותר מ-env כללי).
 *   - שאר ה-CLIs: override של bin/args מהקובץ, ואז הוספת `--model <id>` לפי supportsModelFlag.
 */

export type CliCommand = {
  readonly bin: string // נתיב הרצה או שם
  readonly args: ReadonlyArray<string>
}

// ─── מטמון פתירת-בינאריים — בבעלות הקליפה ───────────────────────────────────────
// AGENTS.md: "packages/core/ — pure logic, no IO" · "Functional core / imperative shell".
// core מקבל את המטמון כפרמטר ואינו מחזיק state; **המופע חי כאן**, ב-provider,
// לצד ה-memoization הקיים של cli-config-file.ts.
// מופע יחיד = הגילוי וה-spawn רואים בדיוק את אותם נתיבים.
const binaryCache: BinaryCache = new Map()

/** המטמון המשותף. ה-backend מעביר אותו ל-detectAvailableClis כדי שגילוי ו-spawn יתלכדו. */
export function getBinaryCache(): BinaryCache {
  return binaryCache
}

/**
 * מחזיר את ה-spec הממוזג (CLI_SPECS + override) לשם CLI נתון.
 * משמש ל-env shaping ב-bridge-manager (unsetEnv/setEnv).
 * מקבל kind כ-string (לא BridgeKind) — כי הקובץ יכול להגדיר override לכל מפתח.
 */
export function getCliSpec(kind: string, env?: NodeJS.ProcessEnv): CliSpec | undefined {
  const base: CliSpec | undefined = CLI_SPECS[kind as CliKind]
  const override = loadCliSpecsOverride(env)[kind]

  // אם אין base ואין override — לא ידוע
  if (base === undefined && override === undefined) return undefined

  // מיזוג: override דורס כל שדה שהוא מגדיר
  return {
    bin: override?.bin ?? base?.bin ?? "",
    args: override?.args ?? base?.args ?? [],
    supportsModelFlag: override?.supportsModelFlag ?? base?.supportsModelFlag ?? false,
    ...(override?.unsetEnv !== undefined ? { unsetEnv: override.unsetEnv } : {}),
    ...(override?.setEnv !== undefined ? { setEnv: override.setEnv } : {}),
    // envVar (slice cli-availability): נשמר מה-base — אין לו שדה override ייעודי היום
    // (validateOverride לא כולל אותו), אבל detectAvailableClis צריך אותו כדי לכבד
    // את סדר-העדיפויות של getCliCommand (override.bin > envVar > spec.bin).
    ...(override?.envVar !== undefined
      ? { envVar: override.envVar }
      : base?.envVar !== undefined
        ? { envVar: base.envVar }
        : {}),
    // detectBin (slice cli-availability re-scope): נשמר מה-base — אין לו שדה override
    // ייעודי (כמו envVar). בלי זה, detectAvailableClis מקבל spec ללא detectBin עבור
    // claude/codex ונופל בחזרה ל-bin=npx — התיקון מנוטרל בשקט.
    ...(base?.detectBin !== undefined ? { detectBin: base.detectBin } : {}),
    // fallbackBins (slice cli-bin-resolution-unify): מה-base בלבד (אין לו שדה
    // override), ורק אם override לא הגדיר bin — override.bin מבטל fallbackBins,
    // בשונה מ-detectBin שנשמר תמיד. המשתמשת שכתבה bin מפורש בחרה בינארי; אין
    // לנחש חלופות עבורה.
    ...(override?.bin === undefined && base?.fallbackBins !== undefined
      ? { fallbackBins: base.fallbackBins }
      : {}),
    // displayName (slice cli-branding): override גובר על base.
    ...(override?.displayName !== undefined
      ? { displayName: override.displayName }
      : base?.displayName !== undefined
        ? { displayName: base.displayName }
        : {}),
    // logo (slice cli-branding): נכנס לחוט; ההגשה בפועל בסלייס cli-logo-serving.
    ...(override?.logo !== undefined
      ? { logo: override.logo }
      : base?.logo !== undefined
        ? { logo: base.logo }
        : {}),
  }
}

/**
 * המובנים ⊕ הקונפ'. המפתחות = כל ה-CLIs שהמערכת מכירה בזמן-ריצה.
 */
export function getEffectiveCliSpecs(env?: NodeJS.ProcessEnv): Record<string, CliSpec> {
  const result: Record<string, CliSpec> = {}
  for (const kind of CLI_KINDS) {
    const spec = getCliSpec(kind, env)
    if (spec !== undefined) result[kind] = spec
  }
  for (const kind of Object.keys(loadCliSpecsOverride(env))) {
    if (result[kind] !== undefined) continue
    const spec = getCliSpec(kind, env)
    if (spec !== undefined) result[kind] = spec
  }
  return result
}

/**
 * שמות בלבד. סדר: המובנים לפי סדר CLI_SPECS, ואז החדשים מהקונפ' לפי סדר הופעתם.
 */
export function getEffectiveCliKinds(env?: NodeJS.ProcessEnv): string[] {
  const override = loadCliSpecsOverride(env)
  const newKinds = Object.keys(override).filter((kind) => !(kind in CLI_SPECS))
  return [...CLI_KINDS, ...newKinds]
}

export function getCliCommand(
  kind: string,
  modelOverride?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): CliCommand {
  const spec = getCliSpec(kind, env)
  if (spec === undefined) {
    throw new Error(`Unknown cliKind: ${kind}`)
  }

  // טוען override מהקובץ (memoized)
  const override = loadCliSpecsOverride(env)[kind]

  // args: override.args גובר על spec.args
  const baseArgs = override?.args ?? spec.args

  const model = modelOverride?.trim() || null
  const args = model && spec.supportsModelFlag ? [...baseArgs, "--model", model] : [...baseArgs]

  // bin resolution (סדר עדיפויות):
  // 1. override.bin (קובץ JSONC — מפורש ביותר)
  // 2. OPENCODE_BIN (env var — רק ל-opencode)
  // 3. spec.bin (ברירת-מחדל מה-core)
  let bin: string
  if (override?.bin !== undefined) {
    // override.bin גובר על הכל (§9 Q2)
    bin = override.bin
  } else if (kind === "opencode") {
    // OPENCODE_BIN נפתר בזמן הקריאה — D14 (Proxmox)
    bin = env.OPENCODE_BIN ?? spec.bin
  } else {
    bin = spec.bin
  }

  // bin resolution שלב 2 (slice cli-bin-resolution-unify): השם שנבחר → נתיב מוחלט.
  // fallbackBins מועברים רק כשה-bin לא הגיע מ-override (המשתמשת בחרה בינארי מפורש).
  const fromOverride = override?.bin !== undefined
  const resolved = resolveCliBinaryCached(
    {
      bin,
      ...(fromOverride ? {} : spec.fallbackBins ? { fallbackBins: spec.fallbackBins } : {}),
    },
    env,
    binaryCache,
  )
  // לא נמצא → מחזירים את השם כמות שהוא, בדיוק כמו היום. זה משמר את הודעת-השגיאה
  // הקיימת (describe-crash / ENOENT) ולא מוסיף failure mode חדש.
  bin = resolved ?? bin

  // Commit 4 (windows-adaptation): OPENCODE_ARGS env override — נחוץ ל-tests cross-platform.
  // JSON array, למשל: OPENCODE_ARGS='["-e","process.stdin.resume()"]'
  const finalArgs: ReadonlyArray<string> =
    kind === "opencode" && env.OPENCODE_ARGS ? (JSON.parse(env.OPENCODE_ARGS) as string[]) : args

  return { bin, args: finalArgs }
}
