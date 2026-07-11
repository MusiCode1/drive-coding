# Pre-brief — subagent nested transcript bubble

> **תאריך**: 2026-07-11
> **סוג מסמך**: pre-brief מחקרי — אינו בריף ביצועי ואסור dispatch לאליעזר
> **סטטוס**: דורש זיקוק לבריפים B1/B2 ואימות אביגיל
> **תלות**: `slice/acp-stack-upgrade` לאחר merge ל-`dev`
> **מחליף הנחות של**:
> - `slice-claude-subagent-adapter-fork.md` — הפורק אינו נדרש ל-transcript ב-stack הנוכחי
> - `slice-subagent-transcript-data.md` — מודל `subFrames` עדיין שימושי, מקור הנתונים השתנה
> **יעד מומלץ**: שני slices עוקבים — B1 data/normalization, ואז B2 rendering/runtime

---

## 1. הבעיה מנקודת מבט המשתמשת

כאשר Claude מפעיל Task/Agent כתת-סוכן, drive-coding מציג היום את קריאת ה-Task כבועת כלי רגילה. אפשר לראות שהכלי התחיל והסתיים, אך אי אפשר לראות בתוך הבועה מה תת-הסוכן חשב, כתב או הפעיל לאורך העבודה. התוצאה היא קפיצה מתיאור משימה לתוצאה סופית בלי transcript שימושי של העבודה המקוננת.

היעד הוא שהבועה של ה-Task תהיה container חי: כותרת ומצב של תת-הסוכן, ובתוכה transcript מקונן של message/thought/tool frames. הרשימה הראשית של הבועות תישאר שטוחה; כל תוכן תת-הסוכן יחיה בתוך בועת האב ולא יזלוג לתשובת הסוכן העליון.

---

## 2. מה כבר הוכח

### 2.1 התנהגות upstream הרגילה

`@agentclientprotocol/claude-agent-acp@0.58.1` עדיין מסנן בכוונה text/thinking של הודעות assistant עם `parent_tool_use_id`, ולכן feed ה-ACP הרגיל מספק את בועת ה-Task ועדכוני הכלי העליונים אך לא transcript מלא של תת-הסוכן.

זהו סינון תצוגתי של ה-adapter, לא אובדן במקור: ה-Claude Agent SDK כן מפיק את האירועים לפני הסינון.

### 2.2 מסלול raw SDK

הפעלת שני שדות ב-session meta מספיקה כדי לחשוף את הנתונים דרך ext notifications:

```ts
claudeCode: {
  options: {
    forwardSubagentText: true,
  },
  emitRawSDKMessages: [
    { type: "system", subtype: "task_started" },
    { type: "system", subtype: "task_progress" },
    { type: "system", subtype: "task_notification" },
    { type: "system", subtype: "task_updated" },
    { type: "assistant" },
  ],
}
```

הוכחה חיה ב-`connectInProcess` מול adapter `0.58.1` ו-SDK `0.3.207` קיבלה שבע הודעות raw:

- `task_started`
- `task_updated`
- `task_notification`
- ארבע הודעות `assistant`
- לפחות הודעת `assistant` אחת עם `parent_tool_use_id` של ה-Task וטקסט `SUBAGENT_RAW_OK`

ההכרעה שנרשמה היא `fork-not-needed-for-transcript`: עבור ה-stack הנוכחי אין צורך לבנות מחדש את fork ה-Claude כדי לקבל את חומר ה-transcript.

### 2.3 מה הסלייס הנוכחי מימש בפועל

- `CLAUDE_SESSION_META` מבקש את אירועי ה-raw הנדרשים.
- `AgentSession.#onExtNotification` מקבל `_claude/sdkMessage`.
- קיים כרגע test hook מינימלי בלבד: `claudeRawSdkMessageCount`.
- אין parser, normalization, correlation, `subFrames` או UI.

### 2.4 רעש lifecycle שאינו transcript

- `command_lifecycle` מתאר queued/started/completed של פקודה.
- `system.background_tasks_changed` מתאר את רשימת משימות הרקע, כולל `local_agent`.

אירועים אלה עשויים להזין status/lifecycle בעתיד, אך אינם מקור התוכן המקונן. מקור התוכן הוא הודעות `assistant` עם `parent_tool_use_id`; אירועי `task_*` מספקים identity, metadata ומצב.

---

## 3. מסמכים וקוד קיימים שיש לשמר מהם ידע

