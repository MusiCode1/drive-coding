<script lang="ts">
/**
 * BubbleKind.svelte — per-kind bubble wrapper with avatar badge.
 *
 * Layout:
 *   - Assistant bubbles (thought/tool/message): align right, avatar bottom-left
 *   - User bubble: align left, avatar bottom-right
 *
 * Click-to-play: optional `onPlayRequest` callback (Phase 8).
 * Currently-playing border: `playingBubbleMessageId` prop.
 */

import type { Bubble } from "$lib/stores/agent-session.svelte"
import BubbleAvatar from "./BubbleAvatar.svelte"
import SubSegment from "./SubSegment.svelte"

interface Props {
  bubble: Bubble
  /** messageId of bubble currently being TTS-played — used for border highlight. */
  playingMessageId?: string | null
  /** Called when the user clicks on the bubble (Phase 8: click-to-play). */
  onPlayRequest?: (bubble: Bubble) => void
}

let { bubble, playingMessageId = null, onPlayRequest }: Props = $props()

let isCurrentlyPlaying = $derived(
  playingMessageId !== null && bubble.messageId === playingMessageId,
)

function handleClick() {
  if (onPlayRequest) {
    onPlayRequest(bubble)
  }
}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="bubble-kind bubble-kind-{bubble.kind}"
  class:playing={isCurrentlyPlaying}
  class:clickable={!!onPlayRequest}
  onclick={handleClick}
  role={onPlayRequest ? "button" : undefined}
  tabindex={onPlayRequest ? 0 : undefined}
>
  <!-- Sub-segments -->
  {#each bubble.segments as segment, i (i)}
    <SubSegment {segment} kind={bubble.kind} />
  {/each}

  <!-- Avatar badge — positioned outside the bubble -->
  <BubbleAvatar kind={bubble.kind} />
</div>

<style>
  /* Base bubble-kind — matches mockup final.html */
  .bubble-kind {
    max-width: 80%;
    padding: var(--s-3);
    border-radius: 16px;
    align-self: flex-end;
    border-bottom-left-radius: 4px;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    position: relative;
    margin-left: 36px; /* space for avatar badge bottom-left */
  }

  /* User bubble — left aligned */
  .bubble-kind-user {
    align-self: flex-start;
    border-bottom-left-radius: 16px;
    border-bottom-right-radius: 4px;
    margin-left: 0;
    margin-right: 36px; /* space for avatar on the right */
    background: var(--bg-bubble-user);
  }

  /* User avatar is on the RIGHT in RTL layout */
  :global(.bubble-kind-user .bubble-avatar) {
    left: auto;
    right: -36px;
  }

  /* Message bubble */
  .bubble-kind-message {
    background: var(--bg-bubble-assistant);
  }

  /* Thought bubble */
  .bubble-kind-thought {
    background: rgba(136, 85, 255, 0.06);
    border: 1px dashed rgba(136, 85, 255, 0.25);
  }

  /* Tool bubble */
  .bubble-kind-tool {
    background: rgba(79, 140, 255, 0.05);
    border: 1px solid rgba(79, 140, 255, 0.18);
  }

  /* Currently playing highlight */
  .bubble-kind.playing {
    box-shadow: 0 0 0 2px var(--speaking), 0 0 12px rgba(79, 255, 138, 0.25);
  }

  /* Clickable bubble — cursor + hover */
  .bubble-kind.clickable {
    cursor: pointer;
  }

  .bubble-kind.clickable:hover {
    opacity: 0.92;
  }
</style>
