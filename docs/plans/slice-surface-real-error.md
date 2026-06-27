# Slice — surface-real-error — הצגת השגיאה האמיתית במקום "WS closed (1005)" — תוכנית

> **תאריך**: 2026-06-27
> **סטטוס**: מאומת ✅ (אביגיל: USABLE-AFTER-FIX → 4 findings תוקנו) — ממתין לאישור dispatch
> **Complexity**: 7/10 (verifier: heavy)
> **תלויות (`depends_on`)**: [] — בנוי ישירות על dev
> **Base**: dev
> **Dev tip**: `197b154`

---

## §0 — Pre-flight

### תלויות (חובה!)

אין תלויות — בנוי ישירות על dev. נשען על תשתית קיימת ולא-ממוזגת-בסלייס-אחר:
- `bridge-manager` stderr buffer + `describeCrash` → `crashReason` במרשם (קיים ב-dev).
- `GET /api/agents/:id` שמחזיר `toAgentPublic(agent)` (קיים ב-dev).
- ה-ACP client (`provider-contract/acp`) כבר זורק `Error` עם `.data` (git-dep, **לא משתנה** — drive-coding=consumer).

### Worktree

```bash
cd d:\UserProjects\AI\drive-coding\dev
git worktree add .worktrees/surface-real-error -b slice/surface-real-error dev
cd .worktrees/surface-real-error
pnpm install && pnpm hooks:install
```

### איך להריץ

- BE: `cd packages/backend; $env:PORT=4000; bun src/server.ts` (Windows — bun ישיר, לא onecli; ראה `docs/running-locally.md` §חסמי Windows)
- FE (dev): `pnpm --filter @drive-coding/frontend-v2 dev`
- FE (build): `pnpm --filter @drive-coding/frontend-v2 build`
- Tests: `pnpm test` (vitest) · `pnpm typecheck` · `pnpm lint:i18n`

### Browser

linux-gui עם `pw-clean.sh`, או מכונת Windows מקומית ב-`http://localhost:<vite>`. אין צורך ב-HTTPS לבדיקה זו (לא נוגעת במיקרופון).

### איך לשחזר את הבאג (קריטי לאימות)

ה-bug משוחזר ע"י **גרימת כשל handshake מכוון** ל-claude. הדרך הקלה:
זמנית הצב ב-`~/.config/drive-coding/cli-specs.jsonc` override של `claude` עם `bin`
שמצביע לקובץ שמחזיר JSON-RPC error על initialize, **או** הסר את
`CLAUDE_CODE_EXECUTABLE` והרץ עם fork ללא native-binary (התרחיש המקורי).
לפני ה-fix: ה-FE מציג `WS closed (1005): no reason`. אחרי: ההודעה האמיתית.

### Reading list

**must-read**:
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — `attach` (510-535), `#handleUnexpectedClose` (287-294), `loadSession`/`#warmReconnect`/`switchSession`/`newSession` (כל ה-catch-ים), `#cleanup`.
- `packages/frontend/src/lib/adapters/agents-api.ts` — `getAgent` (63-71, dead-code candidate שנחיה).
- `packages/backend/src/delivery/http-agents.ts` — `GET /api/agents/:id` (77-82) + `toAgentPublic`.
- `packages/backend/src/app/agent-orchestrator.ts` — `stderrGetters` + `describeCrash` (86-109).

**reference**:
- `docs/learnings.md` [2026-05-29] (1005 רקע — ישן, claude כיום עובד).
- `docs/design-principles.md` §1-5 (5-layer FE architecture).

---

## §1 — מטרה

