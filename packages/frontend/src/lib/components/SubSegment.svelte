<script lang="ts">
/**
 * SubSegment.svelte — one segment within a bubble.
 *
 * For thought bubbles with originalText: shows original (dimmer, LTR)
 * above translation (RTL, italic).
 *
 * For tool bubbles: shows toolTitle (accent) + optional narration (italic).
 *
 * For message/user bubbles: shows text.
 */

import type { BubbleKind, BubbleSegment } from "$lib/stores/agent-session.svelte"
import Icon from "./Icon.svelte"

interface Props {
  segment: BubbleSegment
  kind: BubbleKind
  /** True when this segment is currently being TTS-played. */
  isPlaying?: boolean
}

let { segment, kind, isPlaying = false }: Props = $props()
</script>

<div
  class="sub-segment sub-segment-{kind}"
  class:playing={isPlaying}
>
  {#if kind === "thought"}
    {#if segment.originalText}
      <div class="thought-original" dir="ltr">{segment.originalText}</div>
    {/if}
    {#if segment.text}
      <div class="thought-translation">{segment.text}</div>
    {/if}
    {#if !segment.originalText && !segment.text}
      <!-- empty thought segment — show nothing (streaming placeholder) -->
    {/if}
  {:else if kind === "tool"}
    {#if segment.toolTitle}
      <div class="tool-title">
        <Icon name="file-text" size={14} />
        {segment.toolTitle}
      </div>
    {/if}
    {#if segment.narration}
      <div class="tool-narration">{segment.narration}</div>
    {/if}
  {:else}
    <!-- message or user: plain text -->
    {#if segment.text}
      <span>{segment.text}</span>
    {/if}
  {/if}
</div>

<style>
  .sub-segment {
    padding: var(--s-2) var(--s-3);
    border-radius: 10px;
    font-size: 0.92rem;
    line-height: 1.5;
    background: rgba(255, 255, 255, 0.02);
  }

  /* Thought segment */
  .sub-segment-thought {
    color: var(--fg-dim);
    font-size: 0.85rem;
    font-style: italic;
    background: rgba(136, 85, 255, 0.04);
  }

  .thought-original {
    opacity: 0.5;
    margin-bottom: 4px;
  }

  .thought-translation {
    /* inherits italic + size from parent */
  }

  /* Tool segment */
  .sub-segment-tool {
    background: rgba(79, 140, 255, 0.04);
    font-size: 0.88rem;
  }

  .tool-title {
    color: var(--accent);
    font-weight: 500;
    margin-bottom: 2px;
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }

  .tool-narration {
    color: var(--fg-dim);
    font-style: italic;
    font-size: 0.82rem;
  }

  /* Currently playing highlight */
  .sub-segment.playing {
    background: rgba(79, 255, 138, 0.12);
    border: 1px solid rgba(79, 255, 138, 0.3);
  }
</style>
