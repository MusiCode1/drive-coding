# Slice — rtl-bubble-fixes — תוכנית

> **תאריך**: 2026-07-04
> **סטטוס**: ✅ **מאושר (plan-verified)** — ‏אביגיל r2 READY, 0 ממצאים (r1: 3 ממצאי-ניסוח תוקנו). ‏מוכן ל-dispatch.
> **Complexity**: 3/10 (verifier: light — `calev`)
> **תלות**: depends_on: []. **base=dev**. ‏FE-טהור, ‏CSS/מבנה-בועה בלבד.

שני באגי-רינדור RTL עצמאיים באזור-הבועות, ‏שנתפסו חי ע"י המשתמשת (2026-07-04):
**באג #1** — ‏סמני רשימה ממוספרת/תבליט יושבים על גבול-הבועה ולפעמים נחתכים.
**באג #2** — ‏הפינה-המחודדת של הבועה בצד ה**רחוק** מהאווטר (בעברית), ‏במקום הצד הקרוב.
שניהם באותם 2-3 קבצים, ‏ללא חפיפה — ‏slice מהיר אחד, ‏2 commits.

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/rtl-bubble-fixes -b slice/rtl-bubble-fixes dev
cd .worktrees/rtl-bubble-fixes
pnpm install && pnpm hooks:install
```

> ⚠️ **‏סיכון merge-order (finding אביגיל 3) — ‏לידיעת אליעזר, ‏החלטת-מרדכי**: ‏branch לא-ממוזג
> ‏`slice-ui-polish-batch-2` ‏נוגע **בדיוק** ב-3 הקבצים של ה-slice הזה (+`markdown.ts`), ‏ונראה
> ‏ש**מפרק את איחוד-MarkdownContent** (מוחק את `MarkdownContent.svelte`, ‏מחזיר `overflow-*` ‏לבועות).
> ‏גם `slice/playback-ui` ו-`slice/playback-nav-retain` ‏נוגעים ב-`UserBubble.svelte` (שינוי זעיר).
> ‏**זו לא תלות-קוד** — ‏ה-brief מבוסס נכון על מצב dev (`depends_on: []` **עובדתית-נכון**). ‏אליעזר
> ‏בונה מעל dev כרגיל.
> ‏**‏הכרעת-מרדכי (2026-07-04, ‏אומת ב-git)**: ‏`slice-ui-polish-batch-2` **‏מיושן/עקוף** — ‏commit
> ‏אחרון 2026-06-18, ‏והפיצ'רים שבו (Enter-בדסקטופ, ‏briefs לתמונות/slash) ‏כבר ב-dev דרך slices
> ‏אחרים. ‏הוא נוצר 11 יום **לפני** ‏שאיחוד-MarkdownContent נחת (`ebea950`, 2026-06-29) → ‏ה"מחיקה"
> ‏שב-diff היא artifact של branch-ישן, ‏לא פירוק-אקטיבי. ‏**batch-2 לא ימוזג** → ‏סיכון ה-merge-order
> ‏מולו **אפסי**. ‏(שתי branches חיות — ‏`slice/playback-ui`, ‏`slice/playback-nav-retain` — ‏נוגעות
> ‏ב-`UserBubble.svelte` בשינוי-זעיר; ‏קונפליקט-merge קטן ונשלט, ‏מטופל בסדר-ה-merge.)

### Run
‏- ‏FE: `pnpm --filter @drive-coding/frontend dev` (port: OS-assigned; ‏Vite מדפיס)
‏- ‏BE (לבועות-אמת): `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (port 4000)
‏- ‏Typecheck/lint: `pnpm --filter @drive-coding/frontend typecheck && pnpm lint`

> ‏אין צורך ב-BE כדי לשחזר את שני הבאגים — ‏אפשר לשלוח הודעת-משתמש עם רשימה ממוספרת בעברית,
> ‏ולראות בועת-סוכן כלשהי. אבל **preview חי (production build)** הוא ה-gate של calev — ‏ראה §5.

### Browser
‏- ‏Chrome רגיל על מכונת-המשתמשת (`localhost` מספיק). ‏הבדיקה הקריטית היא **ויזואלית ב-RTL** —
  ‏אין לה תחליף אוטומטי. ‏חובה לבדוק **בעברית וגם באנגלית**, ‏גם בועת-משתמש וגם בועת-סוכן.

