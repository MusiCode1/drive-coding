# Slice B2 — subagent-transcript-render — תוכנית

> **תאריך**: 2026-07-12
> **סוג מסמך**: בריף ביצועי לסלייס
> **סטטוס**: מאושר ל-dispatch
> **אימות אביגיל**: READY (r4 — מול קוד-חי של B1 @ `3203f393`; ר' `reports/drive-coding/subagent-transcript-render-avigail.md`)
> **Complexity**: 8/10 (verifier: **heavy** — calev-heavy: streaming + nested layout + virtua + user-intent + RTL + UI חזותי)
> **depends_on**: [`subagent-transcript-data`] (B1 — שכבת-הנתונים; **טרם merged**, calev GO @ `3203f393`)
> **base**: `slice/subagent-transcript-data` @ `3203f393` (שרשור — B1 עדיין לא ב-dev; ר' §0)
> **מזין-מ**: B1 (`ToolBubble.subFrames` + `ToolCall.task` מאוכלסים ב-`#onExtNotification`)
> **מזין-ל**: **B (per-kind)** — סלייס-המשך שישדרג את ה-parser של B1 (`thinking→ThoughtBubble`,
> `tool_use→ToolBubble`) כך שה-subFrames יהיו מובחנים; **הרנדרר של B2 כבר תומך בכך** (reuse של
> `BubbleRenderer`) → ההבחנה תופיע בחינם כש-B ינחת. ר' §1.
> **מבוסס**: `prebrief-subagent-nested-bubble.md` §8 (B2 scope) + §13 (DoD) + `slice-subagent-transcript-data-v2.md` §4 (חוזה-הנתונים)

> ✅ **גייט-נחיתה נסגר (אביגיל r3/r4 מול קוד-חי)**: חוזה-הנתונים (§2) אומת GREEN מול הקוד החי
> של B1 (`3203f393`) — כל שמות-השדות, ה-optionality, סמן-הזיהוי המשולב, ו-object-replacement
> תואמים בדיוק. B1 **טרם מוזג ל-dev** (מיזוג = שיחה עם המשתמשת) → base נשאר `slice/subagent-transcript-data`.
> **מרדכי בלבד ממזג, ורק אחרי preview + אישור-משתמשת.**

---

## §0 — Pre-flight

### Worktree
```bash
# B1 עדיין לא ב-dev → שרשור מעל ה-branch של B1:
git worktree add .worktrees/subagent-transcript-render -b slice/subagent-transcript-render slice/subagent-transcript-data
cd .worktrees/subagent-transcript-render
pnpm install && pnpm hooks:install
# אם B1 כבר מוזג ל-dev בזמן ה-dispatch → גזור מ-dev במקום, ועדכן base כאן.
```

### הרצה + preview (חובה — gate לפני merge)
- FE dev (inner-loop של אליעזר בלבד, **לא** ה-preview למשתמשת): `pnpm --filter @drive-coding/frontend dev`
- **preview למשתמשת = build production**, לא HMR (ר' `AGENTS.md` §"Preview rules"):
  ```bash
  pnpm --filter @drive-coding/frontend build
  # הגשה single-origin דרך FE_STATIC_DIR — ר' docs/running-locally.md
  ```
- BE (אם צריך Task חי מול claude): `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (port 4000).
- build-gate: `pnpm --filter @drive-coding/frontend typecheck` + `pnpm test` ירוקים.
- i18n-gate: אין עברית בקוד — `pnpm lint:i18n` חוסם. כל מחרוזת-תצוגה → `t(key)`.

### Reading list (priority)
- **must-read לפני**:
  - `packages/frontend/AGENTS.md` — חמשת חוקי-הזהב (במיוחד #4 scroll-ownership, #5 additive).
  - `slice-subagent-transcript-data-v2.md` §4 (חוזה-הנתונים — TaskMeta/SubFrame/subFrames) — **מקור-האמת לשמות-השדות**.
  - `docs/conventions/parallel-safe-code.md` — טכניקה #2 (switch dispatcher ב-leaf), רלוונטי ל-`BubbleRenderer`.
- **reference בזמן עבודה**:
  - `bubbles/ToolBubble.svelte` — תבנית `details`+local-`open`+rAF-guard+status-dot (מעתיקים ממנה).
  - `bubbles/ThoughtBubble.svelte` — אותה תבנית toggle-intent.
  - `types/chat-scroll.ts` — `ChatScrollBridge.noteUserIntent`.
  - `docs/design-principles.md` §1-5 — שכבות, מתי `$state` local מול derived.

### Browser
- Chrome רגיל (localhost) לבדיקת-inner-loop. לאימות-משתמשת = preview production על HTTPS (ר' `AGENTS.md`).

---

## §1 — מטרה

כאשר Claude מפעיל תת-סוכן (Task/Agent), בועת ה-Task בצ'אט תהפוך מ**כלי גנרי עם JSON גולמי**
ל**container חי**: כותרת עם זהות תת-הסוכן (`subagentType`) ומצבו (running/completed/failed),
תקציר ה-prompt/summary, ו**transcript מקונן** של פעילות תת-הסוכן — זורם בתוך אותה בועה, מבלי
לזלוג לתשובת-הסוכן העליון. הרשימה הראשית נשארת שטוחה (virtua לא נוגע); כל התוכן המקונן חי בתוך
בועת האב באזור נגלל מוגבל-גובה.

> **⚠️ scope-MVP — תעתיק כטקסט מאוחד (avigail r3 F1, מאומת מול קוד-חי של B1)**: ב-B1 שנחת,
> ה-parser (`claude-subagent-parse.ts`) **משטח כל בלוק** של תת-הסוכן ל-`MessageBubble` יחיד —
> `thinking`→טקסט, `tool_use`→מחרוזת `"[tool_use: name]"`, `tool_result`→טקסט. זרועות ה-
> `ThoughtBubble | ToolBubble` ב-`SubFrame` union **לא מאוכלסות היום**. לכן **ב-B2 התעתיק מרונדר
> כטקסט-הודעה זורם** (מחשבות/כלים כטקסט inline), **לא** כבועות-מחשבה/כלי מובחנות. זה עדיין שיפור
> עצום מול ה-JSON הגולמי של היום. **ההבחנה-הויזואלית פר-סוג = סלייס B (per-kind)** ששודרג את
> ה-parser של B1 — ומכיוון ש-B2 עושה reuse ל-`BubbleRenderer` (שכבר יודע לצייר Thought/Tool),
> **ההבחנה תופיע בחינם ברנדר** כש-B ינחת, בלי נגיעה נוספת ב-B2.

---

## §2 — חוזה-הנתונים מ-B1 (קלט — לא לשנות כאן)

B2 הוא **צרכן-בלבד** של המבנה ש-B1 בנה. השדות (מ-`slice-subagent-transcript-data-v2.md` §4,
`packages/frontend/src/lib/types/bubble.ts` אחרי B1):

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

export type SubFrame = MessageBubble | ThoughtBubble | ToolBubble   // subset של Bubble, בלי UserBubble

export type ToolCall  = { /* ...הקיים... */ task?: TaskMeta }        // additive מ-B1
export type ToolBubble = BubbleBase & {
  kind: "tool"; /* ...הקיים... */ subFrames?: SubFrame[]             // additive מ-B1
}
```

**סמן-זיהוי Task-bubble** (✅ נפתר אחרי נחיתת B1 — ר' למטה):
```ts
bubble.kind === "tool" && (bubble.toolCall.task !== undefined || bubble.subFrames !== undefined)
```
(אף אחד מהם לא מוגדר = כלי רגיל → `ToolBubble` הרגיל, ללא שינוי.)

> **✅ הוכרע מול B1 שנחת (calev GO, commit `3203f393`)**: אימות הקוד החי הראה ש-B1 **לא**
> מאתחל `subFrames: []` על זיהוי-Task — `subFrames` נוצר **lazily** על ה-frame הראשון
> (`reduceSubagent`: `subFrames: [...(taskBubble.subFrames ?? []), newFrame]`), בעוד **`task`
> נקבע על `task_started`** (`reduceSubagent`: `toolCall.task = { ...prevTask, ... }`). לכן
> `subFrames !== undefined` **לבדו שביר** (מחמיץ Task שקיבל רק task_started, בלי transcript עדיין).
> **ההכרעה**: סמן משולב `task !== undefined || subFrames !== undefined` — תופס את ה-Task ברגע
> ש**אחד** מהם מאוכלס (task קודם, בדרך-כלל). זהו הדפוס שאושר ע"י avigail (#2) + הוכח מול הקוד.
>
> **⚠️ עקביות-marker (avigail r2 🟡)**: אותו predicate **בדיוק** בשני מקומות — (א) תנאי ה-branch
> ב-`BubbleRenderer` (§5 Commit 1), (ב) ההתייחסות ב-§3. הרכיב guarding שני השדות כ-optional
> (§5 Commit 1) — לא קורס אם אחד undefined.

> **⚠️ אימות-נחיתה (§0 gate)**: אחרי נחיתת B1, ודא ששמות-השדות בפועל **זהים** לטבלה למעלה
> (במיוחד `subagentType`/`prompt`/`summary`/`status` ב-`TaskMeta`, ו-`subFrames` ב-`ToolBubble`).
> אם B1 נחת עם שמות שונים — עדכן brief זה **לפני** dispatch, אל תנחש.

---

## §3 — Scope

| פריט | כן/לא | לאן |
|------|-------|-----|
| זיהוי Task-bubble והצגת identity/status/summary ייעודיים | ✅ | Commit 1 |
| transcript פנימי: רינדור ה-`subFrames` שB1 מייצר (**היום: MessageBubble בלבד**, reuse `BubbleRenderer`) | ✅ | Commit 1-2 |
| **הבחנה ויזואלית פר-סוג** (thought/tool כבועות מובחנות) | ❌ | **B (per-kind)** — משדרג parser של B1; הרנדרר כאן כבר תומך (§1) |
| אזור נגלל max-height + overflow-y | ✅ | Commit 2 |
| collapse/expand בלי snap-back בזמן status update | ✅ | Commit 2 |
| `chatScroll.noteUserIntent` על toggle של בועת ה-Task (לא קופץ לרשימה הראשית) | ✅ | Commit 3 |
| depth guard לקינון (Task-בתוך-Task) — depth 1 נתמך, depth>1 render-flat | ✅ | Commit 3 |
| status ברור ל-failure/cancel | ✅ | Commit 3 |
| i18n לכל label; RTL/LTR (`dir="auto"` פרוזה, `dir="ltr"` קוד) | ✅ | לאורך כל commit |
| **שינוי ב-VM / parser / חוזה-נתונים** | ❌ | זה B1 — אל תיגע ב-`agent-session.svelte.ts`/parser |
| **שינוי wire protocol BE↔FE** | ❌ | מחוץ ל-scope |
| וירטואליזציה **פנימית** של ה-transcript | ❌ | future (עד שיש ראיה של transcript ענק) |
| persistence ל-`session/load` (transcript אחרי reload) | ❌ | B3 / live-only (B1 §9 Q1 — הוכרע live-only) |
| depth>1 UI מלא (Task-בתוך-Task עם transcript) | ❌ | B3 (אחרי ראיה חיה) |
| opencode/Codex subagents | ❌ | spike נפרד |

> **הגנת-scope**: אין parsing/correlation ברכיב. הרכיב מקבל `subFrames`/`task` כ-props מוכנים
> ומרנדר. כל לוגיקת-הנתונים חיה ב-B1. אם חסר שדה לרינדור — עצור ושאל (§7), אל תוסיף parsing ברכיב.

---

## §4 — Architecture (5 שכבות — `packages/frontend/AGENTS.md`)

```
routes/            (ללא שינוי)
   │
components/chat/
   ├─ BubbleRenderer.svelte          ← משתנה: ענף tool מתפצל
   │     bubble.kind==="tool"
   │        ├─ subFrames !== undefined → <SubagentBubble>   ← חדש
   │        └─ else                    → <ToolBubble>        (הקיים, ללא שינוי)
   │
   ├─ bubbles/SubagentBubble.svelte   ← חדש (הרכיב המרכזי)
   │     • header: Avatar + status-dot + subagentType + prompt (truncate)
   │     • <details bind:open> (local $state, rAF-guard) → transcript region
   │     • transcript: {#each bubble.subFrames as sf (sf.id)}
   │           <BubbleRenderer bubble={sf} depth={depth+1} />   ← reuse + depth
   │     • summary/status footer (task.summary כשקיים)
   │     • max-height + overflow-y על ה-region
   │
   └─ bubbles/{Message,Thought,Tool}Bubble.svelte   (reused כ-subFrames, ללא שינוי מהותי)

types/bubble.ts    (ללא שינוי — B1 כבר הוסיף subFrames/task)
i18n (core)        ← מפתחות חדשים: keys.ts + catalogs/he.ts + en.ts
```

**עקרונות-מפתח**:
1. **props-only** — `SubagentBubble` לא מייבא VM, לא עושה parsing. מקבל `bubble: ToolBubble` (עם `subFrames`/`task`).
2. **reuse דרך `BubbleRenderer`** — subFrames (message/thought/tool) מרונדרים ע"י ה-dispatcher הקיים
   → עקביות + אפס שכפול-רינדור. `SubFrame ⊆ Bubble` → type-safe להעביר ל-`BubbleRenderer`.
3. **depth guard** — `BubbleRenderer` מקבל `depth` (default 0). `SubagentBubble` מעביר `depth+1`.
   ב-`BubbleRenderer`: `isSubagentTask(bubble) && depth >= MAX_NEST_DEPTH(=1)` → render כ-`ToolBubble`
   שטוח (בלי transcript מקונן) → מונע runaway ומגביל ל-depth 1 ל-MVP.
4. **object-replacement reactivity** (finding #6) — B1 מחליף את אובייקט ה-Task bubble; הרכיב
   קורא `frames.length` ב-template (`<span class="hidden">{frames.length}</span>`) כדי לכפות
   re-measure של virtua. **הבהרה מדויקת**: `ThoughtBubble`/`MessageBubble` משתמשים ב-`.length`
   על **מערך-ה-segments** שלהם; `ToolBubble` **אין לו מערך** ולכן כופה reactivity דרך
   `{tc.narration ?? ""}{tc.status}`. ל-`SubagentBubble` **יש** מערך (`subFrames`) → הדפוס הנכון
   הוא `.length` (כמו Thought/Message), לא narration+status.
   > **avigail r2 🟢 — גדילה תוך-frame**: `frames.length` תופס שינוי ב**מספר** ה-subFrames, אך
   > **לא** גדילת-טקסט בתוך subFrame קיים (append ל-segments של assistant-delta). זה נשען על כך
   > ש-B1 עושה **object-replacement מלא של ה-Task bubble** בכל event (חוזה B1 §4/§5 Commit 3) →
   > הרפרנס משתנה → Svelte/virtua מודדים מחדש. **גייט §0**: ודא שזה אכן מה ש-B1 עושה; אם B1
   > עושה deep-mutation (`subFrames.push`) בלי object-replacement — עדכון תוך-frame לא יורנדר.

---

## §5 — Commits בסדר

### Commit 1 — `SubagentBubble.svelte` + פיצול `BubbleRenderer` (approach: manual + browser smoke)

**קובץ חדש**: `packages/frontend/src/lib/components/chat/bubbles/SubagentBubble.svelte`
**API (props)**:
```ts
let { bubble, depth = 0 }: { bubble: ToolBubble; depth?: number } = $props()
const tc = $derived(bubble.toolCall)                          // finding #5 — הכרז derives
const task = $derived(bubble.toolCall.task)                   // TaskMeta | undefined — optional!
const frames = $derived(bubble.subFrames ?? [])
// finding #4 — status עם fallback ל-"unknown" (task אולי undefined)
const status = $derived(task?.status ?? "unknown")
const heading = $derived(task?.subagentType ?? tc.name)
```
> **finding #1 — `task` הוא `TaskMeta | undefined`**: אל תפרק `task.status`/`task.subagentType`
> ישירות (typecheck נכשל תחת strict; header ריק אם B1 מאכלס subFrames בלי task). השתמש ב-`task?.`
> + fallbacks (למעלה). הרכיב **לא קורס** גם אם `task === undefined` (Task שזוהה מ-subFrames לבד).

תוכן מינימלי ל-commit זה:
- header: `<Avatar kind="tool" />` + status-dot (`class="status-{status}"` +
  `aria-label={t(\`chat.subagent.status.${status}\`)}` — **avigail r2 🟢**: מפתחות
  `chat.subagent.status.*` (§11), **לא** `chat.tool.status.*`) + `{heading}` +
  `{task?.prompt ?? ""}` (truncate, `dir="auto"`).
- `<details bind:open>` (local `let open = $state(true)` — פתוח בזמן ריצה) → transcript region:
  ```svelte
  {#each frames as sf (sf.id)}
    <BubbleRenderer bubble={sf} depth={depth + 1} />
  {/each}
  <span class="hidden">{frames.length}</span>   <!-- finding #6 — כפיית reactivity על מערך -->
  ```
> **finding #3 — Svelte scoped-style, אין "reuse" של CSS**: ה-`<style>` ב-Svelte **scoped
> לרכיב**. אי-אפשר להשתמש ב-`.status-*` של `ToolBubble` מתוך `SubagentBubble` — חובה **להעתיק**
> את בלוק ה-status-dot CSS ל-`<style>` של `SubagentBubble` (או לחלץ ל-global CSS). **finding #4**:
> ToolBubble מגדיר רק `pending/in_progress/completed/failed`; `TaskMeta.status` כולל **`unknown`**
> → הוסף `.status-unknown { background: var(--fg-dim); }` לבלוק המועתק (אחרת נקודה חסרת-צבע).

**קובץ משתנה**: `packages/frontend/src/lib/components/chat/BubbleRenderer.svelte`
- הוסף prop `depth = 0`.
- פצל את ענף `bubble.kind === "tool"`:
  ```svelte
  {:else if bubble.kind === "tool"}
    {#if isSubagentTask(bubble) && depth < MAX_NEST_DEPTH}
      <SubagentBubble {bubble} {depth} />
    {:else}
      <ToolBubble {bubble} />
    {/if}
  {/if}
  ```
  `const MAX_NEST_DEPTH = 1` (const מקומי במודול או `$lib/util`).
  **חלץ את הסמן לפונקציה טהורה** (בר-בדיקה בלי DOM — ר' §5 Commit 3), ב-`packages/frontend/src/lib/components/chat/bubbles/bubble-rendering.ts` (הקובץ הקיים — לצד `bubble-rendering.test.ts`):
  ```ts
  export const isSubagentTask = (b: ToolBubble): boolean =>
    b.toolCall.task !== undefined || b.subFrames !== undefined
  ```
  שימוש **זהה** ב-`SubagentBubble` וב-`BubbleRenderer` — predicate יחיד, אין שכפול-תנאי (avigail r2 🟡).

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck   # 0 errors
pnpm --filter @drive-coding/frontend dev          # פתח צ'אט; Task חי או fixture-replay → בועת Task מציגה header + subframes
```

### Commit 2 — transcript region: max-height + collapse-no-snapback + dir (approach: manual + browser)

**קובץ**: `SubagentBubble.svelte`
- transcript region: `max-height: ~360px; overflow-y: auto` (מדיד — כמו `pre { max-height:300px }` ב-ToolBubble).
- collapse-no-snapback: `let open = $state(true)` מאותחל **פעם אחת** (לא `$derived` מ-setting) —
  מונע snap-back כשה-status/subFrames מתעדכנים (תבנית מדויקת מ-`ThoughtBubble.svelte` — עגן
  בדפוס: השורה `let open = $state(settings.showThoughts)` + ההערה "מאותחל פעם אחת... מונע snap-back").
- summary footer: `{#if task?.summary}` → `<MarkdownContent text={task.summary} />` (dir="auto"). (`task` optional — finding #1.)
- dir: כותרת/prompt/summary `dir="auto"`; אין קוד ישיר ברכיב (ה-subFrames מטפלים ב-dir שלהם דרך MarkdownContent/ToolBubble).

**Verification**:
```bash
pnpm --filter @drive-coding/frontend dev
# 1. Task עם transcript ארוך → אזור נגלל, לא חורג מהבועה.
# 2. קפל/פתח את ה-details בזמן שה-Task רץ (subFrames מתעדכנים) → לא נפתח-מחדש-לבד (no snap-back).
# 3. subagentType/prompt עברית → מיושר-ימין; קוד ב-subframe → dir=ltr.
```

### Commit 3 — scroll-follow + depth guard + failure/cancel (approach: manual + component test)

**קובץ**: `SubagentBubble.svelte`
- toggle-intent: `getChatScroll()` + `let ready=false; onMount(()=>requestAnimationFrame(()=>ready=true))`
  + `ontoggle={() => { if (ready) chatScroll.noteUserIntent?.() }}` — **תבנית מדויקת** מ-`ToolBubble.svelte:40-43`
  (guard ל-init-fire של `<details bind:open={$state(true)}>` תחת CSR).
- status ל-failed/cancel: status-dot `status-failed` (אדום) + label `t("chat.subagent.status.failed")`.
- depth guard: מאומת ב-`BubbleRenderer` (Commit 1); כאן ודא ש-subFrame שהוא Task מקונן (depth≥1)
  מרונדר כ-`ToolBubble` שטוח (בלי recursion אינסופי).

**קובץ חדש (test)**: `packages/frontend/src/lib/components/chat/bubbles/subagent-bubble.test.ts`
(או `bubble-rendering.test.ts` הקיים — הרחבה): טסט **טהור** על לוגיקת-הפיצול:
- טסט טהור על `isSubagentTask` + לוגיקת-הפיצול (`bubble-rendering.ts`, בלי DOM):
  - `tool` עם `task` (בלי subFrames) → `isSubagentTask === true` (**המקרה שהוכרע מול B1** — task קודם).
  - `tool` עם `subFrames` (בלי task) → `true`.
  - `tool` בלי task ובלי subFrames → `false` (כלי רגיל).
  - שילוב depth: `isSubagentTask && depth < 1` → SubagentBubble; `depth >= 1` → ToolBubble שטוח (depth-guard).

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck
pnpm --filter @drive-coding/frontend test         # subagent-bubble.test ירוק
pnpm lint:i18n                                     # אין עברית בקוד
```

---

## §6 — DoD verifiable (calev-heavy — ר' `prebrief §13`)

| # | התנהגות | אימות |
|---|---------|-------|
| 1 | Task מוצג עם identity/status קריאים, לא JSON גולמי | browser + screenshot (Task חי/fixture) |
| 2 | תוכן פעילות תת-הסוכן (text/thinking/tool — **כטקסט מאוחד** ב-MVP, ר' §1) מופיע **בתוך** אותה בועה | fixture-replay + Task חי |
| 3 | שום subagent prose לא מופיע כבועה עליונה ב-`bubbles` הראשי | DOM assertion (רשימה ראשית שטוחה) |
| 4 | streaming פתוח מתעדכן בלי כפילות/קפיצות חריגות | Playwright/live flow |
| 5 | קיפול ידני נשמר בזמן progress/completion (no snap-back) | interaction test |
| 6 | גלילה למעלה לא נמשכת בכוח לתחתית בעת toggle | user-intent flow (noteUserIntent) |
| 7 | mobile + desktop: לא חורג/חופף | screenshots בשני viewports |
| 8 | Hebrew/English/code — כיוון נכון | RTL/LTR fixture |
| 9 | transcript ארוך מוגבל-גובה ונגיש בגלילה | long fixture |
| 10 | failure/cancel → status ברור | fixture/live אם אפשר |
| 11 | כלי רגיל (בלי subFrames) — **ללא רגרסיה** (ToolBubble כרגיל) | regression: כלי read/edit רגיל נראה זהה |
| 12 | depth>1 (Task-בתוך-Task) לא יוצר recursion runaway | render-flat מאומת (fixture סינתטי אם אין חי) |
| 13 | build-gate | `typecheck` + `test` + `lint:i18n` ירוקים |
| 14 | **preview production על HTTPS** אושר ע"י המשתמשת | `AGENTS.md` preview-gate (חובה לפני merge) |

---

## §7 — Escalation triggers

עצור ושאל את מרדכי (parent task) אם:
- שמות-השדות ב-B1 שנחת **שונים** מ-§2 (subFrames/task/subagentType/...) — אל תנחש, עדכן-דרך-מרדכי.
- reuse של `BubbleRenderer` ל-subFrames יוצר בעיית reactivity/measure עמוקה ב-Svelte 5/virtua שלא נפתרת ב-object-replacement.
- ה-subFrame כ-`MessageBubble` מרנדר כפתור-TTS/actions שלא-רצויים בתוך transcript ודורש **מצב-רינדור compact** (החלטת-UX — ר' §9 Q2).
- depth>1 מופיע חי ב-fixture ודורש UI-מקונן אמיתי (זה B3, לא כאן).
- הקיפול המקונן (details בתוך details) גורם ל-`<details>` להיפתח-מחדש בעת status update למרות תבנית ה-local-`$state`.

---

## §8 — Complexity score = 8/10 → verifier **heavy**

- commits: 3 (נמוך) · שכבות חדשות: 1 רכיב + פיצול dispatcher (בינוני).
- Streaming/async: +2 (transcript זורם חי בזמן ריצת תת-הסוכן).
- Nested layout + virtua measure + user-intent scroll: +2 (רגיש — snap-back/jump הם באגים חוזרים).
- UI חזותי + RTL/LTR + mobile/desktop: +2 (טסטים ירוקים לא מספיקים — דורש עין).
- אין שינוי protocol, אין refactor state-model (זה B1).
→ **8/10 → calev-heavy** (פרוטוקול 7 שלבים: visual + E2E + edge + regression). מאושר ב-`prebrief §13`.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת-מחדל | חוסם? |
|---|------|-----------|-------|
| 1 | ~~persistence ל-`session/load`~~ **הוכרע ב-B1 §9: live-only ל-MVP.** transcript נעלם ב-reload — מקובל. | ✅ נסגר | ❌ |
| 2 | reuse רכיבים קיימים (Message/Thought/Tool מלאים) מול "compact frames" ייעודיים ל-transcript? | **reuse דרך `BubbleRenderer`** (עקביות + אפס-שכפול); אם ה-play-button/actions על MessageBubble נראים זרים ב-transcript — לחדד CSS/prop `compact` **בהמשך** (calev-heavy visual יתפוס). | ❌ |
| 3 | `open` ברירת-מחדל של בועת ה-Task — פתוח או סגור? | **פתוח בזמן ריצה** (`$state(true)`), נשאר לפי בחירת-המשתמש אחרי toggle (prebrief Q8). | ❌ |
| 4 | `MAX_NEST_DEPTH` — 1 או יותר? | **1** ל-MVP; depth>1 = B3 אחרי ראיה חיה. | ❌ |
| 5 | האם להציג `task.lastToolName`/progress ב-header בזמן ריצה? | כן, קל — "…{lastToolName}" ב-status line כשקיים (nice-to-have, לא חוסם). | ❌ |
| 6 | branch על `subFrames` מול `task` כסמן-Task? | ✅ **הוכרע מול B1 שנחת**: סמן משולב `task !== undefined \|\| subFrames !== undefined` (`isSubagentTask`, §5 Commit 1). B1 קובע `task` על task_started, `subFrames` lazily → `subFrames` לבדו שביר. | ✅ נסגר |

---

## §10 — Anti-patterns (מ-`prebrief §10`)

- ❌ parser/correlation ברכיב Svelte — זה B1. הרכיב props-only.
- ❌ raw SDK JSON למשתמשת כפתרון-ביניים.
- ❌ `subFrames.push` deep-mutation בהנחה ש-Svelte/virtua ימדדו — B1 עושה object-replacement; הרכיב קורא `.length` ב-template.
- ❌ `BubbleRenderer` רקורסיבי בלי depth guard.
- ❌ `open={derivedSetting}` reactive — יגרום snap-back. `local $state` מאותחל פעם אחת.
- ❌ מחרוזת עברית בקוד — `pnpm lint:i18n` חוסם. הכל דרך `t(key)`.
- ❌ שינוי top-level adapter filtering / VM — מחוץ ל-scope.

---

## §11 — i18n keys חדשים

**`packages/core/src/i18n/keys.ts`** (הוסף ל-union, ליד `chat.tool.*`):
```
| "chat.subagent.status.pending"
| "chat.subagent.status.in_progress"
| "chat.subagent.status.completed"
| "chat.subagent.status.failed"
| "chat.subagent.status.unknown"
| "chat.subagent.prompt"        // label ל-prompt
| "chat.subagent.summary"       // label ל-summary
| "chat.subagent.transcript"    // label לאזור ה-transcript / summary של ה-details
```
**`catalogs/he.ts`** + **`catalogs/en.ts`** — ערך לכל מפתח (he: "בתהליך"/"הושלם"/"נכשל"/... ; en: מקביל).
ודא ש-`pnpm test` (טסט שלמות-קטלוג, אם קיים) + `typecheck` ירוקים אחרי ההוספה.

---

## §12 — סיכום handoff (checklist)

- [x] §0 pre-flight: worktree (שרשור מ-B1), הרצה, preview production, reading-list ממוקד.
- [x] §2 חוזה-נתונים מפורש + gate לאימות-נחיתה.
- [x] §4 architecture 5-שכבות + מה חדש איפה.
- [x] §5 commits עם API skeleton + verification פר-commit.
- [x] §6 DoD טבלה verifiable (14 שורות) + preview-gate.
- [x] gotchas: i18n (§10/§11), Svelte-5 reactivity (`.length` + local-`$state`, §4/§10), depth-guard.
- [x] §8 complexity=8 → calev-heavy מסומן.
- [x] §7 escalation ספציפי + §9 שאלות מסומנות חוסם/לא.
- [x] **gate**: אביגיל READY (r4, מול קוד-חי של B1 @ `3203f393`) → **מאושר ל-dispatch**.
