# Slice P1 — normalized-events — תוכנית

> **תאריך**: 2026-06-08
> **סטטוס**: מאומת — מוכן ל-dispatch (אביגיל 2026-06-08: USABLE-AFTER-FIX → 4 תיקונים הוחלו: guard ל-toolCallId, מקרה-בדיקה ל-content מערך, הבהרת mapToolContent ב-risk-3, תיקון צורת fixtures)
> **עדכון 2026-06-08**: שם הטיפוס יושר ל-`ProviderEvent` (היה `SessionEvent`) בעקבות אימוץ שמות CodeNomad — ראה roadmap §G. ההחלטה אינה משנה את הלוגיקה שאביגיל אימתה.
> **Complexity**: 7/10 (verifier: heavy)
> **תלות / depends_on**: `[]` (base = `dev`)
> **מרדכי → אליעזר**. Brief זה עוקב אחר `docs/plans/README.md`.
> **חלק מ-roadmap**: `docs/plans/provider-abstraction-roadmap.md` (slice P1 מתוך P1–P4).

---

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/slice-provider-1-normalized-events -b slice-provider-1-normalized-events dev
cd .worktrees/slice-provider-1-normalized-events
pnpm install && pnpm hooks:install
```
- **Base**: `dev` (אין תלות בסליסים אחרים).

### Run / Test
- core tests: `pnpm --filter @drive-coding/core test`
- FE tests: `pnpm --filter @drive-coding/frontend test`
- typecheck (כל ה-workspace): `pnpm typecheck`
- lint: `pnpm lint && pnpm lint:i18n`
- (אופציונלי, לבדיקת fixtures ויזואלית) FE dev: `pnpm --filter @drive-coding/frontend dev` — Vite מדפיס port. BE לא נדרש לסליס הזה (כל הבדיקות הן core-unit + FE-unit + mock-fixture).

### Browser (רק ל-DoD ויזואלי אופציונלי)
- Chrome רגיל. נווט ל-`/chat?...` ואז טען fixture דרך הנתיב `mock:` (ראה DoD-7). אין צורך ב-CLI אמיתי או ב-OneCLI לסליס הזה.

### OneCLI agent
- **לא נדרש** לסליס הזה (אין קריאות TTS/STT/proxy; אין spawn של CLI אמיתי). הבדיקות רצות offline.

### Reading list
**must-read לפני קוד**:
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — מתודות `#onSessionUpdate` (582), `#handleToolCall` (631), `#handleToolCallUpdate` (669), `#mapToolContent` (490), `#mapLocations` (530), `#appendChunk` (708), `#loadMockSession` (~544). **אלה הקוד שעובר/נמחק.**
- `packages/frontend/src/lib/types/bubble.ts` — `ToolContent*` (53–57), `ToolLocation` (59), `ToolCall` (61–77).
- `packages/frontend/src/lib/view-models/agent-session.test.ts` — **עוגן ה-regression** (ראה §6 risk-1).
- `packages/core/src/acp/client.ts:71-73` — חתימת `createAcpClient(transport, onUpdate, options)`; `onUpdate: (n: SessionNotification) => void`.
- `docs/plans/provider-abstraction-roadmap.md` §B — מודל היעד.

**reference בזמן עבודה**:
- `packages/frontend/AGENTS.md` §"Parallel-safe additive design" + כלל זהב #5 (אין backward-compat-in-place).
- `docs/conventions/parallel-safe-code.md` — `agent-session.svelte.ts` הוא קובץ משותף; שינוי `$state` types = INVASIVE (מאושר מראש ב-brief זה).
- `packages/core/package.json` — מפת `exports` (צריך עדכון, commit 0).

---

## §1 — מטרה

`agent-session` יפסיק לפרק את צורת ה-`SessionNotification` של ACP ישירות, ויצרוך
במקום זאת **מודל אירועים מנורמל ואגנוסטי-לפרוטוקול** (`ProviderEvent`) שמגיע ממודול
מיפוי טהור ב-core. אחרי הסליס: כל לוגיקת פירוק ה-ACP של נתיב ה-streaming
(הודעות + thoughts + tool calls) חיה במקום אחד טהור ו-TDD-able (`core/acp/acp-mapper.ts`),
ו-`agent-session.svelte.ts` כבר לא מייבא את `SessionNotification`. **אין שום שינוי
בהתנהגות הנראית למשתמש** — אותן בועות, אותו streaming, אותו mock-fixture flow.
זהו ה-slice היסודי שעליו נבנה ה-`ProviderSession` interface (P2) והספקים הלא-ACP (P3+).

