---
project: "drive-coding"
slice: "slice-P1b-acp-adapter"
verifier: "avigail"
date: "2026-06-13"
verdict: "USABLE-AFTER-FIX"
round: 2
findings:
  - id: 1
    severity: "confusion"
    category: "dropped-branch"
    summary: "plan variant (14 occurrences in fixtures) not handled in mapAcpNotification switch nor DoD #2; canonical plan.update event exists in events.ts:58"
    source_brief: "§3 switch / §5 DoD #2"
    source_code: "packages/frontend/static/fixtures/salary-attendance.json (plan entries); .worktrees/slice-P1a-provider-abstraction/packages/core/src/provider/events.ts:58"
    cost_estimate: "5-10min"
  - id: 2
    severity: "type-error"
    category: "type-error"
    summary: "usage_update real shape is {used,size,cost} not {inputTokens,outputTokens}; §3 destructured type for u omits these fields so mapUsage(u) cannot read them without widening"
    source_brief: "§3 mapAcpNotification (u type annotation) + mapUsage(u)"
    source_code: "packages/frontend/static/fixtures/greeting.json (usage_update); .worktrees/.../provider/events.ts:24 Usage"
    cost_estimate: "5min"
---

# Plan Verification (Round 2) — slice-P1b-acp-adapter

> **Brief**: docs/plans/slice-P1b-acp-adapter.md
> **Base**: dev HEAD (provider/ not yet present — P1a in worktree only; confirmed blocked-until-merge)
> **Verdict**: 🟡 USABLE-AFTER-FIX
> **אומדן זמן confusion אם לא תוקן**: ~10-15 דק' (אליעזר ישלח `plan` ל-raw בלי הסבר, או mapUsage לא יקמפל)

## אימות תיקוני סבב 1 (7 findings)

