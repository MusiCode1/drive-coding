<script lang="ts">
/**
 * VoiceSpeechBubble — what the user or the agent's built-in voice said (slice codex-voice-poc).
 * A spoken line, not a written one: tinted with the Live color, a small "voice" caption, plain text.
 */
import AudioLinesIcon from "@lucide/svelte/icons/audio-lines"
import { getI18n } from "$lib/context"
import type { MessageBubble, UserBubble } from "$lib/types/bubble"
import { joinSegmentText } from "./bubble-rendering"

let { bubble }: { bubble: UserBubble | MessageBubble } = $props()
const t = getI18n().t
const isUser = $derived(bubble.voice?.kind === "speech" && bubble.voice.role === "user")
const text = $derived(joinSegmentText(bubble.segments))
</script>

<div
  class="voice-speech rounded-2xl px-3.5 py-2 min-w-0 max-w-[85%] break-words"
  class:voice-speech--user={isUser}
>
  <div class="flex items-center gap-1.5 text-[11px] font-semibold opacity-75 mb-0.5">
    <AudioLinesIcon size={12} strokeWidth={2} />
    {t(isUser ? "voice.bubble.you" : "voice.bubble.voice")}
  </div>
  <p class="text-[14px] leading-relaxed whitespace-pre-wrap" dir="auto">{text}</p>
</div>

<style>
  .voice-speech {
    background: color-mix(in srgb, var(--recording) 9%, var(--bg-card));
    border: 1px solid color-mix(in srgb, var(--recording) 22%, transparent);
    color: var(--fg);
  }
  .voice-speech--user {
    background: color-mix(in srgb, var(--accent) 12%, var(--bg-card));
    border-color: color-mix(in srgb, var(--accent) 25%, transparent);
  }
</style>
