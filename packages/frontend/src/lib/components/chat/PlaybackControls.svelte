<script lang="ts">
/**
 * PlaybackControls — רצועת בקרה מעוגנת מעל RecordFooter (control-dock).
 *
 * חמישה תאים קבועים: עצור השמעה · קודם · השהה/המשך · הבא · השתק.
 * ביטול-הריצה עבר ל-MicLarge ו-TypeArea (slice control-roles).
 *
 * ─── control-dock ───
 * ─── slice control-roles ───
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

const iconSize = $derived(responsive.isMobile ? 24 : 20)

const isPaused = $derived(playlist.transport === "paused")

/** ⏸/▶ — לפי playlist.state (לא isNavDisabled / currentSegmentId). */
const isTransportEnabled = $derived(playlist.state === "playing")

const isNavDisabled = $derived(playlist.items.length === 0 || playlist.items.length < 2)
</script>

<!-- shrink-0 על השורש — כמו RecordFooter; בלי זה 56px נמחצים תחת לחץ flex. -->
<footer
  class="playback-dock-footer relative shrink-0 flex justify-center px-4"
  class:mic-plain={responsive.isMobile}
  class:is-collapsed={!showDock}
>
  <div class="mic-card playback-dock-card w-full max-w-3xl min-w-0">
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
</footer>

<style>
  .playback-dock-card {
    /* יחידה אחת עם RecordFooter — רק פינות עליונות; תחתית שטוחה */
    border-end-start-radius: 0;
    border-end-end-radius: 0;
    border-bottom: none;
    padding: 0;
  }

  /* כשהרצועה מעל וגלויה — RecordFooter מאבד פינות/מסגרת עליונה (יחידה ויזואלית) */
  :global(.playback-dock-footer:not(.is-collapsed) + footer .mic-card) {
    border-start-start-radius: 0;
    border-start-end-radius: 0;
    border-top: none;
    box-shadow: none;
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
    grid-template-columns: repeat(5, 1fr);
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
  }

  .controls-grid--desktop {
    --touch-target-lg: 40px;
    gap: 0.375rem;
    padding: 0.375rem 0.625rem;
  }

  .ctrl-cell {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--touch-target-lg);
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

  .is-collapsed {
    pointer-events: none;
  }
</style>
