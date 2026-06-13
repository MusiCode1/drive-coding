# Slice P1b — ACP Provider adapter

> **תאריך**: 2026-06-13
> **סטטוס**: ✅ **plan-verified / READY** (אביגיל סבב 5, 2026-06-13 — 0 blocker/major, מוכן ל-dispatch אחרי merge P1a). **5 סבבי אימות**: 7→2→3→3→0 findings (כל ה-shape-mismatches מול fixtures תוקנו; ההנחיה "shapes 1:1 מהמקור הקיים" שברה את הלולאה).
> **Base**: `dev` HEAD **אחרי merge של P1a**. ⚠️ **חסום עד merge**: כיום ה-types של P1a ב-worktree `slice-P1a-provider-abstraction` בלבד (טרם merged ל-dev). clone מקומי bare `D:\UserProjects\AI\drive-coding`.
> **Complexity**: ~6/10 (verifier: `calev-heavy` אם נוגעים ב-frontend; ראה §2)
> **תלויות (`depends_on`)**: `[P1a]` — צריך את `ProviderSession`/`ProviderEvent`/`ToolCallLocation`/`classifyToolKind` מ-`packages/core/src/provider/`.

---

## §0 — Pre-flight

### למה
P1a הגדיר את החוזה הקנוני ב-`core`. P1b מיישם **adapter ראשון**: עוטף את ה-ACP הקיים מאחורי
`ProviderSession`, וממפה `SessionNotification` (ACP) → `ProviderEvent` (קנוני). אחרי P1b, consumer
יכול לדבר קנוני מול ACP. ה-cutover של ה-frontend עצמו (`agent-session.svelte.ts`) — **slice נפרד**
(P1d, §10), כדי לשמור על P1b ממוקד וניתן-לאימות בלי לשבור UI.

### Reading list (must-read)
- `packages/core/src/provider/events.ts` — היעד (P1a). `ProviderEvent`, `ProviderSession`, `ProviderCapabilities`.
- `packages/core/src/provider/tool-kind.ts` — `classifyToolKind` (⚠️ **לא מיוצא** מ-index — P1b צריך לייצא, ראה §4 Commit 0).
- `packages/core/src/acp/client.ts` — `AcpClient` (`newSession`/`loadSession`/`listSessions`/`prompt(sid,text)`/`cancel(sid)`/`close()`) + `createAcpClient(transport, onUpdate)`.
- `packages/core/src/ports.ts` — `AcpTransport`, `AcpCapabilities`, `PromptResponse`/`SessionNotification` (מ-ACP SDK).
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts:947` `#onSessionUpdate` — **מקור-האמת ל-mapping** (כל ה-`sessionUpdate` variants שצריך לכסות). וכן `#handleToolCall`/`#handleToolCallUpdate` (collapse logic).
- `packages/core/src/acp/client-impl.ts:21` `requestPermission` — כיום auto `allow_once` (אין UI).

### איך להריץ
- `pnpm -F @drive-coding/core typecheck` · `pnpm -F @drive-coding/core build` · `pnpm vitest run --project @drive-coding/core`
- ⚠️ אל `pnpm test` (root) — pre-existing failures (Windows `/usr/bin/sleep`, svelte tsconfig).

---

## §1 — מטרה
`AcpProviderSession implements ProviderSession` ב-`packages/core/src/provider/` (או `core/src/acp/`),
+ `mapAcpNotification(SessionNotification): ProviderEvent | null` טהור, + מיפוי `AcpCapabilities → ProviderCapabilities`.
מבוסס-טסטים מול fixtures אמיתיים. **בלי** לשנות frontend (P1d).

---

## §2 — Scope

