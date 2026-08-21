<script lang="ts">
/**
 * MicLarge — לחצן mic גדול 110px עם state visual (redesign-4).
 *
 * State → color: מאמץ את מיפוי .mic-rec/.mic-speak מ-app.css הקיים.
 * State → icon: Lucide (לא אמוג'י כמו MicButton הישן) — מפה חדשה.
 *
 * מוקאפ: שורות 447-456, 452 (stop צף absolute, רק ב-speaking).
 * onClick: כמו MicButton — cancel() ב-speaking/thinking, mic.toggle() ב-idle/recording.
 *
 * ─── record-footer (redesign-4) ───
 */

import Loader2Icon from "@lucide/svelte/icons/loader-2"
import MicIcon from "@lucide/svelte/icons/mic"
import SquareIcon from "@lucide/svelte/icons/square"
import Volume2Icon from "@lucide/svelte/icons/volume-2"
import XIcon from "@lucide/svelte/icons/x"
import { getI18n, getMic, getVoiceMode } from "$lib/context"
import type { VoiceModeState } from "$lib/view-models/derived/voice-mode.svelte"

const mic = getMic()
const voiceMode = getVoiceMode()
const t = getI18n().t

// מיפוי state → CSS class (שמות class מ-app.css)
const STATE_CLASS: Record<VoiceModeState, string> = {
  idle: "",
  recording: "mic-rec",
  transcribing: "spin-state",
  thinking: "spin-state",
  speaking: "mic-speak",
  cancelling: "flash-state",
}

const isDisabled = $derived(voiceMode.state === "transcribing" || voiceMode.state === "cancelling")

const showStop = $derived(voiceMode.state === "speaking")
/** ─── slice mic-record-only ─── ביטול ההקלטה בלי לשלוח. */
const showDiscard = $derived(voiceMode.state === "recording")

const stateClass = $derived(STATE_CLASS[voiceMode.state])

/**
 * ─── slice mic-record-only ───
 * 🔴 **היה כאן `cancelRun()`** כשהמצב `speaking`/`thinking` — כלומר לחיצה על
 * המיקרופון בזמן שהסוכן עונה **ביטלה את ההרצה** במקום להתחיל הקלטה. זה
 * הפתיע, כי כפתור-מיקרופון אומר דבר אחד: להקליט.
 *
 * עכשיו הוא **תמיד** לחצן-הקלטה: לחיצה מתחילה, לחיצה נוספת מסיימת ושולחת.
 * ביטול-ההרצה חי אך ורק ברצועת-הבקרה (⊗), במקום שבו הוא מוצהר.
 */
function onClick() {
  if (voiceMode.state === "transcribing" || voiceMode.state === "cancelling") return
  void mic.toggle()
}
</script>

<div class="relative flex items-center justify-center" style="min-height:130px">
  <!-- כפתור mic גדול 110px -->
  <button
    class="rounded-full border-none cursor-pointer flex items-center justify-center transition-all {stateClass}"
    style="width:110px; height:110px; background:var(--accent); color:white; font-size:2.5rem;"
    class:disabled={isDisabled}
    onclick={onClick}
    disabled={isDisabled}
    aria-label={t(`voiceMode.status.${voiceMode.state}`)}
  >
    {#if voiceMode.state === "idle"}
      <MicIcon size={40} strokeWidth={1.5} />
    {:else if voiceMode.state === "recording"}
      <MicIcon size={40} strokeWidth={1.5} />
    {:else if voiceMode.state === "speaking"}
      <Volume2Icon size={40} strokeWidth={1.5} />
    {:else if voiceMode.state === "transcribing" || voiceMode.state === "thinking"}
      <Loader2Icon size={40} strokeWidth={1.5} class="animate-spin" />
    {:else if voiceMode.state === "cancelling"}
      <XIcon size={40} strokeWidth={1.5} />
    {/if}
  </button>

  <!-- stop button — צף absolute, רק ב-speaking (מוקאפ 452) -->
  {#if showStop}
    <button
      class="absolute rounded-full flex items-center justify-center text-xs font-semibold"
      style="
        inset-inline-start: calc(50% + 60px);
        bottom: 0;
        width: 36px; height: 36px;
        background: var(--fg-muted);
        color: var(--bg);
        border: none;
        cursor: pointer;
      "
      onclick={() => voiceMode.stopPlayback()}
      aria-label={t("mic.stop")}
    >
      <SquareIcon size={14} strokeWidth={2.5} />
    </button>
  {/if}

  <!-- ─── slice mic-record-only ───
       ביטול-הקלטה: זורק את מה שהוקלט ואינו שולח. נפרד מהמיקרופון עצמו,
       שסיום-לחיצה בו **כן** שולח. -->
  {#if showDiscard}
    <button
      class="absolute rounded-full flex items-center justify-center"
      style="
        inset-inline-end: calc(50% + 60px);
        bottom: 0;
        width: 36px; height: 36px;
        background: var(--fg-muted);
        color: var(--bg);
        border: none;
        cursor: pointer;
      "
      onclick={() => mic.cancel()}
      aria-label={t("mic.discard")}
      title={t("mic.discard")}
    >
      <XIcon size={16} strokeWidth={2.5} />
    </button>
  {/if}

  <!-- שגיאות mic -->
  {#if mic.error}
    <div
      class="absolute -bottom-6 text-xs text-center"
      style="color:var(--recording); max-width:200px"
      role="alert"
    >
      {t(mic.error)}
      <!-- כפתור "נסה שוב" — רק כשיש blob שמור (תמלול נכשל, ניתן לנסות שוב) -->
      {#if mic.error === "mic.error.transcribe" && mic.canRetry}
        <button
          class="block mx-auto mt-1 px-2 py-0.5 rounded text-[11px] font-medium border"
          style="border-color:var(--recording); color:var(--recording)"
          onclick={() => void mic.retryTranscribe()}
        >
          {t("mic.retry")}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* spin animation עבור transcribing/thinking */
  :global(.animate-spin) {
    animation: spin 1s linear infinite;
  }

  .spin-state {
    background: var(--thinking) !important;
  }

  .flash-state {
    animation: flash-fast 0.3s infinite;
  }

  .disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  @keyframes flash-fast {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>
