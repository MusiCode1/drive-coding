# Slice 26 — Temporary Bridge Idle-Reaper (BE) — ‏תוכנית

> **‏תאריך**: 2026-06-01
> **‏סטטוס**: ‏מאושר (‏אביגיל: READY, 2026-06-01)
> **Complexity**: 4/10 (verifier: light + phase על Commit 2)
> **‏תלויות (`depends_on`)**: []
> **‏Base**: dev
> **‏Dev tip**: `62b41a0dcdb039bcdd09dba99f97238496f2924b`
>
> ⚠️ **‏סלייס זמני** — ‏זו רשת-ביטחון לתפיסת bridges ‏שדלפו ‏ב-reload ‏סתמי / ‏טאב שנסגר (‏המקרים ש-slice 25 ‏לא מכסה). **‏יש למחוק אותו** ‏כשייכנס מנגנון ניהול agents-ברקע מסודר (‏"future A"). ‏ראה §7 ‏לתנאי-המחיקה המדויק.

---

## §0 — Pre-flight

> ‏אם אתה executor חדש: ‏קרא את [`EXECUTOR_DISPATCH.md`](./EXECUTOR_DISPATCH.md) ‏לפני כל דבר אחר.

### ‏תלויות (חובה)

‏slice זה **‏מבוסס על dev בלבד**. ‏כל הסמלים שצוינו להלן קיימים ב-dev tip `62b41a0`:

- `packages/backend/src/acp/bridge-manager.ts` — `createBridgeManager()` ‏מחזיר `BridgeManager` ‏עם `spawn`, `get`, `getChild`, `list`, `kill`, `onCrash`, `spawnWithStderr`. ‏ה-store ‏הפנימי הוא `Map<string, Entry>` ‏עם `{ handle, child, stderrLines }`.
- `packages/backend/src/delivery/ws-agent.ts` — `createAgentWsHandler({ orchestrator, bridgeManager })`. ‏מחזיק `activeFeWs: Map<string, WebSocket>`. ‏מסמן חיבור ב-`activeFeWs.set(agentId, feWs)` (‏שורה ~77) ‏וניתוק ב-`activeFeWs.delete(agentId)` (‏שורה ~123, ‏בתוך `feWs.on("close")`).
- `packages/backend/src/app/agent-orchestrator.ts` — `deleteAndKill(id)` ‏(שורה ~199) ‏עושה: `registry.update(closed)` + `bridgeManager.kill(id)` + `registry.delete(id)`. ‏**‏זהו נתיב הניקוי המאוחד** ‏שה-reaper ‏ישתמש בו.
- `packages/backend/src/server.ts` — ‏ה-boot. ‏יוצר `bridgeManager`, `orchestrator`, `onAgentConnect`. ‏מאזין `httpServer` ‏על port. ‏כאן יירשם ה-interval ‏של ה-reaper.
- `packages/backend/src/agents/registry.ts` — in-memory; `list()`, `delete()`.

`depends_on: []`.

