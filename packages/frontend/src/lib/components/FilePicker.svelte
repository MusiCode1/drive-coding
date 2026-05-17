<script lang="ts">
/**
 * FilePicker.svelte — Phase 11.
 *
 * Modal שמדפדף ב-backend filesystem ובוחר cwd.
 * Header: current path
 * List: directories only
 * Back button + select current path button.
 *
 * Backend: GET /api/fs/browse?path=
 */
import { onMount } from "svelte"
import { createFsBrowserStore } from "$lib/stores/fs-browser-store.svelte"
import Icon from "./Icon.svelte"

interface Props {
  initialPath?: string
  open?: boolean
  onSelect?: (path: string) => void
  onClose?: () => void
}

let { initialPath = "/home/user", open = false, onSelect, onClose }: Props = $props()

const browser = createFsBrowserStore(initialPath)

onMount(() => {
  if (open) {
    browser.browse(initialPath)
  }
})

$effect(() => {
  if (open) {
    browser.browse(browser.currentPath || initialPath)
  }
})

function selectCurrent() {
  onSelect?.(browser.currentPath)
  onClose?.()
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") onClose?.()
}
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- B9 fix: tabindex="-1" required for role="dialog" (a11y interactive_supports_focus) -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div class="modal-backdrop" onclick={onClose} onkeydown={handleKeydown} role="dialog" aria-modal="true" tabindex="-1">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-box" onclick={(e) => e.stopPropagation()}>
      <!-- Header -->
      <div class="modal-header">
        <button
          class="icon-btn"
          onclick={browser.back}
          disabled={!browser.canGoBack}
          aria-label="חזרה"
          title="חזרה"
        >
          <Icon name="arrow-right" size={18} />
        </button>
        <div class="current-path" dir="ltr">{browser.currentPath}</div>
        <button class="icon-btn" onclick={onClose} aria-label="סגור">
          <Icon name="x" size={18} />
        </button>
      </div>

      <!-- Entries list -->
      <div class="entries-list">
        {#if browser.loading}
          <div class="state-msg">טוען...</div>
        {:else if browser.error}
          <div class="error-banner">{browser.error}</div>
        {:else if browser.entries.length === 0}
          <div class="state-msg">תיקייה ריקה</div>
        {:else}
          {#each browser.entries as entry (entry.name)}
            <button class="entry-row" onclick={() => browser.enter(entry.name)}>
              <Icon name="folder" size={16} />
              <span class="entry-name" dir="ltr">{entry.name}</span>
              <Icon name="chevron-left" size={14} class="entry-chevron" />
            </button>
          {/each}
        {/if}
      </div>

      <!-- Footer: select current -->
      <div class="modal-footer">
        <button class="select-btn" onclick={selectCurrent}>
          בחר: <span dir="ltr">{browser.currentPath}</span>
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--s-4);
  }

  .modal-box {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 16px;
    width: 100%;
    max-width: 480px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  /* Header */
  .modal-header {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .current-path {
    flex: 1;
    font-family: ui-monospace, monospace;
    font-size: 0.82rem;
    color: var(--fg-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Entries */
  .entries-list {
    flex: 1;
    overflow-y: auto;
    padding: var(--s-2);
  }

  .entry-row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    width: 100%;
    padding: var(--s-3);
    border-radius: 8px;
    text-align: start;
    color: var(--fg);
    font-family: inherit;
    font-size: 0.9rem;
    border: none;
    background: transparent;
    cursor: pointer;
    transition: background 0.1s;
  }

  .entry-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .entry-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .state-msg {
    color: var(--fg-muted);
    text-align: center;
    padding: var(--s-6) var(--s-4);
    font-size: 0.9rem;
  }

  .error-banner {
    color: var(--recording);
    padding: var(--s-3) var(--s-4);
    font-size: 0.85rem;
  }

  /* Footer */
  .modal-footer {
    padding: var(--s-3) var(--s-4);
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  .select-btn {
    width: 100%;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 10px;
    padding: var(--s-3) var(--s-4);
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    transition: background 0.15s;
  }

  .select-btn:hover {
    background: var(--accent-hi);
  }

  .select-btn span {
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    font-weight: 400;
    opacity: 0.85;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
