import { onDestroy, onMount, untrack } from "svelte"
import type { beforeNavigate } from "$app/navigation"
import { navigating, page } from "$app/state"
import { setComposerDraft, setDictate, setMic, setPromptRetry } from "$lib/context"
import type { CuesEngine } from "$lib/engines/cues"
import {
  createDictateRecovery,
  readRecordTarget,
  sameRecordTarget,
  type RecordTarget,
  type RecordTargetSource,
} from "$lib/engines/pending-capture-wiring"
import type { SessionView } from "$lib/session/session-view"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import { ComposerDraft } from "$lib/view-models/composer-draft.svelte"
import { DictateSubmit } from "$lib/view-models/dictate-submit.svelte"
import { PromptRetry } from "$lib/view-models/prompt-retry.svelte"
import { Dictate } from "$lib/view-models/dictate.svelte"
import { Mic } from "$lib/view-models/mic.svelte"

type RecordSession = Pick<
  AgentSession,
  | "ingestView"
  | "cliKind"
  | "sessionId"
  | "status"
  | "isLoadingHistory"
  | "agentId"
  | "onSessionEnd"
  | "sendPrompt"
  | "lastUserMessage"
>

const inChat = (pathname: string | undefined) =>
  pathname === "/chat" || pathname?.startsWith("/chat/")

function bindComposerOwners(targets: RecordTargetSource, draft: ComposerDraft): void {
  const drafts = new Map<string, string>()
  let previous: string | undefined
  $effect.pre(() => {
    const owner = targets.current()?.ownerKey
    if (!owner || owner === previous) return
    untrack(() => {
      if (previous) {
        drafts.set(previous, draft.text)
        draft.setText(drafts.get(owner) ?? "")
      }
      previous = owner
    })
  })
}

export function installRecordInput(deps: {
  session: RecordSession
  beforeNavigate: typeof beforeNavigate
  cues?: CuesEngine
  getInputDeviceId?: () => string | null
}) {
  const { session, cues, getInputDeviceId } = deps
  let generation = $state(0)
  let routeBlock = $state<number | null>(null)
  let stackBlock = $state<number | null>(null)
  let leavingView = $state.raw<SessionView | null>(null)

  deps.beforeNavigate((nav) => {
    if (!inChat(nav.from?.url.pathname) && !inChat(nav.to?.url.pathname)) return
    const ticket = ++generation
    if (nav.willUnload) return
    routeBlock = ticket
    const settle = () => {
      if (routeBlock === ticket) routeBlock = null
    }
    void nav.complete.then(settle, settle)
  })

  onDestroy(
    session.onSessionEnd((reason) => {
      const ticket = ++generation
      if (reason === "switch" || reason === "new") {
        stackBlock = ticket
        queueMicrotask(() => {
          if (stackBlock === ticket) stackBlock = null
        })
      } else {
        leavingView = session.ingestView()
      }
    }),
  )

  function current(): RecordTarget | null {
    // Superseding navigation can skip beforeNavigate. Read the live router on every call.
    if (navigating.to || routeBlock !== null || stackBlock !== null) return null
    return readRecordTarget(session, generation, leavingView, page.route.id, page.params)
  }

  const targets: RecordTargetSource = {
    current,
    isCurrent: (target) => sameRecordTarget(current(), target),
  }
  const prompts = new PromptRetry(targets, (text) => {
    session.lastUserMessage = text
  })
  const dictateSubmit = new DictateSubmit(prompts)
  const mic = new Mic({ session, targets, cues, getInputDeviceId, prompts })
  const draft = new ComposerDraft()
  const dictate = new Dictate({
    mic,
    draft,
    getInputDeviceId,
    recovery: createDictateRecovery(),
    submit: dictateSubmit,
  })
  const legacyFixture = () =>
    import.meta.env.DEV && !session.ingestView() && session.sessionId?.startsWith("mock:") === true

  const hydrateVoiceSources = (target = current()) => {
    void dictateSubmit.refresh(target)
    if (target) void mic.hydratePending(target)
  }
  bindComposerOwners(targets, draft)
  onMount(() => {
    void dictate.hydratePending()
    return prompts.watch(hydrateVoiceSources, (owner) => dictateSubmit.ownerDeleted(owner))
  })

  $effect(() => {
    if (leavingView) {
      const view = session.ingestView()
      if ((view && view !== leavingView) || (session.status === "idle" && !session.sessionId)) {
        leavingView = null
      }
    }
    const target = current()
    void mic.hydrationRevision
    untrack(() => {
      void prompts.refresh(target)
      hydrateVoiceSources(target)
    })
  })

  return {
    mic,
    installContexts() {
      setMic(mic)
      setComposerDraft(draft)
      setDictate(dictate)
      setPromptRetry({ prompts, dictateSubmit, legacyFixture })
    },
  }
}
