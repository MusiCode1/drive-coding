# Slice version-display-bump — תצוגת-גרסה ב-FE + script ל-bump (B+C) — תוכנית

> **תאריך**: 2026-06-28
> **סטטוס**: **plan-verified / READY** (אביגיל r2, 2026-06-28 — r1 USABLE-AFTER-FIX → תוקן → r2 READY/0-findings). dispatch-ready.
> **מקור**: חולץ מ-`slice-cache-headers-version` (המפלצת בת 8 ה-commits) — רק חלקים B+C.
>   A (cache-headers) ו-D1-D5/publish נשארים שם / מנותבים מחדש (D1 ⊂ frontend-rename-cutover).
> **Complexity**: 3/10 (verifier: **calev light**)
> **מבצע**: להחלטת המשתמשת (אחרי READY)
> **Base**: `dev` HEAD (tip `2cdb85a`)
> **depends_on**: **[]**

---

## §0 — הקשר: הפער שסוגרים

`AGENTS.md` (drive-coding) מתאר **טקס-גרסאות** שבו כל מיזוג ל-dev מריץ
`node scripts/bump-version.mjs <level>`. אבל **ה-script לא קיים** — ה-slice שאמור היה
לבנותו (`cache-headers-version`, חלק C) מעולם לא בוצע. במקביל, הגרסה **לא מוצגת** בשום
מקום ב-FE, אז גם אם נריץ bump ידני — המספר בלתי-נראה (cargo-cult).

שני חלקים סוגרים את הפער:
- **C** — `scripts/bump-version.mjs` + root `package.json` כמקור-אמת יחיד לגרסה.
- **B** — הצגת `v{semver} ({git SHA})` בתחתית מסך ההגדרות, נקרא מ-root package.json ב-build.

> ⚠️ **ה-bump עצמו אינו חלק מה-slice.** ה-script נוצר כאן, אבל **הרצתו קורית רק בטקס-המיזוג
> של מרדכי** (אחרי GO + אישור משתמשת), לא בביצוע ה-slice. רמת ה-bump (patch/minor/major)
> נקבעת בזמן המיזוג לפי אופי ה-PR — לא מוכרעת ב-brief הזה.

