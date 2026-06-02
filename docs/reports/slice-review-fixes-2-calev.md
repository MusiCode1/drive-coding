---
project: "voice-acp"
slice: "slice-review-fixes-2"
verifier: "calev"
date: "2026-06-02"
mode: "light"
verdict: "GO"
dod_items:
  - "typecheck נקי"
  - "build נקי"
  - "כל הטסטים עוברים"
  - "lint:i18n נקי"
  - "createAgent עוטף withTimeout, signal אופציונלי"
  - "deleteAgent + notifySessionAttached עוטפים withTimeout"
  - "getAgent לא שונה + יש TODO"
  - "listVoices עוטף withTimeout"
  - "tts: response.body מחוץ ל-withTimeout"
  - "narrate מיושר + מחזיר null"
  - "regression: speaker tests ירוקים"
  - "regression: loadVoices tests ירוקים"
  - "regression: createAgent callers — signal additive"
spot_check: "pnpm test 495/507 pass (12 skipped = pre-existing), typecheck 0 errors, build clean, lint:i18n clean"
findings: []
---

# slice-review-fixes-2 — Verification Report (Light)

> **תאריך:** 2026-06-02
> **Tier:** light
> **Commit:** 6ec497e (HEAD) — base 2a551d4 (slice-review-fixes-1)

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 13/13 |
| Happy path עובד | ✅ (unit level — אין BE) |
| Bugs חדשים | 0 |

## DoD items

| # | Item | סטטוס | Evidence |
|---|------|--------|----------|
| 1 | typecheck נקי | ✅ | `pnpm typecheck` — 0 errors |
| 2 | build נקי | ✅ | `pnpm --filter @drive-coding/frontend-v2 build` — ✓ built in 4.23s |
| 3 | כל הטסטים עוברים | ✅ | 495 passed, 12 skipped (pre-existing), 0 failed — 52 test files |
| 4 | lint:i18n נקי | ✅ | `✓ No hardcoded Hebrew in code.` |
| 5 | createAgent עוטף withTimeout, signal אופציונלי | ✅ | agents-api.ts:27-47 — `async function createAgent(input: CreateAgentInput, signal?: AbortSignal)` + `withTimeout(..., 10000, { signal, label: "createAgent" })` |
| 6 | deleteAgent + notifySessionAttached עוטפים withTimeout | ✅ | agents-api.ts:61-85 — שניהם עם `withTimeout(..., AGENTS_API_TIMEOUT_MS, { label: ... })` |
| 7 | getAgent לא שונה + יש TODO | ✅ | agents-api.ts:49-59 — TODO comment בשורה 49-50, body זהה לbase (fetch ישיר, אין withTimeout) |
| 8 | listVoices עוטף withTimeout | ✅ | voices.ts:33-46 — `withTimeout(..., VOICES_TIMEOUT_MS=8000, { signal, label: "listVoices" })` |
| 9 | tts: response.body מחוץ ל-withTimeout | ✅ | tts.ts:34-63 — `const response = await withTimeout(...)` (שורה 34), `return response.body` בשורה 63 — מחוץ לscope לחלוטין. תגובה + הסבר בdocstring שורות 10-12 |
| 10 | narrate מיושר + עדיין מחזיר null | ✅ | narrate.ts:34-53 — `withTimeout((s) => generateText({...abortSignal: s}), TIMEOUT_MS=3000, {signal, label:"narrate"})`. catch מחזיר null, טקסט ריק מחזיר null |
| 11 | regression: speaker/TTS tests | ✅ | 495 passed, test suite כולל speaker + tts adapter tests |
| 12 | regression: loadVoices tests | ✅ | voices.test.ts ירוק (5 tests), settings loadVoices scenarios תחת test suite |
| 13 | createAgent callers additive | ✅ | agent-session.svelte.ts:101+206 קוראים `createAgent({cwd, cliKind})` ללא שינוי (signal=undefined). sessions.ts:42 אותו דפוס. חתימה `signal?: AbortSignal` → additive, שלושת הcallers עובדים בלי שינוי |

## Happy path

בדיקה יחידה בלבד (אין BE/browser). כל 6 הפונקציות עטופות ומכוסות בטסטים עם:
- happy path (fetch מחזיר תשובה → תוצאה נכונה)
- timeout (withTimeout זורק → propagation נכון)
- חתימות: signal מועבר ל-withTimeout opts

✅ כל טסטי ה-adapters החדשים ירוקים (agents-api: 8 tests, voices: 5, tts: 6, narrate: 5)

## Bugs חדשים שלא ברשימה

אין.

## הערת streaming-safety (DoD#9)

בדקתי במיוחד את `tts.ts`: `withTimeout` מסתיים ברגע ש-`fetch` מחזיר response (headers בלבד).  
`return response.body` בשורה 63 רץ **אחרי** ש-`withTimeout` resolve + `clearTimeout` כבר קרה.  
tts.test.ts:61-78 בודק את זה מפורשות ("streaming safety: withTimeout מקבל את ה-fetch").  
✅ אין סכנה לקטיעת stream אודיו.
