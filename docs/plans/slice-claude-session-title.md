# Slice — claude-session-title — תוכנית

> **תאריך**: 2026-07-04
> **סטטוס**: 🔬 **טיוטה — spike-מקדים חוסם** (‏Commit 0 מכריע design; אין dispatch/אביגיל עד שהוא סוגר)
> **Complexity**: ~7/10 (‏verifier: heavy — control-channel חדש + adapter + FE)
> **תלות**: אין (‏base=dev). מקפל את הבאג "attach מאפס title".

---

## רקע — קרא קודם

`docs/investigations/2026-07-04-claude-session-title-mechanism.md` — פוענח מלא (‏עם capture כראיה).
**תמצית**: ה-title של claude מגיע כ-`generate_session_title` **control_request** (‏SDK control-channel,
לא ACP). **ה-client יוזם** (‏claude לא דוחף), ה-`description` = **ההודעה הראשונה** של המשתמש, claude
מלטש→title, ו-`persist:true` שומר. drive-coding **אף פעם לא שולח** את הבקשה → אין title.

## §1 — מטרה

סשן claude מקבל **כותרת אוטומטית** (‏כמו ב-VSCode extension): אחרי ~3 turns, drive-coding שולח את
ההודעה הראשונה כ-`description`, מקבל title מלוטש מ-claude, ומציג אותו בהדר + שומר (`persist:true`)
כך שהוא שורד attach/reconnect/reload — סוגר גם את הבאג ש-`attachToLiveAgent` מאפס title.

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| ‏שליחת `generate_session_title` control_request (‏persist=true) | ✅ | ‏Commit 1 (‏אחרי spike) |
| ‏קריאת `control_response.response.title` → FE `sessionTitle` | ✅ | ‏Commit 2 |
| ‏תיקון `attachToLiveAgent:921` (‏לא לאפס; לטעון מ-session/list) | ✅ | ‏Commit 2 |
| ‏auto-title ל-opencode/codex | ❌ | ‏claude-only (‏זה control-protocol של Claude Code) |
| ‏עריכת-title ידנית ע"י המשתמש | ❌ | ‏future |

## §4 — Commits

### Commit 0 — **SPIKE (‏חוסם)**: איך שולחים control_request דרך ה-stack
**שאלה מכריעה**: `claude-agent-acp` → `@anthropic-ai/claude-agent-sdk` — האם ה-SDK חושף
control-channel API לשליחת `generate_session_title`, או שצריך לגעת ב-adapter (‏fork/PR)?
- ‏לחקור: `sdk.d.ts` (‏`query`/control API), ו-`claude-agent-acp` dist (‏האם מעביר control-requests).
- ‏**להוכיח חי** (‏בבידוד, עם ה-`claude-protocol-wrapper` + BE ייעודי): לשלוח `generate_session_title`
  דרך drive-coding ולתפוס `control_response{title}` בשתי ההקלטות (‏CLI↔adapter + adapter↔client).
- ‏**פלט ה-spike**: הכרעה — נתיב-API קיים / הרחבת-adapter / fork. **בלי זה אין brief מלא.**

### Commit 1 — שליחת generate_session_title (‏persist=true) [‏תלוי-spike]
trigger: turn-count (~3). description = ההודעה הראשונה. שולח דרך המנגנון שה-spike קבע.

### Commit 2 — חיווט ל-FE + תיקון attach
`control_response.title` → `sessionTitle` (‏VM). + `attachToLiveAgent:921`: להסיר את ה-reset,
לטעון title מ-`session/list` (‏עכשיו שהוא persist:true ונשמר). keep-on-undefined.

## §8 — Complexity

control-channel חדש (+2) · adapter-boundary (+2, אולי fork) · FE wiring · design-uncertainty.
≈ **7**, verifier **heavy**. אבל **תלוי-ספק** (‏claude-only) → scope תחום.

## §9 — שאלות פתוחות (‏רובן ל-spike)

| # | שאלה | ברירת-מחדל | חוסם? |
|---|---|---|---|
| 1 | ‏איך שולחים control_request (‏SDK API / adapter fork) | ‏spike יקבע | ✅ **חוסם** |
| 2 | ‏persist=true — איפה נשמר + האם session/list מחזיר | ‏לאמת ב-capture persist:true | 🟡 |
| 3 | ‏trigger — turn-count מול idle | ‏turn-count ~3 (‏כמו VSCode) | ❌ |
| 4 | ‏description — הודעה ראשונה או תמצית | ‏הודעה ראשונה (‏VSCode עושה כך) | ❌ |
