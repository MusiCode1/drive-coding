---
project: "drive-coding"
slice: "slice-active-agents-backend"
verifier: "calev"
date: "2026-06-13"
mode: "light"
verdict: "GO"
dod_items:
  - "typecheck נקי — core + backend (pnpm -r typecheck)"
  - "core tests — 243/243 passed (כולל persistent החדשים)"
  - "backend tests — 210/210 slice-tests passed (3 pre-existing failures בhttp-options/http-history)"
  - "agent-schema.test.ts:88 toEqual עדיין עובר (persistent אופציונלי)"
  - "bridge-manager.idle.test.ts — 6/6 ירוק עם cross-platform helper"
  - "reaper-pin — unpinned נקצר, pinned שורד"
  - "lint:i18n — נקי"
  - "AgentRegistry.update Pick הורחב ל-persistent (ports.ts)"
  - "cwd=/tmp בטסט reaper-pin — intentional split, לא מסתיר בעיה"
spot_check: "כל טסטי ה-slice עברו — bridge-manager.runtime, reaper-pin, http-agents persistent+enrichment"
findings:
  - id: 1
    severity: "minor"
    category: "unique"
    summary: "3 כשלונות pre-existing ב-http-options + http-history (Windows path / path-traversal)"
    source_brief: "דווח על ידי אליעזר מראש"
    source_code: "packages/backend/tests/http-options.test.ts, packages/backend/tests/http-history.test.ts"
    cost_estimate: "0 — pre-existing, מחוץ לscope"
---

# slice-active-agents-backend — Verification Report (Light)

> **תאריך:** 2026-06-13
> **Tier:** light
> **Commit:** 871447a (HEAD, 5 commits מעל e25912c)

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 9/9 |
| Happy path עובד | V |
| Bugs חדשים | 0 |

## DoD items

| # | Item | סטטוס | Evidence |
|---|------|--------|----------|
| 1 | typecheck נקי (core + backend) | V | `pnpm --filter @drive-coding/core typecheck` + `pnpm --filter @drive-coding/backend typecheck` — שניהם יצאו 0 ללא שגיאות |
| 2 | core tests כולל החדשים ל-persistent | V | 20 test files, 243/243 passed — כולל agent-schema tests החדשים ל-persistent (שורות 117-172) |
| 3 | backend tests — runtime + endpoint + reaper-pin | V | 21 test files passed, 210/210 slice-relevant tests. 3 כשלונות pre-existing בלבד (ראה finding #1) |
| 4 | agent-schema.test.ts:88 toEqual עדיין עובר | V | בדיקת "omits persistent from pub when not set" (שורה 159) כוללת `expect(pub).toEqual(agent)` — עבר |
| 5 | bridge-manager.idle.test.ts ירוק עם cross-platform helper | V | 6/6 tests ב-bridge-manager.idle.test.ts עברו (process.execPath + acp script במקום /usr/bin/sleep) |
| 6 | reaper-pin: pinned שורד, unpinned נקצר | V | `reaper-pin.test.ts`: "unpinned agent + detached + timeout → reaper kills it" V; "pinned agent (persistent=true)... → reaper skips it" V |
| 7 | lint:i18n | V | `bash ./scripts/lint-no-hebrew-in-code.sh` → "No hardcoded Hebrew in code." EXIT:0 |
| 8 | AgentRegistry.update Pick הורחב ל-persistent | V | `packages/core/src/ports.ts:27` — `Pick<Agent, "status" | "bridgePort" | "acpSessionId" | "crashReason" | "persistent">` |
| 9 | regression: connect רגיל (persistent:false ברירת מחדל) | V | `registry.create()` מאתחל `persistent: false` ב-registry.ts, נבדק ב-agent-orchestrator + http-agents tests |

## Happy path

Flow: POST /api/agents/:id/persistent עם `{persistent:true}` → 200 `{ok:true}` + registry.get().persistent===true. GET /api/agents עם bridgeManager mock → מחזיר `pid` (number) + `attached` (boolean). reapIdleBridges עם agent נעוץ + מנותק + timeout → agent נשאר ב-registry. reapIdleBridges עם agent לא-נעוץ → נמחק מ-registry וbridge נסגר.

V עבד — כל 4 flows אומתו דרך טסטי אינטגרציה.

## Pre-existing failures (לא regression)

3 טסטים נכשלים ב-`http-options.test.ts` + `http-history.test.ts`:
- `projects is an array of absolute paths` — מניח Unix paths (מחזיר Windows `D:\...`, לא `/...`)
- `Slice 24: returns homeDir field (non-empty string, absolute path)` — אותה סיבה
- `returns 403 when path traversal outside allowedBase` — מחזיר 404 במקום 403 על `/etc`

אימות pre-existing: `git diff e25912c..HEAD -- packages/backend/tests/http-options.test.ts packages/backend/tests/http-history.test.ts` → empty diff. הקבצים לא שונו על ידי ה-slice. Last commits שנגעו בהם: `a62c685`, `cdd6897` — קודמים לbase e25912c.

## Bugs חדשים שלא ברשימה

אין.

## סטיות מה-brief (אומתו תקינות)

1. **AgentRegistry.update Pick הורחב** — `ports.ts:27` כולל `"persistent"`. V.
2. **cwd="/tmp" בטסט reaper-pin** — intentional: registry.create מקבל Unix path לvalidation, spawn משתמש ב-`os.tmpdir()` לprocess בפועל. הפרדה נכונה, טסטים עוברים על Windows. V.
3. **cross-platform spawnBridge** — bridge-manager.idle.test.ts משתמש ב-`process.execPath` + acp script ב-tmpdir, לא ב-`/usr/bin/sleep`. כל 6 idle tests עוברים. V.