> **‏יחס ל-slice 25**: ‏25 (FE cleanup) ‏ו-26 (BE reaper) ‏עצמאיים ‏ומשלימים. ‏25 ‏תופס disconnect מפורש + error; 26 ‏תופס reload-סתמי / ‏טאב-שנסגר. ‏אפשר למזג בכל סדר. ‏אין חפיפת קבצים (25=FE, 26=BE). ‏שניהם base=dev.

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-26-bridge-idle-reaper -b slice-26-bridge-idle-reaper dev
cd .worktrees/slice-26-bridge-idle-reaper
pnpm install
pnpm hooks:install
```

### ‏איך להריץ

| ‏מה | ‏פקודה |
|---|---|
| ‏BE | `cd packages/backend && LOG_LEVEL=debug LOG_NS='*' PORT=4001 onecli run --agent voice-acp -- bun --watch src/server.ts` |
| ‏FE | `BE_PORT=4001 pnpm --filter @drive-coding/frontend-v2 dev` |
| ‏BE tests | `pnpm --filter @drive-coding/backend test` |
| ‏כללי | `pnpm typecheck && pnpm lint:i18n` |

‏אם port 4001 ‏תפוס — ‏עבור ל-4002+. **‏אל תהרוג** ‏שירותים קיימים.

> ‏**‏טיפ לבדיקה מהירה**: ‏הגדר `BRIDGE_IDLE_TIMEOUT_MS=10000` ‏(10 ‏שניות) ‏בזמן הבדיקה הידנית ‏כדי לא לחכות 5 ‏דקות. ‏ברירת המחדל ל-prod ‏היא 300000.

### Browser

‏Chrome ‏רגיל. ‏אין מיקרופון — ‏אין צורך ב-HTTPS/tunnel.

### ‏כלי האימות המרכזי

```bash
# ‏רשימת הסוכנים החיים ב-BE
curl -s http://127.0.0.1:4001/api/agents
# ‏ספירת תהליכי opencode שה-BE יילד
pgrep -af 'opencode' | grep -v -- '--watch' | wc -l
```

### OneCLI

```bash
onecli run --agent voice-acp -- bun --watch src/server.ts
```

### Reading list

**must-read**:

1. `packages/backend/src/acp/bridge-manager.ts` — ‏ה-store + lifecycle ‏שמתרחב במעקב זמנים.
2. `packages/backend/src/delivery/ws-agent.ts` — ‏שורות 77 + 123 (`activeFeWs.set`/`delete`) — ‏נקודות ה-hook ‏ל-attach/detach.
3. `packages/backend/src/app/agent-orchestrator.ts` — `deleteAndKill` (‏נתיב הניקוי שה-reaper ‏קורא לו).
4. `packages/backend/src/server.ts` — ‏איפה לרשום את ה-interval.

**reference**:

- `docs/conventions/parallel-safe-code.md` §1 — ‏עריכה אדיטיבית.

---

## §1 — ‏מטרה

‏slice 25 ‏עוצר דליפת bridges ‏ב-disconnect מפורש ‏ובשגיאות חיבור — ‏אבל לא ב-**‏reload סתמי** ‏(המשתמש סוגר טאב / ‏מרענן בלי ללחוץ disconnect): ‏שם ה-FE ‏פשוט מת, ‏`#cleanup` ‏לא רץ, ‏והתהליך נשאר חי לנצח. ‏slice זה מוסיף **‏רשת-ביטחון זמנית בצד שרת**: ‏reaper תקופתי שהורג bridges ‏שאין להם WS ‏מחובר במשך זמן מוגדר (‏ברירת מחדל 5 ‏דקות). ‏המדד הוא **‏"זמן מאז ניתוק ה-WS ‏האחרון"** — ‏לא "‏מאז יצירה" ‏ולא "‏מאז פעילות" — ‏כך ש-bridge ‏עם WS ‏מחובר (‏בשימוש פעיל) ‏**‏לעולם לא נהרג**, ‏גם אם רץ שעה. ‏אחרי שני הסלייסים יחד: ‏אפס דליפה.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ‏מעקב `lastDetachedAt` / `hasActiveWs` ‏פר-bridge | ✅ | ‏הסלייס הזה |
| ‏`markAttached(id)` / `markDetached(id)` ‏ב-bridge-manager | ✅ | ‏הסלייס הזה |
| ‏`ws-agent` ‏קורא ל-`markAttached`/`markDetached` | ✅ | ‏הסלייס הזה |
| ‏interval reaper ב-`server.ts` ‏שקורא `deleteAndKill` | ✅ | ‏הסלייס הזה |
| ‏grace period ‏לסוכן שמעולם לא נפתח לו WS | ✅ | ‏הסלייס הזה |
| ‏ENV ‏`BRIDGE_IDLE_TIMEOUT_MS` ‏(ברירת מחדל 300000) | ✅ | ‏הסלייס הזה |
| ‏הריגה לפי "‏מאז יצירה" ‏או "‏מאז פעילות אחרונה" | ❌ | ‏**‏אסור** — ‏יהרוג סוכנים פעילים. ‏רק "מאז ניתוק WS" |
| ‏reconnect אמיתי / ‏חיווט `existingSessionId` | ❌ | ‏future A |
| ‏ממשק ניהול agents-ברקע | ❌ | ‏future A |
| ‏persistence ‏של bridges ‏בין restarts | ❌ | ‏לא — in-memory נשאר |

> **‏זמניות**: ‏כל הקוד שמתווסף בסלייס זה מסומן `// TEMPORARY (slice 26)` ‏וכולל הפניה למחיקה ‏ב-future A. ‏ראה §7.

---

## §3 — Architecture diagram

