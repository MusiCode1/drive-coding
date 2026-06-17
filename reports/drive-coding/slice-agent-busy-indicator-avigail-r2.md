---
project: "drive-coding"
slice: "slice-agent-busy-indicator"
verifier: "avigail"
date: "2026-06-16"
verdict: "USABLE-AFTER-FIX"
findings:
  - id: 1
    severity: "type-error"
    category: "dropped-branch"
    summary: "Commit 3 changes http-agents deps type to require busy:boolean but does not update the test mock http-agents.test.ts:408 which returns only {pid,attached} — typecheck will fail"
    source_brief: "§4 Commit 3"
    source_code: "packages/backend/tests/http-agents.test.ts:408"
    cost_estimate: "10-20min"
  - id: 2
    severity: "blocker"
    category: "missing-dependency"
    summary: "depends_on slice-remove-idle-reaper declared verified+merged but the idle-reaper (slice-26 TEMPORARY block) is still fully present in dev — no remove branch/commit exists"
    source_brief: "§0 depends_on + blocker note"
    source_code: "packages/backend/src/acp/bridge-manager.ts:20-26,210-242 ; packages/backend/src/acp/reap-idle.ts"
    cost_estimate: "0min code / planner-decision"
  - id: 3
    severity: "confusion"
    category: "wrong-line-number"
    summary: "Commit 1 says update all 6 it() in ws-agent-pipe.test.ts but there are 7 it() blocks"
    source_brief: "§4 Commit 1"
    source_code: "packages/backend/tests/ws-agent-pipe.test.ts"
    cost_estimate: "2min"
  - id: 4
    severity: "outdated"
    category: "outdated-risk"
    summary: "§0 still claims symbols live in integration-active-agents / not in clean dev — stale round-1 wording; everything verified present in dev b2c2349"
    source_brief: "§0 Pre-flight note 1"
    source_code: "n/a"
    cost_estimate: "1min"
---

# Plan Verification — slice-agent-busy-indicator (סבב 2)

> **Brief**: docs/plans/slice-agent-busy-indicator.md
> **Base tip**: dev = b2c2349 (merge integration-active-agents → dev)
> **Verdict**: 🟡 USABLE-AFTER-FIX
> **אומדן זמן confusion אם לא תוקן**: ~15-25 דק' (typecheck fail ב-Commit 3 + בלבול depends_on)

כל הסמלים המרכזיים אומתו נוכחים ב-dev. ה-brief מדויק טכנית ברובו המכריע. נמצאו: type-error אחד ממשי (mock לא מעודכן), אי-עקביות depends_on מול המציאות (reaper לא הוסר), וגרר ניסוח ישן מסבב 1.

## בעיות שנמצאו

### 🔴 Blocker / Regression risk

| # | בעיה | מקור (brief / קוד) | עלות אם לא תוקן |
|---|------|---------------------|------------------|
| 2 | `depends_on: [slice-remove-idle-reaper, slice-active-processes-layout]` מוצהר "verified+merged לפני dispatch" ו-§0 טוען "אחרי שה-reaper הוסר ה-Entry נקי". **בפועל ב-dev ה-reaper שלם**: אין branch `slice-remove-idle-reaper`, אין commit שמסיר אותו, וה-`TEMPORARY (slice 26)` block כולל `reap-idle.ts`, `listIdle`, `markAttached/markDetached`, `bridge-manager.idle.test.ts` — הכל קיים. גם `slice-active-processes-layout` כ-branch לא קיים (יש commits של layout/VM אבל לא slice ייעודי). | brief §0 depends_on + הערת 🔴 blocker / `packages/backend/src/acp/bridge-manager.ts:20-26,210-242`, `reap-idle.ts` | החלטת-planner. **בפועל לא חוסם קוד**: הרפקטור מוסיף שדות חדשים ל-`Entry` (`lineSubscribers`, `tracker`) לצד שדות ה-reaper — אין התנגשות מבנית. אבל ההצהרה כוזבת ומרדכי חייבת ליישב: או לתקן את `depends_on` (השדות הללו לא באמת merged) או לעדכן את §0. |