**מצב נוכחי (מאומת מול dev `2cdb85a`):**
- root `package.json` `version` = **`0.1.0`** ; `packages/release/package.json` = **`0.1.0`** (זהים כרגע).
- `packages/frontend/svelte.config.js` — **אין `kit.version`** (L8-15 רק adapter). צריך להוסיף.
- `$app/environment` `version` — **לא בשימוש** בשום מקום ב-FE (grep ריק).
- אין מנגנון bump קיים (`standard-version`/`changeset`/`semantic-release` — grep ריק ב-devDeps).
- `scripts/` קיים ב-root (יש בו `dc-build-fe.mjs`, `lint-no-hebrew-in-code.mjs` וכו').
- `settings.version` — **לא קיים** ב-i18n (grep=0). מפתח חדש.

**איך מריצים:**
```bash
cd packages/frontend
pnpm --filter @drive-coding/frontend-v2 typecheck   # ⚠️ שם החבילה עדיין frontend-v2 (rename ב-slice נפרד)
pnpm --filter @drive-coding/frontend-v2 build        # adapter-static
pnpm lint:i18n
```
> ⚠️ **שם החבילה הוא `@drive-coding/frontend-v2`** (לא `frontend`). ה-rename ל-`frontend`
> שייך ל-`slice-frontend-rename-cutover` (נפרד). **אל תיגע בשם החבילה כאן.**

**Browser**: אין DISPLAY → linux-gui Chrome :9222. `playwright-cli -s=vacp attach --cdp=http://localhost:9222`.

---

## §1 — מטרה

A. `scripts/bump-version.mjs` — כלי ללא-תלויות שמעלה את `version` ב-root `package.json` לפי
   רמה (patch/minor/major), **מסנכרן** את `packages/release/package.json` לאותו ערך, **ומעלה
   עצמאית כל חבילה שנמסרה ב-`[pkg...]`** (core/frontend/backend) — בדיוק כפי ש-`AGENTS.md:64` מגדיר.
   ארגומנט-רמה חסר/לא-חוקי → exit 1. (מקור-אמת = root; release מסונכרן כי הוא החבילה המפורסמת ל-npm.)
B. הצגת מספר-גרסה בתחתית מסך ההגדרות — `v{semver} ({git SHA})` (למשל `v0.1.0 (2cdb85a)`) —
   visibility ל-debug: על איזו גרסה הלקוח באמת יושב.

---

## §2 — Scope

| פעולה | כן/לא | לאן |
|------|------|-----|
| C: `scripts/bump-version.mjs` (root + release sync + `[pkg...]` עצמאי, exit-1 על arg חסר) | ✅ | הסבב הזה |
| C: root `package.json` כמקור-אמת יחיד לגרסה | ✅ | הסבב הזה |
| B: הזרקת `v{semver} ({SHA})` ב-build דרך SvelteKit `kit.version.name` | ✅ | הסבב הזה |
| B: הצגת הגרסה בתחתית `SettingsScreen.svelte` | ✅ | הסבב הזה |
| B: מפתח i18n `settings.version` (he+en+keys) | ✅ | הסבב הזה |
| **הרצת ה-bump בפועל** | ❌ | **טקס-מיזוג של מרדכי** — לא בביצוע ה-slice |
| **הכרעת רמת bump של slice זה** | ❌ | בזמן ה-merge (לא ב-brief) |
| A: Cache-Control headers | ❌ | slice נפרד (נשאר ב-cache-headers-version) |
| D1: rename `@drive-coding/frontend-v2`→`frontend` | ❌ | `slice-frontend-rename-cutover` |
| D2-D5/publish: כותרת/env/localStorage/metadata | ❌ | slices נפרדים (מיתוג/פרסום) |
| היסק-אוטומטי של רמת bump (conventional-commits) | ❌ | שדרוג עתידי |
| service worker / שינוי manifest | ❌ | — |

---

## §3 — עיצוב (מאומת מול הקוד)

### C. `scripts/bump-version.mjs`

קובץ חדש ב-`scripts/`, ESM (כל ה-scripts שם `.mjs`), ללא תלויות (Node מובנה).

> **🔑 חובת-חוזה (finding אביגיל #1)**: `AGENTS.md:64` מגדיר את הטקס כ-`bump-version.mjs <level> [pkg...]`,
> והגוף מפרט: root+release מקבלים `<level>`, וכל `pkg` שנמסר ב-`[pkg...]` (core/frontend/backend) מקבל
> bump **עצמאי** ב-`<level>` (מונה משלו). **הכרעת מרדכי (2026-06-28): מממשים את `[pkg...]`** (לא מחלישים
> את AGENTS). ה-script חייב לטפל ב-`process.argv.slice(3)`, אחרת AGENTS.md L64 משקר.
```js
// usage: node scripts/bump-version.mjs <patch|minor|major> [pkg...]
//   <level>   — root package.json + packages/release (release מסונכרן ל-root, החבילה המפורסמת).
//   [pkg...]  — שמות חבילות תחת packages/ שנגעו במיזוג (core|frontend|backend) — bump עצמאי לכל אחת.
import { readFileSync, writeFileSync } from "node:fs"

const level = process.argv[2]
if (!["patch", "minor", "major"].includes(level)) {
  console.error("usage: node scripts/bump-version.mjs <patch|minor|major> [pkg...]")
  process.exit(1)
}

function nextVersion(version, lvl) {
  const [maj, min, pat] = version.split(".").map(Number)
  return lvl === "major" ? `${maj + 1}.0.0` : lvl === "minor" ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`
}
function bumpFile(url, lvl) {
  const pkg = JSON.parse(readFileSync(url, "utf8"))
  pkg.version = nextVersion(pkg.version, lvl)
  writeFileSync(url, JSON.stringify(pkg, null, 2) + "\n")
  return pkg.version
}

// root — מקור-האמת לתצוגה (B).
const rootNext = bumpFile(new URL("../package.json", import.meta.url), level)

// release — מסונכרן ל-root (לא bump עצמאי): החבילה המפורסמת ל-npm חייבת == root.
const relUrl = new URL("../packages/release/package.json", import.meta.url)
const rel = JSON.parse(readFileSync(relUrl, "utf8"))
rel.version = rootNext
writeFileSync(relUrl, JSON.stringify(rel, null, 2) + "\n")

// [pkg...] — כל חבילה שנגעה: bump עצמאי מהמונה שלה.
const bumped = process.argv.slice(3).map((name) => {
  const url = new URL(`../packages/${name}/package.json`, import.meta.url)
  return `${name}→${bumpFile(url, level)}`   // package.json חסר → קריאה תיזרק (fail-loud, רצוי)
})

console.log(`version → root+release ${rootNext}${bumped.length ? "; " + bumped.join(", ") : ""}`)
```
> **הערה**: שם-חבילה לא-קיים ב-`[pkg...]` → `readFileSync` זורק → ה-script נכשל בקול (טוב — מונע bump חלקי שקט).
> אם רוצים סלחנות — אפשר guard `existsSync` שמדלג עם warn, אבל fail-loud עדיף בטקס-מיזוג.
> **⚠️ פורמט-כתיבה**: אמת את ה-indent הקיים של שני ה-package.json (2-space סטנדרטי) — `JSON.stringify(_, null, 2)`
> תואם. אם קובץ קיים משתמש ב-trailing-newline (רוב כן), ה-`+ "\n"` שומר על כך → diff מינימלי.
> בדוק את שני הקבצים לפני, וודא שאין שדות שהסדר שלהם משתנה ב-round-trip (JSON.parse→stringify שומר סדר-הכנסה).

### B. הזרקת גרסה ב-build — `packages/frontend/svelte.config.js`

הקובץ כיום (L1-21) אין בו `kit.version`. הוסף קריאת root package.json + git SHA והרכב ל-`version.name`:
```js
import adapter from "@sveltejs/adapter-static"
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte"
import { execSync } from "node:child_process"
import pkg from "../../package.json" with { type: "json" }   // מקור-אמת יחיד = root

let sha = "nogit"
try { sha = execSync("git rev-parse --short HEAD").toString().trim() } catch {}
const appVersion = `v${pkg.version} (${sha})`   // למשל "v0.1.0 (2cdb85a)"

const out = process.env.FE_BUILD_OUT ?? "build"
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ pages: out, assets: out, fallback: "index.html", precompress: false }),
    version: { name: appVersion },
  },
  vitePlugin: { inspector: true },
}

