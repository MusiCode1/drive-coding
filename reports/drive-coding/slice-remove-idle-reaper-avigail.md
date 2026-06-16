---
project: "drive-coding"
slice: "slice-remove-idle-reaper"
verifier: "avigail"
date: "2026-06-16"
verdict: "USABLE-AFTER-FIX"
findings:
  - id: 1
    severity: "confusion"
    category: "wrong-path"
    summary: "ws-agent.test.ts does not exist; actual file is ws-agent-pipe.test.ts"
    source_brief: "§0 reading-list line 51, §6 risk row 'ws-agent.test.ts mock'"
    source_code: "packages/backend/tests/ws-agent-pipe.test.ts:68"
    cost_estimate: "5min"
  - id: 2
    severity: "outdated"
    category: "outdated-risk"
    summary: "stale reaper comment in agent-session.svelte.ts not covered by DoD#5 grep"
    source_brief: "§5 DoD #5 (greps only 'TEMPORARY (slice 26)')"
    source_code: "packages/frontend/src/lib/view-models/agent-session.svelte.ts:320"
    cost_estimate: "5min"
  - id: 3
    severity: "minor"
    category: "wrong-line-number"
    summary: "brief claims integration-active-agents tip f5c3ce0 but actual tip is 22669a5"
    source_brief: "§0 header line 8 'integration-active-agents tip=f5c3ce0'"
    source_code: "git log -1 integration-active-agents -> 22669a5"
    cost_estimate: "2min"
  - id: 4
    severity: "minor"
    category: "naming-inconsistency"
    summary: "TEMPORARY (slice 26) comments also live in ws-agent.ts (45,83,140); brief Commit-2 only edits bridge-manager.ts comments"
    source_brief: "§4 Commit 2 'update comments', §5 DoD #5"
    source_code: "packages/backend/src/delivery/ws-agent.ts:45,83,140"
    cost_estimate: "5min"
---

# Plan Verification — slice-remove-idle-reaper

> **Brief**: docs/plans/slice-remove-idle-reaper.md
> **Base tip**: integration-active-agents = `22669a5` (brief claims `f5c3ce0`; reaper-relevant files identical between the two)
> **Verdict**: 🟡 USABLE-AFTER-FIX
> **אומדן זמן אליעזר confusion אם לא תוקן**: ~10-15 דק' (בעיקר חיפוש אחר ws-agent.test.ts שלא קיים)

ה-brief נבדק כולו מול `integration-active-agents` (לא מול dev — כפי שהורה §0). dev הנקי אכן חסר את כל הסמלים, כצפוי. הטענה המרכזית עומדת: ההסרה כירורגית ונכונה.

## בעיות שנמצאו

### 🔴 Blocker / Regression risk

אין. אין blocker ואין regression risk. הטענה המרכזית אומתה (ראו spot-check).

### 🟡 Confusion / Type error / Outdated

| # | בעיה | מקור | הצעה |
|---|------|------|------|
| 1 | ה-brief מפנה ל-`ws-agent.test.ts` (§0 reading-list שורה 51 + §6 risk row). **הקובץ לא קיים.** הקובץ הממשי שמחזיק את ה-mock עם `markAttached`/`markDetached` הוא `ws-agent-pipe.test.ts`. אליעזר יחפש קובץ לא-קיים. | brief §0/§6 / `packages/backend/tests/ws-agent-pipe.test.ts:68` (`const bridgeManager = { getChild: vi.fn(()=>null), markAttached: vi.fn(), markDetached: vi.fn() }`) | החלף את שם הקובץ ל-`ws-agent-pipe.test.ts` ב-§0 ו-§6. **המהות של ה-risk נכונה** — ה-mock כולל רק `getChild`/`markAttached`/`markDetached` (כולם נשארים), אין בו `listIdle`/`getCreatedAt`. הטסט לא יישבר. |
| 2 | DoD #5 בודק רק `grep "TEMPORARY (slice 26)"`. אבל יש הערה מיושנת על ה-reaper גם ב-FE שלא תיתפס: `agent-session.svelte.ts:320` — `// ... יתום קבוע (reaper לא נוגע ב-hasActiveWs=true) ...`. אחרי המחיקה ה-reaper כבר לא קיים, ההערה הופכת מטעה. | brief §5 DoD #5 / `packages/frontend/src/lib/view-models/agent-session.svelte.ts:320` | אופציונלי: להוסיף ל-Commit 3 הערה לתקן/לעדכן את ההערה הזו, או לתעד שהיא נשארת בכוונה. לא חוסם. |

### 🟢 Minor

| # | בעיה | מקור |
|---|------|------|
| 3 | ה-brief טוען `integration-active-agents tip=f5c3ce0` (שורה 8). ה-tip הממשי הוא `22669a5`. אימתתי `git diff f5c3ce0 integration-active-agents` על כל קבצי ה-reaper (bridge-manager.ts, reap-idle.ts, server.ts, ws-agent.ts) → **diff ריק**. הסטייה אינה משפיעה על ה-slice, רק על דיוק התיעוד. | brief §0 שורה 8 |
| 4 | ה-brief §4 Commit 2 מורה לעדכן הערות `TEMPORARY (slice 26)` ב-bridge-manager.ts בלבד. אבל יש 3 הערות כאלה גם ב-`ws-agent.ts` (שורות 45, 83, 140) שמתייחסות ל-`markAttached`/`markDetached`. הן ישרדו את ה-slice ויהפכו מיושנות (הסמלים כבר לא זמניים — הם משרתים את התצוגה). DoD #5 (`grep "TEMPORARY (slice 26)" → אפס`) **ייכשל** בגלל ההערות האלה. | brief §4 Commit 2 / `packages/backend/src/delivery/ws-agent.ts:45,83,140` |

