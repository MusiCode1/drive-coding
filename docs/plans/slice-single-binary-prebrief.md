# Pre-brief — בינארי יחיד עצמאי (`bun build --compile`) — הטמעת ה-FE

> **תאריך:** 2026-06-27 · **סטטוס:** קדם-brief (חקירה + spike מאומתים; טרם brief מלא)
> **מקור:** דיון משתמשת 27/06 — "בינארי אחד סגור". ההכרעה: **בינארי עצמאי אמיתי**
> (executable שלא דורש Bun/Node מותקן), לא חבילת npm/bunx (שכבר קיימת ב-`packages/release`).
> **טרק:** F (Infrastructure & Packaging) · roadmap §F "מעבר ל-Node target | slice עתידי" (מוחלף בזה).

---

## §1 — מטרה ו-scope

בינארי יחיד (`bun build --compile`) שמטמיע את ה-Bun runtime + ה-BE + **ה-FE build**,
ומשרת הכל מפורט יחיד — **בלי לדרוש Bun מותקן** אצל המשתמש. תקדים מוכח אצלנו:
`claude-code-connection` (`D:\UserProjects\AI\ClaudeCodeACP`) כבר מקמפל wrapper.exe עם
`bun build --compile` ("intentionally large because it embeds the Bun runtime").

**מוקד הקדם-brief הזה:** *איך מטמיעים ומגישים את קבצי ה-FE build* — הכרעה ארכיטקטונית
שהמשתמשת ביקשה לסגור ראשונה. שאר הנושאים (plugin/pino/DATA_DIR) — §5, נדחים.

**הכרעת המשתמשת (27/06):** serve-from-memory — **בלי לחלץ קבצים לדיסק** (extract-to-temp
נדחה). ה-plugin של opencode נדחה לדיון נפרד.

---

## §2 — חקירה: למה זה לא טריוויאלי

ה-FE (SvelteKit + adapter-static) הוא דירקטוריה דינמית — `_app/immutable/chunks/*.js`
עם שמות-hash שמשתנים בכל build, מוגשת היום דרך `serveStatic({root: FE_STATIC_DIR})`
ב-[`server.ts:109-117`](../../packages/backend/src/server.ts) (קריאה מ-fs).

**שלוש מלכודות שהתגלו בקריאת התיעוד המלא של Bun + GitHub:**

