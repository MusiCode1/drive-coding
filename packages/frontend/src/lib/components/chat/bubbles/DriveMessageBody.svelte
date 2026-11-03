<script lang="ts">
/**
 * DriveMessageBody — renders one user bubble according to its envelope kind.
 *
 * Extracted from `UserBubble` while adding the api envelope: the bubble was carrying the
 * whole taxonomy (plain · invalid · agent · api · system) plus four leaf components, none
 * of which has anything to do with playback, copy or timestamps. Adding a fifth source
 * here now costs one branch in one place.
 */
import { getContentViewer, getI18n, getSession } from "$lib/context"
import DriveMessageApiOrigin from "./DriveMessageApiOrigin.svelte"
import DriveMessageEvent from "./DriveMessageEvent.svelte"
import DriveMessageOrigin from "./DriveMessageOrigin.svelte"
import type { DriveMessageView } from "./drive-message-view"
import MarkdownContent from "./MarkdownContent.svelte"

let { view, rawText }: { view: DriveMessageView; rawText: string } = $props()

const t = getI18n().t
const session = getSession()
const viewer = getContentViewer()

const fileLinks = $derived({
  cwd: session.cwd,
  onOpen: (uri: string) => viewer.show({ kind: "file", uri }),
})
</script>

{#if view.kind === "plain"}
  <MarkdownContent text={rawText} imageCwd={session.cwd} {fileLinks} />
{:else if view.kind === "invalid"}
  <p class="drive-envelope-hint">{t("driveMessage.envelope.partial")}</p>
  <pre class="drive-envelope-raw">{rawText}</pre>
{:else if view.kind === "agent"}
  <DriveMessageOrigin
    message={view.message}
    sender={view.sender}
    rawSource={rawText}
    imageCwd={session.cwd}
    {fileLinks}
  />
{:else if view.kind === "api"}
  <DriveMessageApiOrigin
    message={view.message}
    rawSource={rawText}
    imageCwd={session.cwd}
    {fileLinks}
  />
{:else}
  <DriveMessageEvent
    message={view.message}
    subject={view.subject}
    rawSource={rawText}
    imageCwd={session.cwd}
    {fileLinks}
  />
{/if}

<style>
  .drive-envelope-hint {
    font-size: 0.75rem;
    color: var(--fg-dim);
    margin: 0 0 0.35rem;
  }
  .drive-envelope-raw {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.8rem;
  }
</style>
