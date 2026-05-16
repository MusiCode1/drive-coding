<script lang="ts">
import type { AgentPublic } from "@drive-coding/core"
import { renderMarkdown } from "@drive-coding/core"
import { onDestroy, tick } from "svelte"
import { page } from "$app/state"
import { getAgent } from "$lib/api/agents"
import { createAgentSessionStore } from "$lib/stores/agent-session.svelte"
import { createVoiceSessionStore } from "$lib/stores/voice-session.svelte"

let agentId = $derived(page.params.id ?? "")
let agent = $state<AgentPublic | null>(null)
let loadError = $state<string | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

let session = $derived(createAgentSessionStore(agentId))
// Voice store — delegates audio messages via session
let voice = $derived(createVoiceSessionStore(session))

let inputText = $state("")
let chatEl = $state<HTMLUListElement | null>(null)

// Auto-scroll to bottom when new messages arrive
$effect(() => {
  // Track messages length AND last message text length (for streaming updates)
  const _len = session.messages.length
  const _lastText = session.messages[session.messages.length - 1]?.text.length ?? 0
  void _len
  void _lastText
  tick().then(() => {
    if (chatEl) {
      chatEl.scrollTop = chatEl.scrollHeight
    }
  })
})

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

// Voice status labels
const voiceStateLabel: Record<string, string> = {
  idle: "לחץ והחזק לדבר",
  recording: "מקליט...",
  transcribing: "מתמלל...",
  thinking: "המודל חושב...",
  speaking: "מנגן...",
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
      <p class="error">
        הסוכן קרס.
        {#if agent.crashReason}
          <span class="crash-reason">{agent.crashReason}</span>
        {/if}
        נסה שוב מהדשבורד.
      </p>
    {:else}
      <!-- Chat area -->
      <ul class="chat" aria-label="שיחה" bind:this={chatEl}>
        {#each session.messages as msg (msg.id)}
          <li class="msg msg-{msg.kind}">
            {#if msg.kind === "tool_call"}
              <div class="tool-bubble tool-status-{msg.toolStatus ?? 'pending'}">
                <div class="tool-head">
                  <span class="tool-kind">{msg.toolKind ?? "tool"}</span>
                  <span class="tool-title" dir="auto">{msg.text}</span>
                  {#if msg.toolStatus}
                    <span class="tool-status-badge">{msg.toolStatus}</span>
                  {/if}
                </div>
                {#if msg.toolLocations && msg.toolLocations.length > 0}
                  <div class="tool-locations" dir="ltr">
                    {#each msg.toolLocations as loc}
                      <code>{loc}</code>
                    {/each}
                  </div>
                {/if}
                {#if msg.toolContent}
                  <details class="tool-content">
                    <summary>פלט ({msg.toolContent.length} תווים)</summary>
                    <pre dir="ltr">{msg.toolContent}</pre>
                  </details>
                {/if}
              </div>
            {:else if msg.kind === "assistant"}
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <span class="bubble bubble-md" dir="auto">{@html renderMarkdown(msg.text)}</span>
            {:else}
              <span class="bubble" dir="auto">{msg.text}</span>
            {/if}
          </li>
        {/each}
        {#if session.status === "thinking" || voice.voiceState === "thinking"}
          <li class="msg msg-assistant">
            <span class="bubble thinking" aria-live="polite">חושב...</span>
          </li>
        {/if}
        {#if voice.sttText}
          <li class="msg msg-user">
            <span class="bubble stt-preview" dir="auto" title="STT">🎙 {voice.sttText}</span>
          </li>
        {/if}
      </ul>

      {#if session.error}
        <p class="error" role="alert">{session.error}</p>
      {/if}

      {#if voice.voiceError}
        <p class="error" role="alert">{voice.voiceError}</p>
      {/if}

      <!-- Voice status indicator -->
      {#if voice.voiceState !== "idle"}
        <div class="voice-status" aria-live="polite">
          {voiceStateLabel[voice.voiceState] ?? voice.voiceState}
        </div>
      {/if}

      <!-- Push-to-talk button -->
      <div class="ptt-area">
        <button
          class="ptt-btn"
          class:recording={voice.isRecording}
          class:active={voice.voiceState !== "idle"}
          onpointerdown={async (e) => {
            e.preventDefault()
            await voice.startRecording()
          }}
          onpointerup={async () => {
            await voice.stopRecording()
          }}
          onpointerleave={async () => {
            if (voice.isRecording) await voice.stopRecording()
          }}
          disabled={session.status !== "connected"}
          aria-label="לחץ והחזק לדבר"
          title="Push-to-talk"
        >
          🎙
        </button>
        <span class="ptt-label">
          {voiceStateLabel[voice.voiceState] ?? "לחץ והחזק לדבר"}
        </span>
      </div>

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
          {#if session.status === "thinking" || voice.voiceState === "thinking"}
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

  .msg-tool_call { justify-content: stretch; }

  .tool-bubble {
    flex: 1;
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 8px;
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
    color: #78350f;
    max-width: 100%;
  }
  .tool-bubble.tool-status-completed {
    background: #f0fdf4;
    border-color: #bbf7d0;
    color: #14532d;
  }
  .tool-bubble.tool-status-failed {
    background: #fef2f2;
    border-color: #fecaca;
    color: #7f1d1d;
  }
  .tool-bubble.tool-status-in_progress {
    background: #eff6ff;
    border-color: #bfdbfe;
    color: #1e3a8a;
  }
  .tool-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .tool-kind {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    padding: 0.1rem 0.4rem;
    background: rgba(0, 0, 0, 0.07);
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .tool-title {
    flex: 1;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tool-status-badge {
    font-size: 0.7rem;
    opacity: 0.7;
  }
  .tool-locations {
    margin-top: 0.4rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .tool-locations code {
    font-size: 0.75rem;
    background: rgba(0, 0, 0, 0.05);
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
  }
  .tool-content {
    margin-top: 0.4rem;
  }
  .tool-content summary {
    cursor: pointer;
    font-size: 0.75rem;
    opacity: 0.8;
    user-select: none;
  }
  .tool-content pre {
    margin: 0.4rem 0 0;
    padding: 0.5rem;
    background: rgba(0, 0, 0, 0.06);
    border-radius: 4px;
    font-size: 0.75rem;
    max-height: 240px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .bubble.thinking {
    color: #9ca3af;
    font-style: italic;
  }

  .bubble.stt-preview {
    background: #ede9fe;
    color: #4c1d95;
    font-style: italic;
    border: 1px dashed #a78bfa;
  }

  /* ─── Push-to-talk ─── */
  .ptt-area {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 0;
  }

  .ptt-btn {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    border: 3px solid #2563eb;
    background: white;
    font-size: 1.5rem;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    user-select: none;
    touch-action: none;
  }

  .ptt-btn:not(:disabled):hover {
    background: #eff6ff;
    border-color: #1d4ed8;
  }

  .ptt-btn.recording {
    background: #ef4444;
    border-color: #b91c1c;
    animation: pulse 1s infinite;
  }

  .ptt-btn.active:not(.recording) {
    background: #fef3c7;
    border-color: #d97706;
  }

  .ptt-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  @keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
    50% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
  }

  .ptt-label {
    color: #4b5563;
    font-size: 0.9rem;
  }

  .voice-status {
    background: #fef3c7;
    color: #92400e;
    padding: 0.4rem 0.8rem;
    border-radius: 6px;
    font-size: 0.85rem;
    text-align: center;
    margin-bottom: 0.25rem;
  }

  /* ─── Form ─── */
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

  .crash-reason {
    display: block;
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
    margin: 0.4rem 0;
    padding: 0.3rem 0.5rem;
    background: rgba(185, 28, 28, 0.08);
    border-radius: 4px;
    word-break: break-word;
  }

  /* ─── Markdown rendered HTML inside assistant bubbles ─── */
  .bubble-md {
    white-space: normal; /* override pre-wrap — markdown handles newlines */
  }

  :global(.bubble-md p) {
    margin: 0 0 0.5em;
  }
  :global(.bubble-md p:last-child) {
    margin-bottom: 0;
  }
  :global(.bubble-md strong) {
    font-weight: 700;
  }
  :global(.bubble-md em) {
    font-style: italic;
  }
  :global(.bubble-md a) {
    color: #1d4ed8;
    text-decoration: underline;
    word-break: break-all;
  }
  :global(.bubble-md code) {
    font-family: ui-monospace, monospace;
    font-size: 0.85em;
    background: rgba(0, 0, 0, 0.08);
    padding: 0.1em 0.35em;
    border-radius: 3px;
  }
  :global(.bubble-md pre) {
    background: rgba(0, 0, 0, 0.06);
    border-radius: 6px;
    padding: 0.6rem 0.8rem;
    overflow-x: auto;
    margin: 0.5em 0;
    max-width: 100%;
  }
  :global(.bubble-md pre code) {
    background: transparent;
    padding: 0;
    font-size: 0.85rem;
    white-space: pre;
  }
  :global(.bubble-md ul),
  :global(.bubble-md ol) {
    margin: 0.25em 0 0.5em 1.4em;
    padding: 0;
  }
  :global(.bubble-md li) {
    margin-bottom: 0.2em;
  }
  :global(.bubble-md table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.5em 0;
    font-size: 0.9em;
  }
  :global(.bubble-md th),
  :global(.bubble-md td) {
    border: 1px solid #d1d5db;
    padding: 0.3rem 0.6rem;
    text-align: start;
  }
  :global(.bubble-md th) {
    background: rgba(0, 0, 0, 0.05);
    font-weight: 600;
  }
  :global(.bubble-md blockquote) {
    border-inline-start: 3px solid #d1d5db;
    margin: 0.5em 0;
    padding: 0.3em 0.8em;
    color: #6b7280;
  }
  :global(.bubble-md hr) {
    border: none;
    border-top: 1px solid #e5e7eb;
    margin: 0.75em 0;
  }
</style>
