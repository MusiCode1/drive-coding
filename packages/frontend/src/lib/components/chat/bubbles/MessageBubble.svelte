<script lang="ts">
/**
 * MessageBubble — בועת הסוכן עם Markdown (C4).
 *
 * Markdown: joinSegmentText → MarkdownContent (CSS מרוכז שם).
 *
 * msr-v2: כפתור ▶ להשמעת TTS.
 *
 * ui-polish-batch C3: כפתור העתקה + timestamp.
 *
 * slice/agent-fullwidth: תשובת הסוכן ברוחב מלא — בלי בועה/אווטאר.
 *
 * ─── slice/markdown-content-unify (Commit 1) — CSS עבר ל-MarkdownContent ───
 * ─── slice/msg-diagrams (Commit 2) — onExpand ל-MarkdownContent → viewer.show({kind:"image"}) ───
 */
import type { MessageBubble } from "$lib/types/bubble"
import { getBubblePlayer, getContentViewer, getI18n, getSession, getSpeaker } from "$lib/context"
import { joinSegmentText } from "./bubble-rendering"
import { copyToClipboard } from "$lib/util/clipboard"
import { formatTime } from "$lib/util/formatting"
import MarkdownContent from "./MarkdownContent.svelte"
import PlayIcon from "@lucide/svelte/icons/play"
import SquareIcon from "@lucide/svelte/icons/square"
import CopyIcon from "@lucide/svelte/icons/copy"
import CheckIcon from "@lucide/svelte/icons/check"
import Maximize2Icon from "@lucide/svelte/icons/maximize-2"
import PaperclipIcon from "@lucide/svelte/icons/paperclip"

let { bubble }: { bubble: MessageBubble } = $props()
const t = getI18n().t
const bubblePlayer = getBubblePlayer()
// C10: גייט על speaker.enabled — מסתיר כפתור ▶ כשמושתק
const speaker = getSpeaker()
const session = getSession()
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

<div class="group min-w-0 w-full">
  <div class="bubble-wrapper min-w-0 w-full">
    {#if bubble.contentPlaceholders && bubble.contentPlaceholders.length > 0}
      <div class="flex flex-wrap gap-1.5 mb-1">
        {#each bubble.contentPlaceholders as ph, i (i)}
          {#if ph.kind === "resource_link" && (ph.uri ?? ph.label)}
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
      class="content-body text-sm leading-relaxed min-w-0 max-w-full overflow-hidden break-words"
      class:is-playing={isPlaying}
    >
      <MarkdownContent
        text={joinSegmentText(bubble.segments)}
        imageCwd={session.cwd}
        fileLinks={{
          cwd: session.cwd,
          onOpen: (uri) => viewer.show({ kind: "file", uri }),
          absoluteOnly: true,
        }}
        onExpand={(svg) =>
          viewer.show({
            kind: "image",
            // encodeURIComponent, לא base64: btoa נופל על טקסט עברי בתרשים
            // (InvalidCharacterError) — brief §4 Commit 2 סעיף 2.
            src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
          })}
      />
      <!-- כופה ריאקטיביות של Svelte בעת .segments.push() -->
      <span class="hidden">{bubble.segments.length}</span>
    </div>
    <div class="bubble-meta">
      <span class="timestamp">{formatTime(bubble.createdAt)}</span>
      <div class="bubble-actions">
        <!-- content-viewer: כפתור expand → פתיחת הבועה fullscreen -->
        <button
          class="action-btn"
          onclick={() =>
            viewer.show({
              kind: "markdown",
              text: joinSegmentText(bubble.segments),
              cwd: session.cwd,
            })}
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
  </div>
</div>

<style>
  .bubble-wrapper {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    align-items: stretch;
  }

  .content-body {
    border-inline-start: 2px solid transparent;
    padding-inline-start: 0.5rem;
  }

  .content-body.is-playing {
    border-inline-start-color: var(--accent);
  }

  .bubble-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
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
    flex-direction: row;
    gap: 0.25rem;
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
  }
  button.content-chip {
    font: inherit;
    cursor: pointer;
  }
</style>
