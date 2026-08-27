<script lang="ts">
/**
 * type-area-harness.svelte — harness for mounting TypeArea in component tests.
 *
 * ─── slice/ui-var-fixes (Commit 2) ───
 *
 * TypeArea reads five contexts from +layout (i18n, session, settings,
 * voiceMode, modelStatus). Stubs below cover only the fields the component
 * actually touches when rendering the stop-run button.
 *
 * ─── slice/type-area-align (Commit 1+2) ───
 * supportsImageInput + enterToSend props for control-height and Enter gates.
 */

import {
  setI18n,
  setModelStatus,
  setSession,
  setSettings,
  setVoiceMode,
} from "$lib/context"
import type { MessageKey } from "@drive-coding/core/i18n"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { I18nVM } from "$lib/view-models/i18n.svelte"
import type { ModelStatus } from "$lib/view-models/derived/model-status.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"
import type { VoiceMode } from "$lib/view-models/derived/voice-mode.svelte"
import TypeArea from "../TypeArea.svelte"

let props: {
  isRunActive?: boolean
  supportsImageInput?: boolean
  enterToSend?: boolean
  sendPrompt?: (text: string, opts?: { attachments?: unknown[] }) => void
} = $props()

const fakeI18n = { t: (key: string) => key } as unknown as I18nVM

const fakeSession = {
  status: "connected",
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

setI18n(fakeI18n)
setSession(fakeSession)
setSettings(fakeSettings)
setVoiceMode(fakeVoiceMode)
setModelStatus(fakeModelStatus)
</script>

<TypeArea />