| פיצ'ר | כן/לא | הערה |
|------|------|------|
| `mapAcpNotification(n): ProviderEvent \| null` (**טהור**) | ✅ | הלב — ראה §3 |
| `AcpProviderSession implements ProviderSession` (עוטף `AcpClient`) | ✅ | start/sendPrompt/cancel/stop/onEvent + tier2 |
| `mapAcpCapabilities(AcpCapabilities): ProviderCapabilities` | ✅ | resume/list מ-ACP caps; permissions/tools true |
| export `classifyToolKind` + הטיפוסים מ-`core/index.ts` | ✅ | הערת כלב מ-P1a |
| טסטים: mapping פר-variant + session lifecycle (mock transport) | ✅ | TDD; השתמש ב-`transport-mock.ts` הקיים |
| **שינוי `agent-session.svelte.ts` / frontend cutover** | ❌ | **P1d** (§10) — שינוי UI, calev-heavy |
| **permission UI** (חיבור `permission.request` ל-UI אמיתי) | ❌ | P1d — כרגע ACP auto allow_once |
| **`sendRaw`/MCP/diff/terminal** | ❌ | capability-gated; לא נצפו ב-drive-coding flow |

> אם נשאר types+core-logic+טסטים בלבד (בלי frontend) → complexity ~6 → `calev` (light). אם מחליטים לכלול frontend cutover → ~8 → `calev-heavy`. **ברירת-מחדל: core בלבד.**

---

## §3 — Design

### mapAcpNotification (טהור — מ-`#onSessionUpdate`)
```ts
export function mapAcpNotification(n: SessionNotification): ProviderEvent | null {
  const u = n.update as { sessionUpdate?: string; content?: any; messageId?: string;
    toolCallId?: string; title?: string; kind?: string; rawInput?: unknown;
    rawOutput?: unknown; status?: string; locations?: unknown[] | null;
    entries?: unknown[];                          // plan (אביגיל r2)
    used?: number; size?: number; cost?: unknown } // usage_update {used,size,cost}; ⚠️ cost = {amount,currency} object (אביגיל r3)
  switch (u.sessionUpdate) {
    case "tool_call":
    case "tool_call_update":
      return { type: "tool_call", id: u.toolCallId!, name: u.kind ?? u.title ?? "tool",
        input: u.rawInput ?? {}, kind: classifyToolKind(u.kind ?? ""),
        status: mapStatus(u.status),         // ⚠️ undefined→"pending" (ACP status אופציונלי; P1a status required)
        locations: mapLocations(u.locations),
        content: mapContent(u.content) }     // ⚠️ ToolContent מ-`update.content` (array), **לא** `rawOutput` (=result גולמי). אביגיל r4
    case "agent_message_chunk":       return { type: "message.delta", role: "assistant", text: textOf(u.content) }
    case "agent_thought_chunk":       return { type: "thinking.delta", text: textOf(u.content) }
    case "plan":                      return { type: "plan.update", entries: mapPlanEntries(u.entries) } // אביגיל r2: 14 הופעות ב-fixtures; יעד קנוני events.ts:58
    case "usage_update":              return { type: "usage", usage: mapUsage(u) }     // shape {used,size,cost} → Usage passthrough (Usage פתוח: [k]:unknown)
    case "available_commands_update": return { type: "raw", provider: "acp", frame: n } // אין מושג קנוני (§9 #5)
    case "user_message_chunk":        return { type: "raw", provider: "acp", frame: n } // §9 #1 — replay
    default:                          return { type: "raw", provider: "acp", frame: n }
  }
}
// mapContent(content): ⚠️ ACP item = { type:"content", content:{ type:"text", text } } → קנוני { kind:"text", text } (discriminant type→kind). מקור: #mapToolContent (agent-session:855).
// mapUsage(u): { used: u.used, size: u.size, cost: u.cost } — Usage פתוח [k]:unknown; cost = {amount,currency} object (אביגיל r3)
// mapPlanEntries(entries): ⚠️ ACP plan entry = { content, priority, status } (אביגיל r3, אומת מול fixtures), לא {id,title,status}.
//   → entries?.map(e => ({ title: e.content, status: e.status }))  (PlanEntry של P1a = {id?,title?,status?}; priority נדחה — אין שדה קנוני, §9 #6)
```
> ⚠️ **מקור-אמת ל-shapes = הקוד הקיים, לא ה-pseudo-code כאן.** ה-pseudo מתאר את **המבנה** (switch→ProviderEvent); את ה-field-shapes המדויקים (איזה שדה ב-`update` ממפה לאן) **העבר 1:1 מהקוד הקיים** (agent-session.svelte.ts): `#onSessionUpdate`:947, `#handleToolCall`/`#handleToolCallUpdate`:996/1034, `#mapToolContent`:855, `#mapLocations`:895. אל תנחש shape — קרא את המקור. (4 סבבי אביגיל חשפו shape-mismatches; זו הסיבה.)
>
> ⚠️ **fixture file = `{ loadResult, updates: [...] }`** (אביגיל r4). כל element ב-`.updates` הוא **bare `update` object** (לא `SessionNotification`). ה-`#loadMockSession` עוטף `{ update }`. לכן בטסטים: לכל `up` ב-`fixture.updates` → `mapAcpNotification({ update: up } as SessionNotification)`. אל תעביר את הקובץ או את ה-`up` ישירות (אחרת `n.update` undefined → הכל `raw`).
>
> `tool_call`+`tool_call_update` → **single `tool_call` with status** (החלטה 2). ה-consumer ממזג לפי `id` (drive-coding כבר עושה זאת ב-`#handleToolCallUpdate`).

