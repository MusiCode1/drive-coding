# Slice ws-error-survival — בריף

> **תאריך**: 2026-06-18
> **סוג מסמך**: בריף ביצועי לסלייס
> **סטטוס**: **מאושר ל-Commit 0-3 (READY)** · תוספת 2026-06-18: §10 (Commit 3 — observability) + §11 (ממצאי ניסוי ידני).
> **אימות אביגיל**: READY ל-Commit 0-2 (`...-avigail.md`) · **READY ל-Commit 3** (`...-avigail-commit3.md`, 2 nitpicks תוקנו בבריף)
> **Dispatch**: מותר לאליעזר רק אם `אימות אביגיל = READY` — כרגע חסום עד re-verify של Commit 3.
> **Complexity**: 5/10 (היה 4; +1 על Commit 3 observability) (verifier: light + phase על Commit 2)
> **תלויות (`depends_on`)**: []
> **Base**: dev
> **Dev tip**: `3812e4f`

---

## §0 — Pre-flight

### תלויות (חובה!)

אין תלויות — בנוי ישירות על `dev`.

### Worktree

bare repo → absolute path:

```bash
git worktree add /home/user/projects/drive-coding/dev/.worktrees/slice-ws-error-survival -b slice-ws-error-survival dev
cd /home/user/projects/drive-coding/dev/.worktrees/slice-ws-error-survival
pnpm install && pnpm hooks:install
```

### איך להריץ

- **BE**: `cd packages/backend && bun src/server.ts` (port 4000).
  התיקון לא נוגע ב-proxy/TTS → **אין צורך ב-OneCLI** להרצת הבדיקות. (להרצה מלאה
  עם proxy: `onecli run --agent voice-acp -- bun --watch src/server.ts`.)
- **Tests**: `pnpm --filter @drive-coding/backend test` — או קובץ בודד:
  `cd packages/backend && bunx vitest run src/delivery/ws-agent.test.ts`
- **typecheck**: `pnpm typecheck`
- **lint:i18n**: `pnpm lint:i18n` — חוסם עברית **בתוך string literals בלבד**; הערות
  בעברית **מותרות** (`lint-no-hebrew-in-code.sh:6` — "Comments are allowed"). הקוד הקיים ב-`ws-agent.ts` מלא
  הערות עברית — אל תתרגם אותן. כתוב string literals חדשים באנגלית.

### Browser

לא נדרש לטסטים (unit + integration עם child אמיתי). אימות ידני של ניתוק "מלוכלך"
אופציונלי בלבד.

### Reading list

**must-read**:
- `packages/backend/src/delivery/ws-agent.ts` — הקובץ המרכזי (handler ה-WS לסוכן)
- `packages/backend/src/server.ts:14-25` — ה-handler הגלובלי של uncaughtException
- `packages/backend/src/acp/bridge-manager.ts:98` — spawn ה-child (לא detached)

**reference**:
- `packages/backend/src/acp/bridge-manager.runtime.test.ts` — **תבנית** ל-spawn
  child אמיתי בטסט (`process.execPath` + סקריפט acp ב-tmpdir + ניקוי ב-afterEach)

---

## §1 — מטרה

שיבוש או ניתוק של חיבור הדפדפן — **כולל ניתוק לא-נקי** (network blip, נפילת tunnel,
רכב מאבד קליטה) — לא יפיל את ה-backend ולא יהרוג את תהליך ה-CLI agent. ה-agent שורד
את הניתוק, וטאב חדש יכול להתחבר אליו מחדש. כיום ניתוק לא-נקי מפיל את כל השרת.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| `feWs.on("error")` ב-ws-agent (detach בלי kill) | ✅ | Commit 0 |
| error listeners על echo socket + שני `WebSocketServer` | ✅ | Commit 1 |
| ריכוך `uncaughtException` ל-transient socket errors | ✅ | Commit 2 |
| MED-8 two-tab thrashing (ping-pong על הסוקט) | ❌ | slice נפרד — תועד ב-roadmap Track F |
| Backend-managed session ownership (HTTP/SSE transport) | ❌ | Future (roadmap) |

> ה-thrashing מחמיר את הבאג הזה אבל הוא בעיה אחרת (connection-arbitration, לא
> error-handling). לא מערבבים — verification נפרד.

