<script lang="ts">
import type { CliKind } from "@drive-coding/core"
import { connectAgent } from "$lib/actions/connect-agent"
import { getSession, getSettings } from "$lib/context"

const settings = getSettings()
const session = getSession()

let cliKind = $state<CliKind>(settings.cliKind)
let cwd = $state(settings.lastCwd)

async function onSubmit(e: SubmitEvent) {
  e.preventDefault()
  if (!cwd.trim()) return
  await connectAgent({ cliKind, cwd: cwd.trim(), session, settings })
}
</script>

<main class="connect">
  <h1>drive-coding v2</h1>
  <p class="subtitle">חבר ל-CLI agent</p>

  <form onsubmit={onSubmit}>
    <label>
      <span>CLI</span>
      <select bind:value={cliKind} disabled={session.status === "connecting"}>
        <option value="opencode">opencode</option>
        <option value="claude">claude</option>
        <option value="gemini">gemini</option>
        <option value="codex">codex</option>
      </select>
    </label>

    <label>
      <span>תיקיית עבודה</span>
      <input
        type="text"
        bind:value={cwd}
        placeholder="/home/user/projects/X"
        dir="ltr"
        disabled={session.status === "connecting"}
      />
    </label>

    <button type="submit" disabled={!cwd.trim() || session.status === "connecting"}>
      {session.status === "connecting" ? "מתחבר…" : "חבר"}
    </button>
  </form>

  {#if session.error}
    <div class="error" role="alert">
      <strong>שגיאה:</strong>
      {session.error}
    </div>
  {/if}
</main>

<style>
  .connect {
    max-width: 420px;
    margin: 4rem auto;
    padding: 0 1rem;
  }

  h1 {
    margin: 0 0 0.25rem;
    font-size: 1.6rem;
    font-weight: 600;
  }

  .subtitle {
    margin: 0 0 2rem;
    color: var(--fg-dim);
    font-size: 0.95rem;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  label > span {
    font-size: 0.85rem;
    color: var(--fg-dim);
  }

  input,
  select {
    padding: 0.7rem 0.8rem;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--fg);
  }

  input:focus,
  select:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(79, 140, 255, 0.2);
  }

  button {
    margin-top: 0.5rem;
    padding: 0.8rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.95rem;
    transition: background 0.15s;
  }

  button:hover:not(:disabled) {
    background: var(--accent-hi);
  }

  button:disabled {
    background: var(--muted);
    cursor: not-allowed;
    opacity: 0.7;
  }

  .error {
    margin-top: 1.5rem;
    padding: 0.9rem 1rem;
    background: rgba(255, 79, 79, 0.1);
    border: 1px solid rgba(255, 79, 79, 0.3);
    border-radius: 8px;
    color: var(--recording);
    font-size: 0.9rem;
  }
</style>
