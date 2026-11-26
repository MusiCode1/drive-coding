<script lang="ts">
import type { AgentPublic } from "@drive-coding/core"
import type { AgentTree, AgentTreeNode } from "@drive-coding/core/agents/agent-tree"
import { setCliAvailability, setI18n } from "$lib/context"
import { CliAvailability } from "$lib/view-models/cli-availability.svelte"
import { I18nVM } from "$lib/view-models/i18n.svelte"
import { Settings } from "$lib/view-models/settings.svelte"
import AgentProcessRow from "./AgentProcessRow.svelte"
import AgentTreeList from "./AgentTreeList.svelte"

let tree: AgentTree<AgentPublic> | undefined = $state.raw()
const settings = new Settings()
settings.locale = "en"
setI18n(new I18nVM({ settings }))
setCliAvailability(new CliAvailability())

export function setTree(snapshot: AgentTree<AgentPublic>): void {
  tree = snapshot
}
</script>

{#snippet row(node: AgentTreeNode<AgentPublic>)}
  <AgentProcessRow {node} />
{/snippet}
{#if tree}
  <AgentTreeList {tree} {row} />
{/if}
