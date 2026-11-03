/**
 * drive-message-source.ts — resolve who sent a prompt, and wrap it accordingly.
 */

import { serializeDriveMessage } from "@drive-coding/core/acp/drive-message-envelope"
import type { PromptBlocks } from "@drive-coding/provider/client"

export type ResolvedSender = { id: string; name?: string }

function encodeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

/** name = nonempty roleLabel, else nonempty title, else undefined; null is absent. */
export function senderFromRecord(record: unknown): ResolvedSender | undefined {
  if (record === null || record === undefined || typeof record !== "object") return undefined
  const r = record as { id?: unknown; roleLabel?: unknown; title?: unknown }
  if (typeof r.id !== "string" || r.id.length === 0) return undefined
  let name: string | undefined
  if (typeof r.roleLabel === "string" && r.roleLabel.length > 0) name = r.roleLabel
  else if (typeof r.title === "string" && r.title.length > 0) name = r.title
  return name !== undefined ? { id: r.id, name } : { id: r.id }
}

/**
 * Who a prompt came from, as far as the backend can tell.
 *
 * `ui` is the FE identifying itself and stays unwrapped — a human typing is the baseline,
 * not an annotation. `api` is everything else that is not a known agent, and carries only
 * what the caller declared about itself.
 */
export type PromptOrigin =
  | { kind: "agent"; sender: ResolvedSender }
  | { kind: "ui" }
  | { kind: "api"; caller?: { kind?: string; name?: string } }

function shellOf(xml: string): { prefix: string; suffix: string } {
  const bodyOpen = xml.indexOf("<body>")
  const bodyClose = xml.indexOf("</body>")
  if (bodyOpen < 0 || bodyClose < 0) throw new Error("envelope shell missing body")
  return {
    prefix: xml.slice(0, bodyOpen + "<body>".length),
    suffix: xml.slice(bodyClose),
  }
}

/** Full-string agent envelope (body encoded inside serializer). */
export function wrapAgentText(sender: ResolvedSender, body: string): string {
  return serializeDriveMessage({ source: "agent", sender, body })
}

/** Full-string api envelope — only what the caller declared, nothing verified. */
export function wrapApiText(
  caller: { kind?: string; name?: string } | undefined,
  body: string,
): string {
  return serializeDriveMessage({
    source: "api",
    ...(caller !== undefined ? { caller } : {}),
    body,
  })
}

/** Split envelope across text blocks; non-text blocks unchanged. */
function wrapBlocksWithShell(
  shell: { prefix: string; suffix: string },
  blocks: PromptBlocks,
): PromptBlocks {
  const { prefix, suffix } = shell
  const encoded = blocks.map((block) =>
    block.type === "text" ? { ...block, text: encodeText(block.text) } : block,
  )
  const textIndices: number[] = []
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i]?.type === "text") textIndices.push(i)
  }
  if (textIndices.length === 0) {
    return [{ type: "text", text: prefix }, ...encoded, { type: "text", text: suffix }]
  }
  if (textIndices.length === 1) {
    const i = textIndices.at(0)
    if (i === undefined) {
      return [{ type: "text", text: prefix }, ...encoded, { type: "text", text: suffix }]
    }
    const block = encoded[i] as { type: "text"; text: string }
    const out = [...encoded]
    out[i] = { ...block, text: prefix + block.text + suffix }
    return out as PromptBlocks
  }
  const first = textIndices.at(0)
  const last = textIndices.at(-1)
  if (first === undefined || last === undefined) {
    return [{ type: "text", text: prefix }, ...encoded, { type: "text", text: suffix }]
  }
  const out = [...encoded]
  const fb = out[first] as { type: "text"; text: string }
  out[first] = { ...fb, text: prefix + fb.text }
  const lb = out[last] as { type: "text"; text: string }
  out[last] = { ...lb, text: lb.text + suffix }
  return out as PromptBlocks
}

/** Split envelope across text blocks for an agent sender. */
export function wrapAgentBlocks(sender: ResolvedSender, blocks: PromptBlocks): PromptBlocks {
  return wrapBlocksWithShell(
    shellOf(serializeDriveMessage({ source: "agent", sender, body: "" })),
    blocks,
  )
}

/** Split envelope across text blocks for an api caller. */
export function wrapApiBlocks(
  caller: { kind?: string; name?: string } | undefined,
  blocks: PromptBlocks,
): PromptBlocks {
  return wrapBlocksWithShell(shellOf(wrapApiText(caller, "")), blocks)
}

/**
 * Wrap a prompt according to who sent it.
 *
 * 🛑 `ui` and `undefined` both return the content untouched. The FE is the baseline the
 * user sees every day; annotating it would make the envelope noise rather than a signal.
 */
export function wrapPromptContent(
  origin: PromptOrigin | undefined,
  content: string | PromptBlocks,
): string | PromptBlocks {
  if (origin === undefined || origin.kind === "ui") return content
  if (origin.kind === "agent") {
    return typeof content === "string"
      ? wrapAgentText(origin.sender, content)
      : wrapAgentBlocks(origin.sender, content)
  }
  return typeof content === "string"
    ? wrapApiText(origin.caller, content)
    : wrapApiBlocks(origin.caller, content)
}
