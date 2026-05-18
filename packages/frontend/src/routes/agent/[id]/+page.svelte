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
import MicCluster from "$lib/components/MicCluster.svelte"
import Sidebar from "$lib/components/Sidebar.svelte"
import { createLogger } from "$lib/log"
import type { Bubble } from "$lib/stores/agent-session.svelte"
import { createAgentSessionStore } from "$lib/stores/agent-session.svelte"
import { createCarMode } from "$lib/stores/car-mode.svelte"
import { device } from "$lib/stores/device.svelte"
import { deriveMicState } from "$lib/stores/mic-state.svelte"
import { createPlayerStore } from "$lib/stores/player.svelte"
import { settingsStore } from "$lib/stores/settings-store.svelte"
import { sheetState } from "$lib/stores/sheet-state.svelte"
import { sidebarState } from "$lib/stores/sidebar-state.svelte"
import { deriveScrollState } from "$lib/stores/smart-scroll"
import { createVoiceSessionStore } from "$lib/stores/voice-session.svelte"

const log = createLogger("fe.route.agent")

let agentId = $derived(page.params.id ?? "")
let agent = $state<AgentPublic | null>(null)
let loadError = $state<string | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

let session = $state(createAgentSessionStore(agentId))
let voice = $state(createVoiceSessionStore(session))
let carMode = $state(createCarMode())
let player = $state(createPlayerStore())

// Fix: when agentId changes — close old WS and create fresh stores (Bug 4).
$effect(() => {
  const id = agentId
  untrack(() => {
    session.disconnect()
    session = createAgentSessionStore(id)
    voice = createVoiceSessionStore(session)
    player.clear()
  })
})

// Phase 7+8: populate player playlist when new audio_chunk segments arrive
$effect(() => {
  const segId = voice.currentlyPlayingSegmentId
  if (segId) {
    const meta = voice.getSegment(segId)
    if (meta) {
      // B15 fix: pass messageId so jumpToBubble() can work for click-to-play
      player.addSegment(segId, meta.kind, meta.messageId ?? null)
      player.jumpToSegment(segId)
    }
  }
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

  // N6 fix: check settings before firing each cue
  const ac = settingsStore.audioCues
  if (current === "recording") {
    if (ac.recordingStart) cues.recordingStart()
    acquireWakeLock()
  } else if (prevMicState === "recording" && current === "processing") {
    if (ac.recordingStart) cues.recordingStop()
    if (ac.thinking) cues.thinking()
  } else if (current === "speaking") {
    if (ac.speaking) cues.speaking()
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
    // Slice 10: BE-registry status "starting" means bridge is spawned and ready
    // for ACP handshake. FE drives handshake → session-attached → status="ready".
    // session.connect() is idempotent (early-return if connecting/connected) so
    // we call it whenever the agent is in a connectable backend state.
    const canConnect = fetched.status === "starting" || fetched.status === "ready"
    if (canConnect && session.status !== "connecting" && session.status !== "connected") {
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
  // Poll only until status leaves "starting" (which now reflects bridge alive +
  // pre-handshake). Once FE finishes session-attached, BE flips to "ready".
  if (agent?.status === "starting") {
    pollTimer = setInterval(async () => {
      try {
        const { agent: fresh } = await getAgent(agentId)
        agent = fresh
        if (fresh.status !== "starting") {
          if (pollTimer !== null) clearInterval(pollTimer)
          pollTimer = null
          // Safety net: trigger connect() if not already in progress.
          if (
            fresh.status === "ready" &&
            session.status !== "connecting" &&
            session.status !== "connected"
          ) {
            session.connect()
          }
        }
      } catch (e: unknown) {
        log.warn({ err: String(e) }, "poll: getAgent failed, retrying")
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

// B4: text input removed — voice-only interface (no keyboard input)

// ── Bubble click-to-play (Phase 8) ──────────────────────────────────────────
function onBubblePlayRequest(bubble: Bubble) {
  if (bubble.messageId) {
    const item = player.jumpToBubble(bubble.messageId)
    if (item) {
      // Trigger replay from this bubble's first segment
      voice.replayLast()
    }
  }
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
  } catch (e: unknown) {
    log.warn({ err: String(e), agentId }, "deleteAgent failed")
  }
}
</script>

<!-- No-pinch-zoom viewport -->
<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
</svelte:head>

<div class="page-wrap" class:page-mobile={device.isMobile}>
  <!-- ── Desktop: sidebar ────────────────────────────────────────────────── -->
  {#if device.isDesktop}
    <Sidebar
      agents={sheetAgents}
      currentAgentId={agentId}
      collapsed={sidebarState.isCollapsed}
      carModeActive={carMode.isActive}
      onCollapseToggle={() => sidebarState.toggle()}
      onCarModeToggle={enableCarMode}
      onAgentSelect={(id) => goto(`/agent/${id}`)}
    />
  {/if}

  <!-- ── Main column (header + chat + footer) ────────────────────────────── -->
  <div class="main-col">
    <!-- ── Header: floating (mobile) / classic (desktop) ──────────────── -->
    {#if device.isMobile}
      <!-- Floating header — overlays chat, abs positioned inside .main-col -->
      <!-- N1 fix: agentName = project dir name, sessionTitle = cliKind -->
      <FloatingHeader
        agentName={agent ? agent.cwd.split("/").pop() ?? "" : ""}
        sessionTitle={agent?.cliKind ?? ""}
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
              playingMessageId={bubble.messageId && player.isPlayingBubble(bubble.messageId)
                ? bubble.messageId
                : null}
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
    <!-- Phase 7: MicCluster replaces raw mic button + side buttons -->
    <MicCluster
      {micState}
      disabled={session.status !== "connected" && session.status !== "thinking"}
      hasPriorTts={hasPlayedAudio}
      hasNext={player.hasNext}
      hasPrev={player.hasPrev}
      onMicClick={onMicClick}
      onPrev={() => {
        const item = player.goPrev()
        if (item) voice.replayLast() // Phase 7: nav — simplified, full impl in Phase 8
      }}
      onNext={() => {
        const item = player.goNext()
        if (item) voice.replayLast() // Phase 7: nav — simplified, full impl in Phase 8
      }}
      onReplay={() => {
        player.replayLastResponse()
        voice.replayLast()
      }}
    />

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

    <!-- B4 removed: text form removed — voice-only interface -->
  </footer>

    <!-- ── Mobile: BottomSheet ───────────────────────────────────────────── -->
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
  </div> <!-- end .main-col -->
</div>

<style>
  /* ── Page wrapper ──────────────────────────────────────────────────────── */
  .page-wrap {
    display: flex;
    flex-direction: row; /* sidebar | main-col */
    height: 100dvh;
    overflow: hidden;
  }

  /* Mobile: stack vertically + position:relative for floating elements */
  .page-wrap.page-mobile {
    flex-direction: column;
    position: relative;
    overflow: hidden;
  }

  /* ── Main column (header + chat + footer) ───────────────────────────────── */
  .main-col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Mobile: main-col fills all height (sidebar is hidden) */
  .page-wrap.page-mobile .main-col {
    position: relative; /* for absolute floating header + bottom sheet */
    height: 100%;
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
