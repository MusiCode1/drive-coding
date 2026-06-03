<script lang="ts">
/**
 * UserBubble — בועת משתמש (C4).
 *
 * עיצוב מוקאפ 249-255: self-start, avatar user, bubble-user token.
 * flex gap-2 self-start items-end.
 *
 * ─── redesign-5 (C4) ───
 */
import type { UserBubble } from "$lib/types/bubble"
import { getI18n, getBubblePlayer } from "$lib/context"
import Avatar from "$lib/components/chat/Avatar.svelte"
import { joinSegmentText } from "./bubble-rendering"

let { bubble }: { bubble: UserBubble } = $props()
const t = getI18n().t
const bubblePlayer = getBubblePlayer()

const isPlaying = $derived(bubblePlayer.playingBubbleId === bubble.id)
</script>

<div
  class="flex gap-2 self-start max-w-[85%] min-w-0 items-end"
  class:ring-2={isPlaying}
  style={isPlaying ? "ring-color:var(--accent)" : ""}
>
  <Avatar kind="user" />
  <div
    class="px-3.5 py-2.5 rounded-2xl rounded-es-sm text-sm leading-relaxed whitespace-pre-wrap break-words min-w-0"
    style="background:var(--bubble-user)"
    dir="auto"
  >
    {joinSegmentText(bubble.segments)}
    <!-- כופה ריאקטיביות -->
    <span class="hidden">{bubble.segments.length}</span>
  </div>
  {#if bubble.recordingId}
    <button
      class="shrink-0 size-6 grid place-items-center rounded-full opacity-60 hover:opacity-100 transition-opacity"
      style="background:var(--bg-card); border:1px solid var(--border); color:var(--fg)"
      onclick={() => bubblePlayer.toggle(bubble.id)}
      aria-label={isPlaying ? t("bubble.stop") : t("bubble.play")}
      title={isPlaying ? t("bubble.stop") : t("bubble.play")}
    >
      {isPlaying ? "⏸" : "▶"}
    </button>
  {/if}
</div>

<style>
  .hidden { display: none; }
</style>
