<script lang="ts">
  /** D-pad visual — props only, zero logic. */
  import type { BtButton } from "$lib/engines/bt-remote.js"

  let { hot = null, flash = null }: { hot?: BtButton | null; flash?: BtButton | null } = $props()

  function lit(btn: BtButton): boolean {
    return hot === btn || flash === btn
  }
</script>

<div class="pad">
  <div class="none"></div>
  <div class:hot={lit("prev")}>▲</div>
  <div class="none"></div>
  <div class:hot={lit("prev")}>◀</div>
  <div class:hot={lit("center")}>●</div>
  <div class:hot={lit("next")}>▶</div>
  <div class="none"></div>
  <div class:hot={lit("next")}>▼</div>
  <div class="none"></div>
</div>

<style>
  .pad {
    display: grid;
    grid-template-columns: repeat(3, 3.4rem);
    grid-template-rows: repeat(3, 3.4rem);
    gap: 0.4rem;
  }
  .pad > div:not(.none) {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #141b23;
    border: 1px solid #2a3644;
    border-radius: 0.6rem;
    font-size: 1.2rem;
    color: #8899a8;
  }
  .pad > div.hot {
    background: #7ee081;
    color: #0b0f14;
    border-color: #7ee081;
  }
  .none {
    visibility: hidden;
  }
</style>
