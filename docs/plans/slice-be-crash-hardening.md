# Slice — be-crash-hardening — תוכנית

> **תאריך**: 2026-07-10
> **סטטוס**: 📝 טיוטה — טרם אביגיל
> **Complexity**: 6/10 (verifier: **light / calev**)
> **תלות**: `depends_on: []` · **base**: `dev` @ `b448adcb`
> **מקור**: `docs/investigations/2026-07-06-project-wide-bug-review.md` §🔴 ממצאים #1 + #3 (אומתו-מחדש חי ב-dev
>   2026-07-10 — קריאת-קוד שורה-שורה: `stream-bridge.ts:77,124` · `server.ts:213,228` · `transient-socket-error.ts`).
>   שני וקטורי-קריסה **חיים ב-dev כרגע**, כל אחד מפיל את כל תהליך-ה-BE.

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/be-crash-hardening -b slice/be-crash-hardening dev
cd .worktrees/be-crash-hardening
bun install          # ⚠️ שרת bun-only — אין pnpm/node אמיתי. install דרך bun (קורא bun.lock).
```
- env הפרויקט (ports/OneCLI/commands): `AGENTS.md`. פרוטוקול executor: הגדרת הסוכן **eliezer** + סקיל brief-driven-slices.
- ה-slice הזה **backend/provider בלבד** — אין FE, אין Svelte, אין i18n-strings בקוד (מחרוזות-לוג באנגלית כמקובל).
- ⚠️ **סביבת-הרצה bun-only** (השרת הזה, אחרי merge של `agnostic-tooling`): **אין `pnpm`/`node` אמיתי — רק `bun`**.
  `pm.mjs` מזהה bun אוטומטית תחת `bun run`. השתמש בפקודות-bun למטה, **לא** ב-`pnpm`.

### Verification (build-gate) — **bun**
```bash
cd packages/provider && CI=true bun run test        # stream-bridge unit (Commit 1+3) — "vitest run"
cd ../.. && CI=true bunx vitest run packages/backend # server-survival integration (Commit 2)
#   ↑ ל-packages/backend אין `test` script פר-חבילה — הטסטים רצים מה-root דרך vitest (בדוק חי, אל תנחש).
bun run typecheck                                    # root — provider+backend, exit 0
```
> **baseline pre-existing** (environmental, לא רגרסיה שלך — אל תתקן/תחקור): `http-options` · `formatting` · `https-serve`.
> תפוס baseline לפני שינוי (`CI=true bunx vitest run 2>&1 | tail -5`) והשווה מונה אחרי — לא מונה קשיח.

### Reading list
**must-read**:
- `docs/investigations/2026-07-06-project-wide-bug-review.md` — **§🔴 #1** (fire-and-forget→exit) ו-**§🔴 #3**
  (`new URL` ב-upgrade). ה-brief-שמאחורי-ה-brief; כולל את רצף-הכשל המלא ואת ה-repro.
- `packages/provider/src/connection/stream-bridge.ts` — **:77** `void drainOutbound()` · **:124**
  `void inboundWriter.write(msg)` · **:133-152** `close()` (מקור-האמת לסמנטיקת-הסגירה שנרחיב). ה-target של Commit 1+3.
- `packages/provider/src/connection/stream-bridge.test.ts` — **תבנית ה-unit-test** (helpers `readOne`/`writeOne`/`tick`;
  שים לב לטסט הקיים **`"malformed JSON in wireEnd.write() returns false and does not crash"`** (`:134`) —
  מרחיבים את אותו קו למקרה-ה-stream-errored).
- `packages/backend/src/server.ts` — **:227-246** upgrade handler (`new URL` ב-`:228`) · **:211-218** connection
  handler (`new URL` ב-`:213`) · **:19-47** ה-handlers הגלובליים (מדוע דחייה לא-transient = `process.exit(1)`).
- `packages/backend/src/delivery/transient-socket-error.ts` — המסווג. **TypeError אין לו `.code`** → לא-transient → exit.
  זה מדוע שני הווקטורים קטלניים. **אל תשנה אותו** (רוחב-ה-allowlist הוא הכרעה קיימת).
- `packages/backend/tests/ws-agent-error-survival.test.ts` — **תבנית integration** להוכחת "ה-BE שורד".
- `packages/provider/src/connection/connect-in-process.ts` — **:292-297** `onCrash`/`crashListeners` (Commit 3
  מחווט אליהם את שגיאת-ה-stream) · **:236-240** `agentConn.closed.catch(()=>{})` (הבליעה הקיימת).

**reference**:
- `docs/plans/slice-be-shutdown-hardening.md` — הסלייס-האח (ר' §10; שם חי ממצא #2).

## §1 — מטרה

אחרי הסבב: **אף frame יחיד מה-FE ואף בקשת-upgrade יחידה מרחוק לא יכולים להפיל את תהליך-ה-BE.**
היום שני קלטים טריוויאליים עושים `process.exit(1)` על כל השרת + כל הסוכנים ה-in-process:
1. frame שהוא JSON-תקין-אך-לא-אובייקט (למשל `42`) → ה-SDK זורק ב-receive-loop → ה-stream נכנס ל-errored →
   ה-write הבא (פרומפט רגיל) נדחה → `unhandledRejection` לא-transient → exit.
2. בקשת `upgrade` עם request-target פגום (למשל `//[::1`) → `new URL()` זורק `TypeError` → `uncaughtException` → exit.

