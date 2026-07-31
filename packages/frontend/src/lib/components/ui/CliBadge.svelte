<script lang="ts">
/**
 * CliBadge — תצוגת CLI מאוחדת (slice cli-branding, Commit 2).
 *
 * מחליף 5 אתרי-קוד ששילבו הצגת מזהה-CLI גולמי + 2 בלוקי CSS `.cli-badge` משוכפלים
 * מילה-במילה (ActiveProcessesPanel/RecentProjectsPanel). מציג displayName אם הוצהר
 * ב-cli-specs.jsonc, אחרת נופל למזהה (cliDisplayName).
 *
 * "badge" = צ'יפ קומפקטי — מאמץ את ה-CSS הקיים של .cli-badge + עיגול-מונוגרמה בדפוס
 * של Avatar.svelte (BG/FG עם color-mix, גוון מ-cliColorHue). "inline" = טקסט בלבד,
 * לשימוש בתוך כותרת/משפט קיים (SessionOptionsPanel, AuthGuidance).
 *
 * §9 Q2: אין ולידציית-אורך ל-displayName בסכימה — המיטיגציה כאן: max-width +
 * text-overflow:ellipsis על התווית.
 */
import { cliColorHue, cliDisplayName, cliMonogram } from "$lib/util/cli-display"

interface Props {
  id: string
  displayName?: string | undefined
  /** "badge" = צ'יפ קומפקטי (רשימות) · "inline" = טקסט בלבד (כותרות) */
  variant?: "badge" | "inline"
}

const { id, displayName, variant = "badge" }: Props = $props()

const label = $derived(cliDisplayName(id, displayName))
const monogram = $derived(cliMonogram(label))
const hue = $derived(cliColorHue(id))
const monogramBg = $derived(`color-mix(in srgb, hsl(${hue} 70% 55%) 22%, transparent)`)
const monogramFg = $derived(`hsl(${hue} 70% 45%)`)
</script>

{#if variant === "badge"}
  <span class="cli-badge">
    <span class="cli-badge-monogram" style="background:{monogramBg}; color:{monogramFg}"
      >{monogram}</span
    >
    <span class="cli-badge-label" dir="auto">{label}</span>
  </span>
{:else}
  <span dir="auto">{label}</span>
{/if}

<style>
  /* מאוחד משני בלוקים זהים מילה-במילה (ActiveProcessesPanel:508-516,
     RecentProjectsPanel:322-331) — display/gap נוספו כאן כי הבלוק המקורי היה
     span-טקסט פשוט; עכשיו יש גם עיגול-מונוגרמה לפניו. */
  .cli-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: var(--border);
    color: var(--fg);
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 600;
    flex-shrink: 0;
    max-width: 10rem;
  }

  .cli-badge-monogram {
    display: grid;
    place-items: center;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    font-size: 0.6rem;
    font-weight: 700;
    flex-shrink: 0;
    line-height: 1;
  }

  /* §9 Q2 — מיטיגציה לשם ארוך: אין ולידציית-אורך בסכימה, אז חיתוך זול פה. */
  .cli-badge-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
