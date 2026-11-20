/**
 * proto-flow — state + transitions of the clickable mock (/design/proto).
 * Synthetic only: timers stand in for the agent's progress; nothing talks to a backend.
 */
import { type DesignContent, type DesignLang, designContent } from "./content"
import type {
  ChatActions,
  ConnectActions,
  NavActions,
  PanelActions,
  PopupKind,
  PopupPick,
} from "./proto"

export type ProtoScreen = "connect" | "chat" | "settings" | "usage"

export class ProtoFlow {
  lang = $state<DesignLang>("he")
  screen = $state<ProtoScreen>("connect")
  popup = $state<PopupKind | null>(null)
  connectView = $state("default")
  cli = $state<string | undefined>(undefined)
  cwd = $state<string | undefined>(undefined)
  chatState = $state("empty")
  tab = $state("record")
  panelOpen = $state(false)
  muted = $state(false)
  userText = $state<string | undefined>(undefined)
  #settingsFrom: ProtoScreen = "connect"
  #timer: ReturnType<typeof setTimeout> | undefined

  constructor(lang: DesignLang) {
    this.lang = lang
  }

  get content(): DesignContent {
    return designContent(this.lang)
  }
  get sessionCli(): string | undefined {
    return this.cli ?? this.content.data.clis[0]?.name
  }
  get sessionFolder(): string | undefined {
    return (this.cwd ?? this.content.data.cwd).split("/").filter(Boolean).pop()
  }

  #later(ms: number, fn: () => void) {
    clearTimeout(this.#timer)
    this.#timer = setTimeout(fn, ms)
  }
  go(next: ProtoScreen) {
    if (next === "settings" && (this.screen === "connect" || this.screen === "chat"))
      this.#settingsFrom = this.screen
    this.screen = next
    this.popup = null
    this.panelOpen = false
  }
  #enterChat(state: string, text?: string) {
    this.connectView = "connecting"
    this.#later(900, () => {
      this.connectView = "default"
      this.userText = text
      this.chatState = state
      this.tab = "record"
      this.go("chat")
      if (state === "conversation") this.#run()
    })
  }
  #run() {
    this.chatState = "conversation"
    this.#later(1800, () => (this.popup = "permission"))
  }
  #speak() {
    this.chatState = "speaking"
    this.#later(6000, () => (this.chatState = "idle"))
  }
  #stop() {
    clearTimeout(this.#timer)
    this.popup = null
    this.chatState = "idle"
  }
  #mic() {
    const s = this.chatState
    if (s === "empty" || s === "idle") this.chatState = "recording"
    else if (s === "recording") {
      this.chatState = "transcribing"
      this.#later(900, () => {
        this.userText = this.content.data.userText
        this.#run()
      })
    } else if (s === "speaking") this.chatState = "idle"
  }

  readonly connectOn: ConnectActions = {
    openPopup: (k) => (this.popup = k),
    connect: (prompt) => this.#enterChat(prompt ? "conversation" : "empty", prompt || undefined),
    reconnect: () => this.#enterChat("idle"),
    settings: () => this.go("settings"),
  }
  readonly chatOn: ChatActions = {
    openPanel: () => (this.panelOpen = true),
    closePanel: () => (this.panelOpen = false),
    openPopup: (k) => (this.popup = k),
    setTab: (t) => (this.tab = t),
    mic: () => this.#mic(),
    discard: () => (this.chatState = this.userText ? "idle" : "empty"),
    stopRun: () => this.#stop(),
    stopPlayback: () => this.#stop(),
    send: (text) => {
      this.userText = text
      this.#run()
    },
    slashInput: (text) => {
      if (text.startsWith("/")) this.popup = "slash"
      else if (this.popup === "slash") this.popup = null
    },
  }
  readonly panelOn: PanelActions = {
    shutDown: () => this.go("connect"),
    leaveRunning: () => this.go("connect"),
    toggleMute: () => (this.muted = !this.muted),
    settings: () => this.go("settings"),
    newSession: () => this.go("connect"),
  }
  readonly settingsOn: NavActions = {
    back: () => this.go(this.#settingsFrom),
    usage: () => this.go("usage"),
  }
  readonly usageOn: NavActions = { back: () => this.go("settings") }
  readonly overlayOn = { close: () => (this.popup = null), pick: (p: PopupPick) => this.#pick(p) }

  #pick(p: PopupPick) {
    this.popup = null
    if (p.kind === "select") this.cli = p.value
    else if (p.kind === "langSelect")
      this.lang = p.value === designContent("en").copy.language ? "en" : "he"
    else if (p.kind === "cwdCombo") p.value ? (this.cwd = p.value) : (this.popup = "cwdCombo")
    else if (p.kind === "folderPicker") this.cwd = p.value
    else if (p.kind === "permission") {
      if (p.value === "deny") this.chatState = "idle"
      else this.#later(500, () => (this.popup = "elicit"))
    } else if (p.kind === "elicit") this.#speak()
    else if (p.kind === "slash") {
      this.userText = p.value
      this.#run()
    }
  }
}
