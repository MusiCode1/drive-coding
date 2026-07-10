# Slice B1 — subagent-transcript-data — תוכנית

> **תאריך**: 2026-07-06
> **סטטוס**: טיוטה
> **Complexity**: 7/10 (verifier: light — calev; ה-UI ב-B2 calev-heavy)
> **depends_on**: [`claude-subagent-adapter-fork`] (Slice A — ה-fork; נדחף ל-`origin/drive-coding`)
> **base**: dev + חיבור github-dep ל-fork
> **מזין**: Slice B2 `subagent-transcript-render` (ה-renderer, טרם brief)

---

## §1 — מטרה

drive-coding מקבל היום frames מקוננים של תת-סוכן (Task/subagent) אבל **זורק אותם בשקט**: ה-VM (`#onSessionUpdate`) עושה cast ידני שמשמיט את `_meta`, ולכן `_meta.claudeCode.parentToolUseId` (הקינון) ו-`_meta.claudeCode.task` (המטא-דאטה) לא מגיעים למודל. התוצאה: בועת Task גנרית עם JSON גולמי, בלי ה-transcript של תת-הסוכן.

**אחרי B1**: ה-VM קורא את ה-`_meta`, ומנתב כל frame מקונן (`parentToolUseId` נוכח) אל **תוך** בועת ה-Task (מערך `subFrames`) במקום ל-`bubbles` הראשי, וממזג את ה-task-metadata (subagent_type/prompt/summary/last_tool_name/status) לבועת ה-Task. זו **שכבת-הנתונים בלבד** — ה-`bubbles` הראשי נשאר שטוח (וירטואליזציה לא נוגעת). הרינדור (האזור-הנגלל בתוך הבועה) הוא Slice B2.

**גישת "transcript בתוך הבועה"** (הכרעת-משתמשת): הקינון חי **בתוך** ה-Task bubble כמערך פנימי — לא כעץ ב-`bubbles` הראשי. כך הווירטואליזציה השטוחה נשמרת (Task = bubble יחיד), ואין derived-tree/indent.

**רקע חי**: אומת מקצה-לקצה שה-frames זורמים כך (worktree `subagent-smoke`, `proseFrameCount` 2→4 עם `forwardSubagentText`). ר' `decisions/drive-coding.md` (smoke + forwardSubagentText).

---

## §2 — Scope