### AcpProviderSession (עוטף AcpClient)
```ts
class AcpProviderSession implements ProviderSession {
  readonly providerId = "acp"; readonly sessionId; readonly capabilities
  #client: AcpClient; #emit?: (e: ProviderEvent) => void
  // start: createAcpClient(transport, n => this.#emit?.(mapAcpNotification(n))) + newSession; emit session.ready
  //   capabilities ← mapAcpCapabilities(client.capabilities)  ⚠️ המקור הוא AcpClient.capabilities
  //   (= SDK agentCapabilities), **לא** ports.ts AcpCapabilities (שזה רק {loadSession}). (אביגיל)
  // sendPrompt(content: PromptContent): חלץ text קודם — client.prompt דורש (sessionId, text:string):
  //   const text = typeof content === "string" ? content : content.filter(p=>p.type==="text").map(p=>p.text).join("")
  //   ⚠️ client.prompt() הוא AWAIT-blocking עד סוף ה-turn (agent-session:493).
  //   → התחל את prompt() ללא await, החזר PromptAck{turnId:uuid, status:"running"} מיד;
  //     כש-prompt() resolves (PromptResponse{stopReason}) → emit
  //       turn.end{turnId, stopReason, isError: isErrorStop(stopReason)}.  ⚠️ isError חובה (events.ts:59). (§9 #2)
  // cancel(turnId?): client.cancel(sessionId)
  // stop(): client.close()
  // onEvent(handler): this.#emit = handler; return () => {...}
  // tier2: listSessions→client.listSessions; resumeSession→client.loadSession
}
```

---

## §4 — Commits

### Commit 0 — exports + scaffolding (typecheck)
- `core/index.ts`: ⚠️ `verbatimModuleSyntax` → **split imports** — `import type` לטיפוסים (`ProviderEvent`…), **value import** ל-`classifyToolKind` (פונקציה). ייצא `classifyToolKind`, `mapAcpNotification`, `AcpProviderSession`, `mapAcpCapabilities`.
- שלד `provider/acp-provider.ts` + `provider/map-acp-notification.ts`.

### Commit 1 — `mapAcpNotification` + טסטים (tdd)
- מימוש טהור (§3) + helpers: `mapStatus` (⚠️ `undefined`→`"pending"`), `mapContent`, `mapLocations`, `mapUsage`.
- ⚠️ fixtures ב-`packages/frontend/static/fixtures/*.json` הם **bare `update` objects** (לא `SessionNotification`). בטסט עטוף `{ update: fixture } as SessionNotification` (כמו `#loadMockSession`:929) — אחרת `n.update` undefined → הכל `raw`.
- טסט פר-variant — כולל `usage_update`, `available_commands_update`, `user_message_chunk`.

### Commit 2 — `AcpProviderSession` + טסטים (tdd)
- מימוש (§3) מעל `transport-mock.ts` הקיים.
- טסטים: start→session.ready, sendPrompt→PromptAck+turn.end (async), cancel, stop, onEvent emit.

### Commit 3 — `mapAcpCapabilities` + טסטים (tdd)

---