### מסמכים

- `docs/plans/slice-acp-stack-upgrade.md` — הגדרת raw SDK gate וה-scope שנדחה.
- `docs/decisions/drive-coding.md` — הראיה החיה והכרעת `fork-not-needed-for-transcript`.
- `docs/plans/slice-subagent-transcript-data.md` — הצעת `subFrames`, שמירת המערך הראשי שטוח, וסיכוני Svelte reactivity.
- `docs/plans/slice-claude-subagent-adapter-fork.md` — reference בלבד למבנה האירועים ולכוונת הסינון; לא תוכנית לביצוע.
- `docs/plans/ui-feature-backlog.md` — דרישה לתצוגת Task/subagent קריאה במקום JSON גולמי.

### anchors בקוד לאחר merge של ACP upgrade

- `packages/frontend/src/lib/view-models/agent-session.svelte.ts`
  - `CLAUDE_SESSION_META`
  - `#onExtNotification`
  - `#onSessionUpdate`
  - `#handleToolCall`
  - `#handleToolCallUpdate`
  - `#toolBubbleByCallId`
- `packages/frontend/src/lib/types/bubble.ts`
  - `ToolCall`
  - `ToolBubble`
  - `Bubble`
- `packages/frontend/src/lib/components/chat/bubbles/ToolBubble.svelte`
- `packages/frontend/src/lib/components/chat/BubbleRenderer.svelte`
- `packages/frontend/src/lib/components/chat/ChatBubbles.svelte`
- `packages/frontend/src/lib/components/layout/AppShell.svelte`

אין להשתמש במספרי שורות מהמסמכים הישנים; הם נכתבו לפני ACP upgrade ו-lifecycle playback.

---

## 4. חוזה האירועים הידוע והפערים

### 4.1 זרם lifecycle/metadata

אירועי `system.task_*` שנצפו או נתמכים ב-filter:

| subtype | תפקיד צפוי | מזהים/שדות שדורשים אישור fixture |
|---|---|---|
| `task_started` | יצירת/תחילת משימת תת-סוכן | `task_id`, `tool_use_id`, סוג סוכן, prompt |
| `task_progress` | התקדמות ופעילות אחרונה | `task_id`, `tool_use_id`, `last_tool_name`, summary |
| `task_notification` | סיום/שגיאה/הודעה מסכמת | `task_id`, `tool_use_id`, status, summary |
| `task_updated` | patch למצב משימה, לרבות backgrounding אפשרי | `task_id`, patch; לא להניח `tool_use_id` |

השמות המדויקים וה-nullability חייבים להיקבע מהקלטת raw אמיתית ומה-types של SDK `0.3.207`, לא מהבריף הישן.

### 4.2 זרם transcript

הודעות raw מסוג `assistant` עשויות לשאת:

- `parent_tool_use_id`: המזהה שמקשר את הודעת תת-הסוכן לקריאת ה-Task/Agent האב.
- `message.content[]`: blocks כגון `text`, `thinking`, `tool_use`, `tool_result` וסוגים נוספים.
- מזהי message/content block שיכולים לשמש ל-streaming/deduplication; עדיין לא תועדו באופן מספק.

אין להניח שכל הודעת `assistant` עם parent היא delta. ייתכן שה-SDK שולח snapshots מצטברים או הודעות שלמות. לפני בחירת append semantics חובה להקליט רצף רב-שלבי ולבדוק אם אותו content מופיע שוב.

### 4.3 קשר בין שני הזרמים

ה-correlation המשוער הוא:

```text
ACP tool_call.toolCallId
       ^
       | parent_tool_use_id על assistant raw
       |
Claude Task/Agent invocation
       |
       +-- task_*.tool_use_id או מיפוי task_id -> tool_use_id
```

הנחה זו הוכחה עבור הודעת assistant אחת, אך טרם הוכחה לכל ארבעת `task_*`, לריבוי תתי-סוכנים ולתת-סוכן מקונן בתוך תת-סוכן.

---

## 5. ארכיטקטורה מומלצת

```text
Claude Agent SDK
  | raw system.task_* / assistant{parent_tool_use_id}
  v
claude-agent-acp extNotification("_claude/sdkMessage")
  v
AgentSession.#onExtNotification
  |
  +--> pure parser: unknown -> ClaudeSubagentEvent | ignored/unknown
  |
  +--> correlation/index by taskId, toolUseId, parentToolUseId
  |
  +--> reducer: event + current task transcript -> next immutable state
  v
top-level ToolBubble (Task/Agent)
  | toolCall.task metadata
  | subFrames: message/thought/tool entries
  v
Subagent transcript renderer inside ToolBubble
```

