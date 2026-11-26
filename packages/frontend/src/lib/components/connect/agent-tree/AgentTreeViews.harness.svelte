<script lang="ts">
import type { AgentPublic } from "@drive-coding/core"
import type { AgentTree, AgentTreeNode } from "@drive-coding/core/agents/agent-tree"
import { setCliAvailability, setI18n, setResponsive, setSettings } from "$lib/context"
import { CliAvailability } from "$lib/view-models/cli-availability.svelte"
import { I18nVM } from "$lib/view-models/i18n.svelte"
import type { ResponsiveVM } from "$lib/view-models/responsive.svelte"
import { Settings } from "$lib/view-models/settings.svelte"
import type { AgentListView } from "$lib/view-models/settings-persistence"
import AgentDrillList from "./AgentDrillList.svelte"
import AgentProcessRow from "./AgentProcessRow.svelte"
import AgentTreeList from "./AgentTreeList.svelte"
import AgentTreeModeToggle from "./AgentTreeModeToggle.svelte"

let tree: AgentTree<AgentPublic> | undefined = $state.raw()
let mode: AgentListView | "toggle" = $state("tree")
let initialBranchId: string | undefined = $state()
let mobile = $state(false)
let closed = 0
const settings = new Settings()
settings.locale = "en"
settings.agentListView = undefined
setSettings(settings)
setI18n(new I18nVM({ settings }))
setCliAvailability(new CliAvailability())
setResponsive({
  get isMobile() {
    return mobile
  },
} as ResponsiveVM)

export function setTree(snapshot: AgentTree<AgentPublic> | undefined): void {
  tree = snapshot
}

export function setMode(next: typeof mode, branchId?: string): void {
  mode = next
  initialBranchId = branchId
}

export function setMobile(value: boolean): void {
  mobile = value
}

export function closedCount(): number {
  return closed
}
</script>

{#snippet row(node: AgentTreeNode<AgentPublic>, onOpenBranch?: () => void)}
  <AgentProcessRow {node} {onOpenBranch} />
{/snippet}

{#snippet list(view: AgentListView)}
  {#if view === "tree"}
    {#if tree}<AgentTreeList {tree} {row} />{/if}
  {:else}
    {#key initialBranchId}
      <AgentDrillList {tree} {row} {initialBranchId} onClose={() => closed++} />
    {/key}
  {/if}
{/snippet}

{#if mode === "toggle"}
  <AgentTreeModeToggle children={list} />
{:else}
  {@render list(mode)}
{/if}
