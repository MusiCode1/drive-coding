# Slice — be-diag-harness — תוכנית

> **תאריך**: 2026-07-10
> **סטטוס**: ✅ הושלם — commits: 098bff60..a828943f (C1 hot-path-timing, C2 /api/diag, C3 watch.mjs)
> **Complexity**: 5/10 (verifier: **light / calev**)
> **תלות**: `depends_on: [be-crash-hardening]` · **base**: `slice/be-crash-hardening` @ `064f7d5a` (שרשור — טרם merge ל-dev)
> **מקור**: ה-spike השמור `slice/claude-spawn-spike` (@ `dbd70013`) — תשתית-אבחון שרצה חי ב-CodeShark ותפסה
>   וקטורי-קריסה. ה-slice הזה **מפורט** את הקבצים ל-branch מודרני (מעל crash-hardening), כ-observability קבוע.

## §1 — מטרה

לתת **עיניים** ל-BE בזמן "שימוש-לאורך-זמן": endpoint אבחון עשיר + watchdog חיצוני שרואה קפיאה +
לוג שמצביע *איזו* פעולה נתקעה. **תוסף-תצפית טהור — אפס שינוי-התנהגות** (endpoint קריאה-בלבד, לוג gated,
script חיצוני). מאפשר לענות חי: "ה-loop נתקע או OOM?" · "איזו op חנקה?" · "ה-BE עוד נושם?".

## §0 — Pre-flight

### Worktree (כבר קיים — משורשר על crash-hardening)
```bash
# .worktrees/be-diag-harness כבר נוצר מ-slice/be-crash-hardening
cd .worktrees/be-diag-harness && bun install
```
- ⚠️ **bun-only** (השרת): רק `bun`. build-gate כמו ב-crash-hardening (`cd packages/X && CI=true bun run test`).
- **שרשור**: זה בנוי **מעל** crash-hardening — `stream-bridge.ts` כבר מכיל את ה-`.catch` fixes; אתה **מוסיף** עליהם timing (additive, אל תיגע בלוגיקת-ה-catch).
- backend/provider + script — אין FE.

### Reading list (must-read)
- **מקור לפורט** (מה-branch `slice/claude-spawn-spike`, קריאה בלבד דרך `git show slice/claude-spawn-spike:<path>`):
  - `packages/backend/src/delivery/http-health.ts` — רושם `GET /api/diag` (histogram של event-loop delay + memory + per-agent). **פורט as-is** (בדוק התאמת-shape ל-API הנוכחי — §3 C2).
  - `packages/provider/src/shared/hot-path-timing.ts` — `markStart()` + `logIfSlow(op,startedAt,meta)`; threshold `HOTPATH_SLOW_MS` (default 50). **פורט as-is.**
  - `scripts/spawn-spike/watch.mjs` — watchdog חיצוני אפס-תלויות; poll ל-`/api/diag` כל שנייה; `BE_PORT` env; timeout=freeze.
- **יעדי-אינטגרציה ב-branch הנוכחי**:
  - `packages/backend/src/server.ts` — `registry` (`createInMemoryAgentRegistry`) + `connectionRegistry` (`getRuntimeInfo`) זמינים; רישום endpoints בבלוק `registerHttp(app)` … `registerAgentsHttp(app, {...})`. פה מוסיפים `registerHealthHttp` (עגן ל-symbol, לא למספר-שורה).
  - `packages/backend/src/acp/connection-registry.ts` — `getRuntimeInfo(id)` מחזיר `{pid, attached, busy, lastMessageAt}`.
  - `packages/provider/src/connection/stream-bridge.ts` — נתיב ה-relay (`JSON.parse` ב-`write`, `JSON.stringify` ב-`drainOutbound`) — יעד ה-timing.
  - `packages/provider/src/shared/spawn-core.ts` — readline→subscribers + `writeStdin` — יעד ה-timing.
  - `packages/backend/src/delivery/http.ts` — `/api/health` הבסיסי הקיים (**אל תיגע** — `/api/diag` נפרד).

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| `hot-path-timing.ts` (markStart/logIfSlow, gated ב-HOTPATH_SLOW_MS) | ✅ | C1 |
| חיווט timing ב-`stream-bridge.ts` (parse/stringify) + `spawn-core.ts` (readline/writeStdin) | ✅ | C1 |
| `GET /api/diag` (`http-health.ts`) — eventLoop histogram + memory + agents | ✅ | C2 |
| רישום `registerHealthHttp` ב-`server.ts` | ✅ | C2 |
| `scripts/watch.mjs` — watchdog חיצוני (poll /api/diag) | ✅ | C3 |
| ה-spike harness (`run-be`/`run-fe`/`setup`/`stress-8`) | ❌ | היה לבדיקת-ה-spike; לא production. אם שימושי בעתיד — slice נפרד |
| supervisor שמריץ kill-tree/restart על freeze | ❌ | `be-hang-supervisor` (§9) — זה רק **תצפית**, לא התאוששות |

