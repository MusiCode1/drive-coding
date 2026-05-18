<script lang="ts">
/**
 * ProjectCard.svelte — card for a project in the history browser.
 */
import type { ProjectRecord } from "$lib/api/sessions"

interface Props {
  project: ProjectRecord
  onclick?: () => void
}

let { project, onclick }: Props = $props()

function cwdLabel(cwd: string): string {
  return cwd.split("/").filter(Boolean).slice(-2).join("/")
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" })
  } catch {
    return iso
  }
}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="project-card" {onclick} role="button" tabindex="0">
  <div class="project-name" dir="ltr">{cwdLabel(project.cwd)}</div>
  <div class="project-cwd" dir="ltr">{project.cwd}</div>
  <div class="project-count">נצפה לאחרונה: {formatDate(project.lastSeen)}</div>
</div>

<style>
  .project-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: var(--s-4);
    cursor: pointer;
    transition: border-color 0.15s, transform 0.15s;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-height: 100px;
  }

  .project-card:hover {
    border-color: var(--accent);
    transform: translateY(-1px);
  }

  .project-name {
    font-weight: 600;
    font-size: 1rem;
    color: var(--accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-cwd {
    font-size: 0.78rem;
    color: var(--fg-muted);
    font-family: ui-monospace, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-count {
    font-size: 0.8rem;
    color: var(--fg-dim);
    margin-top: auto;
  }
</style>
