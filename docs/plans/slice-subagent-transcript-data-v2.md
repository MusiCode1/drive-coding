# Slice B1-v2 — subagent-transcript-data — תוכנית

> **תאריך**: 2026-07-11
> **סטטוס**: טיוטה (ממתין אביגיל)
> **Complexity**: 7/10 (verifier: light — calev; ה-UI ב-B2 calev-heavy)
> **depends_on**: [`acp-stack-upgrade`] (מוזג ל-dev v0.17.0 — ה-raw-SDK path חי)
> **base**: dev @ v0.17.0
> **מזין**: Slice B2 `subagent-transcript-render` (renderer, טרם brief)
> **מחליף**: `slice-subagent-transcript-data.md` (v1 — הניח fork + `_meta` על `session/update`; הופרך ע"י acp-stack + spike)
> **מבוסס-ראיה**: `spike-subagent-transcript-fixture.md` + fixture חי + `decisions/drive-coding.md` (spike Gate-1)

---

## §1 — מטרה

אחרי `acp-stack-upgrade` (upstream `claude-agent-acp@0.58.1`, **בלי fork**), drive-coding מקבל את
פעילות תת-הסוכן דרך ערוץ **`_claude/sdkMessage`** (ext notification, מבוקש ע"י
`CLAUDE_SESSION_META.emitRawSDKMessages`), אבל **זורק אותו**: `#onExtNotification` רק **סופר**
(`#claudeRawSdkMessageCount += 1`) ומזניח את התוכן. התוצאה: בועת Task גנרית בלי transcript.

**אחרי B1**: `#onExtNotification` **מנתח** כל `_claude/sdkMessage`, **מקשר** אותו לבועת ה-Task האב
(דרך `parent_tool_use_id` == ACP `toolCallId`), וממלא `subFrames` (transcript מקונן) + `task` metadata
**בתוך** בועת ה-Task. זו **שכבת-נתונים בלבד** — `bubbles` הראשי נשאר שטוח; הרינדור הוא B2.

**עקרון "transcript בתוך הבועה"** (הכרעת-משתמשת): הקינון חי כמערך פנימי (`subFrames`) על ה-Task
bubble — לא כעץ ב-`bubbles`. הווירטואליזציה השטוחה (`virtua`) לא נוגעת.

> **הבדל-מפתח מ-v1**: המקור **אינו** `session/update._meta.claudeCode.parentToolUseId` (הנחת-ה-fork).
> המקור הוא raw SDK messages ב-`_claude/sdkMessage` דרך `#onExtNotification` — **נתיב אחר לגמרי**.

---

## §2 — עובדות שה-spike קבע (fixture חי, `__fixtures__/subagent-task-single.json`)

מבנה ה-envelope: `params = { sessionId, message }`, כש-`message` = SDK message.

| SDK `message.type` | תפקיד | שדות-מפתח |
|---|---|---|
| `assistant` (+`parent_tool_use_id`) | text/thinking/tool_use של תת-הסוכן | `.message.id` (יציב, לקיבוץ), `.message.content[]` (blocks), `.parent_tool_use_id`, `.subagent_type`, `.task_description` |
| `user` (+`parent_tool_use_id`) | **tool_result** של כלי תת-הסוכן | `.message.content[]` (בלוק `tool_result` עם `tool_use_id`), **אין `.message.id`** (מפתח: `uuid`/`tool_use_id`) |
| `system` subtype `task_started` | identity | `task_id`, `tool_use_id`, `subagent_type`, `description`, `prompt` |
| `system` subtype `task_progress` | התקדמות | `task_id`, `tool_use_id`, `last_tool_name`, `usage` |
| `system` subtype `task_notification` | סיום/summary | `task_id`, `tool_use_id`, `status`, `summary` |
| `system` subtype `task_updated` | patch | `task_id`, `patch` — **אין `tool_use_id`** |

**הכרעות מבוססות-ראיה** (ר' decisions §9):
- **Q1 DELTAS**: assistant frames הם דלתות — אותו `message.id` חוזר עם block שונה → **append מקובץ לפי `message.id`** (+ dedup הגנתי מפני snapshot).
- **Q4 correlation מדויק**: `parent_tool_use_id` == ACP `toolCallId` של ה-Task (`⊆` מלא, 2 הרצות).
- **Q3 index**: `task_updated` בלי `tool_use_id` → צריך index `task_id → tool_use_id` שנבנה מ-`task_started`.
- **Q7 live-only**: `session/load` **לא** משחזר את ה-ext → transcript נעלם ב-reload (ר' §9, החלטת-scope).

---

## §3 — Scope

| פריט | כן/לא | לאן |
|------|-------|-----|
| **תיקון `CLAUDE_SESSION_META`: הוסף `{type:"user"}`** (בלי זה — אין tool_result) | ✅ | Commit 0 |
| parser טהור `parseClaudeSdkMessage(unknown) → ClaudeSubagentEvent \| ignored` | ✅ | Commit 1 |
| הרחבת `bubble.ts`: `subFrames?` + `task?` + טיפוסי-event (additive) | ✅ | Commit 1 |
| index correlation (`taskId→toolUseId`) + reducer טהור | ✅ | Commit 2 |
| wiring ב-`#onExtNotification` (החלפת ה-counter) + object-replacement | ✅ | Commit 3 |
| **רינדור** האזור-הנגלל | ❌ | **B2** |
| וירטואליזציה פנימית | ❌ | future (§6) |
| persistence ל-`session/load` (Q7) | ❌ | **B3** או live-only (§9) |
| opencode/Codex subagents | ❌ | spike נפרד |

> **הגנת-scope**: `bubbles` הראשי נשאר שטוח. אין nesting/derived-tree/indent. הקינון = `subFrames` על ה-Task bubble בלבד.

---

## §4 — Architecture

```
_claude/sdkMessage (ext notification)
   │
   ▼  #onExtNotification(method, params)   [agent-session.svelte.ts]
   │   method === "_claude/sdkMessage"  → (היום: this.#claudeRawSdkMessageCount++ ; return)
   │
   ├─ parseClaudeSdkMessage(params)  → ClaudeSubagentEvent | { kind: "ignored" }   [pure, Commit 1]
   │     • system task_*                → { kind:"task", subtype, taskId, toolUseId?, patch?, meta }
   │     • assistant + parent_tool_use_id → { kind:"assistantDelta", parentToolUseId, messageId, blocks }
   │     • user + parent_tool_use_id    → { kind:"toolResult", parentToolUseId, blocks }
   │     • ללא parent (top-level)       → { kind:"ignored" }   (אל תזלוג; ה-ACP path כבר מטפל)
   │
   ├─ #subagentIndex.resolve(event)  → parentToolUseId   [Commit 2]
   │     • task_started: index[taskId] = toolUseId
   │     • task_updated (בלי toolUseId): parentToolUseId = index[taskId]
   │
   ├─ idx = this.bubbles.findIndex(b.kind==="tool" && toolCall.toolCallId === parentToolUseId)
   │     • idx === -1 → pending-by-parent (bounded, §6); flush כשה-Task tool_call נוצר
   │
   └─ reduceSubagent(taskBubble, event) → taskBubble'   [pure, Commit 2]
        • assistantDelta: append blocks בקבוצת messageId (dedup)
        • toolResult:     append לבלוק ה-transcript
        • task:           merge meta → toolCall.task
      ↓  object-replacement:  this.bubbles[idx] = taskBubble'   (Svelte 5 + virtua measure)
```

**מבנה-נתונים** (`bubble.ts`, additive בלבד):
```ts
export type SubagentTaskStatus = "pending" | "in_progress" | "completed" | "failed" | "unknown"

export type TaskMeta = {
  taskId?: string
  subagentType?: string
  prompt?: string
  summary?: string
  lastToolName?: string
  status: SubagentTaskStatus
}

// subset של Bubble — message/thought/tool בלבד (אין UserBubble). reuse ל-renderer ב-B2.
export type SubFrame = MessageBubble | ThoughtBubble | ToolBubble

export type ToolCall = { /* ...הקיים... */ task?: TaskMeta }            // additive
export type ToolBubble = BubbleBase & {
  kind: "tool"; /* ...הקיים... */ subFrames?: SubFrame[]                 // additive; undefined = לא-Task
}
```

---

## §5 — Commits בסדר

### Commit 0 — CLAUDE_SESSION_META: הוסף `{type:"user"}` (approach: manual)
**קובץ**: `agent-session.svelte.ts`, `CLAUDE_SESSION_META.claudeCode.emitRawSDKMessages` — הוסף
`{ type: "user" }` לרשימה (אחרי `{ type: "assistant" }`). בלי זה, `tool_result` של כלי תת-הסוכן
לא זורם (spike Q2). **אימות**: harness `spike-subagent-fixture.ts` מראה `raw user ≥ 1` עם בלוק `tool_result`.

### Commit 1 — parser טהור + bubble model (approach: TDD על ה-fixture)
**קובץ חדש**: `packages/frontend/src/lib/view-models/claude-subagent-parse.ts` — `parseClaudeSdkMessage`.
קלט `unknown`, refinement מפורש (guards ממוקדים — ה-shapes של SDK unions רחבים; **לא** `as SDKMessage`).
**קובץ**: `bubble.ts` — הוסף `TaskMeta`/`SubagentTaskStatus`/`SubFrame`/`ToolCall.task?`/`ToolBubble.subFrames?`.
**Test** (table, על ה-fixture): כל 6 סוגי-ה-`message` → event נכון; top-level (בלי parent) → `ignored`;
malformed/unknown subtype → `ignored` (לא throw).

### Commit 2 — index + reducer טהורים (approach: TDD על ה-fixture)
**קובץ**: `claude-subagent-parse.ts` (או מודול-אח) — `createSubagentIndex()` (`taskId→toolUseId`) +
`reduceSubagent(taskBubble, event) → taskBubble` (immutable):
- `assistantDelta` → מצא/צור SubFrame לפי `messageId`, append blocks (dedup לפי (messageId, block)).
- `toolResult` → append SubFrame (מפתח `uuid`/`tool_use_id`, אין `message.id`).
- `task` → merge `TaskMeta` (לא-דריסה; `status` נגזר: started→in_progress, notification.status→completed/failed).

> **finding #5 — id דטרמיניסטי ל-SubFrame**: `SubFrame` הוא `BubbleBase` → דורש `id`/`createdAt`.
> reducer **טהור** לא יכול `Date.now()`/random (שובר טסטים). גזור `id` דטרמיניסטית מהאירוע:
> `assistantDelta` → `sub:${parentToolUseId}:${messageId}`; `toolResult` → `sub:${parentToolUseId}:${uuid ?? tool_use_id}`.
> `createdAt` — או להעביר `now` כפרמטר להזרקה (תבנית `wire-recorder`), או שדה אופציונלי. כך הטסטים דטרמיניסטיים.
**Test**: (א) delta append — 3 frames אותו `message.id` → SubFrame אחד עם 3 blocks (לא 3 SubFrames);
(ב) dedup — אותו frame פעמיים → אין כפילות; (ג) **שני Tasks מקבילים** (fixture או סינתטי) → לא מתערבבים;
(ד) `task_updated` בלי toolUseId → נפתר דרך index.

### Commit 3 — wiring ב-#onExtNotification (approach: TDD — VM integration על replay)
**קובץ**: `agent-session.svelte.ts`, `#onExtNotification`. **ערוך אך-ורק את ה-body של ענף
`if (method === "_claude/sdkMessage")`** — **אל תיגע** בענף `if (method === "_drive/capabilities")`
(ולא בענפים עתידיים). מבנה קיים (לשימור מלבד ה-body הראשון):
```ts
#onExtNotification = (method, params) => {
  if (method === "_claude/sdkMessage") {
    this.#claudeRawSdkMessageCount += 1        // ← שמור! (finding #1) — הטסט
    // agent-session.capabilities.test.svelte.ts:191 מצפה count===2. אחריו:
    const ev = parseClaudeSdkMessage(params)
    if (ev.kind === "ignored") return
    const parentId = this.#subagentIndex.resolve(ev)
    if (!parentId) { this.#pendingByParent.push(ev); return }   // אין parent עדיין
    const idx = this.bubbles.findIndex((b) => b.kind === "tool" && b.toolCall.toolCallId === parentId)
    if (idx === -1) { this.#pendingByParent.push(ev); return }  // bounded (§7)
    const task = this.bubbles[idx]                              // Bubble|undefined (noUncheckedIndexedAccess)
    if (!task || task.kind !== "tool") return                  // guard (finding #3) — narrow ל-ToolBubble
    this.bubbles[idx] = reduceSubagent(task, ev)               // object-replacement
    return
  }
  if (method === "_drive/capabilities") { /* ...קיים — ללא שינוי... */ }
}
```
> **finding #1**: הענף שומר את ה-`#claudeRawSdkMessageCount += 1` הקיים → הטסט
> `agent-session.capabilities.test.svelte.ts:182,191` (0→2) נשאר ירוק. **finding #2**: רק ה-body של
> ענף `_claude/sdkMessage` משתנה; שאר הענפים (`_drive/capabilities`) נשארים — העתקה-verbatim שמוחקת
> אותם תשבור capability-gating. **finding #3**: `this.bubbles[idx]` הוא `Bubble|undefined` תחת
> `noUncheckedIndexedAccess` → guard `!task || task.kind !== "tool"` לפני `reduceSubagent` (שמצפה `ToolBubble`).

+ flush pending כשנוצר Task tool_call (ב-`#handleToolCall`).
**Test** (VM integration, replay ה-fixture דרך `#onExtNotification`): (א) subFrames מתמלא, **`bubbles` הראשי
לא גדל**; (ב) top-level assistant/session-update ללא שינוי (regression); (ג) `parentToolUseId` מקושר לבועה הנכונה;
(ד) הטסט הקיים של ה-counter (0→2) נשאר ירוק.

---

## §6 — DoD verifiable

| בדיקה | איך |
|-------|-----|
| `{type:"user"}` נוסף → tool_result זורם | harness `spike-subagent-fixture.ts` (`raw user ≥ 1`, בלוק tool_result) |
| parser: 6 סוגי-message → event; unknown → ignored ללא throw | table tests על fixture (Commit 1) |
| reducer: delta append לפי messageId | unit (Commit 2) |
| reducer: dedup snapshot | replay-same-frame (Commit 2) |
| שני Tasks מקבילים לא מתערבבים | interleaved unit (Commit 2) |
| VM: subFrames מתמלא, bubbles הראשי לא גדל | integration replay (Commit 3) |
| top-level frames ללא שינוי | regression (Commit 3) |
| build-gate | `pnpm --filter @drive-coding/frontend typecheck` + `pnpm test` ירוקים |
| live: Task אמיתי → transcript state מלא | verifier-phase (calev): harness מול claude חי |

> **אין UI ב-B1** — הכל VM/unit-verifiable. האימות-החזותי-בדפדפן הוא DoD של B2.

---

## §7 — Risks

| סיכון | מיטיגציה |
|-------|----------|
| raw assistant הוא snapshot מצטבר (לא delta) | spike קבע DELTAS; reducer בכל-זאת מ-dedup לפי (messageId, block) — עמיד לשניהם |
| event לפני יצירת ה-Task tool_call | `#pendingByParent` bounded (cap+expiry); flush ב-`#handleToolCall` |
| `task_updated` בלי `tool_use_id` | index `taskId→toolUseId` מ-`task_started` (Commit 2) |
| `user` message בלי `message.id` | מפתח SubFrame לפי `uuid`/`tool_result.tool_use_id`, לא `message.id` |
| object-replacement לא מצית reactivity | תבנית `#handleToolCallUpdate` (object-replace מלא של ה-Task bubble) |
| top-level prose זולג ל-`bubbles` | parser מחזיר `ignored` על message ללא parent |
| transcript ענק לא-מווירטואל | trade-off מודע — max-height ב-B2; וירטואליזציה פנימית = future |
| SDK shape משתנה בגרסה | guards ממוקדים + `ignored` על unknown; לא `as SDKMessage` |

---

## §8 — Escalation

עצור ושאל את מרדכי אם:
- מבנה ה-`_claude/sdkMessage` על ה-wire שונה מה-fixture (`params.message.type`/`parent_tool_use_id` לא במקום).
- ה-reducer דורש snapshot-semantics (assistant מתגלה מצטבר, לא delta) — משנה §5 Commit 2.
- object-replacement לא מצית reactivity למרות התבנית (Svelte 5 עמוק).
- Q7 (persistence) מתברר כחוסם-ערך ל-MVP (ר' §9) — החלטת-scope של מרדכי/משתמשת.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת-מחדל | חוסם? |
|---|------|-----------|-------|
| 1 | ~~Q7 — transcript live-only~~ **הוכרע (משתמשת 2026-07-11): LIVE-ONLY ל-MVP.** persistence = future toggle. + חידוד-ערך: הליבה = prompt+summary (TaskMeta, Commit 3); ה-subFrames המלא = enhancement. ר' decisions. | ✅ נסגר | ❌ |
| 2 | parser: ArkType או guards ידניים? | guards ממוקדים (unions רחבים/משתנים; ר' §7) | ❌ |
| 3 | `SubFrame` = subset של `Bubble`? | כן, בלי `UserBubble` (reuse `BubbleRenderer` ב-B2) | ❌ |
| 4 | `#claudeRawSdkMessageCount` — לשמר או להסיר? | לתאם עם `agent-session.test.ts`; אם אין reader אחר — להסיר בזהירות | ❌ |
| 5 | תת-סוכן מקונן (Task-בתוך-Task)? | ה-fixture לא ייצר; מודל `parent_tool_use_id` תומך; depth>1 = B3 אחרי ראיה | ❌ |
