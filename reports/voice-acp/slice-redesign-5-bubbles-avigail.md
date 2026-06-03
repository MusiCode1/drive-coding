---
project: "voice-acp"
slice: "slice-redesign-5-bubbles"
verifier: "avigail"
date: "2026-06-02"
verdict: "USABLE-AFTER-FIX"
findings:
  - id: 1
    severity: "confusion"
    category: "unique"
    summary: "mockup drill-down (494-547) groups 3 tool actions in ONE bubble, but data-model is one ToolCall per ToolBubble — 3-level vs 2-level nesting ambiguity"
    source_brief: "§2 line 64, §4 Commit 4 line 133, §9 Q4"
    source_code: "packages/frontend/src/lib/types/bubble.ts:82"
    cost_estimate: "15-30min"
  - id: 2
    severity: "outdated"
    category: "wrong-line-number"
    summary: "brief cites agent-session:540 for chunks->segments push; actual #appendChunk at 525, push at 543/545"
    source_brief: "§0 Reading-list line 34, §C1 line 105"
    source_code: "packages/frontend/src/lib/view-models/agent-session.svelte.ts:525"
    cost_estimate: "2min"
  - id: 3
    severity: "minor"
    category: "wrong-path"
    summary: "brief cites redesign-vnext.md §C1/§C2/§C3/§C4 but doc has no such headings — C1-C4 are bullets under '### C. בועות שיחה'"
    source_brief: "§0 Reading-list line 34, 36"
    source_code: "docs/plans/redesign-vnext.md:123-140"
    cost_estimate: "2min"
---

# Plan Verification — slice-redesign-5-bubbles

> **Brief**: docs/plans/slice-redesign-5-bubbles.md
> **Base tip**: 83349df (branch `slice-redesign-4-input-mic`)
> **Verdict**: 🟡 USABLE-AFTER-FIX
> **אומדן זמן אליעזר confusion אם לא תוקן**: 15-30 דק' (בעיקר finding #1 — עומק הקינון של drill-down)

## בעיות שנמצאו

### 🟡 Confusion / Outdated

| # | בעיה | מקור (brief / קוד) | הצעה |
|---|------|--------------------|------|
| 1 | **drill-down depth mismatch**: המוקאפ ChatColumn (494-547) מראה בועת-כלי אחת שמקבצת **3 פעולות** ("הרצתי 3 פעולות: bash·git status / read·package.json / glob") עם `<details>` מקונן פר-פעולה (3 רמות). אבל ה-data-model הוא **ToolCall אחד פר-ToolBubble** (`toolCall: ToolCall` יחיד) — אין קיבוץ כמה tool calls לבועה אחת. בועה אמיתית = summary(narration)→args→result בלבד = **2 רמות**. ה-brief §2/§4 כותב "סיכום→פעולות→פקודה+תוצאה" שעלול להטעות את אליעזר לבנות קינון 3-שכבתי או לנסות לקבץ tool calls (שדורש שינוי data-model — **אסור** לפי §2 שורות 68-69). | brief §2 ל'64, §4 Commit 4 ל'133, §9 Q4 / `types/bubble.ts:82` (`toolCall: ToolCall` יחיד), `agent-session` דוחף בועת tool אחת פר-call | מרדכי: להבהיר ב-§C2 ש-drill-down הוא **פר-tool-call יחיד** (narration summary → expand → args+result+content); הקיבוץ הרב-פעולתי במוקאפ הוא **אילוסטרטיבי בלבד / לא בסקופ**. native `<details>` חיצוני אחד + ה-`{#if expanded}` הקיים, לא 3 רמות. |
| 2 | **line number**: ה-brief מצטט `agent-session:540` ל"chunks→segments". הפונקציה `#appendChunk` היא בשורה **525**, וה-`.segments.push()` בפועל בשורות **543/545**. האזור נכון, המספר 540 לא מדויק. | brief §0 ל'34, §C1 ל'105 / `agent-session.svelte.ts:525` | עדכן 540→525 (או 543) — אזורי, לא חוסם. |

### 🟢 Minor

