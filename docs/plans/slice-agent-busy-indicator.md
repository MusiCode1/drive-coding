# Slice — אינדיקטור busy/idle לתהליכים (קליינט-פענוח עצמאי ב-BE) — תוכנית

> **תאריך**: 2026-06-16
> **סטטוס**: ✅ הושלם + מוזג ל-dev (calev-heavy GO 10/11; אומת ויזואלית 2026-06-16)
> **Complexity**: 7/10 (verifier: heavy / phase)
> **תלויות (`depends_on`)**: [slice-remove-idle-reaper, slice-active-processes-layout]
> **Base**: dev (`a52344f`) — active-agents + שני ה-slices לעיל כבר מוזגו
> **Dev tip**: dev=`a52344f`

---

## §0 — Pre-flight

### בסיס האימות + עיקרון ארכיטקטוני

1. **בסיס**: מיזוג active-agents בוצע ל-dev (b2c2349). כל הסמלים (`getRuntimeInfo`, `decodeWireLine` ב-`packages/backend/src/delivery/wire-decode.ts`, ה-pipe ב-ws-agent, http-agents enrichment, AgentPublic) נמצאים ב-dev. אמת מול dev.
2. **עיקרון-על (הגדרת המשתמש)**: ה-BE מריץ **קליינט-פענוח עצמאי משלו** מעל לוגיקה טהורה משותפת (`decodeWireLine`). **אסור** שום תלות בין ה-ACP client של ה-FE (`agent-session.svelte.ts`) לבין ה-tracker של ה-BE. הם שני instances נפרדים שלא מכירים זה את זה; משותף רק ה-decoder הטהור.

### תלויות (חובה!) — מולאו
- **slice-remove-idle-reaper** — ✅ מוזג ל-dev (a52344f). ה-Entry ב-bridge-manager נקי (אין `createdAt`/`lastDetachedAt`/`listIdle`/`getCreatedAt`); נשמרו `hasActiveWs`/`markAttached`/`markDetached`/`getRuntimeInfo`. ה-Commit 1 (stream-ownership) מרחיב את ה-Entry הזה.
- **slice-active-processes-layout** — ✅ מוזג ל-dev. ה-layout החדש (`.agent-top` + `.agent-meta`) קיים ב-`ActiveProcessesPanel.svelte`; אינדיקטור ה-busy ב-Commit 4 משתלב בו.

> שתי התלויות מולאו. base = dev `a52344f`.

### Worktree
```bash
cd D:/UserProjects/AI/drive-coding
git worktree add .worktrees/slice-agent-busy-indicator -b slice-agent-busy-indicator dev
cd .worktrees/slice-agent-busy-indicator
pnpm install && pnpm hooks:install
```

> base=`dev` (a52344f) — כל התלויות כבר ב-dev.

### איך להריץ
- BE tests: `pnpm --filter @drive-coding/backend test`
- core tests: `pnpm --filter @drive-coding/core test`
- FE: `pnpm --filter @drive-coding/frontend-v2 dev`
- כללי: `pnpm typecheck` ; `pnpm lint:i18n`
- הרצה חיה: `PORT=4001 onecli run --agent voice-acp -- bun --watch src/server.ts` + FE

### Reading list
**must-read**:
1. [wire-decode.ts](../../packages/backend/src/delivery/wire-decode.ts) — ה-decoder הטהור. `WireSummary { method?, sessionUpdate?, id?, responseKind?, unparsed, parsed? }`.
2. [ws-agent.ts](../../packages/backend/src/delivery/ws-agent.ts) — ה-pipe: `createInterface(child.stdout)` ב-connect, `rl.on("line")`, `logWire`, סדר "send → ואז log". זו נקודת ה-refactor.
3. [bridge-manager.ts](../../packages/backend/src/acp/bridge-manager.ts) — ה-store + `getRuntimeInfo` (אחרי slice-remove-idle-reaper). ה-stderr listener הקבוע ב-`spawnInternal` הוא התבנית ל-stdout reader קבוע.
4. [http-agents.ts](../../packages/backend/src/delivery/http-agents.ts) — enrichment של GET /api/agents.
5. [agent.ts schema](../../packages/core/src/schemas/agent.ts) — `AgentPublic` (כבר עם pid/attached).
6. [ActiveProcessesPanel.svelte](../../packages/frontend/src/lib/components/connect/ActiveProcessesPanel.svelte) — `statusColor`, ה-template (אחרי slice-layout).

