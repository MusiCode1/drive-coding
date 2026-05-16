<script lang="ts">
import type { CliKind } from "@drive-coding/core"
import { goto } from "$app/navigation"
import { createAgent } from "$lib/api/agents"

let cliKind = $state<CliKind>("opencode")
let cwd = $state("")
let modelOverride = $state("")
let submitting = $state(false)
let error = $state<string | null>(null)

async function submit(e: SubmitEvent): Promise<void> {
  e.preventDefault()
  error = null

  const trimmedCwd = cwd.trim()
  if (!trimmedCwd) {
    error = "נדרשת תיקיית עבודה"
    return
  }

  submitting = true
  try {
    const { agent } = await createAgent({
      cliKind,
      cwd: trimmedCwd,
      modelOverride: modelOverride.trim() || null,
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
      <input
        type="text"
        bind:value={cwd}
        placeholder="/home/user/projects/foo"
        dir="ltr"
        required
      />
    </label>

    <label>
      <span>Model override (אופציונלי)</span>
      <input
        type="text"
        bind:value={modelOverride}
        placeholder="claude-sonnet-4 / gpt-5 / ..."
        dir="ltr"
      />
    </label>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <button type="submit" disabled={submitting} class="primary">
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
