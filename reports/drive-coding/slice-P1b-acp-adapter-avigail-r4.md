---
project: "drive-coding"
slice: "slice-P1b-acp-adapter"
verifier: "avigail"
date: "2026-06-13"
verdict: "USABLE-AFTER-FIX"
findings:
  - id: 1
    severity: "regression"
    category: "dropped-branch"
    summary: "content: mapContent(u.rawOutput) reads the wrong field — canonical ToolContent[] lives in update.content, not rawOutput"
    source_brief: "§3 line 74"
    source_code: "packages/frontend/src/lib/view-models/agent-session.svelte.ts:1025"
    cost_estimate: "20-40min"
  - id: 2
    severity: "confusion"
    category: "naming-inconsistency"
    summary: "P1a ToolContent uses kind discriminant ({kind:text,text}), ACP content items use type ({type:content,content:{type,text}}) — mapContent must remap fields"
    source_brief: "§3 line 74 / §9 #3"
    source_code: "packages/core/src/provider/events.ts ToolContent"
    cost_estimate: "10min"
  - id: 3
    severity: "minor"
    category: "wrong-line-number"
    summary: "fixtures are {loadResult,updates:[...]} wrappers — each element of .updates is the bare update; brief note implies the file itself is one bare update"
    source_brief: "§3 line 88, §4 Commit 1 line 123"
    source_code: "packages/frontend/static/fixtures/*.json"
    cost_estimate: "5min"
---

# Plan Verification — slice-P1b-acp-adapter (סבב 4)

> **Brief**: docs/plans/slice-P1b-acp-adapter.md
> **Base tip (dev)**: e25912c
> **P1a types**: .worktrees/slice-P1a-provider-abstraction/packages/core/src/provider/ (events.ts, tool-kind.ts)
> **Verdict**: 🟡 USABLE-AFTER-FIX
> **אומדן זמן confusion אם לא תוקן**: 20-40 דק' (אליעזר יממש mapContent על rawOutput → טסט content ייכשל/יחזיר זבל)

## תוצאות סבב 3 — אומתו שתוקנו

- ✅ **finding 1 r3 (plan entry)** — **תוקן ונכון**. fixture אמיתי (`salary-attendance.json`) plan entry = `{content, priority, status}`, ה-`content` מחזיק את טקסט ה-plan (למשל `"מצא קובץ דו"ח נוכחות..."`). §3 line 86 `entries?.map(e => ({ title: e.content, status: e.status }))` תופס נכון את `content`→`title`, ו-`priority` נדחה. תואם `PlanEntry` של P1a (`{id?,title?,status?}`).
- ✅ **finding 2 r3 (cost)** — **תוקן ונכון**. fixture: `cost: {amount:0, currency:"USD"}` (object). §3 line 66+84 `cost?: unknown` + passthrough ל-`Usage` הפתוח (`[k]:unknown`). נכון.
- ✅ **finding 3 r3 (sendPrompt text extraction)** — **תוקן ונכון**. §3 line 101 `typeof content === "string" ? content : content.filter(p=>p.type==="text").map(p=>p.text).join("")`. תואם `PromptContent` של P1a (`string | PromptContentPart[]`, part = `{type:"text",text}`).

שלושת התיקונים מסבב 3 אומתו. אך הסריקה המעמיקה של ה-fixtures חשפה shape-mismatch נוסף — **הפעם השלישית** שמתגלה אי-התאמת shape, וכפי שחששת, היא קיימת.

## בעיות שנמצאו

### 🔴 Regression / dropped-branch

| # | בעיה | מקור (brief / code) | עלות אם לא תוקן |
|---|------|---------------------|------------------|
| 1 | `content: mapContent(u.rawOutput)` קורא מהשדה הלא-נכון. ה-`ToolContent[]` הקנוני מגיע מ-`update.content` (array של `{type:"content", content:{type:"text",text}}` / diff / terminal), **לא** מ-`rawOutput`. ב-fixtures: `rawOutput` = `{output, metadata, attachments}` או `{error}` — זה ה-**result** הגולמי (frontend ממפה אותו ל-`result`, לא ל-`content`). מקור-האמת ב-`#handleToolCall` משתמש `this.#mapToolContent(update.content)`. | brief §3 line 74 / `agent-session.svelte.ts:1025` (`content: ...#mapToolContent(update.content)`) + `:1024` (`result: update.rawOutput`) | 20-40 דק' — אליעזר יממש `mapContent` מעל `rawOutput`, טסט `content` יקבל object `{output,...}` ולא array → ימפה ל-`[]` או יקרוס; ToolContent יאבד שקטית |

**ראיה מ-fixtures**:
- `tool_call_update` נושא `content: [{type:"content", content:{type:"text", text:"..."}}]` (mitm.json) — זה היעד ל-`ToolContent[]`.
- אותו update נושא `rawOutput: {output:"...", metadata:{...}, attachments:[...]}` (phone-tunnel.json) או `rawOutput: {error:"StatusCode 404..."}` (mitm.json) — זה ה-result, **לא** מערך-content.

