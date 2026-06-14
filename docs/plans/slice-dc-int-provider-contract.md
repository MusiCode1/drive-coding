# Slice dc-int — drive-coding צורך provider-contract (Direct, בלי מתווך)

> **תאריך**: 2026-06-14
> **סטטוס**: ✅ **plan-verified / READY** (גרסת **Direct** — אביגיל USABLE-AFTER-FIX → 3 findings קוסמטיים תוקנו, 2026-06-14). הליבה אומתה: 5 הסימבולים נפתרים מ-provider-contract, AcpTransport/AcpClient זהים בין הריפו, ports.ts הוא ה-hub היחיד של BridgeCrashInfo (root-consumers לא משתנים), אין צרכן פנימי נוסף ב-core. תיקונים: §0.2 describeCrash=subpath, §0.4 prepare:tsc חובה (dist gitignored), §6 transitive resolution דרך core. **ממתין ל-go לביצוע.**
> **Base**: `dev` (drive-coding, אחרי P1a+P1b merged — `224743e`)
> **Complexity**: ~7/10 (calev) — 3 packages, מחיקות, frontend test-mock, git-dep ×3 toolchains
> **depends_on**: `[P0-reg merged ✅ (provider-contract @ 53891af)]`
> מקור: חקירת drive-coding/dev (2026-06-14) + החלטת Direct (ללא shim ב-core)

---

## §0 — ממצאי חקירה (קובעים את התכנון)

### §0.1 — ל-ProviderSession layer אין צרכן runtime
ה-frontend עדיין על הנתיב הישן: `AcpClient` **raw** → מיפוי מקומי משלו ל-bubbles
(`agent-session.svelte.ts:855 #mapToolContent`; `ToolContent` מ-`$lib/types/bubble`, **טיפוס מקומי**).
לכן `provider/{events,acp-provider,map-acp-notification,tool-kind}.ts` נצרכים **רק בטסטים של core**.
ה-cutover ל-`ProviderSession`/`ProviderEvent`/`createRegistry` = **P1d** (לא כאן). → ב-dc-int **לא** מייבאים
את ה-ProviderSession layer בכלל; רק את פרימיטיבי ה-ACP client/transport.

### §0.2 — מה באמת עובר מהחבילה (5 סימבולים)
| סימבול | מקור היום | צרכנים בפועל |
|---|---|---|
| `createAcpClient` (value) | `core/acp/client` | frontend `sessions.ts:12`, `agent-session.svelte.ts:20` (+test mock) |
| `AcpClient` (type) | `core/acp/client` | frontend `agent-session.svelte.ts:20`, `agent-session.test.ts:17` |
| `AcpTransport` (type) | `core/acp/transport` | frontend `ws-transport.ts:19` (`WsAcpTransport implements`) |
| `describeCrash` (value) | `core/acp/describe-crash` (subpath `@drive-coding/core/acp/describe-crash`) | backend `agent-orchestrator.ts:26` |
| `BridgeCrashInfo` (type) | `core/acp/describe-crash` | **רק `core/ports.ts:3`** (ראה §0.3) |

כל שאר `@drive-coding/core` = drive-coding-specific (`CliKind`,`BridgeKind`,`AgentRegistry`,`CLI_SPECS`...) — **נשאר**.

### §0.3 — `ports.ts` = ה-hub של BridgeCrashInfo (מפשט!)
`core/src/ports.ts:3` מייבא `BridgeCrashInfo` מ-`./acp/describe-crash.js`, ו-`ports.ts:6` **מייצא אותו מחדש**;
`index.ts:3` = `export type * from "./ports"`. כך backend (`agent-orchestrator.ts:21`, `bridge-manager.ts:2`,
tests) מקבל `BridgeCrashInfo` מ-`@drive-coding/core` **root** — לא מ-subpath.
→ אם `ports.ts:3` יעבור ל-`provider-contract`, ה-root export שורד ו**כל הצרכנים מ-root לא משתנים**.

### §0.4 — packaging מאומת
`provider-contract` (`53891af`): `main:dist/index.js`, `types:dist/index.d.ts`, `prepare:tsc`, `files:[dist]`.
⚠️ `dist/` הוא **gitignored/untracked** → ב-git-dep, pnpm **חייב** להריץ `prepare:tsc` בהתקנה (עם devDeps של provider-contract — typescript) כדי לבנות את `dist`. אם `prepare` לא רץ → אין `dist/index.d.ts` והפתרון נשבר. אמת ב-Commit 0.
`AcpTransport`/`AcpClient`/`AcpClientOptions` **זהים byte-for-byte** בין הריפו (אביגיל אישרה) →
`WsAcpTransport implements AcpTransport` לא יישבר. frontend+backend כבר תלויים ב-`@agentclientprotocol/sdk@^0.21.1`.

