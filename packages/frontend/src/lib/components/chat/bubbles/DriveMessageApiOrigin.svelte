<script lang="ts">
/**
 * DriveMessageApiOrigin — api envelope leaf.
 *
 * 🔑 The wording carries the uncertainty so no disclaimer has to. Hebrew "מזדהה כ" means
 * "identifies itself as", which states a claim rather than a fact — an earlier draft read
 * "API · what the caller said", and that put a meta-comment where a name belongs.
 *
 * 🛑 **No link, and never the `sender` treatment.** `DriveMessageOrigin` renders a name
 * resolved from our registry and links to that agent's session. Everything here is free
 * text from the caller. If the two looked alike, the API would become a way to forge a
 * verified agent identity — the thing this envelope exists to prevent.
 */
import type { DriveMessageApi } from "@drive-coding/core/acp/drive-message-envelope"
import { getI18n } from "$lib/context"
import DriveMessageSource from "./DriveMessageSource.svelte"
import type { FileLinkParams } from "./enhance-file-links"
import MarkdownContent from "./MarkdownContent.svelte"

let {
  message,
  rawSource,
  imageCwd = null,
  fileLinks,
}: {
  message: DriveMessageApi
  rawSource: string
  imageCwd?: string | null
  fileLinks?: Omit<FileLinkParams, "text" | "label" | "enabled">
} = $props()

const t = getI18n().t

const declaredName = $derived(
  message.caller?.name !== undefined && message.caller.name.trim() !== ""
    ? message.caller.name
    : null,
)

/** Known kinds get a specific noun; anything else falls back to a bare claim. */
const claimPrefix = $derived.by(() => {
  const kind = message.caller?.kind
  if (kind === "agent") return t("driveMessage.api.claimsAgent")
  if (kind === "tool") return t("driveMessage.api.claimsTool")
  return t("driveMessage.api.claims")
})
</script>

<div class="drive-msg-origin">
  <div class="drive-msg-header">
    <span class="drive-msg-kind">{t("driveMessage.api.label")}</span>
    {#if declaredName}
      <span class="drive-msg-sep" aria-hidden="true">·</span>
      <span>{claimPrefix}</span>
      <span class="drive-msg-claim">{declaredName}</span>
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
    <DriveMessageSource text={rawSource} />
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
  }
  /* Deliberately not .drive-msg-name: a declared origin must not look like a resolved one. */
  .drive-msg-claim {
    font-style: italic;
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
</style>
