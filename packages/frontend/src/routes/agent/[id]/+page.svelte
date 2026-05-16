<script lang="ts">
import type { AgentPublic } from "@drive-coding/core"
import { renderMarkdown } from "@drive-coding/core"
import { onDestroy, tick, untrack } from "svelte"
import { page } from "$app/state"
import { getAgent } from "$lib/api/agents"
import { cues } from "$lib/audio/cues"
import { createAgentSessionStore } from "$lib/stores/agent-session.svelte"
import { createCarMode } from "$lib/stores/car-mode.svelte"
import { deriveMicState, MIC_ICONS, MIC_STATUS_TEXT } from "$lib/stores/mic-state.svelte"
import { deriveScrollState } from "$lib/stores/smart-scroll"
import { createVoiceSessionStore } from "$lib/stores/voice-session.svelte"

let agentId = $derived(page.params.id ?? "")
let agent = $state<AgentPublic | null>(null)
let loadError = $state<string | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

let session = $state(createAgentSessionStore(agentId))
let voice = $state(createVoiceSessionStore(session))
let carMode = $state(createCarMode())

// Fix: when agentId changes — close old WS and create fresh stores (Bug 4).
// untrack() prevents writing to session/voice from being registered as reactive
// dependencies of this effect, which would cause an infinite update loop:
// agentId changes → effect runs → writes session → session changes → effect re-runs → ...
$effect(() => {
  const id = agentId // reactive: track agentId changes
  untrack(() => {
    // non-reactive block: disconnect + replace stores without re-triggering this effect
    session.disconnect()
    session = createAgentSessionStore(id)
    voice = createVoiceSessionStore(session)
  })
})

// ── URL params ──────────────────────────────────────────────────────────────
let isCarMode = $derived(
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("car") === "1"
    : false,
)

// ── Smart scroll state ──────────────────────────────────────────────────────
let chatEl = $state<HTMLElement | null>(null)
let autoScrollEnabled = $state(true)
let showJumpDown = $state(false)
let lastUserInteractionAt = $state(0)

// ── isCancelling state — set on explicit cancel, cleared when voice returns to idle ──
let isCancelling = $state(false)

// Auto-clear isCancelling when voice pipeline reaches idle (Bug 1 / Bug 3)
$effect(() => {
  if (voice.voiceState === "idle") {
    isCancelling = false
  }
})

// ── Derived mic state from voice pipeline ────────────────────────────────────
let micState = $derived(
  deriveMicState({
    isRecording: voice.isRecording,
    isThinking: session.status === "thinking" || voice.voiceState === "transcribing",
    isAudioPlaying: voice.voiceState === "speaking",
    isCancelling,
  }),
)

// ── Wake Lock ────────────────────────────────────────────────────────────────
let wakeLock = $state<WakeLockSentinel | null>(null)

async function acquireWakeLock() {
  if (!("wakeLock" in navigator)) return
  try {
    wakeLock = await navigator.wakeLock.request("screen")
  } catch {
    // HTTPS required — silent fail in dev
  }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {})
  wakeLock = null
}

// ── Prev mic state for audio cue transitions ─────────────────────────────────
let prevMicState = $state<typeof micState>("idle")

$effect(() => {
  const current = micState
  if (current === prevMicState) return

  // Audio cues on state transitions
  if (current === "recording") {
    cues.recordingStart()
    acquireWakeLock()
  } else if (prevMicState === "recording" && current === "processing") {
    cues.recordingStop()
    cues.thinking()
  } else if (current === "speaking") {
    cues.speaking()
  } else if (current === "idle") {
    releaseWakeLock()
  }

  // Update car mode media session playback state
  carMode.setPlaybackState(current !== "recording")

  prevMicState = current
})

// ── Auto-scroll effect ────────────────────────────────────────────────────────
$effect(() => {
  const _len = session.messages.length
  const _lastText = session.messages[session.messages.length - 1]?.text.length ?? 0
  void _len
  void _lastText
  if (!autoScrollEnabled) return
  tick().then(() => {
    if (chatEl) {
      chatEl.scrollTop = chatEl.scrollHeight
    }
  })
})

