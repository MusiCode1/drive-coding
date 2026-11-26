import { onDestroy, onMount, untrack } from "svelte"
import type { beforeNavigate } from "$app/navigation"
import { navigating, page } from "$app/state"
import { setComposerDraft, setDictate, setMic } from "$lib/context"
import type { CuesEngine } from "$lib/engines/cues"
import {
  createDictateRecovery,
  type RecordTarget,
  type RecordTargetSource,
} from "$lib/engines/pending-capture-wiring"
import type { SessionView } from "$lib/session/session-view"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import { ComposerDraft } from "$lib/view-models/composer-draft.svelte"
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
>

const inChat = (pathname: string | undefined) =>
  pathname === "/chat" || pathname?.startsWith("/chat/")

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
    const { cliKind, sessionId, agentId } = session
    if (
      session.status !== "connected" ||
      session.isLoadingHistory ||
      !cliKind ||
      !sessionId ||
      !agentId
    )
      return null
    const view = session.ingestView()
    const identity = view?.targetIdentity
    if (
      !view ||
      view === leavingView ||
      !identity?.backendBaseUrl ||
      identity.sessionId !== sessionId
    )
      return null
    if (
      page.route.id !== "/chat" &&
      (page.route.id !== "/chat/[cliKind]/[sessionId]" ||
        page.params.cliKind !== cliKind ||
        page.params.sessionId !== sessionId)
    )
      return null
    const backendBaseUrl = identity.backendBaseUrl
    const ownerKey = JSON.stringify([backendBaseUrl, cliKind, sessionId])
    return { ownerKey, backendBaseUrl, view, agentId, generation }
  }

  const targets: RecordTargetSource = {
    current,
    isCurrent(target) {
      const active = current()
      return (
        active?.ownerKey === target.ownerKey &&
        active.view === target.view &&
        active.agentId === target.agentId &&
        active.generation === target.generation
      )
    },
  }
  const mic = new Mic({ session, targets, cues, getInputDeviceId })
  const draft = new ComposerDraft()
  const dictate = new Dictate({ mic, draft, getInputDeviceId, recovery: createDictateRecovery() })

  $effect(() => {
    if (leavingView) {
      const view = session.ingestView()
      if ((view && view !== leavingView) || (session.status === "idle" && !session.sessionId)) {
        leavingView = null
      }
    }
    const target = current()
    void mic.hydrationRevision
    if (target) untrack(() => void mic.hydratePending(target))
  })
  onMount(() => void dictate.hydratePending())

  return {
    mic,
    installContexts() {
      setMic(mic)
      setComposerDraft(draft)
      setDictate(dictate)
    },
  }
}
