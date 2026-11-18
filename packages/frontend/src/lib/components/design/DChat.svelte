<script lang="ts">
import Check from "@lucide/svelte/icons/check"
import Copy from "@lucide/svelte/icons/copy"
import EyeOff from "@lucide/svelte/icons/eye-off"
import FileText from "@lucide/svelte/icons/file-text"
import FolderIcon from "@lucide/svelte/icons/folder"
import ImagePlus from "@lucide/svelte/icons/image-plus"
import Keyboard from "@lucide/svelte/icons/keyboard"
import Loader from "@lucide/svelte/icons/loader-circle"
import Maximize from "@lucide/svelte/icons/maximize-2"
import Menu from "@lucide/svelte/icons/menu"
import Mic from "@lucide/svelte/icons/mic"
import Pause from "@lucide/svelte/icons/pause"
import Pencil from "@lucide/svelte/icons/pencil"
import Radio from "@lucide/svelte/icons/radio"
import Search from "@lucide/svelte/icons/search"
import Send from "@lucide/svelte/icons/send"
import SkipBack from "@lucide/svelte/icons/skip-back"
import SkipForward from "@lucide/svelte/icons/skip-forward"
import Square from "@lucide/svelte/icons/square"
import TerminalIcon from "@lucide/svelte/icons/square-terminal"
import Volume from "@lucide/svelte/icons/volume-2"
import X from "@lucide/svelte/icons/x"
import type { DesignContent } from "./content"
import DSessionPanel from "./DSessionPanel.svelte"

let {
  content,
  state,
  panelOpen = false,
}: { content: DesignContent; state: string; panelOpen?: boolean } = $props()
const c = $derived(content.copy)
const d = $derived(content.data)
const tab = $derived(
  state === "typing"
    ? "type"
    : state === "live"
      ? "live"
      : state === "hidden"
        ? "hidden"
        : "record",
)
const speaking = $derived(state === "speaking" || state === "live")
const empty = $derived(state === "empty")
const toolIcon = { search: Search, read: FileText, edit: Pencil } as const
</script>

