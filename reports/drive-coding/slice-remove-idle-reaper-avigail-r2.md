---
project: "drive-coding"
slice: "slice-remove-idle-reaper"
verifier: "avigail"
date: "2026-06-16"
verdict: "USABLE-AFTER-FIX"
findings:
  - id: 1
    severity: "confusion"
    category: "outdated-risk"
    summary: "DoD 5b grep reaper will still match 3 unaddressed sites: cli-config.ts:74, core/agent.ts:75, frontend/docs/slices.md:78"
    source_brief: "§5 DoD #5b"
    source_code: "packages/backend/src/acp/cli-config.ts:74; packages/core/src/schemas/agent.ts:75; packages/frontend/docs/slices.md:78"
    cost_estimate: "5-10min"
  - id: 2
    severity: "minor"
    category: "outdated-risk"
    summary: "Commit 2 says remove TEMPORARY (fix-idle-flaky) comment but it sits on the getCreatedAt line which is deleted anyway"
    source_brief: "§4 Commit 2"
    source_code: "packages/backend/src/acp/bridge-manager.ts:24"
    cost_estimate: "0min"
  - id: 3
    severity: "minor"
    category: "outdated-risk"
    summary: "§0 verification-base note still tells avigail to verify against integration-active-agents not dev (stale post-merge)"
    source_brief: "§0 lines 16-26, §6, §7"
    source_code: ""
    cost_estimate: "0min"
---

# Plan Verification — slice-remove-idle-reaper (round 2)

> **Brief**: docs/plans/slice-remove-idle-reaper.md
> **Base tip**: b2c2349 (active-agents merged to dev)
> **Verdict**: 🟡 USABLE-AFTER-FIX
> **אומדן זמן אליעזר confusion אם לא תוקן**: ~5-10 דק' (DoD #5b ייכשל ויבלבל)

סבב 2: כל הסמלים אומתו **בפועל מול dev** (`git show dev:<path>`), לא בהנחת מיזוג. המיזוג בוצע. ה-brief מדויק טכנית כמעט לחלוטין — הבעיה היחידה האמיתית היא ש-DoD #5b לא יושג כי קיימות התייחסויות "reaper" שה-brief לא מתכנן לעדכן.

## בעיות שנמצאו

### 🔴 Blocker / Regression risk

אין. כל הסמלים, הנתיבים, מספרי-השורות, וה-call-sites אומתו מול dev.

### 🟡 Confusion / Type error / Outdated

| # | בעיה | מקור | הצעה |
|---|------|------|------|
| 1 | **DoD #5b לא יושג**: `grep -ri "reaper" packages` ידרוש "רק התייחסויות מעודכנות". אך 3 אתרים מזכירים reaper וה-brief **לא** מתכנן לגעת בהם: (א) `cli-config.ts:74` הערה "ל-idle-reaper tests שמשתמשים ב-bun כ-sleep binary" — ה-tests הללו נמחקים, אז ההערה הופכת stale; (ב) `core/agent.ts:75` הערת-schema "true = ה-reaper לא יהרוג גם כשמנותק" — ה-reaper נמחק, ההסבר שגוי; (ג) `frontend/docs/slices.md:78` "Idle-bridge reaper ⚠️ זמני ... למחיקה ב-future A". | brief §5 DoD #5b / `cli-config.ts:74`, `core/schemas/agent.ts:75`, `frontend/docs/slices.md:78` | מרדכי: או להוסיף את 3 האתרים ל-Commit 2/3 (עדכון הערות), או להחליש את DoD #5b ל-allowlist מפורש. אחרת אליעזר יראה DoD #5b "נכשל" ויתבלבל אם זה regression. |
| 3 | **§0 base-note stale**: §0 (שורות 16-26), §6 שורת "בסיס אימות שגוי", §7 escalation #3 — כולם מורים לאמת מול `integration-active-agents` "כי המיזוג טרם בוצע". המיזוג **כבר בוצע** ל-dev (b2c2349). הסעיף נכון פונקציונלית אך מטעה את אליעזר ("צריך worktree מ-integration?"). | brief §0:16-26, §6, §7 #3 | מרדכי: עדכן §0 ל"מוזג; אמת מול dev" והסר את ה-merge-gate ב-§0 Worktree (שורה 39). |

### 🟢 Minor

| # | בעיה | מקור |
|---|------|------|
| 2 | Commit 2 מבקש "הסר את הערת `// TEMPORARY (fix-idle-flaky)`" — ההערה יושבת על שורת `getCreatedAt` (`bridge-manager.ts:24`) שנמחקת כולה ממילא. ההוראה לא שגויה אך מיותרת. | brief §4 Commit 2 / `bridge-manager.ts:24` |

## Spot-check שעבר (לא מצא בעיה)

