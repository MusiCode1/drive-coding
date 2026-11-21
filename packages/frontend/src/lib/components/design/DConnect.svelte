<script lang="ts">
import CliMark from "./CliMark.svelte"
import type { DesignContent } from "./content"
import * as I from "./icons"
import type { ConnectActions } from "./proto"
import { ConnectUi, connectLists, PROC_PEEK, RECENT_PEEK } from "./ui-state.svelte"

let {
  content,
  state: view,
  cli,
  cwd,
  on = {},
}: {
  content: DesignContent
  state: string
  cli?: string
  cwd?: string
  on?: ConnectActions
} = $props()
const c = $derived(content.copy)
const d = $derived(content.data)
const live = $derived(on.connect !== undefined)
const ui = new ConnectUi()
const L = $derived(connectLists(d, view, ui))
const promptText = $derived(live ? ui.prompt : view === "prompt" ? d.userText : "")
const confirmIdx = $derived(live ? ui.confirmKill : 2)
</script>

<div class="connect">
  <header class="topbar">
    <span class="brand"><span class="mark"></span><span class="ltr">{c.brand}</span></span>
    <span class="top-acts">
      <button class="chip" onclick={() => on.openPopup?.("langSelect")}><I.Globe size={15} />{c.language}<I.ChevronDown size={15} /></button>
      <button class="ib" aria-label={c.settings} onclick={() => on.settings?.()}><I.SettingsIcon size={18} /></button>
    </span>
  </header>

  <div class="cols">
    <section class="form-col">
      <h1>{c.connectTitle}</h1>
      <p class="hint">{c.connectHint}</p>

      <div class="form">
        <div class="fl first"><span>{c.cli}</span><button class="ib" aria-label={c.refresh}><I.RefreshCw size={16} /></button></div>
        <button class="field pick" onclick={() => on.openPopup?.("select")}><CliMark name={cli ?? d.clis[0]?.name ?? ""} size={20} /><span class="v">{cli ?? d.clis[0]?.name}</span><I.ChevronDown size={18} class="muted" /></button>
        <div class="fl"><span>{c.cwd}</span></div>
        <div class="field cwd">
          <button class="ib" aria-label={c.browse} onclick={() => on.openPopup?.("folderPicker")}><I.FolderOpen size={18} /></button>
          <button class="v mono-path" onclick={() => on.openPopup?.("cwdCombo")}>{cwd ?? d.cwd}</button>
          <button class="ib" aria-label={c.recent} onclick={() => on.openPopup?.("cwdCombo")}><I.ChevronDown size={18} /></button>
        </div>
        <div class="fl"><span>{c.promptLabel}</span></div>
        <div class="field prompt" class:filled={promptText !== ""}>
          {#if live}
            <textarea class="v ptext" rows="3" placeholder={c.promptPh} bind:value={ui.prompt}></textarea>
          {:else}
            <span class="v ptext" class:ph={promptText === ""}>{promptText || c.promptPh}</span>
          {/if}
          <button class="ib" aria-label={c.dictate} onclick={() => live && (ui.prompt = d.userText)}><I.Mic size={18} /></button>
        </div>
        {#if view === "error"}
          <div class="error" role="alert">
            <I.Alert size={18} />
            <div>
              <b>{c.errorPrefix}</b><p>{d.error}</p>
              <div class="auth">
                <p class="ah"><span>{c.authHow}</span> <span class="cli"><CliMark name={d.auth.cli} size={14} />{d.auth.cli}</span></p>
                <p>{c.authSet} {#each d.auth.env as v (v)}<code>{v}</code>{/each} · <a href="#docs" target="_blank" rel="noopener noreferrer">{c.authDocs}</a></p>
                <p>{c.authTerminal} <code>{d.auth.cmd}</code></p>
              </div>
            </div>
          </div>
        {/if}
      </div>

      <div class="cta">
        <button class="btn" disabled={view === "connecting"} onclick={() => on.connect?.(ui.prompt)}>
          {#if view === "connecting"}<I.Loader size={18} class="spin" />{c.connecting}{:else if view === "error"}{c.tryAgain}{:else if promptText !== ""}{c.startWithPrompt}{:else}{c.connect}{/if}
        </button>
      </div>
    </section>

    <section class="list-col">
      <div class="sec">
        <div class="sec-h">
          <span class="label">{c.active}{#if L.procs.length} · <span class="num">{L.procs.length}</span>{/if}</span>
          <button class="ib" aria-label={c.refresh}><I.RefreshCw size={16} /></button>
        </div>
        <div class="load">
          <div class="meter"><div class="top"><span>{c.machine.memory}</span><b class="num ltr">{d.machine.memUsed} / {d.machine.memTotal} GB</b></div><div class="bar"><i style="inline-size:{d.machine.memPct}%"></i></div></div>
          <div class="meter hot"><div class="top"><span>{c.machine.cpu}</span><b class="num ltr">{d.machine.cpuPct}%</b></div><div class="bar"><i style="inline-size:{d.machine.cpuPct}%"></i></div></div>
        </div>
        {#if L.procs.length === 0}
          <p class="empty">{c.activeEmpty}</p>
        {/if}
        {#each L.procsShown as p, i (p.i)}
          <article class="proc" class:first={i === 0} class:confirm={confirmIdx === (live ? p.i : i)}>
            <button class="hit" aria-label="{c.reconnect}: {p.title}" onclick={() => on.reconnect?.(p.i)}></button>
            <div class="l1">
              <span class="dot" class:busy={p.busy}></span><b>{p.title}</b>
              <button class="kill" aria-label="{c.killNamed} {p.title}" onclick={() => ui.kill(p.i, live)}><I.Power size={14} />{confirmIdx === (live ? p.i : i) ? c.killConfirm : c.kill}</button>
            </div>
            <div class="l2"><span class="cli"><CliMark name={p.cli} size={14} />{p.cli}</span><span>·</span><span class="ltr">{p.folder}</span><span>·</span><span>{p.ago}</span>{#if p.busy}<span class="busy">{c.working}</span>{/if}</div>
            {#if p.connections || p.children}
              <div class="l3">
                {#if p.connections}<span><I.Eye size={13} />{p.connections} {c.connections}</span>{/if}
                {#if p.children}<span><I.Users size={13} />{p.children} {c.children}</span>{/if}
              </div>
            {/if}
          </article>
          {#if "kids" in p && p.kids}
            <ul class="kids" aria-label="{c.subAgentsOf} {p.title}">
              {#each p.kids as k (k.title)}
                <li><span class="dot" class:busy={k.busy}></span><span class="kt"><bdi>{k.title}</bdi></span><span class="cli"><CliMark name={k.cli} size={12} />{k.cli}</span></li>
              {/each}
            </ul>
          {/if}
        {/each}
        {#if L.procs.length > PROC_PEEK}
          <button class="more" onclick={() => (ui.allProcs = !ui.allProcs)}>{L.procsOpen ? c.showLess : `${c.showMore} ${L.procs.length - PROC_PEEK}`}</button>
        {/if}
      </div>

      <div class="sec">
        <div class="sec-h">
          <span class="label">{c.recent} · <span class="num">{L.recents.length}</span></span>
          <button class="ib" aria-label={c.refresh}><I.RefreshCw size={16} /></button>
        </div>
        {#if L.recentsOpen}
          <div class="field search"><I.Search size={15} class="muted" /><span class="v ph">{c.searchFolders}</span></div>
        {/if}
        {#each L.recentsShown as r, i (r.i)}
          <div class="item" class:sel={i === 0}>
            <span class="glyph">{#if r.worktree}<I.GitBranch size={18} />{:else}<I.FolderIcon size={18} />{/if}</span>
            <span class="body">
              <span class="name ltr">{r.name}</span>
              <span class="meta">{#if r.worktree}<span class="tag">{c.worktree}</span><span class="ltr">{r.parent}</span>·{/if}<span class="cli"><CliMark name={r.cli} size={12} />{r.cli}</span>·<span>{r.ago}</span></span>
            </span>
            <button class="ib" aria-label={c.remove} onclick={() => ui.remove(r.i, live)}><I.X size={16} /></button>
          </div>
        {/each}
        {#if L.recents.length > RECENT_PEEK}
          <button class="more" onclick={() => (ui.allRecents = !ui.allRecents)}>{L.recentsOpen ? c.showLess : `${c.showAll} (${L.recents.length})`}</button>
        {/if}
      </div>
    </section>
  </div>

  {#if view === "connecting"}
    <div class="veil"><div class="veil-card"><I.Loader size={28} class="spin" />{c.loadingSession}</div></div>
  {/if}
</div>

<style>
  .connect { min-block-size: 100dvh; display: flex; flex-direction: column; position: relative; }
  .topbar { display: flex; align-items: center; justify-content: space-between; padding: 48px 20px 0; max-inline-size: 1120px; inline-size: 100%; margin-inline: auto; }
  .cli { display: inline-flex; align-items: center; gap: 5px; }
  .kids { list-style: none; margin: 0 0 0 0; padding: 0; padding-inline-start: 22px; position: relative; }
  .kids::before { content: ""; position: absolute; inset-inline-start: 12px; inset-block: 0 18px; border-inline-start: 1px solid var(--line-2); }
  .kids li { position: relative; display: flex; align-items: center; gap: 8px; min-block-size: 40px; font-size: var(--t-sm); color: var(--fg-dim); }
  .kids li::before { content: ""; position: absolute; inset-inline-start: -10px; inline-size: 8px; border-block-start: 1px solid var(--line-2); }
  .kt { flex: 1; min-inline-size: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--fg); }
  .auth { margin-block-start: 10px; padding-block-start: 10px; border-block-start: 1px solid color-mix(in srgb, var(--bad) 25%, transparent); color: var(--fg); }
  .auth p { margin: 4px 0 0; font-size: var(--t-sm); }
  .auth .ah { font-weight: 600; display: flex; align-items: center; gap: 6px; }
  .auth code { margin-inline-end: 4px; }
  .auth a { color: var(--accent); }
  .top-acts { display: flex; align-items: center; gap: 4px; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: var(--t-lg); }
  .mark { inline-size: 8px; block-size: 8px; border-radius: 50%; background: var(--accent); }
  .ltr { direction: ltr; unicode-bidi: isolate; }
  .cols { display: flex; flex-direction: column; flex: 1; max-inline-size: 1120px; inline-size: 100%; margin-inline: auto; }
  .form-col { display: contents; }
  h1 { font-size: var(--t-xl); font-weight: 600; margin: 20px 20px 0; order: 0; }
  .hint { margin: 4px 20px 0; color: var(--fg-dim); font-size: var(--t-sm); order: 0; }
  .list-col { order: 2; }
  .form { order: 1; padding: 20px; margin-block-start: 4px; }
  .cta { order: 3; z-index: 3; position: sticky; inset-block-end: 0; padding: 14px 20px 24px; background: var(--bg); border-block-start: 1px solid var(--line); margin-block-start: auto; }
  .fl { display: flex; align-items: center; justify-content: space-between; font-size: var(--t-sm); color: var(--fg-dim); margin: 14px 2px 6px; min-block-size: 24px; }
  .fl:first-child, .fl.first { margin-block-start: 0; }
  .prompt { align-items: flex-start; min-block-size: 76px; padding-block: 10px; padding-inline-end: 4px; }
  .field.prompt .v.ptext { overflow: visible; text-overflow: clip; white-space: normal; font-size: var(--t-sm); line-height: 1.5; }
  .prompt.filled .ptext { font-size: var(--t-md); }
  .prompt .ib { margin-block-start: -6px; }
  .cwd { padding-inline-start: 4px; }
  .mono-path { direction: ltr; text-align: end; }
  .error { display: flex; gap: 10px; margin-block-start: 16px; padding: 12px; border-radius: var(--r-k); color: var(--bad); background: color-mix(in srgb, var(--bad) 10%, transparent); border: 1px solid color-mix(in srgb, var(--bad) 30%, transparent); }
  .error b { display: block; } .error p { margin: 2px 0 0; font-size: var(--t-sm); }
  .sec { padding: 20px 20px 0; }
  /* section divider */
  .sec + .sec { margin-block-start: 20px; border-block-start: 1px solid var(--line-2); }
  .list-col { border-block-start: 1px solid var(--line-2); margin-block-start: 8px; }
  .pick { inline-size: 100%; text-align: start; cursor: pointer; }
  .cwd .v { text-align: end; cursor: pointer; }
  textarea.ptext { flex: 1; resize: none; background: none; border: 0; color: var(--fg); font: inherit; font-size: var(--t-md); outline: none; padding: 0; }
  textarea.ptext::placeholder { color: var(--fg-muted); font-size: var(--t-sm); }
  .sec-h { display: flex; align-items: center; justify-content: space-between; margin-block-end: 6px; }
  .load { display: flex; gap: 16px; margin-block: 2px 4px; }
  .load .meter { flex: 1; }
  .empty { color: var(--fg-muted); font-size: var(--t-sm); margin: 14px 0 0; }
  .proc { position: relative; margin-block-start: 10px; padding: 12px; border-radius: var(--r-k); background: var(--surface-1); border: 1px solid var(--line); transition: background-color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease); }
  .proc:hover, .proc:has(.hit:focus-visible) { background: var(--surface-2); border-color: var(--line-2); }
  .proc:active { background: var(--surface-3); }
  .hit { position: absolute; inset: 0; border-radius: inherit; z-index: 0; }
  .hit:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .kill { position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 5px; block-size: 30px; padding-inline: 10px; border-radius: 8px; font-size: var(--t-xs); color: var(--fg-muted); border: 1px solid transparent; flex-shrink: 0; }
  .kill:hover { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 35%, transparent); }
  .proc.confirm .kill { color: var(--on-accent); background: var(--bad); }
  .more { margin-block-start: 10px; block-size: 36px; padding-inline: 12px; border-radius: var(--r-c); font-size: var(--t-sm); color: var(--accent); }
  .more:hover { background: var(--surface-2); }
  .search { min-block-size: 40px; margin-block: 2px 4px; font-size: var(--t-sm); }
  .proc.first { border-color: var(--line-2); }
  .l1 { display: flex; align-items: center; gap: 8px; pointer-events: none; }
  .l1 .kill { pointer-events: auto; }
  .l2, .l3 { pointer-events: none; }
  .l1 b { flex: 1; font-weight: 600; font-size: var(--t-md); }
  .busy { font-size: var(--t-xs); color: var(--busy); }
  .l2 { display: flex; gap: 6px; flex-wrap: wrap; font-size: var(--t-sm); color: var(--fg-dim); margin-block-start: 2px; padding-inline-start: 15px; }
  .l3 { display: flex; gap: 10px; font-size: var(--t-xs); color: var(--fg-muted); padding-inline-start: 15px; margin-block-start: 4px; }
  .l3:empty { display: none; }
  .l3 span { display: inline-flex; align-items: center; gap: 4px; }
  .tag { font-size: var(--t-xs); color: var(--fg-dim); border: 1px solid var(--line-2); border-radius: 6px; padding: 0 6px; }
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
    .list-col { border: 0; margin: 0; }
  }
</style>
