# Slice — crash-teardown-fix — תוכנית

> **תאריך**: 2026-07-10
> **סטטוס**: ✅ הושלם — commit e3e7f785 על slice/be-crash-hardening (2026-07-11)
> **Complexity**: 3/10 (verifier: **light / calev** — אך אימות-חי שסשן לא-נסגר-לבד)
> **תלות**: `depends_on: []` (מתקן slice קיים) · **base**: `slice/be-crash-hardening` @ `064f7d5a`
>   ⚠️ ה-commit **נוחת על ענף crash-hardening עצמו** (התיקון שייך ל-slice — "נכון כיחידה"), ואז
>   **rebase של diag-harness + options-trim** מעליו (ר' §9). **restart ל-BE החי** אחרי — כדי לעצור את דליפת-הסשנים.
> **מקור**: אבחון-חי 2026-07-10 (סוכן-חקירה) — המשתמש דיווח **סשנים נסגרים מעצמם** בשרשרת החיה. אומת: רגרסיה מ-**C3**.

## §0 — Pre-flight

### Worktree
```bash
cd /home/user/Projects/drive-coding/.worktrees/be-crash-hardening   # קיים כבר @ 064f7d5a
bun install
```
- ⚠️ **סביבת-הרצה bun-only** — `pm.mjs` מזהה bun. השתמש בפקודות-bun.
- ה-slice **provider בלבד** — אין FE, אין i18n-strings בקוד (מחרוזות-לוג באנגלית).

### Verification (build-gate) — **bun**
```bash
cd packages/provider && CI=true bun run test    # stream-bridge + connect-in-process
cd ../.. && bun run typecheck                    # provider+backend exit 0
```

### Reading list
**must-read**:
- `packages/provider/src/connection/stream-bridge.ts` — **:77-91** (`errListeners`/`onErrorFire`/`erroredOnce` — נמחקים) ·
  **:100-104** (`drainOutbound().catch` — גוף משתנה) · **:158-161** (`inboundWriter.write().catch` — גוף משתנה) ·
  **:170-175** (`onError` method — נמחק). ה-target המרכזי.
- `packages/provider/src/connection/connect-in-process.ts` — **:132-157** (`crashListeners` + `bridge.onError(...)` wiring —
  ה-wiring של C3 נמחק; `crashListeners` **נשאר** ל-onCrash הלגיטימי — ר' `:315` `onCrash(cb){crashListeners.add(cb)}`).
- `packages/provider/src/connection/spawn-core.ts` — **:16** `import { createLogger } from "@drive-coding/core/log"` —
  תבנית ה-logger שנשתמש בו ב-`.catch` (אין logger ב-stream-bridge היום). **(אביגיל #2: `hot-path-timing.ts` לא קיים על base זה — הוא diag-harness; ה-precedent הנכון = spawn-core.)**
- ⚠️ **(אביגיל #3)** מספרי-השורות למטה עשויים לסטות ±1-5 (ה-anchors/symbols ייחודיים) — **הישען על הסמלים, לא על המספר.**
- ⚠️ **(אביגיל #4)** הטענה "SDK לא קורא `.cancel()`" אומתה בחקירה על worktree ה-diag (שם ה-SDK מותקן); `acp-sdk-v1` **לא מותקן** על base זה עד `bun install` — **אמת אחרי install** (`grep -rn '\.cancel(' node_modules/@agentclientprotocol/sdk/dist/`).
- `packages/provider/src/connection/stream-bridge.test.ts` — **:147,:172,:198** (הטסטים שמבוססים על `cancel()` מלאכותי —
  נמחקים/מתהפכים) · **:134,:140** (malformed-JSON + closed — **נשארים**, לא נוגעים).
- `packages/provider/src/connection/connect-in-process.test.ts` — **:221+** `"stream-error → onCrash wiring (C3)"` — נמחק/מתהפך.

> **הראיה לרגרסיה (מהאבחון — עגן בה)**: `inboundWriter.write(msg)` נדחה **רק** אם `inbound.readable` עבר `.cancel()`.
> ה-ACP SDK (`acp-sdk-v1@1.0.0`, `Connection.receive()`) **לעולם לא קורא `.cancel()`** — רק `reader.releaseLock()`
> (אומת: אין ולו `.cancel(` אחד ב-`acp.js`). הטסטים של C3 מכריחים את השגיאה ב-`cancel(new Error("agent gone"))`
> **מלאכותי** שאף רכיב אמיתי לא מבצע. הדחיות ה**אמיתיות** שכן קורות מדי-פעם (race של `bridge.close()` מול write,
> כשל-outbound חולף בין-turns) → C3 מתרגם ל-`BridgeCrashInfo` → `cleanup(agentId)` + `feWs.close(1011)` → **הסשן נעלם**.
> ב-dev אותה דחייה נבלעה (fire-and-forget) → הסשן **שרד**. **זו הרגרסיה.**

## §1 — מטרה

**לבטל את פירוק-הסשן-על-דחיית-stream (C3) — לחזור להתנהגות-dev שבה הסשן שורד — תוך שמירת הערך של C1 (מניעת קריסת-BE) ו-C2 (URL-guard).**

היום: כל דחיית `write`/`drain` (גם תמימה — race עם close, כשל-transport חולף) → `closed=true` + `onErrorFire` →
`crashListeners` → `connection-registry.cleanup(agentId)` + `feWs.close(1011)` → **הסשן מתפרק מול המשתמש**. וקטור-הטריגר
שבשמו נבנה C3 (SDK שמבטל את ה-readable אחרי frame-קטלני) **אינו קיים** ב-SDK בפועל.

אחרי התיקון: דחיית `write`/`drain` **נבלעת ומתועדת** (`log.warn` — מונע `unhandledRejection→exit`, נותן נראות), **בלי לפרק
את הסשן ובלי להרעיל `closed`**. זו **בדיוק חזרה להתנהגות-dev**.

> ⚠️ **תיקון-דיוק (אביגיל finding #1)**: הטענה המוקדמת ש"פירוק-סשן אמיתי נשאר באחריות `agentConn.closed`" **שגויה** —
> נתיב-ה-crash הזה **אינו מחווט בקוד** ל-in-process. האמת: ב-**dev** onCrash של in-process היה **מת ממילא**
> (אין feeder; `crashListeners` קיים ל-API-symmetry בלבד). **C1 הוסיף את ה-feeder היחיד** (`onErrorFire`), ו-C3 חיווט
> אותו ל-teardown. מחיקת השניים = **חזרה למצב-dev** (onCrash-in-process מת, אין teardown-על-stream). **אין אובדן חדש** —
> זה בדיוק מה שהיה. **איסוף-סוכן-מת-אמיתי ל-in-process הוא פער-קיים-מדע** (= ה-reaper שהמשתמש העלה) → **slice נפרד**, לא כאן.

> ⚠️ **מה נשאר (לא נגזר)**:
> - ✅ **C1 — הבליעה** (`.catch` קיים → אין `unhandledRejection→process.exit`). זה הערך האמיתי; **נשמר**.
> - ✅ **C2 — URL-guard** (`safeUrlPathname` ב-`server.ts`, upgrade פגום לא מפיל BE). **לא נגעים.**
> - ❌ **C3 — פירוק-הסשן** (`onError→crashListeners`). **מבוטל** (revert) — הוא הרגרסיה.

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| `.catch` על write/drain → `log.warn` (absorb+observe), בלי `closed=true`, בלי `onErrorFire` | ✅ | Commit 1 |
| מחיקת `onError` API + `errListeners` + `onErrorFire` + `erroredOnce` (מתים אחרי revert) | ✅ | Commit 1 |
| מחיקת wiring `bridge.onError→crashListeners` ב-connect-in-process (:142-157) | ✅ | Commit 1 |
| היפוך/מחיקת הטסטים שמבוססים על `cancel()` מלאכותי (stream-bridge + connect-in-process) | ✅ | Commit 1 |
| הוספת טסט: דחיית-write נבלעת **ולא** מפרקת סשן (אין onCrash, לא נסגר) | ✅ | Commit 1 |
| שינוי C1 (`.catch` נשאר — הבליעה) / C2 (URL-guard) | ❌ | נשמרים כמו-שהם |
| פירוק-סשן על crash **אמיתי** (agentConn.closed / מות-spawn) | ❌ | נתיב קיים, לא בסלייס הזה |
| מדיניות handler גלובלי (unhandledRejection→exit) | ❌ | הכרעה נפרדת (crash-hardening §9 Q1) |

## §3 — Commits

### Commit 1 — revert C3: log-and-continue במקום פירוק-סשן (approach: **TDD / unit + integration**)
**קבצים**: `packages/provider/src/connection/stream-bridge.ts` · `.../connect-in-process.ts` · שני קבצי-הטסט.

1. **stream-bridge.ts — logger**: הוסף בראש הקובץ:
   ```ts
   import { createLogger } from "@drive-coding/core/log"
   const log = createLogger("provider.stream-bridge")
   ```
2. **`:100-104`** (`drainOutbound().catch`) — במקום `closed=true; onErrorFire(err)`:
   ```ts
   drainOutbound().catch((err: unknown) => {
     // outbound drain rejected — absorb (מונע unhandledRejection→exit) ורשום. אל תפרק את הסשן:
     // דחיית-stream אינה אות-crash אמין (in-process אין exitCode/signal). teardown אמיתי = agentConn.closed.
     log.warn({ err: err instanceof Error ? err.message : String(err) }, "outbound drain rejected — absorbed")
   })
   ```
3. **`:158-161`** (`inboundWriter.write().catch`) — אותו דבר:
   ```ts
   inboundWriter.write(msg).catch((err: unknown) => {
     log.warn({ err: err instanceof Error ? err.message : String(err) }, "inbound write rejected — absorbed")
   })
   ```
   > ⚠️ **אל תיגע** ב-`write()`-`return true` ובבדיקת `if (closed) return false` בראש `write` (:140) — ה-`close()` היזום
   > עדיין מגדיר `closed` וזה תקין. רק ה-`.catch` מפסיק להגדיר `closed`/לפרק.
4. **מחק** את הקוד המת של C3 ב-stream-bridge: `errListeners` (:78), `erroredOnce` (:79), `onErrorFire` (:81-91),
   ומתודת `onError` (:170-175) + הסר `onError` מטיפוס ה-`StreamBridge` (interface).
5. **connect-in-process.ts** — מחק את block ה-`bridge.onError((err)=>{...crashListeners...})` (:136-157).
   **השאר** את `const crashListeners = new Set(...)` (:134) ואת `onCrash(cb){crashListeners.add(cb)}` (:315) — הם ה-onCrash
   הלגיטימי (ext channel), **לא** קשורים ל-stream-rejection.

**testing (TDD)**:
- **stream-bridge.test.ts**: **מחק** `:172` ("onError fires exactly once") ו-`:198` ("onError unsubscribe") — הם בודקים API שנמחק.
  **הפוך** `:147` ל: `it("write rejection is absorbed and does NOT close the bridge (session survives)")`:
  ```ts
  const bridge = createStreamBridge()
  const r = bridge.agentEnd.readable.getReader(); await r.cancel(new Error("agent gone")); r.releaseLock()
  bridge.wireEnd.write(JSON.stringify({ jsonrpc:"2.0", method:"ping", id:1 }))
  await tick(); await tick()
  // absorbed (vitest לא מדווח unhandledRejection) — וה-bridge לא ננעל ע"י הדחייה:
  // (write הבא לא חסום ע"י closed שהדחייה הגדירה — כי כבר לא מגדירים closed)
  // הערה: ה-WritableStream עצמו עלול להיות errored — הטענה המרכזית: אין teardown, אין closed מהדחייה.
  ```
  **שמור** `:134` (malformed→false) ו-`:140` (closed→false אחרי `close()` יזום) — לא נוגעים.
- **connect-in-process.test.ts**: **הפוך** את `:221+` `"stream-error → onCrash wiring (C3)"` ל:
  `it("stream write rejection does NOT fire onCrash (session survives)")` — `conn.onCrash(spy)`, גרום לדחיית-write, ודא `expect(spy).not.toHaveBeenCalled()`.

## §4 — DoD

| בדיקה | איך |
|---|---|
| **unit: דחיית-write נבלעת ולא מפרקת** | הטסט המהופך ב-stream-bridge ירוק (אין unhandledRejection; אין closed-מהדחייה) |
| **integration: אין onCrash מדחיית-stream** | הטסט המהופך ב-connect-in-process — `onCrash` **לא** נורה |
| **חי: סשן לא נסגר-לבד** | הרם את השרשרת (אחרי rebase), חבר claude, הרץ מספר turns + cancel + leave-running→reattach → הסשן **שורד**, לא נעלם. (קשה לכפות את ה-race המדויק — ודא **אין** `feWs.close(1011)`/`cleanup` ספונטני בלוג) |
| **regression: C2 חי** | `printf 'GET //[::1 ...' \| nc localhost 4001` → BE שורד, `/api/health` 200 (URL-guard לא נשבר) |
| **regression: C1 חי** | הבליעה עדיין מונעת `unhandledRejection→exit` (הטסט המהופך מוכיח absorb) |
| **אפס רגרסיה** | כל טסטי provider ירוקים (מלבד ה-3 שנמחקו/הופכו); round-trip תקין |
| build-gate | `bun run typecheck` 0 · provider tests ירוקים · `lint:i18n` |

## §5 — Risks

| סיכון | מיטיגציה |
|---|---|
| הסרת `closed=true` → אם ה-stream **באמת** errored, כל write נדחה שוב (log רועש) | הדחיות נבלעות (לא קריסה); `log.warn` פר-דחייה. teardown אמיתי מגיע מ-`agentConn.closed`. אם רועש-מדי בפועל → dedupe/debug-level ב-follow-up |
| מחיקת `onError` API שוברת צרכן אחר | אומת: `onError`/`onErrorFire` קיימים **רק** ב-stream-bridge (def) + connect-in-process (C3 wiring). אין צרכן אחר. typecheck יתפוס |
| `crashListeners` נשאר בלי הזנה → onCrash של in-process מת (אביגיל #1) | **זה מצב-dev המקורי** — ב-dev onCrash של in-process לא נורה אף-פעם (אין feeder; `crashListeners` ל-API-symmetry). C1 הוסיף את ה-feeder היחיד; מחיקתו = חזרה ל-dev. **אין אובדן חדש.** **השאר** את `crashListeners`+`onCrash` interface (כמו dev). איסוף-אמיתי = reaper נפרד |
| rebase של diag-harness מתנגש ב-stream-bridge (diag הוסיף hot-path timing) | אזורים שונים (timing סביב parse/stringify :114,:146 מול `.catch` :100,:158) → סביר נקי; אם קונפליקט — additive, פתירה ידנית (§9) |

## §6 — Escalation triggers
- אם מסתבר שיש נתיב **אמיתי** שבו ה-SDK כן מבטל את ה-readable (כלומר ה-teardown של C3 כן נחוץ למקרה אמיתי) → **עצור, שאל מרדכי** (ההנחה של האבחון מתערערת).
- אם מחיקת ה-onCrash-מ-stream שוברת את נתיב-ה-crash של spawn (opencode/codex) → תעד, שאל (לא אמור — spawn עובר spawn-core, לא stream-bridge).

## §7 — Complexity score
3/10: קובץ-מקור אחד עיקרי (stream-bridge) + connect-in-process (מחיקת block) + 2 טסטים. **ברובו revert/מחיקה**; אין
חוצה-שכבות מהותי (provider בלבד). blast-radius קטן (מסיר התנהגות, לא מוסיף). **verifier: light** — הליבה unit-testable;
ה-DoD החי ממוקד ("סשן לא נסגר-לבד").

## §8 — שאלות פתוחות
| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | להסיר `closed=true` מה-`.catch` לגמרי, או להשאירו (fail-fast, סשן-זומבי במקום נסגר)? | **להסיר** — התאמה ל-dev (סשן שורד); teardown אמיתי מ-`agentConn.closed`. (אם ה-WritableStream ממילא errored → זה cosmetic) | ❌ |
| 2 | למחוק את `onError` מה-interface לגמרי או להשאיר no-op? | **למחוק** — dead code אחרי revert; typecheck מוודא אין צרכן | ❌ |

## §9 — יחס לשרשרת + rebase (מרדכי מבצע אחרי READY+GO)
> ה-commit נוחת על `slice/be-crash-hardening` → crash-hardening נכון-כיחידה. אחר-כך:
```
crash-hardening (+fix) ──rebase──> be-diag-harness ──rebase──> options-trim
```
- **rebase `slice/be-diag-harness` על crash-hardening החדש** → מעדכן את worktree ה-be-diag-harness (החי) עם התיקון →
  **restart ל-BE החי** (PID 1207) כדי לעצור את דליפת-הסשנים. (⚠️ restart מנתק את 2 הסשנים החיים — לתאם עם המשתמש.)
- **rebase `slice/options-trim` על diag-harness החדש**.
- קונפליקט אפשרי יחיד: `stream-bridge.ts` מול hot-path-timing של diag-harness — אזורים שונים, additive.
- merge-order בסוף (אחרי אישור-משתמשת): crash-hardening → diag-harness → options-trim.
