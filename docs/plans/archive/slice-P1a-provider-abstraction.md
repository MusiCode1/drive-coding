# Slice P1 — Canonical Provider abstraction + ACP/ClaudeCode adapters

> ✅ **בוצע · אומת · מוזג ל-dev.** אורכב ב-2026-06-27 (הסטטוס אומת מול היסטוריית git/roadmap; פרטי הביצוע והאימות בהמשך הקובץ).

> **תאריך**: 2026-06-13
> **סטטוס**: ✅ **plan-verified / READY** (אביגיל סבב 3, 2026-06-13 — 0 blocker/major, מוכן ל-dispatch). 3 סבבי אימות: סבב 1 (2 blocker+1 major+2 minor) → סבב 2 (3 textual) → סבב 3 **READY**. 8 findings מצטברים תוקנו: מקור-אמת inline §3 (חוזה v1.2), arktype `.array()`, `classifyToolKind` switch, pnpm 10, `pnpm test`=root vitest, טסטים ב-`tests/`, DoD/§6 ללא שריד events.ts.
> **Base**: `dev` HEAD (הענף הראשי של drive-coding — לא main). עבודה ב-clone המקומי `D:\UserProjects\AI\drive-coding`.
> **פירוק (JIT)**: P1 גדול מכדי להיות slice יחיד → **3 slices**. brief זה מפרט את **P1a** (ההפשטה) לביצוע מיידי, ומתאר P1b/P1c כ-roadmap (§10) שייכתבו JIT אחרי ש-P1a עובר.
>
> | slice | תוכן | Complexity | depends_on |
> |---|---|---|---|
> | **P1a** | canonical Provider **types** ב-`core` + מיפויים + תיקון `locations` drift | ~4/10 | `[]` |
> | P1b | **ACP adapter** — `AcpTransport`/`SessionNotification` → `ProviderSession`/`ProviderEvent` | ~7/10 | `[P1a]` |
> | P1c | **ClaudeCode adapter** — חיבור claude-code-connection כ-Provider | ~6/10 | `[P1a]` |

---

## §0 — Pre-flight (P1a)

### למה זה
drive-coding היום **ACP-direct**: `core/src/ports.ts` מייבא `SessionNotification`/`PromptResponse` מ-`@agentclientprotocol/sdk`, ה-frontend מריץ `createAcpClient` מעל `WsAcpTransport`, ו-`agent-session.svelte.ts` ממפה `SessionNotification` → bubble UI. כדי לתמוך ביותר מספק אחד (ACP + ClaudeCode stream-json) **בלי** שה-consumer יידע מי הספק, צריך שכבת הפשטה קנונית — בדיוק מה ש-`provider-abstraction` (Contract v1.2) מגדיר ו-`claude-code-connection` כבר מיישם בצד Claude.

**P1a הוא types-בלבד** (כמו Slice A ב-claude-code-connection): מגדיר את החוזה ב-`core`, בלי לחבר adapters עדיין. P1b/c בונים עליו. אין שינוי runtime ב-P1a — ה-call sites החדשים הם הטסטים בלבד.

### Worktree (מבנה bare — כמו remote; ענף-בסיס `dev`)
```bash
cd /d/UserProjects/AI/drive-coding
git --git-dir=.bare fetch origin                       # עדכן dev אם צריך
git --git-dir=.bare worktree add .worktrees/slice-P1a-provider-abstraction -b slice-P1a-provider-abstraction dev
cd .worktrees/slice-P1a-provider-abstraction
pnpm install   # toolchain: pnpm 10
```

### איך להריץ
- typecheck/build/test לפי הסקריפטים של `packages/core` (אמת ב-`package.json`).
- אין שרת/FE/browser ל-P1a — שכבת types טהורה + מיפויים + טסטי-יחידה.

