<script lang="ts">
import type { AgentPublic } from "@drive-coding/core"
import type { AgentTreeNode } from "@drive-coding/core/agents/agent-tree"
import { Popover } from "bits-ui"
import { onMount, tick } from "svelte"
import {
  openRelatedAgent,
  type RelatedAgentNavigation,
  relatedAgentBlock,
} from "$lib/actions/open-related-agent"
import { reconnectAgent } from "$lib/actions/reconnect-agent"
import AgentDrillList from "$lib/components/connect/agent-tree/AgentDrillList.svelte"
import AgentProcessRow from "$lib/components/connect/agent-tree/AgentProcessRow.svelte"
import { agentTreeName } from "$lib/components/connect/agent-tree/AgentTreeList.svelte"
import { getActiveAgents, getI18n, getSession, getSettings } from "$lib/context"

const { sourceId, navigation }: { sourceId: string; navigation: RelatedAgentNavigation } = $props()
const reasonId = $props.id()
const agents = getActiveAgents()
const session = getSession()
const settings = getSettings()
const i18n = getI18n()
let open = $state(false)
let moving = $state(false)
const node = $derived(agents.tree.byId.get(sourceId))
const parent = $derived(agents.tree.parentOf(sourceId))
const blocked = $derived(
  relatedAgentBlock(session, sourceId, parent, moving || navigation.isNavigating()),
)
const focusTitle = () => document.getElementById("chat-session-title")?.focus()
onMount(() => agents.subscribe())

async function openParent() {
  const source = node?.agent
  if (!source || blocked) return
  moving = true
  try {
    const result = await openRelatedAgent({
      source,
      parent: () => agents.tree.parentOf(source.id),
      session,
      ...navigation,
      reconnect: (agent) => reconnectAgent({ agent, session, settings }),
      t: i18n.t,
    })
    if (result === "restored" || result === "failed") await tick().then(focusTitle)
  } finally {
    moving = false
  }
}
</script>

{#snippet row(entry: AgentTreeNode<AgentPublic>, onOpenBranch?: () => void)}
  <AgentProcessRow node={entry} {onOpenBranch} />
{/snippet}

{#if node?.descendantCount || parent || open}
  <div class="agent-relationships">
    {#if node?.descendantCount || open}
      <Popover.Root bind:open>
        <Popover.Trigger class="relationship-trigger">
          {#if node?.descendantCount}
            <span class="trigger-text">
              {node.descendantCount}
              {i18n.t(node.descendantCount === 1 ? "connect.agents.tree.descendant" : "connect.agents.tree.descendants")}
              {#if node.busyDescendantCount > 0} · {node.busyDescendantCount} {i18n.t("connect.agents.working")}{/if}
            </span>
          {:else}
            {i18n.t("connect.agents.tree.path")}
          {/if}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            role="dialog"
            sideOffset={6}
            dir={i18n.dir}
            class="z-50 w-80 max-w-[92vw] max-h-[70dvh] overflow-y-auto rounded-xl border shadow-xl"
            style="background:var(--bg-elev); border-color:var(--border)"
            aria-label={i18n.t("connect.agents.tree.path")}
            onCloseAutoFocus={(event) => {
              if (!node?.descendantCount) {
                event.preventDefault()
                focusTitle()
              }
            }}
          >
            <AgentDrillList
              tree={agents.hasSnapshot ? agents.tree : undefined}
              initialBranchId={sourceId}
              onClose={() => {
                open = false
                void tick().then(focusTitle)
              }}
              {row}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    {/if}
    {#if parent}
      <button
        type="button"
        class="relationship-trigger parent-trigger"
        aria-disabled={blocked !== undefined}
        aria-describedby={blocked ? reasonId : undefined}
        aria-label={`${i18n.t("connect.agents.tree.childOf")} ${agentTreeName(parent)}`}
        title={blocked ? i18n.t(blocked) : `${i18n.t("connect.agents.tree.childOf")} ${agentTreeName(parent)}`}
        onclick={openParent}
      >
        <span class="parent-label">{i18n.t("connect.agents.tree.childOf")}</span>
        <bdi>{agentTreeName(parent)}</bdi>
      </button>
      {#if blocked}<span class="sr-only" id={reasonId}>{i18n.t(blocked)}</span>{/if}
    {/if}
  </div>
{/if}

<style>
  .agent-relationships {
    display: flex;
    justify-content: center;
    gap: 0.3rem;
    max-inline-size: 100%;
    min-inline-size: 0;
  }

  .agent-relationships :global(.relationship-trigger) {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    pointer-events: auto;
    flex: 0 1 auto;
    min-inline-size: 0;
    max-inline-size: 100%;
    padding: 0.12rem 0.35rem;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--bg-card);
    color: var(--fg);
    cursor: pointer;
    font-size: 0.69rem;
    line-height: 1.2;
    white-space: nowrap;
  }

  .agent-relationships :global(.relationship-trigger[aria-disabled="true"]) {
    color: var(--fg-dim);
    cursor: not-allowed;
  }

  .parent-label {
    flex: none;
  }

  .parent-trigger bdi, .trigger-text {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (max-width: 480px) {
    .agent-relationships {
      grid-column: 1 / -1;
      grid-row: 2;
      justify-self: center;
    }

    .agent-relationships :global(.relationship-trigger) { padding-inline: 0.28rem; }
  }
</style>
