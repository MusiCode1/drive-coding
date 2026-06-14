---
project: "drive-coding"
slice: "slice-P1b-acp-adapter"
verifier: "avigail"
date: "2026-06-13"
verdict: "USABLE-AFTER-FIX"
round: 3
findings:
  - id: 1
    severity: "regression"
    category: "dropped-branch"
    summary: "mapPlanEntries maps to {id,title,status} but real fixture PlanEntry is {content,priority,status} — plan text (content) dropped, title always undefined"
    source_brief: "§3 line 85 / DoD #2 / §9 #6"
    source_code: "packages/frontend/static/fixtures/salary-attendance.json (plan entries)"
    cost_estimate: "10-20min"
  - id: 2
    severity: "type-error"
    category: "wrong-path"
    summary: "usage_update cost typed as number (§3 line 66/84) but fixture cost is always an object {amount,currency} in all 6 fixtures"
    source_brief: "§3 lines 66,84 / §9 #5"
    source_code: "packages/frontend/static/fixtures/greeting.json (usage_update.cost)"
    cost_estimate: "5-10min"
---

# Plan Verification — slice-P1b-acp-adapter (סבב 3)

> **Brief**: docs/plans/slice-P1b-acp-adapter.md
> **Base**: dev HEAD אחרי merge P1a (types כיום ב-worktree slice-P1a-provider-abstraction)
> **Verdict**: 🟡 USABLE-AFTER-FIX
> **אומדן זמן confusion אם לא תוקן**: ~15-25 דק' (אליעזר יעתיק pseudo-code verbatim ויפיל את plan.update content / יקודד cost כ-number)

## רקע — אימות תיקוני סבב 2

| תיקון r2 | סטטוס | הערה |
|---|---|---|
| variant `plan` → `plan.update` ממופה, ב-§3 switch + DoD #2 + §9 #6 | ✅ ממופה | `plan.update` + `entries` + `PlanEntry` חוקיים ב-events.ts:58,30-34, 30. אבל **shape של mapPlanEntries שגוי** — ראה finding #1 |
| `usage_update` → `usage` passthrough; `Usage` פתוח `[k]:unknown` | ✅ מקמפל | `Usage` ב-events.ts:24-28 אכן `[k:string]:unknown` → passthrough יקמפל. אבל **type של `cost` שגוי** — ראה finding #2 |

שני התיקונים *מבנית* נכונים (variant מכוסה, target קנוני קיים), אך ה-pseudo-code שמתאר את ה-mapping **לא תואם את ה-fixtures האמיתיים** — שתי בעיות חדשות שנחשפות רק כשמסתכלים על shape אמיתי.

## בעיות שנמצאו

### 🔴 Regression risk

| # | בעיה | מקור (brief / code) | עלות אם לא תוקן |
|---|------|------|------|
| 1 | **`mapPlanEntries` shape שגוי**. §3 line 85: `entries?.map(e => ({ id, title, status }))`. אבל ה-PlanEntry האמיתי בכל ה-fixtures הוא `{ content, priority, status }` — **אין `id`, אין `title`**. הטקסט של ה-plan חי ב-`content`, לא ב-`title`. אם אליעזר יעתיק verbatim → כל 14 ה-plan entries ייפלטו עם `title: undefined` וטקסט ה-plan ייעלם silently. ה-canonical `PlanEntry` (events.ts:30) הוא `{id?,title?,status?}` — צריך מיפוי `content→title` (ואולי `priority` → drop או extension). | brief §3 line 85, §9 #6 / `static/fixtures/salary-attendance.json` (כל plan entry: keys `{content,priority,status}`) | 10-20 דק' + silent data loss בכל plan |

### 🟡 Type error / Confusion

| # | בעיה | מקור | הצעה |
|---|------|------|------|
| 2 | **`usage_update.cost` typed `number`, אבל הוא object**. §3 line 66 מטפס `cost?: number`; line 84 `mapUsage: { ... cost: u.cost }`. ב-**כל 6 ה-fixtures** `cost` הוא `{ amount: 0, currency: "USD" }` (object). `used`/`size` אכן numbers (תקין). מאחר ש-`Usage` פתוח → passthrough יקמפל בלי שגיאה, לכן זה **לא typecheck-blocker**, אבל ה-type annotation עובדתית שגוי ועלול להטעות את אליעזר לקודד `cost` כ-number (coerce/validate). | brief §3 lines 66,84, §9 #5 / `static/fixtures/greeting.json` (`cost` = object בכל ה-fixtures) | מרדכי: שנה ל-`cost?: unknown` (או `{amount,currency}`) ב-§3 type של `u` |

