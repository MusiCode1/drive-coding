<script lang="ts">
/**
 * DriveMessageOrigin — agent envelope leaf (slice agent-message-envelope-ui C1).
 */
import type { DriveMessageAgent } from "@drive-coding/core/acp/drive-message-envelope"
import { getI18n } from "$lib/context"
import type { DriveMessageParty } from "./drive-message-view"
import type { FileLinkParams } from "./enhance-file-links"
import MarkdownContent from "./MarkdownContent.svelte"

let {
  message,
  sender,
  rawSource,
  imageCwd = null,
  fileLinks,
}: {
  message: DriveMessageAgent
  sender: DriveMessageParty
  rawSource: string
  imageCwd?: string | null
  fileLinks?: Omit<FileLinkParams, "text" | "label" | "enabled">
} = $props()

const t = getI18n().t
</script>

<div class="drive-msg-origin">
  <div class="drive-msg-header">
    <span class="drive-msg-kind">{t("driveMessage.agent.label")}</span>
    <span class="drive-msg-sep" aria-hidden="true">·</span>
    {#if sender.href}
      <a class="drive-msg-name" href={sender.href}>{sender.displayName}</a>
    {:else}
      <span class="drive-msg-name">{sender.displayName}</span>
    {/if}
  </div>
  {#if message.context}
    <details class="drive-msg-context">
      <summary>{t("driveMessage.context.summary")}</summary>
      <p class="drive-msg-context-text">{message.context.text}</p>
    </details>
  {/if}
  <MarkdownContent
    text={message.body}
    {imageCwd}
    fileLinks={fileLinks ? { ...fileLinks, absoluteOnly: true } : undefined}
  />
  <details class="drive-msg-source">
    <summary>{t("driveMessage.showSource")}</summary>
    <pre class="drive-msg-raw">{rawSource}</pre>
  </details>
</div>

<style>
  .drive-msg-header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: var(--fg-dim);
    margin-bottom: 0.35rem;
  }
  .drive-msg-kind {
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  .drive-msg-name {
    font-weight: 500;
    color: var(--fg);
  }
  a.drive-msg-name {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .drive-msg-context {
    margin-bottom: 0.35rem;
    font-size: 0.8rem;
  }
  .drive-msg-context summary {
    cursor: pointer;
    list-style: none;
  }
  .drive-msg-context-text {
    margin: 0.25rem 0 0;
    white-space: pre-wrap;
  }
  .drive-msg-source {
    margin-top: 0.5rem;
    font-size: 0.75rem;
  }
  .drive-msg-source summary {
    cursor: pointer;
    list-style: none;
  }
  .drive-msg-raw {
    margin: 0.35rem 0 0;
    max-height: 12rem;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.7rem;
  }
</style>
