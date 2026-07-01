# Slice CUT-3b-ii — BE rewire: connection-registry על connectSpawn (bridge-manager מתמוסס) — בריף

> **תאריך**: 2026-06-28 · **סטטוס**: הושלם · **branch**: slice/cutover-migration (ממשיך אחרי CUT-3b-i)
> **Complexity**: 8/10 (verifier: **calev-heavy** — behavior-preserving על נתיב-הסשן החי) + phase-gate · **depends_on**: [CUT-3b-i]
> **Base**: `slice/cutover-migration` @ `ac43a79` · **לא ממזגים.**

---

## §0 — context

CUT-3b-i בנה את `connectSpawn → ProviderConnection` (פרימיטיב, לא-חי). CUT-3b-ii **מחבר אותו חי**: ה-BE
מרכיב את הפרימיטיבים במקום להשתמש ב-`bridge-manager` singleton. **התנהגות זהה לחלוטין** — רק מבנה.

**הממצא המבני**: `bridgeManager` הוא **singleton רב-agent** (`server.ts:86`, Map פנימי לפי agentId), אבל
`connectSpawn` = **connection יחיד**. הפתרון: **connection-registry** (`Map<agentId, ProviderConnection>`) ב-BE.
כל agent → `connectSpawn()` → conn ב-Map. ה-orchestrator/ws-agent/http-agents מחפשים conn לפי agentId ומרכיבים.

> זהו ה-cutover שבו **bridge-manager מתמוסס**: הלוגיקה הגנרית כבר ב-connectSpawn (CUT-3b-i); כאן ה-BE עובר
> לצרוך אותה, ו-`bridge-manager.ts` **נמחק**. ה-attached-state (UI) עובר ל-BE (הוא לא provider-concern).

## §1 — מטרה

החלף את `createBridgeManager` singleton ב-**connection-registry** + הרכבה ב-orchestrator/ws-agent/http-agents.
מחק bridge-manager. **0 רגרסיה** על נתיב-הסשן החי (spawn/prompt/wire/turn/attach/crash).

## §2 — Scope

| כן | לא |
|---|---|
| **תיקון package (פער CUT-3b-i)**: הוסף `modelOverride?: string \| null` ל-`ConnectOpts` + העבר ב-`connectSpawn` (היום מקובע null — `spawn.ts:108`) | claude in-process (CUT-3b-iii) |
| `connection-registry.ts` (BE) — `Map<agentId, ProviderConnection>` + connect/get/close + **dedup על agentId** (NBug1) | FE / capability-frame (FE-normalization) |
| `agent-orchestrator`: `connectSpawn()` במקום bridgeManager.spawn; conn ב-registry; onCrash/kill→conn | FE / capability-frame (FE-normalization) |
| `ws-agent`: `conn.wire.onLine/write`; **attached-state עובר ל-BE map**; getChild→conn.pid | שינוי פרוטוקול FE↔BE (נשאר ACP-over-WS) |
| `http-agents` getRuntimeInfo: הרכבה מ-`conn.turn` + `conn.pid` + BE-attached | שינוי לוגיקת spawn/turn/wire (זהה — היא בחבילה) |
| wire-observability: `conn.onFrame` → LOG_WIRE/WIRE_RECORD (wireRecorder נשאר BE) | — |
| shapeEnv (audio-prompt + opencode-config) מ-BE כ-`connectSpawn` opt | — |
| **מחיקת `bridge-manager.ts`** (+test) | — |

## §3 — מימוש

### א. `connection-registry.ts` (BE — חדש)
```ts
// מחליף את ה-singleton. מנהל את ה-Map + ה-attached-state (UI concern, BE-side).
interface ConnEntry { conn: ProviderConnection; attached: boolean }
createConnectionRegistry() → {
  connect(agentId, cliKind, opts): Promise<ProviderConnection>   // ⚠️ dedup קודם! (NBug1)
  get(agentId): ProviderConnection | undefined
  markAttached(agentId) / markDetached(agentId)                  // BE attached-state (זז מ-bridge-manager)
  getRuntimeInfo(agentId): { pid; attached; busy; lastMessageAt } | null   // מרכיב conn.turn+pid+attached
  close(agentId): Promise<void>                                  // conn.close + Map.delete
  onCrash(cb): ...                                               // מצרף per-conn onCrash → גלובלי
}
```
⚠️ **dedup guard (NBug1 — אביגיל)**: ה-guard החי היום ב-`bridge-manager.spawnInternal` (דגל `created`). `connectSpawn`
מייצר `randomUUID()` טרי בכל קריאה → אין לו תרחיש same-id; ה-guard **חייב לעבור ל-registry**:
`connect(agentId)` בודק `if (map.has(agentId)) throw/return existing` **לפני** `connectSpawn` — לא לדרוס conn חי.
**ה-regression test של NBug1 עובר ל-registry** (לא ל-connectSpawn): connect פעמיים על אותו agentId → ה-ראשון שורד.

