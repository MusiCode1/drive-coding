# Slice header-title-responsive — כותרת הדר רספונסיבית (2 שורות + פונט קטן במובייל, ללא חפיפה) — תוכנית

> **תאריך**: 2026-06-25
> **סטטוס**: הושלם — commit 3132b3f (2026-06-26)
> **Complexity**: 3/10 (verifier: light)
> **תלות (depends_on)**: [] — בונה מעל `session-title-header` (כבר **מוזג** ל-dev). base = `dev` (02a4129).

> **רקע — באג חי**: אחרי merge של `session-title-header`, כותרת-סשן ארוכה (במיוחד עברית) **חופפת** על ה-cwd chip + נקודת-החיבור במסך טלפון. שורש: הכותרת ב-`position:absolute` + `max-w-[60%]` (מחוץ ל-flow) → לא שומרת מקום מול ה-cluster ב-inline-end. אומת חי ב-linux-gui (dev, 362px, סשן עברי אמיתי): ה-chip יושב על גבי הטקסט. **אביגיל r3 #4 דגלה את הסיכון; כלב פספס כי בדק כותרת-mock לטינית קצרה.**

## §1 — מטרה

ההדר במסך קטן יהיה קריא וללא בלאגן:
1. **בלי חפיפה** — הכותרת לא תיכנס על ה-cwd chip / הנקודה לעולם.
2. **פונט קטן יותר במסכים קטנים** — כותרת במובייל בפונט קטן מהדסקטופ.
3. **גלישה ל-2 שורות** — כותרת ארוכה נשברת עד 2 שורות (ellipsis אחרי), במקום שורה אחת שנחתכת/תופסת הכל.

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| מעבר ההדר מ-absolute-center ל-**3 עמודות flex** (start המבורגר · center כותרת · end cluster) | ✅ | הסבב — תנאי-הכרחי ל-2-שורות-ללא-חפיפה |
| כותרת **`line-clamp-2`** (עד 2 שורות + ellipsis) | ✅ | הסבב |
| **פונט רספונסיבי** (קטן במובייל, רגיל בדסקטופ) | ✅ | הסבב |
| cwd chip + נקודה נשארים ב-inline-end, שורה אחת, `shrink-0` | ✅ | נשמר (לא נדחקים) |
| מירכוז אופטי מדויק-לרוחב-ה-viewport | ❌ | מירכוז **בתוך המקום הפנוי** (flex) — לא absolute. trade-off מקובל (ראה §6) |
| שינוי עיצוב ה-chip / הנקודה / fade layer | ❌ | רק layout של ההדר |
| auto-generate / עריכת כותרת | ❌ | future (כמו ב-session-title) |

## §3 — Architecture diagram

```
components/layout/AppHeader.svelte  ← הקובץ היחיד
  <header flex items-center>        ← היה items-start + absolute title; עכשיו 3 עמודות in-flow
    [fade layer]                    ← ללא שינוי
    {#if !isMobile} <button המבורגר shrink-0>   ← start (ללא שינוי לוגי)
    <div flex-1 min-w-0 center>     ← חדש: עמודת הכותרת (תופסת את המקום שנשאר)
       <span line-clamp-2 פונט-רספונסיבי>{headerLabel}</span>
    </div>
    <div cluster shrink-0>          ← end: cwd chip + נקודה (ללא שינוי פנימי; מאבד את ה-spacer הנפרד)
```

**שינוי מבני יחיד**: ה-`<div class="absolute start-1/2 -translate-x-1/2 ... max-w-[60%]">` של הכותרת **+** ה-`<div class="flex-1">` (spacer) → **מוחלפים** ב-עמודת-כותרת `flex-1 min-w-0` במקומה הטבעי (בין ההמבורגר ל-cluster). אין שינוי ב-VM/לוגיקה — רק layout.

## §4 — Commits

### Commit 0 — AppHeader 3-עמודות + line-clamp-2 + פונט רספונסיבי (approach: manual + browser smoke)

**קובץ**: `packages/frontend/src/lib/components/layout/AppHeader.svelte`

1. **`<header>`** (שורה 37) — `items-start` → **`items-center`** (יישור אנכי של הצמתים מול כותרת שעשויה להיות 2 שורות). שאר הקלאסים נשארים (`absolute top-0 inset-x-0 z-20 flex gap-3 px-4 pt-3 pb-8 pointer-events-none`).

