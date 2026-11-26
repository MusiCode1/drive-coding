<script module lang="ts">
import type { createPromptRecoveryDb } from "$lib/adapters/prompt-recovery-idb"

// Serial transactions with rollback, shared by the source, ownership and UI fixtures.
export function promptTestDb() {
  const disk = new Map<string, Map<string, unknown>>()
  let queue: Promise<unknown> = Promise.resolve()
  const transact: ReturnType<typeof createPromptRecoveryDb>["transact"] = (mode, reads, apply) => {
    const operation = queue.then(() => {
      const snapshot = new Map([...disk].map(([name, rows]) => [name, new Map(rows)]))
      const objectStore = (name: string) => {
        const existing = snapshot.get(name)
        const rows = existing ?? new Map<string, unknown>()
        if (!existing) snapshot.set(name, rows)
        return {
          get: (key: IDBValidKey) => rows.get(JSON.stringify(key)),
          put: (data: unknown, key: IDBValidKey) => rows.set(JSON.stringify(key), data),
          delete(key: IDBValidKey | IDBKeyRange) {
            if (typeof key === "object" && "lower" in key) {
              const [owner] = key.lower as unknown[]
              for (const saved of rows.keys()) {
                const parsed: unknown = JSON.parse(saved)
                if (Array.isArray(parsed) && parsed[0] === owner) rows.delete(saved)
              }
            } else rows.delete(JSON.stringify(key))
          },
        }
      }
      const values = reads.map(({ store, key }) => objectStore(store).get(key as IDBValidKey))
      const result = apply({ objectStore } as unknown as IDBTransaction, values)
      if (mode === "readwrite") {
        for (const [name, rows] of snapshot) disk.set(name, rows)
      }
      return result
    })
    queue = operation.catch(() => undefined)
    return operation
  }
  return { transact }
}
</script>

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
 *
 * ─── slice ltr-in-english-mic-denied ───
 * dir (locale direction) + micPermissionDenied for the composer-direction and
 * denied-icon tests.
 */

import { untrack } from "svelte"
import {
  setComposerDraft,
  setDictate,
  setI18n,
  setMic,
  setModelStatus,
  setPromptRetry,
  setSession,
  setSettings,
  setUiShell,
  setVoiceMode,
} from "$lib/context"
import type { MessageKey } from "@drive-coding/core/i18n"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import { ComposerDraft } from "$lib/view-models/composer-draft.svelte"
import { createDictateRecovery } from "$lib/engines/pending-capture-wiring"
import { Dictate, type DictateState, type FinishListeningResult } from "$lib/view-models/dictate.svelte"
import type { I18nVM } from "$lib/view-models/i18n.svelte"
import type { Mic, MicState } from "$lib/view-models/mic.svelte"
import type { ModelStatus } from "$lib/view-models/derived/model-status.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"
import type { InputMode, UiShellVM } from "$lib/view-models/ui-shell.svelte"
import type { VoiceMode } from "$lib/view-models/derived/voice-mode.svelte"
import { PromptRetry } from "$lib/view-models/prompt-retry.svelte"
import { DictateSubmit } from "$lib/view-models/dictate-submit.svelte"
import TypeArea from "../TypeArea.svelte"

let props: {
  isRunActive?: boolean
  supportsImageInput?: boolean
  enterToSend?: boolean
  sendPrompt?: (text: string, opts?: { attachments?: unknown[] }) => void
  dictateState?: DictateState
  finishListening?: () => Promise<FinishListeningResult>
  session?: { status: AgentSession["status"] }
  dir?: "rtl" | "ltr"
  micPermissionDenied?: boolean
  owned?: { prompts: PromptRetry; dictateSubmit: DictateSubmit }
} = $props()

const fakeI18n = {
  t: (key: string) => key,
  get dir() {
    return props.dir ?? "ltr"
  },
} as unknown as I18nVM

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

let permissionDenied = $state<boolean>()
const fakeMic = {
  state: "idle" as MicState,
  get permissionDenied() {
    return permissionDenied ?? props.micPermissionDenied ?? false
  },
  set permissionDenied(denied: boolean) {
    permissionDenied = denied
  },
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
const owned = untrack(() => props.owned)
if (owned) {
  setPromptRetry(owned)
  setDictate(new Dictate({
    mic: fakeMic as unknown as Mic,
    draft: composerDraft,
    recovery: createDictateRecovery(),
    submit: owned.dictateSubmit,
  }))
} else {
  const prompts = new PromptRetry({ current: () => null, isCurrent: () => false }, () => {})
  setPromptRetry({ prompts, dictateSubmit: new DictateSubmit(prompts), legacyFixture: () => true })
  setDictate(fakeDictate as unknown as Dictate)
}
setMic(fakeMic as unknown as Mic)
setUiShell(fakeUiShell as unknown as UiShellVM)
</script>

<TypeArea />
