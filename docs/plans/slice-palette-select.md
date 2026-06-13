# Slice palette-select — בורר ערכת נושא כ-Select במקום chips — תוכנית

> **תאריך**: 2026-06-13
> **סטטוס**: טיוטה
> **Complexity**: 1/10 (verifier: light — מתאחד עם אימות palettes-expansion)
> **תלויות (`depends_on`)**: `slice-palettes-expansion` (אותו worktree, לא ממוזג עדיין). מהווה commit-המשך עליו.
> **Base**: `slice-palettes-expansion` tip `f6cf34e`
> **Worktree קיים**: `.worktrees/slice-palettes-expansion` (אין צורך ליצור חדש)

## §0 — Pre-flight

- **אין worktree חדש.** עובדים בתוך `.worktrees/slice-palettes-expansion` הקיים (Vite כבר רץ שם על :5173).
- BE לא נדרש (FE/CSS בלבד).
- Tests: `pnpm --filter @drive-coding/frontend-v2 typecheck` · `pnpm lint:i18n`.
- Browser: לבדוק ב-mobile (~390px → Dialog) וגם desktop (→ Popover), כי `Select` מתנהג שונה לפי מסך.

### Reading list
**must-read**:
- `packages/frontend/src/lib/components/settings/LanguageSelect.svelte` — הדפוס המדויק לחיקוי (leaf-component שעוטף `Select`).
- `packages/frontend/src/lib/components/ui/Select.svelte` — ה-API: `value`, `options: {value,label}[]`, `title`, `onchange:(v)=>void`.

## §1 — מטרה

המשתמשת תבחר ערכת נושא דרך **תפריט נפתח (Select)** במקום שורת chips. אותה התנהגות בדיוק (בחירה מיידית + שמירה ב-localStorage), אך תצוגה קומפקטית ועקבית עם בורר השפה שכבר משתמש ב-`Select`. במובייל זה Dialog נוח-לאצבע, בדסקטופ Popover מעוגן.

## §2 — Scope
| פיצ'ר | כן/לא | הערה |
|---|---|---|
| המרת PalettePicker ל-Select | ✅ | הסליס היחיד |
| preview-צבע בכל אפשרות (swatch) | ❌ | מעבר ל-`Select` flat; אם נרצה swatches — סליס נפרד |
| קיבוץ כהות/בהירות (groups) | ❌ | 8 פריטים שטוחים מספיק; `Select` תומך אם נרצה בעתיד |

## §3 — Architecture
שכבה 4 (leaf component) בלבד. אין שינוי ב-ThemeVM, ב-context, או ב-CSS. `PalettePicker` ממשיך לקרוא `getTheme()` ולהאציל ל-`theme.setPalette()` — רק ה-render משתנה מ-`<button>`×N ל-`<Select>` יחיד.

## §4 — Commits

### Commit 1 — PalettePicker → Select (approach: manual)
**קובץ שמשתנה**: `packages/frontend/src/lib/components/settings/PalettePicker.svelte`

**מה משתנה**:
- מייבאים `Select from "$lib/components/ui/Select.svelte"`.
- שומרים את `EMOJI` map ואת `PALETTES`/`type Palette`.
- מחליפים את ה-`<div class="flex flex-wrap">…{#each}…<button>` כולו ב-`<Select>` יחיד.
- בונים `options` נגזר מ-`PALETTES`, התווית = `${EMOJI[p]} ${t(\`settings.theme.${p}\`)}`.
- מעדכנים את ה-docstring (chips → Select).

**API skeleton (התוצאה הצפויה — executor אסור לסטות מהמבנה)**:
```svelte
<script lang="ts">
import { getTheme, getI18n } from "$lib/context"
import { PALETTES, type Palette } from "$lib/view-models/theme.svelte"
import Select from "$lib/components/ui/Select.svelte"

const theme = getTheme()
const t = $derived(getI18n().t)

const EMOJI: Record<Palette, string> = {
  ember: "🔥", forest: "🌲", plum: "🍇", teal: "🪸",
  midnight: "🌙", rose: "🌹", slate: "🪨", daylight: "☀️",
}
const options = $derived(PALETTES.map((p) => ({ value: p, label: `${EMOJI[p]} ${t(`settings.theme.${p}`)}` })))
</script>

<Select
  value={theme.palette}
  options={options}
  title={t("settings.theme.label")}
  onchange={(v) => theme.setPalette(v as Palette)}
/>
```

**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm lint:i18n
```

## §5 — DoD
| בדיקה | איך |
|---|---|
| ה-Settings מציג Select במקום chips | פתיחת Settings → כרטיס "ערכת נושא" → trigger יחיד עם הפלטה הנוכחית |
| 8 הפלטות מופיעות בתפריט | פתיחת ה-Select → 8 פריטים עם אימוג'י + שם מתורגם |
| בחירה מחילה צבע מיידית | בחירת `daylight` → הרקע מתבהר מיד |
| נשמר אחרי reload | בחירה → F5 → אותה פלטה פעילה (data-palette על `<html>`) |
| value מסונכרן | הפריט המסומן (check) = הפלטה הפעילה |
| mobile + desktop | ~390px → Dialog; דסקטופ → Popover; שניהם עובדים |
| typecheck + lint:i18n ירוקים | פקודות §4 |

## §6 — Risks
| סיכון | מקור | מיטיגציה |
|---|---|---|
| `value` לא ריאקטיבי לשינוי חיצוני של palette | Svelte 5 | `theme.palette` הוא `$state`; `value={theme.palette}` מגיב — כמו `value={i18n.locale}` ב-LanguageSelect |
| Hardcoded Hebrew | pre-commit hook | אין מחרוזות חדשות; משתמשים ב-`t()` הקיים (`settings.theme.*` כבר קיימים מ-palettes-expansion) |
| חתימת `onchange` שונה מהצפוי | — | מאומת מול LanguageSelect (`onchange={(v)=>…}`) — זהה |

## §7 — Escalation triggers
- אם `Select` לא חושף `onchange` או דורש `bind:value` במקום `value`+`onchange` — עצור ושאל את מרדכי (אולי צריך wrapper-state).

## §8 — Complexity score
1/10 — קובץ יחיד, שכבה אחת, ללא API/protocol/state חדש. verifier: light, מתאחד עם אימות palettes-expansion (כלב רץ פעם אחת על שני ה-commits).

## §9 — שאלות פתוחות
| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | האם לוותר על אינדיקציית-הצבע הוויזואלית של chips? | כן — Select טקסטואלי עם אימוג'י; swatch בסליס עתידי אם יידרש | ❌ |
| 2 | flat או groups (כהות/בהירות)? | flat — 8 פריטים | ❌ |
