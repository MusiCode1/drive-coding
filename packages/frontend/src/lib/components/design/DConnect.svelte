<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down"
import Eye from "@lucide/svelte/icons/eye"
import FolderIcon from "@lucide/svelte/icons/folder"
import FolderOpen from "@lucide/svelte/icons/folder-open"
import GitBranch from "@lucide/svelte/icons/git-branch"
import Globe from "@lucide/svelte/icons/globe"
import Hand from "@lucide/svelte/icons/hand"
import Loader from "@lucide/svelte/icons/loader-circle"
import Plug from "@lucide/svelte/icons/plug"
import Power from "@lucide/svelte/icons/power"
import RefreshCw from "@lucide/svelte/icons/refresh-cw"
import TerminalIcon from "@lucide/svelte/icons/square-terminal"
import Alert from "@lucide/svelte/icons/triangle-alert"
import Users from "@lucide/svelte/icons/users"
import X from "@lucide/svelte/icons/x"
import type { DesignContent } from "./content"

let { content, state }: { content: DesignContent; state: string } = $props()
const c = $derived(content.copy)
const d = $derived(content.data)
const procs = $derived(state === "empty" ? [] : d.processes)
</script>

<div class="connect">
  <header class="topbar">
    <span class="brand"><span class="mark"></span><span class="ltr">{c.brand}</span></span>
    <span class="chip"><Globe size={15} />{c.language}<ChevronDown size={15} /></span>
  </header>

  <div class="cols">
    <section class="form-col">
      <h1>{c.connectTitle}</h1>
      <p class="hint">{c.connectHint}</p>

      <div class="form">
        <div class="fl"><span>{c.cli}</span><button class="ib" aria-label={c.refresh}><RefreshCw size={16} /></button></div>
        <div class="field"><TerminalIcon size={18} class="muted" /><span class="v">{d.clis[0]?.name}</span><ChevronDown size={18} class="muted" /></div>
        <div class="fl"><span>{c.cwd}</span></div>
        <div class="field cwd">
          <button class="ib" aria-label={c.browse}><FolderOpen size={18} /></button>
          <span class="v mono-path">{d.cwd}</span>
          <ChevronDown size={18} class="muted" />
        </div>
        {#if state === "error"}
          <div class="error" role="alert">
            <Alert size={18} />
            <div><b>{c.errorPrefix}</b><p>{d.error}</p><p class="dim">{c.authHint}</p></div>
          </div>
        {/if}
      </div>

      <div class="cta">
        <button class="btn" disabled={state === "connecting"}>
          {#if state === "connecting"}<Loader size={18} class="spin" />{c.connecting}{:else}{state === "error" ? c.tryAgain : c.connect}{/if}
        </button>
      </div>
    </section>

    <section class="list-col">
      <div class="sec">
        <div class="sec-h">
          <span class="label">{c.active}{#if procs.length} · <span class="num">{procs.length}</span>{/if}</span>
          <button class="ib" aria-label={c.refresh}><RefreshCw size={16} /></button>
        </div>
        <div class="load">
          <div class="meter"><div class="top"><span>{c.machine.memory}</span><b class="num ltr">{d.machine.memUsed} / {d.machine.memTotal} GB</b></div><div class="bar"><i style="inline-size:{d.machine.memPct}%"></i></div></div>
          <div class="meter hot"><div class="top"><span>{c.machine.cpu}</span><b class="num ltr">{d.machine.cpuPct}%</b></div><div class="bar"><i style="inline-size:{d.machine.cpuPct}%"></i></div></div>
        </div>
        {#if procs.length === 0}
          <p class="empty">{c.activeEmpty}</p>
        {/if}
        {#each procs as p, i (i)}
          <article class="proc" class:first={i === 0}>
            <div class="l1"><span class="dot" class:busy={p.busy}></span><b>{p.title}</b>{#if p.busy}<span class="busy">{c.working}</span>{/if}</div>
            <div class="l2"><span>{p.cli}</span><span>·</span><span class="ltr">{p.folder}</span><span>·</span><span>{p.ago}</span></div>
            <div class="l3">
              {#if p.attached}<span class="tag">{c.openElsewhere}</span>{/if}
              {#if p.watchers}<span><Eye size={13} />{p.watchers} {c.watchers}</span>{/if}
              {#if p.children}<span><Users size={13} />{p.children} {c.children}</span>{/if}
            </div>
            <div class="acts">
              {#if p.attached}
                <button class="chip primary"><Hand size={15} />{c.takeOver}</button>
              {:else}
                <button class="chip primary"><Plug size={15} />{c.reconnect}</button>
              {/if}
              <span class="sp"></span>
              <button class="chip danger"><Power size={15} />{c.kill}</button>
            </div>
          </article>
        {/each}
      </div>

      <div class="sec">
        <div class="sec-h">
          <span class="label">{c.recent}</span>
          <button class="ib" aria-label={c.refresh}><RefreshCw size={16} /></button>
        </div>
        {#each d.recents as r, i (i)}
          <div class="item" class:sel={i === 0}>
            <span class="glyph">{#if r.worktree}<GitBranch size={18} />{:else}<FolderIcon size={18} />{/if}</span>
            <span class="body">
              <span class="name ltr">{r.name}</span>
              <span class="meta">{#if r.worktree}<span class="tag">{c.worktree}</span><span class="ltr">{r.parent}</span>·{/if}<span>{r.cli}</span>·<span>{r.ago}</span></span>
            </span>
            <button class="ib" aria-label={c.remove}><X size={16} /></button>
          </div>
        {/each}
      </div>
    </section>
  </div>

  {#if state === "connecting"}
    <div class="veil"><div class="veil-card"><Loader size={28} class="spin" />{c.loadingSession}</div></div>
  {/if}
</div>

<style>
  .connect { min-block-size: 100dvh; display: flex; flex-direction: column; position: relative; }
  .topbar { display: flex; align-items: center; justify-content: space-between; padding: 48px 20px 0; max-inline-size: 1120px; inline-size: 100%; margin-inline: auto; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: var(--t-lg); }
  .mark { inline-size: 8px; block-size: 8px; border-radius: 50%; background: var(--accent); }
  .ltr { direction: ltr; unicode-bidi: isolate; }
  .cols { display: flex; flex-direction: column; flex: 1; max-inline-size: 1120px; inline-size: 100%; margin-inline: auto; }
  .form-col { display: contents; }
  h1 { font-size: var(--t-xl); font-weight: 600; margin: 20px 20px 0; order: 0; }
  .hint { margin: 4px 20px 0; color: var(--fg-dim); font-size: var(--t-sm); order: 0; }
  .list-col { order: 1; }
  .form { order: 2; padding: 20px; border-block-start: 1px solid var(--line); margin-block-start: 12px; }
  .cta { order: 3; position: sticky; inset-block-end: 0; padding: 14px 20px 24px; background: var(--bg); border-block-start: 1px solid var(--line); margin-block-start: auto; }
  .fl { display: flex; align-items: center; justify-content: space-between; font-size: var(--t-sm); color: var(--fg-dim); margin: 14px 2px 6px; min-block-size: 24px; }
  .fl:first-child { margin-block-start: 0; }
  .cwd { padding-inline-start: 4px; }
  .mono-path { direction: ltr; text-align: end; }
  .error { display: flex; gap: 10px; margin-block-start: 16px; padding: 12px; border-radius: var(--r-k); color: var(--bad); background: color-mix(in srgb, var(--bad) 10%, transparent); border: 1px solid color-mix(in srgb, var(--bad) 30%, transparent); }
  .error b { display: block; } .error p { margin: 2px 0 0; font-size: var(--t-sm); }
  .sec { padding: 20px 20px 0; }
  .sec-h { display: flex; align-items: center; justify-content: space-between; margin-block-end: 6px; }
  .load { display: flex; gap: 16px; margin-block: 2px 4px; }
  .load .meter { flex: 1; }
  .empty { color: var(--fg-muted); font-size: var(--t-sm); margin: 14px 0 0; }
  .proc { margin-block-start: 12px; padding: 12px; border-radius: var(--r-k); background: var(--surface-1); border: 1px solid var(--line); }
  .proc.first { border-color: var(--line-2); }
  .l1 { display: flex; align-items: center; gap: 8px; }
  .l1 b { flex: 1; font-weight: 600; font-size: var(--t-md); }
  .busy { font-size: var(--t-xs); color: var(--busy); }
  .l2 { display: flex; gap: 6px; flex-wrap: wrap; font-size: var(--t-sm); color: var(--fg-dim); margin-block-start: 2px; padding-inline-start: 15px; }
  .l3 { display: flex; gap: 10px; font-size: var(--t-xs); color: var(--fg-muted); padding-inline-start: 15px; margin-block-start: 4px; }
  .l3:empty { display: none; }
  .l3 span { display: inline-flex; align-items: center; gap: 4px; }
  .tag { font-size: var(--t-xs); color: var(--fg-dim); border: 1px solid var(--line-2); border-radius: 6px; padding: 0 6px; }
  .acts { display: flex; gap: 8px; margin-block-start: 10px; }
  .sp { flex: 1; }
  .item { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-block-end: 1px solid var(--line); }
  .item:last-child { border-block-end: 0; }
  .glyph { inline-size: 36px; block-size: 36px; border-radius: var(--r-c); background: var(--surface-2); display: grid; place-items: center; color: var(--fg-dim); flex-shrink: 0; }
  .item.sel .glyph { background: var(--accent-soft); color: var(--accent); }
  .body { flex: 1; min-inline-size: 0; display: flex; flex-direction: column; }
  .name { font-weight: 500; text-align: start; }
  .meta { display: flex; gap: 6px; font-size: var(--t-xs); color: var(--fg-muted); margin-block-start: 1px; flex-wrap: wrap; }
  .veil { position: absolute; inset: 0; display: grid; place-items: center; background: color-mix(in srgb, var(--bg) 70%, transparent); backdrop-filter: blur(4px); }
  .veil-card { display: flex; align-items: center; gap: 12px; padding: 18px 22px; border-radius: var(--r-k); background: var(--surface-1); border: 1px solid var(--line-2); color: var(--fg-dim); }
  :global(.dv2 .spin) { animation: dv2-spin 1s linear infinite; }
  @keyframes dv2-spin { to { transform: rotate(360deg); } }

  @media (min-width: 768px) {
    .topbar { padding-block-start: 40px; }
    .cols { display: grid; grid-template-columns: minmax(320px, 400px) 1fr; gap: 40px; padding: 0 20px; align-items: start; }
    .form-col { display: block; position: sticky; inset-block-start: 24px; }
    h1, .hint { margin-inline: 0; }
    .form { padding: 20px; margin-block-start: 24px; border: 1px solid var(--line); border-radius: var(--r-k); background: var(--surface-1); }
    .cta { position: static; padding: 16px 0 0; border: 0; background: none; }
    .sec { padding-inline: 0; }
    .sec:first-child { padding-block-start: 28px; }
  }
</style>
