import type { BridgeKind } from "@drive-coding/core"

/**
 * מיפוי CliKind ל-command + args ל-`@rebornix/stdio-to-ws`.
 * Slice 3: רק opencode. שאר ה-CLIs יוסיפו ב-Slice עתידי.
 */
export type CliCommand = {
  readonly bin: string // executable path or name
  readonly args: ReadonlyArray<string>
}

export function getCliCommand(kind: BridgeKind): CliCommand {
  switch (kind) {
    case "opencode":
      // אצל אבי ב-/home/user/.opencode/bin/opencode (D14 — Proxmox)
      // נסה bin in PATH ראשון, אחרת fallback.
      return {
        bin: process.env.OPENCODE_BIN ?? "opencode",
        args: ["acp"],
      }
    case "claude":
      return {
        bin: "npx",
        args: ["-y", "@agentclientprotocol/claude-agent-acp@latest"],
      }
    case "gemini":
      return {
        bin: "npx",
        args: ["-y", "@google/gemini-cli@latest", "--experimental-acp"],
      }
    case "codex":
      return {
        bin: "npx",
        args: ["-y", "@zed-industries/codex-acp@latest"],
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
