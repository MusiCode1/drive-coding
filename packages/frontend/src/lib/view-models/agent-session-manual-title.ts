/** Manual session title helpers (slice session-title-manual — keeps AgentSession smaller). */
import { patchAgent } from "$lib/adapters/agents-api"

export type ManualTitleInput = {
  title?: string
  titleManual?: boolean
  agentNotes?: string
  agentFields?: Record<string, string>
}

type TitleVm = {
  sessionTitle: string
  titleManual: boolean
  agentId: string | null
  agentNotes: string
  agentFields: Record<string, string>
}

export function applyManualTitleFromAttach(
  vm: TitleVm,
  input: ManualTitleInput,
  clearWhenAuto: boolean,
): void {
  if (input.titleManual === true) {
    vm.titleManual = true
    if (input.title !== undefined) vm.sessionTitle = input.title ?? ""
  } else if (clearWhenAuto) vm.sessionTitle = ""
  vm.agentNotes = input.agentNotes ?? ""
  vm.agentFields = input.agentFields !== undefined ? { ...input.agentFields } : {}
}

export function applyTitleFromSessionInput(vm: TitleVm, input: ManualTitleInput): void {
  if (input.titleManual !== undefined) vm.titleManual = input.titleManual === true
  if (vm.titleManual) return
  vm.sessionTitle = input.title ?? vm.sessionTitle
  pushTitleToServer(vm.agentId, vm.sessionTitle)
}

export function setManualTitleOnAgent(vm: TitleVm, title: string): void {
  const trimmed = title.trim()
  if (!trimmed) return
  vm.sessionTitle = trimmed
  vm.titleManual = true
  const id = vm.agentId
  if (id) void patchAgent(id, { title: trimmed, titleManual: true }).catch(() => {})
}

export function syncTitleFromViewState(vm: TitleVm, viewTitle: string): void {
  if (!vm.titleManual && viewTitle !== vm.sessionTitle) vm.sessionTitle = viewTitle
}

export function applyTitleFromSessionInfo(vm: TitleVm, title: string | null | undefined): void {
  if (vm.titleManual) return
  if (title === null) vm.sessionTitle = ""
  else if (typeof title === "string") {
    vm.sessionTitle = title
    pushTitleToServer(vm.agentId, title)
  }
}

/** Best-effort PATCH title for the active agents list. */
function pushTitleToServer(agentId: string | null, title: string): void {
  if (!agentId || !title) return
  void patchAgent(agentId, { title }).catch(() => {})
}
