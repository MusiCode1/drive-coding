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
import MicLarge from "./MicLarge.svelte"
import TypeArea from "./TypeArea.svelte"
import { getI18n, getResponsive } from "$lib/context"

const t = getI18n().t
const responsive = getResponsive()

// mode מקומי — record (ברירת מחדל) או typing
let mode = $state<"record" | "typing">("record")
</script>

<!-- footer: דסקטופ = כרטיס עולה-מלמטה; מובייל = שטוח עם רקע bg (ה-fade הוא
     #chat-fade של אזור הגלילה ב-AppShell — ההודעות נמוגות לתוך המיקרופון). -->
<footer
  class="relative shrink-0 flex justify-center px-4"
  class:mic-plain={responsive.isMobile}
  style={responsive.isMobile ? "background:var(--bg)" : ""}
>
  <!-- כרטיס mic — .mic-card מ-app.css (שקוף במובייל דרך .mic-plain) -->
  <div class="mic-card w-full max-w-3xl min-w-0 px-4 pt-4 pb-5 flex flex-col items-center gap-3">

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

    <!-- אזור פעולה — שני המצבים תמיד ב-DOM, מוערמים באותו תא grid (col/row 1).
         המעבר ב-opacity בלבד (CSS), בלי {#if}/transition — כך אין reflow/קפיצה.
         min-height:168px קובע גובה אחיד לשני המצבים (מוקאפ 443-467). -->
    <div class="w-full grid place-items-center" style="min-height:168px">
      <div
        class="record-pane flex flex-col items-center gap-3 w-full"
        class:is-active={mode === "record"}
      >
        <MicLarge />
      </div>
      <div
        class="record-pane w-full"
        class:is-active={mode === "typing"}
      >
        <TypeArea />
      </div>
    </div>
  </div>
</footer>

<style>
  /* שני ה-panes חולקים את אותו תא grid (col/row 1) → מוערמים זה על זה.
     החלפה ב-opacity בלבד, בלי הוספה/הסרה של DOM → אין reflow ואין קפיצה.
     ה-pane הלא-פעיל נשאר ב-layout (תופס מקום) כדי שהתא יחזיק גובה אחיד,
     אך opacity:0 + pointer-events:none מסתירים אותו ומונעים אינטראקציה.

     Timing — "רגע ריק" באמצע: היוצא דוהה ב-0.3s, ורק אחר כך (delay 0.3s)
     הנכנס עולה ב-0.3s. כך אין חפיפה — תמיד יש רגע ששני ה-panes שקופים.
     ה-visibility מתחלף בסוף כל שלב כדי לא לתפוס קליקים בזמן השקיפות. */
  .record-pane {
    grid-column: 1;
    grid-row: 1;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    /* יציאה: דוהה מיד (0.3s), ואז visibility נכבית */
    transition:
      opacity 0.3s ease,
      visibility 0s linear 0.3s;
  }

  .record-pane.is-active {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    /* כניסה: ממתין שהיוצא ידהה (delay 0.3s) ואז עולה (0.3s) */
    transition:
      opacity 0.3s ease 0.3s,
      visibility 0s linear 0s;
  }
</style>
