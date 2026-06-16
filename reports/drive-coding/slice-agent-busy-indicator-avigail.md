---
project: "drive-coding"
slice: "slice-agent-busy-indicator"
verifier: "avigail"
date: "2026-06-16"
verdict: "USABLE-AFTER-FIX"
findings:
  - id: 1
    severity: "blocker"
    category: "missing-dependency"
    summary: "depends_on slices not merged: slice-remove-idle-reaper + slice-active-processes-layout have no branch and no merge; reaper TEMPORARY code still present"
    source_brief: "§0 depends_on / Commit 1"
    source_code: "packages/backend/src/acp/bridge-manager.ts:20-24,210-242"
    cost_estimate: "blocked-until-merged"
  - id: 2
    severity: "blocker"
    category: "missing-dependency"
    summary: "active-agents not merged to dev: getRuntimeInfo / ActiveProcessesPanel / connect.agents.* absent in dev; base = dev is wrong, real base is integration-active-agents"
    source_brief: "§0 Base / Dev tip=161bd94"
    source_code: "dev/packages/backend/src/acp/bridge-manager.ts (no getRuntimeInfo)"
    cost_estimate: "blocked-until-merged"
  - id: 3
    severity: "confusion"
    category: "wrong-line-number"
    summary: "integration-active-agents tip is 22669a5 not f5c3ce0 (f5c3ce0 is an ancestor)"
    source_brief: "§0 Dev tip line"
    source_code: "git: integration-active-agents=22669a5"
    cost_estimate: "2min"
  - id: 4
    severity: "regression"
    category: "dropped-branch"
    summary: "ws-agent-pipe.test.ts bridgeManager mock has no onLine and writes child.stdout directly; Commit 1 refactor breaks it more than brief's 'maybe update mock' implies"
    source_brief: "Commit 1 Verification line 142"
    source_code: "packages/backend/tests/ws-agent-pipe.test.ts:68,85,128-143"
    cost_estimate: "15-20min"
  - id: 5
    severity: "type-error"
    category: "type-error"
    summary: "http-agents deps bridgeManager.getRuntimeInfo type hardcoded {pid,attached} without busy; brief says 'no logical change' but rt.busy wont be in the local type"
    source_brief: "Commit 3 http-agents 'no change needed'"
    source_code: "packages/backend/src/delivery/http-agents.ts:25"
    cost_estimate: "5min"
  - id: 6
    severity: "minor"
    category: "unique"
    summary: "responseKind=result fires for ANY json-rpc result (initialize/session-new/permission), not only turn-end; tracker may flip busy=false prematurely (debounce mitigates)"
    source_brief: "§2 / Commit 2 logic"
    source_code: "packages/backend/src/delivery/wire-decode.ts:38"
    cost_estimate: "0min (degraded, not broken)"
---

# Plan Verification — slice-agent-busy-indicator

> **Brief**: docs/plans/slice-agent-busy-indicator.md
> **Base tip**: dev=161bd94 ; integration-active-agents=22669a5 (brief said f5c3ce0)
> **Verdict**: 🟡 USABLE-AFTER-FIX
> **אומדן זמן אליעזר confusion אם לא תוקן**: 30-60 דק' (אם dispatched מול dev הנקי — אליעזר יתקע מיד ב-Commit 1 כי getRuntimeInfo + הקוד שעליו הוא מרחיב לא ב-dev)

ה-brief עצמו טכנית-מדויק ברמת ה-symbols וה-API — כל הסמלים שתיארתי (decodeWireLine, WireSummary, ה-pipe, getRuntimeInfo, AgentPublic, enrichment, i18n) קיימים **בדיוק** כפי שה-brief מתאר, **כשבודקים מול ה-worktree הנכון**. הבעיה המרכזית היא **בסיס**: ה-depends_on מוצהר כ-`verified+merged` אך אף אחד מהשלושה לא מוזג ל-dev, ואין אפילו branch לשניים מהם.

## בעיות שנמצאו

### 🔴 Blocker

