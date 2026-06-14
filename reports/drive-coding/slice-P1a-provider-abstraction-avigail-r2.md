---
project: "drive-coding"
slice: "slice-P1a-provider-abstraction"
verifier: "avigail"
date: "2026-06-13"
round: 2
verdict: "USABLE-AFTER-FIX"
findings:
  - id: 1
    severity: "confusion"
    category: "wrong-path"
    summary: "Brief §4 Commit 1/2 imply test files but never state location; repo tests live in packages/core/tests/ NOT colocated src/**/*.test.ts"
    source_brief: "§4 Commit 1, Commit 2"
    source_code: "packages/core/tests/ (e.g. ws-messages.test.ts)"
    cost_estimate: "5-10min"
  - id: 2
    severity: "confusion"
    category: "unique"
    summary: "DoD #4/#5/#6 say 'test → 0 fail' and Commit verification says 'test' but @drive-coding/core has NO test script; tests run via root 'pnpm test' (vitest run) or 'vitest run packages/core'"
    source_brief: "§4 Commit 1/2 Verification, §5 DoD #4/#6"
    source_code: "packages/core/package.json:24-26 (scripts: build,typecheck only)"
    cost_estimate: "5-10min"
  - id: 3
    severity: "outdated"
    category: "outdated-risk"
    summary: "DoD #3 + §6 still say 'grep diff / adopt 1:1 vs claude-code-connection events.ts' contradicting the §3 fix that source-of-truth = contract v1.2 (events.ts is partial)"
    source_brief: "§5 DoD #3, §6 row 2"
    source_code: "n/a (internal inconsistency)"
    cost_estimate: "5min"
---

# Plan Verification — slice-P1a-provider-abstraction (Round 2)

> **Brief**: docs/plans/slice-P1a-provider-abstraction.md
> **Base tip**: 8410042 (drive-coding/main HEAD)
> **Verdict**: 🟡 USABLE-AFTER-FIX
> **אומדן זמן confusion אם לא תוקן**: ~15-20 דק'

## רקע — אימות 5 התיקונים מסבב 1

| # (r1) | תיקון מצופה | סטטוס | עדות |
|---|---|---|---|
| 1 (blocker) | §3 self-contained inline types, מקור-אמת חוזה v1.2 | ✅ **תוקן** | §3 מכיל את כל 12 הטיפוסים inline: `ToolKind`, `ToolCallLocation`, `PermissionOption`, `ToolContent`, `Usage`, `PlanEntry`, `ProviderEvent` (עם `locations?`+`content?`), `ProviderCapabilities`, `ConsumerCapabilities`, `PromptContent`, `PromptAck`, `ProviderSession`. אזהרה מפורשת "אל תסתמך על events.ts לטיפוסים החסרים" ב-§0 reading-list ובראש §3. |
| 2 (blocker) | DoD לא דורש זהות ל-events.ts החלקי | 🟡 **חלקית** — ראה Finding 3 | §3 הובהר, אך DoD #3 + §6 row 2 עדיין מנסחים "grep diff מול events.ts" / "אמץ 1:1". |
| 3 (major) | arktype `.array()` | ✅ **תוקן** | §4 Commit 2 משתמש ב-`type({path,"line?":"number"}).array()`. אומת מול תבנית קיימת `AgentPublic.array()` ב-`agent.ts:104`. |
| 4 (minor) | `classifyToolKind` switch מפורש | ✅ **תוקן** | §4 Commit 1 — `switch` מלא, default→`"other"`, כל ענף מחזיר `ToolKind` ודאי. רציונל `noUncheckedIndexedAccess` נכון (אומת `tsconfig.base.json:8`). |
| 5 (minor) | toolchain pnpm מפורש | ✅ **תוקן** | §0 + Commit 0 + §8 כותבים "pnpm 10". אומת `pnpm -F @drive-coding/core typecheck` (build/typecheck scripts קיימים). |

## בעיות שנמצאו

### 🟡 Confusion / Outdated

