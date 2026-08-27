<script lang="ts">
/**
 * RecordFooter — footer אזור-קלט (redesign-4, גובה משתנה: redesign-fix).
 *
 * mode: "record" | "typing" | "live" | "hidden" — UiShellVM.inputMode (singleton, slice playback-dock-scope).
 * toggle 4-כפתורים + MicLarge / TypeArea / Live pane. במצב hidden אזור הפעולה מתכווץ ל-0
 * ונשאר רק ה-toggle (מאפשר קריאה בלי שהפוטר מסתיר חצי מסך).
 *
 * גובה משתנה — אזור הפעולה הוא grid עם 3 panes מוערמים (col 1), כל אחד עטוף
 * ב-grid-template-rows שמתאנמט בין 0fr (מוסתר) ל-1fr (פעיל). הפוטר גדל/מתכווץ
 * לפי ה-pane הפעיל (record גבוה, typing נמוך, hidden=0).
 *
 * מעבר ללא קפיצה — ה-pane היוצא דוהה מיד (opacity), נשאר תופס מקום; רק אחרי
 * שדהה (delay) מתכווץ גובהו (rows→0fr); הנכנס מתרחב (rows→1fr) ואז עולה (opacity,
 * delay). כל הגבהים נגזרים מהתוכן (grid 0fr/1fr) — אין מדידת JS ואין min-height קבוע.
 *
 * footer responsive: כרטיס mic-card (דסקטופ) / fade (מובייל) — דרך getResponsive.
 * מוקאפ: שורות 420-470.
 *
 * ─── record-footer (redesign-4) ───
 */
import MicIcon from "@lucide/svelte/icons/mic"
import KeyboardIcon from "@lucide/svelte/icons/keyboard"
import RadioIcon from "@lucide/svelte/icons/radio"
import EyeOffIcon from "@lucide/svelte/icons/eye-off"
import MicLarge from "./MicLarge.svelte"
import LiveToggle from "./LiveToggle.svelte"
import LiveTranscript from "./LiveTranscript.svelte"
import PlaybackControls from "./PlaybackControls.svelte"
import TypeArea from "./TypeArea.svelte"
import { getI18n, getLive, getResponsive, getSession, getUiShell } from "$lib/context"
import type { Component } from "svelte"
import type { InputMode } from "$lib/view-models/ui-shell.svelte"
import type { MessageKey } from "@drive-coding/core/i18n"

const t = getI18n().t
const responsive = getResponsive()
const uiShell = getUiShell()
const live = getLive()
// TEMP-RECONNECT (לבדיקה ידנית בלבד — להחזיר לאחור; אינו חלק מ-slice infra)
const session = getSession()

/** Hug-content pill. Mobile = icon-only + ≥44px tap; desktop = icon+label. */
const MODE_TABS: ReadonlyArray<{
  mode: InputMode
  labelKey: MessageKey
  Icon: Component<{ size?: number; strokeWidth?: number }>
}> = [
  { mode: "record", labelKey: "record.tab.record", Icon: MicIcon },
  { mode: "typing", labelKey: "record.tab.type", Icon: KeyboardIcon },
  { mode: "live", labelKey: "record.tab.live", Icon: RadioIcon },
  { mode: "hidden", labelKey: "record.tab.hide", Icon: EyeOffIcon },
]

const tabIconSize = $derived(responsive.isMobile ? 22 : 13)

function switchInputMode(mode: InputMode): void {
  if (uiShell.inputMode === "live" && mode !== "live" && live.isOpen) {
    void live.toggle()
  }
  uiShell.setInputMode(mode)
}
</script>

