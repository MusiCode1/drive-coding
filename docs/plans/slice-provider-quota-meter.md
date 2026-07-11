# Slice — provider-quota-meter — מד מכסת-מנוי רב-ספקי — בריף

> **תאריך**: 2026-07-11
> **סוג מסמך**: בריף ביצועי לסלייס — לא תוכנית טרום-בריף
> **סטטוס**: ⛔ **SUPERSEDED** (2026-07-11) → מוזג ל-**`slice-session-budget-meter.md`** (מכסה + מלאות-קונטקסט ב-popover אחד). אל תבצע את ה-slice הזה. תוכנו (חלק-המכסה) הועתק מאומת ל-session-budget.
> **אימות אביגיל**: READY (r2) — נשמר כ-reference; לא ל-dispatch.
> **Dispatch**: מותר לאליעזר רק אם `אימות אביגיל = READY`.
> **Complexity**: 5/10 (verifier: light + phase על Commit 0 ו-Commit 3)
> **תלויות (`depends_on`)**: []
> **Base**: dev
> **Dev tip**: `be4cd695`

---

## §0 — Pre-flight

> env קבוע (ports/OneCLI/tunnel/hooks/preview) → `AGENTS.md`. פרוטוקול executor גנרי → סוכן `eliezer`.
> כאן רק מה שספציפי ל-slice.

### תלויות (חובה!)
**אין תלויות** — נבנה ישירות על dev. additive בלבד (ext method חדש, שדה VM חדש, רכיב UI חדש).
נוגע ב-`agent-session.svelte.ts` (worktrees פעילים אחרים עליו) → **הישאר additive, אל תשנה signatures קיימים**. קרא `docs/conventions/parallel-safe-code.md`.

### מנגנון (מאומת בקוד — 2026-07-11)
drive-coding מריץ claude דרך **מתאם ACP מעל ה-Claude Agent SDK**:
```
FE ──ACP ext-method──► adapter (@agentclientprotocol/claude-agent-acp@0.52.0, upstream Zed)
                          └─► @anthropic-ai/claude-agent-sdk@0.3.206  (query object, streaming mode)
                                 └─► claude CLI child  (control protocol; get_usage חי כאן)
```
גרסת ה-SDK: root `overrides` (+`pnpm.overrides`) מצהירים `0.3.206`; **`bun.lock` נפתר ל-0.3.206, אך `pnpm-lock.yaml` עדיין ל-0.3.191** (lock מיושן). ה-method קיים ב**שתי** הגרסאות → הפיצ'ר עובד בכל מקרה (executor: אם pnpm מושך 0.3.191, זה תקין; guard על התשובה ממילא).

ה-SDK **חושף method ציבורי** שעוטף בדיוק את `get_usage` (מאומת ב-`node_modules/.../claude-agent-sdk/sdk.d.ts` + `sdk.mjs`):
```ts
// Query interface — "structured data behind the /usage command … plan rate-limit utilization windows"
usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(): Promise<SDKControlGetUsageResponse>
// impl: async(){ return (await this.request({subtype:"get_usage"})).response }
```
ו-drive-coding **כבר מגיע** ל-`query` החי דרך `getQuery(agent, sessionId)` (`query-access.ts`) וכבר קורא method-אח (`setMaxThinkingTokens`) דרך `_drive/setThinkingTokens`. **אותו דפוס בדיוק — method אחר. אין צורך ב-fork, אין spawn של CLI, אין תיקון SDK.**

> ⚠️ **התיקון מ-2026-07-11**: העץ הזה מריץ את ה-adapter ה-**upstream (Zed 0.52.0)**, לא את ה-fork של MusiCode1. ה-fork קיים אבל לא-מוזג (github-dep ל-spike של subagent בלבד). הפיצ'ר הזה **לא תלוי ב-fork**.

### Worktree
```bash
cd /home/user/Projects/drive-coding
git worktree add .worktrees/provider-quota-meter -b slice/provider-quota-meter dev
cd .worktrees/provider-quota-meter && pnpm install && pnpm hooks:install
```

