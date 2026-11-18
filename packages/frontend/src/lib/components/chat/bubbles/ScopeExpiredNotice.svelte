<script lang="ts">
import PermissionDetailRows from "$lib/components/chat/PermissionDetailRows.svelte"
import { getI18n } from "$lib/context"
import type { ToolBubble } from "$lib/types/bubble"
import { scopeExpiredRows } from "$lib/types/scope-prompt-view"

let { bubble }: { bubble: ToolBubble } = $props()

const t = getI18n().t
const rows = $derived(scopeExpiredRows(bubble.toolCall.args, t))
</script>

<article class="scope-expired-notice" dir="auto">
  <p class="title">{t("scopePrompt.expired")}</p>
  {#if rows.length > 0}
    <PermissionDetailRows {rows} />
  {/if}
</article>

<style>
  .scope-expired-notice {
    border: 1px solid var(--border, #444);
    border-radius: 0.5rem;
    padding: 0.65rem 0.75rem;
    background: var(--bg-elevated, rgba(255, 255, 255, 0.04));
    max-width: 78%;
  }

  .title {
    margin: 0 0 0.35rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--fg);
  }
</style>