---

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|-------|-------|-----|
| נרמול נתיב streaming (message/thought/user chunk + tool_call/update) | ✅ | הסליס הזה |
| נרמול **session config** (`SessionConfigOption`/`SessionModeState`/`SessionModelState`) | ❌ | **P2** — דורש כתיבה-מחדש של `SessionOptionsPanel.svelte`. `agent-session` ימשיך לייבא את 3 הטיפוסים האלה מ-ACP SDK בסוף הסליס הזה. |
| `ProviderSession` interface / `createProvider` / שדה `type` | ❌ | **P2** |
| מימוש ספק לא-ACP | ❌ | **P3+** |
| שינוי ב-`createAcpClient` עצמו (חתימה/לוגיקה) | ❌ | P2 (שם הוא ייעטף ב-`createAcpProvider`). בסליס הזה הוא נשאר **זהה לחלוטין**. |
| שינוי ב-`ports.ts` (re-export של `SessionNotification`/`PromptResponse`) | ❌ | שריד Slice 4, לא בשימוש ב-FE flow. לא נוגעים. |
| שינוי ב-BE | ❌ | ה-BE אגנוסטי; לא נוגעים. |
| הרחבת `ProviderEvent` ל-plan/available_commands וכו' | ❌ | לפי הצורך ב-P3. מנרמלים רק מה ש-`#onSessionUpdate` מטפל בו היום. |

> **הגנת scope**: נטייה טבעית תהיה "בזמן שאני פה, אנרמל גם את ה-config" — **אסור**.
> ה-config דורש panel-rewrite והוא P2. נגיעה בו = הרחבת scope.

---

## §3 — Architecture diagram

```
core (טהור, ללא IO)                                  frontend (5 שכבות)
────────────────────────────────                     ─────────────────────────────
protocol/events.ts            ← חדש                  view-models/
  ProviderEvent (union)                                 agent-session.svelte.ts   ← משתנה
  ToolContent, ToolLocation (הוזזו לכאן)                 #onProviderEvent(e)  ← חדש (צורך ProviderEvent)
  ToolStatus                                            (מוחק #onSessionUpdate/#handleToolCall/
acp/acp-mapper.ts             ← חדש                       #handleToolCallUpdate/#mapToolContent/#mapLocations)
  mapAcpNotification(n): ProviderEvent | null           types/bubble.ts          ← משתנה
  (לוגיקת הפירוק שהייתה ב-#onSessionUpdate)               ToolContent/ToolLocation → re-export מ-core
acp/acp-mapper.test.ts        ← חדש (TDD)
acp/client.ts                  ← לא נוגעים             util/tool-format.ts       ← לא משתנה
                                                        (מייבא מ-$lib/types/bubble; ה-re-export שקוף)
package.json exports           ← מוסיפים "./protocol/*"
```

זרימה אחרי הסליס:
```
createAcpClient(transport, onUpdate) → onUpdate(SessionNotification)
  → mapAcpNotification(n) : ProviderEvent | null
  → AgentSession.#onProviderEvent(ProviderEvent) → bubbles[]   (ללא ידע על ACP)
```

---

## §4 — Commits בסדר

### Commit 0 — core: ProviderEvent + acp-mapper + TDD (approach: **TDD**)

**קבצים חדשים**:
- `packages/core/src/protocol/events.ts`
- `packages/core/src/acp/acp-mapper.ts`
- `packages/core/src/acp/acp-mapper.test.ts`

**קבצים שמשתנים**:
- `packages/core/package.json` — הוסף ל-`exports`: `"./protocol/*": "./src/protocol/*.ts"` (אחרי `"./acp/*"`). בלי זה ה-FE לא יוכל לייבא `@drive-coding/core/protocol/events`.
- `packages/core/src/index.ts` — הוסף `export * from "./protocol/events"` (שורה חדשה, אלפבתי ליד השאר).

