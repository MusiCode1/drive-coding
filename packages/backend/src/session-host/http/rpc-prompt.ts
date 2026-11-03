/**
 * rpc-prompt.ts — session/prompt dispatch for POST /api/agents/:id/rpc (extracted from rpc.ts).
 */

import type { AgentRegistry } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import type { PromptBlocks } from "@drive-coding/provider/client"
import { type } from "arktype"
import { CALLER_KIND_MAX, CALLER_NAME_MAX } from "../../agent-identity.js"
import {
  type PromptOrigin,
  senderFromRecord,
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

/**
 * Whether `source="api"` envelopes may be emitted (`apiMessageEnvelope`).
 *
 * Read from the environment per request rather than captured at boot: `buildEnvPatch`
 * maps the config-file value into `process.env`, so this one accessor honours the file,
 * a real env var, and the CLI flag alike — and a reload takes effect without a restart.
 */
export function apiEnvelopeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.API_MESSAGE_ENVELOPE === "1"
}

/**
 * Downgrade an `api` origin to the unwrapped path while the flag is off.
 *
 * 🔑 Separate from `resolvePromptOrigin` so that *who sent it* and *whether we annotate
 * it* stay two questions. A test can then pin the identification without the flag, and
 * the flag without re-deriving identity.
 */
export function gateApiEnvelope(origin: PromptOrigin, enabled: boolean): PromptOrigin {
  if (origin.kind !== "api" || enabled) return origin
  return { kind: "ui" }
}

/**
 * Recover a UTF-8 header value that arrived as latin-1 code units.
 *
 * 🔴 Measured on a live preview: `X-Drive-Coding-Caller: סוכן הלילה` reached the
 * transcript as mojibake, and `n8n · deploy` as `n8n Â· deploy`. HTTP header values are
 * latin-1 by spec, so a caller sending raw UTF-8 bytes — which every ordinary client
 * does — is decoded one byte per character, **with nothing raising an error anywhere**.
 *
 * Only attempted when every code unit fits in a byte, and only kept when the bytes are
 * valid UTF-8 (`fatal: true`). A genuinely latin-1 name therefore survives unchanged
 * instead of being mangled in the other direction.
 */
function decodeHeaderUtf8(raw: string): string {
  if (!/[\u0080-\u00ff]/.test(raw)) return raw
  for (const ch of raw) {
    if (ch.codePointAt(0)! > 0xff) return raw
  }
  try {
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0))
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return raw
  }
}

function clamp(value: string | undefined, max: number): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  const decoded = decodeHeaderUtf8(trimmed)
  return decoded.length > max ? decoded.slice(0, max) : decoded
}

/**
 * Resolve who sent a `session/prompt` (after params validation).
 *
 * Order matters: a header that names a **known agent** wins, because that identity is
 * resolved from our registry rather than declared. Only then does the client-kind header
 * decide between the FE and an outside caller.
 *
 * 🛑 An agent id we do not recognise does **not** fall back to `agent` — it lands in
 * `api` like any other unidentified caller. Otherwise an unknown id would buy a
 * registry-looking label for free.
 */
export async function resolvePromptOrigin(
  agentRegistry: AgentRegistry,
  headers: {
    agentId?: string
    clientKind?: string
    callerName?: string
    callerKind?: string
  },
): Promise<PromptOrigin> {
  const rawCaller = headers.agentId?.trim()
  if (rawCaller) {
    const rec = await agentRegistry.get(rawCaller)
    const sender = rec ? senderFromRecord(rec) : undefined
    if (sender !== undefined) return { kind: "agent", sender }
  }
  if (headers.clientKind?.trim().toLowerCase() === "ui") return { kind: "ui" }

  const name = clamp(headers.callerName, CALLER_NAME_MAX)
  const kind = clamp(headers.callerKind, CALLER_KIND_MAX)
  if (name === undefined && kind === undefined) return { kind: "api" }
  return {
    kind: "api",
    caller: {
      ...(kind !== undefined ? { kind } : {}),
      ...(name !== undefined ? { name } : {}),
    },
  }
}

/** Wrap after validation; honor waitMs on the same wrapped content. */
export async function dispatchRpcPrompt(
  host: ExtendedSessionHost,
  sessionId: string,
  content: string | PromptBlocks,
  meta: Record<string, unknown> | undefined,
  waitMs: number | null,
  origin: PromptOrigin | undefined,
): Promise<RpcPromptOutcome> {
  const wrapped = wrapPromptContent(origin, content)
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
