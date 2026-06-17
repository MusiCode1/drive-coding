# Slice cache-headers-version — Cache-Control לרענון אמין בטלפון + מספר גרסה בתחתית ההגדרות — ‏בריף

> **‏תאריך**: 2026-06-17
> **‏סוג**: ‏feature קטן (3 חלקים — A: ‏headers ב-BE, B: ‏version ב-FE, C: ‏bump של semver במיזוג)
> **‏סטטוס**: ‏READY — ‏אומת ע"י אביגיל (USABLE-AFTER-FIX, 4 findings תוקנו). ‏חלק C ‏נוסף אחרי האימות — ‏ראוי לסבב אימות נוסף קצר.
> **Complexity**: 4/10 (verifier: **calev light** + ‏בדיקת משתמש בטלפון)
> **‏מבצע**: ‏להחלטת המשתמש (‏אחרי READY של אביגיל)
> **Base**: ‏branch `dev` (tip `cceb66f`) — ‏הסביבה הפרוסה ב-staging (`drive-coding-dev` :4001)
> **depends_on**: ‏אין

---

## §0 — ‏רקע ועדויות (‏אובחן חי על staging)

‏המשתמש מתקין PWA ‏בטלפון (‏דרך `https://drive-coding-dev.example.com/chat`) ‏ורואה **‏גרסה ישנה**
‏ביחס למחשב. ‏אובחן חי:

1. **‏אין service worker** ‏בפרויקט — ‏רק `static/manifest.webmanifest` + ‏icons (installable PWA ‏בלבד).
   ‏אין `src/service-worker.*`, ‏אין `vite-plugin-pwa`, ‏אין workbox. ‏אז ה-caching **‏אינו** ‏של SW.
2. ‏ה-FE מוגש ע"י Hono `serveStatic` (`@hono/node-server/serve-static`) ‏מ-`FE_STATIC_DIR`.
   ‏בדיקת headers חיה על `:4001` (‏ה-staging האמיתי): ‏גם `index.html` ‏וגם `/_app/immutable/*.js`
   ‏חוזרים **‏רק עם `Last-Modified`, ‏בלי `Cache-Control` ‏ובלי `ETag`**.
3. ‏ללא `Cache-Control`, ‏הדפדפן עושה **heuristic caching** ‏ל-`index.html` (‏בערך 10% ‏מהזמן מאז
   `Last-Modified`, ‏בלי לשאול את השרת). ‏ה-`index.html` ‏הישן מצביע על chunk-hashes ‏ישנים → ‏גרסה
   ‏ישנה בטלפון. ‏במחשב הרענונים תכופים יותר → ‏כמעט לא מורגש.

**‏הערת תשתית מאומתת**: ‏ה-unit files ‏ב-`deploy/systemd/voice-acp-*.service` ‏מיושנים (‏כתוב בהם
‏`voice-acp`), ‏אבל ‏ה-**‏תהליכים שרצים בפועל** (`/proc/<pid>/environ`) ‏מצביעים על
‏`/home/user/projects/drive-coding/{main,dev}`. ‏כלומר ‏**‏הריפו החי הוא `drive-coding`**, ‏וזה העץ לערוך.
- dev: ‏פורט 4001, `FE_STATIC_DIR=/home/user/projects/drive-coding/dev/packages/frontend/build`.
- main/prod: ‏פורט 4000, `https://drive-coding.example.com`.

---

## §1 — ‏מטרה

A. ‏רענון אמין: ‏הדפדפן בטלפון תמיד יקבל את ה-`index.html` ‏העדכני (revalidate), ‏בעוד נכסי
   `/_app/immutable/*` ‏(‏עם hash בשם) ‏ייהנו מ-cache ארוך. ‏בלי service worker.
B. ‏מספר גרסה גלוי בתחתית מסך ההגדרות — `v{semver} ({git SHA})` — ‏כדי לדעת ‏על איזו
   ‏גרסה הלקוח באמת יושב (‏visibility ל-debug).