2. **מחק את ה-spacer** `<div class="flex-1"></div>` (שורה 66) — עמודת-הכותרת תתפוס את ה-flex-1 במקומו.

3. **החלף את בלוק-הכותרת ה-absolute** (שורות 56-63) בעמודת-כותרת in-flow, **בין** ההמבורגר ל-cluster:
   ```svelte
   <!-- center: עמודת הכותרת — תופסת את המקום שנשאר, נשברת עד 2 שורות -->
   <div class="flex-1 min-w-0 flex items-center justify-center pointer-events-none">
     <span
       class="{responsive.isMobile ? 'text-[13px]' : 'text-[15px]'} font-semibold text-center leading-tight line-clamp-2"
       title={headerLabel}
     >{headerLabel}</span>
   </div>
   ```
   > - `flex-1 min-w-0` — תופס את הרוחב הפנוי **ומאפשר כיווץ** (`min-w-0` קריטי כדי ש-line-clamp יעבוד בתוך flex). זה מה שמונע חפיפה — ה-cluster (`shrink-0`) שומר את מקומו, הכותרת מקבלת את השאר.
   > - `line-clamp-2` — עד 2 שורות, ellipsis אחרי (מחליף את `truncate` שהוא שורה-אחת). Tailwind v4 — `line-clamp` core, אין צורך ב-plugin.
   > - `leading-tight` — כדי ש-2 שורות יישבו בגובה ההדר בלי לדחוף את הצ'אט.
   > - **פונט רספונסיבי דרך `responsive.isMobile`** — אותו מקור-אמת כמו ה-המבורגר (שורה 46), כך שה-breakpoint עקבי. (לא Tailwind `sm:` כדי לא להסתמך על breakpoint שונה.)
   > - `text-center` (a-directional), `gap` סימטרי — **קלאסים לוגיים בלבד**, אין `left/right/ml/mr/pl/pr`.
   > - הוסר `max-w-[60%]`/`max-w-[min(60vw,22rem)]`/`shrink-0`/`truncate` של ה-span הישן — מיותרים ב-flex.

4. עדכן את הערת-המבנה בראש הקובץ (שורה 5): `[כותרת-סשן ממורכזת]` → `[כותרת-סשן flex-1, עד 2 שורות]`.

**Verification (browser smoke — linux-gui, אין צורך ב-ACP חי)**:
```bash
cd packages/frontend && pnpm --filter @drive-coding/frontend-v2 exec vite build --mode development
# הגש single-origin (FE_STATIC_DIR) + tunnel; linux-gui Chrome, viewport מובייל ~360-390px:
#   /chat?mock=greeting (כותרת mock לטינית) — שורה אחת, ממורכזת, ה-cluster לידה ללא חפיפה
#   כותרת עברית ארוכה (זמנית: הזרק sessionTitle ארוך ב-#loadMockSession, או סשן אמיתי):
#     → נשברת ל-2 שורות, ellipsis אחרי 2, **אין חפיפה** עם ה-cwd chip/הנקודה
#   דסקטופ (≥sm): פונט 15px, שורה אחת לרוב; מובייל: פונט 13px
#   RTL: cluster (cwd+נקודה) בשמאל (inline-end), המבורגר בימין (desktop), כותרת באמצע
pnpm --filter @drive-coding/frontend-v2 typecheck && pnpm lint:i18n && pnpm --filter @drive-coding/frontend-v2 build
```

## §5 — DoD verifiable

