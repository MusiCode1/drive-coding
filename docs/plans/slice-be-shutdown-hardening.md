# Slice — be-shutdown-hardening — תוכנית

> **תאריך**: 2026-07-02
> **סטטוס**: ✅ **מאושר — אביגיל READY r2** (2026-07-02, finding 🟢 יחיד [שארית hbInterval מתה] שולב).
>   עבר repro-אמיתי ששינה את Commit 2 (native-ping → `lastPingAt`+sweep על ה-`$/ping` הקיים) ומיסגר-מחדש
>   (heartbeat=ניקוי-קליינט; watchdog=slice נפרד `be-hang-supervisor`). מוכן ל-dispatch.
> **Complexity**: 7/10 (verifier: light — **אך האימות חייב להיות חי על Windows**)
> **תלות**: [] · **base**: `dev` @ `9912912` (עצמאי)
> **מקור**: `docs/investigations/2026-07-01-be-shutdown-socket-health.md` (§השורש המאומת + §לקחים מ-CodeNomad)

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/be-shutdown-hardening -b slice/be-shutdown-hardening dev
cd .worktrees/be-shutdown-hardening
pnpm install && pnpm hooks:install
```

### Run
- BE: `cd packages/backend && PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts`
  (או `bun src/server.ts` ישיר לבדיקות-lifecycle — אין צורך ב-proxy כאן).
- ‏spawn של agent אמיתי לבדיקת kill-tree: להתחבר מה-FE ל-opencode או codex
  (codex/opencode עוברים `connectSpawn`→`spawn-core`; **claude עובר in-process** — אין child, לא רלוונטי ל-kill-tree).

### Browser
- ‏רגיל (Chrome) — רק כדי ליצור agent חי; עיקר הבדיקה ב-terminal/PowerShell.

### כלי-אימות (Windows)
```powershell
# פורט על PID
Get-NetTCPConnection -LocalPort 4000 -State Listen | Select OwningProcess
# עץ-תהליכים של ה-BE (לראות npx→node נכדים)
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='bun.exe'" | Select ProcessId,ParentProcessId,CommandLine
```

### Reading list
**must-read**:
- `docs/investigations/2026-07-01-be-shutdown-socket-health.md` — **כל המסמך**. השורש (4 כשלים)
  + §לקחים מ-CodeNomad (התבניות). זה ה-brief-שמאחורי-ה-brief.
- `packages/provider/src/shared/spawn-core.ts` — `spawnInternal` (79-195, בעיקר spawn options 107-111)
  + `kill` (218-228). כאן Commit 0.
- `D:\UserProjects\AI\CodeNomad\packages\server\src\workspaces\runtime.ts` — **תבנית ה-kill-tree**
  (262-430): `tryKillPosixGroup` (278-291), `tryTaskkill` (307-332), `sendStopSignal` (365-381),
  escalation (383-429). **להעתיק את התבנית, לא את ה-WSL** (אנחנו לא תומכי-WSL בסלייס הזה).
- `packages/backend/src/acp/connection-registry.ts` — API מלא. **שים לב: אין `list()`** — Commit 1 מוסיף.
- `packages/backend/src/server.ts` — `serve()` (203-205), ה-WSS (176-198), אין shutdown (Commit 1+2).
- `packages/backend/src/delivery/ws-agent.ts` — `activeFeWs` (52), MED-8 (58), `$/ping` handler (113),
  `onConnect` set (72), `detach` (138-155). **Commit 2 כאן** (lastPingAt+sweep).
- `packages/frontend/src/lib/engines/ws-transport.ts` — ה-FE **כבר שולח** `$/ping` כל 25s (22, 113-124).
  Commit 2 מנצל זאת (לא native ping). **קריאה בלבד — לא נוגעים ב-FE.**

**reference**:
- `D:\UserProjects\AI\CodeNomad\...\connection-manager.ts` — תבנית heartbeat/sweep (33, 89-96).
- `D:\UserProjects\AI\CodeNomad\...\cli-supervisor.cjs` — תבנית shutdown-handlers (64-76).

## §1 — מטרה

אחרי הסבב: כשעוצרים את ה-BE (Ctrl+C / kill / סגירת-טרמינל) — **כל תהליכי-הבן (כולל
נכדי-`npx`) מתים, והפורט משתחרר מיד**. ובזמן-ריצה, חיבורי-WS "מתים מלוכלך" (דפדפן שקרס,
רשת שנפלה) מזוהים ומנותקים תוך ~שנייה במקום להצטבר כסוקטי-רפאים. שלוש דליפות שמצאנו
(צאצאים יתומים · אין כיבוי-מסודר · דליפת-WS) נסגרות. **אין** שינוי התנהגות גלויה למשתמש —
זו קשיחות-תשתית בלבד.

> ⚠️ **מסגור אחרי ה-repro (2026-07-02, ר' §repro במסמך-החקירה)** — ה-repro חידד את סדר-העדיפויות:
> ב-3 תרחישים של BE **בריא** (כולל `bun --watch` 5-רמות + SIGHUP דרך tmux), bun/tmux/Windows **כבר
> מנקים** את כל העץ ומשחררים את הפורט. **הפורט נתקע רק כשה-BE ב-hang** (67512, event-loop block).
> משמעות לסלייס הזה:
> - **kill-tree + graceful-shutdown (Commit 0-1)** = **defense-in-depth** (happy-path + Node-runtime/systemd
>   עתידי), **לא** התרופה לכאב הנוכחי. רצים מתוך ה-loop → כש-BE תקוע לא ירוצו.
> - **heartbeat/sweep (Commit 2)** = מנקה את דליפת-הסוקטים שהיא **החשוד לגרימת ה-hang** — עולה לעיקר.
> - **ההתאוששות מ-hang עצמה** (watchdog חיצוני) = **slice עוקב** `be-hang-supervisor`. agnostic —
>   מודד ping round-trip מחוץ-ל-loop, ועל אי-מענה → kill-tree מבחוץ. **הפתרון היחיד ל-hang.**
>
> **אימות-אמיתי — הושלם (2026-07-02, ר' §repro-ג במסמך-החקירה). הפריך את השערת-הסוקטים.** 3 ניסויי-
> stress (WS abandon ×400, WS terminate ×300, codex spawn-storm ×25/104-תהליכים) — **BE בריא לא נחנק**
> באף אחד; סוקטים היו TIME_WAIT (מתפנה לבד), לא CLOSE_WAIT. מסקנה: (א) הצטברות-סוקטים **אינה** מחנקת;
> (ב) ה-CLOSE_WAIT של 67512 = **סימפטום** של hang, לא סיבה. **השלכה על הסלייס הזה:**
> **Commit 2 יורד מ"תרופת-hang" ל"ניקוי סוקטי-רפאים של קליינט-מת"** (עדיין שימושי — שאלה 1). האימות
> **לא-חוסם עוד** — הסלייס תקף כ-defense-in-depth + ניקוי-קליינט; ה-hang עצמו → `be-hang-supervisor`.

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| kill-tree (POSIX group + Windows `taskkill /T`) ב-spawn-core | ✅ | Commit 0 |
| `detached:true` ל-POSIX ב-spawn | ✅ | Commit 0 |
| escalation SIGTERM→SIGKILL על ה-tree | ✅ | Commit 0 |
| `connectionRegistry.list()` | ✅ | Commit 1 |
| graceful shutdown (SIGINT/SIGTERM) ב-server.ts | ✅ | Commit 1 |
| ניקוי סוקטי-רפאים של קליינט-מת (`lastPingAt`+sweep על `$/ping` הקיים) | ✅ | Commit 2 |
| תמיכת WSL ב-kill (Linux-PID marker) | ❌ | future (אנחנו לא מריצים agents ב-WSL) |
| החלפת `npx` בבינארי-ישיר (מקטין נכדים) | ❌ | slice נפרד (`binary-dist`/config) |
| **watchdog חיצוני / התאוששות מ-hang** | ❌ | **slice נפרד `be-hang-supervisor`** — הפתרון ל-hang (agnostic, חוץ-loop) |
| תיקון שורש ה-hang (event-loop block) | ❌ | לא שוחזר ב-repro (§ג בחקירה); watchdog מתאושש בלי לדעת שורש |
| נעיצת גרסת codex-acp (boot-race) | ❌ | slice נפרד (ממצא 5) |
| HTTP/SSE transport (מודל CodeNomad) | ❌ | roadmap Future |

## §3 — Architecture diagram

```
עצירת-BE (SIGINT/SIGTERM)                    זמן-ריצה (WS) — קליינט-מת
  server.ts [Commit 1]                         ws-agent.ts [Commit 2]
    for id of connectionRegistry.list():         FE שולח $/ping כל 25s (קיים)
       await connectionRegistry.close(id) ─┐       → activeFeWs[id].lastPingAt = now
    httpServer.close(); wss.close()         │     sweep(20s): now-lastPingAt > 60s?
    setTimeout(exit,Nms).unref()            │       → ws.terminate() → "close" → detach
                                            │     (זיהוי hang עצמו = be-hang-supervisor,
  connectionRegistry.close [קיים]           │      חיצוני-ל-loop; לא כאן)
    → conn.close() ──────────────────────────┘
        → spawn-core.kill(bridgeId) [Commit 0]
            POSIX:  process.kill(-pid, SIG)   ← דורש detached:true!
            Win:    taskkill /PID <pid> /T /F
            escalation: SIGTERM →(2s)→ SIGKILL
