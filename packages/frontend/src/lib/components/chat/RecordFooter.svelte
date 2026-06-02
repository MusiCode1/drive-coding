<script lang="ts">
/**
 * RecordFooter — footer אזור-קלט (redesign-4).
 *
 * mode: "record" | "typing" — $state מקומי (לא VM — לפי §3).
 * מכיל toggle 2-כפתורים + MicLarge / TypeArea.
 * crossfade: wrapper עם min-height:168px + opacity/visibility מתחלפים.
 * footer responsive: כרטיס mic-card (דסקטופ) / fade (מובייל) — דרך getResponsive.
 *
 * מוקאפ: שורות 420-470.
 *
 * ─── record-footer (redesign-4) ───
 */
import MicIcon from "@lucide/svelte/icons/mic"
import KeyboardIcon from "@lucide/svelte/icons/keyboard"
import { fade } from "svelte/transition"
import MicLarge from "./MicLarge.svelte"
import TypeArea from "./TypeArea.svelte"
import { getI18n, getResponsive } from "$lib/context"

const t = getI18n().t
const responsive = getResponsive()

// mode מקומי — record (ברירת מחדל) או typing
let mode = $state<"record" | "typing">("record")
</script>

<footer class="relative shrink-0 flex justify-center px-4">
  <!-- fade gradient מובייל — מוצג רק כש-isMobile -->
  {#if responsive.isMobile}
    <div
      class="pointer-events-none absolute left-0 right-0 -top-8 h-8"
      style="background:linear-gradient(to top, var(--bg-elev), transparent)"
    ></div>
  {/if}

  <!-- כרטיס mic — .mic-card מ-app.css -->
  <div class="mic-card w-full max-w-3xl px-4 pt-4 pb-5 flex flex-col items-center gap-3">

    <!-- toggle הקלדה/הקלטה -->
    <div
      class="flex items-center gap-1 p-1 rounded-full text-xs"
      style="background:var(--bg-card)"
    >
      <button
        class="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full font-semibold transition-all"
        style={mode === "record"
          ? "background:var(--accent); color:white"
          : "color:var(--fg-dim)"}
        onclick={() => (mode = "record")}
        aria-pressed={mode === "record"}
      >
        <MicIcon size={13} strokeWidth={2} />
        {t("record.tab.record")}
      </button>
      <button
        class="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full font-semibold transition-all"
        style={mode === "typing"
          ? "background:var(--accent); color:white"
          : "color:var(--fg-dim)"}
        onclick={() => (mode = "typing")}
        aria-pressed={mode === "typing"}
      >
        <KeyboardIcon size={13} strokeWidth={2} />
        {t("record.tab.type")}
      </button>
    </div>

    <!-- אזור פעולה — min-height:168px מונע קפיצת גובה ב-crossfade -->
    <div class="w-full grid place-items-center" style="min-height:168px">
      {#if mode === "record"}
        <div
          class="flex flex-col items-center gap-3 w-full"
          transition:fade={{ duration: 200 }}
        >
          <MicLarge />
        </div>
      {:else}
        <div
          class="w-full"
          transition:fade={{ duration: 200 }}
        >
          <TypeArea />
        </div>
      {/if}
    </div>
  </div>
</footer>
