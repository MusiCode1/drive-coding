# Slice — session-budget-meter — מד תקציב-סשן (קונטקסט + מכסה) — בריף

> **תאריך**: 2026-07-11
> **סוג מסמך**: בריף ביצועי לסלייס
> **סטטוס**: מאושר (אביגיל READY r2)
> **אימות אביגיל**: **READY** (r1 USABLE-AFTER-FIX: cost-flicker + line-number → תוקנו; r2 READY 0-findings · דוח: `reports/drive-coding/slice-session-budget-meter-avigail.md`)
> **Dispatch**: מותר לאליעזר רק אם `אימות אביגיל = READY`.
> **Complexity**: 7/10 (verifier: light + phase על Commit 0 ו-Commit 4)
> **תלויות (`depends_on`)**: []
> **Base**: dev
> **Dev tip**: `22b57b9b`
> **מחליף**: `slice-provider-quota-meter.md` (מקפל אותו + את `slice-context-window-meter.md` הישן ל-slice אחד)

---

## §0 — Pre-flight

> env קבוע → `AGENTS.md`. פרוטוקול executor → `eliezer`. כאן רק מה שספציפי ל-slice.

### תלויות (חובה!)
**אין תלויות** — ישירות על dev. additive בלבד. נוגע ב-`agent-session.svelte.ts` (worktrees מקבילים) → **הישאר additive, אל תשנה signatures**. קרא `docs/conventions/parallel-safe-code.md`.

### שני מנגנוני-נתון (מאומת בקוד 2026-07-11)
```
FE popover "תקציב-סשן"
 ├── קונטקסט  ← PUSH: ACP usage_update (adapter 0.52.0 פולט; FE-only)
 └── מכסה     ← PULL: _drive/getUsage → SDK query.usage_EXPERIMENTAL…() (provider ext)
```
- **קונטקסט (push)**: האדפטר `@agentclientprotocol/claude-agent-acp@0.52.0` פולט `usage_update` ב-4 מקומות (mid-stream, סוף-turn `result`, `compact_boundary`, `rate_limit_event`), payload `{used, size, cost:{amount,currency}}`. בסוף-turn `used`=טוקני-ה-turn (input+cache+output); ב-`compact_boundary` `used`=`getContextUsage().totalTokens` הסמכותי. מגיע ל-FE `#onSessionUpdate` אבל **נזרק** ב-guard `if (!text) return`. → צריך ענף FE בלבד. **`% מלא = used/size`.**
- **מכסה (pull)**: ה-SDK (`@anthropic-ai/claude-agent-sdk@0.3.206`) חושף method ציבורי `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(): Promise<SDKControlGetUsageResponse>` (`rate_limits.{five_hour,seven_day}.{utilization,resets_at}`). נגיש דרך `getQuery()` — אותו דפוס כמו `_drive/setThinkingTokens`. **בלי fork.**

> ⚠️ גרסת SDK: root `overrides` מצהיר `0.3.206`; `bun.lock`=0.3.206 אך `pnpm-lock.yaml`=0.3.191 — ה-method קיים בשתיהן. האדפטר הוא upstream Zed 0.52.0 (לא fork).

### Worktree
```bash
cd /home/user/Projects/drive-coding
git worktree add .worktrees/session-budget-meter -b slice/session-budget-meter dev
cd .worktrees/session-budget-meter && pnpm install && pnpm hooks:install
```

### איך להריצים
- BE: `cd packages/backend && PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts`
- FE: `pnpm --filter @drive-coding/frontend dev`
- typecheck/test: `pnpm --filter @drive-coding/{provider,frontend} typecheck|test` · i18n: `pnpm lint:i18n`
- **Preview = build מלא (לא HMR)** — `AGENTS.md` §Preview rules.

### Browser
linux-gui Chrome :9222 (voice-acp). Mock: `/chat?mock=greeting`.

### Reading list
**must-read**:
- `packages/provider/src/extensions/schema.ts` + `providers/claude/query-access.ts` — תקדים `_drive/setThinkingTokens` (המכסה מעתיקה אותו)
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — `#onSessionUpdate` (L1497), ענפי non-text קיימים (`current_mode_update`/`available_commands_update`), text guard `if (!text) return` (L1582)
- `packages/frontend/AGENTS.md` — 5 שכבות + logical-CSS/RTL

