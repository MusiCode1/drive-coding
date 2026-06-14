<script lang="ts">
/**
 * UserBubble — בועת משתמש (C4).
 *
 * עיצוב מוקאפ 249-255: self-start, avatar user, bubble-user token.
 * flex gap-2 self-start items-end.
 *
 * msr-v2: כפתור ▶ אם recordingId קיים.
 *
 * ─── redesign-5 (C4) ───
 */
import type { UserBubble } from "$lib/types/bubble"
import { getBubblePlayer, getI18n } from "$lib/context"
import Avatar from "$lib/components/chat/Avatar.svelte"
import { joinSegmentText } from "./bubble-rendering"
import PlayIcon from "@lucide/svelte/icons/play"
import SquareIcon from "@lucide/svelte/icons/square"

let { bubble }: { bubble: UserBubble } = $props()
const t = getI18n().t
const bubblePlayer = getBubblePlayer()

const isPlaying = $derived(bubblePlayer.playingBubbleId === bubble.id)
</script>

<div class="flex gap-2 self-start max-w-[85%] min-w-0 items-end">
  <Avatar kind="user" />
  <div
    class="px-3.5 py-2.5 rounded-2xl rounded-es-sm text-sm leading-relaxed whitespace-pre-wrap break-words min-w-0"
    style="background:var(--bubble-user); {isPlaying ? 'outline:2px solid var(--accent); outline-offset:1px' : ''}"
    dir="auto"
  >
    {joinSegmentText(bubble.segments)}
    <!-- כופה ריאקטיביות -->
    <span class="hidden">{bubble.segments.length}</span>
  </div>
  {#if bubble.recordingId}
    <button
      class="play-btn"
      onclick={() => bubblePlayer.toggle(bubble.id)}
      aria-label={isPlaying ? t("bubble.stop") : t("bubble.play")}
      title={isPlaying ? t("bubble.stop") : t("bubble.play")}
    >
      {#if isPlaying}
        <SquareIcon size={12} strokeWidth={2} />
      {:else}
        <PlayIcon size={12} strokeWidth={2} />
      {/if}
    </button>
  {/if}
</div>

<style>
  .hidden { display: none; }
  .play-btn {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--fg-dim);
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.15s;
    padding: 0;
  }
  .play-btn:hover { opacity: 1; }
</style>
