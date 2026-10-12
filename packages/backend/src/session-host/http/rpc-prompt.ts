/**
 * rpc-prompt.ts — session/prompt dispatch for POST /api/agents/:id/rpc (extracted from rpc.ts).
 */

import { createLogger } from "@drive-coding/core/log"
import type { PromptBlocks } from "@drive-coding/provider/client"
import { type } from "arktype"
import {
  type ResolvedSender,
  wrapPromptContent,
} from "../../delivery/drive-message-source.js"
import type { ExtendedSessionHost } from "../session-host.js"
import { codeOf, messageOf } from "./rpc-respond-wait.js"
import { raceKeepRunning } from "./rpc-wait.js"

const log = createLogger("backend.session-host.rpc")

// ─── slice remote-images C1: PromptBlocks ContentBlock schema ───
export const TextBlock = type({ type: "'text'", text: "string" })
export const ImageBlock = type({ type: "'image'", mimeType: "string", data: "string" })
export const AudioBlock = type({ type: "'audio'", mimeType: "string", data: "string" })
export const ResourceLinkBlock = type({ type: "'resource_link'", name: "string", uri: "string" })
export const ResourceBlock = type({ type: "'resource'", resource: "object" })
const ContentBlockSchema = TextBlock.or(ImageBlock)
  .or(AudioBlock)
  .or(ResourceLinkBlock)
  .or(ResourceBlock)
const PromptContent = ContentBlockSchema.array()

export const PromptParams = type({
  sessionId: "string",
  content: type("string").or(PromptContent),
  "meta?": { "[string]": "unknown" },
})

export type RpcPromptOutcome =
  | { kind: "accepted" }
  | { kind: "json"; status: 200; body: Record<string, unknown> }

/** Wrap after validation; honor waitMs on the same wrapped content. */
export async function dispatchRpcPrompt(
  host: ExtendedSessionHost,
  sessionId: string,
  content: string | PromptBlocks,
  meta: Record<string, unknown> | undefined,
  waitMs: number | null,
  sender: ResolvedSender | undefined,
): Promise<RpcPromptOutcome> {
  const wrapped = wrapPromptContent(sender, content)
  if (waitMs === null) {
    const promptWork = host.prompt(sessionId, wrapped, meta)
    void promptWork.catch((e) => {
      log.warn({ err: e }, "prompt turn failed")
    })
    return { kind: "accepted" }
  }
  const from = host.state.messages.length
  const promptWork = host.prompt(sessionId, wrapped, meta)
  const raced = await raceKeepRunning(promptWork, waitMs, (e) => {
    log.warn({ err: e }, "prompt turn failed")
  })
  if (raced.outcome === "timedOut") {
    return {
      kind: "json",
      status: 200,
      body: { version: host.state.version, ok: false, timedOut: true },
    }
  }
  const messagesSince = host.state.messages.slice(from)
  if (raced.outcome === "rejected") {
    const code = codeOf(raced.error)
    const message = messageOf(raced.error)
    return {
      kind: "json",
      status: 200,
      body: {
        version: host.state.version,
        ok: false,
        timedOut: false,
        error: code === undefined ? { message } : { message, code },
        messagesSince,
      },
    }
  }
  return {
    kind: "json",
    status: 200,
    body: { version: host.state.version, ok: true, timedOut: false, messagesSince },
  }
}