export default config;
```
> **דטרמיניזם (חובת SvelteKit)**: שני הרכיבים דטרמיניסטיים (package.json + SHA של ה-commit). **אל תוסיף**
> `new Date()` ל-`version.name` — SvelteKit דורש ערך יציב. (אם בעתיד תרצה buildTime — Vite `define` נפרד.)
> **`import ... with { type: "json" }`**: דורש Node מודרני (יש; ה-svelte.config של ה-repo כבר ESM). אם ה-build
> נכשל על תחביר זה — חלופה: `JSON.parse(readFileSync(new URL("../../package.json", import.meta.url),"utf8")).version`.
> **`git rev-parse`**: ה-build רץ ב-`ExecStartPre` של systemd בתוך ריפו git → זמין; ה-`try/catch` מכסה shallow/no-git.

קריאה ב-component: `import { version } from "$app/environment"` → `"v0.1.0 (2cdb85a)"`.

### B. הצגה — `packages/frontend/src/lib/components/settings/SettingsScreen.svelte`

הקובץ 216 שורות. ה-`<section>` נסגר ב-**L216**; כפתורי reset/saveOpen ב-`<div>` שנסגר ב-**L215**.
הוסף את ה-`<p>` של הגרסה **בין L215 ל-L216** (בתוך ה-section, אחרי ה-div של הכפתורים):
```svelte
  </div>
  <p class="text-center text-[11px] mt-4" style="color:var(--fg-muted)" dir="ltr">
    {t("settings.version")} {version}
  </p>