אחרי התיקון: (א) שני הקלטים **נספגים** — ה-BE שורד, ממשיך לשרת שאר הסשנים; (ב) הסשן הפגוע **מתפרק נקי**
(לא זומבי-שקט) — הרשומה ב-registry מתנקה דרך נתיב-ה-crash הקיים, לא נשארת תלויה עד DELETE ידני.

> ⚠️ **מה ה-slice הזה עושה — ומה לא**:
> - ✅ עוצר את **שני וקטורי-הקריסה הידועים** (#1, #3) — ספיגה + פירוק-סשן-נקי.
> - ❌ **אינו** משנה את מדיניות ה-handler הגלובלי (exit על כל דחייה לא-transient). זו **הכרעה ארכיטקטונית פתוחה**
>   (ר' §9 Q1) — לא מרחיבים אותה כאן; מתקנים את המקורות הידועים, לא את המדיניות.
> - ❌ **אינו** נוגע ב-#2 (חטיפת SIGINT/SIGTERM ב-usage-store) → `be-shutdown-hardening` (§10).
> - ❌ **אינו** נוגע ב-#4 (`/api/options` חוסם-loop) → slice `options-async-cache` (§10).
> - ❌ **אינו** מתקן את שאר דליפות-ה-lifecycle (#5 dispose · #6 onCrash כללי · #7 מרוץ-DELETE) →
>   `be-lifecycle-hardening` (§10). Commit 3 נוגע ב-`crashListeners` **רק** לטריגר שגיאת-ה-stream — לא ל-onCrash הכללי.

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| `.catch()` על `inboundWriter.write` (`:124`) + `drainOutbound` (`:77`) — עצירת הקריסה | ✅ | Commit 1 |
| על דחייה: `closed=true` (fail-fast, אין עוד דחיות) + לוג עם הקשר | ✅ | Commit 1 |
| חילוץ `safeUrlPathname(raw): string \| null` (pure, לעולם לא זורק) + שימוש ב-`:228` ו-`:213` | ✅ | Commit 2 |
| על target פגום → `socket.destroy()` (upgrade) / התעלמות בטוחה (connection) — לא crash | ✅ | Commit 2 |
| `onError(cb)` ב-`StreamBridge` + חיווט ב-`connect-in-process` → `crashListeners` (פירוק-סשן) | ✅ | Commit 3 |
| שינוי מדיניות ה-handler הגלובלי (unhandledRejection→log-and-continue) | ❌ | §9 Q1 — הכרעת-משתמשת |
| #2 — SIGINT/SIGTERM hijack (usage-store) | ❌ | `be-shutdown-hardening` (§10) |
| #4 — `/api/options` async+cache | ❌ | `options-async-cache` (§10) |
| #5/#6/#7 — dispose / onCrash כללי / מרוץ-DELETE | ❌ | `be-lifecycle-hardening` (§10) |

## §3 — Commits

### Commit 1 — stream-bridge: crash-safety על שני ה-fire-and-forget (approach: **TDD / unit**)
**קובץ**: `packages/provider/src/connection/stream-bridge.ts`

1. **`:124`** — במקום `void inboundWriter.write(msg)`:
   ```ts
   inboundWriter.write(msg).catch((err: unknown) => {
     // ה-stream errored (ה-agent סגר/קרס) — אל תיתן לדחייה לברוח ל-unhandledRejection→exit.
     closed = true                       // fail-fast: write הבא יחזיר false, אין עוד דחיות
     onErrorFire(err)                     // Commit 3 — surface לפירוק-סשן (no-op עד Commit 3)
   })
   ```
2. **`:77`** — במקום `void drainOutbound()`:
   ```ts
   drainOutbound().catch((err: unknown) => { closed = true; onErrorFire(err) })
   ```
   (`drainOutbound` כבר עוטף `try/finally`; ה-`.catch` תופס דחיית `reader.read()` כשה-outbound errored.)
3. שמור על החוזה הקיים: `write()` עדיין מחזיר `boolean` **סינכרונית** (ה-`.catch` אסינכרוני, לא משנה את הערך המוחזר).

**testing (TDD unit)** — מרחיבים את `stream-bridge.test.ts`:
- `it("write on an errored inbound stream does not crash and marks closed")`:
  ```ts
  const bridge = createStreamBridge()
  // Force the inbound stream into an errored state (agent side cancelled):
  const r = bridge.agentEnd.readable.getReader(); await r.cancel(new Error("agent gone")); r.releaseLock()
  // ה-write ראשון פותח writer על stream errored → ה-write נדחה; חייב להיספג, לא unhandledRejection:
  bridge.wireEnd.write(JSON.stringify({ jsonrpc:"2.0", method:"ping", id:1 }))
  await tick(); await tick()
  // אחרי הספיגה: closed → write הבא מחזיר false
  expect(bridge.wireEnd.write(JSON.stringify({ jsonrpc:"2.0", method:"ping", id:2 }))).toBe(false)
  ```
  > vitest נכשל אוטומטית על `unhandledRejection` שלא-נתפס → הטסט **מוכיח** את הספיגה. red לפני (הדחייה בורחת), green אחרי.
- ודא שכל הטסטים הקיימים (happy-path round-trip) עדיין ירוקים.

### Commit 2 — server: URL-guard על ה-upgrade + connection handlers (approach: **TDD / unit + integration**)
**קבצים**: `packages/backend/src/server.ts` (+ helper חדש קטן, למשל `packages/backend/src/delivery/url-safe.ts`)

1. חלץ helper **טהור** (functional-core, testable, לעולם לא זורק):
   ```ts
   export function safeUrlPathname(rawUrl: string | undefined): string | null {
     try { return new URL(rawUrl ?? "", "http://localhost").pathname } catch { return null }
   }
   ```
2. **`server.ts:228`** (upgrade) — במקום `const url = new URL(...)`:
   ```ts
   const pathname = safeUrlPathname(req.url)
   if (pathname === null) { socket.destroy(); return }   // target פגום → הרוס סוקט, אל תקרוס
   if (pathname === "/ws/echo") { ... }
   if (pathname.startsWith("/ws/agent/")) { ... }
   socket.destroy()
   ```
3. **`server.ts:213`** (connection) — אותו guard; על `null` → `ws.close()` והתעלם (לא אמור לקרות אחרי upgrade-תקין, defense-in-depth).

**testing**:
- **unit (TDD)** — `packages/backend/tests/url-safe.test.ts` (קונבנציית backend: טסטים ב-`tests/`, לא co-located):
  `safeUrlPathname` מחזיר `null` (לא זורק) על `"http://["`, `"//[::1"`, `"http://%"`;
  מחזיר `/ws/echo` על `"/ws/echo"`, `/ws/agent/x` על `"/ws/agent/x"`. (הקלטים מ-§🔴#3 בחקירה, אומתו-אמפירית שם.)
- **integration** — תבנית `ws-agent-error-survival.test.ts`: הרם `serve()` על port ארעי, שלח בקשת-upgrade גולמית
  עם target פגום (raw socket write של `GET //[::1 HTTP/1.1\r\nUpgrade: websocket\r\n...`), ואז בקשת-`/api/health` רגילה →
  **חייבת לחזור 200** (ה-BE שרד). אם ה-raw-socket flaky בסביבת-CI → `it.skip` + אימות-חי ב-DoD.

### Commit 3 — stream-bridge onError → פירוק-סשן (approach: **unit + integration**)
**קבצים**: `stream-bridge.ts` (הוספת `onError` ל-interface) · `connect-in-process.ts` (חיווט)

1. הוסף ל-`StreamBridge` interface `onError(cb: (err: unknown) => void): void` + מימוש (`errListeners` set;
   `onErrorFire(err)` מ-Commit 1 קורא לכולם — **פעם אחת** (guard `erroredOnce`) כדי לא לספאם).
2. ב-`connect-in-process.ts` (יצירת ה-bridge): `bridge.onError((err) => { crashListeners.forEach(cb => cb(...)) })`.
   כך שגיאת-stream **מפעילה את נתיב-ה-crash הקיים** → `connection-registry.cleanup(agentId)` → הרשומה מתנקה,
   בקשות-pending נדחות, ה-orchestrator מסמן `crashed`. (זה סוגר את הזומבי-השקט שתיארתי — לא רק לוג.)
3. **גבול מול #6**: זה מחווט `crashListeners` **רק** לטריגר שגיאת-ה-stream (הווקטור של #1). שאר הפערים ב-onCrash
   (codex-child-exit לא סוגר `serverOut`; claude `dispose` חסר) נשארים ב-`be-lifecycle-hardening` — אל תיגע בהם כאן.

**testing**:
- **unit** — `bridge.onError` נורה פעם-אחת כשה-inbound errored (הרחבת הטסט מ-Commit 1: הוסף spy ל-`onError`).
- **integration** — `connect-in-process.test.ts`: אחרי שה-stream errored, ה-connection עובר לנתיב-crash (הרשומה מתנקה /
  onCrash נורה). אם קשה לדמות in-process — לפחות unit על ה-bridge + אימות-חי ב-DoD.

## §4 — DoD

| בדיקה | איך |
|---|---|
| **#1 חי: frame לא-אובייקט לא מפיל BE** | הרם BE (OneCLI), חבר agent, שלח דרך ה-WS frame גולמי `42` ואז פרומפט רגיל → ה-BE **שורד**, הפרומפט של סשן **אחר** ממשיך לעבוד; בלוג רואים ספיגה, לא exit |
| **#1 חי: הסשן הפגוע מתפרק נקי** | אחרי ה-frame הפוגע → הרשומה של אותו agent יורדת מ-`GET /api/agents` (או מסומנת crashed), לא נשארת תלויה |
| **#3 חי: upgrade פגום לא מפיל BE** | `printf 'GET //[::1 HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n' \| nc localhost 4000` → ה-BE **שורד**; `curl localhost:4000/api/health` → 200 |
| **unit: stream-errored write נספג** | הטסט החדש ב-`stream-bridge.test.ts` ירוק (vitest לא מדווח unhandledRejection) |
| **unit: safeUrlPathname לעולם לא זורק** | `packages/backend/tests/url-safe.test.ts` ירוק על כל 3 הקלטים הפגומים |
| **integration: server-survival** | הטסט החדש בתבנית `ws-agent-error-survival` ירוק (או `skip`+אימות-חי אם flaky) |
| **אפס רגרסיה** | כל טסטי provider+backend הקיימים ירוקים; happy-path round-trip של ה-bridge לא נשבר |
| build-gate | `bun run typecheck` (provider+backend) 0 · כל הטסטים ירוקים (מול baseline) · `bun run lint:i18n` עובר |

## §5 — Risks

| סיכון | מיטיגציה |
|---|---|
| ה-`.catch` בולע שגיאה **אמיתית** (לא רק stream-closed) ומסתיר באג | הלוג כולל את ה-`err` המלא; ה-`closed=true` הופך את הסשן ל-fail-fast (לא ממשיך במצב-שבור בשקט); Commit 3 מפרק את הסשן → נראות מלאה דרך נתיב-ה-crash |
| Commit 3 יורה `crashListeners` פעמיים (stream-error + סגירה-רגילה) | guard `erroredOnce` ב-`onErrorFire`; `cleanup(agentId)` ב-registry כבר idempotent (בדוק) |
| חילוץ `safeUrlPathname` משנה התנהגות על URL תקין | הטסט מוודא זהות-פלט על הקלטים התקינים (`/ws/echo`, `/ws/agent/x`); `new URL().pathname` זהה למקור |
| raw-socket integration flaky ב-CI | `it.skip` + אימות-חי ב-DoD (כמו התקדים ב-`ws-agent-error-survival`) |
| חפיפת-קובץ עם `be-shutdown-hardening` ב-`server.ts` | אזורים שונים (upgrade handler מול signal-handlers/`httpServer.close`); additive. סדר-מיזוג גמיש (§10) |

## §6 — Escalation triggers

- אם פירוק-הסשן ב-Commit 3 (`crashListeners`→`cleanup`) מפיל סשנים **אחרים** או יוצר מרוץ → **עצור**, שאל מרדכי (נוגע בגבול #6/#7).
- אם ה-`unhandledRejection→exit` נורה גם אחרי ה-`.catch` (כלומר יש fire-and-forget **נוסף** שלא מופה) → תעד את ה-stack, שאל.
- אם ה-repro של #1 לא מצליח לשחזר את הקריסה על ה-baseline (לפני התיקון) → תעד; ייתכן שה-SDK השתנה — יישר עם מרדכי.

## §7 — Complexity score

6/10: 3 קבצים (provider×2 + backend×1) + helper (+1); חוצה-חבילות provider↔backend (+1); Commit 3 נוגע בנתיב-ה-crash
של ה-connection (blast-radius מדוד — רק טריגר-stream) (+2); אימות דורש repro-חי של קריסה + integration של server-survival
(+2). **verifier: light (calev)** — אין FE/visual, אין E2E-flows, הליבה unit-testable; ה-repro החי ממוקד לשני קלטים.

## §8 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | **מדיניות ה-handler הגלובלי** — `unhandledRejection` לא-transient עדיין עושה `process.exit(1)`. לרכך ל-log-and-continue? | **לא בסלייס הזה** — מתקנים מקורות ידועים, לא מדיניות. הכרעה ארכיטקטונית נפרדת (השלכות: מסתיר באגים אמיתיים מול חוסן). **מרדכי יעלה למשתמשת בנפרד.** | ❌ (מחוץ-scope) |
| 2 | Commit 3 — לחווט `crashListeners` או להוסיף callback ייעודי `onStreamError`? | `crashListeners` הקיים (נתיב-הניקוי כבר שם); גבול מול #6 בהערת-קוד | ❌ |
| 3 | ה-integration של #3 — raw-socket או להסתפק ב-unit של `safeUrlPathname` + אימות-חי? | unit-חובה; integration best-effort (`skip` אם flaky) + DoD-חי חובה | ❌ |

## §9 — יחס לסלייסים אחרים (חלוקת ממצאי 07-06)

> סקירת-הבאגים 07-06 מצאה 3 קריטיים + 7 גבוהים. חלוקה לסלייסים כדי למנוע חפיפה:

| ממצא | סלייס | הערה |
|---|---|---|
| **#1** fire-and-forget→crash | **be-crash-hardening (זה)** | Commit 1+3 |
| **#3** `new URL` upgrade→crash | **be-crash-hardening (זה)** | Commit 2 |
| **#2** SIGINT/SIGTERM hijack (usage-store) | **`be-shutdown-hardening`** (brief READY r2) | ⚠️ **דורש עדכון**: הברִיף נכתב 07-01, **לפני** שזוהה ש-`usage-store.ts:129-135` הוא שורש-החטיפה. ה-graceful-shutdown שם חייב **להסיר את listeners של usage-store** ולנתב את ה-flush דרך נתיב-הכיבוי המסודר (אחרת flush-on-signal אובד). מרדכי יעדכן את הברִיף לפני dispatch. |
| **#4** `/api/options` חוסם-loop | **`options-async-cache`** (חדש, טרם brief) | החשוד המרכזי ל-stalls; async + cache. |
| **#5/#6/#7** dispose / onCrash כללי / מרוץ-DELETE | **`be-lifecycle-hardening`** (חדש, טרם brief) | #7 = PARTIAL (ר' אימות-סוכן) — right-size. |
| **#8** devDeps→deps (provider) | housekeeping (לפני build-מינימלי) | `acp-sdk-v1` + `claude-agent-acp` value-imported מ-production. |
| תשתית-אבחון (`/api/diag` + `watch.mjs` + hot-path) | **`be-diag-harness`** (חדש) — מהspikes השמורים (`slice/claude-spawn-spike`) | ה"הרצת-הרבה-סוכנים-ותפיסת-קריסות". יורד ל-dev כ-observability קבוע. |
| watchdog-חיצוני להתאוששות-hang | **`be-hang-supervisor`** (💭 roadmap Track F) | רשת-ביטחון ל-hang בלתי-משוחזר; **אחרי** lifecycle. |

**סדר-מיזוג מומלץ**: be-crash-hardening (חריף) → be-shutdown-hardening (מעודכן) → options-async-cache → be-diag-harness → be-lifecycle-hardening → be-hang-supervisor. אין תלות-קוד קשיחה בין crash-hardening ל-shutdown-hardening (אזורי-`server.ts` שונים) → גמיש.
