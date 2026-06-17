---
project: "drive-coding"
slice: "slice-ui-polish-batch"
verifier: "avigail"
date: "2026-06-18"
verdict: "USABLE-AFTER-FIX"
findings:
  - id: 1
    severity: "regression"
    category: "missing-symbol"
    summary: "C13 session.title is absent from AgentSession VM — adding it touches agent-session.svelte.ts, contradicting the brief headline 'zero touch to P1d zone'"
    source_brief: "Phase 3 C13 + header claim line 5 + §7"
    source_code: "packages/frontend/src/lib/view-models/agent-session.svelte.ts (no title field; fields at :78 error, :81 cwd)"
    cost_estimate: "10-20min"
  - id: 2
    severity: "confusion"
    category: "wrong-line-number"
    summary: "C14/C15 reference '+page.svelte' lines ~200-206 / ~166-177, but chat/+page.svelte is only 50 lines — those targets are routes/+page.svelte (connect screen), a different file"
    source_brief: "Phase 3 C14, C15"
    source_code: "packages/frontend/src/routes/+page.svelte:201-206 (error), :158-177 (cwd-row); chat/+page.svelte is 50 lines"
    cost_estimate: "10-15min"
  - id: 3
    severity: "confusion"
    category: "wrong-line-number"
    summary: "C2 says extract formatTime (short hour) from SessionPicker.svelte:32-45, but that block is formatDate using Intl.RelativeTimeFormat (relative time), not a short-hour formatter"
    source_brief: "Phase 1 C2"
    source_code: "packages/frontend/src/lib/components/connect/SessionPicker.svelte:32-45"
    cost_estimate: "5-10min"
  - id: 4
    severity: "confusion"
    category: "naming-inconsistency"
    summary: "C7 says setMuted() must call save(); Settings class has no save() method — the established pattern is private #persist() (save() is a module-level fn)"
    source_brief: "Phase 2 C7"
    source_code: "packages/frontend/src/lib/view-models/settings.svelte.ts:270 (#persist), :69 (module save)"
    cost_estimate: "5min"
  - id: 5
    severity: "confusion"
    category: "dropped-branch"
    summary: "C10 says hide replay button when !speaker.enabled, but bubbles consume getBubblePlayer() not getSpeaker(); UserBubble button is already gated by recordingId"
    source_brief: "Phase 2 C10"
    source_code: "MessageBubble.svelte:38-49, UserBubble.svelte:37-50 (getBubblePlayer); context.ts:40 getSpeaker available"
    cost_estimate: "5-10min"
  - id: 6
    severity: "minor"
    category: "wrong-line-number"
    summary: "C13 says AppHeader.svelte:58 — line 58 is the cwd title attribute; the agentName placeholder to replace is line 24/64"
    source_brief: "Phase 3 C13"
    source_code: "packages/frontend/src/lib/components/layout/AppHeader.svelte:24,58,64"
    cost_estimate: "2min"
  - id: 7
    severity: "minor"
    category: "outdated-risk"
    summary: "C6 narration markdown — narration sits in a truncate one-line summary; block-level markdown there will break truncation. Output text is at line 89, not 46"
    source_brief: "Phase 1 C6"
    source_code: "packages/frontend/src/lib/components/chat/bubbles/ToolBubble.svelte:46 (narration summary), :89 (text content)"
    cost_estimate: "5min"
---

# Plan Verification — slice-ui-polish-batch

> **Brief**: docs/plans/slice-ui-polish-batch.md
> **Base tip**: f0f2a18 (dev)
> **Verdict**: 🟡 USABLE-AFTER-FIX
> **אומדן זמן confusion אם לא תוקן**: ~40-60 דק'

הסבב מבוסס היטב — רוב 15 הפריטים בני-ביצוע כפי שמנוסחים, והבידוד מ-event-handling
שמור כמעט בכל מקום. הבעיות הן בעיקר **אי-דיוקי קובץ:שורה** (כי הבריף מערבב שני
קבצי `+page.svelte`) ו**טענת-headline אחת שגויה** (C13 כן נוגע ב-P1d zone). אף אחד
מהם לא חוסם, אבל יחד הם מבזבזים ~40-60 דק' של אליעזר אם לא יתוקנו לפני dispatch.

## בעיות שנמצאו

### 🔴 Blocker / Regression risk

