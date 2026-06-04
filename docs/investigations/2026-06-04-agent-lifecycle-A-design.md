# Agent Lifecycle — אופציה A, עיצוב המבנה האידאלי

תאריך: 2026-06-04
מחבר: מרדכי (planner)
סטטוס: **מסמך-עיצוב תאורטי. לא brief, לא תלוי-מציאות.**
מתאר את ה**יעד** — המבנה הנכון של ניהול מחזור-חיים של agents,
ללא line numbers, base, או commits. כשנוכל (אחרי fix-nbug2 merge),
נתאים אותו למציאות → brief מבצע.

קשור: `2026-06-04-agent-lifecycle-single-mechanism.md` (ניתוח הבלגן + A מול B).
מסמך זה מפרט את **A במלואה**.

---

## 0. עיקרון-העל

> **הצרכנים לא מכירים את המבנה. הם מכירים רק נקודות-קצה.**

כל מה שלמטה נגזר מזה. אם צרכן צריך לדעת "האם מחובר" — הוא מקבל `boolean`,
לא את ה-socket. אם הוא צריך רשימת agents — הוא מקבל `AgentView[]` סריאליזבילי,
לא את ה-Map הפנימי. ה-handles (`child`, `feWs`) חיים במקום אחד, פנימי, ולעולם
לא דולפים.

הבלגן הנוכחי (4 מקורות-אמת) נולד מהפרת העיקרון הזה: ws-agent החזיק את ה-socket,
bridge-manager החזיק flag עליו, registry החזיק status — כי לא היה חוזה צר
שמסתיר את ה-socket מאחורי פעולות.

---

## 1. השכבות

```
┌─────────────────────────────────────────────────────────┐
│ FE (browser)                                            │
│   רואה: HTTP /api/agents (AgentView[]) · WS /ws/agent/:id │
└────────────────────────┬────────────────────────────────┘
                         │  HTTP + WS בלבד
┌────────────────────────▼────────────────────────────────┐
│ delivery (backend)                                       │
│   http-agents.ts  — CRUD endpoints                       │
│   ws-agent.ts     — צינור feWs↔child                     │
│   רואה: AgentLifecycleManager (חוזה הפעולות)             │
└────────────────────────┬────────────────────────────────┘
                         │  פעולות בלבד (attach/detach/spawn/...)
┌────────────────────────▼────────────────────────────────┐
│ AgentLifecycleManager (backend, פנימי)                   │
│   מחזיק: Map<id, AgentLifecycle>                         │
│   המבנה העשיר (child/feWs/stderr) חי כאן ורק כאן         │
└──────────────────────────────────────────────────────────┘

core (pure):
   מגדיר רק את החוזים הסריאליזביליים:
   AgentView · ConnectionState · AgentStatus · CreateAgentInput
   (אין child/feWs/WebSocket/ChildProcess — אלה backend types)
```

---

## 2. החוזים ב-core (מה שחוצה את הגבול)

```ts
// ── מצב חיבור ──────────────────────────────────────────
type ConnectionState = "attached" | "detached" | "orphaned"
//  attached  — יש feWs חי
//  detached  — היה feWs, נסגר (מועמד ל-reap אחרי timeout)
//  orphaned  — child חי, מעולם לא היה feWs (reap מהיר)

// ── סטטוס לוגי (קיים) ──────────────────────────────────
type AgentStatus = "starting" | "ready" | "busy" | "crashed" | "closed"

// ── AgentView — היחיד שיוצא מהמנהל החוצה ───────────────
// סריאליזבילי מלא. ללא child/feWs/getStderr/port.
// = הבסיס שגם ה-FE מקבל מ-GET /api/agents.
type AgentView = {
  id: string
  cliKind: CliKind
  cwd: string
  modelOverride: string | null
  createdAt: string                 // ISO — אחד, מקור-אמת יחיד
  status: AgentStatus
  acpSessionId?: string
  crashReason?: string
  // ── connection metadata (חדש — היה מפוזר על 3 מקורות) ──
  connection: ConnectionState
  lastConnectedAt: string | null
  lastDetachedAt: string | null
}
```

