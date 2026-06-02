<script lang="ts">
import { CLI_KINDS, type CliKind } from "@drive-coding/core"
import { goto } from "$app/navigation"
import { onMount } from "svelte"
import { connectAgent } from "$lib/actions/connect-agent"
import { fetchServerOptions } from "$lib/adapters/options"
import { listSessionsForCwd, type SessionInfo } from "$lib/adapters/sessions"
import VoicePicker from "$lib/components/chat/VoicePicker.svelte"
import SessionPicker from "$lib/components/connect/SessionPicker.svelte"
import { getI18n, getSession, getSettings } from "$lib/context"

const settings = getSettings()
const session = getSession()
const i18n = getI18n()
const t = i18n.t

let cliKind = $state<CliKind>(settings.cliKind)
let cwd = $state(settings.lastCwd)

// Slice 24: אכלס cwd מה-homeDir של השרת אם אין ערך שמור ולא הוקלד
// init-timing: cwd הוא $state מקומי שמועתק מ-settings.lastCwd ב-init.
// fetch חוזר אחרי init → מעדכן cwd ישירות (לא מסתמך על re-init).
// עדכן רק אם cwd עדיין ריק (המשתמש לא הקליד בינתיים).
onMount(() => {
  fetchServerOptions()
    .then((opts) => {
      if (cwd === "" || cwd === settings.lastCwd) {
        // localStorage ריק והמשתמש לא הקליד — הצב homeDir
        if (!settings.lastCwd && cwd === "") {
          cwd = opts.homeDir
        }
      }
    })
    .catch(() => {
      // fetch נכשל → cwd נשאר ריק, המשתמש יקליד ידנית. לא לשבור את מסך ה-connect.
    })
})

// ─── state עבור תפריט בחירת סשן (session picker) ───
let sessions = $state<SessionInfo[]>([])
let sessionsLoading = $state(false)
let sessionsError = $state<string | null>(null)
let selectedSessionId = $state<string | null>(null)

async function loadSessions() {
  sessionsLoading = true
  sessionsError = null
  sessions = []
  selectedSessionId = null
  try {
    sessions = await listSessionsForCwd(cwd.trim(), cliKind)
  } catch (e) {
    sessionsError = e instanceof Error ? e.message : String(e)
  } finally {
    sessionsLoading = false
  }
}

async function onSubmit(e: SubmitEvent) {
  e.preventDefault()
  if (!cwd.trim()) return
  if (selectedSessionId !== null) {
    settings.setCliKind(cliKind)
    settings.setLastCwd(cwd.trim())
    await session.loadSession({ sessionId: selectedSessionId, cwd: cwd.trim(), cliKind })
    if (session.status === "connected") {
      await goto("/chat")
    }
  } else {
    await connectAgent({ cliKind, cwd: cwd.trim(), session, settings })
  }
}
</script>

<main class="connect">
  <h1>{t("connect.title")}</h1>
  <p class="subtitle">{t("connect.subtitle")}</p>

  <form onsubmit={onSubmit}>
    <label>
      <span>{t("connect.cli.label")}</span>
      <select bind:value={cliKind} disabled={session.status === "connecting"}>
        {#each CLI_KINDS as kind (kind)}
          <option value={kind}>{kind}</option>
        {/each}
      </select>
    </label>

    <label>
      <span>{t("connect.cwd.label")}</span>
      <input
        type="text"
        bind:value={cwd}
        placeholder={t("connect.cwd.placeholder")}
        dir="ltr"
        disabled={session.status === "connecting"}
      />
    </label>

    <SessionPicker
      {cwd}
      {cliKind}
      {sessions}
      loading={sessionsLoading}
      error={sessionsError}
      {selectedSessionId}
      onload={loadSessions}
      onselect={(id) => { selectedSessionId = id }}
    />

    <label>
      <span>{t("chat.voicePicker.label")}</span>
      <VoicePicker />
    </label>

    <button type="submit" disabled={!cwd.trim() || session.status === "connecting"}>
      {session.status === "connecting" ? t("connect.submitting") : t("connect.submit")}
    </button>
  </form>

  {#if session.error}
    <div class="error" role="alert">
      <strong>{t("connect.error.prefix")}</strong>
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