**API skeleton** (`protocol/events.ts`):
```ts
export type ToolStatus = "pending" | "in_progress" | "completed" | "failed"

export type ToolContentText = { type: "text"; text: string }
export type ToolContentDiff = { type: "diff"; path: string; oldText?: string; newText: string }
export type ToolContentTerminal = { type: "terminal"; terminalId: string }
export type ToolContentOther = { type: "other"; raw: unknown }
export type ToolContent = ToolContentText | ToolContentDiff | ToolContentTerminal | ToolContentOther

export type ToolLocation = { path: string; line?: number }

export type ProviderEvent =
  | { kind: "message_chunk"; role: "assistant" | "thought" | "user"; text: string; messageId: string | null }
  | {
      kind: "tool_call"
      toolCallId: string
      title?: string
      toolKind?: string                 // = ACP `kind`
      rawInput?: unknown
      rawOutput?: unknown
      status?: ToolStatus
      content?: ToolContent[]
      locations?: ToolLocation[]
    }
  | {
      kind: "tool_call_update"
      toolCallId: string
      title?: string
      toolKind?: string
      rawInput?: unknown
      rawOutput?: unknown
      status?: ToolStatus
      // null = "נמחק במפורש ע"י העדכון"; undefined = "לא נכלל בעדכון" (משמר את ההבחנה הקיימת)
      content?: ToolContent[] | null
      locations?: ToolLocation[] | null
    }
```

**API skeleton** (`acp/acp-mapper.ts`):
```ts
import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { ProviderEvent, ToolContent, ToolLocation } from "../protocol/events.js"

/**
 * ממיר SessionNotification של ACP לאירוע מנורמל יחיד, או null אם אין מה לפלוט
 * (chunk טקסט ריק — תואם ל-`if (!text) return` הקיים).
 * זוהי לוגיקת הפירוק שהייתה ב-AgentSession.#onSessionUpdate (dev:582-628).
 */
export function mapAcpNotification(n: SessionNotification): ProviderEvent | null

// פנימיים (יכולים להיות מיוצאים לבדיקה ישירה אם נוח):
// mapToolContent(raw: unknown): ToolContent[]   ← היה AgentSession.#mapToolContent (490)
// mapLocations(raw: unknown): ToolLocation[]     ← היה AgentSession.#mapLocations (530)
```