C. ‏ה-semver ‏ב-`package.json` ‏ישקף את המצב בפועל: ‏כל מיזוג PR ‏ל-dev ‏מעלה את הגרסה לפי סוג
   ‏השינוי (patch / minor / major), ‏כדי שמספר הגרסה המוצג ב-B ‏יהיה משמעותי ‏ולא תקוע על `0.0.0`.

---

## §2 — Scope

| ‏פעולה | ‏כן/לא |
|------|------|
| A: middleware ב-`server.ts` ‏שמגדיר `Cache-Control` ‏לנכסים סטטיים בלבד | ✅ |
| A: `index.html` + ‏שאר ה-HTML/manifest → `no-cache`; ‏`/_app/immutable/*` → `immutable` ‏שנה | ✅ |
| B: ‏הזרקת version (`v{semver} ({SHA})`) ‏ב-build דרך SvelteKit `version.name` | ✅ |
| B: ‏הצגת version בתחתית `SettingsScreen.svelte` | ✅ |
| B: ‏מפתח i18n ל-label "‏גרסה"/"Version" | ✅ |
| C: ‏script `bump-version.mjs` ‏+ ‏מקור אמת יחיד (root `package.json`) | ✅ |
| C: ‏תיעוד טקס ה-bump ‏כחלק ממיזוג מרדכי ל-dev | ✅ |
| C: ‏היסק אוטומטי מלא של רמת ה-bump (semantic-release/conventional) | ❌ (‏שדרוג עתידי — ‏ראה §3.C + §7) |
| ‏הוספת service worker / ‏שינוי תוכן manifest | ❌ |
| ‏שינוי policy ב-Cloudflare Access / ‏ה-tunnel | ❌ |
| ‏נגיעה ב-headers של `/api`, `/proxy`, `/ws` | ❌ (‏חובה לא לגעת — ‏ראה §3.A) |
| ‏פריסה ל-prod (`main` :4000) | ❌ (‏רק dev בסלייס הזה; main ‏בנפרד אחרי אימות) |

---

## §3 — ‏עיצוב הפתרון (‏מאומת מול הקוד)

### A. Cache-Control ‏לנכסים סטטיים — `packages/backend/src/server.ts`

‏מצב קיים (‏שורות 82-89; ‏78-81 ‏הן הערה + `const feStaticDir`), ‏מאומת:
```js
const feStaticDir = process.env.FE_STATIC_DIR
if (feStaticDir) {
  app.use("/*", serveStatic({ root: feStaticDir }))
  app.get("/*", serveStatic({ path: `${feStaticDir}/index.html` }))
  log.info({ feStaticDir }, "serving static FE")
}
```

‏הוסף middleware **‏בתוך ה-`if (feStaticDir)`, ‏ממש לפני שתי שורות ה-serveStatic**:
```js
if (feStaticDir) {
  // Cache-Control לנכסים סטטיים בלבד. רץ רק כאן (אחרי כל /api,/proxy,/ws —
  // ראה הערת הסדר למטה), אז לא נוגע ב-API/WS. נכסי _app/immutable עם hash
  // בשם → cache ארוך נצחי. index.html ושאר ה-HTML → no-cache (store-but-
  // revalidate): עם ה-Last-Modified הקיים השרת מחזיר 304 זריז כשאין שינוי,
  // וגרסה חדשה מיד כשיש. זה התיקון לגרסה-ישנה-בטלפון (heuristic caching).
  app.use("/*", async (c, next) => {
    await next()
    const p = c.req.path
    if (p.startsWith("/api") || p.startsWith("/proxy")) return // לא נוגעים ב-API/proxy (cache משלהם)
    if (p.startsWith("/_app/immutable/")) {
      c.header("Cache-Control", "public, max-age=31536000, immutable")
    } else {
      c.header("Cache-Control", "no-cache")
    }
  })
  app.use("/*", serveStatic({ root: feStaticDir }))
  app.get("/*", serveStatic({ path: `${feStaticDir}/index.html` }))
  log.info({ feStaticDir }, "serving static FE")
}
```

