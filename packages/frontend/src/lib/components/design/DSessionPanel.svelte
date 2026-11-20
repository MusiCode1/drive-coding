<script lang="ts">
import Brain from "@lucide/svelte/icons/brain"
import ChevronLeft from "@lucide/svelte/icons/chevron-left"
import List from "@lucide/svelte/icons/list"
import LogOut from "@lucide/svelte/icons/log-out"
import Pencil from "@lucide/svelte/icons/pencil"
import Plus from "@lucide/svelte/icons/plus"
import Power from "@lucide/svelte/icons/power"
import RefreshCw from "@lucide/svelte/icons/refresh-cw"
import Search from "@lucide/svelte/icons/search"
import SettingsIcon from "@lucide/svelte/icons/settings"
import VolumeX from "@lucide/svelte/icons/volume-x"
import Wrench from "@lucide/svelte/icons/wrench"
import type { DesignContent } from "./content"

let { content }: { content: DesignContent } = $props()
const c = $derived(content.copy)
const d = $derived(content.data)
const SESSION_PEEK = 5
let allSessions = $state(false)
const sessionsShown = $derived(allSessions ? d.sessions : d.sessions.slice(0, SESSION_PEEK))
</script>

<div class="panel">
  <div class="load">
    <div class="meter"><div class="top"><span>{c.machine.memory}</span><b class="num ltr">{d.machine.memUsed} / {d.machine.memTotal} GB</b></div><div class="bar"><i style="inline-size:{d.machine.memPct}%"></i></div></div>
    <div class="meter hot"><div class="top"><span>{c.machine.cpu}</span><b class="num ltr">{d.machine.cpuPct}%</b></div><div class="bar"><i style="inline-size:{d.machine.cpuPct}%"></i></div></div>
  </div>

  <div class="actions">
    <button class="act danger"><Power size={18} />{c.closeProcess}</button>
    <button class="act"><LogOut size={18} />{c.leaveRunning}</button>
    <button class="act"><VolumeX size={18} />{c.mute}</button>
    <button class="act"><SettingsIcon size={18} />{c.settings}</button>
  </div>

  <div class="block">
    <div class="fl">{c.title}</div>
    <div class="field"><span class="v">{d.session.title}</span><Pencil size={15} class="muted" /></div>
    <div class="fl">{c.fields}</div>
    <div class="chips">{#each d.fields as f (f.k)}<span class="chip">{f.k} · <span class="ltr">{f.v}</span></span>{/each}</div>
  </div>

  <div class="group block">
    <h3>{c.display}</h3>
    <div class="row"><span class="ico"><List size={16} /></span><span class="t">{c.compact}</span><span class="sw on"></span></div>
    <div class="row"><span class="ico"><Brain size={16} /></span><span class="t">{c.showThoughts}</span><span class="sw"></span></div>
    <div class="row"><span class="ico"><Wrench size={16} /></span><span class="t">{c.showTools}</span><span class="sw on"></span></div>
  </div>

  <div class="group block">
    <h3>{c.agentOptions}<span class="dim run-on">{c.runningOn} {d.session.cli}</span></h3>
    <div class="row"><span class="t">{c.mode}</span><span class="v">{d.modeVal}<ChevronLeft size={16} class="muted flip" /></span></div>
    <div class="row"><span class="t">{c.model}</span><span class="v">{d.modelVal}<ChevronLeft size={16} class="muted flip" /></span></div>
    <div class="row"><span class="t">{c.effort}</span><span class="v">{d.effortVal}<ChevronLeft size={16} class="muted flip" /></span></div>
    <div class="row"><span class="t">{c.advanced}<small>Fast mode · Ultracode · {c.agent}</small></span><ChevronLeft size={16} class="muted flip" /></div>
  </div>

  <div class="group block">
    <h3>{c.agentPerms}</h3>
    {#each [c.permSend, c.permChange, c.permClose] as label (label)}
      <div class="row stack"><div class="fl tight">{label}</div><div class="seg"><span class="on">{c.inherit}</span><span>{c.allow}</span><span>{c.ask}</span><span>{c.deny}</span></div></div>
    {/each}
    <p class="note">{c.agentPermsNote}</p>
  </div>

  <div class="group block">
    <h3>{c.projectPrompt}</h3>
    <div class="field area"><span class="ph">{c.projectPromptPh}</span></div>
    <p class="note">{c.projectPromptNote}</p>
  </div>

  <div class="group block last">
    <h3>{c.sessions}<span class="hacts"><button class="ib" aria-label={c.refresh}><RefreshCw size={15} /></button><button class="ib accent" aria-label={c.newSession}><Plus size={17} /></button></span></h3>
    <div class="field small"><Search size={15} class="muted" /><span class="v ph">{c.searchTitles}</span></div>
    <div class="seg mt"><span class="on">{c.allSessions}</span><span>{c.thisFolder}</span></div>
    <ul class="sess">
      {#each sessionsShown as s (s.title)}
        <li class:cur={s.current}><b>{s.title}</b><span><span class="ltr">{s.folder}</span> · {s.when}</span></li>
      {/each}
    </ul>
    {#if d.sessions.length > SESSION_PEEK}<button class="more" onclick={() => (allSessions = !allSessions)}>{allSessions ? c.showLess : `${c.showMore} ${d.sessions.length - SESSION_PEEK}`}</button>{/if}
  </div>
</div>

<style>
  .panel { display: flex; flex-direction: column; }
  .ltr { direction: ltr; unicode-bidi: isolate; }
  .load { display: flex; gap: 16px; padding: 4px 0 0; }
  .load .meter { flex: 1; }
  .actions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-block-start: 16px; }
  .act { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 4px; border-radius: var(--r-k); background: var(--surface-2); border: 1px solid var(--line); font-size: var(--t-xs); color: var(--fg-dim); text-align: center; line-height: 1.3; }
  .act:hover { color: var(--fg); background: var(--surface-3); }
  .act.danger { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 25%, transparent); }
  .block { margin-block-start: 20px; }
  .fl { font-size: var(--t-sm); color: var(--fg-dim); margin: 12px 2px 6px; }
  .fl:first-child { margin-block-start: 0; }
  .fl.tight { margin: 0 2px 6px; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .ico { color: var(--fg-muted); display: grid; }
  .run-on { font-weight: 400; }
  :global(.dv2 [dir="ltr"] .flip) { transform: scaleX(-1); }
  .field.area { min-block-size: 64px; align-items: flex-start; padding-block: 10px; font-size: var(--t-sm); }
  .field.small { min-block-size: 38px; margin-block-start: 6px; font-size: var(--t-sm); }
  .hacts { display: flex; gap: 2px; }
  .accent { color: var(--accent); }
  .mt { margin-block-start: 8px; }
  .sess { list-style: none; margin: 6px 0 0; padding: 0; }
  .sess li { display: flex; flex-direction: column; padding: 9px 0 9px; padding-inline-start: 12px; border-block-end: 1px solid var(--line); position: relative; }
  .sess li b { font-weight: 500; font-size: var(--t-sm); }
  .sess li span { font-size: var(--t-xs); color: var(--fg-muted); }
  .sess li.cur::before { content: ""; position: absolute; inset-inline-start: 0; inset-block: 10px; inline-size: 3px; border-radius: 2px; background: var(--accent); }
  .more { margin-block-start: 8px; block-size: 36px; padding-inline: 12px; border-radius: var(--r-c); font-size: var(--t-sm); color: var(--accent); }
  .more:hover { background: var(--surface-2); }
  .last { padding-block-end: 24px; }
</style>
