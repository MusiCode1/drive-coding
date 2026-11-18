<script lang="ts">
/**
 * /design — gallery of the proposed redesign (branch design/unslop-mocks).
 * Intentional route-shell exception (like /bt-test): not linked from the app, synthetic data only.
 * Each device is an <iframe> of /design/frame so media queries see the real viewport width.
 */
import "$lib/components/design/tokens.css"
import {
  CURRENT,
  DEVICES,
  type DesignDevice,
  type DesignLang,
  type DesignScreen,
  designContent,
  PALETTES,
  SCREENS,
  STATES,
} from "$lib/components/design/content"

let screen = $state<DesignScreen>("connect")
let stateName = $state("default")
let lang = $state<DesignLang>("he")
let palette = $state("ember")
let device = $state<DesignDevice | "all">("all")
let showCurrent = $state(true)
let stageW = $state(0)

const g = $derived(designContent(lang).gallery)
const states = $derived(STATES[screen])
const shown = $derived<DesignDevice[]>(device === "all" ? ["phone", "tablet", "desktop"] : [device])
const frameUrl = $derived(
  `/design/frame?screen=${screen}&state=${stateName}&lang=${lang}&palette=${palette}`,
)
const current = $derived(CURRENT[screen] ?? {})

function pick(s: DesignScreen) {
  screen = s
  stateName = STATES[s][0] ?? "default"
}
function scaleFor(dev: DesignDevice): number {
  const wide = (stageW || 1200) >= 1100
  const share =
    device === "all" && wide ? (dev === "desktop" ? 0.48 : dev === "tablet" ? 0.28 : 0.2) : 1
  return Math.min(1, ((stageW || 1200) * share - 16) / DEVICES[dev].w)
}
</script>

<div class="dv2 gallery" data-palette={palette} dir={lang === "he" ? "rtl" : "ltr"} {lang}>
  <header>
    <h1>{g.title}</h1>
    <p class="dim">{g.intro}</p>
  </header>

  <div class="bar">
    <div class="seg screens">{#each SCREENS as s (s)}<button class:on={screen === s} onclick={() => pick(s)}>{g.screens[s]}</button>{/each}</div>
    <label>{g.stateLbl}<select bind:value={stateName}>{#each states as st (st)}<option value={st}>{g.states[st as keyof typeof g.states]}</option>{/each}</select></label>
    <label>{g.deviceLbl}<select bind:value={device}>{#each ["all", "phone", "tablet", "desktop"] as dv (dv)}<option value={dv}>{g.devices[dv as keyof typeof g.devices]}</option>{/each}</select></label>
    <label>{g.paletteLbl}<select bind:value={palette}>{#each PALETTES as p (p)}<option value={p}>{p}</option>{/each}</select></label>
    <div class="seg langs"><button class:on={lang === "he"} onclick={() => (lang = "he")}>{designContent("he").copy.language}</button><button class:on={lang === "en"} onclick={() => (lang = "en")}>{designContent("en").copy.language}</button></div>
    <label class="chk"><input type="checkbox" bind:checked={showCurrent} />{g.showCurrent}</label>
  </div>

  <div class="stage" bind:clientWidth={stageW}>
    {#each shown as dev (dev)}
      {@const k = scaleFor(dev)}
      <figure>
        <figcaption><b>{g.devices[dev]}</b><span class="muted num">{DEVICES[dev].w}px</span><a href="{frameUrl}" target="_blank" rel="noopener">{g.openFull}</a></figcaption>
        <div class="dev" style="inline-size:{DEVICES[dev].w * k}px; block-size:{DEVICES[dev].h * k}px">
          <iframe title="{g.screens[screen]} · {g.devices[dev]}" src={frameUrl} style="inline-size:{DEVICES[dev].w}px; block-size:{DEVICES[dev].h}px; transform:scale({k})"></iframe>
        </div>
        {#if showCurrent}
          {#if current[dev]}
            <span class="cur-l muted">{g.current}</span>
            <img class="cur" src="/design-current/{current[dev]}" alt="{g.current} · {g.devices[dev]}" style="inline-size:{DEVICES[dev].w * k}px" />
          {/if}
        {/if}
      </figure>
    {/each}
  </div>
  {#if showCurrent && Object.keys(current).length === 0}<p class="muted small">{g.noCurrent}</p>{/if}

  <section class="notes">
    <h2>{g.changed}</h2>
    <ul>{#each g.notes[screen] as n (n)}<li>{n}</li>{/each}</ul>
  </section>
</div>

<style>
  .gallery { block-size: 100dvh; overflow: auto; padding: 24px 20px 48px; }
  header { max-inline-size: 900px; }
  h1 { font-size: var(--t-xl); margin: 0; }
  header p { margin: 6px 0 0; font-size: var(--t-sm); }
  .bar { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; margin-block: 20px; position: sticky; inset-block-start: -24px; padding-block: 10px; background: var(--bg); z-index: 1; }
  .bar button { padding-inline: 10px; }
  .screens { flex-basis: 100%; max-inline-size: 640px; }
  label { display: flex; align-items: center; gap: 6px; font-size: var(--t-sm); color: var(--fg-dim); }
  select { padding: 6px 8px; font-size: var(--t-sm); }
  .chk input { accent-color: var(--accent); }
  .stage { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
  figure { margin: 0; display: flex; flex-direction: column; gap: 8px; }
  figcaption { display: flex; gap: 10px; align-items: baseline; font-size: var(--t-sm); }
  figcaption a { color: var(--accent); margin-inline-start: auto; }
  .dev { overflow: hidden; border-radius: 18px; border: 1px solid var(--line-2); }
  iframe { border: 0; transform-origin: top left; display: block; background: var(--bg); }
  [dir="rtl"] iframe { transform-origin: top right; }
  .cur-l { font-size: var(--t-xs); margin-block-start: 6px; }
  .cur { border-radius: 18px; border: 1px dashed var(--line-2); opacity: 0.92; }
  .small { font-size: var(--t-sm); }
  .notes { margin-block-start: 32px; max-inline-size: 760px; }
  .notes h2 { font-size: var(--t-lg); margin: 0 0 8px; }
  .notes li { margin-block-end: 6px; color: var(--fg-dim); }
</style>