### Reading list (must-read)
- `packages/core/src/ports.ts` — `AcpTransport`, `AcpCapabilities`, `SessionNotification`/`PromptResponse` (ACP SDK). **מקור האמת למה שצריך להפשיט.**
- `packages/core/src/schemas/ws-messages.ts` — `ToolCallMessage` (שורה ~84). `locations?: "string[]"` (שורה 91) = ה-drift לתיקון; `kind` enum בקומנט = ACP 10 ערכים.
- `packages/frontend/src/lib/types/bubble.ts` — `ToolLocation = { path: string; line?: number }` (שורה 59). **כבר זהה ל-`ToolCallLocation` הקנוני.**
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — `#mapLocations` (795), `#onSessionUpdate` — ה-consumer שיעבור ל-`ProviderEvent` ב-P1b.
- **החוזה הקנוני v1.2** (reference): `provider-abstraction/docs/design/canonical-contract-proposal.md` §3 (ProviderEvent), §4 (capabilities), §5 (ProviderSession), decision 9 (locations).
- **מימוש reference (חלקי!)**: `claude-code-connection` (ב-cli-agents `~/projects/claude-code-connection`) `src/session/events.ts` — מגדיר רק `ToolKind`/`PermissionOption`/`ProviderEvent`/`ProviderCapabilities` (76 שורות; **ללא** `ToolCallLocation`/`ProviderSession`/`PromptContent`/`locations`). שמש כ-reference ל-shape הבסיסי, אבל **מקור-האמת המלא = חוזה v1.2** (הטיפוסים מובאים inline ב-§3). אל תסתמך על events.ts לטיפוסים החסרים.

---

## §1 — מטרה (P1a)
להגדיר ב-`packages/core` את שכבת ה-Provider הקנונית (v1.2) — `ProviderSession`, `ProviderEvent`, `ProviderCapabilities`, `ToolCallLocation`, `PromptContent` — + helpers למיפוי `ToolKind` (ACP→canonical) ו-`locations`, + תיקון ה-`locations` drift ב-`ws-messages`. **בלי** לגעת ב-adapters/flow (P1b/c).

---

## §2 — Scope (P1a)

| פיצ'ר | כן/לא | הערה |
|------|------|------|
| `packages/core/src/provider/` — `ProviderEvent`/`ProviderSession`/`ProviderCapabilities`/`ToolCallLocation`/`PromptContent` | ✅ | structural-compat ל-Contract v1.2; טיפוסים מלאים inline ב-§3 (מקור-אמת = החוזה, לא events.ts) |
| export דרך `core/src/index.ts` | ✅ | `export type * from "./provider"` |
| `classifyToolKind(acpKind)` — ACP 10 → canonical 7 (`delete`/`move`→`edit`/`other`, `switch_mode`→`other`) | ✅ | helper טהור + טסטים |
| תיקון `ws-messages` `locations`: `"string[]"` → `{ path: string; "line?": number }[]` | ✅ | drift קיים; מיישר ל-frontend `#mapLocations` **וגם** לקנוני |
| טסטי-יחידה ל-helpers + ל-schema המעודכן | ✅ | TDD |
| **כל נגיעה ב-`AcpTransport`/`acp/`/flow** | ❌ | P1b (ACP adapter) |
| **חיבור ClaudeCode** | ❌ | P1c |
| **שינוי `agent-session.svelte.ts`/frontend consumption** | ❌ | P1b (כשה-ProviderEvent מתחבר) |
| **`content: string → ToolContent[]`** | ❌ | P1b — תלוי ב-event flow |
| package משותף `@provider-contract` | ❌ | §9 #1 — שאלה פתוחה; P1a משכפל structural ל-core |

> קו אדום: P1a **טהור/additive** — types + helpers + תיקון schema. אין adapter, אין שינוי runtime, אין נגיעה ב-ACP client.

---

## §3 — ה-canonical types (מקור-אמת: חוזה v1.2)

> ⚠️ **מקור-האמת הוא חוזה v1.2** (`provider-abstraction/docs/design/canonical-contract-proposal.md` §3-5 + decision 9), **לא** `claude-code-connection/events.ts`. ה-events.ts ב-cli-agents הוא גרסה **חלקית** (76 שורות; חסרים בו `ToolCallLocation`/`ProviderSession`/`PromptContent`/`locations`) — הוא reference ל-shape של `ProviderEvent` הבסיסי בלבד. הטיפוסים המלאים מובאים כאן **inline** (brief self-contained):