| # | finding סבב 1 | מצב | עדות |
|---|---------------|-----|------|
| 1 | fixtures bare `update`, לא SessionNotification | ✅ תוקן ומדויק | §3:82, §4 Commit 1:115, DoD #2 כולם מורים לעטוף `{update: fixture}` ומפנים ל-`#loadMockSession`:929. אימתתי `greeting.json`: מבנה `{loadResult, updates:[{sessionUpdate,...}]}` — ה-entries אכן bare. ב-agent-session:929 העטיפה `{ update } as SessionNotification` אמיתית |
| 2 | Base הניח P1a merged | ✅ תוקן ומדויק | status + Base מציינים "חסום עד merge P1a". אימתתי: `dev/packages/core/src/provider/` **לא קיים**, `dev/index.ts` לא מייצא provider — P1a אכן רק ב-worktree |
| 3 | turn.end דורש isError | ✅ תוקן ומדויק | §3:97 פולט `turn.end{turnId, stopReason, isError}`, DoD #5 כולל isError. events.ts:59 — `{type:"turn.end"; turnId; stopReason; isError: boolean}` (חובה) |
| 4 | capabilities source | ✅ תוקן ומדויק | §3:92-93 + DoD #8: `mapAcpCapabilities(client.capabilities)`. client.ts:42 — `AcpClient.capabilities` = `initialize().agentCapabilities`. ports.ts:70 — `AcpCapabilities = {readonly loadSession: boolean}` בלבד. ההבחנה נכונה |
| 5 | variants חסרים (usage/commands) | 🟡 חלקי | `usage_update→usage`, `available_commands_update→raw` מכוסים (§3, DoD #2, §9 #5). **אבל**: variant `plan` (14 הופעות) חסר לגמרי — ראה finding 1 |
| 6 | verbatimModuleSyntax split imports | ✅ תוקן ומדויק | §4 Commit 0:110. `classifyToolKind` הוא value-function (tool-kind.ts:19), הטיפוסים `import type`. P1a index מייצא `export type * from "./provider/events"` בלבד — classifyToolKind אכן לא מיוצא עדיין |
| 7 | mapStatus undefined→pending | ✅ תוקן ומדויק | §3:70 + DoD #3. events.ts:46 status הוא union required → ACP status אופציונלי → default נדרש |

## בעיות חדשות שנמצאו

### 🟡 Confusion / Type-error

| # | בעיה | מקור | הצעה |
|---|------|------|------|
| 1 | **variant `plan` לא ממופה ולא מתועד**. ה-fixtures מכילים 14 הופעות של `{sessionUpdate:"plan", entries:[{priority,status,content}]}` (salary-attendance, salary-prev, mitm). ה-switch ב-§3 שולח אותו ל-`default → raw` בשתיקה. אבל ב-events.ts:58 **קיים** מושג קנוני `plan.update{entries: PlanEntry[]}`. ה-brief לא מחליט map→`plan.update` ולא מתעד החלטת `raw` (כפי שכן עשה ל-`available_commands_update`). DoD #2 לא מזכיר `plan` כלל | brief §3 switch (:65-79), §5 DoD #2 (:130) / fixtures + events.ts:58 (PlanEntry), tool-kind worktree | מרדכי תחליט: או map ל-`plan.update` (יש קנוני!) או הוסף `case "plan": → raw` מפורש + שורה ב-§9. עדכן DoD #2 בהתאם. ⚠️ שים לב: shape של fixture הוא `{priority,status,content}`, PlanEntry הוא `{id?,title?,status?}` — יידרש מיפוי content→title |
| 2 | **`usage_update` shape mismatch**. fixture אמיתי: `{used:41459, size:200000, cost:{amount,currency}}` — **לא** `{inputTokens,outputTokens}`. הטיפוס המקומי של `u` ב-§3 (השורות 62-64) מונה רק `content/messageId/toolCallId/title/kind/rawInput/rawOutput/status/locations` — **אין** `used/size/cost`. לכן `mapUsage(u)` לא יוכל לקרוא אותם בלי להרחיב את הטיפוס → או typecheck fail או usage ריק | brief §3 (:62-64 type, :75 mapUsage) / fixtures greeting.json, events.ts:24 Usage | הרחב את טיפוס `u` עם `used?/size?/cost?` (או `[k:string]:unknown`), ו-`mapUsage` ימפה `used→inputTokens`? (לא ברור semantics — `used` הוא total). §9 #5 כבר מבקש "אמת shape" — זה הממצא. החלטה של מרדכי |

## Spot-check שעבר (לא מצא בעיה)

- ✅ `AcpClient.capabilities` = agentCapabilities — `client.ts:42`
- ✅ `ports.AcpCapabilities` = `{loadSession}` בלבד — `ports.ts:70`
- ✅ `turn.end` דורש `isError: boolean` — `events.ts:59`
- ✅ `classifyToolKind` הוא value-function, קיים — `tool-kind.ts:19`; לא מיוצא מ-index (P1a index:4 = `export type *` בלבד)
- ✅ fixtures = bare update objects — `greeting.json` updates[]
- ✅ `#loadMockSession` עוטף `{ update }` — `agent-session.svelte.ts:929`
- ✅ `#onSessionUpdate` — `agent-session.svelte.ts:947`
- ✅ `client.prompt` await-blocking — `agent-session.svelte.ts:493`
- ✅ `requestPermission` auto allow_once — `client-impl.ts:~21`
- ✅ `transport-mock.ts` קיים
- ✅ depends_on=[P1a] נכון; provider/ לא קיים ב-dev (אכן blocked)
- ✅ scope core-only עקבי; DoD verifiable; §3↔DoD↔§9 פנימית עקביים (פרט ל-`plan`)
- ✅ `available_commands_update`+`user_message_chunk`+unknown→raw — עקבי בין §3, DoD #2, §9
- ✅ הערה: `#onSessionUpdate` (ה"מקור-אמת" של ה-brief) בעצמו **לא** מטפל ב-plan/usage_update/available_commands (זורק ב-`if(!text)return`:978) — מכאן שהגדרת ה-mapping של P1b מרחיבה מעבר למקור-אמת, מה שמדגיש את הצורך בהחלטה מפורשת על `plan`

## Verdict

🟡 **USABLE-AFTER-FIX** — 6/7 מתיקוני סבב 1 מאומתים ומדויקים. שני ממצאים חדשים, שניהם לא-מבניים:
- finding 1 (`plan`): nitpick-גבולי, אבל כיוון שיש מושג קנוני `plan.update` ו-14 הופעות אמיתיות ב-fixtures, זו החלטת-מיפוי שצריכה להיות מפורשת ב-brief (לא להשאיר ל-`default` אקראי). ~5-10 דק' של מרדכי.
- finding 2 (`usage_update` shape): type-level — אליעזר ייתקע ב-mapUsage typecheck. §9 #5 כבר סימן לאמת — זה הפתרון. ~5 דק'.

אין blocker. שני התיקונים יחד ~15 דק' של מרדכי → ואז READY.