**reference**:
- [ws-agent-pipe.test.ts](../../packages/backend/tests/ws-agent-pipe.test.ts) — דפוס בדיקת ה-pipe (mock child).

---

## §1 — מטרה

כיום אי אפשר לדעת מהפאנל אם CLI agent עובד כרגע או ב-idle: ה-`status` ב-registry אף פעם לא נכתב כ-`busy`, ו-`turnState` המדויק חי רק ב-FE עבור ה-session המחובר. אחרי ה-slice: ה-BE מזהה **לכל** agent (גם כשאף טאב לא מחובר) אם יש turn פעיל — ע"י צפייה קבועה ב-stdout של ה-child — והפאנל מציג אינדיקטור busy/idle בזמן אמת. בונוס: צפייה קבועה ב-stdout מתקנת backpressure פוטנציאלי כשטאב נסגר באמצע turn.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| bridge-manager בעלים יחיד של `child.stdout` (reader קבוע) | ✅ | ה-slice הזה |
| ws-agent נרשם ל-`onLine` במקום לקרוא את ה-stream ישירות | ✅ | ה-slice הזה |
| `turn-tracker.ts` — module טהור (busy state פר-frame) | ✅ | ה-slice הזה |
| `getRuntimeInfo` מחזיר גם `busy` | ✅ | ה-slice הזה |
| `AgentPublic.busy?: boolean` + enrichment ב-GET /api/agents | ✅ | ה-slice הזה |
| אינדיקטור busy/idle ב-`ActiveProcessesPanel` + i18n | ✅ | ה-slice הזה |
| **ה-BE כותב ל-child.stdin** | ❌ | **לא** — ws-agent ממשיך לכתוב stdin ישירות. ה-BE רק קורא |
| פענוח ה-out frames (prompts) ל-tracker | ❌ | לא בגרסה זו — heuristic מ-stdout בלבד מספיק. שדרוג עתידי |
| polling אוטומטי בפאנל (refresh) | ❌ | קיים `refresh` ידני; auto-refresh = slice נפרד |
| שינוי `turnState` של ה-FE | ❌ | **אסור** — הפרדה מוחלטת FE/BE |

> **למה לא כותבים ל-stdin**: זיהוי turn-end מדויק (result על prompt-id) דורש לראות את ה-prompt. אבל heuristic מ-stdout בלבד (`sessionUpdate` נכנס = busy; שקט > debounce = idle) מספיק לתצוגה, ולא דורש לראות את ה-out. נמנע מ-refactor של כתיבת ה-stdin → פחות סיכון regression.

---

## §3 — Architecture diagram

```text
─── stream ownership (bridge-manager בעלים יחיד) ───
spawnInternal:
  child.stderr ──(listener קבוע, קיים)──> ring buffer
  child.stdout ──(readline קבוע, חדש)──> onStdoutLine(id, line):
       1. emit("line", line)         → ws-agent (אם מחובר) → feWs.send   ← FE FIRST
       2. decodeWireLine(line)       → turnTracker.observe(id, summary)  ← decode AFTER (try/catch)

bridge-manager API חדש:
  onLine(bridgeId, cb): () => void          ← subscription לשורות stdout
  getRuntimeInfo(id): { pid, attached, busy }   ← busy נוסף

─── ws-agent (refactor) ───
on connect:  במקום createInterface(child.stdout) → unsub = bridgeManager.onLine(agentId, line => feWs.send(`${line}\n`))
on close:    unsub()    (child.stdin.write נשאר ללא שינוי)

─── turn-tracker (module טהור, הקליינט של ה-BE) ───
observe(summary, now):
   sessionUpdate נוכח (agent_message_chunk/tool_call/...) → busy=true, lastActivity=now
   (responseKind="result" אינו מאפס — לא אמין כ-turn-end; ר' §4)
isBusy(now): busy && (now - lastActivity) < idleDebounceMs   ← שקט > debounce מוריד אוטומטית ל-idle
   נשען רק על WireSummary (decodeWireLine). אפס תלות ב-FE.

─── תצוגה ───
getRuntimeInfo.busy → GET /api/agents (enrichment) → AgentPublic.busy → ActiveProcessesPanel (אינדיקטור)
```