### 🟡 Confusion / naming

| # | בעיה | מקור | הצעה |
|---|------|------|------|
| 2 | גם אחרי תיקון finding 1 (קריאה מ-`u.content`): ה-shape של פריט ACP content הוא `{type:"content", content:{type:"text",text}}`, אבל `ToolContent` הקנוני של P1a משתמש ב-discriminant **`kind`** (`{kind:"text",text}`), לא `type`. `mapContent` חייב למפות שם-שדה (`type→kind`) ולחלץ את ה-`.content.text` הפנימי (לא `item.text` ישיר). §9 #3 אומר "text-only ל-MVP" אבל לא מציין את הצורה המקוננת. | brief §3 line 74, §9 #3 / `events.ts` ToolContent (`{kind:"text";text}`) + frontend `#mapToolContent:863` | מרדכי: ציין ב-§3 ש-`mapContent` קורא מ-`u.content` (array), ולכל item: `item.type==="content" && item.content?.type==="text"` → `{kind:"text", text:item.content.text}` |

### 🟢 Minor

| # | בעיה | מקור |
|---|------|------|
| 3 | ה-fixtures הם wrapper `{loadResult, updates:[...]}` — **כל element** ב-`.updates` הוא bare update. הערות §3 line 88 / §4 Commit 1 line 123 ("fixtures = bare update objects") נכונות לרמת ה-element אך מטעות לגבי קובץ ה-fixture עצמו; הטסט צריך `JSON.parse(file).updates.map(u => mapAcpNotification({update:u}))`. `#loadMockSession:935` קורא `data.updates`. נטל קל — אבל יבלבל את אליעזר אם יטען את הקובץ ישירות. |

## Spot-check שעבר (לא מצא בעיה)

- ✅ **כל 8 ה-variants ב-fixtures מכוסים ב-§3**: tool_call(329), tool_call_update(329), agent_message_chunk(108), agent_thought_chunk(156), plan(14), usage_update(6), available_commands_update(6), user_message_chunk(64). **אין variant נוסף** (אין `task.update`/`status`/`error` ב-fixtures) — ה-`default → raw` מכסה.
- ✅ **status values** = `pending`/`completed`/`failed` בלבד — תת-קבוצה של P1a (`pending|in_progress|completed|failed`); `mapStatus(undefined)→"pending"` (§3 line 72) תקין.
- ✅ **locations** — בכל ה-fixtures `locations: []` (ריק). `mapLocations([])→[]`; כשמלא, shape = `{path, line?}` (frontend `#mapLocations:903`), תואם `ToolCallLocation` של P1a.
- ✅ **usage_update** shape `{used, size, cost:{amount,currency}}` — passthrough ל-`Usage` פתוח. נכון (finding 2 r3).
- ✅ **plan entry** `{content, priority, status}` → `{title:content, status}`. נכון (finding 1 r3).
- ✅ **agent_message_chunk / agent_thought_chunk content** = `{type:"text", text}` — `textOf` עם `content.type==="text"?content.text:""` (frontend:983) תקין.
- ✅ **user_message_chunk** יכול להיות image (`{type:"image",mimeType,data,uri}`) — brief ממפה ל-`raw` (lossless), אז ה-image נשמר; אין בעיית text-extraction.
- ✅ **classifyToolKind** מיוצא מ-`tool-kind.ts` (P1a) ומכסה את כל ACP kinds; §4 Commit 0 export נכון.
- ✅ **sendPrompt text extraction** (finding 3 r3) — תואם `PromptContent`.
- ✅ **depends_on** = `[P1a]` — עקבי. ה-Base מצהיר במפורש "אחרי merge של P1a" + ⚠️ חסום עד merge (types ב-worktree בלבד). תלות מוצהרת נכונה.
- ✅ **scope** — frontend cutover מודר ל-P1d; §2 ברור. DoD §5 (9 בדיקות) מכסה את ה-variants + lifecycle + isError + exports.
- ✅ **verbatimModuleSyntax** split-import (§4 Commit 0) — `import type` לטיפוסים, value import ל-`classifyToolKind`. נכון (P1a גם משתמש `import type`).

## Verdict

🟡 **USABLE-AFTER-FIX** — שלושת תיקוני סבב 3 אומתו ונכונים, ואין naming-inconsistency/wrong-path/depends_on issues. **אך** finding 1 הוא regression אמיתי: `mapContent(u.rawOutput)` קורא מהשדה הלא-נכון — ה-ToolContent הקנוני מגיע מ-`update.content`, ו-`rawOutput` הוא ה-result. זו אי-התאמת shape שלישית ב-fixtures (כפי שחששת — לא נסגרה ב-r3). תיקון ~15-20 דק' של מרדכי: שנה §3 line 74 ל-`content: mapContent(u.content)` + ספציפיקציית shape ב-finding 2. אחרי כן → READY.

לא READY בסבב זה: finding 1 חוסם נכונות (silent ToolContent loss) ואינו nitpick.
