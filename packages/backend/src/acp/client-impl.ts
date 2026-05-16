import * as fs from "node:fs/promises"
import type { Client } from "@agentclientprotocol/sdk"

/**
 * Minimal Client implementation passed to ClientSideConnection.
 *
 * Slice 4 strategy:
 * - requestPermission: auto-allow_once (no UI yet)
 * - sessionUpdate: handled externally via onUpdate callback in acp-transport.ts
 * - fs/readTextFile + fs/writeTextFile: passthrough to host filesystem.
 *   Declared in clientCapabilities so agent can use them (e.g. read editor
 *   buffers — though we have no editor, we still let agent read disk).
 * - terminal/*: not implemented (terminal capability not declared).
 */
export function createClientImpl(opts: {
  onSessionUpdate: (notification: Parameters<NonNullable<Client["sessionUpdate"]>>[0]) => void
}): Client {
  return {
    async requestPermission(params) {
      // Slice 4: auto-allow. Slice 7+: forward to UI for user prompt.
      // Match by `kind` (typed enum), NOT `optionId` (which is an arbitrary
      // string the agent picks). Spec: `kind: "allow_once" | "allow_always"
      // | "reject_once" | "reject_always"`.
      // Prefer allow_once > allow_always > first option (avoids accidental reject).
      const byKind = (k: string) => params.options.find((o) => o.kind === k)
      const chosen =
        byKind("allow_once") ??
        byKind("allow_always") ??
        params.options.find((o) => !o.kind.startsWith("reject")) ??
        params.options[0]
      if (!chosen) {
        return { outcome: { outcome: "cancelled" } }
      }
      return { outcome: { outcome: "selected", optionId: chosen.optionId } }
    },

    async sessionUpdate(notification) {
      opts.onSessionUpdate(notification)
    },

    async readTextFile(params) {
      // ACP spec: paths are absolute. Pass through to host fs.
      const content = await fs.readFile(params.path, "utf8")
      if (params.line != null || params.limit != null) {
        const lines = content.split("\n")
        const start = (params.line ?? 1) - 1
        const end = params.limit != null ? start + params.limit : undefined
        return { content: lines.slice(start, end).join("\n") }
      }
      return { content }
    },

    async writeTextFile(params) {
      await fs.writeFile(params.path, params.content, "utf8")
      return {}
    },
  }
}