---

## §4 — Commits בסדר

### Commit 1 — stream-ownership refactor: bridge-manager בעלים יחיד של stdout (approach: integration)

> **Phase verifier אחרי commit זה** — זו נקודת ה-regression הקריטית. calev mode: phase: לוודא ש-pipe ל-FE עובד ביט-אין-ביט (שיחה + reconnect), ושאין עיכוב/אובדן frames.

**מטרה**: ה-bridge-manager קורא את `child.stdout` תמיד (reader קבוע), ומפרסם שורות ל-subscribers. ה-ws-agent מפסיק לקרוא את ה-stream ישירות.

**קבצים שמשתנים**:
- [bridge-manager.ts](../../packages/backend/src/acp/bridge-manager.ts):
  - ב-`spawnInternal`, אחרי רישום ה-stderr listener: צור `createInterface({ input: child.stdout, crlfDelay: Infinity })` קבוע. ל-`rl.on("line", ...)`: (1) קרא לכל ה-subscribers של ה-bridge עם השורה; (2) **אחרי כן** decode+observe (Commit 3). ב-Commit 1 — רק (1).
  - הוסף ל-`Entry` שדה `lineSubscribers: Set<(line: string) => void>`.
  - הוסף למתודות המוחזרות: `onLine(bridgeId, cb): () => void` (מוסיף ל-Set, מחזיר unsubscribe).
  - שמור על `child.stdout.setEncoding("utf8")`.
- [ws-agent.ts](../../packages/backend/src/delivery/ws-agent.ts):
  - הרחב את ה-deps type של `createAgentWsHandler` ב-`onLine(bridgeId, cb): () => void`.
  - **הסר** את `createInterface(child.stdout)` + `rl.on("line")` + `rl.close()`.
  - במקום: `const unsub = deps.bridgeManager.onLine(agentId, (line) => { if (line.length) { try { feWs.send(\`${line}\n\`) } catch {} ; logWire("in", line) } })`.
  - ב-`feWs.on("close")`: קרא ל-`unsub()` במקום `rl.close()`. **שאר הכל ללא שינוי** (כולל `child.stdin.write` ב-`feWs.on("message")` — נשאר ישיר).
- [ws-agent-pipe.test.ts](../../packages/backend/tests/ws-agent-pipe.test.ts) — **חובה לעדכן** (אביגיל r1): ה-mock הנוכחי הוא `{ getChild, markAttached, markDetached }` וה-test מזריק שורות דרך `child.stdout.write(...)` (כי ה-handler קרא את ה-stream ישירות). אחרי ה-refactor: (1) הוסף ל-mock `onLine: (id, cb) => { ... }` שמאפשר ל-test לדחוף שורות דרך ה-callback; (2) שנה את ההזרקה — במקום `child.stdout.write`, הפעל את ה-callback הרשום. עדכן את כל ה-`it(...)` שמשתמשים ב-bridgeManager mock (יש ~11 ב-קובץ; אלה שמזריקים שורות stdout). זהו עיקר עבודת ה-test בקומיט הזה.

> ⚠️ קריטי: סדר הפעולות ב-reader — `feWs.send` (דרך subscriber) **לפני** decode. הפענוח לעולם בתוך try/catch ולעולם לא מעכב/שובר את ה-pipe (בדיוק כמו `logWire` היום).
> ⚠️ אם אין subscriber (אין feWs) — ה-reader עדיין רץ וצורך את ה-stdout (מונע backpressure). זה רצוי.

**API skeleton**:
```ts
// bridge-manager return type (תוספת):
onLine(bridgeId: string, cb: (line: string) => void): () => void
```

**Verification**:
```bash
pnpm --filter @drive-coding/backend test    # ws-agent-pipe.test.ts ירוק (אולי דורש עדכון mock ל-onLine)
pnpm typecheck
# manual (phase): connect → prompt → תשובה זורמת מלאה; סגור+פתח טאב (reconnect) → עובד
```