### Reading list
**‏must-read לפני**:
‏- `packages/frontend/src/lib/components/chat/bubbles/UserBubble.svelte` — ‏שורות **99-101** (בועה: `rounded-es-sm` + `dir="auto"`) ו-**143-154** (CSS: `align-items:flex-start`).
‏- `packages/frontend/src/lib/components/chat/bubbles/MessageBubble.svelte` — ‏שורות **54** (`flex-row-reverse`) ו-**57-60** (בועה: `rounded-ee-sm` + `dir="auto"`) ו-**111-122**.
‏- `packages/frontend/src/lib/components/chat/bubbles/MarkdownContent.svelte` — ‏שורות **29-34** (`.md-content` עם `dir="auto"`) ו-**59-62** (CSS של `ul`/`ol`/`li`).

**‏reference בזמן עבודה**:
‏- `docs/plans/slice-markdown-dir-per-paragraph.md` §9 שאלה 2 — ‏ההחלטה **לא** להוסיף `dir` ל-`ul`/`ol` (רק ל-`li`), ‏"כי `dir` על ה-list-container עלול להפוך מיקום-סמן". ‏זה הרקע לבאג #1.
‏- `docs/design-principles.md` — ‏רק אם נדרשת הכרעת-שכבה (לא צפוי; זה CSS מקומי).

## §1 — מטרה

אחרי ה-slice: **(א)** ‏סמני רשימה ממוספרת ותבליט בבועות מופיעים במלואם, ‏לא נחתכים על קצה-הבועה,
‏גם בעברית (RTL) ‏וגם באנגלית, ‏כולל מספרים דו-ספרתיים (`10.`, `11.`). **(ב)** ‏הפינה-המחודדת של
כל בועה תמיד בצד ה**קרוב** לאווטר של השולח (משתמש/סוכן), ‏ללא תלות בשפת-ההודעה — ‏בעברית כמו באנגלית.

## §2 — Scope: מה כן, מה לא

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ‏תיקון חיתוך-סמני-רשימה (`ul`/`ol`/`li`) | ✅ | ‏Commit 0 |
| ‏תיקון כיוון פינת-הבועה פר-שולח (decouple מ-`dir` התוכן) | ✅ | ‏Commit 1 |
| ‏שינוי מודל-הבועות / ‏grouping / ‏קיפול | ❌ | ‏slice `collapsed-activity-group` |
| ‏שינוי ב-`markdown.ts` / ‏ה-DOMPurify hook | ❌ | ‏זה CSS/מבנה-בועה בלבד — **לא** לגעת ב-pipeline |
| ‏שינוי כיוון-הטקסט הפנימי (`dir="auto"` פר-פסקה של MarkdownContent) | ❌ | ‏עובד — ‏לא לגעת |
| ‏שינוי `overflow-hidden` על הבועה | ❌ אלא אם חובה | ‏עדיף פתרון שלא נוגע בו (הוא מגן על פינות מעוגלות); ‏אם חובה — §7 |

## §3 — Architecture diagram

```
components/chat/bubbles/
  MarkdownContent.svelte   ← Commit 0: CSS של ul/ol/li (מיקום-סמן שלא נחתך)
  UserBubble.svelte        ← Commit 1: פינת-בועה + dir של מעטפת-הבועה
  MessageBubble.svelte     ← Commit 1: פינת-בועה + dir של מעטפת-הבועה
```
‏שינוי CSS/attribute מקומי ב-3 קבצי-רכיב. ‏אין קובץ חדש, ‏אין שכבה חדשה, ‏אין נגיעה ב-VM/engine/pipeline.

## §4 — Commits

### Commit 0 — סמני-רשימה שלא נחתכים (approach: **manual** — ‏ויזואלי בדפדפן)

**‏השורש (מאומת בקוד)**: ‏ב-`MarkdownContent.svelte:60-61` הרשימות מוגדרות
`list-style: disc/decimal outside` ‏עם `padding-inline-start: 1.4em`. ‏עם `outside`, ‏הסמן
מרונדר ב**שוליים החיצוניים** של פריט-הרשימה ויכול לחרוג אל קצה-הבועה; ‏מעטפת-הבועה
(`UserBubble:99` / `MessageBubble:58`) ‏נושאת `overflow-hidden` ‏שחותכת את החורג — ‏בעיקר ב-RTL
וכשהסמן רחב (מספר דו-ספרתי). **‏השורש היחיד: ‏חיתוך `overflow-hidden`** — ‏לא עמימות-כיוון.
> ‏**‏תיקון ניסוח (finding אביגיל 2)**: ‏השערה מוקדמת ייחסה חלק מהבאג ל"אי-התאמת-כיוון בין
> ‏`<ol>`/`<ul>` (בלי `dir`) ל-`<li>` (עם `dir="auto"`)". ‏זה **לא-מבוסס** ל-`list-style: outside`:
> ‏הסמן מרונדר ב-`::marker` של ה-`li`, ‏וכיוונו נקבע מה-`li` — ‏שכן **כן** ‏מקבל `dir="auto"`
> ‏(`markdown.ts` — ‏`BIDI_BLOCK_TAGS` כולל `LI`, ‏לא `UL`/`OL`). ‏לכן הסמן כבר בצד-הנכון של
> ‏הפריט; ‏הבעיה היחידה היא שהוא חורג מה-content-box ו-`overflow-hidden` חותך אותו. ‏אליעזר —
> ‏**אל תרדוף שורש-כיוון**; ‏השורש הוא clipping בלבד.

