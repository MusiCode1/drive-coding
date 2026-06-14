---
project: "drive-coding"
slice: "slice-model-status-replay-v2"
verifier: "avigail"
date: "2026-06-14"
verdict: "USABLE-AFTER-FIX"
findings:
  - id: 1
    severity: "confusion"
    category: "outdated-risk"
    summary: "NBug1 (opencode-tail #17505) is NOT documented in docs/decisions/voice-acp.md 2026-06-03; that date's NBug1 is the unrelated reconnect onClose bug"
    source_brief: "§1 (line 101), §8.6 (line 293)"
    source_code: "docs/decisions/voice-acp.md:130"
    cost_estimate: "10-20min"
  - id: 2
    severity: "confusion"
    category: "naming-inconsistency"
    summary: "Brief cites '659f0dc/41dd8c0' as the two NBug1 commits, but 41dd8c0 is NBug3 (reset turnState after replay) by its own commit message"
    source_brief: "§1 line 100, §8.6 line 292"
    source_code: "git 41dd8c0"
    cost_estimate: "5min"
  - id: 3
    severity: "minor"
    category: "dropped-branch"
    summary: "AppHeader status-dot consumer (:77) is framed as conditional 'if there is' but definitely exists and is mandatory to edit"
    source_brief: "§2.4 line 156-157"
    source_code: "packages/frontend/src/lib/components/layout/AppHeader.svelte:77"
    cost_estimate: "5min"
---

# Plan Verification — slice-model-status-replay-v2

> **Brief**: docs/plans/slice-model-status-replay-v2.md
> **Base tip**: 2aa9307 (dev)
> **Verdict**: 🟡 USABLE-AFTER-FIX
> **אומדן זמן אליעזר confusion אם לא תוקן**: ~20 דק'

ה-brief מדויק טכנית ברמה חריגה — **כל ה-line numbers ב-§2 אומתו verbatim** מול dev tip,
כל ה-dependencies ב-§4/§5/§6 קיימות, וההנחה המרכזית (reconnect אורתוגונלי ל-thinking)
אומתה. אין blockers. שלושת ה-findings הם דיוקי-תיעוד/ניסוח שיחסכו לאליעזר בלבול סביב
DoD#5/#6 (NBug1 tail-debounce — החלק השביר ביותר בסליס).

## בעיות שנמצאו

### 🟡 Confusion / Outdated