### ב. `agent-orchestrator` — repoint
- `createAndSpawn`: `const conn = await registry.connect(agent.id, input.cliKind, { cwd: input.cwd, shapeEnv: drivecodingShapeEnv, modelOverride: input.modelOverride })`.
  - ⚠️ **modelOverride (🔴 אביגיל)**: ה-orchestrator החי מעביר `input.modelOverride` ל-spawn (agent-orchestrator.ts:153,160); הוא **חי** (בונה `--model` כש-supportsModelFlag). חובה להעבירו דרך `ConnectOpts.modelOverride` (שמתווסף ב-§2), אחרת **בורר-המודל ב-FE נשבר** (typecheck ירוק, רגרסיה שקטה).
  - ה-shapeEnv = הלוגיקה שהייתה ב-bridge-manager:71-83 (opencode→OPENCODE_CONFIG_CONTENT+PROMPT_INJECTOR_TEXT), verbatim.
- ⚠️ **port/wsUrl stub (🟡 אביגיל)**: ה-orchestrator בונה `CreateAndSpawnResult` עם `wsUrl`+`bridgePort` ומריץ `registry.update(id,{bridgePort})`. ל-`ProviderConnection` **אין** port/wsUrl (זה in-process pipe, אין WS-bridge אמיתי). שמר את ה-shape: **`bridgePort = 0`, `wsUrl = ""`** קבוע (כמו ש-spawn-core מחזיר היום — `port:0,wsUrl:""`). אל תמציא.
- ⚠️ **dead dedup (🟢 אביגיל)**: נתיב ה-dedup `if (duplicate?.bridgePort)` (createAndSpawn:127) כבר **מת** (bridgePort תמיד 0). **אל "תתקן" אותו** — שמר no-op (תיקון = שינוי התנהגות, סותר 0-רגרסיה).
- `onCrash` handler: `registry.onCrash((agentId, info) => registry.update(status=crashed))`.
- `deleteAndKill`: `await registry.close(id)`.
- הסר את `BridgeHandleWithStderr`/spawnWithStderr branching (agent-orchestrator:149-157) — עכשיו connect אחיד.

### ג. `ws-agent` — repoint
- `getChild(agentId)` presence-check → `registry.get(agentId)` (קיים?).
- `markAttached/markDetached` → `registry.markAttached/markDetached` (BE-side).
- `onLine(agentId, cb)` → `conn.wire.onLine(cb)`.
- `writeStdin(agentId, line)` → `conn.wire.write(line)`.
- **wire-observability (out)**: היום ב-`bridge-manager.writeStdin`. עכשיו `conn.onFrame` כבר מכסה in+out — ה-BE רושם `conn.onFrame(f => { LOG_WIRE; WIRE_RECORD })` **פעם אחת** ב-connect (לא ב-write). ⚠️ ודא שלא כופלים.

### ד. `http-agents` + `server.ts`
- `http-agents` getRuntimeInfo → `registry.getRuntimeInfo(agentId)`.
- `server.ts`: הסר `createBridgeManager`; הוסף `createConnectionRegistry`; חווט ל-orchestrator/ws-agent/http-agents/registerAgentsHttp. ה-`wireRecorder` עדיין נוצר ב-server ומוזרם ל-registry (שמחבר ל-conn.onFrame).

### ה. מחיקה
- `bridge-manager.ts` + `bridge-manager.runtime.test.ts` (הלוגיקה ב-connectSpawn; ה-regression-tests של double-spawn/NBug1 → העבר רלוונטיים ל-connectSpawn/registry אם חסרים).

## §4 — Commits

0. `connection-registry.ts` + tests (Map, attached-state, getRuntimeInfo הרכבה, onCrash). typecheck.
1. rewire `agent-orchestrator` (connect/onCrash/close) — **phase-gate: calev phase** (spawn+crash עדיין עובד).
2. rewire `ws-agent` + `http-agents` + `server.ts` wiring + **מחיקת bridge-manager**. typecheck + test.
3. אימות חי מלא + findings + walkthrough.

