---
project: "drive-coding"
slice: "slice-P1b-acp-adapter"
verifier: "avigail"
date: "2026-06-13"
verdict: "USABLE-AFTER-FIX"
findings:
  - id: 1
    severity: "blocker"
    category: "missing-dependency"
    summary: "Base claims 'dev HEAD after P1a merge' but P1a is NOT merged to dev; provider/ types live only in the P1a worktree"
    source_brief: "§0 line 5 (Base) / line 7 (depends_on)"
    source_code: "dev: packages/core/src/provider/ does not exist; types in .worktrees/slice-P1a-provider-abstraction/packages/core/src/provider/"
    cost_estimate: "blocked until P1a merges or base re-pointed"
  - id: 2
    severity: "regression"
    category: "dropped-branch"
    summary: "Fixtures hold bare update objects, not SessionNotification; mapAcpNotification does n.update so every event maps to raw unless wrapped as {update}"
    source_brief: "§4 Commit 1 line 108"
    source_code: "agent-session.svelte.ts:929 wraps {update}; static/fixtures/greeting.json updates[0] keys = sessionUpdate,messageId,content"
    cost_estimate: "20-40min silent test wrongness"
  - id: 3
    severity: "type-error"
    category: "type-error"
    summary: "turn.end ProviderEvent requires isError:boolean (events.ts:59) but §3 design emits turn.end{turnId,stopReason} only"
    source_brief: "§3 AcpProviderSession comment (sendPrompt) / §9 #2"
    source_code: ".worktrees/slice-P1a-provider-abstraction/packages/core/src/provider/events.ts:59"
    cost_estimate: "5-10min typecheck fail"
  - id: 4
    severity: "confusion"
    category: "naming-inconsistency"
    summary: "mapAcpCapabilities source ambiguous: ports.ts AcpCapabilities is only {loadSession}, but AcpClient.capabilities is the SDK agentCapabilities (different type)"
    source_brief: "§0 reading list line 23 / §2 / §3 / Commit 3"
    source_code: "packages/core/src/ports.ts:70 vs packages/core/src/acp/client.ts:42,132"
    cost_estimate: "10-20min wrong-type mapping"
  - id: 5
    severity: "confusion"
    category: "dropped-branch"
    summary: "Fixtures emit available_commands_update and usage_update variants not in §3/§5 enumeration; they fall to default->raw (semantically ok) but DoD #2 list is incomplete"
    source_brief: "§3 switch / §5 DoD #2"
    source_code: "static/fixtures/tool-spill.json variants set"
    cost_estimate: "5-10min test-expectation confusion"
  - id: 6
    severity: "minor"
    category: "type-error"
    summary: "verbatimModuleSyntax:true requires split imports — import type for SessionNotification/ProviderEvent, value import for classifyToolKind; pseudo-code omits imports"
    source_brief: "§3 / §4 Commit 0-1"
    source_code: "tsconfig.base.json:10"
    cost_estimate: "5min"
  - id: 7
    severity: "minor"
    category: "type-error"
    summary: "ACP u.status is optional; P1a tool_call.status is required — mapStatus must default undefined->pending or typecheck fails"
    source_brief: "§3 mapStatus(u.status)"
    source_code: "events.ts:46 (required) vs agent-session.svelte.ts:1021 (?? pending)"
    cost_estimate: "5min"
---

# Plan Verification — slice-P1b-acp-adapter

> **Brief**: docs/plans/slice-P1b-acp-adapter.md
> **Base tip (dev)**: e25912c — "docs(plans): P1a — brief... (plan-verified READY)" (P1a brief only, code NOT merged)
> **P1a worktree tip**: .worktrees/slice-P1a-provider-abstraction (provider/events.ts + tool-kind.ts present)
> **Verdict**: 🟡 USABLE-AFTER-FIX
> **אומדן זמן confusion אם לא תוקן**: ~45-90 דק' (בעיקר #1 חוסם הרצה, ו-#2 silent test wrongness)

## בעיות שנמצאו

### 🔴 Blocker / Regression risk

