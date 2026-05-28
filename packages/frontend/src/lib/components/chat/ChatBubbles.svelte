<script lang="ts">
import { tick } from "svelte"
import { getI18n, getSession } from "$lib/context"
import BubbleRenderer from "./BubbleRenderer.svelte"

const session = getSession()
const t = getI18n().t

let chatEl = $state<HTMLElement | null>(null)

/**
 * Auto-scroll on new content. We read three reactive values explicitly so
 * the effect re-runs on bubble add, segment add, and text append:
 *   - bubble count
 *   - last bubble's segment count
 *   - last segment's text length
 *
 * Per Svelte 5 + golden rule #4 — effect lives in the component that owns
 * the DOM bind:this.
 */
$effect(() => {
  const _bubbleCount = session.bubbles.length
  const last = session.bubbles[session.bubbles.length - 1]
  const _segCount =
    last !== undefined && last.kind !== "tool" ? last.segments.length : 0
  const _lastSegLen =
    last !== undefined && last.kind !== "tool"
      ? (last.segments[last.segments.length - 1]?.text.length ?? 0)
      : 0
  void _bubbleCount
  void _segCount
  void _lastSegLen
  tick().then(() => {
    if (chatEl) chatEl.scrollTop = chatEl.scrollHeight
  })
})
</script>

<div class="chat" bind:this={chatEl}>
  {#each session.bubbles as bubble (bubble.id)}
    <BubbleRenderer {bubble} />
  {/each}
  {#if session.bubbles.length === 0}
    <div class="empty">{t("chat.empty")}</div>
  {/if}
</div>

<style>
  .chat {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .empty {
    color: var(--muted);
    text-align: center;
    margin: auto;
    font-size: 0.9rem;
  }
</style>