> הערה לאליעזר: ה-"Entry הנקי" הוא הנחה קוסמטית — ה-Commit 1/3 מוסיפים שדות לצד שדות ה-reaper הקיימים. אין צורך להסיר את ה-reaper כדי לבצע את ה-slice. עם זאת ה-merge-gate ב-§0 ("אל תתחיל אם dev לא כולל אותם") עלול לגרום לאליעזר לעצור שלא לצורך — לכן blocker-לתיאום, לא blocker-טכני.

### 🟡 Confusion / Type error

| # | בעיה | מקור | הצעה |
|---|------|------|------|
| 1 | **Type-error ממשי**: Commit 3 מעדכן את ה-deps type ב-http-agents מ-`{pid,attached}` ל-`{pid,attached,busy:boolean}`, אבל ה-mock בטסט `getRuntimeInfo: vi.fn(() => ({ pid: 12345, attached: true }))` **לא מוזכר**. אחרי שינוי ה-type → `Property 'busy' is missing` → `pnpm typecheck` נכשל. | brief §4 Commit 3 (מזכיר רק את deps type, לא את ה-mock) / `packages/backend/tests/http-agents.test.ts:408` | מרדכי: הוסף ל-Commit 3 "עדכן גם את ה-mock ב-http-agents.test.ts:408 ל-`{pid,attached,busy:false}`". (assertions בטסט הזה בודקות שדה-בשדה, לא strict-equal, אז busy לא ישבור אותן בריצה — רק ה-type.) |
| 3 | Commit 1 כותב "עדכן את כל **6** ה-`it(...)`" — בפועל יש **7** `it()` ב-ws-agent-pipe.test.ts (שורות 66,82,104,128,149,171,189). כולם משתמשים ב-mock `bridgeManager`. | brief §4 Commit 1 / `packages/backend/tests/ws-agent-pipe.test.ts` | תקן ל-7. רק טסט אחד (שורה 128) מזריק בפועל דרך `child.stdout.write` — שאר ה-6 צריכים רק להוסיף `onLine` ל-mock. |

### 🟢 Minor

| # | בעיה | מקור |
|---|------|------|
| 4 | §0 הערה 1 עדיין מנסחת "הסמלים קיימים ב-integration-active-agents / **לא** ב-dev הנקי" — ניסוח ישן מסבב 1. הכל אומת נוכח ב-dev b2c2349. (הוזהרתי על כך ב-prompt; מציין לתיעוד בלבד.) | brief §0 Pre-flight |

## Spot-check שעבר (לא מצא בעיה)

