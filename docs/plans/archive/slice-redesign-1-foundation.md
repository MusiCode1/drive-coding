# Slice redesign-1 — Design System Foundation — תוכנית

> **תאריך**: 2026-06-01
> **סטטוס**: טיוטה
> **Complexity**: 5/10 (verifier: light)
> **תלות**: אין (depends_on: [])
> **base**: dev `80ba325`

---

## §0 — Pre-flight

### Worktree
```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-redesign-1-foundation -b slice-redesign-1-foundation dev
cd .worktrees/slice-redesign-1-foundation
pnpm install && pnpm hooks:install
```

### Run
- **BE** (אופציונלי לסבב הזה — אין נגיעה ב-BE): `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (port 4000)
- **FE**: `pnpm --filter @drive-coding/frontend-v2 dev` (port: OS-assigned, Vite מדפיס בהפעלה)
- **Typecheck**: `pnpm --filter @drive-coding/frontend-v2 typecheck`
- **Build**: `pnpm --filter @drive-coding/frontend-v2 build`
- **Tests**: `pnpm --filter @drive-coding/frontend-v2 test`
- **i18n lint**: `pnpm lint:i18n` (מריצים מ-root)

> ⚠️ **שם ה-package ב-`--filter` הוא `@drive-coding/frontend-v2`** (לא `frontend`), למרות שהתיקייה
> היא `packages/frontend/`. השם הפנימי ב-`package.json` נשאר `-v2` מאז ה-cutover. אל "תתקן" אותו.

### Browser
- Chrome רגיל מול ה-Vite URL שמודפס בהפעלה. אין צורך ב-linux-gui או טלפון.
- בדיקה ויזואלית עיקרית: ה-`/` (connect) וה-`/chat` עדיין נראים זהה למה שהיו (regression check),
  ובדיקת theme-switching ידנית דרך DevTools console (ראה DoD).

### OneCLI agent
- שם: `voice-acp`. **לא נדרש לסבב הזה** (אין קריאות proxy/TTS/STT). מצוין רק אם תרצה להריץ BE לבדיקת רגרסיה מלאה.

### Reading list
**must-read לפני** (אחרת תחליט החלטות שגויות):
- `dev/docs/plans/redesign-vnext.md` §1.1 (Tailwind מלא), §1.4 (4 פלטות), §3 (אילוצים). זה ה-spec.
- `dev/docs/plans/redesign-vnext-mockup.html` שורות 8–193 (כל בלוק ה-`<style type="text/tailwindcss">`).
  **זה מקור-האמת ל-tokens.** ה-`@layer base` עם 4 ה-`[data-palette]`, ה-`@theme`, ה-helpers.
- `packages/frontend/AGENTS.md` — חמשת חוקי הזהב + Parallel-safe.
- `dev/docs/conventions/parallel-safe-code.md` — לפני נגיעה ב-`+layout.svelte` / `app.css`.

**reference בזמן עבודה**:
- `dev/docs/decisions/voice-acp.md` — entry "redesign-1" (ייכתב ע"י מרדכי) לרציונל.
- Tailwind 4 SvelteKit setup: `@tailwindcss/vite` plugin **לפני** `sveltekit()` ב-vite.config; `@import "tailwindcss"` ב-app.css; `@reference "tailwindcss"` ב-`<style>` blocks שצריכים `theme()`.

---

## §1 — מטרה

אחרי הסבב הזה הפרויקט מצויד בתשתית עיצוב מלאה — Tailwind 4 פעיל, 4 פלטות צבע
(Ember/Forest/Plum/Teal) שמתחלפות דרך `data-palette` על `<html>` ונשמרות ב-localStorage,
וספריית אייקונים Lucide זמינה — **בלי לשנות אף מסך קיים**. ה-UI הנוכחי (`/`, `/chat`,
`/settings`) ממשיך להיראות ולעבוד בדיוק כמו לפני, כי ה-tokens החדשים מגדירים את אותם
שמות-משתנים (`--bg`, `--fg`, `--accent`...) שהקומפוננטות הקיימות כבר צורכות. זהו ה-gate
שכל ה-slices העיצוביים הבאים ייבנו עליו.

---

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| התקנת `tailwindcss` + `@tailwindcss/vite` + הפעלת ה-plugin | ✅ | כאן |
| העברת 4 הפלטות + `@theme` + helpers מהמוקאפ ל-`app.css` | ✅ | כאן |
| מנגנון theme-switching (ThemeVM + localStorage + `data-palette` על `<html>`) | ✅ | כאן |
| התקנת `@lucide/svelte` + קומפוננטה אחת "proof" שמרנדרת אייקון | ✅ | כאן |
| **כתיבה-מחדש של AppShell / Sidebar / RecordFooter / bubbles** | ❌ | slices redesign-2+ |
| **המרת הקומפוננטות הקיימות ל-Tailwind** (ChatInput, MicButton, bubbles...) | ❌ | כל אזור ב-slice ייעודי |
| **בורר פלטה ב-UI** (כפתורים גלויים למשתמש) | ❌ | redesign-4 (Settings) — ThemeVM כבר מוכן, רק חיווט UI |
| **החלפת אימוג'ים קיימים ל-Lucide** (tool-format.ts, ⚙️/🔊...) | ❌ | כל slice שנוגע באזור הרלוונטי |
| **component lib** (Bits UI / Melt — Sheet/Select/Dialog/Switch) | ❌ | **הכרעה מתוזמנת ל-redesign-3 (Settings)** — ה-slice הראשון שצריך Switch/Select. מרדכי יעצור וישאל את המשתמשת שם. המלצה מוקדמת: Bits UI. |
| נגיעה ב-BE / core / protocol | ❌ | — |

> **קו אדום ל-executor**: הסבב הזה הוא תשתית "שקופה". אם אתה מוצא את עצמך משנה
> markup של מסך קיים כדי ש"ייראה כמו המוקאפ" — עצור. זה לא הסבב הזה. ה-DoD דורש
> שהמסכים ייראו **זהה** לפני ואחרי (פרט להוספת theme-switching שקוף).

---

## §3 — Architecture diagram

```
routes/
  +layout.svelte        ← משתנה: import app.css (כבר קיים), יצירת ThemeVM + setTheme
  +layout.ts            (ללא שינוי)
