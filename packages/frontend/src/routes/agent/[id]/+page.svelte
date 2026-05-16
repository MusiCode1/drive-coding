<script lang="ts">
import type { AgentPublic } from "@drive-coding/core"
import { onDestroy } from "svelte"
import { page } from "$app/state"
import { getAgent } from "$lib/api/agents"

let agentId = $derived(page.params.id)
let agent = $state<AgentPublic | null>(null)
let error = $state<string | null>(null)
let loading = $state(true)
let pollTimer: ReturnType<typeof setInterval> | null = null

async function load(): Promise<void> {
  loading = true
  error = null
  try {
    const id = agentId ?? ""
    const { agent: fetched } = await getAgent(id)
    agent = fetched
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
  // Poll only while agent is starting
  if (agent?.status === "starting") {
    pollTimer = setInterval(async () => {
      try {
        const id = agentId ?? ""
        const { agent: fresh } = await getAgent(id)
        agent = fresh
        // Stop polling when no longer starting
        if (fresh.status !== "starting" && pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
        }
      } catch {
        // silent — keep polling
      }
    }, 2000)
  }
}

$effect(() => {
  if (agentId) load()
})

onDestroy(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<main>
  <header>
    <a href="/" class="back">← Dashboard</a>
  </header>

  {#if loading}
    <p>טוען...</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if agent}
    <h1>{agent.cliKind}</h1>
    <dl>
      <dt>cwd</dt><dd><code>{agent.cwd}</code></dd>
      <dt>status</dt><dd class="status-{agent.status}">{agent.status}</dd>
      <dt>נוצר</dt><dd>{new Date(agent.createdAt).toLocaleString("he-IL")}</dd>
      {#if agent.modelOverride}
        <dt>model</dt><dd>{agent.modelOverride}</dd>
      {/if}
    </dl>
    {#if agent.status === "starting"}
      <p class="starting-notice">הסוכן מאותחל... ממתין ל-bridge.</p>
    {:else}
      <p class="placeholder">
        ממשק קולי יתווסף ב-Slice 4. כרגע סוכן זה הוא רק entry ב-registry.
      </p>
    {/if}
  {/if}
</main>

<style>
  main { max-width: 720px; margin: 2rem auto; padding: 0 1rem; font-family: system-ui, sans-serif; }
  header { margin-bottom: 1rem; }
  .back { color: #6b7280; text-decoration: none; }
  .back:hover { color: #111827; }
  h1 { margin: 0 0 1.5rem; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 0.5rem 1rem; margin-bottom: 2rem; }
  dt { font-weight: 600; color: #6b7280; }
  dd { margin: 0; }
  code { background: #f3f4f6; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.9rem; }
  .placeholder { color: #9ca3af; font-style: italic; padding: 1rem; background: #f9fafb; border-radius: 8px; }
  .starting-notice { color: #1e40af; background: #dbeafe; padding: 1rem; border-radius: 8px; }
  .error { color: #b91c1c; background: #fef2f2; padding: 0.75rem; border-radius: 6px; }
  .status-ready { color: #065f46; font-weight: 600; }
  .status-busy { color: #92400e; font-weight: 600; }
  .status-starting { color: #1e40af; font-weight: 600; }
  .status-crashed { color: #991b1b; font-weight: 600; }
  .status-closed { color: #4b5563; font-weight: 600; }
</style>
