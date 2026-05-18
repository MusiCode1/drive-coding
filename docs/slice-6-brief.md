# Slice 6 — Implementation Brief

> **מטרה:** עמידות. שלוש יכולות שמסירות את ה-MVP מ-"רץ פעם אחת בdemo" ל-"שורד שימוש יומיומי":
> 1. **Multi-session** — agent יכול להחזיק כמה ACP sessions במקביל (resume + fork)
> 2. **TTS disk cache eviction** — מניעת מילוי דיסק
> 3. **WS reconnect** — frontend מתאושש מ-network blip / tunnel restart / backend redeploy בלי לאבד session

> **תלות:** Slice 5.5 (commit `a5f1e41`+ frontend tests sub-agent)
> **מבצע:** Yolo executor (Sonnet 4-6)

---

## 1. החלטות שננעלו ל-Slice 6

| נושא | בחירה | מקור |
|------|--------|------|
| **Session model** | per-agent יכול להחזיק רשימת `ses_*` IDs. כל אחד עם chat נפרד. UI ברירת מחדל = הסשן האחרון | חדש |
| **Resume mechanism** | ACP `session/load` (capability `loadSession: true` הוכרז ע"י opencode acp) | spec |
| **Storage of sessions** | in-memory `Map<agentId, SessionId[]>` (ה-ACP agent מחזיק את ה-state האמיתי) | D8 |
| **Cache eviction** | LRU + max-size (MB). default 500MB. eviction בכל `set()` אם מעל | D8 |
| **Cache metadata** | JSON file `data/cache/tts/_index.json` עם entries `{key, size, mtime, hits}` | D8 |
| **Reconnect strategy** | exponential backoff: 1s, 2s, 4s, 8s, max 30s. infinite retries (drive scenario — אבי במכונית, רשת חוזרת) | D35 |
| **Reconnect identity** | frontend שומר `sessionId` ב-`sessionStorage`. בreconnect שולח `{ type: "resume", sessionId }` ל-WS | חדש |
| **Backend reconnect** | WS handler עם `resume` action: בודק שה-ACP session עוד חי, אם כן — re-attach. אם לא — מחזיר `{ type: "session_lost" }` | חדש |
| **Bridge identity** | משתמשים ב-`--client-id` של stdio-to-ws עם UUID של ה-agent. backend restart יכול להתחבר מחדש ל-bridge הקיים בלי spawn מחדש | D33 |

**במפורש לא כלול:**
- Session export/import (Slice 8+)
- Cross-device session sharing (לעולם — D11)
- Cache compression (קבצי mp3 כבר דחוסים)
- Reconnect של voice mid-prompt (drop ושלח מחדש)
- Auth flow (Slice 8 conformance #4)

---

## 2. מה נוסף

### 2.1 Core — Session schema + Cache

**עדכון** `packages/core/src/schemas/agent.ts`:
- הוסף `AgentSession` schema:
  ```ts
  type AgentSession = {
    sessionId: string  // ACP ses_*
    createdAt: Date
    title?: string     // generated from first prompt (Slice 8)
    lastActiveAt: Date
  }
  ```
- הוסף ל-`AgentPublic`:
  ```ts
  sessions: AgentSession[]
  currentSessionId: string | null
  ```

**חדש** `packages/core/src/cache/lru.ts`:
- pure function `evictLru(entries, maxBytes): { keep, evict }` (TDD).
- `CacheEntry = { key, size, mtime, hits }`.

**עדכון** `packages/core/src/ports.ts`:
- `CacheStore` הרחבה: `delete(key)`, `stats()` → `{ totalBytes, entryCount }`.

**Tests חדשים** (TDD):
- `lru.test.ts` — מינימום 8 cases: empty, under limit, exactly limit, way over, by mtime, by hits weight, single huge entry, deterministic order.

### 2.2 Backend — Bridge persistence + LRU disk cache

**עדכון** `packages/backend/src/voice/cache-disk.ts`:
- טעינת `_index.json` ב-`init()`. בלי קובץ — סריקת fs (זמן אתחול).
- `set()` קורא ל-`maybeEvict()` אחרי כתיבה. evictLru + מחיקת קבצים פיזיים.
- `_index.json` נכתב debounced (כל 5s או 10 entries — מה שמגיע קודם).

**עדכון** `packages/backend/src/acp/bridge-manager.ts`:
- הוסף param `clientId` ל-spawn. אם קיים — `npx ... --client-id <uuid>`. אם לא — generate חדש.
- שמור `clientId` ב-`BridgeHandle`.
- בbackend startup: לקרוא `data/bridges.json` (אם קיים) ולנסות re-attach לכל bridge ידוע (ping WS, אם חי — שמור ב-Map; אם לא — מחק).

**חדש** `packages/backend/src/app/session-manager.ts`:
- `createSession(agentId)` → קורא `acp-transport.newSession()` חדש, שומר ב-Map.
- `loadSession(agentId, sessionId)` → קורא `acp-transport.loadSession()`.
- `listSessions(agentId)` → מ-Map.
- `closeSession(agentId, sessionId)` → ACP `session/close` (stabilized) + remove.

**עדכון** `packages/backend/src/acp/acp-transport.ts`:
- הוסף method `loadSession({ sessionId, cwd })`.
- הוסף method `closeSession(sessionId)`.
- ה-`AcpTransport` כעת תומך multi-session, לא רק את ה-default.

### 2.3 Backend — HTTP API

**עדכון** `packages/backend/src/delivery/http-agents.ts`:
- `POST /api/agents/:id/sessions` — צור session חדש. body: `{}`. response: `{ sessionId }`.
- `GET /api/agents/:id/sessions` — רשימה.
- `DELETE /api/agents/:id/sessions/:sid` — סגירת session.

### 2.4 Backend — WS reconnect

**עדכון** `packages/backend/src/delivery/ws-agent.ts`:
- בopen handler: לבדוק query param `?sessionId=ses_xxx`. אם קיים — לקשור את ה-WS לאותה session ולא ל-current.
- הוסף message type `resume`: `{ type: "resume", sessionId }`. backend בודק שהsession חי, אם כן — שולח `{ type: "resumed" }`. אם לא — `{ type: "session_lost" }` ו-disconnects.

### 2.5 Frontend — Multi-session UI + reconnect

**עדכון** `packages/frontend/src/lib/stores/agent-session.svelte.ts`:
- `currentSessionId: string` state ב-store, נשמר ב-`sessionStorage` עם key `acp-session-${agentId}`.
- בconnect, שולח `?sessionId=` בURL.
- בonerror/onclose — auto-reconnect עם exponential backoff. דאג שלא להציף.
- חדש: `reconnectStatus: "idle" | "retrying" | "given_up"`.
- חדש: `createSession()` ו-`switchSession(id)`.

**עדכון** `packages/frontend/src/routes/agent/[id]/+page.svelte`:
- כפתור "+" ליצירת session חדש (כותרת חלון).
- dropdown של sessions זמינים (date + first words).
- אינדיקטור reconnect ב-header.

**Frontend tests** (אחרי Slice 5.5 sub-agent):
- `agent-session.test.ts` הוספה: reconnect logic, sessionStorage persistence.

### 2.6 docs

- עדכן `vnext-spec.md §8.5` עם status ✅ ל-Slice 6.
- `docs/walkthrough.md` entry חדש.

---

## 3. תבניות קוד מדויקות

### 3.1 `packages/core/src/cache/lru.ts`

```ts
export type CacheEntry = {
  readonly key: string
  readonly size: number       // bytes
  readonly mtime: number      // unix ms
  readonly hits: number       // access count
}

/**
 * Decide which entries to evict to bring total size <= maxBytes.
 * Score = hits / (age_in_hours + 1) — favours hot recent items.
 * Returns {keep, evict} — caller deletes the evict files.
 */
export function evictLru(
  entries: ReadonlyArray<CacheEntry>,
  maxBytes: number,
  now: number = Date.now(),
): { keep: CacheEntry[]; evict: CacheEntry[] } {
  const totalSize = entries.reduce((s, e) => s + e.size, 0)
  if (totalSize <= maxBytes) return { keep: [...entries], evict: [] }

  const scored = entries.map((e) => ({
    entry: e,
    score: e.hits / ((now - e.mtime) / 3_600_000 + 1),
  }))
  // sort descending by score — keep the best
  scored.sort((a, b) => b.score - a.score)

  const keep: CacheEntry[] = []
  const evict: CacheEntry[] = []
  let acc = 0
  for (const { entry } of scored) {
    if (acc + entry.size <= maxBytes) {
      keep.push(entry)
      acc += entry.size
    } else {
      evict.push(entry)
    }
  }
  return { keep, evict }
}
```

### 3.2 `packages/backend/src/app/session-manager.ts` (skeleton)

```ts
import type { AcpTransport, AgentSession } from "@drive-coding/core"

export type SessionManager = {
  list(agentId: string): AgentSession[]
  current(agentId: string): AgentSession | null
  create(agentId: string, transport: AcpTransport, cwd: string): Promise<AgentSession>
  load(agentId: string, sessionId: string, transport: AcpTransport, cwd: string): Promise<AgentSession>
  close(agentId: string, sessionId: string, transport: AcpTransport): Promise<void>
  switchTo(agentId: string, sessionId: string): void
}

export function createSessionManager(): SessionManager {
  const byAgent = new Map<string, AgentSession[]>()
  const currentByAgent = new Map<string, string>()
  // ... impl
}
```

### 3.3 Frontend reconnect logic

```ts
let retryCount = $state(0)
let retryTimer: ReturnType<typeof setTimeout> | null = null

function scheduleReconnect() {
  if (retryTimer) return
  const delay = Math.min(1000 * Math.pow(2, retryCount), 30_000)
  reconnectStatus = "retrying"
  retryTimer = setTimeout(() => {
    retryTimer = null
    retryCount++
    connect()
  }, delay)
}

ws.onclose = () => {
  ws = null
  status = "disconnected"
  if (intentionallyClosed) return
  scheduleReconnect()
}

ws.onopen = () => {
  retryCount = 0
  reconnectStatus = "idle"
  // ... rest
}
```

---

## 4. Step-by-step

1. **Core LRU (TDD)** — `lru.test.ts` ראשון (8+ cases red), ואז `lru.ts` (green).
2. **Core schemas** — `AgentSession` ב-`agent.ts`, `CacheStore` הרחבה ב-`ports.ts`.
3. **Backend cache eviction** — `cache-disk.ts` עם `_index.json` + LRU integration.
4. **Backend session manager** — `session-manager.ts` חדש + integration ב-`agent-orchestrator.ts`.
5. **Backend transport** — `loadSession` + `closeSession` ב-`acp-transport.ts`.
6. **Backend HTTP API** — 3 routes חדשות ב-`http-agents.ts`.
7. **Backend WS reconnect** — `resume` action ב-`ws-agent.ts`.
8. **Backend bridge persistence** — `data/bridges.json` + re-attach.
9. **Frontend store reconnect** — exponential backoff, sessionStorage.
10. **Frontend multi-session UI** — dropdown, "+", reconnect indicator.
11. **typecheck + lint + tests** — חייב לעבור (יעד: 170+ tests, היה 140).
12. **Smoke E2E ידני** —
    - יצור 2 sessions באותו agent, החלפה ביניהם, שתי שיחות נפרדות.
    - kill backend tmux session → frontend מציג "retrying" → restart backend → frontend מתחבר ושומר על sessionId, ממשיך שיחה.
    - מילוי cache מעבר ל-MAX_CACHE_MB → ראשונים נמחקים.

---

## 5. Definition of Done

1. ✅ `core/cache/lru.ts` עם `evictLru()` pure, 8+ tests
2. ✅ `core/schemas` עם `AgentSession` + `AgentPublic.sessions`
3. ✅ `CacheStore` port עם `delete()` + `stats()`
4. ✅ `backend/voice/cache-disk.ts` — LRU eviction + `_index.json` persistence
5. ✅ `backend/app/session-manager.ts` — list/create/load/close/switch
6. ✅ `acp-transport.ts` — `loadSession` + `closeSession` methods
7. ✅ HTTP: `POST /api/agents/:id/sessions`, `GET`, `DELETE /:sid`
8. ✅ WS: `resume` action + `session_lost` response
9. ✅ Bridge persistence — `data/bridges.json`, re-attach בstartup
10. ✅ Frontend reconnect — exponential backoff, sessionStorage, "retrying" indicator
11. ✅ Frontend multi-session — dropdown + "+ session חדש"
12. ✅ Tests: 170+ עוברים (היה 140; +30 לפחות)
13. ✅ Smoke E2E ידני (3 scenarios למעלה)

---

## 6. Slice 6 לא כולל

- Session export/import (Slice 8+)
- Voice mid-prompt reconnect (drop & retry)
- Auth flow (Slice 8)
- Drive UX (Slice 7)
- Provider catalog (Slice 8)
- i18n (Slice 9)

---

## 7. הוראות פעולה

1. עבוד לפי Step-by-step.
2. TDD חובה ל-`core/cache/lru.ts`.
3. עדכן `docs/walkthrough.md` בסוף.
4. commit אחד: `(slice-6): multi-session + LRU cache + WS reconnect`.
5. אם נתקעת — דווח מה ניסית, אל תמציא.

**Timeline:** ~3-4 שעות. אם 5+ — עצור ודווח.

בהצלחה.