| # | בעיה | מקור (brief / קוד) | עלות אם לא תוקן |
|---|------|---------------------|------------------|
| 1 | `slice-remove-idle-reaper` ו-`slice-active-processes-layout` מוצהרים `status: verified+merged` (§0), אך **אין להם branch כלל** (לא local לא remote) **ולא מוזגו**. קוד ה-`TEMPORARY (slice 26)` reaper עדיין נוכח ב-bridge-manager — בדיוק מה שה-reaper-slice אמור היה להסיר. Commit 1 כתוב מפורשות "מניח את ה-Entry הנקי של slice-remove-idle-reaper". | brief §0 + §19-24 / `bridge-manager.ts:20-24, 32-36, 160-163, 210-242` (כל בלוקי slice 26) | חסום — ה-Entry שעליו אליעזר מרחיב שונה ממה שה-brief מתאר |
| 2 | **active-agents עצמו לא מוזג ל-dev**. `getRuntimeInfo` **לא קיים ב-dev** (`grep getRuntimeInfo dev/.../bridge-manager.ts` → ריק). גם `ActiveProcessesPanel.svelte` ו-`connect.agents.*` keys לא ב-dev. ה-brief קובע `Base: dev אחרי מיזוג active-agents` ו-`Dev tip=161bd94`, אבל 161bd94 (dev) לא מכיל active-agents. הבסיס הממשי היחיד שבו הסמלים קיימים הוא `integration-active-agents` (22669a5). | brief §0 Base / `dev/packages/backend/src/acp/bridge-manager.ts` (אין getRuntimeInfo) | אם dispatched מול dev → אליעזר תקוע מיד ב-Commit 1 |

> שתי הבעיות לעיל הן בעצם **בעיה אחת**: ה-brief מערבב "בסיס לוגי" (worktree active-agents) עם "בסיס מוצהר" (dev/161bd94). ה-warning של ה-brief עצמו (§24) קובע: "אם שני ה-slices לעיל לא מוזגו → 🔴 blocker." לפי הקריטריון של ה-brief עצמו — זה blocker. מרדכי חייב או (א) למזג קודם את שלושת ה-deps, או (ב) לתקן את §0 כך שה-Base יצביע ל-branch אמיתי שמכיל את הכל.

### 🟡 Confusion / Type error / Regression

| # | בעיה | מקור | הצעה |
|---|------|------|------|
| 3 | `integration-active-agents` tip הוא **22669a5**, לא `f5c3ce0` כפי שב-§0 (`f5c3ce0` הוא ancestor — ה-branch התקדם מאז). | brief §0 "integration-active-agents tip=f5c3ce0" / git | עדכן ל-22669a5 |
| 4 | ה-mock של `bridgeManager` ב-`ws-agent-pipe.test.ts` מספק רק `{getChild, markAttached, markDetached}` — **אין `onLine`**. הטסט "child.stdout line forwarded to FE" כותב ישירות ל-`child.stdout` (שורה 143). אחרי refactor של Commit 1 (ws-agent עובר ל-`onLine` במקום `getChild().stdout`) הטסט **שובר מהותית** — לא רק "אולי דורש עדכון mock" כפי שה-brief ממעיט (שורה 142). השורה תגיע דרך subscription, לא דרך כתיבה ל-stdout. | brief Commit 1 Verification / `tests/ws-agent-pipe.test.ts:68, 85, 128-143` | מרדכי: הדגש ב-Commit 1 שהטסט דורש rewrite של ה-mock (להוסיף `onLine` שמדמה דחיפת שורות), לא patch קל |
| 5 | Commit 3 קובע ל-http-agents "אין שינוי לוגי נדרש". אך type ה-deps ב-`http-agents.ts:25` hardcoded ל-`getRuntimeInfo(id): {pid, attached} | null` — **בלי `busy`**. ה-spread `{...(rt ?? {})}` (שורה 34) יעביר `busy` ב-runtime ולא ישבור typecheck (spread של type צר לתוך אובייקט מותר), אבל ה-type המקומי לא משקף את `busy` — מבלבל ומסתיר את ה-contract. | brief Commit 3 / `http-agents.ts:25` | מרדכי: הוסף `busy: boolean` גם ל-type ב-`http-agents.ts:25` (consistency, לא רק bridge-manager) |

### 🟢 Minor

| # | בעיה | מקור |
|---|------|------|
| 6 | `decodeWireLine` קובע `responseKind="result"` לכל json-rpc עם מפתח `result` (שורה 38) — כולל תגובת `initialize`, `session/new`, `session/request_permission` reply וכו', **לא רק** תגובת turn (`session/prompt`). לוגיקת ה-tracker (§2/Commit 2) מתייחסת ל-`responseKind==="result"` כ-turn-end → `busy=false`. תגובת result לא-קשורה באמצע turn עלולה להפיל busy ל-false מוקדם. ה-debounce + העדר id-correlation מצמצמים, וה-brief מסמן out-frame parsing כ-out-of-scope (§2, §9 שאלה 5). לכן degraded, לא שבור — אבל כדאי שמרדכי תדע שה-result-heuristic רועש יותר ממה ש-§2 מרמז. | `wire-decode.ts:38` + brief §2 |

## Spot-check שעבר (לא מצא בעיה)

