<script lang="ts">
/**
 * MicCluster.svelte — Phase 7 mic button cluster.
 *
 * State-driven cluster layout (from final.html mockup):
 *   idle (no prior TTS):  [empty] [🎙 mic] [empty]
 *   idle (after TTS):     [⟲ replay] [🎙 mic] [empty]
 *   recording:            [empty] [⏺ red] [empty]
 *   speaking:             [⏮ prev] [🔊 green] [⏭ next]
 *   cancelling:           [empty] [✕ orange] [empty]
 *
 * Compact size: main button 110px, side buttons 60px.
 */

import type { MicState } from "$lib/stores/mic-state.svelte"
import Icon from "./Icon.svelte"

interface Props {
  micState: MicState
  disabled?: boolean
  hasPriorTts?: boolean
  hasNext?: boolean
  hasPrev?: boolean
  onMicClick?: () => void
  onPrev?: () => void
  onNext?: () => void
  onReplay?: () => void
}

let {
  micState,
  disabled = false,
  hasPriorTts = false,
  hasNext = false,
  hasPrev = false,
  onMicClick,
  onPrev,
  onNext,
  onReplay,
}: Props = $props()

/** Whether the side buttons should be shown. */
type ClusterLayout = "none" | "replay" | "prevnext"

let layout: ClusterLayout = $derived.by(() => {
  if (micState === "speaking") return "prevnext"
  if (micState === "idle" && hasPriorTts) return "replay"
  return "none"
})

let statusLabel: string = $derived.by(() => {
  switch (micState) {
    case "recording":
      return "מקליט..."
    case "processing":
      return "מעבד..."
    case "speaking":
      return "מקריא..."
    case "cancelling":
      return "מבטל..."
    default:
      return "לחץ ודבר"
  }
})
</script>

<div class="mic-cluster-wrap">
  <!-- Status text -->
  <div class="mic-status" class:recording={micState === "recording"} class:speaking={micState === "speaking"} class:cancelling={micState === "cancelling"}>
    {statusLabel}
  </div>

  <!-- Cluster row -->
  <div class="mic-cluster">
    <!-- Left slot: prev (speaking) or empty spacer -->
    {#if layout === "prevnext"}
      <button
        class="cluster-btn"
        onclick={onPrev}
        disabled={!hasPrev}
        aria-label="קטע קודם"
        title="קודם"
      >
        <Icon name="chevrons-right" size={22} />
      </button>
    {:else if layout === "replay"}
      <button
        class="cluster-btn cluster-btn-replay"
        onclick={onReplay}
        aria-label="השמע מחדש"
        title="השמע מחדש"
      >
        <Icon name="rotate-ccw" size={22} />
      </button>
    {:else}
      <div class="cluster-spacer"></div>
    {/if}

    <!-- Main mic button -->
    <button
      class="mic-btn"
      data-state={micState}
      {disabled}
      onclick={onMicClick}
      aria-label={
        micState === "recording" ? "עצור הקלטה"
        : micState === "speaking" ? "עצור הקראה"
        : micState === "processing" ? "ממתין..."
        : "התחל הקלטה"
      }
    >
      {#if micState === "idle" || micState === "processing"}
        <Icon name="mic" size={36} strokeWidth={2} />
      {:else if micState === "recording"}
        <Icon name="square" size={28} strokeWidth={2} />
      {:else if micState === "speaking"}
        <Icon name="volume-2" size={32} strokeWidth={2} />
      {:else if micState === "cancelling"}
        <Icon name="x" size={32} strokeWidth={2} />
      {/if}
    </button>

    <!-- Right slot: next (speaking) or empty spacer -->
    {#if layout === "prevnext"}
      <button
        class="cluster-btn"
        onclick={onNext}
        disabled={!hasNext}
        aria-label="קטע הבא"
        title="הבא"
      >
        <Icon name="chevrons-left" size={22} />
      </button>
    {:else}
      <div class="cluster-spacer"></div>
    {/if}
  </div>
</div>

<style>
  .mic-cluster-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-2);
  }

  /* Status text */
  .mic-status {
    font-size: 0.85rem;
    color: var(--fg-dim);
    min-height: 1.2em;
    text-align: center;
    transition: color 0.2s;
  }

  .mic-status.recording { color: var(--recording); }
  .mic-status.speaking  { color: var(--speaking); }
  .mic-status.cancelling { color: var(--cancelling); }

  /* Cluster row */
  .mic-cluster {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-4);
  }

  /* Side cluster buttons */
  .cluster-btn {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: var(--bg-elevated);
    color: var(--fg);
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    transition: background 0.15s;
    cursor: pointer;
    flex-shrink: 0;
  }

  .cluster-btn:hover:not(:disabled) {
    background: var(--bg-card);
  }

  .cluster-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .cluster-btn-replay {
    background: rgba(79, 140, 255, 0.15);
    border-color: rgba(79, 140, 255, 0.3);
    color: var(--accent);
  }

  /* Spacer — same size as cluster-btn to keep main button centered */
  .cluster-spacer {
    width: 60px;
    height: 60px;
    flex-shrink: 0;
  }

  /* Main mic button */
  .mic-btn {
    width: 110px;
    height: 110px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    background: var(--accent);
    color: white;
    box-shadow: 0 8px 30px rgba(79, 140, 255, 0.4);
    transition: transform 0.1s, background 0.2s, box-shadow 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    touch-action: manipulation;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    flex-shrink: 0;
  }

  .mic-btn:hover:not(:disabled) { transform: scale(1.04); }
  .mic-btn:active:not(:disabled) { transform: scale(0.97); }

  .mic-btn:disabled {
    background: #2a2f3a;
    cursor: not-allowed;
    opacity: 0.6;
  }

  /* State-specific mic button styles */
  .mic-btn[data-state="recording"] {
    background: var(--recording);
    box-shadow: 0 8px 30px rgba(255, 79, 79, 0.4);
    animation: pulse-recording 1s infinite;
  }

  .mic-btn[data-state="processing"] {
    background: #8855ff;
    box-shadow: 0 8px 30px rgba(136, 85, 255, 0.4);
    animation: rotate-slow 2s linear infinite;
  }

  .mic-btn[data-state="speaking"] {
    background: var(--speaking);
    color: #0f1115;
    box-shadow: 0 8px 30px rgba(79, 255, 138, 0.4);
  }

  .mic-btn[data-state="cancelling"] {
    background: var(--cancelling);
    box-shadow: 0 8px 30px rgba(255, 153, 51, 0.4);
    animation: flash-fast 0.3s infinite;
  }
</style>
