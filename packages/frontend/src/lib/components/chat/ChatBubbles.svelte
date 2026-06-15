<script lang="ts">
/**
 * ChatBubbles — רשימת בועות שיחה.
 *
 * ─── redesign-2 (אביגיל #2 — scroll ownership) ───
 * הוסר: bind:this={chatEl}, let chatEl, overflow-y:auto, $effect של auto-scroll.
 * ה-scroll עבר ל-AppShell (חוק זהב #4 — ה-$effect חי ב-component שמחזיק את ה-DOM node).
 *
 * הקומפוננטה הזאת היא כעת content בלבד (לא scroll container).
 * עיצוב הבועות = redesign-5 (לא כאן).
 */
import { getI18n, getSession } from "$lib/context"
import BubbleRenderer from "./BubbleRenderer.svelte"
import StatusBubble from "./StatusBubble.svelte"

const session = getSession()
const t = getI18n().t
</script>

{#each session.bubbles as bubble (bubble.id)}
  <BubbleRenderer {bubble} />
{/each}
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