```text
‏─── ‏מעקב זמנים (‏ב-bridge-manager) ───
bridge-manager store Entry:
  { handle, child, stderrLines,
    hasActiveWs: boolean,        ← ‏חדש (TEMPORARY)
    lastDetachedAt: number|null, ← ‏חדש (TEMPORARY) — ‏epoch ms; null = ‏מעולם לא נותק
    createdAt: number }          ← ‏חדש (TEMPORARY) — ‏epoch ms

bridge-manager ‏API ‏חדש (TEMPORARY):
  markAttached(id)   → entry.hasActiveWs = true
  markDetached(id)   → entry.hasActiveWs = false; entry.lastDetachedAt = Date.now()
  listIdle(timeoutMs, now) → string[]  ← ‏מחזיר agentIds ‏שראויים להריגה

‏─── ‏ws-agent קורא ל-hooks ───
ws-agent onConnect:
  activeFeWs.set(...)         (‏קיים)
  bridgeManager.markAttached(agentId)   ← ‏חדש
feWs.on("close"):
  activeFeWs.delete(...)      (‏קיים)
  bridgeManager.markDetached(agentId)   ← ‏חדש

‏─── ‏ה-reaper (‏ב-server.ts) ───
setInterval(REAP_INTERVAL):
  for id of bridgeManager.listIdle(BRIDGE_IDLE_TIMEOUT_MS, Date.now()):
    await orchestrator.deleteAndKill(id)   ← ‏נתיב ניקוי מאוחד (kill + registry.delete)
    log.info({ id }, "reaped idle bridge")
```

### ‏לוגיקת `listIdle` — ‏הלב

```text
‏bridge ‏ראוי להריגה אם:
  (א) hasActiveWs === false   ‏(אין WS ‏מחובר כרגע)
  ‏וגם אחד מ:
  (ב1) lastDetachedAt !== null  AND  (now - lastDetachedAt) >= timeoutMs
       ← ‏היה מחובר, ‏התנתק, ‏ועבר החלון
  (ב2) lastDetachedAt === null  AND  (now - createdAt) >= timeoutMs * 2
       ← grace period: ‏מעולם לא נפתח לו WS (race ‏אפשרי בין createAgent ל-WS open).
         ‏נותנים פי-2 ‏מהחלון לפני הריגה, ‏כדי לא להרוג סוכן בן-שנייה שעומד להתחבר.
```

> **‏כלל הזהב**: ‏אם `hasActiveWs === true` → ‏**‏לעולם לא ברשימה**. ‏זה מה שמבטיח שסוכן בשימוש פעיל (‏גם משימה ארוכה) ‏לא נהרג.

### ‏כלל ארכיטקטורה מחייב

- ‏ה-reaper ‏קורא **‏רק** ‏ל-`orchestrator.deleteAndKill` — ‏לא ל-`bridgeManager.kill` ‏ישירות. ‏כך ה-registry ‏מתנקה גם (‏אחרת `/api/agents` ‏יציג סוכן מת).
- ‏כל השדות/מתודות החדשים מסומנים `// TEMPORARY (slice 26)`.
- ‏לא משנים את ההתנהגות הקיימת של `ws-agent.ts:126` (child שורד WS close) — ‏ה-reaper ‏הוא שכבה נוספת מעל, ‏לא במקום.

---

## §4 — Commits ‏בסדר

### Commit 1 — bridge-manager: ‏מעקב זמנים + `listIdle` (approach: TDD)

**‏מטרה**: ‏הוסף מעקב `hasActiveWs`/`lastDetachedAt`/`createdAt` ‏ו-API ‏`markAttached`/`markDetached`/`listIdle`. ‏זו לוגיקה טהורה (‏אין I/O) → ‏TDD ‏מתאים.

**‏קבצים חדשים**:

| ‏קובץ | ‏תפקיד |
|---|---|
| `packages/backend/src/acp/bridge-manager.idle.test.ts` | ‏טסטים ל-listIdle ‏(injected `now`) |

**‏קבצים משתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
| `packages/backend/src/acp/bridge-manager.ts` | ‏הרחבת `Entry` + 3 ‏מתודות חדשות |

**API skeleton** — ‏הרחבת הטיפוס המוחזר מ-`createBridgeManager`:

