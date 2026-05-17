<script lang="ts">
/**
 * SessionCard.svelte — compact card for a session in the history browser.
 */

import type { SessionRecord } from "$lib/api/sessions"
import Icon from "./Icon.svelte"

interface Props {
  session: SessionRecord
  onclick?: () => void
}

let { session, onclick }: Props = $props()

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function cwdSnippet(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean)
  return "/" + parts.slice(-2).join("/")
}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="session-card" {onclick} role="button" tabindex="0">
  <div class="card-header">
    <span class="card-title" dir="auto">{session.title || "ללא כותרת"}</span>
    <span class="card-cli">{session.cliKind}</span>
  </div>
  <div class="card-cwd" dir="ltr">{cwdSnippet(session.cwd)}</div>
  <div class="card-date">
    <Icon name="clock" size={12} />
    {formatDate(session.updatedAt)}
  </div>
</div>

<style>
  .session-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: var(--s-4);
    cursor: pointer;
    transition: border-color 0.15s, transform 0.15s;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-height: 90px;
  }

  .session-card:hover {
    border-color: var(--accent);
    transform: translateY(-1px);
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
  }

  .card-title {
    font-weight: 500;
    font-size: 0.92rem;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-cli {
    font-size: 0.72rem;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0;
  }

  .card-cwd {
    font-size: 0.78rem;
    color: var(--fg-muted);
    font-family: ui-monospace, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-date {
    font-size: 0.75rem;
    color: var(--fg-dim);
    display: flex;
    align-items: center;
    gap: var(--s-1);
    margin-top: auto;
  }
</style>
