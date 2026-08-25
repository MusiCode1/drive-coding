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
 * ui-polish-batch C4: markdown ל-joinSegmentText → MarkdownContent.
 *
 * ─── slice/markdown-content-unify (Commit 1) — CSS עבר ל-MarkdownContent ───
 */

import CheckIcon from "@lucide/svelte/icons/check"
import CopyIcon from "@lucide/svelte/icons/copy"
import PaperclipIcon from "@lucide/svelte/icons/paperclip"
import PlayIcon from "@lucide/svelte/icons/play"
import SquareIcon from "@lucide/svelte/icons/square"
import Avatar from "$lib/components/chat/Avatar.svelte"
import { getBubblePlayer, getContentViewer, getI18n, getSpeaker } from "$lib/context"
import type { UserBubble } from "$lib/types/bubble"
import { copyToClipboard } from "$lib/util/clipboard"
import { formatTime } from "$lib/util/formatting"
import { joinSegmentText } from "./bubble-rendering"
import MarkdownContent from "./MarkdownContent.svelte"

let { bubble }: { bubble: UserBubble } = $props()
const t = getI18n().t
const bubblePlayer = getBubblePlayer()
// C10: גייט על speaker.enabled — מסתיר כפתור ▶ כשמושתק
const speaker = getSpeaker()
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

<div class="flex gap-2 self-start max-w-[85%] min-w-0 items-end group">
  <Avatar kind="user" />
  <div class="bubble-wrapper min-w-0 flex-1">
    <!-- תמונות מצורפות (slice-image-paste Commit 3) -->
    {#if bubble.attachments && bubble.attachments.length > 0}
      <div class="flex flex-wrap gap-1.5 mb-1">
        {#each bubble.attachments as att, i (i)}
          <button
            class="user-image-btn"
            onclick={() => viewer.show({ kind: "image", src: `data:${att.mimeType};base64,${att.dataBase64}`, alt: "" })}
            aria-label={t("contentViewer.expand")}
            title={t("contentViewer.expand")}
          >
            <img
              src="data:{att.mimeType};base64,{att.dataBase64}"
              alt=""
              class="max-h-40 max-w-[12rem] rounded-xl object-contain border"
              style="border-color:var(--border)"
            />
          </button>
        {/each}
      </div>
    {/if}
    <!-- §11.3א: placeholder chips לתוכן לא-טקסטואלי מ-replay (resource_link / audio / resource) -->
    {#if bubble.contentPlaceholders && bubble.contentPlaceholders.length > 0}
      <div class="flex flex-wrap gap-1.5 mb-1">
        {#each bubble.contentPlaceholders as ph, i (i)}
          {#if ph.kind === "resource_link" && (ph.uri ?? ph.label)}
            <!-- slice fs-file-proxy — chip לחיץ, פותח ContentViewer עם kind:"file" -->
            <button
              type="button"
              class="content-chip"
              title={t("chat.content.attachedFile")}
              aria-label={t("chat.content.attachedFile")}
              onclick={() => viewer.show({ kind: "file", uri: (ph.uri ?? ph.label) as string })}
            >
              <PaperclipIcon size={12} strokeWidth={2} />
              {ph.label}
            </button>
          {:else if ph.kind === "resource_link"}
            <span
              class="content-chip"
              title={t("chat.content.attachedFile")}
              aria-label={t("chat.content.attachedFile")}
            >
              <PaperclipIcon size={12} strokeWidth={2} />
              {ph.label}
            </span>
          {:else}
            <span class="content-chip" title={t("chat.content.unsupported")} aria-label={t("chat.content.unsupported")}>
              {t("chat.content.unsupported")}
            </span>
          {/if}
        {/each}
      </div>
    {/if}
    <div
      class="px-3.5 py-2.5 rounded-2xl rounded-es-sm text-sm leading-relaxed min-w-0 max-w-full overflow-hidden break-words"
      style="background:var(--bubble-user); {isPlaying ? 'outline:2px solid var(--accent); outline-offset:1px' : ''}"
    >
      <MarkdownContent text={joinSegmentText(bubble.segments)} />
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

  /* §12: lightbox לתמונת-משתמש */
  .user-image-btn {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    display: inline-flex;
  }

  /* §11.3א: chip לתוכן לא-טקסטואלי מ-replay */
  .content-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
    border-radius: 0.75rem;
    border: 1px solid var(--border);
    background: var(--bg-card);
    color: var(--fg-dim);
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* slice fs-file-proxy — chip הפך ל-<button> כשיש uri (ר' תבנית .user-image-btn) */
  button.content-chip {
    font: inherit;
    cursor: pointer;
  }
</style>
