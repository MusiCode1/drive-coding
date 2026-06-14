---
project: "drive-coding"
slice: "slice-P1a-provider-abstraction"
verifier: "avigail"
date: "2026-06-13"
verdict: "USABLE-AFTER-FIX"
findings:
  - id: 1
    severity: "blocker"
    category: "missing-symbol"
    summary: "claude-code-connection events.ts does NOT contain ToolCallLocation / ProviderSession / PromptContent; brief §3 'adopt 1:1' is false for these"
    source_brief: "§0 Reading list, §3, §6"
    source_code: "claude-code-connection/src/session/events.ts (76 lines total)"
    cost_estimate: "20-40min"
  - id: 2
    severity: "blocker"
    category: "missing-symbol"
    summary: "events.ts tool_call variant has NO locations field; canonical 'locations?: ToolCallLocation[]' (decision 9 / v1.2) is NOT in the reference impl"
    source_brief: "§3 code block, §1, DoD #3"
    source_code: "claude-code-connection/src/session/events.ts:19-21"
    cost_estimate: "15-30min"
  - id: 3
    severity: "major"
    category: "outdated-risk"
    summary: "§6 mitigation 'copy arktype array-of-objects pattern from diff/content in ws-messages' is false — no such example exists; only object-array pattern in repo is AgentPublic.array()"
    source_brief: "§4 Commit 2, §6 risk row 1"
    source_code: "packages/core/src/schemas/ws-messages.ts (only array is string[]); packages/core/src/schemas/agent.ts:103"
    cost_estimate: "15-25min"
  - id: 4
    severity: "minor"
    category: "type-error"
    summary: "noUncheckedIndexedAccess=true: classifyToolKind via index-into-map returns T|undefined; brief shows no fallback handling"
    source_brief: "§4 Commit 1"
    source_code: "tsconfig.base.json:8"
    cost_estimate: "5-10min"
  - id: 5
    severity: "minor"
    category: "wrong-symbol"
    summary: "Usage/PermissionOption naming: events.ts uses UsageObject (not Usage) and JsonObject for input (not unknown); brief §3 writes Usage / input: unknown"
    source_brief: "§3, §6 risk row 3"
    source_code: "claude-code-connection/src/session/events.ts:4,19,28"
    cost_estimate: "5min"
---

# Plan Verification — slice-P1a-provider-abstraction

> **Brief**: docs/plans/slice-P1a-provider-abstraction.md
> **Base tip**: 8410042 (merge dev → main)
> **Verdict**: 🟡 USABLE-AFTER-FIX
> **אומדן זמן confusion אם לא תוקן**: 40-70 דק'

## בעיות שנמצאו

### 🔴 Blocker / Regression risk

| # | בעיה | מקור (brief / code) | עלות אם לא תוקן |
|---|------|---------------------|------------------|
| 1 | ה-brief מורה (§0 Reading list, §3, §6) "אמץ structural 1:1 מ-`claude-code-connection/src/session/events.ts` את `ProviderSession`/`ProviderCapabilities`/`ToolCallLocation`/`PromptContent`". בפועל הקובץ הוא **76 שורות** ומכיל רק: `ToolKind`, `PermissionOption`, `ProviderEvent`, `ProviderCapabilities`, `ClaudeExtensions`, `CLAUDE_CODE_CAPABILITIES`. **אין בו `ToolCallLocation`, אין `ProviderSession`, אין `PromptContent`.** §1 + §3 + DoD #2/#3 דורשים את כל אלה. אליעזר ינסה להעתיק מקור שלא קיים. | brief §0/§3/§6 ↔ `claude-code-connection/src/session/events.ts` (כולו 76 שורות) | 20-40 דק' |
| 2 | ה-`tool_call` variant ב-§3 כולל `locations?: ToolCallLocation[]` (מסומן "v1.2 / decision 9"). ב-events.ts ה-`tool_call` variant הוא `{ type; id; name; input: JsonObject; kind; status }` — **בלי `locations`**. כלומר ה"מקור שעבר verification" לא תואם לחוזה v1.2 שה-brief מצטט, וה-DoD #3 ("grep diff מול events.ts — אותם שמות שדות") **ייכשל by design**. צריך החלטה: מי מקור-האמת — events.ts או v1.2? | brief §3 code block, DoD #3 ↔ `claude-code-connection/src/session/events.ts:19-21` | 15-30 דק' |

### 🟡 Major / Confusion

