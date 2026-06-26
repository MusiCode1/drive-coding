# Slice cache-headers-version — Cache-Control לרענון אמין בטלפון + מספר גרסה בתחתית ההגדרות — ‏בריף

> **‏תאריך**: 2026-06-17
> **‏סוג**: ‏feature קטן (3 חלקים — A: ‏headers ב-BE, B: ‏version ב-FE, C: ‏bump של semver במיזוג)
> **‏סטטוס**: ‏4/4 findings טופלו + ‏הכרעות פרסום הוטמעו (2026-06-21). ‏היקף גדל (C+D1-D5+publish) → **‏נדרש סבב אביגיל אחרון** לפני READY/dispatch.
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
D. ‏מיתוג נקי: ‏הסרת ה-`v2` ‏משם החבילה ‏ומכותרת הדף, ‏וסיומת "dev" ‏בכותרת הדף ‏בפריסת dev ‏בלבד —
   ‏כדי להבחין מיד בין הטאב של dev (staging) ‏לבין main (prod).

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
| D1: ‏שינוי שם חבילה `@drive-coding/frontend-v2` → `@drive-coding/frontend` (package.json + dc-launch + תיעוד) | ✅ |
| D2: ‏הסרת `v2` ‏מכותרת הדף (`app.html` → root `+layout.svelte` ‏דינמית) | ✅ |
| D3: ‏איחוד env — `FE_ENV` ‏יחיד גוזר sourcemap+title, ‏עם דריסה (`FE_SOURCEMAP`/`FE_TITLE`); ‏הוספת `FE_ENV=dev` ‏ל-unit החי | ✅ |
| D4: ‏ניקוי `v2` ‏מ-localStorage key (`drive-coding-v2-settings` → `drive-coding-settings`) + ‏מיגרציה + ‏טסט | ✅ |
| D5: ‏השלמת metadata ב-`packages/release/package.json` (repository/homepage/keywords/author) | ✅ |
| D-publish: guards ב-`release/scripts/build.mjs` — ‏כפיית `FE_ENV=prod` ‏בבנייה + ‏סנכרון גרסה root→release | ✅ |
| ‏אסטרטגיית bundle/dependencies של חבילת ה-npm | ❌ (‏בבעלות סוכן הפרסום — ‏לא בסלייס) |
| D: ‏שינוי שם תיקיית `packages/frontend/`, ‏או אזכורים היסטוריים לשם הישן `frontend-v2/` | ❌ (‏היסטוריה — ‏ראה §D1) |
| D: ‏החלת סיומת "dev" ‏גם על prod (`main`) | ❌ (‏main ‏נשאר "drive-coding") |
| D: ‏סנכרון קבצי ה-repo `deploy/systemd/*` ל-units החיים (+ `FE_ENV=dev` + drop-in) | ✅ (‏בוצע 2026-06-21) |
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
- `packages/core/src/i18n/keys.ts` — ‏הוסף `| "settings.version"` ‏ל-union (‏ליד `"settings.saveOpen"` — ‏שורה 137).
- `packages/core/src/i18n/catalogs/he.ts` — `"settings.version": "‏גרסה:",` (‏ליד `"settings.saveOpen"` — ‏שורה 126).
- `packages/core/src/i18n/catalogs/en.ts` — `"settings.version": "Version:",` (‏ליד `"settings.saveOpen"` — ‏שורה 131).
  ‏(‏anchor-by-symbol: ‏מצא לפי `settings.saveOpen`; ‏המספרים מ-2026-06-21.)

> **‏פתק ל-Avigail**: ‏אמת ש-`SettingsScreen.svelte` ‏הוא ה-bottom האמיתי (‏ה-route `settings/+page.svelte`
> ‏רק עוטף ב-`AppShell`); ‏ש-`t` ‏מ-`getI18n().t`; ‏שמילון ה-i18n ‏ב-`@drive-coding/core`
> ‏עם 3 ‏הקבצים keys/he/en; ‏ש-`$app/environment` ‏חושף `version` (‏SvelteKit סטנדרטי).

### C. ‏עדכון semver במיזוג ל-dev

