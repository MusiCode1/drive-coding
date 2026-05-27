<script lang="ts">
import { tick } from "svelte"
import { goto } from "$app/navigation"
import { getSession } from "$lib/context"

const session = getSession()

let promptText = $state("")
let chatEl = $state<HTMLElement | null>(null)

// Redirect to / if no active connection (refresh / direct nav)
$effect(() => {
  if (session.status === "idle") {
    goto("/")
  }
})

// Auto-scroll on new content
$effect(() => {
  const _len = session.bubbles.length
  const _lastText = session.bubbles[session.bubbles.length - 1]?.text.length ?? 0
  void _len
  void _lastText
  tick().then(() => {
    if (chatEl) chatEl.scrollTop = chatEl.scrollHeight
  })
})

function onSubmit(e: SubmitEvent) {
  e.preventDefault()
  const text = promptText.trim()
  if (!text) return
  session.sendPrompt(text)
  promptText = ""
}

function disconnect() {
  session.detach()
  goto("/")
}
</script>

<div class="chat-page">
  <header>
    <div class="meta">
      <span class="status status-{session.status}">{session.status}</span>
      <span class="cwd" dir="ltr">{session.cwd ?? ""}</span>
    </div>
    <button class="disconnect" onclick={disconnect}>נתק</button>
  </header>

  <div class="chat" bind:this={chatEl}>
    {#each session.bubbles as bubble (bubble.id)}
      <div class="bubble bubble-{bubble.kind}">
        <div class="kind-label">
          {bubble.kind === "user" ? "אני" : bubble.kind === "thought" ? "מחשבה" : "סוכן"}
        </div>
        <div class="text">{bubble.text}</div>
      </div>
    {/each}
    {#if session.bubbles.length === 0}
      <div class="empty">התחל לכתוב למטה…</div>
    {/if}
  </div>

  {#if session.error}
    <div class="error" role="alert">{session.error}</div>
  {/if}

  <form onsubmit={onSubmit}>
    <textarea
      bind:value={promptText}
      placeholder="כתוב prompt…"
      rows="2"
      disabled={session.status !== "connected" && session.status !== "thinking"}
      onkeydown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault()
          onSubmit(e as unknown as SubmitEvent)
        }
      }}
    ></textarea>
    <button
      type="submit"
      disabled={
        !promptText.trim() ||
        (session.status !== "connected" && session.status !== "thinking")
      }
    >
      שלח
    </button>
  </form>
</div>

<style>
  .chat-page {
    display: flex;
    flex-direction: column;
    height: 100dvh;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  .status {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    font-family: ui-monospace, monospace;
  }
  .status-idle,
  .status-error {
    background: rgba(255, 79, 79, 0.15);
    color: var(--recording);
  }
  .status-connecting,
  .status-thinking {
    background: rgba(255, 170, 51, 0.15);
    color: #ffaa33;
  }
  .status-connected {
    background: rgba(79, 255, 138, 0.15);
    color: var(--speaking);
  }

  .cwd {
    font-size: 0.8rem;
    color: var(--fg-dim);
    font-family: ui-monospace, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .disconnect {
    background: transparent;
    color: var(--fg-dim);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 0.8rem;
    flex-shrink: 0;
  }

  .disconnect:hover {
    color: var(--recording);
    border-color: var(--recording);
  }

  .chat {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .bubble {
    max-width: 80%;
    padding: 0.7rem 0.9rem;
    border-radius: 12px;
    line-height: 1.4;
  }

  .bubble-user {
    align-self: flex-end;
    background: var(--accent);
    color: white;
  }

  .bubble-message {
    align-self: flex-start;
    background: var(--bg-elev);
    border: 1px solid var(--border);
  }

  .bubble-thought {
    align-self: flex-start;
    background: transparent;
    border: 1px dashed var(--border);
    color: var(--fg-dim);
    font-style: italic;
  }

  .kind-label {
    font-size: 0.7rem;
    opacity: 0.7;
    margin-bottom: 4px;
    font-weight: 600;
  }

  .text {
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .empty {
    color: var(--muted);
    text-align: center;
    margin: auto;
    font-size: 0.9rem;
  }

  .error {
    margin: 0 1rem;
    padding: 0.75rem;
    background: rgba(255, 79, 79, 0.1);
    border: 1px solid rgba(255, 79, 79, 0.3);
    border-radius: 8px;
    color: var(--recording);
    font-size: 0.85rem;
  }

  form {
    display: flex;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  textarea {
    flex: 1;
    padding: 0.6rem 0.8rem;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--fg);
    resize: none;
  }

  textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  textarea:disabled {
    opacity: 0.5;
  }

  form button {
    padding: 0 1.2rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 8px;
    font-weight: 600;
  }

  form button:hover:not(:disabled) {
    background: var(--accent-hi);
  }

  form button:disabled {
    background: var(--muted);
    cursor: not-allowed;
    opacity: 0.7;
  }
</style>
