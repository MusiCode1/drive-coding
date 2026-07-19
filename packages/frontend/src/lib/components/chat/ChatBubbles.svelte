<script lang="ts">
/**
 * ChatBubbles — רשימת בועות שיחה עם windowing (virtua).
 *
 * ─── redesign-2 (אביגיל #2 — scroll ownership) ───
 * הוסר: bind:this={chatEl}, let chatEl, overflow-y:auto, $effect של auto-scroll.
 * ה-scroll עבר ל-AppShell (חוק זהב #4 — ה-$effect חי ב-component שמחזיק את ה-DOM node).
 *
 * הקומפוננטה הזאת היא כעת content בלבד (לא scroll container).
 * עיצוב הבועות = redesign-5 (לא כאן).
 *
 * ─── slice chat-virtualization (Commit 1) ───
 * החלפת {#each} ב-<Virtualizer scrollRef={bridge.scrollEl}>.
 * gap-5 עבר ל-pb-5 פר-item (נמדד כחלק מגובה ה-item).
 * startMargin=80 תואם את ה-pt-20 (80px) של .chat-scroll.
 * {#if chatScroll.scrollEl} מונע mount לפני שה-scrollEl קיים.
 */
import { Virtualizer, type VirtualizerHandle } from "virtua/svelte"
import { getI18n, getSession, getChatScroll } from "$lib/context"
import BubbleRenderer from "./BubbleRenderer.svelte"
import PlanChecklist from "./PlanChecklist.svelte"
import StatusBubble from "./StatusBubble.svelte"

const session = getSession()
const t = getI18n().t
const chatScroll = getChatScroll()

let handle = $state<VirtualizerHandle | undefined>(undefined)

// פרסם handle ל-bridge — ChatBubbles הוא owner ה-Virtualizer
$effect(() => {
  chatScroll.handle = handle ?? null
})
</script>

{#if chatScroll.scrollEl}
  <Virtualizer
    bind:this={handle}
    scrollRef={chatScroll.scrollEl}
    data={session.bubbles}
    getKey={(b) => b.id}
    startMargin={80}
  >
    {#snippet children(bubble)}
      <div class="pb-5"><BubbleRenderer {bubble} /></div>
    {/snippet}
  </Virtualizer>
{/if}
<PlanChecklist />
<StatusBubble />
{#if session.bubbles.length === 0}
  <div class="empty">{t("chat.empty")}</div>
{/if}

<style>
  .empty {
    color: var(--muted);
    text-align: center;
    margin: auto;
    font-size: 0.9rem;
  }
</style>
