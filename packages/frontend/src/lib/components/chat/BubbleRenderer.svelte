<script lang="ts">
/**
 * BubbleRenderer — מחלק קריאות (switch dispatcher) לכל סוג של Bubble.
 *
 * הוספת סוג חדש של bubble:
 *   1. הוסף את הסוג ל-packages/frontend/src/lib/types/bubble.ts.
 *   2. צור את components/chat/bubbles/<NewKind>Bubble.svelte.
 *   3. הוסף ענף `{:else if bubble.kind === "newkind"}` למטה.
 *
 * לפי parallel-safe-code.md טכניקה #2 (switch dispatcher ברכיב leaf קצה).
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