**‏שינויים**: `packages/frontend/src/lib/components/chat/bubbles/MarkdownContent.svelte` — ‏שורות 60-61.
‏להעביר את מיקום-הסמן ל-`inside` כדי לנתק אותו מחיתוך ה-`overflow-hidden`:

```css
/* ── req #5 + rtl-bubble-fixes: סמן inside — זורם בתוך ה-content-box, לא נחתך ע"י overflow-hidden ── */
.md-content :global(ul) { padding-inline-start: 1.2em; margin: 0.3em 0; list-style: disc inside; }
.md-content :global(ol) { padding-inline-start: 1.2em; margin: 0.3em 0; list-style: decimal inside; }
.md-content :global(li) { margin: 0.15em 0; }
```
> **‏למה `inside` ולא הגדלת ריפוד**: ‏`outside` ‏מציב את הסמן מחוץ ל-content-box → ‏חשוף לחיתוך
> ‏של `overflow-hidden` על המעטפת. ‏`inside` ‏זורם את הסמן **בתוך** ‏ה-content-box של ה-`li`, ‏לפי
> ‏כיוון-ה-`li` עצמו (`dir="auto"` פר-פריט) → ‏תמיד בצד הנכון של הפריט **וגם** ‏תמיד בתוך הבועה
> ‏(מעבר לתחום-החיתוך). ‏חיסרון מקובל בצ'אט: ‏שורת-המשך בפריט-ארוך מתיישרת תחת הסמן —
> ‏מקובל לבועות. **אם** ‏המשתמשת/כלב יבקשו יישור-תלוי (hanging indent) ‏בלי חיתוך, ‏חלופה:
> ‏`outside` + ‏העלאת `padding-inline-start` ‏ל-1.6em; ‏אבל ברירת-המחדל של ה-slice היא `inside`.

**‏Verification**:
```bash
cd packages/frontend && pnpm typecheck && pnpm lint
# ידני בדפדפן — ראה DoD:
#  - הודעת-משתמש: "1. שלום\n2. עולם\n...\n10. עשר\n11. אחת-עשרה" (עברית) → כל הסמנים גלויים, לא נחתכים
#  - הודעת-סוכן עם רשימה תבליט (- item) בעברית ובאנגלית → סמנים גלויים
```

### Commit 1 — פינת-בועה פר-שולח, ‏מנותקת משפת-ההודעה (approach: **manual** — ‏ויזואלי RTL/LTR)

**‏השורש (מאומת בקוד)**: ‏הפינה-המחודדת נקבעת ע"י מחלקות **לוגיות** של Tailwind על **אותו** `div`
‏שנושא `dir="auto"`:
‏- ‏`UserBubble.svelte:99-101` — ‏`rounded-es-sm` (`border-end-start-radius`) + ‏`dir="auto"`.
‏- ‏`MessageBubble.svelte:57-60` — ‏`rounded-ee-sm` (`border-end-end-radius`) + ‏`dir="auto"`.

‏מכיוון ש-`dir="auto"` בוחר כיוון לפי התו-החזק-הראשון של ה**תוכן**, ‏ה-property הלוגי (`inline-start`/
‏`inline-end`) ‏מתהפך **לפי שפת-ההודעה** — ‏ולא לפי הצד שבו יושב האווטר (שנקבע ע"י `self-start`/
‏`self-end` + ‏`flex-row-reverse` ‏ברמת ה-container, ‏שהוא **קבוע** לפי כיוון-האפליקציה). ‏לכן
כשההודעה בשפה מנוגדת לכיוון-האפליקציה, ‏הזנב "בורח" לצד הרחוק מהאווטר.

