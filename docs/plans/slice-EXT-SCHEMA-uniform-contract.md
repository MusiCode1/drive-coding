# Slice EXT-SCHEMA — uniform extension contract (ArkType schema + types + validation) — בריף

> **תאריך**: 2026-06-28 · **סטטוס**: brief · **branch**: slice/cutover-migration (ממשיך אחרי CUT-2)
> **Complexity**: 4/10 (verifier: light) · **depends_on**: [CUT-2] · **Base**: `slice/cutover-migration` @ `ead55cd`
> **לא ממזגים — ‏נצבר על cutover-migration עד הסוף.**

---

## §0 — context

משטח ה-ext היום stringly-typed: `callExt(method: string, params: Record<string, unknown>)`. "אחיד" רק בהבטחה.
ה-slice מקים את **החוזה המטופס והמאומת** של ההרחבות: ArkType schema (רישום methods) + טיפוסים נגזרים +
ולידציה בגבול ה-host. **משותף FE/BE** דרך `@drive-coding/provider/extensions` (שניהם תלויים בחבילה אחרי CUT-1).
רשומה ראשונה: `setThinkingTokens` (קיים מ-C3). תשתית ל-compact/mcp/commands העתידיים + ל-gating ב-FE.

> זה ה**צד המשותף** בלבד. ה-facade ב-FE + ה-gating + capability-frame delivery (B-default) = slice FE-normalization נפרד.

## §1 — מטרה

`extensions/schema.ts` (ArkType registry) + `extensions/types.ts` (נגזר) + ולידציה של ה-handler הקיים
`_drive/setThinkingTokens` מול הסכמה + subpath export. NormalizedCapabilities מיושר לסכמה. additive.

## §2 — Scope

| כן | לא |
|---|---|
| `arktype@^2.0.0` → dep של provider (אותה גרסה כמו core) | FE facade / gating (slice FE-normalization) |
| `extensions/schema.ts` — `extMethods` registry `{method → {params, result}}` | מימוש compact/mcp/commands |
| `extensions/types.ts` — טיפוסים נגזרים + `ExtMethodName` union + `ExtParams<M>`/`ExtResult<M>` | מיגרציה של rename ל-ext (היום host.rename — follow-up) |
| exports map: `./extensions` | capability-frame delivery (A/B — slice FE) |
| host.ts: ולידציית params ל-`_drive/setThinkingTokens` מול הסכמה (גבול לא-אמין) | שינוי ה-`callExt(string, Record)` הגנרי (נשאר transport נמוך) |

## §3 — מימוש

### א. `extensions/schema.ts`
```ts
import { type } from "arktype"

/** רישום ה-ext methods האחיד. כל הרחבה חדשה = שורה כאן (מקור-אמת יחיד). */
export const extMethods = {
  "_drive/setThinkingTokens": {
    // n: number | null — null = ביטול-תקרה (no-limit). ה-SDK setMaxThinkingTokens(n: number|null) מקבל null.
    // 🔴 avigail: schema חייב לאפשר null, אחרת בקשת-null תקינה נדחית.
    params: type({ sessionId: "string", n: "number | null" }),
    result: type({ ok: "true" }),
  },
  // compact / setMcpServers / ... יתווספו כאן ב-slices הבאים
} as const

export type ExtMethodName = keyof typeof extMethods
```

### ב. `extensions/types.ts`
```ts
import type { extMethods, ExtMethodName } from "./schema.js"
export type ExtParams<M extends ExtMethodName> = (typeof extMethods)[M]["params"]["infer"]
export type ExtResult<M extends ExtMethodName> = (typeof extMethods)[M]["result"]["infer"]
/** ולידציה בגבול — מחזיר params מטופס או זורק. */
export function parseExtParams<M extends ExtMethodName>(method: M, raw: unknown): ExtParams<M> { /* extMethods[method].params(raw) → on errors throw */ }
```
> ⚠️ ESM `.js` בייבוא. ArkType v2 (2.2.0): `.infer` על ה-`type(...)` — inference דרך `as const` **אומת עובד** (avigail), §7 הוא רק fallback-זהירות תיאורטי.

