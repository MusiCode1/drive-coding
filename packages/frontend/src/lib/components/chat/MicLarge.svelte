<script lang="ts">
/**
 * MicLarge — לחצן mic גדול 110px עם state visual (redesign-4).
 *
 * מיקרופון טהור: לחיצה תמיד מתחילה/מסיימת הקלטה (startTalking — כולל barge-in).
 * כפתור עצור-ריצה (OctagonX) מופיע לצדו כשיש ריצה פעילה.
 * כפתור בטל-הקלטה (X) מופיע בצד השני בזמן recording.
 *
 * ─── record-footer (redesign-4) ───
 * ─── slice control-roles ───
 */

import Loader2Icon from "@lucide/svelte/icons/loader-2"
import MicIcon from "@lucide/svelte/icons/mic"
import OctagonXIcon from "@lucide/svelte/icons/octagon-x"
import XIcon from "@lucide/svelte/icons/x"
import { getI18n, getMic, getModelStatus, getVoiceMode } from "$lib/context"
import type { MicState } from "$lib/view-models/mic.svelte"

const mic = getMic()
const voiceMode = getVoiceMode()
const modelStatus = getModelStatus()
const t = getI18n().t

const STATE_CLASS: Record<MicState, string> = {
  idle: "",
  recording: "mic-rec",
  transcribing: "spin-state",
}

const isDisabled = $derived(mic.state === "transcribing")

/** ─── slice mic-record-only ─── ביטול ההקלטה בלי לשלוח. */
const showDiscard = $derived(mic.state === "recording")

const stateClass = $derived(STATE_CLASS[mic.state])

function onClick() {
  if (mic.state === "transcribing") return
  void voiceMode.startTalking()
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
    aria-label={t(`voiceMode.status.${mic.state}`)}
  >
    {#if mic.state === "idle" || mic.state === "recording"}
      <MicIcon size={40} strokeWidth={1.5} />
    {:else if mic.state === "transcribing"}
      <Loader2Icon size={40} strokeWidth={1.5} class="animate-spin" />
    {/if}
  </button>

  {#if modelStatus.isRunActive}
    <button
      class="absolute rounded-full flex items-center justify-center text-xs font-semibold"
      class:flash-state={voiceMode.isCancelling}
      style="
        inset-inline-start: calc(50% + 60px);
        bottom: 0;
        width: 36px; height: 36px;
        background: var(--fg-muted);
        color: var(--bg);
        border: none;
        cursor: pointer;
      "
      onclick={() => voiceMode.cancelRun()}
      disabled={voiceMode.isCancelling}
      aria-label={t(modelStatus.stopRunLabelKey)}
    >
      <OctagonXIcon size={16} strokeWidth={2.5} />
    </button>
  {/if}

  <!-- ─── slice mic-record-only ───
       ביטול-הקלטה: זורק את מה שהוקלט ואינו שולח. -->
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