<div class="chat" class:panel-open={panelOpen}>
  <div class="main">
    <header class="hbar">
      <button class="ib menu" aria-label={c.menu}><Menu size={20} /></button>
      <div class="ti">
        <b>{empty ? c.newSession : d.session.title}</b>
        <span><span class="dot" class:off={state === "reconnecting"}></span>{d.session.cli}<span>·</span><FolderIcon size={12} /><span class="ltr">{d.session.folder}</span></span>
      </div>
      <span class="budget" title={c.context}><span class="ring" style="--p:{d.session.contextPct}%"></span><span class="num">{d.session.contextPct}%</span></span>
    </header>

    <div class="feed">
      <div class="col">
        {#if empty}
          <p class="empty">{c.emptyChat}</p>
        {:else}
          <div class="you"><span class="via"><Mic size={12} />{c.heard}</span>{d.userText}</div>

          <details class="thought"><summary>{c.thinking}</summary><p>{d.thought}</p></details>

          <div class="tools">
            {#each d.tools as tl, i (i)}
              {@const Icon = toolIcon[tl.kind as keyof typeof toolIcon]}
              <div class="tool" class:run={tl.state === "run" && state !== "speaking"} class:open={i === 0}>
                <div class="tool-h"><Icon size={15} /><span class="lbl">{tl.label}</span><span class="st">{tl.state === "run" && state === "speaking" ? "" : tl.meta}</span>{#if tl.state === "done" || state === "speaking"}<Check size={14} class="ok" />{/if}</div>
                {#if i === 0}
                  <div class="tool-b">
                    <div class="io"><span class="k">{c.input}</span><pre class="cmd"><span class="pr">$</span> {d.toolCmd}</pre></div>
                    <div class="io"><span class="k">{c.output}<span class="tb"><button class="ib" aria-label={c.copy}><Copy size={14} /></button><button class="ib" aria-label={c.expand}><Maximize size={14} /></button></span></span><pre>{d.toolOut}</pre></div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>

          <div class="agent">
            <p>{d.agentP1}</p>
            <table>
              <thead><tr>{#each d.table[0] as h (h)}<th>{h}</th>{/each}</tr></thead>
              <tbody>{#each d.table.slice(1) as r (r[0])}<tr><td class="ltr-cell"><code>{r[0]}</code></td><td>{r[1]}</td></tr>{/each}</tbody>
            </table>
            <pre class="code">{d.code}</pre>
            <p>{d.agentP2}</p>
          </div>

          <div class="plan">
            <h4><span>{c.plan}</span><span class="num muted">1 {c.of} 3</span></h4>
            <ul>
              {#each d.planItems as it (it.text)}
                <li class={it.state}><span class="ck">{#if it.state === "done"}<Check size={10} strokeWidth={3} />{/if}</span>{it.text}</li>
              {/each}
            </ul>
          </div>

          {#if state === "permission"}
            <div class="perm" role="alertdialog">
              <div class="perm-h"><TerminalIcon size={16} />{c.permTitle}</div>
              <pre class="cmd"><span class="pr">$</span> {d.permCmd}</pre>
              <div class="perm-a"><button class="chip primary">{c.permAllowOnce}</button><button class="chip">{c.permAllowAlways}</button><span class="sp"></span><button class="chip danger">{c.permDeny}</button></div>
              <div class="perm-t"><span class="bar"><i></i></span>{c.permTimeout} 42 {c.seconds}</div>
            </div>
          {/if}
        {/if}
      </div>
    </div>

    {#if speaking && tab !== "hidden"}
      <div class="dock" aria-label={c.playback}>
        <button class="ib" aria-label={c.prev}><SkipBack size={15} /></button>
        <button class="ib" aria-label={c.pause}><Pause size={15} /></button>
        <button class="ib" aria-label={c.next}><SkipForward size={15} /></button>
        <span class="what">{c.playback} · {d.playbackPos}</span>
        <button class="ib" aria-label={c.stopPlayback}><Square size={14} /></button>
        <button class="ib" aria-label={c.mute}><Volume size={15} /></button>
      </div>
    {/if}

    <footer class="foot" class:compact={tab !== "record"}>
      {#if state === "reconnecting"}
        <div class="state warn"><Loader size={15} class="spin" />{c.reconnecting} · {c.attempt} {d.reconnectAttempt}</div>
      {:else if tab === "record" || tab === "live"}
        <div class="state" class:speak={speaking}>
          {#if speaking}<span class="wave"><i></i><i></i><i></i><i></i><i></i></span>{c.status.speaking} · {c.interrupt}
          {:else if empty}{c.status.idle}
          {:else}<span class="dot busy"></span>{c.status.tool}{/if}
        </div>
      {/if}

      {#if tab === "record" || tab === "live"}
        <div class="mic-row">
          <div class="side-w"><button class="side" aria-label={c.discard}><X size={18} /></button><span>{c.discard}</span></div>
          <button class="mic" class:speak={speaking} class:busy={!speaking && !empty} class:live={tab === "live"} aria-label={c.status.idle}>
            {#if speaking}<Volume size={34} strokeWidth={1.6} />{:else if tab === "live"}<Radio size={34} strokeWidth={1.6} />{:else}<Mic size={34} strokeWidth={1.6} />{/if}
          </button>
          <div class="side-w">{#if !empty}<button class="side stop" aria-label={c.stopRun}><Square size={16} /></button><span>{c.stopRun}</span>{/if}</div>
        </div>
      {:else if tab === "type"}
        <div class="type">
          <div class="field area"><span class="ph">{c.placeholder}</span></div>
          <div class="type-a"><button class="ib" aria-label={c.addImage}><ImagePlus size={18} /></button><button class="ib" aria-label={c.dictate}><Mic size={18} /></button><span class="sp"></span><button class="chip send"><Send size={15} />{c.send}</button></div>
        </div>
      {/if}

      <nav class="tabs">
        <span class:on={tab === "record"}><Mic size={15} />{c.tabs.record}</span>
        <span class:on={tab === "type"}><Keyboard size={15} />{c.tabs.type}</span>
        <span class:on={tab === "live"}><Radio size={15} />{c.tabs.live}</span>
        <span class:on={tab === "hidden"}><EyeOff size={15} />{c.tabs.hidden}</span>
      </nav>
      <span class="grip" aria-label={c.panel}></span>
    </footer>
  </div>

  <aside class="side-panel" aria-label={c.panel}>
    <span class="grip top"></span>
    <DSessionPanel {content} />
  </aside>
  <div class="scrim"></div>
</div>

<style>
  .chat { block-size: 100dvh; display: flex; position: relative; overflow: hidden; }
  .main { flex: 1; min-inline-size: 0; display: flex; flex-direction: column; }
  .ltr { direction: ltr; unicode-bidi: isolate; }
  .hbar { display: flex; align-items: center; gap: 6px; padding: 12px 12px 10px; border-block-end: 1px solid var(--line); }
  .menu { display: none; }
  .ti { flex: 1; min-inline-size: 0; }
  .ti b { display: block; font-weight: 600; font-size: var(--t-md); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ti > span { display: flex; align-items: center; gap: 6px; font-size: var(--t-xs); color: var(--fg-muted); }
  .budget { display: flex; align-items: center; gap: 6px; block-size: 30px; padding-inline: 8px; border-radius: 8px; border: 1px solid var(--line); font-size: var(--t-xs); color: var(--fg-dim); }
  .ring { inline-size: 14px; block-size: 14px; border-radius: 50%; background: conic-gradient(var(--fg-dim) 0 var(--p), var(--line-2) var(--p) 100%); }
  .feed { flex: 1; overflow: auto; padding: 16px 20px; display: flex; flex-direction: column-reverse; }
  .col { inline-size: 100%; min-inline-size: 0; max-inline-size: 760px; margin-inline: auto; display: flex; flex-direction: column; gap: 14px; }
  .empty { color: var(--fg-muted); text-align: center; margin-block-start: 30vh; }
  .you { align-self: flex-end; max-inline-size: 82%; background: var(--surface-2); border-radius: var(--r-k); border-end-end-radius: 4px; padding: 9px 13px; }
  .via { display: flex; gap: 4px; align-items: center; font-size: var(--t-xs); color: var(--fg-muted); margin-block-end: 2px; }
  .thought summary { cursor: pointer; font-size: var(--t-sm); color: var(--fg-muted); list-style: none; }
  .thought summary::before { content: "› "; }
  .thought p { margin: 6px 0 0; font-size: var(--t-sm); color: var(--fg-dim); font-style: italic; }
  .tools { display: flex; flex-direction: column; gap: 4px; border-inline-start: 2px solid var(--line-2); padding-inline-start: 12px; }
  .tool-h { display: flex; align-items: center; gap: 8px; font-size: var(--t-sm); color: var(--fg-dim); min-block-size: 28px; }
  .tool-h :global(svg) { color: var(--fg-muted); flex-shrink: 0; }
  .lbl { flex: 1; min-inline-size: 0; }
  .st { font-size: var(--t-xs); color: var(--fg-muted); }
  .tool.run .tool-h { color: var(--fg); }
  .tool.run .st { color: var(--busy); }
  :global(.dv2 .ok) { color: var(--ok) !important; }
  .tool-b { margin: 4px 0 6px; display: flex; flex-direction: column; gap: 8px; }
  .io { position: relative; }
  .k { display: flex; align-items: center; min-block-size: 28px; font-size: var(--t-xs); color: var(--fg-muted); margin-block-end: 2px; }
  pre { max-inline-size: 100%; margin: 0; padding: 10px 12px; border-radius: var(--r-c); background: color-mix(in srgb, var(--bg) 70%, #000); font-family: var(--mono); font-size: 12.5px; line-height: 1.6; direction: ltr; text-align: left; overflow: auto; color: var(--fg-dim); white-space: pre; }
  .cmd { color: var(--fg); } .pr { color: var(--fg-muted); }
  .tb { display: flex; margin-inline-start: auto; } .tb .ib { inline-size: 28px; block-size: 28px; }
  .agent p { margin: 0; line-height: 1.6; }
  .agent p + * , .agent * + p { margin-block-start: 10px; }
  table { border-collapse: collapse; font-size: var(--t-sm); margin-block-start: 10px; }
  th, td { text-align: start; padding: 6px 12px; border-block-end: 1px solid var(--line); }
  th { color: var(--fg-muted); font-weight: 600; }
  .code { margin-block-start: 10px; }
  .plan { background: var(--surface-1); border: 1px solid var(--line); border-radius: var(--r-k); padding: 10px 14px; }
  .plan h4 { margin: 0; font-size: var(--t-sm); color: var(--fg-dim); display: flex; justify-content: space-between; }
  .plan ul { list-style: none; margin: 6px 0 0; padding: 0; }
  .plan li { display: flex; gap: 8px; align-items: center; font-size: var(--t-sm); padding: 3px 0; color: var(--fg-dim); }
  .plan li.done { color: var(--fg-muted); text-decoration: line-through; text-decoration-color: var(--line-2); }
  .plan li.now { color: var(--fg); }
  .ck { inline-size: 14px; block-size: 14px; border-radius: 4px; border: 1.5px solid var(--line-2); display: grid; place-items: center; flex-shrink: 0; color: var(--bg); }
  .done .ck { background: var(--fg-muted); border-color: var(--fg-muted); }
  .now .ck { border-color: var(--busy); }
  .perm { min-inline-size: 0; border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent); background: color-mix(in srgb, var(--accent) 7%, var(--surface-1)); border-radius: var(--r-k); padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
  .perm-h { display: flex; gap: 8px; align-items: center; font-weight: 600; }
  .perm-a { display: flex; gap: 8px; flex-wrap: wrap; }
  .perm-t { display: flex; align-items: center; gap: 8px; font-size: var(--t-xs); color: var(--fg-muted); }
  .perm-t .bar { flex: 1; block-size: 3px; border-radius: 2px; background: var(--line-2); }
  .perm-t .bar i { display: block; block-size: 100%; inline-size: 70%; border-radius: 2px; background: var(--accent); }
  .sp { flex: 1; }
  .dock { display: flex; align-items: center; gap: 2px; margin: 0 16px; padding: 2px 6px; border-radius: var(--r-k); background: var(--surface-1); border: 1px solid var(--line); max-inline-size: 760px; align-self: center; inline-size: calc(100% - 32px); }
  .dock .what { flex: 1; font-size: var(--t-xs); color: var(--fg-dim); padding-inline-start: 4px; }
  .foot { padding: 12px 16px 10px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .state { font-size: var(--t-sm); color: var(--fg-dim); display: flex; align-items: center; gap: 8px; min-block-size: 20px; }
  .state.warn { color: var(--warn); }
  .wave { display: flex; gap: 3px; align-items: center; block-size: 16px; }
  .wave i { inline-size: 3px; border-radius: 2px; background: var(--speaking); block-size: 8px; }
  .wave i:nth-child(2) { block-size: 14px; } .wave i:nth-child(3) { block-size: 16px; } .wave i:nth-child(4) { block-size: 10px; }
  .mic-row { display: flex; align-items: center; gap: 24px; }
  .side-w { inline-size: 64px; display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 11px; color: var(--fg-muted); }
  .side { inline-size: 46px; block-size: 46px; border-radius: 50%; background: var(--surface-2); border: 1px solid var(--line); display: grid; place-items: center; color: var(--fg-dim); }
  .side.stop { color: var(--bad); }
  .mic { inline-size: 92px; block-size: 92px; border-radius: 50%; background: var(--accent); color: var(--on-accent); display: grid; place-items: center; --ring: var(--accent); }
  .mic.busy { background: var(--surface-3); color: var(--fg-dim); }
  .mic.speak { background: var(--speaking); --ring: var(--speaking); animation: dv2-ring 1.6s var(--ease) infinite; }
  .mic.live { outline: 2px solid var(--speaking); outline-offset: 4px; }
  .type { inline-size: 100%; max-inline-size: 760px; display: flex; flex-direction: column; gap: 6px; }
  .field.area { min-block-size: 84px; align-items: flex-start; padding-block: 10px; }
  .type-a { display: flex; align-items: center; gap: 4px; }
  .send { background: var(--accent); color: var(--on-accent); border-color: transparent; block-size: 36px; }
  .tabs { display: flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--surface-1); border: 1px solid var(--line); }
  .tabs span { display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; border-radius: 999px; font-size: var(--t-sm); color: var(--fg-muted); }
  .tabs span.on { background: var(--surface-3); color: var(--fg); }
  .grip { inline-size: 36px; block-size: 4px; border-radius: 2px; background: var(--line-2); }
  .side-panel { display: none; }
  .scrim { display: none; }

  /* phone + tablet: panel is a bottom sheet */
  @media (max-width: 1023px) {
    .panel-open .side-panel { display: block; position: absolute; inset-inline: 0; inset-block-end: 0; block-size: 78%; overflow: auto; z-index: 2; background: var(--surface-1); border-radius: var(--r-s) var(--r-s) 0 0; border-block-start: 1px solid var(--line-2); padding: 10px 20px 0; }
    .panel-open .scrim { display: block; position: absolute; inset: 0; background: rgba(0, 0, 0, 0.45); z-index: 1; }
    .grip.top { display: block; margin: 0 auto 14px; }
  }
  @media (min-width: 768px) and (max-width: 1023px) {
    .panel-open .side-panel { inset-inline: 0 auto; inline-size: 420px; inset-block: 0; block-size: auto; border-radius: 0; border-block-start: 0; border-inline-end: 1px solid var(--line-2); }
    .menu { display: inline-grid; }
    .foot .grip { display: none; }
  }
  /* desktop: panel is a sidebar */
  @media (min-width: 1024px) {
    .menu { display: inline-grid; }
    .side-panel { order: -1; display: block; inline-size: 340px; flex-shrink: 0; overflow: auto; padding: 16px 20px 0; background: var(--surface-1); border-inline-end: 1px solid var(--line); }
    .grip { display: none; }
    .hbar { padding-inline: 20px; }
  }
</style>
