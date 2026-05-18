<script lang="ts">
/**
 * /sessions — history browser.
 *
 * Shows all known projects from /api/projects.
 * Each project has a quick "המשך אחרון" button (uses lastSessionId if available)
 * and a "ראה סשנים" button that drills into /sessions/[cwdHash].
 *
 * Session listing per-project is FE-driven via ACP WS — see sessions-ws.ts.
 * The old "כל השיחות" tab (union via /api/sessions) has been removed because
 * that endpoint is gone. Use the per-project drill-down instead.
 */
import { onMount } from "svelte"
import { goto } from "$app/navigation"
import { createProjectsStore } from "$lib/stores/projects-store.svelte"

const store = createProjectsStore()

onMount(async () => {
  await store.load()
  window.addEventListener("focus", () => store.load())
})

function openProject(cwdHash: string) {
  goto(`/sessions/${encodeURIComponent(cwdHash)}`)
}

function continueLastSession(cwdHash: string, lastSessionId: string) {
  goto(`/session/${cwdHash}/${encodeURIComponent(lastSessionId)}?cli=opencode`)
}

function cwdLabel(cwd: string): string {
  return cwd.split("/").filter(Boolean).slice(-2).join("/")
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("he-IL", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })
  } catch {
    return iso
  }
}
</script>

<div class="sessions-page">
  <header class="page-header">
    <a href="/" class="back-link">← דשבורד</a>
    <h1 class="page-title">היסטוריה</h1>
  </header>

  <div class="content">
    {#if store.loading}
      <div class="state-msg">טוען...</div>
    {:else if store.error}
      <div class="error-banner" role="alert">{store.error}</div>
    {:else if store.projects.length === 0}
      <div class="state-msg">אין פרויקטים קודמים.</div>
    {:else}
      <div class="project-list">
        {#each store.projects as project (project.cwdHash)}
          <div class="project-row">
            <div class="project-info">
              <div class="project-name" dir="ltr">{cwdLabel(project.cwd)}</div>
              <div class="project-cwd" dir="ltr">{project.cwd}</div>
              <div class="project-meta">נצפה לאחרונה: {formatDate(project.lastSeen)}</div>
            </div>
            <div class="project-actions">
              {#if project.lastSessionId}
                <button
                  class="btn-primary"
                  onclick={() => continueLastSession(project.cwdHash, project.lastSessionId!)}
                >
                  המשך אחרון
                </button>
              {/if}
              <button
                class="btn-secondary"
                onclick={() => openProject(project.cwdHash)}
              >
                ראה סשנים
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .sessions-page {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    overflow: hidden;
  }

  .page-header {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    padding: var(--s-3) var(--s-4);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .back-link {
    color: var(--fg-dim);
    text-decoration: none;
    font-size: 0.9rem;
  }

  .back-link:hover { color: var(--fg); }

  .page-title {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: var(--s-4);
  }

  .project-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }

  .project-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-4);
    padding: var(--s-4);
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    transition: border-color 0.15s;
  }

  .project-row:hover { border-color: var(--accent); }

  .project-info {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    min-width: 0;
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

  .project-meta {
    font-size: 0.78rem;
    color: var(--fg-dim);
  }

  .project-actions {
    display: flex;
    gap: var(--s-2);
    flex-shrink: 0;
  }

  .btn-primary {
    padding: var(--s-2) var(--s-4);
    background: var(--accent);
    color: var(--bg);
    border: none;
    border-radius: 6px;
    font-size: 0.85rem;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
  }

  .btn-primary:hover { opacity: 0.85; }

  .btn-secondary {
    padding: var(--s-2) var(--s-4);
    background: transparent;
    color: var(--fg-dim);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.85rem;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    transition: border-color 0.15s, color 0.15s;
  }

  .btn-secondary:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .state-msg {
    color: var(--fg-muted);
    text-align: center;
    padding: var(--s-8) var(--s-4);
    font-size: 0.9rem;
  }

  .error-banner {
    color: var(--recording);
    background: rgba(255, 79, 79, 0.08);
    border: 1px solid rgba(255, 79, 79, 0.2);
    padding: var(--s-3) var(--s-4);
    border-radius: 8px;
    font-size: 0.9rem;
  }
</style>
