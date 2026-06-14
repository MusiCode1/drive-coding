<script lang="ts">
/**
 * MessageBubble — בועת הסוכן עם Markdown (C4).
 *
 * עיצוב מוקאפ 256-262: self-end, avatar agent, bubble-agent token.
 * Markdown נשמר: joinSegmentText + renderMarkdown + DOMPurify.
 *
 * msr-v2: כפתור ▶ להשמעת TTS.
 *
 * ─── redesign-5 (C4) ───
 */
import type { MessageBubble } from "$lib/types/bubble"
import { getBubblePlayer, getI18n } from "$lib/context"
import { renderMarkdown } from "$lib/util/markdown"
import { joinSegmentText } from "./bubble-rendering"
import Avatar from "$lib/components/chat/Avatar.svelte"
import PlayIcon from "@lucide/svelte/icons/play"
import SquareIcon from "@lucide/svelte/icons/square"

let { bubble }: { bubble: MessageBubble } = $props()
const t = getI18n().t
const bubblePlayer = getBubblePlayer()

const isPlaying = $derived(bubblePlayer.playingBubbleId === bubble.id)
</script>

<div class="flex gap-2 self-end max-w-[85%] min-w-0 items-end flex-row-reverse">
  <Avatar kind="agent" />
  <div
    class="px-3.5 py-2.5 rounded-2xl rounded-ee-sm text-sm leading-relaxed min-w-0 break-words"
    style="background:var(--bubble-agent); {isPlaying ? 'outline:2px solid var(--accent); outline-offset:1px' : ''}"
    dir="auto"
  >
    {@html renderMarkdown(joinSegmentText(bubble.segments))}
    <!-- כופה ריאקטיביות של Svelte בעת .segments.push() -->
    <span class="hidden">{bubble.segments.length}</span>
  </div>
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
</div>

<style>
  /* Markdown styling — scoped ב-Tailwind/global עם :global */
  div :global(p) { margin: 0.25em 0; }
  div :global(p:first-child) { margin-top: 0; }
  div :global(p:last-child) { margin-bottom: 0; }
  div :global(strong) { font-weight: 700; }
  div :global(em) { font-style: italic; }
  div :global(code) {
    font-family: ui-monospace, monospace;
    font-size: 0.88em;
    background: rgba(0,0,0,0.25);
    padding: 0.1em 0.3em;
    border-radius: 3px;
    overflow-wrap: anywhere;
  }
  /* code בתוך pre לא נשבר (יש ל-pre overflow-x:auto) */
  div :global(pre code) { overflow-wrap: normal; }
  div :global(pre) {
    background: rgba(0,0,0,0.35);
    padding: 0.6rem 0.8rem;
    border-radius: 6px;
    overflow-x: auto;
    margin: 0.4em 0;
  }
  div :global(pre code) { background: none; padding: 0; font-size: 0.85em; }
  div :global(ul), div :global(ol) { padding-inline-start: 1.4em; margin: 0.3em 0; }
  div :global(li) { margin: 0.15em 0; }
  div :global(h1) { font-size: 1.2em; font-weight: 700; margin: 0.4em 0 0.15em; }
  div :global(h2) { font-size: 1.1em; font-weight: 700; margin: 0.4em 0 0.15em; }
  div :global(h3) { font-size: 1em; font-weight: 700; margin: 0.4em 0 0.15em; }
  div :global(blockquote) {
    border-inline-start: 3px solid var(--border);
    padding-inline-start: 0.7rem;
    margin: 0.3em 0;
    opacity: 0.8;
  }
  div :global(a) { color: var(--accent); text-decoration: underline; }
  div :global(hr) { border: none; border-top: 1px solid var(--border); margin: 0.5em 0; }
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
