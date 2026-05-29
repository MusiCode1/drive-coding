<script lang="ts">
import type { MessageKey } from "@drive-coding/core/i18n"
import { getI18n, getMic, getVoiceMode } from "$lib/context"
import type { VoiceModeState } from "$lib/view-models/derived/voice-mode.svelte"

const mic = getMic()
const voiceMode = getVoiceMode()
const t = getI18n().t

const ICONS: Record<VoiceModeState, string> = {
  idle: "🎙",
  recording: "⏺",
  transcribing: "🌀",
  thinking: "🌀",
  speaking: "🔊",
  cancelling: "✕",
}

// מיפוי כל מצב VoiceMode למפתח התווית i18n שלו
function statusKey(s: VoiceModeState): MessageKey {
  switch (s) {
    case "idle":         return "voiceMode.status.idle"
    case "recording":   return "voiceMode.status.recording"
    case "transcribing": return "voiceMode.status.transcribing"
    case "thinking":    return "voiceMode.status.thinking"
    case "speaking":    return "voiceMode.status.speaking"
    case "cancelling":  return "voiceMode.status.cancelling"
  }
}

const stateText = $derived(t(statusKey(voiceMode.state)))

function onClick() {
  if (voiceMode.state === "speaking" || voiceMode.state === "thinking") {
    voiceMode.cancel()
    return
  }
  if (voiceMode.state === "transcribing" || voiceMode.state === "cancelling") return
  // במצב idle (ממתין) או recording (מקליט)
  void mic.toggle()
}
</script>

<div class="mic-container">
  <button
    class="mic-btn mic-{voiceMode.state}"
    onclick={onClick}
    disabled={voiceMode.state === "transcribing" || voiceMode.state === "cancelling"}
    aria-label={stateText}
  >
    <span class="icon">{ICONS[voiceMode.state]}</span>
  </button>
  {#if mic.error}
    <div class="mic-error" role="alert">{t(mic.error)}</div>
  {/if}
</div>

<style>
  .mic-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
  }

  .mic-btn {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: none;
    font-size: 20px;
    cursor: pointer;
    color: white;
    transition: transform 0.15s, box-shadow 0.2s, background 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: var(--accent);
    box-shadow: 0 2px 8px rgba(79, 140, 255, 0.4);
  }

  .mic-btn:hover:not(:disabled) {
    transform: scale(1.04);
  }

  .mic-btn:active:not(:disabled) {
    transform: scale(0.97);
  }

  .mic-btn:disabled {
    background: #2a2f3a;
    cursor: not-allowed;
    opacity: 0.7;
  }

  /* ── צבעי מצבים (State colours) ── */
  .mic-idle {
    background: var(--accent);
    box-shadow: 0 2px 8px rgba(79, 140, 255, 0.4);
  }

  .mic-recording {
    background: var(--recording);
    box-shadow: 0 2px 8px rgba(255, 79, 79, 0.5);
    animation: pulse 1.2s infinite;
  }

  .mic-transcribing {
    background: #8855ff;
    animation: rotate-slow 2s linear infinite;
  }

  .mic-thinking {
    background: var(--thinking);
    animation: rotate-slow 2s linear infinite;
  }

  .mic-speaking {
    background: var(--speaking);
    box-shadow: 0 0 14px rgba(79, 255, 138, 0.6);
    animation: glow 1.5s ease-in-out infinite alternate;
  }

  .mic-cancelling {
    background: #ff9933;
    animation: flash-fast 0.3s infinite;
  }

  /* ── אנימציות ── */
  @keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255, 79, 79, 0.5); }
    50%       { box-shadow: 0 0 0 10px rgba(255, 79, 79, 0); }
  }

  @keyframes rotate-slow {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  @keyframes glow {
    from { box-shadow: 0 0 8px rgba(79, 255, 138, 0.4); }
    to   { box-shadow: 0 0 20px rgba(79, 255, 138, 0.8); }
  }

  @keyframes flash-fast {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.4; }
  }

  .mic-error {
    font-size: 0.75rem;
    color: var(--recording);
    max-width: 200px;
    text-align: center;
    line-height: 1.3;
  }

  /* ── אייקון (אמוג'י) ── */
  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    font-style: normal;
  }
</style>
