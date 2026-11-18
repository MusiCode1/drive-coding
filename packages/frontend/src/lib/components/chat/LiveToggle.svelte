<script lang="ts">
/**
 * LiveToggle — open/close Gemini Live secretary session.
 *
 * Primary CTA in the live pane: large circular button (same footprint as MicLarge).
 * Label sits under the circle — text does not fit inside a round control.
 *
 * Slice: live-ears, Commit 7 · enlarged circle (live-input-mode follow-up).
 * Slice: live-silence-cost — Pause beside Stop when open; Resume when paused (D19 exception).
 * Slice: codex-voice-poc — when the session's agent has its own voice (`capabilities.voice`) and
 *   the user ticks "built-in Live", the same button opens the agent's native voice instead.
 */

import PauseIcon from "@lucide/svelte/icons/pause"
import PlayIcon from "@lucide/svelte/icons/play"
import RadioIcon from "@lucide/svelte/icons/radio"
import { getAgentVoice, getI18n, getLive } from "$lib/context"

const live = getLive()
const agentVoice = getAgentVoice()
const t = getI18n().t
const native = $derived(agentVoice.selected)

const closedLabelKey = $derived(
  agentVoice.status === "connecting"
    ? "agentVoice.connecting"
    : live.state === "connecting"
      ? "live.status.connecting"
      : "live.toggle.open",
)
</script>

<div class="live-toggle flex flex-col items-center gap-2">
  {#if agentVoice.status === "live"}
    <button
      type="button"
      class="live-toggle-btn rounded-full border-none cursor-pointer flex items-center justify-center transition-all"
      style="background:var(--recording); color:#fff"
      onclick={() => void agentVoice.stop()}
      aria-pressed={true}
      aria-label={t("live.toggle.close")}
    >
      <RadioIcon size={40} strokeWidth={1.5} />
    </button>
    <span class="text-sm font-semibold" style="color:var(--fg-dim)" aria-hidden="true">
      {t("agentVoice.live")}
    </span>
  {:else if live.state === "open" || live.paused}
    <div class="live-toggle-row flex items-center gap-3">
      {#if live.paused}
        <button
          type="button"
          class="live-toggle-secondary rounded-full border-none cursor-pointer flex items-center justify-center transition-all"
          style="background:var(--accent); color:#fff"
          onclick={() => live.resume()}
          aria-label={t("live.toggle.resume")}
        >
          <PlayIcon size={28} strokeWidth={1.5} />
        </button>
      {:else}
        <button
          type="button"
          class="live-toggle-secondary rounded-full border-none cursor-pointer flex items-center justify-center transition-all"
          style="background:var(--fg-dim); color:#fff"
          onclick={() => live.pause()}
          aria-label={t("live.toggle.pause")}
        >
          <PauseIcon size={28} strokeWidth={1.5} />
        </button>
      {/if}
      <button
        type="button"
        class="live-toggle-btn rounded-full border-none cursor-pointer flex items-center justify-center transition-all"
        style="background:var(--recording); color:#fff"
        onclick={() => void live.toggle()}
        aria-pressed={true}
        aria-label={t("live.toggle.close")}
      >
        <RadioIcon size={40} strokeWidth={1.5} />
      </button>
    </div>
    <span class="text-sm font-semibold" style="color:var(--fg-dim)" aria-hidden="true">
      {t(live.paused ? "live.toggle.resume" : "live.toggle.close")}
    </span>
  {:else}
    <button
      type="button"
      class="live-toggle-btn rounded-full border-none cursor-pointer flex items-center justify-center transition-all"
      class:disabled={native ? agentVoice.active : !live.canOpen && !live.isOpen}
      style="background:var(--accent); color:#fff"
      disabled={native ? agentVoice.active : !live.canOpen && !live.isOpen}
      onclick={() => void (native ? agentVoice.start() : live.toggle())}
      aria-pressed={live.isOpen}
      aria-label={t(closedLabelKey)}
    >
      <RadioIcon size={40} strokeWidth={1.5} />
    </button>
    <span class="text-sm font-semibold" style="color:var(--fg-dim)" aria-hidden="true">
      {t(closedLabelKey)}
    </span>
  {/if}
</div>

{#if agentVoice.supported && !live.isOpen && !agentVoice.active}
  <label class="mt-1 flex items-center justify-center gap-2 text-sm" style="color:var(--fg-dim)">
    <input
      type="checkbox"
      checked={agentVoice.preferNative}
      onchange={(e) => agentVoice.setPreferNative(e.currentTarget.checked)}
    />
    {t("agentVoice.useNative")}
  </label>
{/if}

{#if native && agentVoice.error}
  <p class="text-xs text-center mt-1" style="color:var(--recording)" role="alert">
    {t("agentVoice.error")} {agentVoice.error}
  </p>
{/if}

{#if live.error}
  <p class="text-xs text-center mt-1" style="color:var(--recording)" role="alert">
    {t(live.error)}
  </p>
{/if}

<style>
  .live-toggle-btn {
    width: 110px;
    height: 110px;
  }

  .live-toggle-secondary {
    width: 72px;
    height: 72px;
  }

  .live-toggle-btn.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
