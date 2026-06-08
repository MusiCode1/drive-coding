---
project: "voice-acp"
slice: "slice-fix-turnstate-stuck"
verifier: "avigail"
date: "2026-06-03"
verdict: "READY"
findings:
  - id: 1
    severity: "confusion"
    category: "wrong-path"
    summary: "§3 diagram + §0 list a 'tests/' / 'packages/frontend/tests/' dir that does NOT exist; real convention is co-located *.test.svelte.ts beside the VM"
    source_brief: "§3 line 119-120, §0 reading-list"
    source_code: "packages/frontend/src/lib/view-models/ (settings.test.svelte.ts, wake-word.test.svelte.ts)"
    cost_estimate: "0-5min"
  - id: 2
    severity: "minor"
    category: "outdated-risk"
    summary: "§6 'safe cue' rationale is incomplete — it only covers #setTurnState's own idle->waiting cue, but ignores Speaker.#handleStatusTransition justFinished (responding->idle) path. Real safety comes from replay emptying buffers, not from the rationale given."
    source_brief: "§6 risk row 1 line 280"
    source_code: "speaker.svelte.ts:283-289 (#handleStatusTransition justFinished)"
    cost_estimate: "n/a (no fix needed, the fix is still safe)"
  - id: 3
    severity: "minor"
    category: "naming-inconsistency"
    summary: "fixture wrapper shape: brief's #loadMockSession reads data.updates and wraps each as {update}, but the fixture objects are ALREADY bare update-shape (sessionUpdate at top level, no nested 'update'). This is existing code, not changed by the fix — but the Commit-3 test note 'inject agent_message_chunk via #onSessionUpdate' must pass {update:{sessionUpdate...}} not the bare shape."
    source_brief: "§4 Commit 3 line 226"
    source_code: "agent-session.svelte.ts:597-599 + static/fixtures/greeting.json"
    cost_estimate: "n/a (test-authoring hint)"
---

# Plan Verification — slice-fix-turnstate-stuck

> **Brief**: docs/plans/slice-fix-turnstate-stuck.md
> **Base tip**: 01e85ce (worktree slice-model-status-control-replay, NOT merged to dev)
> **Verdict**: ✅ READY
> **אומדן זמן אליעזר confusion אם לא תוקן**: ~3 דק' (רק finding #1, ושאר ה-brief מבהיר אותו בעצמו ב-§4/§9)

## הקשר

‏זהו fix-up על branch קיים (`slice-model-status-control-replay`), לא worktree חדש, לא base=dev.
‏dev אומת — **0** הופעות של `turnState` (טענת ה-brief "dev אין בו turnState כלל" — מדויקת).
‏ה-brief נאמן באופן יוצא-דופן גם ל-`decisions/voice-acp.md` (entry 2026-06-03) וגם לדוח calev.

## בעיות שנמצאו

### 🔴 Blocker / Regression risk

‏**אין.** כל ה-API, מספרי השורות, וזרימת ה-flow אומתו מול הקוד בפועל ב-tip 01e85ce.

### 🟡 Confusion / Minor

| # | בעיה | מקור | הצעה |
|---|------|------|------|
| 1 | §3 diagram (שורות 119-120) + §0 reading-list מציינים `tests/agent-session.*.test.ts` / `packages/frontend/tests/` — **הספרייה לא קיימת**. הקונבנציה האמיתית: קבצי `*.test.svelte.ts` **לצד** ה-VM (`settings.test.svelte.ts`, `wake-word.test.svelte.ts`). | brief §3 / §0 | ה-brief עצמו מתקן ב-§4 Commit 3 (שורה 221-222) וב-§9 Q2: "עקוב אחרי הקונבנציה הקיימת (settings.test.svelte.ts ליד הקובץ)". לכן זו אי-עקביות פנימית קלה, לא חוסם. כדאי שמרדכי תיישר את §3 diagram. |
| 2 | §6 שורה 280 — רציונל ה"cue בטוח" חלקי. הוא מכסה רק את ה-cue של `#setTurnState` עצמו (idle→waiting), אבל **מתעלם** מה-`justFinished` של ה-Speaker: `responding→idle` (`speaker.svelte.ts:285-286`) הוא transition שה-fix **כן יוצר**. | brief §6 / `speaker.svelte.ts:283-289` | הבטיחות אמיתית אבל מסיבה אחרת: בזמן replay `#processBubbles` מסמן את כל הבועות כמעובדות עם `buffer=""` (שורות 225-226), ולכן ה-`justFinished` flush מוצא buffers ריקים → אין enqueue → אין audio → אין speaking-cue (ה-cue נורה רק מ-`Player onPlaybackStart`, שורה 131). מומלץ שמרדכי תוסיף משפט ל-§6 שמכסה את ה-path הזה — אבל **אין צורך בתיקון קוד**, ה-fix בטוח. |
| 3 | §4 Commit 3 (שורה 226) — "מזריק agent_message_chunk דרך #onSessionUpdate". ה-fixture עצמו (`greeting.json`) ב-shape **bare** (`sessionUpdate` ב-top level, ללא `update` מקונן), ו-`#loadMockSession` עוטף ל-`{update}` בשורה 599. טסט שמזריק ישירות ל-`#onSessionUpdate` חייב להעביר `{update:{sessionUpdate:"agent_message_chunk", content:{type:"text",text:"…"}}}` — לא את ה-bare shape. | brief §4 Commit 3 | רמז לכתיבת-טסט; לא חוסם. ה-Commit-3 הוא integration-test חדש ממילא. |

### 🟢 (אין minor נוספים)

## Spot-check שעבר (אימות מול הקוד)