// ── User interaction tracking (smart scroll) ─────────────────────────────────
function markUserInteraction() {
  lastUserInteractionAt = Date.now()
}

function onChatScroll() {
  if (!chatEl) return
  const result = deriveScrollState({
    scrollHeight: chatEl.scrollHeight,
    scrollTop: chatEl.scrollTop,
    clientHeight: chatEl.clientHeight,
    lastUserInteractionAt,
    nowMs: Date.now(),
    autoScrollEnabled,
    showJumpDown,
  })
  autoScrollEnabled = result.autoScrollEnabled
  showJumpDown = result.showJumpDown
}

function jumpToBottom() {
  autoScrollEnabled = true
  showJumpDown = false
  tick().then(() => {
    if (chatEl) chatEl.scrollTop = chatEl.scrollHeight
  })
}

// ── Agent loading + polling ──────────────────────────────────────────────────
async function loadAgent(): Promise<void> {
  loadError = null
  try {
    const { agent: fetched } = await getAgent(agentId)
    agent = fetched
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
  releaseWakeLock()
})

// ── Main mic button click ────────────────────────────────────────────────────
async function onMicClick() {
  if (micState === "idle" || micState === "processing") {
    await voice.startRecording()
  } else if (micState === "recording") {
    await voice.stopRecording()
  } else if (micState === "speaking") {
    isCancelling = true
    voice.cancel()
    session.cancel()
  } else if (micState === "cancelling") {
    // already cancelling — no-op
  }
}

// ── Stop button (speaking only) ──────────────────────────────────────────────
function onStop() {
  isCancelling = true
  voice.cancel()
  session.cancel()
}

// ── Replay last — wired to AudioQueue.hasLastPlayed ──────────────────────────
let hasPlayedAudio = $derived(voice.canReplayLast)

// ── Car mode enable ────────────────────────────────────────────────────────────
function enableCarMode() {
  carMode.enable({
    startRecording: () => voice.startRecording(),
    stopRecording: () => voice.stopRecording(),
    isRecording: () => voice.isRecording,
    onReplayLast: () => voice.replayLast(),
  })

  // Landscape lock — only in car mode, optional
  if ("orientation" in screen && screen.orientation && "lock" in screen.orientation) {
    ;(screen.orientation as unknown as { lock: (o: string) => Promise<void> })
      .lock("landscape")
      .catch(() => {})
  }
}

// ── Error audio cue ──────────────────────────────────────────────────────────
$effect(() => {
  if (session.error) cues.error()
})

// ── Text input (keep for accessibility) ─────────────────────────────────────
let inputText = $state("")

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

// ── Tool icon helper ──────────────────────────────────────────────────────────
function toolIcon(kind: string | undefined): string {
  switch (kind) {
    case "read":
      return "📖"
    case "edit":
      return "✏️"
    case "delete":
      return "🗑"
    case "move":
      return "↪"
    case "search":
      return "🔍"
    case "execute":
      return "⚡"
    case "think":
      return "💭"
    case "fetch":
      return "🌐"
    case "switch_mode":
      return "↻"
    default:
      return "🔧"
  }
}

// ── Tools bubble expand state ─────────────────────────────────────────────────
let expandedToolIds = $state(new Set<string>())
function toggleTool(id: string) {
  const next = new Set(expandedToolIds)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedToolIds = next
}
</script>

<!-- No-pinch-zoom viewport (§9.6 "No pinch-zoom") -->
<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
</svelte:head>

