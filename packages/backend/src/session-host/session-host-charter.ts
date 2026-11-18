/**
 * session-host-charter.ts — prepend project charter to the first ACP prompt (slice agent-charter C2).
 *
 * Charter text lives on ConnEntry (connection-registry.connect), not in session-host factory opts.
 * consumeCharter runs once per agent; subsequent turns pass content through unchanged.
 */

import {
  insertEnvelopeContext,
  parseDriveMessage,
} from "@drive-coding/core/acp/drive-message-envelope"
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
  ;(conn.capabilities as { systemPrompt: "native" | "prepended" | "unsupported" }).systemPrompt =
    "prepended"
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

function joinTextBlocks(
  blocks: PromptBlocks,
): { joined: string; firstTextIdx: number; firstLen: number } | null {
  const firstTextIdx = blocks.findIndex((b) => b.type === "text")
  if (firstTextIdx < 0) return null
  let joined = ""
  for (const block of blocks) {
    if (block.type === "text") joined += block.text
  }
  const first = blocks[firstTextIdx]
  if (first?.type !== "text") return null
  return { joined, firstTextIdx, firstLen: first.text.length }
}

function tryInsertCharterInEnvelope(
  joined: string,
  charter: string,
): { offset: number; insertedText: string } | null {
  if (parseDriveMessage(joined).isErr()) return null
  const inserted = insertEnvelopeContext(joined, { kind: "project-charter", text: charter })
  if (inserted.isErr()) return null
  return { offset: inserted.value.offset, insertedText: inserted.value.insertedText }
}

/** Charter inside a full envelope when possible; otherwise legacy prepend. */
export function applyCharterToContent(
  content: string | PromptBlocks,
  charter: string,
): string | PromptBlocks {
  if (typeof content === "string") {
    const ins = tryInsertCharterInEnvelope(content, charter)
    if (ins === null) return prependCharterToContent(content, charter)
    return content.slice(0, ins.offset) + ins.insertedText + content.slice(ins.offset)
  }

  const meta = joinTextBlocks(content)
  if (meta === null) return prependCharterToContent(content, charter)
  const { joined, firstTextIdx, firstLen } = meta
  const ins = tryInsertCharterInEnvelope(joined, charter)
  if (ins === null || ins.offset > firstLen) return prependCharterToContent(content, charter)

  const first = content[firstTextIdx]
  if (first?.type !== "text") return prependCharterToContent(content, charter)
  const out = [...content]
  out[firstTextIdx] = {
    type: "text",
    text: first.text.slice(0, ins.offset) + ins.insertedText + first.text.slice(ins.offset),
  }
  return out
}

/** Hook for session-host prompt(): consume stored charter once, prepend for ACP only. */
export function makePromptCharterHook(
  registry: Pick<ConnectionRegistry, "consumeCharter">,
  agentId: string,
): (content: string | PromptBlocks) => string | PromptBlocks {
  return (content) => {
    const charter = registry.consumeCharter(agentId)
    if (charter === undefined) return content
    return applyCharterToContent(content, charter)
  }
}
