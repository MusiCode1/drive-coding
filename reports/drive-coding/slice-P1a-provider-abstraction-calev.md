---
project: "drive-coding"
slice: "P1a-provider-abstraction"
verifier: "calev"
date: "2026-06-13"
mode: "light"
verdict: "GO"
dod_items:
  - "pnpm -F @drive-coding/core typecheck exit 0"
  - "provider/events.ts exported from core index.ts"
  - "types structural-identical to contract v1.2 §3"
  - "classifyToolKind covers all 10 ACP values + unknown"
  - "ws-messages.locations = ToolLocation.array() matching frontend #mapLocations"
  - "256 core tests pass, 0 fail"
  - "git diff --stat dev: only provider/**, index.ts, schemas/ws-messages.ts, tests/**"
spot_check: "vitest run --project @drive-coding/core — 256 passed, 0 failed, 21 test files"
findings: []
---

# Slice P1a — Verification Report (Light)

> **תאריך:** 2026-06-13
> **Tier:** light
> **Commit:** 9d053f3b458426bb1eb615b0fb3e3dec3bf0f543

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 7/7 |
| Happy path עובד | GO |
| Bugs חדשים | 0 |

## DoD items

| # | Item | סטטוס | Evidence |
|---|------|--------|----------|
| 1 | `pnpm -F @drive-coding/core typecheck` exit 0 | GO | stdout ריק, exit 0 |
| 2 | `pnpm -F @drive-coding/core build` exit 0 | GO | stdout ריק, exit 0 |
| 3 | `provider/events.ts` — types structural-זהים ל-§3 v1.2 | GO | השוואה ישירה 1:1 — כל field/union/interface זהה: `ToolKind`, `ToolCallLocation` (עם `line?`), `ProviderEvent` (13 variants), `ProviderCapabilities` (עם `extensions?`), `ConsumerCapabilities`, `PromptContent`, `PromptAck`, `ProviderSession` (tier-2 optional methods) — TS interfaces טהורים, ללא arktype |
| 4 | `classifyToolKind` — switch מפורש, כל 10 ACP + לא-מוכר | GO | בדיקת קוד ישירה: switch עם `case "read"/"edit"/"delete"/"move"/"execute"/"search"/"fetch"/"think"` + `default: return "other"` (מכסה `switch_mode`, `other`, ולא-מוכר); 11 טסטים כולם passed |
| 5 | `ws-messages.locations` = `ToolLocation.array()` לא `string[]` | GO | שורה 4 ב-ws-messages.ts: `const ToolLocation = type({ path: "string", "line?": "number" })`; שורה 95: `"locations?": ToolLocation.array()`; 5 טסטי P1a drift-fix כולם passed (כולל rejection של `["str"]`) |
| 6 | regression — כל טסטי core עוברים | GO | `pnpm vitest run --project @drive-coding/core` → **256 passed, 0 failed, 21 test files** (3.67s) |
| 7 | scope — רק `provider/**`, `index.ts`, `schemas/ws-messages.ts`, `tests/**` | GO | `git diff --stat dev`: 6 קבצים בלבד — `core/src/index.ts` (+1), `core/src/provider/events.ts` (+117), `core/src/provider/tool-kind.ts` (+39), `core/src/schemas/ws-messages.ts` (8 lines, -2+6), `core/tests/provider/tool-kind.test.ts` (+62), `core/tests/ws-messages.test.ts` (+61). אין נגיעה ב-`acp/`, `ports.ts`, frontend. |

## Happy path

Flow: import types → run tests → verify schema.

`pnpm vitest run --project @drive-coding/core` רץ 21 test files, 256 tests. כל טסטי `classifyToolKind` (11) ו-`ToolCallMessage.locations` (5) עברו. Frontend `#mapLocations` עדיין מצפה `{path?, line?}` objects — תואם ל-`ToolLocation.array()` החדש (לא נשבר).

GO — עבד end-to-end ללא כשל.

## הערה: classifyToolKind לא מיוצאת מ-core/index.ts

`export type * from "./provider/events"` קיים. `tool-kind.ts` לא מיוצא מ-`index.ts`. זה **לא blocker**: DoD §5 item #2 מתייחס ל-events בלבד, והטסטים מייבאים ישירות מ-`../../src/provider/tool-kind` (דפוס תקין ב-monorepo). P1b יצטרך להוסיף export אם consumer חיצוני יצטרך `classifyToolKind` — אך מחוץ לscope של P1a.

## Bugs חדשים שלא ברשימה

אין.
