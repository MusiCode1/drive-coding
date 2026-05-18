<script lang="ts">
/**
 * /sessions — history browser.
 *
 * Two tabs:
 *  - "כל השיחות" — all sessions flat, sorted by updatedAt DESC
 *  - "לפי פרויקט" — projects list → drill into project sessions
 */
import { onMount } from "svelte"
import { goto } from "$app/navigation"
import ProjectCard from "$lib/components/ProjectCard.svelte"
import SessionCard from "$lib/components/SessionCard.svelte"
import { createProjectsStore } from "$lib/stores/projects-store.svelte"

const store = createProjectsStore()

type Tab = "sessions" | "projects"
let activeTab = $state<Tab>("sessions")

onMount(async () => {
  await store.load()
  // Refresh on focus
  window.addEventListener("focus", () => store.load())
})

function openSession(cwdHash: string, sessionId: string) {
  // cwdHash is a SHA-256 base64url — URL-safe, no special chars, no encoding needed.
  // sessionId may contain letters/digits/underscores — also URL-safe.
  goto(`/session/${cwdHash}/${encodeURIComponent(sessionId)}?cli=opencode`)
}

function openProject(cwdHash: string) {
  goto(`/sessions/${encodeURIComponent(cwdHash)}`)
}
</script>

<div class="sessions-page">
  <!-- Header -->
  <header class="page-header">
    <a href="/" class="back-link">← דשבורד</a>
    <h1 class="page-title">היסטוריה</h1>
  </header>

  <!-- Tab switcher -->
  <div class="tab-bar">
    <button class="tab" class:active={activeTab === "sessions"} onclick={() => (activeTab = "sessions")}>
      כל השיחות
    </button>
    <button class="tab" class:active={activeTab === "projects"} onclick={() => (activeTab = "projects")}>
      לפי פרויקט
    </button>
  </div>

  <!-- Content -->
  <div class="tab-content">
    {#if store.loading}
      <div class="state-msg">טוען...</div>
    {:else if store.error}
      <div class="error-banner" role="alert">{store.error}</div>
    {:else if activeTab === "sessions"}
      {#if store.sessions.length === 0}
        <div class="state-msg">אין שיחות קודמות.</div>
      {:else}
        <div class="card-grid">
          {#each store.sessions.slice(0, 50) as session (session.sessionId)}
            <SessionCard
              {session}
              onclick={() => openSession(session.cwdHash, session.sessionId)}
            />
          {/each}
        </div>
      {/if}
    {:else}
      {#if store.projects.length === 0}
        <div class="state-msg">אין פרויקטים.</div>
      {:else}
        <div class="card-grid">
          {#each store.projects as project (project.cwdHash)}
            <ProjectCard {project} onclick={() => openProject(project.cwdHash)} />
          {/each}
        </div>
      {/if}
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

  .back-link:hover {
    color: var(--fg);
    text-decoration: none;
  }

  .page-title {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
  }

  .tab-bar {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .tab {
    padding: var(--s-3) var(--s-5);
    border: none;
    background: transparent;
    color: var(--fg-dim);
    font-size: 0.9rem;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
    font-family: inherit;
  }

  .tab:hover {
    color: var(--fg);
  }

  .tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
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

  .error-banner {
    color: var(--recording);
    background: rgba(255, 79, 79, 0.08);
    border: 1px solid rgba(255, 79, 79, 0.2);
    padding: var(--s-3) var(--s-4);
    border-radius: 8px;
    font-size: 0.9rem;
  }
</style>
