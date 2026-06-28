# Slice active-agents-widget — ווידג'ט תהליכים פעילים בטופס החיבור — ‏בריף

> ✅ **בוצע · אומת · מוזג ל-dev.** אורכב ב-2026-06-27 (הסטטוס אומת מול היסטוריית git/roadmap; פרטי הביצוע והאימות בהמשך הקובץ).

> **‏תאריך**: 2026-06-08
> **‏סוג מסמך**: ‏בריף ביצועי לסלייס
> **‏סטטוס**: ‏הושלם — 4 commits (a95532b..6533ccb) על branch slice-active-agents-widget
> **‏אימות אביגיל**: ✅ **READY** (round 2, 2026-06-14). round 1 = USABLE-AFTER-FIX (6 findings, ‏תוקנו: ‏סביבת Windows, `formatDate`→`toLocaleString`, render מותנה ל-pid, base branch); round 2 ‏אימת את ה-API shape מול ה-backend החי (persistent/pid/attached + endpoint) → READY (2 findings cosmetic בלבד). ‏דוח: `reports/drive-coding/slice-active-agents-widget-avigail.md`
> **Dispatch**: ✅ ‏מותר לאליעזר (אביגיל READY).
> **Complexity**: 6/10 (verifier: light + phase על commit 3)
> **‏תלויות (`depends_on`)**: [slice-active-agents-backend]
> **‏Base**: ‏branch `slice-active-agents-backend` @ `871447a` (‏שרשור — backend ‏טרם מוזג ל-dev; ‏GO 9/9)
> **‏Dev tip**: `224743e` (dev HEAD 2026-06-14)
> **‏תלות-בדיקה-חיה**: ‏לבדיקת reconnect חי על Windows נדרש גם `fix-cwd-validate-windows` (940d222) — ‏אחרת יצירת agent נכשלת ב-400. ‏כלב יצרף אותו בשלב האימות (‏לא נדרש לקומפילציה/טסטים).

---

## §0 — Pre-flight

> ‏הסלייס מוסיף לטופס החיבור (`/`) ‏ווידג'ט שמציג את כל ה-agents החיים בצד-השרת
> ‏(CLI, ‏תיקייה, ‏סשן, ‏סטטוס, ‏גיל, pid), ‏עם 3 ‏פעולות לכל שורה: ‏**‏נעיצה (Pin)**,
> ‏**‏חיבור-מחדש**, ‏**‏הריגה**. ‏כך המשתמש רואה את כל התהליכים, ‏יכול לנעוץ כדי שלא ייהרגו
> ‏בסגירת UI, ‏ולהתחבר/להרוג ידנית. ‏**‏נשען על נתיב warm-reconnect הקיים** (`loadSession`).

### ‏תלויות (‏חובה!)

‏slice זה **‏מבוסס על** `slice-active-agents-backend` (status: ‏חייב verified/merged לפני dispatch):
- ‏משתמש ב-`AgentPublic.persistent` / `.pid` / `.attached` (‏נוספו שם).
- ‏משתמש ב-`POST /api/agents/:id/persistent` (‏נוסף שם).
- ‏מסתמך שה-reaper לא הורג נעוצים (‏אחרת הנעיצה חסרת-משמעות).

