<script lang="ts">
/**
 * CliBadge — תצוגת CLI מאוחדת (slice cli-branding, Commit 2; לוגו — slice
 * cli-logo-serving, Commit 1).
 *
 * מחליף 5 אתרי-קוד ששילבו הצגת מזהה-CLI גולמי + 2 בלוקי CSS `.cli-badge` משוכפלים
 * מילה-במילה (ActiveProcessesPanel/RecentProjectsPanel). מציג displayName אם הוצהר
 * ב-cli-specs.jsonc, אחרת נופל למזהה (cliDisplayName).
 *
 * "badge" = צ'יפ קומפקטי — מאמץ את ה-CSS הקיים של .cli-badge + עיגול-מונוגרמה בדפוס
 * של Avatar.svelte (BG/FG עם color-mix, גוון מ-cliColorHue). "inline" = טקסט בלבד,
 * לשימוש בתוך כותרת/משפט קיים (SessionOptionsPanel, AuthGuidance). "icon" = לוגו-או-
 * מונוגרמה בלבד, בלי טקסט — לשימוש כ-snippet של אייקון בתוך רכיבים אחרים (Select
 * בדרופדאון, slice cli-logo-serving Commit 2) שכבר מרנדרים את התווית בעצמם.
 *
 * §9 Q2: אין ולידציית-אורך ל-displayName בסכימה — המיטיגציה כאן: max-width +
 * text-overflow:ellipsis על התווית.
 *
 * לוגו (slice cli-logo-serving): `logo` הוא prop אופציונלי — קורא שלא מעביר אותו
 * מקבל מונוגרמה תמיד (fail-safe, לא כשל שקט של "בלי כלום"). כשקיים, `<img>` מוגש
 * מ-`/api/cli-logo/:id` (id-keyed, ר' §3 בבריף) דרך `beUrl()` — לא נתיב-שורש קשיח,
 * כי בפריסת CF Pages ה-BE יושב על origin אחר ונתיב קשיח ייכשל תמיד. `onerror` →
 * `failed=true` → נפילה חזרה למונוגרמה, בלי שגיאה גלויה למשתמש.
 *
 * לוגו מרוחק (Commit 3, בקשת משתמשת): אם `logo` הוא URL (`http://`/`https://`,
 * `isRemoteLogo()`) — הדפדפן מושך אותו **ישירות** (`<img src={logo}>`), לא דרך
 * ה-BE. ה-BE לעולם לא מושך URL מרוחק מטעם ה-client — זה משטח-SSRF.
 */
import {
  cliColorHue,
  cliDisplayName,
  cliLogoKey,
  cliMonogram,
  resolveCliLogoUrl,
} from "$lib/util/cli-display"

interface Props {
  id: string
  displayName?: string | undefined
  /** נתיב-לוגו מוצהר (cli-specs.jsonc). חסר → תמיד מונוגרמה. */
  logo?: string | undefined
  /** "badge" = צ'יפ קומפקטי (רשימות) · "inline" = טקסט בלבד (כותרות) · "icon" = לוגו/מונוגרמה בלבד */
  variant?: "badge" | "inline" | "icon"
}

const { id, displayName, logo, variant = "badge" }: Props = $props()

const label = $derived(cliDisplayName(id, displayName))
const monogram = $derived(cliMonogram(label))
const hue = $derived(cliColorHue(id))
const monogramBg = $derived(`color-mix(in srgb, hsl(${hue} 70% 55%) 22%, transparent)`)
const monogramFg = $derived(`hsl(${hue} 70% 45%)`)
// resolveCliLogoUrl: מרוחק | static same-origin (/logos/…) | קובץ מקומי (/api/cli-logo).
const logoUrl = $derived(logo ? resolveCliLogoUrl(id, logo) : undefined)

// 🔴 `failed` חייב להתאפס כש-id/logo משתנים — אחרת אחרי החלפת CLI שבור אחד,
// הנפילה-למונוגרמה "דבקה" גם ל-CLI הבא (לא רק לזה שבאמת נכשל). cliLogoKey
// יוצר מפתח יציב מ-(id,logo); ה-$effect רץ בכל שינוי שלו ומאפס את failed.
const logoKey = $derived(cliLogoKey(id, logo))
let failed = $state(false)
$effect(() => {
  logoKey
  failed = false
})
</script>

{#if variant === "badge"}
  <span class="cli-badge">
    {#if logoUrl && !failed}
      <img
        class="cli-badge-monogram"
        src={logoUrl}
        alt=""
        onerror={() => (failed = true)}
      />
    {:else}
      <span class="cli-badge-monogram" style="background:{monogramBg}; color:{monogramFg}"
        >{monogram}</span
      >
    {/if}
    <span class="cli-badge-label" dir="auto">{label}</span>
  </span>
{:else if variant === "icon"}
  {#if logoUrl && !failed}
    <img class="cli-badge-monogram" src={logoUrl} alt="" onerror={() => (failed = true)} />
  {:else}
    <span class="cli-badge-monogram" style="background:{monogramBg}; color:{monogramFg}"
      >{monogram}</span
    >
  {/if}
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

  /* Commit 4 (בקשת משתמשת אחרי פריוויו): הוגדל 1rem→1.5rem — span (מונוגרמה)
     ו-img (לוגו) חייבים להישאר **זהים** (אותה class בדיוק) כדי שהמעבר
     לוגו↔מונוגרמה לא יזיז פיקסל. font-size הותאם (0.6rem→0.85rem) כדי
     שהאותיות ימשיכו להתאים לעיגול הגדול יותר. */
  .cli-badge-monogram {
    display: grid;
    place-items: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    font-size: 0.85rem;
    font-weight: 700;
    flex-shrink: 0;
    line-height: 1;
  }

  /* 🔴 img.cli-badge-monogram (slice cli-logo-serving) — אותה class בדיוק
     כמו המונוגרמה (span), אז width/height/border-radius/flex-shrink כבר
     זהים ולא זזים פיקסל במעבר לוגו↔מונוגרמה. object-fit:contain הוא הנוסף
     היחיד — קובץ ה-fixture הוא 64px, בלי זה התמונה הייתה שוברת את ה-badge. */
  img.cli-badge-monogram {
    object-fit: contain;
  }

  /* §9 Q2 — מיטיגציה לשם ארוך: אין ולידציית-אורך בסכימה, אז חיתוך זול פה. */
  .cli-badge-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