</section>
```
- `t` כבר זמין (`const t = getI18n().t`, **L26**). הוסף `import { version } from "$app/environment"` ליד שאר ה-imports (L16-23).
- `version` מכיל את המחרוזת המלאה `v0.1.0 (2cdb85a)`. `dir="ltr"` כי הוא לועזי; ממורכז ועדין (`--fg-muted`).
> **פתק ל-Avigail**: אמת ש-`SettingsScreen.svelte` הוא ה-bottom האמיתי (route `settings/+page.svelte` עוטף ב-AppShell);
> ש-`--fg-muted` הוא משתנה-CSS קיים (אחרת `--fg-dim`); ש-`$app/environment` חושף `version` (SvelteKit סטנדרטי).

### B. i18n — מפתח `settings.version` (3 קבצים, anchor-by-symbol)

עוגן: `settings.saveOpen` (מאומת). הוסף `settings.version` לידו בכל קובץ:
- `packages/core/src/i18n/keys.ts` — `| "settings.version"` (ליד `| "settings.saveOpen"`, **L145**).
- `packages/core/src/i18n/catalogs/he.ts` — `"settings.version": "גרסה:",` (ליד `"settings.saveOpen"`, **L135**).
- `packages/core/src/i18n/catalogs/en.ts` — `"settings.version": "Version:",` (ליד `"settings.saveOpen"`, **L140**).
> **פתק ל-Avigail**: anchor-by-symbol (`settings.saveOpen`) — המספרים מ-2026-06-28, אמת. אין צורך ב-`core build`:
> ה-FE צורך את `@drive-coding/core` מ-`src` דרך exports map → שינוי i18n נכנס מיד ל-typecheck/build של ה-FE.

---

## §4 — Commits

### Commit 1 — C: `scripts/bump-version.mjs` (testing: manual smoke)
צור את הקובץ (§3.C). **אל תריץ אותו לשינוי-קבע** — רק smoke ואז החזרה.
**Verification**:
```bash
node scripts/bump-version.mjs                  # → exit 1, "usage: ..."
node scripts/bump-version.mjs minor            # root+release: 0.1.0 → 0.2.0
node scripts/bump-version.mjs minor frontend core   # +bump עצמאי ל-packages/frontend ו-core
git diff --stat package.json packages/release/package.json packages/frontend/package.json packages/core/package.json
git checkout package.json packages/release/package.json packages/frontend/package.json packages/core/package.json   # החזרה — bump אמיתי רק במיזוג
```
**DoD**: arg-רמה חסר→exit1; `minor` מעלה root+release זהה; `minor frontend core` מעלה גם את שתי החבילות (עצמאי, מהמונה שלהן); אחרי `git checkout` אין שארית.

### Commit 2 — B: הזרקת version ב-build (testing: manual)
עדכן `svelte.config.js` (§3.B). **Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 build
grep -rl "v0.1.0" packages/frontend/build 2>/dev/null | head   # ה-version מוטמע ב-bundle (לא תחת _app בהכרח; בלי הסוגר — שביר ב-grep)
```
> **finding אביגיל #2**: SvelteKit כותב `export const version = "v0.1.0 (sha)"`; אחרי minify הליטרל שורד אבל
> ה-environment module עלול להתמזג ל-chunk כללי (לא דווקא `_app/`). grep רחב (`build`, בלי `(`) אמין יותר.
**DoD**: build נקי; המחרוזת `v{version} ({sha})` מופיעה ב-`build/` (לא `undefined`).