**reference**:
- `docs/plans/slice-context-window-meter.md` (brief ישן, לא מוזג — reference לגישת push; ה-spike שלו עובר עכשיו)
- `sdk.d.ts` — `SDKControlGetUsageResponse`, `usage_EXPERIMENTAL…`
- overlay precedent: `components/layout/SessionOptionsPanel.svelte`, `components/modals/*` (bits-ui)

---

## §1 — מטרה

המשתמשת רואה בהדר-הצ'אט **מד קטן** של מלאות-הקונטקסט (% מחלון-ההקשר). **לחיצה עליו פותחת popover "תקציב-סשן"** (read-only) עם: (א) קונטקסט — used/size + % + עלות מצטברת; (ב) מכסת-מנוי — 5h% ושבועי% + זמן-איפוס (רק אם הספק תומך). כך היא יודעת גם כמה מהסשן מלא (מתי לדחוס) וגם כמה מהמנוי נשאר — במקום אחד.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| מד-קונטקסט (%) בהדר, PUSH מ-`usage_update` | ✅ | ה-slice הזה |
| popover "תקציב-סשן" (read-only) — קונטקסט + מכסה | ✅ | ה-slice הזה |
| מכסה (5h/weekly) PULL דרך `_drive/getUsage`, gated `supports.usage` | ✅ | ה-slice הזה |
| הפקודות הספציפיות בקבצים ספציפיים (`providers/claude/quota.ts`) + טיפוסים מנורמלים | ✅ | ה-slice הזה |
| **כפתור "דחוס עכשיו" ב-popover** | ❌ | **fast-follow** (`/compact` או `_drive/compact` — wiring נפרד + confirm) |
| פירוק-קטגוריות של קונטקסט (system/tools/MCP מ-`getContextUsage()`) | ❌ | future (pull אופציונלי) |
| codex/opencode usage · polling · sound alerts | ❌ | slice עתידי |
| הרמת הטיפוסים ל-provider-contract | ❌ | future (FE-local ל-MVP) |

> **אזהרת שם**: קיים `usage` subsystem = **עלות TTS** (`packages/backend/src/usage/*`). namespace הפיצ'ר = `context`/`quota`/`budget`. הדגל `capabilities.usage` הוא ה-gate של המכסה בלבד.

---

## §3 — Architecture diagram

```
┌───────────────────────────────────────┐
│ SessionBudgetMeter.svelte  (הדר, חדש) │  מציג context% ; click → popover
│   {#if session.context} … {/if}       │
└───────────────┬───────────────────────┘
      click ▼                       reads session.context / session.quota
┌───────────────────────────────────────┐
│ SessionBudgetPopover.svelte (חדש)     │  read-only. on-open → session.refreshQuota()
│   קונטקסט: used/size/% (+cost)        │
│   מכסה: 5h%/weekly%  {#if supports.usage && quota}
└───────────────┬───────────────────────┘
                │
┌───────────────▼───────────────────────┐
│ agent-session.svelte.ts (VM, additive)│
│  context = $state<Ctx|null>(null)      │ ← PUSH: #onSessionUpdate ענף usage_update
│  quota   = $state<QuotaSnapshot|null>  │ ← PULL: #refreshQuota()
│  reset שניהם ב-#captureSessionConfig   │
└──────┬───────────────────────┬─────────┘
   push│ (FE-only)         pull│ this.#ext.getUsage(sessionId)
┌──────▼──────┐          ┌──────▼───────────────────────────────┐
│ ACP         │          │ adapters/ext.ts  getUsage()          │
│ usage_update│          │  → client.extMethod("_drive/getUsage")│
│ (BE dumb-   │          └──────┬───────────────────────────────┘
│  pipe)      │                 ▼  provider: getQuery().usage_EXPERIMENTAL…()
└─────────────┘          providers/claude/quota.ts  normalizeClaudeQuota()
```

---

## §4 — Commits בסדר

