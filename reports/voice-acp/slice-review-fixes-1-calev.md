---
project: "voice-acp"
slice: "review-fixes-1"
verifier: "calev"
date: "2026-06-02"
mode: "light"
verdict: "GO"
dod_items:
  - "typecheck נקי"
  - "build FE נקי"
  - "core tests עוברים (with-timeout 6 טסטים)"
  - "FE tests עוברים (transcribe + translate)"
  - "lint:i18n נקי"
  - "withTimeout exported ב-package.json + מיובא ב-transcribe + translate"
  - "helper: no unhandled rejection — טסט #6 ירוק"
  - "helper: timer cleanup — טסט #5 ירוק"
  - "F3: transcribe קורא withTimeout, לא AbortController ידני"
  - "F3: transcribe זורק (אין catch שמחזיר null)"
  - "F3: transcribe.test.ts timeout→throw ירוק"
  - "F1: showSaved=$derived(savedAt!==undefined) + $effect setTimeout 3000 + clearTimeout"
  - "translate מחזיר null בשגיאה/timeout"
  - "FE tests: אין רגרסיה"
spot_check: "pnpm test — 471 passed, 12 skipped, 0 failed. typecheck clean. build clean. lint:i18n clean."
findings: []
---

# slice-review-fixes-1 — Verification Report (Light)

> **תאריך:** 2026-06-02
> **Tier:** light
> **Commit:** 2a551d4 (HEAD)

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 14/14 |
| Happy path עובד | ✅ |
| Bugs חדשים | 0 |

## DoD items

| # | Item | סטטוס | Evidence |
|---|------|--------|----------|
| 1 | typecheck נקי | ✅ | `pnpm typecheck` — 0 שגיאות |
| 2 | build FE נקי | ✅ | `pnpm --filter @drive-coding/frontend-v2 build` — "built in 9.56s", ✔ done |
| 3 | core tests עוברים (with-timeout 6 טסטים) | ✅ | `pnpm test` — 471 passed, 48 files passed + 1 skipped. with-timeout.test.ts — 6 טסטים ירוקים |
| 4 | FE tests עוברים | ✅ | transcribe.test.ts (2 טסטים) + translate.test.ts (5 טסטים) — כולם ירוקים |
| 5 | lint:i18n נקי | ✅ | "✓ No hardcoded Hebrew in code." |
| 6 | withTimeout exported | ✅ | `core/package.json` שורה 22: `"./async/*": "./src/async/*.ts"`. קובץ `src/async/with-timeout.ts` קיים. `transcribe.ts:21` + `translate.ts:20`: `import { withTimeout } from "@drive-coding/core/async/with-timeout"` |
| 7 | helper: no unhandled rejection — טסט #6 ירוק | ✅ | `with-timeout.test.ts` שורות 104-135: listener על `process.on("unhandledRejection")`, מאמת `unhandledRejections.toHaveLength(0)` אחרי fn דוחה מאוחר. `void work.catch(()=>{})` ו-`void timeout.catch(()=>{})` שניהם רשומים לפני ה-timer. |
| 8 | helper: timer cleanup — טסט #5 ירוק | ✅ | `with-timeout.test.ts` שורות 84-98: `vi.spyOn(clearTimeout)`, מאמת שנקרא ב-finally |
| 9 | F3: transcribe קורא withTimeout, לא AbortController ידני | ✅ | `transcribe.ts` שורות 50-64: `await withTimeout((signal) => googleGenAi().models.generateContent({...}), TRANSCRIBE_TIMEOUT_MS, {...})`. אין `new AbortController()` |
| 10 | F3: transcribe זורק (אין catch שמחזיר null) | ✅ | `transcribe.ts` — אין try/catch. throw מתפשט לcaller |
| 11 | F3: transcribe.test.ts timeout→throw ירוק | ✅ | `transcribe.test.ts` שורות 68-73: `mockWithTimeout.mockRejectedValue(...)`, `await expect(transcribe(blob)).rejects.toThrow("transcribe timeout 15000ms")` |
| 12 | F1: showSaved=$derived + $effect setTimeout 3000 | ✅ | `settings/+page.svelte` שורה 23: `let showSaved = $derived(savedAt !== undefined)`. שורות 25-31: `$effect` עם `setTimeout(3000)` ו-`return () => clearTimeout(timer)` |
| 13 | translate מחזיר null בשגיאה/timeout | ✅ | `translate.ts` שורות 77-103: try/catch סביב `withTimeout`, catch מחזיר null. translate.test.ts טסט #2 (timeout→null) + #3 (generic error→null) ירוקים |
| 14 | FE tests: אין רגרסיה | ✅ | `pnpm test` — 471 passed, 0 failures |

## Happy path

**flow**: `pnpm test` (כל packages) + typecheck + build FE + lint:i18n.

- 471 tests passed, 12 skipped (skip קיים מלפני — לא regression), 0 failures
- typecheck 0 שגיאות
- build FE: ✔ done in 9.56s
- lint:i18n: ✓ No hardcoded Hebrew

✅ עבד

## הערות על סטיות מהתוכנית (מאומתות כתקינות)

**סטייה 1 — withTimeout refactor**: `timeoutReject` מחוץ ל-constructor, `void timeout.catch(()=>{})` רשום לפני ה-timer. זה פתרון תקין לבעיית `PromiseRejectionHandledWarning` של vitest@4.1.6+jsdom. הסמנטיקה שלמה, טסטים #5 ו-#6 מאמתים את שני הcritical paths.

**סטייה 2 — mock במקום fake timers ב-transcribe/translate**: withTimeout נmocked בשני הקבצים. הלוגיקה עצמה מכוסה ב-with-timeout.test.ts עם fake timers אמיתיים. הטסטים מאמתים שה-throw מתפשט (F3) ושnull מוחזר (Commit 3) — goal מושג.

## Bugs חדשים שלא ברשימה

אין.
