# Slice branding-fe-env — הסרת `v2` מכותרת/localStorage + איחוד `FE_ENV` (dev/prod) — ‏בריף

> ‏**תאריך**: 2026-06-28
> ‏**סוג**: feature קטן / מיתוג (3 חלקים — D2: title · D3: FE_ENV unification · D4: localStorage migration)
> ‏**סטטוס**: טיוטה — ‏ממתין לאביגיל
> ‏**Complexity**: 5/10 (verifier: **calev light** + ‏בדיקת משתמשת: כותרת dev/prod + ‏שמירת הגדרות קיימות)
> ‏**Base**: branch `dev` (tip `bb0c8d3`)
> ‏**depends_on**: `[]` — ‏עצמאי מהשם (`@drive-coding/frontend-v2`). **‏לא** ‏כולל rename חבילה.
> ‏**מקור**: ‏חלק D ‏(D2+D3+D4) ‏של `slice-cache-headers-version.md` ‏המקורי, ‏אחרי שפיצלנו את A+B+C ל-`slice-cache-version.md`.
>
> ‏**מה **‏לא** ‏בסלייס הזה** (‏מתוך D ‏המקורי):
> - ‏**D1 — rename חבילה** `@drive-coding/frontend-v2` → `@drive-coding/frontend` = ‏`slice-frontend-rename-cutover.md` ‏(הקנוני).
> - ‏**D5 + D-publish** (metadata + guards ב-`build.mjs`) = slice **publish-prep** ‏נפרד שתלוי ב-rename ‏(מצמד לשם החבילה ‏ולסוכן-הפרסום).

---

## §1 — ‏מטרה

‏הבחנה ויזואלית מיידית בין הטאב של dev (staging) ‏לבין main (prod), ‏וניקוי שאריות `v2`:
- D2. ‏כותרת הדף בלי `v2` (fallback סטטי `drive-coding`).
- D3. ‏משתנה-אב יחיד `FE_ENV ∈ {dev,prod}` ‏גוזר sourcemap + ‏כותרת, ‏עם דריסה נקודתית (`FE_SOURCEMAP`/`FE_TITLE`).
  ‏ב-dev הכותרת `drive-coding dev`; ‏ב-prod `drive-coding`. **‏זה סוגר פער קיים**: ה-units ‏כבר מגדירים `FE_ENV=dev`
  ‏אבל `vite.config.ts` ‏עדיין קורא רק `FE_SOURCEMAP` → `FE_ENV` ‏כיום no-op.
- D4. ‏מפתח localStorage בלי `v2` ‏(`drive-coding-settings`) + ‏מיגרציה כדי לא לאבד הגדרות קיימות.

---

## §2 — Scope

| ‏פעולה | ‏כן/לא |
|------|------|
| D2: `app.html` title `drive-coding v2` → `drive-coding` (fallback סטטי) | ✅ |
| D3a: `vite.config.ts` — `isDev` מ-`FE_ENV`; sourcemap+title נגזרים, דריסה גוברת; `define.__APP_TITLE__` | ✅ |
| D3b: `app.d.ts` — הצהרת `const __APP_TITLE__: string` ב-`declare global` | ✅ |
| D3c: `+layout.svelte` — `<svelte:head><title>{__APP_TITLE__}</title></svelte:head>` (override דינמי) | ✅ |
| D4: `settings.svelte.ts` STORAGE_KEY → `drive-coding-settings` + מיגרציה מ-old key ב-`load()` | ✅ |
| D4: עדכון טסטים (`settings.test`, `settings.lastconfig.test`) + case-test מיגרציה | ✅ |
| **D1: rename חבילה** `frontend-v2`→`frontend` | ❌ `slice-frontend-rename-cutover.md` |
| **D5 + D-publish** (release metadata + build.mjs guards) | ❌ slice publish-prep (תלוי rename) |
| נגיעה ב-units חיים | ❌ (כבר מוגדר `FE_ENV=dev`; ה-deploy מרענן build בלבד — §פריסה) |
| שינוי policy CF Access / manifest / service-worker | ❌ |

---

## §3 — ‏עיצוב (‏מאומת מול הקוד החי, dev@bb0c8d3)

### D2 — ‏כותרת בלי `v2` (`packages/frontend/src/app.html`)