| # | בעיה | מקור (brief / קוד) | עלות אם לא תוקן |
|---|------|---------------------|------------------|
| 1 | **C13 — `session.title` לא קיים ב-AgentSession VM.** ל-`AgentSession` יש `cwd` (:81), `error` (:78), `status` — אבל **אין `title`**. `SessionInfo` (adapter ל-session list) כן מחזיק `title` (sessions.ts:20,82), אך AppHeader קורא `getSession()` (ה-VM החי), לא את ה-list. כדי להציג `session.title` חייבים **להוסיף שדה ל-`agent-session.svelte.ts`** ולחווט אותו מ-load/list. זה **סותר ישירות את כותרת הבריף** (שורה 5: "אפס נגיעה ב-`agent-session.svelte.ts` (אזור P1d)"). §7 בבריף כן מודה בסיכון ("אם דורש הוספה, להישאר מינימלי") — אבל ה-claim המוחלט בראש מטעה. **מרדכי צריך להכריע**: או להוסיף שדה `title` read-only מינימלי (מקובל, ל-display בלבד, לא נוגע ב-event-handling/protocol), או לדחות את C13. | brief §0/headline שורה 5 + C13 + §7 / `agent-session.svelte.ts` (אין title; :78 error, :81 cwd) | 10-20 דק' + הפרת constraint מוצהר |

### 🟡 Confusion / Type error / Outdated