```ts
// ‏הרחבת Entry הפנימי (TEMPORARY slice 26):
type Entry = {
  handle: BridgeHandle
  child: ChildProcessWithoutNullStreams
  stderrLines: string[]
  // ─── TEMPORARY (slice 26) — idle-reaper tracking ───
  hasActiveWs: boolean
  lastDetachedAt: number | null
  createdAt: number
}

// ‏אתחול ב-spawnInternal, ‏ב-store.set (‏שורה ~128):
//   hasActiveWs: false, lastDetachedAt: null, createdAt: Date.now()

// ‏הרחבת ה-return type של createBridgeManager:
export function createBridgeManager(): BridgeManager & {
  spawnWithStderr(...): ...   // ‏קיים
  getChild(...): ...          // ‏קיים
  // ─── TEMPORARY (slice 26) ───
  markAttached(bridgeId: string): void
  markDetached(bridgeId: string): void
  listIdle(timeoutMs: number, now: number): string[]
}
```

**Implementation**:

```ts
// ─── TEMPORARY (slice 26): idle-reaper support ───
// Remove together with this whole block when background-agent management
// (future "slice A") lands. See docs/plans/slice-26-bridge-idle-reaper.md §7.
markAttached(bridgeId) {
  const e = store.get(bridgeId)
  if (e) e.hasActiveWs = true
},
markDetached(bridgeId) {
  const e = store.get(bridgeId)
  if (e) {
    e.hasActiveWs = false
    e.lastDetachedAt = Date.now()
  }
},
listIdle(timeoutMs, now) {
  const out: string[] = []
  for (const [id, e] of store) {
    if (e.hasActiveWs) continue                    // ‏בשימוש — ‏לעולם לא
    if (e.lastDetachedAt !== null) {
      if (now - e.lastDetachedAt >= timeoutMs) out.push(id)
    } else {
      // ‏מעולם לא נפתח WS — grace period פי-2
      if (now - e.createdAt >= timeoutMs * 2) out.push(id)
    }
  }
  return out
},
```

> ⚠️ ‏`store` ‏הוא `Map` ‏שכבר קיים ב-closure של `createBridgeManager`. ‏המתודות החדשות ‏נכנסות ל-object שמוחזר ב-`return { ... }` (‏שורות ~133–173). **‏הוסף אותן בתוך ה-return הקיים** — ‏אל תיצור return חדש.

**Tests** (`bridge-manager.idle.test.ts`):

‏בנה bridge-manager אמיתי, ‏אבל אל תפעיל תהליכים אמיתיים — ‏אם spawn אמיתי בעייתי בטסט, ‏בדוק את `listIdle` ‏ע"י הזרקת entries דרך spawn של בינארי לא-מזיק (`sleep`/`cat`) ‏או דרך mock. ‏העדפה: ‏אם אפשר לבדוק את `listIdle` ‏בבידוד ע"י factory שמקבל store מוזרק — ‏עשה זאת. ‏אם לא, ‏spawn `cat` (‏קורא stdin, ‏לא יוצא) ‏ובדוק:

| # | ‏תרחיש | ‏צפוי |
|---|---|---|
| 1 | ‏bridge עם `hasActiveWs=true` | `listIdle` ‏לא מחזיר אותו (‏גם אחרי timeout) |
| 2 | ‏detached, `now - lastDetachedAt < timeout` | ‏לא ברשימה |
| 3 | ‏detached, `now - lastDetachedAt >= timeout` | ‏ברשימה |
| 4 | ‏מעולם לא attached, `now - createdAt < timeout*2` | ‏לא ברשימה (grace) |
| 5 | ‏מעולם לא attached, `now - createdAt >= timeout*2` | ‏ברשימה |
| 6 | `markAttached` ‏אחרי detach | ‏יוצא מהרשימה (‏reconnect מאפס) |

> ‏השתמש ב-`now` ‏מוזרק (‏פרמטר), ‏לא ב-`Date.now()` ‏אמיתי בטסט — ‏דטרמיניסטי.
> ‏נקה תהליכי `cat` ‏ב-`afterEach` (`kill`) ‏אם השתמשת בהם.

**Verification**:

```bash
pnpm --filter @drive-coding/backend test
pnpm typecheck
```

---

### Commit 2 — ws-agent hooks + reaper ב-server.ts (approach: integration)

> **‏Phase verifier ‏אחרי commit זה** — ‏זו נקודת ה-wiring ‏החיה; ‏calev mode: phase ‏יוודא שהדליפה באמת נתפסת ושסוכן פעיל לא נהרג.

**‏מטרה**: ‏חבר את ה-hooks ‏ל-`ws-agent`, ‏והפעל את ה-interval ‏ב-`server.ts`.