‏מאומת: ‏שורה 6 = `<title>drive-coding v2</title>`; ‏שורה 17 = `<meta name="apple-mobile-web-app-title" content="drive-coding">` (‏כבר בלי v2 — ‏לא נוגעים).

> ‏**קריטי — SPA טהור**: `+layout.ts` ‏מאומת `ssr=false` **‏וגם** `prerender=false` (‏שורות 4-5). ‏לכן `%sveltekit.head%`
> ‏ב-`index.html` ‏הסטטי נשאר ריק עד שה-JS רץ. **‏אל תסיר** ‏את ה-`<title>` ‏מ-`app.html` — ‏אחרת ה-HTML הראשוני יגיע בלי title.

‏שנה את שורה 6 ל: `<title>drive-coding</title>` (‏fallback סטטי, ‏בלי v2, ‏בלי flash-בלי-title). ‏ה-override הדינמי = D3c.

### D3 — ‏איחוד `FE_ENV` (`vite.config.ts` + `app.d.ts` + `+layout.svelte`)

**‏החלטת המשתמשת (2026-06-21)**: ‏לא דגל רביעי. ‏`FE_ENV ∈ {dev,prod}` ‏(ברירת מחדל `prod`) ‏קובע פרופיל;
‏כל הגדרה **‏נגזרת** ‏ממנו אלא אם הוגדר משתנה-דריסה ייעודי שאז **‏גובר**.

**(a) `vite.config.ts`** — ‏מאומת: `defineConfig({` ‏שורה 9, `build: {` ‏שורה 11, `sourcemap: process.env.FE_SOURCEMAP === "true"` ‏שורה 18, ‏**‏אין** `define:` ‏כיום.
‏הוסף **‏מעל** ‏`export default defineConfig({` (‏שורה 9):
```ts
const isDev = (process.env.FE_ENV ?? "prod") === "dev"   // משתנה-האב היחיד

// sourcemap: דריסה ספציפית גוברת (כולל כיבוי מפורש FE_SOURCEMAP=false), אחרת נגזר מהפרופיל.
const sourcemap =
  process.env.FE_SOURCEMAP !== undefined
    ? process.env.FE_SOURCEMAP === "true"
    : isDev

// כותרת: דריסה ב-FE_TITLE גוברת, אחרת נגזר מהפרופיל.
const appTitle = process.env.FE_TITLE ?? (isDev ? "drive-coding dev" : "drive-coding")
```
‏החלף בשורה 18 את `sourcemap: process.env.FE_SOURCEMAP === "true"` ב-`sourcemap,` (‏המשתנה המחושב).
‏הוסף בתוך ה-config של `defineConfig({...})` ‏בלוק:
```ts
define: {
  __APP_TITLE__: JSON.stringify(appTitle),
},
```
> ‏ה-`!== undefined` ‏מהותי: ‏מאפשר `FE_SOURCEMAP=false` ‏לכבות sourcemap גם ב-dev (‏דריסה דו-כיוונית).

**(b) `packages/frontend/src/app.d.ts`** — ‏מאומת: `declare global {` ‏שורה 1, `namespace App {}` ‏שורה 2. ‏הוסף בתוך `declare global`:
```ts
declare global {
  namespace App {}
  const __APP_TITLE__: string
}
```

**(c) `packages/frontend/src/routes/+layout.svelte`** — ‏מאומת: `</script>` ‏שורה 151. ‏הוסף **‏אחרי** ‏ה-`</script>` (‏בתחילת ה-markup):
```svelte
<svelte:head>
  <title>{__APP_TITLE__}</title>
</svelte:head>
```
‏(‏Vite `define` ‏מחליף את `__APP_TITLE__` ‏במחרוזת בזמן build; ‏ב-`vite dev` ‏זמין. ‏Svelte מעדכן את `document.title` ‏הקיים, ‏לא מוסיף `<title>` ‏כפול.)

> ‏**הערה (‏אביגיל 🟢)**: ‏ל-route `wake-word-test/+page.svelte:69` ‏יש `<svelte:head>` ‏עם title משלו — ‏override ‏ברמת-route, ‏**‏לא נוגעים בו**. ‏ה-`<svelte:head>` ‏ב-`+layout.svelte` ‏הוא ברירת-המחדל הגלובלית; ‏route שמגדיר title משלו גובר עליו במסך שלו (‏התנהגות תקינה).

