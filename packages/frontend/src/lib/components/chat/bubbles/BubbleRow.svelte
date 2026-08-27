<script lang="ts">
/**
 * BubbleRow — alignment rail: avatar + content on one grid track.
 *
 * Mobile-first: single column, avatar above content.
 * Desktop (768px+): avatar inline with content (28px column).
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
  <Avatar kind={avatar} />
  <div class="bubble-row-content">
    {@render children()}
  </div>
</div>

<style>
  .bubble-row {
    display: grid;
    width: 100%;
    box-sizing: border-box;
    grid-template-columns: 1fr;
    gap: 4px;
    align-items: start;
  }

  .bubble-row[data-side="end"] {
    justify-items: end;
  }

  .bubble-row-content {
    min-width: 0;
    width: 100%;
  }

  @media (min-width: 768px) {
    .bubble-row {
      gap: 8px;
    }

    .bubble-row[data-side="start"] {
      grid-template-columns: 28px minmax(0, 1fr);
    }

    .bubble-row[data-side="end"] {
      grid-template-columns: minmax(0, 1fr) 28px;
      justify-items: stretch;
    }

    .bubble-row[data-side="end"] :global(.avatar) {
      grid-column: 2;
      grid-row: 1;
    }

    .bubble-row[data-side="end"] .bubble-row-content {
      grid-column: 1;
      grid-row: 1;
    }
  }
</style>
