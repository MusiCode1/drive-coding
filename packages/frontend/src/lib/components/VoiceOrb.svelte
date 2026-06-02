<script lang="ts">
  /**
   * VoiceOrb — נורית קולית אינטראקטיבית.
   *
   * props: vm: WakeWordVM
   * מקבל vm כ-prop (לא getContext) כי ה-VM לא ב-context הגלובלי —
   * route הבדיקה /wake-word-test הוא standalone.
   *
   * שכבת החלקה: lerp ב-rAF/$effect (לא ב-VM).
   * שתי timings נפרדות על properties שונים — לקח מה-POC (orb-dom.js):
   *   - background-color: 300ms → מעבר חלק בין מצבים (grey/blue/red)
   *   - width/height/filter: 80ms → מגיב לעוצמת קול per-frame ללא lag
   * flash: $effect על flashCount → אנימציית הבזק.
   */
  import { lerp } from "@drive-coding/core"
  import { onMount } from "svelte"
  import type { WakeWordVM } from "../view-models/wake-word.svelte.js"

  const BASE = 90       // px diameter at silence
  const MAX_EXTRA = 130 // px added at full loudness
  const LERP_FACTOR = 0.3
  const NORM_MAX = 0.25 // RMS ב-0.25 נחשב full loudness

  let { vm }: { vm: WakeWordVM } = $props()

  let smoothed = $state(0)
  let flashing = $state(false)
  let rafId: number | null = null

  // החלקה ב-rAF loop
  function smoothLoop() {
    const norm = Math.min(1, vm.level / NORM_MAX)
    smoothed = lerp(smoothed, norm, LERP_FACTOR)
    rafId = requestAnimationFrame(smoothLoop)
  }

  // מחשב style של הנורית
  const orbSize = $derived(BASE + smoothed * MAX_EXTRA)
  const orbBrightness = $derived(1 - smoothed * 0.4)
  const orbColor = $derived(
    vm.mode === "listening"
      ? "#3b82f6"
      : vm.mode === "recording"
        ? "#ef4444"
        : "#6b7280",
  )

  // flash: $effect שמגיב ל-flashCount
  let prevFlashCount = 0
  $effect(() => {
    const count = vm.flashCount
    if (count > prevFlashCount) {
      prevFlashCount = count
      flashing = false
      // re-trigger animation בcycle הבא
      requestAnimationFrame(() => {
        flashing = true
        setTimeout(() => { flashing = false }, 450)
      })
    }
  })

  onMount(() => {
    rafId = requestAnimationFrame(smoothLoop)
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  })
</script>

<!-- הנורית היא כפתור toggle -->
<div
  class="orb-dom-root"
  role="button"
  tabindex="0"
  aria-label="toggle wake word listening"
  onclick={() => vm.toggle()}
  onkeydown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      vm.toggle()
    }
  }}
  style="
    width: {orbSize}px;
    height: {orbSize}px;
    background-color: {orbColor};
    filter: brightness({orbBrightness});
  "
>
  <!-- flash overlay -->
  <div class="orb-flash" class:fire={flashing}></div>
</div>

<style>
  .orb-dom-root {
    border-radius: 50%;
    cursor: pointer;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    /* שתי timings נפרדות — ראה הסבר בscript */
    transition:
      background-color 0.3s ease,
      width 0.08s linear,
      height 0.08s linear,
      filter 0.08s linear,
      box-shadow 0.3s ease;
    box-shadow: 0 0 30px rgba(255, 255, 255, 0.12);
  }

  .orb-dom-root:hover {
    box-shadow: 0 0 38px rgba(255, 255, 255, 0.22);
  }

  .orb-dom-root:focus-visible {
    outline: 2px solid #93c5fd;
    outline-offset: 6px;
  }

  .orb-flash {
    position: absolute;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    pointer-events: none;
    opacity: 0;
  }

  .orb-flash.fire {
    animation: flashpulse 0.45s ease-out;
  }

  @keyframes flashpulse {
    0% {
      opacity: 0.9;
      transform: scale(1);
      box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.9);
    }
    100% {
      opacity: 0;
      transform: scale(2.4);
      box-shadow: 0 0 0 40px rgba(255, 255, 255, 0);
    }
  }
</style>
