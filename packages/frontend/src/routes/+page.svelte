<script lang="ts">
import type { AgentPublic } from "@drive-coding/core"
import { onDestroy, onMount } from "svelte"
import { deleteAgent, listAgents } from "$lib/api/agents"

let agents = $state<AgentPublic[]>([])
let loading = $state(true)
let error = $state<string | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

async function load(): Promise<void> {
  loading = true
  error = null
  try {
    const { agents: list } = await listAgents()
    agents = [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    schedulePoll()
  } catch (e) {
    error = e instanceof Error ? e.message : "טעינה נכשלה"
  } finally {
    loading = false
  }
}

function schedulePoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  const hasStarting = agents.some((a) => a.status === "starting")
  if (hasStarting) {
    pollTimer = setInterval(async () => {
      try {
        const { agents: fresh } = await listAgents()
        agents = [...fresh].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        if (!agents.some((a) => a.status === "starting") && pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
        }
      } catch {
        // silent — keep polling
      }
    }, 2000)
  }
}

async function remove(id: string): Promise<void> {
  if (!confirm("למחוק את הסוכן?")) return
  try {
    await deleteAgent(id)
    await load()
  } catch (e) {
    error = e instanceof Error ? e.message : "מחיקה נכשלה"
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "ready":
      return "מוכן"
    case "busy":
      return "עסוק"
    case "starting":
      return "מאותחל..."
    case "crashed":
      return "קרס"
    case "closed":
      return "סגור"
    default:
      return status
  }
}

onMount(load)
onDestroy(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<div class="dashboard">
  <header class="dash-header">
    <h1 class="dash-title">drive-coding</h1>
    <a href="/agent/new" class="new-btn" aria-label="סוכן חדש">+ סוכן חדש</a>
  </header>

  {#if loading}
    <div class="loading-state">טוען סוכנים...</div>
  {:else if error}
    <div class="error-banner" role="alert">שגיאה: {error}</div>
  {:else if agents.length === 0}
    <!-- Empty state (§9.6 DoD #32) -->
    <div class="empty-state">
      <div class="empty-icon">🎙</div>
      <div class="empty-title">אין סוכנים פעילים</div>
      <div class="empty-desc">לחצי "+ סוכן חדש" כדי להתחיל.</div>
      <a href="/agent/new" class="new-btn new-btn-large">+ סוכן חדש</a>
    </div>
  {:else}
    <ul class="cards" role="list">
      {#each agents as agent (agent.id)}
        <li class="card">
          <a href={`/agent/${agent.id}`} class="card-link" aria-label={`פתח סוכן ${agent.cliKind}`}>
            <div class="card-top">
              <span class="card-title">{agent.cliKind}</span>
              <span class="card-status status-{agent.status}">{statusLabel(agent.status)}</span>
            </div>
            <div class="card-cwd" dir="ltr">{agent.cwd}</div>
            {#if agent.status === "crashed" && agent.crashReason}
              <div class="card-crash" dir="auto">{agent.crashReason}</div>
            {/if}
          </a>
          <button
            class="delete-btn"
            onclick={() => remove(agent.id)}
            aria-label={`מחק סוכן ${agent.cliKind}`}
            title="מחק"
          >×</button>
        </li>
      {/each}
    </ul>
  {/if}

  <!-- Settings link -->
  <a href="/settings" class="settings-link" title="הגדרות">⚙</a>
</div>

<style>
  /* Dashboard uses the global dark tokens from +layout.svelte */
  .dashboard {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    overflow: hidden;
    position: relative;
  }

  /* ── Header ─────────────────────────────────────────────────────────────── */
  .dash-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .dash-title {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    color: var(--fg);
  }

  /* ── New button ──────────────────────────────────────────────────────────── */
  .new-btn {
    background: var(--accent);
    color: white;
    padding: 10px 20px;
    border-radius: 10px;
    text-decoration: none;
    font-weight: 600;
    font-size: 14px;
    transition: background 0.15s;
    touch-action: manipulation;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
  }

  .new-btn:hover { background: var(--accent-hi); }

  .new-btn-large {
    padding: 16px 32px;
    font-size: 16px;
    border-radius: 14px;
    min-height: 56px;
    margin-top: 16px;
  }

  /* ── Loading / empty / error states ──────────────────────────────────────── */
  .loading-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-size: 14px;
  }

  .error-banner {
    color: var(--recording);
    background: rgba(255, 79, 79, 0.08);
    border: 1px solid rgba(255, 79, 79, 0.2);
    padding: 12px 20px;
    margin: 12px 20px;
    border-radius: 10px;
    font-size: 13px;
  }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 40px 20px;
  }

  .empty-icon {
    font-size: 56px;
    margin-bottom: 8px;
  }

  .empty-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--fg);
  }

  .empty-desc {
    font-size: 14px;
    color: var(--muted);
  }

  /* ── Cards grid (DoD §9.6: ≥100px height, big touch targets) ─────────────── */
  .cards {
    flex: 1;
    list-style: none;
    padding: 16px 20px;
    margin: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .card {
    position: relative;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 14px;
    min-height: 100px;     /* DoD #31: ≥100px */
    transition: border-color 0.15s, box-shadow 0.15s;
    display: flex;
  }

  .card:hover {
    border-color: var(--accent);
    box-shadow: 0 4px 18px rgba(79, 140, 255, 0.1);
  }

  .card-link {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
    text-decoration: none;
    color: inherit;
    padding: 16px 20px;
    padding-inline-end: 60px; /* room for delete button */
  }

  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .card-title {
    font-size: 17px;
    font-weight: 600;
    color: var(--fg);
  }

  .card-cwd {
    font-size: 12px;
    color: var(--muted);
    font-family: ui-monospace, "SF Mono", Consolas, monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .card-crash {
    font-size: 11px;
    color: var(--recording);
    font-family: ui-monospace, monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Status badges ─────────────────────────────────────────────────────── */
  .card-status {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    font-family: ui-monospace, monospace;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .status-ready    { background: rgba(79, 255, 138, 0.15); color: var(--speaking); }
  .status-busy     { background: rgba(255, 170, 51, 0.15); color: var(--thinking); }
  .status-starting { background: rgba(79, 140, 255, 0.15); color: var(--accent); }
  .status-crashed  { background: rgba(255, 79, 79, 0.15); color: var(--recording); }
  .status-closed   { background: rgba(106, 106, 106, 0.15); color: var(--muted); }

  /* ── Delete button ─────────────────────────────────────────────────────── */
  .delete-btn {
    position: absolute;
    top: 12px;
    inset-inline-start: 12px;
    background: transparent;
    border: none;
    font-size: 22px;
    color: var(--muted);
    cursor: pointer;
    padding: 4px 8px;
    line-height: 1;
    border-radius: 6px;
    transition: color 0.15s, background 0.15s;
    touch-action: manipulation;
  }

  .delete-btn:hover {
    color: var(--recording);
    background: rgba(255, 79, 79, 0.1);
  }

  /* ── Settings link (fixed bottom) ─────────────────────────────────────── */
  .settings-link {
    position: fixed;
    bottom: 20px;
    inset-inline-end: 20px;
    color: var(--fg-dim);
    text-decoration: none;
    font-size: 22px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 50%;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    touch-action: manipulation;
  }

  .settings-link:hover {
    color: var(--fg);
    border-color: var(--accent);
    background: var(--accent);
    color: white;
  }
</style>
