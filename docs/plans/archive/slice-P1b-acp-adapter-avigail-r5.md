---
project: "drive-coding"
slice: "slice-P1b-acp-adapter"
verifier: "avigail"
date: "2026-06-13"
verdict: "READY"
round: 5
findings:
  - id: 1
    severity: "minor"
    category: "wrong-line-number"
    summary: "mapContent source ref points to #mapToolContent at agent-session:1025 but the definition is at :855 (1025 is the call site)"
    source_brief: "§3 line 84"
    source_code: "packages/frontend/src/lib/view-models/agent-session.svelte.ts:855"
    cost_estimate: "2-5min"
  - id: 2
    severity: "minor"
    category: "wrong-line-number"
    summary: "general directive lists #mapToolContent/#mapLocations as source-of-truth inside range 947-1060, but they live at :855/:895 (outside that range)"
    source_brief: "§3 line 89"
    source_code: "packages/frontend/src/lib/view-models/agent-session.svelte.ts:855,895"
    cost_estimate: "2-5min"
---

# Plan Verification — slice-P1b-acp-adapter (סבב 5)

> **Brief**: docs/plans/slice-P1b-acp-adapter.md
> **Base tip**: dev HEAD (P1a types ב-worktree slice-P1a-provider-abstraction; טרם merged — חסם מוצהר ב-§0, לא באג)
> **Verdict**: ✅ **READY**
> **אומדן confusion אם לא תוקן**: ~5 דק' (line-refs בלבד; לא חוסם — ההנחיה הכללית מכסה את ה-shapes)

## אימות שלושת התיקונים מסבב 4

### 1. (היה 🔴) `content` מ-`update.content` ולא `rawOutput` — ✅ תוקן ואומת
ה-brief §3 שורה 74: `content: mapContent(u.content)` עם הערה מפורשת
"ToolContent מ-`update.content` (array), **לא** `rawOutput`".
אומת מול fixture `salary-prev.json`: ב-`tool_call_update` השדה `content` הוא
`[{type:"content", content:{type:"text", text}}]`, ואילו `rawOutput` כלל **לא קיים** ב-tool_call/tool_call_update שנבדקו. התיקון נכון.