| בדיקה | איך |
|---|---|
| **אין חפיפה** — כותרת ארוכה לא נכנסת על ה-cluster | מובייל 360px + כותרת עברית ארוכה → הטקסט והקבוצה לא חופפים (זה הבאג שתוקן) |
| גלישה ל-2 שורות + ellipsis | כותרת ארוכה → בדיוק עד 2 שורות, חיתוך עם `…` אחרי השנייה |
| פונט קטן במובייל | מובייל = 13px; דסקטופ = 15px (DevTools computed) |
| כותרת קצרה — שורה אחת ממורכזת | `/chat?mock=greeting` → שורה אחת, מרגיש כמו קודם |
| cluster נשאר inline-end ושורה-אחת | cwd chip + נקודה לא נדחקים/נשברים; נשארים בשמאל (RTL) |
| המבורגר (דסקטופ) ב-inline-start | desktop → המבורגר בימין; mobile → מוסתר |
| ההדר לא מכסה את הבועה הראשונה | 2-שורות עדיין בתוך רזרבת ה-`pt-20`/startMargin=80 של הצ'אט |
| קלאסים לוגיים בלבד | code review: אין `left/right`/`ml/mr`/`pl/pr` חדש |
| typecheck + lint:i18n + build נקיים | הפקודות הרגילות |
| אין regression ב-/settings ו-connect | AppShell משותף — ההדר לא שבר אותם |

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| **מירכוז לא-מדויק-ל-viewport** (flex מרכז בתוך המקום הפנוי, לא מרכז-מסך אמיתי) | מעבר מ-absolute ל-flex | **trade-off מודע ומקובל** — absolute הוא שגרם לחפיפה. אסימטריה קלה (בעיקר כשה-cwd ארוך) עדיפה על חפיפה. אם המשתמשת תרצה מרכוז-מדויק → spacer סימטרי בעתיד (over-engineering ל-MVP) |
| 2 שורות דוחפות את הצ'אט / מכסות בועה | גובה ההדר גדל | `leading-tight` + הצמתים `size-9` (36px) שולטים בגובה; 2 שורות 13px ≈ 31px < 36px. רזרבת 80px בצ'אט מכסה. אמת ויזואלית |
| `line-clamp` לא עובד בתוך flex | חוסר `min-w-0` | `min-w-0` על עמודת-הכותרת — בלעדיו flex item לא מתכווץ מתחת לתוכן. מפורש ב-§4 |
| `responsive.isMobile` breakpoint ≠ "מסך קטן" שהמשתמשת התכוונה | הגדרת ה-context | זה אותו breakpoint שכבר קובע הסתרת-המבורגר → עקבי עם ההתנהגות הקיימת. אם יתברר לא-מתאים → const נפרד |
| מחרוזת עברית קשיחה | pre-commit hook | אין מחרוזת חדשה (כותרת מ-`headerLabel`, tooltip מ-`title`) |
| התנגשות עם slice מקביל | parallel work | אומת: `slice-input-autogrow` (הסשן המקביל) נוגע ב-TypeArea בלבד, **לא** ב-AppHeader. אין חפיפת-קבצים |

## §7 — Escalation triggers

עצור ושאל את מרדכי אם:
- `line-clamp-2` לא נתמך/לא עובד בסביבת ה-Tailwind בפועל (לא אמור — v4 core).
- מתברר שצריך לשנות את רזרבת ה-top-padding של הצ'אט (קובץ אחר) כדי שה-2-שורות לא יכסו — invasive, לא בתכנון.
- מירכוז ה-flex נראה שבור בצורה לא-מקובלת (ולא רק אסימטריה קלה).

## §8 — Complexity score

- commits: 1 · קבצים: 1 (AppHeader.svelte) · שכבות חדשות: 0 · APIs חיצוניים: 0 · streaming/async: 0 · protocol: 0 · VM/state: 0 (layout בלבד)
- +1 על רספונסיביות + line-clamp + יישור-אנכי במסך משתנה
- **Score ≈ 3/10 → verifier `calev` mode: light** (layout טהור; האמת היא ויזואלית-חיה — RTL + מסך צר + כותרת ארוכה).

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל מוצעת | חוסם? |
|---|---|---|---|
| 1 | גדלי פונט מדויקים | 13px מובייל / 15px דסקטופ (תואם ל-15px הקיים) — calev מכוונן ויזואלית | ❌ |
| 2 | מקס' שורות | **2** (בקשת המשתמשת). ellipsis אחרי | ❌ נעול |
| 3 | מרכוז מדויק-ל-viewport עכשיו או future? | future (spacer סימטרי) — לא ל-MVP; flex-center מספיק | ❌ |
| 4 | להקטין פונט גם כשהכותרת נשברת ל-2 שורות בדסקטופ? | לא — רספונסיביות לפי גודל-מסך בלבד, לא לפי אורך-כותרת (פשוט וצפוי) | ❌ |