---

## §3 — Architecture diagram

```
        ניתוק "מלוכלך" (ECONNRESET)
                  │
                  ▼
        ┌──────────────────┐
        │ feWs ('ws' socket)│  ← מצב היום: פולט 'error', אין listener
        └────────┬─────────┘
                 │ throw (EventEmitter ללא listener ל-'error')
                 ▼
        ┌──────────────────┐
        │ uncaughtException │  server.ts:14  ← מצב היום: process.exit(1)
        └────────┬─────────┘
                 │ exit
                 ▼
        ┌──────────────────┐      ┌──────────────────────┐
        │  backend process  │─────▶│ child (claude-code)   │ ← מת כ-collateral
        └──────────────────┘ kills │ (spawn, לא detached)  │
                                   └──────────────────────┘

התיקון:
  Commit 0: feWs.on('error') → detach() idempotent, בלי kill  (חוסם במקור)
  Commit 1: error listeners על echoWss/agentWss/echo-ws        (סותם דליפות נוספות)
  Commit 2: uncaughtException מסנן transient socket errors      (הגנה בעומק)
```

---

## §4 — Commits בסדר

### Commit 0 — feWs error handler + idempotent detach (approach: integration)

הליבה. כיום `feWs.on("close")` (ws-agent.ts:144-152) מבצע ניקוי נכון (detach בלי
kill). הבעיה: ב-error לא-נקי האירוע הוא `'error'`, אין listener → throw.

**קבצים שמשתנים**:
- `packages/backend/src/delivery/ws-agent.ts` — לחלץ את גוף ה-`close` לפונקציה
  פנימית `detach()` **idempotent** (guard ב-flag מקומי, נניח `let detached = false`),
  ולקרוא לה גם מ-`feWs.on("close")` וגם מ-`feWs.on("error")` חדש. בלי `child.kill`.

**API skeleton** (פנימי ל-`onConnect`, לא משנה חתימה ציבורית):

```ts
let detached = false
function detach(reason: "close" | "error", err?: unknown): void {
  if (detached) return
  detached = true
  if (reason === "error") childLog.warn({ err }, "WS error — detaching pipe")
  else childLog.info({}, "WS disconnect — detaching pipe")
  activeFeWs.delete(agentId)
  deps.bridgeManager.markDetached(agentId)
  unsub()
  rec.close()
  child.off("exit", onChildExit)
  // לעולם לא child.kill — ה-child שורד את ניתוק ה-FE
}
feWs.on("error", (err) => detach("error", err))
feWs.on("close", () => detach("close"))
```

**Verification**:
```bash
pnpm typecheck
bunx vitest run src/delivery/ws-agent.test.ts   # קובץ חדש (ראה למטה)
```

**טסט חדש** `packages/backend/src/delivery/ws-agent.test.ts` (integration):
- mock WS = `EventEmitter` עם `.send()`/`.close()` (no-op) + `readyState`. **חובה
  cast** בהעברה ל-handler: `onConnect(mockWs as unknown as import("ws").WebSocket, agentId)`
  — `ws.WebSocket extends EventEmitter` אז `emit("error")` יפעיל את ה-listener
  ב-runtime, אבל החתימה העשירה של `WebSocket` לא מסופקת structurally תחת `strict`,
  לכן ה-cast הכרחי (אחרת typecheck ייפול).
- spawn child אמיתי לפי **תבנית** `bridge-manager.runtime.test.ts` (`process.execPath`
  + סקריפט acp ב-tmpdir שעושה `setInterval`), דרך `createBridgeManager()`.
- חבר handler, ואז `feWs.emit("error", new Error("ECONNRESET"))`.
- assert: (א) אחרי tick `child.exitCode === null` (ה-child שורד); (ב) `markDetached`
  קרה / `activeFeWs` התרוקן — נבדק ע"י חיבור-mock שני שמצליח (לא נדחה ב-MED-8);
  (ג) הטסט עצמו לא קרס (לא היה uncaughtException).
- ניקוי children ב-`afterEach` (כמו ב-runtime test).

### Commit 1 — error listeners על שרתי ה-WS + echo (approach: manual)

הגנות נוספות נגד אותו מנגנון (error ללא listener) ממקורות WS אחרים.

