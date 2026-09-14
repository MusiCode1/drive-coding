/**
 * session-host-charter.ts — prepend project charter to the first ACP prompt (slice agent-charter C2).
 *
 * Charter text lives on ConnEntry (connection-registry.connect), not in session-host factory opts.
 * consumeCharter runs once per agent; subsequent turns pass content through unchanged.
 */

import type { PromptBlocks } from "@drive-coding/provider/client"
import type { ConnectOpts, ProviderConnection } from "@drive-coding/provider/connection"
import type { ConnectionRegistry } from "../acp/connection-registry.js"

/**
 * At connect(): if not native and charter text exists, store on ConnEntry and
 * mark caps.systemPrompt as prepended before SessionState copies capabilities.
 */
export function applyCharterAtConnect(
  conn: ProviderConnection,
  systemPrompt: ConnectOpts["systemPrompt"],
): { charter?: string } {
  if (conn.capabilities.systemPrompt === "native") {
    return {}
  }
  const text = systemPrompt
  if (text == null || text === "") {
    return {}
  }
  ;(
    conn.capabilities as { systemPrompt: "native" | "prepended" | "unsupported" }
  ).systemPrompt = "prepended"
  return { charter: text }
}

/** Prepend charter to string content or the first text block in PromptBlocks. */
export function prependCharterToContent(
  content: string | PromptBlocks,
  charter: string,
): string | PromptBlocks {
  if (typeof content === "string") {
    return `${charter}\n\n${content}`
  }
  const blocks = [...content]
  const firstTextIdx = blocks.findIndex((b) => b.type === "text")
  if (firstTextIdx >= 0) {
    const block = blocks[firstTextIdx]
    if (block?.type === "text") {
      blocks[firstTextIdx] = { type: "text", text: `${charter}\n\n${block.text}` }
      return blocks
    }
  }
  return [{ type: "text", text: charter }, ...blocks]
}

/** Hook for session-host prompt(): consume stored charter once, prepend for ACP only. */
export function makePromptCharterHook(
  registry: Pick<ConnectionRegistry, "consumeCharter">,
  agentId: string,
): (content: string | PromptBlocks) => string | PromptBlocks {
  return (content) => {
    const charter = registry.consumeCharter(agentId)
    if (charter === undefined) return content
    return prependCharterToContent(content, charter)
  }
}
