---
slice: slice-agent-busy-indicator
verifier: calev-heavy (Opus runtime-verifier)
tier: heavy
complexity: 7
verdict: GO
date: 2026-06-16
branch: slice-agent-busy-indicator
worktree: D:/UserProjects/AI/drive-coding/.worktrees/slice-agent-busy-indicator
commits_verified: 7123c2d..2799b0c (c7463c5...HEAD)
brief: docs/plans/slice-agent-busy-indicator.md
dod_total: 11
dod_pass: 10
dod_partial: 1
dod_fail: 0
findings_count: 0
live_e2e: true
---

# דוח אימות heavy — slice-agent-busy-indicator

## פסק דין: **GO** (עם PARTIAL יחיד על אימות ויזואלי בלבד — מגבלת סביבה, לא פגם קוד)

ה-slice עבר אימות end-to-end **חי** מלא: BE אמיתי (bun) + agent claude אמיתי + WS handshake
מלא + prompt אמיתי. כל ההתנהגות הקריטית (pipe, busy, debounce, headless, backpressure)
אומתה ב-runtime, לא רק ב-code review. לא נמצא אף bug. השער היחיד שלא נסגר חי הוא הרינדור
הויזואלי של הפאנל (#9) — אין browser/playwright בסביבה — אך השדה `busy` שמזין אותו אומת
חי ב-JSON וה-template/CSS נסקרו. זה PARTIAL סביבתי, לא NO-GO.

---

## טבלת DoD (§5, 11 פריטים)

| # | בדיקה | סטטוס | ראיה |
|---|---|---|---|
| 1 | כל ה-tests ירוקים (core+backend+frontend) | ✅ GO | 674 passed, 14 skipped; הכשל היחיד `lint-no-hebrew-in-code.test.mjs` = pre-existing סביבתי (Windows SyntaxError, ב-scripts/, לא ב-slice) |
| 2 | typecheck + lint:i18n + lint:rtl | ✅ GO | `tsc --build` exit 0; lint:rtl "No physical direction"; lint:i18n "No hardcoded Hebrew" |
| 3 | turn-tracker unit (6 תרחישים) | ✅ GO | 6/6 ירוקים (src + dist) |
| 4 | pipe ל-FE ביט-אין-ביט (regression) | ✅ GO | חי: handshake מלא + 24 frames זרמו ל-FE ללא אובדן; reconnect (connect→disconnect→connect) נקי בלוג |
| 5 | אין עיכוב/אובדן frames ביציאה | ✅ GO | חי: 21 sessionUpdates + result זרמו במלואם; אפס שגיאות decode בלוג; ws-agent-pipe 7/7 |
| 6 | GET /api/agents מחזיר busy:true בזמן turn | ✅ GO | חי: `busy:true` נצפה במהלך session/new + session/prompt |
| 7 | busy חוזר ל-false בסיום turn | ✅ GO | חי: `busy:false` ~1.6s אחרי `stopReason:end_turn` (debounce 1500ms) |
| 8 | busy עובד **בלי** טאב מחובר | ✅ GO | חי: סגרתי WS באמצע turn → `attached:false busy:true` ב-3 polls רצופים; חזר ל-false בסיום |
| 9 | הפאנל מציג אינדיקטור busy/idle | 🟡 PARTIAL | code-verified (template+CSS+i18n); **לא** visual — אין browser/playwright בסביבה |
| 10 | אין תלות FE↔BE client | ✅ GO | grep: turn-tracker מייבא **רק** `type WireSummary` מ-wire-decode; אפס import מ-agent-session |
| 11 | backpressure: טאב נסגר → CLI לא נתקע | ✅ GO | חי: אחרי סגירת WS באמצע turn, ה-turn הושלם, child שרד שני מחזורי טאב (pid 16120 קבוע) |

---

## ראיות runtime (live e2e)

הרמתי BE מה-worktree (`PORT=4055 bun src/server.ts`), יצרתי agent claude אמיתי
(`POST /api/agents`), ופתחתי WS ל-`/ws/agent/:id` עם handshake ACP מלא (initialize →
session/new → session/prompt) דרך client bun+ws.

### Flow 1 — busy חי + debounce (DoD #4-7)
```
BEFORE prompt busy: {"status":"starting","busy":true,"attached":true}
poll #0: busy=TRUE (frames=3, updates=1)
session/prompt DONE: {"stopReason":"end_turn",...} (frames=24, updates=21)
idle-poll #3: busy=FALSE (back to idle after debounce)
SUMMARY frames: 24 sessionUpdates: 21 sawBusyTrue: true backToIdle: true
```
24 frames + 21 sessionUpdates זרמו ל-FE דרך ה-pipe החדש (onLine→feWs.send) ללא אובדן.
busy נדלק בזמן ה-turn וכבה ~1.6s אחרי סיומו.

### Flow 2 — headless busy + backpressure (DoD #8, #11) — הקריטי
```
busy=TRUE detected (attached=true) → CLOSING WS NOW (tab closes mid-turn)
WS closed (tab gone)
poll #0: attached=FALSE busy=TRUE  ← BE tracks busy with NO tab
poll #1: attached=FALSE busy=TRUE
poll #2: attached=FALSE busy=TRUE
poll #3: attached=false busy=false (back to idle, detached) — debounce works headless
DoD#8 sawBusyWhileDetached: true | attachedWentFalse: true
```
זו ההוכחה הישירה לעיקרון המרכזי של ה-slice: ה-reader הקבוע ב-bridge-manager ממשיך לצרוך
את stdout ולהזין את ה-tracker **גם ללא subscriber/טאב**. ה-child לא נתקע (backpressure פתור).

### לוג ה-BE — נקי
אפס error/uncaught/decode-failure לאורך שני ה-flows. מחזור
`WS connect → pipe attached` / `WS disconnect — detaching pipe` × 2 נקי; אותו child pid
שרד את שני המחזורים (NO kill on disconnect — נשמר).

---

## בדיקת הסטיות שאליעזר תיעד (edge / patterns)

### 1. PassThrough mock upgrade — תקין, לא מסתיר רגרסיה ✅
שלושה קבצי טסט (`bridge-manager.test.ts`, `bridge-failure-modes.test.ts`,
`ws-agent-pipe.test.ts`) שודרגו מ-`stdout = EventEmitter+setEncoding(vi.fn)` ל-`PassThrough`
אמיתי. הסיבה נכונה: ה-reader הקבוע החדש משתמש ב-`createInterface({input: child.stdout})`
שדורש stream אמיתי עם `resume()/pause()`. EventEmitter עירום לא היה זורם ל-readline.
**זה לא מסווה רגרסיה** — להפך, ה-PassThrough הוא stream נאמן יותר. ראיה: `bridge-failure-modes`
(שתועד כ-pre-existing ENOENT-timeout flaky) **עבר** הפעם 8/8, וה-ENOENT-synchronous עבר.

### 2. סדר feWs.send לפני decode — מאומת בקוד ובריצה ✅
- bridge-manager `stdoutRl.on("line")`: (1) לולאת `lineSubscribers` (→ feWs.send) **קודם**,
  (2) `tracker.observe(decodeWireLine(line), Date.now())` **אחרי**, מבודד ב-`try{}catch{}`.
- ws-agent subscriber: `feWs.send(\`${line}\n\`)` ואז `logWire("in", line)` (גם הוא בתוך try).
- ריצה חיה: 24 frames הגיעו ל-FE שלמים בזמן שה-tracker עודכן במקביל — אפס עיכוב/שבירה.

### 3. הפרדה FE/BE (DoD #10, עיקרון-על) — נקי ✅
`turn-tracker.ts` שורה 18: `import type { WireSummary } from "../delivery/wire-decode.js"` —
זה ה-import היחיד, והוא `type`-only. אפס תלות ב-`agent-session.svelte.ts` או כל קוד FE.

### 4. backpressure — reader קבוע גם בלי feWs ✅
`spawnInternal` יוצר `createInterface` קבוע ב-spawn, ללא תלות ב-WS. ה-`lineSubscribers`
ריק כשאין טאב, אבל ה-reader עדיין צורך את stdout (`for cb of entry.lineSubscribers` על Set
ריק = no-op, השורה כבר נקראה). אומת חי ב-Flow 2.

---

## הערות (לא חוסמות)

1. **`status` ב-registry נשאר `starting` כל זמן ה-flow החי** — מצופה וב-scope. ה-slice לא נוגע
   ב-`status` (ה-FE מקדם ל-`ready` דרך `/session-attached`; ה-probe שלי לא קרא לזה). `busy` הוא
   enrichment נפרד לחלוטין מ-`status`, בדיוק כמתוכנן (§4 Commit 3: "אל תוסיף ל-Agent/toAgentPublic").
2. **DoD #9 visual** — לא נבדק חי (אין browser בסביבה). מומלץ אימות ויזואלי קצר ב-staging/desktop
   לפני merge ל-dev אם רוצים סגירה מלאה של #9. הסיכון נמוך: ה-template פשוט (`{#if agent.busy}`
   → busy-indicator פועם + תווית), וה-prop `busy` אומת חי בכל הנתיב עד ה-JSON.

---

## סיווג patterns
לא נמצא bug חדש. הקטגוריות שנבדקו במפורש (heavy): stream-ownership/pipe regression,
cross-store data flow (busy→getRuntimeInfo→schema→JSON→FE), state-machine (debounce idle),
spec-drift (status לא שונה — נכון), reconnect (subscription מתחדש), backpressure headless,
hardcoded nulls (אין), i18n (key קיים he+en+keys), RTL (lint נקי). כולן עברו.
