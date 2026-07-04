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

import type { NormalizedCapabilities } from "../types.js"
import type { SpawnBridgeInput } from "../spawn/index.js"

/**
 * Returns a static NormalizedCapabilities for a given cliKind (spawn-native).
 * ext is undefined for spawn, so ext-channel features are false.
 */
export function staticCapsFor(
  cliKind: SpawnBridgeInput["cliKind"],
): NormalizedCapabilities {
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
        image: false, // tap init-response will update if observed
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
        image: false, // tap init-response will update if observed
      }
    case "codex":
      // Values from live initialize response (in-process harness):
      //   mcpCapabilities.http:true → mcp:true
      //   promptCapabilities.image:true (from live codex initialize — capabilities-static.ts:12)
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
        image: true, // from live codex initialize response (see file header comment)
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
        image: false,
      }
  }
}
