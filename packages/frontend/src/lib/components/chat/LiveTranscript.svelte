<script lang="ts">
/**
 * LiveTranscript — streaming Live secretary transcript (not bubbles).
 *
 * Slice: live-ears, Commit 7.
 */

import { getI18n, getLive, getVoiceMode } from "$lib/context"

const live = getLive()
const voiceMode = getVoiceMode()
const t = getI18n().t
</script>

<!--
  F3: this renders off `voiceMode.ear`, and that is the point.

  The FSM split added `ear`/`mouth` with **zero production consumers**, which is
  the very pathology that got the mutation gate moved off `state` in the first
  place. A split nothing reads is theory: the axis cannot be observed, and a
  mutation on it cannot redden anything except assertions written beside it.

  Keying the surface on `ear` is what makes the split real — and it is also what
  gives DoD 7 something that can actually fail.
-->
{#if voiceMode.ear !== "closed"}
  <div
    class="w-full max-w-lg flex flex-col gap-2 text-sm rounded-xl p-3"
    style="background:var(--bg-card); border:1px solid var(--border)"
    aria-live="polite"
  >
    {#if live.transcript.length === 0}
      <span class="text-xs" style="color:var(--fg-dim)">{t("live.ear.listening")}</span>
    {/if}
    {#each live.transcript as entry (entry.id)}
      <div class="flex flex-col gap-0.5">
        <span class="text-xs font-semibold" style="color:var(--fg-dim)">
          {t(entry.role === "user" ? "live.transcript.user" : "live.transcript.assistant")}
        </span>
        <span style="color:var(--fg)" class:opacity-70={!entry.final}>{entry.text}</span>
      </div>
    {/each}
  </div>
{/if}
