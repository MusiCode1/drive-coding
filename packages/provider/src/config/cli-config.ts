import type { CliSpec } from "@drive-coding/core"
import { CLI_SPECS } from "@drive-coding/core"
import type { BridgeKind } from "../spawn/types.js"
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

/**
 * מחזיר את ה-spec הממוזג (CLI_SPECS + override) לשם CLI נתון.
 * משמש ל-env shaping ב-bridge-manager (unsetEnv/setEnv).
 * מקבל kind כ-string (לא BridgeKind) — כי הקובץ יכול להגדיר override לכל מפתח.
 */
export function getCliSpec(kind: string, env?: NodeJS.ProcessEnv): CliSpec | undefined {
  const base: CliSpec | undefined = CLI_SPECS[kind as BridgeKind]
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
  }
}

export function getCliCommand(kind: BridgeKind, modelOverride?: string | null): CliCommand {
  const spec = CLI_SPECS[kind]
  if (spec === undefined) {
    throw new Error(`Unsupported BridgeKind: ${kind}`)
  }

  // טוען override מהקובץ (memoized)
  const override = loadCliSpecsOverride()[kind]

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
    bin = process.env.OPENCODE_BIN ?? spec.bin
  } else {
    bin = spec.bin
  }

  // Commit 4 (windows-adaptation): OPENCODE_ARGS env override — נחוץ ל-tests cross-platform.
  // JSON array, למשל: OPENCODE_ARGS='["-e","process.stdin.resume()"]'
  const finalArgs: ReadonlyArray<string> =
    kind === "opencode" && process.env.OPENCODE_ARGS
      ? (JSON.parse(process.env.OPENCODE_ARGS) as string[])
      : args

  return { bin, args: finalArgs }
}