- ✅ `WireSummary` — כל השדות מדויקים: `method?`, `sessionUpdate?`, `id?: string|number`, `responseKind?: "result"|"error"`, `unparsed`, `parsed?`. `wire-decode.ts:9-22`.
- ✅ `sessionUpdate` מחולץ מ-`params.update.sessionUpdate` בדיוק כפי שה-brief טוען. `wire-decode.ts:41-43`.
- ✅ `decodeWireLine` **pure** — אין IO, לעולם לא זורק (try/catch על JSON.parse). מתאים ל-§2 "module טהור → TDD" ולעיקרון הפרדת FE/BE. `wire-decode.ts:24-45`.
- ✅ `wire-decode.ts` קיים גם ב-**dev** (`dev/packages/backend/src/delivery/wire-decode.ts`) — כפי שצוין בבסיס האימות.
- ✅ ה-pipe ב-`ws-agent.ts`: `createInterface({input: child.stdout, crlfDelay: Infinity})` (שורה 92), `rl.on("line")` (93), סדר `feWs.send` (96) → ואז `logWire("in")` (100), `rl.close()` ב-feWs close (141). `child.stdin.write` נפרד וישיר ב-feWs `message` (118). הכל מדויק — זו אכן נקודת ה-refactor.
- ✅ stderr listener קבוע ב-`spawnInternal` (`bridge-manager.ts:123` — `child.stderr.on("data")`). זו התבנית ל-reader קבוע. (הערה: stderr הוא chunk-handler, stdout המתוכנן readline — לא זהה אבל הטענה "listener קבוע קיים" נכונה.)
- ✅ `getRuntimeInfo` מחזיר כיום `{pid, attached}` (`bridge-manager.ts:245-249`). ההרחבה ל-`busy` ריאלית.
- ✅ backpressure (טענה §1/§6 Commit 1): **אין** listener קבוע על `child.stdout` ב-spawnInternal — רק על stderr (123). כשאין feWs, ה-stdout לא נצרך. ה-brief צודק שזה תיקון אמיתי.
- ✅ `AgentPublic` תומך ב-optional fields: `"pid?": "number"`, `"attached?": "boolean"` (`agent.ts:97-98`) — תבנית arktype זהה ל-`"busy?": "boolean"`. `toAgentPublic` לא כולל pid/attached (119-138) → הוראת ה-brief "אל תוסיף ל-toAgentPublic" עקבית.
- ✅ enrichment: `{...toAgentPublic(a), ...(rt ?? {})}` (`http-agents.ts:34`) — ה-busy יתפשט אוטומטית כשייכלל ב-rt.
- ✅ `connect.agents.*` keys קיימים בשלושה: `keys.ts:174-182`, `he.ts:163-171`, `en.ts:168-176`. `connect.agents.working` עדיין לא קיים (נכון — ה-slice מוסיף). ההוספה תצטרך את שלושתם.
- ✅ package names: `@drive-coding/backend`, `@drive-coding/core`, `@drive-coding/frontend-v2` — מאומתים מ-package.json.
- ✅ הפרדה FE/BE: turn-tracker מתוכנן לייבא רק `wire-decode.js` (ב-`delivery/`, pure). `agent-session.svelte.ts` ב-`frontend/.../view-models/` (חבילה אחרת). אין סיכון טכני לתלות הכרחית — ההפרדה ישימה.
- ✅ `turn-tracker.ts` עדיין לא קיים (נכון — קובץ חדש). `ws-agent-pipe.test.ts` קיים (reference מדויק).
- ✅ `ActiveProcessesPanel.svelte` + `statusColor` קיימים בווידג'ט (`:41`). הערה: `statusColor` כבר מטפל ב-`status==="busy"` — אבל ה-brief משתמש בשדה `busy?: boolean` נפרד (runtime enrichment), לא ב-`status`. הבחנה תקינה, לא קונפליקט.
- ✅ depends_on הגיוני לוגית: שני ה-deps נוגעים באותו Entry/getRuntimeInfo ובאותו ActiveProcessesPanel. (הבעיה היא רק שלא מוזגו — ראה blocker.)

## Verdict

🟡 **USABLE-AFTER-FIX** — ה-brief טכנית-נכון ומדויק להפליא ברמת ה-symbol/API/line (כל ה-spot-checks עברו). הבעיה היחידה המהותית היא **בסיס**: ה-depends_on מוצהר `verified+merged` אך אף אחד מהשלושה (active-agents, remove-idle-reaper, active-processes-layout) לא מוזג ל-dev — לשניים אין אפילו branch. תיקון של מרדכי (~15 דק'): או למזג קודם את ה-deps, או לתקן את §0 כך ש-Base יצביע ל-branch אמיתי המכיל את כולם, ולעדכן את ה-tip ל-22669a5. בנוסף, להבהיר ב-Commit 1 שטסט ה-pipe דורש rewrite של ה-mock (לא patch), ולהוסיף `busy` ל-type ב-http-agents:25.

> אזהרה ל-dispatch: **אל תשגר מול dev/161bd94** — אליעזר יתקע מיד. שגר רק מול בסיס שמכיל active-agents + שני ה-deps.
