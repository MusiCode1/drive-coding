<script lang="ts">
/**
 * UserBubbleContent — attachments + content placeholders (slice agent-message-envelope-ui C1).
 */
import PaperclipIcon from "@lucide/svelte/icons/paperclip"
import { getContentViewer, getI18n } from "$lib/context"
import type { UserBubble } from "$lib/types/bubble"

let { bubble }: { bubble: UserBubble } = $props()

const t = getI18n().t
const viewer = getContentViewer()
</script>

{#if bubble.attachments && bubble.attachments.length > 0}
  <div class="flex flex-wrap gap-1.5 mb-1">
    {#each bubble.attachments as att, i (i)}
      <button
        class="user-image-btn"
        onclick={() =>
          viewer.show({ kind: "image", src: `data:${att.mimeType};base64,${att.dataBase64}`, alt: "" })}
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

<style>
  .user-image-btn {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    display: inline-flex;
  }

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

  button.content-chip {
    font: inherit;
    cursor: pointer;
  }
</style>
