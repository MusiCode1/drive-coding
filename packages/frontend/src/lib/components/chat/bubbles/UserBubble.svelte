<script lang="ts">
/**
 * UserBubble — בועת משתמש (C4).
 *
 * עיצוב מוקאפ 249-255: self-start, avatar user, bubble-user token.
 * flex gap-2 self-start items-end.
 *
 * msr-v2: כפתור ▶ אם recordingId קיים.
 *
 * ui-polish-batch C3: כפתור העתקה + timestamp.
 * ui-polish-batch C4: markdown ל-joinSegmentText.
 * ui-polish-batch C5: :global(pre),:global(code){direction:ltr;text-align:left}
 *
 * ─── redesign-5 (C4) ───
 */
import type { UserBubble } from "$lib/types/bubble"
import { getBubblePlayer, getI18n, getSpeaker } from "$lib/context"
import Avatar from "$lib/components/chat/Avatar.svelte"
import { joinSegmentText } from "./bubble-rendering"
import { renderMarkdown } from "$lib/util/markdown"
import { copyToClipboard } from "$lib/util/clipboard"
import { formatTime } from "$lib/util/formatting"
import PlayIcon from "@lucide/svelte/icons/play"
import SquareIcon from "@lucide/svelte/icons/square"
import CopyIcon from "@lucide/svelte/icons/copy"
import CheckIcon from "@lucide/svelte/icons/check"

let { bubble }: { bubble: UserBubble } = $props()
const t = getI18n().t
const bubblePlayer = getBubblePlayer()
// C10: גייט על speaker.enabled — מסתיר כפתור ▶ כשמושתק
const speaker = getSpeaker()

const isPlaying = $derived(bubblePlayer.playingBubbleId === bubble.id)

let copied = $state(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

async function handleCopy() {
  const text = joinSegmentText(bubble.segments)
  const ok = await copyToClipboard(text)
  if (ok) {
    copied = true
    if (copyTimer !== null) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied = false
      copyTimer = null
    }, 2000)
  }
}
</script>

<div class="flex gap-2 self-start max-w-[85%] min-w-0 items-end group">
  <Avatar kind="user" />
  <div class="bubble-wrapper min-w-0 flex-1">
    <div
      class="px-3.5 py-2.5 rounded-2xl rounded-es-sm text-sm leading-relaxed min-w-0 max-w-full overflow-hidden break-words"
      style="background:var(--bubble-user); {isPlaying ? 'outline:2px solid var(--accent); outline-offset:1px' : ''}"
      dir="auto"
    >
      {@html renderMarkdown(joinSegmentText(bubble.segments))}
      <!-- כופה ריאקטיביות -->
      <span class="hidden">{bubble.segments.length}</span>
    </div>
    <div class="bubble-meta">
      <span class="timestamp">{formatTime(bubble.createdAt)}</span>
    </div>
  </div>
  <!-- כפתורי פעולה: copy + play (play רק אם recordingId קיים) -->
  <div class="bubble-actions">
    <button
      class="action-btn"
      onclick={handleCopy}
      aria-label={copied ? t("bubble.copied") : t("bubble.copy")}
      title={copied ? t("bubble.copied") : t("bubble.copy")}
    >
      {#if copied}
        <CheckIcon size={12} strokeWidth={2} />
      {:else}
        <CopyIcon size={12} strokeWidth={2} />
      {/if}
    </button>
    {#if bubble.recordingId && speaker.enabled}
      <button
        class="action-btn play-btn"
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
</div>

<style>
  .bubble-wrapper {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    align-items: flex-start;
  }

  .bubble-meta {
    display: flex;
    justify-content: flex-start;
    padding-inline-start: 0.25rem;
  }

  .timestamp {
    font-size: 0.7rem;
    color: var(--fg-dim);
    opacity: 0.6;
    direction: ltr;
  }

  .bubble-actions {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    align-self: flex-end;
    /* מוסתר ב-desktop עד hover */
    opacity: 0;
    transition: opacity 0.15s;
  }

  /* Desktop: hover על ה-group מציג את הכפתורים */
  @media (hover: hover) {
    :global(.group):hover .bubble-actions {
      opacity: 1;
    }
  }

  /* Mobile: כפתורים תמיד גלויים */
  @media (hover: none) {
    .bubble-actions {
      opacity: 1;
    }
  }

  /* C5: code blocks כיוון LTR */
  :global(pre), :global(code) { direction: ltr; text-align: left; }
  /* markdown — code ארוך נשבר במקום לגלוש מהבועה */
  div :global(code) {
    font-family: ui-monospace, monospace;
    font-size: 0.88em;
    background: rgba(0,0,0,0.2);
    padding: 0.1em 0.3em;
    border-radius: 3px;
    overflow-wrap: anywhere;
  }
  div :global(pre) {
    background: rgba(0,0,0,0.28);
    padding: 0.6rem 0.8rem;
    border-radius: 6px;
    margin: 0.4em 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    overflow-x: auto;
  }
  div :global(pre code) { background: none; padding: 0; font-size: 0.85em; }

  .hidden { display: none; }
  .action-btn {
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
  .action-btn:hover { opacity: 1; }
</style>
