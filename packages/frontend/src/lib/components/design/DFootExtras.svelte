<script lang="ts">
/** Footer pieces the basic mock skipped: pending-capture banner, denied mic, live transcript. */
import type { DesignContent } from "./content"
import * as I from "./icons"

let { content, view, tab }: { content: DesignContent; view: string; tab: string } = $props()
const r = $derived(content.copy.rich)
let dismissed = $state(false)
</script>

{#if view === "pending" && !dismissed}
  <div class="banner" role="alert">
    <I.Alert size={16} />
    <div class="txt"><b>{r.pendingTitle}</b><span>{r.pendingBody}</span></div>
    <button class="chip primary">{r.retry}</button>
    <button class="ib" aria-label={r.dismiss} onclick={() => (dismissed = true)}><I.X size={16} /></button>
  </div>
{/if}

{#if view === "micDenied"}
  <p class="denied"><I.MicOff size={14} />{r.denied}</p>
{/if}

{#if tab === "live"}
  <div class="live">
    <div class="transcript" aria-live="polite">
      <p class="lu"><span class="who">{r.liveYou}</span><span dir="auto">{r.liveL1}</span></p>
      <p class="la"><span class="who">{r.liveAgent}</span><span dir="auto">{r.liveL2}</span></p>
      <p class="interim">{r.liveListening}</p>
    </div>
    <div class="chips">
      <button class="chip"><I.Volume size={14} />{r.liveVoice}<I.ChevronDown size={14} /></button>
      <button class="chip" aria-pressed="false"><I.Radio size={14} />{r.liveNative}</button>
    </div>
  </div>
{/if}

<style>
  .banner { display: flex; align-items: center; gap: 10px; inline-size: 100%; max-inline-size: 760px; padding: 10px 12px; border-radius: var(--r-k); background: color-mix(in srgb, var(--warn) 12%, var(--surface-1)); border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); color: var(--fg); }
  .banner .txt { flex: 1; display: flex; flex-direction: column; font-size: var(--t-sm); }
  .banner .txt span { color: var(--fg-dim); font-size: var(--t-xs); }
  .denied { display: flex; align-items: center; gap: 6px; margin: 0; font-size: var(--t-sm); color: var(--bad); }
  .live { inline-size: 100%; max-inline-size: 760px; display: flex; flex-direction: column; gap: 8px; }
  .transcript { block-size: 12rem; overflow: auto; padding: 10px 12px; border-radius: var(--r-k); background: var(--surface-1); border: 1px solid var(--line); font-size: var(--t-sm); }
  .transcript p { margin: 0 0 6px; display: flex; gap: 8px; }
  .who { color: var(--fg-muted); font-size: var(--t-xs); min-inline-size: 3em; }
  .interim { color: var(--fg-muted); opacity: 0.7; }
  .chips { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
</style>