components/
  (קיימות — ללא שינוי)
  AppIcon.svelte        ← חדש (proof-of-wiring ל-Lucide; wrapper דק אופציונלי)
view-models/
  theme.svelte.ts       ← חדש (ThemeVM: palette $state + persist + apply ל-<html>)
context.ts              ← משתנה (additive): setTheme/getTheme זוג חדש
engines/ adapters/      (ללא שינוי)

app.css                 ← נכתב מחדש: @import "tailwindcss" + 4 palettes + @theme + helpers
app.html                ← משתנה: data-palette התחלתי על <html> (anti-FOUC)
vite.config.ts          ← משתנה: tailwindcss() plugin לפני sveltekit()
package.json (frontend) ← משתנה: deps חדשים (tailwindcss, @tailwindcss/vite, @lucide/svelte)
```

**שכבות שנוגעים בהן**: view-models (ThemeVM — חדש), routes (`+layout` חיווט), components
(AppIcon — proof). אין engine/adapter חדש. ThemeVM הוא entity ("ערכת-הנושא הפעילה
חיה ללא תלות במסך") → עומד בחוק זהב #2.

---

## §4 — Commits בסדר

### Commit 1 — התקנת Tailwind 4 + העברת ה-tokens מהמוקאפ (approach: manual)

**קבצים שמשתנים**:
- `packages/frontend/package.json` — הוסף ל-`devDependencies`:
  - `"tailwindcss": "^4.0.0"`, `"@tailwindcss/vite": "^4.0.0"`
- `packages/frontend/vite.config.ts` — הוסף `import tailwindcss from "@tailwindcss/vite"`
  ו-`tailwindcss()` כ-plugin **ראשון** (לפני `sveltekit()`).
- `packages/frontend/src/app.css` — **נכתב מחדש לגמרי** (החלף את כל 63 השורות הקיימות):
  - שורה ראשונה: `@import "tailwindcss";`
  - העתק את בלוק ה-tokens מהמוקאפ (`redesign-vnext-mockup.html` שורות 13–148):
    - `@layer base { :root {...} }` עם `--radius`, `--font`, `color-scheme: dark`.
    - 4 בלוקי `[data-palette="..."]` (ember/forest/plum/teal) — **כפי שהם במוקאפ**.
    - בלוק `@theme { --color-bg: var(--bg); ... }` (שורות 101–113 במוקאפ).
    - `@layer base { html,body {...} .chat-scroll {...} keyframes ... }` (שורות 115–148).
    - בלוק `@layer components { .toggle {...} .mic-rec ... }` (שורות 150–192) —
      **אופציונלי בסבב הזה**: אפשר להעביר עכשיו (parallel-safe, מחכה ל-slices הבאים)
      או לדחות. אם מעבירים — להעביר ככתבו.
  - **חשוב ל-regression**: ודא ש-`--bg`, `--bg-elev`, `--fg`, `--fg-dim`, `--border`,
    `--accent`, `--accent-hi`, `--recording`, `--speaking` כולם מוגדרים תחת ה-`[data-palette]`
    הפעיל. הקומפוננטות הקיימות צורכות אותם דרך `var(--x)`. **המוקאפ לא מגדיר `--muted`** —
    ה-`app.css` הישן כן (שורה 7). **אומת: `--muted` בשימוש ב-3 מקומות** —
    `lib/components/chat/ChatInput.svelte:87`, `lib/components/chat/ChatBubbles.svelte:59`,
    `routes/+page.svelte:177`. לכן **חובה** להוסיף alias `--muted: var(--fg-muted)` ב-`app.css` החדש,
    אחרת רגרסיה. **הערה**: ה-alias מצביע על `--fg-muted` שמוגדר תחת כל `[data-palette]` (לא תחת
    `:root`) — זה תקין: custom properties נפתרים בזמן-שימוש לפי הפלטה הפעילה, לא בזמן-הגדרה.
    שים את ה-alias תחת `:root` (או תחת כל `[data-palette]` — שתי הדרכים עובדות).
- `packages/frontend/src/app.html` — הוסף `data-palette="ember"` ל-`<html lang="he" dir="rtl">`
  (anti-FOUC: הפלטה ההתחלתית נטענת לפני JS; ThemeVM ידרוס מ-localStorage ב-onMount).

**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 typecheck   # 0 errors
pnpm --filter @drive-coding/frontend-v2 build        # עובר (Tailwind מתקמפל)
grep -rn "var(--muted)" packages/frontend/src     # אם יש hits → ודא alias ב-app.css
pnpm --filter @drive-coding/frontend-v2 dev          # פתח בדפדפן — /chat נראה כמו קודם
```
בדיקה ידנית: `/` ו-`/chat` (אחרי connect) נראים **זהה** למה שהיו לפני Tailwind.