**מספרי שורות — כולם מדויקים ב-tip 01e85ce:**
- ✅ `sendPrompt` שורות 200-207: `try { await prompt(); #setTurnState("idle") } catch {...}` — **אין finally היום**. ה-brief מעביר את `#setTurnState("idle")` (שורה 202) ל-finally. flow נכון.
- ✅ `loadSession` finally שורות 264-266: `} finally { this.isLoadingHistory = false }` — מאפס **רק** isLoadingHistory. הוספת `#setTurnState("idle")` שם נכונה.
- ✅ `switchSession` finally שורות 322-324: זהה — רק isLoadingHistory.
- ✅ `#loadMockSession` finally שורות 606-608: זהה — רק isLoadingHistory (ואז `status="connected"` בשורה 609, אחרי ה-finally — אין race).
- ✅ `#setTurnState` שורה 486, private; cue thinking על `idle→waiting` בלבד (שורה 491) — **idempotent** (שורה 488 `if(next===prev)return`). `idle` היעד → לא מנגן.
- ✅ `turnState = $state<TurnState>("idle")` שורה 69 — primitive `$state` (אין array gotcha).
- ✅ `#onSessionUpdate` שורה 617; text guard `if(!text)return` שורה 648; `agent_message_chunk→responding` שורה 653.
- ✅ `model-status.svelte.ts:29` — `turnState==="responding"→"responding"`.
- ✅ `bubble-player.svelte.ts:38` — guard `turnState!=="idle" return`.

**fixture (`greeting.json`) — אומת תוכן:**
- ✅ 5 updates ברצף `user_message_chunk → agent_thought_chunk → agent_message_chunk → available_commands_update → usage_update`.
- ✅ **אין `stopReason` באף update** (טענת ה-brief + decisions — מדויקת).
- ✅ ה-update האחרון שנוגע ב-turnState הוא `agent_message_chunk→responding`. `available_commands_update`+`usage_update` נופלים על `if(!text)return` (אין להם `content.type==="text"`) → לא מאפסים turnState. **NBug3 מאומת מ-fixture, בדיוק כפי שה-brief טוען.**

**שאלות מיוחדות שנשאלו:**
1. ✅ **finally points (264/322/606) מאפסים רק isLoadingHistory?** כן — אומת מילולית. הוספת reset שם נכונה.
2. ✅ **`#setTurnState("idle")` בטוח?** כן — idempotent, ה-cue היחיד שלו (idle→waiting) לא מופעל. (ראה finding #2 על ה-path הנוסף של ה-Speaker — גם הוא בטוח, מסיבת buffers-ריקים.)
3. ✅ **finally ב-sendPrompt (Commit 2) נכון?** כן — היום `idle` בשורה 202 **בתוך ה-try** אחרי `await prompt()`. ה-brief מעביר ל-finally → מתקן את מסלול ה-throw (היום catch קובע error בלי לאפס turnState → בועת-פנטום על מסך-שגיאה). מסלול resolve התקין נשמר. **לא** מתקן Promise תקוע — ה-brief מצהיר על כך מפורשות (שורה 206-207, מכוון).
4. ✅ **סתירה בין brief ל-decisions/calev?** אין. ה-brief תואם לחלוטין: NBug3 ודאי/מאומת-fixture, NBug1 pre-existing/env (calev אימת `git show e2dd686^` מבנה זהה ל-dev), NBug2 נגזרת. רעיונות שנדחו (debounce/timeout/usage_update) זהים. הגנת-scope §2 (אל תוסיף debounce ב-`#onSessionUpdate`) תואמת ל-decisions §"רעיונות שנדחו".
5. ✅ **depends_on=[] נכון?** כן — fix על אותו branch, לא תלוי בסליס אחר. state.json: הסליס-אם `model-status-control-replay` ב-`depends_on:[]`, base על branch עצמו. הסליסים B/C תלויים **בו** (לא להפך). ה-fix-up נכון ב-`depends_on:[]`. (אין עדיין entry ל-`slice-fix-turnstate-stuck` ב-state.json — מרדכי תוסיף לפני dispatch; לא חוסם plan-verification.)

**escalation §7 — אומת:**
- ✅ ה-brief צופה את התלות ב-Speaker `#prevTurnState` flow (שורה 294-295: "`#setTurnState('idle')` שובר טסט קיים של speaker cues → עצור"). זה בדיוק ה-path מ-finding #2. ה-brief מודע לסיכון ומטפל בו כ-escalation trigger — נכון.
- ✅ ה-guard של BubblePlayer (שורה 38) נכון; הבעיה ב-turnState, לא ב-guard (§7 שורה 296 — מדויק).

**DoD#5 wire-trace — אומת:**
- ✅ `ws-agent.ts:logWire` קיים (שורה 57), נקרא ב-`dir=in` (שורה 100) ו-`dir=out` (שורה 109), רושם `{dir, type, id}` ב-`debug` ו-`{dir, frame}` ב-`trace`. ה-DoD#5 (חפש `dir=out type=session/prompt id=N` ואז `dir=in id=N`) — בר-ביצוע מול ה-format הקיים.

## Verdict

✅ **READY** — אין blockers. 3 ממצאים minor/confusion בלבד, ושניים מהם ה-brief מתקן בעצמו במקום אחר.
‏ה-brief מדויק להפליא: כל מספר-שורה אומת מילולית, ה-fixture אומת בקריאת-תוכן, וה-flow של שלושת ה-commits נכון. ה-fix אדיטיבי, לא משנה state shape, לא נוגע ב-API ציבורי.

**המלצה למרדכי לפני dispatch (אופציונלי, ~3 דק'):**
1. יישר את §3 diagram מ-`tests/` ל-co-located `*.test.svelte.ts` (finding #1).
2. הוסף משפט ל-§6 שמכסה את ה-`responding→idle` path של ה-Speaker (finding #2) — להרגעה, לא לתיקון.
