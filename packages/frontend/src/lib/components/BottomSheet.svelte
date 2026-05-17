<script lang="ts">
/**
 * BottomSheet.svelte — mobile bottom sheet (Phase 3).
 *
 * Structure: grip handle → summary (collapsed state) → scrollable content (expanded).
 * Content sections:
 *   - Active agents list
 *   - Navigation (dashboard, new agent)
 *   - Settings (settings, history, car mode toggle)
 *
 * Spec: mockup final.html .bottom-handle
 */

import { goto } from "$app/navigation"
import { sheetState } from "$lib/stores/sheet-state.svelte"
import Icon from "./Icon.svelte"

interface AgentItem {
  id: string
  name: string
  status: string
  cliKind: string
}

interface Props {
  agents?: AgentItem[]
  /** Currently active agent id */
  currentAgentId?: string
  /** Car mode toggle state */
  carModeActive?: boolean
  onCarModeToggle?: () => void
  onAgentSelect?: (agentId: string) => void
  onAgentClose?: (agentId: string) => void
}

let {
  agents = [],
  currentAgentId = "",
  carModeActive = false,
  onCarModeToggle,
  onAgentSelect,
  onAgentClose,
}: Props = $props()

function navigateDashboard() {
  sheetState.close()
  goto("/")
}

function navigateSettings() {
  sheetState.close()
  goto("/settings")
}

function navigateHistory() {
  sheetState.close()
  goto("/sessions")
}

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

<!-- Backdrop — closes sheet on tap -->
{#if sheetState.isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="sheet-backdrop" onclick={sheetState.close}></div>
{/if}

<div class="bottom-sheet" class:open={sheetState.isOpen}>
  <!-- Grip handle — tap to toggle -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="sheet-grip" onclick={sheetState.toggle}></div>

  <!-- Scrollable content (visible when open) -->
  <div class="sheet-content">
    <!-- Section: Active agents -->
    {#if agents.length > 0}
      <div class="sheet-section-label">סוכנים פעילים</div>
      {#each agents as agent (agent.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="sheet-item"
          class:current={agent.id === currentAgentId}
          onclick={() => { sheetState.close(); onAgentSelect?.(agent.id) }}
        >
          <div class="status-dot {agentStatusClass(agent.status)}"></div>
          <div class="item-info">
            <div class="item-title">{agent.name}</div>
            <div class="item-status">{agentStatusText(agent)}</div>
          </div>
          <button
            class="icon-btn"
            onclick={(e) => { e.stopPropagation(); onAgentClose?.(agent.id) }}
            aria-label="סגור סוכן"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      {/each}
    {/if}

    <!-- Section: Navigation -->
    <div class="sheet-section-label">ניווט</div>
    <button class="sheet-item" onclick={navigateDashboard}>
      <div class="item-icon"><Icon name="layout-grid" size={18} /></div>
      <div class="item-title">דשבורד</div>
    </button>
    <button class="sheet-item" onclick={() => { sheetState.close(); goto('/agent/new') }}>
      <div class="item-icon" style="color: var(--accent)"><Icon name="plus" size={18} /></div>
      <div class="item-title" style="color: var(--accent)">סוכן חדש</div>
    </button>

    <!-- Section: Settings -->
    <div class="sheet-section-label">הגדרות</div>
    <button class="sheet-item" onclick={navigateSettings}>
      <div class="item-icon"><Icon name="settings" size={18} /></div>
      <div class="item-title">הגדרות</div>
    </button>
    <button class="sheet-item" onclick={navigateHistory}>
      <div class="item-icon"><Icon name="book-open" size={18} /></div>
      <div class="item-title">היסטוריה</div>
    </button>

    <!-- Car mode toggle -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="sheet-item" onclick={onCarModeToggle}>
      <div class="item-icon"><Icon name="car" size={18} /></div>
      <div class="item-title" style="flex: 1;">מצב רכב</div>
      <!-- Simple toggle indicator -->
      <div class="car-toggle" class:active={carModeActive}>
        <div class="car-toggle-thumb"></div>
      </div>
    </div>
  </div>
</div>

<style>
  /* ── Backdrop ───────────────────────────────────────────────────────────── */
  .sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: 29;
    background: transparent;
  }

  /* ── Sheet container ─────────────────────────────────────────────────────── */
  .bottom-sheet {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--bg-elevated);
    border-top: 1px solid var(--border);
    border-radius: 20px 20px 0 0;
    /* Show just the grip handle when closed */
    transform: translateY(calc(100% - 30px));
    transition: transform 0.3s ease;
    z-index: 30;
    max-height: 70%;
    display: flex;
    flex-direction: column;
    box-shadow: 0 -8px 20px rgba(0, 0, 0, 0.3);
  }

  .bottom-sheet.open {
    transform: translateY(0);
  }

  /* ── Grip ────────────────────────────────────────────────────────────────── */
  .sheet-grip {
    width: 40px;
    height: 4px;
    background: var(--border-strong);
    border-radius: 2px;
    margin: var(--s-2) auto;
    cursor: pointer;
    flex-shrink: 0;
  }

  /* ── Scrollable content ─────────────────────────────────────────────────── */
  .sheet-content {
    flex: 1;
    overflow-y: auto;
    padding: 0 var(--s-2) var(--s-4);
    display: none;
  }

  .bottom-sheet.open .sheet-content {
    display: block;
  }

  /* ── Section label ─────────────────────────────────────────────────────── */
  .sheet-section-label {
    font-size: 0.7rem;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: var(--s-3) var(--s-3) var(--s-1);
  }

  /* ── Sheet items ────────────────────────────────────────────────────────── */
  .sheet-item {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3);
    border-radius: 8px;
    cursor: pointer;
    width: 100%;
    text-align: start;
    background: transparent;
    border: none;
    color: var(--fg);
    font-family: inherit;
    font-size: 1rem;
    transition: background 0.1s;
  }

  .sheet-item:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .sheet-item.current {
    background: rgba(79, 140, 255, 0.1);
  }

  .item-info {
    flex: 1;
    min-width: 0;
  }

  .item-title {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-status {
    font-size: 0.8rem;
    color: var(--fg-dim);
  }

  .item-icon {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-dim);
    flex-shrink: 0;
  }

  /* ── Car mode toggle ────────────────────────────────────────────────────── */
  .car-toggle {
    width: 36px;
    height: 20px;
    background: var(--border);
    border-radius: 10px;
    position: relative;
    flex-shrink: 0;
    transition: background 0.2s;
  }

  .car-toggle.active {
    background: var(--accent);
  }

  .car-toggle-thumb {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 16px;
    height: 16px;
    background: var(--fg);
    border-radius: 50%;
    transition: right 0.2s;
  }

  .car-toggle.active .car-toggle-thumb {
    right: calc(100% - 18px);
  }
</style>
