<script lang="ts">
  /**
   * D-pad visual — props only, zero logic.
   *
   * ‏המיפוי חי ב-`pad-cells.ts` (‏פונקציה טהורה) ‏כדי שיהיה בר-בדיקה: ‏vitest רץ
   * ‏ב-node ‏ואי-אפשר לרנדר רכיב. ‏זהו החוט היחיד שמעביר את התיקון למסך.
   *
   * ‏המיקום ברשת נקבע ב-CSS לפי `data-cell`, ‏**‏לא** ‏לפי סדר-האיטרציה —
   * ‏חמישה תאים לתוך `repeat(3, …)` ‏היו נותנים שתי שורות שבורות במקום צלב.
   */
  import type { BtButton } from "$lib/engines/bt-remote.js"
  import { padCellStates } from "./pad-cells.js"

  let { hot = null, flash = null }: { hot?: BtButton | null; flash?: BtButton | null } = $props()
</script>

<div class="pad">
  {#each padCellStates(hot, flash) as cell (cell.id)}
    <div
      data-cell={cell.id}
      class:hot={cell.lit}
      class:inert={cell.button === null}
      title={cell.inertReason}
    >
      {cell.glyph}
    </div>
  {/each}
</div>
<p class="pad-note">▲ ▼ = volume — swallowed by Android, never reaches the browser</p>

<style>
  .pad {
    display: grid;
    grid-template-columns: repeat(3, 3.4rem);
    grid-template-rows: repeat(3, 3.4rem);
    gap: 0.4rem;
  }
  .pad > div {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #141b23;
    border: 1px solid #2a3644;
    border-radius: 0.6rem;
    font-size: 1.2rem;
    color: #8899a8;
  }
  /* ‏מיקום מפורש — ‏חסין לסדר-האיטרציה. */
  .pad > [data-cell="up"] { grid-column: 2; grid-row: 1; }
  .pad > [data-cell="left"] { grid-column: 1; grid-row: 2; }
  .pad > [data-cell="center"] { grid-column: 2; grid-row: 2; }
  .pad > [data-cell="right"] { grid-column: 3; grid-row: 2; }
  .pad > [data-cell="down"] { grid-column: 2; grid-row: 3; }
  .pad > div.hot {
    background: #7ee081;
    color: #0b0f14;
    border-color: #7ee081;
  }
  /* ⚠️ ‏אחרי כלל-הבסיס: ‏אותה ספציפיות, ‏ולכן הסדר מכריע. */
  .pad > div.inert {
    opacity: 0.45;
    border-style: dashed;
  }
  .pad-note {
    margin: 0;
    font-size: 0.7rem;
    color: #8899a8;
    text-align: center;
  }
</style>
