import { type BridgeKind, CLI_SPECS } from "@drive-coding/core"

/**
 * cli-config.ts — resolution של פקודת ההרצה בזמן-ריצה.
 *
 * מקור-האמת ל-CLIs (שמות + bin/args/supportsModelFlag) חי ב-`@drive-coding/core`
 * (CLI_SPECS). כאן רק ה-resolution התלוי-סביבה:
 *   - opencode: דריסת ה-bin דרך `OPENCODE_BIN` (process.env, בזמן-ריצה).
 *   - שאר ה-CLIs: הוספת `--model <id>` כשיש modelOverride ו-supportsModelFlag.
 */

export type CliCommand = {
  readonly bin: string // נתיב הרצה או שם
  readonly args: ReadonlyArray<string>
}

export function getCliCommand(kind: BridgeKind, modelOverride?: string | null): CliCommand {
  const spec = CLI_SPECS[kind]
  if (spec === undefined) {
    throw new Error(`Unsupported BridgeKind: ${kind}`)
  }

  const model = modelOverride?.trim() || null
  const args = model && spec.supportsModelFlag ? [...spec.args, "--model", model] : [...spec.args]

  // OPENCODE_BIN נפתר בזמן הקריאה (לא בזמן טעינת המודול) — מאפשר override
  // דינמי דרך env, ותואם את התנהגות ה-service file (OPENCODE_BIN=opencode-clean.sh).
  // D14 (Proxmox): אצל אבי ב-/home/user/.opencode/bin/opencode.
  const bin = kind === "opencode" ? (process.env.OPENCODE_BIN ?? spec.bin) : spec.bin

  return { bin, args }
}
