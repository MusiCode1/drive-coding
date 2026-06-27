# Slice — binary-core: בינארי `--compile` עולה ומגיש מקומית — תוכנית

> **תאריך:** 2026-06-27 · **סטטוס:** brief (טרם אביגיל)
> **Complexity:** 8/10 (calev-heavy)
> **depends_on:** [state-dir] — משתמש ב-`getStateDir()` לחילוץ ה-plugin
> **Base:** `slice/state-dir` (שרשור — state-dir טרם מוזג ל-dev)
> **רקע:** `docs/plans/slice-single-binary-prebrief.md` (כל החסמים נחקרו ואומתו בספייקים 27/06).
>
> ℹ️ **תלות ב-state-dir (READY, לא-מבוצע):** ה-claims על `getStateDir()`/`ensureStateSubdir()`
> מבוססים על brief `slice-state-dir` (אומת מול קוד, READY). אם ביצוע state-dir יסטה מה-brief —
> מרדכי יריץ re-check (light) על binary-core לפני dispatch. שאר ה-claims (server.ts/log/plugin-config/bin)
> מאומתים מול dev עכשיו.

---

## §0 — Pre-flight

### Worktree (שרשור על state-dir)
```bash
cd d:\UserProjects\AI\drive-coding\dev
git worktree add .worktrees/binary-core -b slice/binary-core slice/state-dir  # base = branch של state-dir
cd .worktrees/binary-core
pnpm install && pnpm hooks:install
```
> ⚠️ base הוא `slice/state-dir`, **לא** dev — binary-core תלוי ב-`getStateDir()` שנוצר ב-state-dir.

### סביבה
**Windows / PowerShell.** `bun` ב-`~/.bun/bin` (אומת 1.3.12). server/בינארי ברקע = `run_in_background`. פורט 4000.
FE build נדרש לקודג'ן — `pnpm --filter @drive-coding/frontend-v2 build` בתוך ה-worktree (gitignored).

### איך להריץ
- **בניית בינארי:** `node packages/release/scripts/build-binary.mjs` (חדש) → `packages/release/dist/drive-coding[.exe]`.
- **הרצת בינארי:** `cd <תיקייה אקראית>; <abs>/drive-coding.exe` → פתח `http://localhost:4000`.
- **dev (אימות אי-רגרסיה):** `cd packages/backend; bun src/server.ts` — pino pretty עדיין עובד, FE עדיין מ-`FE_STATIC_DIR`.
- **Tests/Typecheck/Lint:** כרגיל מהשורש.

### ספייקים מאומתים (27/06 — אין צורך לחזור עליהם)
1. `.js` נטמע כ-asset רק דרך `import … with { type:"file" }` (glob מבנדל כ-source). `Bun.file()` קורא, content-type אוטומטי.
2. `--asset-naming="[dir]/[name].[ext]"` משמר נתיב (טוקן `[dir]` לא מתועד אך עובד).
3. ה-gate `--define __IS_BINARY__=true` עובד **cross-module** (server.ts/log מיובאים); `Bun.isStandaloneExecutable`=`undefined` (לא אמין).
4. pino-pretty **transport** קורס בבינארי (`thread-stream` worker); pino-pretty **stream ישיר in-process** עובד מושלם.
5. **`.ts` מוטמע כ-asset** דרך `import … with {type:"file"}` (כמו .js — מאומת 27/06): `Bun.file()` מחזיר את ה-source הגולמי (`import type` נשמר, לא מורץ/מבונדל). ה-plugin extraction בטוח.

### Reading list (must-read)
- [`packages/backend/src/server.ts:106-117`](../../packages/backend/src/server.ts) — בלוק serveStatic (FE_STATIC_DIR).
- [`packages/backend/src/bin/drive-coding.ts:90-128`](../../packages/backend/src/bin/drive-coding.ts) — FE cascade + `existsSync` + FE_STATIC_DIR `??=`.
- [`packages/core/src/log/index.ts:31-49`](../../packages/core/src/log/index.ts) — `createPino` (ה-`transport: {target:"pino-pretty"}` שמוחלף).
- [`packages/backend/src/plugin-config.ts:27-31`](../../packages/backend/src/plugin-config.ts) — `import.meta.dirname` → `../plugins/prompt-injector.ts` `file://`.
- [`packages/backend/src/acp/bridge-manager.ts:79-89`](../../packages/backend/src/acp/bridge-manager.ts) — childEnv + plugin injection (opencode בלבד).
- `paths.ts` (מ-state-dir) — `getStateDir()`, `ensureStateSubdir()`.
- `packages/release/scripts/build.mjs` — תבנית build script קיימת (cpSync/execFileSync).

