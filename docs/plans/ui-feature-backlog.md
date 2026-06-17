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
| 2c | כותרת הסשן הנוכחי | להציג את כותרת/שם הסשן הפעיל ב-UI — כרגע לא מוצג כלל. ל-Claude יש `generate_session_title` בפרוטוקול | חדש | 💚 |

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

נסרק 2026-06-18. מקורות: `CodeNomad/packages/ui/src/components/`, `openwork/packages/app/src/`.
סימון: 🔴 חדש-וחשוב · 🟢 nice-to-have · ✅ כבר-קיים/ב-roadmap · ⬜ skip ל-MVP.

### תיבת קלט
+ 🔴 **attachments מלא** — drag-drop + paste + דחיסה אוטומטית (≤8MB, JPEG/2048px). מרחיב את 3a. `composer.tsx`
+ 🟢 draft persistence (טיוטה+attachments בין sessions). `instance-shell2.tsx`
+ 🟢 prompt history ↑/↓ (מחזור הודעות קודמות, per-mode). `prompt-input.tsx` / `composer.tsx`
+ 🟢 `@` mentions (agents + files) — dropdown עם chips. `composer.tsx`
+ 🟢 shell mode (`!` בתחילת קלט → shell, Esc לחזור). `composer.tsx`
+ ✅ thinking-effort picker (None/Low/Med/High/X-High) — **= category `thought_level`** של config-options (Slice vnext-C). `thinking-selector.tsx`

### הודעות
+ 🔴 **streaming/typing indicator** — feedback חיוני (בעיקר ל-voice). `message-item.tsx`
+ 🔴 **message error display** inline (auth / output-length / abort). `message-item.tsx`
+ 🔴 **reasoning/thinking** expandable block (opus/o1). `message-part.tsx` / `thinking-block.tsx`
+ 🟢 revert/edit user message · fork session at message. `message-item.tsx`
+ 🟢 delete-messages-up-to (ניהול context). `message-item.tsx`
+ 🟢 agent/model metadata per message.

### Sessions
+ 🔴 **context usage** — token + cost meter / progress bar. `context-usage-panel.tsx` · `context-meter.tsx`
+ 🟢 session rename. `session-rename-dialog.tsx`
+ ✅ retry/busy status — כבר קיים (busy indicator).

### Tools (drive-coding כבר עם slice 16 tool-rendering)
+ 🔴 **permission/question inline blocks** — agent מבקש אישור להרצת כלי. **החוזה כבר תומך** (`respondToPermission`). בטיחות. `tool-call/permission-block.tsx`
+ 🔴 tool status indicator (pending/running/done). `tool-call.tsx`
+ 🟢 diff renderer (split/unified) · ANSI terminal · 18 tool-specific renderers (bash/read/write/edit/patch/task/todo/webfetch). richness מעבר לקיים. `tool-call/renderers/`

### Layout / Voice
+ ✅ auto-scroll + jump-to-bottom = Track C slice 5 (smart scroll). `virtual-follow-list.tsx`
+ ✅ model/agent selector = slice 23 (done). `model-selector.tsx`
+ 🔴 **TTS per-message speak button** (ליבת voice-first). `speech-action-button.tsx`
+ 🔴 provider-auth modal (ל-multi-provider). `provider-auth/`
+ 🟢 command palette (Cmd+K) · keyboard shortcuts. `command-palette.tsx`

### opencode-ספציפי
+ slash commands עם sources (`command`/`mcp`/`skill`) + fuzzy search + chips + kbd-nav — **מחדד את 3b**. `composer.tsx`
+ progress dots (todos) · context panel (files/plugins/mcp/skills).

### ⬜ Skip ל-MVP
message timeline/x-ray · web-preview browser frame · image-preview popover · session idle-fade.

## 6. פריטים בולטים שצצו מהסריקה (לא היו ברשימה — לתעדף)

1. **Permission/question inline blocks** — בטיחות; החוזה כבר תומך (`respondToPermission`).
2. **Feedback indicators** — streaming/typing + error display + tool-status (שלושתם בסיסיים).
3. **Context usage** (tokens/cost) — חשוב למשתמש שמשלם.
4. **Thinking/reasoning display** — לקראת opus/o1.
5. **TTS per-message speak button** — ליבת voice-first.
6. **thinking-effort** מתחבר ישירות ל-config-options (`thought_level`) — לא feature נפרד.
7. **תצוגת TODO / plan list** 🔴 — כש-ה-agent מייצר תוכנית/משימות (Claude `TodoWrite`, opencode todos), להציג כצ'ק-ליסט מתקדם (done/pending) ולא ככלי גנרי. **תלוי-ספק** (רק CLIs שתומכים). מתחבר ל-`plan.update` בחוזה — **דלת 3 ב-`canonical-mapping-gaps`, עדיין לא ממופה** (TodoWrite נופל כיום ל-`kind:"other"`). כלומר דורש גם הרחבת-מיפוי בחוזה וגם renderer ב-UI.

## 7. תוספות מהתנסות בממשק (2026-06-18)

### Tool rendering

+ 🔴 **Markdown ב-tool output** — פלט כלי לא מרונדר כ-markdown (מוצג עם ```` ``` ```` גולמיים). כמו בבועת ההודעה. מתחבר ל-batch message-polish (markdown+code-block). `ToolBubble.svelte`
+ 🟢 **תצוגת subagent/task** — פרמטרים מוצגים כ-JSON גולמי; לסדר ל-renderer קריא. reference: task renderer ב-CodeNomad. `ToolBubble.svelte`
+ 🟢 **זהות כלי** — לוגו/תווית לכל כלי (Bash, Read, …). **צריך דיון** על העיצוב.

### Audio / מצב מושתק (חשוב לעקביות)

+ 🔴 **muted → אין צלילים** — במצב מושתק לא להשמיע audio cues. עקביות.
+ 🔴 **muted → להסתיר כפתורי replay/speak** — אין טעם בכפתור השמעה-מחדש כשמושתק.

### מסך כניסה / connect

+ 🟢 **auto-refresh processes** — לרענן מדי פעם את רשימת ה-processes בטופס הכניסה. `ActiveProcessesPanel.svelte`
+ 🟢 **כפתור רענון לסשנים** — אייקון refresh בתחילת שורת הסשנים. `SessionPicker.svelte`
+ 🟢 **שורת סשנים תמיד מוצגת** — אם אין סשנים, מצב Disabled (לא מוסתרת). `SessionPicker.svelte`
+ 🐛 **מיקום כפתור התיקייה לפי שפה** — עברית→ימין, אנגלית→שמאל (logical positioning; skill `rtl-adaptation`). `FolderPickerDialog`/connect

### מצב שגיאה (error state) — רוחבי

+ 🔴 **ניקוי שגיאות אוטומטי** — שגיאות (חיבור / `ACP initialize timeout` / טעינת קולות) נשארות sticky **לנצח**. צריך: השגיאה מופיעה בניתוק/כשל, ו**נעלמת אוטומטית** ברגע שהמצב מתוקן (חיבור מחדש / טעינה מוצלחת). כלומר השגיאה reactive ל-state הנוכחי, לא הודעה קבועה שנשארת.

## תעדוף מוצע (ראשוני)

1. **Message polish** (1a–1d) — מהיר, גלוי, עצמאי.
2. **Session control** (2a) — UI מעל infra קיים.
3. **Prompt input** (3a, 3b) — מעל contract קיים.
4. כבר-ב-roadmap (2b/4a/4b) — חידוד והמשך.
