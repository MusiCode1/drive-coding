<script lang="ts">
/**
 * PlaybackControls — בקרת השמעה+ריצה לפי phase.
 *
 * phase=thinking/responding/calling-tool → [עצור ריצה] (cancelRun)
 * phase=speaking/pending-tts            → [⏹][⏸/▶][⏮][⏭]
 *
 * RTL: כל כפתור משתמש בקלאסים לוגיים (inline-start/end, ms-/me-).
 * גדלים: ≥44px tap target (hands-free / drive-first).
 *
 * ─── B1-controls-ui ───
 */
import SquareIcon from "@lucide/svelte/icons/square"
import PauseIcon from "@lucide/svelte/icons/pause"
import PlayIcon from "@lucide/svelte/icons/play"
import SkipBackIcon from "@lucide/svelte/icons/skip-back"
import SkipForwardIcon from "@lucide/svelte/icons/skip-forward"
import { getI18n, getVoiceMode, getModelStatus, getAudioPlaylist } from "$lib/context"

const t = getI18n().t
const voiceMode = getVoiceMode()
const modelStatus = getModelStatus()
const playlist = getAudioPlaylist()

// ── מצבי רינדור ──────────────────────────────────────────────────────────────

/** האם אנחנו בשלב שמחייב כפתור "עצור ריצה" */
const showStopRun = $derived(
  modelStatus.phase === "thinking" ||
  modelStatus.phase === "responding" ||
  modelStatus.phase === "calling-tool"
)

/** האם אנחנו בשלב שמחייב כפתורי השמעה */
const showPlaybackControls = $derived(
  modelStatus.phase === "speaking" ||
  modelStatus.phase === "pending-tts"
)

/** תווית פר-phase לכפתור עצור-ריצה */
const stopRunLabel = $derived.by(() => {
  if (modelStatus.phase === "thinking")      return t("playbackControls.stopRun.thinking")
  if (modelStatus.phase === "responding")    return t("playbackControls.stopRun.responding")
  if (modelStatus.phase === "calling-tool")  return t("playbackControls.stopRun.callingTool")
  return t("playbackControls.stopRun")
})

/** האם transport בהשהייה (לבחור ⏸ או ▶) */
const isPaused = $derived(playlist.transport === "paused")

/** כפתורי next/prev: disable כשה-playlist לא פעיל */
const isPlaylistIdle = $derived(playlist.state === "idle")

/**
 * carry A4 #2: next/prev בזמן current=reserved (טוען) → latency-glitch.
 * disable next/prev כשה-item הנוכחי עדיין reserved/loading.
 */
const isCurrentLoading = $derived.by(() => {
  const cursor = playlist.cursor
  const item = playlist.items[cursor]
  return item !== undefined && (item.state === "reserved" || item.state === "loading")
})

const isNavDisabled = $derived(isPlaylistIdle || isCurrentLoading)
</script>

{#if showStopRun}
  <!-- כפתור עצור-ריצה (thinking/responding/calling-tool) -->
  <div class="playback-controls" role="group" aria-label={t("playbackControls.stopRun")}>
    <button
      class="ctrl-btn ctrl-btn--stop-run"
      onclick={() => voiceMode.cancelRun()}
      aria-label={stopRunLabel}
      title={stopRunLabel}
    >
      <SquareIcon size={18} strokeWidth={2} />
      <span class="ctrl-label">{stopRunLabel}</span>
    </button>
  </div>
{:else if showPlaybackControls}
  <!-- כפתורי השמעה (speaking/pending-tts) -->
  <div class="playback-controls" role="group" aria-label={t("playbackControls.stopPlayback")}>
    <!-- ⏹ עצור השמעה -->
    <button
      class="ctrl-btn"
      onclick={() => voiceMode.stopPlayback()}
      aria-label={t("playbackControls.stopPlayback")}
      title={t("playbackControls.stopPlayback")}
    >
      <SquareIcon size={18} strokeWidth={2} />
    </button>

    <!-- ⏮ קודם -->
    <button
      class="ctrl-btn"
      onclick={() => playlist.prev()}
      disabled={isNavDisabled}
      aria-label={t("playbackControls.prev")}
      title={t("playbackControls.prev")}
    >
      <SkipBackIcon size={18} strokeWidth={2} />
    </button>

    <!-- ⏸/▶ השהה/המשך -->
    {#if isPaused}
      <button
        class="ctrl-btn ctrl-btn--accent"
        onclick={() => playlist.resume()}
        aria-label={t("playbackControls.resume")}
        title={t("playbackControls.resume")}
      >
        <PlayIcon size={18} strokeWidth={2} />
      </button>
    {:else}
      <button
        class="ctrl-btn"
        onclick={() => playlist.pause()}
        disabled={isNavDisabled}
        aria-label={t("playbackControls.pause")}
        title={t("playbackControls.pause")}
      >
        <PauseIcon size={18} strokeWidth={2} />
      </button>
    {/if}

    <!-- ⏭ הבא -->
    <button
      class="ctrl-btn"
      onclick={() => playlist.next()}
      disabled={isNavDisabled}
      aria-label={t("playbackControls.next")}
      title={t("playbackControls.next")}
    >
      <SkipForwardIcon size={18} strokeWidth={2} />
    </button>
  </div>
{/if}

<style>
  .playback-controls {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    /* logical: ms = margin-inline-start */
    margin-inline-start: 0.5rem;
  }

  .ctrl-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    /* ≥44px tap target (hands-free / drive-first) */
    min-width: 44px;
    min-height: 44px;
    padding: 0 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--bg-card);
    color: var(--fg-dim);
    cursor: pointer;
    font-size: 0.78rem;
    transition: background 0.15s, color 0.15s;
  }

  .ctrl-btn:hover:not(:disabled) {
    background: var(--bg-hover, var(--border));
    color: var(--fg);
  }

  .ctrl-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .ctrl-btn--accent {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .ctrl-btn--accent:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .ctrl-btn--stop-run {
    /* הדגשה קלה לכפתור עצור-ריצה */
    border-color: var(--recording, #e53e3e);
    color: var(--recording, #e53e3e);
  }

  .ctrl-btn--stop-run:hover:not(:disabled) {
    background: color-mix(in srgb, var(--recording, #e53e3e) 12%, transparent);
  }

  .ctrl-label {
    font-size: 0.78rem;
    font-weight: 500;
    white-space: nowrap;
  }
</style>
