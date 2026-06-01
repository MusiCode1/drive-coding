# Redesign vNext — מסמך ריכוז דרישות

> **סטטוס:** טיוטה לאיסוף דרישות (לא brief לביצוע). נכתב 2026-06-01 ע"י מרדכי
> אחרי בקשת שיפוץ עיצוב רדיקלי מהמשתמשת.
> **מטרת המסמך:** לתפוס את *כל* הדרישות במקום אחד לפני שמתחילים לתכנן slices
> אחד-אחד, כדי שכלום לא יברח. תכנון ה-slices עצמם יבוא אחרי שהמסמך מאושר.
>
> ⚠️ **המסמך הזה אינו — ולא יהיה בשום שלב — מסמך החלטות.** הוא ריכוז דרישות
> ושאלות פתוחות בלבד. ההחלטות בפועל (Tailwind כן/לא, ספריית קומפוננטות, פלטה,
> וכו') ייכתבו במקום אחר: או במסמך ההחלטות הראשי (`docs/decisions/voice-acp.md`)
> או במסמך החלטות ייעודי לרדיזיין — ייקבע בהמשך. סעיף §1 כאן מציג *אפשרויות
> והמלצות לדיון*, לא הכרעות. אל תקרא ממנו כאילו הוחלט משהו.

---

## 0. רקע ומקורות

המשתמשת ביקשה שיפוץ עיצוב רדיקלי. הבעיה המרכזית: **בדסקטופ קשה לקרוא**
(הכל פרוס לרוחב מלא), **במובייל הגיוני יותר** אבל עדיין לא מעוצב.

### מקורות שנבדקו
- ✅ **המוקאפ המאושר (2026-06-01) — זה ה-anchor.** קובץ:
  `mockup-vnext-components.html` (מיקום קבוע ייקבע — ראו §7). HTML יחיד +
  Tailwind v4 (browser CDN) + 4 פלטות (`@theme`/`[data-palette]`), **מפורק
  לקומפוננטות** ב-`<template>` עם מנגנון `<x-use>` (כל template ↔ Svelte
  component עתידי). מכסה את כל §2. **הקובץ עצמו מתעד את הדרישות בהערות**:
  בראשו "מפת דרישות → קומפוננטה", בתחתיתו "לא במוקאפ" (התנהגויות דינמיות).
  **כל slice עיצובי = "תרגם קומפוננטה מהמוקאפ לקוד".**
- `Draft/mockup-full.html` — מוקאפ קדום (המסך הראשי בלבד). היסטורי.
- `Draft/v1-index.html` / `Draft/v1-config.html` — גרסה ישנה (vanilla JS, single-file).
  מכילה פיצ'רים שנעלמו ב-v2: smart-scroll עם jump-down, folder-picker modal,
  per-message replay, ⏮/⏭ navigation, voice picker.
- `main` branch (FE ישן) — `BubbleAvatar.svelte` + `Icon.svelte` (Lucide wrapper).
  אווטאר של משתמש + אווטאר מודל היו כאן ונמחקו ב-cutover ל-v2.

### מצב ה-FE הנוכחי (dev, tip 115419d)
- **אין Tailwind.** רק CSS גלם + design tokens חלקיים ב-`app.css`.
- **אין ספריית קומפוננטות** (אין shadcn/Skeleton/Melt).
- **אין ספריית icons.** אימוג'ים hardcoded ב-`tool-format.ts` + קומפוננטות
  (⚙️, 🔊, 🎙, 💭...).
- ארכיטקטורה: 5 שכבות נקיות (view-models / actions / engines / adapters / routes)
  עם 5 חוקי זהב (`packages/frontend/AGENTS.md`). **כל שינוי חייב לכבד אותם.**

---

## 1. נושאים-יסוד שדורשים הכרעה (לפני תכנון)

> אלו נושאים שמשפיעים על *כל* ה-slices. כאן רק **אפשרויות והמלצות לדיון** —
> ההכרעה עצמה תירשם במסמך ההחלטות (ראו ההערה בראש הקובץ), לא כאן.

### 1.1 Tailwind — ✅ הוכרע: מיגרציה מלאה
- **המשתמשת הכריעה (2026-06-01): Tailwind 4, מיגרציה מלאה — לא הדרגתית.**
  (ההחלטה עצמה תתועד ב-decisions; מצוין כאן כדי שהתכנון לא יחזור לשקול "הדרגתי".)
- משמעות: כל ה-CSS הגלם הקיים מומר ל-Tailwind. tokens ב-`@theme`. ה-slice
  הראשון של ה-foundation מוסיף את ה-Vite plugin + ממיר את `app.css`.
- אילוץ נגזר: כל slice עיצובי שאחרי ה-foundation כבר כותב Tailwind, לא CSS גלם.

### 1.2 ספריית קומפוננטות
- אופציות ל-Svelte 5: **Melt UI** (headless, גמיש, מתאים ל-design ייחודי),
  **Bits UI** (shadcn-svelte תחתיו), **Skeleton** (opinionated).
- מה שאנחנו *באמת* צריכים: Dialog/Sheet, Select, Toggle/Switch, Tabs, ScrollArea.
- **המלצה:** Melt UI או Bits UI — headless, לא כופים "look" גנרי, מאפשרים
  את הצבעוניות הייחודית שביקשת. **לא Skeleton** (מרגיש גנרי).
- **פתוח:** המשתמשת בוחרת. צריך החלטה לפני slice הראשון של קומפוננטות.

### 1.3 ספריית icons
- **המלצה:** `lucide-svelte` (היה בשימוש ב-FE הישן, מוכר, נקי). מחליף את כל
  האימוג'ים.
- **פתוח:** Lucide מאשר? (יש גם Phosphor/Tabler אם רוצים סגנון אחר.)

### 1.4 פלטת צבעים — ✅ הוכרע: 4 פלטות כ-themes
- **המשתמש הכריע (2026-06-01):** לא לסגור על פלטה אחת כעת. **כל 4 הפלטות
  נשמרות כ-themes** (ערכות נושא) שהמשתמש מחליף ביניהן. אולי בהמשך נצמצם.
- 4 הפלטות (מוגדרות ב-`mockup-vnext.html`, `@theme` + `[data-palette]`):
  🔥 Ember (נחושת חם) · 🌲 Forest (sage רגוע) · 🍇 Plum (לבנדר יוקרתי) ·
  🪸 Teal (טורקיז מודרני).
- אילוץ נגזר: ה-foundation slice חייב מנגנון theme-switching (data-attr על
  `<html>` + `localStorage`), לא פלטה קשיחה אחת.

> ⚠️ 4 ההחלטות האלו הן ה-gate לכל השאר. בלי החלטה עליהן, כל slice עיצובי
> יתבסס על הנחות שעלולות להישבר.

---

## 2. רשימת הדרישות המלאה

מחולק לפי קטגוריה. כל פריט מסומן: 🆕 חדש · 🔧 תיקון באג · ♻️ הוחזר מגרסה ישנה.

### A. פריסה כללית (Layout shell)
- **A1** 🔧 **פריסה אחידה שחלה גם על המסך הראשי וגם על חלון ההגדרות.**
  היום `/chat` ו-`/settings` הם shells נפרדים. צריך layout משותף
  (header אחיד, רוחב מקסימלי בדסקטופ, רקע אחיד).
- **A2** 🔧 **רוחב מקסימלי בדסקטופ** — היום הכל נמתח לרוחב מלא וקשה לקרוא.
  המוקאפ מרכז את התוכן. זה ה-fix העיקרי לבעיית הקריאוּת בדסקטופ.
  - **A2a** (דגש מהמשתמש, 2026-06-01): **שתי רמות max-width** — ה-shell
    החיצוני רחב (`max-w-3xl`, מקום ל-UI) ו**עמודת הבועות הפנימית צרה יותר**
    (`max-w-2xl`, קריאוּת אופטימלית). במוקאפ זה ממומש כ-container פנימי
    `mx-auto` בתוך אזור ה-scroll.
  - **A2b** (דגש): **ריספונסיב מובייל↔דסקטופ** — אותו shell, רק max-width
    שונה. במוקאפ יש demo-toggle 📱/🖥 להמחשה.
- **A3** 🆕 Floating header (מהמוקאפ) — ☰ (תפריט) + שם סוכן + cwd + סטטוס
  connected + ⚙, עם blur/gradient. במקום ה-header המלא הנוכחי.
- **A4** 🆕 (דגש): **footer fade** — אזור ה-mic מתמזג להודעות בהדרגה (gradient
  מ-transparent ל-bg-elev), לא `border-t` חד.
- **A5** 🆕 (דגש): **פס גלילה אלגנטי** להודעות — דק, שקוף-עד-hover, מרווח מהקצה
  (`.chat-scroll` במוקאפ).

### B. קלט — Toggle הקלדה/הקלאה + mic גדול
- **B1** 🆕 **Toggle שמחליף בין מצב הקלדה למצב הקלטה.**
  - מצב הקלדה → Input טקסט (כמו היום, ChatInput).
  - מצב הקלטה → **לחצן גדול וברור מאוד** להתחלת/סיום הקלטה (מהמוקאפ: 110px
    עגול, פועם באדום בהקלטה, ירוק/אחר בהשמעה).
- **B2** 🔧 לחצן ההקלטה היום (MicButton) קטן. צריך להגדיל משמעותית (110px)
  ולחזק את ה-states (idle/recording/speaking) — המוקאפ מראה את זה.
  - **B2a** (דגש): ה-mic **תמיד ממורכז** — כפתורי-צד צפים (absolute), לא
    דוחפים אותו. במוקאפ: wrapper `relative` + stop `absolute`.
- **B3** ✂️ **side-buttons: stop (⏹) בלבד בשלב זה.** לחצן "השמע אחרון" (🔊)
  **נמחק** (החלטת המשתמש 2026-06-01). בהמשך יתווספו ⏮/⏭ (אחורה/קדימה) —
  **slice נפרד**, לא עכשיו.
- **B4** 🆕 (דגש): **אנימציות מעבר בין מצבים** (הקלטה⇄הקלדה, idle→rec→speak).
  במוקאפ: crossfade על record/type areas + transition על ה-mic.

### C. בועות שיחה (Chat bubbles)
- **C1** 🔧 **באג קריטי: סטרימינג מחשבות — כל הברה בשורה נפרדת.**
  - **שורש הבעיה:** `agent-session.svelte.ts:540` — כל `agent_thought_chunk`
    (2-3 אותיות) נדחף כ-**segment חדש** למערך `segments`. ThoughtBubble
    מרנדר כל segment כ-`<div class="segment">` עם `margin-bottom: 0.4em`
    (`ThoughtBubble.svelte:60`), אז כל chunk נראה כשורה.
  - **הכוונה המקורית:** segment = יחידת תרגום (משפט שלם שה-Speaker מתרגם),
    לא chunk. הסטרימינג שובר את ההנחה.
  - **כיוון תיקון:** או (א) chunks מאותו messageId מתאחדים לטקסט רץ בתוך
    segment אחד עד שמגיע גבול-תרגום, או (ב) ה-CSS מרנדר segments כ-inline/רץ.
    דורש חשיבה על data-model — **כנראה slice ייעודי עם plan-verify.**
- **C2** 🔧 **חלונות הכלים תופסים את כל הרוחב.** היום `ToolBubble` עם
  `align-self: stretch` (שורה 130). צריך **לרכז אותם בצד שמאל** (צד המודל) —
  `align-self: flex-end` + max-width, כמו שאר בועות הסוכן.
- **C3** 🆕♻️ **אווטארים.** החזרת `BubbleAvatar` מ-`main` — אווטאר משתמש +
  אווטאר מודל ליד הבועות. (מבוסס Icon, badge עגול קטן. ראה
  `main:packages/frontend/src/lib/components/BubbleAvatar.svelte`.)
- **C4** 🆕 החלת פלטת הצבעים החדשה על כל סוגי הבועות (user/agent/thought/tool).

### D. מסך הגדרות סשן
- **D1** 🔧 **לארגן מחדש את `AgentOptionsPanel` / `/settings` באופן הגיוני יותר.**
  היום זה panel מתקפל צפוף בראש ה-chat. צריך מבנה ברור.
- **D2** 🔧 **גדול ונוח לתפעול במובייל** — שדות/dropdowns בגודל מגע, מרווח.
- **D3** A1 חל גם כאן (אותו layout shell).

### E. פופ-אפים / Modals (תכנון מחדש)
- **E1** 🆕 **פופ-אפ "סשנים אחרונים".** במקום רשימה רגילה — modal/sheet שמציג
  את כל הסשנים האחרונים, גלילה קלה ביניהם, **+ לחצן רענון** למשיכת סשנים
  חדשים. (היום יש `SessionPicker.svelte` בסיסי — צריך שדרוג.)
- **E2** 🆕♻️ **פופ-אפ בחירת תיקייה נוח למובייל.** v1 היה לו folder-picker
  modal (breadcrumb + רשimת תיקיות + ניווט up). צריך להחזיר אבל **גדול,
  עם לחצנים נוחים למגע.** (`/api/ls` כבר קיים ב-BE.)
- **E3** 🆕 Bottom-sheet — ראה §H (הוחלט: ה-sheet הוא ה-mobile equivalent של
  ה-sidebar, מכיל אפשרויות סוכן + סשנים, לא "ניווט" כללי).

### H. Responsive layout: sidebar (דסקטופ) ↔ bottom-sheet (מובייל) 🆕
(דגש המשתמש, 2026-06-01 — החלטת מבנה מרכזית)
- **H1** **דסקטופ: sidebar קבוע בצד** (`aside`, `w-72`, צד-start לוגי) המכיל:
  - **אפשרויות סוכן** — סוכן / מודל / רמת חשיבה (dropdowns).
  - **רשימת סשנים** — כרטיסים + לחצן רענן + "סשן חדש".
  - ה-shell מתרחב ל-`max-w-6xl` בדסקטופ כדי לתת מקום ל-sidebar + chat.
- **H2** **מובייל: bottom-sheet נמשך** (כמו `mockup-full.html`) עם **אותו תוכן
  בדיוק** (אפשרויות + סשנים). ידית peek גלויה בתחתית; משיכה/לחיצה פותחת.
- **H3** **DRY:** אותו תוכן מוזרק לשני המיקומים — component משותף
  (`<SessionOptionsPanel>`) שמרונדר ב-`aside` בדסקטופ וב-sheet במובייל.
  ה-switch לפי breakpoint (`md:`), לא דופליקציה.
- **H4** זה מאחד/מחליף את E1 (sessions popup) ו-AgentOptionsPanel הנוכחי:
  בדסקטופ הם תמיד גלויים ב-sidebar; אין צורך ב-popup נפרד. במובייל הם ב-sheet.
  (מסך sessions/settings מלא נשאר זמin לניהול מעמיק, אבל הגישה המהירה ב-sidebar/sheet.)

### F. תשתית עיצוב (Design system)
- **F1** 🆕 design tokens מאוחדים (צבע/spacing/radius/font) — מהמוקאפ, מורחב
  לפלטה הייחודית. מקור-אמת אחד (`app.css` @theme אם Tailwind).
- **F2** 🆕 החלפת אימוג'ים ב-icon library (תלוי 1.3).
- **F3** 🆕 קומפוننטות בסיס מהספרייה הנבחרת (Dialog/Sheet/Select/Switch/Tabs).

### G. פיצ'רים מגרסאות ישנות ששווה לשקול להחזיר
(מ-v1 — לא בקשה מפורשת, אבל "לחפש אם שכחתי משהו")
- **G1** ♻️ **Smart-scroll + jump-down button** — v1 כיבה auto-scroll כשהמשתמש
  גלל למעלה והראה כפתור ↓. כרגע `ChatBubbles` תמיד נצמד לתחתית (זורק משתמש
  שגלל למעלה — זה גם B5 ב-code-review). **כדאי להחזיר.**
- **G2** ♻️ **Per-message replay (🔊) + ⏮/⏭ navigation** — v1 אִפשר להשמיע כל
  הודעה בנפרד ולנווט בתור הניגון. ב-v2 חלקי.
- **G3** ♻️ **car mode** (כבר slice 7 מתוכנן) — toggle במוקאפ. לתאם.
- **G4** ♻️ markdown מלא בבועות (קיים ב-v2 דרך marked+dompurify — לוודא parity).

---

## 3. אילוצים ארכיטקטוניים (לא לשבור)

כל slice עיצובי חייב לכבד:
1. **5 חוקי הזהב** (`packages/frontend/AGENTS.md`) — routes shells דקים,
   VMs=entities, components=leaves, effects אצל owner ה-state, אין backward-compat.
2. **i18n** — אין מחרוזות עברית בקוד. כל טקסט דרך `t("key")` + catalog.
   (lint חוסם — `pnpm lint:i18n`.)
3. **parallel-safe** — שינוי בקבצים משותפים (`context.ts`, `+layout.svelte`,
   `i18n/keys.ts`) לפי `docs/conventions/parallel-safe-code.md`.
4. **dir/RTL** — `dir="auto"` על תוכן מעורב, logical properties.

---

## 4. גישת העבודה — ✅ הוכרע: מוקאפ-תחילה (mockup-first)

> **המשתמשת הכריעה (2026-06-01):** לא לתכנן slices "באוויר". קודם בונים
> **מוקאפ מלא ומאושר**, ואז כל slice הופך ל"תרגם את האזור הזה לקוד" — קל
> ומדויק. המוקאפ הוא ה-anchor של כל התכנון.

### 4.1 שלב המוקאפ (קודם — לפני כל slice)
- מרחיבים את `Draft/mockup-full.html` (כיום מכסה רק את המסך הראשי) למוקאפ
  שמכסה את **כל** המסכים והמצבים מ-§2, עם demo-bar שמחליף ביניהם:
  - מסך ראשי — מצב idle / recording / speaking
  - **toggle הקלדה ⇄ הקלטה** (B1) — שני המצבים
  - **settings redesign** (D1/D2)
  - **פופ-אפ סשנים** (E1) + לחצן רענון
  - **folder picker** (E2)
  - בועות: thought תקין (C1), tool מרוכז שמאל (C2), avatars (C3)
- **פלטה:** המוקאפ יציג 2-3 כיווני פלטה (אם אין כיוון מהמשתמשת) על UI אמיתי,
  כדי לבחור בראייה ולא בהפשטה.
- המוקאפ סטטי (HTML+CSS, אולי vanilla JS לדמו). **לא** Tailwind/Svelte בשלב הזה
  — מאשרים *עיצוב*, לא *מימוש*. ה-build מתרגם אחר כך.
- **gate:** המשתמשת מאשרת את המוקאפ → רק אז כותבים briefs.

### 4.2 סדר ה-slices אחרי אישור המוקאפ (טיוטה)
```
[2] Design system foundation — Tailwind 4 מלא + @theme tokens (מהמוקאפ)
        + component lib + icons (F1/F2/F3)
        │
        ├──▶ [3] Layout shell אחיד (A1/A2/A3)  ──▶  [4] Settings redesign (D1/D2)
        ├──▶ [5] Input toggle + mic גדול (B1/B2/B3)
        ├──▶ [6] Bubbles: באג segments (C1, slice ייעודי) + tool align (C2) + avatars (C3)
        ├──▶ [7] Modals: sessions popup (E1) + folder picker (E2)
        └──▶ [8] Smart-scroll restore (G1) + replay parity (G2)
```

הערות:
- **C1 (באג segments)** ו-**C2 (tool alignment)** הם תיקונים נקודתיים שאפשר
  לעשות מוקדם, ללא תלות ב-design system — שווה לשחרר מהר כי הם מציקים עכשיו.
- כל השאר תלוי ב-foundation [2].

---

## 5. שאלות פתוחות למשתמש

הוכרע:
- ✅ **Tailwind** — מלא (§1.1).
- ✅ **גישה** — מוקאפ-תחילה (§4).
- ✅ **פלטה** — 4 פלטות כ-themes (§1.4).
- ✅ **מוקאפ אושר** — `mockup-vnext.html` (2026-06-01).
- ✅ **לחצן "השמע אחרון" נמחק**; ⏮/⏭ → slice נפרד עתידי (§B3).

עדיין פתוח (חוסם את ה-foundation slice, לא את ההמשכיות):
1. **ספריית קומפוננטות** — Melt UI / Bits UI / אחר? (headless; המלצה: Bits UI.)
2. **icons** — Lucide (היה אצלך, כבר במוקאפ) / Phosphor / אחר?

לא דחוף:
3. **Bottom-sheet ניווט (E3)** — במוקאפ יש (☰). לאשר שזה הכיוון.
4. פיצ'ר נוסף מגרסאות ישנות שצריך לחפש? (חיפשתי avatar, smart-scroll,
   folder-picker, replay — אם יש עוד, תגיד.)

---

## 6. מה כבר נמצא בצנרת (לא לכפול)

slices קיימים שנוגעים ל-UI ולתאם איתם:
- **slice 6** (audio cues) — executed, calev GO, ממתין merge.
- **slice 9a** (speech toggles — speakThoughts/narrateTools/translateThoughts
  + העברת VoicePicker ל-/settings) — plan-verified, ממתין dispatch. **חופף ל-D1.**
- **slice 7** (car mode) — מתוכנן. חופף ל-G3.
- **slices 24/25/26** (proxy cache / bridge leak / idle reaper) — BE בלבד, לא UI.
