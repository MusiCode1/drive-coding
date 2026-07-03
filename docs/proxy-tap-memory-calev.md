---
slice: proxy-tap-memory
verdict: GO
mode: heavy
verifier: calev (heavy / Opus)
date: 2026-07-04
branch: slice/proxy-tap-memory
head: 560a522
base: a85dff6
dod_total: 8
dod_pass: 8
findings_total: 0
findings_blocking: 0
---

# calev-heavy — proxy-tap-memory — GO

> אימות ע"פ ה-brief `docs/plans/proxy-tap-memory.md` §5 (DoD).
> Slice של backend/core טהור (proxy tap · memory watchdog · usage accumulator) —
> **אין UI**. שלבי הסקירה-הויזואלית וה-E2E-בדפדפן (heavy §2-3) לא רלוונטיים;
> ה-runtime-gate כאן הוא **התנהגות-זיכרון-תחת-עומס** דרך vitest + mock fetch על
> ה-stack האמיתי (Hono + http-proxy), כפי שה-brief מכתיב (מפתח Gemini שרוף, אין upstream חי).

## פסק

**GO.** 8/8 DoD ירוקים. 0 findings חוסמים. ה-runtime-gate המרכזי (§5.1, RSS-under-load)
אומת בגודל האמיתי 256MB — לא רק ב-64MB המוקטן של הטסט הקבוע — עם delta של **8.3MB**
(מול >250MB עם ה-`tee()` הישן). אין regressions חדשים: 2 כשלי-הטסט על ה-slice זהים
בדיוק לכשלים על ה-base commit (pre-existing, known).

---

## DoD — פריט-פריט

| # | פריט (brief §5) | סטטוס | ראיה |
|---|---|---|---|
| §5.1 | repro memory — RSS delta < 50MB | ✅ | הטסט הקבוע `bounded RSS` (64MB) ירוק; בנוסף אימות-heavy **בגודל 256MB האמיתי** דרך ה-http-proxy האמיתי → `finalDelta=8.3MB peakDelta=11.3MB bytesRead=256MB` |
| §5.2 | Gemini usage tap | ✅ | 11/11 טסטי `gemini-usage-accumulator` · `parseGeminiChunkUsage` מיוצא (DRY) · טסט `records usage from Gemini SSE` ירוק (inputTokens=10, audioTokens=45) |
| §5.3 | cache tap — bounded, אין tee/cacheStreamInBackground, cap 8MB | ✅ | `PROXY_CACHE_MAX_ENTRY_BYTES=8MB` קיים; אין `tee()`/`cacheStreamInBackground` אמיתי (רק בהערות); אומת חי: 9MB→skip write (0 קבצים), 1MB→write (2 קבצים) |
| §5.4 | memory watchdog | ✅ | `createMemoryGuard()`: `overBudget()`+`stop()`+timer `.unref()`; 2 טסטים (503 + 200) ירוקים; מחווט ב-`server.ts:124,127` |
| §5.5 | no regressions | ✅ | סוויטה מלאה: `1 failed \| 757 passed \| 17 skipped` — הכשל זהה ל-base (ראה §regressions) |
| §5.6 | no new tee() | ✅ | `grep` על `res.body.tee()` → אפס קריאות אמיתיות (רק 3 אזכורי-הערה שמתעדים את ההסרה) |
| §5.7 | no deps added | ✅ | `git diff a85dff6..HEAD` על `package.json`×3 + `pnpm-lock.yaml` → **ריק לחלוטין** |
| §5.8 | TypeScript | ✅ | `pnpm typecheck` (tsc --build) → 0 errors |

**נוסף (Risk-Hebrew):** `lint:i18n` — הקבצים החדשים אפס עברית; ה-bash script `✓ No hardcoded
Hebrew in code` (exit 0). (הרצת `pnpm lint:i18n` נכשלת על Windows בגלל runner-`./`, לא ממצא.)

---

## §5.1 — הראיה המרכזית (RSS-under-load, 256MB)

ה-brief §5.1 מגדיר את `scripts/repro-proxy-mem.mjs` כעוגן ה-runtime-gate, אבל ה-script
כתוב ל-Bun (פותר `.ts` + workspace-hoisting) — **Bun חסום בסביבה** (known ENOENT), ו-Node-ESM
לא פותר `hono` מ-`scripts/` ולא מייבא `.ts`. לכן שכפלתי את **אותו תרחיש 256MB** דרך ה-stack
האמיתי בתוך vitest (שפותר הכל דרך vite), הרצתי, ומחקתי (worktree נקי):