### עקרונות

1. **Parser טהור לפני state mutation.** `#onExtNotification` לא יבצע casts רחבים ולא יפרש blocks inline.
2. **קלט הוא `unknown`.** יש לבצע refinement מפורש; אין `any` ואין אמון בגרסת SDK חיצונית.
3. **המערך הראשי נשאר שטוח.** Task הוא bubble יחיד עבור `virtua`; הקינון חי בשדה פנימי.
4. **אין זליגה ל-feed העליון.** raw subagent text לא נכנס ל-`this.bubbles` כ-MessageBubble רגיל.
5. **עדכונים immutable/object replacement.** שינוי `subFrames` מחליף את אובייקט ה-Task bubble כדי להצית Svelte 5 ו-virtua measurement.
6. **Unknown is observable, not fatal.** subtype/content block חדש נספר או נרשם בדיבוג, אך אינו מפיל session ואינו מוצג כ-JSON למשתמשת כברירת מחדל.
7. **Provider-specific ingress, provider-neutral display model.** parser Claude-specific; `SubagentTask`/`SubFrame` צריכים להיות מספיק כלליים כדי ש-provider נוסף יוכל להזין אותם בעתיד.
8. **No fork dependency.** הפורק המקומי נשאר reference/fallback בלבד.

---

## 6. מודל נתונים מוצע למחקר

זהו כיוון, לא API חתום. מרדכי צריך לקבע אותו לאחר fixture spike ואביגיל צריכה לאמת מול הקוד.

```ts
export type SubagentTaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "unknown"

export type SubagentTaskMeta = {
  taskId?: string
  parentToolUseId: string
  subagentType?: string
  prompt?: string
  summary?: string
  lastToolName?: string
  status: SubagentTaskStatus
}

export type SubFrame = MessageBubble | ThoughtBubble | ToolBubble

export type ToolCall = {
  // existing fields...
  task?: SubagentTaskMeta
}

export type ToolBubble = BubbleBase & {
  kind: "tool"
  // existing fields...
  subFrames?: SubFrame[]
}
```

שאלה מהותית: reuse רקורסיבי של `ToolBubble` בתוך `SubFrame` מאפשר קינון עמוק, אך גם מאפשר עץ בלתי מוגבל ומסבך rendering/types. חלופה היא `SubagentFrame` ייעודי ולא-רקורסיבי ב-B1, ואז הרחבה לעומק נוסף רק לאחר fixture שמוכיח צורך. ברירת המחדל המומלצת כרגע: מודל רקורסיבי בעומק הנתונים, renderer עם depth guard.

---

## 7. Data Flow Bridges

| Producer | Consumer | Data | מנגנון מומלץ | בדיקת גשר נדרשת |
|---|---|---|---|---|
| `CLAUDE_SESSION_META` | Claude adapter/SDK | raw event filters + `forwardSubagentText` | `_meta` ב-new/load session | test שה-meta נשמר גם ב-new וגם ב-load אם שניהם נתמכים |
| `_claude/sdkMessage` | parser טהור | `unknown` params | `parseClaudeSubagentEvent(params)` | fixtures לכל subtype/content block |
| parser | task reducer/index | event מנורמל | method יחיד שמקבל event | integration test על רצף events אמיתי |
| ACP `tool_call` | task index | `toolCallId` ובועת האב | index קיים או index ייעודי | raw assistant לפני/אחרי tool_call |
| task reducer | `ToolBubble` | `task`, `subFrames` | object replacement ב-`bubbles[index]` | Svelte VM test שמבחין בשינוי |
| `ToolBubble` | renderer פנימי | metadata + transcript | props בלבד; ללא parsing ברכיב | component/browser test |
| renderer פנימי | `AppShell` scroll-follow | שינוי גובה ו-user toggle | `chatScroll.noteUserIntent`, ResizeObserver/virtua flow קיים | streaming פתוח וקיפול ידני בלי jump |

הסיכון הגדול ביותר הוא גשר ACP `tool_call` ↔ raw event. אסור לבדוק parser ו-renderer בנפרד בלבד; חייב להיות לפחות test אחד שמזרים `tool_call` רגיל ואז raw `assistant` ומאשר שה-DOM/VM הסופי מכיל transcript בתוך אותה בועה.