### 2. (היה 🟡) mapContent discriminant `type` → `kind` — ✅ תוקן ואומת
ה-brief §3 שורה 84: "ACP item = `{type:"content", content:{type:"text", text}}` → קנוני `{kind:"text", text}` (discriminant type→kind)".
- אומת מול fixture: ה-ACP item אכן `{type:"content", content:{type:"text", text}}` (salary-prev tool_call_update).
- אומת מול `events.ts:19-22`: הקנוני `ToolContent` משתמש ב-discriminant **`kind`** (`{kind:"text"; text}`), **בלי** variant `"other"`.
היעד שה-brief מתאר נכון. (ראה finding #1 על מספר השורה של המקור).

### 3. (היה 🟢) fixture = `{loadResult, updates:[...]}` wrapper — ✅ תוקן ואומת
ה-brief §3 שורה 91 + §4 שורה 126: לכל `up` ב-`fixture.updates` → `mapAcpNotification({update: up})`.
אומת מול **כל 6 ה-fixtures**: top keys = `['loadResult','updates']`; כל element ב-`updates` הוא **bare update object** (`{sessionUpdate, messageId, content, ...}`, בלי nesting תחת `.update`). תואם בדיוק ל-`#loadMockSession:929` שעוטף `{update}`. התיקון נכון.

## אימות ההנחיה הכללית החדשה (§3 שורה 89)

ההנחיה: "מקור-אמת ל-shapes = הקוד הקיים (`#onSessionUpdate`/`#handleToolCall`/`#handleToolCallUpdate`/`#mapToolContent`/`#mapLocations` ב-agent-session:947-1060)".

**מהות ההנחיה מדויקת ומספיקה** — המתודות אכן מכילות את כל ה-mapping logic שאליעזר צריך:
- `#onSessionUpdate` (947) — ה-switch הראשי על `sessionUpdate`.
- `#handleToolCall` (996) — shape של tool_call (`name = kind ?? title ?? "tool"`, `status ?? "pending"`, `args = rawInput ?? {}`).
- `#handleToolCallUpdate` (1034) — collapse לפי id.
- `#mapToolContent` (855) — מימוש מלא של מיפוי content blocks.
- `#mapLocations` (895) — מיפוי locations.

⚠️ **אי-דיוק טווח-שורות (לא מהותי)**: שתי מתודות מתוך החמש שההנחיה מפנה אליהן — `#mapToolContent` ו-`#mapLocations` — נמצאות ב-**855/895**, **מחוץ** לטווח "947-1060" שצוין. אליעזר ימצא אותן ב-grep תוך שניות (השמות מדויקים), לכן זה **minor** ולא חוסם.

⚠️ **הערת shape להבחנה (לא חוסם)**: המימוש האמיתי ב-`#mapToolContent:855` פולט `{type:"text"|"diff"|"terminal"|"other", ...}` (discriminant `type`, כולל variant `other`) — זהו ה-`ToolContent` **המקומי של ה-frontend**, **שונה** מהקנוני (`{kind:...}`, בלי `other`). ה-brief מודע לכך ומורה מפורשות על type→kind ב-§3:84. כלומר אליעזר **לא** מעתיק את `#mapToolContent` verbatim אלא ממפה את ה-discriminant. ההנחיה הכללית + הערת §3:84 ביחד מכסות את הפער. הבחנה זו מתועדת כאן כדי שלא תיפול בין הכיסאות — אך אינה blocker.

## סריקת variants אחרונה (כל 6 ה-fixtures)

| variant | מופיע ב-fixtures | מכוסה ב-switch §3 |
|---------|------------------|--------------------|
| tool_call / tool_call_update | ✅ (עד 119 כ"א) | ✅ → tool_call |
| agent_message_chunk | ✅ | ✅ → message.delta |
| agent_thought_chunk | ✅ | ✅ → thinking.delta |
| user_message_chunk | ✅ | ✅ → raw (§9 #1) |
| plan | ✅ (salary-prev:8, salary-attendance:6) | ✅ → plan.update |
| usage_update | ✅ | ✅ → usage |
| available_commands_update | ✅ | ✅ → raw (§9 #5) |
| (unknown) | — | ✅ default → raw |

**אין variant לא-מכוסה.** shapes אומתו מול fixtures:
- plan entry = `{priority, status, content}` → תואם §3:86 (`{title:e.content, status:e.status}`, priority נדחה).
- usage = `{used, size, cost:{amount,currency}}` → תואם §3:85.
- content block = `[{type:"content", content:{type:"text", text}}]` → תואם §3:84.

## Spot-check שעבר (ללא בעיה)

- ✅ P1a types — `events.ts` + `tool-kind.ts` קיימים ב-worktree slice-P1a-provider-abstraction; `classifyToolKind` מיוצא (tool-kind.ts:19).
- ✅ `ToolContent` קנוני discriminant = `kind` (events.ts:19-22) — אומת.
- ✅ `ProviderEvent.tool_call` כולל `status` required + `content?: ToolContent[]` + `locations?` (events.ts:40-49) — תואם ל-pseudo §3.
- ✅ `turn.end` דורש `isError: boolean` (events.ts:59) — ה-brief מציין זאת מפורשות (§3:108, DoD #5).
- ✅ `PlanEntry` = `{id?, title?, status?}` (events.ts:30-34) — תואם §3:87.
- ✅ `Usage` פתוח `[k]:unknown` (events.ts:24-28) — תואם §3 passthrough.
- ✅ fixtures = bare update objects, wrapper `{loadResult,updates}` — אומת ב-6 קבצים.
- ✅ depends_on = `[P1a]` מוצהר (§0 שורה 7); ה-base חסם-עד-merge מוצהר (§0 שורה 5) — תקין.

## Verdict

✅ **READY**.

שלושת התיקונים מסבב 4 אומתו מול הקוד וה-fixtures האמיתיים — כולם נכונים. ההנחיה הכללית החדשה (§3:89) **מדויקת במהות ומספיקה**: היא מפנה את אליעזר לקרוא את ה-shapes מהמקור הקיים במקום מה-pseudo, וזה פותר את לולאת ה-shape-mismatch. אין variant לא-מכוסה.

שני ה-findings שנותרו הם **wrong-line-number בלבד** (minor): מספר השורה של `#mapToolContent` (855 ולא 1025) וטווח השורות של ההנחיה (855/895 מחוץ ל-947-1060). השמות מדויקים → אליעזר ימצא ב-grep מיידי. אלה **אינם** mismatch מהותי ואינם חוסמים — בדיוק סוג אי-הדיוק שההנחיה הכללית מכסה. לכן: **READY**, בלי צורך בסבב נוסף.
