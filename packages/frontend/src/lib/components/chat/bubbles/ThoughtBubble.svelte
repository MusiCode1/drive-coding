<script lang="ts">
/**
 * ThoughtBubble — מחשבת הסוכן כ**טקסט רץ** (C1 FIX).
 *
 * הבאג: div-per-segment + margin-bottom=0.4em → כל chunk = שורה.
 * התיקון: rendering-only —
 *   - אם **אין** תרגום (originalText=undefined בכולם): joinSegmentText → MarkdownContent.
 *   - אם **יש** תרגום: visibleThoughtSegments → מתורגם, per-segment + MarkdownContent לטקסט.
 *   - originalText (raw source) נשאר טקסט גולמי dir=ltr — אינו מרקדאון.
 *
 * data-model ב-segments לא שונה — Speaker ממשיך לצרוך כרגיל.
 *
 * עיצוב: מוקאפ 264-278. avatar thought. border-dashed, italic, fg-dim.
 * MarkdownContent יורש italic/color מההורה; code/pre כופים direction:ltr.
 *
 * ─── slice/markdown-content-unify (Commit 2) — מרקדאון מלא בבועת-מחשבה ───
 */
import type { ThoughtBubble } from "$lib/types/bubble"
import { getI18n, getSettings, getChatScroll } from "$lib/context"
import { joinSegmentText, visibleThoughtSegments } from "./bubble-rendering"
import MarkdownContent from "./MarkdownContent.svelte"
import { settingBackedOpen } from "./setting-backed-open.svelte"
import { onMount } from "svelte"

let { bubble }: { bubble: ThoughtBubble } = $props()
const t = getI18n().t
const settings = getSettings()

// visibleThoughtSegments: אם יש תרגום → מחזיר segments מתורגמים; אחרת → הכל
const displaySegments = $derived(visibleThoughtSegments(bubble.segments))
// האם כל ה-segments הם מקור (לא מתורגמים)?
const isAllOriginal = $derived(displaySegments.every((seg) => seg.originalText === undefined))
// join לטקסט רץ אחד כשהמקור (לא מתורגם)
const runningText = $derived(isAllOriginal ? joinSegmentText(displaySegments) : null)

const open = settingBackedOpen(() => settings.showThoughts)

// ─── toggle-intent (slice chat-virtualization, Commit 3 / fix) ───
// chatScroll נקרא ב-component init (חוקי) — לא בתוך ה-callback.
// guard ל-init-fire: ThoughtBubble פתוח כברירת-מחדל (showThoughts=true).
// <details bind:open=$state(true)> תחת CSR מתזמן toggle event ב-mount → init-fire.
// rAF אחרי mount מסנן את ה-fire הראשון (task-from-mount קודם ל-rAF).
const chatScroll = getChatScroll()
let ready = false
onMount(() => requestAnimationFrame(() => { ready = true }))
const onUserToggle = () => { if (ready) chatScroll.noteUserIntent?.() }
</script>

<div
  class="px-3.5 py-2.5 rounded-xl text-[13px] leading-relaxed italic border border-dashed min-w-0 max-w-[85%] break-words"
  style="border-color:var(--border-str); color:var(--fg-dim)"
>
    <details bind:open={open.value} ontoggle={onUserToggle}>
      <summary class="text-[11px] font-semibold not-italic opacity-70 mb-1 cursor-pointer thought-summary">
        {t("chat.bubble.thought")}
      </summary>

      {#if runningText !== null}
        <!-- C1 FIX: טקסט רץ (לא מתורגם) — MarkdownContent (ללא whitespace-pre-wrap; markdown מטפל) -->
        <MarkdownContent text={runningText} />
      {:else}
        <!-- מתורגם: per-segment תקין (segment = יחידת-תרגום = משפט) -->
        {#each displaySegments as seg (seg.id)}
          <div class="mb-1 last:mb-0">
            <MarkdownContent text={seg.text} />
            {#if seg.originalText !== undefined}
              <!-- originalText = raw source, לא מרקדאון — נשאר טקסט גולמי dir=ltr -->
              <div dir="ltr" class="text-[0.82em] opacity-55 mt-0.5 not-italic whitespace-pre-wrap break-words">
                {seg.originalText}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </details>

    <!-- כופה ריאקטיביות של Svelte בעת .segments.push() או כשה-originalText מגיע -->
    <span class="hidden">{bubble.segments.length}</span>
</div>

<style>
  .thought-summary { list-style: none; }
  .thought-summary::-webkit-details-marker { display: none; }
</style>
