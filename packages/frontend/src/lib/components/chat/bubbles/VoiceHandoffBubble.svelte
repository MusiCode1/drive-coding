<script lang="ts">
/**
 * VoiceHandoffBubble — a request the agent's built-in voice handed to the agent (slice codex-voice-poc).
 * Compact, like a tool call: what was handed over, and — on demand — the conversation that led to it.
 */
import CornerDownRightIcon from "@lucide/svelte/icons/corner-down-right"
import { getI18n } from "$lib/context"
import type { UserBubble } from "$lib/types/bubble"
import { joinSegmentText } from "./bubble-rendering"
import { transcriptLines } from "./voice-transcript"

let { bubble }: { bubble: UserBubble } = $props()
const t = getI18n().t
const request = $derived(joinSegmentText(bubble.segments))
const lines = $derived(
  bubble.voice?.kind === "handoff" ? transcriptLines(bubble.voice.transcript) : [],
)
</script>

<div class="voice-handoff rounded-xl px-3 py-2 min-w-0 max-w-[85%] text-[13px]">
  <div class="flex items-start gap-2">
    <CornerDownRightIcon class="mt-0.5 shrink-0" size={14} strokeWidth={2} />
    <div class="min-w-0">
      <span class="font-semibold" style="color:var(--fg-dim)">{t("voice.handoff.label")}</span>
      <span class="break-words" dir="auto">{request}</span>
    </div>
  </div>
  {#if lines.length > 0}
    <details class="mt-1.5">
      <summary class="cursor-pointer text-[11px] font-semibold" style="color:var(--fg-dim)">
        {t("voice.handoff.context")}
      </summary>
      <ul class="mt-1 flex flex-col gap-0.5 text-[12px]" style="color:var(--fg-dim)">
        {#each lines as line, i (i)}
          <li dir="auto">
            {#if line.role}<span class="font-semibold"
                >{t(line.role === "user" ? "voice.bubble.you" : "voice.bubble.voice")}:</span
              >{/if}
            {line.text}
          </li>
        {/each}
      </ul>
    </details>
  {/if}
</div>

<style>
  .voice-handoff {
    border: 1px dashed color-mix(in srgb, var(--recording) 45%, transparent);
    background: color-mix(in srgb, var(--recording) 5%, transparent);
    color: var(--fg);
  }
</style>