**‏למה זה לא נוגע ב-`/api`,`/proxy`,`/ws`** (‏קריטי — ‏ה-proxy מ-`registerProxyHttp` ‏מנהל cache ‏משלו):
- ‏`/api`,`/proxy`: ‏ב-Hono ה-handlers ‏רצים בסדר רישום. ‏נתיבי ה-API/proxy ‏רשומים **‏לפני** ‏הבלוק
  ‏הזה (66-76) ‏והם terminal (‏מחזירים Response ‏בלי `next()`), ‏אז שרשרת הביצוע נעצרת לפניהם
  ‏וה-middleware (‏שרשום אחרון) ‏**‏לא רץ** ‏עבורם.
- ‏`/ws`: **‏תיקון אחרי אביגיל (🟡)** — ‏ה-WS ‏**‏לא** ‏עובר דרך Hono כלל. ‏הוא מטופל ב-
  `httpServer.on("upgrade")` ‏(‏שורות ~91+, `WebSocketServer`/`noServer`), ‏עוד לפני שה-request
  ‏מגיע ל-router של Hono. ‏לכן ה-middleware הזה ‏**‏אף פעם לא רואה** ‏תעבורת WS — ‏לא בגלל
  ‏chain-stop, ‏אלא כי זה נתיב נפרד לגמרי. (‏הנימוק הקודם "‏chain stops" ‏היה שגוי עבור WS.)

‏**‏המלצה (belt-and-suspenders)**: ‏כדי לא להישען על נימוק ordering עדין, ‏העדף guard מפורש בתחילת
‏ה-middleware: `if (p.startsWith("/api") || p.startsWith("/proxy")) return` (‏לפני קביעת ה-header).
‏זה מבטל כל תלות בסדר הרישום ‏ומגן גם אם בעתיד יתווסף route שאינו terminal.

> **‏פתק ל-Avigail / executor — ‏נקודת החלטה לא-חסומה**: ‏גרסאות חדשות של `@hono/node-server`
> ‏חושפות ל-`serveStatic` ‏callback `onFound(path, c)` ‏שמאפשר לקבוע header ‏רק כשקובץ באמת נמצא —
> ‏פתרון נקי יותר מ-middleware. **‏בדוק את הגרסה המותקנת** (`node_modules/@hono/node-server/package.json`
> ‏+ ‏ה-`.d.ts` ‏של serve-static). ‏אם `onFound` ‏קיים — ‏העדף אותו; ‏אם לא — ‏ה-middleware למעלה.
> ‏בשני המקרים: ‏אסור לשנות headers של `/api`,`/proxy`,`/ws`.

> **‏פתק ל-Avigail**: ‏אמת ש-`registerProxyHttp` (‏שורה 76) ‏וכל ה-`register*Http` ‏רשומים לפני
> ‏בלוק ה-static; ‏ש-`app` ‏הוא `new Hono()` (‏שורה 49); ‏ש-`serveStatic` ‏מיובא משורה 5.

### B. ‏מספר גרסה — ‏הזרקה ב-build + ‏הצגה בהגדרות

**‏החלטת המשתמש: ‏לשלב את שניהם** — semver מ-`package.json` + git SHA. ‏פורמט: `v0.0.0 (44f8f47)`.

**‏מימוש (‏מועדף, SvelteKit-native — ‏מקור יחיד):** ‏ב-`packages/frontend/svelte.config.js`, ‏הרכב
‏את שני הערכים ל-`kit.version.name` ‏אחד:
```js
import { execSync } from "node:child_process"
// מקור אמת יחיד לגרסה = root package.json (זה מה ש-bump-version.mjs מעדכן, §3.C).
import pkg from "../../package.json" with { type: "json" }

let sha = "nogit"
try { sha = execSync("git rev-parse --short HEAD").toString().trim() } catch {}
const appVersion = `v${pkg.version} (${sha})`   // למשל "v0.0.0 (44f8f47)"

const config = {
  // ...
  kit: {
    adapter: adapter({ /* ... */ }),
    version: { name: appVersion },
  },
}
```
‏קריאה ב-component: `import { version } from "$app/environment"` → ‏מחזיר `"v0.0.0 (44f8f47)"`.