> ‏**הערה — units חיים כבר מוכנים**: `voice-acp-dev.service` ‏החי כבר עם `Environment=FE_ENV=dev` (‏וה-repo unit כך), `voice-acp-main.service` ‏בלי `FE_ENV` (→ prod). ‏אז אחרי הסלייס הזה, ‏build על dev → ‏כותרת "drive-coding dev" + ‏sourcemaps; ‏על main → "drive-coding" ‏בלי. **‏אין צורך לערוך units.**

> ‏**פתק ל-Avigail**: ‏אמת ש-`vite.config.ts` ‏הוא `defineConfig` (‏שורה 9) ‏ושאין `define:` ‏קיים שנדרוס; ‏ש-`app.d.ts` ‏עם `declare global`; ‏ש-`+layout.svelte` ‏אין בו כבר `<svelte:head><title>`; ‏ש-`__APP_TITLE__` ‏לא בשימוש כבר במקום אחר.

### D4 — ‏מפתח localStorage בלי `v2` + ‏מיגרציה (`settings.svelte.ts`)

‏מאומת: `const STORAGE_KEY = "drive-coding-v2-settings"` ‏שורה 21; `function load()` ‏שורה 84; `localStorage.getItem(STORAGE_KEY)` ‏שורה 87; `setItem` ‏שורה 111.

‏שנה (‏שורה 21):
```ts
const STORAGE_KEY = "drive-coding-settings"          // new
const OLD_STORAGE_KEY = "drive-coding-v2-settings"   // migration fallback (להסרה בעתיד)
```
‏ב-`load()` (‏שורה ~87), ‏מיגרציה — ‏אם החדש ריק, ‏קרא חד-פעמית מהישן (‏ה-`save` ‏הבא [‏שורה 111] ‏כותב לחדש):
```ts
const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(OLD_STORAGE_KEY)
```
**‏טסטים** (‏מאומת — ‏שניהם עם literal `"drive-coding-v2-settings"`):
- `settings.test.svelte.ts:32` — ‏עדכן ל-`"drive-coding-settings"`.
- `settings.lastconfig.test.svelte.ts:23` — ‏עדכן ל-`"drive-coding-settings"`.
- ‏הוסף case-test: ‏כתיבה ל-old key → `load()` ‏טוען אותו (‏מיגרציה), ‏ו-`save` ‏עוקב כותב ל-new key.
  ‏**‏ב-case-test כתוב את ה-old key כ-literal** `"drive-coding-v2-settings"` (‏לא דרך `OLD_STORAGE_KEY`/`STORAGE_KEY` const) — ‏הטסט בודק התנהגות-מיגרציה, ‏לא את ערך הקבוע (‏אביגיל 🟢).

> ‏**פתק ל-Avigail**: ‏אמת ש-3 ‏הקבצים מחזיקים את ה-literal; ‏ש-`load()` ‏הוא הנקודה הנכונה; ‏שאין שימוש אחר ב-`STORAGE_KEY` ‏מחוץ ל-load/save.

---

## §4 — ‏שלבים בסדר

### Commit 1 — D2: title fallback
‏`app.html:6` → `<title>drive-coding</title>`. **Testing**: manual. **Verification**: `pnpm fe:build` ‏נקי; ‏ה-HTML הסטטי עם title `drive-coding`.

### Commit 2 — D3: FE_ENV unification (TDD-לא; build-driven)
‏`vite.config.ts` (isDev/sourcemap/appTitle/define) + `app.d.ts` (global) + `+layout.svelte` (svelte:head).
**Testing**: manual. **Verification**: `pnpm --filter @drive-coding/frontend-v2 typecheck` ‏נקי (`__APP_TITLE__` ‏מוכר);
`FE_ENV=dev pnpm fe:build` → `grep -r "drive-coding dev" build/` ‏מוצא; `pnpm fe:build` (‏ברירת מחדל prod) → "drive-coding" ‏בלבד.

### Commit 3 — D4: localStorage migration + tests
‏`settings.svelte.ts` (key + migration) + ‏2 ‏טסטים + case-test. **Testing**: tdd (case-test מיגרציה red→green).
**Verification**: `pnpm --filter @drive-coding/frontend-v2 test settings` ‏ירוק; `typecheck` ‏נקי.