ה-Provider types הם **interfaces/union טהורים** (TS) — לא arktype (arktype שמור ל-wire schemas). `packages/core/src/provider/events.ts`:

```ts
export type ToolKind = "read" | "edit" | "execute" | "search" | "fetch" | "think" | "other"
export interface ToolCallLocation { path: string; line?: number }            // decision 9
export interface PermissionOption { optionId: string; label: string; kind: string }
export type ToolContent =
  | { kind: "text"; text: string }
  | { kind: "diff"; path: string; oldText?: string; newText: string }
  | { kind: "terminal"; terminalId: string }
export interface Usage { inputTokens?: number; outputTokens?: number; [k: string]: unknown }
export interface PlanEntry { id?: string; title?: string; status?: string }   // §3 בחוזה — minimal

export type ProviderEvent =
  | { type: "session.ready"; sessionId: string; capabilities: ProviderCapabilities }
  | { type: "message.delta"; role: "assistant"; text: string }
  | { type: "thinking.delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown; kind: ToolKind;
      status: "pending" | "in_progress" | "completed" | "failed";
      locations?: ToolCallLocation[];          // v1.2 / decision 9
      content?: ToolContent[] }
  | { type: "permission.request"; toolCallId: string; toolName: string; input: unknown; options: PermissionOption[] }
  | { type: "task.update"; taskId: string; status: string; summary?: string }
  | { type: "plan.update"; entries: PlanEntry[] }
  | { type: "turn.end"; turnId: string; stopReason: string; isError: boolean }
  | { type: "turn.cancelled"; turnId: string }
  | { type: "status"; status: string }
  | { type: "usage"; usage: Usage }
  | { type: "log"; level: "debug" | "info" | "warn" | "error"; message: string }
  | { type: "error"; error: { code?: number; message: string } }
  | { type: "raw"; provider: string; frame: unknown }

export interface ProviderCapabilities {
  resume: boolean; list: boolean; delete: boolean; close: boolean
  permissions: boolean; images: boolean; tools: boolean
  diff: boolean; revert: boolean
  fs: boolean; terminal: boolean
  mcpExternal: boolean; mcpEmbedded: boolean
  extensions?: Record<string, Record<string, unknown>>     // decision 8
}
export interface ConsumerCapabilities {
  fs: boolean; terminal: boolean; permissions: boolean
  hostTools?: unknown[]
}

export type PromptContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
export type PromptContent = string | PromptContentPart[]
export interface PromptAck { turnId: string; status: "running" | "queued" }

export interface ProviderSession {
  readonly providerId: string
  readonly sessionId: string
  readonly capabilities: ProviderCapabilities
  start(consumer: ConsumerCapabilities): Promise<void>
  sendPrompt(content: PromptContent): Promise<PromptAck>
  cancel(turnId?: string): Promise<void>
  stop(): Promise<void>
  onEvent(handler: (e: ProviderEvent) => void): () => void
  // tier 2 — capability-gated (אופציונלי; נוכח רק כשמוצהר ב-capabilities)
  listSessions?(): Promise<unknown[]>
  resumeSession?(id: string): Promise<void>
  deleteSession?(id: string): Promise<void>
  respondToPermission?(toolCallId: string, optionId: string): Promise<void>
  sendRaw?(request: unknown): Promise<unknown>
}
```

> כל הטיפוסים נאמנים ל-§3/§4/§5 של החוזה v1.2. שמור על שמות/shape **זהים** — כך ב-P1c המימוש של claude-code-connection יהיה structural drop-in (גם אם events.ts שם עדיין חלקי — הוא יושלם בנפרד). סטייה מהחוזה → escalation (§7).

---

## §4 — Commits בסדר (P1a)

