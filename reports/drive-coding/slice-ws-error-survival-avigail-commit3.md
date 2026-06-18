---
project: "drive-coding"
slice: "slice-ws-error-survival"
verifier: "avigail"
date: "2026-06-18"
verdict: "READY"
scope: "Commit 3 only (§10 + §11) — Commit 0-2 already verified READY"
findings:
  - id: 1
    severity: "minor"
    category: "naming-inconsistency"
    summary: "Commit 0 skeleton logs 'WS error — detaching pipe' with payload {err}, but §10 specifies the SAME detach('error') log as 'WS error — detaching (survived)' with payload {err:{code,message}} — two different message strings + shapes for one log line. אליעזר may emit both or pick arbitrarily"
    source_brief: "§4 Commit 0 line 132 vs §10 line 288-289"
    source_code: "packages/backend/src/delivery/ws-agent.ts:144"
    cost_estimate: "2-5min"
  - id: 2
    severity: "minor"
    category: "outdated-risk"
    summary: "§10 promises detach('error') logs the extracted code from ErrnoException, but feWs 'error' carries a plain Error (ws lib) whose .code is usually undefined — the code field will frequently be empty. Not wrong, just over-promises 'WS error (ECONNRESET)' trace; the real code surfaces in uncaughtException/wss-error paths, not necessarily in detach"
    source_brief: "§10 line 288-289, §11 line 341"
    source_code: "packages/backend/src/delivery/ws-agent.ts:144"
    cost_estimate: "0min"
---

# Plan Verification — slice-ws-error-survival (Commit 3 — §10 + §11)

> **Brief**: docs/plans/slice-ws-error-survival.md
> **Base tip**: `3812e4f`
> **Verdict**: ✅ READY
> **Scope**: רק התוספת — §10 (Commit 3 observability) + §11 (appendix ניסוי). Commit 0-2 כבר אומתו READY (round 2), לא נבדקו שוב.

התוספת **מדויקת טכנית**. כל 5 ה-claims העובדתיים של §10 אומתו 1:1 מול הקוד ב-dev tip `3812e4f`. התלויות על Commit 0 (`detach`) ו-Commit 2 (`isTransientSocketError`) נכונות — שניהם עדיין לא קיימים בקוד, כצפוי. ה-scope ("התיקון בולע / הלוג מתעד") מובחן נכון. §11 לא מכיל טענות שגויות על הקוד. שני ה-findings היחידים הם cosmetic/over-promise בעלות ~0-5 דק'.

## אימות 5 ה-claims של §10

### ✅ Claim 1 — `LOG_WIRE=ws` ממפה ל-`backend.ws.wire.*` בלבד, ו-`ns==="*"` מוחלף

`packages/core/src/log/config.ts` שורות 108-116 — אומת מדויק:
- שורה 110: `ws: "backend.ws.wire.*"` — מיפוי בלבד ל-namespace הזה. ✓
- שורה 115: `config.ns = config.ns === "*" ? addNs : \`${config.ns},${addNs}\`` — כש-`ns==="*"` הוא **מוחלף** (לא ממוזג); אחרת ממוזג ב-CSV. ✓ זו בדיוק ההצדקה ל-observability gap. מספרי השורות והלוגיקה **נכונים**.

### ✅ Claim 2 — המסנן `backend.ws.wire.*` מחריג `backend.process` ו-`backend.ws.agent`

`packages/core/src/log/namespace.ts` `matchSingle` שורות 41-50 — אומת בידנית:
- `matchSingle("backend.process", "backend.ws.wire.*")` → prefix=`backend.ws.wire`; `"backend.process"` לא `===` ולא `startsWith("backend.ws.wire.")` → **false** (מוחרג). ✓
- `matchSingle("backend.ws.agent", "backend.ws.wire.*")` → `"backend.ws.agent"` לא מתחיל ב-`backend.ws.wire.` → **false** (מוחרג). ✓
- ה-namespaces בפועל: `server.ts:10` → `backend.process`; `ws-agent.ts:26` → `backend.ws.agent`; `ws-agent.ts:27` → `backend.ws.wire`. רק האחרון נכלל תחת `LOG_WIRE=ws`. **האבחנה של §10 מאוששת מהקוד.**

