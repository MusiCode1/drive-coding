<script lang="ts">
/**
 * ThoughtBubble — shows agent's internal reasoning.
 *
 * Slice 4: each segment may have been translated by Speaker.
 *   seg.text        = Hebrew (translated, prominent)
 *   seg.originalText = English (source, shown small/dimmed below)
 *
 * When originalText is undefined (translation not yet arrived or thought was
 * already Hebrew), shows seg.text as-is — graceful fallback.
 */
import type { ThoughtBubble } from "$lib/types/bubble"
import { getI18n } from "$lib/context"

let { bubble }: { bubble: ThoughtBubble } = $props()
const t = getI18n().t
</script>

<div class="bubble bubble-thought">
  <div class="kind-label">{t("chat.bubble.thought")}</div>
  {#each bubble.segments as seg (seg.id)}
    <div class="segment">
      <div class="translated" dir="auto">{seg.text}</div>
      {#if seg.originalText !== undefined}
        <div class="original" dir="ltr">{seg.originalText}</div>
      {/if}
    </div>
  {/each}
  <!-- forces Svelte reactivity on .segments.push() and originalText arrival -->
  <span class="hidden">{bubble.segments.length}</span>
</div>

<style>
  .bubble {
    max-width: 80%;
    padding: 0.7rem 0.9rem;
    border-radius: 12px;
    line-height: 1.4;
  }

  .bubble-thought {
    /* RTL: flex-end = left side (thought is from the agent, same side) */
    align-self: flex-end;
    background: transparent;
    border: 1px dashed var(--border);
    color: var(--fg-dim);
    font-style: italic;
    opacity: 0.85;
  }

  .kind-label {
    font-size: 0.7rem;
    opacity: 0.7;
    margin-bottom: 4px;
    font-weight: 600;
  }

  .segment {
    margin-bottom: 0.4em;
  }

  .segment:last-child {
    margin-bottom: 0;
  }

  .translated {
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .original {
    font-size: 0.82em;
    opacity: 0.55;
    margin-top: 2px;
    font-style: normal;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .hidden {
    display: none;
  }
</style>
