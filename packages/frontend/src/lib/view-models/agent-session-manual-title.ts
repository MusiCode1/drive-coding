/** Manual session title helpers (slice session-title-manual — keeps AgentSession smaller). */
import { patchAgent } from "$lib/adapters/agents-api"
import type { SessionScope } from "./session-scoped-state.svelte"

export type ManualTitleInput = {
  title?: string
  titleManual?: boolean
  userNotes?: string
  sessionFields?: Record<string, string>
}

export function applyManualTitleFromAttach(
  scope: SessionScope,
  input: ManualTitleInput,
  clearWhenAuto: boolean,
): void {
  if (input.titleManual === true) {
    scope.setTitleManual(true)
    if (input.title !== undefined) scope.setManualTitle(input.title ?? "", true)
  } else if (clearWhenAuto) scope.setManualTitle("", scope.titleManual)
  scope.setUserNotes(input.userNotes ?? "")
  scope.setSessionFields(input.sessionFields !== undefined ? { ...input.sessionFields } : {})
}

export function applyTitleFromSessionInput(
  scope: SessionScope,
  input: ManualTitleInput,
  push: (title: string) => void,
): void {
  if (input.titleManual !== undefined) scope.setTitleManual(input.titleManual === true)
  if (scope.titleManual) return
  scope.applyPatch({ kind: "title", title: input.title ?? scope.title })
  push(scope.title)
}

export function setManualTitleOnAgent(
  scope: SessionScope,
  agentId: string | null,
  title: string,
): void {
  const trimmed = title.trim()
  if (!trimmed) return
  scope.setManualTitle(trimmed, true)
  if (agentId) void patchAgent(agentId, { title: trimmed, titleManual: true }).catch(() => {})
}

export function syncTitleFromViewState(scope: SessionScope, viewTitle: string): void {
  if (!scope.titleManual && viewTitle !== scope.title)
    scope.applyPatch({ kind: "title", title: viewTitle })
}