### ✅ Claim 3 — `detach("error", err)` מ-Commit 0; כיום יש `feWs.on("close")` ~144 ללא `feWs.on("error")`

`packages/backend/src/delivery/ws-agent.ts`:
- `feWs.on("close")` בשורה **144** (גוף 145-152, ניקוי בלי `child.kill`). ✓ (§10/§11 אמרו ~144 — מדויק).
- **אין** `feWs.on("error")` כיום (grep אישר: `detach`/`detached` מופיעים רק בהערה שורה 16, לא כקוד). ✓
- §10 בונה את הלוג בתוך `detach("error", err)` — קונסטרוקט של Commit 0. אין סתירה לוגית. ✓ (להבדל בנוסח הלוג — ראה Finding #1).

### ✅ Claim 4 — `uncaughtException`/`unhandledRejection` קיימים ב-`server.ts:14-25`; `isTransientSocketError` מ-Commit 2 (לא קיים עדיין)

`packages/backend/src/server.ts`:
- `uncaughtException` שורות 14-20, `unhandledRejection` שורות 22-25. ✓ כיום ה-payload כולל `{name,message,stack}` — **אין `code`, אין `transient`** → התוספת של §10 (`code` + `transient:`) אכן additive ולא כפילות. ✓
- `grep "isTransientSocketError" packages/` → **NOT FOUND**, ו-`transient-socket-error.ts` לא קיים. ✓ §10 תלוי ב-Commit 2 שיוצר אותו — **תלות נכונה**. (Commit 2 = phase verify, אז סדר הביצוע מבטיח שהפונקציה קיימת לפני שורת-הלוג של Commit 3.)

### ✅ Claim 5 — `agentWss`/`echoWss` קיימים ב-`server.ts`, ניתן `.on("error")`; Commit 1 כבר מוסיף — §10 רק תוכן-לוג

`packages/backend/src/server.ts`:
- `echoWss = new WebSocketServer({noServer:true})` שורה 98, `agentWss` שורה 99. ✓ כיום רק `.on("connection")` (104,108) — **אין `.on("error")`** → Commit 1 מוסיף. ✓
- §10 שורה 293-294 (`procLog.warn({src,err}, "wss error")`) הוא **תוכן הלוג** בתוך ה-listener ש-Commit 1 יוצר — לא יוצר listener שני. אין כפילות/סתירה. ✓ (להקפדה: §2 מייחס את ה-listeners ל-Commit 1, ו-§10 רק את ה-payload — חלוקת-עבודה עקבית).

## בדיקות נוספות (מהבקשה)

- **Complexity 5/10 (+1 ל-Commit 3)** — **סביר**. Commit 3 הוא additive logging בלבד, ללא טסט יחידה (§10 line 301), אבל פורש על 3 קבצים ושוזר נתונים מ-Commit 0 ו-Commit 2 (code extraction + `transient` tag) → +1 הוגן. לא הייתי מתווכחת על +2 ולא על +0.
- **הבחנת scope תיקון-מול-לוג** — **מובחנת נכון**. §10 line 296-298 ("Commit 0 מונע / Commit 3 מתעד") + §11 line 341 מפרידים מפורשות בין הבליעה (Commit 0) לבין התיעוד (Commit 3). אין בלבול scope.
- **§11 — טענות על הקוד** — אומתו: `ws-agent.ts:144 יש close אין error` ✓; `server.ts:14 process.exit(1) על uncaughtException` ✓ (שורה 19). המסקנה "האבחנה תקפה ולא הופרכה" נתמכת. ה"נפילות" המדווחות (SIGKILL ידני, `Restart=on-failure`) הן על תשתית/systemd חיצוני — **לא טענות על הקוד שבכוחי לאמת**, ומסומנות נכון ב-§11 כ"אינן הבאג". אין מסקנה לא-נתמכת.

## findings

### 🟢 Minor

| # | בעיה | מקור | הצעה |
|---|------|------|------|
| 1 | נוסח-לוג כפול לאותה שורת `detach('error')`: Commit 0 skeleton = `"WS error — detaching pipe"` עם `{err}`; §10 = `"WS error — detaching (survived)"` עם `{err:{code,message}}`. אליעזר עלול לבחור שרירותית | §4 Commit 0 שורה 132 vs §10 שורות 288-289 / `ws-agent.ts:144` | מרדכי תבחר נוסח אחד — §10 הוא המעודכן (כולל code), אז עדיף שהוא יגבר ויעדכן את skeleton של Commit 0 |
| 2 | §10/§11 מבטיחים trace `WS error (ECONNRESET)` מתוך `detach`, אבל `feWs` 'error' מספריית ws נושא לרוב `Error` רגיל ש-`.code` שלו `undefined` — שדה ה-`code` ב-detach יהיה לרוב ריק. ה-`ECONNRESET` האמיתי צף ב-uncaughtException/wss-error, לא בהכרח ב-detach | §10 שורות 288-289, §11 שורה 341 | אופציונלי — אין נזק; הלוג עדיין שימושי כ"התרחיש קרה ונוטרל" גם בלי code |

## Spot-check שעבר (לא מצא בעיה)

- ✅ `config.ts:108-116` — מיפוי `ws` + merge/replace logic — אומת מדויק
- ✅ `namespace.ts:41-50` `matchSingle` — exclusion של `backend.process`/`backend.ws.agent` — אומת בידנית
- ✅ `ws-agent.ts:144` `feWs.on("close")` קיים, `on("error")` לא — אומת
- ✅ `server.ts:14-25` uncaughtException/unhandledRejection קיימים בלי code/transient — אומת
- ✅ `server.ts:98-99` echoWss/agentWss קיימים בלי `.on("error")` — אומת
- ✅ `isTransientSocketError` + `transient-socket-error.ts` — לא קיימים (תלות Commit 2 נכונה)
- ✅ `detach`/`detached` — לא קיימים בקוד (תלות Commit 0 נכונה)
- ✅ `depends_on: []` — נכון; Commit 3 תלוי ב-Commits 0/1/2 **באותו slice**, לא ב-slice חיצוני

## חוסר ל-observability מלא של ה-error→crash path? (מהבקשה)

נספרו ב-§10 כל 3 התחנות ב-diagram §3: (1) `feWs 'error'` → detach-log; (2) `uncaughtException` → code+transient; (3) wss `'error'` → src+err. **path מלא מכוסה.** נקודה אחת לא-נספרת אך לא-חוסמת: `child.stdin 'error'` (EPIPE) — §9 שאלה 1 כבר מודה שאין עליו listener ייעודי ונשען על isTransientSocketError כ-safety net; אם תרחיש EPIPE-בכתיבה יקרה, הוא **לא** יקבל שורת-detach ייעודית, רק ייתפס (אולי) ב-uncaughtException. זה עקבי עם החלטת §9#1 ולא רגרסיה — לכן לא finding, רק הערה.

## Verdict

✅ **READY** (Commit 3) — כל 5 ה-claims של §10 מאומתים 1:1 מול הקוד; התלויות על Commit 0/2 נכונות (שניהם עדיין לא קיימים, כצפוי); ה-scope מובחן נכון; §11 ללא טענות שגויות. שני ה-findings הם cosmetic (נוסח-לוג כפול) ו-over-promise (code לרוב ריק ב-detach) — שניהם בעלות 0-5 דק' ולא חוסמים. עקבי עם Commit 0-2 שאושרו. העבר לאליעזר.