---

## 8. חלוקה מומלצת לסלייסים

### B1 — `subagent-transcript-data-v2`

מטרת B1: להפוך raw SDK events למצב מנורמל בתוך בועת ה-Task, בלי UI חדש מעבר ל-test harness/diagnostics.

Scope משוער:

- fixture spike והקלטת רצף חי מלא.
- parser טהור עם runtime refinement.
- correlation/index עבור `taskId`/`toolUseId`/`parentToolUseId`.
- reducer טהור ל-task metadata ול-transcript.
- הרחבת bubble model ב-`task` ו-`subFrames`.
- wiring דרך `#onExtNotification`.
- טיפול ב-ordering, duplicates ו-unknown frames.
- unit + integration tests המבוססים על fixture אמיתי.

לא ב-B1:

- renderer מקונן production-ready.
- CSS, sticky header, max-height, collapse UX.
- וירטואליזציה פנימית.
- אימוץ fork.
- opencode/Codex subagents.

### B2 — `subagent-transcript-render`

מטרת B2: להציג את מצב B1 בתוך בועת Task נגישה, קריאה ויציבה בזמן streaming.

Scope משוער:

- זיהוי Task/Agent tool bubble והצגת identity/status/summary ייעודיים.
- transcript פנימי של message/thought/tool.
- אזור max-height עם overflow; החלטת sticky-bottom ברורה.
- collapse/expand בלי snap-back בזמן status update.
- שילוב `chatScroll.noteUserIntent` כדי שקיפול/פתיחה לא יקפיצו את הרשימה הראשית.
- depth guard לקינון נוסף.
- i18n לכל label; ללא מחרוזות עברית בקוד.
- mobile + desktop + RTL/LTR content handling.
- fixture streaming, Playwright screenshots, ו-flow חי עם Claude Task.

לא ב-B2:

- parser נוסף בתוך Svelte components.
- שינוי wire protocol BE↔FE.
- העברת raw JSON ישירות לרכיב.
- וירטואליזציה פנימית לפני שיש ראיה של transcript גדול שמצדיק אותה.

### B3 אפשרי — hardening רב-ספקי

רק לאחר B2:

- contract provider-neutral רשמי.
- adapters ל-opencode/Codex אם הם חושפים parent/lifecycle.
- nested depth > 1 לאחר ראיה חיה.
- persistence/replay של ext notifications, אם `session/load` אינו משחזר אותם.

---

## 9. Spike חובה לפני הפיכת B1 לבריף ביצועי

יש ליצור fixture raw מצונזר מסודות עבור תרחיש אחד לפחות:

1. prompt עליון מפעיל Task יחיד.
2. תת-הסוכן כותב לפחות שתי הודעות טקסט.
3. תת-הסוכן מפעיל כלי אחד לפחות.
4. המשימה מסתיימת בהצלחה.
5. אם אפשר, תרחיש נוסף של failure/cancel.

לכל frame יש לשמור timestamp וסדר הגעה של שני הערוצים:

- ACP `session/update`
- `_claude/sdkMessage`

השאלות שה-fixture חייב לענות עליהן:

- האם raw assistant הוא delta או snapshot מצטבר?
- האם `tool_use`/`tool_result` של תת-הסוכן מגיעים בתוך assistant content, כאירוע user, או בדרך אחרת?
- האם כל `task_*` נושא `task_id`; אילו מהם נושאים `tool_use_id`?
- האם `parent_tool_use_id` שווה בדיוק ל-ACP `toolCallId` של בועת האב?
- מה סדר ההגעה בין ACP tool_call, `task_started` ו-assistant ראשון?
- האם message ids יציבים מספיק לקיבוץ chunks ול-deduplication?
- מה מגיע ב-failure, cancel ו-background task?
- מה מתקבל ב-`session/load`: האם ext raw messages משוחזרים או רק live?
- האם תת-סוכן יכול להפעיל Task נוסף, ומה שרשרת ה-parent IDs?

אין לקבע append/grouping semantics לפני שהשאלות הראשונות נענו.

---

## 10. Anti-patterns — לא לעשות

