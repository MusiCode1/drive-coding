# Slice app-title-build-env — כותרת-אפליקציה דינמית + שלושה פרופילי-בילד (dev/preview/prod) — תוכנית

> **תאריך**: 2026-07-03 · **עדכון r1→fix**: 2026-07-03 (אביגיל USABLE-AFTER-FIX → תוקן; ר' הערת-אימות)
> **סטטוס**: ✅ מאושר (אביגיל r2 READY, 2×🟢 קוסמטי — 2026-07-03) · ready ל-dispatch
> **Complexity**: 6/10 (verifier: light — אך חובה לבנות את **שלושת** המצבים ולבדוק כותרת+source-maps בכל אחד)
> **תלות (depends_on)**: `[]` — עצמאי. נוגע ב-`packages/frontend/package.json` (scripts, **לא** name) כמו `slice-frontend-rename-cutover` (name) → אזורים שונים, additive. **סדר מומלץ: אחרי מיזוג rename** (base=dev עדכני), אך לא חוסם.
> **Base**: `dev` HEAD `c5deb8f`.

> **⚠️ הערת אימות (2026-07-03) — שינוי-מנגנון מהותי אחרי אביגיל r1**:
> אביגיל אימתה את כל 8 הטענות העובדתיות כ**נכונות** (אין blocker), אך סימנה (finding 4) שה-crux — הזרקת-כותרת דרך `transformIndexHtml` + `define` תחת SvelteKit — **לא-מאומת ומסוכן**. מרדכי בדק את SvelteKit 2.60.1 המותקן ומצא: `transformIndexHtml` **אינו** מובטח על `app.html`, אבל **`%sveltekit.env.PUBLIC_*%` כן נתמך נייטיבית** (`@sveltejs/kit/src/core/config/index.js:33-35`). לכן **המנגנון הוחלף**:
> - **HTML מיָדי**: `<title>%sveltekit.env.PUBLIC_APP_TITLE%</title>` (SvelteKit מחליף ב-build) — במקום vite plugin.
> - **runtime**: `import { env } from "$env/dynamic/public"` → `env.PUBLIC_APP_TITLE` — במקום `define`/`__APP_TITLE_BASE__` (לכן **אין** שינוי ב-`app.d.ts`).
> - `PUBLIC_APP_TITLE` נגזר מ-`FE_ENV` ב-`vite.config.ts` (מציב `process.env.PUBLIC_APP_TITLE` לפני ש-SvelteKit קורא env). fallback אם לא זולג: הצבה מפורשת ב-build scripts. **Commit 1 מתחיל באימות-מוקדם** של המנגנון (ר' §4).

> **תיקוני-מיקרו נוספים (אביגיל r1)**: base `1eab8ce`→`c5deb8f` (finding 2) · הפניית `+layout.svelte` 118-128→**125-135** (finding 5) · `SessionOptionsPanel.svelte` השורה `import { page } from "$app/state"` היא `:24` (finding 6) · **אין טסט-שלמות-קטלוגים** he/en — השלמות נאכפת דרך TS (`MessageKey` union) → ה-verify מסתמך על `typecheck`, לא על `core test` (finding 3) · פקודות build ב-DoD name-agnostic (finding 1 — ר' §0).

---

## §0 — Pre-flight

### רקע — חצי מהתשתית כבר קיימת אך מנותקת
- `FE_ENV` **כבר מוגדר** ב-`deploy/systemd/voice-acp-dev.service:15` (`FE_ENV=dev`); `voice-acp-main.service` משאיר ריק (→ prod).
- **הפער** (מתועד ב-`docs/decisions/drive-coding.md:501-502`): `vite.config.ts:18` עדיין קורא `FE_SOURCEMAP`, **לא** `FE_ENV` → כלומר `FE_ENV=dev` היום **לא עושה כלום**. סלייס זה סוגר את הפער ("D3a") ומרחיב מ-2 מצבים ל-**3** (dev/preview/prod).
- הכותרת היום: `app.html:6` = `<title>drive-coding v2</title>` **סטטית**. אין `<svelte:head><title>` דינמי בשום route (רק `wake-word-test`). כותרת-הסשן כבר קיימת ב-`session.sessionTitle` (מוצגת ב-`AppHeader`, לא בכותרת-הדפדפן).
- `FE_ENV` כבר **זולג אוטומטית** ל-vite דרך `scripts/dc-build-fe.mjs:80` (`env: { ...process.env, FE_BUILD_OUT }`) — כשה-unit מגדיר אותו הוא מגיע ל-build. **אין צורך לגעת ב-dc-build-fe.mjs.**

### עקרון-העל של הפיצ'ר (קראו לפני קוד)
1. **כותרת קשיחה ב-HTML** שנטענת **מיד** (לפני JS) — כוללת כבר את ה-badge: `Drive Coding Dev` / `Drive Coding Preview` / `Drive Coding`. ה-badge תלוי-בילד → מוזרק ב-build-time דרך **placeholder נייטיבי של SvelteKit** `%sveltekit.env.PUBLIC_APP_TITLE%` (לא vite plugin — ר' הערת-אימות).
2. **כותרת ריאקטיבית ב-runtime** מחליפה אותה לפי ההקשר: `<base> • <context>`, כאשר `<base>` = `env.PUBLIC_APP_TITLE` מ-`$env/dynamic/public` (אותו ערך שנצרב ל-HTML — מקור-אמת יחיד = `PUBLIC_APP_TITLE` שנגזר מ-`FE_ENV` ב-`vite.config.ts`), ו-`<context>` = כותרת-סשן / "הגדרות" / "סשנים".

### Worktree
```bash
git worktree add .worktrees/app-title-build-env -b slice/app-title-build-env dev
cd .worktrees/app-title-build-env
pnpm install && pnpm hooks:install
```

### Run / Verify (ליבת ה-slice — build-time, לא רק typecheck)
```bash
# בונים את שלושת המצבים ובודקים את הכותרת ב-index.html שנוצר + נוכחות/היעדר .map:
pnpm --filter @drive-coding/frontend build:dev      # → build/index.html <title>Drive Coding Dev</title>  + *.map קיימים
pnpm --filter @drive-coding/frontend build:preview  # → <title>Drive Coding Preview</title>                + *.map קיימים
pnpm --filter @drive-coding/frontend build:prod     # → <title>Drive Coding</title>                        + אין *.map
```
> אם שם החבילה עדיין `@drive-coding/frontend-v2` (rename טרם מוזג) — השתמשו ב-`--filter @drive-coding/frontend-v2`. ה-scripts שמתווספים הם **תוך-חבילתיים** (`vite build`), עמידים לשם.

### Browser (ל-verifier — smoke ידני)
- הרצת preview מקומית: `cd packages/backend && FE_STATIC_DIR=<worktree>/packages/frontend/build PORT=4002 bun src/server.ts` → `http://localhost:4002`.
- לבדוק: כותרת-הטאב מיד בטעינה = `Drive Coding <badge>`; אחרי כניסה ל-`/chat` עם סשן בעל-כותרת → `... • <כותרת>`; ב-`/settings` → `... • הגדרות`.

### OneCLI
- **לא דרוש** — אין נגיעת proxy/TTS. build+title בלבד.

### Reading list
**must-read לפני**:
- `packages/frontend/vite.config.ts` (כל הקובץ — 29 שורות).
- `packages/frontend/src/app.html` (שורה 6 — הכותרת הסטטית).
- `packages/frontend/src/routes/+layout.svelte` §"dir/lang sync" (שורות **125-135** — דפוס $effect שקורא i18n.locale; באזור הזה יתווסף ה-`<svelte:head>`).
- `docs/decisions/drive-coding.md:484-509` (הרציונל של פיצול-המיתוג + הפער FE_ENV/FE_SOURCEMAP).

**reference**:
- `deploy/systemd/voice-acp-dev.service` + `voice-acp-main.service` (איפה FE_ENV מוגדר).
- `packages/core/src/i18n/keys.ts` + `catalogs/{he,en}.ts` (הוספת מפתחות).

---

## §1 — מטרה

אחרי הסלייס: כותרת-הטאב מזהה **מיד** את הסביבה שאתה מסתכל עליה — `Drive Coding Dev` (בילד-דב), `Drive Coding Preview` (staging), או `Drive Coding` (prod) — כך שכשפתוחים כמה טאבים אי-אפשר להתבלבל. ברגע שנכנסים לסשן/הגדרות הכותרת מתעדכנת ל-`Drive Coding <badge> • <הקשר>`. במקביל, קיימים שלושה פרופילי-בילד אמיתיים: dev+preview עם source-maps (דיבוג), prod בלעדיהם (bundle נקי לפרסום).

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| `FE_ENV` ∈ {dev,preview,prod} מחווט ל-`vite.config.ts` (badge + source-maps) | ✅ | Commit 1 |
| `%sveltekit.env.PUBLIC_APP_TITLE%` ב-app.html — הזרקת `<title>` נייטיבית בזמן build | ✅ | Commit 1 |
| `$env/dynamic/public` → צריכת ה-base-title ב-runtime | ✅ | Commit 3 |
| override מפורש: `FE_TITLE` (base) + `FE_SOURCEMAP` (source-maps) גוברים על FE_ENV | ✅ | Commit 1 |
| scripts `build:dev` / `build:preview` / `build:prod` + `cross-env` | ✅ | Commit 2 |
| כותרת ריאקטיבית `<svelte:head>` ב-`+layout` (route+session aware) | ✅ | Commit 3 |
| מפתחות i18n `appTitle.settings` / `appTitle.sessions` (he+en) | ✅ | Commit 3 |
| סנכרון units systemd (`FE_ENV=preview` ל-staging) + docs | ✅ | Commit 4 |
| שינוי `STORAGE_KEY = "drive-coding-v2-settings"` (localStorage) | ❌ | **מחוץ ל-scope** — מיגרציה מסכנת אובדן-הגדרות; המשתמשת לא ביקשה. ר' §9 Q4 |
| סימן "דורש-תשומת-לב" בטאב כשמסיים | ❌ | slice נפרד `tab-attention-notify` (depends_on=[זה]) |
| rename שם-החבילה `@drive-coding/frontend` | ❌ | `slice-frontend-rename-cutover` (עצמאי) |
| כותרת auto-generate לסשן (`generate_session_title`) | ❌ | future — אנו משתמשים ב-`session.sessionTitle` הקיים בלבד |

## §3 — Architecture diagram

```
build-time (Node, vite.config.ts — מורץ לפני SvelteKit plugin)
  process.env.FE_ENV ─┐
                      ├─► feEnv ─► badge (" Dev"/" Preview"/"")
  process.env.FE_TITLE┘          └─► BASE_TITLE = FE_TITLE ?? `Drive Coding${badge}`
  process.env.FE_SOURCEMAP ─────► sourcemap = FE_SOURCEMAP ?? (feEnv !== "prod")
                      │                     │
                      ▼                     ▼
   process.env.PUBLIC_APP_TITLE = BASE_TITLE   build.sourcemap (source maps)
   (מוצב ב-vite.config; SvelteKit קורא env → זמין לשני הצרכנים)   ← חדש
     ┌──────────────────────────────┴─────────────────────┐
     ▼ (SvelteKit env-substitution ב-build)                ▼ ($env/dynamic/public)
 app.html: <title>%sveltekit.env.PUBLIC_APP_TITLE%</title>   +layout.svelte
   → נצרב ל-index.html (טעינה מיָדית, לפני JS)  ← חדש          import { env } from "$env/dynamic/public"
                                                              base = env.PUBLIC_APP_TITLE
runtime (Svelte)                                              $derived docTitle = base + (ctx ? " • "+ctx : "")
                                                              ctx: /settings→t(appTitle.settings) ·
                                                                   /→t(appTitle.sessions) · /chat→session.sessionTitle
                                                              <svelte:head><title>{docTitle}</title></svelte:head>  ← חדש
```
> שכבה: זו **glue/config** (imperative shell + composition root). אין core-logic חדש → **לא TDD** (ר' §8). מקור-אמת אחד ל-base-title: `PUBLIC_APP_TITLE` (נגזר מ-FE_ENV ב-`vite.config.ts`); ה-HTML (דרך `%sveltekit.env%`) וה-runtime (דרך `$env/dynamic/public`) **שניהם** קוראים את אותו env-var — לא יכולים לסטות.

## §4 — Commits

### Commit 1 — חיווט FE_ENV ב-vite.config + placeholder כותרת ב-app.html (approach: manual)

> **⚠️ שלב-0 של Commit 1 — אימות-מנגנון מוקדם (5 דק', לפני כל השאר)**: לפני שכותבים את שאר הסלייס, אמת שהמנגנון עובד. הוסף `<title>%sveltekit.env.PUBLIC_APP_TITLE%</title>` ל-app.html + `process.env.PUBLIC_APP_TITLE = "TEST123"` בראש vite.config, הרץ build, וּודא ש-`grep TEST123 build/index.html` מוצא. **אם לא נצרב** → ה-fallback: הצב `PUBLIC_APP_TITLE` ישירות ב-build scripts (Commit 2) במקום ב-vite.config, והמשך. **אם גם זה לא** → escalate (ר' §7). SvelteKit 2.60.1 תומך ב-placeholder (אומת בקוד ע"י מרדכי) — סביר שיעבוד; זהו gate ליתר-ביטחון.

**קבצים שמשתנים**:
- `packages/frontend/vite.config.ts` — חישוב FE_ENV → BASE_TITLE + sourcemap, והצבת `PUBLIC_APP_TITLE` ל-env כדי ש-SvelteKit יזריק אותו. שלד:
```ts
type FeEnv = "dev" | "preview" | "prod"
const FE_ENV = (process.env.FE_ENV ?? "prod") as FeEnv
const BADGES: Record<FeEnv, string> = { dev: " Dev", preview: " Preview", prod: "" }
// base-title: FE_TITLE override גובר; אחרת "Drive Coding" + badge לפי הסביבה.
const BASE_TITLE = process.env.FE_TITLE ?? `Drive Coding${BADGES[FE_ENV] ?? ""}`
// חושפים ל-SvelteKit דרך env-var בעל prefix PUBLIC_ (נצרך גם ב-app.html וגם ב-runtime).
// מוצב כאן (top-level של vite.config) — רץ לפני ש-SvelteKit-plugin קורא env.
process.env.PUBLIC_APP_TITLE = BASE_TITLE
// source-maps: FE_SOURCEMAP מפורש גובר; אחרת ON לכל מצב שאינו prod.
const SOURCEMAP =
  process.env.FE_SOURCEMAP != null ? process.env.FE_SOURCEMAP === "true" : FE_ENV !== "prod"

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],   // ← אין plugin חדש
  build: { sourcemap: SOURCEMAP },
  server: { /* ללא שינוי — allowedHosts/proxy כפי שהם */ },
})
```
  > **אין** `define` ו**אין** שינוי ב-`app.d.ts` — ה-runtime צורך את הערך דרך `$env/dynamic/public` (Commit 3), לא דרך global מוזרק.
- `packages/frontend/src/app.html:6` — `<title>drive-coding v2</title>` → `<title>%sveltekit.env.PUBLIC_APP_TITLE%</title>` (SvelteKit מחליף ב-build; אם ה-var חסר → מחרוזת ריקה, לכן ה-build scripts תמיד מציבים אותו).

**Verification**:
```bash
# name-agnostic: אם החבילה עדיין -v2, החלף frontend→frontend-v2 ב-filter.
FE_ENV=dev     pnpm --filter @drive-coding/frontend build && grep -o '<title>[^<]*</title>' packages/frontend/build/index.html   # Drive Coding Dev
FE_ENV=preview pnpm --filter @drive-coding/frontend build && grep -o '<title>[^<]*</title>' packages/frontend/build/index.html   # Drive Coding Preview
FE_ENV=prod    pnpm --filter @drive-coding/frontend build && grep -o '<title>[^<]*</title>' packages/frontend/build/index.html   # Drive Coding
ls packages/frontend/build/_app/immutable/**/*.map >/dev/null 2>&1 && echo "prod: יש map (רגרסיה!)" || echo "prod: אין map ✓"
pnpm --filter @drive-coding/frontend typecheck
```

### Commit 2 — build scripts + cross-env (approach: manual)

**קבצים שמשתנים**:
- `packages/frontend/package.json` — הוספת scripts (מתחת ל-`"build": "vite build"` הקיים):
```jsonc
"build:dev": "cross-env FE_ENV=dev vite build",
"build:preview": "cross-env FE_ENV=preview vite build",
"build:prod": "cross-env FE_ENV=prod vite build",
```
  + הוספת `"cross-env": "^7.0.3"` ל-`devDependencies` (cross-platform env — Windows cmd לא תומך ב-`VAR=x cmd`).
  > **`"build"` הקיים נשאר `vite build`** — ברירת-מחדל prod (FE_ENV unset → "prod"). `build:prod` הוא alias מפורש.
- (אין שינוי ב-`svelte.config.js` — appVersion לא מושפע.)

**Verification**:
```bash
cd .worktrees/app-title-build-env && pnpm install    # cross-env נמשך; בדקו git diff pnpm-lock.yaml — תוספת cross-env בלבד
pnpm --filter @drive-coding/frontend build:preview && grep -o '<title>[^<]*</title>' packages/frontend/build/index.html  # Drive Coding Preview (עובד גם ב-Windows)
```

### Commit 3 — כותרת ריאקטיבית ב-layout + i18n (approach: manual)

**קבצים שמשתנים**:
- `packages/frontend/src/routes/+layout.svelte` — הוספת import ל-`page` מ-`$app/state`, `$derived` לכותרת, ו-`<svelte:head>`. `session` ו-`i18n` כבר קיימים בקובץ (VMs מקומיים). שלד:
```svelte
import { page } from "$app/state"
import { env } from "$env/dynamic/public"
// ... (i18n, session כבר מוגדרים למעלה)
// base מ-env; fallback "Drive Coding" אם ה-var חסר (dev-server בלי FE_ENV).
const baseTitle = env.PUBLIC_APP_TITLE || "Drive Coding"
const titleContext = $derived.by(() => {
  const p = page.url.pathname
  if (p.startsWith("/settings")) return i18n.t("appTitle.settings")
  if (p.startsWith("/chat")) return session.sessionTitle?.trim() || null
  if (p === "/") return i18n.t("appTitle.sessions")
  return null
})
const docTitle = $derived(
  titleContext ? `${baseTitle} • ${titleContext}` : baseTitle
)
```
> `$env/dynamic/public` תקין ב-adapter-static (הערכים נצרבים ל-bundle ב-build). אם ה-executor נתקל ב-`$env/dynamic/public` לא-נתמך ב-prerender — לעבור ל-`$env/static/public` (`import { PUBLIC_APP_TITLE } from "$env/static/public"`), inline ב-build. שתי הצורות נייטיביות ל-SvelteKit.
```svelte
<svelte:head>
  <title>{docTitle}</title>
</svelte:head>

{@render children?.()}
```
- `packages/core/src/i18n/keys.ts` — הוספת שני מפתחות ל-registry: `"appTitle.settings"`, `"appTitle.sessions"`.
- `packages/core/src/i18n/catalogs/he.ts` — `"appTitle.settings": "הגדרות"`, `"appTitle.sessions": "סשנים"`.
- `packages/core/src/i18n/catalogs/en.ts` — `"appTitle.settings": "Settings"`, `"appTitle.sessions": "Sessions"`.

**Verification**:
```bash
pnpm --filter @drive-coding/core build && pnpm --filter @drive-coding/frontend typecheck   # מפתחות מוכרים; MessageKey union אוכף ששני הקטלוגים כוללים את המפתח (זו בדיקת-השלמות — אין טסט ייעודי he/en, אביגיל r1 #3)
# smoke ידני (ר' §0 Browser): /settings → "... • הגדרות" ; /chat עם סשן → "... • <כותרת>"
```

### Commit 4 — סנכרון systemd + docs (approach: manual)

**קבצים שמשתנים**:
- `deploy/systemd/voice-acp-dev.service:11-15` — עדכון ההערה + `FE_ENV=dev` → **`FE_ENV=preview`** (ה-staging הוא "preview"; ה-`vite dev` המקומי הוא "dev" האמיתי). ההערה תתאר: badge "Preview" + source-maps ON.
- `deploy/systemd/voice-acp-main.service:11-12` — עדכון ההערה בלבד (נשאר בלי FE_ENV → prod: כותרת נקייה, בלי source-maps).
- `docs/running-locally.md` — סעיף על שלושת פרופילי-הבילד (`build:dev/preview/prod`) + מה כל אחד מזריק (badge + source-maps) + ה-overrides (`FE_TITLE`/`FE_SOURCEMAP`).
- `docs/decisions/drive-coding.md` — **מרדכי** כותב entry (לא ה-executor). ה-executor **לא** נוגע כאן.

> **הערה ל-executor**: אל תיגע ב-`docs/decisions/drive-coding.md` — זה יומן-מרדכי.

**Verification**:
```bash
grep -n 'FE_ENV' deploy/systemd/voice-acp-dev.service   # FE_ENV=preview
pnpm lint:i18n   # docs — לא אמור להישבר
```

## §5 — DoD

| בדיקה | איך |
|---|---|
| `build:dev` → `<title>Drive Coding Dev</title>` | build + `grep <title> build/index.html` |
| `build:preview` → `<title>Drive Coding Preview</title>` | build + grep |
| `build:prod` (ו-`build` סתם) → `<title>Drive Coding</title>` | build + grep |
| dev+preview מייצרים `*.map`; prod **לא** | `ls build/_app/immutable/**/*.map` בכל מצב |
| `FE_TITLE=X` גובר על ה-badge; `FE_SOURCEMAP=false` מכבה map גם ב-dev | `FE_ENV=dev FE_TITLE=Foo FE_SOURCEMAP=false pnpm ... build` + grep + ls |
| כותרת קשיחה נטענת מיד (לפני JS) עם ה-badge | code review: ה-`<title>` ב-build/index.html מכיל את הטקסט המחושב (`Drive Coding Dev`), **לא** את ה-placeholder `%sveltekit.env...%` |
| runtime: `/settings` → `... • הגדרות`, `/chat`+סשן → `... • <כותרת>`, `/` → `... • סשנים` | smoke ידני בדפדפן (preview על 4002) |
| `env.PUBLIC_APP_TITLE` זמין ל-runtime (הכותרת אינה "undefined • ...") | typecheck ירוק + smoke |
| קטלוגי he+en מכילים את 2 המפתחות; אין key חסר | `pnpm --filter @drive-coding/core test` (אם קיים טסט-שלמות) + typecheck |
| `pnpm lint:i18n` נקי (אין מחרוזת עברית קשיחה בקוד — "הגדרות"/"סשנים" רק בקטלוג) | הפקודה |
| units: dev=`FE_ENV=preview`, main ללא | grep |

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| `FE_ENV=dev` שוב "לא עושה כלום" (placeholder לא נצרב / env לא זולג) | הפער ההיסטורי (decisions:501) | **שלב-0 של Commit 1 = אימות-מנגנון מוקדם** (TEST123); ה-DoD **בונה בפועל** ו-grep-ים את ה-`<title>` בכל מצב — לא מסתמך על typecheck |
| `%sveltekit.env.PUBLIC_APP_TITLE%` לא מוחלף / `process.env` לא זולג ל-SvelteKit | crux (אביגיל r1 #4) | SvelteKit 2.60.1 תומך (אומת בקוד ע"י מרדכי, `config/index.js:33`); **fallback**: הצבת `PUBLIC_APP_TITLE` ב-build scripts במקום vite.config → escalate רק אם גם זה נכשל (§7) |
| מחרוזת עברית קשיחה בקוד ("הגדרות"/"סשנים") → pre-commit hook חוסם | learnings — gotcha #1 | המחרוזות **רק** בקטלוג `he.ts` (מותר); בקוד רק `t("appTitle.…")` |
| `env.PUBLIC_APP_TITLE` ריק ב-dev-server (בלי FE_ENV) → כותרת ריקה | טבע $env | fallback `|| "Drive Coding"` ב-Commit 3 + הצבה תמידית ב-build scripts (Commit 2) |
| Windows: `FE_ENV=x vite build` נכשל ב-cmd | pnpm scripts רצים דרך cmd ב-Windows | `cross-env` (Commit 2); ה-DoD מריץ `build:preview` שהוא cross-env |
| `page` מ-`$app/state` לא ריאקטיבי / import שגוי | SvelteKit 2 API | הדפוס כבר בשימוש ב-`src/lib/components/layout/SessionOptionsPanel.svelte:24` (`import { page } from "$app/state"`) — להעתיק |
| `<svelte:head>` כפול (layout + wake-word-test) → last-wins לא צפוי | SvelteKit dedupe | `wake-word-test` הוא route-דיבוג מבודד; ה-layout title תקף לכל שאר ה-routes. לא-חוסם |
| flash: HTML="Drive Coding Dev" → runtime מוסיף " • …" | טבעי (התנהגות רצויה) | לא באג — זה בדיוק ה-flow שהמשתמשת ביקשה ("קשיח מיד, קוד מחליף") |
| `pnpm-lock.yaml` drift מעבר ל-cross-env | learnings (pnpm) | לא מריצים `pnpm update`; רק `pnpm install`. DoD: `git diff pnpm-lock.yaml` = cross-env בלבד |

## §7 — Escalation triggers

עצור ושאל את מרדכי (parent task) אם:
- **גם** ההצבה ב-vite.config **וגם** ה-fallback (הצבת `PUBLIC_APP_TITLE` ב-build scripts) לא מצליחים לצרוב את הכותרת ל-`build/index.html` (ה-placeholder נשאר גולמי / ריק) — שלב-0 של Commit 1 נכשל. **אל תמציא** hook — שאל.
- `$env/dynamic/public` **וגם** `$env/static/public` נכשלים ב-adapter-static (prerender) — הרֵק ב-runtime.
- typecheck אדום מסיבה שאינה 2 המפתחות שהוספת ל-catalogs.
- אתה נדרש לשנות את `STORAGE_KEY`/localStorage כדי שמשהו יעבוד (מחוץ ל-scope — ר' §9 Q4).

## §8 — Complexity score

- commits: 4 (סביר)
- שכבות חדשות: 0 (config + composition-root glue)
- APIs חיצוניים: 0 · streaming/async: לא · state-model refactor: לא · protocol BE↔FE: לא
- +1 ערנות: SvelteKit env-injection (`%sveltekit.env%` + `$env/dynamic/public`) + נגיעה ב-deploy units
- +1 ערנות: build-time behavior שלא נתפס ב-typecheck → חובה build אמיתי בכל 3 המצבים (+ שלב-0 אימות-מנגנון)

**Score ≈ 6/10 → verifier `calev` mode: light.** דגש חד: **לבנות את שלושת המצבים** ולוודא כותרת+source-maps בכל אחד (לא רק typecheck). לא TDD — glue/config; ה-feedback loop הוא build+grep+browser.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל מוצעת | חוסם? |
|---|---|---|---|
| 1 | מיפוי dev/preview/prod | dev=source-maps+badge "Dev"; preview=source-maps+badge "Preview" (staging tunnel); prod=בלי source-maps+בלי badge. staging unit עובר ל-`FE_ENV=preview`. | ❌ (אושר עם המשתמשת) |
| 2 | תוויות route: מקומי (i18n) או אנגלית קשיח? המשתמשת כתבה "Sessions"/"Settings" באנגלית, אך האפליקציה עברית-first (dir=rtl) | **i18n** (מקומי): he→"הגדרות"/"סשנים", en→"Settings"/"Sessions". קל להפוך לאנגלית-קשיח (מחרוזת במקום `t()`) אם תעדיף אחידות-tab. | ❌ |
| 3 | `/` (מסך-חיבור) → "• סשנים"? זה מסך בחירת-פרויקט/תהליכים, לא בדיוק "סשנים" | כן, `• סשנים` (המשתמשת נתנה זאת כדוגמה). אם צורם — להסיר ולהשאיר base בלבד ב-`/`. | ❌ |
| 4 | `STORAGE_KEY = "drive-coding-v2-settings"` — לתקן את ה-"v2"? | **לא** בסלייס זה — מיגרציה מסכנת אובדן-הגדרות-משתמש חיות; המשתמשת לא ביקשה. אם רוצים — slice-מיגרציה נפרד (D4 המקורי). | ❌ |
| 5 | vite dev מקומי (`vite dev`, בלי FE_ENV) יראה "Drive Coding" (prod-like) | מקובל — ה-badge נועד ל**בילדים**. מי שרוצה badge ב-dev-server: `FE_ENV=dev pnpm dev`. | ❌ |
