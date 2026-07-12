# Slice — be-lifecycle-hardening — תוכנית

> **תאריך**: 2026-07-11 · **סטטוס**: ✅ **הושלם** (2026-07-11, 2 commits: 5d4a8b34..b1d1bde6). אביגיל r2 READY לפני ביצוע.
> **Complexity**: 6/10 (verifier: **light (calev)**, אך אימות-היתומים חייב להיות **חי** — child אמיתי, לא unit)
> **תלות**: `depends_on: []` · **base**: `dev` @ `0c8cb0e8` (השרשרת be-shutdown-hardening + crash-teardown + diag + options-trim + LAN כבר מוזגו; v0.15.0)
> **מקור**: bug-review 2026-07-06 findings #5 (claude `dispose`), #7 (DELETE-during-spawn race) + המשך-ישיר ל-`be-shutdown-hardening` §11(4) ("claude in-process בלי `dispose` → out-of-scope שם").
>
> ⚠️ **מסגור**: זה הסלייס שסוגר את **דליפת-ה-claude-child ב-in-process**. `be-shutdown-hardening` נתן kill-tree ל-**spawn**-connections (opencode/gemini/qoder), אבל **claude עובר `connectInProcess`** — אין child חשוף, לא עובר spawn-core, ו-`close()` שלו **לא קורא `dispose()`** → ה-SDK query לא נסגר → ה-claude CLI subprocess דולף. הסלייס מוסיף dispose-on-close (#5) + סוגר race של DELETE-בזמן-spawn שמייצר child אלמותי-בלתי-נגיש (#7).
>
> ⚠️ **base חדש (dev ממוזג) → מספרי-שורות ב-§4 אינדיקטיביים** — הישען על **סמלים** (אביגיל תאמת שכולם קיימים).

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/be-lifecycle-hardening -b slice/be-lifecycle-hardening dev
cd .worktrees/be-lifecycle-hardening
pnpm install && pnpm hooks:install
```

### Run
- BE: `cd packages/backend && PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts`
  (ל-DoD של claude-dispose צריך **claude חי** → onecli/מפתח claude; בדיקת-#7 אפשר גם עם opencode/codex).
- ה-claude child שדולף: אחרי connect-claude חי, `pgrep -af claude` (POSIX) מראה את ה-CLI subprocess שה-SDK spawn.

### כלי-אימות (POSIX)
```bash
# ה-claude child(ים) של ה-BE (ה-SDK spawn אותם; pid לא נשמר אצלנו — pid=null ב-registry)
pgrep -af "claude" | grep -v grep
# עץ-הצאצאים של ה-BE
pstree -p <BE_PID>
# אחרי close/DELETE — לוודא שה-child מת
kill -0 <claude_child_pid> 2>&1   # → "No such process" = מת (טוב)
```

### Reading list
**must-read**:
- `packages/provider/src/connection/connect-in-process.ts` — `connectInProcess`. **`close()`** (≈300-314):
  היום `bridge.close()` + `await agentConn.closed` — **בלי `claudeAgent.dispose()`**. כאן #5.
  `claudeAgent` (סגור ב-closure, ≈139, מוגדר ב-`.onConnect` ≈151).
- `packages/provider/node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js` (0.52.0) —
  **`dispose()`** (≈1733) → `teardownSession` (≈1710) → `closeQueryStream` (≈1694, `query.close()` = *"terminates the subprocess"*).
  **`index.js`** (≈55-65): התקדים — `connection.closed.then(shutdown)` שקורא `agent.dispose()`. אנחנו **חסרים** את החיווט הזה.
- `packages/backend/src/acp/connection-registry.ts` — `connect` (≈101-156): **`map.set` קורה *אחרי* ה-`await connect…`**;
  `close` (≈189-198): **early-return אם `!map.get`**. זה חלון-ה-race של #7.
- `packages/backend/src/app/agent-orchestrator.ts` — `createAndSpawn` (≈118-192, ה-`await connectionRegistry.connect`)
  + `deleteAndKill` (≈194-210, קורא `connectionRegistry.close`). ה-race נחשף כאן (create בטיסה מול delete).

**reference (לא לגעת)**:
- `packages/provider/src/connection/connect-codex-in-process.ts` — codex `close()` כבר מנקה את ה-child שלו
  (`serverIn.end()` → fork הורג אחרי 2s). **codex לא צריך #5** — התקדים למה dispose חסר רק ב-claude.
- `packages/provider/src/providers/claude/query-access.ts` — הדפוס לצימוד-רך ל-`claudeAgent` (ל-context בלבד).

## §1 — מטרה

אחרי הסבב: **סגירת connection של claude in-process (close/DELETE) מסיימת את ה-claude CLI subprocess** —
אין יותר claude יתום ששורד את הסוכן. **ו**-DELETE שמגיע *בזמן* ש-spawn עדיין בטיסה **לא** מייצר
connection אלמותי-בלתי-נגיש (child שאף אחד לא יכול להרוג). **אין** שינוי התנהגות גלוי למשתמש —
קשיחות-lifecycle בלבד.

> **הקשר** (be-shutdown-hardening §10): kill-tree שם כיסה spawn-connections. claude/codex הם in-process
> → מנוקים ב-`close()` **שלהם**. codex ✅ (fork הורג את ה-child). **claude ❌** — `close()` לא קורא dispose →
> ה-query (וה-subprocess) שורדים. הסלייס סוגר בדיוק את הפער הזה, + race נלווה שמייצר את אותו סימפטום
> (child בלתי-נגיש) מכיוון אחר.

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| `claudeAgent.dispose()` ב-`connectInProcess.close()` (#5) — סוגר את ה-SDK query → subprocess | ✅ | Commit 0 |
| timeout-guard על ה-dispose (turn תקוע לא יתקע את close לנצח) | ✅ | Commit 0 |
| סגירת race: DELETE-בזמן-spawn → child בלתי-נגיש (#7) | ✅ | Commit 1 |
| double-connect guard (אותו agentId ב-connect בטיסה) — נלווה ל-#7 | ✅ | Commit 1 |
| **onCrash על מוות-אמיתי של claude child (#6)** | ❌ | **נדחה** — ר' §6-דחייה + §9 Q1. אין signal-host נקי ללא fork; ה-adapter כבר דוחה turns; שייך ל-`be-hang-supervisor` (watchdog חיצוני). |
| codex dispose | ❌ | codex `close()` כבר מנקה (`serverIn.end`→fork). לא נוגעים. |
| שינוי ב-spawn-core / kill-tree | ❌ | be-shutdown-hardening (מוזג). in-process לא עובר שם. |
| watchdog חיצוני / התאוששות-hang / RSS | ❌ | `be-hang-supervisor` (slice נפרד) |

## §3 — Architecture

```
close() של claude in-process [Commit 0]                 DELETE-בזמן-spawn [Commit 1]
  connect-in-process.ts::close()                          connection-registry.ts
    await claudeAgent?.dispose()  ← חדש                     connect(id): pending.set(id, token)
        teardownSession(each)                                 conn = await connectInProcess(…)  ← חלון-race
          cancel()/interrupt()                                if token.cancelled:               ← חדש
          closeQueryStream → query.close()                       await conn.close(); return/throw
            ⇒ terminates claude subprocess                     map.set(id, …)
    (עטוף ב-timeout guard)                                  close(id): token?.cancelled = true  ← חדש
    bridge.close(); await agentConn.closed                    (משדר ל-connect בטיסה לבטל)
    clear listeners
```

## §4 — Commits

### Commit 0 — dispose-on-close ל-claude in-process (#5) (approach: mixed — unit + live)

**קבצים**: `packages/provider/src/connection/connect-in-process.ts` (+ `connect-in-process.test.ts`)

היום (≈300-314):
```ts
async close(): Promise<void> {
  bridge.close()
  await agentConn.closed.catch(() => {})
  frameListeners.clear()
  changeListeners.clear()
  crashListeners.clear()
}
```

**החלף ל** (dispose לפני bridge.close — לסיים את ה-subprocess בעודו נגיש):
```ts
async close(): Promise<void> {
  // #5 — סיים את כל ה-SDK sessions → query.close() מסיים את ה-claude subprocess.
  // בלי זה ה-child דולף (be-shutdown kill-tree לא מכסה in-process). dispose אידמפוטנטי
  // ובטוח על 0 sessions (Promise.all([])). timeout-guard: turn תקוע לא יתקע את close לנצח.
  if (claudeAgent) {
    await withTimeout(claudeAgent.dispose(), DISPOSE_TIMEOUT_MS).catch((err) => {
      // dispose נכשל/נתקע — ממשיכים לסגור bridge; ה-subprocess ייתפס ע"י
      // graceful-shutdown/kill-tree של ה-BE כרשת-בטחון. לא זורקים החוצה.
      log.warn({ err }, "claudeAgent.dispose() failed/timed-out during close — continuing")
    })
  }
  bridge.close()
  await agentConn.closed.catch(() => {})
  frameListeners.clear()
  changeListeners.clear()
  crashListeners.clear()
}
```
- `DISPOSE_TIMEOUT_MS = 5000` (module-const; ר' §9 Q2).
- `withTimeout(p, ms)` — **‏אין עוזר-נגיש ב-provider** (‏אביגיל #3: רק `Promise.race` inline ב-`ws.ts:107`/`client.ts:256`).
  **‏כתוב עוזר מקומי קטן** ב-`connect-in-process.ts` (module-level): `Promise.race([p, new Promise((_,rej)=>{const t=setTimeout(()=>rej(new Error("dispose timeout")),ms); t.unref?.()})])`. אל תחפש reuse.
- `log` — **‏`createLogger` אינו מיובא כיום ב-`connect-in-process.ts`** (‏אביגיל #2 — אומת). **‏הוסף**:
  `import { createLogger } from "@drive-coding/core/log"` + `const log = createLogger("provider.connect-in-process")`
  (דפוס זהה ל-`stream-bridge.ts:21-24`). בלי זה ה-`log.warn` ב-close() לא יתקמפל.

> ⚠️ **סדר**: dispose **לפני** `bridge.close()`. dispose פועל ישירות על `claudeAgent.sessions` (מסלול ה-query מול ה-subprocess, **לא** דרך ה-ACP wire) → עובד גם אחרי bridge.close, אבל dispose-first נותן interrupt נקי בעוד ה-object שלם ותואם את התקדים (`connection.closed.then(dispose)` ב-index.js).
> ⚠️ **`claudeAgent` יכול להיות undefined** (close לפני onConnect אי-פעם) → guard `if (claudeAgent)` (או `claudeAgent?.`).
> ⚠️ **אל תשבור את נתיב-ה-C3**: אנחנו **לא** מוסיפים teardown על stream-error. dispose נקרא **רק** מ-`close()` המפורש — לא מ-`.catch` של agentConn/bridge. (crash-teardown-fix הפך את ה-stream-errors ל-log-only; זה נשאר.)

**testing (unit)** — `connect-in-process.test.ts`:
- **חדש**: mock/spy ל-`ClaudeAcpAgent.dispose` (או שימוש ב-`getQuery`-סגנון בדיקה) → קרא `connection.close()` → ודא `dispose` נקרא **פעם אחת**, ו-`close()` נפתר גם כש-`dispose` נדחה (timeout-path). ה-mock: `vi.spyOn` על ה-prototype, או להזריק agent-כפול. (הטסטים הקיימים structural — אין claude אמיתי; שמור על אותו סגנון.)
- **שמור** את הטסט הקיים "stream write rejection does NOT fire onCrash (C3 reverted)" — dispose לא מופעל שם (אין close).

**Verification**:
```bash
pnpm --filter @drive-coding/provider test -- connect-in-process
pnpm --filter @drive-coding/provider typecheck
```

### Commit 1 — סגירת DELETE-בזמן-spawn race (#7) (approach: unit + live)

**קבצים**: `packages/backend/src/acp/connection-registry.ts` (+ `connection-registry.test.ts`)

**ה-race** (היום): ב-`connect(agentId)` ה-`map.set` קורה **אחרי** ה-`await connectInProcess/connectSpawn`.
בחלון ה-await, `close(agentId)` עושה `map.get` → undefined → early-return (no-op). אחר-כך connect משלים
ו-`map.set` רושם connection ש**אין דרך להגיע אליו** (הסוכן כבר נמחק) → **child אלמותי**.

**התיקון — טוקן-ביטול פר-spawn-בטיסה**:
```ts
// module-scope בתוך createConnectionRegistry:
const pending = new Map<string, { cancelled: boolean }>()

async connect(agentId, cliKind, connectOpts) {
  if (map.has(agentId)) throw new Error(`connection-registry: agentId already live: ${agentId}`)
  if (pending.has(agentId)) throw new Error(`connection-registry: agentId already connecting: ${agentId}`) // double-connect guard
  const token = { cancelled: false }
  pending.set(agentId, token)
  try {
    const rec = wireRecorder?.open(agentId) ?? { record() {}, close() {} }
    const conn = cliKind === "claude" ? await connectInProcess(connectOpts)
      : cliKind === "codex" ? await connectCodexInProcess(connectOpts)
      : await connectSpawn(cliKind, connectOpts)

    // #7 — DELETE הגיע בזמן ה-spawn? סגור מיָד ואל תרשום (מונע child אלמותי).
    if (token.cancelled) {
      rec.close()
      await conn.close().catch(() => {})
      throw new Error(`connection-registry: connect cancelled by concurrent close: ${agentId}`)
    }

    // …register onFrame + onCrash (verbatim מהקוד הקיים)…
    map.set(agentId, { conn, attached: false, rec, unsubs: [unsubFrame, unsubCrash] })
    return conn
  } finally {
    pending.delete(agentId)
  }
}

async close(agentId) {
  const pend = pending.get(agentId)
  if (pend) pend.cancelled = true    // #7 — סמן ל-connect שבטיסה לבטל
  const e = map.get(agentId)
  if (!e) return                     // (אם רק pending — הסימון לבד מספיק; connect יסגור בעצמו)
  cleanup(agentId)
  try { await e.conn.close() } catch { /* child may already be dead */ }
}
```

> **הערות עיצוב**:
> - **`rec` נפתח כעת בתוך ה-try** (זז פנימה) כדי שנוכל `rec.close()` בנתיב-הביטול. אימות: `wireRecorder?.open` cheap.
> - ה-`throw` בנתיב-הביטול עולה ל-`createAndSpawn` → ה-catch שלו מסמן `status:"crashed"` וזורק. **זה מקובל** — הסוכן ממילא בתהליך-מחיקה (deleteAndKill ריצה במקביל: update(closed)+delete). ה-`.catch(()=>{})` על update-crashed מספיג את הסדר. **התוצאה החשובה: ה-child נסגר, שום entry לא נשאר ב-map.**
> - **double-connect guard** (`pending.has`) — נלווה: מונע שני connect בו-זמנית לאותו agentId (היום רק `map.has` מגן, וזה לא מכסה את חלון-הטיסה).

**testing (unit)** — ⚠️ **קובץ-טסט חדש נפרד: `connection-registry.race.test.ts`** (לא בתוך הקיים!):

> **‏רקע חובה (אביגיל #1)**: `connection-registry.test.ts` הקיים **‏אינו** משתמש ב-`vi.mock` — הוא spawns
> **‏ילדים אמיתיים** דרך `OPENCODE_BIN` + סקריפטי-tmp (`ALIVE_SCRIPT`/`EXIT_SCRIPT`, ≈36-50). ילד-אמיתי
> **‏אינו יכול** לתת `connect` נדחה (connectSpawn נפתר מהר; אין להשהותו באמצע-await) → ה-race-test
> ‏הדטרמיניסטי **‏חייב `vi.mock`** על `@drive-coding/provider/connection`. **‏אבל `vi.mock` מורם ברמת-המודול
> ‏ויחול על כל הקובץ** → ‏אם תוסיף אותו ל-`connection-registry.test.ts` הוא **‏ישבור את הטסטים-החיים**.
> ‏לכן: **‏קובץ נפרד** `connection-registry.race.test.ts` עם ה-`vi.mock` מבודד בו.

- **`vi.mock("@drive-coding/provider/connection", …)`** — ה-factory **‏חייב לייצא-מחדש את כל 4 הסמלים**
  שה-registry מייבא (`connection-registry.ts:21`): `connectInProcess`, `connectSpawn`, `connectCodexInProcess`,
  ו-**`decodeWireLine`**. ⚠️ **השמטת `decodeWireLine` = קריסת-import** (‏לא כשל-assertion) — ה-registry קורא לו
  ב-`connect` (≈:125, מסלול onFrame). מַמֵּש `decodeWireLine` כ-pass-through פשוט (`(raw)=>({unparsed:true})` מספיק
  ל-onFrame; או `vi.importActual` ל-decodeWireLine האמיתי + mock רק ל-3 ה-connect).
- **`connect*` שמוקים** מחזירים **conn נדחה**: `connectSpawn` = `() => deferred.promise`, כאשר
  `deferred` = `{promise, resolve}` ידני; ה-conn שיוחזר = stub עם `onFrame:()=>()=>{}`, `onCrash:()=>()=>{}`,
  `close: vi.fn(async()=>{})`, `turn`/`pid`/`wire` מינימליים.
- **race-חדש**: `const p = registry.connect(id, "opencode", opts)` (בטיסה, לא await) → `await registry.close(id)`
  → `deferred.resolve(connStub)` → `await expect(p).rejects.toThrow(/cancelled by concurrent close/)`. ודא:
  (א) `connStub.close` **‏נקרא** (`toHaveBeenCalled`); (ב) `registry.get(id) === undefined` (map ריק).
- **double-connect guard**: `registry.connect(id,…)` בטיסה + `registry.connect(id,…)` שני → השני `rejects` מיָד (`/already connecting/`).
- **שמור** את `connection-registry.test.ts` הקיים **‏ללא שינוי** — הטסט "double-connect → 'already live'" (≈:246)
  מלא-await את conn1 (pending כבר נמחק) → עדיין עובר עם ה-guard החדש. ה-NBug1 dedup נשמר.

> **fallback (אם ה-`vi.mock` מסתבך)**: §7 escalation מתיר live-only ל-#7 (DELETE מיָד אחרי POST → אין claude
> יתום + אין entry) — **פחות מועדף** (לא-דטרמיניסטי), אך תקף אם ה-mock נכשל. **העדפה: vi.mock בקובץ נפרד.**

**Verification**:
```bash
pnpm --filter @drive-coding/backend test -- connection-registry   # מריץ גם .test.ts (חי) וגם .race.test.ts (mock) — שניהם ירוקים
pnpm --filter @drive-coding/backend typecheck
```

## §5 — DoD

| בדיקה | איך |
|---|---|
| **חי: claude child מת ב-close** | חבר claude (in-process) → `pgrep -af claude` מראה subprocess → DELETE `/api/agents/:id` (או close) → תוך <6s ה-subprocess **מת** (`kill -0` → ESRCH). **לפני התיקון: שורד.** |
| **חי: אין claude יתום אחרי Ctrl+C** | חבר claude → Ctrl+C על ה-BE (graceful-shutdown קורא close→dispose) → אין `claude` יתום מה-session (`pgrep`). (משלים את be-shutdown-hardening ל-claude.) |
| dispose נקרא פעם-אחת ב-close | provider unit ירוק |
| close נפתר גם כש-dispose נכשל/timeout | provider unit ירוק (timeout-path) |
| **#7: DELETE-בזמן-spawn לא משאיר child** | backend unit ירוק (race test: conn.close נקרא, map ריק). **חי (אם ניתן):** DELETE מיָד אחרי POST /api/agents (claude) → אין claude יתום + אין entry ב-registry. |
| double-connect נדחה | backend unit ירוק |
| BE שורד את הכל | אחרי כל בדיקות ה-lifecycle — `http=200` ב-`/api/diag`; ה-BE ממשיך לרוץ |
| build-gate | typecheck (provider+backend) + כל הטסטים ירוקים; **0 רגרסיות** בטסטים הקיימים של שני הקבצים |

## §6 — Risks + §6-דחייה (#6)

### Risks
| סיכון | מקור | מיטיגציה |
|---|---|---|
| `dispose()` נתקע (turn wedged → interrupt→force-cancel floor) → close תקוע | adapter cancel-floor (`forceCancelGraceMs`) | `withTimeout(dispose, 5000)` + `.catch` → ממשיכים לסגור bridge; kill-tree/graceful-shutdown כרשת-בטחון |
| dispose מפעיל stream-write על bridge שנסגר | סדר | dispose **לפני** `bridge.close()`; dispose ממילא לא עובר ב-wire (query ישיר ל-subprocess) |
| 🔴 שבירת נתיב-C3 בטעות (teardown על stream-error) | crash-teardown-fix | dispose נקרא **רק** מ-`close()`; **אסור** לחווט ל-`.catch` של agentConn/bridge. §4 מדגיש. |
| #7 `throw` בנתיב-ביטול מרעיש לוג | orchestrator catch | ה-catch כבר קיים; הודעה ברורה "cancelled by concurrent close"; זה נתיב-מחיקה מכוון |
| #7 שינוי מבנה `connect` (rec זז פנימה, try/finally) | registry | שמור onFrame/onCrash **verbatim**; רק לעטוף ב-try/finally + 2 בדיקות-token; טסטים קיימים מגנים |
| dispose double-call (close אחרי close) | idempotency | dispose אידמפוטנטי (guarded by queryClosed) + `close()` שלנו לא נקרא פעמיים (registry cleanup+close חד-פעמי) |
| i18n / Svelte / OneCLI | 3-הקבועים | BE/provider בלבד, אין UI-strings, אין Svelte; claude חי דורש onecli ל-DoD בלבד |

### §6-דחייה — למה #6 (onCrash על מוות-אמיתי) **מחוץ-scope**
נבדק חי מול ה-adapter 0.52.0 (`acp-agent.js`):
1. **ה-adapter כבר מטפל במוות-subprocess**: ה-consumer catch (≈1589) מזהה `processDied` (התאמת-מחרוזת על ProcessTransport/"process exited with"/signal) → `failAllTurns(...)` (**דוחה כל prompt תלוי** עם "The Claude Agent process exited unexpectedly. Please start a new session.") → `closeQueryStream` → `delete sessions[id]`. כלומר **ה-harm המקורי ש-#6 טען לו ("pending requests hang forever") לא קיים** ב-0.52.0 — ה-turns נדחים עם הודעה ברורה.
2. **אין signal-host נקי**: המוות מטופל *בתוך* ClaudeAcpAgent ו**לא נחשף** ל-`connectInProcess` (אין callback; `agentConn.closed` לא נפתר — ה-bridge חי). ה-signal היחיד שנצפה מבחוץ = מחרוזת-שגיאה על ה-wire → **שביר** (התאמת-מחרוזת) ו**חלקי** (רק אם turn באוויר; מוות-idle בלתי-נראה). זה בדיוק **לקח-C3**: אל תתלה teardown ב-signal-שביר.
3. **הנתיב-הנקי דורש fork** של ה-adapter (event/callback על processDied) — עלות-תחזוקה, מחוץ לסלייס תשתית זה.
4. **הבעלים הנכון** = `be-hang-supervisor` (watchdog חיצוני-ל-loop, agnostic לסיבה) שרואה מוות/hang/RSS מבחוץ דרך ה-OS — **בדיוק** התרחיש שאין לו signal פנימי נקי. **הפניה מפורשת נרשמת שם** (§roadmap update).
   - הפער-שנותר אחרי הסלייס הזה: registry-staleness (getRuntimeInfo אומר "alive" על claude-שמת-ספונטנית ללא close). **מינורי** (מתנקה ב-close/delete הבא) ומכוסה ע"י ה-supervisor.

## §7 — Escalation triggers
- `dispose()` מתגלה **לא-אידמפוטנטי** / זורק גם עם timeout-guard באופן שמשאיר את ה-BE לא-יציב → **עצור**, שאל מרדכי.
- ה-race-fix של #7 מתברר כלא-מספיק (child עדיין נשאר בתרחיש אחר, למשל DELETE *בין* map.set ל-return) → תעד את החלון המדויק, שאל.
- מתגלה ש-`connectInProcess`/`connectSpawn` הם imports-ישירים שאי-אפשר למוק בלי refactor-הזרקה → תעד; אפשר להסתפק ב-race-test דרך fake ב-`vi.mock` (העדפה) או לדחות את ה-unit ל-live-only (פחות טוב).
- מתגלה claude יתום **גם אחרי** dispose (ה-`query.close()` לא באמת הורג את ה-subprocess בגרסה שלנו) → זה שורש עמוק יותר (SDK) — תעד, שאל מרדכי לפני הרחבת-scope.

## §8 — Complexity score
6/10: 2 commits (0), 2 packages (provider+backend) (+1), רגישות-concurrency (race/token, #7) (+2),
רגישות-BE-lifecycle (dispose שנתקע יכול לתקוע close; C3-regression-risk) (+2), אימות-יתומים דורש child-חי
לא-אוטומטי-בקלות (+1). → **verifier: light (calev)**, אך **אימות claude-dispose חייב חי** (child אמיתי;
unit רק מוודא שהקריאה קורית). לא heavy — אין visual/E2E/FE (Commit-0/1 שניהם BE/provider).

## §9 — שאלות פתוחות
| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | #6 (onCrash real-death) בסלייס הזה? | **לא** — §6-דחייה (אין signal נקי; ה-adapter כבר דוחה turns; שייך ל-be-hang-supervisor) | ❌ |
| 2 | `DISPOSE_TIMEOUT_MS` | 5000ms (= escalation-floor של be-shutdown; נדיב ל-flush/interrupt) | ❌ |
| 3 | #7 — token-cancel מול "check-after-set + immediate-close" | token-cancel (מכסה גם את החלון שבו close רץ *לפני* map.set) | ❌ |
| 4 | codex dispose analog? | לא — codex `close()` כבר מנקה (`serverIn.end`→fork 2s). מחוץ-scope. | ❌ |
| 5 | `withTimeout` — עוזר קיים ב-provider? | **‏לא** (אביגיל #3 אישרה) — מקומי קטן (`Promise.race`+timer.unref) | ❌ |

## §10 — יומן-החלטות
נכתב ל-`docs/decisions/drive-coding.md` בחתימת-ה-dispatch: רציונל (dispose-on-close סוגר את הפער היחיד
שנשאר מ-be-shutdown-hardening §10 ל-claude in-process), דחיית-#6 (signal-שביר, לקח-C3, בעלות
be-hang-supervisor), ובחירת token-cancel ל-#7.