- לא להחזיר את fork ה-Claude רק משום שה-feed הרגיל מסנן prose; raw ext path כבר הוכח.
- לא לבצע `params as SDKMessage` ולסמוך על package חיצוני בלי runtime guard.
- לא לערבב raw subagent text ב-`bubbles` הראשי.
- לא להציג raw SDK JSON למשתמשת כפתרון ביניים.
- לא להניח שכל raw assistant הוא chunk חדש; snapshots ייצרו כפילויות.
- לא ליצור segment חדש לכל delta מאותו message אם החוויה הרצויה היא טקסט זורם רציף.
- לא להשתמש ב-`null` כ-placeholder ל-parent id או task id. אם correlation טרם אפשרי, החזק pending event בצורה מפורשת ומוגבלת.
- לא לבצע mutation עמוקה בלבד (`task.subFrames.push`) ולהניח ש-Svelte/virtua ימדדו מחדש.
- לא לכתוב parser או correlation logic בתוך `ToolBubble.svelte`.
- לא לשכפל את `BubbleRenderer` רקורסיבית בלי depth guard ובלי החלטה על props/context.
- לא להסתפק בטסטי parser/reducer ירוקים; ה-flow החי וה-DOM הם gates נפרדים.
- לא לשנות את top-level adapter filtering; הוא מונע זליגת prose ל-feed הראשי.

---

## 11. סיכונים ומיטיגציות

| סיכון | השפעה | מיטיגציה מוצעת |
|---|---|---|
| ext notifications אינן חלק מ-session replay | transcript נעלם לאחר reload | לבדוק `session/load`; אם חסר, להחליט על persistence או להציג live-only במפורש |
| raw assistant הוא snapshot מצטבר | טקסט/כלים כפולים | fixture + reducer עם stable identity/deduplication |
| raw event מגיע לפני ACP tool_call | parent bubble לא קיים | pending-by-parent queue עם cap/expiry; flush ביצירת tool bubble |
| `task_updated` ללא `tool_use_id` | metadata לא נקשר לבועה | index `taskId -> parentToolUseId` שנבנה מ-event מוקדם יותר |
| שני Tasks במקביל | state מתערבב | maps לפי IDs; אין singleton currentTask |
| nested Task עמוק | recursion/layout runaway | depth field/guard; בדיקה לפחות depth 2 אם fixture מאפשר |
| transcript גדול | ToolBubble ענק וביצועי scroll גרועים | max-height ב-B2; וירטואליזציה פנימית נדחית עד מדידה |
| streaming משנה גובה בתוך virtua | jump/measurement stale | object replacement + flow חי עם follow/hold ו-ResizeObserver |
| user קיפל ואז status update | `<details>` נפתח מחדש | local `$state` מאותחל פעם אחת; לא `open={derivedSetting}` reactive |
| thinking/text מכילים כיווניות מעורבת | RTL לא קריא | `dir="auto"` לפרוזה, `dir="ltr"` לקוד/terminal; browser verification |
| event subtype חדש | session נשבר או מידע נזרק בשקט | unknown counter/debug hook; parser returns ignored/unknown ללא throw |
| provider coupling חודר ל-UI | קשה להוסיף ספקים | Claude parser נפרד, מודל task/subframe כללי |

---

## 12. DoD ראשוני ל-B1

זה אינו DoD סופי; מרדכי צריך להפוך אותו לפקודות וקבצים מדויקים לאחר ה-spike.

| # | התנהגות | אימות נדרש |
|---|---|---|
| 1 | fixture raw מייצג נשמר ללא secrets | review + parser tests עליו |
| 2 | כל `task_*` הידוע מתנרמל ללא throw | unit table tests |
| 3 | assistant עם parent נכנס רק ל-Task האב | VM integration test |
| 4 | top-level assistant/session updates נשארים ללא שינוי | regression test |
| 5 | שני Tasks מקבילים אינם מתערבבים | interleaved integration test |
| 6 | duplicate/snapshot אינו מכפיל transcript | replay same-frame test |
| 7 | event-before-parent נשמר ומתחבר לאחר tool_call | ordering test |
| 8 | unknown subtype/content אינו מפיל session | malformed/unknown tests |
| 9 | שינוי `subFrames` נראה reactive לצרכן | AgentSession state test |
| 10 | provider/frontend typecheck + suites ירוקים | פקודות package מדויקות בבריף |
| 11 | live Task מוכיח transcript state מלא | verifier-phase אחרי wiring |

---

## 13. DoD ראשוני ל-B2