> **‏התובנה המרכזית**: ‏`MarkdownContent.svelte:32` **כבר** נושא `dir="auto"` על `.md-content`, ‏וה-slice
> ‏`markdown-dir-per-paragraph` ‏הוסיף `dir="auto"` **פר-בלוק** (p/li/h1-6/blockquote/td/th). ‏כלומר
> ‏כיוון-הטקסט הפנימי כבר מטופל בשלמותו **בתוך** ‏MarkdownContent. ‏ה-`dir="auto"` על מעטפת-הבועה
> ‏(`UserBubble:101` / `MessageBubble:60`) ‏הוא **מיותר לתוכן** — ‏ותפקידו היחיד-בפועל הוא להפוך את
> ‏הפינה הלוגית. ‏הסרתו → ‏הבועה יורשת את כיוון-האפליקציה (RTL ב-locale=he) → ‏הפינה יציבה פר-שולח,
> ‏בעוד הטקסט הפנימי נשאר נכון פר-פסקה.

**‏שינויים**:
‏1. ‏`UserBubble.svelte:98-102` — ‏להסיר את `dir="auto"` ממעטפת-הבועה (שורה 101). ‏המחלקה
   ‏`rounded-es-sm` ‏נשארת: ‏כשה-app ב-locale=he (RTL — ‏ברירת-המחדל הנוכחית), ‏`end-start`
   ‏= ‏תחתית-קרוב-לאווטר-של-המשתמש.
‏2. ‏`MessageBubble.svelte:57-61` — ‏להסיר את `dir="auto"` ממעטפת-הבועה (שורה 60). ‏`rounded-ee-sm`
   ‏נשארת: ‏ב-locale=he, ‏`end-end` = ‏תחתית-קרוב-לאווטר-של-הסוכן.

> **‏הבהרת-locale (finding אביגיל 1)**: ‏כיוון-ה-app **אינו** ‏RTL-קבוע-מוחלט — ‏הוא נגזר-locale
> ‏(`+layout.svelte:131-137`: ‏`RTL_LOCALES=["he"]` → ‏`he`=rtl, ‏אחרת ltr). ‏הסרת `dir="auto"`
> ‏מהמעטפת מייצבת את הפינה **פר-שולח כל עוד ה-app ב-locale=he** (המצב הנוכחי/ברירת-מחדל).
> ‏אם יום אחד יתווסף locale LTR — ‏כל בועה תתהפך ל-LTR והפינה תלך לצד-ההפוך. ‏**הפתרון היחיד
> ‏שיציב פר-שולח חוצה-locale הוא ה-fallback הפיזי למטה** (מחלקות פיזיות פר-שולח). ‏ל-scope הזה
> ‏(ה-app היום RTL) — ‏הסרת ה-`dir="auto"` מספיקה; ‏ה-fallback הפיזי נשאר אופציה אם ה-repro החי דורש.

> ⚠️ **‏זוהי ההשערה החזקה — ‏אך חובה לאמת חי בכל 4 הצירופים** (משתמש/סוכן × ‏עברית/אנגלית).
> ‏**אם** ‏הסרת ה-`dir="auto"` לבדה לא ממקמת את כל 4 הצירופים נכון (למשל אם כיוון-האפליקציה
> ‏אינו RTL עקבי, ‏או ש-`rounded-es/ee` לא מתנהג כצפוי) — ‏החלופה הדטרמיניסטית: ‏להחליף את
> ‏המחלקות הלוגיות ב**פיזיות** מפורשות לפי שולח (הבועה תמיד יורשת אותו כיוון): ‏משתמש (אווטר
> ‏בצד-start של ה-app) = ‏פינת-`rounded-ss-sm`/`rounded-es-sm` ‏שמצביעה לאווטר; ‏סוכן =
> ‏בהתאמה. **‏אל תנחש — ‏בדוק ב-DevTools מה כיוון-ה-app בפועל, ‏ואז בחר.** ‏אם מגלים שכיוון-ה-app
> ‏אינו קבוע → §7 escalation.

**‏Verification**:
```bash
cd packages/frontend && pnpm typecheck && pnpm lint
# ידני בדפדפן (הליבה) — ראה DoD: 4 צירופים × פינה נכונה
```

## §5 — DoD

