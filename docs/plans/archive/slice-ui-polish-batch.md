# Slice — ui-polish-batch — brief

> ✅ **בוצע · אומת · מוזג ל-dev.** אורכב ב-2026-06-27 (הסטטוס אומת מול היסטוריית git/roadmap; פרטי הביצוע והאימות בהמשך הקובץ).

+ **תאריך:** 2026-06-18 · **סטטוס:** הושלם · **מקור:** `docs/plans/ui-feature-backlog.md`
+ **Base:** `dev` · **Worktree:** `.worktrees/slice-ui-polish-batch` · **Branch:** `slice-ui-polish-batch`
+ **Complexity:** 8/10 (heavy — calev-heavy: רוב הפריטים visual) · **כל הקוד ב-FE בלבד; אפס נגיעה ב-`agent-session.svelte.ts` (אזור P1d).**

## מטרה

סבב UI-polish שמביא את הממשק לרמת "table-stakes" של chat מקובל, ב-3 phases מבודדים. כל phase = כמה commits.

## §0 — מוסכמות
+ Svelte 5 runes (`$state`/`$derived`/`$effect`); i18n דרך `t(...)` — **אסור מחרוזות עברית קשיחות** (`pnpm lint:i18n`).
+ TDD ל-utils טהורים (clipboard/formatting/settings-persist). שאר הפריטים — manual+visual (calev-heavy).
+ `pnpm typecheck && pnpm test && pnpm lint` ירוק בסוף כל phase.

## Phase 1 — Message polish

