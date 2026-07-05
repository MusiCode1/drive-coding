# Slice — permission-ui-client-shell — שלד לקוח לבקשות הרשאה

> **תאריך**: 2026-06-28
> **סטטוס**: ✅ **הושלם** (4/4 commits, בוצע ע"י אליעזר 2026-07-05).
> ⚠️ **הערה**: עותק זה (בענף ה-worktree) הוא **טיוטה שקדמה לאישור אביגיל r2** —
> ה-base של הענף (`49b98e9`) קדם לעדכון ה-brief ל-READY על `dev`. הביצוע בפועל
> נעשה לפי הגרסה המעודכנת (READY, אביגיל r2) שנקראה ישירות מ-`dev/docs/plans/...`
> לפי הנחיית מרדכי ב-dispatch — כולל תיקון virtua-Virtualizer ב-§3 ו-arrow-bound
> class fields ב-Commit 1. ראה `docs/walkthrough.md` לפרטי הביצוע המלאים.
> **Complexity**: 6/10 (verifier: calev-light)
> **תלויות (`depends_on`)**: `[]`
> **Base**: `dev`
> **Dev tip**: `f5c722f`

---

## §0 — Pre-flight

### החלטת scope

הסלייס הזה מתמקד **בצד הלקוח בלבד**. הוא לא מוסיף `onRequestPermission` ל-`provider-contract`,
לא מעדכן `pnpm-lock.yaml`, ולא מבצע חיבור חי ל-ACP permission requests.

המטרה היא להכין שלד UI/state שניתן לבדוק עם mock/harness, כך שכאשר ה-hook החיצוני יגיע בעתיד,
החיבור יהיה קטן ומקומי.

### Worktree

```bash
cd d:/UserProjects/AI/drive-coding/dev
git worktree add .worktrees/permission-ui-client-shell -b slice/permission-ui-client-shell dev
cd .worktrees/permission-ui-client-shell
pnpm install && pnpm hooks:install
```

### איך להריץ

```bash
pnpm test -- permission
pnpm --filter @drive-coding/frontend-v2 run typecheck
pnpm lint:i18n
pnpm lint:rtl
```

### Reading list

**must-read**:

- `packages/frontend/src/lib/view-models/agent-session.svelte.ts`
- `packages/frontend/src/lib/components/chat/ChatBubbles.svelte`
- `packages/frontend/src/lib/components/chat/bubbles/ToolBubble.svelte`
- `packages/frontend/src/lib/types/bubble.ts`
- `packages/core/src/i18n/keys.ts`
- `packages/core/src/i18n/catalogs/he.ts`
- `packages/core/src/i18n/catalogs/en.ts`

**reference**:

- `docs/plans/slice-permission-ui.md` — הסלייס המלא, כולל החסם החיצוני.
- `docs/plans/ui-feature-backlog.md:72` — permission/question inline blocks.
- `docs/conventions/parallel-safe-code.md` — שינויי context/i18n/VM.

---

## §1 — מטרה

להוסיף ל-drive-coding שלד לקוח להצגת בקשת הרשאה inline בצ'אט: state pending, mapping של options,
component להצגת הבקשה, וכפתורי resolve/cancel. הסלייס מוכיח את ה-UX עם mock/test harness בלבד.

בסוף הסלייס המשתמש לא יקבל עדיין בקשות הרשאה חיות מסוכן ACP, כי אין hook בצד `provider-contract`.

---

## §2 — Scope

| פיצ'ר | כן/לא | הערה |
|---|---|---|
| טיפוסי permission ומיפוי options בצד FE | ✅ | נגזר מ-`Client["requestPermission"]` |
| state pending ב-`AgentSession` או helper ייעודי של ה-VM | ✅ | ללא חיבור חי ל-ACP |
| `PermissionRequestBlock.svelte` inline בצ'אט | ✅ | לא modal |
| i18n keys לכל טקסט UI | ✅ | אין עברית קשיחה בקוד |
| בדיקות mapping/state | ✅ | TDD |
| harness/mock להפעלת block ידנית בסביבת dev/test | ✅ | רק לצורך verification |
| העברת `onRequestPermission` ל-`createAcpClient` | ❌ | תלוי ב-provider-contract, סלייס עתידי |
| עדכון `pnpm-lock.yaml` | ❌ | לא בסלייס הזה |
| live claude allow/reject | ❌ | סלייס עתידי אחרי hook חיצוני |
| approve-all session policy | ❌ | סלייס עתידי |

---

## §3 — Architecture

```text
AgentSession / PermissionBridge
  pendingPermission: PermissionRequestState | null
  beginPermissionForTestOrHarness(params)  ← local-only, not ACP wiring
  resolvePermission(requestId, optionId)
  cancelPermission(requestId)
      │
      ▼
ChatBubbles.svelte
  messages...
  <PermissionRequestBlock request={session.pendingPermission} />
      │
      ▼
PermissionRequestBlock.svelte
  title/status/options/details
```

השם המדויק של פונקציית ה-harness פתוח לביצוע, אבל אסור לחשוף API משתמש קבוע בשם מטעה.
ברירת מחדל: helper פנימי/test-only שמאפשר לטסטים ול-dev harness להזריק `PermissionParams`.

---

## §4 — Commits בסדר

### Commit 0 — טיפוסי permission ומיפוי טהור (approach: tdd)

**קבצים חדשים**:

- `packages/frontend/src/lib/types/permission.ts`
- `packages/frontend/src/lib/types/permission.test.ts`

**API מחייב**:

```ts
import type { Client } from "@agentclientprotocol/sdk"

export type PermissionParams = Parameters<Client["requestPermission"]>[0]
export type PermissionResponse = Awaited<ReturnType<Client["requestPermission"]>>

export type PermissionRequestState = {
  id: string
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

**חוקים**:

- להשתמש ב-`option.name`; אין `option.label`.
- לא למיין options.
- לא להמציא option שלא הגיע מה-agent.
- אין טקסט UI בקובץ הזה.

**Verification**:

```bash
pnpm test -- permission
pnpm --filter @drive-coding/frontend-v2 run typecheck
```

### Commit 1 — state bridge בצד VM בלבד (approach: tdd)

**קבצים משתנים**:

- `packages/frontend/src/lib/view-models/agent-session.svelte.ts`
- `packages/frontend/src/lib/view-models/agent-session.permission.test.svelte.ts` או helper test קיים.

**Implementation**:

- להוסיף `pendingPermission = $state<PermissionRequestState | null>(null)`.
- להוסיף methods ציבוריים ל-UI:
  - `resolvePermission(requestId: string, optionId: string): void`
  - `cancelPermission(requestId: string): void`
- להוסיף helper פנימי/test-only שמייצר pending permission מ-`PermissionParams`.
- לא להעביר עדיין `onRequestPermission` ל-`createAcpClient`.

**חוקים**:

- אם נפתחת בקשה חדשה בזמן שיש pending ישנה: הישנה מסומנת cancelled ונדרסת.
- `requestId` שגוי לא פותר את הבקשה הנוכחית.
- `cancelTurn()`, `detach()`, `leaveRunning()`, ו-cleanup סוגרים pending עם cancelled.
- אחרי resolve/cancel, להשאיר state disabled להצגה; לא למחוק מיידית.

**Verification**:

```bash
pnpm test -- agent-session.permission
pnpm --filter @drive-coding/frontend-v2 run typecheck
```

### Commit 2 — UI inline + i18n (approach: component/manual)

**קבצים חדשים**:

- `packages/frontend/src/lib/components/chat/PermissionRequestBlock.svelte`

**קבצים משתנים**:

- `packages/frontend/src/lib/components/chat/ChatBubbles.svelte`
- `packages/core/src/i18n/keys.ts`
- `packages/core/src/i18n/catalogs/he.ts`
- `packages/core/src/i18n/catalogs/en.ts`

**UI requirements**:

- block inline בצ'אט, לא modal.
- לא card בתוך card.
- עיצוב קרוב ל-`ToolBubble`: border restrained, status, title, details.
- details מציג raw params בצורה קריאה, סגור כברירת מחדל.
- כפתורים נבנים מ-`request.options`.
- option kind לא מוכר מוצג ככפתור neutral עם `option.name`.
- בזמן pending כפתורים enabled; אחרי resolve/cancel disabled והבחירה מסומנת.
- touch targets לפחות 40px.
- אין עברית hardcoded בקוד; labels runtime מה-agent מותרים.

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

### Commit 3 — dev/test harness verification (approach: manual)

**מטרה**:

להוכיח שה-block עובד ויזואלית בלי ACP live hook.

**אפשרויות מימוש, לפי הקוד הקיים**:

- test helper שמזריק `pendingPermission` ב-VM ומרנדר `ChatBubbles`.
- או dev-only action קטן שמופעל רק בסביבת test/dev קיימת, אם יש pattern כזה בקוד.

**אסור**:

- להוסיף כפתור debug גלוי למשתמש production.
- להוסיף route חדש רק בשביל demo אם אין pattern קיים.
- לשנות provider/backend.

**Manual verification**:

- pending עם 4 options מוצג תקין.
- kind לא מוכר מוצג בלי crash.
- details נפתח/נסגר.
- mobile viewport: אין overflow על TypeArea/RecordFooter.
- resolve/cancel מנטרלים כפתורים ומציגים state סופי.

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|---|---|
| 1 | mapping משתמש ב-`option.name` | `pnpm test -- permission` |
| 2 | selected/cancelled response shape נכון | `pnpm test -- permission` |
| 3 | pendingPermission נוצר ונפתר דרך VM | `pnpm test -- agent-session.permission` |
| 4 | requestId שגוי לא פותר state נוכחי | VM test |
| 5 | cleanup/cancel סוגרים pending | VM test |
| 6 | block inline מוצג בצ'אט | manual/dev harness |
| 7 | options לא גולשים במובייל | screenshot/manual |
| 8 | אין עברית hardcoded | `pnpm lint:i18n` |
| 9 | RTL לא נשבר | `pnpm lint:rtl` |
| 10 | typecheck נקי | `pnpm --filter @drive-coding/frontend-v2 run typecheck` |

---

## §6 — Risks + mitigations

| סיכון | מיטיגציה |
|---|---|
| הקוד נראה “מחובר” אבל אין live ACP hook | לציין בבירור ב-scope; לא להעביר `onRequestPermission` ל-`createAcpClient` בסלייס הזה |
| helper test-only דולף ל-production UI | לא להוסיף UI debug גלוי; להשתמש בטסטים או pattern dev קיים בלבד |
| SDK shape משתנה | טיפוסים נגזרים מ-`Client["requestPermission"]`; raw details fallback |
| state נשאר pending אחרי עזיבה | cleanup paths מחייבים cancel |
| UI security-sensitive | לא להוסיף options; להציג רק מה שה-agent סיפק |

---

## §7 — Escalation triggers

- אי אפשר לבדוק UI בלי route/debug גלוי חדש ואין pattern test מתאים.
- `AgentSession` גדול מדי לשינוי ממוקד ודורש refactor רחב.
- `Client["requestPermission"]` לא זמין לטיפוס בצד frontend.
- `ChatBubbles` לא יכול לקבל `pendingPermission` בלי שינוי ארכיטקטורי רחב.

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|---|---|
| UI חדש בצ'אט | +1 |
| VM async state | +2 |
| i18n/RTL | +1 |
| אין live ACP integration | -1 |
| testing harness | +1 |
| security-sensitive UX | +1 |

**Score**: 6/10

**Tier**: `calev-light`

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | האם להציג raw params פתוח או סגור? | סגור ב-`details` | ❌ |
| 2 | האם לייצר route demo? | לא, אלא אם אין דרך test/harness אחרת | ❌ |
| 3 | האם למחוק state אחרי resolve? | לא מיד; להשאיר disabled עד turn update עתידי | ❌ |
| 4 | האם הסלייס מחליף את full permission-ui? | לא. הוא pre-slice לקוח בלבד | ❌ |

---

## סטיות מהתכנון

- אין סטייה מ-הגרסה המעודכנת (READY, אביגיל r2) של הבריף. הביצוע כולל את כל
  התיקונים שהוספו ב-r2 שלא מופיעים בעותק-הטיוטה הזה (virtua Virtualizer + מיקום
  מחוץ ל-list ליד StatusBubble; resolvePermission/cancelPermission + harness
  helper כ-arrow-bound class fields; גישור-חתימה מפורש onSelect/onCancel).
- Commit 2 הוסיף גם כפתור ✕ נפרד (cancelPermission) שלא צוין ב-Commit 2 המקורי
  כאן, כי `RequestPermissionOutcome` תומך ב-`cancelled` גם בלי בחירת option —
  נדרש נתיב UI לכך מעבר לכפתורי ה-options.
- ראה `docs/walkthrough.md` (entry 2026-07-05) לפירוט מלא פר-commit + תוצאות בדיקה.