```
[calev-256] bytesRead=256MB finalDelta=8.3MB peakDelta=11.3MB records=1 audioTokens=20
```

Client מנקז את כל 256MB · ה-tap רץ inline · usage נרשם נכון · **peak delta 11.3MB** — ה-backpressure
של `TransformStream` עובד כפי שה-brief טען (67→86MB ב-repro המקורי). זו הרגרסיה שהפילה את ה-BE, סגורה.

---

## §regressions — אימות pre-existing (heavy §5)

הרצתי את הסוויטה המלאה גם על ה-**base commit `a85dff6`** (worktree detached נפרד, הותקן והוסר):

| קובץ | base a85dff6 | slice 560a522 | מסקנה |
|---|---|---|---|
| `bridge-failure-modes.test.ts` (Bun ENOENT edge) | ×1 (בסוויטה מלאה) | ×1 | **pre-existing** · flaky-isolation (עובר לבד, נכשל בעומס-מקבילי; אין `it.skip`) |
| `https-serve.test.ts` (TLS-cert-Windows) | ×2 | ×2 | **pre-existing** |

הכשלים **זהים בדיוק** על ה-base ועל ה-slice. ה-slice לא נגע ב-bridge/spawn/tls. 0 regressions חדשים.

---

## Edge cases שנבחנו (heavy §4 — הסקה)

| מקרה | ממצא |
|---|---|
| `flush()` לא נקרא ב-abort (FE מנתק) → usage לא נרשם | **מקובל** — מתועד בקוד+brief (fail-safe: להחסיר מטריקה עדיף מקריסה) |
| `res.body === null` בנתיב-forward | תקין — `new Response(null)` חוקי; שאר הנתיבים guarded ב-`res.body &&` |
| `boundedCollector` על-גבול-cap (9MB) | תקין — truncated→skip write, client מקבל את כל 9MB |
| usage double-record / race | תקין — ElevenLabs נרשם sync מ-request-body (deterministic), Gemini ב-flush; לא חופפים |
| DRY refactor שובר `extractGeminiUsage` (escalation trigger) | לא-קרה — חתימה לא-שונתה, `extract.test.ts` 0 שינויים + 15/15 ירוק |
| `_cache` module-singleton חוצה-בקשות | **pre-existing מ-Slice 10** (לא ב-scope); לא-נגע. הבחנתי בו כי חשף עצמו בבידוד-טסט |
| memoryGuard timer דולף | לא — `.unref()` מונע החזקת-exit; `stop()` קיים (לא מחווט ל-shutdown, מקובל בגרסה זו) |

## Observations לא-חוסמות (לא findings)

1. **`memoryGuard` 503 חוסם גם cache-hits זולים** — ה-guard רץ בראש ה-handler, לפני בדיקת ה-cache,
   אז over-budget יחסום גם cache-hit שלא צורך זיכרון. שמרני-מעט; ה-brief מקבל "גרסה מספקת". (informational)
2. **`memoryGuard.stop()` לא מחווט ל-shutdown** ב-`server.ts` — לא בעיה בפועל (`.unref()`), אבל אם
   ייכתב graceful-shutdown בעתיד (be-shutdown-hardening) — נקודת-קריאה מוכנה. (informational)

---

## שיטת-אימות (heavy — runtime, לא רק קריאה)

- הרצתי כל טסט בפועל (לא הסתמכתי על דיווח אליעזר): 60 core+proxy · 15 extract · 34 slice ×2 (determinism).
- שכפלתי את ה-256MB בגודל אמיתי דרך ה-stack + מדדתי RSS בפועל.
- אימתתי cap-truncation (9MB/1MB) בפועל מול ה-filesystem.
- הרצתי את הסוויטה על ה-base commit להשוואת-regressions.
- קראתי את ה-brief המקורי בעצמי + כל 5 קבצי-הקוד + ה-diff מול base.
- כל הטסטים הזמניים (`_calev-*`) נמחקו; `git diff --ignore-cr-at-eol` → worktree נקי מבחינת תוכן.
```
verdict: GO
```