---

## §1 — מטרה

`node build-binary.mjs` מייצר **executable יחיד** (`bun build --compile`) שמטמיע את ה-BE + ה-FE,
ומריץ אותו מ-**כל תיקייה** מרים את האפליקציה על :4000, מגיש FE (מהזיכרון), API ו-WS — **בלי Bun מותקן,
בלי דיסק חיצוני**. ה-state (recordings/cache/plugins) ב-`~/.config/drive-coding/`. ה-dev path נשאר ללא רגרסיה.
**Scope = הבינארי עובד מקומית בפלטפורמה הנוכחית.** cross-compile + flags + GitHub Releases → `binary-dist`.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| `isBinary()` helper + `__IS_BINARY__` declare (core) | ✅ | Commit 0 |
| pino-pretty: transport → stream ישיר in-process | ✅ | Commit 1 |
| plugin extraction: `prompt-injector.ts` מוטמע → `getStateDir()/plugins/` ב-boot (בינארי) | ✅ | Commit 2 |
| codegen `fe-manifest.gen.ts` + serve-from-memory handler + bin gate | ✅ | Commit 3 |
| `build-binary.mjs` — compile target יחיד (current platform) + הרצה מקומית | ✅ | Commit 4 |
| **cross-compile (3 platforms)** | ❌ | `binary-dist` |
| **flags audit** (`--state-dir`/`--cli-specs`/`--log-level`) | ❌ | `binary-dist` |
| **GitHub Releases** | ❌ | `binary-dist` |
| שינוי ל-state-dir paths | ❌ | נעשה ב-state-dir |

---

## §3 — Architecture

```
build-binary.mjs:
  1. pnpm --filter frontend build → frontend-dist/   (כמו build.mjs)
  2. codegen fe-manifest.gen.ts  ← Glob(frontend-dist/**/*):
       import f0 from "<rel>" with { type:"file" }  ...
       export const FE: Record<string,string> = { "/…": f0, … }
  3. bun build --compile --define __IS_BINARY__=true \
       --asset-naming="[dir]/[name].[ext]" <bin> --outfile dist/drive-coding

‏Runtime (בינארי, __IS_BINARY__=true):
  bin: ‏מדלג על FE cascade (existsSync על $bunfs מת) ‏אלא אם FE_STATIC_DIR מפורש
  server.ts: ‏if isBinary() → app handler ‏מ-FE map (Bun.file) ‏במקום serveStatic
  log: ‏pino-pretty stream ‏ישיר (לא worker)
  plugin: ‏boot ‏מחלץ prompt-injector ‏מ-$bunfs → getStateDir()/plugins/ ; plugin-config ‏מצביע שם

‏Runtime (dev, ‏__IS_BINARY__ undefined): ‏הכל כמו היום (serveStatic, ‏transport, ‏plugins/ ‏מקומי)
```

---

## §4 — Commits

### Commit 0 — `isBinary()` gate (approach: tdd)
**קובץ חדש** `packages/core/src/binary.ts` (או `backend` — §9 Q1):
```ts
declare const __IS_BINARY__: boolean | undefined
export function isBinary(): boolean {
  return typeof __IS_BINARY__ !== "undefined" && __IS_BINARY__ === true
}
```
+ `declare global` או `.d.ts` ל-`__IS_BINARY__` כדי ש-typecheck ב-dev לא ייכשל.
**Verification:** `tdd` — בדיקה ש-`isBinary()` מחזירה `false` ב-dev (אין define). (אימות `true` בבינארי — ב-Commit 4 + ספייק שכבר אומת.)

