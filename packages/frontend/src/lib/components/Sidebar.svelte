<script lang="ts">
/**
 * Sidebar.svelte — desktop sidebar (Phase 4).
 *
 * Layout:
 *   - Header: "סוכנים" title + new agent button
 *   - Items: agents list with status dots (scrollable)
 *   - Footer: ⚙ settings, 📚 history, 🚗 car mode, collapse button
 *
 * Spec: mockup final.html .desktop-with-sidebar .sidebar
 */

import { goto } from "$app/navigation"
import Icon from "./Icon.svelte"

interface AgentItem {
  id: string
  name: string
  status: string
  cliKind: string
}

interface Props {
  agents?: AgentItem[]
  currentAgentId?: string
  collapsed?: boolean
  carModeActive?: boolean
  onCollapseToggle?: () => void
  onCarModeToggle?: () => void
  onAgentSelect?: (agentId: string) => void
}

let {
  agents = [],
  currentAgentId = "",
  collapsed = false,
  carModeActive = false,
  onCollapseToggle,
  onCarModeToggle,
  onAgentSelect,
}: Props = $props()

function agentStatusClass(status: string): string {
  switch (status) {
    case "busy":
      return "speaking"
    case "starting":
      return "thinking"
    case "crashed":
      return "error"
    case "ready":
      return "active"
    default:
      return ""
  }
}

function agentStatusText(agent: AgentItem): string {
  switch (agent.status) {
    case "busy":
      return `עסוק · ${agent.cliKind}`
    case "starting":
      return `מאותחל... · ${agent.cliKind}`
    case "crashed":
      return `קרס · ${agent.cliKind}`
    default:
      return `מוכן · ${agent.cliKind}`
  }
}
</script>

<aside class="sidebar" class:collapsed>
  <!-- ── Header ─────────────────────────────────────────────────────────── -->
  <div class="sidebar-header">
    {#if !collapsed}
      <div class="sidebar-title">סוכנים</div>
    {/if}
    <button
      class="icon-btn"
      onclick={() => goto("/agent/new")}
      aria-label="סוכן חדש"
      title="סוכן חדש"
    >
      <Icon name="plus" size={18} />
    </button>
  </div>

  <!-- ── Agents list ────────────────────────────────────────────────────── -->
  <div class="sidebar-items">
    {#if agents.length > 0}
      {#if !collapsed}
        <div class="sidebar-section-label">פעילים</div>
      {/if}
      {#each agents as agent (agent.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="sidebar-item"
          class:current={agent.id === currentAgentId}
          onclick={() => onAgentSelect?.(agent.id)}
          title={collapsed ? agent.name : undefined}
        >
          <div class="status-dot {agentStatusClass(agent.status)}"></div>
          {#if !collapsed}
            <div class="item-info">
              <div class="item-title">{agent.name}</div>
              <div class="item-status">{agentStatusText(agent)}</div>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <!-- ── Footer ────────────────────────────────────────────────────────── -->
  <div class="sidebar-footer">
    <a href="/settings" class="icon-btn" aria-label="הגדרות" title="הגדרות">
      <Icon name="settings" size={18} />
    </a>
    <button
      class="icon-btn"
      onclick={() => goto("/sessions")}
      aria-label="היסטוריה"
      title="היסטוריה"
    >
      <Icon name="book-open" size={18} />
    </button>
    <button
      class="icon-btn"
      class:active-icon={carModeActive}
      onclick={onCarModeToggle}
      aria-label="מצב רכב"
      title="מצב רכב"
    >
      <Icon name="car" size={18} />
    </button>
    <div class="spacer"></div>
    <button
      class="icon-btn"
      onclick={onCollapseToggle}
      aria-label={collapsed ? "הרחב" : "כווץ"}
      title={collapsed ? "הרחב סרגל צד" : "כווץ סרגל צד"}
    >
      <Icon name={collapsed ? "panel-left-open" : "panel-right-close"} size={18} />
    </button>
  </div>
</aside>

<style>
  /* ── Sidebar container ──────────────────────────────────────────────────── */
  .sidebar {
    width: 260px;
    background: var(--bg-elevated);
    border-inline-start: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    transition: width 0.2s ease;
    overflow: hidden;
  }

  .sidebar.collapsed {
    width: 56px;
  }

  /* ── Header ─────────────────────────────────────────────────────────────── */
  .sidebar-header {
    padding: var(--s-4);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: var(--s-2);
    flex-shrink: 0;
  }

  .sidebar-title {
    font-weight: 500;
    flex: 1;
    font-size: 0.95rem;
    white-space: nowrap;
  }

  /* ── Items ──────────────────────────────────────────────────────────────── */
  .sidebar-items {
    flex: 1;
    overflow-y: auto;
    padding: var(--s-2);
  }

  .sidebar-section-label {
    font-size: 0.7rem;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: var(--s-3) var(--s-3) var(--s-1);
    white-space: nowrap;
  }

  .sidebar-item {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3);
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.1s;
    min-height: 44px;
  }

  .sidebar-item:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .sidebar-item.current {
    background: rgba(79, 140, 255, 0.1);
  }

  .item-info {
    flex: 1;
    min-width: 0;
  }

  .item-title {
    font-weight: 500;
    font-size: 0.9rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-status {
    font-size: 0.75rem;
    color: var(--fg-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Footer ─────────────────────────────────────────────────────────────── */
  .sidebar-footer {
    padding: var(--s-3);
    border-top: 1px solid var(--border);
    display: flex;
    gap: var(--s-2);
    align-items: center;
    flex-shrink: 0;
  }

  .spacer {
    flex: 1;
  }

  /* Active state for car mode icon */
  .active-icon {
    color: var(--accent);
  }
</style>
