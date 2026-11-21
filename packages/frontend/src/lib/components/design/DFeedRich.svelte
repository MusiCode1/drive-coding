<script lang="ts">
/** Bubble kinds the basic mock skipped: thought, sub-agent, clean-reading group, attachments,
 * agent-to-agent message, expired scope prompt, plan file, status line, Codex voice bubbles. */
import type { DesignContent } from "./content"
import * as I from "./icons"

let { content, view }: { content: DesignContent; view: string } = $props()
const c = $derived(content.copy)
const r = $derived(content.copy.rich)
let subOpen = $state(true)
let groupOpen = $state(false)
</script>

{#if view === "voice"}
  <div class="voice you-v"><span class="cap"><I.Mic size={12} />{r.voiceYou}</span>{r.voiceUser}</div>
  <div class="voice agent-v"><span class="cap"><I.Volume size={12} />{r.voiceVoice}</span>{r.voiceAgent}</div>
  <details class="handoff">
    <summary><I.Send size={14} /><b>{r.handoff}</b><span>{r.handoffReq}</span></summary>
    <p class="ctx"><span class="dim">user:</span> {r.voiceUser}<br /><span class="dim">assistant:</span> {r.voiceAgent}</p>
  </details>
{:else}
  <div class="you att">
    <div class="thumbs"><span class="thumb" aria-label={r.attachCaption}><I.ImagePlus size={20} /></span></div>
    {r.attachText}
  </div>

  <details class="thought" open>
    <summary>{r.thoughtLabel}</summary>
    <p>{r.thought}</p>
  </details>

  <div class="sub">
    <button class="sub-h" aria-expanded={subOpen} onclick={() => (subOpen = !subOpen)}>
      <span class="sd done"></span><b>{r.subTitle}</b><span class="dim one" dir="auto">{r.subPrompt}</span>
      <span class="chev" class:open={subOpen}><I.ChevronDown size={14} /></span>
    </button>
    {#if subOpen}
      <div class="sub-b">
        {#each r.subTools as t (t)}<div class="mini"><span class="sd done"></span><bdi>{t}</bdi></div>{/each}
        <p class="sub-sum">{r.subSummary}</p>
        <span class="tag">{r.subStatus}</span>
      </div>
    {/if}
  </div>

  <button class="group" aria-expanded={groupOpen} onclick={() => (groupOpen = !groupOpen)}>
    <span class="chev" class:open={groupOpen}><I.ChevronDown size={14} /></span>
    <span>{r.groupSummary}</span>
    <span class="kinds"><I.Search size={13} /><I.FileText size={13} /><I.Pencil size={13} /><I.TerminalIcon size={13} /></span>
    <span class="dim one"><bdi>{r.groupLast}</bdi></span>
  </button>

  <div class="from">
    <div class="from-h"><I.Users size={14} />{r.fromAgent}<a href="#agent">{r.fromName}</a></div>
    <p>{r.fromBody}</p>
    <button class="link">{r.showSource}</button>
  </div>

  <div class="expired"><I.Clock size={14} /><b>{r.expired}</b><span class="dim">{r.expiredDetail}</span></div>

  <div class="planfile"><I.FileText size={15} /><span>{r.planFile}</span><code>{r.planFileName}</code><button class="chip">{r.view}</button></div>

  <div class="status" role="status"><span class="dot busy"></span>{r.status}</div>
{/if}

<style>
  .you { align-self: flex-end; max-inline-size: 82%; background: var(--surface-2); border-radius: var(--r-k); border-end-end-radius: 4px; padding: 9px 13px; }
  .thumbs { display: flex; gap: 6px; margin-block-end: 6px; }
  .thumb { inline-size: 120px; block-size: 80px; border-radius: 10px; background: linear-gradient(135deg, var(--surface-3), var(--bg-elev)); display: grid; place-items: center; color: var(--fg-muted); }
  .thought { border: 1px dashed var(--line-2); border-radius: var(--r-k); padding: 8px 12px; max-inline-size: 85%; }
  .thought summary { cursor: pointer; font-size: var(--t-sm); color: var(--fg-muted); }
  .thought p { margin: 6px 0 0; font-size: var(--t-sm); color: var(--fg-dim); font-style: italic; }
  .sub { border: 1px solid var(--line); border-radius: var(--r-k); background: var(--surface-1); max-inline-size: 85%; }
  .sub-h, .group { display: flex; align-items: center; gap: 8px; inline-size: 100%; padding: 10px 12px; text-align: start; font-size: var(--t-sm); }
  .one { flex: 1; min-inline-size: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chev { display: grid; transition: transform var(--dur-2) var(--ease); }
  .chev.open { transform: rotate(180deg); }
  .sub-b { border-block-start: 1px solid var(--line); padding: 8px 12px 10px; max-block-size: 360px; overflow: auto; border-inline-start: 2px solid var(--line-2); margin-inline-start: 12px; }
  .mini { display: flex; align-items: center; gap: 8px; font-size: var(--t-sm); color: var(--fg-dim); min-block-size: 26px; }
  .sub-sum { font-size: var(--t-sm); margin: 6px 0; }
  .sd { inline-size: 7px; block-size: 7px; border-radius: 50%; background: var(--fg-muted); flex-shrink: 0; }
  .sd.done { background: var(--ok); }
  .tag { font-size: var(--t-xs); color: var(--fg-dim); border: 1px solid var(--line-2); border-radius: 6px; padding: 0 6px; }
  .group { border: 1px solid var(--line); border-radius: var(--r-k); background: var(--surface-1); color: var(--fg-dim); max-inline-size: 85%; }
  .kinds { display: inline-flex; gap: 4px; color: var(--fg-muted); }
  .from { border: 1px solid var(--line-2); border-radius: var(--r-k); padding: 10px 12px; align-self: flex-end; max-inline-size: 85%; background: var(--surface-2); }
  .from-h { display: flex; align-items: center; gap: 6px; font-size: var(--t-xs); color: var(--fg-muted); }
  .from-h a { color: var(--accent); }
  .from p { margin: 6px 0; font-size: var(--t-sm); }
  .link { font-size: var(--t-xs); color: var(--fg-muted); text-decoration: underline dotted; }
  .expired { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: var(--t-sm); color: var(--fg-dim); border-inline-start: 2px solid var(--bad); padding-inline-start: 10px; }
  .planfile { display: flex; align-items: center; gap: 8px; font-size: var(--t-sm); color: var(--fg-dim); }
  .planfile code { flex: 1; }
  .status { display: flex; align-items: center; gap: 8px; font-size: var(--t-sm); color: var(--fg-dim); }
  .voice { max-inline-size: 85%; padding: 9px 13px; border-radius: var(--r-k); white-space: pre-wrap; }
  .voice .cap { display: flex; gap: 4px; align-items: center; font-size: var(--t-xs); color: var(--fg-muted); margin-block-end: 2px; }
  .you-v { align-self: flex-end; background: color-mix(in srgb, var(--accent) 14%, var(--surface-2)); }
  .agent-v { align-self: flex-start; background: color-mix(in srgb, var(--recording) 10%, var(--surface-2)); }
  .handoff { border: 1px dashed var(--line-2); border-radius: var(--r-k); padding: 8px 12px; max-inline-size: 85%; }
  .handoff summary { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: var(--t-sm); }
  .ctx { font-size: var(--t-xs); color: var(--fg-dim); margin: 6px 0 0; }
</style>