| # | בעיה | מקור (brief / קוד) | עלות אם לא תוקן |
|---|------|---------------------|------------------|
| 1 | **Base מטעה**: §0 שורה 5 כותב "Base: dev HEAD (אחרי merge של P1a)". בפועל P1a **לא merged** — `dev/packages/core/src/provider/` **לא קיים**. הטיפוסים (`ProviderEvent`/`ProviderSession`/`ToolCallLocation`/`classifyToolKind`) קיימים רק ב-worktree של P1a. `depends_on:[P1a]` נכון, אבל ה-base בפועל לא מספק את התלות. | brief §0:5,7 / `dev`: provider/ חסר; worktree `.worktrees/slice-P1a-provider-abstraction/packages/core/src/provider/` | אליעזר נחסם ב-Commit 0 — אין מה לייבא. צריך לחכות ל-merge של P1a או לבסס את ה-slice על branch של P1a. |
| 2 | **fixtures אינם SessionNotification**: Commit 1 (שורה 108) אומר "חלץ `SessionNotification` אמיתיים מ-fixtures". בפועל כל איבר ב-`updates[]` הוא אובייקט **update גולמי** (`{sessionUpdate, messageId, content,...}`), **לא** `{sessionId, update}`. `mapAcpNotification(n)` עושה `n.update` → אם מעבירים איבר fixture ישירות, `n.update===undefined` → **כל** ה-events נופלים ל-`default → raw`. הקוד הקיים (`#loadMockSession:929`) עוטף ב-`{ update: elem }` לפני ההזרמה — אליעזר חייב לעשות אותו דבר. | brief §4 Commit 1:108 / `agent-session.svelte.ts:929`; `static/fixtures/greeting.json` updates[0] keys=`sessionUpdate,messageId,content` | טסטים "עוברים" אבל ממפים הכל ל-raw — silent wrongness, 20-40 דק' debug. |

### 🟡 Confusion / Type error