## §3 — Commits

### C1 — hot-path-timing + חיווט (approach: **TDD unit + integration**)
**קבצים**: `packages/provider/src/shared/hot-path-timing.ts` (חדש, פורט) · `stream-bridge.ts` · `spawn-core.ts`
- פורט `hot-path-timing.ts` as-is (markStart/logIfSlow, `HOTPATH_SLOW_MS` default 50, `log.warn` רק כשחורג).
- **חיווט ב-`stream-bridge.ts`** (מעל ה-`.catch` של crash-hardening — additive): עטוף את `JSON.parse(line)` ב-`write()` ואת `JSON.stringify(value)` ב-`drainOutbound()` ב-`markStart`/`logIfSlow("parse"/"stringify", t, {bytes})`.
- **חיווט ב-`spawn-core.ts`**: readline→subscribers dispatch + `writeStdin`.
- **testing (TDD unit)**: `hot-path-timing.test.ts` — `logIfSlow` **לא** מלגג מתחת ל-threshold, **כן** מעל (mock logger / spy). overhead-קטן: happy-path רק `performance.now()` diff.

### C2 — `/api/diag` endpoint (approach: **integration + live**)
**קבצים**: `packages/backend/src/delivery/http-health.ts` (חדש, פורט) · `server.ts` (רישום)
- פורט `http-health.ts` (`registerHealthHttp(app, {registry, connectionRegistry})` → `GET /api/diag`).
  - ⚠️ **נקה את ה-JSDoc בראש הקובץ** — במקור כתוב "GET /api/health" (copy-paste ישן) בעוד הקוד רושם `/api/diag`. תקן ל-`/api/diag`.
- **בדוק התאמת-shape**: `registry.list()` מחזיר פריטים עם `.id`/`.cliKind`; `connectionRegistry.getRuntimeInfo(id)` מחזיר `{pid,attached,busy,lastMessageAt}`. אם ה-shape סטה מהגרסה ב-spike — התאם (אל תשבור typecheck).
- רשום ב-`server.ts` ליד בלוק `registerAgentsHttp(app, {...})` (עגן ל-symbol): `registerHealthHttp(app, { registry, connectionRegistry })`.
- **testing (integration)**: `http-health.test.ts` — `GET /api/diag` → 200 + body מכיל `eventLoop{meanMs,maxMs,p99Ms,stddevMs}`, `memory{rssMB,...}`, `agents{total,busy,list}`. (`monitorEventLoopDelay` עובד ב-bun — אומת ב-spike.)

### C3 — `watch.mjs` watchdog חיצוני (approach: **manual/live**)
**קובץ**: `scripts/watch.mjs` (חדש, פורט; שים ב-`scripts/` השורש, לא תת-תיקיית spike)
- פורט את הלוגיקה, **עם שני שינויים-חובה** (הקובץ תלוי-מיקום ותלוי-פורט → **לא** "as-is"):
  1. **`BE_PORT` default `"4010"`→`"4001"`** (`watch.mjs:22`, `process.env.BE_PORT ?? "4010"`) — כי dev-BE על 4000 וה-diag BE על 4001. (ה-spike היה 4010.)
  2. **נתיב ה-`WT`** (`watch.mjs:21`, `resolve(dirname(...), "../..")`): במקור הקובץ ב-`scripts/spawn-spike/` (2 רמות מתחת לשורש) → `../..`=שורש. ב-`scripts/` זו **רמה אחת** → שנה `"../.."`→`".."`, אחרת `.tmp/watch.log` נכתב **מחוץ** ל-worktree ונבלע ב-`catch {}`.
  3. **דוגמת-השימוש ב-JSDoc בראש הקובץ** — במקור `BE_PORT=4010 node scripts/spawn-spike/watch.mjs` (פורט+נתיב ישנים). עדכן ל-`BE_PORT=4001 bun scripts/watch.mjs`.