**‏מקור אמת יחיד**: ‏root `package.json` `version` (‏כרגע `0.0.0`). ‏זה הערך ש-B ‏מציג (‏svelte.config
‏קורא `../../package.json`), ‏וזה הערך שמתעדכן בכל מיזוג. ‏ה-`version` ‏ב-`packages/frontend/package.json`
‏נשאר `0.0.0` ‏ולא בשימוש לתצוגה (‏אפשר להשאיר או לסנכרן — ‏לא קריטי).

> **✅ ‏הוכרע (§7 #8) — root ‏הוא המקור היחיד (‏אופציה A)**: ‏התצוגה (B) ‏קוראת root `package.json`
> ‏(‏כבר כך — ‏`svelte.config` ‏קורא `../../package.json`). ‏`packages/release/package.json` ‏מסונכרן מ-root
> ‏בשתי נקודות: ‏(1) `bump-version.mjs` ‏מעדכן את **‏שניהם** ‏מיד (‏שב-git יהיו זהים); ‏(2) guard ב-build
> ‏(§D-publish) ‏כרשת-ביטחון לפני pack/publish. ‏הסוכן מעלה את גרסת root בכל שינוי.
>
> **⚠️ ‏אילוץ npm שצריך הכרעת-התחלה**: ‏`packages/release` ‏פורסם כבר ב-`0.1.0`; ‏npm **‏לא** ‏מאפשר
> ‏לפרסם גרסה ≤ ‏הקיימת. ‏אם נסנכרן release ← root=`0.0.0`, ‏הפרסום הבא ייכשל. ‏**‏לכן root צריך לקפוץ
> ‏ל-≥ `0.1.1`** ‏לפני הפרסום הסונכרן הראשון. ‏המלצה: ‏להעמיד את root ‏ל-`0.1.0` ‏עכשיו (‏שיקוף המצב),
> ‏והסלייס הזה (‏feature) ‏מעלה ל-`0.2.0` ‏במיזוג. ‏(‏הכרעת ערך-התחלה למשתמש.)

**‏מנגנון bump** — `scripts/bump-version.mjs` (‏ללא תלויות, Node מובנה):
```js
// usage: node scripts/bump-version.mjs <patch|minor|major>
import { readFileSync, writeFileSync } from "node:fs"
const level = process.argv[2]
if (!["patch", "minor", "major"].includes(level)) { console.error("level required: patch|minor|major"); process.exit(1) }
const p = new URL("../package.json", import.meta.url)
const pkg = JSON.parse(readFileSync(p, "utf8"))
const [maj, min, pat] = pkg.version.split(".").map(Number)
const next = level === "major" ? `${maj + 1}.0.0` : level === "minor" ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`
pkg.version = next
writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n")

// אופציה A: root הוא המקור, אבל מסנכרנים גם את release/package.json מיד כדי שב-git
// השניים יהיו תמיד זהים (לא רק בזמן prepack). (§D-publish — guard ה-build הוא רשת-ביטחון נוספת.)
const rel = new URL("../packages/release/package.json", import.meta.url)
const relPkg = JSON.parse(readFileSync(rel, "utf8"))
relPkg.version = next
writeFileSync(rel, JSON.stringify(relPkg, null, 2) + "\n")
console.log(`version → ${next} (root + packages/release)`)
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
| 7 | (D3) ‏הבחנת dev/main ‏בכותרת: env מפורש ‏או זיהוי-branch? | ✅ ‏הוכרע ע"י המשתמש — **env מאוחד** (`FE_ENV` ‏יחיד + ‏overrides) |
| 8 | (C+publish) ‏מקור הגרסה המוצגת: root ‏או `packages/release`? | ✅ ‏הוכרע ע"י המשתמש — **root ‏הוא המקור היחיד**; ‏התצוגה תמיד קוראת ממנו, ‏ו-`packages/release/package.json` ‏מסונכרן **‏אוטומטית** ‏מ-root בזמן ה-build/pack (§3.C). ‏הסוכן מעלה את גרסת root ‏בכל שינוי. |

---

## §D — ‏מיתוג: ‏שם חבילה + ‏כותרת דף (‏הסרת `v2`) + ‏הבחנת dev/main ‏בכותרת

> **‏נוסף 2026-06-19 ‏בבקשת המשתמש.** ‏שלושה שינויי-מיתוג קטנים, ‏עצמאיים מ-A/B/C ‏אך נשלחים באותו slice.
> **‏ראוי לסבב אימות אביגיל קצר** (‏כמו שחלק C ‏הוסף אחרי האימות).

### D1 — ‏שינוי שם החבילה: `@drive-coding/frontend-v2` → `@drive-coding/frontend`

‏שם ה-**‏חבילה** (`name` ‏ב-`package.json`), ‏לא שם התיקייה (‏התיקייה כבר `packages/frontend/`).
‏הסרת ה-`-v2` ‏מהשם המוצג של החבילה.

‏**‏מקומות פונקציונליים** (‏חובה — ‏שבירה אם לא יעודכנו):
- `packages/frontend/package.json:2` — `"name": "@drive-coding/frontend-v2"` → `"@drive-coding/frontend"`.
- `scripts/dc-launch.mjs:18` — `["--filter", "@drive-coding/frontend-v2", "build"]` → ‏`"@drive-coding/frontend"`.
  ‏**‏זה ה-launcher של `bunx drive-coding`** — ‏אם לא יעודכן, ‏בניית ה-FE ‏ב-launch ‏תיכשל (filter ‏לא תואם).
- `packages/release/scripts/build.mjs:40` — `["--filter", "@drive-coding/frontend-v2", "build"]` → ‏`"@drive-coding/frontend"`
  ‏(‏וגם ההערות בשורות 4-5 שמזכירות את ה-filter). **‏זהו ה-build של חבילת ה-npm ה-מפורסמת `drive-coding`** (`prepack`/bundle).
  ‏**‏שבירה שקטה אם לא יעודכן**: `pnpm pack`/publish/bunx ‏ייכשל על filter לא-תואם — ‏typecheck/build רגיל ‏**‏לא** ‏יתפסו את זה
  ‏(‏אביגיל finding #1 🔴). ‏קריטי במיוחד עכשיו כשמתכננים לפרסם.

‏**‏מקומות תיעוד** (‏לא שובר ריצה, ‏אבל פקודות copy-paste ‏שגויות אם לא יעודכנו):
- `AGENTS.md:111` ‏ו-`:117` — ‏דוגמאות `pnpm --filter @drive-coding/frontend-v2 dev`.
- `tests/smoke/README.md:30` ‏ו-`tests/smoke/chat-roundtrip.mjs:26` (‏הערה) — ‏אותו filter בדוגמה.

‏**‏אסור לגעת** — ‏אזכורים היסטוריים לשם ה-**‏תיקייה הישנה** `packages/frontend-v2/` (‏מתארים את ההיסטוריה,
‏לא את ההווה): `AGENTS.md:33`, `packages/frontend/AGENTS.md:5`, ‏וכל `packages/frontend/docs/slices.md`.

‏**lockfile**: ‏ה-importer ב-`pnpm-lock.yaml` ‏ממופתח לפי **‏נתיב** (`packages/frontend:`) ‏ולא לפי שם החבילה,
‏ושום חבילה אחרת לא תלויה ב-frontend → ‏שינוי השם ‏**‏לא** ‏אמור לגעת ב-lockfile. ‏בכל זאת: ‏אחרי השינוי
‏הרץ `pnpm install` ‏וודא שה-lockfile לא השתנה (‏אם כן — commit אותו), ‏כדי ש-`pnpm install --frozen-lockfile`
‏ב-`ExecStartPre` ‏של ה-deploy לא ייכשל.

> **‏עדכון פנימי ל-brief**: ‏פקודות האימות ב-§4 (Commit 2/3) ‏וב-§5 ‏שמשתמשות ב-`--filter @drive-coding/frontend-v2`
> ‏מתעדכנות אף הן ל-`@drive-coding/frontend` (‏ראה הערה ב-§4).

### D2 — ‏הסרת `v2` ‏מכותרת הדף

‏הכותרת היחידה היא ב-`packages/frontend/src/app.html:6`: `<title>drive-coding v2</title>`.
‏(‏אין `<title>` ‏ברמת route ראשי — ‏רק `wake-word-test` ‏מגדיר משלו דרך `<svelte:head>`.)

> **‏תיקון אחרי אביגיל (🟡 finding #2)**: ‏ה-FE הוא **SPA טהור** — `+layout.ts` ‏מגדיר `ssr=false`
> ‏**‏וגם** ‏`prerender=false`. ‏לכן `%sveltekit.head%` ‏ב-`index.html` ‏הסטטי **‏נשאר ריק** ‏בזמן ההגשה,
> ‏וכל מה שב-`<svelte:head>` ‏נקבע **‏רק client-side ‏אחרי הרצת JS**. ‏הנימוק הקודם ("‏prerender ‏ע"י
> ‏adapter-static") ‏היה שגוי. ‏מסקנה: ‏**‏לא להסיר** ‏את ה-`<title>` ‏מ-`app.html` ‏לגמרי, ‏אחרת ה-HTML
> ‏הראשוני יגיע בלי title בכלל.

‏**‏הגישה (‏fallback סטטי + override דינמי)**:
- `app.html:6` — ‏שנה ל-`<title>drive-coding</title>` (‏הסרת `v2`; ‏זה ה-fallback הסטטי שתמיד נשלח, ‏בלי flash-בלי-title).
- ‏ה-override הדינמי (‏הוספת סיומת "dev") ‏נעשה ב-`+layout.svelte` ‏דרך `<svelte:head>` (‏ראה D3.c).
  ‏ב-prod הערך זהה ל-fallback ("drive-coding") → ‏אין שינוי גלוי; ‏ב-dev הוא הופך ל-"drive-coding dev" ‏ברגע ש-JS רץ.
  ‏Svelte מעדכן את `document.title` ‏הקיים (‏לא מוסיף תג `<title>` ‏כפול).
- `<meta name="apple-mobile-web-app-title" content="drive-coding">` (‏שורה 17, ‏כבר בלי v2) — ‏משאירים כמו שהוא.

### D3 — ‏הבחנת dev/main ‏בכותרת ‏דרך env מאוחד: ‏preset יחיד + ‏overrides

‏**‏החלטת המשתמש (2026-06-21)**: ‏לא להוסיף דגל רביעי. ‏משתנה-אב יחיד `FE_ENV` ∈ `{dev, prod}`
‏(‏ברירת מחדל `prod`) ‏קובע את הפרופיל, ‏וכל הגדרה ספציפית **‏נגזרת** ‏ממנו — ‏אלא אם הוגדר משתנה-דריסה
‏ייעודי, ‏שאז **‏גובר**. ‏כך ב-deploy צריך בד"כ משתנה אחד, ‏עם פתח-מילוט לדריסה נקודתית.

**‏כלל הקדימות (‏לכל הגדרה בנפרד)**: `משתנה-דריסה-ספציפי` (‏אם הוגדר) ← ‏גובר על → ‏ברירת-מחדל-מ-`FE_ENV`.

‏שתי הגדרות נגזרות כרגע: ‏(1) sourcemap — ‏דריסה ב-`FE_SOURCEMAP`; ‏(2) ‏כותרת — ‏דריסה ב-`FE_TITLE`.

‏**(a) `vite.config.ts`** — ‏מאחד את לוגיקת ה-sourcemap הקיימת ‏עם הכותרת תחת `FE_ENV`:
```ts
const isDev = (process.env.FE_ENV ?? "prod") === "dev"   // משתנה-האב היחיד

// sourcemap: דריסה ספציפית גוברת (כולל כיבוי מפורש), אחרת נגזר מהפרופיל.
// (מחליף את השורה הישנה: sourcemap: process.env.FE_SOURCEMAP === "true")
const sourcemap =
  process.env.FE_SOURCEMAP !== undefined
    ? process.env.FE_SOURCEMAP === "true"
    : isDev

// כותרת: דריסה ב-FE_TITLE גוברת, אחרת נגזר מהפרופיל.
const appTitle = process.env.FE_TITLE ?? (isDev ? "drive-coding dev" : "drive-coding")
```
‏ב-`build` ‏השתמש ב-`sourcemap` ‏(‏המחושב למעלה) ‏במקום ‏`process.env.FE_SOURCEMAP === "true"`.
‏ובתוך `defineConfig({...})` ‏הוסף בלוק `define`:
```ts
define: {
  __APP_TITLE__: JSON.stringify(appTitle),
},
```
> ‏ה-`!== undefined` ‏מהותי: ‏מאפשר `FE_SOURCEMAP=false` ‏**‏לכבות** ‏sourcemap גם ב-dev (‏דריסה אמיתית
> ‏לשני הכיוונים). ‏בדיקת `=== "true"` ‏בלבד לא היתה מאפשרת כיבוי-דריסה.

‏**(b) `packages/frontend/src/app.d.ts`** — ‏הצהר על ה-global (‏ל-svelte-check/TS), ‏בתוך `declare global`:
```ts
declare global {
  namespace App {}
  const __APP_TITLE__: string
}
```

‏**(c) `packages/frontend/src/routes/+layout.svelte`** — ‏הוסף ‏ב-markup (‏אחרי תגית ה-`</script>`):
```svelte
<svelte:head>
  <title>{__APP_TITLE__}</title>
</svelte:head>
```
‏(‏Vite `define` ‏מחליף את `__APP_TITLE__` ‏בטקסט המחרוזת בזמן build; ‏ב-`vite dev` ‏הערך זמין כרגיל.)

‏**(d) deploy — ‏ה-unit ה-CHI הוא מקור-האמת** (‏מאומת 2026-06-21, ‏ראה §D-deploy למטה):
- ‏**Live dev** (`~/.config/systemd/user/voice-acp-dev.service`): ‏הוסף `Environment=FE_ENV=dev`.
  ‏(‏אפשר להסיר את ה-`Environment=LOG_WIRE=ws` ‏המיותר — ‏ה-drop-in ‏ממילא מאפס אותו; ‏לא חובה לסלייס הזה.)
- ‏**Live main** (`~/.config/systemd/user/voice-acp-main.service`): ‏**‏ללא** ‏`FE_ENV` → ‏ברירת מחדל `prod` →
  ‏כותרת "drive-coding" + ‏בלי sourcemap.
- ‏**‏קבצי ה-repo** (`deploy/systemd/*`): **‏סונכרנו ל-live ב-2026-06-21** — ‏נתיבי `drive-coding/…`,
  ‏הוסר `FE_SOURCEMAP=true` ‏הרפאים, ‏נוסף `FE_ENV=dev` ‏(dev) ‏+ ‏ה-drop-in `voice-acp-dev.service.d/10-logging.conf`.
  ‏קבצי ה-repo הם תבנית/reference; ‏ה-unit החי הוא עדיין מקור-האמת לריצה.

### §D-deploy — ‏השוואת units (‏מאומת 2026-06-21) ‏ונקודת-תשומת-לב

‏ה-units שב-repo הם snapshot מת; ‏ה-units ה-**‏חיים** ‏עודכנו (`.bak-f060fd3` ‏מעיד על regeneration):

| ‏שדה | ‏repo `deploy/systemd/` | ‏live `~/.config/systemd/user/` |
|------|------------------------|--------------------------------|
| ‏נתיבים (WorkingDir/FE_STATIC_DIR/OPENCODE_BIN) | `…/voice-acp/…` ❌ | `…/drive-coding/…` ✅ |
| `FE_SOURCEMAP=true` | ‏קיים | **‏לא קיים** |
| `LOG_WIRE` + drop-in logging | ‏אין | ‏`LOG_WIRE=ws` + ‏`10-logging.conf` (`LOG_LEVEL=debug, LOG_NS=backend.*, LOG_FORMAT=both`) |

‏**‏נקודת-תשומת-לב (‏הכרעה למשתמש)**: ‏ה-live dev ‏**‏בונה כרגע בלי sourcemaps** (‏אומת: `0` ‏קבצי `.map`
‏ב-build). ‏הוספת `FE_ENV=dev` ‏בעיצוב המאוחד ‏**‏תדליק מחדש sourcemaps על dev** (‏כי `isDev` ‏גוזר
‏`sourcemap=true`) — ‏החזרה לכוונה המקורית. ‏אם לא רוצים: ‏הוסף גם `Environment=FE_SOURCEMAP=false`.
‏ברירת המחדל בסלייס: ‏להדליק (‏רצוי ל-staging).

‏**‏אחרי עריכת unit חי**: `systemctl --user daemon-reload && systemctl --user restart voice-acp-dev.service`.

### D4 — ‏ניקוי `v2` ‏מ-localStorage key (‏עם מיגרציה)

`packages/frontend/src/lib/view-models/settings.svelte.ts:21` — `const STORAGE_KEY = "drive-coding-v2-settings"`
‏→ ‏`"drive-coding-settings"`.

‏**‏מיגרציה (‏חובה — ‏אחרת משתמשים קיימים מאבדים הגדרות)**: ‏ב-`load()` (‏שורה ~61), ‏אם המפתח החדש ריק,
‏קרא חד-פעמית את המפתח הישן `"drive-coding-v2-settings"` ‏כ-fallback (‏ה-`save` ‏הבא ייכתב למפתח החדש):
```ts
const NEW_KEY = "drive-coding-settings"
const OLD_KEY = "drive-coding-v2-settings"   // migration fallback (הוסר בעתיד)
// בתוך load():
const raw = localStorage.getItem(NEW_KEY) ?? localStorage.getItem(OLD_KEY)
```
‏**‏טסטים**: `packages/frontend/src/lib/view-models/settings.test.svelte.ts:32` ‏משתמש ב-literal
‏`"drive-coding-v2-settings"` — ‏עדכן למפתח החדש (‏ושקול case-test למיגרציה: ‏מפתח ישן → ‏נטען).

### D5 — ‏metadata של חבילת ה-npm `packages/release/package.json`

‏קיים כבר: `name`, `version`, `description`, `license: MIT`, `files` allowlist, `bin`, `dependencies` (pino+pino-pretty).
‏**‏חסר ‏לפרסום ציבורי** — ‏הוסף: `repository` (‏URL ‏ל-GitHub), `homepage`, `keywords`, `author`.
‏(‏אסטרטגיית ה-dependencies — ‏bundle של הכל למעט pino/ACP — ‏היא **‏בבעלות סוכן הפרסום, ‏לא בסלייס הזה**;
‏כאן רק מטא-דאטה.)

### §D-publish — ‏היגיינת build של החבילה (FE_ENV ‏+ ‏סנכרון גרסה)

‏ה-build של החבילה (`packages/release/scripts/build.mjs`) **‏בונה FE מראש** ‏ומעתיק ל-`frontend-dist/`.
‏שתי בעיות אם לא מטפלים:
1. ‏אם המתחזק מפרסם מ-shell שבו `FE_ENV=dev` ‏מוגדר → ‏הכותרת "drive-coding **dev**" ‏תיאפה לחבילה הציבורית.
2. ‏npm קורא את הגרסה מ-`packages/release/package.json`, ‏לא מ-root → ‏root כמקור-אמת לא מגיע ל-npm בלי סנכרון.

‏**‏פתרון — ‏שני guards ב-`build.mjs` ‏עצמו** (‏לא תלוי במתחזק):
```js
// (1) כפיית prod ל-FE build — לא משנה מה ב-shell של המפרסם.
execFileSync("pnpm", ["--filter", "@drive-coding/frontend", "build"], {
  stdio: "inherit", cwd: repoRoot,
  env: { ...process.env, FE_ENV: "prod", FE_SOURCEMAP: "false" },
})

// (2) סנכרון גרסה root → release (root הוא המקור היחיד, §3.C #8).
const rootPkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"))
const relUrl = new URL("../package.json", import.meta.url)
const relPkg = JSON.parse(readFileSync(relUrl, "utf8"))
if (relPkg.version !== rootPkg.version) {
  relPkg.version = rootPkg.version
  writeFileSync(relUrl, JSON.stringify(relPkg, null, 2) + "\n")
}
```
> ‏זה הופך את root ‏ל-source-of-truth אמיתי: ‏התצוגה (B) ‏קוראת root, ‏וה-npm publish ‏מקבל את אותה גרסה.
> ‏(‏אילוץ ה-≥0.1.1 ‏מ-§3.C ‏עדיין חל — ‏root חייב להיות מעל הגרסה המפורסמת.)

### ‏שלבים (‏משתלב ב-§4)

- **Commit 5 — D1: ‏שינוי שם חבילה**. ‏עדכן את **3** ‏המקומות הפונקציונליים (`package.json`, `dc-launch.mjs`,
  ‏`packages/release/scripts/build.mjs`) + ‏התיעודיים; ‏הרץ `pnpm install` ‏וודא lockfile יציב.
  **Verification**: `pnpm --filter @drive-coding/frontend build` ‏נקי (‏השם החדש מזוהה);
  `pnpm install --frozen-lockfile` ‏עובר; **‏smoke פרסום**: `node packages/release/scripts/build.mjs` ‏מסיים נקי
  ‏(‏ה-filter החדש תואם — ‏מונע את השבירה השקטה מ-finding #1).
- **Commit 6 — D2+D3: ‏כותרת דינמית + ‏איחוד env**. `vite.config.ts` (‏איחוד sourcemap+title תחת `FE_ENV`
  ‏+ ‏define) + `app.d.ts` + `+layout.svelte` + ‏הסרת `<title>` ‏מ-`app.html`. ‏עריכת ה-unit החי
  ‏(`~/.config/systemd/user/voice-acp-dev.service` → `FE_ENV=dev`) ‏היא צעד **‏deploy** (‏לא בתוך הריפו),
  ‏מתבצע בעת הפריסה. **Verification**:
  - `pnpm --filter @drive-coding/frontend typecheck` ‏נקי.
  - `FE_ENV=dev pnpm --filter @drive-coding/frontend build` → ‏grep ל-"drive-coding dev" ‏ב-`build/`
    ‏**‏וגם** ‏קבצי `.map` ‏קיימים (‏sourcemap נגזר מ-FE_ENV).
  - build ‏ברירת-מחדל (‏בלי env) → "drive-coding" ‏בלבד, ‏**‏ללא** `.map`.
  - ‏דריסה: `FE_ENV=dev FE_SOURCEMAP=false build` → ‏אין `.map` (‏דריסה גוברת); `FE_TITLE=foo build` → ‏כותרת "foo".
- **Commit 7 — D4: ‏localStorage key + ‏מיגרציה**. `settings.svelte.ts` (NEW_KEY + ‏fallback ל-OLD_KEY) + ‏עדכון
  ‏`settings.test.svelte.ts`. **Verification**: `pnpm --filter @drive-coding/frontend test` ‏ירוק (‏כולל case מיגרציה).
- **Commit 8 — D5 + ‏D-publish**. ‏metadata ב-`packages/release/package.json` (repository/homepage/keywords/author);
  ‏2 ‏ה-guards ב-`release/scripts/build.mjs` (‏כפיית prod + ‏סנכרון גרסה). ‏העמדת root `version` ‏ל-`0.1.0`
  ‏(‏אילוץ npm). **Verification**: `node packages/release/scripts/build.mjs` ‏נקי; ‏אחריו
  ‏`packages/release/package.json` `version` == root `version`; ‏grep "drive-coding dev" ‏ב-`frontend-dist/` ‏ריק
  ‏(‏prod נכפה גם אם `FE_ENV=dev` ‏ב-shell).

## ‏סטיות מהתכנון (‏מתעדכן ע"י המבצע)

- 2026-06-17 — ‏תיקוני אביגיל (‏4 findings) ‏הוחלו על ה-brief לפני handoff:
  ‏(1) ‏שורות בלוק static 82-89; (2) ‏נימוק /ws ‏תוקן (httpServer upgrade, ‏לא chain-stop) + ‏guard מפורש;
  ‏(3) ‏אין core build ‏ב-Commit 3 (exports map מ-src); (4) ‏`version.name` ‏דטרמיניסטי — ‏בלי Date().
- 2026-06-17 — ‏החלטת משתמש: ‏מספר הגרסה משלב **‏שניהם** — `v{package.json version} ({git SHA})`,
  ‏מורכב למחרוזת אחת ב-`version.name` (§3.B).
- 2026-06-17 — ‏החלטת משתמש: ‏נוסף **‏חלק C** — ‏bump של semver (root `package.json`) ‏בכל מיזוג PR
  ‏ל-dev לפי סוג השינוי (patch/minor/major), ‏כדי שהגרסה תשקף את המצב בפועל. ‏מנגנון: `scripts/bump-version.mjs`
  ‏בטקס המיזוג של מרדכי; ‏רמה explicit (§7 #5). ‏ה-slice הזה עצמו → `minor` (0.1.0).
- 2026-06-19 — ‏החלטת משתמש: ‏נוסף **‏חלק D** (‏מיתוג) — ‏הסרת `v2` ‏משם החבילה ‏ומכותרת הדף, ‏וסיומת "dev"
  ‏בכותרת ה-deploy של dev. ‏פרטים מלאים ‏ב-§D; ‏ראוי לסבב אימות אביגיל קצר (‏כמו חלק C).
- 2026-06-21 — ‏החלטת משתמש: ‏**‏איחוד env** — ‏במקום `FE_ENV` ‏בנפרד מ-`FE_SOURCEMAP`, ‏משתנה-אב יחיד
  ‏`FE_ENV` ∈ `{dev,prod}` ‏גוזר את שתיהן (sourcemap + ‏title), ‏עם דריסה נקודתית (`FE_SOURCEMAP`/`FE_TITLE`)
  ‏שגוברת. ‏מטרה: ‏משתנה אחד ב-deploy, ‏לא ריבוי דגלים (§D3).
- 2026-06-21 — ‏ממצא ‏אימות (‏השוואת units): ‏ה-units שב-repo `deploy/systemd/` ‏מיושנים (‏נתיבי `voice-acp/…`,
  ‏`FE_SOURCEMAP=true` ‏שלא קיים ב-live); ‏ה-units ה-**‏חיים** (`~/.config/systemd/user/`) ‏עדכניים יותר
  ‏(‏נתיבי `drive-coding/…` + ‏drop-in logging). ‏live dev ‏בונה כרגע **‏בלי** sourcemaps (0 `.map`).
  ‏הוספת `FE_ENV=dev` ‏תחזיר sourcemaps ל-dev (‏רצוי). ‏בוצע: ‏קבצי ה-repo סונכרנו ל-live + ‏FE_ENV + ‏drop-in.
- 2026-06-21 — **‏אימות אביגיל §C+§D** (`reports/drive-coding/cache-headers-version-avigail.md`, ‏verdict USABLE-AFTER-FIX, 4 findings):
  ‏#1 🔴 ‏תוקן — ‏נוסף `packages/release/scripts/build.mjs:40` ‏לרשימת ה-rename (‏שבירת publish/bunx שקטה).
  ‏#2 🟡 ‏תוקן — ‏רציונל הכותרת: ‏SPA (`ssr=false`+`prerender=false`) → ‏לא prerender; ‏fallback סטטי ב-app.html + ‏override client-side.
  ‏#3 🟡 ‏תוקן — ‏מספרי שורות i18n (he 126 / en 131 / keys 137, anchor-by-symbol).
  ‏#4 🟢 ‏הועלה ל-§7 #8 — ‏גרסה כפולה: root `0.0.0` ‏מול `packages/release` `0.1.0` (‏ה-npm המפורסמת).
- 2026-06-21 — ‏הכרעות משתמש (‏הקשר פרסום):
  ‏(§7 #8) **root ‏מקור יחיד** לגרסה; ‏release מסונכרן אוטומטית מ-root ב-build (§D-publish); ‏הסוכן מעלה root בכל שינוי.
  ‏אילוץ npm: root חייב לקפוץ ל-≥`0.1.1` (‏המלצה: ‏root→0.1.0 ‏עכשיו, ‏הסלייס→0.2.0).
  ‏(‏היגיינה) ‏build של החבילה כופה `FE_ENV=prod` — ‏שלא תיאפה כותרת "dev" ‏לפרסום (§D-publish).
  ‏(D4) ‏לתקן את ה-localStorage key (`drive-coding-v2-settings`→`drive-coding-settings`) **‏עם מיגרציה**.
  ‏(D5) ‏להשלים metadata ב-`packages/release/package.json`.
  ‏(dependencies) ‏אסטרטגיית bundle (‏הכל למעט pino+ACP) ‏— ‏בבעלות סוכן הפרסום, ‏מחוץ לסלייס; ‏git-dep `provider-contract#main`
  ‏מנוטרל בפועל כי הוא נכנס ל-bundle ב-build (‏רק זמן-build מושך מ-`#main`).
