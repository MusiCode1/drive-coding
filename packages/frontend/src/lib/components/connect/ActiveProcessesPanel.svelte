<script lang="ts">
import type { AgentPublic, MachineStats } from "@drive-coding/core"
import type { AgentTreeNode } from "@drive-coding/core/agents/agent-tree"
import { onDestroy, onMount } from "svelte"
import { getMachineStats } from "$lib/adapters/system-api"
import { getActiveAgents, getI18n, getSettings } from "$lib/context"
import { resizeDrag } from "$lib/util/resize-drag"
import AgentProcessRow from "./agent-tree/AgentProcessRow.svelte"
import AgentTreeList from "./agent-tree/AgentTreeList.svelte"
import MachineStatsBar from "./MachineStatsBar.svelte"

const { onReconnect }: { onReconnect: (agent: AgentPublic) => void } = $props()
const activeAgents = getActiveAgents()
const { t } = getI18n()
const settings = getSettings()
let dragHeight = $state<number | null>(null)
let handleEl = $state<HTMLDivElement | null>(null)
let confirmingId = $state<string | null>(null)
let confirmTimer: ReturnType<typeof setTimeout> | undefined
let machine = $state<MachineStats | null>(null)

async function refreshMachine() {
  try {
    machine = await getMachineStats()
  } catch {
    // Keep the last reading when the server cannot provide fresh machine stats.
  }
}

function cancelKillConfirm() {
  clearTimeout(confirmTimer)
  confirmingId = null
}

function handleKill(id: string) {
  if (confirmingId === id) {
    cancelKillConfirm()
    void activeAgents.kill(id)
  } else {
    clearTimeout(confirmTimer)
    confirmingId = id
    confirmTimer = setTimeout(cancelKillConfirm, 3000)
  }
}

onMount(() => activeAgents.subscribe(refreshMachine))
onDestroy(() => clearTimeout(confirmTimer))
</script>

{#snippet row(node: AgentTreeNode<AgentPublic>)}
  <AgentProcessRow {node} {onReconnect} onKill={handleKill} onCancelKill={cancelKillConfirm} confirming={confirmingId === node.agent.id} />
{/snippet}

<section class="active-panel">
  <div class="panel-header">
    <span class="panel-title">
      {t("connect.agents.title")}{activeAgents.tree.byId.size > 0 ? ` (${activeAgents.tree.byId.size})` : ""}
    </span>
    <button
      type="button"
      class="refresh-btn"
      disabled={activeAgents.loading}
      onclick={() => { void activeAgents.refresh(); void refreshMachine() }}
      title={t("connect.agents.refresh")}
      aria-label={t("connect.agents.refresh")}
    >
      ↺
    </button>
  </div>

  <MachineStatsBar stats={machine} />

  {#if activeAgents.tree.byId.size === 0}
    <div class="empty-state">
      {t("connect.agents.empty")}
    </div>
  {:else}
    <div class="agent-scroll chat-scroll" style:max-height={`${dragHeight ?? settings.activePanelHeight}px`}>
      <AgentTreeList tree={activeAgents.tree} {row} />
    </div>
    <div
      class="resize-handle"
      bind:this={handleEl}
      use:resizeDrag={{
        getStart: () => settings.activePanelHeight,
        onMove: (px) => {
          dragHeight = px
          handleEl?.scrollIntoView({ block: "nearest" })
        },
        onEnd: (px) => {
          settings.setActivePanelHeight(px)
          dragHeight = null
        },
      }}
      role="separator"
      aria-orientation="horizontal"
      aria-label={t("connect.panel.resizeHandle")}
    ></div>
  {/if}
</section>

<style>
  .active-panel {
    margin-bottom: 1.5rem;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--border);
  }

  .panel-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--fg-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .refresh-btn {
    padding: 0.2rem 0.5rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--fg-dim);
    font-size: 1rem;
    cursor: pointer;
    line-height: 1;
    transition: color 0.15s, border-color 0.15s;
    margin-top: 0;
  }

  .refresh-btn:hover:not(:disabled) {
    color: var(--fg);
    border-color: var(--accent);
  }

  .refresh-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .empty-state {
    padding: 0.8rem 0.9rem;
    font-size: 0.85rem;
    color: var(--fg-dim);
  }

  .agent-scroll {
    overflow: auto;
  }

  /* ידית גרירה לשינוי גובה — slice connect-panel-resize */
  .resize-handle {
    height: 10px;
    cursor: ns-resize;
    touch-action: none;
    position: relative;
  }

  .resize-handle::after {
    content: "";
    position: absolute;
    inset-inline: 40%;
    top: 50%;
    height: 3px;
    transform: translateY(-50%);
    border-radius: 2px;
    /* גלוי-תמיד (לא hover-only) — במובייל אין hover */
    background: var(--border-str);
    transition: background 0.15s;
  }

  .resize-handle:hover::after,
  .resize-handle:active::after {
    background: var(--accent);
  }

</style>
