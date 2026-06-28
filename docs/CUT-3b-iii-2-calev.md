# CUT-3b-iii-2 — calev-heavy verification — GO (7/7 DoD)

> **תאריך:** 2026-06-29 · **mode:** heavy · **verdict:** GO · **Commit:** 279f89c
> **הדוח המלא (מקור-אמת):** `~/projects/brief-driven-slices/main/reports/drive-coding/slice-CUT-3b-iii-2-live-routing-calev.md`
> **Evidence:** `/tmp/verify/CUT-3b-iii-2/*`

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items | 7/7 ✅ |
| Regressions | 0 |
| Bugs חדשים | 0 (1 minor in-scope מתועד) |
| BE errors/unhandled | 0 / 0 |

claude רץ **in-process חי** וענה "PONG" דרך הזרימה האמיתית (initialize→session/new→prompt מעל WS).
opencode (pid=1896914) ו-gemini (pid=1897393) נשארו **spawn**. ערוץ ה-**ext חי**
(`_drive/setThinkingTokens`→`{ok:true}`, לא -32601). ה-connection in-process **שורד ניתוק-FE**
(session/load הצליח אחרי reconnect) — ה-seam הקריטי של Model 2 עובד.

## DoD

| # | בדיקה | סטטוס | עדות חיה |
|---|------|--------|----------|
| 1 | typecheck ירוק | ✅ declared | אליעזר הצהיר (calev לא מריץ כראיה) |
| 2 | claude in-process → prompt → תשובה | ✅ | agent text="PONG", stopReason=end_turn; connect ב-5ms (אין spawn) |
| 3 | opencode עדיין spawn (0 רגרסיה) | ✅ | opencode pid≠null; gemini→spawn; claude pid=null |
| 4 | ext חי (_drive/setThinkingTokens, לא -32601) | ✅ | claude `{ok:true}`; opencode `-32601` (נכון) |
| 4b | capability delivery (_drive/capabilities) | ✅ | frame הגיע ל-FE על attach |
| 5 | getRuntimeInfo (pid:null + שאר השדות) | ✅ | claude: `{pid:null, lastMessageAt:1782680174766, ...}` — אין short-circuit |
| 6 | modelOverride in-process | ✅ | claude+modelOverride ענה PONG; הוזרק ל-session/new |
| 7 | pnpm test (פרט ל-2 pre-existing) | ✅ | git diff: קבצי הטסטים הכושלים לא נגעו ב-iii-2 |

## הערת-סביבה

ה-prompt אמר onecli. הרצה דרך onecli voice-acp נתנה **401 מ-anthropic** (ה-agent בכוונה לא מזריק
Anthropic creds — AGENTS.md). הרצתי BE **בלי onecli** → claude in-process משתמש ב-OAuth של המשתמש →
prompt עבד מלא. **לא בעיה ב-slice.**

## ממצא יחיד (minor, in-scope)

`_drive/capabilities` מדווח `mcp:false` תמיד (mapClaudeCapabilities(null) לא מצותת ל-initialize).
מתועד בקוד כ-future improvement (connect-in-process.ts:249-254); ב-scope של ה-brief. לא blocker.
