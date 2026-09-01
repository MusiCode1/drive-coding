<script lang="ts">
/**
 * type-area-harness.svelte — harness for mounting TypeArea in component tests.
 *
 * ─── slice/ui-var-fixes (Commit 2) ───
 *
 * TypeArea reads contexts from +layout. Stubs below cover fields the component
 * touches when rendering controls.
 *
 * ─── slice/type-area-align (Commit 1+2) ───
 * supportsImageInput + enterToSend props for control-height and Enter gates.
 *
 * ─── slice dictate-to-input (C2) ───
 * composerDraft, dictate, mic, uiShell stubs for dictate button + draft bind.
 *
 * ─── slice dictate-to-input-polish (C1) ───
 * finishListening, dictateState, session ref for send-during-listening tests.
 */

import {
  setComposerDraft,
  setDictate,
  setI18n,
  setMic,
  setModelStatus,
  setSession,
  setSettings,
  setUiShell,
  setVoiceMode,
} from "$lib/context"
import type { MessageKey } from "@drive-coding/core/i18n"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import { ComposerDraft } from "$lib/view-models/composer-draft.svelte"
import type { Dictate, DictateState, FinishListeningResult } from "$lib/view-models/dictate.svelte"
import type { I18nVM } from "$lib/view-models/i18n.svelte"
import type { MicState } from "$lib/view-models/mic.svelte"
import type { ModelStatus } from "$lib/view-models/derived/model-status.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"
import type { InputMode } from "$lib/view-models/ui-shell.svelte"
import type { VoiceMode } from "$lib/view-models/derived/voice-mode.svelte"
import TypeArea from "../TypeArea.svelte"

let props: {
  isRunActive?: boolean
  supportsImageInput?: boolean
  enterToSend?: boolean
  sendPrompt?: (text: string, opts?: { attachments?: unknown[] }) => void
  dictateState?: DictateState
  finishListening?: () => Promise<FinishListeningResult>
  session?: { status: AgentSession["status"] }
} = $props()

const fakeI18n = { t: (key: string) => key } as unknown as I18nVM

const sessionRef = $derived(props.session ?? { status: "connected" as AgentSession["status"] })

const fakeSession = {
  get status() {
    return sessionRef.status
  },
  availableCommands: [],
  get supportsImageInput() {
    return props.supportsImageInput ?? false
  },
  sendPrompt(text: string, opts?: { attachments?: unknown[] }) {
    ;(props.sendPrompt ?? (() => {}))(text, opts)
  },
} as unknown as AgentSession

const fakeSettings = {
  get enterToSend() {
    return props.enterToSend ?? false
  },
} as unknown as Settings

const fakeVoiceMode = { cancelRun: () => {} } as unknown as VoiceMode

const fakeModelStatus = {
  get isRunActive() {
    return props.isRunActive ?? false
  },
  stopRunLabelKey: "playbackControls.stopRun" as MessageKey,
} as unknown as ModelStatus

const composerDraft = new ComposerDraft()

const fakeDictate = {
  get state() {
    return props.dictateState ?? ("idle" as DictateState)
  },
  error: null as MessageKey | null,
  toggle: async () => {},
  cancel: () => {},
  finishListening: () =>
    (props.finishListening ?? (async () => ({ ok: true, text: "" } as const)))(),
}

const fakeMic = {
  state: "idle" as MicState,
}

const fakeUiShell = {
  inputMode: "typing" as InputMode,
}

setI18n(fakeI18n)
setSession(fakeSession)
setSettings(fakeSettings)
setVoiceMode(fakeVoiceMode)
setModelStatus(fakeModelStatus)
setComposerDraft(composerDraft)
setDictate(fakeDictate as unknown as Dictate)
setMic(fakeMic)
setUiShell(fakeUiShell)
</script>

<TypeArea />
