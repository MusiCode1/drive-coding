<script lang="ts">
import CliMark from "./CliMark.svelte"
import { type DesignContent, designContent } from "./content"
import * as I from "./icons"
import type { PopupKind, PopupPick } from "./proto"

let {
  content,
  kind,
  on = {},
}: {
  content: DesignContent
  kind: PopupKind
  on?: { close?: () => void; pick?: (p: PopupPick) => void }
} = $props()
const c = $derived(content.copy)
const p = $derived(content.copy.pop)
const d = $derived(content.data)
const view = $derived(kind === "langSelect" ? "select" : kind)
let crumbs = $state<string[]>(["home", "user"])
let other = $state("")
function pick(value: string) {
  on.pick?.({ kind, value })
}
function close() {
  on.close?.()
}
const options = $derived(
  kind === "langSelect"
    ? [
        { name: designContent("he").copy.language, available: true },
        { name: designContent("en").copy.language, available: true },
      ]
    : d.clis,
)
</script>

  {#if view !== "budget" && view !== "slash" && view !== "permission"}<button class="scrim" aria-label={p.close} onclick={close}></button>{:else if view === "budget" || view === "slash"}<button class="scrim clear" aria-label={p.close} onclick={close}></button>{/if}

  {#if view === "folderPicker"}
    <div class="sheet full" role="dialog" aria-label={p.folderTitle}>
      <header class="sh-h"><h2>{p.folderTitle}</h2><button class="ib" aria-label={p.close} onclick={close}><I.X size={20} /></button></header>
      <div class="shortcuts">
        <button class="chip" class:primary={crumbs.length === 2} onclick={() => (crumbs = ["home", "user"])}><I.Home size={15} />{p.home}</button>
        <button class="chip" class:primary={crumbs[2] === "projects"} onclick={() => (crumbs = ["home", "user", "projects"])}><I.FolderGit size={15} />{p.projects}</button>
        <button class="chip" onclick={() => on.pick?.({ kind: "cwdCombo", value: "" })}><I.Clock size={15} />{p.recentShort}</button>
      </div>
      <nav class="crumbs"><button class="ib" aria-label={p.up} onclick={() => crumbs.length > 1 && (crumbs = crumbs.slice(0, -1))}><I.ArrowUp size={16} /></button><span class="ltr path">{#each crumbs as cr, i (i)}<span class="dim">/</span> <button class:cur={i === crumbs.length - 1} onclick={() => (crumbs = crumbs.slice(0, i + 1))}>{cr}</button> {/each}</span></nav>
      <div class="field small"><I.Search size={15} class="muted" /><span class="v ph">{p.filter}</span></div>
      <ul class="rows">
        {#each d.dirs as dir (dir)}<li><button class="li-btn" onclick={() => (crumbs = [...crumbs, dir])}><I.FolderIcon size={18} /><span class="ltr name">{dir}</span><I.ChevronLeft size={16} class="muted flip" /></button></li>{/each}
      </ul>
      <footer class="sh-f">
        <div class="hid"><span class="sw"></span>{p.hidden}</div>
        <button class="btn" onclick={() => pick(`/${crumbs.join("/")}`)}>{p.chooseThis}&nbsp;<span class="ltr">{crumbs[crumbs.length - 1]}</span></button>
      </footer>
    </div>
  {:else if view === "cwdCombo"}
    <div class="sheet" role="listbox" aria-label={p.comboHint}>
      <div class="field small"><I.Search size={15} class="muted" /><span class="v ph">{c.searchFolders}</span></div>
      <ul class="rows two">
        {#each d.recents.slice(0, 6) as r (r.name + r.ago)}
          <li><button class="li-btn" onclick={() => pick(`${r.parent}/${r.name}`)}><I.FolderIcon size={18} /><span class="col"><span class="ltr name">{r.name}</span><span class="sub"><span class="ltr">{r.parent}</span> · {r.ago}</span></span></button></li>
        {/each}
      </ul>
    </div>
  {:else if view === "select"}
    <div class="sheet" role="listbox" aria-label={p.selectTitle}>
      <header class="sh-h"><h2>{kind === "langSelect" ? c.uiLanguage : p.selectTitle}</h2><button class="ib" aria-label={p.close} onclick={close}><I.X size={20} /></button></header>
      <ul class="rows">
        {#each options as cli, i (cli.name)}
          <li class:off={!cli.available} class:sel={i === 0}><button class="li-btn" disabled={!cli.available} onclick={() => pick(cli.name)}>{#if kind !== "langSelect"}<CliMark name={cli.name} size={22} />{/if}<span class="col"><span class="name">{cli.name}</span>{#if !cli.available}<span class="sub">{c.notInstalled}</span>{/if}</span>{#if i === 0}<I.Check size={18} class="acc" />{/if}</button></li>
        {/each}
      </ul>
    </div>
  {:else if view === "permission"}
    <div class="dock-perm" role="alertdialog" aria-label={p.permTitle}>
      <div class="pm-h"><I.FilePen size={18} /><b>{p.permTitle}</b></div>
      <pre class="cmd"><span class="dim">{p.permWhat}</span> playlist.test.ts</pre>
      <p class="spoken">{p.permSpoken}</p>
      <div class="pm-a">
        <button class="big primary" onclick={() => pick("once")}>{p.permOnce}</button>
        <button class="big" onclick={() => pick("always")}>{p.permAlways}</button>
        <button class="big danger" onclick={() => pick("deny")}>{p.permDeny}</button>
      </div>
      <div class="timer"><span class="bar"><i></i></span><span class="num">42 {c.seconds}</span></div>
    </div>
  {:else if view === "budget"}
    <div class="pop budget" role="dialog" aria-label={p.budgetTitle}>
      <h3>{p.budgetTitle}</h3>
      <div class="meter"><div class="top"><span>{p.contextUsed}</span><b class="num ltr">47K / 1M</b></div><div class="bar"><i style="inline-size:5%"></i></div></div>
      <dl>
        <div><dt>{p.costSoFar}</dt><dd class="num ltr">$0.28</dd></div>
        <div><dt>{p.compactionsN}</dt><dd class="num">0</dd></div>
        <div><dt>{p.quotaTitle}</dt><dd>{p.resets}</dd></div>
      </dl>
    </div>
  {:else if view === "slash"}
    <div class="pop slash" role="listbox" aria-label={p.slashFilter}>
      {#each d.slash as s, i (s.cmd)}
        <button class="sl" class:sel={i === 0} onclick={() => pick(s.cmd)}><code><b>/</b>{s.cmd.slice(1)}</code><span>{s.desc}</span></button>
      {/each}
    </div>
  {:else if view === "viewer"}
    <div class="sheet full viewer" role="dialog" aria-label={p.viewerTitle}>
      <header class="sh-h"><h2 class="ltr-h">{p.viewerTitle}</h2><button class="ib" aria-label={p.wrap}><I.WrapText size={18} /></button><button class="ib" aria-label={p.copy}><I.Copy size={18} /></button><button class="ib" aria-label={p.close} onclick={close}><I.X size={20} /></button></header>
      <pre class="out">{d.toolOut}
{d.toolOut}
{d.toolOut}</pre>
    </div>
  {:else if view === "elicit"}
    <div class="sheet" role="dialog" aria-label={p.elicitTitle}>
      <header class="sh-h"><h2><I.MessageQuestion size={18} />{p.elicitTitle}</h2><button class="ib" aria-label={p.close} onclick={close}><I.X size={20} /></button></header>
      <p class="q">{p.elicitQ}</p>
      <ul class="rows radio">
        {#each d.branches as b, i (b)}<li class:sel={other === "" ? i === 0 : false}><button class="li-btn" onclick={() => pick(b)}><span class="rd"></span><span class="ltr name">{b}</span></button></li>{/each}
        <li class:sel={other !== ""}><span class="rd"></span><input class="other" placeholder={p.elicitOther} bind:value={other} /></li>
      </ul>
      <footer class="sh-f row-f"><button class="chip" onclick={() => pick("")}>{p.elicitDecline}</button><button class="btn" onclick={() => pick(other || d.branches[0] || "")}>{p.elicitSubmit}</button></footer>
    </div>
  {/if}

<style>
  .scrim { position: absolute; inset: 0; z-index: 4; background: rgba(0, 0, 0, 0.5); border: 0; }
  .scrim.clear { background: transparent; }
  .li-btn { display: flex; align-items: center; gap: 12px; inline-size: 100%; min-block-size: 50px; text-align: start; color: inherit; }
  .li-btn:disabled { cursor: not-allowed; }
  .crumbs button { color: var(--fg-dim); } .crumbs button.cur { color: var(--fg); font-weight: 700; }
  .other { flex: 1; background: none; border: 0; outline: none; color: var(--fg); font: inherit; }
  .sl { inline-size: 100%; text-align: start; }
  .sheet, .pop, .dock-perm { z-index: 5; }
  .ltr { direction: ltr; unicode-bidi: isolate; }
  :global(.dv2 [dir="ltr"] .flip) { transform: scaleX(-1); }
  .sheet { position: absolute; inset-inline: 0; inset-block-end: 0; max-block-size: 80%; display: flex; flex-direction: column; gap: 12px; padding: 16px 20px 20px; background: var(--surface-1); border-radius: var(--r-s) var(--r-s) 0 0; border-block-start: 1px solid var(--line-2); overflow: auto; }
  .sheet.full { inset-block-start: 0; max-block-size: none; border-radius: 0; }
  .sh-h { display: flex; align-items: center; gap: 4px; }
  .sh-h h2 { flex: 1; margin: 0; font-size: var(--t-lg); font-weight: 600; display: flex; align-items: center; gap: 8px; }
  .ltr-h { direction: ltr; text-align: end; font-family: var(--mono); font-size: var(--t-sm) !important; }
  .shortcuts { display: flex; gap: 8px; flex-wrap: wrap; }
  .crumbs { display: flex; align-items: center; gap: 6px; font-size: var(--t-md); }
  .path { flex: 1; text-align: end; }
  .field.small { min-block-size: 40px; font-size: var(--t-sm); }
  .rows { list-style: none; margin: 0; padding: 0; flex: 1; overflow: auto; }
  .rows li { display: flex; align-items: center; gap: 12px; min-block-size: 50px; border-block-end: 1px solid var(--line); color: var(--fg-dim); }
  .rows li :global(svg) { flex-shrink: 0; }
  .rows .name { flex: 1; color: var(--fg); text-align: start; }
  .rows .col { flex: 1; display: flex; flex-direction: column; min-inline-size: 0; }
  .rows .sub { font-size: var(--t-xs); color: var(--fg-muted); }
  .rows li.sel .name { font-weight: 600; }
  .rows li.off { opacity: 0.5; }
  :global(.dv2 .acc) { color: var(--accent); }
  .sh-f { display: flex; flex-direction: column; gap: 12px; padding-block-start: 8px; border-block-start: 1px solid var(--line); }
  .row-f { flex-direction: row; align-items: center; }
  .row-f .btn { flex: 1; }
  .hid { display: flex; align-items: center; gap: 10px; font-size: var(--t-sm); color: var(--fg-dim); }
  .dock-perm { position: absolute; inset-inline: 0; inset-block-end: 0; padding: 16px 20px 24px; background: var(--surface-1); border-block-start: 2px solid var(--accent); border-radius: var(--r-s) var(--r-s) 0 0; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 -12px 32px rgba(0, 0, 0, 0.4); }
  .pm-h { display: flex; align-items: center; gap: 8px; font-size: var(--t-lg); }
  pre { margin: 0; padding: 10px 12px; border-radius: var(--r-c); background: var(--code-bg); font-family: var(--mono); font-size: 13px; direction: ltr; text-align: left; color: var(--fg); overflow: auto; }
  .spoken { margin: 0; font-size: var(--t-sm); color: var(--fg-muted); }
  .pm-a { display: flex; flex-direction: column; gap: 8px; }
  .big { block-size: 52px; border-radius: var(--r-c); border: 1px solid var(--line-2); font-size: var(--t-md); font-weight: 600; }
  .big.primary { background: var(--accent); color: var(--on-accent); border-color: transparent; }
  .big.danger { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 40%, transparent); }
  .timer { display: flex; align-items: center; gap: 10px; font-size: var(--t-xs); color: var(--fg-muted); }
  .timer .bar { flex: 1; block-size: 3px; border-radius: 2px; background: var(--line-2); }
  .timer .bar i { display: block; block-size: 100%; inline-size: 70%; border-radius: 2px; background: var(--accent); }
  .pop { position: absolute; background: var(--surface-1); border: 1px solid var(--line-2); border-radius: var(--r-k); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45); }
  .budget { inset-block-start: 58px; inset-inline-end: 12px; inline-size: min(300px, calc(100% - 24px)); padding: 14px 16px; }
  .budget h3 { margin: 0 0 10px; font-size: var(--t-md); }
  .budget dl { margin: 12px 0 0; display: flex; flex-direction: column; gap: 6px; }
  .budget dl div { display: flex; justify-content: space-between; font-size: var(--t-sm); }
  .budget dt { color: var(--fg-muted); } .budget dd { margin: 0; }
  .slash { inset-inline: 16px; inset-block-end: 210px; padding: 6px; max-inline-size: 760px; margin-inline: auto; }
  .sl { display: flex; flex-direction: column; padding: 8px 10px; border-radius: var(--r-c); }
  .sl.sel { background: var(--surface-3); }
  .sl code { color: var(--fg); text-align: start; direction: ltr; align-self: flex-start; }
  .sl code b { color: var(--accent); }
  .sl span { font-size: var(--t-xs); color: var(--fg-muted); }
  .out { flex: 1; white-space: pre; }
  .q { margin: 0; font-size: var(--t-lg); }
  .radio li { cursor: pointer; }
  .rd { inline-size: 18px; block-size: 18px; border-radius: 50%; border: 2px solid var(--line-2); flex-shrink: 0; }
  .radio li.sel .rd { border-color: var(--accent); box-shadow: inset 0 0 0 4px var(--surface-1); background: var(--accent); }
  .ph { color: var(--fg-muted); }
  @media (min-width: 768px) {
    .sheet { inset: auto; inset-block-start: 50%; inset-inline-start: 50%; transform: translate(-50%, -50%); inline-size: 520px; max-block-size: 80%; border-radius: var(--r-s); border: 1px solid var(--line-2); }
    :global([dir="rtl"]) .sheet { transform: translate(50%, -50%); }
    .sheet.full { inline-size: 640px; block-size: 80%; }
    .dock-perm { inset-inline: 50% auto; transform: translateX(-50%); inline-size: 560px; inset-block-end: 24px; border-radius: var(--r-s); border: 1px solid var(--line-2); border-block-start: 2px solid var(--accent); }
    :global([dir="rtl"]) .dock-perm { inset-inline: auto 50%; transform: translateX(50%); }
    .pm-a { flex-direction: row; }
    .pm-a .big { flex: 1; }
  }
</style>
