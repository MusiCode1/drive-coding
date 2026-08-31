/**
 * create-agent-input.ts — shared POST /api/agents + session_open validation
 * (slice session-bus-mcp C1; Avigail finding 2).
 *
 * CreateAgentInputFull lives here so http-agents and http-mcp cannot drift.
 */

import { CliId, type CreateAgentInput, PermissionPolicy, validateCwd } from "@drive-coding/core"
import { getCliSpec, getEffectiveCliKinds } from "@drive-coding/provider/config"
import { type } from "arktype"
import type { CreateAndSpawnInput } from "../app/agent-orchestrator.js"

/**
 * Server-side extension of CreateAgentInput — includes existingSessionId
 * for loading a session (Slice 8a). Defined here because it extends the
 * core schema with HTTP-nullability.
 */
export const CreateAgentInputFull = type({
  cliKind: CliId,
  cwd: "string >= 1",
  "modelOverride?": "string | null",
  "existingSessionId?": "string | null",
  "systemPrompt?": "string | null",
  "permissionPolicy?": PermissionPolicy,
  "env?": { "[string]": "string" },
  "parentAgentId?": "string",
  "closeOnTurnEnd?": "boolean",
  "notifyOnDone?": "string.uuid",
})
export type CreateAgentInputFull = typeof CreateAgentInputFull.infer

export type ParseCreateAgentFailure = {
  status: 400
  body: { error: string; known?: string[]; detail?: unknown }
}

export function parseCreateAgentBody(
  body: unknown,
): { ok: true; value: CreateAndSpawnInput } | { ok: false; error: ParseCreateAgentFailure } {
  const parsed = CreateAgentInputFull(body)
  if (parsed instanceof type.errors) {
    return { ok: false, error: { status: 400, body: { error: parsed.summary } } }
  }

  if (getCliSpec(parsed.cliKind, process.env) === undefined) {
    return {
      ok: false,
      error: {
        status: 400,
        body: { error: `unknown cliKind: ${parsed.cliKind}`, known: getEffectiveCliKinds() },
      },
    }
  }

  const cwdResult = validateCwd(parsed.cwd)
  if (cwdResult.isErr()) {
    const e = cwdResult.error
    return {
      ok: false,
      error: { status: 400, body: { error: `invalid cwd: ${e.kind}`, detail: e } },
    }
  }

  const input: CreateAndSpawnInput = {
    cliKind: parsed.cliKind as CreateAgentInput["cliKind"],
    cwd: cwdResult.value,
  }
  if (parsed.env !== undefined) input.env = parsed.env
  if (parsed.permissionPolicy !== undefined) input.permissionPolicy = parsed.permissionPolicy
  if (parsed.modelOverride !== undefined && parsed.modelOverride !== null) {
    input.modelOverride = parsed.modelOverride
  }
  if (parsed.systemPrompt !== undefined && parsed.systemPrompt !== null) {
    input.systemPrompt = parsed.systemPrompt
  }
  if (parsed.existingSessionId !== undefined && parsed.existingSessionId !== null) {
    input.existingSessionId = parsed.existingSessionId
  }
  if (parsed.parentAgentId !== undefined && parsed.parentAgentId !== "") {
    input.parentAgentId = parsed.parentAgentId
  }
  if (parsed.closeOnTurnEnd === true) {
    input.closeOnTurnEnd = true
  }
  if (parsed.notifyOnDone !== undefined && parsed.notifyOnDone !== "") {
    input.notifyOnDone = parsed.notifyOnDone
  }
  return { ok: true, value: input }
}
