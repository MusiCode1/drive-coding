# Slice palettes-expansion — ‏הרחבת ערכות נושא + בורר ב-Settings — ‏תוכנית

> **‏תאריך**: 2026-06-10
> **‏סטטוס**: ‏טיוטה
> **Complexity**: 2/10 (verifier: light)
> **‏תלויות (`depends_on`)**: [] ‏— ‏בנוי ישירות על dev. ‏מסתמך על תשתית ה-theme מ-redesign-1 ‏שכבר merged ב-dev (ThemeVM + `@theme` ב-app.css).
> **‏Base**: dev
> **‏Dev tip**: `e5ad302`

---

## §0 — Pre-flight

### ‏תלויות (‏חובה!)

‏slice זה **‏אין לו תלויות לא-merged**:
- ‏תשתית ה-theme (‏`ThemeVM`, ‏`[data-palette]`, ‏`@theme` mapping) ‏כבר ב-dev — ‏הוטמעה ב-redesign-1 (merged).
- ‏ה-slice כולו **additive**: ‏מוסיף 4 בלוקי `[data-palette]`, ‏מרחיב union, ‏מוסיף קומפוננטת בורר + כרטיס ב-Settings. ‏לא משנה התנהגות קיימת.

> ‏ברירת המחדל נשארת `ember` (‏`app.html` ‏ו-`DEFAULT_PALETTE`) — ‏ללא שינוי.

### Worktree

```bash
cd /home/user/drive-coding
git worktree add .worktrees/slice-palettes-expansion -b slice-palettes-expansion dev
cd .worktrees/slice-palettes-expansion
pnpm install && pnpm hooks:install
```

### ‏איך להריץ

- BE: **‏לא נדרש** — ‏ה-slice כולו FE/CSS, ‏אין קריאות proxy/TTS/STT.
- FE: `pnpm --filter @drive-coding/frontend dev` (port: ‏OS-assigned, ‏Vite מדפיס)
- Tests: `pnpm typecheck` ‏· `pnpm lint:i18n` ‏· `pnpm test`
- Tunnel: ‏לא נדרש.

### Browser

‏כל דפדפן מודרני. ‏ל-DoD: ‏לבדוק ‏ב-2 ‏viewports (‏mobile ‏~390px ‏ו-desktop) ‏כי הבורר יושב ב-SettingsScreen ‏ה-responsive.

### OneCLI agent

‏**‏לא רלוונטי** — ‏אין SDK חיצוני, ‏אין credentials. ‏אפשר `pnpm` ‏רגיל.

### Reading list

**must-read** ‏(לפני שמתחילים):
- `docs/conventions/parallel-safe-code.md` — ‏ה-slice נוגע ב-`packages/core/src/i18n/keys.ts` (shared file). ‏כל התוספות **‏additive בלבד**.
- `packages/frontend/src/app.css` ‏שורות 18–111 — ‏מבנה בלוק פלטה (17 ‏tokens) + ‏ה-`@theme` mapping. ‏הבלוקים החדשים מועתקים מהמבנה הזה.
- `packages/frontend/src/lib/view-models/theme.svelte.ts` — ‏ה-`Palette` union + ‏מערך `PALETTES` + ‏persistence.

