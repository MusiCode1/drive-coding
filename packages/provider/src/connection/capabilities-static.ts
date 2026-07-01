/**
 * capabilities-static.ts — static capabilities map per cliKind (spawn-based).
 *
 * Spawn-based connections do not go through in-process initialize handshake,
 * so capabilities cannot be discovered at runtime here.
 * MVP: conservative defaults; configOptions and ext-dependent features = false.
 * Will be filled in as CUT-3b-iii+ rounds out the primitive.
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
      }
  }
}
