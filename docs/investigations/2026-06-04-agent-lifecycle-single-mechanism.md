# Agent Lifecycle — מנגנון יחיד (תכנון על נייר, טרם brief)

תאריך: 2026-06-04
מחבר: מרדכי (planner)
סטטוס: **תכנון — לא מומש, לא brief**. נכתב לפני קוד כדי להכריע על היקף.
הקשר: "future A" שהובטחה אחרי ה-reaper הזמני (slice 26) ו-NBug2 (ws-reconnect).

---

## 1. הבעיה — 4 מקורות-אמת לאותו agent

מצב של agent יחיד מפוזר היום על פני **4 מבני-נתונים נפרדים**, שכולם אמורים
להסכים ואף אחד לא אוכף סנכרון:

| # | מבנה | קובץ:שורה | מחזיק | תפקיד |
|---|------|-----------|-------|-------|
| 1 | `registry.store` | `agents/registry.ts:11` | `Agent` (id, status, cwd, createdAt, acpSessionId, crashReason) | מצב **לוגי** |
| 2 | `bridge.store` | `acp/bridge-manager.ts:34` | child, stderr, `hasActiveWs`, `lastDetachedAt`, `createdAt`(כפול) | מצב **פיזי** + TEMPORARY |
| 3 | `activeFeWs` | `delivery/ws-agent.ts:51` | ה-WS החי per-agent | מקור-אמת **שלישי** ל-connected |
| 4 | `bridgePorts` + `stderrGetters` | `app/agent-orchestrator.ts:86,90` | port + getter per-agent | maps צדדיים |

