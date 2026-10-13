<script lang="ts" module>
/** Test-only sync when harnessState is a plain object outside Svelte reactivity. */
export const envelopeHarnessControls = {
  setAgents: (_agents: AgentPublic[]) => {},
  setBubble: (_bubble: UserBubbleModel) => {},
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

const fakeSession = {
  cwd: "/tmp/envelope-test",
  status: "connected",
} as unknown as AgentSession

const fakeSettings = {
  sessionTransport: null,
} as unknown as Settings

const activeAgents = new ActiveAgents()

$effect(() => {
  activeAgents.agents = harnessState.agents
})

envelopeHarnessControls.setAgents = (agents) => {
  activeAgents.agents = agents
}
envelopeHarnessControls.setBubble = (bubble) => {
  harnessState = { ...harnessState, bubble }
}

setI18n(fakeI18n)
setSession(fakeSession)
setSettings(fakeSettings)
setSpeaker({ enabled: false } as never)
setBubblePlayer({ playingBubbleId: null, toggle: () => {} } as never)
setContentViewer({ show: () => {} } as never)
setActiveAgents(activeAgents)
</script>

<UserBubble bubble={harnessState.bubble} />
