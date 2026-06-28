# Slice cache-version — Cache-Control לרענון אמין בטלפון + מספר גרסה+SHA בהגדרות — ‏בריף

> ‏**תאריך**: 2026-06-28
> ‏**סוג**: feature קטן (3 חלקים — A: headers ב-BE · B: version ב-FE · C: bump semver במיזוג)
> ‏**סטטוס**: טיוטה — ‏ממתין לאביגיל
> ‏**Complexity**: 4/10 (verifier: **calev light** + ‏בדיקת משתמשת בטלפון)
> ‏**Base**: branch `dev` (tip `9ff60fa` — ‏אחרי commit ה-baseline `chore(version): root 0.1.0`)
> ‏**depends_on**: `[]` — ‏עצמאי. (`slice-fe-build-decouple` ‏כבר מוזג ל-dev → ‏זרימת ה-build המנותקת זמינה.)
> ‏**מקור**: ‏פיצול של `slice-cache-headers-version.md` ‏(שגדל לנפח-יתר A+B+C+D+publish). ‏זה החלק הדק A+B+C
> ‏בלבד. ‏החלק D ‏(מיתוג: איחוד `FE_ENV` ‏[כבר בוצע ב-units], rename `frontend-v2`→`frontend`, publish-hygiene)
> ‏ייכתב כ-brief נפרד **אחרי** ‏שזה יאומת. ‏rename ה-FE ‏הקנוני = `slice-frontend-rename-cutover.md`.

---

## §0 — ‏רקע ועדויות (‏אובחן חי על staging)

‏המשתמשת מתקינה PWA ‏בטלפון (`https://drive-coding-dev.example.com/chat`) ‏ורואה **‏גרסה ישנה** ‏ביחס למחשב:

1. ‏**אין service worker** ‏בפרויקט — ‏רק `static/manifest.webmanifest` + ‏icons (installable PWA ‏בלבד). ‏אין
   `src/service-worker.*`, ‏אין `vite-plugin-pwa`. ‏ה-caching **‏אינו** ‏של SW.
2. ‏ה-FE ‏מוגש ע"י Hono `serveStatic` ‏מ-`FE_STATIC_DIR`. ‏בדיקת headers חיה הראתה ש-`index.html` ‏וגם
   `/_app/immutable/*.js` ‏חוזרים **‏רק עם `Last-Modified`, ‏בלי `Cache-Control` ‏ובלי `ETag`**.
3. ‏ללא `Cache-Control`, ‏הדפדפן עושה **heuristic caching** ‏ל-`index.html` → ‏מצביע על chunk-hashes ‏ישנים →
   ‏גרסה ישנה בטלפון. ‏במחשב הרענונים תכופים → ‏כמעט לא מורגש.

‏**הריפו החי הוא `drive-coding`** (`/home/user/projects/drive-coding/{dev,main}`): dev=:4001, main=:4000.

---

## §1 — ‏מטרה

A. ‏רענון אמין: ‏הדפדפן בטלפון תמיד יקבל את ה-`index.html` ‏העדכני (revalidate), ‏בעוד נכסי
   `/_app/immutable/*` ‏(hash בשם) ‏ייהנו מ-cache ארוך. ‏בלי service worker.
B. ‏מספר גרסה גלוי בתחתית מסך ההגדרות — `v{semver} ({git SHA})` — ‏visibility ‏לדעת על איזו גרסה הלקוח יושב.
C. ‏ה-semver ‏ב-root `package.json` ‏ישקף את המצב: ‏כל מיזוג ל-dev ‏מעלה גרסה לפי סוג השינוי, ‏כדי שהמספר
   ‏ב-B ‏יהיה משמעותי ‏ולא תקוע על `0.0.0`.

---

## §2 — Scope

