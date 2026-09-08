/**
 * agent-row.ts — building an Agent record from a CreateAgentInput.
 *
 * Pure on purpose: the registry owns storage, this owns shape. Extracted from
 * registry.ts when the persistent registry needed to build rows with a caller-
 * supplied `id` and `createdAt` (adoption of a row read back from disk), which
 * the inline version could not express.
 */

import type { Agent, CreateAgentInput } from "@drive-coding/core"

/**
 * buildAgentRow — assemble the stored shape.
 *
 * `cwd` is passed separately because the caller has already normalised it
 * through validateCwd; taking it from `input` again would silently store the
 * un-normalised string.
 */
export function buildAgentRow(opts: {
  id: string
  cwd: string
  createdAt: string
  input: CreateAgentInput
}): Agent {
  const { id, cwd, createdAt, input } = opts
  return {
    id,
    cliKind: input.cliKind,
    cwd,
    modelOverride: input.modelOverride ?? null,
    status: "ready", // Slice 2 stub. ב-Slice 3 ומעלה: starting → ready
    createdAt,
    persistent: false, // ← agent נוצר לא-נעוץ (slice active-agents)
    ...(input.permissionPolicy !== undefined ? { permissionPolicy: input.permissionPolicy } : {}),
    ...(input.parentAgentId !== undefined ? { parentAgentId: input.parentAgentId } : {}),
    ...(input.closeOnTurnEnd === true ? { closeOnTurnEnd: true } : {}),
    ...(input.notifyOnDone !== undefined && input.notifyOnDone !== ""
      ? { notifyOnDone: input.notifyOnDone }
      : {}),
    ...(input.roleLabel !== undefined ? { roleLabel: input.roleLabel } : {}),
    ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
  }
}
