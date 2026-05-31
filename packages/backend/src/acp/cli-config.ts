import type { BridgeKind } from "@drive-coding/core"

/**
 * מיפוי פקודות CLI עבור סוכני ACP.
 * Slice 3: רק opencode. CLI אחרים יתווספו בסלייסים עתידיים.
 */
export type CliCommand = {
  readonly bin: string // נתיב הרצה או שם
  readonly args: ReadonlyArray<string>
}

export function getCliCommand(kind: BridgeKind, modelOverride?: string | null): CliCommand {
  const model = modelOverride?.trim() || null
  switch (kind) {
    case "opencode":
      // אצל אבי ב-/home/user/.opencode/bin/opencode (D14 — Proxmox)
      // נסה bin in PATH ראשון, אחרת fallback.
      // `opencode acp` לא מקבל -m / --model — הוא משתמש במודל 
      // ברירת המחדל מהקונפיגורציה של `opencode auth`. דריסת מודל פר-סשן
      // צריכה לקרות בזמן session/new דרך ה-ACP SDK (סלייס עתידי).
      // אנחנו מקבלים modelOverride ב-API אבל כרגע מתעלמים ממנו עבור opencode.
      return {
        bin: process.env.OPENCODE_BIN ?? "opencode",
        args: ["acp"],
      }
    case "claude":
      return {
        bin: "npx",
        args: model
          ? ["-y", "@agentclientprotocol/claude-agent-acp@latest", "--model", model]
          : ["-y", "@agentclientprotocol/claude-agent-acp@latest"],
      }
    case "gemini":
      return {
        bin: "gemini",
        args: model
          ? ["--acp", "--model", model]
          : ["--acp"],
      }
    case "codex":
      return {
        bin: "npx",
        args: model
          ? ["-y", "@zed-industries/codex-acp@latest", "--model", model]
          : ["-y", "@zed-industries/codex-acp@latest"],
      }

    case "qoder":
      return {
        bin: "qodercli",
        args: model
          ? ["--acp", "--model", model]
          : ["--acp"],
      }
  }
}
