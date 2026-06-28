---
project: "drive-coding"
slice: "FE-normalization"
verifier: "calev"
date: "2026-06-29"
mode: "light"
verdict: "GO"
dod_items:
  - "typecheck + tests (vm + facade) ירוקים"
  - "client.extMethod עובד — passthrough ל-ClientSideConnection.extMethod"
  - "ext.setThinkingTokens מאמת params (schema) ושולח _drive/setThinkingTokens"
  - "vm.capabilities נטען מ-_drive/capabilities frame; vm.supports.thinkingTokens נכון"
  - "gating: UI יכול לעשות {#if vm.supports.X}"
  - "ה-FE לא מסעיף על cliKind — רק capabilities+schema"
  - "additive — FE + client.ts + docs; אין BE rewire"
spot_check: "provider 133/133 + frontend 380/380; vite build ירוק; pre-existing failures לא נגעו ל-slice"
findings: []
---

# FE-normalization — Verification Report (Light)

> **תאריך:** 2026-06-29
> **Tier:** light
> **Commit:** `085438d` (HEAD) / base: `bdc88c1`

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 7/7 |
| Happy path עובד | ✅ |
| Bugs חדשים | 0 |

## DoD items

| # | Item | סטטוס | Evidence |
|---|------|--------|----------|
| 1 | typecheck + tests ירוקים | ✅ | `typecheck` — 0 שגיאות; provider 133/133, frontend 380/380 |
| 2 | `client.extMethod` passthrough ל-`ClientSideConnection.extMethod` | ✅ | `client.ts:206-211` — `conn.extMethod(method, params)`; TDD test ב-`client.extmethod.test.ts` |
| 3 | `ext.setThinkingTokens` מאמת params ושולח `_drive/setThinkingTokens` | ✅ | `adapters/ext.ts:31-32` — `parseExtParams(...)` לפני `client.extMethod`; test ב-`ext.test.ts` |
| 4 | `vm.capabilities` נטען מ-`_drive/capabilities`; `vm.supports.thinkingTokens` נכון | ✅ | `agent-session.svelte.ts:1356-1358` — `#onExtNotification` מסנן `_drive/capabilities` → `#capabilities`; getter `supports` מחזיר `#capabilities ?? {כל false}` |
| 5 | gating: `{#if vm.supports.X}` | ✅ | getter `supports():NormalizedCapabilities` ב-שורה 154; test ב-`agent-session.capabilities.test.svelte.ts` (6 בדיקות) |
| 6 | FE לא מסעיף על `cliKind` בנתיבי capabilities/ext | ✅ | ext.ts ו-`#onExtNotification` / `supports` getter — אפס התנייה על `cliKind`; הfacade אגנוסטי לספק |
| 7 | additive — FE + client.ts + docs; אין BE rewire | ✅ | `git show --stat` על 3 commits — שינוי בלעדי ב-`packages/provider/src/client/`, `packages/frontend/src/lib/`, `docs/`; אין נגיעה ב-`packages/backend/` |

## Happy path

שרשרת שלמה אומתה בקוד (אין BE חי):
BE (`ws-agent.ts`) → `feWs.send(_drive/capabilities)` → SDK default-routes כ-extNotification → `createClientImpl.extNotification` → `onExtNotification(method,params)` → `AgentSessionVM.#onExtNotification` → `this.#capabilities` מתעדכן → `vm.supports.thinkingTokens === true` → `{#if vm.supports.thinkingTokens}` ב-UI מראה את הכפתור.

נתיב ext: UI קורא `vm.ext.setThinkingTokens(sessionId, 4096)` → `parseExtParams("_drive/setThinkingTokens", ...)` (validation ArkType) → `client.extMethod("_drive/setThinkingTokens", params)` → `conn.extMethod(...)`.

✅ כל 9 חוליות השרשרת אומתו בקוד.

## vite build

ירוק — `built in 20.31s`, `Wrote site to "build"`. subpath `./types` → `src/types.ts` מנתק `spawn-core` בהצלחה (אין `node:child_process` ב-`types.ts`).

## כשלי טסטים קיימים (לא regression)

שני כשלים ב-`@drive-coding/backend`:
- `bridge-failure-integration.test.ts` — F-1 regression (POST /api/agents → 5xx) — **ידוע מ-roadmap** ("spawn ENOENT → 201, known bug"); קיים לפני base commit `bdc88c1`.
- `https-serve.test.ts` — 3 skipped (Windows bun path) — pre-existing, אינו קשור לסלייס.

שום שינוי של הסלייס לא נגע ב-`packages/backend/tests/`.

## Bugs חדשים

אין.