| # | בעיה | מקור | הצעה |
|---|------|------|------|
| 2 | **C14/C15 — line numbers שייכים לקובץ הלא-נכון.** הבריף כותב "`+page.svelte` (~200-206, `session.error`)" ו-"(~166-177, `cwd-row`)". אבל `routes/chat/+page.svelte` הוא **50 שורות בלבד** (session.error שם ב-:36-44). ה-line numbers האלה הם של `routes/+page.svelte` (מסך connect, 336 שורות): error ב-:201-206, cwd-row ב-:158-177. שני קבצים, שם זהה. אליעזר עלול לערוך את הקובץ הלא-נכון. **C14 דו-משמעי במיוחד**: יש `session.error` גם ב-chat וגם ב-connect — איזה מהם צריך reactive-clear? (ה-clear עצמו כבר קורה ב-VM: `this.error=null` ב-:477/530/686 וכו'). | C14, C15 / `routes/+page.svelte:201,158`; `chat/+page.svelte:36` | להפריד מפורשות: "`routes/+page.svelte` (connect)" מול "`chat/+page.svelte`" בכל פריט |
| 3 | **C2 — הדפוס ב-SessionPicker:32-45 הוא `formatDate` (זמן יחסי), לא `formatTime`.** הבריף מבקש לחלץ `formatTime(ts)` ("שעה קצרה") מ-`SessionPicker.svelte:32-45`. אבל הבלוק הזה הוא `formatDate(iso)` שמשתמש ב-`Intl.RelativeTimeFormat` ("לפני 5 דקות") — לא formatter של שעה. אין שם דפוס "שעה קצרה" לחלץ. C3 רוצה `formatTime(bubble.createdAt)` (timestamp→שעה) — זה util **חדש**, לא חילוץ. גם ה-input שונה: SessionPicker מקבל ISO string, bubble.createdAt הוא `number`. | C2 / `SessionPicker.svelte:32-45` | לנסח C2 כ"צור formatTime חדש; אופציונלית גם formatDate משותף" — לא "חלץ" |
| 4 | **C7 — `Settings` מ class אין מתודת `save()`.** הבריף: "setMuted() שקורא `save()`". בקוד יש `save(s)` ברמת-מודול (:69) ו-`#persist()` פרטי במחלקה (:270). כל ה-setters הקיימים (setCarMode וכו') קוראים `#persist()`. אליעזר שמחפש `save()` במחלקה לא ימצא. | C7 / `settings.svelte.ts:270,69` | C7 צריך לומר "קורא `#persist()`" (תיעוד ה-Persisted/DEFAULTS בקובץ נכון — רק שם המתודה) |
| 5 | **C10 — הבועות לא רואות את `speaker.enabled`.** MessageBubble/UserBubble מזריקים `getBubblePlayer()` בלבד (לא `getSpeaker()`). "הסתר כפתור כש-`!speaker.enabled`" דורש או להזריק `getSpeaker()` לבועה, או לחשוף enabled דרך BubblePlayer. בנוסף ב-UserBubble הכפתור כבר מוסתר מאחורי `{#if bubble.recordingId}` (:37) — כך שהתנאי נעשה משולב. speaker זמין ב-context (context.ts:40) — בר-ביצוע, רק לא "מובן מאליו". | C10 / `MessageBubble.svelte:38`, `UserBubble.svelte:37`, `context.ts:40` | לציין מפורשות מאיפה הבועה מקבלת את ה-enabled |

### 🟢 Minor

| # | בעיה | מקור |
|---|------|------|
| 6 | C13 — `AppHeader.svelte:58` הוא ה-`title` attribute של ה-cwd chip. ה-placeholder להחלפה (`agentName = "drive-coding"`) הוא :24 והשימוש ב-:64. | `AppHeader.svelte:24,58,64` |
| 7 | C6 — narration (`ToolBubble.svelte:46`) יושב ב-`<div class="truncate">` בתוך summary של `<details>`. `renderMarkdown` מחזיר block-level HTML (`<p>` וכו') שישבור truncate בשורה אחת. הפלט הטקסטואלי האמיתי (text content) הוא ב-:89 (`<pre>{c.text}</pre>`), לא :46. | `ToolBubble.svelte:46,89` |

## Spot-check שעבר (לא מצא בעיה)

- ✅ **C1** — `lib/util/clipboard.ts` לא קיים (קובץ חדש, נכון). תיקיית `lib/util/` קיימת.
- ✅ **C2 (path)** — `lib/util/formatting.ts` לא קיים (קובץ חדש, נכון).
- ✅ **C3** — `bubble.createdAt: number` קיים ב-`BubbleBase` (bubble.ts:27) — formatTime(bubble.createdAt) בר-ביצוע.
- ✅ **C4** — `UserBubble.svelte:33` אכן מציג `{joinSegmentText(bubble.segments)}` raw (ללא markdown). `renderMarkdown` (markdown.ts:47) + `joinSegmentText` (bubble-rendering.ts:3) זמינים. ה-feature add נכון.
- ✅ **C5** — בלוק ה-`pre/code` ב-MessageBubble `<style>` הוא ב-:59-76 (~69-75 בבריף קרוב מספיק). הוספת `direction:ltr` שם בת-ביצוע.
- ✅ **C7 (path/pattern)** — בלוק ההוראות התוספתי ב-settings.svelte.ts:1-13 קיים; הוספת `muted` ל-Persisted/DEFAULTS/$state עוקבת אחר הדפוס המתועד.
- ✅ **C8** — `Speaker` כבר מקבל `settings` כ-`#settings` (speaker.svelte.ts:80,122) ו-`cues` כ-`#cues` (:83,123). חיווט `enabled` מ-`!settings.muted` ב-constructor + כתיבת `setMuted` ב-`toggle()` (:183) — בלי לגעת ב-event-handling effect. `CuesEngine.enabled` הוא public mutable (cues.ts:23, ref מדויק). סנכרון `this.#cues.enabled` בר-ביצוע. **הבידוד נשמר.**
- ✅ **C9** — `cues.play()` כבר guarded ב-`if (!this.enabled) return` (cues.ts:32). סנכרון מ-C8 מספיק. בנוסף Speaker כבר חוסם narration/TTS כש-`!enabled` (:255, :425).
- ✅ **C11** — `SessionPicker.svelte:67-77` הוא בדיוק בלוק ה-`{#if sessions.length>0}` עם label+Select. רפקטור ל"תמיד מוצג + disabled" בר-ביצוע. כפתור load קיים כבר (:58).
- ✅ **C12** — `ActiveProcessesPanel.svelte` כבר מחזיק כפתור refresh שקורא `activeAgents.refresh()` (:96). הוספת `$effect`+interval+cleanup ל-auto-refresh בת-ביצוע (אין $effect קיים שיתנגש).
- ✅ **C14 (mechanism)** — ה-VM כבר מנקה `error=null` ב-reconnect/load/newSession מוצלחים (:477,530,686,735). אם מה שצריך הוא רק תצוגה reactive — `{#if session.error}` כבר reactive בשני ה-+page.
- ✅ **C15** — `.cwd-row` ב-`routes/+page.svelte:158-177`, style :267. flex order/logical props בר-ביצוע (skill rtl-adaptation).
- ✅ **בידוד P1d (כללי)** — חוץ מ-C13 (ממצא #1), אף פריט לא דורש נגיעה ב-`agent-session.svelte.ts`. C8 נוגע ב-speaker/cues בלבד, C14 קורא `session.error` קיים (read-only).

## Verdict

🟡 **USABLE-AFTER-FIX** — אין blocker שמונע התחלה, אבל **לפני dispatch** מרדכי צריך:
1. **C13 (#1)** — להכריע: להוסיף שדה `title` מינימלי ל-VM (ולתקן את ה-headline "אפס נגיעה") או לדחות את C13. זו הכרעה ארכיטקטונית, לא של אליעזר.
2. **C14/C15 (#2)** — להפריד מפורשות `routes/+page.svelte` (connect) מ-`chat/+page.svelte` בכל פריט, ולהבהיר ב-C14 איזה error מסך מדובר.
3. **C2/C7/C10 (#3,#4,#5)** — תיקוני ניסוח קצרים (חילוץ→יצירה; save→#persist; מאיפה הבועה מקבלת enabled).

~15-20 דק' תיקון של מרדכי ⇐ חוסך ~40-60 דק' confusion של אליעזר.