> ⚠️ הערה על finding #4: זו לא רק הערה-מיושנת — היא הופכת את **DoD #5 לבלתי-עביר** כפי שנוסח. ה-grep `TEMPORARY (slice 26)` יחזיר 3 hits ב-ws-agent.ts אם אליעזר יעדכן רק את bridge-manager.ts. מרדכי צריך או (א) להוסיף לCommit 2 עדכון של ההערות ב-ws-agent.ts, או (ב) להגביל את grep ה-DoD ל-`packages/backend/src/acp/`.

## Spot-check שעבר (לא מצא בעיה)

- ✅ **הטענה המרכזית** — `hasActiveWs` נחוץ ל-`getRuntimeInfo`: `bridge-manager.ts:248` → `return { pid: e.handle.pid, attached: e.hasActiveWs }`. נצרך ע"י `http-agents.ts:33` (`deps.bridgeManager?.getRuntimeInfo(a.id)`) → GET /api/agents. **חייב להישאר. אומת.**
- ✅ אין צרכן אחר של `listIdle` מחוץ ל-reaper+טסטים-למחיקה: hits רק ב-`reap-idle.ts`, `server.ts` (דרך reapIdleBridges), `bridge-manager.idle.test.ts` [נמחק], `reaper-pin.test.ts` [נמחק]. אומת ב-grep מקיף על integration-active-agents.
- ✅ אין צרכן אחר של `getCreatedAt`: רק `bridge-manager.idle.test.ts` [נמחק] + ההגדרה/מימוש ב-bridge-manager.ts. אומת.
- ✅ אין צרכן אחר של `lastDetachedAt` (שדה ה-Entry): רק ב-bridge-manager.ts (listIdle/markDetached/אתחול) + idle.test.ts [נמחק]. אומת.
- ✅ הבחנת `createdAt`: יש המון `createdAt` לא-קשורים (agent schema, bubbles, voice cache-headers, ActiveProcessesPanel `agent.createdAt`). **DoD #4 grep לא כולל `createdAt`** — נכון; אילו היה כולל, היה false-positive המוני. אליעזר ימחק רק את `Entry.createdAt` (bridge-manager.ts:35,163,234,241).
- ✅ `reap-idle.ts` קיים, כל הקובץ סובב סביב reapIdleBridges+listIdle → מחיקה מלאה תקינה.
- ✅ `reaper-pin.test.ts` בודק רק `reapIdleBridges` → מחיקה מלאה תקינה.
- ✅ `bridge-manager.idle.test.ts` בודק רק `listIdle`/`getCreatedAt` → מחיקה מלאה תקינה.
- ✅ בלוק ה-reaper ב-`server.ts` (שורות ~145-152: `BRIDGE_IDLE_TIMEOUT_MS`, `REAP_INTERVAL_MS`, `setInterval`, `reaper.unref()`, import שורה 48) תואם בדיוק ל-§3. `bridgeManager`/`orchestrator`/`registry` אכן בשימוש במקומות אחרים (registerAgentsHttp, createAgentWsHandler) — אסור להסיר. אומת.
- ✅ `bridge-manager.runtime.test.ts` (לא מוזכר ב-brief) — בודק `getRuntimeInfo` בעזרת `markAttached`/`markDetached`/`getRuntimeInfo` בלבד. **שורד ללא נגיעה.** אין סיכון.
- ✅ `markDetached` שינוי: השורה `e.lastDetachedAt = Date.now()` (bridge-manager.ts:222) תוסר, יישאר `e.hasActiveWs = false` — תואם §3. אומת.
- ✅ DoD #4 grep (`reapIdle|listIdle|getCreatedAt|reap-idle` ב-`packages/backend/src`) → אחרי המחיקות לא יישאר אף hit בקובץ ששורד. אומת (כל ה-hits ב-src נמצאים בקבצים שנמחקים/נערכים).
- ✅ פקודות Verification ריאליות: `@drive-coding/backend` הוא שם ה-filter; `pnpm typecheck` (`tsc --build`), `pnpm lint:i18n` (`./scripts/lint-no-hebrew-in-code.sh`) קיימים ב-root package.json.
- ✅ dev הנקי חסר את הסמלים (אומת `dev:reap-idle.ts → MISSING`) — מאשר ש-§0 צודק שצריך לבדוק מול integration-active-agents.

## Verdict

🟡 **USABLE-AFTER-FIX** — אין blocker ואין regression risk; הטענה המרכזית והניתוח הכירורגי נכונים לחלוטין. שני תיקונים קלים (~15 דק' של מרדכי):
1. **finding #1**: לתקן `ws-agent.test.ts` → `ws-agent-pipe.test.ts` ב-§0 ו-§6.
2. **finding #4 (החשוב)**: להוסיף לCommit 2 עדכון של 3 הערות `TEMPORARY (slice 26)` ב-`ws-agent.ts`, או להגביל את grep DoD #5 ל-`packages/backend/src/acp/` — אחרת DoD #5 ייכשל.

findings #2, #3 minor — לשיקול מרדכי.
