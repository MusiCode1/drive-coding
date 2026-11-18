/**
 * acp-bridge.ts — resolving the ACP bridge we actually depend on.
 *
 * Some CLIs do not speak ACP themselves; a separate adapter package does it for
 * them. `claude` is the case that matters here: the core cli-spec points at
 * `npx -y @agentclientprotocol/claude-agent-acp@latest`, which is fine for a
 * one-off on a developer's laptop and wrong for a long-lived sidecar.
 *
 * 🔴 Measured 2026-09-08:
 *
 * | | version | cost |
 * |---|---|---|
 * | `npx -y …@latest` | **0.75.1** | **23s** per spawn, needs the network |
 * | the copy we ship  | 0.58.1  | instant, offline |
 *
 * Seventeen minor versions apart, and the pinned one is the only one anything
 * has ever been tested against — `connect-in-process.ts` imports it as a
 * library. Two bridges of different versions for the same CLI, chosen by which
 * code path you happened to take, is not a difference anyone would debug
 * quickly.
 *
 * So: prefer the installed copy, and fall back to the spec only if it is not
 * there. The interpreter is the one running us, by absolute path, because a
 * transient systemd unit does not inherit a PATH that can find one.
 */

import { createRequire } from "node:module"

const require_ = createRequire(import.meta.url)

/** cliKind → the npm package whose `bin` speaks ACP on its behalf. */
const BRIDGE_PACKAGES: Record<string, string> = {
  claude: "@agentclientprotocol/claude-agent-acp",
}

/**
 * The installed bridge for this cliKind, or null if there is none to prefer.
 *
 * Returns a command in the same shape as `getCliCommand`, so a caller can use
 * it in place of the spec without special-casing anything else.
 */
export function resolveVendoredAcpBridge(cliKind: string): { bin: string; args: string[] } | null {
  const pkg = BRIDGE_PACKAGES[cliKind]
  if (pkg === undefined) return null
  try {
    const manifestPath = require_.resolve(`${pkg}/package.json`)
    const manifest = require_(manifestPath) as { bin?: string | Record<string, string> }
    const rel =
      typeof manifest.bin === "string" ? manifest.bin : Object.values(manifest.bin ?? {})[0]
    if (rel === undefined) return null
    const entry = require_.resolve(`${pkg}/${rel}`)
    return { bin: process.execPath, args: [entry] }
  } catch {
    // Not installed — the caller falls back to the spec, which still works.
    return null
  }
}