### Commit 0 — provider types (approach: none → typecheck)
- צור `packages/core/src/provider/events.ts` עם **כל** הטיפוסים מ-§3 (inline — מקור-אמת חוזה v1.2, לא events.ts של claude-code-connection).
- `core/src/index.ts`: הוסף `export type * from "./provider/events"` (אותו דפוס כמו `export type * from "./ports"`).
- **Verification**: `pnpm -F @drive-coding/core typecheck` → exit 0. (toolchain מאומת: **pnpm 10**.)

### Commit 1 — `classifyToolKind` helper + טסטים (approach: tdd)
- `packages/core/src/provider/tool-kind.ts`: `classifyToolKind(acpKind: string): ToolKind` — **`switch` מפורש** (לא index-into-map — תחת `noUncheckedIndexedAccess:true` מיפוי דרך map מחזיר `ToolKind|undefined`):
  ```ts
  export function classifyToolKind(acpKind: string): ToolKind {
    switch (acpKind) {
      case "read": return "read"
      case "edit": case "delete": case "move": return "edit"
      case "execute": return "execute"
      case "search": return "search"
      case "fetch": return "fetch"
      case "think": return "think"
      default: return "other"   // switch_mode, other, לא-מוכר
    }
  }
  ```
- טסטים ב-`packages/core/tests/provider/tool-kind.test.ts` (ה-repo משתמש ב-`tests/`, **לא** colocated): כל 10 ערכי ACP (`read/edit/delete/move/execute/search/fetch/think/switch_mode/other`) + לא-מוכר → כולם מחזירים `ToolKind` ודאי (לא undefined).
- **Verification**: `pnpm -F @drive-coding/core typecheck` + `pnpm test` (root — `vitest run`; ל-`@drive-coding/core` **אין** script `test`) → 0 fail.

### Commit 2 — תיקון `locations` drift ב-ws-messages (approach: tdd)
- `packages/core/src/schemas/ws-messages.ts`: `"locations?": "string[]"` → מערך-אובייקטים ב-arktype. **התבנית הנכונה ב-repo** היא `.array()` (ראה `AgentPublic.array()` ב-`agent.ts:103`) — אין דוגמת inline-object-array; השתמש ב:
  ```ts
  const ToolLocation = type({ path: "string", "line?": "number" })
  // בתוך ToolCallMessage:
  "locations?": ToolLocation.array(),
  ```
