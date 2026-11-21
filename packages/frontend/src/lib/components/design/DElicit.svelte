<script lang="ts">
/**
 * Agent question (elicitation, form mode) with every field type the real dialog maps:
 * enum → radio group, string → text, number → number input, boolean → checkbox.
 * Required fields gate submit; accept / decline / cancel stay three distinct actions.
 */
import type { DesignContent } from "./content"
import * as I from "./icons"

let {
  content,
  onPick,
  onClose,
}: { content: DesignContent; onPick: (value: string) => void; onClose: () => void } = $props()
const p = $derived(content.copy.pop)
const d = $derived(content.data)
let branch = $state("")
let title = $state("")
let retries = $state<number | undefined>(undefined)
let asDraft = $state(false)
const canSubmit = $derived(branch !== "" && title.trim() !== "")
</script>

<div class="sheet" role="dialog" aria-label={p.elicitTitle}>
  <header class="sh-h">
    <h2><I.MessageQuestion size={18} />{p.elicitTitle}</h2>
    <button class="ib" aria-label={p.elicitCancel} onclick={onClose}><I.X size={20} /></button>
  </header>
  <p class="q" dir="auto">{p.elicitQ}</p>

  <fieldset>
    <legend>{p.fBranch} <span class="req" title={p.required}>*</span> <span class="desc">{p.fBranchDesc}</span></legend>
    {#each d.branches as b (b)}
      <label class="opt"><input type="radio" name="branch" value={b} bind:group={branch} /><span class="ltr">{b}</span></label>
    {/each}
  </fieldset>

  <label class="fld">
    <span>{p.fTitle} <span class="req" title={p.required}>*</span></span>
    <input class="field-in" dir="auto" placeholder={d.prTitle} bind:value={title} />
  </label>

  <label class="fld">
    <span>{p.fRetries}</span>
    <input class="field-in num" type="number" min="0" bind:value={retries} />
  </label>

  <label class="chk"><input type="checkbox" bind:checked={asDraft} />{p.fDraft}</label>

  <footer class="row-f">
    <button class="chip" onclick={() => onPick("")}>{p.elicitDecline}</button>
    <button class="btn" disabled={!canSubmit} onclick={() => onPick(branch)}>{p.elicitSubmit}</button>
  </footer>
</div>

<style>
  .sheet { position: absolute; z-index: 5; inset-inline: 0; inset-block-end: 0; max-block-size: 88%; overflow: auto; display: flex; flex-direction: column; gap: 14px; padding: 16px 20px 20px; background: var(--surface-1); border-radius: var(--r-s) var(--r-s) 0 0; border-block-start: 1px solid var(--line-2); }
  .sh-h { display: flex; align-items: center; }
  .sh-h h2 { flex: 1; margin: 0; display: flex; align-items: center; gap: 8px; font-size: var(--t-lg); }
  .q { margin: 0; font-size: var(--t-md); }
  fieldset { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; }
  legend, .fld > span { font-size: var(--t-sm); color: var(--fg-dim); margin-block-end: 6px; padding: 0; }
  .desc { color: var(--fg-muted); font-size: var(--t-xs); }
  .req { color: var(--bad); }
  .opt { display: flex; align-items: center; gap: 12px; min-block-size: 44px; border-block-end: 1px solid var(--line); }
  .opt input, .chk input { accent-color: var(--accent); inline-size: 18px; block-size: 18px; }
  .ltr { direction: ltr; unicode-bidi: isolate; }
  .fld { display: flex; flex-direction: column; }
  .field-in { block-size: 44px; padding-inline: 12px; border-radius: var(--r-c); background: var(--surface-2); border: 1px solid var(--line); color: var(--fg); font: inherit; }
  .field-in:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .num { inline-size: 120px; direction: ltr; }
  .chk { display: flex; align-items: center; gap: 10px; font-size: var(--t-md); }
  .row-f { display: flex; align-items: center; gap: 10px; padding-block-start: 10px; border-block-start: 1px solid var(--line); }
  .row-f .btn { flex: 1; }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  @media (min-width: 768px) {
    .sheet { inset: auto; inset-block-start: 50%; inset-inline-start: 50%; transform: translate(-50%, -50%); inline-size: 520px; border-radius: var(--r-s); border: 1px solid var(--line-2); }
    :global([dir="rtl"]) .sheet { transform: translate(50%, -50%); }
  }
</style>
