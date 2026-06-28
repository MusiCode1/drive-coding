# Slice — permission-ui — ממשק אישור בקשות הרשאה

> **תאריך**: 2026-06-28
> **סטטוס**: BLOCKED / pre-dispatch (ממתין ל-P0 חיצוני ב-`provider-abstraction`, ואז אביגיל חוזרת)
> **Complexity**: 8/10 (verifier: calev-heavy)
> **תלויות (`depends_on`)**: `[provider-contract-acp-permission-callback (external, provider-abstraction)]`
> **Base**: `dev` **אחרי** עדכון `pnpm-lock.yaml` ל-commit קונקרטי של `provider-contract` שמכיל `onRequestPermission`
> **Dev tip**: `116346c`

---

## §0 — Pre-flight

### תלויות

slice זה **מבוסס על** slice מקדים ב-`D:/UserProjects/AI/provider-abstraction`.

- `provider-contract-acp-permission-callback` (status: **חסום כרגע: טרם קיים branch/commit**) — מוסיף ל-`createAcpClient` option אינטראקטיבי:
  `onRequestPermission?: RequestPermissionHandler`.
- בלי התלות הזו, `provider-contract/src/adapters/acp/client/client-impl.ts` ממשיך לאשר אוטומטית `allow_once`, ול-drive-coding אין hook אמיתי להציג UI.
- התלות חייבת להתפרסם/להינעל ב-`pnpm-lock.yaml` של drive-coding לפני dispatch של הסלייס הזה.

**Dispatch gate חובה**:

ה-brief הזה **אינו dispatchable במצבו הנוכחי**. לפני מסירה לאליעזר, מרדכי חייב:

1. להשלים את `provider-contract-acp-permission-callback` ב-`provider-abstraction`.
2. לרשום כאן commit hash קונקרטי של provider P0:
   - `provider-abstraction commit: <hash>`
   - `provider-contract lock commit in drive-coding: <hash from pnpm-lock.yaml>`
3. לעדכן את ה-header:
   - `סטטוס`: טיוטה (ממתין לאביגיל) או READY אחרי דוח חדש.
   - `Base`: `dev` tip אחרי lock update.
   - `Dev tip`: hash של drive-coding dev אחרי lock update.
4. להריץ אביגיל שוב. רק verdict=READY מסמן `plan_verified=true`.

**Companion P0 — provider-abstraction, חובה לפני הסלייס הזה**

ב-`provider-abstraction`:

- `src/adapters/acp/client/client-impl.ts`:
  - להרחיב `createClientImpl(opts)` עם `onRequestPermission?`.
  - אם callback קיים: להמתין לו ולהחזיר את התוצאה ל-ACP.
  - אם אין callback: לשמר בדיוק את מדיניות ה-auto-allow הקיימת.
- `src/adapters/acp/client/client.ts`:
  - להוסיף ל-`AcpClientOptions` את `onRequestPermission?`.
  - להעביר אותו ל-`createClientImpl`.
- טיפוסים מוצעים (חובה לגזור מ-`Client`, לא להניח export ישיר מה-root של ה-SDK):
  ```ts
  import type { Client } from "@agentclientprotocol/sdk"

  export type RequestPermissionHandler = (
    params: Parameters<Client["requestPermission"]>[0],
  ) => ReturnType<Client["requestPermission"]>
  ```
  ה-SDK מחזיק `RequestPermissionRequest/Response` תחת schema generated types, אבל ה-import היציב בקוד הקיים הוא `Client` מה-root. גזירה מה-method מונעת drift.
- בדיקות ב-`tests/acp/client.test.ts`:
  - default ללא callback עדיין בוחר `allow_once`.
  - callback מחזיר selected option ומכובד.
  - callback מחזיר cancelled ומכובד.
  - callback זורק → requestPermission מחזיר cancelled, לא מפיל את ה-client.

### Worktree

```bash
cd d:/UserProjects/AI/drive-coding/dev
git worktree add .worktrees/permission-ui -b slice/permission-ui dev
cd .worktrees/permission-ui
pnpm install && pnpm hooks:install
```

אם `provider-contract` עוד לא עודכן ב-lock:

```bash
pnpm update provider-contract
pnpm install
```

### איך להריץ