**לוגיקת מיפוי — חובה לשמר 1:1 מ-`#onSessionUpdate`** (dev:582-628):
0. **guard `toolCallId` (תיקון אביגיל #1)**: עבור `tool_call` ו-`tool_call_update`, אם `update.toolCallId === undefined` → `return null`. זהו ה-`if (update.toolCallId === undefined) return` שקיים היום בתחילת `#handleToolCall` (dev:641) ו-`#handleToolCallUpdate` (dev:679). ה-guard **עובר ל-mapper** (שדה `toolCallId: string` באירוע הוא חובה — לא אופציונלי), ולכן ה-VM ב-`#onProviderEvent` כבר מקבל `toolCallId` ודאי ולא צריך לבדוק שוב.
1. `update.sessionUpdate === "tool_call"` → `{ kind: "tool_call", toolCallId, ... }`. `content`/`locations`: **אם `update.content/locations != null`** → `mapToolContent(update.content)` / `mapLocations(update.locations)` (כמו dev:660-661); **אחרת** השמט את השדה (`undefined`).
2. `update.sessionUpdate === "tool_call_update"` → `{ kind: "tool_call_update", toolCallId, ... }`. עבור `content` (ואותו דין ל-`locations`) — **שלושה מצבים** (תיקון אביגיל #3, תואם dev:695-701):
   - שדה **לא קיים** ב-update (`update.content === undefined`) → השמט מהאירוע (`undefined` = "לא עודכן").
   - שדה הוא **מערך** (`Array.isArray`) → `content: mapToolContent(update.content)` (זהו המסלול הדומיננטי בפועל — ראה risk-3 + מקרה-בדיקה).
   - שדה הוא **`null`** → `content: null` (= "נמחק במפורש"; ה-VM ימיר ל-`undefined` בבועה).
3. אחרת (chunk): `text = update.content?.type === "text" ? (update.content.text ?? "") : ""`. אם `!text` → `return null`.
4. `messageId = update.messageId ?? null`.
5. `agent_message_chunk` → `{ kind:"message_chunk", role:"assistant", text, messageId }`; `agent_thought_chunk` → `role:"thought"`; `user_message_chunk` → `role:"user"`. כל ערך `sessionUpdate` אחר עם טקסט → `return null` (תואם להתנהגות הקיימת — רק 3 ה-chunk נצרכים).

> **לתשומת לב**: ה-mapper מפיק אירוע **נאמן** (toolKind/title/status/rawInput as-is, אופציונליים).
> ברירות-המחדל של ה-bubble (`name = kind ?? title ?? "tool"`, `args = rawInput ?? {}`,
> `status = status ?? "pending"`) **נשארות ב-VM** (commit 2), הן UI-concern לא protocol-concern.

**Verification**:
```bash
pnpm --filter @drive-coding/core test          # acp-mapper.test.ts ירוק
pnpm --filter @drive-coding/core typecheck
```

**מקרי-בדיקה ל-`acp-mapper.test.ts`** (מינימום):
- message_chunk assistant/thought/user — text + messageId נשמרים; role נכון.
- chunk עם content לא-text → `null`. chunk עם text ריק → `null`.
- sessionUpdate לא מוכר עם content.text → `null`.
- tool_call עם content מעורב (text/diff/terminal/לא-מוכר) → ToolContent[] נכון (כולל `{type:"other",raw}`).
- tool_call ללא content/locations → השדות `undefined` באירוע.
- **tool_call ללא `toolCallId` → `null`** (guard, תיקון אביגיל #1). אותו דבר ל-tool_call_update.
- **tool_call_update עם `content` = מערך לא-ריק → `content` ממופה דרך mapToolContent (המסלול הדומיננטי של `tool-spill.json`)** (תיקון אביגיל #2). כלול גם diff/terminal בתוך המערך.
- tool_call_update עם `content: null` → `content === null` באירוע (לא undefined). עם `content` חסר → השדה `undefined`/מושמט.
- mapLocations: פריט עם `path` (±`line`) נכלל; ללא `path` מסונן.

---

### Commit 1 — FE: bubble.ts צורך ToolContent/ToolLocation מ-core (approach: **manual**)

**קבצים שמשתנים**:
- `packages/frontend/src/lib/types/bubble.ts` — מחק את ההגדרות המקומיות של
  `ToolContentText/Diff/Terminal/Other`, `ToolContent`, `ToolLocation` (53–59), והחלף ב:
  ```ts
  export type {
    ToolContent, ToolContentText, ToolContentDiff, ToolContentTerminal, ToolContentOther, ToolLocation,
  } from "@drive-coding/core/protocol/events"
  ```
  `ToolCall` (61–77) ממשיך להשתמש ב-`ToolContent[]`/`ToolLocation[]` — עכשיו מ-core, שקוף.

**למה זה לא backward-compat-in-place (כלל זהב #5)**: זו החלפה מלאה של מקור-האמת
(הגדרה מקומית → re-export), לא הוספת מסלול שני. צרכנים (`tool-format.ts`,
`agent-session.svelte.ts`) ממשיכים לייבא מ-`$lib/types/bubble` ללא שינוי — ה-re-export שקוף.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck   # אין שגיאות — השמות זהים, הצורה זהה
```

---

### Commit 2 — FE: agent-session צורך ProviderEvent (approach: **manual + regression**)

**קבצים שמשתנים**: `packages/frontend/src/lib/view-models/agent-session.svelte.ts`

**מה יורד**:
- ייבוא `SessionNotification` משורה 13 (נשאר רק `SessionConfigOption`, `SessionModeState`, `SessionModelState` — config, P2).
- המתודות: `#onSessionUpdate` (582), `#handleToolCall` (631), `#handleToolCallUpdate` (669), `#mapToolContent` (490), `#mapLocations` (530) — **נמחקות**.

**מה נוסף**:
- ייבוא: `import { mapAcpNotification } from "@drive-coding/core/acp/acp-mapper"` ו-`import type { ProviderEvent } from "@drive-coding/core/protocol/events"`.
- מתודה פרטית `#onProviderEvent = (e: ProviderEvent): void => { ... }` (ב-`// ─── פרטי ───`):
  - `e.kind === "message_chunk"` → `this.#appendChunk(roleToKind(e.role), e.text, e.messageId)` כאשר `role:"assistant"→"message"`, `"thought"→"thought"`, `"user"→"user"`.
  - `e.kind === "tool_call"` → בנה `ToolBubble` (כמו 631-666 היום), עם ברירות-המחדל של ה-bubble נשמרות כאן: `name: e.toolKind ?? e.title ?? "tool"`, `kind: e.toolKind`, `args: e.rawInput ?? {}`, `status: e.status ?? "pending"`, `title: e.title`, `result: e.rawOutput`, `content: e.content`, `locations: e.locations`. push + `#toolBubbleByCallId.set`.
  - `e.kind === "tool_call_update"` → אותו merge כמו 669-705 היום, על בסיס שדות האירוע (כולל הבחנת `content===null → undefined` בבועה).
- **boundary adapter** (callback ל-createAcpClient): במקום `this.#onSessionUpdate`, העבר
  ```ts
  this.#client = await createAcpClient(transport, (n) => {
    const e = mapAcpNotification(n)
    if (e) this.#onProviderEvent(e)
  })
  ```
  בשני האתרים (dev:138 ו-dev:252). `n` מקבל את טיפוסו מחתימת `createAcpClient` (אין צורך לייבא `SessionNotification`).
- **mock path** (`#loadMockSession`, dev:564): החלף `this.#onSessionUpdate({ update } as ... SessionNotification)` ב:
  ```ts
  const e = mapAcpNotification({ update } as Parameters<typeof mapAcpNotification>[0])
  if (e) this.#onProviderEvent(e)
  ```

**מה נשאר ללא שינוי**: `#appendChunk` (708), `#captureSessionConfig` (462 — config, P2), `configOptions/models/modes` state (78-82), `applyConfigOption` (363), `#toolBubbleByCallId`, כל ה-lifecycle (attach/loadSession/detach/sendPrompt).

**Verification**:
```bash
pnpm --filter @drive-coding/frontend test       # agent-session.test.ts ירוק ללא שינוי בו
pnpm --filter @drive-coding/frontend typecheck
pnpm typecheck                                   # workspace שלם
pnpm lint && pnpm lint:i18n
grep -n "SessionNotification" packages/frontend/src/lib/view-models/agent-session.svelte.ts || echo "OK: no SessionNotification"
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|-------|-----|
| 1 | `acp-mapper.test.ts` ירוק (כל מקרי §4 commit 0) | `pnpm --filter @drive-coding/core test` |
| 2 | `agent-session.test.ts` ירוק **בלי שינוי בקובץ הטסט** | `pnpm --filter @drive-coding/frontend test` + `git diff --stat` מראה שהטסט לא נגוע |
| 3 | typecheck נקי בכל ה-workspace | `pnpm typecheck` |
| 4 | lint + i18n נקיים | `pnpm lint && pnpm lint:i18n` |
| 5 | `agent-session.svelte.ts` לא מייבא `SessionNotification` | `grep -n "SessionNotification" packages/frontend/src/lib/view-models/agent-session.svelte.ts` → ריק |
| 6 | המתודות הישנות נמחקו | `grep -nE "#onSessionUpdate\|#handleToolCall\|#mapToolContent\|#mapLocations" packages/frontend/src/lib/view-models/agent-session.svelte.ts` → ריק |
| 7 | mock-fixture עדיין מרנדר זהה | FE dev → טען fixture `tool-spill` (tool calls) ו-`greeting` (text) דרך נתיב `mock:`; השווה ל-`dev` לפני: אותן בועות, אותו tool rendering. (הערה: ה-fixtures בצורת `{ loadResult?, updates:[...] }` — `#loadMockSession` קורא רק את `data.updates`, אז אין השפעה.) |
| 8 | `SessionConfigOption`/`SessionModeState`/`SessionModelState` עדיין מיובאים (config לא נגענו) | `grep -n "SessionConfigOption" packages/frontend/src/lib/view-models/agent-session.svelte.ts` → קיים |

---

## §6 — Risks + mitigations

| # | סיכון | מקור | מיטיגציה |
|---|-------|------|----------|
| 1 | שבירת `agent-session.test.ts` — הוא תופס את ה-callback שמועבר ל-`createAcpClient` (mocked) ומריץ אותו עם `SessionNotification` סינתטיים | קריאת הטסט (dev:20-33) | הטסט **לא** מ-mock-ים את `acp-mapper` → ה-mapper האמיתי רץ. ה-callback החדש (`n → mapAcpNotification → #onProviderEvent`) שקוף לטסט. **אסור** להוסיף `vi.mock("@drive-coding/core/acp/acp-mapper")`. אם הטסט נשבר — סימן שהמיפוי לא 1:1; תקן את ה-mapper, לא את הטסט. |
| 2 | Svelte 5 reactivity על `bubbles` array | learnings (README §6) | לא משנים את אופן ה-push/replace הקיים — `#onProviderEvent` משכפל בדיוק את ה-push וה-`this.bubbles[idx] = {...}` של ה-handlers הישנים. |
| 3 | אובדן הבחנת `null` / מערך / חסר ב-`content`/`locations` ב-tool_call_update | dev:695-701 — שלושה מצבים שונים, ראה §4 commit 0 כלל 2 | ב-`ProviderEvent` שמר `content?: ToolContent[] \| null`. ה-mapper: **מערך → `mapToolContent(...)`** (המסלול הדומיננטי, לא רק "type only"!); **`null` → `null`** (לא משמיט); **חסר → מושמט**. ה-VM ב-`#onProviderEvent` ממיר `null → undefined` בבועה בדיוק כמו dev:697,700 היום. כוסה ב-2 מקרי-בדיקה ייעודיים (commit 0). |
| 4 | i18n hook חוסם commit אם נכנסה מחרוזת עברית בקוד | learnings | אין מחרוזות UI חדשות בסליס; ה-`console.warn` הקיים (dev:409) לא נגענו בו. הרץ `pnpm lint:i18n` לפני commit. |
| 5 | קובץ משותף `agent-session.svelte.ts` — שינוי `$state` types | `parallel-safe-code.md` | בסליס הזה **לא** משנים שום `$state` (bubbles נשאר `Bubble[]`, config נשאר ACP types). רק מתודות פרטיות נמחקות/נוספות = ADDITIVE/refactor פנימי. אין צורך לתאם מעבר ל-brief זה. |
| 6 | `import.meta.env.DEV` במסלול mock — `mapAcpNotification` חייב להיתמך גם ב-build prod (tree-shake לא יסיר את ה-mapper כי הוא בשימוש גם ב-callback החי) | dev:545 | ה-mapper בשימוש בשני המסלולים (חי + mock), אז הוא תמיד נכלל. אין בעיית tree-shaking. |

---

## §7 — Escalation triggers

עצור ושאל את מרדכי ב-parent task אם:
- המיפוי 1:1 לא אפשרי — `SessionNotification` של ACP חושף שדה שה-`#onSessionUpdate` הקיים מטפל בו ולא תיעדתי כאן (השווה מול dev:582-705 שורה-שורה לפני שמחליטים).
- `agent-session.test.ts` נשבר ואתה לא בטוח אם זו רגרסיה אמיתית או שהטסט עצמו צריך עדכון (לפי DoD-2 הוא **לא** אמור להשתנות — שבירה = bug ב-mapper).
- typecheck נכשל על `bubble.ts` re-export (commit 1) באופן שמרמז שצריך להזיז יותר טיפוסים מ-`bubble.ts` ל-core (למשל `ToolCall` עצמו) — זו החלטת scope.
- מתגלה שמשהו מחוץ ל-`agent-session` קורא ל-`#onSessionUpdate`/`#handleToolCall` וכו' (לא אמור — הם פרטיים).

---

## §8 — Complexity score + verifier

- commits: 3 (סביר)
- שכבות חדשות: 1 (`core/protocol/`)
- APIs חיצוניים: 0
- streaming/async refactor: +1 (נתיב streaming קיים)
- refactor של state-model consumption (נתיב bubbles): +2
- שינוי protocol BE↔FE: 0

**ציון: 7/10 → verifier: heavy (calev-heavy).** הסיבה ל-heavy אף שזה refactor אפס-שינוי-התנהגות:
האימות הוא **regression-hunting** על נתיב streaming + tool + mock + test בו-זמנית —
עבודת הסקה שמתאימה ל-Opus. כלב-heavy יוודא שאין דליפת התנהגות (בועות, tool rendering, grouping).
שקול גם `calev mode: phase` אחרי commit 0 (ה-mapper הוא הליבה — אם הוא לא 1:1, כל השאר נופל).

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל מוצעת | חוסם? |
|---|------|------------------|-------|
| 1 | האם להזיז גם `ToolCall` (bubble.ts:61) ל-core/protocol יחד עם ToolContent? | **לא** — `ToolCall` הוא טיפוס bubble (UI: `narration`, `name`), לא protocol-pure. נשאר ב-bubble.ts. | ❌ |
| 2 | האם לייצא `mapToolContent`/`mapLocations` כפונקציות ציבוריות מ-`acp-mapper.ts` או להשאירן פנימיות? | ייצא (מקל על בדיקה ישירה + שימוש חוזר ב-P3). לא חוסם — בחירת אליעזר. | ❌ |
| 3 | שם המודול: `core/protocol/events.ts` מול `core/protocol/session-event.ts`? | `events.ts` (קצר; ה-namespace `protocol/` כבר מבהיר). | ❌ |
| 4 | האם `acp-mapper.ts` תחת `core/acp/` (ליד client) או `core/protocol/`? | `core/acp/` — הוא ACP-specific (מייבא `SessionNotification`). `protocol/` שמור לאגנוסטי. | ❌ |