- ✅ `reap-idle.ts` קיים ב-dev עם `reapIdleBridges`, `listIdle` בלבד ב-deps — `packages/backend/src/acp/reap-idle.ts`. נמחק כולו (Commit 1).
- ✅ `reaper-pin.test.ts` קיים, מייבא `reapIdleBridges` + משתמש ב-`listIdle`/`markAttached`/`markDetached` בלבד — בודק **רק** reaper. מחיקה בטוחה. `packages/backend/tests/reaper-pin.test.ts`.
- ✅ `bridge-manager.idle.test.ts` קיים ב-`packages/backend/src/acp/` (לא ב-tests/) — הנתיב ב-brief Commit 2 נכון. בודק **רק** `listIdle`/`getCreatedAt`. מחיקה בטוחה.
- ✅ server.ts reaper block: import שורה 48, בלוק שורות 139-150 (`BRIDGE_IDLE_TIMEOUT_MS`, `REAP_INTERVAL_MS`, `setInterval`, `reaper.unref()`, הערת TEMPORARY) — תואם §4 Commit 1 במדויק.
- ✅ bridge-manager.ts: `Entry` עם `hasActiveWs`/`lastDetachedAt`/`createdAt` (שורות ~32-37); `getRuntimeInfo` קורא `e.handle.pid` + `e.hasActiveWs` בלבד (שורות ~216-220) — **לא** תלוי ב-`createdAt`/`lastDetachedAt`. ההסרה הכירורגית נכונה; §7 escalation לא ייורה.
- ✅ `markDetached` מכיל `e.hasActiveWs = false` + `e.lastDetachedAt = Date.now()` (שורות ~167-171) — תואם §3 (הסר רק את lastDetachedAt).
- ✅ **בדיקת-צרכן קריטית (משימה 3)**: `git grep listIdle|getCreatedAt|reapIdle|reap-idle|lastDetachedAt` ב-`packages/` מחוץ ל-bridge-manager.ts+reap-idle.ts → **רק** 2 קבצי-הטסט שנמחקים. אין צרכן יתום. `agent.createdAt`/`meta.createdAt`/`ActiveProcessesPanel` הם שדות-domain שונים (schema/voice-meta), **לא** ה-`Entry.createdAt`.
- ✅ `hasActiveWs` נחוץ ל-`getRuntimeInfo` (→ `attached` בתצוגה) ול-`markAttached`/`markDetached` ב-ws-agent.ts — נשאר. אומת.
- ✅ ws-agent.ts הערות `TEMPORARY (slice 26)` בשורות 45, 83, 140 — תואם §4 Commit 2 (~45/~83/~140). הקריאות `markAttached`/`markDetached` נשארות.
- ✅ agent-session.svelte.ts הערות "reaper" stale בשורות 258 ("חלון reaper 5 דק'") ו-320 ("reaper לא נוגע ב-hasActiveWs=true") — קיימות; הקובץ 1277 שורות. תואם §4 Commit 3.
- ✅ ws-agent-pipe.test.ts mock (7 מופעים) כולל רק `getChild`/`markAttached`/`markDetached` — **אין** `listIdle`. הסיכון ב-§6 מטופל נכון: ה-mock לא נשבר.
- ✅ http-agents.test.ts ו-http-agents.ts משתמשים ב-`getRuntimeInfo` (שנשאר) — לא מושפעים.
- ✅ קבצי Commit 3 קיימים: `docs/walkthrough.md`, `docs/plans/archive/slice-26-bridge-idle-reaper.md`.
- ✅ DoD #4 grep (`reapIdle|listIdle|getCreatedAt|reap-idle`) → אחרי המחיקות יהיה אפס ב-`packages/backend/src`. ריאלי.
- ✅ DoD #5 grep (`TEMPORARY (slice 26)`) → אחרי עדכוני ws-agent.ts + bridge-manager.ts + מחיקת idle.test → אפס. ריאלי.
- ✅ `depends_on: []` — מתאים: התלות (מיזוג active-agents) כבר ב-dev. אין תלות ב-slice-brief אחר.

## Verdict

🟡 **USABLE-AFTER-FIX** — הליבה הטכנית מדויקת ובטוחה (אפס blockers, אפס regression risk, בדיקת-הצרכן עברה נקי). שתי בעיות-confusion קלות: (1) DoD #5b ייכשל בגלל 3 אתרי-"reaper" שלא תוכננו לעדכון — דורש החלטת-מרדכי (להוסיף לסקופ או להחליש DoD); (3) §0 base-note מיושן פוסט-מיזוג ועלול לבלבל את אליעזר לגבי ה-worktree base. ~5-10 דק' תיקון של מרדכי. אין צורך ב-rework מבני.