כשחיבור ל-CLI agent נכשל — בין אם ה-child החזיר JSON-RPC error על ה-handshake
(כמו `Claude native binary not found`) ובין אם הוא קרס (ENOENT / credit-balance) —
המשתמשת תראה את **הסיבה האמיתית** בהודעת השגיאה, במקום `WS closed (1005): no reason`
הגנרי שמסתיר את המידע. ה-BE כבר מחזיק את כל הפרטים; הסלייס מחווט אותם עד ל-UI.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| onClose גנרי לא דורס שגיאה ספציפית קיימת (anti-clobber) | ✅ | סלייס זה (A) |
| חילוץ `e.data.details`/`e.data.message` של JSON-RPC, לא רק `e.message` | ✅ | סלייס זה (B) |
| משיכת `crashReason` מ-`GET /api/agents/:id` בסגירה לא-צפויה (child crash) | ✅ | סלייס זה (C) |
| `toAgentPublic` חושף `crashReason` | ✅ כבר קיים (core/schemas/agent.ts) | אין עבודה |
| permission-UI / auto-answer כשאין FE | ❌ | סלייס "ממשק אישור-בקשות" |
| נורמליזציית cwd ב-bridge-manager (libuv POSIX) | ❌ | סלייס נפרד |
| תיקון ה-native-binary עצמו (config) | ❌ | בוצע ידנית, מחוץ ל-repo |

> זו הגנה מ-scope creep, לא טבלת TODO.

---

## §3 — Architecture diagram

```
                JSON-RPC error            child exit / spawn fail
                (handshake נכשל)           (ENOENT / credit / crash)
                      │                            │
                      ▼                            ▼
        ┌─────────────────────────┐    ┌──────────────────────────┐
        │ ACP client זורק Error   │    │ bridge-manager:           │
        │ {code,message,data}     │    │  stderrLines → describe   │
        │ (provider-contract)     │    │  Crash → crashReason      │
        └───────────┬─────────────┘    │  (registry, קיים)         │
                    │                  └───────────┬──────────────┘
                    ▼                              │ GET /api/agents/:id
        ┌─────────────────────────┐               ▼
        │ agent-session catch:    │    ┌──────────────────────────┐
        │  formatAcpError(e)  (B) │    │ toAgentPublic.crashReason │ ← לאמת
        │  this.error = <details> │    └───────────┬──────────────┘
        │  status="error"         │                │
        └───────────┬─────────────┘                │
                    │ #cleanup() → WS close         │
                    ▼                               │
        ┌─────────────────────────┐                 │
        │ #handleUnexpectedClose  │◄────────────────┘
        │  (A) אם status==="error"│  (C) אחרת: getAgent → אם
        │      → return (לא דורס) │      crashed → הצג crashReason
        │                         │      אחרת → "WS closed (code)"
        └─────────────────────────┘
                    │
                    ▼
        ┌─────────────────────────┐
        │ +page.svelte / UI alert │ ← קיים, מציג this.error
        └─────────────────────────┘
```

---

## §4 — Commits בסדר

### Commit 0 — `formatAcpError` helper (approach: tdd)

**קבצים חדשים**:
- `packages/frontend/src/lib/view-models/format-acp-error.ts`

**API skeleton**:

```ts
/** מחלץ את ההודעה המשמעותית ביותר מ-Error של ACP client (JSON-RPC). */
export function formatAcpError(e: unknown): string
// סדר עדיפויות: data.details → data.message → message → String(e).
// JSON-RPC envelope טיפוסי: { code:-32603, message:"Internal error",
//   data:{ details:"Claude native binary not found…" } } → מחזיר את ה-details.
```

**Verification**:
```bash
pnpm test --filter @drive-coding/frontend-v2 format-acp-error
pnpm typecheck
```
טסטים: data.details קיים → מוחזר; רק message → מוחזר; non-Error → String(e); message="Internal error" עם details → מעדיף details.

---

### Commit 1 — anti-clobber ב-onClose + שימוש ב-formatAcpError בכל ה-catch-ים (approach: tdd)

**קבצים שמשתנים**:
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts`

שינויים:
1. **anti-clobber (A)** — `#handleUnexpectedClose` (287-294): חזרה מוקדמת אם כבר יש שגיאה אמיתית מוצגת:
   ```ts
   #handleUnexpectedClose(code: number, reason: string): void {
     if (this.status === "error" && this.error) return  // ← אל תדרוס שגיאה ספציפית
     // ... כמו היום (this.error = `WS closed…`; reconnect/disconnected)
   }
   ```
   > **שאלה פתוחה Q1** — ראה §9: ייתכן שצריך flag ייעודי (`#errorSurfaced`) ולא תנאי על status,
   > כי auto-reconnect לגיטימי עשוי לרצות כן להציג close אחרי error קודם. אביגיל תכריע.