## §1 — מטרה
ניתוק מלא: frontend/backend מייבאים את 5 פרימיטיבי ה-ACP **ישירות** מ-`provider-contract`; `core/src/{provider,acp}`
**נמחקים** (כולל subpath `./acp/*` והטסטים הכפולים). אין שכבת shim, אין indirection, אין ניקוי ב-P1d.

## §2 — Scope
| פעולה | package |
|------|------|
| + dep `"provider-contract": "git+https://github.com/MusiCode1/provider-abstraction.git#main"` | core, frontend, backend |
| `ports.ts:3` → import `BridgeCrashInfo` מ-`provider-contract`; הסר subpath `./acp/*`; הסר re-exports provider מ-`index.ts`; **מחק** `src/{provider,acp}` + `tests/{provider,acp}` | core |
| 3 אתרי import → `provider-contract` (ws-transport, sessions, agent-session) + test-mock | frontend |
| `agent-orchestrator.ts:26` → `describeCrash` מ-`provider-contract` | backend |
| frontend cutover ל-ProviderSession/createRegistry | ❌ — **P1d** |

## §3 — Design — שינויים מדויקים

### A. core (`@drive-coding/core`)
1. `package.json`: + dep `provider-contract` (git-dep). מ-`exports` **הסר** `"./acp/*": "./src/acp/*.ts"`.
2. `src/ports.ts:3`: `import type { BridgeCrashInfo } from "./acp/describe-crash.js"` → `from "provider-contract"`. שורה 6 (`export type { BridgeCrashInfo, ... }`) **נשארת** → root API שורד.
3. `src/index.ts`: **הסר** שורות 4,8,9,10 (`export type * from "./provider/events"` + 3 ה-`export * from "./provider/*"`). שורות 1-3,5-7,11-17 נשארות.
4. **מחק**: `src/provider/{events,acp-provider,map-acp-notification,tool-kind}.ts`.
5. **מחק**: `src/acp/{client,client-impl,transport,transport-mock,provider-error,describe-crash}.ts`.
6. **מחק**: `tests/provider/*` (4) + `tests/acp/*` (4) — הקוד+הכיסוי עברו ל-provider-contract (95+ טסטים שם).
   ⚠️ אמת שאין צרכן פנימי אחר ב-core ל-`./acp`/`./provider` מלבד `ports.ts` (§0.3) ו-acp-provider (נמחק).