| ‏פעולה | ‏כן/לא |
|------|------|
| A: middleware ב-`server.ts` ‏שמגדיר `Cache-Control` ‏בענף `else if (feStaticDir)` ‏בלבד | ✅ |
| A: `index.html`/manifest → `no-cache`; `/_app/immutable/*` → `immutable` ‏שנה; `/api`,`/proxy` → ‏לא נוגעים | ✅ |
| B: ‏הזרקת version (`v{semver} ({SHA})`) ‏ב-build דרך SvelteKit `version.name` ‏ב-`svelte.config.js` | ✅ |
| B: ‏הצגת version בתחתית `SettingsScreen.svelte` | ✅ |
| B: ‏מפתח i18n `settings.version` ‏ב-3 ‏קבצים | ✅ |
| C: ‏script `scripts/bump-version.mjs` (root + ‏סנכרון `packages/release`) | ✅ |
| C: ‏תיעוד טקס ה-bump ‏כחלק ממיזוג מרדכי ל-dev | ✅ |
| **D: ‏מיתוג** (rename `frontend-v2`, `FE_ENV` ‏unification, title, localStorage-key, publish) | ❌ **brief נפרד אחרי אימות** |
| A ‏עבור מצב **binary** (`isBinary()` ‏branch, Bun.file from-memory) | ❌ (‏נתיב נפרד; ‏הפריסה החיה היא FE_STATIC_DIR. ‏follow-up) |
| ‏היסק אוטומטי של רמת bump (conventional-commits) | ❌ (‏שדרוג עתידי) |
| ‏service worker / ‏שינוי manifest / ‏Cloudflare Access | ❌ |
| ‏נגיעה ב-headers של `/api`,`/proxy`,`/ws` | ❌ (‏חובה לא לגעת) |
| ‏פריסה ל-prod (`main` :4000) | ❌ (‏dev בלבד; main בנפרד אחרי אימות) |

---

## §3 — ‏עיצוב הפתרון (‏מאומת מול הקוד החי, dev@bb0c8d3)

### A. Cache-Control — `packages/backend/src/server.ts`

‏מצב קיים **מאומת** (‏שורות 111-137): ‏יש ענף `isBinary()` ‏חדש מעל. ‏בלוק ה-FE_STATIC_DIR ‏הוא:
```ts
// line 112
const feStaticDir = process.env.FE_STATIC_DIR
if (isBinary() && !feStaticDir) {
  // ... binary embedded-manifest serving (114-129) — לא בסקופ
} else if (feStaticDir) {
  app.use("/*", serveStatic({ root: feStaticDir }))          // 135
  app.get("/*", serveStatic({ path: `${feStaticDir}/index.html` }))  // 136
  log.info({ feStaticDir }, "serving static FE")             // 137
}
```

‏הוסף middleware **‏בתוך ה-`else if (feStaticDir)`, ‏ממש לפני שתי שורות ה-serveStatic** (135-136):
```ts
} else if (feStaticDir) {
  // Cache-Control לנכסים סטטיים בלבד (ה-FE המוגש מ-FE_STATIC_DIR). guard מפורש
  // מוודא שלא נוגעים ב-/api,/proxy (cache משלהם); /ws לא עובר Hono כלל (httpServer
  // upgrade נפרד). נכסי _app/immutable עם hash → cache נצחי; index.html ושאר HTML
  // → no-cache (store-but-revalidate): עם ה-Last-Modified הקיים → 304 זריז כשאין
  // שינוי, גרסה חדשה מיד כשיש. תיקון ל-heuristic-caching בטלפון.
  app.use("/*", async (c, next) => {
    await next()
    const p = c.req.path
    if (p.startsWith("/api") || p.startsWith("/proxy")) return // לא נוגעים
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

‏**למה זה לא נוגע ב-`/api`,`/proxy`,`/ws`**:
- ‏`/api`,`/proxy`: ‏ה-guard המפורש בתחילת ה-middleware מחזיר מוקדם. ‏(‏בנוסף הם רשומים לפני בלוק ה-static
  ‏והם terminal, ‏אבל ה-guard מבטל תלות בסדר-רישום.)
- ‏`/ws`: ‏מטופל ב-`httpServer.on("upgrade")` ‏לפני ה-router של Hono → ‏ה-middleware **‏אף פעם לא רואה** ‏אותו.

> ‏**פתק ל-Avigail / executor — ‏החלטה לא-חסומה**: ‏גרסאות חדשות של `@hono/node-server` ‏חושפות ל-`serveStatic`
> ‏callback `onFound(path, c)` ‏(‏header רק כשקובץ נמצא) — ‏נקי יותר. ‏**בדוק** `node_modules/@hono/node-server/package.json`
> ‏+ ‏ה-`.d.ts` ‏של serve-static. ‏אם `onFound` ‏קיים → ‏העדף; ‏אם לא → ‏ה-middleware למעלה. ‏בשני המקרים: ‏אסור לגעת ב-`/api`,`/proxy`,`/ws`.

> ‏**פתק ל-Avigail**: ‏אמת ש-`isBinary` ‏מיובא ‏ושהבלוק הוא `else if (feStaticDir)` (‏לא `if`); ‏ש-`app=new Hono()`;
> ‏ש-`serveStatic` ‏מיובא משורה 4; ‏שכל ה-`register*Http` ‏רשומים **‏לפני** ‏בלוק ה-static.

### B. ‏מספר גרסה — ‏הזרקה ב-build + ‏הצגה

**B1 — ‏הזרקה.** ‏`packages/frontend/svelte.config.js` ‏**‏השתנה** ‏ב-fe-build-decouple ‏(יש בו `FE_BUILD_OUT`).
‏המצב החי המאומת:
```js
import adapter from "@sveltejs/adapter-static"
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte"

