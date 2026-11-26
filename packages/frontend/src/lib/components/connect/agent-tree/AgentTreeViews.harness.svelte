<script lang="ts">
import { untrack } from "svelte"
import type { RelatedAgentNavigation } from "$lib/actions/open-related-agent"
import AgentRelationshipBadges from "$lib/components/layout/AgentRelationshipBadges.svelte"
import {
  setActiveAgents,
  setCliAvailability,
  setI18n,
  setResponsive,
  setSession,
  setSettings,
} from "$lib/context"
import { ActiveAgents } from "$lib/view-models/active-agents.svelte"
import { CliAvailability } from "$lib/view-models/cli-availability.svelte"
import { I18nVM } from "$lib/view-models/i18n.svelte"
import { Settings } from "$lib/view-models/settings.svelte"
import type { AgentListView } from "$lib/view-models/settings-persistence"
import AgentDrillList from "./AgentDrillList.svelte"
import AgentProcessRow from "./AgentProcessRow.svelte"
import AgentTreeList from "./AgentTreeList.svelte"
import AgentTreeModeToggle from "./AgentTreeModeToggle.svelte"

interface State {
  tree?: ActiveAgents["tree"]
  mode: AgentListView | "toggle" | "header"
  initialBranchId?: string
  mobile: boolean
}
let fixtureState = $state.raw<State>({ mode: "tree", mobile: false })
let closed = 0
const settings = new Settings()
settings.locale = "en"
const agents = new ActiveAgents()
setActiveAgents(agents)
setSettings(settings)
setI18n(new I18nVM({ settings }))
setCliAvailability(new CliAvailability())
setResponsive({
  get isMobile() {
    return fixtureState.mobile
  },
} as Parameters<typeof setResponsive>[0])
const props: { session: Parameters<typeof setSession>[0]; navigation: RelatedAgentNavigation } =
  $props()
setSession(untrack(() => props.session))
export function update(patch: Partial<State>): void {
  fixtureState = { ...fixtureState, ...patch }
  if (patch.tree) agents.agents = patch.tree.preOrder.map((node) => node.agent)
}
export const closedCount = () => closed
</script>

{#snippet row(node: ActiveAgents["tree"]["preOrder"][number], onOpenBranch?: () => void)}
  <AgentProcessRow {node} {onOpenBranch} />
{/snippet}

{#snippet list(view: AgentListView)}
  {#if view === "tree"}
    {#if fixtureState.tree}<AgentTreeList tree={fixtureState.tree} {row} />{/if}
  {:else}
    {#key fixtureState.initialBranchId}
      <AgentDrillList tree={fixtureState.tree} {row} initialBranchId={fixtureState.initialBranchId} onClose={() => closed++} />
    {/key}
  {/if}
{/snippet}

{#if fixtureState.mode === "header"}
  <span id="chat-session-title" tabindex="-1">Session title</span>
  {#if props.session.agentId}
    {#key props.session.agentId}
      <AgentRelationshipBadges sourceId={props.session.agentId} navigation={props.navigation} />
    {/key}
  {/if}
{:else if fixtureState.mode === "toggle"}
  <AgentTreeModeToggle children={list} />
{:else}
  {@render list(fixtureState.mode)}
{/if}
