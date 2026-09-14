import type { AgentOpenInput } from "@drive-coding/core/schemas/session-bus"

/** Optional create-agent fields for MCP session_open → parseCreateAgentBody. */
export function applySessionOpenCreateFields(
  body: Record<string, unknown>,
  input: typeof AgentOpenInput.infer,
  effectiveParent: string | undefined,
): void {
  if (input.permission !== undefined) body.permissionPolicy = input.permission
  if (effectiveParent !== undefined) body.parentAgentId = effectiveParent
  if (input.closeOnTurnEnd === true) body.closeOnTurnEnd = true
  if (input.systemPrompt !== undefined) body.systemPrompt = input.systemPrompt
  if (input.roleLabel !== undefined && input.roleLabel !== "") body.roleLabel = input.roleLabel
}
