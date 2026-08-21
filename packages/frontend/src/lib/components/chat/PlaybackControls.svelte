<script lang="ts">
/**
 * PlaybackControls — רצועת בקרה מעוגנת מעל RecordFooter (control-dock).
 *
 * ארבעה תאים שווים: עצור · קודם · השהה/המשך · הבא.
 * "עצור ריצה" מחליף "עצור השמעה" בתא הראשון — רוחב קבוע, בלי קפיצת-פריסה.
 *
 * ─── control-dock ───
 */
import OctagonXIcon from "@lucide/svelte/icons/octagon-x"
import PauseIcon from "@lucide/svelte/icons/pause"
import PlayIcon from "@lucide/svelte/icons/play"
import SkipBackIcon from "@lucide/svelte/icons/skip-back"
import SkipForwardIcon from "@lucide/svelte/icons/skip-forward"
import SquareIcon from "@lucide/svelte/icons/square"
import {
  getAudioPlaylist,
  getI18n,
  getModelStatus,
  getResponsive,
  getVoiceMode,
} from "$lib/context"

const t = getI18n().t
const voiceMode = getVoiceMode()
const modelStatus = getModelStatus()
const playlist = getAudioPlaylist()
const responsive = getResponsive()

const showStopRun = $derived(
  modelStatus.phase === "thinking" ||
    modelStatus.phase === "responding" ||
    modelStatus.phase === "calling-tool",
)

/** הרצועה מוצגת ⇔ יש מה לשלוט בו */
const showDock = $derived(showStopRun || playlist.items.length > 0)

/**
 * ─── slice stop-split ───
 * 🔴 **היה כאן כפתור אחד עם שתי משמעויות.** אותו אייקון-ריבוע קרא ל-
 * `cancelRun()` כשהסוכן פעיל ול-`stopPlayback()` כשלא — וההבדל היה
 * `showStopRun`, מצב שאינו נראה למשתמש. כלומר לחיצה על "עצור" כדי
 * **להשתיק** ביטלה את **ההרצה**, בדיוק ברגע שבו יש קול ולכן בדיוק כשמושיטים
 * אליו יד. דווח מהשדה ("לוחץ סטופ ואז זה לא חוזר בפרומפט הבא").
 *
 * עכשיו: תא-התעבורה הוא **תמיד השתקה**, וביטול-ההרצה הוא תא נפרד שמופיע
 * רק כשיש הרצה — שני אייקונים, שתי תוויות, ואין מצב סמוי שמחליף משמעות.
 */
const stopRunLabel = $derived.by(() => {
  if (modelStatus.phase === "thinking") return t("playbackControls.stopRun.thinking")
  if (modelStatus.phase === "responding") return t("playbackControls.stopRun.responding")
  if (modelStatus.phase === "calling-tool") return t("playbackControls.stopRun.callingTool")
  return t("playbackControls.stopRun")
})

const isPaused = $derived(playlist.transport === "paused")

/** ⏸/▶ — לפי playlist.state (לא isNavDisabled / currentSegmentId). */
const isTransportEnabled = $derived(playlist.state === "playing")

const isNavDisabled = $derived(playlist.items.length === 0 || playlist.items.length < 2)

/** ‏השתקה בלבד — לעולם אינה נוגעת בהרצה. */
function onStopPlayback(): void {
  voiceMode.stopPlayback()
}

/** ‏ביטול ההרצה (ומשתיק אגב כך). תא נפרד, אייקון נפרד, אדום. */
function onCancelRun(): void {
  voiceMode.cancelRun()
}
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
          class:controls-grid--with-run={showStopRun}
          role="group"
          dir="ltr"
          aria-label={t("playbackControls.dock")}
        >
          {#if showStopRun}
            <button
              type="button"
              class="ctrl-cell ctrl-cell--stop-run"
              onclick={onCancelRun}
              aria-label={stopRunLabel}
              title={stopRunLabel}
            >
              <OctagonXIcon size={24} strokeWidth={2} />
            </button>
          {/if}

          <button
            type="button"
            class="ctrl-cell"
            onclick={onStopPlayback}
            disabled={playlist.items.length === 0}
            aria-label={t("playbackControls.stopPlayback")}
            title={t("playbackControls.stopPlayback")}
          >
            <SquareIcon size={24} strokeWidth={2} />
          </button>

          <button
            type="button"
            class="ctrl-cell"
            onclick={() => playlist.prev()}
            disabled={isNavDisabled}
            aria-label={t("playbackControls.prev")}
            title={t("playbackControls.prev")}
          >
            <SkipBackIcon size={24} strokeWidth={2} />
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
              <PlayIcon size={24} strokeWidth={2} />
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
              <PauseIcon size={24} strokeWidth={2} />
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
            <SkipForwardIcon size={24} strokeWidth={2} />
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
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
  }

  /* ─── slice stop-split ───
     תא חמישי כשהסוכן רץ. התאים מתכווצים במקום לגלוש — 56px הוא יעד-המגע
     המינימלי, ולכן `1fr` עם `min-width` על התא ולא רוחב קבוע. */
  .controls-grid--with-run {
    grid-template-columns: repeat(5, 1fr);
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

  .ctrl-cell--stop-run:not(:disabled) {
    border-color: var(--recording, #e53e3e);
    color: var(--recording, #e53e3e);
  }

  .ctrl-cell--stop-run:hover:not(:disabled) {
    background: color-mix(in srgb, var(--recording, #e53e3e) 12%, transparent);
  }

  .is-collapsed {
    pointer-events: none;
  }
</style>
