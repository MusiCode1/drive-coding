<script lang="ts">
import CliMark from "./CliMark.svelte"
import type { DesignContent } from "./content"
import * as I from "./icons"
import type { NavActions } from "./proto"

let { content, on = {} }: { content: DesignContent; on?: NavActions } = $props()
const c = $derived(content.copy)
const u = $derived(content.data.usage)
</script>

<div class="usage">
  <header class="head">
    <button class="ib" aria-label={c.settingsTitle} onclick={() => on.back?.()}><I.ChevronRight size={20} class="flip-back" /></button>
    <h1>{c.usageTitle}</h1>
    <button class="ib" aria-label={c.refresh}><I.RefreshCw size={16} /></button>
  </header>

  <section class="card">
    <h3 class="label">{c.ttsUsage}</h3>
    <div class="meter hot"><div class="top"><span>{c.quota}</span><b class="num">{u.quotaUsed} / {u.quotaLimit}</b></div><div class="bar"><i style="inline-size:{u.quotaPct}%"></i></div></div>
    <div class="tts">{#each u.tts as t (t.name)}<div><b>{t.name}</b><span class="num">{t.line}</span></div>{/each}</div>
  </section>

  <section class="card">
    <h3 class="label">{c.contextByCli}</h3>
    <!-- phone: one card per CLI; tablet+: a real table -->
    <div class="cards">
      {#each u.rows as r (r.cli)}
        <article class="cli">
          <div class="cli-h"><b class="cn"><CliMark name={r.cli} size={16} />{r.cli}</b><span class="muted">{r.last}</span></div>
          {#if r.notReported}
            <p class="muted small">{c.notReported}</p>
          {:else}
            <dl>
              <div><dt>{c.sessionsCol}</dt><dd class="num">{r.sessions}</dd></div>
              <div><dt>{c.turns}</dt><dd class="num">{r.turns}</dd></div>
              <div><dt>{c.peak}</dt><dd class="num">{r.peak}</dd></div>
              <div><dt>{c.cost}</dt><dd class="num">{r.cost}</dd></div>
            </dl>
          {/if}
          <p class="muted small">{r.folders} {c.folders}</p>
        </article>
      {/each}
    </div>
    <table>
      <thead><tr><th>CLI</th><th>{c.projects}</th><th>{c.sessionsCol}</th><th>{c.turns}</th><th>{c.peak}</th><th>{c.cost}</th><th>{c.lastActive}</th></tr></thead>
      <tbody>
        {#each u.rows as r (r.cli)}
          <tr><td><b class="cn"><CliMark name={r.cli} size={16} />{r.cli}</b></td><td class="num">{r.folders} {c.folders}</td>
            {#if r.notReported}<td colspan="4" class="muted">{c.notReported}</td>{:else}<td class="num">{r.sessions}</td><td class="num">{r.turns}</td><td class="num">{r.peak}</td><td class="num">{r.cost}</td>{/if}
            <td class="muted">{r.last}</td></tr>
        {/each}
      </tbody>
    </table>
  </section>
</div>

<style>
  .usage { min-block-size: 100dvh; max-inline-size: 1040px; margin-inline: auto; padding: 16px 16px 24px; }
  .head { display: flex; align-items: center; gap: 6px; }
  .head h1 { flex: 1; margin: 0; font-size: var(--t-xl); font-weight: 600; }
  :global(.dv2 [dir="ltr"] .flip-back) { transform: scaleX(-1); }
  .card { margin-block-start: 16px; padding: 16px; border: 1px solid var(--line); border-radius: var(--r-k); background: var(--surface-1); }
  .card h3 { margin: 0 0 12px; }
  .tts { display: flex; flex-direction: column; gap: 6px; margin-block-start: 14px; font-size: var(--t-sm); }
  .tts div { display: flex; justify-content: space-between; gap: 12px; }
  .tts span { color: var(--fg-dim); }
  .cards { display: flex; flex-direction: column; gap: 10px; }
  .cn { display: inline-flex; align-items: center; gap: 6px; }
  .cli { padding: 12px; border-radius: var(--r-c); background: var(--surface-2); }
  .cli-h { display: flex; justify-content: space-between; font-size: var(--t-sm); }
  dl { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0 0; }
  dt { font-size: var(--t-xs); color: var(--fg-muted); }
  dd { margin: 0; font-size: var(--t-md); }
  .small { font-size: var(--t-xs); margin: 8px 0 0; }
  table { display: none; inline-size: 100%; border-collapse: collapse; font-size: var(--t-sm); }
  th, td { text-align: start; padding: 10px 12px; border-block-end: 1px solid var(--line); white-space: nowrap; }
  th { color: var(--fg-muted); font-weight: 600; font-size: var(--t-xs); }
  @media (min-width: 768px) {
    .usage { padding: 32px 24px; }
    .cards { display: none; }
    table { display: table; }
  }
</style>