<!-- footer: דסקטופ = כרטיס עולה-מלמטה; מובייל = שטוח עם רקע bg (ה-fade הוא
     #chat-fade של אזור הגלילה ב-AppShell — ההודעות נמוגות לתוך המיקרופון).
     מובייל: pb גדול יותר במצב hidden כדי שה-toggle לא יכסה את ידית ה-BottomSheet. -->
<footer
  class="relative shrink-0 flex justify-center px-4"
  class:mic-plain={responsive.isMobile}
  class:is-hidden={uiShell.inputMode === "hidden"}
  style={responsive.isMobile ? "background:var(--bg)" : ""}
>
  <!-- כרטיס mic — .mic-card מ-app.css (שקוף במובייל דרך .mic-plain) -->
  <div class="mic-card w-full max-w-3xl min-w-0 px-4 pt-4 pb-5 flex flex-col items-center gap-3">

    <!-- mode toggle: כדורית hug-content (לא רוחב-מסך). מובייל = אייקון בלבד + יעד ≥44px. -->
    <div
      class="mode-tabs inline-flex items-center gap-1 p-1 rounded-full text-xs"
      style="background:var(--bg-card)"
    >
      {#each MODE_TABS as tab (tab.mode)}
        {@const label = t(tab.labelKey)}
        <button
          type="button"
          class="mode-tab inline-flex items-center justify-center gap-1.5 rounded-full font-semibold transition-all"
          class:mode-tab--mobile={responsive.isMobile}
          style={uiShell.inputMode === tab.mode
            ? "background:var(--accent); color:white"
            : "color:var(--fg-dim)"}
          onclick={() => switchInputMode(tab.mode)}
          aria-label={label}
          aria-pressed={uiShell.inputMode === tab.mode}
        >
          <tab.Icon size={tabIconSize} strokeWidth={2} />
          {#if !responsive.isMobile}
            {label}
          {/if}
        </button>
      {/each}
    </div>

    <!-- TEMP-RECONNECT-BUTTON (לבדיקה ידנית בלבד — להחזיר לאחור; אינו חלק מ-slice infra) -->
    {#if session.status === "disconnected"}
      <button
        onclick={() => session.reconnect()}
        class="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold"
        style="background:var(--recording); color:#fff"
      >
        {#if session.reconnectAttempt > 0}
          {t("record.reconnecting")} ({t("record.reconnectAttempt")} {session.reconnectAttempt})
        {:else}
          {t("record.reconnect")}
        {/if}
      </button>
    {/if}
    <!-- /TEMP-RECONNECT-BUTTON -->

    <!-- control-dock (dock-inline): רצועת השמעה בתוך הכרטיס, בין toggle ל-action-area -->
    <PlaybackControls />

    <!-- אזור פעולה — גובה משתנה. 3 panes מוערמים (col 1), כל אחד עטוף ב-grid
         שגובהו 0fr (מוסתר) / 1fr (פעיל). הפוטר גדל/מתכווץ לפי ה-pane הפעיל.
         מעבר ללא קפיצה: opacity (יציאה מיד, כניסה עם delay) + rows (התכווצות/
         התרחבות עם delay מתואם). ר' <style>. במצב hidden כל ה-panes ב-0fr. -->
    <div class="action-area w-full">
      <div
        class="record-pane"
        class:is-active={uiShell.inputMode === "record"}
      >
        <div class="record-pane-inner flex flex-col items-center gap-3 w-full">
          <MicLarge />
        </div>
      </div>
      <div
        class="record-pane"
        class:is-active={uiShell.inputMode === "typing"}
      >
        <div class="record-pane-inner w-full">
          <TypeArea />
        </div>
      </div>
      <div
        class="record-pane"
        class:is-active={uiShell.inputMode === "live"}
      >
        <div class="record-pane-inner flex flex-col items-center gap-3 w-full">
          <LiveTranscript />
          <LiveToggle />
        </div>
      </div>
    </div>
  </div>
</footer>

<style>
  /* דסקטופ: אייקון + תווית (כמו לפני live-input-mode). */
  .mode-tab {
    padding: 0.375rem 1rem; /* py-1.5 px-4 */
  }

  /* מובייל: אייקון בלבד, יעד לחיצה ≥44×44 (HIG) — הכדורית נשארת hug-content. */
  .mode-tab--mobile {
    min-width: 44px;
    min-height: 44px;
    padding: 0;
  }

  /* ── אזור הפעולה — גובה משתנה דרך grid-template-rows ──
     ה-panes מוערמים באותו תא (col/row 1). כל pane הוא grid עם שורה אחת
     שגובהה 0fr (מוסתר) / 1fr (פעיל). גובה אזור הפעולה = סכום ה-panes, כלומר
     גובה ה-pane הפעיל בלבד (האחרים 0fr) → הפוטר גדל/מתכווץ לפי המצב.
     grid-template-rows מאנמט גובה ל-content בלי לדעת אותו מראש (לא min-height קבוע). */
  .action-area {
    display: grid;
  }

  .record-pane {
    grid-column: 1;
    grid-row: 1;
    display: grid;
    grid-template-rows: 0fr; /* מוסתר — מתכווץ */
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    /* יציאה (לא-פעיל):
       - opacity דוהה מיד (0.3s) — ה-pane היוצא נעלם ראשון.
       - rows מתכווץ עם delay 0.3s — רק אחרי שדהה, כדי שלא יקפוץ תוך כדי.
       - visibility נכבית בסוף. */
    transition:
      opacity 0.3s ease,
      grid-template-rows 0.3s ease 0.3s,
      visibility 0s linear 0.6s;
  }

  /* ה-inner חייב min-height:0 + overflow:hidden כדי ש-0fr באמת יחתוך אותו. */
  .record-pane-inner {
    min-height: 0;
    overflow: hidden;
  }

  .record-pane.is-active {
    grid-template-rows: 1fr; /* פעיל — נפתח לגובה התוכן */
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    /* כניסה (פעיל):
       - rows מתרחב מיד (0.3s) — הגובה נפתח ראשון, מפנה מקום.
       - opacity עולה עם delay 0.3s — אחרי שהיוצא דהה והגובה התרחב.
       כך הרצף: יוצא דוהה → גובה מתכוונן → נכנס עולה. אין קפיצה. */
    transition:
      grid-template-rows 0.3s ease,
      opacity 0.3s ease 0.3s,
      visibility 0s linear 0s;
  }

  /* מצב hidden: כל ה-panes לא-פעילים → action-area מתכווץ ל-0. נשאר רק ה-toggle.
     ה-padding-block-end של ה-mic-card (מרווח לידית ה-BottomSheet במובייל) מטופל
     ב-app.css (.is-hidden.mic-plain .mic-card) עם delay אסימטרי שמונע התרוממות. */
</style>