### איך להריצים
- BE: `cd packages/backend && PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts`
- FE: `pnpm --filter @drive-coding/frontend dev` (port OS-assigned; `BE_PORT=4000` ברירת-מחדל)
- typecheck: `pnpm --filter @drive-coding/frontend typecheck` · `pnpm --filter @drive-coding/provider typecheck`
- tests: `pnpm --filter @drive-coding/provider test` · `pnpm --filter @drive-coding/frontend test`
- i18n: `pnpm lint:i18n`
- **Preview (pre-merge gate)**: build מלא, לא HMR — ראה `AGENTS.md` §Preview rules.

### Browser
linux-gui Chrome :9222 (profile voice-acp), `playwright-cli -s=vacp attach --cdp=http://localhost:9222`. Mock ל-UI ללא BE: `/chat?mock=greeting`.

### OneCLI agent
`voice-acp` — מזריק credentials ל-TTS/translate proxy. **לא** מזריק Anthropic (claude רץ על auth משלו).

### Reading list
**must-read**:
- `packages/provider/src/extensions/schema.ts` + `providers/claude/query-access.ts` — התקדים המדויק `_drive/setThinkingTokens` → `getQuery().setMaxThinkingTokens()`
- `packages/frontend/AGENTS.md` — 5 שכבות + logical-CSS/RTL
- `node_modules/.../@anthropic-ai/claude-agent-sdk/sdk.d.ts` — `Query.usage_EXPERIMENTAL…`, `SDKControlGetUsageResponse`, `SDKRateLimitInfo`