> **‏הערה — determinism (‏אביגיל 🟢)**: ‏שני הרכיבים דטרמיניסטיים (‏package.json + ‏SHA של ה-commit),
> ‏אז ‏**‏אין** ‏הפרה של דרישת SvelteKit. ‏**‏אל תוסיף** ‏`new Date()` ‏ל-`version.name`. ‏אם בעתיד תרצה
> ‏buildTime — ‏הזרק בנפרד כ-Vite `define` (`__BUILD_TIME__`) ‏ושלב בתצוגה, ‏לא ב-version.name.

> **‏פתק ל-executor**: ‏שים לב ל-`package.json` ‏שכרגע `"version": "0.0.0"` ‏בשני המקומות (root + frontend).
> ‏ה-SHA הוא מה שייתן הבחנה אמיתית בין builds; ‏ה-semver יתחיל להיות שימושי כשתתחיל להעלות אותו ידנית.
> ‏ה-`import ... with { type: "json" }` ‏דורש Node מודרני — ‏אם ה-build נכשל על זה, ‏חלופה:
> `JSON.parse(readFileSync("./package.json","utf8")).version`.

‏הערך מחושב ב-**build time**. ‏ה-build רץ ב-`ExecStartPre` ‏של systemd (`pnpm build`) ‏בתוך ריפו git
‏→ `git rev-parse` ‏זמין; ‏ה-`try/catch` ‏מכסה מקרה שאין git (fallback `nogit`).

**‏הצגה** — `packages/frontend/src/lib/components/settings/SettingsScreen.svelte`:
‏בתחתית ה-`<section>`, ‏**‏אחרי** ‏ה-`<div>` ‏של כפתורי איפוס/שמור (‏סוף הקובץ, ‏שורה ~163):
```svelte
<p class="text-center text-[11px] mt-4" style="color:var(--fg-muted)" dir="ltr">
  {t("settings.version")} {version}
</p>
```
- `t` ‏כבר זמין (`const t = getI18n().t`, ‏שורה 25). ‏הוסף `import { version } from "$app/environment"`.
- `version` ‏מכיל כבר את המחרוזת המלאה `v0.0.0 (44f8f47)`. `dir="ltr"` ‏כי הוא לועזי; ‏ממורכז ‏ועדין (`--fg-muted`).

**i18n** — ‏הוסף מפתח `settings.version` ‏ב-3 ‏מקומות (‏מאומת מבנה):
- `packages/core/src/i18n/keys.ts` — ‏הוסף `| "settings.version"` ‏ל-union (‏ליד `"settings.saveOpen"`:135).
- `packages/core/src/i18n/catalogs/he.ts` — `"settings.version": "‏גרסה:",` (‏ליד שורה 124).
- `packages/core/src/i18n/catalogs/en.ts` — `"settings.version": "Version:",` (‏ליד שורה 129).

> **‏פתק ל-Avigail**: ‏אמת ש-`SettingsScreen.svelte` ‏הוא ה-bottom האמיתי (‏ה-route `settings/+page.svelte`
> ‏רק עוטף ב-`AppShell`); ‏ש-`t` ‏מ-`getI18n().t`; ‏שמילון ה-i18n ‏ב-`@drive-coding/core`
> ‏עם 3 ‏הקבצים keys/he/en; ‏ש-`$app/environment` ‏חושף `version` (‏SvelteKit סטנדרטי).

### C. ‏עדכון semver במיזוג ל-dev

**‏מקור אמת יחיד**: ‏root `package.json` `version` (‏כרגע `0.0.0`). ‏זה הערך ש-B ‏מציג (‏svelte.config
‏קורא `../../package.json`), ‏וזה הערך שמתעדכן בכל מיזוג. ‏ה-`version` ‏ב-`packages/frontend/package.json`
‏נשאר `0.0.0` ‏ולא בשימוש לתצוגה (‏אפשר להשאיר או לסנכרן — ‏לא קריטי).

