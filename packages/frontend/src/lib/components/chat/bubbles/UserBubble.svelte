<script lang="ts">
/**
 * UserBubble — בועת משתמש (C4).
 *
 * slice agent-message-envelope-ui C1: envelope display via driveMessageView + leaf components.
 */

import CheckIcon from "@lucide/svelte/icons/check"
import CopyIcon from "@lucide/svelte/icons/copy"
import PlayIcon from "@lucide/svelte/icons/play"
import SquareIcon from "@lucide/svelte/icons/square"
import { env } from "$env/dynamic/public"
import {
  getActiveAgents,
  getBubblePlayer,
  getContentViewer,
  getI18n,
  getSession,
  getSettings,
  getSpeaker,
} from "$lib/context"
import { readSessionTransport } from "$lib/session/session-transport-read"
import type { UserBubble } from "$lib/types/bubble"
import { copyToClipboard } from "$lib/util/clipboard"
import { formatTime } from "$lib/util/formatting"
import { joinSegmentText } from "./bubble-rendering"
import DriveMessageEvent from "./DriveMessageEvent.svelte"
import DriveMessageOrigin from "./DriveMessageOrigin.svelte"
import { driveMessageView } from "./drive-message-view"
import MarkdownContent from "./MarkdownContent.svelte"
import UserBubbleContent from "./UserBubbleContent.svelte"

let { bubble }: { bubble: UserBubble } = $props()
const t = getI18n().t
const bubblePlayer = getBubblePlayer()
const speaker = getSpeaker()
const viewer = getContentViewer()
const session = getSession()
const activeAgents = getActiveAgents()
const settings = getSettings()
const transport = readSessionTransport({
  env: env.PUBLIC_SESSION_TRANSPORT,
  stored: settings.sessionTransport,
})

const rawText = $derived(joinSegmentText(bubble.segments))
const view = $derived(driveMessageView(rawText, { agents: activeAgents.agents, transport }))

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

<div class="user-bubble-outer group">
  <div class="bubble-wrapper">
    <UserBubbleContent {bubble} />
    <div
      class="px-3.5 py-2.5 rounded-2xl rounded-se-sm text-sm leading-relaxed w-max max-w-full break-words"
      style="background:var(--bubble-user); {isPlaying ? 'outline:2px solid var(--accent); outline-offset:1px' : ''}"
    >
      {#if view.kind === "plain"}
        <MarkdownContent
          text={rawText}
          imageCwd={session.cwd}
          fileLinks={{
            cwd: session.cwd,
            onOpen: (uri) => viewer.show({ kind: "file", uri }),
          }}
        />
      {:else if view.kind === "invalid"}
        <p class="drive-envelope-hint">{t("driveMessage.envelope.partial")}</p>
        <pre class="drive-envelope-raw">{rawText}</pre>
      {:else if view.kind === "agent"}
        <DriveMessageOrigin
          message={view.message}
          sender={view.sender}
          rawSource={rawText}
          imageCwd={session.cwd}
          fileLinks={{
            cwd: session.cwd,
            onOpen: (uri) => viewer.show({ kind: "file", uri }),
          }}
        />
      {:else}
        <DriveMessageEvent
          message={view.message}
          subject={view.subject}
          rawSource={rawText}
          imageCwd={session.cwd}
          fileLinks={{
            cwd: session.cwd,
            onOpen: (uri) => viewer.show({ kind: "file", uri }),
          }}
        />
      {/if}
      <span class="hidden">{bubble.segments.length}</span>
    </div>
    <div class="bubble-meta">
      {#if bubble.createdAt}
        <span class="timestamp">{formatTime(bubble.createdAt)}</span>
      {/if}
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
  </div>
</div>

<style>
  .user-bubble-outer {
    max-width: 85cqw;
  }

  @media (min-width: 768px) {
    .user-bubble-outer {
      max-width: calc(85cqw - 1.75rem - 8px);
    }
  }

  .bubble-wrapper {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    width: max-content;
    max-width: 100%;
    align-items: end;
  }

  .bubble-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-inline-end: 0.25rem;
    width: 0;
    min-width: 100%;
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
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s;
  }

  @media (hover: hover) {
    :global(.group):hover .bubble-actions {
      opacity: 1;
    }
  }

  @media (hover: none) {
    .bubble-actions {
      opacity: 1;
    }
  }

  .hidden {
    display: none;
  }
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
  .action-btn:hover {
    opacity: 1;
  }

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