### Commit 1 — pino-pretty in-process (approach: integration)
**משתנה** [`core/log/index.ts:31-49`](../../packages/core/src/log/index.ts) — `createPino(dest, pretty=true)`:
```ts
import pretty from "pino-pretty"
// pretty branch:
return pino({ level: "trace" }, pretty({ colorize: true, ignore: "pid,hostname", translateTime: "HH:MM:ss.l", destination: dest }))
```
> `pino-pretty` כבר dependency של core. **לא** worker — stream ישיר. אחיד dev+binary (לא מותנה ב-gate). אמת ש-`destination` עובר נכון ל-stderr.
**Verification:** `integration` — `bun src/server.ts`, לוג pretty צבעוני עדיין מופיע ב-stderr; JSON ב-stdout עדיין עובד; אין worker.

### Commit 2 — plugin extraction (approach: integration)
**חדש** `backend/src/plugin-extract.ts` — `ensurePluginExtracted(): string`:
```ts
import pluginSrc from "../plugins/prompt-injector.ts" with { type: "file" }  // ‏embedded בבינארי (.ts כ-asset — מאומת)
// ‏בבינארי: ‏dest = ensureStateSubdir("plugins") (יוצר תיקייה — finding avigail #3); ‏העתק
//          Bun.file(pluginSrc) → dest/prompt-injector.ts ‏(אם חסר/hash שונה), ‏החזר נתיב היעד.
// ‏ב-dev: ‏החזר את import.meta.dirname/../plugins/prompt-injector.ts ‏(הקיים).
```
**משתנה** [`plugin-config.ts:27`](../../packages/backend/src/plugin-config.ts) — `pluginPath = isBinary() ? ensurePluginExtracted() : path.resolve(import.meta.dirname, "../plugins/prompt-injector.ts")`.
**Verification:** `integration` — ב-dev: path ללא שינוי, opencode spawn עובד (טסט cli-config). בבינארי (Commit 4): הקובץ מחולץ ל-`getStateDir()/plugins/`.

### Commit 3 — codegen + serve-from-memory + bin gate (approach: integration)
- **`build-binary.mjs`** (חדש, שלב codegen בלבד כאן) — `Glob("frontend-dist/**/*").scanSync()` → כותב `backend/src/fe-manifest.gen.ts` (gitignored): imports + `export const FE`.
- **`server.ts:106-117`** — ענף:
  ```ts
  if (isBinary()) {
    const { FE } = await import("./fe-manifest.gen.js")
    const indexPath = FE["/index.html"]   // string | undefined תחת noUncheckedIndexedAccess (finding #1)
    app.use("/*", (c, next) => { const p = FE[c.req.path]; return p ? new Response(Bun.file(p)) : next() })
    if (indexPath) app.get("/*", () => new Response(Bun.file(indexPath)))   // SPA fallback (guarded)
  } else if (feStaticDir) { /* serveStatic הקיים */ }
  ```
- **`bin/drive-coding.ts:90-104`** — אם `isBinary()` ו-`FE_STATIC_DIR` לא מפורש → **דלג על ה-cascade** (אל תגדיר FE_STATIC_DIR). FE_STATIC_DIR מפורש > embedded (§9 Q2).
**Verification:** `integration` — typecheck (עם `fe-manifest.gen.ts` קיים מ-codegen); dev path עדיין serveStatic.