/** @type {import('@sveltejs/kit').Config} */
const out = process.env.FE_BUILD_OUT ?? "build"
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: out,
      assets: out,
      fallback: "index.html",
      precompress: false,
    }),
  },
  vitePlugin: { inspector: true },
}

export default config;
```

‏ערוך אותו ל (‏שמירה על `out` ‏הקיים, ‏הוספת `version.name`):
```js
import adapter from "@sveltejs/adapter-static"
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte"
import { execSync } from "node:child_process"
import pkg from "../../package.json" with { type: "json" }   // מקור-אמת יחיד = root package.json

let sha = "nogit"
try { sha = execSync("git rev-parse --short HEAD").toString().trim() } catch {}
const appVersion = `v${pkg.version} (${sha})`   // למשל "v0.1.0 (bb0c8d3)"

/** @type {import('@sveltejs/kit').Config} */
const out = process.env.FE_BUILD_OUT ?? "build"
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: out,
      assets: out,
      fallback: "index.html",
      precompress: false,
    }),
    version: { name: appVersion },
  },
  vitePlugin: { inspector: true },
}

export default config;
```
‏קריאה ב-component: `import { version } from "$app/environment"` → ‏מחזיר `"v0.1.0 (bb0c8d3)"`.

> ‏**executor — merge, ‏לא paste**: ‏הקוד למעלה הוא ה-config המלא **‏אחרי** ‏העריכה (‏פורמט תואם לקובץ החי,
> ‏כולל `adapter()` ‏רב-שורתי). ‏מזג את 3 ‏התוספות לקובץ הקיים — `import execSync`, `import pkg`, ‏בלוק ה-`sha`/`appVersion`,
> ‏ושורת `version: { name: appVersion }` ‏בתוך `kit` — ‏אל תדרוס את הקובץ (`out`/`FE_BUILD_OUT`/`vitePlugin` ‏נשמרים).

> ‏**determinism (‏אביגיל 🟢)**: ‏שני הרכיבים דטרמיניסטיים (‏package.json + ‏SHA) → ‏אין הפרת דרישת SvelteKit.
> ‏**אל תוסיף** ‏`new Date()` ‏ל-`version.name`. ‏אם בעתיד buildTime — ‏הזרק כ-Vite `define` (`__BUILD_TIME__`) ‏בנפרד.

> ‏**פתק ל-executor**: root `package.json` ‏כרגע `"version": "0.0.0"`. ‏ה-SHA ‏נותן הבחנה אמיתית בין builds מיד;
> ‏ה-semver יהפוך שימושי כשמרדכי יתחיל להעלות אותו (§C). ‏ה-`import ... with { type: "json" }` ‏דורש Node מודרני —
> ‏אם ה-build נכשל על זה, ‏חלופה: `JSON.parse(readFileSync(new URL("../../package.json",import.meta.url),"utf8")).version`.

**B2 — ‏הצגה.** ‏`packages/frontend/src/lib/components/settings/SettingsScreen.svelte` ‏(‏מאומת: `const t = getI18n().t`
‏בשורה 26; ‏סוף הקובץ = ‏כפתורי reset/saveOpen ‏בתוך `</div></section>`). ‏הוסף **‏לפני** ‏ה-`</section>` ‏הסוגר:
```svelte
  <p class="text-center text-[11px] mt-4" style="color:var(--fg-muted)" dir="ltr">
    {t("settings.version")} {version}
  </p>
