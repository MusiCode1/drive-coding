<script lang="ts">
/**
 * ThoughtBubble — מחשבת הסוכן כ**טקסט רץ** (C1 FIX).
 *
 * הבאג: div-per-segment + margin-bottom=0.4em → כל chunk = שורה.
 * התיקון: rendering-only —
 *   - אם **אין** תרגום (originalText=undefined בכולם): joinSegmentText → טקסט רץ אחד.
 *   - אם **יש** תרגום: visibleThoughtSegments → מתורגם, per-segment (segment=משפט, תקין).
 *
 * data-model ב-segments לא שונה — Speaker ממשיך לצרוך כרגיל.
 *
 * עיצוב: מוקאפ 264-278. avatar thought. border-dashed, italic, fg-dim.
 *
 * ─── redesign-5 (C1 fix) ───
 */
import type { ThoughtBubble } from "$lib/types/bubble"
import { getI18n, getBubblePlayer } from "$lib/context"
import { joinSegmentText, visibleThoughtSegments } from "./bubble-rendering"
import Avatar from "$lib/components/chat/Avatar.svelte"

let { bubble }: { bubble: ThoughtBubble } = $props()
const t = getI18n().t
const bubblePlayer = getBubblePlayer()

const isPlaying = $derived(bubblePlayer.playingBubbleId === bubble.id)

// visibleThoughtSegments: אם יש תרגום → מחזיר segments מתורגמים; אחרת → הכל
const displaySegments = $derived(visibleThoughtSegments(bubble.segments))
// האם כל ה-segments הם מקור (לא מתורגמים)?
const isAllOriginal = $derived(displaySegments.every((seg) => seg.originalText === undefined))
// join לטקסט רץ אחד כשהמקור (לא מתורגם)
const runningText = $derived(isAllOriginal ? joinSegmentText(displaySegments) : null)
</script>

<div
  class="flex gap-2 self-end max-w-[85%] min-w-0 items-end flex-row-reverse"
  class:ring-2={isPlaying}
  style={isPlaying ? "ring-color:var(--accent)" : ""}
>
  <Avatar kind="thought" />
  <div
    class="px-3.5 py-2.5 rounded-xl text-[13px] leading-relaxed italic border border-dashed min-w-0 break-words"
    style="border-color:var(--border-str); color:var(--fg-dim)"
  >
    <div class="text-[11px] font-semibold not-italic opacity-70 mb-1">
      {t("chat.bubble.thought")}
    </div>

    {#if runningText !== null}
      <!-- C1 FIX: טקסט רץ (לא מתורגם) — ללא div-per-segment -->
      <div dir="auto" class="whitespace-pre-wrap break-words">{runningText}</div>
    {:else}
      <!-- מתורגם: per-segment תקין (segment = יחידת-תרגום = משפט) -->
      {#each displaySegments as seg (seg.id)}
        <div class="mb-1 last:mb-0">
          <div dir="auto" class="whitespace-pre-wrap break-words">{seg.text}</div>
          {#if seg.originalText !== undefined}
            <div dir="ltr" class="text-[0.82em] opacity-55 mt-0.5 not-italic whitespace-pre-wrap break-words">
              {seg.originalText}
            </div>
          {/if}
        </div>
      {/each}
    {/if}

    <!-- כופה ריאקטיביות של Svelte בעת .segments.push() או כשה-originalText מגיע -->
    <span class="hidden">{bubble.segments.length}</span>
  </div>
  <button
    class="shrink-0 size-6 grid place-items-center rounded-full opacity-60 hover:opacity-100 transition-opacity"
    style="background:var(--bg-card); border:1px solid var(--border); color:var(--fg)"
    onclick={() => bubblePlayer.toggle(bubble.id)}
    aria-label={isPlaying ? t("bubble.stop") : t("bubble.play")}
    title={isPlaying ? t("bubble.stop") : t("bubble.play")}
  >
    {isPlaying ? "⏸" : "▶"}
  </button>
</div>
