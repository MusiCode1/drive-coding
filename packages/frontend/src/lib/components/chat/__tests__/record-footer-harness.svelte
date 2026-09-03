<script lang="ts">
/**
 * record-footer-harness.svelte — mount RecordFooter with minimal context stubs.
 *
 * ─── slice live-input-mode (Commit 1) ───
 */
import {
  setAudioPlaylist,
  setComposerDraft,
  setDictate,
  setI18n,
  setLive,
  setMic,
  setModelStatus,
  setResponsive,
  setSession,
  setSettings,
  setSpeaker,
  setUiShell,
  setVoiceMode,
} from "$lib/context"
import type { MessageKey } from "@drive-coding/core/i18n"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { I18nVM } from "$lib/view-models/i18n.svelte"
import type { Live } from "$lib/view-models/live.svelte"
import type { Mic } from "$lib/view-models/mic.svelte"
import type { Dictate } from "$lib/view-models/dictate.svelte"
import type { ComposerDraft } from "$lib/view-models/composer-draft.svelte"
import type { ModelStatus } from "$lib/view-models/derived/model-status.svelte"
import type { ResponsiveVM } from "$lib/view-models/responsive.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"
import type { Speaker } from "$lib/view-models/speaker.svelte"
import type { VoiceMode } from "$lib/view-models/derived/voice-mode.svelte"
import { ComposerDraft } from "$lib/view-models/composer-draft.svelte"
import type { Dictate } from "$lib/view-models/dictate.svelte"
import { UiShellVM, type InputMode } from "$lib/view-models/ui-shell.svelte"
import RecordFooter from "../RecordFooter.svelte"

let {
  inputMode = "record" as InputMode,
  liveOpen = false,
  isMobile = false,
  onLiveToggle,
}: {
  inputMode?: InputMode
  liveOpen?: boolean
  isMobile?: boolean
  onLiveToggle?: () => void
} = $props()

const uiShell = new UiShellVM()
uiShell.setInputMode(inputMode)

$effect(() => {
  uiShell.setInputMode(inputMode)
})

const fakeI18n = { t: (key: string) => key } as unknown as I18nVM

const fakeSession = {
  status: "connected",
  reconnectAttempt: 0,
  reconnect: () => {},
} as unknown as AgentSession

const fakeResponsive = {
  get isMobile() {
    return isMobile
  },
} as unknown as ResponsiveVM

const fakeMic = {
  state: "idle",
  error: null,
  canRetry: false,
  pendingRestored: false,
  cancel: () => {},
  retryTranscribe: async () => {},
  dismiss: async () => {},
  hydratePending: async () => {},
} as unknown as Mic

const liveState = $state({ open: liveOpen })

$effect(() => {
  liveState.open = liveOpen
})

const fakeLive = {
  get state() {
    return liveState.open ? "open" : "closed"
  },
  get isOpen() {
    return liveState.open
  },
  get canOpen() {
    return !liveState.open
  },
  transcript: [],
  error: null,
  toggle: async () => {
    onLiveToggle?.()
    liveState.open = !liveState.open
  },
} as unknown as Live

const fakeVoiceMode = {
  get ear() {
    return inputMode === "live" ? "listening" : "closed"
  },
  startTalking: async () => {},
  cancelRun: () => {},
  isCancelling: false,
} as unknown as VoiceMode

const fakeModelStatus = {
  isRunActive: false,
  stopRunLabelKey: "playbackControls.stopRun" as MessageKey,
} as unknown as ModelStatus

const fakeSettings = {
  enterToSend: false,
  liveVoice: "Puck",
  setLiveVoice: () => {},
} as unknown as Settings

const fakeSpeaker = {} as unknown as Speaker

const fakeDraft = { text: "" } as unknown as ComposerDraft

const fakeDictate = {
  state: "idle",
  error: null,
  canRetry: false,
  pendingRestored: false,
  toggle: async () => {},
  cancel: () => {},
  finishListening: async () => ({ ok: true as const, text: "" }),
  retryTranscribe: async () => {},
  dismiss: async () => {},
  hydratePending: async () => {},
} as unknown as Dictate

const fakePlaylist = { items: [], transport: "stopped" as const }
const composerDraft = new ComposerDraft()
const fakeDictate = { state: "idle", error: null, toggle: async () => {}, cancel: () => {} } as unknown as Dictate

setI18n(fakeI18n)
setComposerDraft(composerDraft)
setDictate(fakeDictate)
setSession(fakeSession)
setResponsive(fakeResponsive)
setUiShell(uiShell)
setMic(fakeMic)
setLive(fakeLive)
setVoiceMode(fakeVoiceMode)
setModelStatus(fakeModelStatus)
setSettings(fakeSettings)
setSpeaker(fakeSpeaker)
setComposerDraft(fakeDraft)
setDictate(fakeDictate)
setAudioPlaylist(fakePlaylist as never)
</script>

<RecordFooter />