1. **`Bun.embeddedFiles` מסנן `.js`/`.ts`** ("to help protect your application's source",
   [docs executables §Listing embedded files](https://bun.com/docs/bundler/executables)).
   ה-FE הוא בעיקרו `.js` — לב ה-SPA.
2. **`blob.name` משוטח ל-basename + content-hash** (`icon-a1b2c3d4.png`) — הנתיב היחסי
   `_app/immutable/...` שה-HTML מפנה אליו נשבר.
3. **הדרך ה"רשמית" full-stack** (`import index from "./index.html"` + `Bun.serve({routes})`)
   **מבנדלת מחדש את ה-source** — לא תואמת ל-SvelteKit כבר-בנוי, וגם דורשת `Bun.serve`
   (אנחנו על Hono + `@hono/node-server`).

**אין מסלול רשמי מתועד** לשרת prebuilt-SPA (כולל js) מבינארי compiled דרך Hono.
זו בעיה ידועה ופתוחה: [oven-sh/bun#15734 — "bun build --compile doesn't work for
sveltekit apps"](https://github.com/oven-sh/bun/issues/15734). לכן — spike אמפירי.

---

## §3 — ממצאי ה-spike (מאומת: bun 1.3.12, Windows, 27/06)

### Spike 1 — import `.js`/`.css` עם `with { type: "file" }` (default naming)
```
jsPath:  "B:/~BUN/root/app-73p80k4z.js"      ← Bun.file(jsPath).text() החזיר תוכן מלא ✅
js .type:  "text/javascript;charset=utf-8"    ← content-type אוטומטי ונכון ✅
css .type: "text/css;charset=utf-8"
embeddedFiles names: ["app-73p80k4z.js","style-8w7nateq.css"]   ← basename + hash
isStandalone: undefined                        ← 🔴 לא true!
```
→ **`.js` ניתן להטמעה וקריאה כ-asset דרך import מפורש.** הסינון של `embeddedFiles` חל רק
על js שנכנס כ-source-import — לא על asset-import מפורש. content-type מגיע חינם מ-`.type`.

### Spike 2 — `--asset-naming="[dir]/[name].[ext]"` + `--define`
```
jsPath:  "B:/~BUN/root/assets/sub/app.js"      ← נתיב יחסי מלא נשמר, בלי hash ✅
embeddedFiles names: ["assets/sub/app.js"]
isStandaloneExecutable: undefined              ← 🔴 שוב undefined
embeddedFiles.length: 1
DEFINE __IS_BINARY__: true                      ← ✅ ה-gate עובד
```
→ הטוקן **`[dir]` נתמך** (לא מתועד!) ומשמר נתיב. ה-gate הנכון הוא **`--define`**, לא
`isStandaloneExecutable` (שמחזיר `undefined` ב-1.3.12).

### Spike 3 — glob/entrypoint (`find -type f`, בלי import מפורש)
```
embed 4 files (2×js + html + css) → count: 3 (!)
names: ["assets/index.html","assets/style.css","index-meqr85vs.js"]
```
→ **🔴 קריטי: שני קבצי ה-`.js` בונדלו כ-source ל-output אחד — לא נשמרו כ-assets.**
**glob/entrypoint לא עובד ל-js.** רק `import … with { type: "file" }` מפורש מתייחס
ל-`.js` כ-asset. **מכאן: ה-build חייב codegen.**

---

## §4 — העיצוב המאומת (serve-from-memory, אפס חילוץ לדיסק)

### Build — `packages/release/scripts/build-binary.mjs` (חדש, לצד `build.mjs`)
1. build FE → `frontend-dist/` (כמו `build.mjs` הקיים)
2. **codegen** `fe-manifest.gen.ts` מ-`new Glob("frontend-dist/**/*").scanSync()`:
   ```ts
   import f0 from "../frontend-dist/index.html"                with { type: "file" }
   import f1 from "../frontend-dist/_app/immutable/chunk.DxY.js" with { type: "file" }
   // … import לכל קובץ FE
   export const FE: Record<string, string> = {
     "/": f0, "/index.html": f0,
     "/_app/immutable/chunk.DxY.js": f1,   // ה-codegen יודע את ה-url path מהנתיב היחסי
   }
   ```
   > ה-codegen שולט במפה url→path — לא תלוי ב-`blob.name` המשוטח, ולא צריך `embeddedFiles`.
3. `bun build --compile --target=<t> --define __IS_BINARY__=true <bin-entry> --outfile dist/drive-coding-<t>[.exe]`
   (ה-`fe-manifest.gen.ts` מיובא מה-bin → כל הקבצים מוטמעים כ-assets)
4. per-target loop: `bun-windows-x64`, `bun-linux-x64`, `bun-darwin-arm64`

### Runtime — ענף חדש ב-[`server.ts`](../../packages/backend/src/server.ts) (במקום שורות 109-117)
```ts
declare const __IS_BINARY__: boolean | undefined
if (typeof __IS_BINARY__ !== "undefined" && __IS_BINARY__) {
  app.use("/*", (c, next) => {
    const p = FE[c.req.path]
    if (p) return new Response(Bun.file(p))   // content-type אוטומטי מ-.type
    return next()                              // → SPA fallback ל-FE["/index.html"]
  })
} else {
  // dev/release-bundle: serveStatic מ-FE_STATIC_DIR — כמו היום, ללא שינוי
}
```
לוגיקת ה-API/WS/proxy — **אפס שינוי**. ה-gate `__IS_BINARY__` מבדיל בינארי מ-dev.

> **ה-gate הוא build-time constant (`--define`), לא env var** — מוטמע ב-compile, dead-code-eliminated,
> לא ניתן לזיוף ב-runtime (להבדיל מ-env). **אומת cross-module (27/06):** define ב-`--compile` חל גם
> על module מיובא (לא רק entry) → `server.ts`/`log/index.ts` יקבלו אותו. 3 תרחישים: dev (bun ישיר)→`false`,
> binary+define→`true`, binary בלי define→`false` (כולם בטוחים, לא קורסים). חובה `declare const __IS_BINARY__:
> boolean | undefined` + `typeof` guard (אחרת dev נכשל typecheck+ReferenceError). מומלץ helper מרכזי
> `isBinary()` ב-core, לא לפזר `typeof`. אם children (opencode/claude spawn) יצטרכו את הסיגנל — לגזור
> env מה-constant (`if (isBinary()) childEnv.X=...`), ה-constant נשאר source-of-truth.

---

## §5 — נושאים פתוחים (לא חלק מהטמעת ה-FE — לדיון בהמשך)

| נושא | מצב | הערה |
|------|-----|------|
| **pino-pretty worker** | ✅ **נבדק ונפתר** (spike 27/06) | [`core/log/index.ts:31-49`](../../packages/core/src/log/index.ts) `transport: {target:"pino-pretty"}` רץ ב-worker thread (`thread-stream`) עם `require.resolve` דינמי. **אומת שנשבר ב-compile**: `Cannot find package 'real-require' from thread-stream/lib/worker.js → the worker thread exited`. JSON path (בלי transport) עובד. **הפתרון (מאומת בבינארי):** להחליף ל-pino-pretty **כ-stream ישיר in-process** — `import pretty from "pino-pretty"; pino({level}, pretty({colorize,...}))` — בלי worker, בלי gate, עובד אחיד dev+binary, ומבטל גם את מלכודת [bun#19725](https://github.com/oven-sh/bun/issues/19725) (worker+embed). שינוי קטן ב-`createPino`. רקע קהילתי: [bun#10246](https://github.com/oven-sh/bun/issues/10246)/[#23062](https://github.com/oven-sh/bun/issues/23062)/[#5410](https://github.com/oven-sh/bun/issues/5410)/[Archon#960](https://github.com/coleam00/Archon/issues/960); [bun-plugin-pino](https://github.com/vktrl/bun-plugin-pino) הוא multi-file, לא ל-compile. |
| **תיקיית state מאוחדת** (plugin + DATA_DIR + recordings + config) | 🟢 **הוכרע 27/06** | מאחד את ה-plugin (שהיה נדחה) ואת `DATA_DIR` למקום אחד יציב: **`~/.config/drive-coding/`** (ראה §5.1). פותר גם את חילוץ ה-plugin (לדיר קבוע, לא temp) וגם את ה-cwd-relative data. |
| **cross-compile** | 💭 | `--target` תומך win/linux/mac (x64+arm64). flags של Windows metadata (icon/hideConsole) לא עובדים ב-cross-compile. |
| **bytecode/minify** | 💭 nice-to-have | `--minify --bytecode` לזמן-עליה. |

### §5.1 — תיקיית state מאוחדת `~/.config/drive-coding/` (הוכרע 27/06)

החלטת המשתמשת: לאחד plugins + recordings + config + cache למקום **יציב** אחד (לא cwd,
לא temp) — הרחבת התקדים הקיים [`cli-config-file.ts:29`](../../packages/backend/src/acp/cli-config-file.ts)
(`cli-specs.jsonc` כבר שם). אחיד בכל הפלטפורמות דרך [`getHomeDir()`](../../packages/backend/src/delivery/http-options.ts)
(`HOME` / `USERPROFILE` / `os.homedir()`).

```
~/.config/drive-coding/            ← join(getHomeDir(), ".config", "drive-coding")
  cli-specs.jsonc                  ← קיים (cli-config-file.ts)
  plugins/
    prompt-injector.ts             ← חולץ מהבינארי (חד-פעמי לפי hash/גרסה, לא temp)
    <claude-code prompt>           ← עתידי (הזרקת prompt-מערכת פר-CLI)
  recordings/                      ← היה data/recordings (cwd)
  cache/  (+ cache/proxy/)         ← היה data/cache, data/cache/proxy (cwd)
  wire-recordings/                 ← היה data/wire-recordings (cwd)
```
- **נתיבים פר-OS:** `C:\Users\<user>\.config\drive-coding\` · `/home/<user>/.config/drive-coding/`
  · `/Users/<user>/.config/drive-coding/` (אחיד — לא OS-native; הוכרע לטובת פשטות).
- **שינויי קוד:** (1) helper מרכזי `getStateDir()` (לאחד עם cli-config-file.ts); (2)
  [`server.ts:80,84-85,104`](../../packages/backend/src/server.ts) — `path.resolve("data/...")`
  → `join(getStateDir(), ...)`; (3) **plugin extraction** ב-boot — חילוץ ה-`prompt-injector.ts`
  המוטמע ל-`plugins/` (אם חסר/גרסה שונה) → `plugin-config.ts` מצביע לשם במקום `import.meta.dirname`.
- **חל גם ב-dev/non-binary** (אחידות) — לא רק בבינארי.
- ✅ **migration לא נדרש (הוכרע 27/06):** אין recordings חיים, cache לא קריטי (ייבנה מחדש בנתיב
  החדש). מוריד regression-risk → `slice-state-dir` הופך ל-slice פשוט (complexity ~4, calev light).
  cli-specs כבר שם.
- **חופף ל-`slice-session-prefs-per-cwd`** (roadmap §C) שתכנן `~/.drive-coding/` — ההכרעה כאן
  (`~/.config/drive-coding/`) גוברת ומעדכנת אותו.

---

## §6 — דרישות נוספות ל-brief (נקלטו 27/06)

### §6.1 — Audit: flags של ה-CLI מול env vars
דרישה: **כל מה שהועבר עד כה כ-env var צריך flag מקביל** (או החלטה מודעת להשאיר env-only).
מצב נוכחי — ה-bin חושף 4 flags ([`bin/drive-coding.ts`](../../packages/backend/src/bin/drive-coding.ts)):
`--port`/`PORT`, `--opencode-bin`/`OPENCODE_BIN`, `--fe-static-dir`/`FE_STATIC_DIR`, `--cors-origins`/`CORS_ORIGINS`.

env vars של production **בלי flag** (gap):
| env | תפקיד | מקור | המלצה |
|-----|-------|------|-------|
| `OPENCODE_ARGS` | args override ל-opencode (JSON array) | [`cli-config.ts:76`](../../packages/backend/src/acp/cli-config.ts) | flag |
| `CLI_SPECS_FILE` | override לקובץ specs (יושב ב-`~/.config/drive-coding/`) | `cli-config-file.ts` | flag `--cli-specs` |
| `FS_BROWSE_ALLOWED_BASE` | sandbox ל-fs browse (**אבטחה**) | [`http-history.ts:139`](../../packages/backend/src/delivery/http-history.ts) | flag |
| `LOG_LEVEL`/`LOG_NS`/`LOG_FORMAT` | logging | [`core/log/config.ts`](../../packages/core/src/log/config.ts) | flag `--log-level` לפחות |
| `WIRE_RECORD`/`LOG_WIRE` | debug | server.ts / log/config.ts | env-only (debug) — החלטה מודעת |
| **state-dir** (חדש) | override ל-`~/.config/drive-coding/` (§5.1) | — | flag `--state-dir` |

→ ה-brief צריך טבלת audit מלאה עם הכרעה פר-env (flag / env-only / both), ולעדכן את `HELP`.

### §6.2 — CLI detection (אילו CLIs מותקנים) — **לא קיים**
מקור-האמת: `CLI_SPECS` ([`core/schemas/agent.ts:30`](../../packages/core/src/schemas/agent.ts)) — 5 kinds:
`opencode`, `claude`, `gemini`, `codex`, `qoder` (`CLI_KINDS`). **אין מנגנון detection** — ה-bin
עושה preflight ל-`opencode` **בלבד** ([`bin/drive-coding.ts:113-122`](../../packages/backend/src/bin/drive-coding.ts)).
חסר: פונקציה שעוברת על `CLI_KINDS`, בודקת `which`/`where` (או override.bin) לכל אחד, ומחזירה
את הזמינים — לטובת preflight מלא + חשיפה ל-FE (connect form יציג רק agents מותקנים).
→ **הוצא מ-scope (27/06):** כל ה-CLI management (detection + specs) הוא concern של המנוע
הרב-ספקי → שייך לפרויקט **provider** (Track A), לא לבינארי. לא חלק מהסלייס הזה.

---

## §7 — מקורות

- [Bun — Single-file executable](https://bun.com/docs/bundler/executables) (נקרא מלא, 1339 שורות)
- [Bun — Fullstack dev server](https://bun.com/docs/bundler/fullstack) · [Standalone HTML](https://bun.com/docs/bundler/standalone-html)
- [oven-sh/bun#15734](https://github.com/oven-sh/bun/issues/15734) — SvelteKit + `--compile` (פתוח)
- תקדים פנימי: `claude-code-connection` (`build:wrapper` = `bun build --compile … .exe`)
- חבילת ה-bunx הקיימת (לא בינארי): [`slice-release-package.md`](slice-release-package.md)