- BE: `cd packages/backend && PORT=4000 bun src/server.ts`
- FE: `pnpm --filter @drive-coding/frontend-v2 dev` (Vite port OS-assigned)
- Tests:
  ```bash
  pnpm test -- permission
  pnpm --filter @drive-coding/frontend-v2 run typecheck
  pnpm lint:i18n
  pnpm lint:rtl
  ```
- Provider-contract P0, לפני כן:
  ```bash
  cd d:/UserProjects/AI/provider-abstraction
  pnpm test -- tests/acp/client.test.ts
  pnpm typecheck
  pnpm build
  ```

### Browser

- בדיקה חיה מול `localhost` רגיל.
- ספק עיקרי לאימות: `claude` במצב שאינו `bypassPermissions`, כי ב-bypass אין `request_permission` בכלל.
- אם אפשר: smoke גם מול `opencode`, רק כדי לוודא שאין שינוי התנהגות כשאין בקשות הרשאה.

### Reading list

**must-read**:

- `D:/UserProjects/AI/provider-abstraction/src/adapters/acp/client/client-impl.ts` — auto-allow הנוכחי.
- `D:/UserProjects/AI/provider-abstraction/src/adapters/acp/client/client.ts` — `createAcpClient`, `AcpClientOptions`.
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — בניית `createAcpClient`, `sendPrompt`, `cancelTurn`, state ownership.
- `packages/frontend/src/lib/types/bubble.ts` — `ToolBubble`/`ToolCall`; להחליט אם permission הוא bubble נפרד או state ב-VM.
- `packages/frontend/src/lib/components/chat/ChatBubbles.svelte` + `BubbleRenderer.svelte` — איפה להכניס UI inline.
- `packages/frontend/src/lib/components/chat/bubbles/ToolBubble.svelte` — סגנון ו-layout של כלי.
- `packages/core/src/i18n/keys.ts` + `catalogs/he.ts` + `catalogs/en.ts` — כל טקסט חדש דרך i18n.

**reference**:

- `docs/plans/ui-feature-backlog.md:72` — permission/question inline blocks.
- `docs/roadmap.md:117` + `docs/roadmap.md:153` — הקשר ל-`bypassPermissions` ול-stall בלי דפדפן.
- `docs/plans/archive/slice-leave-running-background.md` — שלב מקדים: `permission-mode.ts`, אזהרת stall.
- `main/docs/archive/v1/future-features.md:94` — רעיון Gemini/click המקורי.
- `docs/conventions/parallel-safe-code.md` — שינויי context/i18n/VM.

---

## §1 — מטרה

כאשר הסוכן מבקש הרשאה להריץ פעולה, drive-coding לא מאשר אוטומטית. במקום זאת מופיע block ברור בתוך הצ'אט עם שם הפעולה, היעד/הקלט, ואפשרויות ההחלטה שהסוכן הציע. המשתמש יכול לאשר פעם אחת, לאשר תמיד אם האפשרות קיימת, או לדחות. עד שהמשתמש מחליט, התור ממתין; אחרי החלטה ה-block ננעל ומציג את הבחירה. במצב `bypassPermissions` אין block, כי הספק לא שולח בקשת הרשאה.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| callback אינטראקטיבי ב-`provider-contract` במקום auto-allow קשיח | ✅ | Companion P0, לפני הסלייס |
| state ב-`AgentSession` ל-permission request pending | ✅ | הסלייס הזה |
| UI inline בצ'אט לבקשת הרשאה | ✅ | הסלייס הזה |
| כפתורי החלטה לפי `params.options` בפועל | ✅ | הסלייס הזה |
| default fallback ל-cancel אם המשתמש מתנתק/מבטל turn/ה-client נסגר | ✅ | הסלייס הזה |
| “approve all for session” כ-state מקומי שמחזיר `allow_always` אוטומטית לבקשות דומות | ❌ | slice עתידי |
| Gemini voice approval | ❌ | slice עתידי; לא לערבב עם click UI |
| BE auto-answer כשאין FE מחובר | ❌ | Track F נפרד; שומר על UI עתידי |
| שינוי `bypassPermissions` או persist mode | ❌ | כבר טופל/מתוכנן ב-slices אחרים |
| fs/terminal ACP capabilities | ❌ | לא חלק מ-permission UI |