---

### Commit 2 — ThemeVM + theme-switching (approach: manual)

**קבצים חדשים**:
- `packages/frontend/src/lib/view-models/theme.svelte.ts`

**API skeleton**:
```ts
export type Palette = "ember" | "forest" | "plum" | "teal"

export const PALETTES: readonly Palette[] = ["ember", "forest", "plum", "teal"]

const STORAGE_KEY = "drive-coding.palette"
const DEFAULT_PALETTE: Palette = "ember"

export class ThemeVM {
  palette = $state<Palette>(DEFAULT_PALETTE)

  constructor() {
    // קריאה מ-localStorage (ב-browser בלבד; ה-FE כבר SPA-only עם ssr=false)
    const saved = this.#read()
    if (saved) this.palette = saved
    this.#apply()
  }

  setPalette(p: Palette): void {
    this.palette = p
    this.#persist(p)
    this.#apply()
  }

  #apply(): void {
    document.documentElement.dataset.palette = this.palette
  }

  #read(): Palette | undefined {
    try {
      const v = localStorage.getItem(STORAGE_KEY)
      return PALETTES.includes(v as Palette) ? (v as Palette) : undefined
    } catch { return undefined }
  }

  #persist(p: Palette): void {
    try { localStorage.setItem(STORAGE_KEY, p) } catch { /* ignore */ }
  }
}
```
> ה-executor **לא רשאי לשנות** את החתימות הציבוריות (`palette`, `setPalette`, `PALETTES`, `Palette`).
> שמות פרטיים (`#apply` וכו') — חופשי.

**קבצים שמשתנים** (additive בלבד — parallel-safe):
- `packages/frontend/src/lib/context.ts` — הוסף זוג חדש בסוף הקובץ. ה-context משתמש
  ב-`createContext` מ-`"svelte"` (לא `getContext`/`setContext` ידני). הוסף:
  - בבלוק הייבוא: `import type { ThemeVM } from "./view-models/theme.svelte"`
  - בלוק domain חדש בסוף: `// ─── theme ───` ואז
    `export const [getTheme, setTheme] = createContext<ThemeVM>()`
  - **אל תערוך בלוקים קיימים** — הוספה בסוף בלבד.
- `packages/frontend/src/routes/+layout.svelte` — בבלוק חדש `// ─── theme ───`:
  `const theme = new ThemeVM()` + `setTheme(theme)`. **רק הוספה**, לא שינוי בלוקים קיימים.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 dev
```
בדיקה ידנית ב-DevTools console (אחרי שהאפליקציה נטענה):
```js
// החלפת פלטה ידנית — ה-UI כולו אמור לשנות צבעים מיידית:
document.documentElement.dataset.palette = "forest"   // → ירוק/sage
document.documentElement.dataset.palette = "plum"     // → סגול
document.documentElement.dataset.palette = "ember"    // → נחושת
// בדיקת persistence (סימולציה של מה ש-setPalette עושה):
localStorage.setItem("drive-coding.palette", "teal"); location.reload()
// → אחרי reload, ה-UI טורקיז (ThemeVM קרא מ-localStorage ב-constructor)
```

---

### Commit 3 — Lucide proof-of-wiring (approach: manual)

**קבצים חדשים**:
- `packages/frontend/src/lib/components/AppIcon.svelte` — wrapper דק (אופציונלי אבל מומלץ
  כ-proof). אם נבחר wrapper, חתימה:

**API skeleton**:
```svelte
<script lang="ts">
  import type { Icon as IconType } from "@lucide/svelte"
  let { icon, size = 20, strokeWidth = 1.75, class: cls = "" }:
    { icon: typeof IconType; size?: number; strokeWidth?: number; class?: string } = $props()
  const Cmp = $derived(icon)
</script>
<Cmp {size} {strokeWidth} class={cls} />
```
> **אם ה-`Icon` type לא מיוצא כך ב-`@lucide/svelte@next`** — אל תילחם בטיפוס. fallback:
> ייבא אייקון בודד ישירות במקום ה-proof (ראה למטה) ודלג על ה-wrapper הגנרי. תעד בהודעת ה-commit.

**קבצים שמשתנים**:
- `packages/frontend/package.json` — הוסף ל-`dependencies` את `@lucide/svelte`. **אל תכתוב גרסה
  ידנית** — הרץ `pnpm --filter @drive-coding/frontend-v2 add @lucide/svelte@next` ותן ל-pnpm לפתור
  (נכון ל-2026-06: `@next` = 1.3.x; `latest` = 1.17.x). **לא** `lucide-svelte` הישן (0.x, ל-Svelte 4).
- **proof-of-render**: רנדר אייקון Lucide אחד במקום נראה-לעין-בבדיקה אך זמני, כדי לאמת
  שהbundle עובד. ההמלצה: רנדר זמנית ב-`/settings` route (`settings/+page.svelte`) — למשל
  אייקון `Settings` ליד הכותרת. **זה proof זמני** — מסומן בהערה `<!-- TODO redesign-4: -->`.
  - import per-icon (tree-shakable): `import Settings from "@lucide/svelte/icons/settings"`
  - **אל תהפוך את זה לקבוע** — redesign-4 יחליף את כל ה-/settings מהמוקאפ.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 add @lucide/svelte@next   # פותר גרסה
pnpm --filter @drive-coding/frontend-v2 typecheck                  # 0 errors
pnpm --filter @drive-coding/frontend-v2 build                      # האייקון נכלל ב-bundle
pnpm --filter @drive-coding/frontend-v2 dev                        # /settings מציג אייקון Lucide
```

---

## §5 — DoD

| בדיקה | איך |
|---|---|
| Tailwind מתקמפל | `pnpm --filter @drive-coding/frontend-v2 build` עובר ללא שגיאות |
| typecheck נקי | `pnpm --filter @drive-coding/frontend-v2 typecheck` → 0 errors |
| כל הטסטים הקיימים עוברים | `pnpm --filter @drive-coding/frontend-v2 test` → ירוק (אין רגרסיה) |
| i18n lint נקי | `pnpm lint:i18n` → אין מחרוזות עברית בקוד |
| `/chat` נראה זהה לפני/אחרי | בדיקה ויזואלית: connect → /chat. בועות, header, input — כמו קודם |
| 4 פלטות עובדות | DevTools: `document.documentElement.dataset.palette = "forest"/"plum"/"teal"/"ember"` → צבעים משתנים מיידית |
| persistence עובד | `localStorage.setItem("drive-coding.palette","teal"); location.reload()` → נטען טורקיז |
| anti-FOUC | טען עמוד נקי (localStorage ריק) → אין הבזק לבן; הפלטה ember מההתחלה (data-palette ב-app.html) |
| Lucide ב-bundle | `/settings` מציג אייקון Lucide (SVG, לא אימוג'י), build כולל אותו |
| ThemeVM ב-context | `getTheme()` זמין מ-context; `+layout.svelte` יוצר instance יחיד |
| parallel-safe | `+layout.svelte` ו-`context.ts` — שינוי additive בלבד (בלוק domain חדש, לא שינוי בקיים) |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| Tailwind 4 PostCSS vs Vite plugin בלבול | docs: v4 משתמש ב-`@tailwindcss/vite`, **לא** ב-postcss/`tailwind.config.js` | אין `tailwind.config.js` ואין `postcss.config`. רק `@tailwindcss/vite` + `@import "tailwindcss"`. config דרך `@theme` ב-CSS. |
| סדר plugins ב-vite | docs Tailwind+SvelteKit | `tailwindcss()` **לפני** `sveltekit()` ב-`plugins[]`. |
| `<style>` blocks ב-Svelte שצריכים `theme()`/`@apply` נשברים | Tailwind 4 Svelte gotcha | הסבב **לא ממיר** קומפוננטות קיימות → ה-`<style>` שלהן נשארות CSS גלם עם `var(--x)`. אם executor כן צריך `theme()` ב-`<style>` חדש — חובה `@reference "tailwindcss";` בראש הבלוק. |
| שבירת regression: token חסר ב-`app.css` החדש | המוקאפ לא מגדיר `--muted` שה-app.css הישן כן | Commit 1: `grep var(--muted)` → אם בשימוש, הוסף alias `--muted: var(--fg-muted)`. בדוק ידנית ש-/chat נראה זהה. |
| Lucide v0 (`lucide-svelte`) vs v1 (`@lucide/svelte`) | ה-FE הישן ב-main השתמש ב-v0; Svelte 5 דורש v1 | השתמש ב-`@lucide/svelte@next` בלבד. import per-icon: `@lucide/svelte/icons/<name>`. אל תעתיק את `Icon.svelte` הישן מ-main. |
| Hardcoded Hebrew | pre-commit hook | אין מחרוזות חדשות בסבב; אם AppIcon/proof צריך טקסט → `t(key)`. ThemeVM אין בו UI strings. |
| Svelte 5 reactivity על `$state` | learnings | `palette` הוא string scalar, לא array — אין בעיית reactivity. `dataset.palette` הוא side effect ב-method, לא ב-`$effect` (זה owner של ה-state, חוק זהב #4 ✓). |
| localStorage ב-SSR | SvelteKit | ה-FE כבר `ssr=false` (`+layout.ts`). ThemeVM constructor רץ בדפדפן בלבד. עדיין — `try/catch` סביב localStorage. |

---

## §7 — Escalation triggers

עצור ושאל את מרדכי ב-parent task אם:
- `@lucide/svelte@next` נכשל בהתקנה / לא מייצא `Icon` type / שובר את ה-build באופן שמרמז על
  אי-תאימות ל-Svelte 5 (לא רק טיפוס — build ממש נשבר).
- `@tailwindcss/vite` מתנגש עם `@sveltejs/adapter-static` או עם ה-Vite 6 הקיים.
- העברת ה-tokens מהמוקאפ שוברת מסך קיים בצורה שלא ניתנת לתיקון ב-alias פשוט
  (כלומר נדרש לשנות markup של קומפוננטה קיימת — זה כבר לא הסבב הזה).
- מתגלה שצריך component lib (Bits UI/Melt) כבר עכשיו ל-foundation — **לא אמור לקרות**,
  אבל אם כן: זו הכרעה פתוחה, עצור.
- ה-`@theme` של Tailwind 4 לא מייצר את ה-utility classes הצפויים (`bg-bg`, `text-fg`...) —
  ייתכן צורך בהתאמת שמות. תעד ושאל לפני המצאת מבנה אחר.

---

## §8 — Complexity score

**5/10 → verifier: light** (calev, mode: light)

חישוב:
- commits: 3 (נמוך) → 0
- שכבות חדשות: ThemeVM (view-model) + AppIcon (component) → 2 שכבות → +1
- APIs חיצוניים: Tailwind build-tooling + Lucide → +2
- streaming/async: אין → 0
- refactor state model: אין (additive בלבד) → 0
- protocol BE↔FE: אין → 0
- build-system migration (Tailwind) — לא בנוסחה אבל מעלה סיכון תצורה → +2

סה"כ ≈ 5. מתחת ל-8 → **light**. הסיכון העיקרי הוא תצורת build (Commit 1), לא לוגיקה —
לכן בדיקת runtime light (build עובר + 4 פלטות מתחלפות + regression ויזואלי) מספיקה.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | להעביר את בלוק `@layer components` (toggle/mic-rec...) מהמוקאפ כבר עכשיו? | כן — parallel-safe, חוסך עבודה ב-slices הבאים. אם מסבך את Commit 1, דחה. | ❌ |
| 2 | AppIcon wrapper גנרי או import-per-icon ישיר בכל מקום? | wrapper דק (DRY ל-strokeWidth/size קבועים). אם הטיפוס מסרב — import ישיר. | ❌ |
| 3 | proof של Lucide ב-/settings — להשאיר או להסיר בסוף הסבב? | להשאיר זמנית עם `TODO redesign-4`; redesign-4 יחליף ממילא. | ❌ |
| 4 | שם ה-storage key | `drive-coding.palette` | ❌ |
