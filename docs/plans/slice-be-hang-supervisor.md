# Slice — be-hang-supervisor — תוכנית

> **תאריך**: 2026-07-05
> **סטטוס**: ✅ **READY — אביגיל r3 (2026-07-05, 0 findings)**. r1 USABLE-AFTER-FIX (5 findings) → תוקנו;
>   r2 תפסה `bootAt const` (warmup מיָרה מוקדם אחרי respawn) → תוקן ל-`let`+reset; r3 אימתה עקביות → READY.
>   מוכן ל-dispatch. (reports: `be-hang-supervisor-avigail{,-r3}.md`)
> **Complexity**: 8/10 (verifier: **heavy** — צפיפות edge-cases + blast-radius + אימות-hang חי על Windows)
> **תלות**: [] · **base**: `dev` (עצמאי — לא תלוי ב-`be-shutdown-hardening`; ר' §10)
> **מקור**: `docs/investigations/2026-07-01-be-shutdown-socket-health.md` §repro-ג + §השלכה + §"האם המודל".
>   ה-repro הוכיח: BE בריא עמיד; ה-hang (event-loop block) הוא השורש; kill-tree/graceful **רצים מתוך
>   ה-loop** → כש-BE תקוע לא ירוצו. **הפתרון היחיד = watchdog חיצוני-ל-loop.**

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/be-hang-supervisor -b slice/be-hang-supervisor dev
cd .worktrees/be-hang-supervisor
pnpm install && pnpm hooks:install
```

### Run (עם ה-supervisor החדש)
```bash
# היום:  node scripts/dc-launch.mjs [flags]
# אחרי:  node scripts/dc-supervisor.mjs [flags]   ← עוטף את dc-launch, מנטר, מתאושש
node scripts/dc-supervisor.mjs
```
- ‏ה-supervisor הוא **תהליך-node עצמאי** (לא bun) — חייב לשרוד גם כש-ה-BE (bun) תקוע.
- ‏ל-BE אמיתי לבדיקה: `PORT=4000 node scripts/dc-supervisor.mjs` (ה-supervisor מריץ את dc-launch שמריץ את bun).

### כלי-אימות (Windows)
```powershell
# עץ-התהליכים: supervisor(node) → dc-launch(node) → bun(BE) → npx→node (agents)
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='bun.exe'" | Select ProcessId,ParentProcessId,CommandLine
# פורט על PID
Get-NetTCPConnection -LocalPort 4000 -State Listen | Select OwningProcess
# בדיקת RSS של ה-BE (לא בסלייס הזה — follow-up; רק להתמצאות)
Get-Process -Id <bePid> | Select WorkingSet64
```

### הזרקת-hang לאימות (חובה — אין hang טבעי לשחזור)
ה-repro (§repro-ג) לא שחזר hang טבעי. לכן ה-DoD מזריק hang דטרמיניסטי דרך **endpoint-דיבוג ייעודי**
שנוסף מאחורי env-flag (Commit 1, §4). מפעילים אותו → ה-event-loop נחסם → `/api/health` מפסיק לענות →
ה-supervisor אמור לזהות + kill-tree + restart.

### Reading list
**must-read**:
- `docs/investigations/2026-07-01-be-shutdown-socket-health.md` — **§repro-ג** (ה-hang לא שוחזר → agnostic),
  **§השלכה** (watchdog חיצוני = הפתרון היחיד), **§"האם המודל"** (וקטורי-חנק; single-process לגיטימי).
  זה ה-brief-שמאחורי-ה-brief.
- `scripts/dc-launch.mjs` — **מה שעוטפים**. spawn של `bun` (23-27, `stdio:"inherit"`, forward exit).
  ה-supervisor מריץ אותו כ-child.
- `packages/backend/src/delivery/http.ts` — `/api/health` (4-6). **synchronous, על ה-loop** → אם הלולאה
  תקועה, לא עונה. זה ה-probe target. (אל תשנה אותו — הוא מושלם כאות-hang.)
- `packages/backend/src/bin/drive-coding.ts` — `await import("../server.js")` (184) מפעיל את השרת.
- `packages/backend/src/server.ts:220` — **מקור-האמת ל-PORT** (`Number(process.env.PORT ?? 4000)`).
  ה-supervisor חייב את אותו PORT ל-probe; ה-קבוע ב-§1b זהה לו. (הערה: `drive-coding.ts:19` הוא טקסט-HELP, לא הקריאה.)
- `D:\UserProjects\AI\CodeNomad\packages\electron-app\electron\resources\cli-supervisor.cjs` — **התבנית**.
  spawn+forward-stdio (108-116), shutdown-handlers (64-76: SIGTERM/SIGINT/disconnect→terminate child),
  escalation SIGTERM→(grace)→SIGKILL (44-62). **להעתיק את המבנה, להוסיף את ה-health-probe + restart.**
- `D:\UserProjects\AI\CodeNomad\packages\server\src\workspaces\runtime.ts` — **תבנית kill-tree**
  (262-430): Windows `taskkill /PID <pid> /T /F` (307-332), POSIX `kill(-pid)` (278-291), escalation (418-428).

**reference**:
- `docs/plans/slice-be-shutdown-hardening.md` — הסלייס-האח (kill-tree *בתוך* ה-BE לצאצאי-agent).
  ה-supervisor עושה kill-tree ברמת **תהליך-ה-BE כולו** (חיצוני). ר' §10.

## §1 — מטרה

אחרי הסבב: כש-ה-BE **נתקע** (event-loop block — ה-hang האמיתי מ-§repro, `http=000` על פורט מאזין) —
**תהליך-supervisor חיצוני מזהה זאת תוך ~30ש', הורג את כל עץ-ה-BE (kill-tree), ומרים אותו מחדש** —
אוטומטית, בלי התערבות-משתמש. במקום "פורט תקוע יומיים על PID מת" (הכאב המאומת) → התאוששות תוך שנייה עד
דקה. ה-supervisor **agnostic לשורש-ה-hang** (שלא שוחזר) — הוא לא מנסה למנוע את ה-hang, אלא **מתאושש
ממנו**. הגנה מפני restart-loop: אם ה-BE נתקע-מחדש מיד שוב ושוב → backoff + כניעה מתועדת (לא crash-loop אינסופי).

> ⚠️ **מה ה-supervisor הזה עושה — ומה לא** (מסגור מ-§repro):
> - ✅ **מזהה hang** — probe חיצוני-ל-loop (בתהליך נפרד), האות היחיד שעובד כש-ה-loop תקוע.
> - ✅ **מתאושש** — kill-tree של עץ-ה-BE מבחוץ (taskkill /T Windows / process-group POSIX) + restart.
> - ✅ **מונע crash-loop** — backoff, max-restarts-in-window, כניעה-מתועדת.
> - ❌ **אינו מתקן את שורש-ה-hang** — לא שוחזר (§repro-ג), agnostic במכוון.
> - ❌ **אינו מנטר RSS/memory** — נדחה ל-follow-up `be-supervisor-rss` (§2). ה-slice הזה = **hang בלבד**.
> - ⚠️ **residual — פורט-מוחתם-בקרנל**: אם אחרי kill-tree הפורט **עדיין** נעול על PID מת (החתמת-handle
>   ברמת-OS ששרדה גם את force-kill — ר' §6), ה-restart ייכשל ב-bind. מיטיגציה: retry-bind עם backoff;
>   אם מתמיד → כניעה מתועדת. ה-supervisor **מקטין** את הסבירות (kill-tree מהשורש תופס את מחזיק-ה-handle
>   האמיתי, לא רק נכדים — בניגוד להריגות-החלקיות שנכשלו ב-repro), אבל לא יכול לרפא leak ברמת-קרנל.

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| `scripts/dc-supervisor.mjs` — עוטף את `dc-launch.mjs`, מנטר, מתאושש | ✅ | Commit 1 |
| health-probe חיצוני (`GET /api/health`, timeout קצר, K כשלונות רצופים) | ✅ | Commit 1 |
| kill-tree חיצוני של עץ-ה-BE (Windows `taskkill /T` / POSIX group) + escalation | ✅ | Commit 1 |
| restart אחרי hang + backoff + max-restarts-in-window | ✅ | Commit 1 |
| forward stdio (child→supervisor→terminal) + forward SIGINT/SIGTERM לילד | ✅ | Commit 1 |
| endpoint הזרקת-hang לאימות (`/api/debug/hang`, מאחורי env-flag) | ✅ | Commit 1 (test-only) |
| retry-bind על restart אם הפורט תפוס-זמנית | ✅ | Commit 1 |
| **מעקב RSS/memory + recovery על OOM-risk** | ❌ | **follow-up `be-supervisor-rss`** — סופג את ה-`memoryGuard` ה-in-process (roadmap) |
| החלפת `npx` בבינארי-ישיר (מקטין נכדים) | ❌ | slice נפרד (`binary-dist`) |
| תיקון שורש-ה-hang (event-loop block) | ❌ | לא שוחזר (§repro-ג); ה-supervisor מתאושש בלי לדעת שורש |
| HTTP/SSE transport / session-owner ב-backend | ❌ | roadmap Future (multi-user) |

## §3 — Architecture diagram

```
                    scripts/dc-supervisor.mjs   (node — עצמאי, שורד hang של bun)
                      │
                      ├─ spawn: node dc-launch.mjs [flags]   ← detached(POSIX) / חדש-group(Win)
                      │    └─ spawn: bun drive-coding.ts (BE, LISTEN :PORT)
                      │         └─ spawn: npx→node (agents)
                      │
                      ├─ forwardStream(child.stdout/stderr → process)   [תבנית cli-supervisor:25-30]
                      ├─ on SIGINT/SIGTERM/disconnect → killTree(child) + exit   [cli-supervisor:64-76]
                      │
                      └─ setInterval(PROBE_INTERVAL):                    ← הלב. חיצוני-ל-loop-של-BE.
                           fetch(`/api/health`, timeout=PROBE_TIMEOUT)
                             ok    → fails=0
                             fail  → if (++fails >= MAX_FAILS):
                                       log("BE hung — recovering")
                                       killTree(childPid, "SIGTERM") →(grace)→ "SIGKILL"   [runtime.ts:365-428]
                                       if (restartsInWindow > MAX_RESTARTS): surrender+exit(1)
                                       else: respawn (retry-bind עם backoff)
```

## §4 — Commits

### Commit 1 — dc-supervisor.mjs (health-probe + kill-tree + restart) (approach: integration + live)

**קבצים חדשים**: `scripts/dc-supervisor.mjs`
**קבצים שמשתנים**: `packages/backend/src/delivery/http.ts` (endpoint הזרקת-hang, test-only), `package.json` (script)

#### 1a — endpoint הזרקת-hang (test-only, מאחורי env-flag)
ב-`http.ts`, **רק כש-`process.env.DC_DEBUG_HANG === "1"`**, רשום:
```ts
if (process.env.DC_DEBUG_HANG === "1") {
  app.get("/api/debug/hang", (c) => {
    const ms = Number(c.req.query("ms") ?? "60000")
    const end = Date.now() + ms
    while (Date.now() < end) { /* busy-block the event loop */ }
    return c.json({ hung: ms })
  })
}
```
> ‏גייטד ב-env → **לא קיים בפרודקשן**. משמש את ה-DoD להזרקת hang דטרמיניסטי (§repro-ג השתמש בדיוק בזה).
> ‏busy-loop סינכרוני = חוסם את ה-event-loop לגמרי → `/api/health` (על אותו loop) מפסיק לענות.

#### 1b — ה-supervisor
מבנה (תבנית `cli-supervisor.cjs` + health-probe + restart). **node טהור, אפס תלויות** (fetch גלובלי מ-Node 22.5+;
`AbortSignal.timeout()` ל-probe-timeout — ר' §4#2). קבועים module-level (§9 מגדיר defaults):
```js
const PROBE_INTERVAL_MS = 10_000   // כל כמה זמן לבדוק בריאות
const PROBE_TIMEOUT_MS  = 3_000    // timeout לכל probe
const MAX_FAILS         = 3        // כשלונות רצופים → hang (≈30ש')
const KILL_GRACE_MS     = 5_000    // SIGTERM →(grace)→ SIGKILL על העץ
const MAX_RESTARTS      = 3        // בתוך RESTART_WINDOW_MS
const RESTART_WINDOW_MS = 300_000  // 5 דק'
const STARTUP_TIMEOUT_MS = 120_000 // חלון-warmup: אם ה-BE לא ענה פעם-אחת תוך זה → boot-failure (§9 row9)
const PORT = Number(process.env.PORT ?? 4000)  // == server.ts:220 (מקור-האמת ל-PORT שה-probe פונה אליו)
```
> ⚠️ **warmup-gate (אביגיל 🟡 finding 1)** — `dc-launch.mjs:15` בונה FE **סינכרונית** (`execFileSync`) *לפני*
> ה-`spawn("bun")` (23). cold-boot / bundle-stale יכול לחרוג מ-`MAX_FAILS×PROBE_INTERVAL≈30ש'` (ה-roadmap:
> `vite build` דולף 1.38GB, codex boot ~10ש'). לכן **אין לספור `fails` לפני ה-probe-המוצלח-הראשון** — ראה §4#3.
לוגיקה:
1. `spawnChild()` — `spawn("node", [dcLaunchPath, ...forwardedArgs], { stdio:["ignore","pipe","pipe"], detached: process.platform!=="win32", env: process.env })`. **`env: process.env` מפורש** (אביגיל 🟢) — קריטי ש-`DC_DEBUG_HANG`/`PORT`/סודות יזרמו supervisor→dc-launch→bun→BE. שמור `child`, `child.pid`. forward stdout/stderr. **אפס את שלושת מצבי-ה-warmup**: `ready=false; fails=0; bootAt=Date.now()` (§4#3 — קריטי ש-`bootAt` מתאפס, אחרת ה-STARTUP_TIMEOUT מיָרה מיד ב-warmup שאחרי recover).
2. `probe()` — `fetch("http://localhost:"+PORT+"/api/health", {signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)})`; `res.ok` → החזר true.
3. `setInterval(PROBE_INTERVAL_MS)` — עם **warmup-gate** (אביגיל 🟡). מצב module-level `let` (מאופס בכל spawn — ר' §4#1):
   ```js
   // module-level state — spawnChild() מאפס את שלושתם בכל הרמה:
   let ready = false          // הפך true אחרי ה-probe-המוצלח-הראשון (BE האזין לפחות פעם)
   let fails = 0
   let bootAt = Date.now()    // ← let, לא const! spawnChild() מאפס ל-Date.now() בכל respawn (אביגיל r2 🟡)
   // בתוך ה-interval:
   const ok = await probe()
   if (ok) { ready = true; fails = 0; return }
   if (!ready) {              // עדיין ב-warmup (בונה FE / bun boot) — אל תספור hang
     if (Date.now() - bootAt > STARTUP_TIMEOUT_MS) { log("BE never became healthy — boot failure"); recover() }
     return
   }
   if (++fails >= MAX_FAILS) recover()   // רק אחרי שהיה בריא פעם → זיהוי-hang אמיתי
   ```
   > ‏**warmup**: לפני ה-probe-המוצלח-הראשון (`ready=false`) כשלים **לא נספרים** כ-hang — ה-BE עדיין boots
   > (בניית-FE סינכרונית ב-dc-launch + bun boot). safety: אם לא הבריא תוך `STARTUP_TIMEOUT_MS` → boot-failure → recover.
   > ‏🔴 **חובה (אביגיל r2)**: `bootAt` הוא `let` ש-`spawnChild()` **מאפס ל-`Date.now()` בכל הרמה** — אחרת אחרי recover
   > ה-`STARTUP_TIMEOUT` מחושב מול ה-boot המקורי (כבר > 120s) ומיָרה מיד על ה-warmup השני. מאפסים את שלושתם יחד (`ready`,`fails`,`bootAt`).
   > ‏guard: אל תריץ probe חופף (flag `probing`); אל תריץ recover בזמן restart (flag `recovering`).
4. `recover()` — `recovering=true`; log; `killTree(child.pid, "SIGTERM")`, `setTimeout(()=>killTree(child.pid,"SIGKILL"), KILL_GRACE_MS)`; המתן ל-`child "exit"`; בדוק restart-budget → `respawnWithBackoff()` או `surrender()`.
5. `killTree(pid, signal)` (module-level, **תבנית runtime.ts:365-428**):
   - ‏Windows: `spawnSync("taskkill", ["/PID", String(pid), "/T", ...(signal==="SIGKILL"?["/F"]:[])])`. `/T`=tree.
   - ‏POSIX: `process.kill(-pid, signal)` (negative=group; דורש `detached:true` ב-spawn). על `ESRCH`→כבר מת. fallback `process.kill(pid, signal)`.
   - ‏try/catch — לעולם לא זורק החוצה.
6. `respawnWithBackoff()` — רשום timestamp ל-`restarts[]`; נקה ישנים (>RESTART_WINDOW_MS); אם `restarts.length>MAX_RESTARTS` → `surrender()`. אחרת: `spawnChild()` מחדש. **retry-bind**: אם ה-BE החדש נופל תוך <5ש' עם EADDRINUSE (פורט תקוע) → backoff מדורג (1s,2s,4s) ונסה שוב עד N; ריצת log.
7. `surrender()` — log ברור ("BE נתקע N פעמים ב-window — עוצר, נדרשת התערבות ידנית"), `process.exit(1)`.
8. shutdown-handlers (תבנית cli-supervisor:64-76): `SIGINT`/`SIGTERM` → `clearInterval` + `killTree(child.pid,"SIGTERM")` →(grace)→ SIGKILL → `process.exit(0)`.
9. `child.on("exit")` — אם **לא** ב-`recovering` (כלומר ה-BE מת מעצמו, לא ביוזמתנו) → זה crash לא-hang; החל את אותו restart-budget (respawn או surrender).

#### 1c — package.json
הוסף script (אל תשנה את `start` הקיים — additive):
```jsonc
"start:supervised": "node scripts/dc-supervisor.mjs"
```

**testing (integration)**: harness שמריץ `dc-supervisor.mjs` מול BE אמיתי עם `DC_DEBUG_HANG=1`, קורא
`/api/debug/hang?ms=60000`, ומוודא: (א) `/api/health` מפסיק לענות; (ב) תוך ~30-40ש' ה-supervisor
מזהה+הורג+מרים; (ג) `/api/health` חוזר לענות אחרי ה-restart. Windows-חי ב-DoD; ה-harness עצמו
`it.skip` ב-CI אם flaky (timing) — נאמת חי.

**Verification**:
```bash
node --check scripts/dc-supervisor.mjs        # syntax
pnpm --filter @drive-coding/backend typecheck  # http.ts (endpoint) עדיין מקמפל
pnpm --filter @drive-coding/backend test
```

## §5 — DoD

| בדיקה | איך |
|---|---|
| **Windows חי: זיהוי hang + restart** | `PORT=4000 DC_DEBUG_HANG=1 node scripts/dc-supervisor.mjs`; חבר agent; `curl "localhost:4000/api/debug/hang?ms=60000"`; **תוך ≤40ש'** הלוג מראה "BE hung — recovering" + kill + respawn; `curl /api/health` → 200 אחרי restart |
| **Windows חי: הפורט משתחרר אחרי kill-tree** | בזמן ה-recover → `Get-NetTCPConnection -LocalPort 4000` מתפנה, ואז נתפס-מחדש ע"י ה-BE החדש (PID **חדש**) |
| **Windows חי: אין יתומים אחרי recover** | אחרי restart → אין bun/node/npx יתום מה-BE הישן (`Get-CimInstance`) |
| **restart-loop guard** | הזרק hang **מיד** אחרי כל restart (או הורד MAX_RESTARTS ל-2 זמנית) → אחרי החריגה: log "surrender" + supervisor יוצא exit(1), **לא** לולאה אינסופית |
| **BE בריא — אפס התערבות** | ריצה רגילה 5+ דק' בלי hang → **אפס** kill/restart; probe עובר תמיד; לוג שקט |
| **SIGINT מפיל הכול נקי** | Ctrl+C על ה-supervisor → הורג את עץ-ה-BE כולו (kill-tree) + הפורט משתחרר + supervisor יוצא 0 |
| **stdio forward** | לוגי ה-BE (pino) מופיעים דרך ה-supervisor בטרמינל כרגיל |
| **endpoint gated** | בלי `DC_DEBUG_HANG=1` → `GET /api/debug/hang` מחזיר 404 (לא רשום) |
| **POSIX unit (kill-tree)** | (אם מריצים על Linux/mac ב-CI) grandchild → ESRCH אחרי killTree; Windows `skipIf` |
| build-gate | `node --check` + typecheck (backend) + כל הטסטים ירוקים |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| 🔴 recover בטעות על BE **בריא-אך-איטי** (probe timeout על עומס-רגעי) | GC pause / spawn-storm רגעי | `MAX_FAILS=3` רצופים (≈30ש') — לא כשל-בודד; `PROBE_TIMEOUT=3s` נדיב; §repro הוכיח BE בריא עונה 4-62ms גם תחת עומס |
| 🔴 `taskkill /T /F` / `kill(-pid)` הורג יותר מדי (למשל את ה-supervisor) | tree/group semantics | ה-child הוא `dc-launch` ב-group/tree **נפרד** מה-supervisor; POSIX `detached:true` נותן group משלו; Windows `/T` מושרש ב-child.pid בלבד. DoD "supervisor שורד" |
| 🔴 **פורט מוחתם-בקרנל שורד גם kill-tree** (הבאג של היום — PID מת מחזיק port) | Windows handle-leak אחרי force-terminate | ה-supervisor הורג **מהשורש** (dc-launch→bun) בעוד המחזיק **חי** → OS משחרר נקי (בניגוד להריגות-חלקיות שנכשלו ב-repro). residual: retry-bind + backoff; אם מתמיד → surrender מתועד. **תיעוד כמגבלה ידועה** (§1) |
| restart-loop אינסופי (hang חוזר מיד) | שורש-hang לא ידוע | `MAX_RESTARTS=3`/`RESTART_WINDOW=5min` → surrender+exit(1). DoD בודק זאת |
| `fetch`/`AbortSignal.timeout` לא זמין | גרסת Node ישנה | Node 22.5+ (AGENTS.md) — קיים. `node --check` + DoD חי מוודא |
| ה-supervisor עצמו נתקע | — | טריוויאלי: רק timer+fetch+spawn, אפס work כבד, אפס תלויות. לא קורא stdin, לא מעבד frames |
| הזרקת-hang endpoint דולף לפרוד | — | gated ב-`DC_DEBUG_HANG==="1"`; DoD מוודא 404 בלי הדגל |
| `taskkill` sync חוסם את ה-supervisor | spawnSync | קצר (חוזר מיד); ה-supervisor idle ממילא בזמן recover |
| double-probe / recover חופף | timing | flags `probing`/`recovering` (§4#3) |
| i18n / Svelte / OneCLI | 3-הקבועים | script + BE endpoint gated; אין UI, אין Svelte, אין SDK. (מחרוזות-לוג באנגלית — כמו dc-launch) |

## §7 — Escalation triggers

- ‏kill-tree מפיל את ה-supervisor עצמו או תהליכים לא-קשורים → **עצור**, שאל מרדכי (🔴).
- ‏אחרי kill-tree הפורט **לא** משתחרר אף פעם (גם עם retry-bind) → תעד; ייתכן שצריך גישה אחרת
  (SO_REUSEADDR ב-BE / bind-retry ב-server.ts) — הכרעת-API, שאל מרדכי.
- ‏ה-BE הבריא מקבל recover שגוי (false-positive) חוזר → כוונן MAX_FAILS/timeout, תעד; אם עקבי — שאל.
- ‏`fetch`/`taskkill`/`process.kill(-pid)` מתנהג שונה מהצפוי על Windows → תעד, שאל.

## §8 — Complexity score

8/10: קובץ-חדש + 2 שינויים (+1), ניהול-תהליכים cross-platform Windows+POSIX (+2), **טופולוגיית-הרצה
חדשה** (supervisor מעל כל ה-BE — blast-radius: שולט בכל התהליך) (+2), restart-loop-safety + retry-bind
+ backoff (+1), אימות דורש **הזרקת-hang חי על Windows** + edge-cases צפופים (hang/restart-loop/bind-fail/
false-positive) (+2). → **verifier: heavy (calev-heavy)** — לא בגלל visual/FE, אלא צפיפות ה-edge-cases,
ה-blast-radius, וה-אימות-החי הקשה-לאוטומציה. (RSS ירד ל-follow-up → לא ניפח מעבר ל-8.)

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | PROBE_INTERVAL / TIMEOUT / MAX_FAILS | 10s / 3s / 3 (≈30ש' לזיהוי) | ❌ |
| 2 | KILL_GRACE (SIGTERM→SIGKILL) | 5000ms (עקבי עם be-shutdown) | ❌ |
| 3 | MAX_RESTARTS / RESTART_WINDOW | 3 / 5min | ❌ |
| 4 | האם לעטוף `dc-launch.mjs` או להחליפו (לשלב את ה-FE-build פנימה) | **לעטוף** — additive, dc-launch נשאר מקור-אמת ל-FE-build | ❌ |
| 5 | retry-bind על EADDRINUSE — כמה נסיונות/backoff | 3 נסיונות, 1s/2s/4s | ❌ |
| 6 | endpoint הזרקת-hang: `/api/debug/hang` gated ב-env — מקובל? | כן (test-only, gated, 404 בלי הדגל) | ❌ |
| 7 | האם ה-supervisor צריך `on("disconnect")` (כמו cli-supervisor, ל-Electron-fork) | לא — אנחנו לא child-fork; SIGINT/SIGTERM + child-exit מספיקים | ❌ |
| 8 | לוג פורמט — pino או console פשוט (כמו dc-launch)? | console פשוט עם prefix `[dc-supervisor]` (dc-launch לא משתמש pino; ה-supervisor חייב להיות דל-תלויות) | ❌ |
| 9 | **warmup-gate** (אביגיל 🟡): איך למנוע recovery על BE שעדיין boots? | **אל תספור fails לפני ה-probe-המוצלח-הראשון** (`ready` flag, §4#3); safety `STARTUP_TIMEOUT_MS=120s` → boot-failure→recover | ❌ (נסגר) |

## §10 — יחס ל-`be-shutdown-hardening` (הסלייס-האח)

> שני הסלייסים ממקור-חקירה אחד, **עצמאיים** (`depends_on` ריק לשניהם), ומשלימים:

| נושא | `be-shutdown-hardening` | `be-hang-supervisor` (זה) |
|---|---|---|
| **מה מנקה** | צאצאי-agent (npx→node) **בתוך** ה-BE | את **כל תהליך-ה-BE** מבחוץ |
| **רץ איפה** | בתוך ה-event-loop של ה-BE | בתהליך **נפרד** (שורד hang) |
| **מתי עוזר** | happy-path shutdown (defense-in-depth) | **hang** (התרחיש האמיתי — §repro) |
| **kill-tree** | `spawn-core.kill()` (TS, in-process) | `killTree()` ב-`dc-supervisor.mjs` (JS, standalone) |

**כפילות kill-tree — מקובלת ומכוונת**: ה-supervisor הוא script עצמאי (node, אפס-build) → **לא יכול**
לייבא את `spawn-core.ts` (TS, בתוך חבילה). לכן `killTree` שלו הוא מימוש-מראה קטן (~15 שורות) של אותה תבנית
CodeNomad. context-runtime שונה (standalone-script מול in-process-TS) מצדיק את הכפילות — לא מופשט לשיתוף.

**סדר-מיזוג**: אין תלות. **גמיש** — לפי מי שעובר calev קודם. אין חפיפת-קבצים (be-shutdown נוגע ב-spawn-core/
server/ws-agent/connection-registry; זה נוגע ב-scripts/dc-supervisor.mjs [חדש] + http.ts [endpoint gated] +
package.json). **חפיפה-אפשרית יחידה**: `http.ts` — be-shutdown **לא נוגע בו**; אין קונפליקט.

**follow-up גזור**: `be-supervisor-rss` — סופג את ה-`memoryGuard` ה-in-process (`server.ts:124`) לתוך
ה-supervisor (query RSS דרך ה-OS על ה-bePid → recovery על OOM-risk). ה-supervisor הוא המקום הנכון כי הוא
**חיצוני** → רואה RSS דרך ה-OS ושורד גם OOM-native וגם hang (בניגוד ל-`memoryGuard` ה-in-process שנופל בשניהם).
```
