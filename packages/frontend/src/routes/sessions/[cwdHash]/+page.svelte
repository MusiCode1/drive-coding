<script lang="ts">
/**
 * /sessions/[cwdHash] — sessions of a specific project.
 *
 * Flow:
 *   1. Resolve cwdHash → project via /api/projects.
 *   2. Show lastSessionId quick-continue immediately (0 network cost).
 *   3. Check localStorage cache — display stale sessions instantly if present.
 *   4. "הצג את כל הסשנים" button → on click: spawn temp agent, list, update cache.
 */
import { onMount } from "svelte"
import { goto } from "$app/navigation"
import { page } from "$app/state"
import type { CliKind } from "@drive-coding/core"
import SessionCard from "$lib/components/SessionCard.svelte"
import { listProjects } from "$lib/api/sessions"
import type { SessionInfo } from "$lib/api/sessions-ws"
import { listSessionsViaTempAgent } from "$lib/api/sessions-ws"
import { loadCachedSessions, saveCachedSessions } from "$lib/stores/sessions-cache"
import { notifications } from "$lib/stores/notifications-store.svelte"

let cwdHash = $derived(page.params.cwdHash ?? "")

let projectCwd = $state<string | null>(null)
let projectKind = $state<string>("opencode")
let lastSessionId = $state<string | null>(null)
let sessions = $state<SessionInfo[]>([])
let loading = $state(true)
let fetchingAll = $state(false)
let loadError = $state<string | null>(null)

onMount(async () => {
  loading = true
  loadError = null
  try {
    const projects = await listProjects()
    const project = projects.find((p) => p.cwdHash === cwdHash)
    if (!project) {
      loadError = "פרויקט לא נמצא — הנתיב אינו רשום במערכת"
      return
    }
    projectCwd = project.cwd
    projectKind = project.kind
    lastSessionId = project.lastSessionId ?? null

    // Show cached sessions immediately (stale-while-revalidate pattern)
    const cached = loadCachedSessions(project.cwd)
    if (cached && cached.length > 0) {
      sessions = cached
    }
  } catch (e) {
    loadError = e instanceof Error ? e.message : "טעינה נכשלה"
  } finally {
    loading = false
  }
})

function openSession(sessionId: string) {
  goto(`/session/${cwdHash}/${encodeURIComponent(sessionId)}?cli=opencode`)
}

async function loadAllSessions() {
  if (!projectCwd) return
  fetchingAll = true
  try {
    const result = await listSessionsViaTempAgent(projectCwd, projectKind as CliKind)
    sessions = result.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    saveCachedSessions(projectCwd, sessions)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    notifications.push(`שליפת הסשנים נכשלה: ${msg}`, "error")
  } finally {
    fetchingAll = false
  }
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
    {:else if loadError}
      <div class="error-banner" role="alert">{loadError}</div>
    {:else}
      <!-- Quick-continue: last session always shown first if known -->
      {#if lastSessionId && sessions.length === 0}
        <div class="quick-continue">
          <span class="quick-label">המשך שיחה אחרונה</span>
          <button class="btn-primary" onclick={() => openSession(lastSessionId!)}>
            המשך
          </button>
        </div>
      {/if}

      <!-- Full session list (from cache or after explicit fetch) -->
      {#if sessions.length > 0}
        <div class="card-grid">
          {#each sessions as session (session.sessionId)}
            <SessionCard
              {session}
              onclick={() => openSession(session.sessionId)}
            />
          {/each}
        </div>
      {/if}

      <!-- Load-all button: only when full list not yet available -->
      {#if sessions.length === 0 && !lastSessionId}
        <div class="state-msg">אין מידע על סשנים לפרויקט זה.</div>
      {/if}

      {#if sessions.length === 0 || sessions.length === 1}
        <div class="load-all-row">
          {#if fetchingAll}
            <div class="spinner-inline"></div>
            <span class="fetch-label">טוען רשימה מה-CLI...</span>
          {:else}
            <button
              class="btn-secondary"
              onclick={loadAllSessions}
              disabled={fetchingAll}
            >
              הצג את כל הסשנים
            </button>
          {/if}
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
    flex-shrink: 0;
  }

  .back-link:hover { color: var(--fg); }

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
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }

  .quick-continue {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-3) var(--s-4);
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
  }

  .quick-label {
    font-size: 0.9rem;
    color: var(--fg-dim);
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
  }

  .btn-primary:hover { opacity: 0.85; }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--s-3);
  }

  .load-all-row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding-top: var(--s-2);
  }

  .btn-secondary {
    padding: var(--s-2) var(--s-4);
    background: transparent;
    color: var(--fg-dim);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.85rem;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }

  .btn-secondary:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .btn-secondary:disabled { opacity: 0.5; cursor: default; }

  .spinner-inline {
    width: 16px;
    height: 16px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  .fetch-label {
    font-size: 0.85rem;
    color: var(--fg-muted);
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

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