**‏מנגנון bump** — `scripts/bump-version.mjs` (‏ללא תלויות, Node מובנה):
```js
// usage: node scripts/bump-version.mjs <patch|minor|major>
import { readFileSync, writeFileSync } from "node:fs"
const level = process.argv[2]
if (!["patch", "minor", "major"].includes(level)) { console.error("level required: patch|minor|major"); process.exit(1) }
const p = new URL("../package.json", import.meta.url)
const pkg = JSON.parse(readFileSync(p, "utf8"))
const [maj, min, pat] = pkg.version.split(".").map(Number)
pkg.version = level === "major" ? `${maj + 1}.0.0` : level === "minor" ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`
writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n")
console.log(`version → ${pkg.version}`)
```

**‏רמת ה-bump לפי סוג ה-PR** (semver סטנדרטי):
| ‏סוג שינוי | ‏רמה |
|----------|-----|
| ‏bug fix, ‏בלי שינוי התנהגות/API | `patch` |
| ‏feature חדש, ‏backward-compatible | `minor` |
| ‏breaking change (‏שינוי API/חוזה/התנהגות שמחייב התאמה) | `major` |

**‏מתי רץ — ‏שולב בטקס המיזוג של מרדכי** (‏ה-merge ‏ל-dev ‏הוא human-gated, ‏אחרי GO ‏ואישור משתמש):
```
‏אחרי merge ל-dev (‏לפני push):
  node scripts/bump-version.mjs <patch|minor|major>   # מרדכי בוחר לפי אופי ה-PR
  git commit -am "chore(release): vX.Y.Z"
  git push origin dev
