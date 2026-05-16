<script lang="ts">
import type { AgentPublic } from "@drive-coding/core"
import { onDestroy } from "svelte"
import { page } from "$app/state"
import { getAgent } from "$lib/api/agents"
import { createAgentSessionStore } from "$lib/stores/agent-session.svelte"

let agentId = $derived(page.params.id ?? "")
let agent = $state<AgentPublic | null>(null)
let loadError = $state<string | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

let session = $derived(createAgentSessionStore(agentId))
let inputText = $state("")

async function loadAgent(): Promise<void> {
  loadError = null
  try {
    const { agent: fetched } = await getAgent(agentId)
    agent = fetched
    // Auto-connect if agent is ready and WS not open yet
    if (fetched.status === "ready" && session.status === "disconnected") {
      session.connect()
    }
    schedulePoll()
  } catch (e) {
    loadError = e instanceof Error ? e.message : "טעינה נכשלה"
  }
}

function schedulePoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (agent?.status === "starting") {
    pollTimer = setInterval(async () => {
      try {
        const { agent: fresh } = await getAgent(agentId)
        agent = fresh
        if (fresh.status !== "starting") {
          if (pollTimer !== null) clearInterval(pollTimer)
          pollTimer = null
          if (fresh.status === "ready") {
            session.connect()
          }
        }
      } catch {
        // keep polling
      }
    }, 2000)
  }
}

$effect(() => {
  if (agentId) loadAgent()
})

onDestroy(() => {
  if (pollTimer) clearInterval(pollTimer)
  session.disconnect()
})

function send(): void {
  if (!inputText.trim()) return
  session.sendPrompt(inputText.trim())
  inputText = ""
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}
</script>

<main>
  <header>
    <a href="/" class="back">← Dashboard</a>
    {#if agent}
      <span class="title">{agent.cliKind} · <code>{agent.cwd}</code></span>
      <span class="badge badge-{session.status}">{session.status}</span>
    {/if}
  </header>

  {#if loadError}
    <p class="error">{loadError}</p>
  {:else if agent}
    {#if agent.status === "starting"}
      <p class="notice">הסוכן מאותחל... ממתין ל-bridge.</p>
    {:else if agent.status === "crashed"}
      <p class="error">הסוכן קרס. נסה שוב מהדשבורד.</p>
    {:else}
      <!-- Chat area -->
      <ul class="chat" aria-label="שיחה">
        {#each session.messages as msg (msg.id)}
          <li class="msg msg-{msg.kind}">
            <span class="bubble" dir="auto">{msg.text}</span>
          </li>
        {/each}
        {#if session.status === "thinking"}
          <li class="msg msg-assistant">
            <span class="bubble thinking" aria-live="polite">חושב...</span>
          </li>
        {/if}
      </ul>

      {#if session.error}
        <p class="error" role="alert">{session.error}</p>
      {/if}

      <form onsubmit={(e) => { e.preventDefault(); send() }}>
        <textarea
          bind:value={inputText}
          onkeydown={onKeydown}
          placeholder="הקלד הודעה..."
          rows="2"
          disabled={session.status !== "connected"}
          aria-label="הודעה"
        ></textarea>
        <div class="actions">
          <button
            type="submit"
            disabled={!inputText.trim() || session.status !== "connected"}
          >שלח</button>
          {#if session.status === "thinking"}
            <button type="button" onclick={session.cancel} class="btn-cancel">
              בטל
            </button>
          {/if}
        </div>
      </form>
    {/if}
  {:else}
    <p>טוען...</p>
  {/if}
</main>

<style>
  main {
    max-width: 720px;
    margin: 1rem auto;
    padding: 0 1rem;
    display: flex;
    flex-direction: column;
    height: 95vh;
    font-family: system-ui, sans-serif;
  }

  header {
    display: flex;
    gap: 1rem;
    align-items: center;
    padding-bottom: 1rem;
    border-bottom: 1px solid #e5e7eb;
    flex-shrink: 0;
  }

  .back { color: #6b7280; text-decoration: none; }
  .back:hover { color: #111827; }
  .title { font-weight: 600; }

  .badge {
    padding: 0.2rem 0.6rem;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 500;
  }
  .badge-connected    { background: #d1fae5; color: #065f46; }
  .badge-connecting   { background: #dbeafe; color: #1e40af; }
  .badge-thinking     { background: #fef3c7; color: #92400e; }
  .badge-disconnected { background: #f3f4f6; color: #4b5563; }

  .notice {
    color: #1e40af;
    background: #dbeafe;
    padding: 1rem;
    border-radius: 8px;
  }

  .error {
    color: #b91c1c;
    background: #fef2f2;
    padding: 0.75rem;
    border-radius: 6px;
    margin: 0.5rem 0;
  }

  .chat {
    list-style: none;
    padding: 0.5rem 0;
    margin: 0;
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .msg { display: flex; }

  /* User messages on the right (in RTL this is on the start side visually) */
  .msg-user      { justify-content: flex-end; }
  .msg-assistant { justify-content: flex-start; }
  .msg-thought   { justify-content: flex-start; opacity: 0.7; }
  .msg-tool_call { justify-content: center; }

  .bubble {
    padding: 0.6rem 1rem;
    border-radius: 12px;
    max-width: 70%;
    white-space: pre-wrap;
    word-break: break-word;
    background: #f3f4f6;
    line-height: 1.5;
  }

  .msg-user .bubble {
    background: #2563eb;
    color: white;
  }

  .msg-thought .bubble {
    background: transparent;
    border: 1px dashed #d1d5db;
    font-style: italic;
    color: #6b7280;
  }

  .msg-tool_call .bubble {
    background: #fef3c7;
    font-size: 0.85rem;
    border-radius: 6px;
    color: #78350f;
  }

  .bubble.thinking {
    color: #9ca3af;
    font-style: italic;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 1rem;
    border-top: 1px solid #e5e7eb;
    flex-shrink: 0;
  }

  textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 0.6rem;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-family: inherit;
    font-size: 1rem;
    resize: none;
  }

  textarea:focus {
    outline: none;
    border-color: #2563eb;
    box-shadow: 0 0 0 2px #bfdbfe;
  }

  textarea:disabled { background: #f9fafb; color: #9ca3af; }

  .actions { display: flex; gap: 0.5rem; }

  button {
    padding: 0.6rem 1.2rem;
    border: none;
    border-radius: 6px;
    background: #2563eb;
    color: white;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.95rem;
  }

  button:disabled { background: #9ca3af; cursor: not-allowed; }
  button:not(:disabled):hover { background: #1d4ed8; }

  .btn-cancel {
    background: #ef4444;
  }
  .btn-cancel:hover { background: #dc2626; }
</style>
