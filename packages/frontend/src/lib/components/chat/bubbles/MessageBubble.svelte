<script lang="ts">
import type { MessageBubble } from "$lib/types/bubble"
import { getI18n } from "$lib/context"

let { bubble }: { bubble: MessageBubble } = $props()
const t = getI18n().t
</script>

<div class="bubble bubble-message">
  <div class="kind-label">{t("chat.bubble.agent")}</div>
  <div class="text">
    {#each bubble.segments as seg (seg.id)}<span>{seg.text}</span>{/each}
    <span class="hidden">{bubble.segments.length}</span>
  </div>
</div>

<style>
  .bubble {
    max-width: 80%;
    padding: 0.7rem 0.9rem;
    border-radius: 12px;
    line-height: 1.4;
  }

  .bubble-message {
    align-self: flex-start;
    background: var(--bg-elev);
    border: 1px solid var(--border);
  }

  .kind-label {
    font-size: 0.7rem;
    opacity: 0.7;
    margin-bottom: 4px;
    font-weight: 600;
  }

  .text {
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .text > .hidden {
    display: none;
  }
</style>
