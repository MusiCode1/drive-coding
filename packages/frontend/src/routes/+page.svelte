<script lang="ts">
import type { AgentPublic } from "@drive-coding/core"
import { onMount } from "svelte"
import { deleteAgent, listAgents } from "$lib/api/agents"

let agents = $state<AgentPublic[]>([])
let loading = $state(true)
let error = $state<string | null>(null)

async function load(): Promise<void> {
  loading = true
  error = null
  try {
    const { agents: list } = await listAgents()
    agents = [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  } catch (e) {
    error = e instanceof Error ? e.message : "טעינה נכשלה"
  } finally {
    loading = false
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

onMount(load)
</script>

<main>
  <header>
    <h1>drive-coding</h1>
    <a href="/agent/new" class="primary">+ סוכן חדש</a>
  </header>

  {#if loading}
    <p>טוען...</p>
  {:else if error}
    <p class="error">שגיאה: {error}</p>
  {:else if agents.length === 0}
    <p class="empty">אין סוכנים. לחץ "+ סוכן חדש" כדי להתחיל.</p>
  {:else}
    <ul class="cards">
      {#each agents as agent (agent.id)}
        <li class="card">
          <a href={`/agent/${agent.id}`}>
            <div class="card-title">{agent.cliKind}</div>
            <div class="card-cwd"><code>{agent.cwd}</code></div>
            <div class="card-status status-{agent.status}">{agent.status}</div>
          </a>
          <button class="delete" onclick={() => remove(agent.id)} aria-label="מחק">×</button>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  main { max-width: 720px; margin: 2rem auto; padding: 0 1rem; font-family: system-ui, sans-serif; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
  h1 { margin: 0; }
  .primary { background: #2563eb; color: white; padding: 0.6rem 1.2rem; border-radius: 8px; text-decoration: none; font-weight: 600; }
  .primary:hover { background: #1d4ed8; }
  .empty { color: #666; text-align: center; padding: 3rem 0; }
  .error { color: #b91c1c; background: #fef2f2; padding: 0.75rem; border-radius: 6px; }
  .cards { list-style: none; padding: 0; display: grid; gap: 1rem; }
  .card { position: relative; background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.2rem; transition: box-shadow 0.15s; }
  .card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .card a { display: block; text-decoration: none; color: inherit; }
  .card-title { font-size: 1.2rem; font-weight: 600; margin-bottom: 0.25rem; }
  .card-cwd { color: #6b7280; font-size: 0.9rem; margin-bottom: 0.5rem; }
  .card-status { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.8rem; font-weight: 500; }
  .status-ready { background: #d1fae5; color: #065f46; }
  .status-busy { background: #fef3c7; color: #92400e; }
  .status-starting { background: #dbeafe; color: #1e40af; }
  .status-crashed { background: #fee2e2; color: #991b1b; }
  .status-closed { background: #f3f4f6; color: #4b5563; }
  .delete { position: absolute; top: 0.8rem; left: 0.8rem; background: transparent; border: none; font-size: 1.5rem; color: #9ca3af; cursor: pointer; padding: 0.2rem 0.5rem; line-height: 1; }
  .delete:hover { color: #dc2626; }
</style>
