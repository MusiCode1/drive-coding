/**
 * rpc-prompt.ts — session/prompt dispatch for POST /api/agents/:id/rpc (extracted from rpc.ts).
 */

import type { AgentRegistry } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import type { PromptBlocks } from "@drive-coding/provider/client"
import { type } from "arktype"
import { recordPromptDispatch } from "../../agent-scope.js"
import {
  type ResolvedSender,
  senderFromRecord,
  wrapPromptContent,
} from "../../delivery/drive-message-source.js"
import type { ExtendedSessionHost } from "../session-host.js"
import { SWITCHING_SESSION_ID } from "../session-switch.js"
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
  | { kind: "json"; status: 409; body: { error: string; code: "prompt_session_mismatch" } }

/** Resolve caller identity only for session/prompt (after params validation). */
export async function resolveCallerSenderForPrompt(
  agentRegistry: AgentRegistry,
  callerHeader: string | undefined,
): Promise<ResolvedSender | undefined> {
  const rawCaller = callerHeader?.trim()
  if (!rawCaller) return undefined
  const rec = await agentRegistry.get(rawCaller)
  return rec ? senderFromRecord(rec) : undefined
}

/** Wrap after validation; honor waitMs on the same wrapped content. */
export async function dispatchRpcPrompt(
  host: ExtendedSessionHost,
  sessionId: string,
  content: string | PromptBlocks,
  meta: Record<string, unknown> | undefined,
  waitMs: number | null,
  sender: ResolvedSender | undefined,
  scope: { token: string | undefined; targetId: string },
): Promise<RpcPromptOutcome> {
  // Caller lookup has completed. Read the live target and start the prompt in the same tick.
  const activeSessionId = host.state.sessionId
  if (
    activeSessionId !== sessionId ||
    activeSessionId === SWITCHING_SESSION_ID ||
    host.isSessionSwitchPreFlip === true
  ) {
    return {
      kind: "json",
      status: 409,
      body: {
        error: "Prompt session no longer matches the active session",
        code: "prompt_session_mismatch",
      },
    }
  }
  const wrapped = wrapPromptContent(sender, content)
  const from = waitMs === null ? 0 : host.state.messages.length
  recordPromptDispatch(scope.token, scope.targetId)
  const promptWork = host.prompt(sessionId, wrapped, meta)
  if (waitMs === null) {
    void promptWork.catch((e) => {
      log.warn({ err: e }, "prompt turn failed")
    })
    return { kind: "accepted" }
  }
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
