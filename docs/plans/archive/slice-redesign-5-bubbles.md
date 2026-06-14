# Slice redesign-5 — Bubbles: C1 segments bug + tool align + avatars — תוכנית

> **תאריך**: 2026-06-01
> **סטטוס**: טיוטה
> **Complexity**: 7/10 (verifier: light, **phase-verifier אחרי Commit 1/C1**)
> **תלות**: depends_on: [redesign-1, redesign-2]
> **base**: branch הקצה הנוכחי של השרשרת (בד"כ slice-redesign-4-input-mic)

---

## §0 — Pre-flight

> ⚠️ **brief בשרשרת — אומת מול תכנון, לא מול קוד קיים.** Tailwind/tokens (redesign-1) ו-AppShell
> (redesign-2) טרם קיימים ב-dev. ה-base = ה-branch של ה-slice הקודם בשרשרת, **לא dev**. אם 1+2 טרם
> בוצעו → עצור. **הערה ל-C1**: הבדיקה מול agent-session/Speaker (שלא משתנים) — תקפה כבר עכשיו.

### Worktree (שרשור)
```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-redesign-5-bubbles -b slice-redesign-5-bubbles <branch-של-הקודם>
cd .worktrees/slice-redesign-5-bubbles
pnpm install && pnpm hooks:install
```

### Run / Browser / OneCLI
- FE: `pnpm --filter @drive-coding/frontend-v2 dev`
- **BE חובה** (thoughts streaming + tool calls + tts צריך OneCLI): `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts`
- Chrome מקומי. **בדיקה קריטית ל-C1**: שלח פרומפט שמייצר מחשבה ארוכה (thought) — ודא שהמחשבה
  מוצגת כ**טקסט רץ** ולא הברה-בשורה. (זה הבאג ש-C1 מתקן.)
- שם package: `@drive-coding/frontend-v2`.

### Reading list
**must-read**:
- `dev/docs/plans/redesign-vnext.md` §C1 — **תיאור הבאג המלא** (agent-session:540 chunks→segments,
  ThoughtBubble margin per segment). + §C2 (tool align), §C3 (avatars), §C4 (פלטה).
- `dev/docs/plans/redesign-vnext-mockup.html` — `ThoughtBubble` (264-278), `ToolBubble` (280-291 +
  ChatColumn 494-558 דמו drill-down), `ChatBubble-user/agent` (249-262), `Avatar` (238-243 + avatarCfg 1136-1147).
- `view-models/speaker.svelte.ts` שורות 1-60 + 196-260 — **קריטי**: ה-Speaker צורך `bubble.segments`
  כ-buffer ומריץ splitIntoSentences בעצמו. **אסור לשבור את מבנה ה-segments.** ראה §C1-approach.
- `components/chat/bubbles/*` — הקוד הקיים. **שים לב**: MessageBubble כבר עושה `joinSegmentText`
  (טקסט רץ ✓). רק **ThoughtBubble** עושה div-per-segment (זה הבאג).
- `types/bubble.ts` — Segment/ThoughtSegment/ToolCall.

**reference**: `bubble-rendering.ts` (joinSegmentText/visibleThoughtSegments), `main` branch
`BubbleAvatar.svelte` (C3 reference, אבל **אל תעתיק** — בנה Lucide-based מהמוקאפ avatarCfg).

---

## §1 — מטרה

הבועות נכתבות לפי המוקאפ עם תיקון הבאג הקריטי C1: מחשבות הסוכן מוצגות כ**טקסט רץ** (לא הברה-בשורה).
בנוסף: בועות כלים מרוכזות בצד המודל (לא רוחב מלא) עם drill-down מקובץ; אווטארים (Lucide) ליד הבועות;
פלטת הצבעים החדשה על כל סוגי הבועות. **ה-data-model של segments נשאר ללא שינוי** (ה-Speaker מסתמך עליו) —
התיקון הוא ב-rendering בלבד.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| **C1**: ThoughtBubble — טקסט רץ במקום div-per-segment | ✅ | כאן (rendering-only) |
| **C2**: ToolBubble align self-end + max-width (לא stretch) | ✅ | כאן |
| **C2** drill-down: סיכום→פעולות→פקודה+תוצאה (details מקוננים) | ✅ | כאן |
| **C3**: avatars (Lucide) ליד user/agent/thought/tool | ✅ | כאן |
| **C4**: פלטת בועות (bubble-user/bubble-agent tokens) | ✅ | כאן |
| המרת UserBubble/MessageBubble/ToolBubble/ThoughtBubble ל-Tailwind | ✅ | כאן |
| **שינוי data-model של segments** (מיזוג chunks ב-agent-session) | ❌ | **לא** — C1 נפתר ב-rendering (§C1) |
| **שינוי Speaker pipeline** | ❌ | — (Speaker ממשיך לצרוך segments as-is) |
| smart-scroll / jump-down | ❌ | redesign-7 |
| markdown parity | ✅ (שמירה) | MessageBubble כבר עושה marked+dompurify — לשמר |

> **קו אדום ל-C1**: ההכוונה הראשונית הייתה "אולי slice עם data-model refactor". אחרי בדיקה:
> **לא צריך.** ה-segments נשארים (Speaker buffer + thought translation per-segment תלויים בהם).
> התיקון: ThoughtBubble מרנדר את הטקסט **רץ** (join), לא div-per-segment. אם executor מתפתה
> לגעת ב-`agent-session.#appendChunk` או ב-Speaker → **עצור** (escalation).

---

## §3 — Architecture diagram

```
components/chat/bubbles/         ← כל הקבצים נכתבים מחדש ל-Tailwind + מוקאפ
  UserBubble.svelte              — self-start, avatar user, bubble-user token (מוקאפ 249-255)
  MessageBubble.svelte           — self-end, avatar agent, bubble-agent token, markdown נשמר (256-262)
  ThoughtBubble.svelte           — **C1 FIX**: טקסט רץ + translation מתחת (264-278)
  ToolBubble.svelte              — **C2 FIX**: self-end + max-w + drill-down (280-291, 494-558)
components/chat/Avatar.svelte    ← חדש (C3): Lucide icon לפי kind (user/agent/thought/tool), avatarCfg
components/chat/bubbles/bubble-rendering.ts  ← אולי additive (helper לטקסט-רץ של thought)
i18n/keys.ts                     ← additive (אם צריך labels חדשים — bubble kind labels כבר קיימים)
```
**אין שינוי**: `agent-session.svelte.ts`, `speaker.svelte.ts`, `types/bubble.ts`, BubbleRenderer (אלא
אם מוסיפים avatar — אז BubbleRenderer לא משתנה, ה-avatar בתוך כל bubble component).

### §C1 — איך מתקנים (קריטי)
**הבעיה**: `ThoughtBubble.svelte` עושה `{#each displaySegments as seg}` עם `<div class="segment">`
+ `margin-bottom: 0.4em` → כל chunk (2-3 אותיות) = שורה.
**התיקון**: רנדר את הטקסט **רץ**:
- אם **אין** תרגום (originalText undefined בכולם): `joinSegmentText(segments)` → `<div dir="auto">` אחד רץ.
- אם **יש** תרגום: ה-thought translation עובד per-segment (Speaker מעדכן `seg.originalText` per segment,
  שם segment=משפט-תרגום). במצב זה, רנדר כל segment מתורגם כפסקה (זה תקין — segment=משפט, לא chunk).
  כלומר: `visibleThoughtSegments` כבר מבדיל. **הכלל**: כשמציגים את ה**מקור** (לא מתורגם) — join לרץ.
  כשמציגים **מתורגם** — segment-per-משפט (כי אז segment באמת = יחידת-תרגום, לא chunk).
- מעשית: הסר את ה-`margin-bottom: 0.4em` הגלובלי; בנה rendering שמצרף chunks רצופים לטקסט רץ.
> **למה זה עובד**: ה-chunks נדחפים כ-segments נפרדים (agent-session:540) אבל הם **טקסט רציף** של אותה
> מחשבה. join שלהם = הטקסט המקורי המלא. ה-Speaker ממילא מצרף אותם ל-buffer לפני splitIntoSentences,
> אז אין לו תלות ב-margin/div של ה-UI. **ה-rendering היה הבעיה היחידה.**

---

## §4 — Commits

### Commit 1 — C1: ThoughtBubble טקסט רץ (approach: manual + **phase-verifier**)
**קובץ**: `ThoughtBubble.svelte` נכתב מחדש (Tailwind + מוקאפ 264-278). rendering לפי §C1:
מקור→join רץ; מתורגם→per-segment. avatar thought (Lucide Brain). border-dashed, italic, tokens.
**Verification**: `typecheck` + ידני **קריטי**: BE+FE, פרומפט עם מחשבה ארוכה → **טקסט רץ, לא הברה-בשורה**.
> **אחרי Commit זה — הפעל calev phase-verifier** (C1 הוא הליבה; אם שבור, כל השאר מתמוטט).
> Task(calev, "mode: phase, Brief: ..., Commit: <hash>, בדוק ספציפית: מחשבה ארוכה = טקסט רץ").

### Commit 2 — Avatar component (C3) (approach: manual)
**קובץ חדש**: `Avatar.svelte` — Lucide icon לפי `kind` (מוקאפ avatarCfg 1136-1147):
user→User, agent→Sparkles, thought→Brain, tool→Wrench. צבע/רקע לפי kind (color-mix tokens).
**Verification**: `typecheck`.

### Commit 3 — User + Message bubbles (C4) (approach: manual)
`UserBubble.svelte` (self-start, avatar user, bubble-user token, מוקאפ 249-255).
`MessageBubble.svelte` (self-end, avatar agent, bubble-agent token, **markdown נשמר** — joinSegmentText
+ renderMarkdown כמו היום, רק עיצוב Tailwind). 
**Verification**: `typecheck` + ידני: בועות user ימין, agent שמאל, צבעים מהפלטה, markdown עובד.

### Commit 4 — ToolBubble (C2) + drill-down (approach: manual)
`ToolBubble.svelte` (מוקאפ 280-291 + drill-down 494-558): self-end + `max-w-[78%]` (לא stretch),
avatar tool, status dot (ירוק=completed, כתום-פועם=in_progress), details מקוננים (סיכום→פעולה→פקודה+תוצאה).
שמור על התוכן הקיים (narration, content, locations מ-slice 16). 
**Verification**: `typecheck/build/test/lint:i18n` + ידני: כלי מרוכז שמאל (לא רוחב מלא), drill-down נפתח.

---

## §5 — DoD

| בדיקה | איך |
|---|---|
| typecheck/build/test/i18n נקיים | 4 פקודות |
| **C1: מחשבה = טקסט רץ** | פרומפט עם thought ארוך → טקסט רציף, **לא** הברה-בשורה |
| C1: תרגום עדיין עובד | translateThoughts on → תרגום עברי מוצג מתחת (per-משפט תקין) |
| C2: כלי מרוכז שמאל | ToolBubble self-end + max-width, לא נמתח לרוחב מלא |
| C2: drill-down | סיכום→פעולות→פקודה+תוצאה (details מקוננים) נפתחים |
| C3: avatars | אווטאר Lucide ליד user/agent/thought/tool |
| C4: פלטה | bubble-user/bubble-agent בצבעי הפלטה; החלפת פלטה משנה |
| markdown נשמר | MessageBubble: bold/code/list/links עובדים |
| data-model לא שונה | `git diff` לא נוגע ב-agent-session.svelte.ts / speaker.svelte.ts / types/bubble.ts |
| Speaker עדיין עובד | הקראה (TTS) של הודעות+מחשבות עובדת כרגיל |

---

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| **C1 fix שובר תרגום מחשבות** | thought translation per-segment | התיקון מבדיל מקור(join)↔מתורגם(per-segment). `visibleThoughtSegments` כבר מבחין. בדוק שני המצבים. |
| **C1 פיתוי לגעת ב-data-model** | redesign-vnext §C1 "אולי slice ייעודי" | **לא צריך.** rendering-only. אם נוגעים ב-#appendChunk/Speaker → escalation. |
| Speaker reactivity נשבר | Speaker קורא segments.length | אל תשנה את מבנה segments. ThoughtBubble ה-`<span class="hidden">{segments.length}</span>` — **שמור** (lock reactivity, gotcha §6 #2). |
| Tool drill-down עם content/diff/terminal (slice 16) | types/bubble ToolContent | שמור את הרינדור הקיים של content/locations; רק עטוף ב-details המקוננים. |
| Hardcoded Hebrew | hook | labels מהמפתחות הקיימים (chat.bubble.*, chat.tool.*). אם חדש → t(key). |
| avatar צבע per-kind | מוקאפ color-mix | השתמש ב-color-mix tokens מהמוקאפ (var(--accent)/var(--thinking)). |

---

## §7 — Escalation triggers
- C1 דורש שינוי ב-`agent-session.#appendChunk` או ב-Speaker buffer logic → עצור (אמור להיות rendering-only).
- תרגום המחשבות נשבר מהתיקון של C1 ואי-אפשר לתקן ב-rendering → עצור.
- ToolBubble content (diff/terminal מ-slice 16) לא מתאים ל-drill-down של המוקאפ → עצור ושאל.

## §8 — Complexity score
**7/10 → light + phase-verifier אחרי Commit 1.** commits 4, שכבות: Avatar + 4 bubbles rewrite (+1),
אין API חיצוני, **C1 = תיקון באג עדין עם תלות ב-Speaker** (+2), drill-down tool (+1), פלטה+avatars (+1),
markdown parity לשמר (+1). ≈7. C1 הוא הסיכון → phase-verifier אחרי Commit 1. שאר ה-slice ויזואלי → light.

## §9 — שאלות פתוחות
| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | C1 — rendering-only או data-model? | **rendering-only** (Speaker מסתמך על segments) | ❌ (הוכרע) |
| 2 | thought מתורגם — per-segment או join? | מתורגם=per-משפט (segment=יחידת-תרגום); מקור=join רץ | ❌ |
| 3 | avatar icons — אילו Lucide? | User/Sparkles/Brain/Wrench (מוקאפ avatarCfg) | ❌ |
| 4 | drill-down tool — `<details>` native או Bits Collapsible? | native `<details>` (המוקאפ עושה כך, בלי JS) | ❌ |