---

## §3 — Architecture diagram

```text
provider-contract/acp
  createClientImpl({ onUpdate, onRequestPermission })     ← P0 חדש
      │
      ├─ no callback → auto-allow_once legacy             ← fallback קיים
      │
      └─ callback(params) waits                           ← חדש
             │
             ▼
drive-coding AgentSession
  createAcpClient(transport, onUpdate, { onRequestPermission })
      │
      ├─ #requestPermission(params)
      │     ├─ creates PermissionRequestVM state
      │     └─ returns Promise<RequestPermissionResponse>
      │
      ├─ resolvePermission(requestId, optionId)
      │     └─ resolves Promise selected(optionId)
      │
      └─ cancelPermission(requestId)
            └─ resolves Promise cancelled
             │
             ▼
ChatBubbles.svelte
  messages...
  <PermissionRequestBlock request={session.pendingPermission} />
             │
             ▼
PermissionRequestBlock.svelte
  title/action/options
  Allow once / Allow always / Reject once / Reject always
```

---

## §4 — Commits בסדר

### Commit 0 — עדכון dependency + טיפוסי permission מקומיים (approach: tdd)

**קבצים שמשתנים**:

- `pnpm-lock.yaml` — provider-contract commit חדש שמכיל P0.
- `packages/frontend/package.json` — רק אם צריך pin מפורש ל-commit/branch זמני. ברירת מחדל: להשאיר `#main` ולעדכן lock בלבד.
- `packages/frontend/src/lib/types/permission.ts` — חדש.
- `packages/frontend/src/lib/types/permission.test.ts` — חדש, אם יש פונקציות מיפוי טהורות.

**קובץ חדש**: `packages/frontend/src/lib/types/permission.ts`

**API skeleton**:

```ts
import type { Client } from "@agentclientprotocol/sdk"

export type PermissionParams = Parameters<Client["requestPermission"]>[0]
export type PermissionResponse = Awaited<ReturnType<Client["requestPermission"]>>

export type PermissionRequestState = {
  id: string
  title: string
  raw: PermissionParams
  options: PermissionOptionView[]
  status: "pending" | "resolved" | "cancelled"
  selectedOptionId?: string
}

export type PermissionOptionView = {
  optionId: string
  name: string
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always" | string
}

export function permissionSelected(optionId: string): PermissionResponse {
  return { outcome: { outcome: "selected", optionId } }
}

export function permissionCancelled(): PermissionResponse {
  return { outcome: { outcome: "cancelled" } }
}

export function toPermissionOptionViews(params: PermissionParams): PermissionOptionView[] {
  return params.options.map((option) => ({
    optionId: option.optionId,
    name: option.name,
    kind: option.kind,
  }))
}
```

**לוגיקה מחייבת**:

- `toPermissionOptionViews` שומרת את סדר `params.options`; לא ממציאה אופציות.
- `PermissionOptionView.name` נגזר מ-`option.name` של ה-SDK. אין `option.label` ב-`PermissionOption`.
- `permissionSelected(optionId)` מחזיר `{ outcome: { outcome: "selected", optionId } }`.
- `permissionCancelled()` מחזיר `{ outcome: { outcome: "cancelled" } }`.
- אין טקסט UI כאן; רק mapping טהור.

**Verification**:

```bash
pnpm test -- permission
pnpm --filter @drive-coding/frontend-v2 run typecheck
```

### Commit 1 — AgentSession permission state + promise bridge (approach: tdd)

**קבצים שמשתנים**:

- `packages/frontend/src/lib/view-models/agent-session.svelte.ts`
- `packages/frontend/src/lib/view-models/agent-session.permission.test.svelte.ts` — חדש או הרחבה של test קיים.

**API skeleton**:

```ts
// state
pendingPermission = $state<PermissionRequestState | null>(null)

// public methods for UI
resolvePermission = (requestId: string, optionId: string): void
cancelPermission = (requestId: string): void

// private bridge passed to createAcpClient
#requestPermission = async (params: PermissionParams): Promise<PermissionResponse> => {
  // create id, set pendingPermission, return Promise resolved by UI
}
```

**שינוי ב-createAcpClient call sites ב-VM**:

