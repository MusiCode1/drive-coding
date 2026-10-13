<script lang="ts">
/**
 * DriveMessageEvent — system envelope leaf (slice agent-message-envelope-ui C1).
 */
import type { DriveMessageSystem } from "@drive-coding/core/acp/drive-message-envelope"
import { getI18n } from "$lib/context"
import DriveMessageSource from "./DriveMessageSource.svelte"
import type { DriveMessageParty } from "./drive-message-view"
import type { FileLinkParams } from "./enhance-file-links"
import MarkdownContent from "./MarkdownContent.svelte"

let {
  message,
  subject,
  rawSource,
  imageCwd = null,
  fileLinks,
}: {
  message: DriveMessageSystem
  subject: DriveMessageParty
  rawSource: string
  imageCwd?: string | null
  fileLinks?: Omit<FileLinkParams, "text" | "label" | "enabled">
} = $props()

const i18n = getI18n()
const t = i18n.t

function formatAt(at: number): string {
  const loc = i18n.locale === "he" ? "he-IL" : "en-US"
  return new Intl.DateTimeFormat(loc, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(at),
  )
}

function formatSilentMs(ms: number): string {
  if (ms >= 86_400_000) return `${Math.round(ms / 86_400_000)}d`
  if (ms >= 3_600_000) return `${Math.round(ms / 3_600_000)}h`
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`
  return `${Math.round(ms / 1000)}s`
}

const headlineSuffix = $derived.by(() => {
  if (message.eventKind === "stall-suspected") return t("driveMessage.system.stallSuspected")
  if (message.lastTurnError) return t("driveMessage.system.turnEndedError")
  return t("driveMessage.system.turnEndedSuffix")
})
</script>

<div class="drive-msg-event">
  <div class="drive-msg-event-head">
    <span class="drive-msg-kind">{t("driveMessage.system.alert")}</span>
    <span class="drive-msg-sep" aria-hidden="true">·</span>
    {#if subject.href}
      <a class="drive-msg-name" href={subject.href}>{subject.displayName}</a>
    {:else}
      <span class="drive-msg-name">{subject.displayName}</span>
    {/if}
    <span class="drive-msg-event-title">{headlineSuffix}</span>
  </div>
  {#if message.context}
    <details class="drive-msg-context">
      <summary>{t("driveMessage.context.summary")}</summary>
      <p class="drive-msg-context-text">{message.context.text}</p>
    </details>
  {/if}
  <time class="drive-msg-event-time" datetime={new Date(message.at).toISOString()}>{formatAt(message.at)}</time>

  {#if message.eventKind === "stall-suspected" && message.silentMs !== undefined}
    <p class="drive-msg-event-silent">
      {t("driveMessage.system.silentPrefix")}
      <span dir="ltr">{formatSilentMs(message.silentMs)}</span>
      {t("driveMessage.system.silentSuffix")}
    </p>
  {/if}

  {#if message.lastAssistantText}
    <section class="drive-msg-quote">
      <h4 class="drive-msg-quote-label">{t("driveMessage.system.quoteSection")}</h4>
      {#if message.lastAssistantText.truncated}
        <p class="drive-msg-quote-trunc">{t("driveMessage.system.quoteTruncated")}</p>
      {/if}
      <MarkdownContent
        text={message.lastAssistantText.text}
        {imageCwd}
        fileLinks={fileLinks ? { ...fileLinks, absoluteOnly: true } : undefined}
      />
    </section>
  {/if}

  {#if message.lastTurnError}
    <p class="drive-msg-event-error">{message.lastTurnError.message}</p>
  {/if}

  <div class="drive-msg-event-actions">
    {#if subject.href}
      <a class="drive-msg-link" href={subject.href}>{t("driveMessage.system.openChat")}</a>
    {/if}
    <details class="drive-msg-details">
      <summary>{t("driveMessage.system.details")}</summary>
      <dl class="drive-msg-dl">
        <dt>{t("driveMessage.system.detail.eventKind")}</dt>
        <dd>{message.eventKind}</dd>
        <dt>{t("driveMessage.system.detail.subjectId")}</dt>
        <dd dir="ltr">{subject.id}</dd>
        <dt>{t("driveMessage.system.detail.at")}</dt>
        <dd dir="ltr">{message.at}</dd>
        {#if message.stopReason}
          <dt>{t("driveMessage.system.detail.stopReason")}</dt>
          <dd>{message.stopReason}</dd>
        {/if}
        {#if message.silentMs !== undefined}
          <dt>{t("driveMessage.system.detail.silentMs")}</dt>
          <dd dir="ltr">{message.silentMs}</dd>
        {/if}
        {#if message.lastTurnError}
          <dt>{t("driveMessage.system.detail.error")}</dt>
          <dd>{message.lastTurnError.message}</dd>
        {/if}
      </dl>
    </details>
    <details class="drive-msg-source">
      <summary>{t("driveMessage.showSource")}</summary>
      <DriveMessageSource text={rawSource} />
    </details>
  </div>
</div>

<style>
  .drive-msg-context {
    margin: 0.35rem 0;
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
  .drive-msg-event-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem;
    font-size: 0.8rem;
    font-weight: 500;
  }
  .drive-msg-kind {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--fg-dim);
  }
  .drive-msg-name {
    font-weight: 600;
  }
  a.drive-msg-name,
  .drive-msg-link {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .drive-msg-event-time {
    display: block;
    font-size: 0.75rem;
    color: var(--fg-dim);
    margin-top: 0.15rem;
  }
  .drive-msg-event-silent {
    font-size: 0.8rem;
    margin: 0.35rem 0 0;
  }
  .drive-msg-quote {
    margin-top: 0.5rem;
    padding-top: 0.35rem;
    border-top: 1px solid var(--border);
  }
  .drive-msg-quote-label {
    font-size: 0.75rem;
    font-weight: 600;
    margin: 0 0 0.25rem;
  }
  .drive-msg-quote-trunc {
    font-size: 0.7rem;
    color: var(--fg-dim);
    margin: 0 0 0.25rem;
  }
  .drive-msg-event-error {
    margin: 0.35rem 0 0;
    color: #f87171;
    font-size: 0.85rem;
    white-space: pre-wrap;
  }
  .drive-msg-event-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 0.5rem;
    font-size: 0.75rem;
  }
  .drive-msg-details summary,
  .drive-msg-source summary {
    cursor: pointer;
    list-style: none;
  }
  .drive-msg-dl {
    margin: 0.35rem 0 0;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.15rem 0.75rem;
    font-size: 0.7rem;
  }
  .drive-msg-dl dt {
    color: var(--fg-dim);
  }
</style>