- עדכן את ה-comment (שורה ~77) "מערך של נתיבי קבצים" → "מערך `{ path, line? }`".
- טסט ב-`packages/core/tests/ws-messages.test.ts` (**קיים** — הרחב אותו): schema מקבל `[{path, line}]` ו-`[{path}]`, דוחה `["str"]`.
- **regression**: ודא ש-`#mapLocations` ב-frontend עדיין תואם (הוא כבר מצפה `{path, line?}` — DoD #5).
- **Verification**: `pnpm -F @drive-coding/core typecheck` + `pnpm build` + `pnpm test` → 0 fail.

---

## §5 — DoD verifiable (P1a)

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck נקי | `pnpm -F @drive-coding/core typecheck` → exit 0 |
| 2 | `provider/events.ts` מיוצא מ-`core` | `import type { ProviderEvent } from "@drive-coding/core"` עובד בטסט |
| 3 | טיפוסים structural-זהים ל-**חוזה v1.2** | השוואה מול §3 (inline) — אותם שמות שדות (**לא** מול events.ts החלקי) |
| 4 | `classifyToolKind` — כל 10 ACP + לא-מוכר | טסט מפורש |
| 5 | `ws-messages.locations` = `{path,line?}[]` ותואם `#mapLocations` | טסט schema + בדיקת ה-shape מול frontend |
| 6 | regression — כל הטסטים הקיימים של `core` עוברים | `pnpm test` (root — `vitest run`) → 0 fail |
| 7 | לא נגעו ב-`acp/`/`ports.ts`/frontend | `git diff --stat dev` רק: `provider/**`, `index.ts`, `schemas/ws-messages.ts`, `tests/**` |

---

## §6 — Risks + mitigations
| סיכון | מיטיגציה |
|------|----------|
| arktype תחביר למערך-אובייקטים שגוי | השתמש ב-`type({...}).array()` (תבנית `AgentPublic.array()` ב-`agent.ts:103`); **אין** inline-object-array ב-`ws-messages` |
| סטייה מ-shape הקנוני שוברת structural-compat ב-P1c | אמץ 1:1 מ-**§3 (חוזה v1.2, inline)**; כל סטייה → escalation |
| `Usage`/`PermissionOption`/`PromptContent` types חסרים | **מוגדרים inline ב-§3** (חלק מההפשטה) — אין תלות במקור חיצוני |
| תיקון `locations` schema שובר serialization בקיים | ה-frontend `#mapLocations` כבר מצפה אובייקטים → התיקון **מיישר**, לא שובר. DoD #5 |

---

## §7 — Escalation triggers
- צריך לגעת ב-`acp/`/`ports.ts`/frontend כדי ש-typecheck יעבור → scope creep (P1b).
- ה-shape הקנוני לא מתאים ל-arktype/toolchain של drive-coding → שאל לפני סטייה.
- מתעורר צורך ב-package משותף → §9 #1, החלטה אדריכלית, שאל.

---

## §8 — Complexity (P1a)
מרחיב (לא greenfield, אבל מודול חדש) +1 · types/pure -2 · TDD -1 · additive -1 · arktype schema + 2 helpers +2 · structural-fidelity לחוזה +1 = **~4/10 → `calev` (light)**.

---

## §9 — שאלות פתוחות
| # | שאלה | default | חוסם? |
|---|------|--------|------|
| 1 | איפה ה-canonical types חיים — package משותף `@provider-contract` או שכפול structural ב-`core`? | **שכפול structural ב-`core`** ל-P1a (כמו claude-code-connection שמגדיר משלו). package משותף = שיקול עתידי כש-3+ consumers | ❌ |
| 2 | `ToolKind` ACP `delete`/`move` → `edit` או `other`? | **`edit`** (שניהם מוטציות-קובץ); `switch_mode`→`other` | ❌ |
| 3 | האם להמיר `ws-messages` כולו ל-ProviderEvent עכשיו? | **לא** — P1a רק מתקן `locations`; המרת ה-flow היא P1b | ❌ |

---

## §10 — Roadmap (P1b / P1c — ייכתבו JIT אחרי P1a)

### P1b — ACP adapter (depends_on: [P1a])
- `AcpProviderSession implements ProviderSession` שעוטף את `createAcpClient`/`WsAcpTransport` הקיים.
- `mapAcpNotification(SessionNotification): ProviderEvent` — `tool_call`/`tool_call_update` → `tool_call` (collapse + `classifyToolKind` + `locations`), `agent_message_chunk`→`message.delta`, permission→`permission.request{options}`, וכו'.
- `AcpCapabilities` → `ProviderCapabilities`.
- עדכן `agent-session.svelte.ts` `#onSessionUpdate` לצרוך `ProviderEvent` במקום `SessionNotification`.
- **כאן** `content: string → ToolContent[]` נסגר.
- verifier: `calev-heavy` (complexity ~7, נוגע ב-frontend flow + regression UI).

### P1c — ClaudeCode adapter (depends_on: [P1a])
- חיבור `claude-code-connection` (ClaudeCodeACP) כ-`ProviderSession` נוסף — או דרך ACP (אם הוא חושף ACP) או ישירות stream-json דרך bridge.
- רישום ב-`CLI_SPECS`/`AgentRegistry` כך ש-drive-coding יכול לבחור provider=claude-code.
- structural-compat: claude-code-connection כבר פולט `ProviderEvent` תואם → אמור להיות "drop-in".
- verifier: `calev` (אם structural-compat מלא) או `calev-heavy`.

> סדר: P1a → (P1b ‖ P1c יכולים להישען על P1a במקביל ב-worktrees נפרדים). ה-value המלא (multi-provider) מגיע כששניהם מחוברים.
