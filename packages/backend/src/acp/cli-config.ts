import type { BridgeKind } from "@drive-coding/core"

/**
 * CLI command mapping for ACP agents.
 * Slice 3: opencode only. Other CLIs to be added in future slices.
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