### Commit 3 — B: i18n + הצגה בהגדרות (testing: manual + browser)
3 מפתחות i18n + ה-`<p>` ב-SettingsScreen (§3.B). **Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 typecheck   # ה-MessageKey החדש מוכר
pnpm lint:i18n                                        # אין עברית קשיחה בקוד
```
ב-browser (linux-gui :9222, `/chat?mock=greeting` → ניווט להגדרות, או `/settings`):
- תחתית ההגדרות מציגה "גרסה: v0.1.0 (2cdb85a)" (he) / "Version: ..." (en), ממורכז, dir=ltr.
**DoD**: typecheck נקי; הגרסה מוצגת חי בתחתית ההגדרות; i18n he+en.

### Commit 4 — calev light (testing: none — verifier)
מרדכי מפעיל את כלב (mode: light). אליעזר לא ממזג.

---

## §5 — DoD (סיכום)

| בדיקה | איך | Commit |
|------|-----|--------|
| `bump-version.mjs`: arg חסר→exit1; `minor` מעלה root+release זהה; `minor <pkg>` מעלה גם חבילה עצמאית | smoke + git checkout | 1 |
| `version.name` מוטמע ב-build (לא undefined) | grep build/ | 2 |
| typecheck + build + lint:i18n ירוקים | פקודות §0 | כל commit |
| הגרסה מוצגת חי בתחתית ההגדרות (he+en) | browser | 3 |
| **לא בוצע bump לקבע** (root נשאר 0.1.0 ב-commits) | grep | כל commit |

---

## §6 — סיכונים

| סיכון | מיטיגציה |
|------|---------|
| `import ... with { type:"json" }` נכשל בגרסת Node | fallback `JSON.parse(readFileSync(...))` (§3.B) |
| `git rev-parse` נכשל (shallow/no-git) | `try/catch` → `"nogit"`; build לא נשבר |
| `bump-version.mjs` משנה סדר/פורמט של package.json | `JSON.stringify(_,null,2)+"\n"` שומר 2-space+newline; smoke בודק `git diff` מינימלי |
| מבצע מריץ bump לקבע בטעות | DoD מפורש: root נשאר 0.1.0; ה-bump = טקס-מיזוג בלבד |
| `settings.version` key חסר בקטלוג אחד → typecheck/runtime | מוסף ב-3 הקבצים יחד (keys+he+en) |

## §7 — Q&A / החלטות

- **Q: רמת bump של ה-slice הזה?** A: **לא מוכרע כאן.** ה-bump קורה בטקס-המיזוג; הרמה נקבעת בזמן merge.
- **Q: root או release כמקור-אמת?** A: **root**. release מסונכרן מ-root ב-bump (החבילה המפורסמת).
- **Q: למה ה-script מטפל ב-`[pkg...]` ולא רק root?** A: הכרעת מרדכי (finding אביגיל #1) — `AGENTS.md:64`
  מתעד `<level> [pkg...]` עם bump עצמאי פר-חבילה. כשהמימוש זול והחוזה מתועד — מממשים אותו, לא מחלישים את
  התיעוד. release מסונכרן ל-root; `[pkg...]` (core/frontend/backend) עולות עצמאית.
- **Q: למה לא לגעת בשם החבילה (frontend-v2)?** A: ה-rename הוא `slice-frontend-rename-cutover` נפרד — חפיפה=קונפליקט.
- **Q: אילוץ npm (release פורסם ב-0.1.0)?** A: root כבר 0.1.0; bump הבא ≥0.2.0 > הקיים → תקין.

## depends_on
**[]** — עצמאי. root package.json + svelte.config + SettingsScreen + i18n (FE+root בלבד). BE: 0 שינוי.
