# Pre-brief (debug handoff) — virtua scroll flicker + follow + state-loss

> **תאריך**: 2026-06-28
> **סטטוס**: pre-brief — **למרדכי** (סשן נפרד). אבחנה מלאה ומאומתת; הפתרון טרם הושלם.
> **נכתב מתוך**: סשן דיבוג-חי משותף עם המשתמשת (preview build + Playwright harness).
> **נוגע**: `slice-chat-virtualization` (כבר מוזג). שלושה באגים נפרדים — לא לערבב.

## TL;DR — שלושה באגים נפרדים בגלילה הווירטואלית

1. **ריצוד (flicker)** — בועה **נראית** נעלמת-וחוזרת מתזוזת-גלילה זעירה (2px). **שורש מאומת בקוד.** ← העיקרי.
2. **קפיצה-לתחתית (follow)** — גלילה-למעלה לפעמים קופצת חזרה לתחתית. שורש מאופיין.
3. **אובדן מצב-הרחבה** — בועת-מחשבה/כלי שהורחבה חוזרת סגורה אחרי גלילה. שורש מאומת.

---

## באג 1 — ריצוד (flicker) ⭐ העיקרי

### תסמין (מהמשתמשת, מאומת חי)
בועה **שנמצאת על המסך** (נראית, לא רק על הקצה) נעלמת ומופיעה כשמזיזים את הגלילה **2 פיקסלים** הלוך-ושוב.
**לא** ספונטני במנוחה — דורש תזוזה זעירה. קורה "הרבה מעבר לקצה" של ה-viewport.

### שורש — **מאומת בקוד-המקור של virtua**
virtua מודד את גובה-ה-viewport דרך `ResizeObserver` וקורא את **`contentRect.height`**:
- `packages/frontend/node_modules/virtua/lib/core/index.js` (~שורות 380, 426):
  `for (const {target, contentRect} of entries) if (target === root) store.$update(4, contentRect.height)`
- **`contentRect` = content-box → מחריג padding.**

ל-`.chat-scroll` (ה-`scrollRef` של virtua, `AppShell.svelte:~302`) היה `pt-20 pb-10` = **120px padding**.
- גובה נראה (border-box) = **644px**
- אבל `contentRect.height` ש-virtua קיבל = 644 − 120 = **524px**

→ virtua **חשב** ש-ה-viewport הוא 524, רינדר רק 524px, והשאיר את **120px התחתונים (נראים!) בלי בועות** → שם הריצוד.

### ראיות מה-harness (מדידה חיה)
- **גובה הבועות יציב ב-100%**: `HEIGHT-CHANGED = 0` בכל הריצודים (`h=NNN(same)`). → **לא** חוסר-יציבות-גובה.
- **GEO**: `viewportVisible=[0..644]` אבל `renderedSpanPx` נעצר ב-**~524** במצב-הפער — בדיוק `644 − 120`.
- **scrollTop יציב** בזמן הריצוד (תזוזות של 2-100px בלבד) → **לא** באג ה-follow.
- **רק 1-3 בועות** מרונדרות במקור (חלון זעיר).
- בועה אחת ענקית נצפתה: `h=3404` (גבוהה פי-כמה מהמסך) — להחזיק בראש כ-edge-case.

### תיקון שנבדק חי — **חלקי בלבד** (חשוב!)
ניסוי-זריקה: הסרת `pt-20 pb-10` מ-`.chat-scroll` + `pb-10` ל-wrapper הפנימי (`max-w-2xl`).
- **תוצאה**: הפער ירד 120→**~80px** (rendered ל-~564 במקום 524), items 1-3 → 7-9. **אבל הריצוד נשאר.**
- ה-~80px שנשארו ≈ **`startMargin={80}`** (ב-`ChatBubbles.svelte`). → יש **גורם שני**.

### השערות לגורם-השני (לחקור בסשן הייעודי)
1. **`startMargin={80}`** — כיצד הוא נספר מול ה-viewport. ייתכן שצריך להעביר את clearance-ההדר מ-startMargin
   ל-padding על wrapper פנימי (שלא מקטין contentRect) — או להפך, להסיר את ה-startMargin ולהשאיר רק אחד.
2. **חוסר `itemSize`** — `<Virtualizer>` לא מקבל אומדן-גובה → לבועות שלא נמדדו יש מיקום שגוי → חישוב-נראוּת לא-יציב.
3. **`contain: "size"`** על container של virtua (`Virtualizer.svelte:163`) + `height: totalSize`.
4. **`pointer-events: none` בזמן scrolling** (`Virtualizer.svelte:169`) — כנראה לא קשור לריצוד, אבל הוביל למצוא את contentRect.

### כיוון-פתרון מוצע
ודא ש-ל-`scrollRef` של virtua **אין padding אנכי** (viewport של virtua = content-box = חייב לשקף את הנראה).
את כל ה-spacing (80px עליון clearance-הדר + 40px תחתון) להעביר ל-`startMargin`/`endMargin` של virtua ו/או
ל-padding על wrapper פנימי שאינו ה-scroll-element. **+ להוסיף `itemSize` אומדן** (ראה residual). לאמת בכל סבב עם ה-harness שהפער = 0.

