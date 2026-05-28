<script lang="ts">
/**
 * BubbleRenderer — switch dispatcher per Bubble variant.
 *
 * Adding a new bubble kind:
 *   1. Add the variant to packages/frontend/src/lib/types/bubble.ts.
 *   2. Create components/chat/bubbles/<NewKind>Bubble.svelte.
 *   3. Add an `{:else if bubble.kind === "newkind"}` branch below.
 *
 * Per parallel-safe-code.md technique #2 (switch dispatcher in leaf component).
 */
import type { Bubble } from "$lib/types/bubble"
import UserBubble from "./bubbles/UserBubble.svelte"
import MessageBubble from "./bubbles/MessageBubble.svelte"
import ThoughtBubble from "./bubbles/ThoughtBubble.svelte"
import ToolBubble from "./bubbles/ToolBubble.svelte"

let { bubble }: { bubble: Bubble } = $props()
</script>

{#if bubble.kind === "user"}
  <UserBubble {bubble} />
{:else if bubble.kind === "message"}
  <MessageBubble {bubble} />
{:else if bubble.kind === "thought"}
  <ThoughtBubble {bubble} />
{:else if bubble.kind === "tool"}
  <ToolBubble {bubble} />
{/if}