## §5 — DoD
| # | בדיקה |
|---|------|
| 1 | typecheck + build exit 0 |
| 2 | `mapAcpNotification` — כל variant: tool_call, tool_call_update, agent_message_chunk, agent_thought_chunk, **plan→plan.update**, **usage_update→usage**, **available_commands_update→raw**, user_message_chunk→raw, unknown→raw. fixtures עטופים `{update}` |
| 3 | tool_call collapse — tool_call_update לאותו id → status מתעדכן; `mapStatus` undefined→"pending" |
| 4 | `AcpProviderSession` — start/sendPrompt(async)/cancel/stop/onEvent מאומתים מול mock transport |
| 5 | sendPrompt מחזיר PromptAck מיד; `turn.end{turnId, stopReason, **isError**}` נפלט כש-prompt resolves (לא חוסם) |
| 6 | exports מ-core/index (classifyToolKind, mapAcpNotification, AcpProviderSession, mapAcpCapabilities) |
| 7 | scope — לא נגעו ב-frontend/`agent-session.svelte.ts` |
| 8 | `mapAcpCapabilities` ← `client.capabilities` (SDK agentCapabilities), **לא** ports `AcpCapabilities` |
| 9 | regression — vitest core 0 fail |

---

## §6 — Risks
| סיכון | מיטיגציה |
|------|----------|
| `client.prompt` blocking מול sendPrompt non-blocking | §3 — prompt ללא await, turn.end on resolve. טסט #5 |
| `SessionNotification` shape לא יציב (ACP `_meta`/extensions) | unknown variant → `raw`; טסט |
| `content` (rawOutput) → `ToolContent[]` — צורות מגוונות | התחל text-only; diff/terminal → §9 #3 |
| turnId — ACP אין מובנה | ה-adapter מייצר uuid, ממפה ל-prompt() promise |

---

## §7 — Escalation
- צריך לשנות frontend/`agent-session` כדי שמשהו יעבוד → P1d, scope creep.
- `SessionNotification` variant לא ידוע/לא ב-fixtures → `raw`, אל תמציא.
- ACP `prompt()` מתנהג אחרת ממה שמתואר (493) → עצור, אמת מול הקוד.

---

## §8 — Complexity
adapter core (+2) · pure mapping (-1) · TDD (-1) · async lifecycle ניואנס (+2) · mock transport קיים (-1) · exports (+1) = **~6/10 → calev (light)**. (אם frontend cutover → +2 → calev-heavy, אבל זה P1d.)

---

## §9 — שאלות פתוחות
| # | שאלה | default | חוסם? |
|---|------|--------|------|
| 1 | `user_message_chunk` (replay) → `raw` או דילוג? | **`raw`** (lossless; הקנוני אין role:user ב-message.delta) | ❌ |
| 2 | turnId — מאיפה? | **uuid שה-adapter מייצר**, ממופה ל-prompt() promise; turn.end on resolve | ❌ |
| 3 | `content` rawOutput → ToolContent? | **text-only ל-MVP**; diff/terminal → P1d (תלוי ב-content shape של ACP) | ❌ |
| 4 | permission — לחבר עכשיו? | **לא** — ACP auto allow_once כיום; `permission.request` ייפלט אם/כשACP יחשוף; UI = P1d | ❌ |
| 5 | `usage_update` shape `{used,size,cost}` (אביגיל r2) → `usage`? | **`usage`** עם passthrough (`Usage` פתוח `[k]:unknown`; אין tokens ב-ACP usage_update). `available_commands_update`→**`raw`** | ❌ |
| 6 | variant `plan` (14 הופעות ב-fixtures, אביגיל r2) → ? | **`plan.update`** (יעד קנוני events.ts:58); `mapPlanEntries` לפי shape `PlanEntry` של P1a — אמת מול fixture | ❌ |

---

## §10 — Roadmap (אחרי P1b)
- **P1d — frontend cutover**: `agent-session.svelte.ts` צורך `AcpProviderSession`+`ProviderEvent` במקום `createAcpClient`+`SessionNotification`. כולל `content→ToolContent[]` מלא ו-permission UI. calev-heavy.
- **P1c — ClaudeCode adapter**: `ClaudeProviderSession` (claude-code-connection כבר פולט `ProviderEvent` תואם → drop-in). רישום ב-`CLI_SPECS` (יש `claude` ACP, אין `claude-code`).