```

## §4 — Commits

### Commit 0 — kill-tree + detached ב-spawn-core (approach: mixed — unit + live)

**קבצים שמשתנים**: `packages/provider/src/shared/spawn-core.ts`

1. **spawn options** (107-111) — הוסף `detached`:
```ts
child = spawn(cli.bin, [...cli.args], {
  cwd: input.cwd,
  env: childEnv,
  stdio: ["pipe", "pipe", "pipe"],
  detached: process.platform !== "win32",   // ← POSIX process-group; תנאי ל-kill(-pid)
  windowsHide: true,                          // ← אין חלון-console מהבהב
})
```
> ⚠️ **אסור** `child.unref()` — אנחנו רוצים להמשיך לנהל אותו. `detached` כאן = process-group
> בלבד, לא ניתוק. ה-stdio pipes ממשיכים לעבוד (בניגוד ל-CodeNomad שהוא `stdin:"ignore"` — **אנחנו
> חייבים stdin pipe ל-ACP**, לא לשנות!).

2. **`kill()`** (218-229) — החלף את `child.kill("SIGTERM")` ב-kill-tree (תבנית `runtime.ts:365-428`).
   **הכרעת-Windows (r3, אליעזר תפס חי — ר' §9 Q1)**: על Windows `taskkill` בלי `/F` **נכשל דטרמיניסטית**
   עבור node.exe (exit 255, *"can only be terminated forcefully"*) → graceful הוא אשליה שם (הקוד הישן
   `child.kill("SIGTERM")` ממילא היה `TerminateProcess` מיידי). לכן **branch לפי platform**:
```ts
async kill(bridgeId) {
  const entry = store.get(bridgeId)
  if (!entry) return false
  const pid = entry.child.pid
  store.delete(bridgeId)             // לפני exit — מונע notifyCrash על kill מכוון (שמור!)
  if (!pid) return true
  return new Promise<boolean>((resolve) => {
    entry.child.once("exit", () => resolve(true))
    if (process.platform === "win32") {
      killTree(pid, "SIGKILL")       // Windows: taskkill /T /F ישירות — אין graceful ל-node.exe (משחזר את ה-immediacy הישן)
    } else {
      killTree(pid, "SIGTERM")       // POSIX: graceful group-kill → escalation
      setTimeout(() => killTree(pid, "SIGKILL"), 5000)
    }
  })
}
```
פונקציית-עזר `killTree(pid, signal)` (module-level, בתוך spawn-core.ts):
- ‏POSIX: `process.kill(-pid, signal)` (negative = group). על `ESRCH` → כבר מת (בסדר).
  fallback ל-`process.kill(pid, signal)` אם ה-group נכשל.
- ‏Windows: `spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"])` — **תמיד `/F`** (graceful WM_CLOSE
  לא עובד ל-console node.exe, אומת exit-255). `signal` מתעלם על Windows; `/T`=tree kill-כל-הצאצאים.