**קבצים שמשתנים**:
- `packages/backend/src/server.ts` — `echoWss.on("error", ...)` + `agentWss.on("error", ...)`
  (procLog.warn, לא קריסה).
- `packages/backend/src/delivery/ws-echo.ts` — `ws.on("error", ...)` ל-socket ה-echo.

**Verification**:
```bash
pnpm typecheck
# manual reasoning: אין error event ללא listener על אף WS source.
```

### Commit 2 — isTransientSocketError + ריכוך uncaughtException (approach: tdd)

הגנה בעומק: גם אם דליפה לא צפויה מגיעה ל-handler הגלובלי, שגיאת-socket חולפת לא
תפיל את כל השרת. **שינוי התנהגות גלובלית — phase verify כאן.**

**קבצים חדשים**:
- `packages/backend/src/delivery/transient-socket-error.ts` — פונקציה טהורה:

```ts
const TRANSIENT_CODES = new Set(["ECONNRESET", "EPIPE", "ENOTCONN", "ECONNABORTED", "ETIMEDOUT"])
export function isTransientSocketError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return typeof code === "string" && TRANSIENT_CODES.has(code)
}
```

**קבצים שמשתנים**:
- `packages/backend/src/server.ts:14-25` — בתוך `uncaughtException` (וגם
  `unhandledRejection`, לעקביות): אם `isTransientSocketError(err)` → `procLog.warn(...)`
  + `return` (לא exit). אחרת — `process.exit(1)` **כמו היום** (שומר על קו-ההגנה
  לשגיאות אמיתיות).

**טסט** `transient-socket-error.test.ts` (TDD): code ברשימה → true; code לא ברשימה
(`EACCES`) → false; `undefined`/`null`/אובייקט בלי code → false.

