<script lang="ts">
/**
 * /sessions/[cwdHash] — sessions of a specific project.
 */
import { onMount } from "svelte"
import { goto } from "$app/navigation"
import { page } from "$app/state"
import SessionCard from "$lib/components/SessionCard.svelte"
import { createProjectsStore } from "$lib/stores/projects-store.svelte"

const store = createProjectsStore()
let cwdHash = $derived(page.params.cwdHash ?? "")
let projectSessions = $state<Awaited<ReturnType<typeof store.loadProjectSessions>>>([])
let loading = $state(true)

onMount(async () => {
  loading = true
  projectSessions = await store.loadProjectSessions(cwdHash)
  loading = false
})

function openSession(sessionId: string) {
  // cwdHash is a SHA-256 base64url from the URL — URL-safe, no encoding needed.
  goto(`/session/${cwdHash}/${encodeURIComponent(sessionId)}?cli=opencode`)
}
</script>

<div class="sessions-page">
  <header class="page-header">
    <a href="/sessions" class="back-link">← היסטוריה</a>
    <h1 class="page-title" dir="ltr">{cwdHash}</h1>
  </header>

  <div class="tab-content">
    {#if loading}
      <div class="state-msg">טוען...</div>
    {:else if projectSessions.length === 0}
      <div class="state-msg">אין שיחות לפרויקט זה.</div>
    {:else}
      <div class="card-grid">
        {#each projectSessions as session (session.sessionId)}
          <SessionCard {session} onclick={() => openSession(session.sessionId)} />
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
    flex-shrink: 0;
  }

  .back-link:hover {
    color: var(--fg);
    text-decoration: none;
  }

  .page-title {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--fg-muted);
    font-family: ui-monospace, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--s-4);
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--s-3);
  }

  .state-msg {
    color: var(--fg-muted);
    text-align: center;
    padding: var(--s-8) var(--s-4);
    font-size: 0.9rem;
  }
</style>
