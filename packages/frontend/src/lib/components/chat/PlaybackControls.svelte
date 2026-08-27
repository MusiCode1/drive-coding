<script lang="ts">
/**
 * PlaybackControls — רצועת בקרה בתוך כרטיס RecordFooter (control-dock, slice dock-inline).
 *
 * חמישה תאים קבועים: עצור השמעה · קודם · השהה/המשך · הבא · השתק.
 * ביטול-הריצה עבר ל-MicLarge ו-TypeArea (slice control-roles).
 *
 * ─── control-dock ───
 * ─── slice control-roles ───
 * ─── slice dock-inline ───
 */
import PauseIcon from "@lucide/svelte/icons/pause"
import PlayIcon from "@lucide/svelte/icons/play"
import SkipBackIcon from "@lucide/svelte/icons/skip-back"
import SkipForwardIcon from "@lucide/svelte/icons/skip-forward"
import SquareIcon from "@lucide/svelte/icons/square"
import Volume2Icon from "@lucide/svelte/icons/volume-2"
import VolumeXIcon from "@lucide/svelte/icons/volume-x"
import {
  getAudioPlaylist,
  getI18n,
  getModelStatus,
  getResponsive,
  getSpeaker,
  getUiShell,
  getVoiceMode,
} from "$lib/context"
import { shouldShowPlaybackDock } from "$lib/util/playback-dock-visibility"

const t = getI18n().t
const voiceMode = getVoiceMode()
const modelStatus = getModelStatus()
const speaker = getSpeaker()
const playlist = getAudioPlaylist()
const responsive = getResponsive()
const uiShell = getUiShell()

const showDock = $derived(
  shouldShowPlaybackDock({
    inputMode: uiShell.inputMode,
    playlistItemCount: playlist.items.length,
    isRunActive: modelStatus.isRunActive,
  }),
)

const iconSize = $derived(responsive.isMobile ? 24 : 22)

const isPaused = $derived(playlist.transport === "paused")

/** ⏸/▶ — לפי playlist.state (לא isNavDisabled / currentSegmentId). */
const isTransportEnabled = $derived(playlist.state === "playing")

const isNavDisabled = $derived(playlist.items.length === 0 || playlist.items.length < 2)
</script>

<!-- shrink-0 + w-full: שורה בתוך mic-card — בלי w-full repeat(5,1fr) נסוג במובייל. -->
<div
  class="playback-dock-row relative w-full min-w-0 shrink-0"
  class:is-collapsed={!showDock}
>
  <div class="dock-pane" class:is-visible={showDock}>
    <div class="dock-pane-inner">
      <!-- dir=ltr: בקרת-תעבורה (⏮ שמאל, ⏭ ימין) — מוסכמת נגנים, לא כיוון טקסט.
           חריג RTL מודע; אל תהפוך לפי locale. -->
      <div
        class="controls-grid"
        class:controls-grid--desktop={!responsive.isMobile}
        role="group"
        dir="ltr"
        aria-label={t("playbackControls.dock")}
      >
        <button
          type="button"
          class="ctrl-cell"
          onclick={() => voiceMode.stopPlayback()}
          disabled={playlist.items.length === 0}
          aria-label={t("playbackControls.stopPlayback")}
          title={t("playbackControls.stopPlayback")}
        >
          <SquareIcon size={iconSize} strokeWidth={2} />
        </button>

        <button
          type="button"
          class="ctrl-cell"
          onclick={() => playlist.prev()}
          disabled={isNavDisabled}
          aria-label={t("playbackControls.prev")}
          title={t("playbackControls.prev")}
        >
          <SkipBackIcon size={iconSize} strokeWidth={2} />
        </button>

        {#if isPaused}
          <button
            type="button"
            class="ctrl-cell ctrl-cell--accent"
            onclick={() => playlist.resume()}
            disabled={!isTransportEnabled}
            aria-label={t("playbackControls.resume")}
            title={t("playbackControls.resume")}
          >
            <PlayIcon size={iconSize} strokeWidth={2} />
          </button>
        {:else}
          <button
            type="button"
            class="ctrl-cell"
            onclick={() => playlist.pause()}
            disabled={!isTransportEnabled}
            aria-label={t("playbackControls.pause")}
            title={t("playbackControls.pause")}
          >
            <PauseIcon size={iconSize} strokeWidth={2} />
          </button>
        {/if}

        <button
          type="button"
          class="ctrl-cell"
          onclick={() => playlist.next()}
          disabled={isNavDisabled}
          aria-label={t("playbackControls.next")}
          title={t("playbackControls.next")}
        >
          <SkipForwardIcon size={iconSize} strokeWidth={2} />
        </button>

        <button
          type="button"
          class="ctrl-cell"
          onclick={() => speaker.toggle()}
          aria-pressed={!speaker.enabled}
          aria-label={speaker.enabled ? t("header.audioOn") : t("header.audioOff")}
          title={speaker.enabled ? t("header.audioOn") : t("header.audioOff")}
        >
          {#if speaker.enabled}
            <Volume2Icon size={iconSize} strokeWidth={2} />
          {:else}
            <VolumeXIcon size={iconSize} strokeWidth={2} />
          {/if}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  /* mic-card gap-3 (0.75rem) still applies when ribbon height is 0 — cancel when collapsed. */
  .playback-dock-row {
    transition: margin-block-start 0.3s ease;
  }

  .playback-dock-row.is-collapsed {
    margin-block-start: -0.75rem;
    pointer-events: none;
  }

  .dock-pane {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition:
      opacity 0.3s ease,
      grid-template-rows 0.3s ease 0.3s,
      visibility 0s linear 0.6s;
  }

  .dock-pane-inner {
    min-height: 0;
    overflow: hidden;
  }

  .dock-pane.is-visible {
    grid-template-rows: 1fr;
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transition:
      grid-template-rows 0.3s ease,
      opacity 0.3s ease 0.3s,
      visibility 0s linear 0s;
  }

  .controls-grid {
    --touch-target-lg: 56px;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.5rem;
    padding: 0.5rem;
  }

  .controls-grid--desktop {
    --touch-target-lg: 48px;
    max-width: 28rem;
    margin-inline: auto;
  }

  .ctrl-cell {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    min-height: var(--touch-target-lg);
    border: 1px solid var(--border);
    border-radius: 0.625rem;
    background: var(--bg-card);
    color: var(--fg-dim);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, opacity 0.15s;
  }

  .ctrl-cell:hover:not(:disabled) {
    background: var(--bg-hover, var(--border));
    color: var(--fg);
  }

  .ctrl-cell:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .ctrl-cell--accent {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .ctrl-cell--accent:hover:not(:disabled) {
    filter: brightness(1.1);
  }
</style>