```
‏מרדכי קובע את הרמה מתוך אופי ה-PR שמוזג. ‏זה הופך את מספר הגרסה המוצג ל-meaningful: ‏כל deploy
‏נושא גרסה שמשקפת את סוג השינוי המצטבר.

> **‏החלטה פתוחה (§7 #5)**: ‏ברירת המחדל היא **explicit** — ‏מרדכי מעביר את הרמה ידנית בזמן merge.
> ‏שדרוג עתידי אופציונלי: ‏היסק אוטומטי מ-conventional-commit prefixes (`fix:`→patch, `feat:`→minor,
> ‏`feat!:`/`BREAKING CHANGE`→major) ‏בטווח ה-merge, ‏או כלי כמו `commit-and-tag-version`. ‏לא בסלייס הזה.

> **‏פתק ל-Avigail**: ‏אמת ש-root `package.json` ‏קיים ‏ושדה `version` ‏בו `"0.0.0"`; ‏שאין כבר
> ‏מנגנון release/bump קיים (‏grep ל-`standard-version`/`changeset`/`semantic-release` ‏ב-devDeps);
> ‏שתיקיית `scripts/` ‏קיימת ב-root (‏ראינו `scripts/opencode-clean.sh`).

---

## §4 — ‏שלבים בסדר

### Commit 1 — A: Cache-Control middleware
‏הוסף את ה-middleware ב-`server.ts` ‏כפי ש-§3.A (‏או `onFound` ‏אם נתמך).
**Verification**: `pnpm --filter @drive-coding/backend typecheck` ‏(‏או root `pnpm typecheck`) ‏נקי.

### Commit 2 — B: ‏הזרקת version ב-build
‏מימוש אופציה 1 ‏(‏או 2) ‏מ-§3.B. ‏ודא build נקי ‏ושה-ערך מופיע בפלט (‏לא ריק/undefined).
**Verification**: `pnpm --filter @drive-coding/frontend-v2 build` ‏נקי; ‏ה-version מופיע ב-`build/`
‏(grep ל-SHA ב-`build/_app/` ‏או ב-`index.html`).

### Commit 3 — B: i18n keys + ‏הצגה בהגדרות
‏הוסף 3 ‏מפתחות i18n, ‏ואז את ה-`<p>` ‏בתחתית `SettingsScreen.svelte`.
**Verification**: `pnpm --filter @drive-coding/frontend-v2 typecheck` ‏נקי (‏ה-MessageKey החדש מוכר).
> **‏תיקון אחרי אביגיל (🟢)**: ‏**‏אין צורך** ‏ב-`pnpm --filter core build` — ‏ה-FE ‏צורך את `@drive-coding/core`
> ‏מ-`src` ‏דרך ה-exports map (‏לא מ-`dist/`), ‏אז שינוי i18n נכנס מיד ל-typecheck/build של ה-FE.

### Commit 4 — C: ‏script bump-version + ‏מקור אמת
‏צור `scripts/bump-version.mjs` (§3.C). ‏ודא ש-`svelte.config.js` (Commit 2) ‏קורא root `package.json`
‏(`../../package.json`), ‏כך שהתצוגה וה-bump חולקים מקור יחיד.
**Verification**: `node scripts/bump-version.mjs patch` ‏מריץ נקי ‏ומעלה `0.0.0`→`0.0.1` (‏ואז `git checkout`
‏להחזרה — ‏זה רק smoke; ‏ה-bump האמיתי קורה במיזוג, ‏לא בסלייס). `node scripts/bump-version.mjs` ‏בלי
‏ארגומנט → ‏exit 1.

### ‏פריסה (‏אחרי calev GO + ‏אישור משתמש)
‏commit ל-dev → `git push origin dev` → ‏על cli-agents: `git -C dev pull --ff-only` →
`systemctl --user restart voice-acp-dev.service` (‏ה-`ExecStartPre` ‏בונה מחדש) → ‏בדיקת משתמש בטלפון.

> **‏הערה — ‏מהסלייס הזה והלאה**: ‏טקס המיזוג של מרדכי ל-dev ‏כולל מעתה צעד `bump-version.mjs`
> ‏(§3.C). ‏המיזוג של *‏הסלייס הזה עצמו* ‏יקבל `minor` (‏feature חדש) → `0.1.0`.

> **‏הערה ל-executor**: ‏אם עובדים ב-worktree (`.worktrees/cache-headers-version/`, base dev),
> ‏ה-build/deploy מתבצע על העץ של dev ‏אחרי merge — ‏לא מתוך ה-worktree.

---

## §5 — ‏אסטרטגיית בדיקות

- **‏סטטי**: typecheck + build ‏נקיים (‏BE + FE + core).
- **‏runtime (calev light)** ‏על staging אחרי deploy:
  - `curl -sI http://localhost:4001/` → `index.html` ‏מחזיר `Cache-Control: no-cache`.
  - `curl -sI http://localhost:4001/_app/immutable/<hashed>.js` → `Cache-Control: public, max-age=31536000, immutable`.
  - `curl -sI http://localhost:4001/api/...` ‏(‏נתיב API קיים) → **‏ללא** ‏`no-cache` ‏שנכפה עליו / ‏לא השתנה.
  - WS (`/ws`) ‏עדיין מתחבר (‏smoke — ‏חיבור agent עובד).
- **‏בדיקת משתמש בטלפון**: ‏אחרי deploy — ‏רענון מראה את הגרסה החדשה; ‏מספר הגרסה מופיע בתחתית
  ‏ההגדרות ‏ותואם ל-SHA שנפרס. ‏בדיקה חוזרת: ‏push קטן → restart → ‏הטלפון מתעדכן בלי מחיקת PWA.
- **C (smoke)**: `node scripts/bump-version.mjs minor` ‏מעלה `0.0.0`→`0.1.0`; ‏בלי ארגומנט → exit 1.
  ‏אחרי בדיקה — ‏`git checkout package.json` (‏ה-bump האמיתי קורה במיזוג, ‏לא בריצת הבדיקה).

---

## §6 — ‏סיכונים