- ‏שתי הפונקציות עוטפות ב-try/catch — kill לעולם לא זורק החוצה.

> 🔴 **הסיכון הקריטי** (§6): `process.kill(-pid)` בלי `detached:true` יכול לכוון ל-group של
> **ה-BE עצמו** ולהרוג אותו. ה-`detached` בסעיף 1 הוא **תנאי-מוקדם** לזה. לוודא ששניהם באותו commit.

**testing (unit)**: `spawn-core.test.ts` — הוסף טסט: spawn של סקריפט-node שעושה `spawn` של תת-תהליך
בעצמו (grandchild) שכותב PID לקובץ; קרא `core.kill`; ודא (POSIX) שה-grandchild מת (`process.kill(gpid,0)`
זורק ESRCH). Windows: לדלג (`it.skipIf(process.platform==="win32")`) — נאמת חי ב-DoD.

**Verification**:
```bash
pnpm --filter @drive-coding/provider test -- spawn-core
pnpm --filter @drive-coding/provider typecheck
```

### Commit 1 — connectionRegistry.list() + graceful shutdown (approach: manual + live)

**קבצים שמשתנים**: `packages/backend/src/acp/connection-registry.ts`, `packages/backend/src/server.ts`

1. **connection-registry** — הוסף לטיפוס `ConnectionRegistry` ולמימוש:
```ts
/** list — כל ה-agentIds החיים (לכיבוי-מסודר). */
list(): string[]        // return [...map.keys()]
```
> ⚠️ (אביגיל 🟢) **אל תתבלבל**: ל-`spawn-core.ts:214` **כבר יש** `list()` שמחזיר `BridgeHandle[]` —
> זה סמל **אחר** בשכבה אחרת. ה-`list()` שכאן הוא ב-`connection-registry` ומחזיר `string[]` (agentIds).

