/**
 * design/proto — shared types for the clickable prototype (/design/proto).
 * Every callback is optional: the static gallery renders the same components without them.
 */
export type PopupKind =
  | "folderPicker"
  | "cwdCombo"
  | "select"
  | "langSelect"
  | "permission"
  | "budget"
  | "slash"
  | "viewer"
  | "elicit"

/** Value a popup hands back when the user picks something (a CLI name, a folder, a language…). */
export type PopupPick = { kind: PopupKind; value: string }

export type ConnectActions = {
  openPopup?: (kind: PopupKind) => void
  /** start a new session from the form; `prompt` may be empty */
  connect?: (prompt: string) => void
  /** tap on an active-process card */
  reconnect?: (index: number) => void
  settings?: () => void
}

export type ChatActions = {
  openPanel?: () => void
  closePanel?: () => void
  openPopup?: (kind: PopupKind) => void
  setTab?: (tab: string) => void
  mic?: () => void
  stopRun?: () => void
  discard?: () => void
  send?: (text: string) => void
  slashInput?: (text: string) => void
  stopPlayback?: () => void
}

export type PanelActions = {
  shutDown?: () => void
  leaveRunning?: () => void
  toggleMute?: () => void
  settings?: () => void
  newSession?: () => void
}

export type NavActions = {
  back?: () => void
  usage?: () => void
}

/**
 * Svelte action for the mock: makes every `.sw` switch toggle and every `.seg` option selectable,
 * without wiring state into each row. Prototype-only convenience.
 */
export function mockControls(node: HTMLElement) {
  const onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement | null
    const sw = t?.closest<HTMLElement>(".sw")
    if (sw && node.contains(sw)) {
      sw.classList.toggle("on")
      return
    }
    const opt = t?.closest<HTMLElement>(".seg > *")
    if (opt && node.contains(opt)) {
      for (const sib of Array.from(opt.parentElement?.children ?? [])) sib.classList.remove("on")
      opt.classList.add("on")
    }
  }
  node.addEventListener("click", onClick)
  return { destroy: () => node.removeEventListener("click", onClick) }
}
