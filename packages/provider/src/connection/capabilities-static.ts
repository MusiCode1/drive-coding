/**
 * capabilities-static.ts — static capabilities map per cliKind.
 *
 * Covers both spawn-based connections (opencode, claude-fallback) and in-process
 * connections (codex) that do not go through a live initialize handshake.
 * MVP: conservative defaults; configOptions and ext-dependent features = false.
 * Will be filled in as CUT-3b-iii+ rounds out the primitive.
 *
 * codex (in-process via startAcpServer): mcp:true, thinkingTokens:false, rename:false.
 * Values derived from live codex initialize response (aomvted in-process harness):
 *   mcpCapabilities.http:true → mcp:true
 *   promptCapabilities.image:true (not currently mapped to NormalizedCapabilities field)
 *   thinking: not supported → thinkingTokens:false
 *   rename/fork: not exposed → rename:false
 */

import type { SpawnBridgeInput } from "../spawn/index.js"
import type { NormalizedCapabilities } from "../types.js"

/**
 * Returns a static NormalizedCapabilities for a given cliKind (spawn-native).
 * ext is undefined for spawn, so ext-channel features are false.
 */
export function staticCapsFor(cliKind: SpawnBridgeInput["cliKind"]): NormalizedCapabilities {
  switch (cliKind) {
    case "opencode":
      return {
        mcp: false,
        compact: false,
        commands: false,
        usage: false,
        configOptions: false, // discovered at runtime in CUT-3b-iii+
        rename: false,
        thinkingTokens: false,
        image: false, // slice reattach-state-sync: safe default; the init-frame tap updates this
      }
    case "claude":
      return {
        mcp: false,
        compact: false,
        commands: false,
        usage: false,
        configOptions: false,
        rename: false,
        thinkingTokens: false,
        image: false, // slice reattach-state-sync: safe default; the init-frame tap updates this
      }
    case "codex":
      // Values from live initialize response (in-process harness):
      //   mcpCapabilities.http:true → mcp:true
      //   thinking: not supported → thinkingTokens:false
      //   fork/rename: not exposed → rename:false
      return {
        mcp: true,
        compact: false,
        commands: false,
        usage: false,
        configOptions: false,
        rename: false,
        thinkingTokens: false,
        // image: codex reports promptCapabilities.image:true (see header note above), but we
        // don't hardcode it here — the init-frame tap (extractPromptCaps) is the source of
        // truth for all providers uniformly. Safe default until the tap observes a real frame.
        image: false,
      }
    case "cursor":
      // Spawn-native. Measured live (2026-07-08, brief §-1): mcp = http+sse → mcp:true.
      // Other caps not discovered statically — runtime caps come from initialize on the FE path.
      return {
        mcp: true,
        compact: false,
        commands: false,
        usage: false,
        configOptions: false,
        rename: false,
        thinkingTokens: false,
        image: false, // slice reattach-state-sync: safe default; the init-frame tap updates this
      }
    case "grok":
      // Spawn-native. Measured live (2026-07-10, brief §-1): mcpCapabilities.http/sse:true → mcp:true.
      return {
        mcp: true,
        compact: false,
        commands: false,
        usage: false,
        configOptions: false,
        rename: false,
        thinkingTokens: false,
        image: false, // slice reattach-state-sync: safe default; the init-frame tap updates this
      }
    default:
      return {
        mcp: false,
        compact: false,
        commands: false,
        usage: false,
        configOptions: false,
        rename: false,
        thinkingTokens: false,
        image: false, // slice reattach-state-sync: safe default; the init-frame tap updates this
      }
  }
}