### 🟢 Minor (לא חוסם — READY-compatible)

| # | בעיה | מקור |
|---|------|------|
| 3 | `client.prompt(sessionId, text: string)` מקבל **string**, אבל `sendPrompt(content: PromptContent)` כאשר `PromptContent = string \| PromptContentPart[]`. ה-brief §3 לא מציין שצריך לחלץ string מ-`PromptContent` לפני `client.prompt`. ניואנס מימוש, לא טעות עובדתית — אליעזר יפתור בקלות. | brief §3 line 99 / `acp/client.ts:49`, events.ts:91-95 |

## Spot-check שעבר (לא מצא בעיה)

- ✅ **8/8 variants ב-fixtures מכוסים**: `agent_message_chunk`(108) · `agent_thought_chunk`(156) · `available_commands_update`(6) · `plan`(14) · `tool_call`(329) · `tool_call_update`(329) · `usage_update`(6) · `user_message_chunk`(64). כולם ב-§3 switch + DoD #2. אין variant חסר/לא-ב-DoD.
- ✅ `plan.update` + `entries: PlanEntry[]` — events.ts:58; `PlanEntry{id?,title?,status?}` — events.ts:30-34 (worktree P1a). variant קנוני קיים.
- ✅ `Usage` פתוח `[k:string]:unknown` — events.ts:24-28. passthrough של `{used,size,cost}` יקמפל.
- ✅ `classifyToolKind` קיים ב-`provider/tool-kind.ts:19`, ו**לא** מיוצא מ-`core/index.ts` (אומת — index מייצא רק cwd/ports/events(type)/schemas/ui/voice). §4 Commit 0 צודק.
- ✅ `events` מיוצא ב-`index.ts:4` כ-`export type *` — עקבי עם הערת split-imports (§4 Commit 0, verbatimModuleSyntax).
- ✅ AcpClient surface — `client.ts`: `capabilities`(=SDK agentCapabilities, ל.42), `newSession`(43), `loadSession`(44), `listSessions`(48), `prompt(sessionId,text)`(49), `cancel(sessionId)`(50), `close()`(51), `createAcpClient`(71). תואם §3.
- ✅ `client.capabilities` = `agentCapabilities` (ל.42/132) — **לא** ports `AcpCapabilities`. §3 line 97-98 + DoD #8 צודקים.
- ✅ `requestPermission` auto `allow_once` — `client-impl.ts:5,21,24`. §0/§9 #4 צודקים.
- ✅ fixtures-wrapping — `agent-session.svelte.ts:929` `#onSessionUpdate({ update } as ...)`; `#onSessionUpdate` ל.947; `client.prompt` blocking await ל.493. כל ה-line refs עובדתיים. הקובץ 1126 שורות.
- ✅ depends_on=[P1a] — §0 line 7 מצהיר מפורש על `ProviderSession`/`ProviderEvent`/`ToolCallLocation`/`classifyToolKind` מ-core/provider. עקבי.
- ✅ scope core-only — §2 + DoD #7. frontend cutover → P1d מפורש. עקביות פנימית טובה.
- ✅ עקביות שמות — `mapAcpNotification`/`AcpProviderSession`/`mapAcpCapabilities` עקביים בכל §§. אין naming drift.

## Verdict

🟡 **USABLE-AFTER-FIX** — שני התיקונים של סבב 2 *מבנית* נכונים (variants מכוסים, targets קנוניים קיימים), אבל ה-pseudo-code שמתאר את המיפוי לא תואם את ה-fixtures האמיתיים בשתי נקודות:

1. 🔴 `mapPlanEntries` ממפה ל-`{id,title}` בעוד ה-PlanEntry האמיתי הוא `{content,priority}` → silent loss של טקסט ה-plan.
2. 🟡 `cost?: number` שגוי — הוא object `{amount,currency}` בכל ה-fixtures (לא חוסם typecheck בזכות passthrough, אבל מטעה).

שני אלה תיקון קצר של מרדכי (~15 דק'): עדכון §3 line 85 (`content→title`) + §3 line 66/84 (`cost?: unknown`). אחרי זה — READY. finding #3 הוא nitpick, לא חוסם.

> הערה לסבב הבא: כדאי שמרדכי תפתח fixture אמיתי אחד לכל variant לא-טריוויאלי לפני שכותבת pseudo-code של mapper — סבב 2 ו-3 שניהם נתפסו על mismatch בין pseudo-code ל-shape אמיתי.