| # | בעיה | מקור (brief / קוד) | הצעה |
|---|------|---------------------|------|
| 1 | ה-brief מפנה את אליעזר ל-`docs/decisions/voice-acp.md` 2026-06-03 כדי לשחזר את NBug1 (opencode-tail / mid-stream RESP / #17505). אבל ה-"NBug1" היחיד בתאריך הזה ב-decisions doc (שורה 130) הוא **באג אחר לגמרי** — onClose תקוע ב-cold-teardown של ה-reconnect (NBug1+NBug2 של ws-reconnect). ה-opencode-tail issue (#17505, "RESP באמצע הזרם") **לא מתועד כלל** ב-voice-acp.md (grep ל-`17505`/`tail`/`RESP`/`באמצע הזרם` → ריק). אליעזר שיפתח את ה-doc לפי ההפניה ימצא באג לא-רלוונטי. | brief §1:101, §8.6:293 / docs/decisions/voice-acp.md:130 | מרדכי: הסר/תקן את הפניית-ה-decisions; ההפניה התקפה היחידה היא ל-commit `659f0dc` (ראה finding 2). |
| 2 | ה-brief מתאר את ה-fix כ-"branch ישן commits `659f0dc`/`41dd8c0`". בפועל: `659f0dc` = "idle-on-RESP + debounce-net על tail (NBug1 — מעקף opencode #17505)" — זה הקומיט הנכון (40 שורות, מזכיר turnEnded/scheduleIdle/TAIL_MS). אבל `41dd8c0` = "reset turnState=idle אחרי replay (**NBug3** — history phantom)" — זה NBug3, לא NBug1. אליעזר צריך את שניהם בכל מקרה (גם reset-after-replay), אך השיוך מטעה. | brief §1:100, §8.6:292 / git 41dd8c0 | מרדכי: ציין מפורשות "`659f0dc` (NBug1 tail) + `41dd8c0` (NBug3 replay-reset)". |

### 🟢 Minor

| # | בעיה | מקור |
|---|------|------|
| 3 | §2.4 מנסח את AppHeader כ-"**אם יש** תנאי `status === 'thinking'` ברקע ה-dot → הסר". התנאי קיים ודאי ב-`:77` (`session.status === 'connected' \|\| session.status === 'thinking'`). מאחר ש-thinking יוסר מה-type, זהו consumer **חובה לעריכה** (לא אופציונלי). typecheck יתפוס אותו (גישה ישירה לשדה, לא cast) → low risk, אך ראוי לציון ודאי. | brief §2.4:156-157 / packages/frontend/src/lib/components/layout/AppHeader.svelte:77 |

## Spot-check שעבר (לא מצא בעיה)

**§2.1 AgentSession (`view-models/agent-session.svelte.ts`, 1126 שורות) — כל ה-line numbers verbatim:**
- ✅ `AgentSessionStatus` type :39-45, `thinking` ב-:43, `disconnected` ב-:45 — אומת
- ✅ `status` field :73 — אומת
- ✅ `sendPrompt` :472, guard :473, `#setStatus("thinking")` :490, resolve :494 — אומת
- ✅ `applyConfigOption` :727, guard :728 — אומת
- ✅ `#setStatus` :815, cue thinking :819, error cue :820 — אומת
- ✅ chunks: agent_message_chunk :982, agent_thought_chunk :984; dispatch tool_call :968/:972; `#handleToolCall` :996, `#handleToolCallUpdate` :1034 — אומת

**§2.2/2.3/2.4 שאר הקבצים:**
- ✅ voice-mode :28 (VoiceModeState type נשאר), :45, :59 — אומת
- ✅ speaker :269, :275; effect קורא `this.#session.status` (:131, tracked) ומעביר ל-`#handleStatusTransition(status, enabled, speakThoughts)` (:163, :266) — חתימת `enabled` קיימת ✓; `#processToolBubbles(bubbles, enabled, ...)` ב-:390 — חתימת `enabled` קיימת ✓ (§2.3 מדויק)
- ✅ TypeArea :19 — אומת
- ✅ MicLarge :44/:69 קורא `voiceMode.state` (לא status) — לא משתנה, מדויק ✓
- ✅ AppShell smart-scroll $effect קורא `session.bubbles.length` (:66) — קיים (§3.4 מדויק)
- ✅ agent-session.test.ts:242 `session.status = "thinking" as typeof session.status` — קיים (§2.5/§9.2 מנחה לעדכן ✓)

**ההנחה המרכזית — reconnect אורתוגונלי:**
- ✅ כל 8 מתודות reconnect קיימות (`#runReconnectLoop`/`#doReconnect`/`#findReusableAgent`/`#scheduleReconnect`/`#handleUnexpectedClose`/`#warmReconnect`/`#coldReconnect`)
- ✅ אף אחת לא מתייחסת ל-`status === "thinking"`. ה-2 מופעי "thinking" הנוספים (:610, :670) הם **הערות בלבד** — ה-guards בפועל הם `status !== "connected"`. לא consumers.
- ✅ רשימת ה-consumers ב-brief מלאה (פרט ל-finding 3 שהוא ניסוח, לא פספוס)

**Dependencies (§4/§5/§6) — כולן ב-dev:**
- ✅ POST `/api/recordings` → `{id}` 201, body `{audioBase64, mimeType}` — `http-history.ts:73-98` (shape מדויק כפי שה-brief טוען)
- ✅ stub `Promise.resolve({ id: "" })` + `withRetry` (sessions-inline) ב-`transcribe.ts:40,54`, return `{text, recordingId}` :76 — אומת
- ✅ `cancel(sessionId)` ב-`core/acp/client.ts:50,161` — אומת
- ✅ `synthesizeStreaming` ב-`tts.ts:29` — אומת
- ✅ `bytesToBase64` ב-`base64.ts:13` — אומת
- ✅ `beUrl` ב-`util/be-url.ts:31` — אומת
- ✅ `settings.language.*` keys קיימים ב-`keys.ts:137-139` + catalogs (collision warning §3.3/§6 תקף ועדכני)
- ✅ קבצים חדשים (recordings.ts, play-bubble.ts, bubble-player, model-status, StatusBubble) — לא קיימים עדיין (נכון)

**§8.6 / NBug1 reference (skeleton recoverable):**
- ✅ branch `slice-model-status-control-replay` = `aae715f` קיים; brief המקורי קריא דרך git show
- ✅ commit `659f0dc` הוא ה-NBug1 האמיתי (turnEnded/scheduleIdle/TAIL_MS=1500) — skeleton מלא ניתן לשחזור מה-branch הישן (`#turnEnded` :105, `#scheduleIdle` :110, `#resetTurnTracking`, `#setTurnState`)
- ✅ `docs/decisions/voice-acp.md` קיים

**depends_on (§7):**
- ✅ depends_on=[] תקף — sessions-inline (withRetry ב-transcribe), wake-word infra, ws-reconnect (8 מתודות) — כולם ב-dev tip 2aa9307

## Verdict

🟡 **USABLE-AFTER-FIX** — ה-brief טכנית מצוין ואין blocker. שני תיקוני-תיעוד קצרים (findings 1+2)
סביב הפניות ה-NBug1 ימנעו מאליעזר לבזבז זמן על ה-decisions doc הלא-נכון בחלק השביר ביותר
(tail-debounce). finding 3 הוא חידוד-ניסוח. ~20 דק' תיקון של מרדכי ואז READY.