### B. frontend (`@drive-coding/frontend-v2`)
7. `package.json`: + dep `provider-contract`.
8. `src/lib/engines/ws-transport.ts:19`: `import type { AcpTransport } from "provider-contract"`.
9. `src/lib/adapters/sessions.ts:12`: `import { createAcpClient } from "provider-contract"`.
10. `src/lib/view-models/agent-session.svelte.ts:20`: `import { createAcpClient, type AcpClient } from "provider-contract"`.
11. `src/lib/view-models/agent-session.test.ts`: שורה 17 `import type { AcpClient } from "provider-contract"`; שורה 25 `vi.mock("@drive-coding/core/acp/client", ...)` → `vi.mock("provider-contract", ...)`; שורה 205 dynamic `import("provider-contract")`. ⚠️ **mock partial** — `provider-contract` חושף עוד symbols (createRegistry וכו'); השתמש ב-`importActual` או mock רק `createAcpClient` כדי לא לשבור import-ים אחרים מ-ה-package. ראה §6.

### C. backend (`@drive-coding/backend`)
12. `package.json`: + dep `provider-contract`.
13. `src/app/agent-orchestrator.ts:26`: `import { describeCrash } from "provider-contract"`. שורה 21 (`BridgeCrashInfo` מ-root) — **לא משתנה** (§0.3).
14. `bridge-manager.ts:2` + tests (`BridgeCrashInfo` מ-root) — **לא משתנים**.

## §4 — Commits (outline)
0. + dep `provider-contract` ל-3 package.json; `pnpm install` (root). ⚠️ אמת ש-`prepare:tsc` בנה `dist/index.{js,d.ts}`, ושכל 3 ה-packages פותרים אותו. typecheck בסיס.
1. core: `ports.ts` import + מחיקת `src/{provider,acp}` + `index.ts` + subpath + מחיקת `tests/{provider,acp}`. `pnpm vitest run --project @drive-coding/core` ירוק.
2. backend: `agent-orchestrator.ts:26`. `tsc --noEmit` (backend) + טסטים ירוקים.
3. frontend: 3 import sites + test-mock (§3.11). `pnpm vitest run --project @drive-coding/frontend-v2` ירוק; `svelte-check` נקי.

## §5 — DoD
| # | בדיקה |
|---|------|
| 1 | 3 package.json עם dep `provider-contract` git-dep; `pnpm install` בנה dist; כל 3 packages פותרים |
| 2 | `core/src/{provider,acp}` + `tests/{provider,acp}` **נמחקו**; subpath `./acp/*` הוסר; `index.ts` בלי provider re-exports |
| 3 | `core/ports.ts` מייבא `BridgeCrashInfo` מ-`provider-contract`; root export שורד (backend root-consumers לא שונו) |
| 4 | frontend: 3 import sites + mock → `provider-contract`; `WsAcpTransport implements AcpTransport` עובר typecheck |
| 5 | backend: `describeCrash` מ-`provider-contract`; שאר root-imports לא שונו |
| 6 | typecheck נקי בכל 3 ה-toolchains: core (tsc), backend (tsc/bun), frontend (svelte-check) |
| 7 | טסטים ירוקים: `--project @drive-coding/core` + `@drive-coding/frontend-v2` + backend |
| 8 | scope: לא נגעו ב-ProviderSession cutover (P1d); `agent-session.svelte.ts` עדיין על AcpClient raw |

## §6 — Risks
| סיכון | מיטיגציה |
|------|----------|
| git-dep dist לא נפתר תחת **vite** (frontend) — resolver שונה מ-tsc | Commit 3 מאמת `vite build`/`svelte-check`; dist הוא ESM `.js` → vite אמור לפתור; אם לא — escalation |
| git-dep לא נפתר תחת **bun** (backend runtime) | Commit 2 מאמת; bun פותר node_modules; אם לא — escalation |
| `vi.mock("provider-contract")` ממכר את כל ה-package → שובר import אחר | mock partial (`importActual` + override `createAcpClient`); §3.11 |
| pnpm git-dep משוכפל פר-package (3×) | pnpm dedupes לפי אותו URL+#main; אמת lock entry יחיד |
| **transitive resolution דרך core** — `ports.ts` מייבא מ-provider-contract, לכן **כל** צרכן של core (frontend/backend, גם קבצים שלא מייבאים ישירות) פותר את provider-contract transitively. ה-d.ts חייב להיפתר מכל נקודה ש-`@drive-coding/core` נצרכת | ה-dep המפורש ב-3 ה-package.json מבטיח resolvability; אמת typecheck של frontend/backend (svelte-check/tsc) עובר על קבצים שצורכים core root |
| מחיקת `tests/{provider,acp}` = איבוד כיסוי ב-core | הכיסוי קיים ב-provider-contract (95 acp + 91 cc); זו כפילות מכוונת |
| `@agentclientprotocol/sdk` transitive ≠ workspace | שתיהן `^0.21.1` |

## §7 — Escalation
- git-dep build נכשל באחד מ-3 ה-toolchains (tsc/vite/bun) → עצור, אל תתקן tsconfig/vite config של provider-contract בלי אישור.
- אם `ports.ts` אינו ה-hub היחיד של `BridgeCrashInfo` (צרכן פנימי נוסף ב-core ל-`./acp`) → דווח לפני מחיקה.
- frontend test-mock דורש שינוי מבני גדול (לא partial) → דווח.

## §9 — לדיוק/הכרעה אחרי אביגיל
1. git-dep refresh workflow (עדכון provider-contract ב-main) — `pnpm update provider-contract`? תיעוד.
2. האם `BridgeCrashInfo`/`describeCrash` הם באמת generic או drive-coding-specific (bridge = מושג drive-coding)? — לא חוסם dc-int (כבר בחבילה ע"י P0-acp), אך שווה לשקול ל-roadmap.
3. registry/ProviderSession — **לא** נכנס ל-dc-int (אין צרכן; P1d).