## §5 — DoD (behavior-preserving — כל סטייה = בעיה)

| # | בדיקה |
|---|------|
| 1 | typecheck ירוק (כל packages) |
| 2 | **spawn חי** — claude + opencode: POST /api/agents → spawn → prompt → תשובה (calev-heavy, CLI אמיתי) |
| 3 | **WS pump** — FE↔agent זורם (onLine/write דרך conn.wire); תשובות מגיעות ל-FE |
| 4 | **wire-observability** — LOG_WIRE in+out; WIRE_RECORD שני כיוונים (פעם אחת, לא כפול) |
| 5 | **turn/busy** — getRuntimeInfo.busy מתעדכן בturn (conn.turn) |
| 6 | **attach** — markAttached/markDetached + getRuntimeInfo.attached (BE-state) משרת active-agents panel |
| 7 | **crash** — kill child → registry.update(crashed) (conn.onCrash) |
| 8 | **opencode env** — OPENCODE_CONFIG_CONTENT+PROMPT_INJECTOR_TEXT מוזרקים (shapeEnv) ל-opencode child; claude לא |
| 9 | `bridge-manager.ts` נמחק; אין צרכן שנותר; **double-spawn regression עבר ל-registry** (connect פעמיים על agentId → ראשון שורד) |
| 10 | **modelOverride חי** — בורר-מודל ב-FE עובד: spawn עם `--model` כש-supportsModelFlag (ConnectOpts.modelOverride מועבר, לא null) |
| 11 | port/wsUrl stub: `bridgePort=0`/`wsUrl=""` נשמרים; ה-dead dedup path נשאר no-op |
| 12 | `pnpm test` ירוק (פרט ל-2 pre-existing) |

## §6 — Risks

| סיכון | מיטיגציה |
|---|---|
| נתיב-הסשן החי נשבר (כל agent עובר כאן) | calev-heavy חי + phase-gate אחרי orchestrator; behavior-preserving DoD מקצה-לקצה |
| כפל wire-observability (onFrame + writeStdin) | §3ג ⚠️ — רשום onFrame פעם אחת ב-connect; הסר את ה-decode מ-write |
| attached-state model שונה (זז מ-conn ל-BE) | registry מחזיק attached; getRuntimeInfo מרכיב; DoD#6 חי |
| single-conn vs multi-agent | registry = Map<agentId,conn>; כל agent connectSpawn נפרד; DoD#2 ב-2 agents |
| double-spawn/NBug1 regression (CUT-2) | connectSpawn מחזיק bridgeId יחיד; registry מונע כפל agentId; העבר/אמת ה-regression test |
| shapeEnv condition (opencode-only) | העבר verbatim מ-bridge-manager; DoD#8 |
| crash cleanup (Map leak) | registry.close מסיר מ-Map; onCrash מסיר; regression test |

> 3 שנשכחים: ESM `.js` · lint:i18n (BE) · phase-gate אחרי commit 1.

## §7 — Escalation
- אם ה-WS-pump (onLine/write) לא מתיישב נקי עם conn.wire (timing/backpressure) → עצור, תעד. זה הלב.
- אם הסרת bridge-manager חושפת צרכן נסתר (getRuntimeInfo shape, BridgeHandleWithStderr) שלא ממופה → עצור.

## §8 — Complexity: 8/10 → **calev-heavy** (behavior-preserving על נתיב-הסשן החי — spawn/pump/turn/wire/attach/crash, edge+regression). phase-gate אחרי orchestrator.

## §9 — שאלות פתוחות

| # | שאלה | ברירת-מחדל | חוסם? |
|---|------|----------|------|
| 1 | connection-registry מודול נפרד או בתוך orchestrator? | מודול נפרד (`connection-registry.ts`) — נצרך ע"י orchestrator+ws-agent+http-agents | ❌ |
| 2 | attached-state ב-registry או ב-ws-agent? | registry (getRuntimeInfo צריך אותו; http-agents קורא) | ❌ |
| 3 | wireRecorder: BE יוצר ומזרים ל-registry? | כן — server יוצר, registry מחבר ל-conn.onFrame פר-agent | ❌ |
| 4 | onFrame של conn — מתי נרשם? | ב-`registry.connect`, פעם אחת פר-agent (in+out) | ❌ |