| # | בעיה | מקור | הצעה |
|---|------|------|------|
| 3 | §4 Commit 2 + §6 risk#1: "אמת תחביר arktype למערך-אובייקטים; בדוק דוגמה קיימת ב-`ws-messages.ts` (יש diff/content); העתק תבנית". **אין כזו דוגמה**: הסריקה של `packages/core/src/schemas/` מצאה שהמערך היחיד הוא `locations?: "string[]"` (string), ו-`content` הוא `"string"` (לא מערך-אובייקטים). הדפוס היחיד למערך-אובייקטים ב-repo הוא `AgentPublic.array()` (agent.ts:103) — כלומר `SubType.array()`, **לא** התחביר inline `{ path: string; "line?": number }[]` שה-brief מציע ב-§2/§4. צריך לאמת שתחביר ה-inline נתמך, או להגדיר sub-`type` ולהשתמש ב-`.array()`. | brief §2/§4 Commit 2, §6 ↔ `ws-messages.ts` (אין דוגמה); `agent.ts:103` (הדפוס האמיתי) | מרדכי: החלף את הפניה ל"diff/content example" בהפניה ל-`AgentPublic.array()`, או ספק תחביר arktype מאומת ל-object-array |

### 🟢 Minor

| # | בעיה | מקור |
|---|------|------|
| 4 | strict tsconfig: `noUncheckedIndexedAccess: true` (tsconfig.base.json:8). `classifyToolKind` הממומש כ-`MAP[acpKind]` יחזיר `ToolKind \| undefined` → typecheck יתלונן. ה-brief לא מציין fallback ל-`other`. (פתיר ב-switch או `?? "other"`.) | brief §4 Commit 1 ↔ tsconfig.base.json:8 |
| 5 | אי-עקביות שמות מול המקור: events.ts משתמש ב-`UsageObject` (לא `Usage`) ו-`input: JsonObject` (לא `unknown`). ה-brief §3 כותב `Usage` ו-`input: unknown`. אם "אמץ 1:1" — אלה שמות שונים; אם מתאימים ל-core — צריך להגדיר `Usage`/`JsonObject` מקומית. | brief §3 ↔ events.ts:4,19,28 |

## Spot-check שעבר (לא מצא בעיה)

- ✅ `ports.ts:1` — מייבא `PromptResponse`/`SessionNotification` מ-`@agentclientprotocol/sdk` (שורות 1,5). אומת. ACP-direct כפי שה-brief טוען.
- ✅ `ws-messages.ts` — `ToolCallMessage` ב-`type({...})` (arktype), `"locations?": "string[]"` שורה **91**, וה-`kind` comment מתאר ACP enum עם 10 ערכים (read/edit/delete/move/search/execute/think/fetch/switch_mode/other) שורה 74-75. הכל מדויק.
- ✅ `bubble.ts:59` — `export type ToolLocation = { path: string; line?: number }` — **בדיוק** בשורה 59, זהה לקנוני `ToolCallLocation`. ה-claim הקריטי של ה-brief נכון.
- ✅ `agent-session.svelte.ts:795` — `#mapLocations(raw): ToolLocation[]` ממפה `{path, line?}`. אומת. (הערה: ב-frontend `line` נשמר כ-`undefined` מפורש, לא omitted — לא חוסם.)
- ✅ `index.ts` — דפוס `export type * from "./ports"` קיים; הוספת `export type * from "./provider/events"` תואמת לדפוס + תואמת `verbatimModuleSyntax: true`. אומת.
- ✅ toolchain — **pnpm** (`packageManager: "pnpm@10.0.0"`, רק `pnpm-lock.yaml` קיים, אין bun/npm lock). core scripts: `build: "tsc --build"`, `typecheck: "tsc --noEmit"`. root: `test: "vitest run"`. ה-placeholder `<package-manager>` ב-brief = **pnpm**.
- ✅ `claude-code-connection` קיים ונגיש: `/home/user/projects/claude-code-connection`, ו-`src/session/events.ts` קיים (אבל ראה blocker 1/2 על תוכנו).
- ✅ `agent.ts` `CLI_SPECS`/`CliKind` — נתמכים: opencode, claude, gemini, codex, qoder. **אין `claude-code`** (יש `claude` = ACP via `@agentclientprotocol/claude-agent-acp`). לא חוסם ל-P1a (P1c בלבד) — אבל P1c §10 מניח רישום שלא קיים עדיין.

## Verdict

🟡 **USABLE-AFTER-FIX** — 5 findings (2 blocker, 1 major, 2 minor). ה-blockers הם data-fidelity: ה-brief מסתמך על "אמץ 1:1 מ-events.ts" אבל events.ts חסר את חצי מהטיפוסים שה-brief דורש (`ToolCallLocation`/`ProviderSession`/`PromptContent`) ו-`locations` כלל לא קיים שם. זה לא דורש rewrite מבני — מרדכי צריכה (א) להבהיר שהמקור ל-`ToolCallLocation`+`locations`+`ProviderSession`+`PromptContent` הוא **החוזה v1.2** (לא events.ts), ולתקן את הוראת ה"1:1"; (ב) להחליף את ההפניה לדוגמת arktype הלא-קיימת ב-`AgentPublic.array()` או בתחביר מאומת. ~15-20 דק' תיקון. ה-claims העובדתיים (line numbers, bubble.ts:59, toolchain, ws-messages:91) כולם נכונים.