**reference**:
- `docs/plans/slice-context-window-meter.md` — reference לדפוס מד-UI (⚠️ **brief בלבד, לא מוזג** — אין שדה `usage` ב-VM ואין רכיב meter קיים; שם PUSH `used/size`, כאן PULL מכסה — פיצ'ר נפרד)
- `PROTOCOL.md` (repo provider-abstraction) §"Usage Query (`get_usage`)" — צורת ה-`rate_limits` האמיתית

---

## §1 — מטרה

המשתמשת רואה בממשק **כמה מהמכסה שלה נשארה** — אחוז-ניצול לחלון 5-השעות ולחלון השבועי (למשל "5h: 8% · שבועי: 14%"), עם זמן-איפוס. הנתון נשלף על-פי-דרישה מהספק הפעיל (claude → SDK `usage_EXPERIMENTAL…()`), ומוצג רק כשהספק תומך. ספק שלא תומך → אין מד (לא שגיאה).

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| מד מכסת-מנוי (5h% + weekly%) עבור **claude** — PULL | ✅ | ה-slice הזה |
| ext method רב-ספקי `_drive/getUsage` + טיפוס מנורמל `QuotaSnapshot` | ✅ | ה-slice הזה |
| הפקודה הספציפית-ל-claude (`usage_EXPERIMENTAL…` → normalize) בקובץ claude בלבד | ✅ | ה-slice הזה |
| gating לפי `supports.usage` (ספק לא-תומך → אין מד) | ✅ | ה-slice הזה |
| **push חי דרך fork** (`rate_limit_event` → `_drive/rateLimit` ext-notification) | ❌ | **slice המשך** — רק אם/כשמאמצים את ה-fork של subagent; forward ממוקד, לא blanket (§9 Q5) |
| **codex** (`account/rateLimits/read`) — fetch בקובץ codex-ספציפי, אותו `QuotaSnapshot` | ❌ | slice עתידי |
| **opencode** usage | ❌ | slice עתידי (`capabilities.usage=false` → מד ריק) |
| polling אוטומטי / התראות-סף | ❌ | slice עתידי |
| מד חלון-הקשר (`used/size`) | ❌ | `context-window-meter` (פיצ'ר נפרד, PUSH) |
| הרמת `QuotaSnapshot` ל-provider-contract | ❌ | future (כרגע FE-local, §9 Q1) |

> **אזהרת שם**: קיים כבר `usage` subsystem = **מדידת עלות TTS** (`packages/backend/src/usage/*`, `/api/usage/summary`). **אל תיגע ואל תשתמש בשמות האלה.** namespace הפיצ'ר = `quota`. (הדגל `capabilities.usage` הוא היחיד המשותף — הוא ה-gate.)

---

## §3 — Architecture diagram

```
┌──────────────────────────────┐
│ QuotaMeter.svelte  (חדש, FE) │  gate: {#if session.supports.usage && session.quota}
└──────────────┬───────────────┘
               │ reads session.quota (QuotaSnapshot | null)
┌──────────────▼───────────────┐
│ agent-session.svelte.ts      │  + quota = $state<QuotaSnapshot|null>(null)   (additive)
│  + #refreshQuota()           │  + reset ב-#captureSessionConfig
└──────────────┬───────────────┘
               │ this.#ext.getUsage(sessionId)   (PULL / ext-RPC)
┌──────────────▼───────────────┐
│ adapters/ext.ts  ExtClient   │  + getUsage(sessionId): Promise<QuotaSnapshot|null>  (חדש)
└──────────────┬───────────────┘
               │ client.extMethod("_drive/getUsage", {sessionId})   (JSON-RPC, id-correlated)
┌──────────────▼───────────────┐
│ BE ws-agent.ts (dumb pipe)   │   ללא שינוי
└──────────────┬───────────────┘
               ▼
┌───────────────────────────────────────────────────────────┐
│ packages/provider — claude handler                         │
│  connect-in-process.ts + in-process-host.ts:               │  agentApp.onRequest("_drive/getUsage")
│   getQuery(agent,sessionId)                                │
│     .usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS…()  │  → SDKControlGetUsageResponse
│   → normalizeClaudeQuota(res) → QuotaSnapshot|null         │  ← קובץ claude-ספציפי
└───────────────────────────────────────────────────────────┘
   extensions/schema.ts: extMethods += _drive/getUsage   (one line)
   capabilities.ts: mapClaudeCapabilities.usage → true
```

---

## §4 — Commits בסדר

### Commit 0 — CONFIRM (light): האם ה-auth שלנו מחזיר rate_limits אמיתי (approach: manual)

> נגישות ה-method **מאומתת סטטית** (§0). ה-spike כאן צר: **זמינות-נתון בריצה חיה** — לא אם אפשר לקרוא, אלא אם חוזר משהו.

**המטרה — סיכון-החיוב:** ה-roadmap מסמן ש-claude דרך ACP/SDK **יוצא מ-pool המנוי** → ייתכן שה-`usage_EXPERIMENTAL…()` יחזיר `rate_limits_available:false` / `rate_limits:null` על ה-auth שלנו (כמו API-key/Bedrock/Vertex). אם כך — המד תמיד ריק והפיצ'ר מיותר בנתיב הזה.

**צעדים:**
1. הרץ BE (claude in-process, turn קצר אמיתי). קרא `getQuery(agent, sessionId).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` (harness זמני / לוג בתוך handler).
2. **לכוד את התשובה המדויקת בריצה** (ה-method מסומן unstable — ודא ש-`SDKControlGetUsageResponse` בפועל תואם ל-`sdk.d.ts`): `subscription_type`, `rate_limits_available`, `rate_limits.five_hour/seven_day.{utilization,resets_at}`.
3. תעד ב-walkthrough.

**🛑 שער-החלטה:**
- `rate_limits_available:true` עם ערכי-utilization → המשך ל-Commit 1. תעד את הצורה.
- `rate_limits_available:false` על ה-auth שלנו → **עצור, דווח למרדכי.** זה ממצא-חיוב (הפיצ'ר ריק בנתיב ה-SDK), לא באג — ההחלטה (לזנוח / להתנות בסוג-auth / להציג cost-per-turn במקום) היא של מרדכי.

**DoD Commit 0:** walkthrough מציין "`rate_limits_available=<bool>`, five_hour=<utilization>, seven_day=<utilization>" מריצה חיה.

---

### Commit 1 — provider: ext method `_drive/getUsage` + claude handler + capability (approach: integration + unit)

**קבצים שמשתנים:**
- `packages/provider/src/extensions/schema.ts` — הוסף רשומה ל-`extMethods` (L13) לצד `_drive/setThinkingTokens`. **⚠️ params ו-result חייבים להיות סכמות ArkType** (`type(...)`), בדיוק כמו הרשומה הקיימת (`params: type({...}), result: type({...})`) — לא interface של TS. הגדר גם את סכמת `quotaSnapshot` כאן (או בקובץ אחות בתוך `extensions/`) והסק ממנה את הטיפוס:
```ts
import { type } from "arktype"
export const quotaWindow = type({ utilizationPct: "number", resetsAt: "string | null" })
export const quotaSnapshot = type({ "session?": quotaWindow, "weekly?": quotaWindow, provider: "string" })
export type QuotaSnapshot = typeof quotaSnapshot.infer   // ArkType → TS (קונבנציית הפרויקט)
// ברשומת extMethods:
"_drive/getUsage": { params: type({ sessionId: "string" }), result: quotaSnapshot.or("null") },
```
- `packages/provider/src/extensions/index.ts` — ייצא את `QuotaSnapshot` (ו-`quotaSnapshot` אם צריך) מה-barrel, כדי שה-FE יוכל לייבא דרך ה-subpath הקיים `@drive-coding/provider/extensions` (⚠️ **אין export subpath לקבצים שרירותיים** ב-`packages/provider/package.json` — הטיפוס חייב לצאת ממודול מיוצא. ראה `exports` בקובץ).
- `packages/provider/src/extensions/types.ts` — אם `ExtParams`/`ExtResult`/`parseExtParams` (L26) נגזרים אוטומטית מ-`extMethods` — אין מה לשנות; אחרת הרחב לפי הדפוס.
- `packages/provider/src/providers/claude/query-access.ts` — הרחב את ה-interface הלוקאלי `SessionRecord.query` (L18-22) כך שיצהיר גם על `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(): Promise<SDKControlGetUsageResponse>` (structural — הצהר רק את השדות שנצרוך; אל תייבא את טיפוס ה-Query של ה-SDK, עקבי עם ההערה הקיימת "climbs only the method we call").
- `packages/provider/src/connection/connect-in-process.ts` — handler חדש ל-`_drive/getUsage` **במקביל** ל-`_drive/setThinkingTokens` (~L227): `getQuery(agent, sessionId).usage_EXPERIMENTAL…()` → `normalizeClaudeQuota(res)`.
- `packages/provider/src/providers/claude/in-process-host.ts` — handler מקביל בנתיב ה-host (~L209; `ExtHandlers` L73).
- `packages/provider/src/providers/claude/capabilities.ts` — ב-`mapClaudeCapabilities` (~L36) הפוך `usage` ל-`true` (הדגל `NormalizedCapabilities.usage`, `types.ts:19`).

**קבצים חדשים:**
- `packages/provider/src/providers/claude/quota.ts` — **הקובץ ה-claude-ספציפי** (provider-internal — לא מיובא ע"י FE, לכן לא צריך export subpath). `normalizeClaudeQuota(res): QuotaSnapshot | null`. זה המקום היחיד שמכיר את `SDKControlGetUsageResponse` (`five_hour`/`seven_day`/`utilization`/`resets_at`) וממפה ל-`QuotaSnapshot` המנורמל (`utilizationPct`/`resetsAt`).

> הטיפוס `QuotaSnapshot` **אינו** קובץ נפרד — הוא נגזר מסכמת ArkType ב-`extensions/` ומיוצא משם (ראה "קבצים שמשתנים"). זה פותר גם את חוזה-הרישום (ArkType) וגם את ה-import מה-FE.

**API skeleton:**
```ts
// packages/provider/src/providers/claude/quota.ts
import type { QuotaSnapshot } from "../../extensions"  // ArkType-inferred
export function normalizeClaudeQuota(res: SDKControlGetUsageResponse): QuotaSnapshot | null
// res.rate_limits_available===false || res.rate_limits==null → null (לא זורק)
// utilization/resets_at חסרים בחלון → החלון מושמט
```

**testing (integration + unit):** unit טהור ל-`normalizeClaudeQuota` (מ-fixture אמיתי של Commit 0 → QuotaSnapshot; `rate_limits_available:false` → null; שדה חסר → null/השמטה בלי לזרוק). integration ל-`_drive/getUsage` אם קיים harness ל-ext ב-provider tests.

**Verification:** `pnpm --filter @drive-coding/provider typecheck && pnpm --filter @drive-coding/provider test`

---

### Commit 2 — FE state: ext facade + VM + normalized quota (approach: tdd)

**קבצים שמשתנים:**
- `packages/frontend/src/lib/adapters/ext.ts` — הוסף ל-`ExtClient` (L16-35) method `getUsage(sessionId): Promise<QuotaSnapshot | null>` בדפוס `setThinkingTokens` (L30-33): `parseExtParams("_drive/getUsage", …)` → `client.extMethod("_drive/getUsage", {sessionId})`. יבוא: `import type { QuotaSnapshot } from "@drive-coding/provider/extensions"`.
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts`:
  - יבוא `QuotaSnapshot` מ-`@drive-coding/provider/extensions`.
  - שדה **additive** `quota = $state<QuotaSnapshot | null>(null)` (ליד `configOptions`/`modes`/`models`).
  - method **additive** `#refreshQuota()`: אם **`this.supports.usage`** (ה-getter הלא-null ב-L178, **לא** `capabilities` שהוא nullable) → `this.quota = await this.#ext?.getUsage(this.sessionId)` (guard על `#ext`+sessionId; try/catch → משאיר null, לא מפיל). קרא (א) פעם אחרי `connected`, (ב) בסוף כל turn. **אל תשנה signatures קיימים.**
  - **reset**: `this.quota = null` ב-`#captureSessionConfig` (L1312) — ליד האיפוסים הקיימים שם (`configOptions`/`models`/`modes`/`availableCommands`). ⚠️ **אין** שדה `usage` לאפס לצדו (context-window-meter לא מוזג).

**testing (tdd):** ext-mock שמחזיר `QuotaSnapshot`: אמת ש-`refreshQuota` מציב `quota` כש-capability true; שלא קורא ל-ext כש-false; reset בסשן חדש; ext שנכשל → `quota` נשמר/null בלי לזרוק.

**Verification:** `pnpm --filter @drive-coding/frontend typecheck && pnpm --filter @drive-coding/frontend test`

---

### Commit 3 — UI: רכיב מד-מכסה (approach: integration + manual)

**קבצים חדשים:**
- `packages/frontend/src/lib/components/QuotaMeter.svelte` — קלט `quota: QuotaSnapshot` (יבוא הטיפוס מ-`@drive-coding/provider/extensions`). לכל חלון קיים (session/weekly) בר/תווית אחוז + tooltip עם `resetsAt` (פורמט יחסי — בדוק helper ב-`packages/core` לפני כתיבה). **logical-CSS בלבד** (RTL). חלון חסר → לא מרונדר.

**קבצים שמשתנים:**
- שיבוץ ליד הרכיב שמחזיק את ה-`AgentSession` ומציג `SessionOptionsPanel`/`session.modes`: `{#if session.supports.usage && session.quota}<QuotaMeter quota={session.quota} />{/if}` (ה-getter הלא-null `supports`, לא `capabilities`).
- **i18n**: כל מחרוזת גלויה → `packages/core/src/i18n/catalogs/he.ts`. `pnpm lint:i18n`.

**testing:** component test (mount עם `QuotaSnapshot`, אמת בר/אחוז/טקסט לשני החלונות; חלון חסר לא מרונדר). manual ב-preview.

**DoD Commit 3:** typecheck ✓, `lint:i18n` ✓, מד מוצג עם claude, ריק/מוסתר בספק לא-תומך, RTL תקין.

---

### Commit 4 — calev light (approach: none — verifier)
מרדכי מפעיל את כלב (light) + verifier-phase על Commit 0 (data-confirm) ו-Commit 3 (UI). אליעזר לא ממזג.

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck (provider+frontend) | `pnpm --filter @drive-coding/provider typecheck && pnpm --filter @drive-coding/frontend typecheck` |
| 2 | tests | `pnpm --filter @drive-coding/provider test && pnpm --filter @drive-coding/frontend test` |
| 3 | lint:i18n | `pnpm lint:i18n` |
| 4 | data-confirm מתועד | walkthrough מציין `rate_limits_available` + ערכי-utilization מריצה חיה (Commit 0) |
| 5 | מד עובד עם claude | preview חי: פתח סשן claude, שלח turn, ודא מד מציג 5h%/weekly% |
| 6 | ספק לא-תומך = אין מד | opencode (`supports.usage=false`) → אין רכיב, אין שגיאה |
| 7 | RTL + mobile/desktop | screenshot 2 viewports |
| 8 | regression: `_drive/setThinkingTokens` עדיין עובד (אותו ext channel) | preview: שנה thinking-tokens, ודא שעובד |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| ה-auth שלנו מחזיר `rate_limits_available:false` (מד תמיד ריק) | roadmap billing risk | **Commit 0 data-confirm** → אם false, עצירה+דיווח למרדכי |
| ה-method `usage_EXPERIMENTAL…` unstable (שם/צורה עלולים להשתנות) | sdk.d.ts | root `overrides` מצהיר `0.3.206`; **bun.lock=0.3.206 אך pnpm-lock.yaml=0.3.191** — ה-method קיים בשתיהן, אז לא חוסם; guard על התשובה (`rate_limits_available` + null-checks) + normalizer סובלני; אם יתייצב-שם — עדכון נקודתי |
| התנגשות-שם עם `usage` של TTS-cost | Explore | namespace `quota`; לא נוגעים ב-`packages/*/usage/*` |
| שינוי signature ב-`agent-session.svelte.ts` שובר worktree מקביל | parallel-safe-code | **additive בלבד** |
| Hardcoded Hebrew | learnings | pre-commit hook + `pnpm lint:i18n` |
| Svelte 5 reactivity על אובייקט מקונן | learnings | `$state` על `quota`; קריאה `session.quota.session?.utilizationPct` |

---

## §7 — Escalation triggers
- Commit 0: `rate_limits_available:false` על ה-auth שלנו → **עצור, דווח למרדכי** (ממצא-חיוב).
- התשובה בפועל שונה מהותית מ-`SDKControlGetUsageResponse` שב-`sdk.d.ts` → הכרעת-מיפוי למרדכי.
- מתברר שדרוש fork/patch כלשהו (לא צפוי — §0) → מרדכי.
- כל חריגה מ-Testing strategy.

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| Protocol/contract חדש (`_drive/getUsage` + normalized QuotaSnapshot) | +2 |
| Cross-store data flow חדש (provider→WS→FE VM→UI) | +2 |
| >5 files ב->2 packages (provider+frontend+core i18n) | +1 |
| ext-RPC async coordination (pull + reset) | +1 |
| Greenfield (אין call-sites קיימים) · דפוס `setThinkingTokens` מוכח | -1 |
| חלק ניכר TDD (normalizer טהור + VM) | -1 |

**Score**: **5/10**. הנגישות מאומתת סטטית (אין סיכון-reachability); הסיכון היחיד שנותר צר — **זמינות-נתון-חיוב** (Commit 0).

**Tier**: 4-7 → `calev` (light) + **verifier-phase על Commit 0 ו-Commit 3**.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל / הכרעה | חוסם? |
|---|------|----------|------|
| 1 | `QuotaSnapshot` — FE-local או provider-contract? | **FE-local ל-MVP** (החלטת מרדכי 2026-07-11) | ❌ |
| 2 | מתי שולפים? | **on-demand + רענון בסוף turn** (החלטת מרדכי 2026-07-11; pull, בלי polling) | ❌ |
| 3 | מיקום ה-UI המדויק | ליד `SessionOptionsPanel`/header הצ'אט | ❌ |
| 4 | האם ה-SDK query חושף get_usage | **פתור** — `usage_EXPERIMENTAL…()` ציבורי (§0) | ✅→פתור |
| 5 | push חי דרך fork | **נדחה ל-slice המשך** (מרדכי 2026-07-11) — רק אם מאמצים fork של subagent; forward ממוקד של `rate_limit_event`, לא blanket | ❌ |

---

## סטיות מהתכנון (מתעדכן ע"י executor תוך כדי)

- ...