2. **שימוש ב-formatAcpError (B)** — בכל ה-catch-ים שמציגים error למשתמשת (שורות `catch` מאומתות ע"י אביגיל):
   - `attach` (**529**) — קובע `this.error = msg` **בלי prefix** (שונה מהאחרים) → `this.error = formatAcpError(e)`.
   - `loadSession` (**665**) — שומר prefix: `loadSession failed: ${formatAcpError(e)}`.
   - `switchSession` (**783**) — שומר prefix: `switchSession failed: …`.
   - `newSession` (**837**) — שומר prefix: `newSession failed: …`.
   - `#warmReconnect` (**469**) — **`catch {` bare, ללא `e` binding** → B **לא חל**. לא מציג למשתמשת (נופל ל-cold). אם רוצים לוג: להוסיף `(e)` binding — אופציונלי, מחוץ ל-scope של הסלייס.
   מחליפים `e instanceof Error ? e.message : String(e)` ב-`formatAcpError(e)`.

**Verification**:
```bash
pnpm test --filter @drive-coding/frontend-v2 agent-session
pnpm typecheck
# manual: שחזר כשל handshake (§0) → ודא ש-this.error מציג את ה-details, לא 1005
```
טסט-gate: סימולציית catch שקובע error="X" ואז onClose(1005) → `this.error` נשאר "X". control: onClose(1005) בלי error קודם → "WS closed (1005)".

---

### Commit 2 — ~~חשיפת crashReason ב-BE~~ — **בוטל (אומת ע"י אביגיל)**

> **אביגיל אימתה:** `toAgentPublic` **כבר חושף `crashReason`**, והוא חי ב-`packages/core/src/schemas/agent.ts` (לא ב-`backend/delivery/http-agents.ts`). אין מה לעשות ב-BE — `GET /api/agents/:id` כבר מחזיר `crashReason`. **commit זה יורד.** ה-brief ממשיך ישירות מ-Commit 1 ל-Commit 3.

---

### Commit 3 — חיווט crash-path ב-FE (approach: integration + manual)

**קבצים שמשתנים**:
- `packages/frontend/src/lib/adapters/agents-api.ts` — הרחב `getAgent` להחזיר `crashReason`:
  ```ts
  export async function getAgent(agentId: string):
    Promise<{ agent: { cwd: string; status: string; crashReason?: string } }>
  ```
  (מסירים את הערת ה-dead-code TODO — עכשיו יש צרכן.)
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — `#handleUnexpectedClose`:
  כשאין שגיאה ספציפית קודמת ולפני הצגת `WS closed`, נסה best-effort:
  ```ts
  // best-effort: ה-child אולי קרס עם סיבה ידועה (ENOENT/credit/native-binary)
  const info = await getAgent(this.agentId).catch(() => null)
  if (info?.agent.status === "crashed" && info.agent.crashReason) {
    this.error = info.agent.crashReason
  } else {
    this.error = `WS closed (${code}): ${reason || "no reason"}`
  }
  ```
  > להפוך את `#handleUnexpectedClose` ל-async-safe: לא לחסום את ה-reconnect; ה-fetch
  > best-effort עם guard ל-`#detached`. אם ה-agentId כבר נמחק → fallback ל-WS closed.

**Verification**:
```bash
pnpm test --filter @drive-coding/frontend-v2 agent-session
pnpm typecheck && pnpm build
# manual: spawn עם CLI לא-קיים (cliKind שמוביל ל-ENOENT) → ודא crashReason ב-UI
# manual: שחזר native-binary error → ודא ה-details ב-UI (מסלול A+B, לא C)
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck + build + tests | `pnpm typecheck && pnpm build && pnpm test` |
| 2 | lint:i18n (אין עברית קשיחה בקוד) | `pnpm lint:i18n` |
| 3 | JSON-RPC error מוצג נכון | שחזר כשל handshake → UI מציג `Claude native binary not found…` (או ה-details), **לא** `WS closed (1005)` |
| 4 | child crash מוצג נכון | spawn עם CLI חסר → UI מציג `crashReason` (ENOENT/...) |
| 5 | onClose לא דורס | בדיקת-gate אוטומטית: error ספציפי שורד onClose(1005) |
| 6 | regression: reconnect | ניתוק WS אמיתי (לא error) → עדיין מצית backoff/reconnect (test reconnect קיים ירוק) |
| 7 | regression: סגירה רגילה | detach/1000/1001 → אין הודעת שגיאה |
| 8 | mobile + desktop | screenshot של הודעת השגיאה בשני viewports |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| anti-clobber חוסם הצגת close לגיטימי אחרי error | תכנון | Q1 — אביגיל מכריעה בין `status==="error"` ל-flag ייעודי; טסט-control על reconnect |
| `getAgent` async ב-onClose מאט/חוסם reconnect | async coordination | best-effort `.catch(()=>null)`, guard `#detached`, fallback מיידי |
| race: agentId נמחק לפני getAgent | lifecycle | 404 → fallback ל-`WS closed` |
| Hardcoded Hebrew strings | learnings.md [2026-05-29] | crashReason/details מגיעים מ-upstream (אנגלית); אין מחרוזת חדשה בקוד → pre-commit hook חוסם בכל מקרה |
| Svelte 5 reactivity על `this.error` | learnings.md | `this.error` כבר `$state` — assignment מספיק |
| `toAgentPublic` כבר חושף crashReason → commit 2 מיותר | אי-ודאות | Q2 — אמת לפני; אם קיים, דלג |

---

## §7 — Escalation triggers

עצור ושאל את Tama (מרדכי) אם:
- Q1 (anti-clobber strategy) מתברר כמשפיע על >50 שורות או על מסלול reconnect קיים.
- ה-ACP client **לא** חושף `e.data` בפועל (סותר את ממצא החקירה ב-client.js:43) — אז צריך לגעת ב-provider-contract (git-dep) → החלטה ארכיטקטונית.
- מסלול ה-crash דורש שינוי בחוזה ה-WS (הוספת גוף הודעה לפני close) — חורג מ-scope.
- 3+ גישות ל-async onClose, אף אחת לא יציבה.

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| Streaming/real-time (WS close handling) | +2 |
| State machine / async coordination (onClose↔cleanup↔reconnect race) | +2 |
| Refactor של קוד קיים (error handling בכמה catch-ים) | +1 |
| >5 files ב->2 packages (FE vm+adapter+helper, BE http) | +1 |
| אזור החזיר bugs לאחרונה (ws-reconnect-fix-nbug2 וכו') | +2 |
| TDD על helper + gate-test | -1 |

**Score**: 7 / 10

**Tier**: 8+ גבולי → המשתמשת בחרה **`calev-heavy`** (אזור reconnect רגיש + race). 
**Verifier-phase**: אחרי Commit 1 (anti-clobber — הליבה ה-race-prone) ואחרי Commit 3 (crash wiring חי).

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | anti-clobber: תנאי `status==="error"` או flag ייעודי `#errorSurfaced`? | תנאי status (פשוט) | ❌ (אביגיל ממליצה) |
| 2 | ~~האם `toAgentPublic` כבר חושף `crashReason`?~~ | **נענה (אביגיל): כן, ב-`core/schemas/agent.ts`. Commit 2 בוטל.** | ✅ סגור |
| 3 | האם להציג code מספרי (`-32603`) לצד ה-details? | לא — details בלבד, נקי למשתמשת | ❌ |
| 4 | מסלול C (getAgent ב-onClose) — להחיל גם על 1005, או רק 1011/1006? | על כל code שאינו 1000/1001 ואין error קודם | ❌ |

---

## סטיות מהתכנון (מתעדכן ע"י executor תוך כדי)

- ...
