<script lang="ts">
import type { DesignContent } from "./content"
import * as I from "./icons"
import { mockControls, type NavActions } from "./proto"

let {
  content,
  palette,
  on = {},
}: { content: DesignContent; palette: string; on?: NavActions } = $props()
const c = $derived(content.copy)
const d = $derived(content.data)
const s = $derived(d.settings)
const swatches: Record<string, string> = {
  ember: "#e8845c",
  forest: "#7fb685",
  plum: "#b794f6",
  teal: "#2dd4bf",
  midnight: "#6b8afd",
  rose: "#f472b6",
  slate: "#8aa0bd",
  daylight: "#f6f4f0",
}
const sections = $derived([
  c.appearance,
  c.voice,
  c.ttsStatus,
  c.screen,
  c.chatDisplay,
  c.crossAgent,
  c.connection,
])
</script>

<div class="settings" use:mockControls>
  <header class="head"><button class="ib back" aria-label={c.settingsTitle} onclick={() => on.back?.()}><I.ChevronRight size={20} class="flip-back" /></button><h1>{c.settingsTitle}</h1></header>

  <div class="layout">
    <nav class="toc">{#each sections as sec, i (sec)}<span class:on={i === 0}>{sec}</span>{/each}</nav>

    <div class="groups">
      <section class="group">
        <h3>{c.appearance}</h3>
        <div class="row"><span class="t">{c.uiLanguage}</span><span class="v">{c.language}<I.ChevronLeft size={16} class="muted flip" /></span></div>
        <div class="row stack">
          <div class="pal-h"><span>{c.theme}</span><span class="dim cap">{palette}</span></div>
          <div class="swatches">{#each Object.entries(swatches) as [name, color] (name)}<span class="swatch" class:sel={name === palette} style="background:{color}" title={name}></span>{/each}</div>
        </div>
      </section>

      <section class="group">
        <h3>{c.voice}</h3>
        <div class="row"><span class="t">{c.ttsProvider}</span><span class="v">{s.provider}<I.ChevronLeft size={16} class="muted flip" /></span></div>
        <div class="row"><span class="t">{c.ttsModel}</span><span class="v">{s.ttsModel}<I.ChevronLeft size={16} class="muted flip" /></span></div>
        <div class="row"><span class="t">{c.ttsVoice}<small>{s.voice} · {s.voiceNote}</small></span><button class="ib" aria-label={c.ttsVoice}><I.Play size={16} /></button><I.ChevronLeft size={16} class="muted flip" /></div>
        <div class="row"><span class="t">{c.speakThoughts}</span><span class="sw on"></span></div>
        <div class="row"><span class="t">{c.narrateTools}</span><span class="sw on"></span></div>
        <div class="row"><span class="t">{c.translateThoughts}</span><span class="sw"></span></div>
        <div class="row"><span class="t">{c.carMode}<small>{c.carModeNote}</small></span><span class="sw on"></span></div>
        <div class="row"><span class="t">{c.mic}</span><span class="v">{c.micDefault}<I.ChevronLeft size={16} class="muted flip" /></span></div>
      </section>

      <section class="group">
        <h3>{c.ttsStatus}<button class="ib sm" aria-label={c.refresh}><I.RefreshCw size={15} /></button></h3>
        <div class="row stack">
          <div class="meter"><div class="top"><span>{c.quota}</span><b class="num">{s.quotaPct}% {c.used}</b></div><div class="bar"><i style="inline-size:{s.quotaPct}%"></i></div></div>
          <p class="note">{c.estCost}: {s.costs}</p>
        </div>
        <div class="row"><span class="t">{c.tokenUsage}<small>{c.compactions} · {c.heldBefore}</small></span><span class="v num">{s.compactions}</span></div>
        <button class="row link" onclick={() => on.usage?.()}><span class="t">{c.usageLink}</span><I.ExternalLink size={16} class="muted" /></button>
      </section>

      <section class="group">
        <h3>{c.screen}</h3>
        <div class="row"><span class="t">{c.keepOn}</span><span class="sw on"></span></div>
        <div class="row"><span class="t">{c.notifications}</span><span class="sw"></span></div>
      </section>

      <section class="group">
        <h3>{c.chatDisplay}</h3>
        <div class="row"><span class="t">{c.compact}</span><span class="sw on"></span></div>
        <div class="row"><span class="t">{c.showThoughts}</span><span class="sw"></span></div>
        <div class="row"><span class="t">{c.showTools}</span><span class="sw on"></span></div>
        <div class="row"><span class="t">{c.enterSends}</span><span class="sw on"></span></div>
        <div class="row"><span class="t">{c.memo}</span><span class="sw"></span></div>
        <div class="row"><span class="t">{c.remoteImages}<small>{c.remoteImagesNote}</small></span><span class="sw"></span></div>
      </section>

      <section class="group">
        <h3>{c.crossAgent}</h3>
        <div class="row stack"><div class="seg"><span>{c.allow}</span><span class="on">{c.ask}</span><span>{c.deny}</span></div><p class="note">{c.crossAgentNote}</p></div>
      </section>

      <section class="group">
        <h3>{c.connection}</h3>
        <div class="row stack"><div class="fl">{c.beUrl}</div><div class="field"><span class="v ph ltr-in">https://…</span></div><p class="note">{c.beUrlNote}</p></div>
        <div class="row stack"><div class="fl">{c.transport}</div><div class="seg"><span class="on">WebSocket</span><span>HTTP</span></div></div>
      </section>

      <footer class="foot"><span class="muted">{c.version} <span class="num">{s.version}</span></span><span class="sp"></span><button class="chip">{c.reset}</button><button class="chip save">{c.saveOpen}</button></footer>
    </div>
  </div>
</div>

<style>
  .settings { min-block-size: 100dvh; padding-block-end: 8px; }
  .head { display: flex; align-items: center; gap: 6px; padding: 16px 12px 0; max-inline-size: 1040px; margin-inline: auto; }
  .head h1 { font-size: var(--t-xl); font-weight: 600; margin: 0; }
  :global(.dv2 [dir="ltr"] .flip), :global(.dv2 [dir="ltr"] .flip-back) { transform: scaleX(-1); }
  .layout { max-inline-size: 1040px; margin-inline: auto; }
  .toc { display: none; }
  .group { padding: 22px 20px 0; }
  .ib.sm { inline-size: 28px; block-size: 28px; }
  .pal-h { display: flex; justify-content: space-between; }
  .cap { text-transform: capitalize; font-size: var(--t-sm); }
  .swatches { display: flex; gap: 8px; flex-wrap: wrap; padding-block: 12px 4px; }
  .swatch { inline-size: 32px; block-size: 32px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08); }
  .swatch.sel { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--fg-dim); }
  .fl { font-size: var(--t-sm); color: var(--fg-dim); margin: 0 2px 6px; }
  .ltr-in { direction: ltr; text-align: end; }
  .row.link { color: var(--fg); inline-size: 100%; text-align: start; }
  .group + .group { margin-block-start: 22px; border-block-start: 1px solid var(--line-2); }
  .foot { display: flex; align-items: center; gap: 8px; padding: 28px 20px 16px; font-size: var(--t-sm); }
  .sp { flex: 1; }
  .save { background: var(--accent); color: var(--on-accent); border-color: transparent; }
  @media (min-width: 768px) {
    .head { padding: 32px 24px 0; }
    .groups { max-inline-size: 640px; margin-inline: auto; inline-size: 100%; }
    .head { max-inline-size: 640px; padding-inline: 0; }
    .group + .group { border-block-start: 1px solid var(--line); }
    .group { margin-block-start: 16px; padding: 16px 20px 8px; border: 1px solid var(--line); border-radius: var(--r-k); background: var(--surface-1); }
    .layout { padding-inline: 24px; }
    .foot { padding-inline: 0; }
  }
  @media (min-width: 1024px) {
    .layout { display: grid; grid-template-columns: 220px 1fr; gap: 40px; }
    .head { max-inline-size: 1040px; padding-inline: 24px; }
    .toc { display: flex; flex-direction: column; gap: 2px; position: sticky; inset-block-start: 24px; align-self: start; margin-block-start: 16px; }
    .toc span { padding: 8px 12px; border-radius: var(--r-c); color: var(--fg-dim); font-size: var(--t-sm); }
    .toc span.on { background: var(--surface-2); color: var(--fg); }
  }
</style>
