<script lang="ts">
  /** Live log + toolbar — props and callbacks only. */
  export type BtLogRow = {
    id: number
    t: number
    kind: "raw-key" | "raw-media" | "cmd" | "audio" | "beat" | "sys" | "rec" | "err"
    detail: string
    data?: Record<string, unknown>
    visibility: "visible" | "hidden"
    simulated?: true
  }

  let {
    rows,
    holdingMs = 0,
    onClear,
    onCopy,
    onDownload,
    onSimTapNext,
    onSimHoldCenter,
    onSimMediaNext,
    onSimMediaPrev,
    onSimMediaPause,
  }: {
    rows: BtLogRow[]
    holdingMs?: number
    onClear: () => void
    onCopy: () => void
    onDownload: () => void
    onSimTapNext: () => void
    onSimHoldCenter: () => void
    onSimMediaNext: () => void
    onSimMediaPrev: () => void
    onSimMediaPause: () => void
  } = $props()
</script>

{#if holdingMs > 0}<p class="hold">Holding {holdingMs}ms</p>{/if}
<div class="bar">
  <button type="button" onclick={onClear}>Clear</button>
  <button type="button" onclick={onCopy}>Copy log</button>
  <button type="button" onclick={onDownload}>Download log</button>
</div>
<div class="sim">
  <span>Simulate:</span>
  <button type="button" onclick={onSimTapNext}>tap next</button>
  <button type="button" onclick={onSimHoldCenter}>hold center</button>
  <button type="button" onclick={onSimMediaNext}>media next</button>
  <button type="button" onclick={onSimMediaPrev}>media prev</button>
  <button type="button" onclick={onSimMediaPause}>media pause</button>
</div>
<div class="log">
  {#if rows.length === 0}
    <p class="empty">Press a remote button — captured events appear here</p>
  {:else}
    {#each rows as row (row.id)}
      <div class="row {row.kind}{row.simulated ? ' sim' : ''}">
        <span class="t">{(row.t / 1000).toFixed(2)}s</span>
        <span class="k">{row.kind}</span>
        <span class="d">{row.detail}</span>
        {#if row.visibility === "hidden"}<span class="v">hidden</span>{/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .hold { font-size: 0.85rem; color: #7ee081; margin: 0 0 0.4rem; }
  .bar, .sim { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.4rem; width: 100%; }
  .sim span { font-size: 0.72rem; color: #8899a8; align-self: center; }
  .bar button, .sim button {
    flex: 1; min-width: 4.5rem; padding: 0.4rem; font-size: 0.72rem;
    background: #1c2530; color: #e6edf3; border: 1px solid #2a3644; border-radius: 0.35rem;
  }
  .log {
    width: 100%; max-height: 16rem; overflow-y: auto; background: #11151c; border: 1px solid #2a3543;
    border-radius: 0.5rem; padding: 0.5rem; font: 0.72rem/1.4 ui-monospace, Menlo, monospace;
  }
  .empty { color: #8899a8; text-align: center; margin: 1.2rem 0; }
  .row { display: grid; grid-template-columns: 4rem 5rem 1fr auto; gap: 0.3rem; padding: 0.2rem 0; border-bottom: 1px solid #1c2530; }
  .row.cmd { color: #7ee081; } .row.raw-key { color: #4ea1ff; } .row.raw-media { color: #ffb84e; }
  .row.err { color: #ff6b6b; } .row.beat { color: #8899a8; } .row.sim { opacity: 0.75; }
  .t { color: #8899a8; } .k { font-weight: 600; text-transform: uppercase; font-size: 0.62rem; }
  .v { color: #ffb84e; font-size: 0.62rem; }
</style>