### ג. host.ts — ולידציה בגבול
ב-handler `_drive/setThinkingTokens` (host.ts:**192-202**): במקום `params as {sessionId, n}` — `const { sessionId, n } = parseExtParams("_drive/setThinkingTokens", params)`. params לא-תקין → שגיאה ברורה (RequestError) **לפני** שמגיע ל-query. (n יכול להיות null — תקין, מועבר כמו-שהוא ל-setMaxThinkingTokens.)

### ד. exports + NormalizedCapabilities
- `package.json` exports: `"./extensions": "./src/extensions/index.ts"` (barrel: schema + types).
- **תיעוד** (לא מימוש): NormalizedCapabilities key ↔ ext method (`thinkingTokens` ↔ `_drive/setThinkingTokens`). גזירה-מהסכמה = follow-up; כאן רק מיישרים את השמות + הערה.

## §4 — Commits

0. arktype dep + `extensions/{schema,types,index}.ts` + exports `./extensions`. typecheck + `pnpm install`. **TDD**: schema מאמת params תקין; דוחה (חסר `n` / טיפוס שגוי / sessionId לא-string).
1. host.ts: `parseExtParams` ב-handler + extraction מטופס. test: params לא-תקין → שגיאה (לא מגיע ל-query); תקין → מבצע. findings + walkthrough.

## §5 — DoD

| # | בדיקה |
|---|------|
| 1 | typecheck + tests ירוקים |
| 2 | `@drive-coding/provider/extensions` ניתן-לייבוא (subpath); `extMethods` + טיפוסים מיוצאים |
| 3 | `_drive/setThinkingTokens` מאמת params — לא-תקין → שגיאה ברורה, **לא** מגיע ל-query |
| 4 | ArkType (לא zod/ידני); גרסה = core (`^2.0.0`) |
| 5 | additive — רק `packages/provider/**` + `docs/**` |
| 6 | הסכמה = מקור-אמת: הוספת method = שורה אחת (דפוס מתועד ב-walkthrough) |

## §6 — Risks

| סיכון | מיטיגציה |
|---|---|
| arktype גרסה ≠ core | נעל `^2.0.0` (DoD#4) |
| ext-schema ב-provider או core? | **provider** — זה חבילת-החוזה המשותפת FE/BE; core נשאר IO-free, provider טיפוסים-טהורים גם |
| over-typing — שבירת ה-callExt הגנרי | `callExt(string, Record)` נשאר transport נמוך; הסכמה מאמתת בגבול ה-handler בלבד |
| ArkType v2 inference דרך `as const` | §7 — fallback ל-per-method exported schemas |

> 3 שנשכחים: ESM `.js` · lint:i18n (provider לא נסרק אבל אין עברית בקוד) · `pnpm install` אחרי dep.

## §7 — Escalation
- inference דרך `as const` **אומת עובד** ב-arktype 2.2.0 (avigail) — לא צפוי. אם בכל זאת יתגלה gap → fallback: schema פר-method (`setThinkingTokensParams = type({...})`) במקום map יחיד. פונקציונליות זהה, DX פחות נקי.

## §8 — Complexity: 4/10 → calev light (schema+validation; האמת מ-unit tests + import-check).

## §9 — שאלות פתוחות

| # | שאלה | ברירת-מחדל | חוסם? |
|---|------|----------|------|
| 1 | schema ב-provider/extensions או core? | provider (חוזה משותף; FE+BE כבר תלויים) | ❌ |
| 2 | ולידציית result גם בצד-לקוח? | בהמשך (FE facade); כאן גבול-שרת בלבד | ❌ |
| 3 | rename → ext עכשיו? | לא — host.rename נשאר; מיגרציה ל-`_drive/rename` = follow-up אחיד | ❌ |
