<script lang="ts">
/**
 * ActivityGroupBubble — collapsed row for a run of thought/tool bubbles.
 *
 * slice compact-activity, Commit 1: local open state (not derived from settings).
 * Uses <button> + {#if open}, not <details> (init-fire under CSR).
 */
import ChevronRightIcon from "@lucide/svelte/icons/chevron-right"
import { getChatScroll, getI18n } from "$lib/context"
import type { Bubble } from "$lib/types/bubble"
import { stableBubbleKey } from "$lib/util/bubble-key"
import BubbleRenderer from "../BubbleRenderer.svelte"
import {
  activityGroupLastSummary,
  countActivityKinds,
  isLastBubbleInProgress,
  uniqueToolKinds,
} from "./activity-group-view"
import ToolKindIcon from "./ToolKindIcon.svelte"

let {
  bubbles,
  allBubbles,
  depth = 0,
}: {
  bubbles: Bubble[]
  allBubbles: readonly Bubble[]
  depth?: number
} = $props()

const t = getI18n().t
const chatScroll = getChatScroll()

let open = $state(false)

const counts = $derived(countActivityKinds(bubbles))
const kinds = $derived(uniqueToolKinds(bubbles))
const lastSummary = $derived(activityGroupLastSummary(bubbles, t("chat.bubble.thought")))
const lastInProgress = $derived(isLastBubbleInProgress(bubbles))

function toggleOpen(): void {
  chatScroll.noteUserIntent?.()
  open = !open
}
</script>

<div class="activity-group w-full min-w-0">
  <button
    type="button"
    class="activity-group-toggle w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-[13px] text-start"
    style="background:var(--bg-card); border-color:var(--border); color:var(--fg-dim)"
    onclick={toggleOpen}
    aria-expanded={open}
    aria-label={open ? t("chat.activityGroup.collapse") : t("chat.activityGroup.expand")}
  >
    <ChevronRightIcon
      size={14}
      strokeWidth={1.75}
      class="shrink-0 transition-transform {open ? 'rotate-90' : ''}"
      aria-hidden="true"
    />

    {#if lastInProgress}
      <span
        class="size-2 rounded-full shrink-0 status-in_progress"
        aria-hidden="true"
      ></span>
    {/if}

    <span class="shrink-0 tabular-nums">
      {counts.toolCount} {t("chat.activityGroup.tools")} · {counts.thoughtCount} {t("chat.activityGroup.thoughts")}
    </span>

    <span class="flex items-center gap-1 shrink-0" aria-hidden="true">
      {#each kinds as kind (kind)}
        <ToolKindIcon {kind} />
      {/each}
    </span>

    {#if lastSummary}
      <span class="flex-1 min-w-0 truncate" dir="auto">{lastSummary}</span>
    {/if}

    <span class="hidden">{bubbles.length}</span>
  </button>

  {#if open}
    <div class="activity-group-body flex flex-col gap-5 pt-5">
      {#each bubbles as b (stableBubbleKey(b, allBubbles))}
        <BubbleRenderer bubble={b} {depth} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .activity-group-toggle {
    cursor: pointer;
    list-style: none;
  }

  .status-in_progress {
    background: #f97316;
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }
</style>