- ✅ `WireSummary` ב-`wire-decode.ts` — כל השדות נוכחים: `method?`, `sessionUpdate?` (מ-`params.update.sessionUpdate`), `id?`, `responseKind?:"result"|"error"`, `unparsed`, `parsed?`. **pure** (רק `JSON.parse`, אפס IO). ✓ Check 1.
- ✅ `decodeWireLine` מסמן `responseKind="result"` ל-**כל** `result` in o (גם session/new וכו'), לא רק turn-end — מאשר את הנמקת ה-brief ש-`result` לא אמין כ-turn-end (§4 Commit 2 + Risk). ✓ Check 4(ג).
- ✅ ws-agent.ts: `createInterface({input:child.stdout})` ב-connect (שורה 92), `rl.on("line")` (93), סדר `feWs.send` (96) → ואז `logWire` (100), `rl.close()` ב-`feWs.on("close")` (141), `child.stdin.write` נפרד ב-`feWs.on("message")` (118). ✓ Check 2.
- ✅ bridge-manager.ts: stderr listener קבוע ב-`spawnInternal` (`child.stderr.on("data")` שורה 123 — הערה: זה `.on("data")` גולמי, **לא** `createInterface`; ה-brief מתאר אותו כ"תבנית" בלבד, לא טוען שהוא readline). `getRuntimeInfo` מחזיר כרגע `{pid,attached}` (245-249). ✓ Check 3.
- ✅ ws-agent-pipe.test.ts mock = `{getChild,markAttached,markDetached}` (שורות 68,85,107,134,152,174,192) וההזרקה דרך `child.stdout.write` (143). הרפקטור אכן ישבור את הטסט אם לא יעודכן — תיאור ה-brief מדויק. ✓ Check 4(א).
- ✅ http-agents deps type = `{ getRuntimeInfo(id): { pid:number; attached:boolean } | null }` (שורה 25) — בדיוק כפי שה-brief מצטט ב-Commit 3. ✓ Check 4(ב).
- ✅ הפרדה FE/BE: אין `import` מ-`agent-session` ב-`packages/backend/src/`. `turn-tracker.ts` עדיין לא קיים (יוצר ב-Commit 2) ו-ה-skeleton מייבא **רק** `import type { WireSummary }` מ-wire-decode. ✓ Check 5.
- ✅ Backpressure: ב-`spawnInternal` אין reader קבוע על `child.stdout` (רק stderr). כיום ה-stdout נקרא רק ב-ws-agent כש-feWs מחובר. הנחת ה-brief נכונה. ✓ Check 6.
- ✅ Packages + i18n: `connect.agents.*` קיים ב-he.ts(163-171)/en.ts(168-176)/keys.ts(174-182). `connect.agents.working` עדיין לא קיים (יוצר ב-Commit 4) — ה-namespace תקין. ✓ Check 7.
- ✅ AgentPublic schema (agent.ts): `pid?`, `attached?` נוכחים (97-98); אין `busy?` עדיין (יוצר Commit 3). `toAgentPublic` לא מאכלס pid/attached — runtime enrichment ב-http handler. תואם ל-brief ("אל תוסיף ל-toAgentPublic"). agent-schema.test.ts משתמש ב-`toEqual` על toAgentPublic — לא יישבר כי busy לא נכנס ל-toAgentPublic.
- ✅ `verbatimModuleSyntax:true` + `noUncheckedIndexedAccess:true` (tsconfig.base.json) — ה-skeleton של Commit 2/3 כבר משתמש ב-`import type` נכון. אין סיכון type-error מהם.
- ✅ ActiveProcessesPanel.svelte קיים עם `statusColor`, `{#each ... (agent.id)}` keyed loop, `status-dot`, `agent-info` row — נקודת שילוב ברורה ל-Commit 4. `statusColor` ממפה גם ready וגם busy ל-`var(--accent)`; ה-`agent.busy` החדש עצמאי מ-`status`. אין התנגשות.
- ✅ `getRuntimeInfo` callers: `bridge-manager.runtime.test.ts` בודק שדה-בשדה (לא strict-equal) → busy לא ישבור; `http-agents.test.ts:408` הוא ה-mock היחיד ש**כן** יישבר (finding #1).

## Verdict

🟡 **USABLE-AFTER-FIX** — אין בעיה מבנית בקוד; ה-slice בר-ביצוע מול dev הנוכחי. נדרשים 2 תיקונים קצרים של מרדכי לפני dispatch:
1. **(type-error, חובה)** הוסף ל-Commit 3 עדכון ה-mock ב-`http-agents.test.ts:408` ל-`busy:false` — אחרת `pnpm typecheck` נכשל.
2. **(depends_on, חובה-תיאום)** יישב את ה-`depends_on`: ה-reaper לא הוסר ו-slice-remove-idle-reaper/slice-active-processes-layout לא merged כ-branches. או תקן את הרשימה או הסר את ה-merge-gate הקוסמטי כדי שאליעזר לא יעצור שלא לצורך (טכנית הרפקטור מוסיף שדות לצד ה-reaper — אין צורך בהסרתו).
3. (minor) תקן "6 it" → "7 it" ב-Commit 1; נקה ניסוח ישן ב-§0.