**Verification**:
```bash
pnpm typecheck
bunx vitest run src/delivery/transient-socket-error.test.ts
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck + tests עוברים | `pnpm typecheck && pnpm --filter @drive-coding/backend test` |
| 2 | lint:i18n נקי | `pnpm lint:i18n` |
| 3 | ניתוק לא-נקי לא הורג child | טסט Commit 0: `feWs.emit("error")` → `child.exitCode === null` |
| 4 | classifier נכון | טסט Commit 2: codes ברשימה→true, אחר→false |
| 5 | regression — ניתוק נקי | `feWs.emit("close")` עדיין detach בלי kill; child שורד |
| 6 | regression — MED-8 עדיין עובד | אחרי detach, חיבור שני לאותו agentId מצליח; **בזמן** חיבור פעיל — נדחה 1008 |
| 7 | regression — שגיאה אמיתית עדיין מפילה | uncaughtException עם err בלי code (או EACCES) עדיין `process.exit` |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| בליעת שגיאות אמיתיות ב-uncaughtException | שינוי גלובלי | רשימת codes סגורה + לוג warn ברור; phase verify על Commit 2 |
| error+close שניהם נורים → ניקוי כפול | ws emit order | `detach()` idempotent (guard flag) |
| Hebrew ב-string literals חדשים | AGENTS lint:i18n | string literals באנגלית (הערות מותרות); pre-commit hook חוסם רק literals |
| `feWs.send()` זורק sync על socket סגור | קיים | כבר עטוף try/catch (ws-agent.ts:100) — לא לגעת |

---

## §7 — Escalation triggers

עצור ושאל את מרדכי אם:
- ריכוך `uncaughtException` נראה מסוכן מדי או לא מספיק (החלטת error-handling גלובלית)
- אין דרך לבצע integration test ל-child שורד בלי flakiness (תשתית טסט)
- מתגלה מקור WS error נוסף שלא נספר ב-§4

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| Streaming/real-time (WS) | +2 |
| State machine / async coordination (idempotency, error/close ordering) | +2 |
| Refactor של קוד קיים | +1 |
| Pure logic extract (isTransientSocketError), TDD | -1 |

**Score**: 4 / 10

**Tier**: light (`calev` mode: light) + **phase verify על Commit 2** (שינוי
התנהגות גלובלית של error-handling).

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | listener על `child.stdin` 'error' (EPIPE כשה-child מת תוך כתיבה)? | לא בנפרד — Commit 2 (isTransientSocketError) מכסה כ-safety net | ❌ |
| 2 | להחיל את הסינון גם על `unhandledRejection`? | כן, לעקביות | ❌ |
| 3 | מיקום `isTransientSocketError` — `core` או `backend`? | `backend/delivery` (תלוי ב-NodeJS.ErrnoException, IO-adjacent) | ❌ |

---

## §10 — Commit 3: Observability — שיהיה אפשר לתפוס את זה בפעם הבאה

> **מוטיבציה (מהניסוי, §11):** ב-18/6 השרת קרס במהלך הבדיקה, אבל **לא תפסנו ראיה**.
> שתי סיבות, ושתיהן מטופלות כאן:
> 1. ה-service רץ עם `LOG_WIRE=ws`, שמצמצם את ה-namespace ל-`backend.ws.wire.*` **בלבד**
>    (`core/log/config.ts:108-116`) — ובכך **מסנן החוצה** את `backend.process`
>    (ה-`uncaughtException` עצמו) ואת `backend.ws.agent` (connect/disconnect/error/detach).
>    אם השרת קורס מ-unhandled WS error, ה-journal לא רואה את זה.
> 2. אין כלל לוג על ה-error path (כי אין `feWs.on("error")`), אז גם ידנית אין מה לקרוא.

**מטרה:** כל קריסה עתידית באזור ה-WS תשאיר trace מלא — ה-lifecycle, ה-error, וה-exit —
**בלי תלות ב-env flag**. ה-observability הוא ה-enabler שיאשש סופית את הבאג אחרי המיזוג.

**קבצים שמשתנים (additive בלבד — לוגים, לא לוגיקה):**
- `packages/backend/src/delivery/ws-agent.ts` — **מרחיב את שורת הלוג היחידה** ש-Commit 0
  כבר שם ב-`detach("error", err)` (לא שורה שנייה!). נוסח מאוחד — מחליף את `{ err }` של
  Commit 0 ב-payload עשיר, **אותו message string** `"WS error — detaching pipe"`:
  `childLog.warn({ err: { code: (err as NodeJS.ErrnoException)?.code, message: String(err) } }, "WS error — detaching pipe")`.
  ⚠️ **`code` הוא best-effort:** `feWs` 'error' מספריית `ws` נושא לרוב `Error` רגיל עם
  `code=undefined` (לא `ErrnoException`) — אז `code` יתמלא רק ב-RST אמיתי וריק אחרת.
  ה-`message` + עצם קיום השורה הם הראיה ש"התרחיש קרה ונוטרל", לא ה-`code`.
- `packages/backend/src/server.ts:14-25` — ב-`uncaughtException`/`unhandledRejection`:
  לכלול את `code` (אם קיים) ב-payload, ולתייג `transient: isTransientSocketError(err)` —
  כך שורת-הלוג עצמה אומרת אם זו שגיאת-socket חולפת או שגיאה אמיתית.
- `packages/backend/src/server.ts` — error listeners של ה-`WebSocketServer`-ים (Commit 1):
  `procLog.warn({ src: "agentWss"|"echoWss", err }, "wss error")` — מקור מפורש.

> **חשוב — הלוג והתיקון משלימים, לא חופפים:** Commit 0 מונע את הקריסה (בולע את ה-error);
> Commit 3 מבטיח שהבליעה **מתועדת** (warn/error). בלי Commit 3, אחרי התיקון לא נדע
> בכלל שהתרחיש קרה. עם שניהם: השרת שורד **וגם** משאיר עקבות.

**Verification:** `pnpm typecheck`. ידני: `feWs.emit("error", new Error("boom"))` →
שורת warn `"WS error — detaching pipe"` מופיעה (גם כש-`code` ריק), ה-process חי.
(אין טסט יחידה ללוגים — נבדק ב-phase verify של Commit 2.)

> **תיקון מ-re-verify של אביגיל (Commit 3, 18/6):** הובהר ש-`code` הוא best-effort
> (ws Error לרוב בלי code), והנוסח אוחד מול Commit 0. דוח:
> `reports/drive-coding/slice-ws-error-survival-avigail-commit3.md`.

**תוספת config — כבר בוצעה ידנית (18/6), לתעד בלבד:** drop-in
`~/.config/systemd/user/voice-acp-dev.service.d/10-logging.conf` שמבטל `LOG_WIRE=ws`
ופותח `LOG_NS=backend.*` ב-debug. **לפני המיזוג:** להחליט אם זה נשאר drop-in או נכנס
ל-unit הקבוע ב-`deploy/systemd/` (כדי שלא יאבד ב-redeploy). ה-prod (`:4000`) **עדיין**
על `LOG_WIRE=ws` — לשקול את אותו שינוי גם שם.

---

## §11 — Appendix: ממצאי ניסוי ידני (2026-06-18)

**מה נעשה:** הורם dev (`:4001`) עם לוגים מלאים; נפתחה שיחה (פרומפט ספירה+פקודות
שמייצר streaming מתמשך); נוסו ניתוקים שונים תוך כדי ריצה.

**מה נצפה בלוג (כל אירוע מתועד):**

| פעולה | event בלוג | תוצאה |
|------|-----------|-------|
| Offline (DevTools → Network) | `WS disconnect — detaching pipe` (close נקי) | ✅ child שורד, reconnect המשיך עד הסוף |
| Refresh לדף | `WS disconnect` (close נקי) | ✅ child שורד |
| סגירת טאב ממש | לא נתפסה ראיה חד-משמעית בלוג | ⚠️ ההשערה החזקה ל-trigger, לא אושש |

**שתי "נפילות" התרחשו בפועל, אך אף אחת אינה הבאג:**
- הראשונה — ה-instance הידני (background, לא systemd) מת **בלי שום trace** (הלוג נקטע
  בשקט באמצע proxy-polling) = SIGKILL/SIGTERM חיצוני, **לא** `uncaughtException`. בעיית
  יציבות של process ידני, לא הבאג.
- ה-`Restart=on-failure` ב-`voice-acp-dev.service` מסביר למה קריסות "נעלמות" — systemd
  מרים מחדש לבד, אז המשתמש רואה 502 קצר ולא קריסה מתמשכת.

**מסקנות:**
1. **האבחנה תקפה ולא הופרכה** — הקוד מאשש: `feWs` ללא `error` listener (`ws-agent.ts:144`
   יש `close`, אין `error`); `server.ts:14` עושה `process.exit(1)` על `uncaughtException`.
2. **הבאג לא שוחזר ידנית עם ראיה** — כל ניתוק שמייצר `close` נקי (offline/refresh/✕-תקין)
   הוא ה-happy path; ה-error path דורש RST אמיתי (network drop פתאומי / crash דפדפן),
   שקשה לייצר ידנית בעקביות. **זה לא מפריך את הבאג — רק מראה שהוא נדיר ותלוי-תזמון.**
3. **Observability gap אמיתי נמצא ותוקן** — `LOG_WIRE=ws` הסתיר את ה-namespace הקריטי.
   זה ה-driver ל-Commit 3 ולתוספת ה-config.

**המלצה:** לבצע את ה-slice במלואו (Commit 0-3). ה-observability הוא דווקא מה שיאפשר
**אישוש סופי** אחרי המיזוג: אם זה קורה שוב, ה-journal יראה את הרצף
`WS error (ECONNRESET) → uncaughtException → exit` ברחל-בתך-הקטנה.

---

## סטטוס

**הושלם** — 4 commits על branch `slice-ws-error-survival`:
- `132e8ab` — Commit 0: feWs error handler + idempotent detach
- `9f7bfcc` — Commit 1: error listeners על שרתי WS + echo
- `5f23bf3` — Commit 2: isTransientSocketError + ריכוך uncaughtException
- `4b9fe3e` — Commit 3: observability logs

## סטיות מהתכנון (מתעדכן ע"י executor תוך כדי)

- **spawn child בטסט**: `OPENCODE_ARGS='["-e","setInterval(...)"]'` נדרש כדי שה-child יישאר חי (OPENCODE_BIN=node + args של opencode רגיל גורם ל-exit מהיר). תועד בטסט עצמו.
- **מיקום קובץ הטסט**: הtbriefאמר `src/delivery/ws-agent.test.ts` אבל הפרויקט שם טסטים ב-`tests/`. יצרתי `tests/ws-agent-error-survival.test.ts` לפי הקונבנציה.
- **TypeScript narrowing**: `childOrNull` → `const child = childOrNull` נדרש בגלל closure + strict (TypeScript מאבד narrowing בתוך closure).