| ‏בדיקה | ‏איך |
|---|---|
| ‏typecheck + ‏lint ירוקים | `pnpm --filter @drive-coding/frontend typecheck && pnpm lint` |
| ‏build עובר (preview הוא ה-gate) | `pnpm --filter @drive-coding/frontend build` |
| ‏רשימה ממוספרת עברית 1..11 — ‏כל הסמנים גלויים, ‏לא נחתכים | ‏preview: ‏הודעה עם רשימה בת 11 פריטים בעברית |
| ‏רשימת-תבליט עברית + אנגלית — ‏סמנים גלויים | ‏preview: ‏רשימה מעורבת |
| ‏רשימה באנגלית — ‏אין רגרסיה (עדיין נכון) | ‏preview |
| ‏בועת-משתמש עברית — ‏פינה קרובה לאווטר-המשתמש | ‏preview |
| ‏בועת-משתמש אנגלית — ‏פינה קרובה לאווטר-המשתמש (זהה) | ‏preview |
| ‏בועת-סוכן עברית — ‏פינה קרובה לאווטר-הסוכן | ‏preview |
| ‏בועת-סוכן אנגלית — ‏פינה קרובה לאווטר-הסוכן (זהה) | ‏preview |
| ‏אין רגרסיה בכיוון-הטקסט הפנימי (פסקה עברית+אנגלית עדיין כל אחת לכיוונה) | ‏preview: ‏הודעה דו-לשונית |

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|
| ‏כיוון-ה-app נגזר-locale (`he`=rtl, ‏אחרת ltr — ‏`+layout.svelte:131-137`), ‏לא RTL-מוחלט → ‏יציבות-הפינה תלויה ב-locale=he | ‏אבחון אביגיל (finding 1) | ‏ל-scope הנוכחי ה-app=he → ‏הסרת `dir="auto"` מספיקה; ‏executor מאמת ב-DevTools; ‏fallback פיזי פר-שולח (§Commit1) = ‏הפתרון היציב חוצה-locale אם יידרש; §7 |
| ‏`list-style: inside` ‏משנה יישור שורת-המשך בפריט-ארוך | ‏שינוי-ויזואלי | ‏מקובל לבועות-צ'אט; ‏חלופת `outside`+ריפוד מתועדת ב-Commit 0 אם המשתמשת מתנגדת |
| ‏Hardcoded Hebrew יחסום ב-pre-commit | ‏learnings | ‏אין מחרוזות חדשות ב-slice — ‏CSS/attribute בלבד. ‏אם בכל-זאת — `t(key)` |
| ‏Svelte 5 reactivity על array | ‏learnings | ‏לא רלוונטי — ‏אין נגיעה ב-`$state` arrays |
| ‏OneCLI/SDK | ‏learnings | ‏לא רלוונטי — ‏FE-טהור, ‏אין SDK חיצוני |
| ‏רגרסיה בכיוון-הטקסט הפנימי אחרי הסרת `dir` מהמעטפת | ‏באג #2 | ‏MarkdownContent שומר `dir="auto"` פנימי — ‏DoD בודק הודעה דו-לשונית מפורשות |

## §7 — Escalation triggers
‏- ‏אם ב-DevTools מתגלה שכיוון-ה-app **אינו** ‏RTL קבוע (משתנה פר-הקשר) → ‏עצור ושאל מרדכי (משנה את כל אסטרטגיית התיקון של Commit 1).
‏- ‏אם התיקון דורש לגעת ב-`markdown.ts` / ‏ב-DOMPurify hook / ‏ב-`overflow-hidden` של הבועה → ‏עצור (סימן ש-scope רחב מהמתוכנן).
‏- ‏אם הסרת `dir="auto"` מהמעטפת שוברת את כיוון-הטקסט הפנימי (למרות ה-`dir` הפנימי של MarkdownContent) → ‏עצור ושאל.

## §8 — Complexity score
‏- ‏commits: 2 (נמוך) · ‏שכבות חדשות: 0 · ‏APIs חיצוניים: 0 · ‏streaming: לא · ‏state-model: לא · ‏protocol: לא · ‏security-path: אין
‏- ‏**Score: 3/10 → verifier: light (`calev`)**. ‏הליבה היא בדיקה ויזואלית RTL — ‏calev light עם preview חי מספיק.

## §9 — שאלות פתוחות
| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏`list-style: inside` ‏או `outside`+ריפוד? | ‏`inside` (מנתק מ-overflow + עמימות-כיוון) | ❌ |
| 2 | ‏הסרת `dir="auto"` ‏מהמעטפת ‏או החלפת מחלקה-לוגית בפיזית? | ‏הסרת `dir="auto"` (מינימלי); ‏פיזית כ-fallback אם repro חי דורש | ❌ (‏executor מכריע לפי DevTools) |
| 3 | ‏האם ThoughtBubble/ToolBubble סובלים מאותו באג-פינה? | ‏לא — ‏הם `rounded-xl` ‏אחיד (אין פינה-מחודדת). ‏לא בטווח | ❌ |