- שאר הלוגיקה as-is: poll `/api/diag` כל שנייה, timeout=3s=freeze, ספי lag/RSS, לוג ל-`.tmp/watch.log`.
- אפס-תלויות (fetch גלובלי). **לא ניתן ל-unit test בקלות** (לולאת-poll) → אימות **חי** ב-DoD (כולל: `.tmp/watch.log` **נוצר בתוך** ה-worktree).

## §4 — DoD

| בדיקה | איך |
|---|---|
| **`/api/diag` חי** | הרם BE (`PORT=4001 bun src/server.ts`); `curl -s localhost:4001/api/diag \| ...` → 200 + `eventLoop.maxMs`/`memory.rssMB`/`agents` קיימים |
| **eventLoop lag נמדד** | הזרק busy-loop (או עומס) → `maxMs` עולה משמעותית ב-poll הבא (ה-histogram מתגלגל) |
| **watch.mjs חי** | `BE_PORT=4001 bun scripts/watch.mjs` → טבלה מתעדכנת כל שנייה; עצור את ה-BE → תוך ~3ש' "FROZEN/down" |
| **hot-path slow-log** | `HOTPATH_SLOW_MS=1 bun ...` + תעבורה → `log.warn "slow hot-path op"` עם `op`/`durationMs`; **בלי** הדגל (default 50) → שקט בתעבורה רגילה |
| **אפס שינוי-התנהגות** | ה-relay עובד כרגיל (crash-hardening tests עדיין ירוקים); `/api/health` הבסיסי לא נגע |
| build-gate | `bun run typecheck` 0 · provider+backend tests ירוקים מול baseline · `bun run lint:i18n` |

## §5 — Risks

| סיכון | מיטיגציה |
|---|---|
| חיווט ה-timing שובר את ה-`.catch` של crash-hardening | additive בלבד — עוטף את ה-op, לא משנה control-flow; crash-hardening tests הם ה-gate |
| `monitorEventLoopDelay` לא זמין/שונה ב-bun | אומת ב-spike (300ms block→max≈306ms); DoD מוודא חי |
| `/api/diag` עצמו על ה-loop → לא עונה ב-freeze מלא | **מכוון** — ה-timeout של watch.mjs הוא האות. ה-endpoint = דאטה-עשיר + אזהרה-מוקדמת (maxMs עולה) בזמן שה-loop עוד נושם |
| shape של `getRuntimeInfo`/`registry.list` סטה מה-spike | C2 מורה לבדוק ולהתאים לפני typecheck |
| overhead בנתיב-החם | רק `performance.now()` diff + compare; `log.warn` רק כשחורג |

## §6 — Escalation
- אם ה-shape של ה-registry/getRuntimeInfo שונה מהותית מה-spike (דורש שינוי-חוזה) → שאל מרדכי.
- אם חיווט ה-timing מצריך לגעת בלוגיקת-ה-`.catch`/`.close` של crash-hardening → עצור, שאל.

## §7 — Complexity score
5/10: פורט 3 קבצים-מוכחים (+1), חיווט timing ב-2 קבצי-hot-path (+1), endpoint + רישום (+1), התאמת-shape ל-API הנוכחי (+1), אימות-חי של watchdog/lag (+1). observability טהור, אפס blast-radius על התנהגות. **verifier: light.**

## §8 — שאלות פתוחות
| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | `watch.mjs` — `scripts/` שורש או `scripts/diag/`? | `scripts/watch.mjs` (שורש; בלי תת-תיקיית spike) | ❌ |
| 2 | לחווט hot-path גם ב-`writeStdin` או רק parse/stringify? | שניהם (כמו ב-spike) — הזול, מקיף | ❌ |
| 3 | `/api/diag` gated או תמיד-פעיל? | **תמיד-פעיל** (קריאה-בלבד, זול; שימושי בפרוד לאבחון) | ❌ |

## §9 — יחס לשרשרת-היציבות
- **מבוסס על**: `be-crash-hardening` (שרשור, טרם merge). merge-order: crash-hardening → **diag-harness** → הבאים.
- **מזין את**: `be-hang-supervisor` (עתידי) — ה-supervisor יצרוך את `/api/diag` (probe) + watch.mjs (תבנית) כדי **להתאושש** מ-freeze. diag-harness = **תצפית**; supervisor = **פעולה**.
- **לא כולל** RSS-recovery / kill-tree — אלה ב-supervisor/lifecycle.
