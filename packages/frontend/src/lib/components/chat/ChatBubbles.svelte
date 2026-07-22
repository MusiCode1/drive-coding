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
import { getChatScroll, getI18n, getSession } from "$lib/context"
import { stableBubbleKey } from "$lib/util/bubble-key"
import BubbleRenderer from "./BubbleRenderer.svelte"
import ElicitationDialog from "./ElicitationDialog.svelte"
import PermissionRequestBlock from "./PermissionRequestBlock.svelte"
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
    data={session.renderBubbles}
    getKey={stableBubbleKey}
    startMargin={80}
  >
    {#snippet children(bubble)}
      <div class="pb-5"><BubbleRenderer {bubble} /></div>
    {/snippet}
  </Virtualizer>
{/if}
<PlanChecklist />
<StatusBubble />
<!-- slice-permission-ui-basic: inline, אחרי ה-Virtualizer (לא בתוך ה-snippet המווירטואל) -->
{#if session.pendingPermission}
  <PermissionRequestBlock
    params={session.pendingPermission.params}
    onResolve={(optionId) => session.resolvePermission(optionId)}
    onCancel={() => session.cancelPermission()}
  />
{/if}
<!-- slice-elicitation-ui: אותו מקום כמו PermissionRequestBlock — inline, אחרי ה-Virtualizer -->
<!-- {#key} → כל בקשה חדשה/supersede מקבלת instance טרי עם אתחול-ערכים סינכרוני (calev NO-GO r2 fix) -->
{#if session.pendingElicitation}
  {#key session.pendingElicitation}
    <ElicitationDialog
      params={session.pendingElicitation.params}
      onResolve={(content) => session.resolveElicitation(content)}
      onDecline={() => session.cancelElicitation("decline")}
      onCancel={() => session.cancelElicitation("cancel")}
    />
  {/key}
{/if}
{#if session.renderBubbles.length === 0}
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
