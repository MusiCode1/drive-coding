# Slice ws-reconnect-infra — תשתית שחזור חיבור WebSocket (warm-first, VM-only) — תוכנית

> **תאריך**: 2026-06-03
> **סטטוס**: הושלם 2026-06-03 — 4 commits (5dc69dc→8d14a42), 634 tests ✓
> **Complexity**: 8/10 (verifier: heavy)
> **תלויות (`depends_on`)**: []
> **Base**: dev
> **Dev tip**: `8f59ec3` (fix-409 מוזג — `notifySessionAttached` תומך ב-`{replace:true}`)

---

## §0 — Pre-flight

> אם אתה executor חדש: קרא את [`EXECUTOR_DISPATCH.md`](./EXECUTOR_DISPATCH.md) לפני כל דבר אחר.

### תלויות (חובה!)

slice זה **מבוסס על dev בלבד**. כל הסמלים שצוינו קיימים ב-dev tip `8f59ec3`:

- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — `AgentSession` עם `loadSession`(212), `attach`(107), `detach`(158-168), **`switchSession`(288-336)**, `#cleanup`(472-488), `#setStatus`(451-457), `#captureSessionConfig`(462-470), `status`, `error`, `bubbles`, `agentId`, `cwd` ($state 65-69), `#sessionId`(91), `#client`(90), `#detached`(99). ה-`onClose` listener רשום פעמיים (`attach` 125-134, `loadSession` 242-248) — **זהים**. `waitForOpen` בשורה 135/249. ה-WS URL נבנה כ-``${proto}//${location.host}/ws/agent/${agentId}`` (124, 241). `loadSession` guard בשורה **217** (`if status==="connecting"||"connected" throw`). `loadSession` מאפס `bubbles=[]`(222), קובע `this.cwd`(237), `this.agentId`(236), `#sessionId`(263).
- **⚠️ `switchSession`(288-336) הוא הדגם הקרוב ביותר ל-warm** — הוא כבר עושה `#client.loadSession({sessionId,cwd})` + `#captureSessionConfig` + `notifySessionAttached(agentId, sessionId, {replace:true})`(327) + `#setStatus("connected")`. **ההבדל היחיד מ-warm-reconnect**: `switchSession` עובד על `#client` **חי** (אותו WS פתוח); ה-reconnect שלנו צריך WS **חדש** לאותו agentId (כי הישן מת). חקה את ה-pattern של switchSession, רק עם WS חדש לפניו. ראה Commit 2.
- `packages/frontend/src/lib/adapters/agents-api.ts` — `createAgent`(27), `getAgent`(51), `deleteAgent`(79), **`notifySessionAttached`(61) — חתימה `(agentId, sessionId, opts?: { replace?: boolean })`** (fix-409 מוזג). `CreateAgentResponse` כולל `agentId`+`acpSessionId?`+`status`. **אין** כרגע פונקציה שמושכת רשימת agents (`GET /api/agents`) — נוסיף `listAgents()` ב-Commit 1.
- `packages/core/src/schemas/agent.ts` — `AgentPublic`(75-89): `{ id, cliKind, cwd, modelOverride, status, createdAt, crashReason?, acpSessionId? }`. **מיוצא מ-`@drive-coding/core` ה-root דרך `export * from "./schemas"`** (core/src/index.ts:4) → `import type { AgentPublic } from "@drive-coding/core"` עובד. `AgentStatus`(55): `'starting'|'ready'|'busy'|'crashed'|'closed'`. `AgentList`(102): `{ agents: AgentPublic[] }`. ההערה ב-84-86 מתעדת: `acpSessionId` נועד ל-FE לקריאת `loadSession` ברענון.
- **⚠️ `packages/frontend/src/lib/engines/ws-transport.ts` `waitForOpen`(70-78)** — מאזין **רק** ל-`open` (resolve) ו-`error` (reject). **לא** מאזין ל-`close`! קריטי ל-warm: סגירת WS ב-1008 היא `close` event, **לא** `error` → `waitForOpen` נתקע **לנצח** (deadlock). ה-warm חייב `Promise.race` בין `waitForOpen()` ל-Promise שנפתר ב-onClose. ראה Commit 2 (תיקון אביגיל #1).
- `packages/backend/src/delivery/http-agents.ts` — `GET /api/agents`(27-30) מחזיר `{ agents: AgentPublic[] }` דרך `toAgentPublic`. `GET /api/agents/:id`(70-75) → 404 אם לא קיים.
- `packages/backend/src/delivery/ws-agent.ts` — **MED-8** (69-72): WS שני לאותו agentId → `close(1008, "agent in use by another tab")`. child שורד WS close (127-134: `markDetached`+`activeFeWs.delete`, **בלי** `child.kill`). child exit → `feWs.close(1011, "bridge closed")`(116-124).
- `packages/backend/src/server.ts` (138-155) — reaper הזמני (slice 26): הורג detached bridges אחרי `BRIDGE_IDLE_TIMEOUT_MS` (default 300_000 = 5 דק'). **חלון ה-reconnect.**
- `packages/backend/src/app/agent-orchestrator.ts` — שורה 14 מתעדת: **"הוסר מ-Slice 9: historyBuffer / שידור היסטוריה"**. ה-BE הוא pure pipe, **אין** buffer של שיחה בצד שרת — המקור-אמת היחיד הוא הסוכן עצמו (דרך `loadSession` ACP).
- `packages/frontend/src/routes/+layout.svelte` (42, 81-84) — singleton `session` + `window.__session` ב-DEV (כלי האימות המרכזי כאן).

`depends_on: []`.

> **הערה על base**: dev tip `8f59ec3` (fix-409 כבר מוזג — `notifySessionAttached` תומך ב-`replace`). slice-17 (wake-word) לא מוזג. slice זה נוגע ב-`agent-session.svelte.ts` + `agents-api.ts` (מוסיף `listAgents`) + טסט — אין חפיפה עם wake-word. `base: dev`.

> **⚠️ זהו slice TASHTIT (infra) בלבד — אפס UI.** ה-slice העוקב `slice-ws-reconnect-ui` (טרם נכתב, JIT, ייסגר בנפרד) יוסיף כפתור + חיווי, `depends_on: [ws-reconnect-infra]`. **אל תיגע ב-components/routes/i18n כאן** (DoD #17). ההחלטה על הממשק נדחית בכוונה.

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-ws-reconnect-infra -b slice-ws-reconnect-infra dev
cd .worktrees/slice-ws-reconnect-infra
pnpm install && pnpm hooks:install
```

### איך להריץ

| מה | פקודה |
|---|---|
| BE | `cd packages/backend && LOG_WIRE=ws PORT=4001 onecli run --agent voice-acp -- bun --watch src/server.ts` |
| BE (reaper מהיר לטסט cold) | `BRIDGE_IDLE_TIMEOUT_MS=8000 PORT=4001 onecli run --agent voice-acp -- bun --watch src/server.ts` |
| FE | `BE_PORT=4001 pnpm --filter @drive-coding/frontend dev` |
| Frontend typecheck | `pnpm --filter @drive-coding/frontend typecheck` |
| כללי | `pnpm typecheck && pnpm lint:i18n` |
| Tests | `pnpm test` |

אם port 4001 תפוס — עבור ל-4002+. **אל תהרוג** שירותים קיימים (כולל `voice-acp-be` ה-systemd על 4000).

### Browser

linux-gui Chrome :9222 profile voice-acp. `playwright-cli -s=vacp attach --cdp=http://localhost:9222`. ⚠️ תמיד `-s=vacp`. הליבה נבדקת דרך **DevTools console** (`window.__session`) — אין UI בסלייס זה. connect אמיתי דרוש (לא mock — mock לא מחזיק WS).

### OneCLI agent

שם: `voice-acp`. שימוש: `onecli run --agent voice-acp -- <cmd>` (מזריק xi-api-key + x-goog-api-key). ה-BE חייב לרוץ דרך OneCLI אחרת proxy מחזיר 401.

### איך לדמות נפילת WS + שני התרחישים (כלי האימות המרכזי)

אין "כפתור" שמפיל WS. **שני תרחישים שונים שחייבים להיבדק בנפרד:**

1. **WARM** (ה-bridge עוד חי): **DevTools → Network → offline** לרגע ואז online → ה-WS נופל (code 1006) אבל ה-child **לא** מת בצד BE. או: `BRIDGE_IDLE_TIMEOUT_MS` גבוה (default) + נתק רשת רגעי. → ה-reconnect צריך למצוא את ה-agent ב-`GET /api/agents` ולהתחבר אליו **בלי spawn חדש**.
2. **COLD** (ה-bridge מת): `pkill -f 'opencode'` בזמן שיחה → child exit → `feWs.close(1011)` + ה-agent יוצא מהרשימה. **או** `BRIDGE_IDLE_TIMEOUT_MS=8000` + נתק + המתנה ל-reaper. → ה-reconnect **לא** ימצא agent מתאים → ייצור חדש.

> **המלצה ל-calev**: בדוק את שני התרחישים בנפרד (DoD #7 warm, #8 cold). זיהוי warm-vs-cold דרך לוג BE: warm = **אין** `createAgent`/spawn חדש בלוג; cold = יש spawn חדש + agentId חדש.
>
> כלי console: `window.__session.status`, `window.__session.reconnectAttempt`, `window.__session.reconnect()`, ו-`fetch('/api/agents').then(r=>r.json()).then(console.log)`.

### Reading list

**must-read** (לפני שמתחילים):
1. `packages/frontend/AGENTS.md` — 5 חוקי הזהב. **#4 (side effects שייכים ל-owner)** קריטי. **חוקי import**: view-models→adapters מותר; adapters→core בלבד.
2. `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — כל הקובץ. במיוחד `loadSession` (212-275, **הדגם לבנייה של warm-path**), `onClose` (125-134, 242-248), `detach` (158-168), `#cleanup` (471-487), `#setStatus` (450-456), constructor (60-62).
3. `packages/frontend/src/lib/adapters/agents-api.ts` — כל הקובץ (מוסיפים `listAgents`).
4. `packages/core/src/schemas/agent.ts` 75-124 — `AgentPublic` + `toAgentPublic` (מה זמין ל-FE).
5. `docs/decisions/voice-acp.md` 375-504 + 716-748 — היסטוריית גישה A/B + "WS closed (1005)" ghost.

**reference** (בזמן עבודה):
- `packages/backend/src/delivery/ws-agent.ts` — MED-8 (69-72) + child שורד (127-134).
- `packages/backend/src/server.ts` 138-155 — reaper + timeout.
- `packages/backend/src/app/agent-orchestrator.ts` 14 — אין historyBuffer (BE = pipe).

---

## §1 — מטרה

היום, כשה-WebSocket נופל (crash של ה-CLI, נפילת רשת רגעית, reaper שהרג bridge נטוש, restart של BE), ה-`AgentSession` עובר ל-`error` ונשאר תקוע — אין מנגנון שחזור; צריך לרענן את הדף ולאבד את כל השיחה. אחרי ה-slice: ה-`AgentSession` **יודע לשחזר את עצמו בצורה חכמה**. כשה-WS נופל בלי detach מפורש ו**הדף בפוקוס** — מתחילה לולאת backoff שמנסה אוטומטית לשחזר. **השחזור הוא warm-first**: קודם בודקים `GET /api/agents` — אם הסוכן עדיין חי בצד השרת (אותו `acpSessionId`+`cwd`), מתחברים אליו ישירות **בלי spawn מחדש** (חוסך ~300-700ms), ורק טוענים את ההיסטוריה (`loadSession`) לשחזור ה-bubbles. אם הסוכן כבר מת (reaper/crash) — נופלים אוטומטית ל-cold: יוצרים agent חדש. כשה-WS נופל **כשהדף ברקע** — לא מנסים אוטומטית, אלא עוברים ל-`disconnected` שממתין לקריאת `reconnect()` יזומה. מתודה ציבורית `reconnect()` נחשפת ל-UI עתידי. **זהו slice תשתית בלבד** — אפס שינוי גלוי בממשק; הכל נבדק דרך `window.__session` ב-DevTools. ה-UI (כפתור + חיווי) הוא slice עוקב נפרד.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| `listAgents()` adapter (`GET /api/agents` → `AgentPublic[]`) | ✅ | ה-slice הזה |
| `reconnect()` ציבורי ב-`AgentSession` — **warm-first, cold fallback** | ✅ | ה-slice הזה |
| **warm reconnect**: מצא agent חי תואם → WS חדש לאותו agentId + `loadSession` (בלי spawn) | ✅ | ה-slice הזה |
| **MED-8 retry**: warm נדחה ב-1008 → retry קצר (×2-3, ~250ms) → fallback ל-cold | ✅ | ה-slice הזה |
| **cold reconnect** (fallback): אין agent מתאים → `loadSession` מאפס (spawn חדש) | ✅ | ה-slice הזה |
| auto-reconnect ב-`onClose` בפוקוס (backoff מדורג, 5 ניסיונות) | ✅ | ה-slice הזה |
| WS נופל ברקע → `disconnected`, ללא ניסיון אוטומטי | ✅ | ה-slice הזה |
| Page Visibility — מעקב `document.hidden` | ✅ | ה-slice הזה |
| state חדש: `"disconnected"` ב-union + `reconnectAttempt` $state | ✅ | ה-slice הזה |
| שמירת `cliKind` כשדה (לצורך reconnect) | ✅ | ה-slice הזה |
| ביטול לולאת reconnect ב-`detach` | ✅ | ה-slice הזה |
| **כל UI** (כפתור, חיווי, banner, i18n, נגיעה ב-components/routes) | ❌ | **`slice-ws-reconnect-ui`** (עוקב, JIT) |
| חזרה-לפוקוס מנסה reconnect אוטומטי | ❌ | §9 Q1 — ברירת מחדל: לא. ה-listener קיים, לא מטריגר אוטו |
| buffer של updates צד-שרת (החזרת historyBuffer שהוסר ב-slice 9) | ❌ | **future slice נפרד, מתועד** (§9 Q3) — דורש החלטה ארכיטקטונית (BE כיום = pipe) |
| cue קולי / toast בהצלחה | ❌ | future / slice-ui |
| רשימת agents פעילים / ניהול multi-agent / agents-ברקע | ❌ | future (גישה A המלאה) |
| שינוי reaper / MED-8 / `ws-agent.ts` בצד BE | ❌ | לא נוגעים (warm מטופל ב-FE עם retry+fallback) |

> זו לא טבלת TODO. זו הגנה מ-scope creep. ה-slice הוא **VM + adapter logic בלבד — אפס UI.**

---

## §3 — Architecture diagram

```text
─── נפילת WS (הדף בפוקוס) ───
BE: child crash / reaper / net drop → feWs.close(1011/1006/...)
  └── WsAcpTransport.onClose(code) → AgentSession   (handler משתנה בסלייס)
        ├── if #detached → return                       (קיים)
        ├── if code===1000||1001 → return               (קיים — סגירה תקינה)
        └── else → #handleUnexpectedClose(code,reason)   ← חדש
              ├── if #pageHidden → #setStatus("disconnected")  (רקע: לא אוטו)
              └── else → #scheduleReconnect()                  (פוקוס: backoff loop)

─── reconnect() ציבורי / לולאת backoff → #doReconnect() ───
#doReconnect():   ← הלב — warm-first
  1. agentId = #findReusableAgent()           ← GET /api/agents, סנן
  │    מחפש agent.acpSessionId === #sessionId
  │              && agent.cwd === cwd
  │              && status !== "crashed" && status !== "closed"
  2. אם נמצא → #warmReconnect(agentId):
  │    ├── WS חדש ל-`/ws/agent/${agentId}`  (אותו agent, בלי createAgent!)
  │    ├── אם close(1008 "in use") → retry ×N (250ms) → אם נכשל → cold
  │    ├── createAcpClient + loadSession ACP (#sessionId)   ← משחזר bubbles
  │    └── notifySessionAttached(agentId, #sessionId, replace:true)
  3. אם לא נמצא / warm נכשל → #coldReconnect():
  │    └── this.loadSession({sessionId:#sessionId, cwd, cliKind})  ← spawn חדש מאפס
  4. הצלחה → status="connected", reconnectAttempt=0

─── state machine ───
status: idle|connecting|connected|thinking|error|disconnected   ← +disconnected
reconnectAttempt: number   ← חדש ($state, UI עתידי קורא)

─── מקור-אמת השיחה ───
אין buffer ב-BE (historyBuffer הוסר slice 9). loadSession מושך הכל מהסוכן.
```

### החלטות ארכיטקטורה מחייבות

1. **owner-driven (חוק זהב #4)**: כל ה-reconnect + ה-`visibilitychange` listener ב-`AgentSession`. נחשף דרך `status` + `reconnectAttempt` ($state) + `reconnect()` (public). אין route/component בסלייס.
2. **warm-first, cold-fallback**: `#doReconnect` קודם מנסה warm (agent קיים), ובכל כשל (לא נמצא / 1008 אחרי retries / שגיאת WS/handshake) נופל ל-cold. **cold תמיד עובד** — הוא הרשת-ביטחון. **אסור** ש-warm יחסום או יזרוק החוצה — תמיד fallback.
3. **warm = loadSession בלי createAgent**: ה-bubbles ב-FE אבדו עם ה-WS, אז גם warm חייב `loadSession` ACP על ה-client החדש. החיסכון היחיד מ-cold = דילוג על `createAgent`/spawn (~300-700ms). ה-warm-path מחקה את `loadSession` (212-275) **חוץ מ-שורה 235** (`createAgent`) — משתמש ב-agentId הקיים.
4. **MED-8 retry**: warm מתחבר ל-**אותו** agentId → אם ה-BE עוד לא עיבד את ה-`close` הישן, ה-WS נדחה ב-1008. retry קצר (250ms ×2-3); אם עדיין נכשל → cold (agentId חדש, אין MED-8). **לא נוגעים ב-BE.**
5. **cold reconnect דרך `loadSession` מאפס** — תמיד עובד (bridge חי→agent חדש; מת→agent חדש). `loadSession` כבר משחזר היסטוריה + משתיק TTS (`isLoadingHistory`).
6. **`cliKind` נשמר כשדה `$state`** (`#cliKind`) — דרוש ל-cold (`loadSession` צריך אותו). שדה חדש → **INVASIVE** (מאושר, §9 Q4).
7. **`#setStatus` נקודת mutation יחידה** — `"disconnected"` עובר דרכו.
8. **`visibilitychange` ב-constructor** → `#pageHidden`. AgentSession singleton → אין הסרת listener.
9. **חוקי import**: `listAgents` ל-`agents-api.ts` (adapter — מותר לייבא core). ה-VM קורא ל-adapter (מותר). אין הפרת שכבות.

---

## §4 — Commits בסדר

### Commit 0 — תשתית state + cliKind + visibility (approach: tdd)

**מטרה**: ה-state הפסיבי — בלי לוגיקת reconnect עדיין.

**קבצים שמשתנים**:
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts`

**קבצים חדשים**:
- `packages/frontend/src/lib/view-models/agent-session.reconnect.test.svelte.ts` — ⚠️ הסיומת **חייבת** `.test.svelte.ts` (svelte preprocessor ל-`$state`). הדפוס: `settings.test.svelte.ts`, `wake-word.test.svelte.ts`.

**שינויי state** (INVASIVE — מאושר, slice ייעודי):

```ts
// union (אחרי "error", ~44):
export type AgentSessionStatus =
  | "idle" | "connecting" | "connected" | "thinking" | "error"
  | "disconnected"   // ← חדש: WS נפל, ממתין ל-reconnect (ידני/אוטו)

// $state חדש (~65-69):
reconnectAttempt = $state<number>(0)   // 0=לא מנסה; >0=הניסיון הנוכחי

// פרטי חדש (~90-99):
#cliKind: CliKind | null = null
#pageHidden = false
#reconnectTimer: ReturnType<typeof setTimeout> | undefined
#reconnecting = false
```

**שמירת cliKind** — ב-`attach` (אחרי `this.cwd = input.cwd`, ~120) וב-`loadSession` (אחרי `this.cwd = input.cwd`, ~237):
```ts
this.#cliKind = input.cliKind
```

**constructor** (~60):
```ts
constructor(opts?: { cues?: CuesEngine }) {
  this.#cues = opts?.cues
  if (typeof document !== "undefined") {
    this.#pageHidden = document.hidden
    document.addEventListener("visibilitychange", () => {
      this.#pageHidden = document.hidden
    })
  }
}
```

> ⚠️ ה-listener לא מוסר (singleton). אם אתה מוסיף `destroy()` — עצור ושאל.

**approach: tdd** — תשתית VM-test קיימת (`settings.test.svelte.ts`, `wake-word.test.svelte.ts` עם `vi.stubGlobal`). כתוב טסטים: default `reconnectAttempt===0`, `status` מקבל `"disconnected"` (union typecheck). ⚠️ `vitest.config.ts` = `environment:node` (אין `document`) — טסטי Commit 0 לא דורשים document; טסט שמכסה `#pageHidden` (Commit 3) דורש `vi.stubGlobal("document",...)` (דפוס ב-`wake-word.test.svelte.ts:50`). ה-guard `typeof document !== "undefined"` מבטיח אי-קריסה ב-node.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck && pnpm typecheck && pnpm test
```

---

### Commit 1 — `listAgents()` adapter + `#findReusableAgent` (approach: tdd)

**מטרה**: היכולת לשאול את ה-BE מי חי ולמצוא agent מתאים לשחזור.

**קבצים שמשתנים**:
- `packages/frontend/src/lib/adapters/agents-api.ts` — מוסיף `listAgents`.
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — מוסיף `#findReusableAgent`.

**API skeleton** — `agents-api.ts` (ADDITIVE, ליד `getAgent`):

```ts
import type { AgentPublic } from "@drive-coding/core"   // ודא ש-AgentPublic מיוצא מ-core root

/** מושך את רשימת הסוכנים הפעילים מה-BE (GET /api/agents). */
export async function listAgents(signal?: AbortSignal): Promise<AgentPublic[]> {
  const res = await withTimeout(
    (s) => fetch(beUrl("/api/agents"), { signal: s }),
    AGENTS_API_TIMEOUT_MS,
    { signal, label: "listAgents" },
  )
  if (!res.ok) throw new Error(`listAgents failed: ${res.status}`)
  const body = (await res.json()) as { agents: AgentPublic[] }
  return body.agents
}
```

> ⚠️ ודא ש-`AgentPublic` מיוצא מ-`@drive-coding/core` (ה-root). בדוק `packages/core/src/index.ts`. אם מיוצא רק מ-`@drive-coding/core/schemas/agent` — ייבא משם. אל תשבור verbatimModuleSyntax (`import type`).

**`#findReusableAgent`** — `agent-session.svelte.ts` (private, בבלוק "פרטי"):

```ts
/**
 * מחפש agent חי בצד השרת שאפשר להתחבר אליו מחדש (warm) במקום spawn.
 * תנאי: אותו acpSessionId (=#sessionId הנוכחי), אותו cwd, ו-status חי.
 * מחזיר agentId או null. שגיאת רשת → null (נופלים ל-cold).
 */
#findReusableAgent = async (): Promise<string | null> => {
  if (this.#sessionId === null || this.cwd === null) return null
  try {
    const agents = await listAgents()
    const match = agents.find(
      (a) =>
        a.acpSessionId === this.#sessionId &&
        a.cwd === this.cwd &&
        a.status !== "crashed" &&
        a.status !== "closed",
    )
    return match?.id ?? null
  } catch {
    return null   // שגיאת רשת — cold יטפל
  }
}
```

**import** ב-`agent-session.svelte.ts` (שורה 23 קיימת):
```ts
// before: import { createAgent, deleteAgent, notifySessionAttached } from "$lib/adapters/agents-api"
// after:  import { createAgent, deleteAgent, listAgents, notifySessionAttached } from "$lib/adapters/agents-api"
```

**approach: tdd** — טסט ל-`listAgents` (mock fetch, כמו `agents-api.test.ts`). `#findReusableAgent` נבדק integration ב-DoD (private, קשה ליחידה).

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck && pnpm test
# manual: fetch('/api/agents').then(r=>r.json()).then(console.log) — ודא acpSessionId מאוכלס אחרי connect+prompt
```

---

### Commit 2 — `reconnect()` + warm/cold paths (approach: manual)

**מטרה**: הלב — `reconnect()` שבוחר warm-first עם cold fallback.

**קבצים שמשתנים**:
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts`

**API skeleton — מתודה ציבורית** (ADDITIVE, בבלוק "מחזור חיי חיבור"):

```ts
/**
 * משחזר את החיבור לסשן הנוכחי. warm-first: אם הסוכן עוד חי בצד השרת —
 * מתחבר אליו בלי spawn; אחרת יוצר חדש (cold). מאפס reconnectAttempt
 * ועוצר לולאת backoff פעילה (קריאה ידנית גוברת).
 */
reconnect = async (): Promise<void> => {
  if (this.#sessionId === null || this.cwd === null || this.#cliKind === null) return
  this.#clearReconnectTimer()
  this.#reconnecting = false
  this.reconnectAttempt = 0
  await this.#doReconnect()
}
```

**עזרי private** (בבלוק "פרטי"):

> **⚠️ תיקון אביגיל #2**: `#handleUnexpectedClose` (שנקרא ב-onClose של warm כאן) מוגדר במקור ב-Commit 3 → typecheck נשבר ב-Commit 2. **הגדר את `#handleUnexpectedClose` כבר כאן ב-Commit 2** (הגוף המלא ב-Commit 3 — או הגדר אותו מלא כאן ו-Commit 3 רק מחבר אותו ל-onClose של attach/loadSession). הפתרון הנקי: **העבר את כל הבלוק של `#handleUnexpectedClose` + `#scheduleReconnect` + `#runReconnectLoop` + ה-statics ל-Commit 2**, ו-Commit 3 רק משנה את שני ה-onClose של attach/loadSession לקרוא לו. כך אין forward-reference.

```ts
static readonly #MED8_RETRY_MS = 250
static readonly #MED8_MAX_RETRIES = 3

/**
 * ניסיון reconnect יחיד: warm-first, נופל ל-cold בכל כשל.
 */
#doReconnect = async (): Promise<void> => {
  const reuseId = await this.#findReusableAgent()
  if (reuseId !== null) {
    const ok = await this.#warmReconnect(reuseId)
    if (ok) {
      if (this.status === "connected") this.reconnectAttempt = 0
      return
    }
    // warm נכשל (1008 אחרי retries / שגיאת WS/handshake) → נפילה ל-cold
  }
  await this.#coldReconnect()
  if (this.status === "connected") this.reconnectAttempt = 0
}

/**
 * cold: יוצר agent חדש דרך loadSession מאפס.
 * ⚠️ תיקון אביגיל #1 (סבב 2): guard 217 זורק אם status==="connecting"||"connected".
 * אם הגענו לכאן מ-fallback של warm (שקבע "connecting" ולא איפס) — חייבים לאפס
 * ל-status שעובר את ה-guard. "disconnected" עובר (ה-guard בודק רק connecting/connected),
 * ועקבי לוגית (אנחנו בתהליך reconnect). אסור #setStatus("connecting") לפני loadSession.
 */
#coldReconnect = async (): Promise<void> => {
  this.#client = null   // נקה client מת
  if (this.status === "connecting" || this.status === "connected") {
    this.#setStatus("disconnected")   // מאפס מצב שהשאיר warm-fail; עובר את guard 217
  }
  await this.loadSession({
    sessionId: this.#sessionId!,
    cwd: this.cwd!,
    cliKind: this.#cliKind!,
  })
}

/**
 * warm: מתחבר ל-agent קיים (אותו agentId) דרך WS חדש, בלי createAgent.
 * מחקה את הדגם של switchSession (288-336) — #client.loadSession + #captureSessionConfig +
 * notifySessionAttached(replace:true) — אבל פותח WS חדש קודם (switchSession משתמש ב-WS חי).
 * מטפל ב-MED-8 (1008) עם retry. מחזיר true בהצלחה, false → fallback ל-cold.
 */
#warmReconnect = async (agentId: string): Promise<boolean> => {
  this.#detached = false
  this.#setStatus("connecting")   // ל-warm מותר — הוא לא עובר דרך loadSession של ה-VM (אין guard)

  for (let attempt = 0; attempt <= AgentSession.#MED8_MAX_RETRIES; attempt++) {
    this.#client = null
    const proto = location.protocol === "https:" ? "wss:" : "ws:"
    const transport = new WsAcpTransport(`${proto}//${location.host}/ws/agent/${agentId}`)

    // ⚠️ תיקון אביגיל #1 — DEADLOCK: waitForOpen (ws-transport.ts:70-78) מאזין רק
    // open+error, לא close. סגירת 1008 היא close event → waitForOpen נתקע לנצח.
    // לכן race בין waitForOpen ל-Promise שנפתר ב-onClose. ה-onClose הזה זמני —
    // משמש רק לזיהוי כשל בזמן הפתיחה; אחרי open מצליח נרשם onClose "אמיתי".
    const closeOutcome = new Promise<{ closed: true; code: number; reason: string }>((resolve) => {
      transport.onClose((code, reason) => resolve({ closed: true, code, reason }))
    })
    let opened = false
    // הערה (אביגיל #2): אם close זוכה ב-race, ה-Promise של waitForOpen נשאר pending
    // ברקע לנצח (waitForOpen לא מאזין ל-close). benign — ה-.catch תופס reject עתידי,
    // וה-transport נאסף ב-GC. אין דליפת state.
    const closeResult = await Promise.race([
      transport.waitForOpen().then(() => { opened = true; return null }).catch(() => null),
      closeOutcome,
    ])

    if (!opened) {
      // ה-WS נסגר/נכשל לפני open. 1008 = MED-8 (retry); אחר = כשל warm → cold.
      transport.close()
      const code = closeResult && "closed" in closeResult ? closeResult.code : 0
      if (code === 1008 && attempt < AgentSession.#MED8_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, AgentSession.#MED8_RETRY_MS))
        continue   // MED-8 — נסה שוב
      }
      return false   // לא-1008, או מיצינו retries → cold
    }

    // ה-WS פתוח. רשום onClose "אמיתי" לנפילות עתידיות (כמו attach/loadSession).
    transport.onClose((code, reason) => {
      if (this.#detached) return
      if (code !== 1000 && code !== 1001) this.#handleUnexpectedClose(code, reason)
    })

    try {
      this.agentId = agentId
      this.#client = await createAcpClient(transport, this.#onSessionUpdate)
      this.bubbles = []
      this.isLoadingHistory = true
      try {
        const loadResult = await this.#client.loadSession({ sessionId: this.#sessionId!, cwd: this.cwd! })
        this.#captureSessionConfig(loadResult)
      } finally {
        this.isLoadingHistory = false
      }
      // replace:true — אותו דגם כמו switchSession:327 (fix-409 מוזג ב-8f59ec3)
      await notifySessionAttached(agentId, this.#sessionId!, { replace: true }).catch(() => {})
      this.#setStatus("connected")
      return true
    } catch {
      // שגיאת handshake/loadSession — נקה ונפול ל-cold
      this.#client = null
      transport.close()
      return false
    }
  }
  return false
}

#clearReconnectTimer(): void {
  if (this.#reconnectTimer !== undefined) {
    clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = undefined
  }
}
```

> ⚠️ **`notifySessionAttached` עם `{ replace: true }`** — אומת ב-`agents-api.ts:61-77` (חתימה `(agentId, sessionId, opts?: {replace?})`, fix-409 מוזג ב-`8f59ec3`). זהה לדגם `switchSession:327`. ה-`replace:true` עוקף את guard MED-9 (http-agents.ts:118) — נחוץ כי ה-agent הקיים כבר מחזיק את אותו acpSessionId (ה-guard לא חוסם ממילא כש-acpSessionId זהה, אבל replace:true עקבי ובטוח).

> ⚠️ **שני onClose על אותו transport**: ה-warm רושם onClose זמני (race) לפני open, ואז onClose "אמיתי" אחרי open. **שניהם נשארים רשומים** (`#closeListeners` הוא מערך, ws-transport.ts:89-91 push). ה-זמני יקרא resolve על Promise שכבר נפתר (no-op בטוח). ה-אמיתי יטפל בנפילה עתידית. זה תקין — ודא שאין double-handling של נפילה אמיתית (ה-זמני רק עושה resolve, לא משנה state).

> ⚠️ **קריטי — `#coldReconnect` לא קורא `#setStatus("connecting")`** לפני `loadSession` (guard 217 יזרוק). `#warmReconnect` **כן** קורא `connecting` — מותר, כי הוא קורא `#client.loadSession` הגולמי (אין לו guard), לא את `loadSession` של ה-VM.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck
# manual warm: connect+prompt → DevTools offline+online (WS נופל, child חי) →
#   window.__session.reconnect() → ודא בלוג BE אין createAgent חדש, agentId זהה, שיחה חוזרת
# manual cold: pkill -f opencode → window.__session.reconnect() →
#   ודא createAgent חדש בלוג, agentId חדש, שיחה חוזרת
```

> 🔬 **calev phase-check אחרי Commit זה** (הלב — warm/cold/MED-8). ראה §8.

---

### Commit 3 — חיבור attach/loadSession ל-auto-reconnect (approach: manual)

**מטרה**: כשה-WS נופל בלי detach בנתיב הרגיל (attach/loadSession) — בפוקוס: backoff; ברקע: disconnected.

> **⚠️ תיקון אביגיל #2**: הבלוק `#handleUnexpectedClose` + `#scheduleReconnect` + `#runReconnectLoop` + ה-statics (`#MAX_RECONNECT_ATTEMPTS`, `#BACKOFF_MS`) **כבר הוגדר ב-Commit 2** (כי `#warmReconnect` קורא ל-`#handleUnexpectedClose` ב-onClose האמיתי). אם לא הגדרת אותו ב-Commit 2 — typecheck של Commit 2 נשבר. **Commit 3 רק (א) מחבר את שני ה-onClose של attach/loadSession לקרוא ל-`#handleUnexpectedClose`, ו-(ב) מעדכן את `detach`.** אם כבר הגדרת את הבלוק ב-Commit 2, דלג על הגדרתו כאן.

**קבצים שמשתנים**:
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts`

**שינוי ה-`onClose` ב-attach + loadSession** — **שני** מופעים זהים (125-134, 242-248). שניהם:

```ts
// Before (שני המקומות):
transport.onClose((code, reason) => {
  if (this.#detached) return
  if (code !== 1000 && code !== 1001) {
    this.error = `WS closed (${code}): ${reason || "no reason"}`
    this.#setStatus("error")
  }
})

// After (שני המקומות — זהה):
transport.onClose((code, reason) => {
  if (this.#detached) return
  if (code !== 1000 && code !== 1001) {
    this.#handleUnexpectedClose(code, reason)
  }
})
```

> 💡 אם תרצה — חלץ ל-`#attachCloseHandler(transport)` למניעת כפילות. **רק אם** לא משנה התנהגות. בספק → השאר. תעד בסטיות. (שים לב: ה-onClose ב-`#warmReconnect` שונה — אל תאחד איתו.)

**עזרי private**:

```ts
static readonly #MAX_RECONNECT_ATTEMPTS = 5
/** backoff (ms) לפי ניסיון. סך ~31s << חלון reaper (5 דק'). */
static readonly #BACKOFF_MS = [1000, 2000, 4000, 8000, 16000]

#handleUnexpectedClose(code: number, reason: string): void {
  this.error = `WS closed (${code}): ${reason || "no reason"}`
  if (this.#pageHidden) {
    this.#setStatus("disconnected")   // רקע — לא אוטו
    return
  }
  this.#scheduleReconnect()           // פוקוס — backoff
}

#scheduleReconnect(): void {
  if (this.#reconnecting) return
  this.#reconnecting = true
  this.reconnectAttempt = 0
  this.#setStatus("disconnected")
  void this.#runReconnectLoop()
}

async #runReconnectLoop(): Promise<void> {
  while (this.reconnectAttempt < AgentSession.#MAX_RECONNECT_ATTEMPTS) {
    const attempt = this.reconnectAttempt           // 0-indexed לתוך BACKOFF_MS
    const delay = AgentSession.#BACKOFF_MS[attempt] ?? 16000
    this.reconnectAttempt = attempt + 1             // 1-indexed לחיווי
    await new Promise<void>((resolve) => {
      this.#reconnectTimer = setTimeout(resolve, delay)
    })
    // ⚠️ הערה (אביגיל #3 מסבב קודם): אם detach קרא clearTimeout כאן, ה-Promise
    // לא resolve וה-await תקוע → ה-bail מתחת לא נגיש. לא מזיק (#detached/#reconnecting
    // כבר עצרו המשך). אם מפריע — resolve() ב-#clearReconnectTimer לפני clearTimeout.
    if (this.#detached) { this.#reconnecting = false; return }
    try {
      await this.#doReconnect()
    } catch {
      // warm/cold כבר תפסו; נמשיך
    }
    if (this.status === "connected") {
      this.#reconnecting = false
      this.reconnectAttempt = 0
      return
    }
  }
  this.#reconnecting = false
  this.#setStatus("disconnected")   // מיצינו — ממתין ל-reconnect ידני
}
```

> ⚠️ **עדכן `detach()`** (158) — בטל לולאה לפני cleanup:
```ts
detach = (): void => {
  this.#detached = true
  this.#clearReconnectTimer()
  this.#reconnecting = false
  this.reconnectAttempt = 0
  this.#cleanup()
  this.#setStatus("idle")
  this.error = null
  this.bubbles = []
  this.sessions = []
  this.#sessionsLoaded = false
  this.sessionsError = null
}
```

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck
# manual (console):
# 1. connect+prompt+תשובה
# 2. offline+online (פוקוס) → status disconnected→connecting→connected, warm (אין spawn), reconnectAttempt חוזר 0
# 3. pkill (פוקוס) → cold אוטו (spawn חדש), שיחה חוזרת
# 4. pkill + מיד tab אחר → status נשאר disconnected, אין createAgent. חזור → reconnect() ידני
# 5. detach() באמצע backoff → לולאה נעצרת
```

---

### Commit 4 — Docs + סטטוס (approach: manual)

**קבצים**:
- `docs/walkthrough.md` — רשומת ביצוע.
- `docs/plans/slice-ws-reconnect-infra.md` — סטטוס + סטיות.
- `packages/frontend/docs/slices.md` — רישום (וציון UI = slice עוקב).
- `docs/future-features.md` — תיעוד "buffer/historyBuffer לשחזור updates תוך-כדי-נתק" כ-future (§9 Q3).

```bash
pnpm typecheck && pnpm lint:i18n && pnpm test
pnpm --filter @drive-coding/frontend build
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | Typecheck ירוק | `pnpm typecheck` |
| 2 | Frontend typecheck | `pnpm --filter @drive-coding/frontend typecheck` |
| 3 | Build ירוק | `pnpm --filter @drive-coding/frontend build` |
| 4 | אין עברית קשיחה | `pnpm lint:i18n` (אפס מחרוזות UI; הערות עברית מותרות) |
| 5 | Tests ירוקים | `pnpm test` (כולל `listAgents` test + state) |
| 6 | `reconnect()` ידני | connect+prompt → `window.__session.reconnect()` → שיחה חוזרת מלאה |
| 7 | **WARM** | connect+prompt → offline+online (child חי) → אוטו: **אין** createAgent בלוג BE, **אותו** agentId, שיחה חוזרת |
| 8 | **COLD** | `pkill -f opencode` (פוקוס) → אוטו: createAgent **חדש** בלוג, **agentId חדש**, שיחה חוזרת |
| 9 | **warm→cold fallback + אין deadlock** | פתח שני טאבים לאותו agent (טאב 2 → 1008 MED-8) → ודא retry ואז cold, **ולא תקיעה** (deadlock אביגיל #1). לכל הפחות: cold עובד כש-`#findReusableAgent` מחזיר null |
| 10 | **לא-אוטומטי ברקע** | `pkill` + מיד tab אחר → `status` נשאר `disconnected`, **אין** createAgent בלוג |
| 11 | **backoff מדורג** | הפל WS + השאר BE מת → `reconnectAttempt` 1→5 בהשהיות גדלות, אחרי 5 → `disconnected` יציב |
| 12 | **cold אחרי reaper** | `BRIDGE_IDLE_TIMEOUT_MS=8000` → הפל WS + המתן reaper → `reconnect()` → agent **חדש** + שיחה חוזרת |
| 13 | **disconnect לא מפעיל reconnect** | `window.__session.detach()` → status=idle, **אין** ניסיון reconnect |
| 14 | **detach mid-backoff** | הפל WS (פוקוס) → בזמן backoff `detach()` → לולאה נעצרת (אין createAgent אחרי) |
| 15 | Regression: שיחה רגילה | connect→prompt→תשובה→detach — כרגיל |
| 16 | Regression: switchSession + אין דליפת agents | החלף סשן → עובד; אחרי כמה reconnects → `/api/agents` לא צובר מתים |
| 17 | **אפס שינוי UI** | `git diff --stat` — רק `agent-session.svelte.ts` + `agents-api.ts` + טסט + docs. אין components/routes/i18n |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| **MED-8 DEADLOCK** (warm): `waitForOpen` לא מאזין ל-close → 1008 לפני open תוקע אותו לנצח | ws-transport.ts:70-78 (אביגיל #1) | `#warmReconnect` עושה `Promise.race([waitForOpen, closeOutcome])` — ה-close זוכה במרוץ → לא deadlock. 1008 → retry ×3 → fallback ל-cold. **קריטי — אל תסתמך על try/catch סביב waitForOpen לבדו.** |
| **MED-8 race** (warm): WS חדש לפני שה-BE עיבד `close` → 1008 | ws-agent.ts:69 | retry 250ms ×3 → fallback ל-cold (agentId חדש, אין MED-8). מתועד #4+#6. |
| **warm מצא agent אבל הוא בעצם מת/תקוע** | race בין list ל-WS | אם ה-WS/handshake נכשל → `#warmReconnect` מחזיר false → cold. cold תמיד עובד. |
| **`#findReusableAgent` מחזיר agent של סשן אחר** | סינון לקוי | סינון משולש: `acpSessionId===#sessionId` **וגם** `cwd===this.cwd` **וגם** status חי. acpSessionId ייחודי לסשן. |
| **"WS closed (1005)" ghost** אחרי detach | decisions §716-748 | `#detached` guard קיים+נשמר. `detach` מבטל לולאה (Commit 3). ה-onClose ב-warm גם בודק `#detached`. |
| **לולאת reconnect כפולה** | שני onClose + warm onClose | `#reconnecting` guard. `#clearReconnectTimer` ב-detach/reconnect. |
| **`loadSession` guard זורק** ב-cold | agent-session:217 | `#coldReconnect` **לא** קורא `#setStatus("connecting")` לפני loadSession. warm קורא `#client.loadSession` הגולמי (אין guard). מתועד #2. |
| **`notifySessionAttached` 409** ב-warm | MED-9 | משתמשים ב-`{replace:true}` (אומת ב-agents-api.ts:64, fix-409 מוזג ב-8f59ec3) — עוקף MED-9. זהה ל-switchSession:327. |
| **forward-reference** (`#handleUnexpectedClose` נקרא ב-Commit 2, מוגדר ב-Commit 3) | אביגיל #2 | הגדר את הבלוק כבר ב-Commit 2; Commit 3 רק מחבר את attach/loadSession. typecheck של Commit 2 חייב לעבור. |
| **reaper הורג bridge באמצע backoff** | reaper 5 דק' | backoff ~31s << 5 דק'. וגם אם נהרג → cold יוצר חדש. |
| **AgentPublic לא מיוצא מ-core root** | import | בדוק `packages/core/src/index.ts`; ייבא מהמקום הנכון. `import type` (verbatimModuleSyntax). |
| **updates בזמן הנתק עצמו** | אין buffer BE (slice 9) | `loadSession`/warm-load מושכים הכל מהסוכן. updates *בדיוק* בחלון הנתק עלולים לחסר — known limitation, future buffer (§9 Q3). |
| **חזרה לפוקוס לא מטריגרת** (Q1=לא) | בחירת UX | listener מעדכן `#pageHidden` בלבד. הפעלה = שורה אחת. מתועד §9 Q1. |
| Svelte 5 reactivity | `reconnectAttempt`/`status` | $state רגיל. |
| `visibilitychange`/SSR | document undefined | guard `typeof document !== "undefined"`. SPA. |
| scope creep ל-UI | — | DoD #17 — `git diff --stat` חייב רק VM+adapter+test+docs |

> 3 שתמיד נשכחים: (1) i18n — **לא רלוונטי** (אפס UI). (2) reactivity ✅. (3) OneCLI placeholder — לא רלוונטי.

---

## §7 — Escalation triggers

> אם X — עצור ושאל את מרדכי:

- ה-warm-path נכשל **תמיד** ב-1008 גם אחרי retries+fallback, ו-cold לא עוזר — דווח (אולי MED-8 צריך תיקון BE, מחוץ ל-scope).
- אתה רוצה לשנות `ws-agent.ts` / MED-8 / reaper / להוסיף historyBuffer ב-BE — **עצור** (out of scope; buffer = future slice נפרד).
- אתה רוצה לגעת ב-component/route/i18n — **עצור** (slice עוקב `ws-reconnect-ui`, DoD #17).
- ה-guard של `loadSession` (217) זורק ב-cold למרות שלא קראת `#setStatus("connecting")` — דווח.
- `notifySessionAttached` מחזיר 409 ב-warm למרות אותו acpSessionId — דווח (הבנת MED-9 שגויה).
- `AgentPublic` לא נמצא לייבוא משום מקום ב-core — דווח.
- אין תשתית טסטים ל-VM — עבור ל-manual ב-Commit 0/1, **אל תמציא**.
- אתה צריך `destroy()` ל-AgentSession — **עצור** (singleton).
- שינוי signature של `loadSession`/`attach`/`detach` — **עצור** (invasive).

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------:|
| Streaming/real-time (WS lifecycle ×2 paths) | +2 |
| State machine / async coordination (backoff, visibility, warm/cold, MED-8 retry) | +2 |
| Protocol contract (warm = loadSession ידני בלי createAgent) | +1 |
| Refactor (onClose ×2, detach, status union) | +1 |
| Cross-layer (VM + adapter + core type) | +1 |
| Regression surface (כל ה-connection lifecycle) | +1 |
| State model change (union + 2 $state) — INVASIVE | +1 |
| TDD חלקי (Commit 0/1) | -1 |

**Score**: 8/10

**Tier**: `calev-heavy` (Opus). הסיכון בעיקר **inference**: warm/cold branching, MED-8 retry loop, edge-cases (detach/פוקוס/WS-נופל-שוב באמצע reconnect), races, ו-regression על כל ה-lifecycle. ה-warm-path מוסיף נתיב WS שני שמחקה את `loadSession` — צריך אימות קפדני שלא נשבר משהו.

**Verifier-phase**: `calev` (mode: phase, Sonnet) אחרי **Commit 2** (warm/cold/MED-8 — הלב). בודק את שני הנתיבים + ה-fallback לפני שמוסיפים את ה-backoff מעליהם.

---

## §9 — שאלות פתוחות

| # | שאלה | החלטה | חוסם? |
|---|------|------|------|
| 1 | חזרה-לפוקוס → reconnect אוטומטי? | **לא** (אושר ע"י המשתמשת). רק `reconnect()` יזום. שינוי עתידי = שורה אחת | ❌ |
| 2 | מספר ניסיונות backoff | **5** (אושר ע"י המשתמשת) | ❌ |
| 3 | updates בזמן הנתק עצמו — buffer? | **לא עכשיו** (אושר). אין buffer ב-BE (הוסר slice 9, BE=pipe). `loadSession` מכסה את הרוב. **buffer אמיתי = future slice נפרד מתועד** ב-`docs/future-features.md` | ❌ |
| 4 | `cliKind` כשדה $state חדש — INVASIVE | **כן** (אושר ע"י מרדכי) | ❌ |
| 5 | warm גם קורא loadSession? | **כן** (אושר) — bubbles אבדו; חוסך רק spawn | ❌ |
| 6 | MED-8: retry או תיקון BE? | **retry ב-FE + fallback ל-cold** (אושר). לא נוגעים ב-BE | ❌ |

> כל ההחלטות **נסגרו עם המשתמשת**. ה-slice העוקב (`ws-reconnect-ui`) ייכתב JIT אחרי אימות התשתית.

---

## סטיות מהתכנון (מתעדכן ע"י executor תוך כדי)

> ה-executor מתעד פה כל סטייה מה-brief ולמה.

- **הגדרת `#handleUnexpectedClose`+`#scheduleReconnect`+`#runReconnectLoop` ב-Commit 2 (לא 3)**: לפי תיקון אביגיל #2 — `#warmReconnect` קורא ל-`#handleUnexpectedClose` → forward-reference אם מוגדר ב-Commit 3. הועבר ל-Commit 2 כנדרש. Commit 3 רק חיבר את attach/loadSession.
- **test helpers `_setStatusForTest`/`_setReconnectAttemptForTest`**: הוספו כ-workaround לבדיקת private fields ב-Vitest (node env). tree-shaken מ-prod build.
- **ייבוא `listAgents` נדחה ל-Commit 1** (לא ב-Commit 0): הייבוא בוצע ב-Commit 1 יחד עם המימוש כדי שTypecheck של Commit 0 יעבור נקי.
- **לא נדרש `attachCloseHandler` refactor**: שני ה-onClose זהים ופשוטים — לא חולצו (כמו שה-brief הציע "רק אם לא משנה התנהגות"). תועד בcommit message.
