<script lang="ts">
/**
 * /session/[cwdHash]/[id] — load handler for session history.
 *
 * Flow:
 *   1. Resolve cwdHash → cwd (via /api/projects)
 *   2. POST /api/agents with { cwd, kind, existingSessionId }
 *   3. Redirect to /agent/[agentId]
 *
 * If backend returns an existing agent (dedup), same redirect happens.
 * Shows loading state while resolving, error state on failure.
 */
import { onMount } from "svelte"
import { goto } from "$app/navigation"
import { page } from "$app/state"
import { createAgent } from "$lib/api/agents"
import { listProjects } from "$lib/api/sessions"

let cwdHash = $derived(page.params.cwdHash ?? "")
let sessionId = $derived(page.params.id ?? "")
let cliKind = $derived(page.url.searchParams.get("cli") ?? "opencode")

let loadError = $state<string | null>(null)

onMount(async () => {
  loadError = null
  try {
    // 1. Resolve cwdHash → cwd
    const projects = await listProjects()
    const project = projects.find((p) => p.cwdHash === cwdHash)
    const cwd = project?.cwd ?? `/${cwdHash}` // fallback if not found

    // 2. Create/reuse agent with existingSessionId
    const { agent } = await createAgent({
      cwd,
      cliKind: cliKind as "opencode",
      existingSessionId: sessionId,
    } as Parameters<typeof createAgent>[0])

    // 3. Redirect
    goto(`/agent/${agent.id}`, { replaceState: true })
  } catch (e) {
    loadError = e instanceof Error ? e.message : "טעינת session נכשלה"
  }
})
</script>

<div class="load-page">
  {#if loadError}
    <div class="error-banner" role="alert">
      שגיאה: {loadError}
      <a href="/sessions" class="back-link">← חזרה להיסטוריה</a>
    </div>
  {:else}
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <div class="loading-text">טוען session...</div>
    </div>
  {/if}
</div>

<style>
  .load-page {
    display: flex;
    height: 100dvh;
    align-items: center;
    justify-content: center;
    padding: var(--s-4);
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-4);
    color: var(--fg-dim);
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .loading-text {
    font-size: 0.9rem;
    color: var(--fg-muted);
  }

  .error-banner {
    color: var(--recording);
    background: rgba(255, 79, 79, 0.08);
    border: 1px solid rgba(255, 79, 79, 0.2);
    padding: var(--s-4) var(--s-5);
    border-radius: 12px;
    font-size: 0.95rem;
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    max-width: 420px;
    text-align: center;
  }

  .back-link {
    color: var(--accent);
    text-decoration: none;
    font-size: 0.85rem;
  }

  .back-link:hover {
    text-decoration: underline;
  }
</style>