| # | התנהגות | אימות נדרש |
|---|---|---|
| 1 | Task מוצג עם identity/status קריאים ולא JSON גולמי | browser + screenshot |
| 2 | text/thought/tool של תת-הסוכן מופיעים בתוך אותה בועה | fixture + live Task |
| 3 | שום subagent prose אינו מופיע כבועה עליונה | DOM assertion |
| 4 | streaming פתוח מתעדכן ללא כפילות או קפיצות חריגות | Playwright/live flow |
| 5 | קיפול ידני נשמר בזמן progress/completion | interaction test |
| 6 | גלילה למעלה אינה נמשכת בכוח לתחתית | user-intent flow |
| 7 | mobile ו-desktop אינם חורגים/חופפים | screenshots בשני viewports |
| 8 | Hebrew/English/code מוצגים בכיוון נכון | RTL/LTR fixture |
| 9 | transcript ארוך מוגבל בגובה ונגיש בגלילה | long fixture |
| 10 | failure/cancel מקבלים status ברור | fixture/live אם אפשר |
| 11 | production preview נבנה ומוגש ב-HTTPS | AGENTS.md preview gate |

B2 צריך `verifier-slice-heavy`: זה שילוב של streaming, nested layout, virtua, user-intent ו-UI חזותי. טסטים ירוקים לבדם אינם מספיקים.

---

## 14. שאלות פתוחות והמלצות ברירת מחדל

| # | שאלה | ברירת מחדל מוצעת | חוסם |
|---|---|---|---|
| 1 | האם B1 ו-B2 נשארים נפרדים? | כן; B1 data, B2 UI | לא |
| 2 | היכן parser/reducer הטהור יישב? | מודול kebab-case ליד `agent-session.svelte.ts`, אלא אם נמצא contract קיים מתאים | כן, בכתיבת הבריף |
| 3 | ArkType או guards ידניים ל-raw SDK? | ArkType אם shapes יציבים; guards ממוקדים אם unions רחבים/משתנים | כן, אחרי קריאת types/fixture |
| 4 | האם `SubFrame` reuses `Bubble`? | כן, אך בלי `UserBubble`; לקבע אחרי בדיקת tool blocks | לא |
| 5 | האם הנתונים רקורסיביים? | כן במודל עם depth guard; UI תומך לפחות depth 1 | לא |
| 6 | מה עושים כש-parent טרם קיים? | pending queue bounded, לא זליגה ל-top-level | לא |
| 7 | האם transcript נשמר ב-replay/history? | לבדוק לפני הבטחה; live-only אינו שווה feature מלא | כן ל-scope הסופי |
| 8 | ברירת מחדל פתוח או סגור? | פתוח בזמן ריצה, נשאר לפי בחירת המשתמשת לאחר toggle; טעון החלטת UX | לא |
| 9 | האם מציגים thinking? | כן, collapsible ובאותן הגדרות thought קיימות | לא |
| 10 | האם מציגים כל כלי פנימי? | כן, compact; raw details לפי renderer הקיים | לא |
| 11 | האם `background_tasks_changed` נכנס ל-B1? | לא, אלא אם fixture מוכיח שהוא נדרש ל-status/correlation | לא |
| 12 | האם מתקנים גם `command_lifecycle` noise? | סלייס קטן נפרד; לא לערבב | לא |
| 13 | האם למחוק את שני הבריפים הישנים? | לא; לסמן superseded/archive לאחר שהבריפים החדשים READY | לא |

---

## 15. תוכנית להפיכת המסמך לבריפים מוכנים

1. למזג תחילה את `slice/acp-stack-upgrade` ל-`dev`; הוא dependency אמיתי.
2. להריץ fixture spike מתוך base המעודכן ולשמור raw event sequence מצונזר.
3. לקרוא את SDK types של הגרסה הנעולה ולאמת כל field בטבלאות §4.
4. להכריע בשאלות החוסמות: replay, parser placement, runtime schema ו-dedup semantics.
5. מרדכי משכתב את `slice-subagent-transcript-data.md` כ-B1 v2 או יוצר שם חדש ומארכב את הישן.
6. ליצור `state.json` עם `depends_on` מדויק ו-dev tip עדכני.
7. אביגיל מאמתת את B1 מול הקוד וה-fixture עד READY.
8. רק לאחר B1 GO, לכתוב JIT את B2 לפי המודל שנחת בפועל.
9. אביגיל מאמתת B2; אליעזר מבצע; כלב-heavy מריץ fixture + Task חי + browser screenshots.

המסמך הזה אינו מאשר implementation ואינו מחליף את plan-gate.
