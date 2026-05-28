<script lang="ts">
/**
 * ToolBubble — stub.
 *
 * Slice 4 (Bubble polish) will implement the real rendering:
 *   - collapsible details
 *   - status dot (pending / in_progress / completed / failed)
 *   - narration text + technical title fallback
 *   - args summary
 *
 * For now we render a minimal placeholder so the BubbleRenderer switch is
 * exhaustive at the type level.
 */
import type { ToolBubble } from "$lib/types/bubble"
import { getI18n } from "$lib/context"

let { bubble }: { bubble: ToolBubble } = $props()
const t = getI18n().t
</script>

<div class="bubble bubble-tool">
  <div class="kind-label">{t("chat.bubble.agent")}</div>
  <div class="placeholder" dir="ltr">
    [tool: {bubble.toolCall.name} — {bubble.toolCall.status}]
  </div>
</div>

<style>
  .bubble {
    max-width: 80%;
    padding: 0.7rem 0.9rem;
    border-radius: 12px;
    line-height: 1.4;
    align-self: flex-start;
    background: var(--bg-elev);
    border: 1px dotted var(--border);
  }

  .kind-label {
    font-size: 0.7rem;
    opacity: 0.7;
    margin-bottom: 4px;
    font-weight: 600;
  }

  .placeholder {
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
    color: var(--fg-dim);
  }
</style>
