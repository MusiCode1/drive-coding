/**
 * ui-state — local UI state + derived flags for the design mock components, kept out of the
 * .svelte scripts so each component stays a thin template.
 */
import type { DesignContent } from "./content"
import type { ChatActions, PanelActions } from "./proto"

export const PROC_PEEK = 3
export const RECENT_PEEK = 5

/** Chat footer/feed flags derived from the mock state name. */
export function chatFlags(view: string, tabProp?: string) {
  const tab =
    tabProp ??
    ({ typing: "type", live: "live", hidden: "hidden" } as Record<string, string>)[view] ??
    "record"
  return {
    tab,
    speaking: view === "speaking" || view === "live",
    recording: view === "recording",
    transcribing: view === "transcribing",
    idle: ["empty", "idle", "rich", "voice", "pending", "micDenied"].includes(view),
    empty: view === "empty" || view === "recording" || view === "transcribing",
  }
}

export class ChatUi {
  draft = $state("")
  #dragY: number | null = null
  /** sheet handle: drag up opens, drag down closes, a tap toggles (like BottomSheet's peek↔full) */
  gripDown(e: PointerEvent) {
    this.#dragY = e.clientY
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  gripUp(e: PointerEvent, open: boolean, on: ChatActions) {
    if (this.#dragY === null) return
    const dy = e.clientY - this.#dragY
    this.#dragY = null
    if (dy < -24 || (Math.abs(dy) <= 24 && !open)) on.openPanel?.()
    else if (dy > 24 || (Math.abs(dy) <= 24 && open)) on.closePanel?.()
  }
  confirmClose = $state(false)
  close(panelOn: PanelActions) {
    if (!this.confirmClose) {
      this.confirmClose = true
      return
    }
    this.confirmClose = false
    panelOn.shutDown?.()
  }
  send(on: ChatActions) {
    if (!this.draft.trim()) return
    on.send?.(this.draft)
    this.draft = ""
  }
}

export class ConnectUi {
  allProcs = $state(false)
  allRecents = $state(false)
  confirmKill = $state<number | null>(null)
  killed = $state<number[]>([])
  removed = $state<number[]>([])
  prompt = $state("")
  kill(i: number, live: boolean) {
    if (!live) return
    if (this.confirmKill === i) {
      this.killed = [...this.killed, i]
      this.confirmKill = null
    } else this.confirmKill = i
  }
  remove(i: number, live: boolean) {
    if (live) this.removed = [...this.removed, i]
  }
}

/** Visible slices of the connect lists (peek vs. expanded, minus killed/removed rows). */
export function connectLists(d: DesignContent["data"], view: string, ui: ConnectUi) {
  const expanded = view === "expanded"
  const procs =
    view === "empty"
      ? []
      : d.processes.map((p, i) => ({ ...p, i })).filter((p) => !ui.killed.includes(p.i))
  const recents = d.recents.map((r, i) => ({ ...r, i })).filter((r) => !ui.removed.includes(r.i))
  const procsOpen = ui.allProcs || expanded
  const recentsOpen = ui.allRecents || expanded
  return {
    procs,
    procsOpen,
    procsShown: procsOpen ? procs : procs.slice(0, PROC_PEEK),
    recents,
    recentsOpen,
    recentsShown: recentsOpen ? recents : recents.slice(0, RECENT_PEEK),
  }
}