| פריט | כן/לא | לאן |
|------|-------|-----|
| חיבור github-dep ל-fork (`claude-agent-acp#drive-coding`) | ✅ | Commit 0 |
| `injectForwardSubagentText` (config) — **כבר כתוב+מאומת חי** | ✅ | Commit 0 |
| קריאת `_meta.claudeCode` ב-`#onSessionUpdate` | ✅ | Commit 1 |
| הרחבת `bubble.ts`: `subFrames` + `task?` (additive) | ✅ | Commit 1 |
| ניתוב frames מקוננים → `subFrames` של ה-Task bubble | ✅ | Commit 2 |
| הצטברות chunks (text/thought) בתוך `subFrames` | ✅ | Commit 2 |
| merge task-metadata → `ToolCall.task` | ✅ | Commit 3 |
| **רינדור** האזור-הנגלל בתוך הבועה | ❌ | **Slice B2** |
| **וירטואליזציה פנימית** של transcript ענק | ❌ | future (trade-off מודע — §6) |
| **opencode** subagent (משטח — ר' decisions) | ❌ | spike נפרד |

> **הגנת-scope**: ה-`bubbles` הראשי **נשאר מערך שטוח**. אין nesting במערך הראשי, אין derived-tree, אין indent. הקינון = מערך פנימי (`subFrames`) על ה-Task bubble בלבד.

---

## §3 — Architecture

```
frame נכנס (_meta.claudeCode.*)
   │
   ▼  #onSessionUpdate (agent-session.svelte.ts:1483)
   │
   ├─ has _meta.claudeCode.parentToolUseId?
   │     ├─ YES → idx = this.bubbles.findIndex(b.kind==="tool" && toolCallId===parentToolUseId)
   │     │        └─ #routeToSubFrames(idx, update) → object-replace bubbles[idx].subFrames
   │     │           (NOT this.bubbles; NOT the #toolBubbleByCallId Map — it has zero readers)
   │     └─ NO  → נתיב קיים (this.bubbles) — ללא שינוי
   │
   └─ has _meta.claudeCode.task?  → merge subagent_type/prompt/summary/last_tool_name/status
                                     into taskBubble.toolCall.task   (toolCallId = task's)
```

**מבנה-נתונים** (`bubble.ts`, additive):
```ts
// subFrames = תת-בועות בתוך ה-Task. reuse של מבנה Bubble הקיים (message/thought/tool).
export type SubFrame = MessageBubble | ThoughtBubble | ToolBubble  // subset מספיק

export type TaskMeta = {
  subagentType?: string
  prompt?: string
  summary?: string
  lastToolName?: string
  status?: string          // task_notification.status
}

export type ToolCall = {
  /* ... הקיים ... */
  task?: TaskMeta                 // ← additive (Commit 3)
}
export type ToolBubble = BubbleBase & {
  kind: "tool"
  messageId: null
  toolCall: ToolCall
  segments: never[]
  subFrames?: SubFrame[]          // ← additive (Commit 1); undefined = לא-Task
}
```

---

## §4 — Commits בסדר

### Commit 0 — config: github-dep + injectForwardSubagentText (approach: manual)

**(א) חיבור ה-fork** ב-`packages/provider/package.json` (`devDependencies`, שם `claude-agent-acp` יושב היום):
```json
"@agentclientprotocol/claude-agent-acp": "github:MusiCode1/claude-agent-acp#d6891f8"
```
> **pin ל-SHA** `d6891f8` (לא `#drive-coding`) ליציבות (Q1). ה-`prepare` script בונה dist ב-install (אומת חי ב-Windows).

**(ב) `injectForwardSubagentText`** ב-`packages/provider/src/connection/connect-in-process.ts` — **כבר כתוב ומאומת חי** ב-worktree. תאום מדויק ל-`injectModelOverride`, מזריק `_meta.claudeCode.options.forwardSubagentText: true`, מחווט בשרשרת `session/new`:
```ts
const withModel = injectModelOverride(ctx.params, opts.modelOverride)
const withSubagent = injectForwardSubagentText(withModel)   // ← חדש
const params = injectEnvOverride(withSubagent, envOverride) as NewSessionRequest
```

**Verification**: `pnpm install` (dist נבנה) · `pnpm --filter @drive-coding/provider typecheck` · live smoke קיים (`subagent-smoke.live.test.ts`) → `proseFrameCount ≥ 4`.

> ⚠️ **known**: typecheck ב-provider הראה 3 שגיאות pre-existing (codex declaration + 2 tests) — לא קשורות; לוודא שהן **זהות** ל-baseline dev (לא רגרסיה מ-B1).

---

### Commit 1 — read _meta + extend bubble model (approach: TDD)

**קובץ**: `packages/frontend/src/lib/types/bubble.ts` — הוסף `SubFrame`, `TaskMeta`, `ToolCall.task?`, `ToolBubble.subFrames?` (additive, §5 — variant/field חדש).

**קובץ**: `agent-session.svelte.ts:1486-1499` — הרחב את ה-cast של `update` לכלול `_meta`:
```ts
const update = notification.update as {
  /* ... הקיים ... */
  _meta?: { claudeCode?: { parentToolUseId?: string; task?: Record<string, unknown> } }
}
```
+ helper טהור `parseTaskMeta(raw)` (TDD): frame גולמי → `TaskMeta` (מיפוי subagent_type→subagentType וכו').

**Test** (core/VM unit): `parseTaskMeta` על frame `task_started`/`task_progress`/`task_notification` → `TaskMeta` נכון.

---

### Commit 2 — route nested frames into subFrames (approach: TDD)

**קובץ**: `agent-session.svelte.ts` — **בראש `#onSessionUpdate`, לפני שורה 1504** (לפני ה-dispatch של tool_call/tool_call_update ולפני ה-text-gate), בדוק `parentToolUseId`:
```ts
const parentId = update._meta?.claudeCode?.parentToolUseId
if (parentId) {
  const idx = this.bubbles.findIndex(
    (b) => b.kind === "tool" && b.toolCall.toolCallId === parentId,
  )
  if (idx !== -1) { this.#routeToSubFrames(idx, update); return }
  // parent לא נמצא (מרוץ נדיר; ב-raw ה-Task tool_call תמיד קודם) → ליפול לנתיב הראשי (לא לזרוק)
}
```
> ⚠️ **מדוע לפני 1504**: ה-nested frames הם `sessionUpdate: "tool_call"/"tool_call_update"/"agent_message_chunk"/"agent_thought_chunk"` — הם היו נתפסים ע"י ה-dispatch הקיים (1504/1508/1564) ונכנסים ל-`bubbles` הראשי. ה-check על `parentToolUseId` **חייב לקדם** אותם.

**`#routeToSubFrames(idx, update)`** — מיני-dispatch לתוך `subFrames` של ה-Task bubble ב-`bubbles[idx]`:
- `tool_call` → ToolBubble חדש ל-subFrames.
- `tool_call_update` → מצא+עדכן ב-subFrames.
- `agent_message_chunk`/`agent_thought_chunk` → append segment לתת-בועה אחרונה לפי kind+messageId.

**⚠️ reactivity (finding אביגיל #2)**: `#toolBubbleByCallId.get()` (ו-`this.bubbles[idx]` ה-ref) מחזירים את ה-**ref הגולמי**; push עליו **לא בהכרח מצית Svelte 5**. לכן `#routeToSubFrames` **חייב לסיים ב-object-replacement** של ה-Task bubble (תבנית `#handleToolCallUpdate:1658`): לבנות `subFrames` מעודכן ואז `this.bubbles[idx] = { ...task, toolCall: { ...task.toolCall }, subFrames: newSubFrames }`. **לא** push גולמי דרך ה-Map-ref.

**Test**: frame עם `parentToolUseId` → נכנס ל-`taskBubble.subFrames`, **לא** ל-`this.bubbles` (אורך bubbles הראשי לא גדל). + top-level frame (בלי parent) → נתיב רגיל (regression).

---

### Commit 3 — merge task metadata (approach: TDD)

**⚠️ מיקום קריטי (finding אביגיל #1)**: ה-task-metadata רוכב על frames מסוג **`tool_call_update`** (`_meta.claudeCode.task`, `toolCallId = tool_use_id ?? task_id`, **בלי** `parentToolUseId`). frame כזה **פוגע ב-`if (sessionUpdate === "tool_call_update")` בשורה 1508 → `#handleToolCallUpdate; return`** — לפני כל handler גנרי. לכן ה-merge **חייב לחיות בתוך `#handleToolCallUpdate`** (handler נפרד אחרי ה-dispatch = **dead code**: ה-unit-test יעבור בבידוד אך ייכשל חי).

**קובץ**: `agent-session.svelte.ts` — בתוך `#handleToolCallUpdate` (1619), אחרי מציאת ה-bubble ובאותה object-replacement של ה-update הרגיל: אם `update._meta?.claudeCode?.task` נוכח, מזג `parseTaskMeta(task)` ל-`toolCall.task` (`{ ...old, toolCall: { ...newToolCall, task: mergedTask } }`, merge לא-דריסה מול `task` קודם).

> **ordering מול Commit 2**: task frames **אין** להם `parentToolUseId` (ה-toolCallId שלהם = ה-Task tool_call עצמו, top-level ביחס אליו), אז ה-check של Commit 2 **לא** תופס אותם → הם ממשיכים ל-1508 → `#handleToolCallUpdate` כרגיל. אין התנגשות.

**Test**: הזרם `tool_call`(Task) → `tool_call_update{_meta.task: task_started(subagent_type,prompt)}` → `...task_progress(last_tool_name)` → `...task_notification(summary,status)`. אמת ש-`bubbles[taskIdx].toolCall.task` מצטבר נכון (merge, לא דריסה).

---

## §5 — DoD verifiable

| בדיקה | איך |
|-------|-----|
| github-dep נבנה + provider typecheck | `pnpm install` → dist קיים; typecheck 3-errors זהים ל-baseline |
| live smoke `proseFrameCount ≥ 4` | `RUN_LIVE=1` על `subagent-smoke.live.test.ts` |
| `parseTaskMeta` נכון | unit test (Commit 1) |
| nested frame → subFrames, לא bubbles הראשי | unit test (Commit 2) |
| top-level frame לא נשבר | regression test (Commit 2) |
| task-meta מצטבר | unit test (Commit 3) |
| build-gate | `pnpm typecheck` + `pnpm test` ירוקים |

> **אין UI ב-B1** — הכל VM/unit-verifiable. האימות-החי-בדפדפן הוא DoD של B2.

---

## §6 — Risks

| סיכון | מיטיגציה |
|-------|----------|
| ~~`#appendChunk` optional-target~~ **נסגר** (Q2) | נבחר **mini-dispatch נפרד** (`#routeToSubFrames`) — אפס נגיעה ב-`#appendChunk` הקיים |
| task-meta נכתב כ-handler נפרד → dead code (early-return :1508) | ה-merge **בתוך `#handleToolCallUpdate`** (§4 Commit 3, finding #1); test חי ב-DoD |
| parent bubble לא נמצא (frame מגיע לפני ה-Task tool_call) | fallback לנתיב הראשי (לא לזרוק); ב-raw ה-Task tool_call תמיד קודם |
| transcript פנימי ענק לא-מווירטואל | **trade-off מודע** — max-height+overflow ב-B2; וירטואליזציה פנימית = future |
| reactivity לא מצתה על subFrames push | החלפת-אובייקט (תבנית `#handleToolCallUpdate:1658`) |
| SHA pin מתיישן | Q1 — pin מכוון ליציבות; bump מודע בעדכון fork |

---

## §7 — Escalation

עצור ושאל את מרדכי אם:
- ~~הוספת optional `target` שוברת test~~ **נסגר** (Q2: נבחר mini-dispatch, אפס נגיעה ב-`#appendChunk`).
- מבנה ה-`_meta` על ה-wire שונה ממה שה-smoke הראה (`parentToolUseId`/`task` לא במקום הצפוי).
- ה-cast של `update` דורש שינוי מבני מעבר להוספת `_meta` (לא צפוי).
- ה-object-replacement ב-`#routeToSubFrames` לא מצית reactivity למרות התבנית (בעיית Svelte 5 עמוקה).

---

## §8 — Complexity

- commits: 4 · שכבות: VM + provider-config · streaming: לא (unit) · protocol: קריאת `_meta` (+1) · INVASIVE-risk: optional-target (+1)
- **Score 7/10 → light (calev)**. הליבה VM-unit-testable; ה-UI (B2) הוא ה-calev-heavy.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת-מחדל | חוסם? |
|---|------|-----------|-------|
| 1 | github-dep: `#drive-coding` (branch) או `#d6891f8` (sha)? | **sha** (יציבות) | ❌ |
| 2 | ✅ **הוכרע** — `subFrames`: reuse `#appendChunk` או mini-dispatch? | **mini-dispatch ייעודי** (`#routeToSubFrames`, §4 Commit 2). finding אביגיל #2: reuse-push לא מצית reactivity על subFrames פנימי; mini-dispatch עם object-replacement נקי ואינו נוגע ב-`#appendChunk` הקיים. | ✅ נסגר |
| 3 | `SubFrame` = subset של `Bubble` (reuse renderer ב-B2) או type ייעודי? | subset של Bubble (reuse `BubbleRenderer` ב-B2) | ❌ |
| 4 | האם ה-task-meta צריך גם `is_backgrounded` (task_updated.patch)? | לא בסבב זה — subagent_type/prompt/summary/last_tool/status מספיק ל-B2 | ❌ |
| 5 | `SubFrame` מחריג `UserBubble` (finding אביגיל #3) — variance? | ה-mini-dispatch (Q2) בונה רק message/thought/tool — אין `UserBubble` ב-subFrames, ו-`SubFrame` type מדויק. משנבחר mini-dispatch (לא reuse עם `target:Bubble[]`) — ה-variance-nuance נעלם. | ❌ |
