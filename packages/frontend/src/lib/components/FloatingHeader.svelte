<script lang="ts">
/**
 * FloatingHeader.svelte — mobile floating header (Phase 3).
 *
 * Layout: ⚙ | [agent name / session title centered] | 📚
 * Absolute positioned with backdrop-blur, pointer-events on buttons only.
 * Spec: mockup final.html .floating-header
 */

import { goto } from "$app/navigation"
import { sheetState } from "$lib/stores/sheet-state.svelte"
import Icon from "./Icon.svelte"

interface Props {
  agentName?: string
  sessionTitle?: string
}

let { agentName = "", sessionTitle = "" }: Props = $props()

function openHistory() {
  goto("/sessions")
}
</script>

<div class="floating-header">
  <!-- Settings icon — left in RTL (visually on the left side of screen) -->
  <a href="/settings" class="icon-btn header-icon-btn" aria-label="הגדרות">
    <Icon name="settings" size={18} />
  </a>

  <!-- Centered titles -->
  <div class="titles">
    {#if agentName}
      <div class="agent-line">{agentName}</div>
    {/if}
    {#if sessionTitle}
      <div class="session-line">{sessionTitle}</div>
    {/if}
  </div>

  <!-- History icon — right in RTL -->
  <button class="icon-btn header-icon-btn" onclick={openHistory} aria-label="היסטוריה">
    <Icon name="book-open" size={18} />
  </button>
</div>

<style>
  .floating-header {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    padding: var(--s-3) var(--s-4);
    display: flex;
    justify-content: space-between;
    align-items: center;
    z-index: 10;
    pointer-events: none;
  }

  .floating-header > * {
    pointer-events: auto;
  }

  /* Centered titles — absolutely positioned */
  .titles {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    max-width: 60%;
    pointer-events: none;
  }

  .agent-line {
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--fg);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .session-line {
    font-size: 0.78rem;
    color: var(--fg-dim);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  /* Icon buttons — darker background for contrast over chat */
  .header-icon-btn {
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-radius: 8px;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-dim);
    text-decoration: none;
    transition: color 0.15s, background 0.15s;
  }

  .header-icon-btn:hover {
    color: var(--fg);
    background: rgba(0, 0, 0, 0.6);
    text-decoration: none;
  }
</style>
