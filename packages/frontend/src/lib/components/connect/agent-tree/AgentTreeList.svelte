<script module lang="ts">
import type { AgentPublic } from "@drive-coding/core"
import type { AgentTree, AgentTreeNode } from "@drive-coding/core/agents/agent-tree"
import type { Snippet } from "svelte"
import { basename } from "$lib/util/path"

export type AgentTreeRow = Snippet<[AgentTreeNode<AgentPublic>, (() => void)?]>

export function agentBranchPath(
  tree: AgentTree<AgentPublic>,
  trail: readonly string[],
  boundary: string | undefined,
): AgentPublic[] {
  const outside = new Set<string>()
  for (const id of trail.slice().reverse()) {
    const agent = tree.byId.get(id)?.agent
    if (!agent || outside.has(id)) continue
    if (boundary === undefined) return tree.pathTo(id)

    const path: AgentPublic[] = []
    let member: AgentPublic | undefined = agent
    while (member && !outside.has(member.id)) {
      path.push(member)
      if (member.id === boundary) return path.reverse()
      member = tree.parentOf(member.id)
    }
    for (const member of path) outside.add(member.id)
  }
  const root = boundary === undefined ? undefined : tree.byId.get(boundary)?.agent
  return root ? [root] : []
}

export function agentTreeName(agent: AgentPublic): string {
  return agent.title?.trim() || agent.roleLabel || basename(agent.cwd) || agent.id
}

export function focusAgentRow(list: HTMLElement | undefined, id: string): void {
  for (const child of list?.children ?? []) {
    if (child instanceof HTMLElement && child.dataset.agentId === id) {
      child.focus()
      child.scrollIntoView?.({ block: "nearest" })
      return
    }
  }
}
</script>

<script lang="ts">
import { getI18n } from "$lib/context"

const { tree, row }: { tree: AgentTree<AgentPublic>; row: AgentTreeRow } = $props()
const { t } = getI18n()
let list: HTMLUListElement | undefined = $state()
</script>

<ul class="agent-tree-list" bind:this={list} aria-label={t("connect.agents.title")}>
  {#each tree.preOrder as node (node.agent.id)}
    {@const parent = node.depth >= 3 ? tree.parentOf(node.agent.id) : undefined}
    <li
      data-agent-id={node.agent.id}
      data-depth={node.depth}
      class:root={node.depth === 0}
      style:padding-inline-start={`${Math.min(node.depth, 2) * 0.8}rem`}
      tabindex="-1"
    >
      {@render row(node)}
      {#if node.rootReason}
        <span class="relationship-note">{t(node.rootReason === "orphan" ? "connect.agents.tree.orphan" : "connect.agents.tree.cycle")}</span>
      {/if}
      {#if parent}
        <button type="button" class="relationship-note parent-link" onclick={() => focusAgentRow(list, parent.id)}>
          <span aria-hidden="true" class="parent-arrow">↳</span>
          {t("connect.agents.tree.parent")} <bdi>{agentTreeName(parent)}</bdi>
        </button>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .agent-tree-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .root:not(:first-child) {
    border-block-start: 1px solid var(--border);
  }

  .relationship-note {
    display: block;
    margin: 0 0.9rem 0.55rem;
    color: var(--fg-dim);
    font-size: 0.75rem;
  }

  .parent-link {
    cursor: pointer;
    text-align: start;
    text-decoration: underline;
    overflow-wrap: anywhere;
  }

  .parent-arrow {
    display: inline-block;
  }

  .parent-arrow:dir(rtl) {
    transform: scaleX(-1);
  }
</style>