2. **server.ts** — אחרי `log.info({ port }, "listening")` (228), הוסף:
```ts
let shuttingDown = false
async function gracefulShutdown(sig: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  procLog.info({ sig }, "graceful shutdown — closing connections + children")
  const force = setTimeout(() => {
    procLog.warn({}, "shutdown timeout — forcing exit")
    process.exit(0)
  }, 8000)
  force.unref()
  try {
    await Promise.allSettled(connectionRegistry.list().map((id) => connectionRegistry.close(id)))
    echoWss.close(); agentWss.close()
    await new Promise<void>((r) => httpServer.close(() => r()))
  } catch (e) {
    procLog.error({ err: e }, "error during shutdown")
  }
  process.exit(0)
}
process.on("SIGINT", () => void gracefulShutdown("SIGINT"))
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"))
```
> ‏(הערה: ה-`sweep` interval של Commit 2 חי ב-ws-agent עם `unref()` — אין צורך לנקותו כאן.)
> `httpServer` (מ-`serve()` של `@hono/node-server`) הוא `http.Server` — או **`Http2SecureServer`/`https.Server`
> במסלול TLS** (`server.ts:203-205`, `resolveTls`). (אביגיל 🟡) **`.close(cb)` קיים על כל הווריאנטים** —
> לא חוסם; אין צורך לבדוק את סוג-השרת. ✅
> ‏`connectionRegistry.close(id)` כבר קורא `conn.close()`→`spawn-core.kill` (kill-tree מ-Commit 0).
> ‏claude in-process: `close()` שלו לא-spawn — מטופל graceful ע"י ה-registry (try/catch קיים).

**Verification**:
```bash
pnpm --filter @drive-coding/backend typecheck
pnpm --filter @drive-coding/backend test
```

### Commit 2 — ניקוי סוקטי-רפאים של קליינט-מת (`lastPingAt`+sweep) (approach: manual + live)