**‏קבצים משתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
| `packages/backend/src/delivery/ws-agent.ts` | ‏2 ‏קריאות: `markAttached` ‏ב-connect, `markDetached` ‏ב-close |
| `packages/backend/src/server.ts` | ‏interval reaper (`reaper.unref()` ‏בלבד — ‏**‏אין** ‏shutdown handler ‏ב-server.ts ‏היום; ‏אל תוסיף `clearInterval`/SIGTERM, `unref()` ‏מספיק) |

**ws-agent.ts** — ‏הרחבת ה-deps type + ‏2 ‏קריאות:

```ts
// ‏הרחבת ה-deps של createAgentWsHandler (‏בנוסף ל-bridgeManager הקיים):
export function createAgentWsHandler(deps: {
  orchestrator: AgentOrchestrator
  bridgeManager: {
    getChild(bridgeId: string): ChildProcessWithoutNullStreams | null
    // ─── TEMPORARY (slice 26) ───
    markAttached(bridgeId: string): void
    markDetached(bridgeId: string): void
  }
}): ...
```

‏קריאה 1 — ‏אחרי `activeFeWs.set(agentId, feWs)` (‏שורה ~77):

```ts
activeFeWs.set(agentId, feWs)
deps.bridgeManager.markAttached(agentId)   // ← TEMPORARY (slice 26)
```

‏קריאה 2 — ‏בתוך `feWs.on("close")`, ‏אחרי `activeFeWs.delete(agentId)` (‏שורה ~123):

```ts
activeFeWs.delete(agentId)
deps.bridgeManager.markDetached(agentId)   // ← TEMPORARY (slice 26)
rl.close()
// ... ‏שאר הקוד הקיים
```

> ⚠️ ‏ה-`bridgeManager` ‏שמוזרק ל-`createAgentWsHandler` ‏ב-`server.ts:96` ‏הוא אותו object ‏מ-`createBridgeManager()` ‏— ‏שכבר כולל את `markAttached`/`markDetached` ‏מ-Commit 1. ‏אין צורך ב-wiring נוסף, ‏רק להרחיב את ה-type.

**server.ts** — ‏הוסף אחרי `log.info({ port }, "listening")` (‏שורה ~136):

```ts
// ─── TEMPORARY (slice 26): idle-bridge reaper ───
// Safety net for bridges leaked by a plain reload / closed tab (cases that
// slice 25's FE cleanup does NOT cover). DELETE THIS BLOCK when background-agent
// management (future "slice A") lands. See docs/plans/slice-26-bridge-idle-reaper.md §7.
const BRIDGE_IDLE_TIMEOUT_MS = Number(process.env.BRIDGE_IDLE_TIMEOUT_MS ?? 300_000)
const REAP_INTERVAL_MS = Math.min(BRIDGE_IDLE_TIMEOUT_MS, 60_000)
const reaperLog = createLogger("backend.reaper")
const reaper = setInterval(() => {
  const now = Date.now()
  const idle = bridgeManager.listIdle(BRIDGE_IDLE_TIMEOUT_MS, now)
  for (const id of idle) {
    reaperLog.info({ agentId: id }, "reaping idle bridge")
    orchestrator.deleteAndKill(id).catch((e) =>
      reaperLog.warn({ err: e, agentId: id }, "reap failed"),
    )
  }
}, REAP_INTERVAL_MS)
reaper.unref() // ‏אל תחזיק את ה-event loop חי בגלל ה-reaper
```

> ‏`REAP_INTERVAL_MS` = `min(timeout, 60s)` — ‏סורק לפחות פעם בדקה, ‏אבל לא לעתים תכופות מהחלון. ‏עם `BRIDGE_IDLE_TIMEOUT_MS=10000` ‏בבדיקה → ‏סורק כל 10ש.
> ‏`reaper.unref()` — ‏ה-interval לא ימנע יציאה נקייה של התהליך.

**Verification**:

```bash
pnpm --filter @drive-coding/backend test
pnpm typecheck
pnpm lint:i18n
```

‏Manual (‏הליבה — ‏שני התרחישים ההפוכים):

```bash
# ‏הרץ עם timeout קצר
BRIDGE_IDLE_TIMEOUT_MS=10000 LOG_NS='*' PORT=4001 onecli run --agent voice-acp -- bun --watch src/server.ts
```