### Commit 0 — CONFIRM: מכסה זמינה על ה-auth שלנו (approach: manual, gate)

> רק ה**מכסה** בסיכון. הקונטקסט אמין (usage_update מאומת נפלט) — לא צריך spike.

**המטרה (סיכון-חיוב):** claude דרך SDK עלול לצאת מ-pool המנוי → `usage_EXPERIMENTAL…()` עלול להחזיר `rate_limits_available:false`. אם כן — חלק-המכסה ב-popover ריק (הקונטקסט לא מושפע).
1. ריצה חיה: `getQuery(agent, sessionId).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`.
2. לכוד `subscription_type`, `rate_limits_available`, `rate_limits.five_hour/seven_day.{utilization,resets_at}`.
3. תעד ב-walkthrough.

**🛑 שער:** `true` → בנה חלק-מכסה (Commits 2-3). `false` → **דלג על חלק-המכסה** (בנה רק קונטקסט + popover; המכסה תסומן future), **דווח למרדכי**. הקונטקסט ממשיך תמיד.

**DoD:** walkthrough מציין `rate_limits_available=<bool>` + ערכי-utilization מריצה חיה.

---

### Commit 1 — קונטקסט state (PUSH, FE-only) (approach: tdd)

**קבצים שמשתנים:** `packages/frontend/src/lib/view-models/agent-session.svelte.ts`:
- שדה **additive** `context = $state<{ used: number; size: number; cost?: number } | null>(null)` (ליד `configOptions`/`modes`).
- ב-`#onSessionUpdate` (L1497) — **ענף early-return לפני** ה-`if (!text) return` (L1582), **בדיוק כמו** `current_mode_update`/`available_commands_update` הקיימים (הם early-returns; `usage_update` נושא אין `content.text` ולכן חייב לפני ה-guard):
```ts
if (update.sessionUpdate === "usage_update") {
  const u = update as { used?: number; size?: number; cost?: { amount?: number } | null }
  if (typeof u.used === "number" && typeof u.size === "number") {
    // ⚠️ cost מגיע רק ב-turn-result (1 מ-4 אתרי-פליטה); mid-stream/compact/rate-limit בלי cost.
    // שמר cost קודם כדי שהתצוגה לא תהבהב ל-undefined בין turns:
    this.context = { used: u.used, size: u.size, cost: u.cost?.amount ?? this.context?.cost }
  }
  return
}
```
⚠️ עקוב אחר דפוס ה-cast הרופף הקיים במתודה. `cost` ב-ACP הוא `{amount,currency}` (אובייקט) — שומרים `.amount` בלבד, עם fallback ל-cost הקודם.
- **reset**: `this.context = null` ב-`#captureSessionConfig` (L1312), ליד `configOptions`/`models`/`modes`/`availableCommands`.

**testing (tdd):** הזרק `usage_update` (`{sessionUpdate:"usage_update", used, size, cost:{amount,currency}}`) דרך helper ה-inject הקיים ואמת `session.context === {used,size,cost:amount}`; ערך לא-תקין (חסר `used`) לא מקלקל; reset בסשן חדש.

**Verification:** `pnpm --filter @drive-coding/frontend typecheck && pnpm --filter @drive-coding/frontend test`

---

### Commit 2 — מכסה provider: `_drive/getUsage` + normalizer + capability (approach: integration + unit)

> מותנה ב-Commit 0 = true.