### Commit 4 — build --compile + הרצה מקומית (approach: manual)
- **`build-binary.mjs`** — להשלים: `bun build --compile --define __IS_BINARY__=true --asset-naming="[dir]/[name].[ext]" <bin> --outfile dist/drive-coding`.
**Verification (manual):**
```powershell
node packages/release/scripts/build-binary.mjs
cd $env:TEMP; & <abs>\dist\drive-coding.exe   # run_in_background
# GET / = 200 + HTML, asset .js = 200, /api/agents = 200, WS echo, pino לא קורס
# ~/.config/drive-coding/plugins/prompt-injector.ts קיים
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck + tests + lint:i18n ירוקים | `pnpm typecheck; pnpm test; pnpm lint:i18n` |
| 2 | dev path ללא רגרסיה (serveStatic, pino pretty, plugin) | `bun src/server.ts` → FE 200 מ-FE_STATIC_DIR, לוג pretty, opencode spawn |
| 3 | בינארי נבנה | `node build-binary.mjs` → `dist/drive-coding[.exe]` קיים |
| 4 | בינארי מ-cwd אקראי מגיש FE | מ-`$env:TEMP`: `GET /` = 200 + HTML, `_app/…js` = 200 |
| 5 | API + WS בבינארי | `/api/agents` = 200, WS echo → hello |
| 6 | pino לא קורס בבינארי | אין `worker thread exited`; לוג נכתב |
| 7 | plugin מחולץ + opencode טוען בבינארי | `~/.config/drive-coding/plugins/prompt-injector.ts` קיים; spawn opencode → prompt מוזרק (אם opencode זמין) |
| 8 | FE_STATIC_DIR מפורש גובר בבינארי | `FE_STATIC_DIR=<dir> drive-coding` → מגיש מהדיר, לא embedded |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| `fe-manifest.gen.ts` עם מאות imports — זמן build/bundle | codegen | מקובל; אם איטי מדי — `--minify`. gitignored, נוצר ב-build |
| `await import("./fe-manifest.gen.js")` ב-dev (הקובץ לא קיים) | server.ts | ב-`isBinary()` בלבד → ב-dev הענף לא רץ. אבל typecheck צריך את הקובץ → codegen גם ב-dev-build, או stub gitignored committed-empty (§9 Q3) |
| plugin `.ts` מוטמע — opencode פותר deps שלו | spike מאומת ל-FE js | ה-plugin הוא raw .ts; opencode טוען עם ה-Bun שלו ופותר `@opencode-ai/plugin`. אמת חי (DoD#7) |
| pino `pretty({destination})` — API שונה מ-transport | pino-pretty API | ספייק אימת stream ישיר; אמת ש-`destination: dest` מכוון ל-stderr |
| `Bun.file($bunfs)` ב-dev (לא בינארי) | server handler | רץ רק ב-`isBinary()`; ב-dev serveStatic |
| state-dir (base) משתנה אחרי merge | שרשור | binary-core מבוסס על branch slice/state-dir; merge בסדר A→B |

---

## §7 — Escalation triggers
- `bun build --compile` נכשל לבנדל את ה-bin (resolution/circular) — עצור.
- ה-plugin המחולץ לא נטען ע"י opencode בפועל — בעיה ארכיטקטונית, עצור (לא לאלתר).
- pino-pretty stream ישיר קורס/לא מדפיס — עצור (ספייק אמר שעובד).
- צריך לשנות את `server.ts` API/WS routing (לא רק FE serving) — מחוץ ל-scope.
- ה-`__IS_BINARY__` define לא תופס ב-server.ts המיובא — עצור (ספייק אמר cross-module עובד; אם לא — בעיית build).

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| codegen + bun --compile + asset embedding (greenfield) | +2 |
| Runtime risk (בינארי boot, FE/plugin/pino בבינארי) | +2 |
| נוגע ב-server.ts boot + bin + log + plugin-config (4 קבצים, 2 packages) | +2 |
| plugin extraction + opencode חי (cross-process) | +1 |
| מבוסס על 4 ספייקים מאומתים | -1 |
| cross-platform paths | +1 |

**Score:** 8/10 → **`calev-heavy`** (Opus). verifier-phase מומלץ אחרי Commit 3 (serve+gate).

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | `isBinary()` ב-core או backend? | backend (`binary.ts`) — ה-gate נצרך ב-server/plugin (shell). core הוא pure/no-IO; gate הוא env-ish. אם נצרך גם ב-core/log → core. | ❌ |
| 2 | FE_STATIC_DIR מפורש גובר על embedded בבינארי? | כן (debug/override). embedded = default כשאין FE_STATIC_DIR. | ❌ |
| 3 | `fe-manifest.gen.ts` ב-dev (typecheck) — stub committed או codegen-always? | `fe-manifest.gen.ts` עם **`export const FE: Record<string, string> = {}`** (annotation **חובה** — בלעדיו `FE[c.req.path]` שובר typecheck, finding avigail #2) ריק **committed**, ה-codegen דורס בזמן build. typecheck עובד ב-dev, build מייצר אמיתי. | ❌ |
| 4 | plugin extraction — hash-check או תמיד מעתיק? | hash/mtime check — מעתיק רק אם חסר/שונה (חד-פעמי). | ❌ |

> אין שאלה חוסמת.

---

## סטיות מהתכנון (executor ממלא)
- (אין עדיין)
