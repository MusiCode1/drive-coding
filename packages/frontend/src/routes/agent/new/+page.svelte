<script lang="ts">
import type { CliKind } from "@drive-coding/core"
import { onMount } from "svelte"
import { goto } from "$app/navigation"
import { createAgent } from "$lib/api/agents"
import { createLogger } from "$lib/log"

const log = createLogger("fe.route.agent")

let cliKind = $state<CliKind>("opencode")
let cwd = $state("")
let customCwd = $state("")
let modelOverride = $state("")
let customModel = $state("")
let submitting = $state(false)
let error = $state<string | null>(null)

let models = $state<Record<string, string[]>>({})
let projects = $state<string[]>([])
let loadingOptions = $state(true)

onMount(async () => {
  try {
    const res = await fetch("/api/options")
    if (res.ok) {
      const data = (await res.json()) as {
        models: Record<string, string[]>
        projects: string[]
      }
      models = data.models
      projects = data.projects
      // Sensible defaults
      const firstModel = data.models[cliKind]?.[0]
      if (firstModel) modelOverride = firstModel
      const firstProject = data.projects[0]
      if (firstProject) cwd = firstProject
    }
  } catch (err) {
    log.warn({ err }, "/api/options fetch failed")
  } finally {
    loadingOptions = false
  }
})

// When CLI changes, reset model to first option for that CLI
$effect(() => {
  const cliModels = models[cliKind]
  const first = cliModels?.[0]
  if (first && cliModels && !cliModels.includes(modelOverride) && modelOverride !== "__custom__") {
    modelOverride = first
  }
})

async function submit(e: SubmitEvent): Promise<void> {
  e.preventDefault()
  error = null

  const finalCwd = cwd === "__custom__" ? customCwd.trim() : cwd.trim()
  if (!finalCwd) {
    error = "נדרשת תיקיית עבודה"
    return
  }

  const finalModel = modelOverride === "__custom__" ? customModel.trim() : modelOverride.trim()

  submitting = true
  try {
    const { agent } = await createAgent({
      cliKind,
      cwd: finalCwd,
      modelOverride: finalModel || null,
    })
    await goto(`/agent/${agent.id}`)
  } catch (err) {
    error = err instanceof Error ? err.message : "יצירה נכשלה"
  } finally {
    submitting = false
  }
}
</script>

<main>
  <header>
    <a href="/" class="back">← חזרה</a>
    <h1>סוכן חדש</h1>
  </header>

  <form onsubmit={submit}>
    <label>
      <span>CLI</span>
      <select bind:value={cliKind} required>
        <option value="opencode">opencode</option>
        <option value="claude">Claude Code</option>
        <option value="gemini">Gemini CLI</option>
        <option value="codex">Codex</option>
      </select>
    </label>

    <label>
      <span>תיקיית עבודה (cwd)</span>
      <select bind:value={cwd} required dir="ltr" disabled={loadingOptions}>
        {#if loadingOptions}
          <option value="">טוען...</option>
        {:else}
          {#each projects as p}
            <option value={p}>{p}</option>
          {/each}
          <option value="__custom__">— נתיב אחר —</option>
        {/if}
      </select>
    </label>

    {#if cwd === "__custom__"}
      <label>
        <span>נתיב מותאם</span>
        <input
          type="text"
          bind:value={customCwd}
          placeholder="/home/user/projects/foo"
          dir="ltr"
        />
      </label>
    {/if}

    <label>
      <span>מודל</span>
      <select bind:value={modelOverride} dir="ltr" disabled={loadingOptions}>
        {#if loadingOptions}
          <option value="">טוען...</option>
        {:else}
          <option value="">ברירת מחדל של ה-CLI</option>
          {#each models[cliKind] ?? [] as m}
            <option value={m}>{m}</option>
          {/each}
          <option value="__custom__">— מודל אחר —</option>
        {/if}
      </select>
    </label>

    {#if modelOverride === "__custom__"}
      <label>
        <span>מודל מותאם</span>
        <input
          type="text"
          bind:value={customModel}
          placeholder="provider/model-name"
          dir="ltr"
        />
      </label>
    {/if}

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <button type="submit" disabled={submitting || loadingOptions} class="primary">
      {submitting ? "יוצר..." : "צור"}
    </button>
  </form>
</main>

<style>
  main { max-width: 480px; margin: 2rem auto; padding: 0 1rem; font-family: system-ui, sans-serif; }
  header { display: flex; gap: 1rem; align-items: center; margin-bottom: 1.5rem; }
  h1 { margin: 0; }
  .back { color: #6b7280; text-decoration: none; }
  .back:hover { color: #111827; }
  form { display: flex; flex-direction: column; gap: 1rem; }
  label { display: flex; flex-direction: column; gap: 0.3rem; }
  label > span { font-weight: 500; font-size: 0.9rem; }
  input, select { padding: 0.6rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 1rem; font-family: inherit; }
  input:focus, select:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1); }
  .primary { background: #2563eb; color: white; padding: 0.7rem; border: none; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer; margin-top: 0.5rem; }
  .primary:hover:not(:disabled) { background: #1d4ed8; }
  .primary:disabled { background: #9ca3af; cursor: wait; }
  .error { color: #b91c1c; background: #fef2f2; padding: 0.75rem; border-radius: 6px; margin: 0; font-size: 0.9rem; white-space: pre-wrap; }
</style>