**reference** (‏בזמן עבודה):
- `docs/plans/redesign-vnext-mockup.html` ‏שורות 822–826 — ‏ה-`#palette-bar` ‏המקורי (‏סגנון chips עם אימוג'י) — ‏ה-PalettePicker מבוסס עליו.
- `packages/frontend/src/lib/components/settings/SettingsScreen.svelte` — ‏איפה מוסיפים את הכרטיס + ‏דפוס `SettingsCard` + ‏`getI18n().t`.
- `packages/frontend/src/lib/components/settings/LanguageSelect.svelte` — ‏דפוס leaf-component שקורא VM מ-context (‏אותו דפוס ל-PalettePicker).

---

## §1 — ‏מטרה

‏המשתמשת תוכל לבחור את ערכת הצבעים של האפליקציה ‏מתוך מסך ההגדרות — ‏מבחר שיתרחב מ-4 ‏ל-8 ‏פלטות (‏נוספות: ‏`midnight` ‏כחול-דֶּב, ‏`rose` ‏ורוד-בלאש, ‏`slate` ‏אפור-מינימלי, ‏ו-`daylight` ‏הערכה הבהירה הראשונה). ‏הבחירה תיכנס לתוקף מיידית ‏ותישמר בין הפעלות (localStorage, ‏כבר נתמך). ‏עד היום הפלטות היו מוגדרות ב-CSS ‏אך **‏לא נגישות מה-UI** — ‏הסבב הזה סוגר את הפער.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|------|------|------|
| 4 ‏בלוקי `[data-palette]` ‏חדשים ב-app.css (midnight/rose/slate/daylight) | ✅ | ‏בסבב הזה |
| ‏הרחבת `Palette` union + ‏`PALETTES` ‏array | ✅ | ‏בסבב הזה |
| ‏בורר פלטות (chips) ‏ב-SettingsScreen | ✅ | ‏בסבב הזה |
| ‏מפתחות i18n ‏לשמות הפלטות (he+en) | ✅ | ‏בסבב הזה |
| ‏ערכה בהירה `daylight` (`color-scheme: light`) | ✅ | ‏בסבב הזה (‏ר' §6 risk — ‏בדיקת ניגודיות) |
| `carbon` (OLED שחור-מוחלט) | ❌ | ‏slice עתידי — ‏ר' §9 שאלה 2 |
| ‏העדפת מערכת אוטומטית (`prefers-color-scheme`) | ❌ | ‏slice עתידי — ‏מחוץ ל-scope, ‏בחירה ידנית בלבד |
| ‏שינוי ברירת המחדל מ-`ember` | ❌ | ‏לא — ‏ember ‏נשאר default |
| ‏Preview חי של הפלטה לפני בחירה | ❌ | ‏לא — ‏החלה מיידית מספיקה |

> ‏זו לא טבלת TODO. ‏זו הגנה מ-scope creep.

---

## §3 — Architecture diagram

```
┌──────────────────────────────────────────┐
│ routes/+layout.svelte                     │
│   const theme = new ThemeVM()             │  ‏קיים
│   setTheme(theme)  → Context              │
└───────────────┬──────────────────────────┘
                │ getTheme()
                ▼
┌──────────────────────────────────────────┐
│ settings/PalettePicker.svelte   ← ‏חדש     │
│   chips ← PALETTES                         │
│   onclick → theme.setPalette(p)            │
└───────────────┬──────────────────────────┘
                │ ‏נצרך ע"י
                ▼
┌──────────────────────────────────────────┐
│ settings/SettingsScreen.svelte  ← ‏משתנה   │
│   <SettingsCard><PalettePicker/></...>    │  ‏כרטיס חדש
└──────────────────────────────────────────┘

‏שכבת tokens (‏לא קומפוננטה):
┌──────────────────────────────────────────┐
│ app.css                          ← ‏משתנה  │
│   [data-palette="midnight|rose|             │  +4 ‏בלוקים
│    slate|daylight"] { --bg ... }          │
└──────────────────────────────────────────┘

‏שכבת core (‏מחרוזות):
┌──────────────────────────────────────────┐
│ core/i18n/keys.ts + catalogs/{he,en}.ts  │  +9 ‏מפתחות
│                                  ← ‏משתנה  │  (additive)
└──────────────────────────────────────────┘
```

---

## §4 — Commits ‏בסדר

### Commit 0 — tokens + Palette union (approach: manual)

**‏קבצים שמשתנים**:
- `packages/frontend/src/app.css` — ‏מוסיף 4 ‏בלוקי `[data-palette]` ‏מיד אחרי בלוק `teal` (‏אחרי שורה 96, ‏לפני `}` ‏של `@layer base`). ‏לא נוגע ב-`@theme` mapping (‏ה-tokens זהים בשם). `daylight` ‏כולל `color-scheme: light;` ‏כשורה ראשונה בבלוק (‏override ל-`dark` ‏ב-`:root`).
- `packages/frontend/src/lib/view-models/theme.svelte.ts` — ‏מרחיב את `Palette` union ‏ואת `PALETTES` ‏array. ‏לא נוגע ב-`DEFAULT_PALETTE` (‏נשאר `ember`).

**‏ערכי ה-tokens** (‏מבנה זהה ל-ember — ‏17 ‏משתנים):

```css
[data-palette="midnight"] {
  --bg:#0e1118; --bg-elev:#161b26; --bg-card:#1d2433;
  --fg:#e4e9f2; --fg-dim:#9aa6bf; --fg-muted:#65718a;
  --border:rgba(225,235,255,0.08); --border-str:rgba(225,235,255,0.16);
  --accent:#6b8afd; --accent-hi:#8aa3ff; --accent-soft:rgba(107,138,253,0.15);
  --bubble-user:#1b2440; --bubble-agent:#181f33;
  --recording:#ff5a5a; --thinking:#c98bff; --speaking:#5eead4;
}
[data-palette="rose"] {
  --bg:#171015; --bg-elev:#221820; --bg-card:#2c1f29;
  --fg:#f3e7ee; --fg-dim:#c0a6b3; --fg-muted:#856b78;
  --border:rgba(255,225,240,0.08); --border-str:rgba(255,225,240,0.16);
  --accent:#f472b6; --accent-hi:#fb8fc8; --accent-soft:rgba(244,114,182,0.15);
  --bubble-user:#2e1f2a; --bubble-agent:#261a2a;
  --recording:#ff5a5a; --thinking:#c98bff; --speaking:#f9a8d4;
}
[data-palette="slate"] {
  --bg:#101216; --bg-elev:#181b21; --bg-card:#20242c;
  --fg:#e6e9ee; --fg-dim:#a2a9b5; --fg-muted:#6b7280;
  --border:rgba(235,240,250,0.08); --border-str:rgba(235,240,250,0.16);
  --accent:#8aa0bd; --accent-hi:#a6b8d1; --accent-soft:rgba(138,160,189,0.15);
  --bubble-user:#232830; --bubble-agent:#1c2028;
  --recording:#ef6b6b; --thinking:#b0b8c4; --speaking:#8aa0bd;
}
[data-palette="daylight"] {
  color-scheme: light;
  --bg:#f6f4f0; --bg-elev:#fbfaf7; --bg-card:#ffffff;
  --fg:#1f1b16; --fg-dim:#5b554c; --fg-muted:#8a8276;
  --border:rgba(20,15,10,0.10); --border-str:rgba(20,15,10,0.18);
  --accent:#d2693f; --accent-hi:#b9572f; --accent-soft:rgba(210,105,63,0.14);
  --bubble-user:#efe7dd; --bubble-agent:#f1ece6;
  --recording:#e0453f; --thinking:#8b5cf6; --speaking:#c2772e;
}
```

**API skeleton** (`theme.svelte.ts` — ‏ה-diff המדויק; ‏executor אסור לשנות שמות):

```ts
export type Palette =
  | "ember" | "forest" | "plum" | "teal"
  | "midnight" | "rose" | "slate" | "daylight"

export const PALETTES: readonly Palette[] = [
  "ember", "forest", "plum", "teal",
  "midnight", "rose", "slate", "daylight",
]
```

**Verification**:

```bash
pnpm typecheck
pnpm --filter @drive-coding/frontend build
# manual: ‏ב-devtools, document.documentElement.dataset.palette = "daylight"
#         → ‏הרקע הופך בהיר, ‏הטקסט כהה, ‏ניגודיות תקינה.
#         ‏חזור על midnight/rose/slate.
```

### Commit 1 — i18n keys ‏לשמות הפלטות (approach: manual)

**‏קבצים שמשתנים** (‏כולם additive — ‏ר' parallel-safe-code.md):
- `packages/core/src/i18n/keys.ts` — ‏מוסיף 9 ‏מפתחות ל-union (‏ליד שאר `settings.*`).
- `packages/core/src/i18n/catalogs/he.ts` — ‏מוסיף 9 ‏ערכים.
- `packages/core/src/i18n/catalogs/en.ts` — ‏מוסיף 9 ‏ערכים.

**‏המפתחות** (‏9):

```
"settings.theme.label"
"settings.theme.ember"   "settings.theme.forest"  "settings.theme.plum"
"settings.theme.teal"    "settings.theme.midnight" "settings.theme.rose"
"settings.theme.slate"   "settings.theme.daylight"
```

**‏ערכי he** (‏דוגמה — ‏executor ממלא את כולם):
```
"settings.theme.label": "ערכת נושא",
"settings.theme.ember": "גחלת",  "settings.theme.forest": "יער",
"settings.theme.plum": "שזיף",   "settings.theme.teal": "טורקיז",
"settings.theme.midnight": "חצות", "settings.theme.rose": "ורד",
"settings.theme.slate": "צפחה",  "settings.theme.daylight": "אור יום",
```
**‏ערכי en**: `"Theme"`, `"Ember"`, `"Forest"`, `"Plum"`, `"Teal"`, `"Midnight"`, `"Rose"`, `"Slate"`, `"Daylight"`.

**Verification**:

```bash
pnpm typecheck      # ‏union מלא → ‏אם catalog חסר מפתח, ‏ts יתפוס
pnpm lint:i18n      # ‏אין מחרוזות עברית בקוד (‏רק ב-catalogs)
```

### Commit 2 — PalettePicker + ‏כרטיס ב-Settings (approach: manual + browser smoke)

**‏קבצים חדשים**:
- `packages/frontend/src/lib/components/settings/PalettePicker.svelte`

**‏קבצים שמשתנים**:
- `packages/frontend/src/lib/components/settings/SettingsScreen.svelte` — ‏מוסיף `import PalettePicker` + ‏`<SettingsCard title={t("settings.theme.label")}><PalettePicker/></SettingsCard>` (‏מיקום מוצע: ‏מתחת לכרטיס "‏שפת ממשק", ‏שורה ~71).

**‏API skeleton** (PalettePicker — ‏leaf component, ‏דפוס LanguageSelect):

```svelte
<script lang="ts">
import { getTheme, getI18n } from "$lib/context"
import { PALETTES, type Palette } from "$lib/view-models/theme.svelte"

const theme = getTheme()
const t = $derived(getI18n().t)

// ‏אימוג'י פר-פלטה (‏מ-#palette-bar ‏במוקאפ; ‏החדשות בעקביות)
const EMOJI: Record<Palette, string> = {
  ember: "🔥", forest: "🌲", plum: "🍇", teal: "🪸",
  midnight: "🌙", rose: "🌹", slate: "🪨", daylight: "☀️",
}
</script>

<div class="flex flex-wrap gap-2">
  {#each PALETTES as p (p)}
    <button
      onclick={() => theme.setPalette(p)}
      aria-pressed={theme.palette === p}
      class="px-3 py-1.5 rounded-full text-[13px] font-semibold border"
      style="..."
    >
      {EMOJI[p]} {t(`settings.theme.${p}`)}
    </button>
  {/each}
</div>
```

> ‏הכפתור הפעיל מסומן דרך `theme.palette === p` (‏רקע `var(--accent-soft)` + ‏border `var(--accent)`); ‏השאר `var(--bg-card)` + `var(--border)`. ‏הריאקטיביות עובדת כי `theme.palette` ‏הוא `$state` ‏ב-ThemeVM.

**Verification**:

```bash
pnpm typecheck
pnpm --filter @drive-coding/frontend dev
# manual (‏ר' DoD):
#  1. ‏פתח /settings → ‏כרטיס "‏ערכת נושא" ‏עם 8 ‏chips.
#  2. ‏לחץ "🌙 חצות" → ‏הצבעים משתנים מיידית, ‏ה-chip מסומן.
#  3. ‏רענן → ‏הבחירה שרדה (localStorage).
#  4. ‏לחץ "☀️ אור יום" → ‏ערכה בהירה, ‏וודא ניגודיות בכל המסך.
```

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | typecheck + build + tests | `pnpm typecheck && pnpm --filter @drive-coding/frontend build && pnpm test` |
| 2 | lint:i18n ‏עובר | `pnpm lint:i18n` |
| 3 | 8 ‏chips מוצגים ב-/settings | ‏פתח /settings, ‏ספור 8 ‏chips בכרטיס "‏ערכת נושא" |
| 4 | בחירה משנה צבע מיידית | ‏לחץ chip → ‏`document.documentElement.dataset.palette` ‏מתעדכן, ‏הרקע משתנה |
| 5 | בחירה שורדת רענון | ‏בחר `midnight`, ‏רענן → ‏עדיין midnight (localStorage `drive-coding.palette`) |
| 6 | `daylight` ‏ניגודיות תקינה | ‏עבור ל-daylight, ‏וודא טקסט קריא ב-Settings + Chat + bubbles + mic (‏אין טקסט בהיר על בהיר) |
| 7 | mobile + desktop | ‏screenshot של ‏הכרטיס ב-2 ‏viewports — ‏chips wrap תקין במובייל |
| 8 | regression: 4 ‏הפלטות הישנות | ‏לחץ ember/forest/plum/teal → ‏עדיין עובדות כרגיל |

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| Hardcoded Hebrew strings בקוד | README.md §6 ‏(‏3 ‏שתמיד נשכחים) | ‏שמות הפלטות **‏רק** ‏ב-catalogs; ‏הקומפוננטה משתמשת ‏ב-`t(...)`. ‏אימוג'י ‏מותר ‏בקוד (‏לא עברית). ‏`pnpm hooks:install` ‏אחרי worktree → ‏pre-commit חוסם. |
| `daylight` ‏ניגודיות — ‏אלמנטים עם צבע קשיח | ‏בדיקה ידנית | ‏ידוע: ‏`.mic-speak { color:#111 }` ‏(app.css:185) ‏תקין על בהיר; ‏`text-white` ‏על כפתור `var(--accent)` ‏(SettingsScreen:152) ‏תקין כי accent כהה ב-daylight. ‏DoD #6 ‏מאמת end-to-end. |
| `color-scheme: light` ‏לא נתפס | ‏CSS cascade | ‏הוא בתוך בלוק `[data-palette="daylight"]` ‏(specificity גבוה מ-`:root`) → ‏מנצח את ה-`dark` ‏הגלובלי. ‏executor: ‏וודא שהוא שורה ראשונה בבלוק. |
| Svelte 5 reactivity | README.md §6 | ‏`theme.palette` ‏הוא `$state` ‏scalar (‏לא array) — ‏אין gotcha של `.length`. ‏ה-`{#each PALETTES as p (p)}` ‏על קבוע, ‏לא משתנה. |
| OneCLI placeholder | README.md §6 | ‏**‏לא רלוונטי** — ‏אין SDK חיצוני בסבב. |
| `EMOJI` Record ‏לא ‏exhaustive | ‏strict TS | ‏`Record<Palette, string>` ‏→ ‏אם מוסיפים פלטה ל-union ‏בלי אימוג'י, ‏ts יתפוס ב-typecheck. ‏טוב — ‏הגנה מובנית. |

> ‏3 ‏שתמיד נשכחים — ‏נבדקו: i18n ✅ (‏catalogs), ‏reactivity ✅ (‏scalar $state), ‏OneCLI ✅ (‏לא רלוונטי).

---

## §7 — Escalation triggers

> ‏אם X — ‏עצור ושאל את מרדכי (‏planner) ‏ב-parent task:

- ‏בדיקת `daylight` ‏חושפת **‏יותר מ-2** ‏מקומות עם צבע קשיח (‏`#fff`/`text-white`/`#111`) ‏שנשברים על רקע בהיר → ‏ייתכן שצריך slice נפרד ל-light-mode audit, ‏לא תיקון נקודתי.
- ‏ה-`@theme` mapping ‏ב-app.css ‏(שורות 99–111) ‏מתגלה כחסר token ‏שהפלטות החדשות צריכות (‏לא צפוי — ‏כולן משתמשות באותם 17).
- ‏מבנה ה-i18n catalogs ‏שונה ‏ממה שה-brief מניח (‏object literal עם keys) — ‏עצור.
- ‏אתה רוצה לסטות מ-testing strategy ‏(‏כל ה-commits manual — ‏אין core logic ‏ל-TDD).

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|------|------|
| >5 files ‏ב->2 packages (7 ‏קבצים: frontend + core) | +1 |
| Refactor של קוד קיים (‏מינימלי — ‏הוספת import + ‏כרטיס) | +1 |
| Cross-store data flow / streaming / protocol / state-machine | 0 |
| ‏ספרייה חיצונית | 0 |
| Greenfield component (PalettePicker) | -1 ‏(‏לא מקזז מתחת ל-0) |

**Score**: **2 / 10**

**Tier**: 0-3 → `verifier-slice-light` ‏בלבד (= ‏כלב, Sonnet, mode: light).

**‏Verifier-phase ‏אחרי commit/phase**: ‏אין (‏אין phase מסוכן).

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | ‏לכלול את `daylight` (light) ‏כבר עכשיו, ‏או לדחות ל-slice נפרד? | ‏לכלול עכשיו — ‏ה-tokens משתמשים באותו מנגנון; ‏הסיכון מכוסה ב-DoD #6 + escalation. | ❌ |
| 2 | ‏להוסיף גם `carbon` (OLED שחור-מוחלט)? | ‏לא בסבב הזה — ‏מחוץ ל-scope (§2), slice עתידי. | ❌ |
| 3 | ‏האם אימוג'י בכל chip, ‏או צבע-נקודה (swatch) ‏במקום? | ‏אימוג'י — ‏עקבי עם ה-#palette-bar ‏במוקאפ, ‏זול יותר. | ❌ |
| 4 | ‏שמות עבריים לפלטות (גחלת/יער/...) ‏או לשמור אנגלית transliterated? | ‏עברית מתורגמת ‏ב-he, ‏אנגלית ב-en (‏דרך i18n). | ❌ |

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor ‏תוך כדי)

> ‏ה-executor מתעד פה כל סטייה ‏מה-brief ‏ולמה.

- ‏(‏אין עדיין)
