<script lang="ts" module>
type HarnessAgent = import("@drive-coding/core/schemas/agent").AgentPublic
type HarnessBubble = import("$lib/types/bubble").UserBubble

/** Test-only sync when harnessState is a plain object outside Svelte reactivity. */
export const envelopeHarnessControls = {
  setAgents: (_agents: HarnessAgent[]) => {},
  getBubble: (): HarnessBubble => {
    throw new Error("harness not mounted")
  },
  setSessionCwd: (_cwd: string) => {},
}

const viewerCalls: { kind: string; uri?: string }[] = []

export function getViewerCalls(): readonly { kind: string; uri?: string }[] {
  return viewerCalls
}

export function clearViewerCalls(): void {
  viewerCalls.length = 0
}

export function pushViewerCall(payload: { kind: string; uri?: string }): void {
  viewerCalls.push(payload)
}
</script>

<script lang="ts">
/**
 * user-bubble-envelope-harness.svelte — mount UserBubble with envelope test context.
 */
import type { AgentPublic } from "@drive-coding/core/schemas/agent"
import {
  setActiveAgents,
  setBubblePlayer,
  setContentViewer,
  setI18n,
  setSession,
  setSettings,
  setSpeaker,
} from "$lib/context"
import type { UserBubble as UserBubbleModel } from "$lib/types/bubble"
import { ActiveAgents } from "$lib/view-models/active-agents.svelte"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { I18nVM } from "$lib/view-models/i18n.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"
import UserBubble from "../bubbles/UserBubble.svelte"

export type EnvelopeHarnessState = {
  bubble: UserBubbleModel
  agents: AgentPublic[]
}

let { harnessState = $bindable() }: { harnessState: EnvelopeHarnessState } = $props()

const fakeI18n = { t: (key: string) => key, locale: "he" } as unknown as I18nVM

class HarnessSession {
  cwd = $state<string | null>("/tmp/envelope-test")
  status = "connected" as const
}
const fakeSession = new HarnessSession() as unknown as AgentSession

const fakeSettings = {
  sessionTransport: null,
} as unknown as Settings

const activeAgents = new ActiveAgents()
// Single $state proxy — never replace bubble or segments[] (production: apply-patch-mutable).
const bubble = $state(harnessState.bubble)

$effect(() => {
  activeAgents.agents = harnessState.agents
})

envelopeHarnessControls.setAgents = (agents) => {
  activeAgents.agents = agents
}
envelopeHarnessControls.getBubble = () => bubble
envelopeHarnessControls.setSessionCwd = (cwd) => {
  ;(fakeSession as HarnessSession).cwd = cwd
}

const fakeViewer = {
  show: (payload: { kind: string; uri?: string }) => {
    pushViewerCall(payload)
  },
}

setI18n(fakeI18n)
setSession(fakeSession)
setSettings(fakeSettings)
setSpeaker({ enabled: false } as never)
setBubblePlayer({ playingBubbleId: null, toggle: () => {} } as never)
setContentViewer(fakeViewer as never)
setActiveAgents(activeAgents)
</script>

<UserBubble {bubble} />