1. **‏דליפה נתפסת**: ‏התחבר ל-opencode → ‏צ'אט → ‏ודא agent ב-`/api/agents`. ‏עכשיו **‏סגור את הטאב** ‏(לא disconnect — ‏פשוט סגור) → ‏המתן ~15ש → `curl /api/agents` → ‏הסוכן נעלם + ‏log "reaping idle bridge".
2. **‏סוכן פעיל לא נהרג**: ‏התחבר → ‏צ'אט → ‏**‏השאר את הטאב פתוח** → ‏המתן 30ש (‏פי-3 ‏מה-timeout) → ‏ודא שהסוכן **‏עדיין** ‏ב-`/api/agents` (WS ‏מחובר → `hasActiveWs=true` → ‏לא נאסף).
3. **‏reconnect מאפס**: ‏התחבר → ‏סגור טאב → ‏המתן 5ש (‏מתחת ל-timeout) → ‏פתח מחדש (‏reload, ‏ייווצר agent חדש) — ‏ודא שהישן נאסף אחרי 10ש ‏אבל החדש חי.
4. **‏grace period**: ‏(קשה לבדוק ידנית — ‏מכוסה בטסט #4/#5). ‏לא חוסם ידנית.

---

### Commit 3 — Docs + ‏סטטוס (approach: manual)

**‏קבצים**:

| ‏קובץ | ‏שינוי |
|---|---|
| `docs/walkthrough.md` | ‏רשומת ביצוע (‏שיטת `update-walkthrough`) — ‏ציין שזה **‏זמני** |
| `docs/plans/slice-26-bridge-idle-reaper.md` | ‏עדכון סטטוס + ‏סטיות |
| `packages/frontend/docs/slices.md` | ‏רישום slice 26 ‏אם חסר — ‏עם תג "‏זמני / ‏למחיקה ב-future A" |

```bash
pnpm --filter @drive-coding/backend test
pnpm typecheck
pnpm lint:i18n
pnpm --filter @drive-coding/backend build  # ‏אם קיים build ל-BE; ‏אחרת דלג
```

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|---|---|
| 1 | ‏BE tests ‏ירוקים (‏כולל 6 ‏טסטי listIdle) | `pnpm --filter @drive-coding/backend test` |
| 2 | ‏Typecheck ‏ירוק | `pnpm typecheck` |
| 3 | ‏אין עברית קשיחה | `pnpm lint:i18n` |
| 4 | ‏דליפה נתפסת: ‏סגירת טאב → ‏הסוכן נאסף | ‏manual #1 — ‏נעלם מ-`/api/agents` + log |
| 5 | ‏סוכן פעיל (WS ‏מחובר) **‏לא** ‏נהרג | ‏manual #2 — ‏עדיין ב-`/api/agents` ‏אחרי פי-3 timeout |
| 6 | ‏reconnect לפני timeout מאפס | ‏manual #3 / ‏טסט #6 |
| 7 | ‏grace period לסוכן ללא WS | ‏טסט #4/#5 |
| 8 | ‏Regression: ‏שיחה רגילה עובדת | ‏connect → ‏פרומפט → ‏תשובה → ‏disconnect |
| 9 | ‏ה-reaper ‏לא מונע יציאה נקייה | ‏`reaper.unref()` ‏קיים; ‏BE ‏יוצא ב-Ctrl-C ‏מיד |
| 10 | ‏כל הקוד החדש מתויג `TEMPORARY (slice 26)` | ‏grep — ‏ראה §7 |

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|
| ‏GC ‏הורג סוכן פעיל (‏משימה ארוכה) | ‏מדד idle ‏שגוי | ‏`hasActiveWs===true` → ‏אף פעם לא נאסף. ‏המדד הוא "מאז ניתוק WS", ‏לא "מאז יצירה/פעילות" |
| ‏race: ‏agent נוצר, ‏WS ‏עוד לא נפתח, ‏reaper ‏הורג | ‏timing בין createAgent ל-WS open | ‏grace period פי-2 ‏(`lastDetachedAt===null` ‏branch) |
| ‏`deleteAndKill` ‏זורק ב-reaper | ‏async ‏ב-interval | ‏`.catch()` ‏על כל קריאה — ‏לא מפיל את ה-interval |
| ‏ה-interval ‏מחזיק את ה-event loop / ‏מונע shutdown | ‏setInterval | ‏`reaper.unref()` |
| ‏מחיקת agent בזמן שעוד מחובר WS ‏(race ‏בין listIdle ל-deleteAndKill) | ‏async gap | ‏זניח: `hasActiveWs` ‏נבדק ב-listIdle; ‏אם WS ‏התחבר בין הבדיקה להריגה — ‏המקרה נדיר ‏וה-FE ‏פשוט יקבל close+יצור חדש. ‏לא קריטי לסלייס זמני |
| ‏הסלייס יישכח ולא יימחק | ‏"זמני" ‏שנשאר לנצח | ‏תג `TEMPORARY (slice 26)` ‏בכל בלוק + §7 ‏מפורש + walkthrough + slices.md |
| ‏מחרוזות עברית | ‏pre-commit hook | ‏הסלייס מוסיף רק הערות + log messages באנגלית. ‏אין UI strings |
| ‏Svelte 5 / FE | ‏— | ‏לא רלוונטי — ‏BE בלבד |

---

## §7 — Escalation triggers + ‏תנאי-מחיקה

### Escalation

- ‏`deleteAndKill` ‏לא מנקה את ה-registry (‏הסוכן נשאר ב-`/api/agents` ‏אחרי reap) — ‏באג BE ‏נפרד, ‏עצור.
- ‏אתה רוצה לשנות את התנהגות `ws-agent.ts:126` (child שורד WS close) — ‏עצור (‏זה future A).
- ‏אתה רוצה להוסיף persistence ‏ל-bridges — ‏עצור (‏מחוץ ל-scope).
- ‏מתברר שאין דרך נקייה למעקב hasActiveWs ‏בלי שינוי invasive ב-store — ‏דווח ל-מרדכי.

### ‏תנאי-מחיקה (‏קריטי — ‏זה סלייס זמני)

‏**‏כשייכנס מנגנון ניהול agents-ברקע ("future A")**, ‏יש למחוק את כל הקוד המתויג `TEMPORARY (slice 26)`:

```bash
# ‏לאיתור כל מה שצריך למחוק:
grep -rn "TEMPORARY (slice 26)" packages/backend/src
```

‏הבלוקים למחיקה:
1. `bridge-manager.ts` — ‏שדות `Entry` (`hasActiveWs`/`lastDetachedAt`/`createdAt`) + ‏מתודות `markAttached`/`markDetached`/`listIdle` + ‏אתחולם ב-spawn.
2. `bridge-manager.idle.test.ts` — ‏הקובץ כולו.
3. `ws-agent.ts` — ‏2 ‏הקריאות `markAttached`/`markDetached` + ‏הרחבת ה-deps type.
4. `server.ts` — ‏בלוק ה-reaper כולו.

‏future A ‏יחליף את זה ב-lifecycle ‏מנוהל (‏reconnect מפורש + ‏רשימת agents + ‏סגירה יזומה ע"י המשתמשת).

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|---|---:|
| ‏לוגיקה טהורה ב-listIdle (TDD) | +1 |
| ‏wiring ‏ב-2 ‏קבצים (ws-agent + server) | +1 |
| ‏async ‏ב-interval + ‏edge cases (grace, ‏reconnect) | +1 |
| ‏אין API ‏חיצוני / ‏streaming | 0 |
| ‏אין protocol BE↔FE ‏חדש | 0 |
| ‏Regression surface ‏ממוקד (BE bridge lifecycle) | +1 |

**Score**: 4/10

**Tier**: `calev` mode: light ‏בסוף + **`calev` mode: phase ‏אחרי Commit 2** ‏(נקודת ה-wiring ‏החיה — ‏צריך לוודא runtime ‏ששני התרחישים ההפוכים עובדים: ‏דליפה נתפסת / ‏פעיל לא נהרג).

> ‏האימות המרכזי הוא runtime (‏התנהגות ה-reaper ‏בזמן אמת), ‏לכן calev (Sonnet) ‏מתאים.

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏חלון idle (`BRIDGE_IDLE_TIMEOUT_MS`)? | 300000 (5 ‏דקות) | ❌ |
| 2 | ‏grace period factor ‏לסוכן ללא WS? | ‏פי-2 ‏(timeout*2) | ❌ |
| 3 | ‏לבדוק `listIdle` ‏עם mock store ‏או spawn אמיתי של `cat`? | ‏מה שנקי יותר ל-executor; ‏שניהם תקפים | ❌ |
| 4 | ‏interval scan frequency? | `min(timeout, 60s)` | ❌ |

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor ‏תוך כדי)

- (‏טרם בוצע)
