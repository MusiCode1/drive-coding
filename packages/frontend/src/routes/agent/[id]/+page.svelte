<script lang="ts">
import type { AgentPublic } from "@drive-coding/core"
import { onDestroy, tick, untrack } from "svelte"
import { goto } from "$app/navigation"
import { page } from "$app/state"
import { deleteAgent, getAgent } from "$lib/api/agents"
import { cues } from "$lib/audio/cues"
import BottomSheet from "$lib/components/BottomSheet.svelte"
import BubbleKind from "$lib/components/BubbleKind.svelte"
import FloatingHeader from "$lib/components/FloatingHeader.svelte"
import type { Bubble } from "$lib/stores/agent-session.svelte"
import { createAgentSessionStore } from "$lib/stores/agent-session.svelte"
import { createCarMode } from "$lib/stores/car-mode.svelte"
import { device } from "$lib/stores/device.svelte"
import { deriveMicState, MIC_ICONS, MIC_STATUS_TEXT } from "$lib/stores/mic-state.svelte"
import { sheetState } from "$lib/stores/sheet-state.svelte"
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
$effect(() => {
  const id = agentId
  untrack(() => {
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

// ── isCancelling state ──────────────────────────────────────────────────────
let isCancelling = $state(false)

$effect(() => {
  if (voice.voiceState === "idle") {
    isCancelling = false
  }
})

// ── Derived mic state ────────────────────────────────────────────────────────
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

  carMode.setPlaybackState(current !== "recording")
  prevMicState = current
})

// ── Auto-scroll effect ────────────────────────────────────────────────────────
$effect(() => {
  const _len = session.bubbles.length
  const _lastSegments = session.bubbles[session.bubbles.length - 1]?.segments.length ?? 0
  void _len
  void _lastSegments
  if (!autoScrollEnabled) return
  tick().then(() => {
    if (chatEl) chatEl.scrollTop = chatEl.scrollHeight
  })
})

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
          if (fresh.status === "ready") session.connect()
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

// ── Hidden file upload ────────────────────────────────────────────────────────
let fileInputEl = $state<HTMLInputElement | null>(null)

async function onFileUpload(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  input.value = ""
  await voice.sendAudioBlob(file, file.type || "audio/webm")
}

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

function onStop() {
  isCancelling = true
  voice.cancel()
  session.cancel()
}

let hasPlayedAudio = $derived(voice.canReplayLast)

// ── Car mode enable ────────────────────────────────────────────────────────────
function enableCarMode() {
  carMode.enable({
    startRecording: () => voice.startRecording(),
    stopRecording: () => voice.stopRecording(),
    isRecording: () => voice.isRecording,
    onReplayLast: () => voice.replayLast(),
  })

  if ("orientation" in screen && screen.orientation && "lock" in screen.orientation) {
    ;(screen.orientation as unknown as { lock: (o: string) => Promise<void> })
      .lock("landscape")
      .catch(() => {})
  }
}

$effect(() => {
  if (session.error) cues.error()
})

// ── Text input (accessibility fallback) ─────────────────────────────────────
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

// ── Bubble click-to-play (placeholder for Phase 8) ───────────────────────────
function onBubblePlayRequest(_bubble: Bubble) {
  // Phase 8 will wire this to the player
}

// ── Sheet agents (current agent as item for BottomSheet) ─────────────────────
let sheetAgents = $derived(
  agent
    ? [
        {
          id: agent.id,
          name: agent.cwd.split("/").pop() ?? agent.cliKind,
          status: agent.status,
          cliKind: agent.cliKind,
        },
      ]
    : [],
)

async function handleSheetAgentClose(agentId: string) {
  try {
    await deleteAgent(agentId)
    goto("/")
  } catch {
    // ignore
  }
}
</script>

<!-- No-pinch-zoom viewport -->
<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
</svelte:head>

<div class="page-wrap" class:page-mobile={device.isMobile}>
  <!-- ── Header: floating (mobile) / classic (desktop) ──────────────────── -->
  {#if device.isMobile}
    <!-- Floating header — overlays chat, abs positioned inside .page-wrap -->
    <FloatingHeader
      agentName={agent?.cliKind ?? ""}
      sessionTitle={agent ? agent.cwd.split("/").pop() ?? "" : ""}
    />
  {:else}
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
  {/if}

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
      <div class="chat-wrap">
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          class="chat"
          class:chat-floating={device.isMobile}
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
          {#each session.bubbles as bubble, i (i)}
            <BubbleKind
              {bubble}
              onPlayRequest={onBubblePlayRequest}
            />
          {/each}

          {#if session.bubbles.length === 0}
            <div class="chat-empty">התחילו לדבר — תוכן השיחה יופיע כאן.</div>
          {/if}
        </div>

        <!-- Jump-down button -->
        <button
          class="jump-down"
          class:visible={showJumpDown}
          onclick={jumpToBottom}
          aria-label="גלול למטה"
        >↓</button>
      </div>

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
  <footer class:footer-mobile={device.isMobile}>
    <div
      class="status"
      class:recording={micState === "recording"}
      class:processing={micState === "processing"}
      class:speaking={micState === "speaking"}
      class:cancelling={micState === "cancelling"}
    >
      {MIC_STATUS_TEXT[micState]}
    </div>

    <div class="controls">
      <button
        class="side-btn"
        disabled={!hasPlayedAudio}
        title="השמע את ההודעה האחרונה"
        aria-label="השמע אחרון"
        onclick={() => voice.replayLast()}
      >🔊</button>

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

      <button
        class="side-btn stop-btn"
        class:hidden={micState !== "speaking" && micState !== "cancelling"}
        onclick={onStop}
        title="עצור הקראה"
        aria-label="עצור הקראה"
      >⏹</button>

      {#if micState !== "speaking" && micState !== "cancelling"}
        <div class="side-btn-spacer" aria-hidden="true"></div>
      {/if}
    </div>

    <input
      id="audio-file-input"
      type="file"
      accept="audio/*"
      style="display:none"
      bind:this={fileInputEl}
      onchange={onFileUpload}
    />

    {#if isCarMode && !carMode.isActive}
      <button class="car-enable-btn" onclick={enableCarMode}>
        🚗 הפעל בקרת רכב
      </button>
    {:else if isCarMode && carMode.isActive}
      <div class="car-active-badge">🚗 בקרת רכב פעילה</div>
    {/if}

    {#if !isCarMode}
      <form class="text-form" onsubmit={(e) => { e.preventDefault(); send() }}>
        <textarea
          bind:value={inputText}
          onkeydown={onKeydown}
          placeholder="הקלד הודעה..."
          rows="2"
          disabled={session.status !== "connected"}
          aria-label="הודעה"
          dir="auto"
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

  <!-- ── Mobile: BottomSheet ─────────────────────────────────────────────── -->
  {#if device.isMobile}
    <BottomSheet
      agents={sheetAgents}
      currentAgentId={agentId}
      carModeActive={carMode.isActive}
      onCarModeToggle={enableCarMode}
      onAgentSelect={(id) => goto(`/agent/${id}`)}
      onAgentClose={handleSheetAgentClose}
    />
  {/if}
</div>

<style>
  /* ── Page wrapper ──────────────────────────────────────────────────────── */
  .page-wrap {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    overflow: hidden;
  }

  /* Mobile: position:relative needed for absolute floating header + bottom sheet */
  .page-wrap.page-mobile {
    position: relative;
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
    padding: 16px 16px 32px; /* extra bottom padding for avatar badges */
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    gap: 32px; /* space between bubbles — avatars extend 19px below */
    scroll-behavior: smooth;
  }

  /* Mobile: add top padding so chat doesn't hide under floating header */
  .chat.chat-floating {
    padding-top: 80px;
  }

  .chat-empty {
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
    background: var(--bg-elevated);
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

  /* ── Footer ──────────────────────────────────────────────────────────────── */
  footer {
    flex-shrink: 0;
    padding: 14px 16px 20px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    background: var(--bg-elevated);
  }

  /* Mobile: add extra bottom padding to keep mic above the bottom sheet grip */
  footer.footer-mobile {
    padding-bottom: 50px;
  }

  .status {
    font-size: 12px;
    color: var(--muted);
    min-height: 16px;
    text-align: center;
    transition: color 0.2s;
  }

  .status.recording  { color: var(--recording); }
  .status.processing { color: var(--processing); }
  .status.speaking   { color: var(--speaking); }
  .status.cancelling { color: var(--cancelling); }

  /* ── Controls row ────────────────────────────────────────────────────────── */
  .controls {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  /* ── BIG mic button ─────────────────────────────────────────────────────── */
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

  /* ── Side buttons ───────────────────────────────────────────────────────── */
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

  /* ── Text input form ─────────────────────────────────────────────────────── */
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