**קבצים שמשתנים:**
- `packages/provider/src/extensions/schema.ts` — הוסף ל-`extMethods` (L13). **params ו-result חייבים סכמות ArkType** (`type(...)`), כמו `_drive/setThinkingTokens`. הגדר `quotaSnapshot` כאן והסק את הטיפוס:
```ts
export const quotaWindow = type({ utilizationPct: "number", resetsAt: "string | null" })
export const quotaSnapshot = type({ "session?": quotaWindow, "weekly?": quotaWindow, provider: "string" })
export type QuotaSnapshot = typeof quotaSnapshot.infer
"_drive/getUsage": { params: type({ sessionId: "string" }), result: quotaSnapshot.or("null") },
```
- `packages/provider/src/extensions/index.ts` — ייצא `QuotaSnapshot` (subpath `./extensions` קיים; **אין export לקבצים שרירותיים** ב-`package.json`).
- `packages/provider/src/providers/claude/query-access.ts` — הרחב את ה-interface הלוקאלי `SessionRecord.query` (L18-22) עם `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(): Promise<SDKControlGetUsageResponse>` (structural — רק השדות שנצרוך).
- `packages/provider/src/connection/connect-in-process.ts` (~L227) + `providers/claude/in-process-host.ts` (~L209) — handler ל-`_drive/getUsage` במקביל ל-`setThinkingTokens`: `getQuery(agent,sessionId).usage_EXPERIMENTAL…()` → `normalizeClaudeQuota(res)`.
- `packages/provider/src/providers/claude/capabilities.ts` (~L36) — `mapClaudeCapabilities.usage → true`.

**קבצים חדשים:**
- `packages/provider/src/providers/claude/quota.ts` — **claude-ספציפי** (provider-internal). `normalizeClaudeQuota(res: SDKControlGetUsageResponse): QuotaSnapshot | null`. `rate_limits_available===false || rate_limits==null → null`; חלון בלי utilization → מושמט. `import type { QuotaSnapshot } from "../../extensions"`.

**testing:** unit ל-`normalizeClaudeQuota` (fixture מ-Commit 0 → QuotaSnapshot; false → null; חסר → null). integration ל-`_drive/getUsage` אם יש harness.

---

### Commit 3 — מכסה FE: facade + VM (approach: tdd)

**קבצים שמשתנים:**
- `packages/frontend/src/lib/adapters/ext.ts` — `ExtClient.getUsage(sessionId): Promise<QuotaSnapshot | null>` בדפוס `setThinkingTokens` (L30-33). `import type { QuotaSnapshot } from "@drive-coding/provider/extensions"`.
- `agent-session.svelte.ts`:
  - יבוא `QuotaSnapshot`; שדה **additive** `quota = $state<QuotaSnapshot | null>(null)`.
  - method **additive** `#refreshQuota()`: אם **`this.supports.usage`** (getter לא-null L178) → `this.quota = await this.#ext?.getUsage(this.sessionId)` (guard; try/catch → null, לא מפיל). קורא **בעת פתיחת ה-popover** (Commit 4) — on-demand.
  - **reset**: `this.quota = null` ב-`#captureSessionConfig` (ליד `context`).

**testing (tdd):** ext-mock → `refreshQuota` מציב `quota` כש-`supports.usage`; לא קורא כש-false; reset; כשל → null בלי לזרוק.

---

### Commit 4 — UI: מד בהדר + popover (approach: integration + manual)

**קבצים חדשים:**
- `packages/frontend/src/lib/components/SessionBudgetMeter.svelte` — מד קטן בהדר: מציג `context` % (`used/size`). **clickable** → פותח את ה-popover. `{#if session.context}` (אחרת לא מרונדר). logical-CSS/RTL.
- `packages/frontend/src/lib/components/SessionBudgetPopover.svelte` — popover (bits-ui, כדפוס `SessionOptionsPanel`/`modals/*`). **read-only**. **on-open → `session.refreshQuota()`** (pull המכסה). מציג:
  - קונטקסט: בר `used/size` + `Math.round(used/size*100)%` + עלות (אם `cost`).
  - מכסה: `{#if session.supports.usage && session.quota}` → 5h%/weekly% + `resetsAt` (פורמט יחסי — בדוק helper ב-`packages/core`). חלון חסר → מושמט.

**קבצים שמשתנים:**
- שיבוץ `SessionBudgetMeter` בהדר-הצ'אט (ליד `SessionOptionsPanel`).
- **i18n**: כל מחרוזת → `packages/core/src/i18n/catalogs/he.ts` → `pnpm lint:i18n`.

**testing:** component test (mount עם `context`+`quota`, אמת בר/אחוז/חלונות; חלון חסר לא מרונדר; click פותח). manual ב-preview.

**DoD:** typecheck ✓, i18n ✓, מד-קונטקסט מוצג ומתעדכן חי, click פותח popover, מכסה מוצגת (או מוסתרת ב-`supports.usage=false`), RTL.

