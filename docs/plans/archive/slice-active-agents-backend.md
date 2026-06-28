# Slice active-agents-backend — תשתית שרת לווידג'ט תהליכים פעילים — ‏בריף

> ✅ **בוצע · אומת · מוזג ל-dev.** אורכב ב-2026-06-27 (הסטטוס אומת מול היסטוריית git/roadmap; פרטי הביצוע והאימות בהמשך הקובץ).

> **‏תאריך**: 2026-06-08
> **‏סוג מסמך**: ‏בריף ביצועי לסלייס
> **‏סטטוס**: ‏הושלם (2026-06-13)
> **‏אימות אביגיל**: ‏לא מאומת (‏דוח: `reports/drive-coding/slice-active-agents-backend-avigail.md`)
> **Dispatch**: ‏מותר לאליעזר רק אם `אימות אביגיל = READY`.
> **Complexity**: 5/10 (verifier: light + phase על commit 3)
> **‏תלויות (`depends_on`)**: [] — ‏בנוי ישירות על dev
> **‏Base**: dev
> **‏Dev tip**: `62ca5bf` (‏אומת ע"י אביגיל: ‏אף קובץ BE/core שה-brief נשען עליו לא השתנה מאז f060fd3)

---

## §0 — Pre-flight

> ‏הסלייס מוסיף לצד-השרת את כל מה שהווידג'ט (slice הבא) צריך: ‏שדה `persistent` (pin)
> ‏ל-agent, ‏נקודת-קצה לשנותו, ‏החרגת agents נעוצים מ-idle-reaper, ‏והעשרת רשימת
> ‏ה-agents ב-`pid` + `attached` (האם פתוח כרגע ב-WS). ‏**‏אין שינוי FE בסלייס הזה.**

### ‏תלויות (‏חובה!)

‏slice זה **‏אין לו תלויות** — ‏בנוי ישירות על dev (`62ca5bf`).

> ‏אביגיל בודקת שזה עקבי עם `depends_on: []` ב-state.json.

### Worktree

```bash
cd /home/user/projects/drive-coding
git worktree add /home/user/projects/drive-coding/.worktrees/slice-active-agents-backend -b slice-active-agents-backend dev
cd /home/user/projects/drive-coding/.worktrees/slice-active-agents-backend
pnpm install && pnpm hooks:install
```

### ‏איך להריץ

- BE: `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (port 4000).
- ‏Typecheck: `pnpm --filter @drive-coding/backend typecheck && pnpm --filter @drive-coding/core typecheck`.
- ‏Tests: `pnpm --filter @drive-coding/core test && pnpm --filter @drive-coding/backend test`.
- ‏בדיקת endpoint ידנית (BE חי): `curl` — ‏ראה §4 commit 2.

### Browser

‏אין — ‏סלייס backend בלבד. ‏אימות דרך `curl` + ‏טסטים.

### Reading list

**must-read** (‏לפני שמתחילים):
- `packages/core/src/schemas/agent.ts` — `Agent` (63-75), `AgentPublic` (79-92), `toAgentPublic` (112-128). ‏(‏העוגנים המדויקים: `crashReason`=74, `acpSessionId`=91, copy-blocks 121-126.) ‏**‏הבחן בדפוס**: `crashReason` ו-`acpSessionId` ‏הם אופציונליים ‏ומועתקים בתנאי (121-126). ‏`persistent` ‏יעקוב אחרי **‏אותו דפוס בדיוק**.
- `packages/core/tests/agent-schema.test.ts` — ‏**‏קריטי**: שורה 88 `expect(pub).toEqual(agent)` ‏ושורות 94/106 `Agent({...})` ‏**‏בלי `persistent`**. ‏לכן `persistent` ‏**‏חייב להיות אופציונלי** ‏(לא חובה) — ‏אחרת הטסטים נשברים. ‏ראה §6.
- `packages/backend/src/agents/registry.ts` — `create` (14-33). ‏מוסיף `persistent: false`.
- `packages/backend/src/acp/bridge-manager.ts` — ‏ה-return type interface (16-24), `Entry` (25-33), `get` (172-174) ‏שמחזיר `handle` ‏שיש בו `pid`, `markAttached`/`store` ל-`hasActiveWs`. ‏מוסיף `getRuntimeInfo`.
- `packages/backend/src/delivery/http-agents.ts` — `GET /api/agents` (27-30), ‏דפוס endpoint עם body validation (99-134 — `session-attached`, ‏לחקות לשם ה-`persistent` endpoint).
- `packages/backend/src/server.ts` — ‏ה-reaper (138-155).
- `packages/backend/src/acp/bridge-manager.idle.test.ts` — ‏טסטי listIdle הקיימים (לא משתנים; ‏ה-pin נבדק ברמת ה-reaper, ‏לא ב-listIdle).

**reference**:
- `packages/backend/tests/http-agents.test.ts` — ‏להרחבה (endpoint חדש + רשימה מועשרת).
- `packages/backend/src/app/agent-orchestrator.ts` — `deleteAndKill` (‏מה ה-reaper קורא).

---

## §1 — ‏מטרה

‏אחרי הסלייס, ‏צד-השרת תומך ב-"תהליך נעוץ" (pinned): ‏ל-agent יש שדה `persistent`,
‏יש endpoint לשנותו, ‏וה-idle-reaper **‏לא הורג** agents נעוצים (גם אחרי שה-WS התנתק
‏וחלף הטיים-אאוט). ‏בנוסף, `GET /api/agents` ‏מחזיר לכל agent גם `pid` ו-`attached`
‏(האם יש כרגע WS פעיל). ‏אין שינוי גלוי למשתמש — ‏זו תשתית ל-slice הווידג'ט. ‏אימות:
‏`curl` + ‏טסטים מראים ש-pin שורד reaper, ‏ו-unpinned עדיין נקצר.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|------|------|------|
| ‏שדה `persistent` ב-`Agent` + `AgentPublic` (אופציונלי) | ✅ | ‏בסלייס הזה |
| `create()` ‏מאתחל `persistent: false` | ✅ | ‏בסלייס הזה |
| `POST /api/agents/:id/persistent` (toggle) | ✅ | ‏בסלייס הזה |
| reaper מדלג על `persistent === true` | ✅ | ‏בסלייס הזה |
| `getRuntimeInfo` ב-bridge-manager → `{pid, attached}` | ✅ | ‏בסלייס הזה |
| `GET /api/agents` ‏מעשיר כל שורה ב-`pid` + `attached` | ✅ | ‏בסלייס הזה |
| ‏ווידג'ט FE / VM / רכיב | ❌ | slice-active-agents-widget |
| ‏הרצת reconnect / כפתורים | ❌ | slice-active-agents-widget |
| ‏הישרדות חוצת-restart של ה-BE (daemon אמיתי, persist ל-PIDs) | ❌ | ‏מחוץ ל-scope — ‏ה-registry בזיכרון, ‏children מתים עם ה-BE (D8) |
| ‏מחיקת ה-reaper לגמרי | ❌ | ‏לא — ‏ה-pin מאלף אותו (ראה §6), ‏לא מוחק |

> ‏**‏הבהרה על "future slice A"**: ‏ההערות ב-bridge-manager/server אומרות "DELETE THIS
> ‏BLOCK when background-agent management (slice A) lands". ‏הסלייס הזה **‏הוא** ‏אותו slice A,
> ‏אבל **‏לא מוחק** ‏את ה-reaper — ‏הוא **‏ממשיך** ‏לנקות דליפות מקריות (reload/טאב שנסגר),
> ‏ורק מחריג נעוצים. ‏אל תמחק את בלוק ה-TEMPORARY; ‏שנה את התנהגותו.

---

## §3 — Architecture diagram

```
core/schemas/agent.ts
  Agent           + "persistent?": boolean          ← אופציונלי (כמו crashReason)
  AgentPublic     + "persistent?" "pid?" "attached?" ← אופציונלי
  toAgentPublic   + copy persistent (בתנאי)          ← לא נוגע ב-pid/attached
                                  │
backend/agents/registry.ts        │
  create()  persistent: false  ───┘ (default)
                                  
backend/acp/bridge-manager.ts
  getRuntimeInfo(id) → { pid: handle.pid, attached: entry.hasActiveWs } | null   ← חדש
                                  │
backend/delivery/http-agents.ts   │
  GET /api/agents:  map(a => ({ ...toAgentPublic(a), ...getRuntimeInfo(a.id) }))  ← מועשר
  POST /api/agents/:id/persistent  { persistent: boolean } → registry.update      ← חדש
                                  
backend/server.ts  (reaper, 138-155)
  reapIdle(now):  listIdle(...) → for id: if registry.get(id).persistent → skip   ← משתנה
                 (חילוץ ל-helper testable)
```

---

## §4 — Commits ‏בסדר

### Commit 0 — שדה `persistent` ב-schema + default ב-registry (approach: tdd)

**‏קבצים שמשתנים**:
- `packages/core/src/schemas/agent.ts` — ‏מוסיף שדה ל-`Agent`, `AgentPublic`, ‏ועדכון `toAgentPublic`.
- `packages/backend/src/agents/registry.ts` — `create()` ‏מוסיף `persistent: false`.

**‏השינוי המדויק ב-agent.ts**:

ב-`Agent` (‏אחרי שורה 74, ‏ליד `crashReason`):
```ts
  // נעיצה (slice active-agents): true = ה-reaper לא יהרוג גם כשמנותק. ברירת מחדל false.
  "persistent?": "boolean",
```

ב-`AgentPublic` (‏אחרי שורה 91, ‏ליד `acpSessionId`):
```ts
  // נעיצה — ה-FE מציג/משנה. אופציונלי: literals בטסטים לא חייבים לכלול אותו.
  "persistent?": "boolean",
  // runtime enrichment (מאוכלס ב-GET /api/agents handler, לא ב-toAgentPublic):
  "pid?": "number",
  "attached?": "boolean",
```

ב-`toAgentPublic` (‏אחרי בלוק `acpSessionId`, ‏שורה 126 — **‏אותו דפוס בדיוק**):
```ts
  if (agent.persistent !== undefined) {
    pub.persistent = agent.persistent
  }
```
> ⚠️ **‏אל תיגע ב-pid/attached כאן** — ‏הם לא חלק מ-`Agent` ‏ולא מ-registry. ‏הם מתווספים
> ‏ב-handler של GET (commit 2). ‏`toAgentPublic` ‏נשאר טהור על registry.

**‏השינוי ב-registry.ts** (‏שורה 23-30, ‏בתוך אובייקט ה-`agent`):
```ts
        status: "ready",
        createdAt: new Date().toISOString(),
        persistent: false,   // ← חדש: agent נוצר לא-נעוץ
```

**Tests (core)** — ‏הרחב את `packages/core/tests/agent-schema.test.ts`:
- `Agent` ‏מקבל אובייקט עם `persistent: true` (‏לא `summary`).
- `Agent` ‏מקבל אובייקט **‏בלי** `persistent` (‏אופציונלי — ‏הטסטים הקיימים בשורות 94/106 ‏עדיין עוברים).
- `toAgentPublic`: ‏אם `agent.persistent === true` → `pub.persistent === true`; ‏אם חסר → `pub` ‏בלי `persistent` (‏מוודא ש-`toEqual(agent)` ‏בשורה 88 ‏עדיין עובר).

**Verification**:
```bash
pnpm --filter @drive-coding/core typecheck && pnpm --filter @drive-coding/core test
pnpm --filter @drive-coding/backend typecheck
```

---

### Commit 1 — `getRuntimeInfo` ב-bridge-manager (approach: tdd)

> ‏מטרה: ‏accessor יחיד שמחזיר `{ pid, attached }` ‏ל-bridge חי — ‏מקור ה-pid וה-attached
> ‏ל-handler של GET. ‏ה-pid כבר קיים ב-`handle.pid`; ‏ה-attached הוא `entry.hasActiveWs`.

**‏קבצים שמשתנים**:
- `packages/backend/src/acp/bridge-manager.ts` — ‏מוסיף `getRuntimeInfo` ל-interface (16-24) ‏ולמימוש (‏ליד `getChild`, ‏שורה 176).

**API skeleton** (‏בתוך ה-return type, ‏ליד `getChild` בשורה 18):
```ts
  getRuntimeInfo(bridgeId: string): { pid: number; attached: boolean } | null
```

**‏המימוש** (‏ליד `getChild`, ‏שורה 176-178):
```ts
    getRuntimeInfo(bridgeId) {
      const e = store.get(bridgeId)
      if (!e) return null
      return { pid: e.handle.pid, attached: e.hasActiveWs }
    },
```
> `e.handle.pid` ‏קיים תמיד (spawn זורק אם אין pid, ‏שורה 135-138). `e.hasActiveWs` ‏הוא
> ‏ה-flag ש-`markAttached`/`markDetached` ‏מתחזקים.

**Tests** — ‏הוסף ל-`packages/backend/src/acp/bridge-manager.idle.test.ts` (‏או קובץ חדש `bridge-manager.runtime.test.ts` ‏אם מעדיף — ‏**‏לא** ‏תחת שם שמתחיל ב-`reports/`):
- `getRuntimeInfo("unknown")` → `null`.
- ‏אחרי `spawnBridge` → `{ pid: <number>, attached: false }`.
- ‏אחרי `markAttached` → `attached: true`; ‏אחרי `markDetached` → `attached: false`.

> ‏השתמש באותו דפוס `spawnBridge` (OPENCODE_BIN=/usr/bin/sleep) ‏מהטסט הקיים (52-72).

**Verification**:
```bash
pnpm --filter @drive-coding/backend test
```

---

### Commit 2 — endpoint `persistent` + העשרת GET (approach: integration)

**‏קבצים שמשתנים**:
- `packages/backend/src/delivery/http-agents.ts` — ‏מעשיר `GET /api/agents` (27-30), ‏מוסיף `POST /api/agents/:id/persistent`.

**‏העשרת GET /api/agents** (‏מחליף שורות 27-30). ‏צריך גישה ל-bridgeManager — ‏הוא **‏לא** ‏ב-`deps` ‏כרגע (deps = registry/orchestrator/projectsRegistry). ‏הוסף אותו ל-`deps` **‏כשדה אופציונלי** (`bridgeManager?:`):
```ts
  deps: {
    registry: AgentRegistry
    orchestrator: AgentOrchestrator
    projectsRegistry?: ProjectsRegistry
    // אופציונלי בכוונה — ראה הערה למטה (call-sites קיימים בטסט לא מעבירים אותו)
    bridgeManager?: { getRuntimeInfo(id: string): { pid: number; attached: boolean } | null }   // ← חדש
  },
```
```ts
  app.get("/api/agents", async (c) => {
    const all = await deps.registry.list()
    return c.json({
      agents: all.map((a) => {
        const rt = deps.bridgeManager?.getRuntimeInfo(a.id)   // guard: אם אין bridgeManager → אין העשרה
        return { ...toAgentPublic(a), ...(rt ?? {}) }
      }),
    })
  })
```
> **‏למה אופציונלי (‏ולא חובה)**: ‏ל-`registerAgentsHttp` ‏יש **‏3 call-sites** — ‏אחד ב-`server.ts:69`
> ‏(‏שם **‏חובה להוסיף** `bridgeManager`, ‏שכבר ב-module scope שם), ‏ו-**‏2 בטסט**
> ‏`http-agents.test.ts:34,150` ‏שלא מעבירים אותו. ‏שדה חובה היה שובר את שני אלה ב-typecheck.
> ‏אופציונלי + guard `?.` ‏שומר את הטסטים הקיימים ירוקים, ‏ועדיין מעשיר בפרודקשן.
> **‏חובה**: ‏עדכן את `server.ts:69` ‏להוסיף `bridgeManager` ל-deps (אמת עם `grep -rn "registerAgentsHttp" packages/backend/src`).

**endpoint חדש** (‏אחרי ה-`session-attached`, ‏שורה 134 — ‏לחקות את הדפוס שלו):
```ts
  // POST /api/agents/:id/persistent — נעיצה: { persistent: boolean }
  app.post("/api/agents/:id/persistent", async (c) => {
    const id = c.req.param("id")
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid json" }, 400)
    }
    const { persistent } = body as Record<string, unknown>
    if (typeof persistent !== "boolean") {
      return c.json({ error: "persistent (boolean) is required" }, 400)
    }
    const agent = await deps.registry.get(id)
    if (!agent) return c.json({ error: "agent not found" }, 404)
    await deps.registry.update(id, { persistent })
    return c.json({ ok: true })
  })