> **מטרה מעודכנת אחרי ה-repro**: לא "תרופת-hang" (הופרך — ר' §1) אלא **זיהוי קליינט מנותק/ללא-קליטה**
> וניקוי ה-WS שלו. מנצל את ה-`$/ping` שה-FE **כבר שולח כל 25s** (`ws-transport.ts:22,115`) — אין צורך
> ב-native `ws.ping()`. פשוט יותר, ומבטל את ה-cross-commit dependency שאביגיל תפסה (אין hbInterval ב-server).

**קבצים שמשתנים**: `packages/backend/src/delivery/ws-agent.ts` (בלבד — לא server.ts)

היום `activeFeWs: Map<string, WebSocket>` (52). מרחיבים ל-lastPingAt + sweep:
```ts
const activeFeWs = new Map<string, { ws: WebSocket; lastPingAt: number }>()
const STALE_MS = 60_000   // 2+ פעימות שהוחמצו (FE שולח כל 25s)

const sweep = setInterval(() => {
  const now = Date.now()
  for (const [, e] of activeFeWs) {
    if (now - e.lastPingAt > STALE_MS) e.ws.terminate()  // RST → "close" → detach הקיים מנקה
  }
}, 20_000)
sweep.unref()
```
**התאמות למבנה-החדש** (ה-Map ערכו שונה — `.ws`):
- `onConnect`: `activeFeWs.set(agentId, { ws: feWs, lastPingAt: Date.now() })` (במקום 72).
- MED-8 (58): `activeFeWs.has(agentId)` — ללא שינוי (בדיקת-מפתח).
- ה-`$/ping` handler (113): **הוסף** עדכון `const e = activeFeWs.get(agentId); if (e) e.lastPingAt = Date.now()`
  לפני ה-`feWs.send($/pong)`.
- `detach` (147): `activeFeWs.delete(agentId)` — ללא שינוי.

> **חשוב (מ-ה-repro)**: ה-sweep רץ על ה-event-loop → **לא מזהה hang** (כש-loop תקוע גם ה-sweep וגם
> עדכון lastPingAt קופאים). הוא מזהה **קליינט מת בזמן ש-BE בריא** — וזה כל מה שהוא מתיימר. זיהוי-hang =
> `be-hang-supervisor` (חיצוני-ל-loop).
> `terminate()` פולט `close` → `detach()` הקיים (154-155) מנקה. `sweep.unref()` → לא מעכב exit.

**Verification**:
```bash
pnpm --filter @drive-coding/backend typecheck && pnpm --filter @drive-coding/backend test
```

## §5 — DoD

| בדיקה | איך |
|---|---|
| kill-tree הורג נכדים (POSIX) | `spawn-core` unit ירוק (grandchild → ESRCH אחרי kill) |
| **Windows חי: עצירת-BE משחררת פורט** | הרץ BE:4000, חבר **opencode** (spawn יציב, לא תלוי בסדר-מיזוג מול codex-inprocess), Ctrl+C → `Get-NetTCPConnection -LocalPort 4000` **ריק** תוך <8s. (אם codex עדיין npx ב-dev — גם codex מדגים נכד; ר' §תיאום) |
| **Windows חי: אין יתומים** | אחרי Ctrl+C → `Get-CimInstance Win32_Process` — אין `opencode.exe`/node יתום מה-session |
| graceful shutdown רץ | לוג `graceful shutdown` מופיע ב-SIGINT; לא force-timeout (אלא אם hang) |
| BE עצמו לא נהרג ב-group-kill | אחרי spawn+kill של agent בזמן-ריצה (DELETE /api/agents/:id) — ה-BE **ממשיך לרוץ**, `http=200` |
| sweep מנתק קליינט-מת | חבר FE (שולח `$/ping`), נתק רשת/הרוג-דפדפן מלוכלך → הפסקת ה-ping → תוך ≤80s ה-sweep עושה `terminate` → הלוג מראה `detach` |
| (אופציה לאימות מהיר) | הורד `STALE_MS` ל-5000 זמנית → הניתוק מזוהה תוך ~7s |
| build-gate | typecheck (provider+backend) + כל הטסטים ירוקים |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| 🔴 `process.kill(-pid)` בלי detached → הורג את ה-BE עצמו | POSIX group semantics | `detached:true` ו-kill-tree **באותו commit** (0); fallback ל-single-PID; DoD "BE לא נהרג" |
| `taskkill` sync חוסם event-loop | CodeNomad משתמש spawnSync | קצר (taskkill חוזר מיד); בכיבוי לא משנה; בזמן-ריצה (deleteAndKill) נדיר |
| `detached` משנה התנהגות stdio pipe | — | לא: pipes נשמרים; **בלי `unref`**. אנחנו לא `stdin:"ignore"` כמו CodeNomad (חייבים ACP stdin) |
| ה-hang (ממצא 2) מונע מ-handler לרוץ | investigation | `setTimeout(exit).unref()` force-fallback. **הערה: Commit 2 לא פותר hang** (הופרך ב-repro §ג) — זה `be-hang-supervisor` |
| Commit 2 משנה מבנה `activeFeWs` (Map value) | ws-agent | לגעת בכל 4 האתרים (set/has/get/delete); MED-8 ו-detach משתמשים ב-`.has`/`.delete` (מפתח) — ללא שינוי |
| sweep מנתק קליינט חי בטעות (FE לא שלח ping בזמן) | timing | `STALE_MS=60s` = 2+ פעימות (FE כל 25s) — סובלנות רחבה; `terminate` → reconnect נקי |
| טסט kill-tree flaky ב-CI | process timing | unit רק POSIX + `skipIf` ל-Windows; Windows נאמת חי ב-DoD (calev) |
| i18n / Svelte / OneCLI | 3-הקבועים | BE-only, אין מחרוזות-UI, אין Svelte, אין SDK — לא רלוונטי |

## §7 — Escalation triggers

- ‏kill-tree מפיל את ה-BE עצמו (group-kill רחב מדי) → **עצור**, שאל מרדכי (סיכון 🔴).
- ‏`taskkill` לא זמין / מוחזר לא-אפס לא-צפוי על Windows → תעד, שאל.
- ‏מסתבר ש-`httpServer.close()` תלוי ולא חוזר (keep-alive sockets) → יתכן שצריך `closeAllConnections()`
  (Node 18.2+) — הכרעת-API, שאל מרדכי.
- ‏ה-BE נתקע (hang) בזמן הבדיקה → **מחוץ ל-scope הזה** (זה `be-hang-supervisor`); תעד ותמשיך.

## §8 — Complexity score

7/10: 3 commits (+0), 2 packages/layers (+1), ניהול-תהליכים cross-platform Windows+POSIX (+2),
רגישות-BE-crash (group-kill יכול להפיל BE) (+2), אימות דורש בדיקה-חיה על Windows שקשה-לאוטומציה (+2).
(Commit 2 הצטמצם אחרי ה-repro — ניקוי-קליינט על ping קיים, לא native-ping; watchdog יצא ל-slice נפרד.)
→ **verifier: light (calev)**, אך **האימות חייב להיות חי על Windows** (kill-tree + port-release
+ no-orphans לא ניתנים לאימות אמין ב-unit). לא heavy — אין visual/E2E/FE.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | escalation timeout (SIGTERM→SIGKILL) | 5000ms (CodeNomad=2000; אנחנו נדיבים יותר ל-flush) | ❌ |
| 2 | shutdown force-timeout | 8000ms | ❌ |
| 3 | `STALE_MS` / sweep interval | 60_000ms / 20_000ms (FE שולח כל 25s → 2+ פעימות סובלנות) | ❌ |
| 4 | `httpServer.close()` מול `closeAllConnections()` לסוקטי-keepalive תקועים | close רגיל; אם תקוע → escalation ל-`closeAllConnections()` (Node 18.2+) | ❌ (escalation triggers מכסה) |
| 5 | האם להוסיף `process.on("disconnect")` כמו cli-supervisor | לא — אנחנו לא child-fork של Electron; SIGINT/SIGTERM מספיק | ❌ |

## §10 — תיאום עם `slice/codex-inprocess` (2026-07-02)

> סוקר כדי ליישר קו. codex-inprocess = branch נפרד @ `61587fd`, **לא מוזג** (אביגיל READY r3, ממתין calev).

**חפיפת-קובץ יחידה — רכה**: `connection-registry.ts`. codex-inprocess מוסיף **routing** (`cliKind==="codex"
→ connectCodexInProcess`, ~106-113); אני מוסיף **`list()`** (טיפוס + מימוש, אזור אחר). **additive — merge
לא יתנגש.** שאר קבצי הסלייס שלי (spawn-core/server/ws-agent/agent.ts) — codex-inprocess **לא נגע** בהם.

**סדר-מיזוג**: אין תלות קשה (שני depends_on ריקים). merge-order **גמיש** — לפי מי שעובר calev קודם.
המזוג-שני עושה reconcile מול dev המעודכן (רק connection-registry, additive → אוטומטי).

**השלכה על ה-scope שלי — חשובה**:
- ה-**kill-tree שלי (Commit 0) חי ב-spawn-core** → מכסה רק **spawn-connections**: opencode/gemini/qoder.
- claude ו-codex הם **in-process** (`connectInProcess`/`connectCodexInProcess`) — **לא עוברים spawn-core**.
  native-codex רץ כ-child דרך `CODEX_PATH` בתוך ה-adexapter, ומנוקה ב-`close()` **שלו** (אחריות
  codex-inprocess), לא spawn-core.
- **ה-graceful-shutdown שלי (Commit 1)** קורא `connectionRegistry.close(id)` → `conn.close()` **לכל**
  connection (spawn + in-process). כלומר **הוא מפעיל את הניקוי הנכון פר-סוג** — spawn דרך kill-tree שלי,
  in-process דרך ה-close() שלהם. ✅ אין פער *כל עוד* ה-close() של כל in-process-connection מנקה את הצאצא שלו.

**escalation-triggers חדש**: אם ב-DoD מתגלה **native-codex יתום** אחרי כיבוי → זה פער ב-`connectCodexInProcess.close()`
(**לא** בסלייס שלי) → תעד ותאם עם codex-inprocess (או merge שלי ראשון והשאר ל-DoD שלהם).

**שובל לניקוי (לא חוסם)**: codex-inprocess השאיר את `codex` ב-`CLI_SPECS` כ-`npx…@latest` (לא בשימוש
בנתיב ה-in-process, ה-routing עוקף). ניקוי עתידי — לא בסלייס הזה ולא בשלהם.