בכל מקום שבו `createAcpClient(transport, this.#onSessionUpdate, opts)` נקרא, להוסיף:

```ts
{
  ...existingOptions,
  onRequestPermission: this.#requestPermission,
}
```

**חוקים מחייבים**:

- רק בקשת הרשאה אחת pending בכל רגע. אם מגיעה שנייה לפני שהראשונה נסגרה: לבטל את הישנה ב-`cancelled`, להחליף בחדשה, ולתעד ב-comment קצר. ACP אמור להיות serial, אבל UI צריך fail-safe.
- `resolvePermission`/`cancelPermission` חייבים לבדוק `requestId` כדי שקליק מאוחר על block ישן לא יפתור בקשה חדשה.
- `detach()`, `leaveRunning()`, `cancelTurn()`, ו-`#cleanup()` חייבים לסגור pending permission עם `cancelled`.
- אחרי resolve/cancel: `pendingPermission.status` משתנה לרגע ל-`resolved`/`cancelled`, ואז נשאר מוצג כ-disabled עד שה-turn מתקדם. ברירת מחדל: לא למחוק מיד, כדי שהמשתמש יראה מה נבחר.
- אין `confirm()` דפדפן; הכל inline UI.

**טסטים מחייבים**:

1. `#requestPermission` יוצר `pendingPermission` ומחזיר Promise תלוי.
2. `resolvePermission(id, "allow_once")` פותר response selected ומסמן resolved.
3. `cancelPermission(id)` פותר cancelled.
4. requestId שגוי לא פותר את ה-Promise.
5. `cancelTurn()` בזמן pending פותר cancelled.
6. `detach()`/`leaveRunning()` בזמן pending פותרים cancelled.
7. אם callback ב-provider זורק/נסגר, אין unhandled rejection.

**Verification**:

```bash
pnpm test -- agent-session.permission
pnpm test -- agent-session
pnpm --filter @drive-coding/frontend-v2 run typecheck
```

### Commit 2 — PermissionRequestBlock UI (approach: manual + component test אם קיים)

**קבצים חדשים**:

- `packages/frontend/src/lib/components/chat/PermissionRequestBlock.svelte`

**קבצים שמשתנים**:

- `packages/frontend/src/lib/components/chat/ChatBubbles.svelte` — מציג block אחרי רשימת הבועות או ליד StatusBubble.
- `packages/core/src/i18n/keys.ts`
- `packages/core/src/i18n/catalogs/he.ts`
- `packages/core/src/i18n/catalogs/en.ts`

**API skeleton**:

```svelte
<script lang="ts">
  import type { PermissionRequestState } from "$lib/types/permission"

  let {
    request,
    onSelect,
    onCancel,
  }: {
    request: PermissionRequestState
    onSelect: (requestId: string, optionId: string) => void
    onCancel: (requestId: string) => void
  } = $props()
</script>
```

**UI requirements**:

- block inline בצ'אט, לא modal.
- לא card בתוך card. עיצוב דומה ל-ToolBubble: border, status dot, כותרת, details ל-raw params.
- כותרת קצרה דרך i18n: `permission.title`.
- action/target:
  - אם `params.toolCall`/`params.tool`/`params.title` קיימים לפי SDK בפועל, הצג אותם.
  - אם shape שונה, הצג `prettyJson(params)` תחת details, ו-title גנרי. לא לשבור על shape לא מוכר.
- כפתורי אופציות:
  - `allow_once` → צבע accent.
  - `allow_always` → accent muted + label ברור.
  - `reject_once`/`reject_always` → neutral/danger restrained.
  - option kind לא מוכר → כפתור neutral עם `option.name`.
- בזמן pending: כל הכפתורים enabled.
- אחרי resolve/cancel: כל הכפתורים disabled, הבחירה שנבחרה מסומנת.
- touch targets מינימום 40px במובייל.
- אין מחרוזות עברית hardcoded. שמות אופציות מה-agent (`option.name`) מותר להציג כמו שהם, כי זה data runtime.

**i18n keys**:

```ts
| "permission.title"
| "permission.pending"
| "permission.resolved"
| "permission.cancelled"
| "permission.details"
| "permission.allowOnce"
| "permission.allowAlways"
| "permission.rejectOnce"
| "permission.rejectAlways"
| "permission.unknownOption"
```

