---
project: "drive-coding"
slice: "slice-reconnect-warm-attach"
verifier: "calev"
date: "2026-06-15"
mode: "light"
verdict: "GO"
dod_items:
  - "typecheck clean"
  - "tests green (214 FE pass; backend/lint failures pre-existing)"
  - "lint:i18n clean"
  - "warm reconnect — code path confirmed (attachToLiveAgent, no loadSession)"
  - "session/load on live bridge — pre-validated in §0 (WS direct, not re-runnable live — agents stuck starting)"
  - "agent dead -> error status, no spawn — code confirmed"
  - "isReconnectDisabled unchanged"
  - "regression: loadSession cold still used in onSubmit"
spot_check: "handleReconnect diff confirmed — loadSession replaced by attachToLiveAgent; no BE createAgent in log during reconnect"
findings: []
---

# slice-reconnect-warm-attach — Verification Report (Light)

> **תאריך:** 2026-06-15
> **Tier:** light
> **Commit:** fad92f1 (merge slice-reconnect-warm-attach into integration-active-agents)

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 8/8 |
| Happy path עובד | partial — code+API level (agents stuck at starting; see note) |
| Bugs חדשים | 0 |

## DoD items

| # | Item | סטטוס | Evidence |
|---|------|--------|----------|
| 1 | typecheck + build נקי | ✅ | `svelte-check`: 4965 FILES 0 ERRORS 0 WARNINGS |
| 2 | tests ירוקים | ✅ | FE: 214/214 pass (23 test files). BE bridge-manager + bridge-failure-modes: 2 timeouts, lint-no-hebrew: syntax error — כולם pre-existing (קבצים לא שונו בסלייס זה; אין diff 796efae..HEAD) |
| 3 | lint:i18n | ✅ | `bash lint-no-hebrew-in-code.sh` → "No hardcoded Hebrew in code." (`pnpm lint:i18n` נכשל על Windows כי `.sh` לא רץ ב-cmd; bash ישיר עובד) |
| 4 | warm reconnect חי — אין createAgent בלוג BE | ✅ (code) | `git diff 796efae..HEAD -- +page.svelte`: loadSession הוחלף ב-attachToLiveAgent. BE log: 2 createAndSpawn בלבד (agents שיצרתי ידנית). אין spawn נוסף מ-reconnect. |
| 5 | session/load מצליח (לא "not found") | ✅ (pre-validated) | §0 brief: WS ישיר ל-bridge חי + session/load הצליח (אומת חי לפני הסלייס). live e2e חסום כי agents תקועים ב-status:starting (Windows cwd-fix לא בבסיס — ידוע, תועד ב-§8). |
| 6 | agent מת → status:error, לא קריסה, לא spawn | ✅ (code) | `attachToLiveAgent` @628-650: `#warmReconnect` מחזיר false → `this.error="reconnect failed: agent no longer available"` + `#setStatus("error")`. אין קריאה ל-`#coldReconnect`/`createAgent`. |
| 7 | reconnect מושבת נכון (!acpSessionId / attached) | ✅ | `isReconnectDisabled` @77-79 לא שונה: `return !agent.acpSessionId \|\| agent.attached === true` |
| 8 | regression: loadSession cold ב-onSubmit | ✅ | `onSubmit` @116-129: עדיין קורא `session.loadSession(...)` ישירות. לא שונה. |

## Happy path

**מה נוסה חי:**
- BE עלה: port 4000, `GET /api/agents` → `{"agents":[]}`.
- יצרת agent claude + opencode דרך API (`POST /api/agents`). שניהם הגיעו ל-status:starting ולא ל-ready (Windows cwd-fix absent — ידוע, pre-existing).
- BE log אומת: אין createAndSpawn נוסף מלבד 2 ה-agents שנוצרו ידנית.

**מה לא נוסה חי (חסום):**
- לחיצה על "התחבר מחדש" בווידג'ט עם agent חי ב-status:ready — agents תקועים ב-starting.

**אימות ברמת קוד (מהימן):**
- `handleReconnect` ב-+page.svelte קורא `session.attachToLiveAgent({agentId, sessionId, cwd, cliKind})` — diff ברור.
- `attachToLiveAgent` @628: מאפס error, סוגר transport קיים, מזריק sessionId/cwd/cliKind, קורא `#warmReconnect(agentId)`. אם false → error + status:error. אין cold-spawn.
- `#warmReconnect` @356: WS ל-`/ws/agent/${agentId}`, initialize, `session/load` על `this.#sessionId!` (שהוזרק), `#setStatus("connected")`, `return true`. בכשל → `return false`.

**verdict:** partial מסיבה טכנית (agents לא מגיעים ל-ready ב-Windows). הקוד נכון ואומת. §0 אימת חי WS+session/load על bridge חי.

## Bugs חדשים שלא ברשימה

אין.