---

### Commit 5 — calev light (approach: none — verifier)
מרדכי מפעיל כלב (light) + verifier-phase על Commit 0 (billing) ו-Commit 4 (UI). אליעזר לא ממזג.

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck (provider+frontend) | `pnpm --filter @drive-coding/{provider,frontend} typecheck` |
| 2 | tests | `pnpm --filter @drive-coding/{provider,frontend} test` |
| 3 | lint:i18n | `pnpm lint:i18n` |
| 4 | קונטקסט חי | preview: שלח turn, ודא מד-הקונטקסט זז |
| 5 | popover | click על המד → popover נפתח, מציג קונטקסט |
| 6 | מכסה (אם Commit 0=true) | popover מציג 5h%/weekly% |
| 7 | ספק לא-תומך = אין מכסה | opencode (`supports.usage=false`) → חלק-המכסה מוסתר, אין שגיאה |
| 8 | RTL + mobile/desktop | screenshot 2 viewports |
| 9 | regression: `_drive/setThinkingTokens` | preview: שנה thinking-tokens |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| מכסה מחזירה `rate_limits_available:false` | roadmap billing | Commit 0 gate; המכסה מוסתרת, הקונטקסט לא מושפע |
| `usage_EXPERIMENTAL…` unstable | sdk.d.ts | override 0.3.206 (bun.lock=206, pnpm-lock=191; method בשתיהן); guard + normalizer סובלני |
| `used` mid-stream תת-מדווח מול תפוסה מלאה | investigation | ל-MVP `used/size` מספיק; ב-`compact_boundary` האדפטר שולח את הסמכותי (`getContextUsage`) ; פירוק-מלא = future pull |
| `size` תת-מדווח במודלי 1M | adapter comment | `size` מגיע מ-`contextWindowSize` של האדפטר (לא מ-getContextUsage) — כבר נכון |
| שם `usage` מתנגש (TTS cost) | Explore | namespace `context`/`quota`/`budget` |
| שינוי signature ב-VM שובר worktree מקביל | parallel-safe | **additive בלבד** |
| Hardcoded Hebrew | learnings | hook + `pnpm lint:i18n` |

---

## §7 — Escalation triggers
- Commit 0 `rate_limits_available:false` → דווח למרדכי (חלק-מכסה future).
- `usage_update` לא מגיע לפועל בריצה חיה (סותר את החקירה) → מרדכי.
- התשובה שונה מהותית מ-`SDKControlGetUsageResponse` → מרדכי.
- כל חריגה מ-Testing strategy.

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| Protocol/contract חדש (`_drive/getUsage` + טיפוסים) | +2 |
| Cross-store data flow ×2 (push + pull) | +2 |
| Streaming/real-time (usage_update push) | +2 |
| >5 files ב->2 packages | +1 |
| Greenfield · דפוסים מוכחים (setThinkingTokens/non-text branches) | -1 |
| חלק ניכר TDD (normalizer + VM branches) | -1 |

**Score**: **7/10** (שני מנגנונים + push חי + popover). **Tier**: light + **verifier-phase על Commit 0 ו-Commit 4**.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל / הכרעה | חוסם? |
|---|------|----------|------|
| 1 | click על המד | **פותח popover read-only** (החלטת-משתמשת 2026-07-11; לא דחיסה — הימנעות מ-footgun VSCode) | ❌ |
| 2 | כפתור-דחיסה | **fast-follow נפרד** (מחוץ ל-scope) | ❌ |
| 3 | מתי שולפים מכסה | **on-open של ה-popover** (pull; הקונטקסט push תמיד-חי) | ❌ |
| 4 | קונטקסט — push או pull? | **push** (`usage_update` FE-only; pull `getContextUsage` = future לפירוק) | ❌ |
| 5 | טיפוסים FE-local או contract? | **FE-local ל-MVP** | ❌ |
| 6 | מכסה זמינה על ה-auth שלנו? | Commit 0 מכריע | ✅ |

---

## סטיות מהתכנון (מתעדכן ע"י executor תוך כדי)

- ...