**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 run typecheck
pnpm lint:i18n
pnpm lint:rtl
```

Manual:

- fixture/mock: set `session.pendingPermission` through test helper or temporary dev harness.
- desktop + mobile: block fits, buttons do not overflow, details opens/closes.

### Commit 3 — Wire UI to live ACP permission requests (approach: integration)

**קבצים שמשתנים**:

- `packages/frontend/src/lib/view-models/agent-session.svelte.ts`
- `packages/frontend/src/lib/components/chat/ChatBubbles.svelte`
- tests under `packages/frontend/src/lib/view-models/`

**Implementation**:

- `AgentSession` passes `#requestPermission` into `createAcpClient`.
- `ChatBubbles` renders:

```svelte
{#if session.pendingPermission}
  <PermissionRequestBlock
    request={session.pendingPermission}
    onSelect={session.resolvePermission}
    onCancel={session.cancelPermission}
  />
{/if}
```

- `sendPrompt()` and turn-state behavior remain unchanged; permission wait is owned by the ACP request callback.
- `turnState` may remain `calling-tool`/`thinking`; do not invent a new turnState unless necessary. If UI needs label, derive it from `pendingPermission !== null`.

**Integration test strategy**:

- Use `MockAcpTransport` from `provider-contract/acp` if exported and usable.
- Simulate `session/request_permission` JSON-RPC frame from agent after initialization.
- Assert `AgentSession.pendingPermission` appears.
- Call `resolvePermission`.
- Assert outgoing frame contains selected optionId.

If direct JSON-RPC simulation is too brittle because of SDK internals, keep TDD at VM boundary and do a live/manual ACP test in Commit 4. Do not write a fragile test that asserts private SDK frame formatting unless it is already done in `provider-abstraction`.

**Verification**:

```bash
pnpm test -- agent-session.permission
pnpm --filter @drive-coding/frontend-v2 run typecheck
```

### Commit 4 — Live verification + UX hardening (approach: manual)

**קבצים משתנים לפי צורך בלבד**:

- `PermissionRequestBlock.svelte`
- i18n catalogs
- `agent-session.svelte.ts` only for bugs found in live flow.

**Live scenarios**:

1. `claude` non-bypass:
   - start session.
   - ask for an action likely to require permission, e.g. filesystem write or shell command in current project.
   - permission block appears.
   - click reject → agent receives cancellation/rejection and continues/fails gracefully.
   - repeat and click allow once → tool proceeds.
2. `claude` `bypassPermissions`:
   - same prompt.
   - no permission block appears; flow still works through provider short-circuit.
3. disconnect while pending:
   - trigger permission, then `leaveRunning()`/navigate away.
   - pending Promise resolves cancelled; no hung UI; no unhandled rejection in console.
4. mobile viewport:
   - options wrap cleanly, no overlap with TypeArea/RecordFooter.