</section>
```
‏והוסף בראש הקובץ: `import { version } from "$app/environment"`. (`t` ‏כבר קיים; `version` ‏הוא המחרוזת המלאה; `dir="ltr"` ‏כי לועזי.)

**B3 — i18n** (‏anchor-by-symbol: `settings.saveOpen`, ‏מאומת):
- `packages/core/src/i18n/keys.ts` — ‏הוסף `| "settings.version"` ‏ליד `| "settings.saveOpen"` (‏שורה 145).
- `packages/core/src/i18n/catalogs/he.ts` — `"settings.version": "גרסה:",` ‏ליד `settings.saveOpen` (‏שורה 135).
- `packages/core/src/i18n/catalogs/en.ts` — `"settings.version": "Version:",` ‏ליד `settings.saveOpen` (‏שורה 140).

> ‏**פתק ל-Avigail**: ‏אמת ש-`SettingsScreen.svelte` ‏הוא ה-bottom האמיתי (‏ה-route `settings/+page.svelte` ‏עוטף ב-AppShell);
> ‏ש-`$app/environment` ‏חושף `version`; ‏שמילון i18n ‏ב-`@drive-coding/core` ‏עם 3 ‏הקבצים; ‏ש-`@drive-coding/core` ‏נצרך
> ‏מ-`src` ‏(לא `dist/`) → ‏אין צורך ב-`pnpm --filter core build`.

### C. ‏עדכון semver במיזוג ל-dev

**‏מודל הגרסאות** (‏מתועד גם ב-`AGENTS.md` §Versioning — ‏מקור-אמת לטקס):
- ‏**root `package.json` = ‏המספר הראשי** — ‏הגרסה המוצגת ב-FE (B ‏קורא `../../package.json`). ‏baseline הועמד ל-`0.1.0`.
- ‏**`packages/release` = ‏זהה ל-root ‏תמיד** — ‏החבילה המפורסמת ל-npm; ‏מסונכרנת בכל bump.
- ‏**`packages/{backend,core,frontend}` = ‏גרסאות עצמאיות** — ‏מונה לכל אחת; ‏עולה **‏רק כשהחבילה נגעה** ‏במיזוג.

> ‏**⚠️ ‏אילוץ npm**: `packages/release` ‏כבר ב-`0.1.0` ‏(פורסם); npm ‏לא מאפשר ‏גרסה ≤ ‏קיימת. ‏לכן root ‏הועמד
> ‏ל-`0.1.0` ‏(baseline — ‏**‏קומיט ל-dev** `9ff60fa`, `chore(version)`; HEAD ‏כבר `0.1.0`). ‏מיזוג הסלייס הזה → `0.2.0` (minor).

**‏מנגנון** — `scripts/bump-version.mjs` (‏ללא תלויות, Node מובנה):
```js
// usage: node scripts/bump-version.mjs <patch|minor|major> [pkg...]
//   pkg = שם תיקייה תחת packages/ שנגעה במיזוג (backend|core|frontend). אפשר כמה. release לא נמסר (מסונכרן ל-root).
import { readFileSync, writeFileSync } from "node:fs"
const level = process.argv[2]
const pkgs = process.argv.slice(3)
if (!["patch", "minor", "major"].includes(level)) { console.error("usage: bump-version.mjs <patch|minor|major> [pkg...]"); process.exit(1) }
const bump = (v) => { const [maj, min, pat] = v.split(".").map(Number); return level === "major" ? `${maj + 1}.0.0` : level === "minor" ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}` }
const edit = (url, fn) => { const o = JSON.parse(readFileSync(url, "utf8")); fn(o); writeFileSync(url, JSON.stringify(o, null, 2) + "\n") }

// 1) root = המספר הראשי
let rootNext
edit(new URL("../package.json", import.meta.url), (o) => { rootNext = o.version = bump(o.version) })
// 2) packages/release = זהה ל-root תמיד
edit(new URL("../packages/release/package.json", import.meta.url), (o) => { o.version = rootNext })
// 3) כל חבילה שנגעה — מונה עצמאי, עולה ב-level
for (const name of pkgs) {
  if (name === "release") continue            // כבר מסונכרן ל-root
  edit(new URL(`../packages/${name}/package.json`, import.meta.url), (o) => { o.version = bump(o.version) })
}
console.log(`root+release → ${rootNext}${pkgs.length ? ` | bumped: ${pkgs.filter((p) => p !== "release").join(", ")}` : ""}`)
```

