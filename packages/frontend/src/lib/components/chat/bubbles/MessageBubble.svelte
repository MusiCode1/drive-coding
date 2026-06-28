<script lang="ts">
/**
 * MessageBubble — בועת הסוכן עם Markdown (C4).
 *
 * עיצוב מוקאפ 256-262: self-end, avatar agent, bubble-agent token.
 * Markdown: joinSegmentText → MarkdownContent (CSS מרוכז שם).
 *
 * msr-v2: כפתור ▶ להשמעת TTS.
 *
 * ui-polish-batch C3: כפתור העתקה + timestamp.
 *
 * ─── slice/markdown-content-unify (Commit 1) — CSS עבר ל-MarkdownContent ───
 */
import type { MessageBubble } from "$lib/types/bubble"
import { getBubblePlayer, getContentViewer, getI18n, getSpeaker } from "$lib/context"
import { joinSegmentText } from "./bubble-rendering"
import { copyToClipboard } from "$lib/util/clipboard"
import { formatTime } from "$lib/util/formatting"
import Avatar from "$lib/components/chat/Avatar.svelte"
import MarkdownContent from "./MarkdownContent.svelte"
import PlayIcon from "@lucide/svelte/icons/play"
import SquareIcon from "@lucide/svelte/icons/square"
import CopyIcon from "@lucide/svelte/icons/copy"
import CheckIcon from "@lucide/svelte/icons/check"
import Maximize2Icon from "@lucide/svelte/icons/maximize-2"

let { bubble }: { bubble: MessageBubble } = $props()
const t = getI18n().t
const bubblePlayer = getBubblePlayer()
// C10: גייט על speaker.enabled — מסתיר כפתור ▶ כשמושתק
const speaker = getSpeaker()
// content-viewer: כפתור expand לפתיחת הבועה fullscreen
const viewer = getContentViewer()

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

<div class="flex gap-2 self-end max-w-[85%] min-w-0 items-end flex-row-reverse group">
  <Avatar kind="agent" />
  <div class="bubble-wrapper min-w-0 flex-1">
    <div
      class="px-3.5 py-2.5 rounded-2xl rounded-ee-sm text-sm leading-relaxed min-w-0 max-w-full overflow-hidden break-words"
      style="background:var(--bubble-agent); {isPlaying ? 'outline:2px solid var(--accent); outline-offset:1px' : ''}"
      dir="auto"
    >
      <MarkdownContent text={joinSegmentText(bubble.segments)} />
      <!-- כופה ריאקטיביות של Svelte בעת .segments.push() -->
      <span class="hidden">{bubble.segments.length}</span>
    </div>
    <div class="bubble-meta">
      <span class="timestamp">{formatTime(bubble.createdAt)}</span>
    </div>
  </div>
  <!-- כפתורי פעולה: expand + copy + play -->
  <div class="bubble-actions">
    <!-- content-viewer: כפתור expand → פתיחת הבועה fullscreen -->
    <button
      class="action-btn"
      onclick={() => viewer.show({ kind: "markdown", text: joinSegmentText(bubble.segments) })}
      aria-label={t("contentViewer.expand")}
      title={t("contentViewer.expand")}
    >
      <Maximize2Icon size={12} strokeWidth={2} />
    </button>
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
    {#if speaker.enabled}
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
    align-items: flex-end;
  }

  .bubble-meta {
    display: flex;
    justify-content: flex-end;
    padding-inline-end: 0.25rem;
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