**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 run typecheck
pnpm lint:i18n
pnpm lint:rtl
pnpm test -- permission
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|---|---|
| 1 | provider-contract P0 קיים ונעול | `pnpm-lock.yaml` מצביע ל-commit קונקרטי עם `onRequestPermission`; `client.d.ts` כולל option חדש; ה-header במסמך עודכן מהסטטוס BLOCKED |
| 2 | fallback legacy נשמר | provider-contract tests: ללא callback עדיין auto-allow לפי `allow_once > allow_always > non-reject > first` |
| 3 | VM יוצר pending permission | `pnpm test -- agent-session.permission` |
| 4 | resolve/cancel מחזירים response נכון ל-ACP | טסט VM + provider-contract client test |
| 5 | detach/leaveRunning/cancelTurn לא משאירים Promise תלוי | טסטים + console נקי |
| 6 | UI מוצג inline ולא modal | בדיקה ידנית בצ'אט |
| 7 | כל options מה-agent מוצגות | mock עם 4 kinds + kind לא מוכר |
| 8 | i18n/RTL נקי | `pnpm lint:i18n && pnpm lint:rtl` |
| 9 | typecheck נקי | `pnpm --filter @drive-coding/frontend-v2 run typecheck` |
| 10 | live reject עובד | claude non-bypass, פעולה שדורשת הרשאה, Reject |
| 11 | live allow once עובד | claude non-bypass, אותה פעולה, Allow once |
| 12 | bypass לא מציג block | claude `bypassPermissions`, 0 blocks |
| 13 | mobile layout | screenshot mobile + desktop, אין overflow/overlap |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| ה-hook חי ב-git dependency חיצוני, לא ב-drive-coding | `provider-contract` מ-`provider-abstraction` | Companion P0 חובה; drive-coding לא עורך `node_modules`; lock commit נבדק ב-DoD |
| requestPermission shape שונה מהנחות UI | SDK/ספקים שונים | UI מציג fields מוכרים אם קיימים, ו-raw details כ-fallback; typings נגזרים מ-`Client["requestPermission"]` |
| Promise נשאר תלוי ו-turn נתקע | callback מחכה להחלטת משתמש | כל נתיבי cleanup/cancel פותרים `cancelled`; טסטים מחייבים |
| שני permission requests במקביל | edge ב-ACP/adapter | request חדש מבטל את הישן; מזהה `requestId` מונע קליק מאוחר |
| Hardcoded Hebrew | dev-conventions | כל טקסט UI דרך i18n; labels runtime מה-agent בלבד |
| Svelte array/object mutation לא מרנדר | Svelte 5 | `pendingPermission = { ... }` בהחלפת סטטוס, לא mutation עמוקה בלבד |
| mobile overcrowding | כפתורי option רבים | flex-wrap, min-width סביר, icon+label קצר, details ל-raw |
| bypassPermissions גורם ל"לא רואים UI" בבדיקה | התנהגות מכוונת | בדיקה חיה חייבת non-bypass; bypass הוא scenario נפרד |
| `allow_always` משנה מדיניות רחבה מדי | security/UX | מציגים רק אם הספק הציע; label ברור; לא מוסיפים approve-all משלנו |

---

## §7 — Escalation triggers

- `provider-contract` לא יכול להוסיף `onRequestPermission` בלי שינוי API שובר ל-`createAcpClient`.
- ה-SDK לא מייצא טיפוסים/shape יציב ל-`requestPermission`, ואי אפשר לגזור מ-`Client["requestPermission"]`.
- בקשות הרשאה מגיעות בזמן שאין FE attached וצריך BE auto-answer כדי למנוע stall. זה Track F, לא לתקן בתוך הסלייס הזה.
- live claude non-bypass לא מצליח לייצר `request_permission` אחרי 3 ניסיונות סבירים. אל תסמן GO בלי תרחיש חי.
- נדרש refactor גדול של `AgentSession` state מעבר ל-`pendingPermission` ומתודות resolve/cancel.
- רוצים להוסיף Gemini voice approval. זה slice עתידי, לא scope creep.

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|---|---|
| Cross-store / cross-package flow חדש (`provider-contract` → FE VM → UI) | +2 |
| Protocol contract חדש | +2 |
| Async coordination / pending Promise | +2 |
| >5 files ב->2 packages | +1 |
| UI security-sensitive | +1 |
| Live ACP behavior required | +1 |
| TDD על mapping/VM | -1 |

**Score**: 8/10

**Tier**: `calev-heavy`

**Verifier-phase אחרי commit/phase**: אחרי Commit 3 אם integration test/live mock עובד; חובה בסוף אחרי Commit 4.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | האם ליצור גם bubble היסטורי קבוע לכל permission resolved? | לא. `pendingPermission` inline מספיק ל-MVP; היסטוריה מלאה slice עתידי | ❌ |
| 2 | האם `cancelTurn()` צריך לדחות permission או רק לשלוח ACP cancel? | גם resolve cancelled מקומית וגם לשלוח cancel best-effort | ❌ |
| 3 | האם להציג raw JSON כברירת מחדל פתוח? | סגור ב-`details`; title/options גלויים | ❌ |
| 4 | האם `allow_always` דורש confirm נוסף? | לא בסלייס הזה; label ברור מספיק, כי זו option שהספק הציע | ❌ |
| 5 | האם לבצע provider-contract P0 באותו worktree של drive-coding? | לא. זה repo אחר; לבצע קודם ב-`provider-abstraction`, ואז לעדכן lock כאן | ✅ |

---

## סטיות מהתכנון (מתעדכן ע"י executor תוך כדי)

- ...
