---
project: "drive-coding"
slice: "slice-ws-error-survival"
verifier: "avigail"
date: "2026-06-18"
verdict: "READY"
findings:
  - id: 1
    severity: "minor"
    category: "wrong-line-number"
    summary: "brief cites lint-no-hebrew-in-code.sh:9 for the 'Comments are allowed' statement, but line 9 is blank — the statement is on line 6 (.sh) / line 8 (.mjs). Substantive claim is correct, only the line citation is off"
    source_brief: "§0 lint:i18n / §6 risks row 3"
    source_code: "scripts/lint-no-hebrew-in-code.sh:6"
    cost_estimate: "0min"
---

# Plan Verification — slice-ws-error-survival (round 2)

> **Brief**: docs/plans/slice-ws-error-survival.md
> **Base tip**: `3812e4f`
> **Verdict**: ✅ READY
> **סבב**: round 2 — אימות שני התיקונים מהסבב הקודם + רגרסיה חדשה

בסבב הקודם: 🟡 USABLE-AFTER-FIX, 2 findings. שניהם תוקנו. אימתי את התיקונים מול הקוד/הסקריפט — **שניהם נכונים טכנית**. לא נוצרה בעיה חדשה. נותרה אי-דיוק קוסמטי בלבד (ציטוט שורה) שאינו חוסם.

## אימות התיקונים

### ✅ Finding #1 (round 1) — mock WS cast — **תוקן נכון**

הבריף עכשיו אומר במפורש (§4 Commit 0, שורות 152-156):
> "**חובה cast**: `onConnect(mockWs as unknown as import("ws").WebSocket, agentId)` — `ws.WebSocket extends EventEmitter` אז `emit("error")` יפעיל את ה-listener ב-runtime, אבל החתימה העשירה לא מסופקת structurally תחת strict, לכן ה-cast הכרחי."

אימות מול הקוד:
- ✅ `ws-agent.ts:56` — `onConnect(feWs: WebSocket, agentId: string)`; `ws-agent.ts:21` — `import type { WebSocket } from "ws"`. הטיפוס הוא בדיוק `ws.WebSocket`.
- ✅ `@types/ws@8.18.1/index.d.ts:41` — `declare class WebSocket extends EventEmitter` — מאשר ש-`emit("error")` תקף ב-runtime (הירושה אמיתית).
- ✅ אותו קובץ: `binaryType` (51), `bufferedAmount` (52), `ping` (88), `terminate` (102) — חתימה עשירה ש-mock חלקי לא יספק structurally תחת strict → ה-cast באמת הכרחי.
- ✅ הרציונל בבריף מדויק 1:1 לקוד. הניסוח (`emit` עובד / החתימה לא structural) נכון. תיקון מלא.

### ✅ Finding #2 (round 1) — i18n comments — **תוקן נכון (אי-דיוק קוסמטי בציטוט שורה)**

הבריף עכשיו אומר (§0 שורות 39-41, §6 row 3):
> "lint:i18n חוסם עברית בתוך string literals בלבד; הערות בעברית מותרות (`lint-no-hebrew-in-code.sh:9`). הקוד הקיים ב-`ws-agent.ts` מלא הערות עברית — אל תתרגם אותן."

אימות מול הסקריפט:
- ✅ הטענה המהותית נכונה: `lint-no-hebrew-in-code.sh:6` — "literals (single, double, or backtick quotes). **Comments are allowed.**" וב-`.mjs:8` — "Hebrew inside line comments (`//`) and block comments (...) is allowed — those are developer notes." `stripJsdocBlocks` (mjs:69) מאפס הערות לפני סריקת ה-literals → הערות עברית באמת מותרות.
- ✅ `ws-agent.ts:4,8,15,16` — הערות עברית קיימות בקובץ. ההוראה "אל תתרגם" מוצדקת.
- 🟢 **אי-דיוק קוסמטי**: הבריף מצטט `lint-no-hebrew-in-code.sh:9`, אבל שורה 9 ב-`.sh` היא `#` ריקה. המשפט "Comments are allowed" נמצא בשורה **6** של ה-`.sh` (ובשורה 8 של ה-`.mjs`). הטענה נכונה, רק מספר השורה שגוי בשלוש. עלות לאליעזר: אפס — הוא לא יפתח את הסקריפט בגלל הציטוט, וגם אם יפתח יראה את המשפט שתי שורות מעל. לא חוסם.

## רגרסיה חדשה (האם התיקונים שברו משהו) — אין

- ✅ שני התיקונים הם **תיעוד בלבד** ב-§0/§4/§6 — לא נגעו ב-skeleton הקוד, ב-commits, או ב-DoD. אין דרך שיכניסו רגרסיה לוגית.
- ✅ הוספת ה-cast לתיאור הטסט לא סותרת את שאר תבנית הטסט (spawn child אמיתי, emit error, assert exitCode===null). עקבי.
- ✅ הבהרת ה-i18n לא משנה את הוראת §6 row 3 ("string literals באנגלית") — רק מבהירה שהערות פטורות. עקבי עם §5 DoD #2 (`pnpm lint:i18n` נקי).
- ✅ ה-claims העובדתיים מסבב 1 (שורות, symbols, paths, `depends_on=[]`) לא נגעו — נשארים אומתים 1:1. לא חזרתי עליהם לפי הוראתך, אך ה-base tip זהה (`3812e4f`) אז הם תקפים.

## Verdict

✅ **READY** — שני ה-findings מסבב 1 תוקנו נכון ומאומתים מול הקוד. לא נוצרה בעיה חדשה. ה-finding היחיד שנותר הוא ציטוט-שורה קוסמטי (sh:9 במקום sh:6) בעלות אפס — לא חוסם dispatch. העבר לאליעזר.
