/** Manual session title helpers (slice session-title-manual — keeps AgentSession smaller). */
import { patchAgent } from "$lib/adapters/agents-api"

export type ManualTitleInput = { title?: string; titleManual?: boolean }

type TitleVm = {
  sessionTitle: string
  titleManual: boolean
  agentId: string | null
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
}

export function applyTitleFromSessionInput(
  vm: TitleVm,
  input: ManualTitleInput,
  push: (title: string) => void,
): void {
  if (input.titleManual !== undefined) vm.titleManual = input.titleManual === true
  if (vm.titleManual) return
  vm.sessionTitle = input.title ?? vm.sessionTitle
  push(vm.sessionTitle)
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
