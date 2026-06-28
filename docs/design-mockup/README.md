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