**‏רמת bump** (semver): bug→`patch` · feature backward-compatible→`minor` · breaking→`major`.

**‏מתי רץ — ‏בטקס המיזוג של מרדכי** (‏אחרי GO + ‏אישור; ‏בכל מיזוג, ‏לא כל commit):
```
‏אחרי merge ל-dev (‏לפני push):
  node scripts/bump-version.mjs <level> [pkg...]    # pkg = החבילות שנגעו (backend/core/frontend)
  git commit -am "chore(release): vX.Y.Z"
  git push origin dev
```

> ‏**פתק ל-Avigail**: ‏אמת ש-root `package.json` ‏קיים (‏`version` ‏הועמד `0.1.0`); ‏ש-`packages/release="0.1.0"`;
> ‏ש-`packages/{backend,core,frontend}/package.json` ‏קיימים עם `version` (`0.0.0`); ‏שאין מנגנון release קיים
> ‏(`standard-version`/`changeset`/`semantic-release` ‏ב-devDeps); ‏שתיקיית `scripts/` ‏קיימת ב-root.

---

## §4 — ‏שלבים בסדר

### Commit 1 — A: Cache-Control middleware
‏הוסף middleware ב-`server.ts` ‏בענף `else if (feStaticDir)` ‏(או `onFound` ‏אם נתמך).
**Testing**: integration — ‏אם יש test ל-server static; ‏אחרת manual (‏ראה §5). **Verification**: `pnpm typecheck` ‏נקי.

### Commit 2 — B1: ‏הזרקת version ב-build
‏ערוך `svelte.config.js` ‏(שמירה על `FE_BUILD_OUT` ‏הקיים + ‏הוספת `version.name`).
**Testing**: manual. **Verification**: `pnpm fe:build` ‏נקי; ‏ה-SHA מופיע ב-`build/` (`grep -r "(.*)" build/_app` ‏או ב-`index.html`).
> ‏**הרץ מתוך ה-worktree** (‏שבו `.git` ‏זמין) — `git rev-parse` ‏ב-svelte.config דורש git; ‏מחוץ ל-git ה-fallback `"nogit"` ‏יורה בשקט. ‏ה-deploy רץ ב-worktree של dev (‏git קיים) → ‏תקין.

### Commit 3 — B2+B3: i18n + ‏הצגה
‏3 ‏מפתחות i18n (`settings.version`), ‏ואז ה-`<p>` ‏בתחתית `SettingsScreen.svelte` + ‏ה-import.
**Testing**: manual. **Verification**: `pnpm --filter @drive-coding/frontend-v2 typecheck` ‏נקי (‏ה-MessageKey החדש מוכר).

### Commit 4 — C: bump-version script
‏צור `scripts/bump-version.mjs` (‏root + ‏release sync + ‏touched-packages). ‏root `package.json` ‏כבר `0.1.0` (‏baseline בוצע).
**Testing**: manual smoke. **Verification**:
- `node scripts/bump-version.mjs patch` → root `0.1.0`→`0.1.1` + release מסונכרן ל-`0.1.1` (‏ואז `git checkout -- package.json packages/release/package.json` ‏משחזר ל-baseline ה-**‏קומיט** `0.1.0` — ‏smoke).
- `node scripts/bump-version.mjs minor frontend` → root+release `0.2.0` **‏וגם** `packages/frontend` ‏עולה ב-minor (‏ואז `git checkout`).
- ‏בלי ארגומנט → ‏exit 1.

### ‏פריסה (‏אחרי calev GO + ‏אישור משתמשת) — **‏זרימה מנותקת (fe-build-decouple)**
A ‏הוא שינוי **BE** (`server.ts`) → ‏מחייב restart. B ‏הוא שינוי **FE** → ‏מחייב build טרי (‏ה-version מוזרק ב-build).
```
git -C dev pull --ff-only
pnpm -C dev install            # אם השתנו תלויות
pnpm -C dev fe:build           # build טרי — מזריק version חדש (לא --if-missing!)
systemctl --user restart voice-acp-dev.service   # ל-BE (A); ExecStartPre --if-missing ידלג (build כבר טרי)
# → בדיקת משתמשת בטלפון: hard-refresh פעם אחת, ואז refresh רגיל מקבל עדכונים
```