+ **C1 · clipboard util** — צור `lib/util/clipboard.ts` → `copyToClipboard(text): Promise<boolean>` (`navigator.clipboard.writeText`, try/catch). TDD.
+ **C2 · formatting util** — צור `lib/util/formatting.ts` → `formatTime(ts: number)` = שעה קצרה (HH:MM, `Intl.DateTimeFormat`). **לא** לחלץ מ-`SessionPicker.svelte:32-45` — שם זה `formatDate` (relative-time, `Intl.RelativeTimeFormat`), שונה. TDD.
+ **C3 · copy + timestamp בבועות** — `MessageBubble.svelte` + `UserBubble.svelte`: כפתור העתקה (hover-desktop/גלוי-נייד, feedback ~2s) + `formatTime(bubble.createdAt)` קטן. i18n ל-aria/tooltip.
+ **C4 · markdown להודעת משתמש (1c)** — `UserBubble.svelte:33`: להחיל `renderMarkdown(joinSegmentText(...))` כמו ב-MessageBubble (כולל DOMPurify שכבר בצינור). **זה ב-scope — בקשת המשתמש.**
+ **C5 · code-block RTL (1d 🐛)** — `MessageBubble.svelte` `<style>` (אזור ה-`pre`, ~69-75): הוסף `:global(pre),:global(code){direction:ltr;text-align:left}`. החל גם על ה-markdown של UserBubble (C4).
+ **C6 · tool-output markdown** — `ToolBubble.svelte`: הפלט הטקסטואלי (שורה ~89) → `renderMarkdown` (כיום raw עם ```` ``` ```` גולמיים). **לא** את ה-narration (שורה 46) — הוא סיכום שורה-אחת עם `truncate`, ו-block-markdown ישבור אותו. `<pre>` נשאר `dir="ltr"`.

## Phase 2 — Muted consistency

+ **C7 · settings persist** — `settings.svelte.ts`: הוסף `muted: boolean` ל-`Persisted` (DEFAULT `false`) + `$state` + `setMuted()` **לפי דפוס ה-setter הקיים** (כמו `setSpeakThoughts` — קורא ל-`#persist()` הפרטי, לא `save()`). TDD ל-round-trip.
+ **C8 · חיווט speaker↔settings** — `speaker.svelte.ts`: `enabled` יאותחל מ-`!settings.muted`, ו-`toggle()` יכתוב `settings.setMuted(...)`. סנכרן `cues.enabled` ל-`!muted` (כי `CuesEngine.enabled` נפרד מ-`speaker.enabled` — `cues.ts:23`).
+ **C9 · muted → אין צלילים** — תוצאה של C8 (cues מסונכרן). אמת ש-`cues.play(...)` חסום כש-muted.
+ **C10 · muted → הסתר replay/speak** — `MessageBubble`/`UserBubble`: כפתור ה-▶ מוסתר כש-muted. הבועות צורכות `getBubblePlayer()` — להוסיף `getSpeaker()` ולגייט על `speaker.enabled`. הערה: כפתור UserBubble כבר מותנה ב-`recordingId` — להוסיף את תנאי ה-muted מעליו.

## Phase 3 — Connect screen

+ **C11 · SessionPicker** — `SessionPicker.svelte:67-77`: ה-label+select **תמיד מוצגים**; כשאין sessions → `disabled`. הוסף כפתור refresh (↺) בתחילת השורה (קורא `onload`, disabled ב-loading). i18n.
+ **C12 · auto-refresh processes** — `ActiveProcessesPanel.svelte`: `$effect` עם interval (~12s) שקורא `activeAgents.refresh()`; ניקוי ב-cleanup. אל תרענן אם הפאנל מוסתר.
+ **C13 · כותרת סשן — 🚫 נדחה (out-of-scope)** — `session.title` לא קיים ב-AgentSession VM; הוספתו נוגעת ב-`agent-session.svelte.ts` (אזור P1d) ושוברת את עקרון הבידוד של הסבב. יבוצע בסבב שכן נוגע ב-VM (לצד P1d). ה-`title` עצמו זמין ב-session-list (`s.title` ב-SessionPicker) — שם אין בעיה, אבל ה-header צורך את ה-VM.
+ **C14 · ניקוי שגיאה reactive** — `routes/+page.svelte` (connect screen, ~200-206, `session.error`): השגיאה תתנקה כשהמצב מתוקן (חיבור מחדש/הצלחה). ודא `$effect`/reactive-clear, לא הודעה sticky. (לא `chat/+page.svelte` — הוא 50 שורות.)
+ **C15 · מיקום כפתור התיקייה (RTL)** — `routes/+page.svelte` (~166-177, `cwd-row`): מיקום logical לפי שפה (עברית→ימין, אנגלית→שמאל) — flex order/logical props (skill `rtl-adaptation`).

## §5 — Definition of Done
+ כל C1-C15 בוצעו; `pnpm typecheck && pnpm test && pnpm lint && pnpm lint:i18n` ירוקים.
+ ויזואלית (calev-heavy): code-block מיושר LTR בעברית; markdown בבועת משתמש ובפלט כלי; copy+timestamp עובדים; muted מכבה צלילים+replay ונשמר בין רענונים; connect — sessions-row תמיד מוצג, refresh עובד, processes מתרעננים, שגיאה מתנקה, כפתור תיקייה בצד הנכון. (C13 כותרת-סשן — נדחה.)
+ Walkthrough עודכן.

## §6 — מחוץ ל-scope
+ **זהות כלי (לוגו per-tool)** — "צריך דיון", לא נכלל.
+ subagent/task renderer מתקדם — רק אם פרמטרים מוצגים כ-JSON גולמי, ניקוי בסיסי; לא renderer מלא.
+ feedback-indicators (streaming/error display עשיר), permission-blocks, deep-links, images, slash — סבבים נפרדים.

## §7 — סיכונים
+ קבצים משותפים בין phases: `MessageBubble`/`UserBubble` (C3+C4+C5+C10). מבוצעים סדרתית באותו worktree — אין מקביליות.
+ C13 (title ב-VM) עלול לגעת ב-session VM — לוודא שזה read-only של שדה קיים; אם דורש הוספה, להישאר מינימלי ולא לגעת ב-event-handling.