| # | בעיה | מקור | הצעה |
|---|------|------|------|
| 1 | §4 Commit 1/2 מניחים קבצי-טסט אך לא מציינים **היכן**. ב-repo הטסטים יושבים ב-`packages/core/tests/` (לא colocated `src/**`). אליעזר עלול ליצור `src/provider/*.test.ts`, שייאסף ע"י vitest (glob ברירת-מחדל) אך סוטה מהקונבנציה ומ-DoD #7 (`git diff --stat` מצפה רק `provider/**`,`index.ts`,`ws-messages.ts`,טסטים). | brief §4 Commit 1/2 / `packages/core/tests/ws-messages.test.ts` | ציין `packages/core/tests/provider/*.test.ts`. |
| 2 | DoD #4/#6 + Commit verification אומרים `test → 0 fail`, אך **ל-`@drive-coding/core` אין script `test`**. הטסטים רצים דרך root `pnpm test` (`vitest run`, projects כולל `packages/core`) או `pnpm vitest run packages/core`. `pnpm -F @drive-coding/core test` ייכשל "no script". | brief §4 verification + §5 DoD #4/#6 / `packages/core/package.json:24-26` + root `package.json:14` | החלף ל-`pnpm vitest run packages/core` (או root `pnpm test`). |
| 3 | DoD #3 ("grep diff מול claude-code-connection events.ts — אותם שמות שדות") ו-§6 row 2 ("אמץ 1:1 מ-claude-code-connection") **סותרים** את התיקון של §3 שקבע מקור-אמת = חוזה v1.2 ו-events.ts חלקי. אליעזר יבלבל בין שני מקורות-אמת; grep diff מול 76 שורות חלקיות ייכשל על הטיפוסים החסרים. | brief §5 DoD #3, §6 row 2 / §3 (אזהרת events.ts) | נסח DoD #3 כ-"structural מול חוזה v1.2 §3-5" ולא diff מול events.ts. |

### 🟢 Minor
אין.

## Spot-check שעבר (לא מצא בעיה)

- ✅ ports.ts הוא **interfaces טהורים** (`AcpTransport`/`AcpCapabilities` interfaces, ACP types מיובאים מ-SDK) — מצדיק את בחירת §3 שה-Provider types יהיו interfaces/union טהורים ולא arktype (`ports.ts:70-90`).
- ✅ `ws-messages.ts:91` — `"locations?": "string[]"` drift קיים בדיוק כפי שהbrief טוען. comment ב-77 "מערך של נתיבי קבצים" קיים (יעד לעדכון Commit 2).
- ✅ `agent.ts:104` — `AgentPublic.array()` קיים → תבנית `.array()` של Commit 2 נכונה.
- ✅ `index.ts:3` — `export type * from "./ports"` קיים → דפוס `export type * from "./provider/events"` עקבי.
- ✅ `bubble.ts:59` — `ToolLocation = { path: string; line?: number }` זהה ל-`ToolCallLocation` הקנוני (decision 9).
- ✅ `#mapLocations` (agent-session.svelte.ts:795) כבר מצפה `{path, line?}` → תיקון Commit 2 **מיישר ולא שובר** (regression mitigation §6 row 4 תקף).
- ✅ `tsconfig.base.json:8` `noUncheckedIndexedAccess: true` → רציונל ה-switch ב-`classifyToolKind` תקף.
- ✅ `packages/core/src/provider/` **לא קיים** → מודול חדש, אין התנגשות שמות.
- ✅ types inline §3 — עקביות פנימית: כל type שמוזכר ומשמש מוגדר לפני שימוש (`ToolKind`/`ToolCallLocation`/`ToolContent`/`PermissionOption` לפני `ProviderEvent`; `Usage`/`PlanEntry` לפני שימוש ב-events; `ProviderCapabilities`/`ConsumerCapabilities`/`PromptContent`/`PromptAck` לפני `ProviderSession`). `ConsumerCapabilities` מוגדר ומשמש ב-`start()`. אין type חסר שמוזכר ומשמש.
- ✅ depends_on (§8 בדיקה): P1a `depends_on: []` עקבי — types-only additive, אין הסתמכות על slice אחר ב-dev. P1b/P1c מצהירים `[P1a]` נכון. (state.json לא נבדק — לא נגיש מקומית; הצהרת ה-brief פנימית-עקבית.)

## Verdict

🟡 **USABLE-AFTER-FIX** — 5 התיקונים מסבב 1 בוצעו בפועל (2 blocker + major + 2 minor סגורים מבחינת תוכן). אך התיקון של blocker #2 הותיר **שריד** ב-DoD #3/§6 (Finding 3), ושני findings חדשים סביב מנגנון-הטסט של ה-repo (Findings 1+2 — מיקום `tests/` + היעדר script `test` ב-core) שייתקעו את אליעזר ב-verification. כולם textual-fixes של מרדכי (~15-20 דק'), לא בעיות מבניות. אין blocker.