הערה: `bridgePort` **לא** ב-`AgentView`. הוא פרט-ניתוב פנימי של ה-backend
(in-process כיום: port=0). אם FE אי-פעם יצטרך אותו — מוסיפים אז, מודעים.

---

## 3. החוזה הפנימי — `AgentLifecycleManager`

backend בלבד. מחליף את שלושת המנהלים (registry + bridge-manager + activeFeWs-map).
כל מעבר-מצב **synchronous ו-atomic** (JS thread יחיד → אין race).
**אף שיטה לא מחזירה `AgentLifecycle`** — רק `AgentView` / primitive / handle ממוקד.

```ts
interface AgentLifecycleManager {
  // ── יצירה / מחיקה ───────────────────────────────────
  spawn(input: CreateAgentInput): Promise<AgentView>
  kill(id: string): Promise<void>

  // ── מעברי-מצב לוגיים (מחליפים registry.update הגנרי) ──
  markReady(id: string, acpSessionId: string): AgentView
  markBusy(id: string): void
  markIdle(id: string): void            // busy → ready
  markCrashed(id: string, reason: string): void

  // ── חיבור — SoT יחיד (מחליף markAttached/markDetached/activeFeWs) ──
  attach(id: string, ws: WebSocket): boolean   // false אם כבר attached (MED-8)
  detach(id: string): void

  // ── קריאה — views/primitives/handle ממוקד בלבד ──────
  view(id: string): AgentView | null
  list(): ReadonlyArray<AgentView>
  getChild(id: string): ChildProcessWithoutNullStreams | null  // ws-agent בלבד, לצינור
  listIdle(timeoutMs: number, now: number): string[]

  // ── crash propagation ───────────────────────────────
  onCrash(cb: (id: string, info: BridgeCrashInfo) => void): () => void
}
```

### המבנה הפנימי (לא חוצה החוצה לעולם)

```ts
// backend בלבד. הצרכנים לא רואים את זה.
type AgentLifecycle = {
  // זהות + לוגי (= כל שדות AgentView)
  view: AgentViewMutable          // ← המקור שממנו נגזר ה-view היוצא
  // handles פנימיים — לעולם לא בסריאליזציה
  child: ChildProcessWithoutNullStreams
  feWs: WebSocket | null          // SoT יחיד למצב-חיבור
  getStderr: () => string[]
  bridgePort: number
}
```

`view()` מחזיר עותק/snapshot של `view` בלבד — לא את האובייקט עם ה-handles.

---

## 4. מכונות-המצב

### status (לוגי — קיים, נשמר)
```
starting → ready → busy → ready → ...
   │         │       │
   └─────────┴───────┴──→ crashed   (bridge מת)
             └───────────→ closed    (kill ע"י משתמש)
```

### connection (חדש — מאחד 3 מקורות)
```
spawn ──────────► orphaned
                    │ attach()
                    ▼
                 attached ◄────┐
                    │          │ attach() (אותו id, reconnect)
                    │ detach() │
                    ▼          │
                 detached ─────┘
                    │ listIdle timeout
                    ▼
                  kill()
```
- `attach` על `attached` → `false` (MED-8: טאב שני נדחה, אין דריסה).
- `detach` תמיד → `detached` + `lastDetachedAt=now`, `feWs=null`.
- `listIdle`: `orphaned`→grace×2 · `detached`→timeout · `attached`→לעולם לא.

---

## 5. מיפוי החלפה — מי מחליף את מי

