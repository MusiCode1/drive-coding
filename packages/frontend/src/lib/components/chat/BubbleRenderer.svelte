<script lang="ts">
/**
 * BubbleRenderer — מחלק קריאות (switch dispatcher) לכל סוג של Bubble.
 *
 * הוספת סוג חדש של bubble:
 *   1. הוסף את הסוג ל-packages/frontend/src/lib/types/bubble.ts.
 *   2. צור את components/chat/bubbles/<NewKind>Bubble.svelte.
 *   3. הוסף ענף `{:else if bubble.kind === "newkind"}` למטה.
 *
 * switch dispatcher ברכיב leaf קצה — כל סוג-בועה חדש נוגע רק בענף שלו,
 * כך ששני slices מקבילים לא מתנגשים באותן שורות.
 *
 * ─── slice/subagent-transcript-render (Commit 1) — ענף tool מתפצל ל-SubagentBubble/ToolBubble ───
 * prop `depth` — מונע recursion runaway ב-Task-בתוך-Task (SubagentBubble מעביר depth+1;
 * מעבר ל-MAX_NEST_DEPTH מרונדר Task מקונן כ-ToolBubble שטוח, בלי transcript מקונן).
 */
import type { Bubble } from "$lib/types/bubble"
import { isSubagentTask } from "./bubbles/bubble-rendering"
import UserBubble from "./bubbles/UserBubble.svelte"
import MessageBubble from "./bubbles/MessageBubble.svelte"
import ThoughtBubble from "./bubbles/ThoughtBubble.svelte"
import ToolBubble from "./bubbles/ToolBubble.svelte"
import SubagentBubble from "./bubbles/SubagentBubble.svelte"

const MAX_NEST_DEPTH = 1

let { bubble, depth = 0 }: { bubble: Bubble; depth?: number } = $props()
</script>

{#if bubble.kind === "user"}
  <UserBubble {bubble} />
{:else if bubble.kind === "message"}
  <MessageBubble {bubble} />
{:else if bubble.kind === "thought"}
  <ThoughtBubble {bubble} />
{:else if bubble.kind === "tool"}
  {#if isSubagentTask(bubble) && depth < MAX_NEST_DEPTH}
    <SubagentBubble {bubble} {depth} />
  {:else}
    <ToolBubble {bubble} />
  {/if}
{/if}
