# Design Mockup — drive-coding

מוקאפ סטטי של שפת-העיצוב של ה-frontend. **תצוגה ויזואלית בלבד — לא קוד רץ ולא חלק מה-build.**

## מה זה

קובץ HTML עצמאי אחד (`index.html`) שמדגים נאמנה את ה-UI לפי `docs/frontend-spec.md`:

- **Design Tokens** (§3) — הפלטה המלאה, dark mode.
- **Mic button** (§5) — כל 5 ה-states (idle / recording / processing / speaking / cancelling) עם הצבעים והאנימציות החיות.
- **Screens** — `/agent/:id` (live + car mode), ו-`/` (dashboard) בתוך מסגרות טלפון.
- **Chat bubbles** (§7) — user / assistant / thought / tool, כולל יישור RTL ו-status dots.

## איך לפתוח

פותחים את `index.html` ישירות בדפדפן — אין תלויות, אין build, אין שרת.

## מקור-אמת

זה **נגזרת** של `docs/frontend-spec.md` (וה-tokens מתוך `+layout.svelte`). אם ה-spec
משתנה — המוקאפ הזה לא מתעדכן אוטומטית; הוא snapshot ידני להמחשה.

## claude-design/ — תוצרי claude.ai/design

תת-התיקייה [`claude-design/`](claude-design/) מחזיקה snapshots של ה-project
**"DriveCoding Design System"** מ-claude.ai/design (React + tokens), נשמרים כ-**reference
ויזואלי בלבד** לעיצוב קומפוננטות ה-Svelte. claude.ai/design תומך רק ב-React, ולכן אלה
מוקאפים-מטרה — לא קוד רץ ולא חלק מה-build. ראה את ה-README שם לפירוט המבנה ומה שנמשך.
