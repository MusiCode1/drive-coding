<script lang="ts">
/**
 * MicLarge — לחצן mic גדול 110px עם state visual (redesign-4).
 *
 * ─── slice voice-pending-persistence: PendingCaptureBanner below button (flex-col) ───
 * requesting = soft pulse (not thinking spinner); transcribing keeps spin-state.
 */

import Loader2Icon from "@lucide/svelte/icons/loader-2"
import MicIcon from "@lucide/svelte/icons/mic"
import OctagonXIcon from "@lucide/svelte/icons/octagon-x"
import XIcon from "@lucide/svelte/icons/x"
import { getI18n, getLive, getMic, getModelStatus, getVoiceMode } from "$lib/context"
import type { MicState } from "$lib/view-models/mic.svelte"
import PendingCaptureBanner from "./PendingCaptureBanner.svelte"

const mic = getMic()
const live = getLive()
const voiceMode = getVoiceMode()
const modelStatus = getModelStatus()
const t = getI18n().t

const STATE_CLASS: Record<MicState, string> = {
  idle: "",
  requesting: "mic-arming",
  recording: "mic-rec",
  transcribing: "spin-state",
}

const isArming = $derived(mic.state === "requesting")
const isHardDisabled = $derived(mic.state === "transcribing" || live.isOpen)
const isDisabled = $derived(isHardDisabled || isArming)
const showDiscard = $derived(mic.state === "recording")
const stateClass = $derived(STATE_CLASS[mic.state])
const statusLine = $derived(
  mic.state === "requesting"
    ? mic.awaitingPermissionDialog
      ? ("voiceMode.status.requesting" as const)
      : null
    : mic.error
      ? null
      : mic.permissionHint,
)

function onClick() {
  if (mic.state === "transcribing" || mic.state === "requesting") return
  void voiceMode.startTalking()
}
</script>

<div class="flex flex-col items-center" style="min-height:130px">
  <div class="relative flex items-center justify-center">
    <button
      class="rounded-full border-none cursor-pointer flex items-center justify-center transition-all {stateClass}"
      style="width:110px; height:110px; background:var(--accent); color:white; font-size:2.5rem;"
      class:disabled={isHardDisabled}
      class:mic-arming-wait={isArming}
      onclick={onClick}
      disabled={isDisabled}
      aria-busy={isArming || mic.state === "transcribing" ? true : undefined}
      aria-label={t(`voiceMode.status.${mic.state}`)}
    >
      {#if mic.state === "transcribing"}
        <Loader2Icon size={40} strokeWidth={1.5} class="animate-spin" />
      {:else}
        <MicIcon size={40} strokeWidth={1.5} />
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
  </div>

  <PendingCaptureBanner
    error={mic.error}
    canRetry={mic.canRetry}
    restored={mic.pendingRestored}
    onRetry={() => void mic.retryTranscribe()}
    onDismiss={() => void mic.dismiss()}
    {t}
  />
  {#if statusLine}
    <p
      class="text-xs text-center mt-1 max-w-xs"
      style="color:var(--fg-dim)"
      role="status"
    >
      {t(statusLine)}
    </p>
  {/if}
</div>

<style>
  :global(.animate-spin) {
    animation: spin 1s linear infinite;
  }

  .spin-state {
    background: var(--thinking) !important;
  }

  .mic-arming {
    animation: pulse-arm 1s ease-in-out infinite;
  }

  .mic-arming-wait {
    cursor: wait;
    opacity: 1;
  }

  .flash-state {
    animation: flash-fast 0.3s infinite;
  }

  .disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  @keyframes pulse-arm {
    0%,
    100% {
      opacity: 1;
      box-shadow: 0 0 0 0 var(--accent-soft);
    }
    50% {
      opacity: 0.78;
      box-shadow: 0 0 0 14px transparent;
    }
  }

  @keyframes flash-fast {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>