> ⚠️ ‏**‏חוסם dispatch**: ‏branch `slice-active-agents-backend` ‏**‏עדיין לא קיים** (‏לא local, ‏לא remote
> ‏— ‏אומת ע"י אביגיל 2026-06-13). ‏ה-base בפועל הוא ה-branch הזה (שרשור), ‏לא dev. ‏**‏אין לפתוח
> ‏worktree ל-widget עד שה-backend slice בוצע** (‏ה-branch נוצר ב-dispatch של ה-backend) ‏או מוזג ל-dev.
> ‏לפי JIT — ‏ה-widget מאומת/נכתב סופית **‏אחרי** ‏שה-backend חזר GO. ‏אביגיל בודקת עקביות `depends_on`/`base`.

### ‏סביבה: **Windows-native** (‏החלטה 2026-06-13)

> ‏הפרויקט עבר ל-Windows. ‏השל הראשי PowerShell; ‏Git-Bash (MINGW64) ‏זמין ל-bash scripts.

### Worktree

```powershell
# מהשורש d:\UserProjects\AI\drive-coding — שרשור: base הוא branch התלות, לא dev
cd d:\UserProjects\AI\drive-coding
git worktree add .worktrees\slice-active-agents-widget -b slice-active-agents-widget slice-active-agents-backend
cd .worktrees\slice-active-agents-widget
pnpm install ; pnpm hooks:install
```

### ‏איך להריץ

- BE: `pnpm --filter @drive-coding/backend dev` (port 4000). ‏**‏נדרש BE חי** — ‏הווידג'ט מושך agents אמיתיים. ‏(‏onecli wrapper הוא לינוקס — ‏על Windows מריצים ישירות.)
- FE: `pnpm --filter @drive-coding/frontend dev` (port: OS-assigned).
- Typecheck: `pnpm --filter @drive-coding/frontend typecheck`.
- ‏lint:i18n: `pnpm lint:i18n` ‏(על Windows דרך Git-Bash; ‏fallback: `bash ./scripts/lint-no-hebrew-in-code.sh`).
- Tests: `pnpm --filter @drive-coding/frontend test`.

### Browser

‏Windows: ‏Chrome עם `--remote-debugging-port=9222` (‏פרופיל ייעודי), ‏ו-`playwright-cli attach --cdp=http://localhost:9222`. ‏(‏ה-skill `playwright-cli` ‏זמין; ‏אם anti-detection נדרש — `pw-clean`.)
‏בדיקה: ‏(1) ‏צור 2-3 ‏agents (התחבר לכמה תיקיות, ‏חזור ל-`/`). ‏(2) ‏הווידג'ט מראה אותם. ‏(3) ‏Pin → ‏נשאר; ‏reconnect → ‏עובר ל-/chat; ‏kill → ‏נעלם.

### Reading list

**must-read** (‏לפני שמתחילים):
- `packages/frontend/AGENTS.md` — ‏5 ‏שכבות + 5 ‏חוקי זהב. ‏**‏קריטי**: routes לא עושים fetch/polling; ‏components הם leaves (props/getContext, ‏קוראים VM method מותר — ‏ראה SessionOptionsPanel); ‏fetch/state חי ב-VM.
- `packages/frontend/src/lib/context.ts` — ‏דפוס `createContext` + ‏**‏קונבנציית התוספתיות** (הוסף בלוק בסוף, ‏אל תערוך קיים). שורות 9-12.
- `packages/frontend/src/routes/+layout.svelte` — composition root. ‏דפוס הוספת VM (1-3 ‏בתיעוד למעלה). ‏ה-VM החדש בלתי-תלוי → ‏אפשר בכל מקום.
- `packages/frontend/src/routes/+page.svelte` — ‏טופס החיבור. `onMount` (29-49), `onSubmit` ‏ענף ה-existing-session (101-107) — ‏**‏זה בדיוק נתיב ה-reconnect שנחקה**.
- `packages/frontend/src/lib/adapters/agents-api.ts` — `listAgents` (50-59), `deleteAgent` (91-102). ‏מוסיף `setAgentPersistent`.
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — `loadSession` ‏(public, `:508`; ‏ה-reconnect קורא לו. ⚠️ ‏זורק אם `status` ‏הוא connecting/connected — ‏עקבי עם onSubmit שמחקים), `#findReusableAgent` (‏matches לפי `acpSessionId + cwd`). **‏לא משנים את הקובץ הזה** — ‏רק קוראים ל-`loadSession`.
- `packages/frontend/src/lib/components/modals/SessionCard.svelte` — ‏דפוס ויזואלי לשורה (Tailwind + design tokens). ‏לחיקוי.
- `packages/core/src/i18n/keys.ts` — ‏דפוס הוספת מפתח (1-9) + ‏בלוק connect (24+). `catalogs/he.ts`, `catalogs/en.ts`.

**reference**:
- `packages/frontend/src/lib/components/connect/SessionPicker.svelte` — ‏דפוס props של רכיב connect.

---

## §1 — ‏מטרה

‏אחרי הסלייס, ‏כשמשתמש פותח את טופס החיבור הוא רואה **‏ווידג'ט "תהליכים פעילים"** ‏עם כל
‏ה-agents שרצים בצד-השרת: ‏לכל אחד — ‏איזה CLI, ‏איזו תיקייה, ‏איזה סשן, ‏סטטוס, ‏גיל ו-pid.
‏לכל שורה: ‏**‏נעיצה** (כדי שהתהליך לא ייהרג כשה-UI נסגר), ‏**‏חיבור-מחדש** (קופץ ל-/chat לאותו
‏סשן), ‏ו-**‏הריגה**. ‏כך אין יותר חשש מ"תהליכים דולפים" — ‏הכל גלוי ובשליטה, ‏ואפשר להשאיר
‏תהליכים רצים בכוונה (נעוצים) גם כשהממשק סגור.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|------|------|------|
| ‏VM `ActiveAgents` (list + refresh + setPersistent + kill) | ✅ | ‏בסלייס הזה |
| ‏רכיב `ActiveProcessesPanel` ‏בטופס החיבור | ✅ | ‏בסלייס הזה |
| ‏שורה: CLI, cwd, ‏סשן (8 ‏תווים), ‏סטטוס, ‏גיל, pid | ✅ | ‏בסלייס הזה |
| ‏פעולת Pin (toggle `persistent`) | ✅ | ‏בסלייס הזה |
| ‏פעולת reconnect (דרך `session.loadSession` הקיים) | ✅ | ‏בסלייס הזה |
| ‏פעולת kill (דרך `deleteAgent` הקיים) + ‏אישור-קצר | ✅ | ‏בסלייס הזה |
| refresh ‏ב-mount + ‏כפתור רענון ידני | ✅ | ‏בסלייס הזה |
| reconnect מושבת כש-`attached===true` ‏או אין `acpSessionId` | ✅ | ‏בסלייס הזה |
| polling אוטומטי כל X שניות | ❌ | ‏עתידי — refresh ידני + on-mount מספיק ל-v1 |
| ‏שינוי `agent-session.svelte.ts` / ‏לוגיקת reconnect | ❌ | ‏לא — ‏רק קוראים ל-loadSession הקיים |
| ‏שמות-סשן אנושיים (title) | ❌ | ‏דורש listSessions יקר (spawn) — ‏מציגים sessionId קצר |
| ‏ווידג'ט גם בתוך /chat (sidebar) | ❌ | ‏עתידי — ‏רק בטופס החיבור |

---

## §3 — Architecture diagram

```
+layout.svelte (composition root)
  const activeAgents = new ActiveAgents()        ← חדש (בלתי-תלוי)
  setActiveAgents(activeAgents)                  ← חדש

context.ts  + [getActiveAgents, setActiveAgents] ← חדש (בלוק בסוף)

view-models/active-agents.svelte.ts  ← חדש (entity: live server agents)
  agents   = $state<AgentPublic[]>([])
  loading  = $state(false)
  error    = $state<string|null>(null)
  refresh()             → listAgents()
  setPersistent(id, on) → setAgentPersistent() → refresh()
  kill(id)              → deleteAgent()         → refresh()

adapters/agents-api.ts  + setAgentPersistent(id, persistent)  ← חדש

components/connect/ActiveProcessesPanel.svelte  ← חדש (leaf)
  getActiveAgents() → רשימה
  per row: pin/unpin (VM), kill+confirm (VM), reconnect → onReconnect(agent) callback
  manual refresh button → activeAgents.refresh()

routes/+page.svelte  (משתנה)
  onMount: + void activeAgents.refresh()         ← זול (GET, אין spawn)
  <ActiveProcessesPanel onReconnect={handleReconnect} />
  handleReconnect(agent):                        ← מחקה onSubmit:101-107
    settings.setCliKind/setLastCwd
    await session.loadSession({ sessionId: agent.acpSessionId, cwd: agent.cwd, cliKind })
    if connected → goto("/chat")

i18n: keys.ts + he.ts + en.ts  + בלוק "// ─── active-agents ───" (בסוף)
```

---

## §4 — Commits ‏בסדר

### Commit 0 — i18n keys + adapter `setAgentPersistent` (approach: none)

**‏קבצים שמשתנים**:
- `packages/core/src/i18n/keys.ts` — ‏בלוק חדש **‏בסוף** ‏ה-union.
- `packages/core/src/i18n/catalogs/he.ts` — ‏בלוק חדש בסוף.
- `packages/core/src/i18n/catalogs/en.ts` — ‏בלוק חדש בסוף.
- `packages/frontend/src/lib/adapters/agents-api.ts` — ‏מוסיף `setAgentPersistent`.

**‏מפתחות i18n** (‏בלוק `// ─── active-agents ───`):

| ‏מפתח | he | en |
|------|-----|-----|
| `connect.agents.title` | תהליכים פעילים | Active processes |
| `connect.agents.empty` | אין תהליכים פעילים | No active processes |
| `connect.agents.refresh` | רענן | Refresh |
| `connect.agents.reconnect` | התחבר מחדש | Reconnect |
| `connect.agents.kill` | הרוג | Kill |
| `connect.agents.killConfirm` | בטוח? | Sure? |
| `connect.agents.pin` | השאר חי | Keep alive |
| `connect.agents.unpin` | בטל נעיצה | Unpin |
| `connect.agents.inUse` | פעיל בכרטיסייה אחרת | Open in another tab |

> ‏הוסף את **‏כל** ‏המפתחות לשלושת הקבצים (keys union + he + en). ‏**typecheck** ‏אוכף שלמות
> ‏(`Catalog = Record<MessageKey, string>`) — ‏מפתח חסר בקטלוג יפיל את ה-typecheck של Commit 0.

**adapter** (‏אחרי `deleteAgent`, ‏שורה 102):
```ts
/** משנה את דגל הנעיצה (persistent) של agent. */
export async function setAgentPersistent(
  agentId: string,
  persistent: boolean,
): Promise<void> {
  const res = await withTimeout(
    (s) =>
      fetch(beUrl(`/api/agents/${agentId}/persistent`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persistent }),
        signal: s,
      }),
    AGENTS_API_TIMEOUT_MS,
    { label: "setAgentPersistent" },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`setAgentPersistent failed: ${res.status} ${body}`)
  }
}
```

**Verification**:
```bash
pnpm lint:i18n
pnpm --filter @drive-coding/core typecheck && pnpm --filter @drive-coding/frontend typecheck
```

---

### Commit 1 — VM `ActiveAgents` + חיווט context/layout (approach: tdd)

**‏קבצים חדשים**:
- `packages/frontend/src/lib/view-models/active-agents.svelte.ts`

**‏קבצים שמשתנים**:
- `packages/frontend/src/lib/context.ts` — ‏בלוק חדש **‏בסוף** (אל תערוך קיים).
- `packages/frontend/src/routes/+layout.svelte` — import + `new ActiveAgents()` + `setActiveAgents(...)`.

**API skeleton** (`active-agents.svelte.ts`):
```ts
import type { AgentPublic } from "@drive-coding/core"
import { listAgents, deleteAgent, setAgentPersistent } from "$lib/adapters/agents-api"

export class ActiveAgents {
  agents = $state<AgentPublic[]>([])
  loading = $state(false)
  error = $state<string | null>(null)

  refresh = async (): Promise<void> => {
    this.loading = true
    this.error = null
    try {
      this.agents = await listAgents()
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
    } finally {
      this.loading = false
    }
  }

  setPersistent = async (id: string, persistent: boolean): Promise<void> => {
    await setAgentPersistent(id, persistent)
    await this.refresh()
  }

  kill = async (id: string): Promise<void> => {
    await deleteAgent(id)
    await this.refresh()
  }
}
```
> **‏מתודות כ-arrow fields** (`refresh = async () =>`) — ‏שומר `this` ‏כשמעבירים אותן כ-handlers
> ‏לרכיב. ‏עקבי עם הדפוס ב-agent-session (`#findReusableAgent = async () =>`).

**context.ts** (‏בלוק בסוף):
```ts
// ─── active-agents ─── (slice active-agents-widget)
export const [getActiveAgents, setActiveAgents] = createContext<ActiveAgents>()
```
+ ‏import type בראש: `import type { ActiveAgents } from "./view-models/active-agents.svelte"`

**+layout.svelte**:
- import: `import { ActiveAgents } from "$lib/view-models/active-agents.svelte"`
- ‏הוסף ל-import של context: `setActiveAgents`
- ‏בלוק: `// ─── active-agents ─── (slice active-agents-widget — בלתי-תלוי)` + `const activeAgents = new ActiveAgents()`
- ‏ב-setContext: `setActiveAgents(activeAgents)`

**Tests** (`active-agents.svelte.test.ts`) — ‏mock את `$lib/adapters/agents-api` (vi.mock):
- `refresh()` ‏ממלא `agents` ‏מ-listAgents, ‏מאפס loading.
- `refresh()` ‏על שגיאה → `error` ‏מאוכלס, ‏לא זורק.
- `setPersistent(id,true)` ‏קורא ל-adapter ‏ואז refresh.
- `kill(id)` ‏קורא ל-deleteAgent ‏ואז refresh.

> ‏בדוק דפוס mock קיים: `packages/frontend/src/lib/adapters/agents-api.test.ts` ‏ו-`agent-session.test.ts`.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck && pnpm --filter @drive-coding/frontend test
```

---

### Commit 2 — רכיב `ActiveProcessesPanel` (approach: manual)

**‏קבצים חדשים**:
- `packages/frontend/src/lib/components/connect/ActiveProcessesPanel.svelte`

**Props** (‏שים לב: ‏`verbatimModuleSyntax: true` ‏ב-tsconfig → ‏**‏חובה `import type`**):
```ts
import type { AgentPublic } from "@drive-coding/core"

interface Props {
  onReconnect: (agent: AgentPublic) => void
}
```
> ‏הרכיב מושך את הרשימה מ-`getActiveAgents()` (context), ‏לא מ-props. reconnect הוא callback
> ‏(הניווט שייך ל-route, ‏לא לרכיב — ‏חוק שכבות).

**‏התנהגות**:
- ‏כותרת `t("connect.agents.title")` + ‏כפתור רענון (`activeAgents.refresh()`, ‏אייקון, ‏disabled בזמן loading).
- ‏ריק → `t("connect.agents.empty")`.
- ‏לכל agent (‏`{#each activeAgents.agents as a (a.id)}` — ‏**‏key לפי id** ‏לריאקטיביות נכונה):
  - ‏שורה בסגנון SessionCard: badge `a.cliKind` · `a.cwd` (truncate) · `a.acpSessionId?.slice(0,8)` · ‏נקודת-סטטוס לפי `a.status` · ‏גיל מ-`a.createdAt` · `pid` ‏**‏בתצוגה מותנית** (`{#if a.pid}pid: {a.pid}{/if}` — ‏השדה אופציונלי, ‏לא מאוכלס אם ה-BE לא העשיר; ‏אל תרנדר `undefined`).
  - **Pin**: ‏כפתור toggle. `a.persistent` ? `unpin` : `pin`. onclick → `activeAgents.setPersistent(a.id, !a.persistent)`. ‏חיווי ויזואלי לנעוץ (אייקון מלא/accent).
  - **Reconnect**: ‏כפתור. **‏disabled** ‏אם `!a.acpSessionId` ‏(אין סשן לטעון) ‏**‏או** `a.attached === true` (‏פתוח בטאב אחר — ‏ה-BE ידחה WS שני ב-1008). ‏tooltip `inUse` ‏כשמושבת. onclick → `onReconnect(a)`.
  - **Kill**: ‏אישור-קצר דו-לחיצה — local `$state` ל-`confirmingId`. ‏לחיצה ראשונה: ‏הכפתור הופך ל-`t("connect.agents.killConfirm")`; ‏לחיצה שנייה (‏או על אותו id) → `activeAgents.kill(a.id)`; ‏לחיצה על שורה אחרת / ‏טיים-אאוט קצר → ‏איפוס. (‏**‏לא** ‏native `confirm()` — ‏חוסם; ‏לא ModalsVM — ‏scope creep.)

**‏עיצוב**: Tailwind + design tokens (`var(--bg-elev)`, `var(--border)`, `var(--accent)`, `var(--fg-dim)`, `var(--recording)` ‏ל-kill). ‏חקה את SessionCard. ‏נקודת-סטטוס (‏כסה את **‏כל** 5 ‏ערכי `AgentStatus`): ‏`ready`=accent, `busy`=accent (‏או amber/warn), `starting`=muted, `crashed`/`closed`=recording.

**‏גיל**: ‏**‏העדפה — ‏חקה את `formatDate` ‏של `SessionCard.svelte:17-25`** (`new Date(iso).toLocaleString("he-IL", { day, month, hour, minute })` → ‏תאריך+שעה, ‏לא רק שעה) — ‏אפס מחרוזות חדשות, ‏אפס תלות ב-i18n. ‏(‏אם בכל זאת רוצים relative "5 ‏דק'" — ‏יחידות הזמן **‏חייבות** ‏לעבור דרך `t()`, ‏אחרת `lint:i18n` ‏חוסם. ‏ברירת המחדל: ‏העתק את `formatDate` ‏כמו שהוא.)

> ⚠️ **‏אין מחרוזת עברית קשיחה בקוד** — ‏הכל דרך `t()`. `pnpm lint:i18n` ‏חוסם. ‏ראה §6.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck && pnpm --filter @drive-coding/frontend build && pnpm lint:i18n
```

---

### Commit 3 — חיווט בטופס החיבור + reconnect handler (approach: manual) ⚠️ verifier-phase

**‏קבצים שמשתנים**:
- `packages/frontend/src/routes/+page.svelte` — ‏import הרכיב + VM, refresh ב-onMount, render, handler.

**‏השינויים**:
1. import: `import ActiveProcessesPanel from "$lib/components/connect/ActiveProcessesPanel.svelte"` + ‏`getActiveAgents` ‏מ-context.
2. `const activeAgents = getActiveAgents()`.
3. ‏ב-`onMount` (29) — ‏הוסף בתחילתו: `void activeAgents.refresh()` (‏זול — GET, ‏אין spawn, ‏בניגוד ל-loadSessions; ‏ללא guard — ‏רענון בכל mount רצוי).
4. render — ‏מעל ה-`<form>` ‏או מתחת ל-subtitle (‏מיקום: ‏ראש הטופס, ‏הכי גלוי):
   ```svelte
   <ActiveProcessesPanel onReconnect={handleReconnect} />
   ```
5. handler — ‏**‏מחקה את onSubmit:101-107** (‏ענף existing-session):
   ```ts
   async function handleReconnect(agent: AgentPublic) {
     if (!agent.acpSessionId) return
     settings.setCliKind(agent.cliKind)
     settings.setLastCwd(agent.cwd)
     await session.loadSession({
       sessionId: agent.acpSessionId,
       cwd: agent.cwd,
       cliKind: agent.cliKind,
     })
     if (session.status === "connected") {
       await goto("/chat")
     }
   }
   ```
   + import type `AgentPublic` ‏מ-`@drive-coding/core`.

> **‏למה זה בטוח**: `loadSession` ‏הוא נתיב warm-first קיים ומאומת (slice ws-reconnect).
> ‏`#findReusableAgent` (182) ‏ימצא את ה-agent החי לפי `acpSessionId + cwd` ‏ויעשה warm —
> ‏בלי spawn חדש. ‏אם warm נכשל → cold (loadSession מאפס). ‏**‏לא כותבים לוגיקת reconnect חדשה.**

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck && pnpm --filter @drive-coding/frontend build && pnpm lint:i18n
# ידני (linux-gui + BE חי): ראה §0 Browser + DoD §5.
```

> **‏verifier-phase כאן** (כלב mode:phase) — ‏ה-commit שמחבר reconnect אמיתי. ‏סיכון: ‏טאב כפול (1008), ‏ניווט, agent ללא session. ‏ראה §8.

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | typecheck + build נקי | `pnpm --filter @drive-coding/frontend typecheck && build` |
| 2 | lint:i18n עובר | `pnpm lint:i18n` (‏אין עברית קשיחה — ‏הכל דרך t()) |
| 3 | core+frontend tests | `pnpm --filter @drive-coding/core test && pnpm --filter @drive-coding/frontend test` |
| 4 | ‏הווידג'ט מציג agents | BE חי, ‏צור 2 agents → `/` ‏מראה 2 ‏שורות עם cwd/cli/pid/סטטוס |
| 5 | Pin עובד | ‏לחץ Pin → ‏חיווי נעוץ; `curl /api/agents` ‏מראה `persistent:true`; ‏נשאר אחרי refresh |
| 6 | reconnect עובד | ‏לחץ "התחבר מחדש" על agent עם session → ‏עובר ל-/chat, ‏ההיסטוריה נטענת (warm, ‏לא spawn חדש — ‏בדוק ב-BE log שאין createAgent) |
| 7 | reconnect מושבת נכון | agent בלי acpSessionId ‏או `attached:true` → ‏הכפתור disabled + tooltip inUse |
| 8 | kill עובד | ‏לחץ kill (×2 ‏אישור) → ‏השורה נעלמת; `curl` ‏מראה שה-agent נמחק |
| 9 | empty state | ‏אין agents → `t("connect.agents.empty")` |
| 10 | refresh ידני | ‏לחץ רענן → ‏הרשימה מתעדכנת |
| 11 | mobile + desktop | screenshot של הטופס עם הווידג'ט ב-2 viewports |
| 12 | regression: connect/loadSession רגיל | ‏בחר תיקייה+CLI → ‏חבר → /chat; ‏ובחר סשן קיים מ-SessionPicker → ‏עובד כמקודם |
| 13 | ‏אין לוגיקה כבדה **‏חדשה** ב-route | ‏ה-glue היחיד: import + `const activeAgents` + `void activeAgents.refresh()` ב-onMount + render + `handleReconnect` (מחקה onSubmit). fetch/state ב-VM. ‏(‏**‏הערה**: ‏ה-route כבר 316 שורות — debt **‏קיים**, ‏מעל ספיק ה-150 של AGENTS.md. ‏**‏לא** ‏מחלצים בסלייס הזה; ‏ראה §7.) |

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| ‏מחרוזות עברית קשיחות בווידג'ט | learnings (decisions: ws-reconnect i18n gate חסם commit) | ‏**‏כל** ‏טקסט דרך `t()` + ‏9 ‏מפתחות ב-commit 0. `pnpm lint:i18n` ‏(hook) חוסם. ‏גיל = `formatDate` ‏מספרי (אין מילים). DoD#2. |
| Svelte 5 reactivity על array | recommendations | `{#each activeAgents.agents as a (a.id)}` ‏עם **‏key**; ‏`agents` ‏הוא `$state`; refresh מציב array חדש (לא mutate). |
| ‏ניווט/לוגיקה כבדה ב-route (חוק #1) | AGENTS.md | ‏fetch/state ב-VM; ‏route רק קורא `activeAgents.refresh()` ‏ב-onMount (כמו loadSessions הקיים) ‏ו-handler שמחקה onSubmit קיים. DoD#13. |
| ‏טאב כפול → 1008 ב-reconnect | ws-agent one-tab (BE) | ‏reconnect **‏disabled** ‏כש-`attached===true`. ‏אם בכל זאת — `loadSession` ‏warm נכשל → ‏cold (לא קורס). DoD#7. |
| reconnect ל-agent בלי session (starting/לא-attached) | acpSessionId אופציונלי | ‏הכפתור disabled כש-`!acpSessionId`; ‏ה-handler גם בודק ו-return מוקדם. DoD#7. |
| VM context לא זמין ב-`/` (לא עטוף ב-AppShell) | layout structure | ‏context נקבע ב-**root** +layout (עוטף את `/` — `getSettings/getSession` ‏כבר עובדים שם). ‏אומת: +page.svelte:16-19 ‏כבר משתמש ב-getContext. |
| ‏שמות-סשן לא אנושיים (רק id) | listSessions יקר | ‏מציגים `sessionId.slice(0,8)` + cwd (זול). title מלא = ‏עתידי. ‏מתועד ב-Scope. |
| ‏מחיקת agent בזמן reconnect race | async | kill/reconnect הם פעולות מפורשות של המשתמש; refresh אחרי כל פעולה מסנכרן. ‏לא מטפלים ב-race תיאורטי ל-v1. |

> ‏3 שתמיד נשכחים:
> 1. Hardcoded strings → ‏9 ‏מפתחות i18n, ‏אפס עברית בקוד. ✅
> 2. Reactivity → `{#each ... (a.id)}` + `$state` array. ✅
> 3. OneCLI placeholder → ‏ה-BE רץ דרך OneCLI; ‏אין שינוי. ✅

---

## §7 — Escalation triggers

> ‏אם X — ‏עצור ושאל את מרדכי:

- ‏**‏הבהרה על ספיק ה-150**: ‏`+page.svelte` ‏כבר **‏316 שורות** ‏לפני הסלייס (debt קיים, ‏מעל הספיק). ‏**‏אל תחלץ אותו בסלייס הזה** — ‏הוסף רק את ה-glue (import + VM + onMount line + render + `handleReconnect`, ‏~13 שורות שמחקות את onSubmit הקיים). ‏אם ה-`handleReconnect` ‏גדל מעבר לחיקוי של onSubmit (לוגיקה חדשה מהותית) — ‏עצור ושאל אם לחלץ ל-action. ‏ריפקטור ה-route כולו = ‏סלייס נפרד.
- `loadSession` ‏מהווידג'ט מתנהג שונה מה-SessionPicker (‏reconnect לא עושה warm / ‏יוצר agent כפול).
- ‏ה-VM context לא זמין ב-`/` (‏בניגוד לצפי — ‏ראה §6).
- ‏אתה רוצה להוסיף polling אוטומטי (‏מחוץ ל-scope) ‏או ModalsVM ל-kill (‏scope creep).
- backend (התלות) ‏לא סיפק `pid`/`attached`/`persistent` ‏כצפוי — ‏עצור, ‏זו בעיית שרשור.

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|------|------|
| Cross-store data flow חדש (VM חדש + context) | +2 |
| ‏ספרייה DOM-mutating (Svelte each/reactivity) | +1 |
| >5 files ‏ב->1 package (core i18n + frontend) | +1 |
| ‏נגיעה באזור reconnect (אבל read-only reuse) | +1 |
| Greenfield component, ‏אין call-sites קיימים | -1 |
| TDD על ה-VM | -1 |
| ‏בסיס glue | +2 (base) |
| ‏שרשור על תלות לא-merged | +1 |

**Score**: 6 / 10

**Tier**: 4-7 → `calev` (light) + `verifier-phase` ‏על **commit 3** (reconnect — ‏נגיעה ב-flow מסוכן).

**‏Verifier-phase אחרי**: commit 3.

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | ‏מיקום הווידג'ט — ‏ראש הטופס או תחתית? | ‏ראש (מתחת ל-subtitle, ‏הכי גלוי) | ❌ |
| 2 | ‏גיל כ-relative ("5 ‏דק'") ‏או שעה מוחלטת? | ‏שעה מוחלטת (`formatDate` ‏כמו SessionCard) — ‏אפס מחרוזות חדשות | ❌ |
| 3 | ‏אישור kill — ‏דו-לחיצה inline ‏או modal? | ‏דו-לחיצה inline (‏בלי תלות ב-ModalsVM) | ❌ |
| 4 | ‏להציג גם agents `crashed`/`closed` ‏או לסנן? | ‏להציג (‏עם נקודת-סטטוס אדומה) — ‏שקיפות מלאה; ‏kill מנקה | ❌ |

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor ‏תוך כדי)

- **blocked-on-cwd-fix**: בדיקת agent חי end-to-end על Windows (DoD items 4-8: ווידג'ט מציג, Pin, reconnect, kill, refresh) — חסומה על `fix-cwd-validate-windows` (940d222). validateCwd חוסם נתיבי Windows ב-400, יצירת agent נכשלת. כלב יצרף את ה-fix בשלב האימות כמתועד ב-brief header.
- **fakeAgent.modelOverride**: בטסט TDD הוספתי `modelOverride: null` לאובייקט הבדיקה — שדה חובה ב-AgentPublic שה-brief לא ציין מפורשות. תיקון טריוויאלי שנדרש ל-typecheck.
