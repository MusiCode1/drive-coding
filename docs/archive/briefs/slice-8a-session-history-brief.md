# Slice 8a — Session History (Backend) brief

> **מטרה:** החזרת פיצ'ר מ-v1 — UI לרשימת sessions ישנים + טעינתם דרך
> ACP `session/list` + `session/load`. כולל שמירה של recordings של המשתמש
> ל-disk, ו-endpoint לדפדוף בfilesystem (במקום v1's config.html picker).
>
> **סוג:** Backend-only. Frontend יקבל את ה-WS events החדשים ב-frontend
> refactor הבא.
> **TDD חובה.** Sub-agent: Sonnet 4.6.
> **זמן הערכה:** 5-7 שעות עבודה.
>
> **בסיס המוצא:** commit `fcf576c` (Tier 1 voice pipeline complete).
> מסמך החקירה: `docs/slice-8a-session-history-research.md`.

---

## 1. מה כלול ב-Slice 8a

| # | פיצ'ר | למה |
|---|--------|-----|
| 1 | `acp-transport.listSessions(cwd)` + `loadSession({ sessionId, cwd })` | תשתית ל-session history |
| 2 | `projects-registry.ts` — persistent disk store של cwds שראינו | dashboard "כל הפרויקטים" |
| 3 | `sessions-cache.ts` — TTL cache לתוצאות `session/list` per cwd | חיסכון של 3-5s spawn זמני בכל refresh |
| 4 | `recordings-store.ts` — disk store לrecordings של המשתמש | replay של user audio |
| 5 | HTTP endpoints חדשים (`/api/projects`, `/api/sessions`, `/api/recordings/:id`, `/api/fs/browse`) | API ל-frontend |
| 6 | Agent creation עם `existingSessionId` → `session/load` במקום `newSession` | טעינת session ישן |
| 7 | WS events: `history_start`, `history_chunk`, `history_tool_call`, `history_done`, `audio_recording_saved` | streaming של history + recording reference |
| 8 | `agent-session.sendAudioPrompt` שומר את ה-blob ב-`recordings-store` ושולח event | משתמש יכול להאזין מחדש |

**מה לא כלול:**
- Frontend changes — יבואו ב-frontend refactor הבא
- File picker UI (modal דפדפן תיקיות) — frontend
- Bubble click-to-play UX (קליק על bubble להשמיע) — frontend
- Recordings auto-cleanup (כשהדיסק מתמלא — נחשוב בעתיד)

---

## 2. החלטות שאושרו

| # | החלטה |
|---|--------|
| 1 | URL ל-session ישן: **persistent** — `/session/[cwdHash]/[sessionId]?cli=opencode` (frontend implementation) |
| 2 | Session שכבר טעון ב-agent חי → redirect ל-agent הקיים (dedup ב-orchestrator) |
| 3 | Bubble click-to-play UI: לוגו קטן בפינה (idle) + border מודגש בזמן השמעה. מעבר מ-bubble ל-bubble אחר עוצר את הקיים ומתחיל מהחדש. *מוקדש לfrontend, backend רק מספק audio chunks*. |
| 4 | File picker: backend folder browser (`/api/fs/browse?path=...`) שe-frontend ירכוב עליו |
| 5 | Recordings: שמירה ל-disk (`.recordings/`), ללא auto-cleanup ב-MVP |

---

## 3. מבנה הקוד המוצע

### קבצים חדשים

```
packages/backend/src/
├── app/
│   ├── projects-registry.ts          # NEW: disk-backed JSON של cwds + lastSession per kind
│   ├── sessions-cache.ts             # NEW: in-memory TTL cache (5 min)
│   └── recordings-store.ts           # NEW: disk-backed recordings (.recordings/<id>.webm)
├── delivery/
│   ├── http-projects.ts              # NEW: GET /api/projects, /api/projects/:cwdHash/sessions, /api/sessions
│   ├── http-recordings.ts            # NEW: GET /api/recordings/:id
│   └── http-fs.ts                    # NEW: GET /api/fs/browse?path=
```

### קבצים שמשתנים

```
packages/backend/src/
├── acp/acp-transport.ts              # add listSessions(cwd), loadSession({ sessionId, cwd })
├── app/
│   ├── agent-orchestrator.ts         # support existingSessionId in create; dedup via active sessions
│   └── agent-session.ts              # handle session/load notifications → history_* events; save recording
└── server.ts                         # wire new HTTP routes

packages/core/src/schemas/ws-messages.ts  # extend with HistoryStartMessage,
                                         HistoryChunkMessage, HistoryToolCallMessage,
                                         HistoryDoneMessage, AudioRecordingSavedMessage
```

---

## 4. Phases (TDD)

### Phase 1 — ACP transport extensions (8-10 tests)

**`acp-transport.listSessions(cwd: string)`:**
```typescript
listSessions(cwd: string): ResultAsync<readonly SessionInfo[], AcpError>
```
- Calls ACP `session/list` with `{ cwd }`.
- `SessionInfo = { sessionId, cwd, title, updatedAt }` (uniform across CLIs).
- Returns empty array if CLI doesn't support (`-32601 Method not found`).
- Tests: happy path, empty result, method-not-found fallback, transport error.

**`acp-transport.loadSession({ sessionId, cwd })`:**
```typescript
loadSession(input: { sessionId: string; cwd: string }, 
            onUpdate: (n: SessionNotification) => void
): ResultAsync<{ capabilities: AgentCapabilities }, AcpError>
```
- Calls ACP `session/load` with `{ sessionId, cwd, mcpServers: [] }`.
- The agent emits notifications for the historical messages — onUpdate forwards them.
- Tests: history events received in order, error on bad sessionId, capabilities returned.

**Reference:** v1 `acp-bridge.ts:269-294`.

### Phase 2 — Storage layer (12-15 tests)

**`projects-registry.ts`:**
```typescript
type ProjectEntry = {
  readonly cwd: string
  readonly kind: BridgeKind
  readonly lastSeen: string  // ISO
  readonly lastSessionId?: string
}

createProjectsRegistry(baseDir: string): {
  recordCwd(cwd: string, kind: BridgeKind): Promise<void>
  recordSession(cwd: string, sessionId: string): Promise<void>
  getProjects(): Promise<readonly ProjectEntry[]>  // sorted by lastSeen DESC
}
```
- Persisted as JSON in `<baseDir>/projects-registry.json`.
- Tests: empty load, record + reload, sort order, duplicate cwd updates lastSeen.

**`sessions-cache.ts`:**
```typescript
createSessionsCache(opts?: { ttlMs?: number }): {
  get(cwd: string): readonly SessionInfo[] | null
  set(cwd: string, sessions: readonly SessionInfo[]): void
  invalidate(cwd: string): void
}
```
- In-memory Map with timestamps. Default TTL 5 min.
- Tests: cache hit, miss after TTL, manual invalidation.

**`recordings-store.ts`:**
```typescript
createRecordingsStore(baseDir: string): {
  save(bytes: Uint8Array, mimeType: string): Promise<{ id: string; durationMs?: number }>
  get(id: string): Promise<{ bytes: Uint8Array; mimeType: string } | null>
  delete(id: string): Promise<void>
  stats(): Promise<{ count: number; bytes: number }>
}
```
- Saves to `<baseDir>/<uuid>.<ext>` (extension from mimeType).
- Sidecar JSON `<baseDir>/index.json` keeps `{ id → { filename, mimeType, savedAt } }`.
- Tests: save + get roundtrip, missing id → null, idempotent init, ext mapping, stats.

### Phase 3 — HTTP endpoints (10-12 tests)

```
GET  /api/projects                          → [{ cwd, kind, lastSeen, lastSessionId }]
GET  /api/projects/:cwdHash/sessions        → [{ sessionId, cwd, title, updatedAt }]
GET  /api/sessions?cwds=a,b,c               → unified (multiple cwds), sorted by updatedAt DESC, limit 50
GET  /api/recordings/:id                    → audio/* bytes (or 404)
GET  /api/fs/browse?path=/home/user         → { path, entries: [{ name, isDir }] }
```

**`http-projects.ts`:**
- `GET /api/projects` reads from registry.
- `GET /api/projects/:cwdHash/sessions`: decode cwdHash → find cwd in registry → check cache → if miss, spawn temp bridge → listSessions → cache → return.
- `GET /api/sessions` (no params or `cwds=`): union of all known cwds (or selected).
- `cwdHash = base64url(sha256(cwd))` — short, URL-safe.

**`http-recordings.ts`:**
- `GET /api/recordings/:id` → `recordings-store.get(id)` → respond with bytes + `Content-Type`.
- 404 if not found.

**`http-fs.ts`:**
- `GET /api/fs/browse?path=` — reads directory entries via `node:fs/promises`.
- Returns `{ path, entries: [{ name, isDir }] }` for navigation.
- Resolves symlinks. Skips hidden files (`.git`, `.opencode/`, etc. — configurable).
- 403 if path resolves outside user's home (security guard).

**Tests:** happy paths, 404s, security (path traversal), cache integration.

### Phase 4 — Agent creation with `existingSessionId` (6-8 tests)

Modify `agent-orchestrator.create`:
```typescript
create({
  cwd: string
  kind: BridgeKind
  model?: string | null
  existingSessionId?: string | null  // NEW
}): Promise<AgentRow>
```

**Flow:**
1. If `existingSessionId` provided:
   - **Dedup check:** iterate active sessions in registry. If any has `cwd === input.cwd && acpSessionId === existingSessionId` → return that agent (no new spawn).
2. Spawn bridge + acp-transport as before.
3. If `existingSessionId` provided → call `transport.loadSession({ sessionId, cwd })` instead of `newSession`.
4. agent-session receives history notifications → emit `history_*` events.
5. Save to registry: `recordSession(cwd, sessionId)`.

Tests: happy path (no existingSessionId), happy path with existingSessionId, dedup hit, dedup miss (different cwd), loadSession error (bad sessionId).

### Phase 5 — WS history events + recording saved (8-10 tests)

**New WS schemas (extend `schemas/ws-messages.ts`):**
```typescript
const HistoryStartMessage = type({
  type: "'history_start'",
  agentId: "string",
  sessionId: "string",
})

const HistoryChunkMessage = type({
  type: "'history_chunk'",
  kind: "'message' | 'thought' | 'user_message'",
  text: "string",
  messageId: "string",
})

const HistoryToolCallMessage = type({
  type: "'history_tool_call'",
  toolCallId: "string",
  title: "string",
  // ...similar to ToolCallMessage but with messageId
})

const HistoryDoneMessage = type({
  type: "'history_done'",
})

const AudioRecordingSavedMessage = type({
  type: "'audio_recording_saved'",
  recordingId: "string",
  mimeType: "string",
  "durationMs?": "number",
})
```

**`agent-session.ts` extensions:**
- When agent is created with `existingSessionId`:
  - Broadcast `history_start` immediately.
  - For each notification received during load:
    - `agent_message_chunk` → `history_chunk { kind: 'message' }`
    - `agent_thought_chunk` → `history_chunk { kind: 'thought' }`
    - `user_message_chunk` → `history_chunk { kind: 'user_message' }`
    - `tool_call` → `history_tool_call`
  - After loadSession resolves → broadcast `history_done`.
  - `firstPromptSent = true` (system prompt is already in history per v1 PROMPT-4).

- When `sendAudioPrompt` is called:
  - **Before STT**, save the blob: `const { id } = await recordingsStore.save(bytes, mimeType)`.
  - Broadcast `audio_recording_saved { recordingId: id, mimeType, durationMs? }`.
  - Continue with STT/ACP/TTS as before.

Tests: history flow generates events in order, recording is saved before STT, duplicate prevention (no `history_*` on regular newSession), AudioRecordingSavedMessage ArkType validation.

---

## 5. WS Protocol — Full Summary After Slice 8a

```typescript
// Existing (from Tier 1):
text_chunk { kind, text, messageId }
audio_chunk { mp3Base64, segmentId, messageId, kind, originalText, translatedText }
tool_call { toolCallId, title, narration?, ... }
tool_call_update { toolCallId, narration, ... }
thinking
done
error
ping/pong

// New in Slice 8a:
history_start { agentId, sessionId }
history_chunk { kind, text, messageId }
history_tool_call { toolCallId, title, ... }
history_done
audio_recording_saved { recordingId, mimeType, durationMs? }
```

---

## 6. DoD Checklist

- [ ] All TDD tests pass (~45-55 new tests expected)
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test` green at every commit
- [ ] listSessions returns 19+ sessions for opencode on `/home/user/projects/voice-acp-v2` (live integration check — ask Avi to verify)
- [ ] recordings saved to `.recordings/` with sidecar `index.json`
- [ ] `GET /api/fs/browse?path=/home/user/projects` returns directory entries
- [ ] Agent creation with `existingSessionId` emits `history_*` events
- [ ] Dedup: creating agent twice with same (cwd, sessionId) → same agentId
- [ ] WS schemas validated by ArkType
- [ ] update `docs/walkthrough.md` with entry per Phase + final summary
- [ ] update `docs/behaviors-coverage.md` — UI-HIST behaviors (now backend-supported)

---

## 7. אסור / מותר

**מותר:**
- `packages/backend/src/**`, `packages/backend/tests/**`
- `packages/core/src/schemas/ws-messages.ts` (extend schemas)
- `docs/walkthrough.md` (entry חדש)
- `docs/behaviors-coverage.md` (עדכון סטטוסים)
- `.recordings/`, `.cache/projects-registry.json` (gitignored)

**אסור:**
- `packages/frontend/src/**` — frontend refactor יבוא אחר כך
- `packages/core/src/**` חוץ מ-`schemas/ws-messages.ts`
- `docs/reviews/**`, `docs/archive/**`

---

## 8. סקילים חובה

- `tdd` — red-green-refactor loop
- `dev-conventions` — ESM, ArkType, Result/neverthrow, functional core, אסור any
- `commit` — מבנה commit messages (עברית, פר-Phase)
- `update-walkthrough` — entry בסוף

**אוטונומיה גורפת:** אבי אישר את התוכנית. אל תבקש רשות לcommit. בסוף כל
Phase ירוק → typecheck/lint/test → commit אוטומטי. אם נתקל בהחלטה
ארכיטקטונית שלא מכוסה ב-brief — עצור ושאל.

---

## 9. Prompt לסוכן

```
אתה סוכן TDD שמיישם Slice 8a (Session History — Backend) ב-drive-coding.

נתיבים:
- worktree (CWD): /home/user/projects/voice-acp-v2
- v1 reference: /home/user/projects/voice-acp/backend/src/
  בעיקר: acp-bridge.ts, init-handler.ts, api-info.ts, prompt-handler.ts
- מסמך החקירה: docs/slice-8a-session-history-research.md (קרא ראשון לcontext)

מקור אמת: docs/slice-8a-session-history-brief.md (החל ב-1 → 9).

עבודה:
1. טען את הסקילים: tdd, dev-conventions, commit, update-walkthrough.
2. קרא את ה-brief מקצה לקצה.
3. קרא את הקוד הקיים: acp-transport.ts, agent-orchestrator.ts, agent-session.ts,
   schemas/ws-messages.ts.
4. קרא v1 reference: acp-bridge.ts (listSessions, loadSession, extractSessionResult).
5. בצע לפי Phase 1→5 בסדר. TDD חובה: test → red → impl → green → refactor.
6. commit פר Phase. פורמט עברי. דוגמאות:
   "feat(acp): Phase 1 — listSessions + loadSession transport — X tests"
   "feat(storage): Phase 2 — projects-registry + sessions-cache + recordings-store"
7. בסוף — עדכן docs/walkthrough.md לפי skill עם entry מסכם.
8. עדכן docs/behaviors-coverage.md — UI-HIST behaviors עוברים ל-✅.

pnpm typecheck + pnpm lint + pnpm test לפני כל commit.

אסור לערוך: packages/frontend/src/**, packages/core/src/** חוץ מ-schemas/ws-messages.ts.
מותר: backend/src, backend/tests, schemas/ws-messages.ts, docs/walkthrough.md, docs/behaviors-coverage.md.

ה-backend רץ ברקע ב-tmux `be`. אל תפיל. אם צריך לבדוק integration חי — שאל קודם.

אוטונומיה גורפת — בסוף כל Phase ירוק → commit אוטומטי. רק החלטה
ארכיטקטונית לא מכוסה ב-brief → עצור ושאל.
```

---

## 10. סיכום צפוי

- 5 commits (פר Phase)
- ~45-55 tests חדשים
- ~600-900 שורות impl חדשות
- 4 endpoints חדשים
- 5 WS events חדשים
- 3 modules חדשים (projects-registry, sessions-cache, recordings-store)
- 2 transport methods חדשות
- 7+ UI-HIST behaviors עוברים ל-✅ (תלוי בfrontend, אבל ה-backend מספק)