### Commit 2 — turn-tracker טהור (approach: tdd)

**מטרה**: module טהור שמחזיק busy-state פר-agent מתוך `WireSummary`. לוגיקה טהורה, אפס IO → TDD.

**קבצים חדשים**:
- `packages/backend/src/acp/turn-tracker.ts`
- `packages/backend/src/acp/turn-tracker.test.ts`

**API skeleton**:
```ts
import type { WireSummary } from "../delivery/wire-decode.js"

export type TurnTracker = {
  /** עדכן מצב מ-frame נכנס (stdout). now מוזרק לדטרמיניזם בטסט. */
  observe(summary: WireSummary, now: number): void
  /** האם יש turn פעיל (פלט לאחרונה ולא הסתיים/לא חלף debounce). */
  isBusy(now: number): boolean
}

export function createTurnTracker(opts?: { idleDebounceMs?: number }): TurnTracker
```

**לוגיקה** (heuristic מ-stdout בלבד — **debounce-שקט הוא המנגנון העיקרי**):
- `summary.sessionUpdate` נוכח (כל ערך: agent_message_chunk / tool_call / tool_call_update / ...) → `busy=true`, `lastActivityAt=now`. זהו האות החיובי היחיד והאמין.
- `isBusy(now)`: `true` רק אם `busy && (now - lastActivityAt) < idleDebounceMs`. ברירת מחדל `idleDebounceMs = 1500`. כך שקט > debounce → אוטומטית idle, גם בלי אות סיום מפורש.
- ⚠️ **אל תסתמך על `responseKind === "result"` כאות turn-end**: `decodeWireLine` מסמן `result` לכל תגובת JSON-RPC (גם `session/new`, `session/load`, capabilities וכו'), לא רק לסיום turn (אביגיל r1). לכן `result` **אינו** מאפס busy. אם בעתיד נרצה איפוס מיידי — צריך להתאים `result` ל-`id` של ה-prompt (דורש לראות out-frames; מחוץ ל-scope, §2).
- frames לא רלוונטיים (`$/ping`, `unparsed`, `responseKind`, method ללא sessionUpdate) → אין שינוי על busy (רק debounce-השקט מורידו).

**Tests** (דטרמיניסטי, `now` מוזרק):
| # | תרחיש | צפוי |
|---|---|---|
| 1 | observe sessionUpdate → isBusy מיד | true |
| 2 | sessionUpdate ואז responseKind=result, שקט < debounce | isBusy=**true** (result לא מאפס) |
| 3 | sessionUpdate ואז שקט > debounce | isBusy=false |
| 4 | sessionUpdate, שקט < debounce | isBusy=true |
| 5 | frame לא רלוונטי ($/ping / unparsed / result בלבד) | אין הדלקת busy |
| 6 | רצף chunks מרובים (כל אחד מאפס lastActivity) | נשאר busy לאורך הרצף |

**Verification**:
```bash
pnpm --filter @drive-coding/backend test
pnpm typecheck
```

### Commit 3 — חיווט: bridge-manager → tracker → getRuntimeInfo → schema (approach: integration)

> **Phase/heavy verifier אחרי commit זה** — נקודת ה-end-to-end. calev: לוודא ש-busy מופיע ב-GET /api/agents בזמן turn אמיתי, וחוזר ל-idle בסיומו.

**קבצים שמשתנים**:
- [bridge-manager.ts](../../packages/backend/src/acp/bridge-manager.ts):
  - הוסף ל-`Entry`: `tracker: TurnTracker` (אתחל ב-`spawnInternal`).
  - ב-reader (אחרי שליחת השורה ל-subscribers): `try { e.tracker.observe(decodeWireLine(line), Date.now()) } catch {}`.
  - `getRuntimeInfo`: הוסף `busy: e.tracker.isBusy(Date.now())` להחזרה.
- [agent.ts schema](../../packages/core/src/schemas/agent.ts):
  - ב-`AgentPublic`: הוסף `"busy?": "boolean"` (enrichment, ליד pid/attached). **אל** תוסיף ל-`Agent` או ל-`toAgentPublic` (זה runtime enrichment, לא state מתמשך).
- [http-agents.ts](../../packages/backend/src/delivery/http-agents.ts):
  - **עדכן את ה-deps type** (אביגיל r1): כיום `bridgeManager?: { getRuntimeInfo(id): { pid: number; attached: boolean } | null }` — הוסף `busy: boolean` לטיפוס המוחזר, אחרת TS לא יראה את `busy` ב-`rt` וה-spread לא יכלול אותו בבטחה.
  - לוגיקת ה-enrichment עצמה (`{ ...toAgentPublic(a), ...(rt ?? {}) }`) **לא** משתנה — `rt` כולל כעת `busy` ומתפשט אוטומטית. ודא ידנית שזה מגיע ל-JSON.
- [http-agents.test.ts](../../packages/backend/tests/http-agents.test.ts) — **חובה לעדכן** (אביגיל r2): ה-mock ב-שורה ~408 הוא `getRuntimeInfo: vi.fn(() => ({ pid: 12345, attached: true }))` — חסר `busy`. אחרי שינוי ה-type, typecheck ייכשל. הוסף `busy: false` (או `true`) ל-return של ה-mock.

**API skeleton** (getRuntimeInfo אחרי):
```ts
getRuntimeInfo(bridgeId: string): { pid: number; attached: boolean; busy: boolean } | null
```

**Verification**:
```bash
pnpm --filter @drive-coding/backend test
pnpm --filter @drive-coding/core test     # agent-schema.test.ts אם נוגע
pnpm typecheck
# manual: agent בשיחה ארוכה → GET /api/agents מראה busy:true; אחרי סיום → busy:false
```

### Commit 4 — FE: אינדיקטור busy/idle בפאנל (approach: manual)

**קבצים שמשתנים**:
- [ActiveProcessesPanel.svelte](../../packages/frontend/src/lib/components/connect/ActiveProcessesPanel.svelte):
  - אינדיקטור ויזואלי כש-`agent.busy === true`: נקודת-סטטוס פועמת (animation) ו/או תווית `t("connect.agents.working")` קטנה ליד הסטטוס. כש-idle — מצב רגיל.
  - השתלב בשורת המידע הראשי מ-slice-active-processes-layout.
- [he.ts](../../packages/core/src/i18n/catalogs/he.ts) + [en.ts](../../packages/core/src/i18n/catalogs/en.ts) + [keys.ts](../../packages/core/src/i18n/keys.ts):
  - הוסף key `"connect.agents.working"` (he: "עובד…", en: "working…"). (idle = ללא תווית, לא נדרש key.)

**Verification**:
```bash
pnpm typecheck ; pnpm lint:i18n ; pnpm lint:rtl
pnpm --filter @drive-coding/frontend-v2 test
# manual: שלח prompt ארוך → השורה בפאנל מסמנת "עובד…"/פועמת; בסיום → חוזר רגיל
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|---|---|
| 1 | כל ה-tests ירוקים (core+backend+frontend) | `pnpm test` |
| 2 | typecheck + lint:i18n + lint:rtl | הפקודות |
| 3 | turn-tracker unit tests (6 תרחישים) | `pnpm --filter @drive-coding/backend test` |
| 4 | pipe ל-FE עובד ביט-אין-ביט (regression) | manual: שיחה מלאה + reconnect |
| 5 | אין עיכוב/אובדן frames ביציאה לזרם | manual: תשובה ארוכה זורמת חלק |
| 6 | GET /api/agents מחזיר `busy:true` בזמן turn | curl בזמן prompt פעיל |
| 7 | `busy` חוזר ל-false בסיום turn | curl אחרי סיום |
| 8 | busy עובד גם **בלי** טאב מחובר | סגור טאב באמצע turn → BE עדיין מסמן busy |
| 9 | הפאנל מציג אינדיקטור busy/idle | ויזואלי |
| 10 | אין תלות FE↔BE client | code review: turn-tracker מייבא רק wire-decode; לא agent-session |
| 11 | backpressure: טאב נסגר באמצע turn → CLI לא נתקע | manual: סגור טאב, ה-CLI מסיים turn |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| הפענוח ב-reader מעכב את ה-frame ל-FE | decode בנתיב הקריטי | סדר מחייב: `feWs.send` (subscriber) **לפני** decode; decode ב-try/catch מבודד |
| שני readers על אותו stream (regression) | refactor של בעלות ה-stream | ws-agent **מפסיק** לקרוא ישירות; bridge-manager הבעלים היחיד. Commit 1 + phase verifier |
| אובדן/כפילות frames אחרי refactor | שינוי ה-pipe | ws-agent-pipe.test.ts + manual שיחה מלאה |
| busy "תקוע" true (לא חוזר ל-idle) | אין `result` ברור | debounce על שקט (`idleDebounceMs`) מבטיח חזרה ל-idle |
| תלות סמויה FE↔BE | "client" משותף | turn-tracker מייבא **רק** `wire-decode` (pure). DoD #10. אסור לייבא agent-session |
| `decodeWireLine` לא מזהה sessionUpdate בכל ה-CLIs | פורמט ACP שונה בין claude/opencode/gemini | heuristic גס (כל sessionUpdate=busy) סובלני; debounce מכסה. אם CLI לא פולט sessionUpdate — busy לא יידלק (degraded, לא שבור) |
| מחרוזות עברית קשיחות | pre-commit hook | key `connect.agents.working` ב-catalog; אין hardcode |
| arktype optional field (`busy?`) | schema validation | עקוב אחר התבנית הקיימת של `pid?`/`attached?` ב-AgentPublic |

> 3 שתמיד נשכחים: (1) i18n — `connect.agents.working`; (2) Svelte 5 reactivity — `agent.busy` הוא prop מתוך `$state` array, ה-`{#each (agent.id)}` הקיים מספיק; (3) OneCLI placeholder — לא רלוונטי.

---

## §7 — Escalation triggers

- כדי לזהות turn-end מדויק מסתבר שחייבים לראות את ה-out frames (prompts) — עצור ושאל (זה מרחיב scope לכתיבה/האזנה ל-stdin).
- ה-refactor של בעלות ה-stream דורש שינוי ב-`child.stdin.write` או בהתנהגות ה-WS — עצור (§2 אומר: stdin נשאר ישיר).
- אתה נדרש לייבא/לגעת ב-`agent-session.svelte.ts` כדי לחבר busy — עצור (הפרת ההפרדה FE/BE).
- `decodeWireLine` לא מספקת את השדות שה-tracker צריך — עצור, דווח (אולי צריך הרחבת ה-decoder, slice נפרד).
- פתחת 3+ גישות ל-stream ownership ואף אחת לא שומרת את ה-pipe תקין — עצור.

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|---|---:|
| Streaming/real-time (stdout pipe) | +2 |
| Refactor של קוד קיים (stream ownership) | +1 |
| Cross-store data flow (BE tracker → schema → FE) | +2 |
| State machine (turn busy/idle + debounce) | +2 |
| >5 files ב->2 packages | +1 |
| Pure logic core (turn-tracker, TDD) | -2 |
| נטו | +6 |

**Score**: 7/10
**Tier**: `calev` mode: light בסוף + **phase אחרי Commit 1** (regression ה-pipe) + **phase אחרי Commit 3** (end-to-end busy). אם ה-pipe refactor יתגלה שביר → שדרג ל-calev-heavy.

> האימות המרכזי הוא runtime (התנהגות ה-pipe + busy בזמן אמת). turn-tracker עצמו pure→TDD.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | `idleDebounceMs`? | 1500ms | ❌ |
| 2 | להסתמך על `result` או רק debounce-שקט? | שניהם (result מאפס מיד, שקט כ-fallback) | ❌ |
| 3 | אינדיקטור: נקודה פועמת / תווית / שניהם? | נקודה פועמת + תווית "עובד…" | ❌ |
| 4 | auto-refresh לפאנל כדי לראות busy חי? | לא ב-slice הזה (refresh ידני קיים) | ❌ |
| 5 | להזין גם out-frames ל-tracker בעתיד (turn-start מדויק)? | לא עכשיו; שדרוג עתידי | ❌ |

---

## סטיות מהתכנון (מתעדכן ע"י executor)

- ...
