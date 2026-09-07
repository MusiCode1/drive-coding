<script lang="ts">
/**
 * SessionMemoPad — פתק ממו צף לסשן (slice session-memo-pad).
 *
 * מצומצם = גלולה קטנה שהיא עצמה הלחצן שפותח את הפתק. פרוש = כרטיס עם כותרת
 * ו-textarea. **אין כפתור סגירה, במכוון** — צמצום הוא הדרך היחידה להרחיק אותו,
 * כך שרשומות של סשן לא נמחקות בלחיצה מוטעית.
 *
 * leaf (חוק זהב #3): קורא getContext, מרנדר, ומאציל כל שינוי-מצב ל-VM.
 * מרונדר דרך ה-snippet `overlay` של AppShell, ולכן הוא ממוקם absolute בתוך
 * ה-wrapper של אזור-הגלילה — צף מעל הבועות ומעל ה-footer, ולא נגלל איתן.
 */
import { getI18n, getSessionMemo, getSettings } from "$lib/context"
import { createPadDrag, reclampElement } from "$lib/util/pad-drag"

const t = getI18n().t
const memo = getSessionMemo()
const settings = getSettings()

let el = $state<HTMLElement | null>(null)

// מכונת-הגרירה ב-util; כאן רק החיווט.
const dragging = createPadDrag({ getEl: () => el, onPos: (pos) => memo.setPos(pos) })

// הפתיחה נשארת `onclick` (נגיש למקלדת), אבל גרירה שמסתיימת על הגלולה מייצרת
// גם היא click — consumeDrag בולע אותו כדי שגרירה לא תפתח את הפתק.
function openUnlessDragged() {
  if (!dragging.consumeDrag()) memo.setMinimized(false)
}

function reclamp() {
  const next = reclampElement(el, memo.pos)
  if (next) memo.setPos(next)
}

// המיקום משותף לגלולה ולכרטיס, שרוחבם שונה מאוד — ולכן מצמידים מחדש בכל
// פרישה/צמצום ובכל שינוי-מידות. אלה effects תלויי-DOM-node, שנשארים
// בקומפוננטה לפי הסייג של חוק זהב #4.
$effect(() => {
  void memo.minimized
  reclamp()
})

$effect(() => {
  window.addEventListener("resize", reclamp)
  return () => window.removeEventListener("resize", reclamp)
})

// מיקום גרור גובר על ברירת-המחדל של ה-CSS (פינה תחתונה, צד ההתחלה).
const posStyle = $derived(
  memo.pos
    ? `left:${memo.pos.left}px; top:${memo.pos.top}px; bottom:auto; inset-inline-start:auto;`
    : "",
)
</script>

<!-- הכיבוי יושב כאן ולא ב-ChatScreen: leaf שקורא שדה אחד מ-VM הוא בדיוק מה
     שחוק זהב #3 מתיר, וכך נקודת-הקריאה נשארת קובץ אחד. שים לב שזה **לא**
     כפתור סגירה — הוא חי בהגדרות, הרחק ממחוות הצ'אט, ולכן אי אפשר להיתקל בו
     בטעות ולאבד רשומות. -->
{#if !settings.showSessionMemo}
  <!-- כבוי בהגדרות — אין רינדור כלל. -->
{:else if memo.minimized}
  <button
    bind:this={el}
    type="button"
    class="memo-pill"
    style={posStyle}
    {...dragging}
    onclick={openUnlessDragged}
    aria-label={t("sessionMemo.open")}
    title={t("sessionMemo.open")}
  >
    <span>{t("sessionMemo.title")}</span>
    {#if memo.hasContent}
      <span class="memo-dot" aria-hidden="true"></span>
    {/if}
  </button>
{:else}
  <section bind:this={el} class="memo-card" style={posStyle} aria-label={t("sessionMemo.title")}>
    <header class="memo-head" {...dragging}>
      <span class="memo-title">{t("sessionMemo.title")}</span>
      <button
        type="button"
        class="memo-min"
        data-no-drag
        onclick={() => memo.setMinimized(true)}
        aria-label={t("sessionMemo.minimize")}
        title={t("sessionMemo.minimize")}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>
    </header>
    <textarea
      class="memo-body"
      dir="auto"
      bind:value={memo.text}
      placeholder={t("sessionMemo.placeholder")}
    ></textarea>
  </section>
{/if}

<style>
  /* inset-inline-start: הצד ההתחלתי לפי כיוון הממשק (RTL/LTR), לא "שמאל".
     bottom-4 מיישר לגובה של כפתור JumpDown באותו wrapper. */
  .memo-pill,
  .memo-card {
    position: absolute;
    inset-inline-start: 1rem;
    bottom: 1rem;
    z-index: 20;
    border-radius: 0.75rem;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg, inherit);
  }

  .memo-pill {
    touch-action: none;
    user-select: none;
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.4375rem 0.75rem;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
  }

  .memo-dot {
    width: 0.375rem;
    height: 0.375rem;
    border-radius: 50%;
    background: var(--accent);
  }

  .memo-card {
    display: flex;
    flex-direction: column;
    /* min() — במסך צר הפתק מתכווץ במקום לגלוש מעבר לקצה. */
    width: min(20rem, calc(100vw - 2rem));
    height: 13rem;
    overflow: hidden;
  }

  .memo-head {
    /* ידית הגרירה. touch-action:none — בלעדיו הדפדפן תופס את המחווה כגלילה
       ומבטל את ה-pointermove באמצע הגרירה. */
    cursor: move;
    touch-action: none;
    user-select: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.5rem 0.375rem 0.75rem;
    border-bottom: 1px solid var(--border);
  }

  .memo-title {
    flex: 1 1 auto;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .memo-min {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 0.25rem;
    color: var(--fg-dim);
    cursor: pointer;
  }

  .memo-min:hover {
    color: var(--fg, inherit);
    background: color-mix(in srgb, var(--fg-dim) 18%, transparent);
  }

  .memo-body {
    flex: 1 1 auto;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: 0;
    outline: none;
    resize: none;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.8125rem;
    line-height: 1.45;
  }

  .memo-body::placeholder {
    color: var(--fg-dim);
  }
</style>
