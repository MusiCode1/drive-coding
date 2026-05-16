import type { BridgeKind } from "@drive-coding/core"

/**
 * מיפוי CliKind ל-command + args ל-`@rebornix/stdio-to-ws`.
 * Slice 3: רק opencode. שאר ה-CLIs יוסיפו ב-Slice עתידי.
 */
export type CliCommand = {
  readonly bin: string // executable path or name
  readonly args: ReadonlyArray<string>
}

export function getCliCommand(kind: BridgeKind, modelOverride?: string | null): CliCommand {
  const model = modelOverride?.trim() || null
  switch (kind) {
    case "opencode":
      // אצל אבי ב-/home/user/.opencode/bin/opencode (D14 — Proxmox)
      // נסה bin in PATH ראשון, אחרת fallback.
      // `opencode acp` doesn't accept -m / --model — it uses the default
      // model from `opencode auth` config. Per-session model override needs
      // to happen at session/new time via the ACP SDK (future slice).
      // We accept modelOverride in the API but currently ignore it for opencode.
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
        bin: "npx",
        args: model
          ? ["-y", "@google/gemini-cli@latest", "--experimental-acp", "--model", model]
          : ["-y", "@google/gemini-cli@latest", "--experimental-acp"],
      }
    case "codex":
      return {
        bin: "npx",
        args: model
          ? ["-y", "@zed-industries/codex-acp@latest", "--model", model]
          : ["-y", "@zed-industries/codex-acp@latest"],
      }
  }
}

/**
 * Args ל-stdio-to-ws שיעטוף את ה-CLI.
 * הCLI command מועבר כstring יחיד (stdio-to-ws עושה parse).
 */
export function buildStdioToWsArgs(cli: CliCommand, port = 0): ReadonlyArray<string> {
  const cliCommand = [cli.bin, ...cli.args].join(" ")
  return [
    "-y",
    "@rebornix/stdio-to-ws",
    cliCommand,
    "--port",
    String(port),
    "--persist",
    "--grace-period",
    "-1",
  ]
}