| ישן (4 מקורות) | חדש (מנגנון יחיד) |
|----------------|---------------------|
| `registry.create` | `manager.spawn` |
| `registry.update({status})` | `markReady`/`markBusy`/`markIdle`/`markCrashed` |
| `registry.get`/`list` | `manager.view`/`list` (מחזיר AgentView) |
| `registry.delete` + `bridge.kill` | `manager.kill` |
| `bridge.spawn` + `bridgePorts.set` | נבלע ל-`spawn` |
| `bridge.getChild` | `manager.getChild` |
| `bridge.markAttached` + `activeFeWs.set` | `manager.attach` |
| `bridge.markDetached` + `activeFeWs.delete` | `manager.detach` |
| `bridge.hasActiveWs` | `view.connection === "attached"` |
| `bridge.lastDetachedAt`/`createdAt`(epoch) | `view.lastDetachedAt`/`createdAt`(ISO) |
| `bridge.listIdle` | `manager.listIdle` (זהה, מקור נתונים אחד) |
| `orchestrator.onCrash` | `manager.onCrash` |
| `stderrGetters` map | שדה `getStderr` ב-AgentLifecycle |
| `bridgePorts` map | שדה `bridgePort` ב-AgentLifecycle |

**נמחק כליל**: `Entry.createdAt` הכפול, `hasActiveWs` flag, `activeFeWs` map,
`stderrGetters` map, `bridgePorts` map, כל בלוק TEMPORARY (slice 26),
`closeAndWait` (fix-nbug2 — הופך מיותר כי אין שני מקורות לסגור בסדר).

---

## 6. למה A סוגר את NBug2 מהשורש

יש `feWs` **אחד**, ו-`connection` נגזר ממנו ישירות. `attach`/`detach` הם
synchronous → המעבר atomic. בלתי-אפשרי שצרכן אחד יחשוב "מחובר" ואחר "מנותק",
כי יש מקור אחד ופעולה אחת. ה-race שב-fix-nbug2 (FE סוגר WS לפני ש-BE עדכן)
נעלם — `detach()` מאפס את `feWs` ואת `connection` בו-זמנית, ואין flag נפרד
שעלול להישאר תקוע.

---

## 7. גבולות שמירה (invariants לאימות)

1. אף שיטה ציבורית של המנהל לא מחזירה אובייקט שמכיל `child`/`feWs`/`getStderr`.
2. `core/` לא מייבא `WebSocket`/`ChildProcess` (נשאר pure, no IO types).
3. `connection==="attached"` ⟺ `feWs!==null`. תמיד. (invariant מרכזי)
4. שני agents שונים לעולם לא חולקים `feWs`.
5. `attach` כשכבר attached מחזיר `false` ולא נוגע ב-state (MED-8).

---

## 8. פירוק עתידי ל-commits (כשנכתוב brief תלוי-מציאות)

הצעה (לא מחייב — ייקבע מול הקוד בפועל):
1. **core contracts** — `ConnectionState`, `AgentView`, הרחבת schema. אין IO. TDD.
2. **manager skeleton** — `AgentLifecycleManager` עם המבנה הפנימי + מעברי-מצב,
   tests ברמת unit (spawn/attach/detach/kill, invariant #3).
3. **delivery migration** — http-agents + ws-agent עוברים למנהל. מוחקים activeFeWs.
4. **cleanup** — מחיקת registry/bridge-manager הישנים, TEMPORARY, closeAndWait.
5. **FE** — צריכת `connection` מ-AgentView (אם agents-list UI באותו slice, או נפרד).

complexity כולל: ~8 → calev-heavy. שקול לפצל 1-2 (foundation) מ-3-4 (migration)
לשני slices אם הסיכון גבוה מדי במהלך אחד.

---

## 9. מה שמסמך זה **לא** כולל (מכוון)

- **line numbers / base / commits** — תלוי-מציאות, ייקבע כשנכתוב brief אחרי fix-nbug2 merge.
- **keepAlive / background-agent** — שלב מאוחר יותר (future-A-2). יתווסף כשדה
  ב-connection (`detached + keepAlive` = "המשך לרוץ בלי טאב"). דחוי עד שאין דליפות.
- **persistence** — היום in-memory (D8). המנגנון היחיד מקל על persist עתידי
  (schema אחד) אבל לא נדרש כאן.
- **agents-list UI** — צרכן של `AgentView`. slice נפרד (future-A-1).
