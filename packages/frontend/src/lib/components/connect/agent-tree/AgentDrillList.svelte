<script lang="ts">
import type { AgentPublic } from "@drive-coding/core"
import type { AgentTree } from "@drive-coding/core/agents/agent-tree"
import { tick, untrack } from "svelte"
import { getI18n } from "$lib/context"
import {
  type AgentTreeRow,
  agentBranchPath,
  agentTreeName,
  focusAgentRow,
} from "./AgentTreeList.svelte"

interface Props {
  tree: AgentTree<AgentPublic> | undefined
  row: AgentTreeRow
  initialBranchId?: string
  onClose?: () => void
}

const { tree, row, initialBranchId, onClose }: Props = $props()
const { t } = getI18n()
let trail = $state.raw<string[]>([])
let list: HTMLUListElement | undefined = $state()
const unavailable = $derived(
  !!tree && initialBranchId !== undefined && !tree.byId.has(initialBranchId),
)
const path = $derived(tree && !unavailable ? agentBranchPath(tree, trail, initialBranchId) : [])
const branch = $derived(path.at(-1))
const entries = $derived(branch ? tree?.byId.get(branch.id)?.children : tree?.roots)
const firstDepth = $derived(initialBranchId === undefined ? 0 : 1)

$effect(() => {
  if (!tree || unavailable) return
  const next = path.map((agent) => agent.id)
  untrack(() => {
    if (next.length !== trail.length || next.some((id, index) => id !== trail[index])) trail = next
  })
})

async function go(depth: number, enter?: string): Promise<void> {
  const next = path.slice(0, depth).map((agent) => agent.id)
  const focusId =
    enter === undefined ? path[depth]?.id : tree?.byId.get(enter)?.children[0]?.agent.id
  trail = enter === undefined ? next : [...next, enter]
  await tick()
  if (focusId !== undefined) focusAgentRow(list, focusId)
}
</script>

{#if unavailable}
  <p role="status" class="empty-branch">{t("connect.agents.tree.unavailable")}</p>
  {#if onClose}
    <button type="button" class="close-branch" onclick={onClose}>{t("connect.agents.tree.closeBranch")}</button>
  {/if}
{:else if !tree}
  <p role="status" class="empty-branch">{t("connect.agents.tree.loading")}</p>
{:else}
  {#if path.length > 0}
    <nav class="branch-nav" aria-label={t("connect.agents.tree.path")}>
      {#if path.length > firstDepth}
        <button type="button" class="path-button back" onclick={() => go(path.length - 1)}>
          {t("connect.agents.tree.back")}
        </button>
      {/if}
      <ol class="breadcrumbs">
        {#if firstDepth === 0}
          <li><button type="button" class="path-button" onclick={() => go(0)}>{t("connect.agents.title")}</button></li>
        {/if}
        {#each path as agent, index (agent.id)}
          <li>
            {#if index > 0 || firstDepth === 0}<span aria-hidden="true" class="path-separator">›</span>{/if}
            {#if index === path.length - 1}
              <span aria-current="location"><bdi>{agentTreeName(agent)}</bdi></span>
            {:else}
              <button type="button" class="path-button" onclick={() => go(index + 1)}>
                <bdi>{agentTreeName(agent)}</bdi>
              </button>
            {/if}
          </li>
        {/each}
      </ol>
    </nav>
  {/if}

  <ul class="drill-list" bind:this={list} aria-label={t("connect.agents.title")}>
    {#each entries ?? [] as node (node.agent.id)}
      <li data-agent-id={node.agent.id} tabindex="-1">
        {@render row(node, node.children.length > 0 ? () => go(path.length, node.agent.id) : undefined)}
        {#if node.rootReason}
          <span class="relationship-note">{t(node.rootReason === "orphan" ? "connect.agents.tree.orphan" : "connect.agents.tree.cycle")}</span>
        {/if}
      </li>
    {:else}
      <li class="empty-branch">{t("connect.agents.empty")}</li>
    {/each}
  </ul>
{/if}

<style>
  .drill-list, .breadcrumbs {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .drill-list > li + li {
    border-block-start: 1px solid var(--border);
  }

  .branch-nav, .breadcrumbs, .breadcrumbs li {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    min-inline-size: 0;
    gap: 0.35rem;
  }

  .branch-nav {
    padding: 0.5rem 0.9rem;
    border-block-end: 1px solid var(--border);
    font-size: 0.75rem;
    overflow-wrap: anywhere;
  }

  .path-button, .close-branch {
    color: var(--fg);
    cursor: pointer;
    text-align: start;
    text-decoration: underline;
  }

  .back {
    padding-inline-end: 0.5rem;
    border-inline-end: 1px solid var(--border);
  }

  .path-separator:dir(rtl) {
    transform: scaleX(-1);
  }

  .relationship-note, .empty-branch {
    display: block;
    padding: 0 0.9rem 0.55rem;
    color: var(--fg-dim);
    font-size: 0.75rem;
  }

  .empty-branch, .close-branch {
    padding: 0.55rem 0.9rem;
  }
</style>