---

## באג 2 — קפיצה-לתחתית (follow)

### תסמין
גלילה-למעלה לפעמים קופצת חזרה לתחתית.

### שורש (מאופיין, `AppShell.svelte`)
- `onScroll` (`:185-188`): בכל פעם שהגלילה בתוך 48px מהתחתית, `following` **נדלק-מחדש אוטומטית**. virtua מודד-מחדש
  גבהים תוך כדי גלילה → distanceBelow "קופץ" מתחת ל-48px רגעית → follow נדלק → עדכון-תוכן הבא קופץ.
- חלון-הכוונה (`userIntentUntil`) קצר — **600ms** (`:69`). קריאה ארוכה > 0.6s → נשכח שגללת ידנית.

### כיוון-פתרון (אושר עם המשתמשת)
follow יידלק-מחדש **רק** ב-3 מקרים מפורשים: (א) המשתמש גלל **בכוונה** עד התחתית, (ב) לחיצה על כפתור
"הודעות חדשות" (`jumpToBottom`, `:319-331`), (ג) שליחת הודעה (turn-boundary, `:259-279`). **לא** מזיהוי-אוטומטי
של "קרוב לתחתית". להפוך את מצב "גללתי-למעלה" ל**דביק**.

---

## באג 3 — אובדן מצב-הרחבה (state-loss על remount)

### תסמין
הרחבתי בועת-מחשבה/כלי, גללתי, חזרתי → סגורה.

### שורש (מאומת)
virtua משמיד/בונה-מחדש בועות שיוצאות מהחלון. מצב-הפתיחה הוא **state מקומי**:
- `ThoughtBubble.svelte`: `let open = $state(settings.showThoughts)`
- `ToolBubble.svelte`: `let open = $state(settings.showTools)`
בבנייה-מחדש → מאותחל לברירת-המחדל → ההרחבה אובדת.

### הקשר היסטורי (חשוב — קראתי את ה-git)
זהו **אותו שורש** כמו "snap-back": commit `0adfb17` (chat-render-polish) תיקן snap-back ע"י מעבר ל-`$state`
מקומי — תיקון ש**שרד עדכוני-status אבל לא שורד remount של virtua**. ה-roadmap סימן זאת מראש כ"תיקן מקומית בלבד"
ושמר את השורש האמיתי כפריט **"ID יציב לכלי (שורש snap-back)"** (`roadmap.md`, Track C).

### כיוון-פתרון
להוציא את מצב הפתיחה/קיפול ל**מאגר מתמיד לפי מזהה-בועה יציב** (`Map<bubbleId, boolean>` ב-VM/context).
פותר את אובדן-ה-remount **וגם** מייתר את ה-snap-back המקומי. = מימוש "ID יציב לכלי".

---

## כלי-הדיבוג (Playwright harness) — מוכן לשימוש חוזר

`scripts/debug-virtua-flicker.cjs` — Chrome **גלוי** (channel:chrome) + DevTools, MutationObserver על
`.chat-scroll` subtree. לכל mount/unmount של בועה מתעד: snippet, `offsetHeight` (+ `HEIGHT-CHANGED`),
`scrollTop`, ו-`GEO` (טווח-הפיקסלים המרונדר מול ה-viewport הנראה). מזהה `⚡⚡ FLICKER` (בועה שחזרה < 1.5s).

```bash
# דורש: BE שמגיש build על 4010 (FE_STATIC_DIR), ו-Chrome מותקן.
cd packages/backend && FE_STATIC_DIR="<abs>/packages/frontend/build" PORT=4010 bun src/server.ts &
node scripts/debug-virtua-flicker.cjs   # פותח Chrome → 4010; לוג ל-stdout
# חבר agent, צור שיחה ארוכה, גלול 2px לאזור-גבול; קרא את שורות [FLICKER]/GEO.
```
> ⚠️ Playwright בפרויקט לא resolvable ישירות — הסקריפט דורש מנתיב ה-npx cache (Windows path).
> ⚠️ הסקריפט מחזיק את הטאב; "פתיחה-מחדש" = הרצה מחדש (פותח חלון Chrome חדש).

## קבצים מרכזיים
- `packages/frontend/src/lib/components/chat/ChatBubbles.svelte` — props של `<Virtualizer>` (`startMargin`, חסר `overscan`/`itemSize`).
- `packages/frontend/src/lib/components/layout/AppShell.svelte` — scroll owner, follow logic (`onScroll`/`maybeJump`/turn-boundary), ה-padding על `.chat-scroll`, ה-`chat-fade`.
- `packages/frontend/node_modules/virtua/lib/core/index.js` — מדידת ה-viewport (contentRect).
- `packages/frontend/src/lib/components/chat/bubbles/{Thought,Tool}Bubble.svelte` — `open` state מקומי.

## הצעת חיתוך לסשן הייעודי
- **Slice — scroll-stability** (calev-heavy): באג 1 (contentRect/padding + startMargin + itemSize) + באג 2 (follow דביק). אימות עם ה-harness עד flicker=0.
- **Slice — stable-fold-state**: באג 3 (מאגר fold לפי id) — מייתר גם snap-back. עצמאי.