### תסמיני הבלגן
- **`connected` ב-3 מקומות**: `hasActiveWs` (#2), `activeFeWs.has` (#3), ובעקיפין `status==="ready"` (#1).
- **`createdAt` ב-2 מקומות**: `Agent.createdAt` (ISO, #1, אזרח) + `Entry.createdAt` (epoch, #2, TEMPORARY כפול).
- כל סנכרון ידני, fire-and-forget. כל אי-הסכמה = באג.

### NBug2 כדוגמת-מופת
`reconnect()` על WS חי: FE סגר socket, אבל `hasActiveWs` נשאר `true` (#2),
`activeFeWs` עדיין החזיק reference (#3), `status` נשאר `ready` (#1).
**3 מקורות, 3 דעות** → reaper לא ניקה → agent יתום קבוע.
ה-fix הנוכחי (closeAndWait) מתקן את ה-*race* בין המקורות — לא את הסיבה
ששלושה מקורות קיימים מלכתחילה.

---

## 2. המנגנון היחיד — `AgentLifecycle`

רשומה אחת עשירה per-agent, מקור-אמת יחיד, map אחד.

```ts
type ConnectionState = "attached" | "detached" | "orphaned"
//  attached  — יש feWs חי
//  detached  — היה feWs, נסגר (מועמד ל-reap אחרי timeout)
//  orphaned  — child חי, מעולם לא היה feWs (reap מהיר — זה באג ה-NBug2)

// ⚠️ מבנה פנימי של המנהל (backend) בלבד — אף צרכן לא רואה אותו.
// היוצא החוצה הוא AgentView (סעיף 2.x) — סריאליזבילי, בלי child/feWs/getStderr.
type AgentLifecycle = {
  // ── זהות (היה registry #1) ──────────────────────────
  id: string
  cliKind: CliKind
  cwd: string
  modelOverride: string | null
  createdAt: string          // ISO. אחד. לא כפול.

  // ── מצב לוגי (היה registry #1) ──────────────────────
  status: AgentStatus        // starting/ready/busy/crashed/closed
  acpSessionId?: string
  crashReason?: string

  // ── מצב פיזי (היה bridge #2 + orchestrator #4) ──────
  child: ChildProcessWithoutNullStreams
  bridgePort: number
  getStderr: () => string[]

  // ── מצב חיבור (היה bridge #2 + activeFeWs #3) ───────
  connection: ConnectionState
  feWs: WebSocket | null     // ה-socket עצמו — מקור-אמת יחיד
  lastConnectedAt: string | null
  lastDetachedAt: string | null
}
```

### עיקרון מנחה — הצרכנים לא מכירים את המבנה, רק נקודות-קצה

> `AgentLifecycle` (סעיף למעלה) הוא **המבנה הפנימי של המנגנון בלבד**. אף צרכן
> לא רואה אותו. `child`, `feWs`, `getStderr` — אלה פרטים פנימיים שלעולם לא
> דולפים החוצה. אם צרכן צריך לדעת "האם מחובר" הוא מקבל `boolean`, לא את ה-socket.

זו הטעות שגרמה ל-4-מקורות-האמת מלכתחילה: ws-agent החזיק את ה-socket *וגם*
bridge-manager החזיק flag עליו — כי לא היה חוזה צר שמסתיר את ה-socket. המנגנון
היחיד מתקן את זה **רק אם** הוא נשמר פנימי, מאחורי נקודות-קצה.

### שלוש שכבות-צרכן — וכל אחת רואה רק את הקצה שלה

| צרכן | מה הוא רואה | מה הוא **לא** רואה |
|------|------------|---------------------|
| **FE** | HTTP endpoints (`/api/agents` → `AgentPublic[]`) + WS (`/ws/agent/:id`) | child, feWs, port, המנהל עצמו |
| **ws-agent** | 2 פעולות: `attach(id, ws)→bool`, `detach(id)` + `getChild(id)` לצינור | connection-state, timestamps, registry |
| **http-agents / orchestrator** | פעולות CRUD + status transitions | feWs, ה-Map הפנימי |

### החוזה הפנימי — `AgentLifecycleManager` (backend בלבד)
מחליף את שלושת המנהלים: `AgentRegistry` + `bridge-manager` + `activeFeWs`-map.
כל מעבר-מצב עובר דרכו — **synchronous ו-atomic** (JS thread יחיד → אין race).
**אף שיטה לא מחזירה את `AgentLifecycle` המלא.** היא מחזירה view צר או primitive.

```ts
interface AgentLifecycleManager {
  // ── יצירה / מחיקה ──────────────────────────────────────
  spawn(input: CreateAgentInput): Promise<AgentView>   // ← view, לא Lifecycle
  kill(id: string): Promise<void>

  // ── מעברי-מצב מפורשים (מחליפים registry.update הגנרי) ──
  markReady(id: string, acpSessionId: string): void
  markBusy(id: string): void
  markCrashed(id: string, reason: string): void

  // ── חיבור — synchronous, SoT יחיד (מחליף markAttached/markDetached/activeFeWs) ──
  attach(id: string, ws: WebSocket): boolean   // false אם כבר attached (MED-8)
  detach(id: string): void

  // ── קריאה — מחזיר views/primitives בלבד, לא את המבנה ──
  view(id: string): AgentView | null           // סריאליזבילי, ללא child/feWs
  list(): ReadonlyArray<AgentView>
  getChild(id: string): ChildProcessWithoutNullStreams | null  // ws-agent בלבד, לצינור
  listIdle(timeoutMs: number, now: number): string[]

  onCrash(cb: (id: string, info: BridgeCrashInfo) => void): () => void
}

// AgentView — מה שיוצא מהמנהל החוצה. סריאליזבילי. ללא child/feWs/getStderr.
// = בדיוק AgentPublic + connection metadata. זה גם מה ש-toAgentPublic מחזיר.
type AgentView = {
  id: string; cliKind: CliKind; cwd: string; modelOverride: string | null
  createdAt: string; status: AgentStatus
  acpSessionId?: string; crashReason?: string
  connection: ConnectionState          // attached | detached | orphaned
  lastConnectedAt: string | null; lastDetachedAt: string | null
}
```

`getChild` הוא היוצא-דופן היחיד שמחזיר handle פנימי — ורק כי ws-agent חייב
את ה-stdin/stdout לצינור. גם הוא מחזיר `ChildProcess` ולא את ה-`AgentLifecycle`.

### מכונת-המצב של `connection`
```
spawn ─────────────► orphaned
                        │  attach()
                        ▼
                     attached ◄──────┐
                        │            │ attach()
                        │ detach()   │
                        ▼            │
                     detached ───────┘
                        │  timeout (listIdle)
                        ▼
                      kill()
```
- `attach` על `attached` קיים → מחזיר `false` (MED-8: טאב שני נדחה).
- `detach` תמיד → `detached` + `lastDetachedAt=now`.
- `listIdle`: `orphaned` → reap מהיר (grace×2); `detached` → reap אחרי timeout;
  `attached` → לעולם לא.

---

## 3. למה זה סוגר את NBug2 מהשורש

יש `connection` **אחד**. אם `attached` → `feWs !== null`. אם `detached`/`orphaned`
→ `feWs === null`. בלתי אפשרי להגיע ל"חשבנו שיש WS אבל אין" — כי אין שני שדות
לסנכרן. ה-closeAndWait של fix-nbug2 הופך ל**מיותר ברובו**: אין שני מקורות
שצריך לסגור בסדר הנכון; יש שדה אחד ש-`detach()` מאפס atomically.

---

## 4. ההשלכה — זה refactor ארכיטקטוני, לא slice קטן

נוגע ב-5 קבצים + port:
- `core/ports.ts` — `AgentRegistry` interface מוחלף ב-`AgentLifecycleManager`.
- `core/schemas/agent.ts` — `Agent`/`AgentPublic` מקבלים `connection`/`lastConnectedAt`/`lastDetachedAt`; `update` הגנרי נעלם.
- `backend/agents/registry.ts` — נמחק/מתמזג לתוך המנהל.
- `backend/acp/bridge-manager.ts` — child+stderr נבלעים למנהל; כל בלוק ה-TEMPORARY (slice 26) נמחק.
- `backend/app/agent-orchestrator.ts` — `bridgePorts`/`stderrGetters` נבלעים; `createAndSpawn`/`deleteAndKill` עוברים למנהל.
- `backend/delivery/ws-agent.ts` — `activeFeWs` נמחק; `attach`/`detach` מהמנהל.
- `backend/delivery/http-agents.ts` — `registry.*` → `manager.*`.

### סיכונים
- `AgentRegistry` הוא **port ב-core** — החלפת interface שלם משפיעה על כל ה-callers.
- `update` הגנרי (`Partial<Pick<...>>`) מוחלף בפעולות מפורשות — כל call-site משתנה.

### גבול core/backend — נגזר ישירות מעיקרון נקודות-הקצה
המבנה הפנימי (`AgentLifecycle` עם `child`/`feWs`/`getStderr`) **לעולם לא חוצה ל-core**.
חלוקה:
- **core** מגדיר רק את ה-**חוזה הסריאליזבילי**: `AgentView` (= `AgentPublic` + connection
  metadata), `ConnectionState`, וה-interface של המנהל **בלי** סוגי-IO (ה-IO types
  כמו `WebSocket`/`ChildProcess` נשארים backend). זה גם מה שמחזיר אותנו לכלל
  "no browser globals in core" — `feWs` הוא browser/ws global, ולכן הוא backend-only.
- **backend** מחזיק את המנהל המלא (המבנה העשיר + ה-Map).
- **התוצאה**: גם הגבול core/backend **וגם** עיקרון נקודות-הקצה נשמרים מאותה הסיבה —
  הצרכן רואה view סריאליזבילי, לא handle. הם לא שני כללים, הם אותו כלל.

---

## 5. דרכי-ביצוע אפשריות (טרם הוכרע)

### אופציה A — הכל במהלך אחד
מנגנון יחיד מלא, 5 קבצים + port. הכי נקי, הכי מסוכן. complexity ~8 → calev-heavy.

### אופציה B — לאחד רק את connected (מומלץ כשלב ראשון)
`registry` נשאר הבית הלוגי. מאחדים רק את 3 המקורות של `connected`
(`hasActiveWs`/`activeFeWs`/`status`) לשדה `connection` יחיד ב-`Agent`,
חשוף ב-`AgentPublic`. מוחקים את `Entry.createdAt` הכפול. `child`/`stderr`/`port`
**נשארים** ב-bridge-manager/orchestrator לעת-עתה.
- סוגר את שורש NBug2 (מקור-אמת אחד ל-connected).
- מסיר את ה-TEMPORARY של slice 26.
- לא נוגע ב-child/ports/stderr → סיכון נמוך בהרבה. complexity ~4-5.
- מאפשר את agents-list UI (חושף connection+createdAt).
- משאיר את איחוד child/ports/stderr ל-slice עתידי אם בכלל יידרש.

### אופציה C — תכנון מלא ואז החלטה (← הנבחרת כרגע)
המסמך הזה. אחרי שהמשתמשת קוראת — מכריעים A מול B.

---

## 6. סדר מוצע (אם B)

```
1. fix-nbug2 (ב-queue)              ← עוצר דליפה נוכחית
2. future-A-0: connection single-SoT ← B מהמסמך הזה. foundation.
3. future-A-1: agents-list UI        ← פיצ'ר ראשון, צורך AgentPublic מורחב
4. future-A-2: background keepAlive   ← דחוי, הכי מורכב, רק כשאין דליפות
```

הערה: אם בוחרים B, ה-closeAndWait של fix-nbug2 עדיין שווה למזג קודם
(הוא עוצר את הדליפה *היום*); future-A-0 אחר-כך הופך אותו למיותר וניתן
להסיר אותו אז בניקוי.

---

## 7. שאלות פתוחות להכרעה

1. **A מול B** — refactor מלא עכשיו, או רק איחוד connected קודם?
2. **גשר ws-agent→מנהל** (רלוונטי לשתי האופציות): `attach`/`detach` הם
   synchronous; אם המנהל ב-backend מחזיק את ה-state ישירות, אין בעיית async
   (בניגוד ל-`registry.update` שהוא Promise). זו נקודת-זכות לאיחוד.
3. **persistence**: היום הכל in-memory (D8). המנגנון היחיד מקל על persist עתידי
   (schema אחד) — אבל לא חובה עכשיו.
4. **keepAlive**: לא נכלל ב-A או B. נוסף רק ב-future-A-2 כשדה ב-`connection`
   (detached+keepAlive = "המשך לרוץ בלי טאב").