| # | בעיה | מקור | הצעה |
|---|------|------|------|
| 3 | **turn.end חסר isError**: `ProviderEvent` של `turn.end` דורש `isError: boolean` (events.ts:59). §3 (הערת sendPrompt) ו-§9 #2 פולטים `turn.end{turnId, stopReason}` בלבד — **חסר `isError`**. typecheck ייכשל. | brief §3 / §9 #2 / `events.ts:59` | מרדכי: הוסף `isError` (גזור מ-`stopReason`). |
| 4 | **mapAcpCapabilities — מקור מעורפל**: §0:23 מפנה ל-`ports.ts AcpCapabilities` כמקור. אבל `ports.ts AcpCapabilities` הוא **רק** `{ loadSession: boolean }` (אין `listSessions`/permissions/tools). וה-`AcpProviderSession` עוטף `AcpClient`, ש-`.capabilities` שלו הוא ה-SDK `agentCapabilities` (טיפוס **אחר** לגמרי, client.ts:42,132). §2 מבטיח "resume/list מ-ACP caps; permissions/tools true" — לא ברור מאיזה משני הטיפוסים. | brief §0:23/§2/§3/Commit 3 / `ports.ts:70`, `client.ts:42,132` | מרדכי: קבע מפורשות — `mapAcpCapabilities(agentCapabilities)` (SDK) ולא `ports.ts AcpCapabilities`. |
| 5 | **variants נוספים ב-fixtures**: ה-fixtures מכילים `available_commands_update` ו-`usage_update` (לא ב-§3 switch ולא ב-DoD #2). הם נופלים ל-`default → raw` (תקין סמנטית), אבל DoD #2 מונה רשימה סגורה — אליעזר עלול לחשוב שהטסט "שגוי" כשרואה raw. | brief §3/§5:122 / `static/fixtures/tool-spill.json` | מרדכי: הוסף ל-DoD ש-`available_commands_update`/`usage_update` → raw (ולא מתעלמים). |

### 🟢 Minor

| # | בעיה | מקור |
|---|------|------|
| 6 | `verbatimModuleSyntax:true` (tsconfig.base.json:10) — ייבוא ב-`map-acp-notification.ts` חייב `import type` ל-`SessionNotification`/`ProviderEvent` אבל `import` רגיל ל-`classifyToolKind` (value). ה-pseudo-code לא מראה imports. | tsconfig.base.json:10 |
| 7 | `mapStatus`: ACP `u.status` אופציונלי; P1a `tool_call.status` חובה (events.ts:46). `mapStatus` חייב לדרוס undefined→"pending" (כמו frontend `?? "pending"`, שורה 1021), אחרת typecheck. | brief §3 / events.ts:46 |

## Spot-check שעבר (לא מצא בעיה)

- ✅ **AcpClient surface** (`client.ts:40-69`) — `newSession`/`loadSession`/`listSessions`/`prompt(sessionId,text)`/`cancel(sessionId)`/`close()` קיימים. `createAcpClient(transport, onUpdate, options)` חתימה תואמת (אסינכרוני, מחזיר `Promise<AcpClient>`). [claim 1]
- ✅ **#onSessionUpdate variants** (`agent-session.svelte.ts:947-992`) — בדיוק 5 ה-variants ש-P1b ממפה: `tool_call`,`tool_call_update`,`agent_message_chunk`,`agent_thought_chunk`,`user_message_chunk`. אין variant מטופל נוסף; השאר → אין else (נופל). תואם default→raw. [claim 2] (ראה #5 לגבי variants שב-fixtures אך לא מטופלים)
- ✅ **client.prompt await-blocking** (`agent-session.svelte.ts:493`) — `await this.#client.prompt(this.#sessionId, text)` חוסם עד סוף ה-turn. מצדיק את design §3 (sendPrompt non-blocking). [claim 3]
- ✅ **requestPermission auto** (`client-impl.ts:21`) — מחזיר `allow_once` אוטומטית, בלי UI. [claim 4]
- ✅ **transport-mock.ts** (`acp/transport-mock.ts`) — `MockAcpTransport implements AcpTransport` קיים עם `emitFrame`/`sentFrames`/`simulateClose`. הערה: פועל ברמת **frame** (NDJSON), לא ברמת notification — טסט של AcpProviderSession חייב לפלוט קודם תגובת `initialize` כי `createAcpClient` ממתין לה. [claim 5]
- ✅ **fixtures קיימים** (`packages/frontend/static/fixtures/*.json`: greeting, tool-spill, mitm, phone-tunnel, salary-attendance, salary-prev). [claim 6 — קיימים, אך צורה לא תואמת — ראה #2]
- ✅ **classifyToolKind לא מיוצא** (worktree `core/index.ts`) — `export type * from "./provider/events"` בלבד; **אין** ייצוא ל-`provider/tool-kind`, ו-`classifyToolKind` הוא value (לא נתפס ב-`export type *`). מצדיק Commit 0. [claim 7]
- ✅ **AcpCapabilities shape** (`ports.ts:70`) — `{ loadSession: boolean }` בלבד. (תרם ל-#4) [claim 8]
- ✅ **scope core-only** — P1b נשאר core (provider+acp+טסטים), לא נוגע ב-frontend. `depends_on:[P1a]` נכון. אין `state.json` בפרויקט; התלות מוצהרת inline ב-front-matter (תקין). [claim 9]
- ✅ `exactOptionalPropertyTypes` **לא** מוגדר → push של `line: undefined` ל-`ToolCallLocation.line?` תקין (לא בעיה).

## Verdict

🟡 **USABLE-AFTER-FIX** — אין בעיה מבנית ב-brief עצמו; ה-mapping תואם את ה-codebase. אבל:
- #1 (base/dependency) הוא חוסם **תהליכי**: אסור ל-dispatch לאליעזר עד ש-P1a merged ל-dev (או עד שה-base מצביע ל-branch של P1a). זה תיקון של מרדכי/דוד, לא של אליעזר.
- #2 (fixtures shape) — תיקון ניסוח קטן ב-Commit 1 (לעטוף `{update}`), אבל קריטי כי הוא silent.
- #3,#4,#5 — ~15-20 דק' חידוד של מרדכי.

אחרי תיקון #1-#5 → READY.
