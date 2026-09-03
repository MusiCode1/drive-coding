<script lang="ts">
/**
 * BubbleRow — alignment rail: avatar + content with a fixed gap (no 1fr spacer).
 *
 * Outer row is full width and only justifies a shrink-wrapped *cluster*
 * (avatar + content) to inline-start or inline-end. That avoids the canyon
 * where a stretched content track leaves the bubble on the far side of the
 * avatar.
 *
 * Mobile: cluster is a column (avatar above content).
 * Desktop: cluster is a row (start) / row-reverse (end); only `gap` between
 * avatar and bubble.
 */
import type { Snippet } from "svelte"
import Avatar from "$lib/components/chat/Avatar.svelte"
import type { BubbleAvatarKind, BubbleSide } from "./bubble-row"

interface Props {
  side: BubbleSide
  avatar: BubbleAvatarKind
  children: Snippet
}

const { side, avatar, children }: Props = $props()
</script>

<div class="bubble-row" data-side={side}>
  <div class="bubble-row-cluster">
    <Avatar kind={avatar} />
    <div class="bubble-row-content">
      {@render children()}
    </div>
  </div>
</div>

<style>
  .bubble-row {
    display: flex;
    width: 100%;
    box-sizing: border-box;
    /* pack cluster to inline-start (agent) */
    justify-content: start;
    /* definite inline size so user bubbles can cap with 85cqw instead of cyclic 100% */
    container-type: inline-size;
  }

  .bubble-row[data-side="end"] {
    justify-content: end;
  }

  .bubble-row-cluster {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    max-width: 100%;
    /* shrink-wrap — never a free 1fr track between avatar and bubble */
    width: fit-content;
    align-items: start;
  }

  .bubble-row[data-side="end"] .bubble-row-cluster {
    align-items: end;
  }

  /* agent/start: may use the full chat column (MessageBubble is w-full) */
  .bubble-row[data-side="start"] .bubble-row-cluster {
    width: 100%;
  }

  .bubble-row-content {
    min-width: 0;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    /* pack children toward the avatar edge */
    align-items: start;
  }

  .bubble-row[data-side="end"] .bubble-row-content {
    align-items: end;
    width: fit-content;
    max-width: 100%;
  }

  .bubble-row[data-side="start"] .bubble-row-content {
    width: 100%;
  }

  .bubble-row :global(.avatar) {
    flex-shrink: 0;
  }

  @media (min-width: 768px) {
    .bubble-row-cluster {
      gap: 8px;
      /* DOM: Avatar, Content. row + dir=rtl → avatar at inline-start (right). */
      flex-direction: row;
      align-items: start;
    }

    .bubble-row[data-side="start"] .bubble-row-content {
      flex: 1 1 auto;
      min-width: 0;
      width: auto;
      /* tool/thought max-w cards hug the avatar (inline-start), not the far edge */
      align-items: start;
    }

    /*
     * end: row-reverse + dir=rtl → avatar at inline-end (left), content beside it.
     * Cluster stays fit-content so only `gap` separates avatar and bubble.
     */
    .bubble-row[data-side="end"] .bubble-row-cluster {
      flex-direction: row-reverse;
      align-items: start;
      width: fit-content;
      max-width: 85%;
    }

    .bubble-row[data-side="end"] .bubble-row-content {
      flex: 0 1 auto;
      width: fit-content;
      max-width: 100%;
      align-items: end;
    }
  }
</style>