### ‏פריסה (‏אחרי calev GO + ‏אישור משתמשת) — ‏זרימה מנותקת
‏אין עריכת units (FE_ENV ‏כבר שם). build טרי מזריק כותרת לפי FE_ENV:
```
git -C dev pull --ff-only
pnpm -C dev install
FE_ENV=dev pnpm -C dev fe:build         # build טרי — כותרת "drive-coding dev" (ה-unit ממילא מגדיר FE_ENV=dev ב-restart)
systemctl --user restart voice-acp-dev.service   # ExecStartPre --if-missing ידלג (build טרי); ה-FE_ENV מ-unit יחול בבנייה אם תקרה
# → בדיקת משתמשת: כותרת הטאב "drive-coding dev"; הגדרות קיימות נשמרו (מיגרציה)
```
> ‏**הערה**: ‏ב-restart, ‏ExecStartPre עם `--if-missing` ‏ידלג אם build קיים → ‏ה-build הטרי שבנינו ידנית (‏עם FE_ENV=dev) ‏הוא שיוגש. ‏זה תקין.

---

## §5 — ‏אסטרטגיית בדיקה

- **D2/D3** (manual): ‏טאב dev → ‏כותרת "drive-coding dev"; ‏טאב prod (main) → "drive-coding". ‏SHA/sourcemaps לפי פרופיל.
- **D4** (tdd): case-test — old key → ‏נטען; save → new key. ‏בדיקת משתמשת: ‏הגדרות קיימות (‏שנשמרו תחת v2-key) ‏נשמרות אחרי deploy.
- **runtime-gate (calev light)**: ‏כותרת נכונה פר-סביבה; ‏הגדרות קיימות לא אבדו; ‏typecheck/test ירוקים; ‏אין רגרסיה ב-settings.

---

## §6 — Definition of Done

1. `app.html` title = `drive-coding` (בלי v2).
2. `vite.config.ts`: `isDev` מ-`FE_ENV`; sourcemap+title נגזרים עם דריסה; `define.__APP_TITLE__`. `app.d.ts` global. `+layout.svelte` svelte:head.
3. `FE_ENV=dev` build → כותרת "drive-coding dev"; ברירת מחדל → "drive-coding". `FE_SOURCEMAP=false` דורס.
4. `settings.svelte.ts`: key = `drive-coding-settings` + מיגרציה מ-old; 2 טסטים מעודכנים + case-test מיגרציה ירוק.
5. `pnpm typecheck` + `pnpm --filter @drive-coding/frontend-v2 test` ירוקים (build-gate).
6. אומת חי על dev :4001 — כותרת + שמירת הגדרות; בדיקת משתמשת.

---

## §7 — ‏שאלות פתוחות

1. **sourcemaps על dev** — D3 ‏מדליק מחדש sourcemaps ב-dev (`isDev`→`sourcemap=true`). ‏רצוי ל-staging. ‏אם לא — ‏הוסף `FE_SOURCEMAP=false` ‏ל-unit dev. (‏ברירת מחדל: ‏להדליק.)

---

## §8 — Complexity

| ‏גורם | ‏ניקוד |
|------|------|
| ‏היקף (app.html, vite.config, app.d.ts, +layout.svelte, settings + 2 טסטים) | 2 |
| ‏סיכון (מיגרציית localStorage — ‏אובדן הגדרות אם שגוי; build-time define) | 2 |
| ‏אינטגרציה (build-time inject + client title + persistence) | 1 |
| **‏סה"כ** | **5/10 → calev light (mode: light)** |

---

## §9 — ‏סיכונים

- **‏אובדן הגדרות משתמשת קיימות** (key rename) — ‏ממותן: ‏מיגרציה ב-`load()` + case-test חובה.
- **‏הסרת `<title>` ‏מ-`app.html` תשבור HTML ראשוני** (SPA, head ריק) — ‏ממותן: ‏משאירים fallback סטטי, ‏רק מורידים v2.
- **`FE_ENV` ‏לא חל** — ‏ממותן: D3a ‏סוגר את הפער (vite.config קורא FE_ENV); ‏ה-units כבר מגדירים אותו.
- **`define` ‏מתנגש עם define קיים** — ‏מאומת: ‏אין `define:` ‏ב-vite.config כיום (‏הוספה, ‏לא דריסה).
- **דליפת "dev" ‏לכותרת prod** — ‏ממותן: main בלי `FE_ENV` → ‏ברירת מחדל prod → "drive-coding".