| ‏סיכון | ‏מיטיגציה |
|------|---------|
| ‏ה-middleware דורס `Cache-Control` ‏של ה-proxy ‏או נוגע ב-`/api` | ‏לא — ‏הוא רשום אחרי כל ה-`register*Http` ‏ו-terminal handlers עוצרים את השרשרת לפניו (§3.A). calev מאמת ב-curl על `/api`/`/proxy`. ‏אם בכל זאת — ‏הוסף guard מפורש `if (p.startsWith("/api")||p.startsWith("/proxy")||p.startsWith("/ws")) return` |
| `no-cache` ‏על `index.html` ‏עדיין מגיש ישן (‏אם אין revalidation) | ‏לא — `no-cache` ‏מחייב revalidate בכל בקשה; ‏עם `Last-Modified` ‏הקיים → 304 ‏או 200 ‏עדכני. ‏(‏אם רוצים ודאות מלאה אפשר `no-store`, ‏אבל מפסידים 304 — ‏לא נדרש כאן) |
| `git rev-parse` ‏נכשל ב-build (‏לא ריפו / ‏shallow) | `try/catch` → fallback `"dev"`; ‏ה-build לא נשבר |
| ‏`onFound` ‏לא קיים בגרסת @hono/node-server | ‏ה-middleware הוא ברירת המחדל; ‏executor בוחר לפי הגרסה המותקנת |
| ‏Cloudflare edge ‏מוסיף caching משלו | ‏מחוץ ל-scope; ‏Access מקדימה בד"כ עוקף edge-cache לבקשות מאומתות. ‏אם יתגלה — ‏slice נפרד על CF |

---

## §7 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל |
|---|------|----------|
| 1 | ‏הזרקת version: SvelteKit `version.name` ‏או Vite `define`? | ✅ ‏הוכרע — SvelteKit `version` (‏native, ‏מקור יחיד) |
| 2 | ‏פורמט התצוגה? | ✅ ‏הוכרע ע"י המשתמש — **‏שניהם**: `v{package.json} ({git SHA})` ‏= `v0.0.0 (44f8f47)` |
| 3 | ‏להחיל גם על prod (`main` :4000)? | ‏לא בסלייס הזה — ‏רק dev; main ‏אחרי אימות בטלפון |
| 4 | ‏ה-`settings.version` label — ‏להציג גם בעמוד chat? | ‏לא — ‏רק תחתית ההגדרות, ‏כבקשת המשתמש |
| 5 | ‏רמת ה-bump (C): ‏explicit במיזוג ‏או היסק אוטומטי מ-conventional-commits? | **‏explicit** ‏בסלייס הזה (‏מרדכי בוחר); ‏אוטומציה = ‏שדרוג עתידי |
| 6 | ‏לסנכרן גם `packages/frontend/package.json` ‏ל-root, ‏או רק root? | ‏רק root ‏(‏מקור אמת יחיד); ‏frontend נשאר `0.0.0` ‏ולא בשימוש |

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י המבצע)

- 2026-06-17 — ‏תיקוני אביגיל (‏4 findings) ‏הוחלו על ה-brief לפני handoff:
  ‏(1) ‏שורות בלוק static 82-89; (2) ‏נימוק /ws ‏תוקן (httpServer upgrade, ‏לא chain-stop) + ‏guard מפורש;
  ‏(3) ‏אין core build ‏ב-Commit 3 (exports map מ-src); (4) ‏`version.name` ‏דטרמיניסטי — ‏בלי Date().
- 2026-06-17 — ‏החלטת משתמש: ‏מספר הגרסה משלב **‏שניהם** — `v{package.json version} ({git SHA})`,
  ‏מורכב למחרוזת אחת ב-`version.name` (§3.B).
- 2026-06-17 — ‏החלטת משתמש: ‏נוסף **‏חלק C** — ‏bump של semver (root `package.json`) ‏בכל מיזוג PR
  ‏ל-dev לפי סוג השינוי (patch/minor/major), ‏כדי שהגרסה תשקף את המצב בפועל. ‏מנגנון: `scripts/bump-version.mjs`
  ‏בטקס המיזוג של מרדכי; ‏רמה explicit (§7 #5). ‏ה-slice הזה עצמו → `minor` (0.1.0).