<div class="page-wrap">
  <!-- ── Header ──────────────────────────────────────────────────────────── -->
  <header>
    <a href="/" class="back-link" aria-label="חזרה לדשבורד">←</a>
    {#if agent}
      <h1 class="title">{agent.cliKind}</h1>
      <div class="meta" dir="ltr">{agent.cwd}</div>
    {/if}
    <div class="header-end">
      <span class="badge badge-{session.status}">{session.status}</span>
      <a href="/settings" class="settings-link" title="הגדרות" aria-label="הגדרות">⚙</a>
    </div>
  </header>

  <!-- ── Chat area ────────────────────────────────────────────────────────── -->
  {#if loadError}
    <div class="error-banner" role="alert">{loadError}</div>
  {:else if agent}
    {#if agent.status === "starting"}
      <div class="notice">הסוכן מאותחל... ממתין ל-bridge.</div>
    {:else if agent.status === "crashed"}
      <div class="error-banner">
        הסוכן קרס.
        {#if agent.crashReason}<span class="crash-reason">{agent.crashReason}</span>{/if}
        נסה שוב מהדשבורד.
      </div>
    {:else}
      <div
        id="chat-wrap"
        class="chat-wrap"
      >
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <ul
          class="chat"
          aria-label="שיחה"
          aria-live="polite"
          bind:this={chatEl}
          onscroll={onChatScroll}
          onwheel={markUserInteraction}
          ontouchstart={markUserInteraction}
          ontouchmove={markUserInteraction}
          onmousedown={markUserInteraction}
          onkeydown={markUserInteraction}
          role="log"
        >
          {#each session.messages as msg (msg.id)}
            <li class="msg msg-{msg.kind}">
              {#if msg.kind === "tool_call"}
                <!-- Tool call bubble — collapsible with arrow -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="tools-bubble"
                  class:expanded={msg.toolCallId ? expandedToolIds.has(msg.toolCallId) : false}
                  onclick={() => msg.toolCallId && toggleTool(msg.toolCallId)}
                >
                  <div class="tools-header">
                    <div class="tools-summary">
                      <span class="tool-item tool-item-{msg.toolStatus ?? 'pending'}">
                        <span class="status-dot"></span>
                        <span dir="auto">{toolIcon(msg.toolKind)} {msg.text}</span>
                      </span>
                    </div>
                    {#if msg.toolStatus}
                      <span class="tool-status-badge tool-status-{msg.toolStatus}">{msg.toolStatus}</span>
                    {/if}
                    <span class="tools-arrow">▸</span>
                  </div>
                  {#if msg.toolCallId && expandedToolIds.has(msg.toolCallId)}
                    <div class="tools-details">
                      {#if msg.toolLocations && msg.toolLocations.length > 0}
                        <div class="tool-locations" dir="ltr">
                          {#each msg.toolLocations as loc}
                            <code>{loc}</code>
                          {/each}
                        </div>
                      {/if}
                      {#if msg.toolContent}
                        <pre dir="ltr" class="tool-content">{msg.toolContent}</pre>
                      {/if}
                    </div>
                  {/if}
                </div>
              {:else if msg.kind === "thought"}
                <div class="bubble bubble-thought" dir="auto">
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  {@html renderMarkdown(msg.text)}
                </div>
              {:else if msg.kind === "assistant"}
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                <div class="bubble bubble-agent" dir="auto">{@html renderMarkdown(msg.text)}</div>
              {:else}
                <!-- user -->
                <div class="bubble bubble-user" dir="auto">{msg.text}</div>
              {/if}
            </li>
          {/each}

          <!-- STT preview while transcribing -->
          {#if voice.sttText}
            <li class="msg msg-user">
              <div class="bubble bubble-user stt-preview" dir="auto">🎙 {voice.sttText}</div>
            </li>
          {/if}
        </ul>

        <!-- Jump-down button -->
        <button
          class="jump-down"
          class:visible={showJumpDown}
          onclick={jumpToBottom}
          aria-label="גלול למטה"
        >↓</button>
      </div>

      <!-- Error display -->
      {#if session.error}
        <div class="error-banner" role="alert">{session.error}</div>
      {/if}
      {#if voice.voiceError}
        <div class="error-banner" role="alert">{voice.voiceError}</div>
      {/if}
    {/if}
  {:else}
    <div class="loading">טוען...</div>
  {/if}

  <!-- ── Footer / Controls ──────────────────────────────────────────────── -->
  <footer>
    <!-- Status text below button -->
    <div
      id="status"
      class="status"
      class:recording={micState === "recording"}
      class:processing={micState === "processing"}
      class:speaking={micState === "speaking"}
      class:cancelling={micState === "cancelling"}
    >
      {MIC_STATUS_TEXT[micState]}
    </div>

    <!-- Control row: replay-last | mic button | stop -->
    <div class="controls">
      <!-- Replay last (56px) -->
      <button
        class="side-btn"
        disabled={!hasPlayedAudio}
        title="השמע את ההודעה האחרונה"
        aria-label="השמע אחרון"
        onclick={() => voice.replayLast()}
      >🔊</button>

      <!-- BIG mic button (110px) -->
      <button
        id="mic-btn"
        class="mic-btn"
        data-state={micState}
        disabled={session.status !== "connected" && session.status !== "thinking"}
        onclick={onMicClick}
        aria-label={
          micState === "recording" ? "עצור הקלטה"
          : micState === "speaking" ? "עצור הקראה"
          : micState === "processing" ? "ממתין..."
          : "התחל הקלטה"
        }
      >
        {MIC_ICONS[micState]}
      </button>

      <!-- Stop (56px) — visible only when speaking -->
      <button
        class="side-btn stop-btn"
        class:hidden={micState !== "speaking" && micState !== "cancelling"}
        onclick={onStop}
        title="עצור הקראה"
        aria-label="עצור הקראה"
      >⏹</button>

      <!-- Spacer when stop hidden (keeps button centered) -->
      {#if micState !== "speaking" && micState !== "cancelling"}
        <div class="side-btn-spacer" aria-hidden="true"></div>
      {/if}
    </div>

    <!-- Car mode enable button (only in car mode and not yet active) -->
    {#if isCarMode && !carMode.isActive}
      <button class="car-enable-btn" onclick={enableCarMode}>
        🚗 הפעל בקרת רכב
      </button>
    {:else if isCarMode && carMode.isActive}
      <div class="car-active-badge">🚗 בקרת רכב פעילה</div>
    {/if}

    <!-- Text input (accessibility fallback — collapsed in car mode) -->
    {#if !isCarMode}
      <form class="text-form" onsubmit={(e) => { e.preventDefault(); send() }}>
        <textarea
          bind:value={inputText}
          onkeydown={onKeydown}
          placeholder="הקלד הודעה..."
          rows="2"
          disabled={session.status !== "connected"}
          aria-label="הודעה"
        ></textarea>
        <div class="form-actions">
          <button
            type="submit"
            class="send-btn"
            disabled={!inputText.trim() || session.status !== "connected"}
          >שלח</button>
          {#if session.status === "thinking" || voice.voiceState === "transcribing"}
            <button type="button" class="cancel-btn" onclick={session.cancel}>בטל</button>
          {/if}
        </div>
      </form>
    {/if}
  </footer>
</div>

<style>
  /* ── Page wrapper ──────────────────────────────────────────────────────── */
  .page-wrap {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    overflow: hidden;
  }

  /* ── Header ────────────────────────────────────────────────────────────── */
  header {
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .back-link {
    color: var(--fg-dim);
    text-decoration: none;
    font-size: 20px;
    line-height: 1;
    flex-shrink: 0;
    padding: 4px 6px;
  }
  .back-link:hover { color: var(--fg); }

  .title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--fg-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .meta {
    font-size: 11px;
    color: var(--muted);
    font-family: ui-monospace, "SF Mono", Consolas, monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 35%;
  }

  .header-end {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .settings-link {
    color: var(--fg-dim);
    text-decoration: none;
    font-size: 18px;
    line-height: 1;
  }
  .settings-link:hover { color: var(--fg); }

  /* ── Badges ─────────────────────────────────────────────────────────────── */
  .badge {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    font-family: ui-monospace, monospace;
  }
  .badge-connected    { background: rgba(79, 255, 138, 0.15); color: var(--speaking); }
  .badge-connecting   { background: rgba(79, 140, 255, 0.15); color: var(--accent); }
  .badge-thinking     { background: rgba(255, 170, 51, 0.15); color: var(--thinking); }
  .badge-disconnected { background: rgba(106, 106, 106, 0.15); color: var(--muted); }

  /* ── Notices / Errors ────────────────────────────────────────────────────── */
  .notice {
    color: var(--accent);
    background: rgba(79, 140, 255, 0.1);
    border: 1px solid rgba(79, 140, 255, 0.2);
    padding: 10px 16px;
    margin: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
  }

  .error-banner {
    color: var(--recording);
    background: rgba(255, 79, 79, 0.08);
    border: 1px solid rgba(255, 79, 79, 0.25);
    padding: 10px 16px;
    margin: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
  }

  .crash-reason {
    display: block;
    font-family: ui-monospace, monospace;
    font-size: 0.85em;
    margin: 4px 0;
    padding: 3px 6px;
    background: rgba(255, 79, 79, 0.08);
    border-radius: 4px;
    word-break: break-word;
  }

  .loading {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-size: 14px;
  }

  /* ── Chat wrap ───────────────────────────────────────────────────────────── */
  .chat-wrap {
    flex: 1;
    position: relative;
    min-height: 0;
    display: flex;
  }

  .chat {
    flex: 1;
    list-style: none;
    padding: 12px 16px;
    margin: 0;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    gap: 12px;
    scroll-behavior: smooth;
  }

  .chat:empty::before {
    content: "התחילו לדבר — תוכן השיחה יופיע כאן.";
    color: var(--muted);
    font-size: 13px;
    align-self: center;
    margin: auto;
  }

  /* ── Jump-down button ────────────────────────────────────────────────────── */
  .jump-down {
    position: absolute;
    bottom: 14px;
    inset-inline-end: 14px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    color: var(--fg);
    border-radius: 50%;
    width: 40px;
    height: 40px;
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    opacity: 0;
    pointer-events: none;
    transition: opacity 200ms, background 150ms, border-color 150ms;
    z-index: 5;
  }

  .jump-down.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .jump-down:hover {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  /* ── Messages ────────────────────────────────────────────────────────────── */
  .msg {
    display: flex;
    max-width: 85%;
  }

  .msg-user    { align-self: flex-start; }
  .msg-assistant { align-self: flex-end; }
  .msg-thought { align-self: flex-end; opacity: 0.85; }
  .msg-tool_call { align-self: stretch; max-width: 100%; }

  /* ── Bubble base ─────────────────────────────────────────────────────────── */
  .bubble {
    padding: 10px 14px;
    border-radius: 14px;
    font-size: 14px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .bubble:empty::after {
    content: "…";
    color: var(--muted);
  }

  /* user bubble — RTL: left side */
  .bubble-user {
    background: var(--bubble-user);
    border-bottom-right-radius: 4px;
  }

  /* agent bubble — RTL: right side */
  .bubble-agent {
    background: var(--bubble-agent);
    border-bottom-left-radius: 4px;
    white-space: normal; /* markdown handles newlines */
  }

  /* thought bubble */
  .bubble-thought {
    background: transparent;
    border: 1px dashed var(--border);
    color: var(--fg-dim);
    font-style: italic;
    font-size: 12.5px;
    white-space: normal;
  }

  .bubble-thought::before {
    content: "💭 ";
    opacity: 0.6;
  }

  /* STT preview */
  .stt-preview {
    font-style: italic;
    opacity: 0.75;
  }

  /* ── Markdown inside bubbles ─────────────────────────────────────────────── */
  :global(.bubble-agent p)           { margin: 0 0 0.5em; }
  :global(.bubble-agent p:last-child) { margin-bottom: 0; }
  :global(.bubble-agent h1), :global(.bubble-agent h2),
  :global(.bubble-agent h3), :global(.bubble-agent h4) {
    margin: 0.5em 0 0.3em;
    font-weight: 600;
  }
  :global(.bubble-agent h1) { font-size: 1.2em; }
  :global(.bubble-agent h2) { font-size: 1.1em; }
  :global(.bubble-agent h3), :global(.bubble-agent h4) { font-size: 1em; }
  :global(.bubble-agent ul), :global(.bubble-agent ol) {
    margin: 0.3em 0;
    padding-inline-start: 1.5em;
  }
  :global(.bubble-agent li) { margin: 0.15em 0; }
  :global(.bubble-agent code) {
    background: rgba(255, 255, 255, 0.07);
    padding: 1px 5px;
    border-radius: 4px;
    font-family: ui-monospace, "SF Mono", Consolas, monospace;
    font-size: 0.92em;
  }
  :global(.bubble-agent pre) {
    background: rgba(0, 0, 0, 0.3);
    padding: 8px 10px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 0.4em 0;
    direction: ltr;
    text-align: left;
  }
  :global(.bubble-agent pre code) { background: none; padding: 0; }
  :global(.bubble-agent a) { color: var(--accent-hi); }
  :global(.bubble-agent blockquote) {
    border-inline-start: 3px solid var(--border);
    padding-inline-start: 10px;
    margin: 0.4em 0;
    color: var(--fg-dim);
  }
  :global(.bubble-agent table) { border-collapse: collapse; margin: 0.4em 0; }
  :global(.bubble-agent th), :global(.bubble-agent td) {
    border: 1px solid var(--border);
    padding: 4px 8px;
  }

  :global(.bubble-thought p)           { margin: 0 0 0.4em; }
  :global(.bubble-thought p:last-child) { margin-bottom: 0; }

  /* ── Tools bubble ────────────────────────────────────────────────────────── */
  .msg-tool_call { justify-content: stretch; }

  .tools-bubble {
    flex: 1;
    background: var(--tool-bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 6px 12px;
    cursor: pointer;
    user-select: none;
  }

  .tools-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 12px;
    color: var(--fg-dim);
    font-family: ui-monospace, "SF Mono", Consolas, monospace;
  }

  .tools-summary {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    flex: 1;
    min-width: 0;
  }

  .tools-arrow {
    font-size: 10px;
    opacity: 0.5;
    transition: transform 0.15s;
    flex-shrink: 0;
  }

  .tools-bubble.expanded .tools-arrow {
    transform: rotate(90deg);
  }

  .tools-details {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .tool-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--fg-dim);
  }

  .tool-item-in_progress { color: var(--thinking); }
  .tool-item-failed      { color: var(--recording); }
  .tool-item-completed   { color: var(--speaking); }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--muted);
    flex-shrink: 0;
  }

  .tool-item-in_progress .status-dot {
    background: var(--thinking);
    animation: pulse-dot 1s infinite;
  }
  .tool-item-completed .status-dot { background: var(--speaking); }
  .tool-item-failed    .status-dot { background: var(--recording); }

  .tool-status-badge {
    font-size: 10px;
    opacity: 0.6;
    font-family: ui-monospace, monospace;
  }
  .tool-status-completed { color: var(--speaking); }
  .tool-status-failed    { color: var(--recording); }
  .tool-status-in_progress { color: var(--thinking); }

  .tool-locations {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }

  .tool-locations code {
    font-size: 11px;
    background: rgba(255, 255, 255, 0.05);
    padding: 1px 5px;
    border-radius: 3px;
    font-family: ui-monospace, monospace;
    color: var(--fg-dim);
  }

  .tool-content {
    margin: 4px 0 0;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.25);
    border-radius: 4px;
    font-size: 11px;
    max-height: 180px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--fg-dim);
  }

  /* ── Footer ──────────────────────────────────────────────────────────────── */
  footer {
    flex-shrink: 0;
    padding: 14px 16px 20px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    background: var(--bg-elev);
  }

  /* ── Status text ─────────────────────────────────────────────────────────── */
  .status {
    font-size: 12px;
    color: var(--muted);
    min-height: 16px;
    text-align: center;
    transition: color 0.2s;
  }

  .status.recording  { color: var(--recording); }
  .status.processing { color: var(--thinking); }
  .status.speaking   { color: var(--speaking); }
  .status.cancelling { color: #ff9933; }

  /* ── Controls row ────────────────────────────────────────────────────────── */
  .controls {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  /* ── BIG mic button (110px, §9.6 ≥80px) ─────────────────────────────────── */
  .mic-btn {
    width: 110px;
    height: 110px;
    border-radius: 50%;
    border: none;
    font-size: 44px;
    cursor: pointer;
    background: var(--accent);
    color: white;
    box-shadow: 0 4px 18px rgba(79, 140, 255, 0.4);
    transition: transform 0.15s, box-shadow 0.2s, background 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    touch-action: manipulation;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }

  .mic-btn:hover:not(:disabled) { transform: scale(1.04); }
  .mic-btn:active:not(:disabled) { transform: scale(0.97); }

  .mic-btn:disabled {
    background: #2a2f3a;
    cursor: not-allowed;
    opacity: 0.6;
  }

  .mic-btn[data-state="recording"] {
    background: var(--recording);
    box-shadow: 0 4px 18px rgba(255, 79, 79, 0.4);
    animation: pulse 1.2s infinite;
  }

  .mic-btn[data-state="processing"] {
    background: #8855ff;
    box-shadow: 0 4px 18px rgba(136, 85, 255, 0.4);
    animation: rotate-slow 2s linear infinite;
  }

  .mic-btn[data-state="speaking"] {
    background: var(--speaking);
    color: #0f1115;
    box-shadow: 0 4px 18px rgba(79, 255, 138, 0.45);
  }

  .mic-btn[data-state="cancelling"] {
    background: #ff9933;
    box-shadow: 0 4px 18px rgba(255, 153, 51, 0.4);
    animation: flash-fast 0.3s infinite;
  }

  /* ── Side buttons (56px, §9.6 "touch targets ≥80px"  — 56 is acceptable for secondary controls) */
  .side-btn {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--fg-dim);
    border-radius: 50%;
    width: 56px;
    height: 56px;
    font-size: 22px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    touch-action: manipulation;
    flex-shrink: 0;
  }

  .side-btn:hover:not(:disabled) {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .side-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .stop-btn:hover:not(:disabled) {
    background: var(--recording);
    border-color: var(--recording);
    color: white;
  }

  .stop-btn.hidden {
    visibility: hidden;
    pointer-events: none;
  }

  .side-btn-spacer {
    width: 56px;
    height: 56px;
    flex-shrink: 0;
  }

  /* ── Car mode ────────────────────────────────────────────────────────────── */
  .car-enable-btn {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 14px;
    padding: 16px 24px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 6px 24px rgba(79, 140, 255, 0.4);
    touch-action: manipulation;
  }

  .car-enable-btn:hover { background: var(--accent-hi); }

  .car-active-badge {
    font-size: 12px;
    color: var(--accent);
    font-weight: 600;
  }

  /* ── Text input form (non-car mode) ──────────────────────────────────────── */
  .text-form {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    max-width: 600px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }

  textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--fg);
    font-family: inherit;
    font-size: 14px;
    resize: none;
    direction: rtl;
  }

  textarea:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(79, 140, 255, 0.2);
  }

  textarea:disabled { opacity: 0.5; cursor: not-allowed; }

  .form-actions {
    display: flex;
    gap: 8px;
  }

  .send-btn {
    padding: 8px 18px;
    border: none;
    border-radius: 6px;
    background: var(--accent);
    color: white;
    font-weight: 600;
    cursor: pointer;
    font-size: 14px;
  }

  .send-btn:disabled { background: var(--muted); cursor: not-allowed; }
  .send-btn:not(:disabled):hover { background: var(--accent-hi); }

  .cancel-btn {
    padding: 8px 18px;
    border: none;
    border-radius: 6px;
    background: var(--recording);
    color: white;
    font-weight: 600;
    cursor: pointer;
    font-size: 14px;
  }

  .cancel-btn:hover { opacity: 0.85; }
</style>