```

**Tests** — ‏הרחב `packages/backend/tests/http-agents.test.ts`:
- `POST /api/agents/:id/persistent` ‏עם `{persistent:true}` → 200 `{ok:true}`, ‏ו-`registry.get(id).persistent === true`.
- ‏גוף לא-boolean → 400. ‏agent לא קיים → 404. ‏JSON לא תקין → 400.
- `GET /api/agents` ‏מחזיר `pid` ‏(number) ו-`attached` ‏(boolean) ‏ל-agent חי — ‏ב-call-site חדש בטסט שמעביר `bridgeManager` mock עם `getRuntimeInfo` ‏שמחזיר `{pid, attached}`. (‏2 ה-call-sites הקיימים ב-`:34,150` ‏לא מעבירים bridgeManager → ‏אצלם השדות נעדרים, ‏וזה תקין — ‏ה-guard `?.` ‏מטפל.)

**Verification**:
```bash
pnpm --filter @drive-coding/backend test
# ידני (BE חי): צור agent, ואז:
#   curl -XPOST localhost:4000/api/agents/<id>/persistent -H 'content-type: application/json' -d '{"persistent":true}'
#   curl localhost:4000/api/agents | jq '.agents[] | {id,persistent,pid,attached}'
```

---

### Commit 3 — reaper מדלג על נעוצים (approach: integration) ⚠️ verifier-phase

**‏קבצים שמשתנים**:
- `packages/backend/src/server.ts` — ‏ה-reaper (138-155): ‏חילוץ ל-helper + ‏החרגת persistent.

**‏השינוי** — ‏החלף את גוף ה-`setInterval` (145-154) ‏בקריאה ל-helper testable. ‏הגדר את ה-helper **‏מעל** ‏ה-`setInterval` (‏או ‏ב-module נפרד `acp/reap-idle.ts` ‏אם מעדיף — ‏executor בוחר, ‏אבל ‏חייב להיות testable בלי לאתחל את כל ה-server):
```ts
// ─── TEMPORARY (slice 26, מאולף ב-active-agents): idle-bridge reaper ───
// כעת מחריג agents נעוצים (persistent=true) — לא מוחק את הבלוק, משנה התנהגות.
async function reapIdleBridges(now: number): Promise<void> {
  const idle = bridgeManager.listIdle(BRIDGE_IDLE_TIMEOUT_MS, now)
  for (const id of idle) {
    const agent = await registry.get(id)
    if (agent?.persistent) {
      reaperLog.debug({ agentId: id }, "skip reaping pinned bridge")
      continue
    }
    reaperLog.info({ agentId: id }, "reaping idle bridge")
    await orchestrator.deleteAndKill(id).catch((e) =>
      reaperLog.warn({ err: e, agentId: id }, "reap failed"),
    )
  }
}
const reaper = setInterval(() => { void reapIdleBridges(Date.now()) }, REAP_INTERVAL_MS)
reaper.unref()
```
> **‏למה async ב-interval**: `registry.get` ‏הוא async (חתימה), ‏אבל in-memory (מיידי). ‏ה-`void`
> ‏לא חוסם את ה-interval. ‏זה מקובל — ‏ה-deleteAndKill הקיים כבר היה fire-and-forget.

**Tests** — ‏טסט אינטגרציה חדש `packages/backend/tests/reaper-pin.test.ts`:
‏בנה `registry` + `bridgeManager` + `orchestrator` ‏אמיתיים (כמו ב-agent-orchestrator.test.ts),
‏spawn bridge (sleep), `markDetached`, ‏הצב `BRIDGE_IDLE_TIMEOUT_MS` ‏נמוך, ‏וודא:
- ‏agent **‏לא-נעוץ** + ‏מנותק + ‏עבר timeout → ‏מופיע ב-`listIdle` ‏**‏ו**-reapIdleBridges הורג אותו (registry.get → null / bridgeManager.get → null).
- ‏agent **‏נעוץ** (`registry.update(id,{persistent:true})`) + ‏מנותק + ‏עבר timeout → ‏מופיע ב-`listIdle` ‏אבל reapIdleBridges **‏לא** ‏הורג (bridge עדיין חי).

> ‏אם החילוץ ל-helper מקשה על import (ה-server.ts ‏מריץ side-effects ב-top-level) —
> ‏העבר את `reapIdleBridges` ‏ל-`packages/backend/src/acp/reap-idle.ts` ‏כפונקציה
> ‏שמקבלת `{bridgeManager, registry, orchestrator, timeoutMs}` ‏ו-`now`. ‏ה-server רק קורא לה.
> ‏**‏זו הדרך המומלצת** — ‏מנתק את הטסט מ-side-effects של server.ts.

**Verification**:
```bash
pnpm --filter @drive-coding/backend typecheck && pnpm --filter @drive-coding/backend test
```

> **‏verifier-phase כאן** (כלב mode:phase) — ‏זה ה-commit המסוכן: ‏שינוי התנהגות reaper שעלול
> ‏להחזיר regression (להרוג נעוצים / ‏לא להרוג דליפות). ‏ראה §8.

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | typecheck נקי (3 packages) | `pnpm -r typecheck` |
| 2 | core tests | `pnpm --filter @drive-coding/core test` — ‏כולל הטסטים החדשים ל-persistent |
| 3 | backend tests | `pnpm --filter @drive-coding/backend test` — ‏כולל runtime + endpoint + reaper-pin |
| 4 | ‏הטסטים הקיימים לא נשברו | `agent-schema.test.ts` ‏(שורה 88 toEqual), `bridge-manager.idle.test.ts` ‏ירוקים |
| 5 | endpoint pin עובד | BE חי: `curl -XPOST .../persistent -d '{"persistent":true}'` → `{ok:true}`; `GET` ‏מראה `persistent:true` |
| 6 | GET מעשיר pid+attached | `curl .../api/agents \| jq` ‏מראה `pid` ‏ו-`attached` ‏ל-agent חי |
| 7 | reaper מדלג נעוץ | ‏טסט reaper-pin ירוק: ‏נעוץ שורד, ‏לא-נעוץ נקצר |
| 8 | lint עובר | `pnpm lint:i18n` (‏אין מחרוזות חדשות — ‏אמור לעבור) + ‏הוקים |
| 9 | regression: connect רגיל | BE חי: ‏POST /api/agents ‏עדיין יוצר agent (`persistent:false` ‏בברירת מחדל) |

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| **`persistent` ‏כחובה שובר טסטים** | `agent-schema.test.ts:88,94,106` | ‏**‏אופציונלי בלבד** (`"persistent?"`) + ‏העתקה מותנית ב-toAgentPublic (כמו crashReason). ‏אומת: ‏הטסט בשורה 88 ‏בונה literal בלי persistent → ‏חייב לעבור. DoD#4. |
| pid/attached דולפים ל-toAgentPublic ‏ושוברים toEqual | ‏העשרה במקום הלא-נכון | ‏ההעשרה **‏רק** ‏ב-handler של GET, ‏**‏לא** ‏ב-toAgentPublic. toAgentPublic נשאר טהור-registry. DoD#4. |
| `bridgeManager` ‏כחובה שובר 2 call-sites בטסט | ‏אביגיל: `http-agents.test.ts:34,150` | ‏הוסף ל-deps **‏כאופציונלי** (`bridgeManager?:`) + guard `?.` ‏בהעשרה. ‏עדכן call-site ב-`server.ts:69` ‏(‏שם מעבירים אותו). ‏2 ה-call-sites בטסט נשארים ירוקים (לא מעבירים → אין העשרה). typecheck יתפוס אם שכחת ב-server.ts. |
| reaper async-in-interval | ‏שינוי 145 | `void` ‏לא חוסם; `registry.get` ‏in-memory מיידי. ‏דפוס fire-and-forget כבר היה שם (deleteAndKill.catch). |
| ‏טסט reaper נשען על side-effects של server.ts | top-level boot | ‏חלץ `reapIdleBridges` ל-`acp/reap-idle.ts` (מומלץ) — ‏טסט מייבא פונקציה טהורה, ‏לא את ה-server. |
| ‏שם קובץ טסט תחת `reports/`-trap | `.gitignore` (plan-pitfalls קט' 2) | ‏טסטים ב-`packages/backend/tests/` ‏או ליד ה-src — ‏**‏לא** ‏תחת `reports/`. `git check-ignore -v <path>` ‏לפני יצירה. |

> ‏3 שתמיד נשכחים:
> 1. Hardcoded strings → ‏**‏אין מחרוזת UI חדשה** (backend בלבד). ✅
> 2. Reactivity gotchas → ‏אין FE. ✅
> 3. OneCLI placeholder → ‏ה-BE רץ דרך OneCLI כרגיל; ‏אין שינוי spawn. ✅

---

## §7 — Escalation triggers

> ‏אם X — ‏עצור ושאל את מרדכי:

- ‏חילוץ `reapIdleBridges` ‏ל-module נפרד דורש לשנות עוד מבנה ב-server.ts ‏(תלות ב-state פנימי שלא צפוי).
- ‏`registerAgentsHttp` ‏נקרא ב-יותר ממקום אחד עם deps שונים (לא רק server.ts).
- ‏הוספת `persistent` ‏ל-arktype `Agent` ‏מפילה טסט/קוד שלא נצפה ב-§6.
- ‏אתה רוצה לסטות מ-approach שה-brief קבע ל-commit.

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|------|------|
| Protocol contract חדש (endpoint + שדות) | +2 |
| Refactor של קוד קיים (reaper) | +1 |
| >5 files ‏ב->1 package (core+backend) | +1 |
| State machine / async coordination (reaper async) | +1 |
| Pure logic ברובו, ‏IO מועט | -1 |
| TDD על 0+1, ‏tests מקיפים | -1 |
| ‏בסיס glue | +2 (base) |

**Score**: 5 / 10

**Tier**: 4-7 → `calev` (light) + `verifier-phase` ‏על **commit 3** (reaper — ‏סיכון regression).

**‏Verifier-phase אחרי**: commit 3.

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | ‏לכלול `pid` ‏ברשימה (לעומת רק `attached`)? | ‏כן — ‏זול (כבר ב-handle), ‏מחזק תפיסת "תהליך" ל-UI | ❌ |
| 2 | ‏`reapIdleBridges` ‏inline ב-server.ts ‏או module נפרד? | ‏module נפרד (`acp/reap-idle.ts`) — ‏testable | ❌ |
| 3 | endpoint נפרד `/persistent` ‏או PATCH כללי על `/api/agents/:id`? | ‏נפרד — ‏עקבי עם `/session-attached`, ‏פשוט יותר | ❌ |

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor ‏תוך כדי)

- **ports.ts לא בscope**: נדרשה הרחבת `AgentRegistry.update` Pick להכיל "persistent" — לא צוין בbrief, הוסף בcommit 2.
- **cwd="/tmp" בטסט reaper-pin**: validateCwd דורש Unix absolute path; os.tmpdir() מחזיר Windows path. הטסט משתמש ב-`/tmp` כ-cwd לregistry (בעוד spawn עצמו רץ מ-os.tmpdir()).
- **cross-platform spawnBridge**: bridge-manager.idle.test.ts שכבר היה על dev היה תלוי ב-/usr/bin/sleep (Windows-broken). הוחלף ב-process.execPath + acp script — תיקון שנדרש לפי §0 של dispatch.
