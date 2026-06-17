# UI Feature Backlog — drive-coding

+ **תאריך:** 2026-06-18 · **סטטוס:** backlog (לתעדוף; טרם הומר ל-slices)
+ **שייך ל-roadmap:** `docs/roadmap.md` — Tracks **C** (Frontend/UX), **E** (Access & Entry), ו-Voice **V4**.
+ **מקור השראה:** UI של CodeNomad (`CodeNomad/packages/ui/src/components/`) ו-opencode — הרבה מהפריטים כבר פתורים שם ומוכנים להעתקה. **ממצאי סריקה — §5 (יתמלא).**

הערכת מורכבות: 💚 קל/עצמאי · 🟡 בינוני · ⭐ high-value.

## 1. הודעות (Message UX)

| # | פריט | תיאור | מול roadmap | הערכה |
| --- | --- | --- | --- | --- |
| 1a | מראה סטנדרטי + העתקה | בועות כמו בממשקי chat מקובלים, כולל לחצן העתקת-הודעה | חדש | 💚 |
| 1b | timestamp | שעה על כל הודעה (נייד: hover/tap-to-reveal, לא להעמיס) | חדש | 💚 |
| 1c | Markdown להודעות משתמש | רינדור markdown גם לבועת המשתמש (לוודא escaping תקין) | חדש | 💚 |
| 1d | יישור code block (🐛 bug) | כרגע מיושר RTL; קוד צריך `dir="ltr"` + יישור-שמאל. קשור ל-skill `rtl-adaptation` | חדש (bug) | 💚 |

→ **batch טבעי אחד ("Message polish")** — עצמאי ומהיר; מועמד מוביל ל-slice ראשון.

## 2. ניהול סשן ופרוסס

| # | פריט | תיאור | מול roadmap | הערכה |
| --- | --- | --- | --- | --- |
| 2a | יציאה בלי הריגה | "צא" = detach (חוזר לרשימה, ה-process חי); "סגור/הרוג" = משני/מאחורי אישור. UX ברור שלא יבלבל | **הפער שזוהה** (future-features) | ⭐🟡 — ה-backend כבר תומך (`bridge-manager.markDetached/markAttached`); בעיקר UI+חיווט |
| 2b | Deep links | קישור → folder + sessionId; attach אם ה-process פעיל, אחרת פתח חדש על אותם folder+session | **כבר ב-Track E** (מחדד אותו) | 🟡 — תלוי registry של sessions |

## 3. תיבת הפרומפט

| # | פריט | תיאור | מול roadmap | הערכה |
| --- | --- | --- | --- | --- |
| 3a | הדבקת תמונות | paste image לתיבה + preview; תמיכה בנייד (`input capture`/file picker) | חדש | 🟡 — ה-`PromptContent` הקנוני כבר מולטימודלי (text+image) |
| 3b | פקודות סלאש (/) | autocomplete dropdown לפקודות | חדש | 🟡 — ל-Claude יש `commands_changed` בפרוטוקול; תלוי חשיפה דרך ה-contract |

## 4. כבר ב-roadmap (הצלבה — לא לתכנן מחדש)

| פריט (מהבקשה) | היכן ב-roadmap |
| --- | --- |
| 4a — המשך תכנון תצוגה | Track C — smart scroll, audio cues, car mode, settings, recordings (`packages/frontend/docs/slices.md`) |
| 4b — כמה ספקים ל-TTS/נרטיב | Voice **V4** (`docs/plans/voice-provider-abstraction-roadmap.md`) — הכרעת ספק פתוחה |
| deep links (=2b) | Track E |
| יציאה graceful (=2a) | future-features (פער מזוהה) |

## 5. ממצאי סריקה — CodeNomad / opencode

> טרם בוצע. הסריקה תוסיף פיצ'רים סטנדרטיים שעדיין לא ברשימה (לדוגמה צפויה: edit/resend, retry, scroll-to-bottom, attachments, file mentions, message actions menu, וכו'). יעודכן לאחר הסריקה.

## תעדוף מוצע (ראשוני)

1. **Message polish** (1a–1d) — מהיר, גלוי, עצמאי.
2. **Session control** (2a) — UI מעל infra קיים.
3. **Prompt input** (3a, 3b) — מעל contract קיים.
4. כבר-ב-roadmap (2b/4a/4b) — חידוד והמשך.