| # | בעיה | מקור |
|---|------|------|
| 3 | ה-brief מפנה ל-`redesign-vnext.md §C1` (must-read) אבל אין כותרת `§C1` במסמך. C1-C4 הם bullets (`**C1**`...) תחת `### C. בועות שיחה (Chat bubbles)` (ל'123-140). ניתן לחיפוש לפי "C1", אבל הסימון `§C1` שגוי. | brief §0 ל'34, 36 / `redesign-vnext.md:123-140` |

## Spot-check שעבר (לא מצא בעיה)

- ✅ **base branch** `slice-redesign-4-input-mic` קיים; שרשרת redesign-1/2/3/4 כולה present (`git branch` מאשר). depends_on [redesign-1, redesign-2] מסופק במלואו דרך השרשרת.
- ✅ **package name** `@drive-coding/frontend-v2` — `packages/frontend/package.json:2` מאשר.
- ✅ **4 קומפוננטות bubble קיימות**: UserBubble/MessageBubble/ThoughtBubble/ToolBubble.svelte ב-`components/chat/bubbles/`.
- ✅ **diagnosis C1 מדויק**: ThoughtBubble.svelte:23-30 עושה `{#each displaySegments}` עם `<div class="segment">` + `margin-bottom:0.4em` (ל'61) = הברה-בשורה (הבאג). MessageBubble.svelte:26 כבר עושה `joinSegmentText(bubble.segments)` (טקסט רץ ✓). ההבחנה ב-brief ל'40-41 נכונה לחלוטין.
- ✅ **Speaker rendering-only safe**: speaker.svelte.ts:215-246 צורך `bubble.segments`, מצרף `.text` עם `.join("")` ומריץ `splitIntoSentences` על buffer — **לא תלוי ב-margin/div של ה-UI**. טענת ה-brief (§C1 ל'106-107) ש"rendering היה הבעיה היחידה" מאומתת.
- ✅ **reactivity-lock**: `<span class="hidden">{bubble.segments.length}</span>` קיים ב-ThoughtBubble:32 (brief §6 #2 ל'162 — "שמור"). קיים גם ב-Speaker $effect:127-133 (נועל segments.length פר-בועה).
- ✅ **bubble-rendering helpers**: `joinSegmentText` (ל'3-5) ו-`visibleThoughtSegments` (ל'7-10) קיימים. `visibleThoughtSegments` מבדיל מתורגם↔מקור (מסנן `originalText !== undefined`) — בדיוק כפי ש-brief §C1 ל'102 מניח.
- ✅ **i18n keys קיימים** (keys.ts): `chat.bubble.user/thought/agent` (33-35), `chat.tool.status.*` (58-61), `chat.tool.args/result/loading_narration/raw/locations/content/terminal/diff.*` (62-71). אין מפתח עברי קשיח חדש שנדרש.
- ✅ **4 Lucide icons resolve**: brain, wrench, sparkles, user — כולם קיימים ב-`@lucide+svelte@1.3.0` store. דפוס import `@lucide/svelte/icons/<kebab>` בשימוש פעיל (AppHeader/MicLarge וכו').
- ✅ **CSS tokens קיימים** (app.css, 4 פלטות): `--bubble-user`/`--bubble-agent` (C4, ל'31-32/51-52/71-72/91-92), `--bg-card`, `--thinking`, `--accent-hi`, `--border-str`, `--fg-dim`, `--bg-elev`. brief §6 ל'165 (`var(--thinking)`) + מוקאפ avatarCfg (`--accent-hi`/`color-mix`) — כולם מכוסים.
- ✅ **מוקאפ line ranges מדויקים**: Avatar 238-243 ✓, ChatBubble-user/agent 249-262 ✓, ThoughtBubble 264-278 ✓, ToolBubble 280-291 ✓, ChatColumn drill-down 494-558 ✓, avatarCfg 1136-1147 ✓.
- ✅ **C2 diagnosis מדויק**: ToolBubble.svelte:130 כרגע `align-self: stretch` (רוחב מלא) — בדיוק מה ש-brief §C2 רוצה לשנות ל-`self-end + max-w-[78%]`.
- ✅ **ToolBubble slice-16 content נשמר**: content (text/diff/terminal/other), locations, raw — כולם מרונדרים (ToolBubble:73-113); `tool-format` util (formatToolInput/prettyJson/formatLocation) קיים. brief §4 ל'134 "שמור על התוכן הקיים" בר-ביצוע.
- ✅ **BubbleRenderer לא משתנה**: switch dispatcher (29 שורות) ל-4 kinds — brief §3 ל'92 נכון שה-avatar נכנס בתוך כל bubble, לא ב-renderer.
- ✅ **types/bubble.ts לא משתנה**: Segment/ThoughtSegment/ToolCall/ToolBubble כולם תואמים את הנחות ה-brief. DoD §5 ל'151 (git diff לא נוגע) בר-אכיפה.

## Verdict

🟡 **USABLE-AFTER-FIX** — אין blocker. ה-base נכון, כל ה-APIs/symbols/tokens/icons/i18n מאומתים, ו-diagnosis ה-C1 מדויק להפליא (כולל Speaker safety). תיקון יחיד שמשנה: **finding #1** — להבהיר ב-§C2 שה-drill-down הוא פר-tool-call יחיד (2 רמות), והקיבוץ הרב-פעולתי במוקאפ הוא אילוסטרטיבי/לא-בסקופ — אחרת אליעזר עלול לבנות קינון 3-שכבתי או לנסות לקבץ tool calls (שאוסר על שינוי data-model). findings #2/#3 קוסמטיים (line number + סימון §). ~15 דק' עריכה של מרדכי.