---

## §5 — ‏אסטרטגיית בדיקה

- **A** (manual/integration): ‏אחרי deploy, `curl -sI http://localhost:4001/ | grep -i cache-control` → `no-cache`;
  `curl -sI http://localhost:4001/_app/immutable/<chunk>.js | grep -i cache-control` → `immutable`;
  `curl -sI http://localhost:4001/api/<endpoint>` → ‏**אין** `Cache-Control` ‏שנוסף על-ידינו (‏לא נשבר).
- **B** (manual): ‏מסך ההגדרות מציג `גרסה: v0.x.y (<sha>)` ‏בתחתית; ‏ה-SHA תואם `git rev-parse --short HEAD` ‏של ה-build.
- **C** (manual smoke): ‏כמו §4 Commit 4.
- **runtime-gate (calev light)**: ‏headers נכונים פר נתיב; ‏version מוצג ‏ולא ריק/undefined; ‏אין רגרסיה ב-`/api`/`/ws`.
- **בדיקת משתמשת בטלפון**: ‏אחרי deploy, ‏ה-PWA מתעדכן ב-refresh רגיל (‏לא צריך uninstall).

---

## §6 — Definition of Done

1. `server.ts`: ‏middleware קיים בענף `else if (feStaticDir)`, ‏עם guard מפורש ל-`/api`,`/proxy`.
2. `curl` ‏מאשר: `index.html`→`no-cache`, `/_app/immutable/*`→`immutable`, `/api`→ ‏ללא Cache-Control חדש.
3. `svelte.config.js`: `version.name = "v{semver} ({sha})"`, ‏שומר על `FE_BUILD_OUT`; `pnpm fe:build` ‏נקי.
4. `SettingsScreen.svelte`: ‏מציג את ה-version בתחתית; ‏3 ‏מפתחות i18n קיימים.
5. `scripts/bump-version.mjs`: ‏עובד (patch/minor/major), ‏מסנכרן root+release, ‏exit 1 ‏בלי arg.
6. `pnpm typecheck` ‏נקי (build-gate).
7. ‏אומת חי על dev :4001 + ‏בדיקת משתמשת בטלפון.

---

## §7 — ‏שאלות פתוחות

1. ✅ **‏הוכרע** — ‏root הועמד `0.1.0` (‏baseline, ‏בוצע ב-dev). ‏מיזוג הסלייס → `0.2.0` (minor).
2. **`onFound` vs middleware** — ‏executor יחליט לפי הגרסה המותקנת של `@hono/node-server` (‏מותקן 2.0.3 → ‏תומך `onFound`).

---

## §8 — Complexity

| ‏גורם | ‏ניקוד |
|------|------|
| ‏היקף קבצים (server.ts, svelte.config, SettingsScreen, 3×i18n, bump script) | 2 |
| ‏סיכון (middleware ordering — ‏ממותן ב-guard מפורש; ‏build-time injection) | 1 |
| ‏אינטגרציה (BE+FE+build, ‏אבל additive ‏וברור) | 1 |
| **‏סה"כ** | **4/10 → calev light (mode: light)** |

---

## §9 — ‏סיכונים

- **A ‏שובר cache של `/api`/`/proxy`** — ‏ממותן ב-guard מפורש בתחילת ה-middleware (‏לא תלוי בסדר-רישום).
- **B ‏מפר determinism של SvelteKit** — ‏ממותן: ‏אין `Date()`; ‏רק package.json+SHA דטרמיניסטיים.
- **‏build נכשל על `import ... with { type: "json" }`** — ‏fallback ל-`readFileSync` (‏ראה §3.B1).
- **‏גרסה לא מתעדכנת אחרי deploy** — ‏כי `--if-missing` ‏מדלג: ‏הפריסה משתמשת ב-`pnpm fe:build` ‏מלא (‏לא if-missing) ‏לפני restart (§4).
- **binary mode ‏ללא cache-headers** — ‏מודע, ‏מחוץ לסקופ (‏הפריסה החיה היא FE_STATIC_DIR); ‏follow-up אם/כשבינארי נפרס.
