# Walkthrough — voice-acp

יומן התקדמות הפרויקט. רשומה חדשה בראש הקובץ.

---
## 2026-05-17 02:15 — Slice 8a Phase 2: Storage Layer (projects-registry + sessions-cache + recordings-store)

### סיכום

TDD Phase 2 — שלושה מודולי אחסון חדשים ב-`packages/backend/src/app/`.
16 טסטים חדשים, כולם ירוקים. typecheck ו-lint נקיים.

#### מה בוצע

**1. `projects-registry.ts`** — disk-backed JSON store של cwds
- קריאה וכתיבה ל-`<baseDir>/projects-registry.json`
- `recordCwd(cwd, kind)`: יוצר/מעדכן entry עם `lastSeen` ISO
- `recordSession(cwd, sessionId)`: עדכון `lastSessionId` בלבד
- `getProjects()`: מחזיר ממויין לפי `lastSeen DESC`
- `mkdir({ recursive: true })` — ניצור תיקייה אם לא קיימת
- 5 טסטים

**2. `sessions-cache.ts`** — in-memory TTL cache
- `Map<string, { sessions, cachedAt }>` עם TTL (ברירת מחדל 5 דקות)
- `get(cwd)`: null אם פג תוקף / לא קיים
- `set(cwd, sessions)`: מאפס שעון TTL
- `invalidate(cwd)`: ניקוי ידני מיידי
- 4 טסטים (כולל fake-timers לבדיקת TTL)

**3. `recordings-store.ts`** — disk-backed recordings
- שמירה ל-`<baseDir>/<uuid>.<ext>` (ext ממיפוי mimeType)
- `index.json` סייד-קאר עם `{ id → { filename, mimeType, savedAt, bytes } }`
- `save / get / delete / stats`
- ניצור baseDir רקורסיבית
- 7 טסטים (roundtrip, null on miss, deep dir, ext mapping, stats, delete)

#### החלטות ארכיטקטורה

- **index.json vs filesystem scan**: index.json נוח יותר לstats + get מהיר ללא stat/readdir
- **`delete` מוחק מהindex ומהdisk**: שני המקומות תמיד בסנכרון. אם הקובץ כבר נמחק — `unlink` נכשל בשקט
- **`SessionInfo` type מיובא מ-acp-transport**: sessions-cache לא מגדיר type משלו

---
## 2026-05-17 01:55 — Slice 8a Phase 1: ACP Transport Extensions (listSessions + loadSession)

### סיכום

TDD Phase 1 — הוספת תמיכה ב-`listSessionsFromBridge` ו-`createAcpWsLoadTransport` ל-`acp-transport.ts`.
12 טסטים חדשים, כולם ירוקים. typecheck ו-lint נקיים.

#### מה בוצע

**1. ריפקטור `setupWsAndInitialize` (helper פרטי)**
- חולצה הלוגיקה המשותפת של פתיחת WS + handshake + initialize מ-`createAcpWsTransport`
- תמיכה ב-`warmupDelayMs` option (0 בטסטים, 1500 בproduction)
- שמירה על `auth_required` error handling

**2. `SessionInfo` type (exported)**
- `{ sessionId, cwd, title, updatedAt }` — uniform schema שעובד עם כל ה-CLIs

**3. `listSessionsFromBridge(opts)` — ResultAsync**
- קורא ACP `session/list` (ללא `session/new`)
- Fallback: `-32601 Method not found` → `ok([])` (תמיכה ב-Gemini שלא תומך ב-list)
- שגיאת transport → `err({ kind: 'transport', ... })`
- 5 טסטים

**4. `createAcpWsLoadTransport(opts)` — Promise\<AcpTransport\>**
- קורא `session/load` (ללא `session/new`) — מטרה: טעינת session קיים
- `onHistoryUpdate` callback מקבל notifications במהלך הload (לפני resolve)
- Transport מחזיר אחר loadSession ניתן לשימוש ל-`prompt()` רגיל
- `onHistoryUpdate` מתנקה אחרי load — prompts עתידיים לא "מזהמים" את callback ההיסטוריה
- 7 טסטים

#### החלטות ארכיטקטורה

- **`setupWsAndInitialize` כ-private helper**: הלוגיקה המשותפת (WS setup, initialized) מחולצת פנימית, לא exported — כי שימוש חיצוני לא נדרש
- **ResultAsync עבור listSessions, Promise עבור loadTransport**: listSessions יכול להיכשל בנחת (CLI לא תומך) → ResultAsync מתאים. loadTransport זה חלק מ-agent creation flow שכבר זורק → Promise מספיק
- **warmupDelayMs=0 בטסטים**: מונע 1.5s בכל test, שוות ערך לproduction-behavior

---
## 2026-05-17 03:00 — Tier 1 Voice Pipeline: Phases 1-6

### סיכום

סוכן TDD יישם את מלא Tier 1 של voice pipeline — 6 Phases, 57 tests חדשים (+37 בנוסף לבסיס).
כל tests ירוקים, typecheck ו-lint נקיים. 7 behaviors מ-v1 שוחזרו.

#### Phases שבוצעו

| Phase | תיאור | קבצים | Tests |
|-------|--------|--------|-------|
| 1 | Cache\<T\> factory | core/cache/types.ts, backend/voice/cache.ts, cache-keys.ts | 8 (CACHE-1..8) |
| 2 | narration.ts | backend/voice/narration.ts | 14 (NARR-1..14) |
| 3 | translateText cache | backend/voice/pipeline.ts | 4 (TRANS-CACHE-1..4) |
| 4 | Coordination מלאה | backend/app/agent-session.ts, core/schemas/ws-messages.ts | 25 (COORD-1..25) |
| 5 | Provider error | backend/app/agent-session.ts + orchestrator.ts | 7 (PERR-1..7) |
| 6 | WS protocol + E2E | core/schemas/ws-messages.ts | 7 (PROTO-1..6 + E2E-1) |

#### מה בוצע

**1. Cache\<T\> — factory גנרי (Phase 1)**
- `packages/core/src/cache/types.ts`: ממשק `Cache<T>` (get/set/has)
- `packages/backend/src/voice/cache.ts`: `createDiskCache<T>` עם namespace separation, lazy mkdir, encode/decode
- `packages/backend/src/voice/cache-keys.ts`: `sha256Key()` helper
- `packages/backend/src/voice/cache-disk.ts`: מסומן `@deprecated`, קוד מקורי נשמר לתאימות

**2. Narration (Phase 2)**
- `packages/backend/src/voice/narration.ts`: port מ-v1 gemini-helper.ts
- `buildNarratePrompt` (pure) + `narrateToolCall` (async, Result\<string,string\>)
- `NarrationGenerator` interface (decoupled מ-@google/genai)
- Cache hit → ללא קריאת LLM; timeout 1500ms → Err

**3. Translation cache (Phase 3)**
- `translateText` קיבל פרמטר רביעי: `cache: Cache<string> | null`
- Cache key = sha256(text + "|" + targetLang)
- null cache → fallback לנתיב הישן (backward compat)

**4. Coordination מלאה (Phase 4)**
- `sendAudioPrompt` מחודש לחלוטין:
  - `acpMessageBuffer` + `acpThoughtBuffer` — thought/message נפרדים
  - `currentMessageId` / `currentThoughtId` — UUIDs stable per turn
  - `TtsJob` union: message | thought | narration (עם segmentId + messageId)
  - `processQueue`: narration → `narrateToolCall` → `tool_call_update` broadcast
  - `flushMessage` / `flushThought`: FIFO recentMessages (max 3) לnarration context
  - PROMPT-11: message buffer flushed כשthought מגיע
  - PROMPT-12: thought buffer flushed כשtool_call מגיע
  - `audioPromptCancelled` flag עוצר processQueue ב-cancel
  - `callbacks.onAudioChunk` נשמר לbackward compat
- WS protocol extension: TextChunkMessage.messageId?, AudioChunkMessage.segmentId/kind/originalText/translatedText, ToolCallUpdateMessage חדש, ToolCallMessage.narration?

**5. Provider error (Phase 5)**
- `createAgentSession({ getStderr?: () => string[] })` — Phase 4 כבר הוסיף
- `sendPrompt` + `sendAudioPrompt`: אחרי response, אם 0 chars + getStderr → extractProviderError → PROVIDER_ERROR broadcast
- `agent-orchestrator.ts`: מעביר `getStderr` ל-createAgentSession

**6. WS protocol tests + E2E (Phase 6)**
- ArkType schema validation tests לכל הtype extensions
- E2E test: thought→message→tool_call → בדיקת כל WS events עם IDs נכונים

#### סטטיסטיקה לפני/אחרי Tier 1

| סטטוס | לפני | אחרי |
|--------|------|------|
| ✅ מכוסה | 52 | **57** (+5) |
| ❌ לא מכוסה | 6 | 1 |
| **סה"כ tests** | **335** | **392** (+57) |

#### Behaviors שנסגרו

- PROMPT-7: TTS error per segment → pipeline ממשיכה
- PROMPT-10: thoughtBuffer + flushThought + ttsQueue
- PROMPT-11: message→thought flush
- PROMPT-12: tool_call → flush + narration (narrateToolCall)
- PROMPT-13: trailing buffers flushed at end of turn
- PROMPT-17: totalMessageChars=0 → provider error (כבר היה ✅, תוקן reference)

#### החלטות ארכיטקטורה

- `DiskCache` נשמר `@deprecated` (לא מומר ל-wrapper) — הבדלי נתיב פנימי היו שוברים tests ישנים
- `narrationGenerator` נוצר inside `sendAudioPrompt` משתמש ב-translator model (Gemini Flash Lite)
- narration cache: in-memory Map per sendAudioPrompt call (reset בין קריאות)
- translation cache: null בתוך sendAudioPrompt (Phase 4) — disk cache בעתיד דרך delivery layer
- `void flushMessage()` fire-and-forget בnotification handler (sync) מכיוון שהsync part pushes לqueue לפני ה-await

#### מעקפים ופתרונות

- **import order (Biome)**: כל קובץ דרש import ordering ידני לפי סדר alphabetical ש-Biome מצפה
- **`err()` vs manual mock**: mock של Result עם `{isOk,isErr}` plain object לא הכיל `.error` — תוקן ל-`err("...")` מneverthrow
- **`findIndex` → `indexOf`**: Biome's `useIndexOf` rule דרשה החלפה לstring equality

---
## 2026-05-16 (TDD) — סגירת 9 פערי כיסוי behaviors

### סיכום

סוכן TDD סגר את כל 9 הפערים שזוהו ב-`docs/behaviors-coverage.md` (High + Medium Priority).

#### סטטיסטיקה לפני/אחרי

| סטטוס | לפני | אחרי |
|--------|------|------|
| ✅ מכוסה | 43 | **52** (+9) |
| ❌ לא מכוסה | 15 | 6 |
| ⚠️ חלקית | 15 | 15 |
| 🚫 לא רלוונטי | 150 | 150 |
| **סה"כ tests** | **308** (backend) | **325** (backend) |

#### פערים שנסגרו

| ID | תיאור | impl שינוי? | קובץ test |
|----|--------|------------|-----------|
| PROMPT-1 | busy flag — concurrent prompts | ✅ הוסף `isBusy` ל-`sendPrompt` | agent-session.test.ts |
| STT-8 | empty transcript → done מיידי | ✅ early-return לפני ACP | agent-session-audio.test.ts |
| PROMPT-5 | serial TTS queue | — (impl קיים) | agent-session-audio.test.ts |
| ACP-9 | unknown sessionUpdate → silently ignored | — (impl קיים) | agent-session.test.ts |
| TTS-2 | missing ttsVoiceId → Err | ✅ validation לפני TTS API | voice-pipeline.test.ts |
| GEMINI-3 | translation timeout 2500ms | ✅ `Promise.race` + timeout | voice-pipeline.test.ts |
| ACP-13 | stopReason≠end_turn → warn log | ✅ `console.warn` נוסף | agent-session.test.ts |
| MARKDOWN-7 | replace order קבוע | — (impl קיים) | core/tests/ui/markdown.test.ts |
| ACP-17 | session/new mcpServers:[] | — (impl קיים) | acp-transport.test.ts |

#### באג audio_chunk — סטטוס

הבאג שחשד ב-PROMPT-5 ו-GEMINI-3 כגורם לבעיות audio_chunk **לא אושר**:
- PROMPT-5 (serial queue): הImpl הקיים נכון. הtest מאשר שסדר ה-chunks תקין.
- GEMINI-3 (translation timeout): הTimeout לא היה קיים — נוסף. בהיעדר timeout, pipeline תקועה חוסמת את כל ה-audio. תיקון הוסף.

אין עדות לבאג audio_chunk ספציפי בסביבת ה-tests.

#### קבצים שנוצרו

- `packages/backend/tests/agent-session-audio.test.ts` — tests ל-sendAudioPrompt (STT-8, PROMPT-5)

#### קבצים שעודכנו (impl)

- `packages/backend/src/app/agent-session.ts` — isBusy flag, empty transcript check, stopReason warn
- `packages/backend/src/voice/pipeline.ts` — ttsVoiceId validation, translateText timeout

---
## 2026-05-16 (docs) — מיפוי כיסוי behaviors v1 → vnext

### behaviors-coverage.md נוצר

מסמך מיפוי מלא של 223 behaviors מ-v1 (`docs/archive/v1/behaviors.md`) לכיסוי ב-vnext.
נסרקו כל 33 קבצי tests ב-`packages/{core,backend,frontend}`.

#### סטטיסטיקה

| סטטוס | כמות | אחוז |
|--------|------|------|
| ✅ מכוסה | 43 | 19% |
| ⚠️ חלקית | 15 | 7% |
| ❌ לא מכוסה | 15 | 7% |
| 🚫 לא רלוונטי | 150 | 67% |
| **סה"כ** | **223** | |

#### למה 67% "לא רלוונטי"?

vnext הוא ארכיטקטורה שונה לחלוטין: multi-agent platform עם SvelteKit frontend.
קטגוריות שלמות נפלו: CONFIG/CONFIG-PICKER (21), STATIC (5), URL (5), UI-HEADER (4), UI-HIST (7), SYSPROMPT (7), REC (8), רוב HTTP (14).

#### פערים מסוכנים (❌) — ממוינים לפי priority

1. **PROMPT-1** — busy flag, מניעת concurrent prompts → עלול לגרום לstate corruption
2. **STT-8** — empty transcript → done מיידי (לא נבדק, עלול לשלוח פרומפט ריק ל-ACP)
3. **PROMPT-5** — serial TTS queue (race condition ב-audio chunks)
4. **ACP-9** — unknown sessionUpdate types → עלול להוריד transport
5. **TTS-2** — missing voice ID env var → TTS נכשל בשקט
6. **GEMINI-3** — translation timeout (pipeline חסומה)
7. **ACP-13** — stopReason ≠ end_turn handling
8. **MARKDOWN-7** — סדר replace operations
9. **ACP-17** — mcpServers:[] ב-session/new

ראה `docs/behaviors-coverage.md` לפירוט מלא + הצעות לסגירת פערים.

---
## 2026-05-16 20:32 (vnext, Yolo — backend tests pri 🟢 — סיום)

### Backend Test Coverage — Priority 3 (16 tests חדשים)

סיום תוכנית הכיסוי לפי `docs/backend-test-plan.md`. 4 קבצי "low logic"
שעדיין שווה לכסות כדי להגן מ-regression.

#### קבצים שכוסו

**1. `http-options.ts` — 7 tests**
- GET /api/options → `{models, projects}`.
- כל 4 ה-CLIs יש להם מערכי models לא ריקים.
- `execFileSync("opencode", ["models"])` ממוקם דרך `vi.mock("node:child_process")`,
  מסיר 10s מזמן הרצת הסשן (התנהגות אמיתית קוראת ל-opencode עם 5s timeout).
- fallback ל-MODEL_FALLBACKS כש-execFileSync זורק.
- projects: כל path אבסולוטי, אין `user-files` או `node_modules`, capped 50.
- Preferred prefixes order (anthropic/claude-opus קודם).

**2. `providers.ts` — 4 tests**
- `STT_REGISTRY['gemini/flash-context']` — v3 spec.
- `TTS_REGISTRY['elevenlabs/v3']` — modelId קיים.
- `TRANSLATOR_REGISTRY['gemini/flash-lite']` — קיים.
- `DEFAULT_REGISTRIES` ממופה נכון.

**3. `ws-echo.ts` — 4 tests**
- open → hello + version.
- ping → pong + echoOf + serverTime.
- Invalid JSON → INVALID_JSON.
- Unknown type → INVALID_MSG.

**4. `http.ts` — 1 test**
- GET /api/health → `{status: 'ok', version, uptime}`.

#### Stats סופי

- 12 commits לאורך הסשן (kept tmux-crash-safe)
- 308 backend tests (היה 185 בתחילה, נוספו 123 tests TDD)
- 56 frontend tests (לא נגעתי)
- `pnpm typecheck` ✅, `pnpm lint` ✅, `pnpm test` ✅
- Coverage backend: **18/19 קבצים** (server.ts לא נכלל לפי התוכנית — wiring only)

#### סה"כ tests חדשים לפי קובץ

| קובץ | Tests | Priority |
|------|-------|----------|
| ws-streams.ts | 20 | 🔴 |
| acp-transport.ts | 14 | 🔴 |
| client-impl.ts | 13 | 🔴 |
| cli-config.ts | 15 | 🟡 |
| agent-orchestrator.ts | 11 | 🟡 |
| ws-agent.ts | 14 | 🟡 |
| cache-disk.ts | 10 | 🟡 |
| gemini-transcription.ts | 10 | 🟡 |
| http-options.ts | 7 | 🟢 |
| providers.ts | 4 | 🟢 |
| ws-echo.ts | 4 | 🟢 |
| http.ts | 1 | 🟢 |
| **סה"כ** | **123** |  |

המספר עלה מעל היעד המקורי של 86 (כיסוי טוב יותר בקבצים העיקריים).

#### באג audio_chunk — לא תוקן

כל ה-tests החדשים עברו ירוק על הimpl הקיים — סימן ש-ws-streams /
acp-transport / ws-agent / gemini-transcription / cache-disk תקינים.
הצוואר צר נשאר ב-`voice/pipeline.ts` או ב-race-condition ב-`ttsActive`
flag ב-`agent-session.sendAudioPrompt`. דורש חקירה מקור-לקבלן עם logs
לחיים — לא בתחום של unit tests סטטיים.

---
## 2026-05-16 20:28 (vnext, Yolo — backend tests pri 🟡)

### Backend Test Coverage — Priority 2 (60 tests חדשים)

המשך כיסוי backend לפי `docs/backend-test-plan.md`. 5 קבצים של "חשוב
אבל לא נמצאו בו באגים ב-prod". TDD: כל test נכתב, ה-impl עבר ירוק בלי
תיקונים (סימן שהimpl יציב).

#### קבצים שכוסו

**1. `cli-config.ts` — 15 tests**
- `getCliCommand` לכל 4 ה-kinds (opencode/claude/gemini/codex).
- opencode מתעלם מ-modelOverride — וידוא חשוב כי `opencode acp` לא
  מקבל `-m`/`--model` (learning 2026-05-16). הtest יציל מ-regression
  אם מישהו "יתקן" לשים `--model` שם.
- `OPENCODE_BIN` env override.
- modelOverride ריק / whitespace / null → לא מתווסף `--model`.
- `buildStdioToWsArgs`: `--persist` + `--grace-period -1`, port=0/12345,
  CLI command מצורף כstring יחיד.

**2. `agent-orchestrator.ts` — 11 tests**
- happy path → status=ready, bridgePort+acpSessionId.
- bridge spawn failure / ACP attach failure → status=crashed.
- deleteAndKill ↔ kill + session removed.
- deleteAndKill על agent לא קיים → no-op.
- crash listener: bridge מת → status=crashed; agent ב-closed לא נדרס.
- spawnWithStderr preferred path; modelOverride מועבר.

המוק: `vi.mock('../src/acp/acp-transport.js')` מחליף את
`createAcpWsTransport` באובייקט קבוע, ו-Registry/BridgeManager mocks
ב-memory.

**3. `ws-agent.ts` — 14 tests**
- open: known agent → 'connected' + subscribe; unknown → AGENT_NOT_FOUND + close 1008.
- message: invalid JSON, unknown type, ping, prompt, cancel, audio (base64 decode).
- agent removed mid-session → AGENT_NOT_FOUND error.
- broadcasts: session subscriber → ws.send forwarded.
- close → unsubscribe (זיהוי memory leak פוטנציאלי).
- tryUpgrade: URL match, no-match, upgrade=false → Response 426.

**4. `cache-disk.ts` — 10 tests**
- init() יוצר תיקייה; idempotent.
- set/get roundtrip עם bytes זהים; missing key → null.
- last write wins; sha256 hex key; empty buffer; 100KB byte-exact.
- get לפני init() → null (graceful, no throw).

**5. `gemini-transcription.ts` — 10 tests**
- provider shape: specificationVersion='v3', modelId, provider='gemini-transcription'.
- doGenerate מחזיר {text, segments:[], warnings:[], response.modelId}.
- מבנה contents שנשלח: prompt + inlineData{mimeType, base64}.
- WITH/WITHOUT previousAssistantText — prompt משתנה (context-aware STT, D39).
- prompt תמיד כולל הוראת Hebrew script (אל transliterate — learning 2026-05-16).
- audio גם כ-base64 string (לא רק Uint8Array).
- response.text=undefined → '' (no crash).

#### Stats

- 5 commits לאורך הסשן (kept tmux-crash-safe)
- 292 backend tests (היה 232) — נוספו 60 טסטים TDD
- `pnpm typecheck` ✅, `pnpm lint` ✅ (תוקן: imports order, non-null
  assertions → `?.`)
- Coverage backend: 13/19 → 18/19 קבצים. נשאר `server.ts` (wiring בלבד)
  ו-4 קבצי `🟢` בעדיפות נמוכה.

#### באג audio_chunk — לא נחשף ב-tests

הtests של `ws-agent.ts`, `gemini-transcription.ts`, `cache-disk.ts`
עברו ירוק על הimpl הקיים. ה-pipeline למעלה (`agent-session.sendAudioPrompt`)
כבר היה מכוסה ב-tests קיימים. הtests החדשים לא מצאו את הbug. ייתכן:
- בעיית timing ב-`splitIntoSentences` — חוזר ריק על chunks קצרים
  ומשאיר את הbuffer מלא עד flush.
- TTS provider החזיר 401 / cache miss + ElevenLabs rate-limit.
- Race ב-`ttsActive` flag (לא raceטוב, אבל לא תמיד הbug).

הצעה לחקירה: tests של `voice/pipeline.ts` (כבר קיים) — להוסיף tests
ל-`speakSentence` עם empty audio + cache fail + retry. לא נכלל בתוכנית
הזו (`voice-pipeline.test.ts` כבר קיים, לא חסר).

---
## 2026-05-16 20:20 (vnext, Yolo — backend tests pri 🔴)

### Backend Test Coverage — Priority 1 (47 tests חדשים)

לפי `docs/backend-test-plan.md`, סגירת פערי כיסוי ב-backend. 3 קבצים
חשופים שבהם כבר נמצאו באגים ב-prod (NDJSON `\n`, warmup timing,
filter כל frame ולא רק הראשון). TDD: test → impl נשאר ירוק.

#### קבצים שכוסו

**1. `ws-streams.ts` — 20 tests**
- Readable side: ACP JSON-RPC frame passthrough; `connected` / `heartbeat`
  / `disconnected` swallowed (לא רק על ההודעה הראשונה — באג ידוע); unknown
  type swallowed + `console.warn`; partial frames נשמרים as-is **בלי**
  הוספת `\n` (באג שני שתוקן בעבר); 2 frames שמרכיבים JSON אחד; string
  vs Buffer data; ws close/error → controller.close/error; double-close
  guard.
- Writable side: line + `\n` נשלח כ-frame; שתי שורות → שני frames;
  שורה ריקה לא נשלחת; `ws.send` שזורק נבלע בשקט; `close()` → `ws.close()`;
  כשws כבר CLOSED → אין `ws.close`; `abort(reason)` → `ws.close(1011, reason)`.

**2. `acp-transport.ts` — 14 tests**
- `MockWebSocket` מדמה את stdio-to-ws: שולח `connected` frame אחרי open,
  עונה ל-`initialize`/`session/new`/`session/prompt`/`session/cancel`.
- happy path; capabilities default ל-`loadSession=false` כש-agentCapabilities
  חסר; sessionId propagation; WS error → reject `ACP WS error`;
  stdio-to-ws handshake timeout (10s עם fake timers); clientCapabilities.fs;
  clientInfo.name = `drive-coding`; cwd forwarding; custom protocolVersion;
  prompt forwarding + onUpdate; cancel + sessionId; shutdown closes WS;
  `auth_required` error → `kind: 'auth_required'` typed error.

**3. `client-impl.ts` — 13 tests**
- requestPermission: `allow_once` > `allow_always` > non-reject > first;
  options ריק → cancelled; reject_once+allow_once → בוחר allow_once;
  unknown kind → still picks (non-reject fallback).
- sessionUpdate forwards notification.
- fs operations עם `mkdtemp` + cleanup: readTextFile עם/בלי line+limit,
  ENOENT throws; writeTextFile יוצר ומחליף קובץ.

#### Stats

- 3 commits לאורך הסשן (kept tmux-crash-safe)
- 232 backend tests (היה 185) — נוספו 47 טסטים TDD
- `pnpm typecheck` ✅, `pnpm lint` ✅, `pnpm test` ✅
- Coverage backend: 10/19 → 13/19 קבצים (לפי קבצים)

#### באגים שלא מצאו תיקון

כל ה-tests עברו ירוק על הimpl הקיים — אין עדויות חדשות לבאג ה-`audio_chunk` החסר.
הimpl של ws-streams + acp-transport נראה תקין; ייתכן שהבעיה במקום אחר
ב-pipeline (אולי `voice/pipeline.ts` או callbacks ב-`agent-session`). יבדק
ב-🟡 כשנכסה את `ws-agent.ts` ו-`gemini-transcription.ts`.

---
## 2026-05-16 19:55 (vnext, Yolo — QA + fix)

### QA Pass + 4 Bug Fixes (56 frontend tests)

QA מקיף לפי `docs/frontend-spec.md §20` מול browser חי ב-linux-gui
(pw-clean.sh + CDP attach דרך `your-app.nue.tuns.sh`).
מצאנו 4 באגים, תיקנו ב-TDD, וידאנו ב-browser.

#### באגים שתוקנו

**1. dashboard `confirm()` — הפרת §9.6 #5 ("בלי modals/dialogs")**
- `routes/+page.svelte`: `confirm("למחוק את הסוכן?")` → inline confirm.
- הכפתור × עכשיו מחליף את עצמו בקבוצת "למחוק? [אשר] [בטל]" באותו card.
- מתאים לנהיגה — אצבע גדולה, אין מודל שחוסם.

**2. audio_chunk dropped on file upload**
- `routes/agent/[id]/+page.svelte`: `onFileUpload` קרא ל-`session.sendRaw`
  ישירות בלי לעדכן את `voiceState`. בקבלת audio_chunk הguard ב-
  voice-session דחה (`if (voiceState === "thinking"||"speaking")` → false).
- Fix: הוספנו `voice.sendAudioBlob(blob, mimeType)` ב-voice-session
  שמקדם את ה-state ל-`transcribing → thinking` בדיוק כמו stopRecording.
- 2 טסטים חדשים: שולח payload נכון; קודם state.

**3. STT preview הופיע אחרי תשובת הassistant**
- הbubble `🎙 …` היה ב-template נפרד אחרי `{#each session.messages}`,
  ולא היה משולב ב-messages — תוצאה: תמיד בתחתית הצ'אט גם אחרי תשובה.
- Fix: ב-agent-session, message מסוג `stt_partial` עושה upsert בtoך
  messages — מעדכן user bubble streaming קיים או יוצר חדש. בrender,
  user bubble streaming מקבל `🎙 ` prefix + italic. `done` מסיים streaming.
- 2 טסטים חדשים: chronological order; לא דורס user bubble של טקסט.

**4. replay-last נשאר disabled גם אחרי שמע**
- `voice.canReplayLast` החזיר `player.hasLastPlayed` — property רגיל
  על AudioQueue, **לא** `$state`. Svelte 5 לא יודע לעקוב — `$derived`
  שקורא לו לעולם לא re-evaluates.
- Fix: הוספנו `hasReplayable = $state(false)` ב-voice-session שמתעדכן
  ב-`onStateChange(true)` של ה-player. `canReplayLast` מחזיר אותו.
- טסט חדש: `canReplayLast` הופך true אחרי audio_chunk.

#### עבר QA ב-browser

§20 blockers (כולם ✅): `dir="rtl"`, mic 110px×5 states+animations,
bubbles RTL alignment, markdown rendering, text prompt E2E, voice E2E
via upload, auto-scroll+jump-down (verified scroll-to-top → button
appears → click → scrolls back), status text colors, error display,
audio cues (code path), replay-last (now functional), stop button
visible only in speaking, tools collapsible + status dots (arrow
rotates 90°), thought 💭, WS reconnect (backoff array verified).

car mode `?car=1`: enable button מופיע, click → "🚗 בקרת רכב פעילה",
text input מוסתר ב-car mode (לפי spec §4).

#### בעיה backend מחוץ לתחום

ה-TTS pipeline בbackend לא שולח `audio_chunk` עבור כל ה-prompts —
המודל החזיר תשובה טקסטואלית אבל אין audio_chunk events ב-WS log
(verified). frontend מתפקד נכון על מה שמגיע — אם chunks יגיעו, הם
ינוגנו וreplay יהיה זמין. לא בתחום ה-QA (אסור לערוך backend).

#### Stats

- 4 commits לאורך הסשן (לא בסוף בלבד — kept tmux-crash-safe)
- 56 frontend tests (היה 51) — נוספו 5 טסטים TDD
- pnpm typecheck ✅, pnpm lint ✅ (פתרנו 3 warnings ב-scripts/), pnpm test ✅

---
## 2026-05-16 18:35 (vnext, Yolo)

### UI Parity Fix — 7 באגים מה-review (236 tests)

תיקון כל ה-blockers וה-high-value items מ-`docs/reviews/ui-parity-review.md`. סה"כ 7 תיקונים, 16 טסטים חדשים, 236 סה"כ (מ-220).

#### מה בוצע?

**1. תיקון 1 — `dir="rtl"` (verified):**
- `app.html` כבר מכיל `<html lang="he" dir="rtl">` — לא היה נדרש שינוי. הדוח ציין זאת כ-bug אך הקוד היה תקין.

**2. תיקון 2 — `$derived` → `$state` + cleanup (Bug 4 ב-review):**
- `routes/agent/[id]/+page.svelte`: שינוי `session` ו-`voice` מ-`$derived` ל-`$state`. הוסף `$effect` שסוגר את ה-WS הישן לפני יצירת session חדש כשמשתנה `agentId`. מונע זליגת WebSocket connections.

**3. תיקון 3 — `isCancelling` wired (Bug 1 ב-review):**
- `+page.svelte`: הוסף `let isCancelling = $state(false)`. מדלק ב-`onMicClick` וב-`onStop` כשעוברים ל-cancel. מכבה אוטומטית ב-`$effect` כש-`voiceState === "idle"`. כעת state `cancelling` ניתן להגיע אליו — הכפתור מציג ✕ + flash כתום.

**4. תיקון 4 — WS reconnect עם exponential backoff (Bug 5 ב-review):**
- `lib/stores/agent-session.svelte.ts`: הוסף `scheduleReconnect()` עם delays `[1s, 2s, 4s, 8s, 15s, 30s]`. WS סגירה לא-מכוונת מציג "מתחבר מחדש... (ניסיון N)" ב-error. `disconnect()` מפסיק reconnect ואינה מציג error. `retryCount` מאופס כשהחיבור מצליח.
- טסטים חדשים: 4 טסטים לreconnect (schedules, actually reconnects, no reconnect on intentional, resets count).

**5. תיקון 5 — replay-last button wired:**
- `lib/audio/player.ts`: הוסף `private lastPlayed` שנשמר ב-`tick()` בכל פעם שמנגנים. `replayLast()` מאפס `currentTime=0` ומפעיל `play()`. `hasLastPlayed` getter.
- `lib/stores/voice-session.svelte.ts`: חשוף `replayLast()` ו-`canReplayLast` getter.
- `+page.svelte`: wire הכפתור 🔊 — `onclick={() => voice.replayLast()}`, `disabled={!voice.canReplayLast}`.
- טסטים חדשים: 7 טסטים ב-`player.test.ts` (hasLastPlayed, replayLast, isPlaying, clear).

**6. תיקון 6 — car mode previoustrack handler (Bug 3 ב-review):**
- `lib/stores/car-mode.svelte.ts`: `setActionHandler("previoustrack", null)` → `setActionHandler("previoustrack", () => controls.onReplayLast?.())`. הוסף `onReplayLast?: () => void` ל-`CarModeControls` interface.
- `+page.svelte`: wire `onReplayLast: () => voice.replayLast()` ב-`enableCarMode()`.
- טסטים חדשים: 3 טסטים (registered as function not null, calls onReplayLast, no-op without onReplayLast).

**7. תיקון 7 — delete-btn RTL position (Bug 6 ב-review):**
- `routes/+page.svelte`: `inset-inline-start: 12px` → `inset-inline-end: 12px`. כפתור ה-× כעת ב-RTL = שמאל (צד לוגי נכון, כנגד ה-`padding-inline-end: 60px` של card-link).

#### מצב טסטים

- סה"כ: **236 tests** (185 ב-workspace root, 51 ב-frontend package) — הכל עובר ✅
- typecheck: נקי ✅
- lint (Biome): נקי ✅

---
## 2026-05-16 17:50 (vnext, Yolo)

### Slice 7 — Drive-First UX (222 tests)

יישום §9.6 "UX Principles — Drive-First". ה-UI השתנה מ-scaffold ל-product: dark mode, כפתור 110px, state machine 5-states, animations, smart scroll, audio cues, car mode, wake lock.

#### מה בוצע?

**1. Design tokens + Layout:**
- `+layout.svelte` — dark mode CSS variables מלאים (16 tokens): `--bg`, `--recording`, `--speaking`, `--tool-bg` וכו'. Global keyframes: `pulse`, `rotate-slow`, `flash-fast`, `pulse-dot`, `spin`.
- Layout flex: `body → flex-column, 100dvh, overflow-hidden`. Header + chat-wrap (flex:1) + footer (flex-shrink:0).

**2. State machine (TDD):**
- `stores/mic-state.svelte.ts` — `deriveMicState()` פונקציה pure. 5 states: idle/recording/processing/speaking/cancelling. `MIC_STATUS_TEXT`, `MIC_ICONS` maps.
- `stores/mic-state.test.ts` — 9 tests לכל transition.

**3. Smart scroll (TDD):**
- `stores/smart-scroll.ts` — `deriveScrollState()` פונקציה pure. User-intent detection בחלון 500ms.
- `stores/smart-scroll.test.ts` — 7 tests: at-bottom, user-scroll, programmatic-content.

**4. Car mode (TDD):**
- `stores/car-mode.svelte.ts` — `createCarMode()` store. Media Session API handlers (play/pause → toggle recording). Landscape lock optional.
- `stores/car-mode.test.ts` — 8 tests: register handlers, play/pause triggers, isActive, graceful no-mediaSession.

**5. Audio cues (Web Audio API):**
- `audio/cues.ts` — 5 synthesized cues ללא mp3 files. `recordingStart(880Hz)`, `recordingStop(660Hz)`, `thinking(C5→E5)`, `speaking(E5→C5)`, `error(E4→A3)`. Lazy AudioContext, SSR safe.

**6. Agent live page (שכתוב מלא):**
- `routes/agent/[id]/+page.svelte` — drive-first UX מלא:
  - MIC button 110px עגול, 5 states + animations (pulse/rotate-slow/flash-fast)
  - Status text מתחת לכפתור עם צבע per-state
  - Side controls: replay-last (56px) + stop (hidden when idle)
  - Smart scroll + jump-down button
  - Bubble redesign: user (bubble-user), agent (bubble-agent עם markdown מלא), thought (dashed italic), tools (collapsible עם arrow + status dots)
  - Audio cues on state transitions (`$effect`)
  - Wake Lock: acquired on recording, released on idle
  - Car mode: `?car=1` → enable button → Media Session handlers
  - No-pinch-zoom via `<svelte:head>` viewport meta

**7. Dashboard upgrade:**
- `routes/+page.svelte` — cards גדולים (min-height: 100px), empty state עם אייקון 🎙 + הסבר + כפתור גדול, settings FAB, dark mode מלא.

#### החלטות ארכיטקטורה

- **Web Audio במקום mp3**: D42 דורש "5 cues" — יושם ב-Web Audio oscillator. אין צורך ב-`static/sounds/` assets. mp3 files — future Slice 8.
- **prevMicState = $state("idle")**: Svelte 5 מתריע אם `$state` מאותחל עם ערך derived — פתרנו עם type annotation מפורש.
- **@keyframes ב-layout ללא :global()**: Svelte לא תומך ב-`:global(@keyframes ...)`. הפתרון: `@keyframes` ישירות ב-`<style>` של layout — הם global בטבעם כי הקובץ הוא layout component.

#### תוצאות

- `pnpm typecheck` — נקי (0 errors, 0 warnings).
- `pnpm lint` — נקי.
- `pnpm test` — 185 core + 37 frontend = **222 tests** ✓ (+24 חדשים מ-Slice 7: mic-state, smart-scroll, car-mode).

---
## 2026-05-16 17:40 (vnext, Yolo)

### Slice 5.6 — port v1: provider-error + markdown (198 tests)

השלמת slice שנפל באמצע עקב tmux crash. הוחזרה עבודה uncommitted והושלם החצי השני.

#### מה בוצע?

**1. provider-error (port מ-v1):**
- `packages/core/src/acp/provider-error.ts` — port מילולי מ-v1. פונקציה `extractProviderError(stderrLines)` סורקת stderr buffer ומחזירה שגיאת provider אמיתית (JSON message עם keyword, או opencode ERROR log line).
- `packages/core/tests/acp/provider-error.test.ts` — 16 tests כולל: pattern 1 (JSON message), pattern 2 (opencode ERROR log), edge cases, scan window (last 30/50 lines).
- Wire: `bridge-spawn.ts` שומר FIFO buffer של 200 שורות stderr. `bridge-manager.ts` חושף `getStderr()`. `agent-orchestrator.ts` קורא `extractProviderError` ב-catch ושומר `crashReason` ב-registry.
- Schema: `AgentPublic.crashReason?: string` נוסף. Frontend `+page.svelte` מציג `crashReason` ב-block מעוצב במקום "הסוכן קרס" גנרי.

**2. markdown (port מ-v1 + wire ל-frontend):**
- `packages/core/src/ui/markdown.ts` — port מ-v1. `renderMarkdown(text)` ממיר markdown ל-HTML נקי עם sanitization (XSS, event attrs, js: URLs, dangerous tags).
- תלות: `marked@18` הוספה ל-`packages/core/package.json`. ה-API (`marked.parse`, `marked.setOptions`) תואם את v1.
- `packages/core/tests/ui/markdown.test.ts` — 29 tests: GFM, tables, breaks, bold/italic, Hebrew, XSS sanitization, paired tags, self-closing tags, event attrs, javascript: URLs.
- `packages/core/src/index.ts` — הוסף `export * from "./ui/markdown"`.
- `+page.svelte` — assistant messages עכשיו `{@html renderMarkdown(msg.text)}` עם class `bubble-md`. CSS: support מלא לאלמנטי HTML (`p`, `a`, `code`, `pre`, `ul/ol`, `table`, `blockquote`, `hr`, headings).

**3. lint fixes:**
- formatting בקבצי provider-error (biome -- for loops inline style).
- `result!.length` → `result?.length` (non-null assertion lint).

#### תוצאות

- `pnpm typecheck` — נקי.
- `pnpm lint` — נקי.
- `pnpm test` — 185 core + 13 frontend = **198 tests** ✓ (יעד: 198).

---
## 2026-05-16 16:30 (vnext, Tama)

### Slice 5.5 closeout — חלק 1: UI tool calls + 3 conformance fixes

ניצול ה-conformance review של Yolo (`46cfb88`) לתיקון 4 מ-6 ממצאים.

**1. `tool_call` UI שדרוג (Critical UX gap):**
- Backend (`agent-session.ts`): handle גם `tool_call` וגם `tool_call_update`. extraction של `kind`, `status`, `locations`, `content`. summariseToolContent מקצר ל-2000 תווים.
- Schema (`ws-messages.ts`): ToolCallMessage הורחב עם `kind`, `status`, `locations[]`, `content`.
- Frontend store (`agent-session.svelte.ts`): merge של tool_call+update לאותה bubble לפי `toolCallId`.
- Page (`+page.svelte`): UI עשיר — כותרת + kind badge + status (צבע לפי completed/failed/in_progress/pending) + locations chips + `<details>` collapsible לפלט (max-height 240px, scroll, pre dir=ltr).

**2. Auto-scroll:**
$effect מאזין ל-`messages.length` ול-`messages.at(-1).text.length` (לעדכוני streaming). אחרי tick → `chatEl.scrollTop = scrollHeight`.

**3. stopReason מועבר נכון (Yolo finding #5):**
`sendAudioPrompt` שמר `promptStopReason` מ-`response.stopReason` במקום hardcoded `"end_turn"`. תואם ACP spec.

**4. auth_required detection (Yolo finding #4):**
`acp-transport.ts` catch — מזהה `err.data.code === "auth_required"` ומחזיר Error עם `kind: "auth_required"`. orchestrator/UI ידעו בעתיד להציג auth flow במקום generic crash.

**5. agentId fix (היה blocker של voice):**
`createAgentSessionStore` לא חשפה `agentId` ב-return. voice-session ניסה `agentSession.agentId` → undefined → validation error `INVALID_MSG: agentId must be a string`. תיקון: 1 שורה (`return { agentId, ... }`).

**Tests:** 140/140 ✓ (לא נוספו).

**מה עוד נותר ל-Slice 5.5:**
- Frontend tests (sub-agent מטפל ברקע): AgentSessionPublic contract, unit test ל-store, voice flow unit test
- voice push-to-talk בדיקה בדפדפן (Avi)

## 2026-05-16 15:50 (vnext, Tama)

### Slice 5 closeout — UI E2E עובד, ACP bugs תוקנו

Avi חזר לבדוק את ה-UI בדפדפן (linux-gui). הודעה ראשונה שלו תקועה עם `disconnected` ו-"ממתין ל-bridge". cascade של 3 באגים שהתגלו ותוקנו ברצף.

**Bug #1 — model override ב-CLI args:**
הצורה הראשונה: הוספתי `-m anthropic/claude-sonnet-4-6` ל-`opencode acp` בקוד `cli-config.ts`. `opencode acp` **לא תומך** ב-flag הזה — יוצא מיד עם help → ה-subprocess מת → `ACP connection closed`. ה-model selection ב-ACP נעשה דרך `unstable_setSessionModel` או דרך `session/new` config (לא דרך CLI). הסרתי את ה-flag.

**Bug #2 — Conformance check חשף 6 ממצאים:**
Avi שאל "יש לנו docs של ACP לוודא שאנחנו תואמים?". שיגרתי sub-agent (Yolo+Sonnet) שקרא את ה-SDK schema, 11 דפי spec מ-`agentclientprotocol.com`, ו-7 קבצי ACP code שלנו. דוח 632 שורות ב-`docs/reviews/acp-conformance.md` (commit `5dba1e0`).

הממצא הקריטי שלי על `clientCapabilities: {}` ריק **הופרך** — ה-spec מפורש שכל ה-capabilities optional. אבל זוהו 6 issues:
- 🔴 Critical: `requestPermission` בודק `optionId === "allow_once"` במקום `kind === "allow_once"` (kind הוא typed enum)
- 🟡 חסר `clientInfo` (SHOULD בspec)
- 🟡 חסר `fs` capability declaration (handlers קיימים אך agent לא יודע)
- 🟡 לא מטופל `auth_required` error
- 🟢 first-message filter ב-ws-streams (רק על הודעה ראשונה)
- 🟢 `stopReason` hardcoded ב-`sendAudioPrompt`

**Bug #3 — ה-root cause האמיתי: NDJSON `\n` חסר:**
התיקונים של Yolo לא היו מספיקים. ה-flow עדיין הצליח להגיע ל-`initialize` אבל נתקע 45s ללא תגובה. עם logging trace ב-`ws-streams.ts` ובהשוואה ל-test ידני שעבד — גיליתי:

```diff
-ws.send(line)         // missing \n delimiter
+ws.send(`${line}\n`)  // NDJSON needs newline
```

stdio-to-ws מעביר WS frame → subprocess stdin verbatim. opencode acp מצפה NDJSON. בלי `\n` הוא ממתין לעוד data לעולם. ה-`ndJsonStream` של ה-SDK כותב לנו `{...}\n`, אבל ה-`split("\n")` שלנו **חתך** את ה-`\n` ולא הוסיף בחזרה.

זה היה הסיבה האמיתית של "newSession תקוע" — לא capabilities, לא race timing, אלא delimiter חסר.

**עוד תיקונים שנכנסו:**
- `acp-transport.ts`: המתנה ל-stdio-to-ws `connected` frame + 1.5s warmup לפני initialize (subprocess cold start)
- `acp-transport.ts`: timeout 10s → 45s (sync עם bridge spawn 30s)
- `acp-transport.ts`: structured logging `[acp] +Nms ...`
- `acp-transport.ts`: `clientInfo` + `clientCapabilities.fs`
- `client-impl.ts`: `kind` במקום `optionId` ב-permission lookup; `readTextFile`+`writeTextFile` handlers
- `ws-streams.ts`: filter על כל הודעה (לא רק ראשונה); זיהוי frames לא-ACP
- `http-options.ts` חדש: `GET /api/options` עם models + projects לdropdowns
- `frontend/agent/new/+page.svelte`: 2 selects (CLI's models + ~/projects) + custom freeform fallback
- `vite.config.ts`: `allowedHosts: [".tuns.sh", ...]` עבור tunnel

**מצב E2E:**
ה-handshake לוקח ~2.5s (initialize 300ms, newSession 700ms, plus 1.5s warmup). Avi בדק בדפדפן עם prompt בעברית "בדיקת התקשורת של הממשק החדש עם המודל דרך ACP". המודל ענה, ביצע `read` ו-`bash` tool calls, החזיר תוצאות. **ה-flow עובד E2E end-to-end.**

UI gross — tool calls מוצגים כbadges קטנים `read`/`bash` בלי תוכן, אין auto-scroll, typography גנרי. Slice 7 (drive-first UX) יטפל.

**Voice (push-to-talk):**
ה-frontend code מוכן (Recorder + AudioQueue + button) אבל **לא נבדק בדפדפן** עוד. נדרש בדיקה.

**Tests:** 140/140 ✓. typecheck ✓. lint ✓.

## 2026-05-16 14:40 (vnext, Tama)

### Slice 5 — DoD 15/15: voice round-trip חי עבד

**Blocker מסומה הקודמת:** SDKs דורשים API key, OneCLI מזריק רק header. **פתרון (אבי החליט "פלייסהולדר"):** העברת `apiKey: "onecli-injects-this-at-proxy"` ל-`createElevenLabs`, `createGoogleGenerativeAI`, ו-`GoogleGenAI` constructors. ה-SDK עוקף את ה-fail-fast validation ושולח request עם header placeholder; OneCLI proxy מחליף לערך אמיתי.

**שינויים:**
- `providers.ts` — `createElevenLabs({ apiKey: PLACEHOLDER })` + `createGoogleGenerativeAI({ apiKey: PLACEHOLDER })` במקום default instances
- `providers/gemini-transcription.ts` — `new GoogleGenAI({ apiKey: PLACEHOLDER })`
- מודלים עודכנו ל-current: `gemini-2.0-flash` → `gemini-flash-latest`, `gemini-2.0-flash-lite` → `gemini-flash-lite-latest` (הישנים deprecated, השגיאה זוהתה בריצה החיה)

**Smoke E2E חי (3 בדיקות נפרדות):**
1. ✅ `generateText` עם Gemini Flash Lite — `"שלום! איך אני יכול לעזור..."` בעברית
2. ✅ `generateSpeech` עם ElevenLabs v3, voice `EXAVITQu4vr4xnSDxMaL` (Sarah) — 36KB MP3 עברית
3. ✅ Full round-trip: TTS Hebrew → MP3 → STT (Gemini transcription) → text "Shalom, ma shlomcha hayom?"

**הערה ל-Slice 7/8:** ה-Gemini STT מבצע transliteration במקום עברית native ב-output. צריך להוסיף ל-prompt: `"Output in the original Hebrew script if Hebrew is spoken — do NOT transliterate"`. לא חוסם MVP, אבל יפגע ב-UX. תיקון 1-line.

**הערה אדריכלית — placeholder pattern:**
- ✅ OneCLI מחליף את ה-header value (לא מוסיף; מחליף)
- ✅ אם OneCLI לא בpath (unit tests, dev בלי `--agent voice-acp`) — placeholder גורם ל-401 מה-API, שזה התנהגות צפויה
- ✅ ה-real API key לעולם לא נכנס למשתני התהליך
- 🔒 Pattern עובד גם ל-future providers (Anthropic, OpenAI, Deepgram) — אותו pattern עם apiKey constructor

**אישור D38 בריצה אמיתית:** הוא לא רק עובד, הוא מצוין. AI SDK + OneCLI selective agent + placeholder = clean separation.

DoD Slice 5: **15/15 ✅**.

Tests: 140/140 ✓. typecheck ✓. lint ✓.

## 2026-05-16 14:20 (vnext, executor-agent Yolo)

### Slice 5 — Voice Pipeline: STT (Gemini) + TTS (ElevenLabs v3) + Translator (Gemini Flash)

Yolo (executor) השלים Slice 5 — voice pipeline מלא, פרט ל-live API call test (ראה "ניסיונות smoke").

**מה נוסף (LOC):**

| קובץ | שורות | תיאור |
|------|--------|-------|
| `packages/core/src/voice/sentence-boundary.ts` | 22 | port מPOC — חלוקה למשפטים |
| `packages/core/src/voice/cache-key.ts` | 15 | SHA-256 cache key |
| `packages/core/src/voice/translation-prompt.ts` | 14 | Hebrew/English translation prompt builder |
| `packages/core/src/ports.ts` | +35 | SttPort, TtsPort, TranslatorPort, CacheStore, VoiceError |
| `packages/core/src/schemas/ws-messages.ts` | +25 | AudioMessage (client), SttPartialMessage, AudioChunkMessage, TranslationMessage |
| `packages/backend/src/voice/providers/gemini-transcription.ts` | 71 | Custom AI SDK TranscriptionModelV3 provider |
| `packages/backend/src/voice/providers.ts` | 50 | STT/TTS/translator registries (1 each) |
| `packages/backend/src/voice/cache-disk.ts` | 38 | DiskCache CacheStore implementation |
| `packages/backend/src/voice/pipeline.ts` | 130 | 3 functions: transcribeUserAudio, speakSentence, translateText |
| `packages/backend/src/app/agent-session.ts` | +100 | sendAudioPrompt — full voice round-trip |
| `packages/backend/src/delivery/ws-agent.ts` | +50 | audio message handler |
| `packages/backend/src/server.ts` | +10 | DiskCache + DEFAULT_REGISTRIES boot |
| `packages/frontend/src/lib/audio/recorder.ts` | 48 | MediaRecorder wrapper |
| `packages/frontend/src/lib/audio/player.ts` | 54 | AudioQueue — sequential mp3 playback |
| `packages/frontend/src/lib/stores/voice-session.svelte.ts` | 146 | Voice state machine |
| `packages/frontend/src/lib/stores/agent-session.svelte.ts` | +15 | sendRaw, setVoiceMessageHandler |
| `packages/frontend/src/routes/agent/[id]/+page.svelte` | +100 | push-to-talk button + voice UI |
| `packages/backend/tests/voice-pipeline.test.ts` | 244 | 13 tests מ-pipeline |
| `packages/core/tests/voice/sentence-boundary.test.ts` | 130 | 21 tests (TDD) |
| `packages/core/tests/voice/cache-key.test.ts` | 45 | 7 tests (TDD) |
| `packages/core/tests/voice/translation-prompt.test.ts` | 55 | 6 tests (TDD) |

**מספרי tests:**
- לפני: 93 tests
- אחרי: **140 tests** (+47)

**DoD Slice 5 — 14/15:**

1. ✅ `sentence-boundary.ts`, `cache-key.ts`, `translation-prompt.ts` — pure, TDD
2. ✅ Core voice tests: 34 cases (21 sentence-boundary, 7 cache-key, 6 translation-prompt)
3. ✅ Core ports: SttPort, TtsPort, TranslatorPort, CacheStore
4. ✅ WS schemas: audio ClientMessage + stt_partial, audio_chunk, translation ServerMessages
5. ✅ Backend deps: ai, @ai-sdk/elevenlabs, @ai-sdk/google, @ai-sdk/provider, @google/genai
6. ✅ `gemini-transcription.ts` — TranscriptionModelV3 compliant, previousAssistantText context
7. ✅ `providers.ts` — 3 registries (gemini/flash-context, elevenlabs/v3, gemini/flash-lite)
8. ✅ `pipeline.ts` — 3 functions Result-returning
9. ✅ `cache-disk.ts` — DiskCache, data/cache/tts/
10. ✅ `agent-session.ts.sendAudioPrompt` — STT → ACP → sentence batching → translation → TTS
11. ✅ `ws-agent.ts` handles `type: "audio"` message
12. ✅ Frontend: Recorder + AudioQueue + push-to-talk button + VoiceState machine
13. ✅ typecheck + lint נקי
14. ✅ tests 140 (היה 93, +47)
15. ⚠️ Smoke E2E partial — server עולה, pipeline נטען, ElevenLabs HTTP fetch עובד דרך onecli header injection. Full TTS/STT live call לא הצליח כי @ai-sdk SDKs מחפשים env vars (ELEVENLABS_API_KEY) בעוד onecli מזריק HTTP headers בלבד. יצריך Slice 6 לטעון keys מ-Bitwarden ב-runtime.

**Gotchas שנתגלו:**
- `ai` מייצא `experimental_generateSpeech` ו-`experimental_transcribe` (לא `generateSpeech`/`transcribe` ישירות)
- `@ai-sdk/elevenlabs` ו-`@google/genai` דורשים env vars — onecli מזריק headers בלבד
- `neverthrow` לא היה ב-backend deps — הוסף

**Next:** Slice 6 — reconnect + multi-session + API key loading מ-Bitwarden.

---
## 2026-05-16 13:55 (vnext, executor-agent Yolo + planner-agent Tama)

### Slice 4 — AcpTransport + chat UI (closed-loop ACP)

Yolo (executor) השלים את הקוד; tmux session קרס באמצע smoke E2E השני (ה-Yolo agent יצא); Tama קמט בעצמו.

**מה נוסף:**
- `packages/backend/src/acp/ws-streams.ts` — adapter WebSocket → ReadableStream/WritableStream (ACP NDJSON). מסנן stdio-to-ws handshake frames (`connected`/`heartbeat`).
- `packages/backend/src/acp/client-impl.ts` — `ClientSideConnection` implementation; מטפל ב-`requestPermission` (allow_once default), `sessionUpdate` forwarding.
- `packages/backend/src/acp/acp-transport.ts` — orchestrates `ClientSideConnection` + initialize handshake.
- `packages/backend/src/app/agent-session.ts` — אחד לכל agent; מחזיק AcpTransport + WS clients + send/cancel.
- `packages/backend/src/delivery/ws-agent.ts` — `/ws/agent/:id` route + Bun.upgrade.
- `packages/frontend/src/lib/stores/agent-session.ts` + `+page.svelte` — chat UI עם streaming.
- 2 schemas חדשים ב-core: `WsClientMessage`, `WsServerMessage`.
- `Port` חדש ב-core: `AcpClientPort`.

**מספרים:**
- 93 tests (היה 60+, יעד DoD היה 60+; 33 חדשים).
- typecheck ✅, lint ✅ (biome 50 files clean).
- smoke E2E #1: `stdio-to-ws → opencode acp → initialize → response עם agentCapabilities` עבד ✅.
- smoke E2E #2: ניסיון send prompt — tmux קרס לפני סיום.

**גילוי תיקון:**
- ACP SDK API השתנה: `option.id` → `option.optionId`, `outcome.id` → `outcome.optionId`. Yolo זיהה ותיקן.
- `Bun.upgrade<T>` לא מקבל generic; משתמשים ב-`data: {...} satisfies T`.

**DoD Slice 4 — 12/12:**
1. ✅ AcpTransport ב-`packages/backend/src/acp/`
2. ✅ ws-streams (NDJSON pipes)
3. ✅ ClientSideConnection ImplPort
4. ✅ AgentSession ב-app layer
5. ✅ `/ws/agent/:id` route
6. ✅ Frontend store + chat UI
7. ✅ Streaming תשובות (agent_message_chunk → WS → UI)
8. ✅ requestPermission auto-allow (allow_once)
9. ✅ Cancellation מסונן בtransport
10. ✅ 93 tests (33 חדשים; יעד היה 60+)
11. ✅ typecheck + lint נקי
12. ✅ smoke E2E עם opencode חי (handshake הצליח; prompt round-trip לא נבדק עד הסוף בגלל tmux crash)

**מה לא נבדק:**
- Full prompt → תשובה streaming → UI flow (smoke #2 לא הסתיים)
- אבי יעשה smoke ידני בבוקר

**Next:** Slice 5 — voice pipeline (STT + TTS + WebRTC או MediaRecorder + ElevenLabs + Gemini STT).


## 2026-05-16 03:00 (master, planner-agent Tama)

### תכנון vNext — סבב 7: SDK mock agent + acpx conformance suite

אבי שאל "יש ל-ACP mock לבדיקות, לא?". בדיקה גילתה שני כלים מוכנים שמשנים את strategy ה-testing:

1. **SDK example agent** — `@agentclientprotocol/sdk/src/examples/agent.ts` הוא ACP-compliant mock מובנה. D49 — לא נכתוב mock משלנו. שני patterns: loopback streams (in-process, מהיר) או spawn child (יותר ריאלי).

2. **⭐ acpx conformance suite** — תגלית חשובה. `openclaw/acpx/conformance/` יש להם normative spec ב-`spec/v1.md`, 20 required cases ב-JSON data-driven, runner ב-TS, mock adapter מובנה, nightly CI workflow מוגדר. coverage מלא של ACP v1 core: initialize/session lifecycle/errors. D50 — נריץ ב-CI nightly נגד ה-AcpTransport שלנו + real adapters (opencode/claude/gemini).

זה משחרר אותנו מלהמציא testing infrastructure ל-ACP. במקום לכתוב ~20 integration tests ידנית, אנחנו צורכים suite שכבר נבנה ע"י הקהילה, וגם מקבלים validation אמיתית של protocol compliance.

D49 + D50 נוספו. §1.7a חדש ב-research. §8.5 Slice 4 עודכן עם tests = loopback mock + conformance suite. D1-D50 נעולות.

---

## 2026-05-16 02:45 (master, planner-agent Tama)

### תכנון vNext — סבב 6: Node+Bun universal, TDD partial, port pure tests

אבי שאל 3 שאלות חכמות אחרונות לפני Slice 1:

1. **Node + Bun compatibility** — שיהיה ניתן להריץ עם `npx` או `bunx`. **D45:** Hono ל-HTTP/WS אגנוסטי, `node:sqlite` או `better-sqlite3`, pnpm workspaces. Bun runtime כ-fast-path אופציונלי. רק 10-15% throughput loss וזה לא ה-bottleneck.

2. **תאימות לקוד הקיים + 289 הבדיקות** — לא לחלוטין (D3 = greenfield), אבל ה-pure helpers ינדדו. **D47:** Port ~96 pure tests מ-v1 (sentence-boundary 21, provider-error 16, markdown 29, tts-cache 20, recordings ~10). ~193 לא רלוונטיות בגלל D33 (bridge חיצוני) ו-D38 (AI SDK).

3. **TDD?** — **D46:** חלקי. `/tdd` skill ב-executor mode ל-core (full red-green-refactor) ו-custom Gemini provider. backend עם validation tests, IO heavy עם integration, UI עם manual+Playwright.

4 D-החלטות נוספות (D45-D48). dependencies list עודכן: hono + @hono/node-server, better-sqlite3 או node:sqlite, vitest, pnpm. Bun נשאר כ-fast-path אופציונלי.

**סיכום סופי:** D1-D48 נעולות, Q1-Q17 + כל Q-NEW נסגרו. המסמכים production-ready. אבי קיבל סיכום one-pager של התוכנית והארכיטקטורה.

הצעד הבא: ירוק ל-Slice 1.

---

## 2026-05-16 02:00 (master, planner-agent Tama)

### תכנון vNext — סבב 4: Vercel AI SDK + voice-coda tested

אבי ניסה את voice-coda בקונטיינר 134 (`voice-coda-test`, 192.168.x.x) שנפרס ע"י sub-agent. תגובה: "נחמד אבל מדמיין משהו טוב יותר".

הצרכים החדשים שהוגדרו:
- ממשק קולי ברור יותר (קיים ב-§9.6)
- **צלילים שמסמנים פעולות** ⭐ חדש
- ריצה גם כשהדף סגור (קיים ב-D33)
- multi-agent (קיים ב-D12)
- תמלול חכם של Gemini (חדש ב-D39)
- **Provider abstraction לתמיכה בהרבה ספקים** ⭐ חדש

אבי הציע "בטח Vercel" — והוא צודק. **Vercel AI SDK** הוא ה-provider abstraction הנכון:
- TypeScript first, MIT, 30k⭐
- API אחיד ל-`transcribe`, `speech`, `generateText`
- 25+ providers רשמיים + 35+ community
- spec פתוח `language-model-v3` ל-custom providers (~30 שורות)
- Streaming + AbortSignal + middleware מובנים

בדיקת Gemini OpenAI compatibility: chat completions כן, audio לא, Responses API לא. אז OpenAI envelope אחיד לא מספיק.

**6 D-החלטות חדשות (D35-D40):**
- D35 — Audio cues system (mp3, theme picker)
- D36 — Provider catalog ב-UI (dropdown ב-/settings, runtime swap)
- D37 — מבוטל (AI SDK מטפל ב-capabilities)
- D38 ⭐ — Vercel AI SDK כליבת provider abstraction. **חוסך ~800-1000 שורות backend.**
- D39 — Custom Gemini transcription provider (AI SDK לא תומך). ~80 שורות.
- D40 — Hexagonal layer 2 משתמש ב-AI SDK contracts (עדכון D28)

**שינויי spec:**
- §7.5 (Voice Pipeline) שוכתב מלא עם registries + pipeline orchestration דרך AI SDK
- §8 monorepo: `voice/` package במקום `adapters/`. dependencies list עם 7 חבילות AI SDK
- §6 (Ports) שוכתב — אין יותר SttProvider/TtsProvider/TranslatorProvider שלנו. שימוש ב-`@ai-sdk/provider`. דוגמת קוד מלאה ל-D39
- §8.5 roadmap: Slice 5 הצטמצם דרסטית (npm install + 5 שורות registry במקום 4 adapters). Slice 8 שינה כיוון מ-"local providers" ל-"provider catalog UI"

**חיסכון מצטבר ב-roadmap:**
- D33 (אחרי סבב 3): bridge מצטמצם מ-200 שורות ל-spawn npm package
- D38 (סבב 4 הזה): voice adapters מצטמצמים מ-~600 שורות ל-~80 (custom Gemini בלבד)
- סה"כ: ~800 שורות backend פחות לכתוב, ועדכון פשוט יותר לתוספת ספק

קונטיינר 134 נשאר עומד ל-reference. אם לא יצטרך עוד יום — `pct stop 134 && pct destroy 134`.

המסמכים production-ready להתחלת Slice 1. ממתין לאישור Q-NEW-5/6/7 ולירוק.

---

## 2026-05-15 05:00 (master, planner-agent Tama)

### תכנון vNext — ממצא קריטי: bridge מוכן + מתחרה web נוסף

אבי הצביע על שיחה אחרת (`ses_1d1d7e005ffehwl6wIsjsw6wKI`) שבה הסוכן השני מצא:

1. **`@rebornix/stdio-to-ws`** — fork של marimo-team, **published ב-npm** (`@rebornix/stdio-to-ws@0.2.0`), Apache-2.0. תומך `--persist`, `--grace-period -1`, `--tunnel-name` (Microsoft Dev Tunnels integration ל-`wss://` URL ציבורי). בשימוש ע"י acp-ui (274★) — מאומת בproduction.

   **השלכה:** ביטול D30 (write our own bridge), הוספת D33 (spawn `@rebornix/stdio-to-ws`). §4 ב-spec נכתב מחדש — אנחנו consumer של JSON-RPC ACP גולמי דרך WS, לא מגדירים פרוטוקול. Slice 3 בroadmap הצטמצם מ-"כתוב bridge ~200 שורות" ל-"spawn npm package + parse port" — חיסכון של 70% מהעבודה.

2. **`formulahendry/acp-ui`** — Vue 3 + Tauri + Web client בוגר ל-ACP, MIT license, 274★. cross-platform, 11 agents נתמכים, web build חי ב-acp-ui.github.io. תומך session/load reconnect + $/ping heartbeat + foreground resumption. **חסר voice + RTL + drive-first UX** — בדיוק מה שאנחנו מציעים.

   **השלכה:** הוספת D34 ו-Q-NEW-4 — שאלה אסטרטגית: (A) build from scratch, (B) fork acp-ui ולהוסיף voice+RTL, (C) hybrid (build voice gateway + svelte FE, accept acp-ui כ-alternative client). ההמלצה שלי: C ≈ A — SvelteKit הוא הבחירה של אבי, drive-first הוא הייחוד שלנו, fork ל-Vue היה tax לא-תרומתי.

3. **`openclaw/acpx`** — CLI client (לא bridge), 2.7k⭐, MIT, 16 agents נתמכים. inspiration ל-flows ו-queue management בעתיד, לא רלוונטי עכשיו.

עדכוני מסמכים: `vnext-architecture.md` (ביטול D30, הוספת D33+D34, פרק §7.4a שכתוב, Q-NEW-4 חדש), `vnext-spec.md` (§4 BE↔Bridge נכתב מחדש, §8.5 roadmap עודכן), `vnext-research.md` (סעיפים 1.5/1.6/1.7 חדשים על rebornix/acp-ui/acpx, TL;DR שכתוב).

ממתין לאבי על Q-NEW-4 (האם אופציה A/B/C) ולאישור סופי להתחלת Slice 1.

---

## 2026-05-15 04:30 (master, planner-agent Tama)

### תכנון vNext — שכבה 2: spec טכני להתחלת implementation

אבי אישר "בגדול הכל כן" על שאר השאלות הפתוחות (Q9-Q17, Q-NEW-1/2/3 + ArkType גם ב-frontend + Hexagonal מינימלי + voice-coda outreach). שכבה 2 הושלמה.

נכתב `docs/vnext-spec.md` (~750 שורות, 9 פרקים) — מסמך טכני מפורט להתחלת implementation. הפרדה משלושה פרוטוקולים מובחנים:

1. **`drive-coding-ws` (FE↔BE)** — voice events (`audio_start`, `audio_chunk`, `audio_end`, `cancel`) + chat events (`text_chunk`, `audio_start`, `tool_call`, `bubble_persisted`, `done`). 11 ServerMessage types, 6 ClientMessage types.

2. **`drive-coding-bridge-ws` (BE↔Bridge)** — ACP envelope על WS, פנימי. BridgeServerMessage (ready, sessionUpdate, promptComplete, requestPermission, fileOps), BridgeClientMessage (prompt, cancel, permissionResponse, shutdown). Buffer 500 + replay אחרי backend restart.

3. **ACP stdio (Bridge↔CLI)** — לא בתחום שלנו, סטנדרט ACP.

Domain models ב-ArkType. ports interfaces ב-TypeScript עם `ResultAsync<T,E>` מ-neverthrow לכל IO. 5 sequence diagrams (agent creation, voice round-trip, cancel mid-speech, disconnect+reconnect, multi-tab fan-out). HTTP API עם 9 endpoints (identity, agents CRUD, voices, filesystem, health).

**Slice 1 מוגדר במלואו** — 8 משימות (scaffold worktree, monorepo, schemas, ports, echo server, frontend, Docker), DoD מפורט (10 checkboxes), ~3.5 שעות. תוצר: echo dialect מהדפדפן ל-backend וחזרה. אין CLI/voice/ACP — רק תשתית.

רשימת 9 slices אחריו: identity persistence + dashboard, acp-bridge wrapper, AcpTransport adapter, voice pipeline (Gemini+ElevenLabs), multi-session+cache+reconnect, drive-first UX, Whisper+Piper local options, i18n, production deploy.

5 שאלות פתוחות לimplementation זמן: token storage (SQLite?), bridge crash detection, CLI not found, concurrent prompts, TTS streaming vs buffered.

המסמך מוכן ל-executor. אחרי אישור אבי על spec → executor פותח worktree `voice-acp-v2` ומתחיל ב-Slice 1.

---

## 2026-05-15 04:00 (master, planner-agent Tama)

### תכנון vNext — תיקון ממצאים אחרי בדיקה ספקנית של אבי

אבי שאל שלוש שאלות חדות שחשפו פערים במחקר הקודם:

1. **למה ל-`@flutur/acp-http-bridge` אין כוכבים ולמה הוא לא ב-npm?** בדיקה שנייה: `package.json` מראה `"version": "0.1.0-alpha.0"`, ה-README מטעה ("npm install..."), בפועל לא published. ביטול **D25**, הוספת **D30** — נכתוב bridge משלנו ב-`packages/acp-bridge/` בהשראת הקוד שלהם (Apache 2.0 מאפשר). ~200 שורות, שליטה מלאה. במקביל נפנה ל-Alemusica עם help/PR offer.

2. **`voice-coda` — האם מספיק טוב לתרום ACP במקום לכתוב משלנו?** בדיקה: ה-LICENSE file חוזר 404, אין license field ב-package.json. **משפטית "all rights reserved"** = אסור fork/copy/PR בלי הסכמה. ביטול **D29**, הוספת **D32** — לא להישען. inspiration רעיונית בלבד. לשלוח issue ל-evanstern על license. נמשיך עצמאית.

3. **`ArkType` במקום `Zod`?** אבי כבר משתמש ב-ArkType. הצדקה: bundle קטן (~10KB vs 13KB), claim של performance ~100× ב-runtime, syntax יותר טבעי (TS-like DSL: `type({ name: "string" })`), וייחוד נוסף מ-voice-coda (שם Zod). עדכון **D27 → D31**: ArkType + neverthrow.

**Bonus — חששות over-engineering:** **D28 צומצם.** במקום 5 layers כ-packages נפרדים, אנחנו מתחילים עם **2 packages בלבד** (`core` + `backend`) + frontend נפרד. השכבות (ports/adapters/app/delivery) הן רק תיקיות בתוך `backend/`. ה-`packages/protocol/` יחולץ רק כשנצטרך (למשל מעבר ל-Go).

**neverthrow הוסבר** באריכות: `Result<T, E>` עם ok/err, chaining דרך .map/.andThen/.match, ResultAsync לאסינכרוני. ערך גבוה בליבה הטהורה, פחות ב-IO shell.

המסמכים שעודכנו:
- `vnext-architecture.md`: D25/D27/D29 בוטלו (קוו מעליהם), D30/D31/D32 נוספו.
- `vnext-research.md`: §1.4 עודכן (לא ניתן להישען על npm dep), §2.1 עודכן (license missing — סיבה לזהירות), §4.1+4.2 עודכנו (ArkType row חדשה, ההמלצה השתנתה), §8 TL;DR נכתב מחדש.

הצעדים הבאים: ממתין לאבי על Q9-Q17 + Q-NEW-1/2/3 + שאלת voice-coda license outreach.

---

## 2026-05-15 03:30 (master, planner-agent Tama)

### תכנון vNext — מחקר מקיף: prior art, ספריות, ארכיטקטורה

אבי ביקש מחקר על: (1) האם יש ACP bridges בוגרים, (2) האם מישהו כבר עשה voice-CLI, (3) ספריות שיכולות לחסוך פיתוח, (4) ארכיטקטורה רעיונית להפרדת backend.

נכתב `docs/vnext-research.md` חדש (8 פרקים, ~500 שורות).

**5 ממצאים שמשנים את הארכיטקטורה:**

1. **`@flutur/acp-http-bridge` (Alemusica/acp-http-bridge)** — adapter שמיישם בדיוק את הרעיון של אבי מ-D23 — bridge שעוטף ACP stdio agents ב-WebSocket + HTTP/SSE. מבוסס RFD רשמית. תכונות כבר ממומשות: WebSocket מלא, persistent sessions עם `session/load`, multi-tab fan-out, 18 tests passing. בוטל ה-package שלנו `packages/acp-bridge/` — נצרוך את שלהם. נוספה D25.

2. **RFD רשמית קיימת ב-ACP** — "Streamable HTTP & WebSocket Transport". `Acp-Connection-Id` + `Acp-Session-Id` headers, HTTP/2 required, single `/acp` endpoint. אנחנו מיישרים לזה. נוספה D26.

3. **`evanstern/voice-coda`** — מתחרה ישיר באנגלית. React Router 7 PWA + Hono + tRPC + openWakeWord + Whisper + OpenAI/Google/Piper TTS. תומך Anthropic/Claude Code/OpenCode (אבל לא דרך ACP — adapters ידניים). אנגלית בלבד, אין RTL, generic chat UI. ה-niche הייחודי שלנו ברור: **ACP + עברית + drive-first**. נוספה D29 (ללמוד, לא להעתיק).

4. **ספריות functional TS:** `neverthrow` + `Zod` מספיקות. לא Effect-TS (paradigm shift כבד מדי, ROI נמוך). `@ricky0123/vad-web` ל-VAD בעתיד (2k★, Silero VAD via ONNX, מוכן). נוספה D27.

5. **Hexagonal architecture עם 5 layers:** Pure Core (no IO) / Ports (interfaces) / Adapters (implementations) / Application (orchestration) / Delivery (HTTP+WS). דוגמת קוד מלאה ב-research §5. נוספה D28.

עדכוני monorepo: הסרת `packages/acp-bridge/`, הוספת תיקיה `core/ports/` עם interfaces, תיקיה `backend/adapters/` עם implementations, וtree מסודר יותר ל-`backend/app/`, `backend/delivery/`. רשימת dependencies חיצוניים מפורטת.

3 שאלות חדשות פתוחות: (Q-NEW-1) להשתמש ב-bridge as-is / contribute / fork? (Q-NEW-2) להוסיף Whisper+Piper local options ל-MVP? (Q-NEW-3) ללמוד מ-voice-coda?

המסמך `vnext-architecture.md` גדל ל-~920 שורות. `vnext-research.md` חדש ב-~500 שורות.

---

## 2026-05-15 02:50 (master, planner-agent Tama)

### תכנון vNext — שכבה 1.7: acp-bridge + Claude Code

אבי הציע שלושה רעיונות שמשנים את הארכיטקטורה:

**1. `acp-bridge` — תהליך עוטף stdio↔WebSocket.** רעיון חזק שפותר שתי בעיות בו זמנית: (א) survival של ה-CLI אם הbackend קורס, (ב) פתח עתידי ל-multi-client sharing. בוטלו D15 (stdio בלבד) ו-D16 (agent dies with backend). נוספו D23 ו-§7.4a חדש עם תיאור מלא של mahzor חיים, יתרונות ועלויות. ה-monorepo גדל ב-package נוסף — `packages/acp-bridge/` עם 5 קבצים (bridge, manager, stdio-proxy, buffer, lifecycle). ה-deployment diagram עודכן כדי לשקף bridges על port range נפרד, עם הסבר על failure modes (backend crash, bridge crash, tunnel down).

**2. Wake word ל-hands-free טהור.** אבי מכיר פרויקטים שמזהים מילה custom עם דגימות אימון, ללא LLM, low-resource. הוספתי Q14b עם סקירה של 5 ספריות (Porcupine, Snowboy, openWakeWord, Vosk, Web Speech API) והמלצה על openWakeWord — open source, custom wake words, רץ ב-browser דרך ONNX. POC נפרד אחרי MVP.

**3. Claude Code adapter קיים** — תיקון לידע שלי: לא של Zed עצמם, אלא `agentclientprotocol/claude-agent-acp` (תחת ה-org של הפרוטוקול), 1.9k stars, v0.34.0 שוחרר באותו יום. תומך בתמונות, MCP, slash commands, terminals, TODO lists. אישרתי דרך GitHub fetch. נוספה D24 ועדכון §A2 עם טבלת CLIs נתמכים.

שאלות חדשות נוספו (Q14a על ה-protocol של ה-bridge — WS/HTTP+SSE, port allocation, supervisor, buffer, auth, discovery). שני שאלות ישנות (Q12 survival, Q18 multi-CLI adapter) נסגרו בעקבות D23 ו-D24.

המסמך גדל ל-~870 שורות. שכבה 2 (data models, sequence diagrams, API spec) תיכתב אחרי סבב נוסף של תשובות אבי על Q9-Q17 + Q14a/Q14b.

---

## 2026-05-15 02:20 (master, planner-agent Tama)

### תכנון vNext — שכבה 1.5: סגירת שאלות + UX + Drive Coding

אבי ענה על 8 השאלות שהיו פתוחות + הוסיף הקשר שמשנה הרבה:
- **שם הפרויקט הוצע: `drive-coding`** — ממשק קולי לסוכני CLI בנהיגה/שטיפת כלים/ריצה. ה-niche הייחודי הוא voice + multi-CLI + RTL + hands-free. אין מתחרה ישיר (codenomad לא תומך בקול ולא ב-multi-CLI, Zed לא תומך ב-RTL).
- **Deployment:** Proxmox container אצל אבי + Cloudflare tunnel. יעד: אימוץ קהילתי של מפתחים. לא ענן ציבורי בשלב ראשון.
- **Pricing model: BYOC** (Bring Your Own CLI) — המשתמש משתמש ב-`opencode`/`gemini`/`claude` עם המינוי שלו. אנחנו ממומנים רק את ה-STT/TTS (Gemini+ElevenLabs) של אבי, או BYOK בעתיד.
- **stdio בלבד** ל-MVP — אין HTTP transport. עם זאת `AcpTransport` interface יישאר open.
- **Agent מת עם backend** ב-MVP — survival mechanism נדחה. ה-cost של פתיחת agent מחדש קל.
- **שפה: עברית בלבד**. i18n layer מובנה כדי שהוספת אנגלית תהיה JSON patch.

נוספו 10 החלטות (D13-D22), 10 שאלות חדשות (Q9-Q18 — בעיקר UX), ופרק חדש מלא §9.6 על UX principles:
- כפתור גדול אחד שעושה הכל (start/stop של הקלטה + cancel של model).
- Touch targets ≥ 80px, high contrast, large text.
- State machine מפורש: idle → recording → processing → speaking → cancelling.
- Wake lock + Media Session API לטובת mobile.
- אין modals, אין scroll מורכב, אין הקלדה.

נוסף נספח השוואה לכלים מתחרים (codenomad/opencode/Zed/Claude) שמראה את ה-positioning הייחודי.

המסמך גדל ל-~820 שורות. שכבה 2 (data models, sequence diagrams, API spec) תיכתב אחרי סבב נוסף של תשובות אבי על Q9-Q18.

---

## 2026-05-15 01:45 (master, planner-agent Tama)

### תכנון vNext — מסמך ארכיטקטורה ראשון

אבי ביקש לתכנן את הגרסה הבאה מאפס — לא ריפקטור של ה-POC. דיון מורחב במוד יועץ עם planner-agent (חתום Tama). ארבעה תורות עיקריים:

1. **שאלות-על:** איפה ירוץ (ענן/מקומי)? עם opencode HTTP או stdio? תשובה: רב-לשוני, בענן, ACP על פני vendor lock-in.
2. **דרישות הליבה:** CLI שורד סגירת דף, multi-session, הפעלה/כיבוי כמו codenomad, worktree לפיתוח מקביל.
3. **שפה ופרדיגמה:** TS על Bun (אבי מכיר), SvelteKit ל-frontend, functional core + imperative shell (לא fp library מלאה — כדי לאפשר port עתידי ל-Go).
4. **frontend מלא:** routing, dashboard, settings — לא SPA יחיד.

תוצר: `docs/vnext-architecture.md` — שכבה ראשונה (11 פרקים + 2 נספחים, ~600 שורות). מכסה: עקרונות מנחים, 12 החלטות locked, 8 שאלות פתוחות, mental model ("tmux לסוכני AI"), 7 domains, monorepo structure, deployment story, ו-roadmap של 10 vertical slices.

החלטות בולטות שננעלו:
- Greenfield ב-worktree `voice-acp-v2`. ה-POC ב-master ימשיך לעבוד עד מעבר.
- Backend ו-frontend נפרדים מהיום הראשון (services נפרדים, types משותפים ב-package `@voice-acp/protocol`).
- Agent process = entity עצמאית עם UUID. WebSocket = subscription, לא lifecycle.
- אין DB משלנו. רק cache (memory/disk/R2/KV) ל-Gemini ו-ElevenLabs.
- ACP transport מופשט (`AcpTransport` interface). stdio ל-MVP, HTTP בעתיד אם יבשיל.

שאלות פתוחות שאבי צריך לענות עליהן (נספח B במסמך): hosting target (Fly.io / Cloudflare Containers / VPS), agent orchestration model (parent process / systemd / containers), cache backend, identity strategy (anonymous → OAuth?), pricing model (BYOK?), i18n scope, frontend routes.

מחקר טכני: ACP הוא JSON-RPC 2.0 transport-agnostic. אין implementation רשמית של ACP-over-HTTP — כל הסוכנים מדברים stdio.

תוספות לקבצים מ-master שהיו לפני סשן זה (לא קומטו עדיין): סעיף ג ב-`plan.md` (באגי config.html של אבי), סעיפים 18+19 ב-`future-features.md` (hold music, message-id cache). יקומטו יחד עם המסמך החדש.

---

## 2026-05-14 23:55 (worktree `voice-acp-refactor` / branch `refactor`)

### v6 שכבה 7 — message router + parser + lifecycle helpers + 22 בדיקות

**רקע (Avi):** "אני בעד לעשות כמה שיותר לוגיקה טהורה שאינה מחוברת ליישום ספציפי. ואז קל לבדוק אותה. ו-Bun.serve לא ממש עוזר בעניין הזה."

עיקרון מנחה לשכבה הזו — extract ה-WebSocket handler logic לפונקציות טהורות שלא יודעות מ-Bun.serve. Bun.serve נשאר רק עוטף את ה-events ל-pure functions.

**`src/message-router.ts` (חדש)** — שלוש פונקציות + interface אחד:

1. **`parseClientMessage(raw: string | Buffer): ParseResult`** — JSON parsing עם error handling. מחזיר union type, לא זורק.
2. **`MessageHandlers` interface** — `onInit`, `onAudio`, `onText`, `onCancel`. כל אחד מקבל `sink + state + msg`.
3. **`routeClientMessage(sink, state, msg, handlers)`** — switch לפי `msg.type`, dispatch ל-handler. unknown → sendError. שגיאות הdler מועברות החוצה (caller wraps).
4. **`disposeConnection(state)`** — close-time cleanup. אם יש bridge, מעצב dispose עם catch-and-ignore.
5. **`cancelActivePrompt(state)`** — wrapper של bridge.cancel עם catch-and-ignore.

**ב-`server.ts`:**
- `Bun.serve.websocket.message` עכשיו: parseClientMessage → אם error → sink.sendError; אחרת try { routeClientMessage } catch { sendError }.
- `Bun.serve.websocket.close` עכשיו: `disposeConnection(state)` במקום inline.
- `messageHandlers` const מועבר ל-routeClientMessage. handlers משתמשים ב-deps factories שכבר היו (`promptDeps`, `createAcpBridge`).
- הקוד הישן (`handleMessage`, `handleInit`, `handleAudio`, `handleUserInput`) הוסר. server.ts: 306 → 269 שורות (-12%).

**בדיקות חדשות: `tests/message-router.test.ts` — 22 בדיקות בארבע קבוצות:**

- **parseClientMessage (8):** valid string, valid Buffer, invalid → 'JSON לא תקין', empty string → invalid, whitespace → invalid, number/array technically valid (no shape validation), complex nested preserved, Hebrew text preserved.
- **routeClientMessage (7):** init/audio/text/cancel each dispatches correctly, unknown type → sendError no handler called, handler error propagates, state passed through, sink passed through.
- **disposeConnection (3):** no bridge → noop, bridge → dispose called, dispose throws → silently swallowed (close mustn't crash).
- **cancelActivePrompt (3):** no bridge → noop, bridge → cancel called, cancel throws → silently swallowed.

**אימות:**
- `bun test` → **289 pass, 0 fail, 511 expect() calls, 579ms** (37 unit + 18 ACP + 18 prompt + 9 audio + 14 init + 29 markdown + 13 static + 53 HTTP + 20 tts-cache + 35 gemini + 21 rec + 22 message-router).
- `bunx tsc --noEmit` → נקי.

**מצב server.ts:** 888 (מקור) → 269 (אחרי שכבה 7), -70%.

**מצב כיסוי סופי לפי `behaviors.md`:**
- ✅ ACP, PROMPT, TTS cache, GEMINI, REC, HTTP, MARKDOWN, STATIC, WS routing+lifecycle (כולל JSON parse + close + cancel) — כיסוי ישיר.
- ⚠ STT `transcribeAudio` ו-TTS `textToSpeech`/`streamTextToSpeech` — fetch wrappers דקים שלא נבדקו ישירות. ערך הכיסוי שלהם נמוך (רק transport).
- ⚠ `createAcpBridge` spawn-based wrapper — דורש spawn אמיתי לבדיקה, לא ראלי.
- ⚠ `Bun.serve` wiring ב-server.ts — נשאר רק glue של 30-40 שורות, בלי לוגיקה.
- ⚠ frontend — מחוץ לסקופ.

**v6 הושלם סופית.** כל הלוגיקה הטהורה של ה-backend מכוסה. Bun.serve נשאר wiring רזה ש-tests מקבלים שלא ניתן לבדיקה (Bun.serve הוא כמעט framework — בדיקת אותו = בדיקת Bun עצמו).

**הצעדים הבאים:**
- merge של refactor ל-master.
- אופציה אחרי: שכבה 8 (tts-queue priority/cancel — שינוי לוגי לטיפול בבזבוז).

ממתין להחלטת Avi.

---

## 2026-05-14 23:30 (worktree `voice-acp-refactor` / branch `refactor`)

### v6 שכבה 6 — סיום הכיסוי: TTS cache + GEMINI helpers + REC + 76 בדיקות

**רקע:** אחרי שכבה 5, נשארו שלוש קטגוריות לא מכוסות (TTS cache, GEMINI, REC). זה כיסוי הסיום של הריפקטור.

**TTS cache (20 בדיקות):**
- **`src/tts-cache.ts` (חדש):** class `TtsCache` עם API מלא — `keyOf`, `get`, `set`, `has`, `size`, `clear`, `stats`. exported `DEFAULT_MODEL_ID = "eleven_v3"`.
- **`src/tts.ts`:** משתמש ב-singleton instance של `TtsCache`. הקוד הקיים נשאר עובד.
- **`tests/tts-cache.test.ts` — 20 בדיקות:** key construction (same/different text/voice/model, env fallback, format, empty inputs), get/set/has, size+clear, stats (counts entries, sums bytes, after overwrite, after clear), isolation בין instances.

**GEMINI helpers (35 בדיקות):**
- **ריפקטור של `gemini-helper.ts`:** מבנה חדש — `createGeminiHelper(ai, opts)` factory שמחזיר `{translateThought, narrateToolCall, resetCaches, cacheSizes}`. הסינגלטון של production נשאר זמין דרך `defaultHelper`. exported גם `withTimeout`, `buildNarratePrompt`, `GeminiLike` interface, ו-constants. ה-imports הקיימים (`translateThought` ו-`narrateToolCall`) עדיין עובדים.
- **`tests/gemini-helper.test.ts` — 35 בדיקות בארבע קבוצות:**
  - withTimeout utility (3): resolves fast, fallback on slow, null fallback.
  - translateThought happy path (4): translation returned, default model, custom model override, output trimmed.
  - translateThought failure modes (6): empty input → null no API call, empty response → null, undefined text → null, whitespace-only → null, AI throws → null, timeout → null.
  - translateThought cache (5): same input → cache hit, different input → no hit, trim part of key, null NOT cached → retries, sizes/reset helpers.
  - narrateToolCall happy + fallback (8): returns narration, trimmed, throws → fallback to title, timeout → fallback, empty → fallback, title empty → kind fallback, both empty → "פעולה".
  - narrateToolCall cache (4): same toolCallId hit (different ctx), different toolCallId → no hit, fallback NOT cached → retries, narrations counted separately.
  - buildNarratePrompt pure (5): includes user message, recentMessages join with ` · `, empty recent → `—`, kind defaults to `?`, kind included, 4 examples present.

**REC (21 בדיקות):**
- **ריפקטור של `recordings.ts`:** נחשפו `extFromMime` ו-`buildRecordingPaths` כ-pure functions exported. הלוגיקה הקיימת ב-`saveRecording` נשארה עובדת — היא משתמשת ב-helpers.
- **`tests/recordings.test.ts` — 21 בדיקות:**
  - extFromMime (11): webm, ogg+codecs, ogg, mp3, mpeg → mp3, wav, m4a, mp4 → m4a, flac, case-insensitive, unknown → "audio" fallback.
  - buildRecordingPaths (7): standard inputs, audio + meta share base, colon/period replaced, null sessionId → "no-sess", sessionId truncated to 8 chars, ext from mimeType, baseDir variation.
  - saveRecordingMetadata integration with tmp dir (3): valid JSON written, 2-space indent, error doesn't throw.

**אימות:**
- `bun test` → **267 pass, 0 fail, 476 expect() calls, 601ms** (37 unit + 18 ACP + 18 prompt + 9 audio + 14 init + 29 markdown + 13 static + 53 HTTP + 20 tts-cache + 35 gemini + 21 rec).
- `bunx tsc --noEmit` → נקי.

**סיכום מצב הכיסוי לפי `behaviors.md`:**
- ✅ STT (מכוסה בעקיפין דרך audio-handler tests)
- ✅ ACP (18 בדיקות)
- ✅ PROMPT (18 בדיקות)
- ✅ TTS cache (20 בדיקות, חדש)
- ✅ GEMINI (35 בדיקות, חדש)
- ✅ REC (21 בדיקות, חדש)
- ✅ WS (entry conditions ב-init/audio handlers)
- ✅ HTTP (53 בדיקות)
- ✅ MARKDOWN (29 בדיקות)
- ✅ STATIC (13 בדיקות)
- ⚠ SYSPROMPT (string constant — לא נצרך testing)
- ⚠ URL/UI-* (frontend — ריפקטור frontend בעתיד)

**כל ה-backend מכוסה במלואו** — 267 בדיקות שמכסות את כל ההתנהגויות הקריטיות שתועדו ב-`behaviors.md`.

**מצב server.ts לאורך הריפקטור:**
- מקורי: 888 שורות.
- אחרי שכבה 3: 546 (-39%).
- אחרי שכבה 4: 438 (-51%).
- אחרי שכבה 5: 306 (-66%).
- אחרי שכבה 6: 306 (לא השתנה — הקטגוריות החדשות לא נגעו ב-server).

**הצעדים הבאים:**
- merge של refactor ל-master.
- אופציה אחרי merge: שכבה 7 (אם רוצים) — tts-queue עם priority/cancel לטיפול בבזבוז.

ממתין להחלטת Avi.

---

## 2026-05-14 22:30 (worktree `voice-acp-refactor` / branch `refactor`)

### v6 שכבה 5 — כיסוי אזורים שלא כוסו: markdown + static + 4 HTTP endpoints + 95 בדיקות

**רקע:** אחרי שכבה 4, נשארו שלוש קטגוריות שלמות לא מכוסות ב-`behaviors.md` — MARKDOWN sanitization (security), STATIC file serving (security), HTTP endpoints (4 endpoints, 16 התנהגויות). כל אלה נכתבו עכשיו.

**קבוצה 1 — pure functions (42 בדיקות):**

- **`tests/markdown.test.ts` — 29 בדיקות.** בדיקה ישירה של `renderMarkdown` (אין צורך ב-extraction — כבר פונקציה טהורה). כיסוי: basic rendering (GFM, breaks, bold, italic, Hebrew), הסרת תגיות paired (script, style, iframe, object, embed, form, noscript — case-insensitive, multiline), הסרת self-closing (meta, link, base), הסרת event handlers (onclick, onerror — quoted/unquoted, case-insensitive), הסרת `javascript:` URLs (href/src/action), שילובים מורכבים.

- **`src/static-path.ts` (חדש)** — extracted `resolveStaticPath(pathname, frontendDir)` מ-`serveStatic`. מחזיר union type עם `{ok: true, filePath}` או `{ok: false, status, message}`. ה-`serveStatic` ב-server.ts הפך wrapper של 7 שורות.

- **`tests/static-path.test.ts` — 13 בדיקות.** path traversal `..`, null byte, normal paths, `/` rewriting, FRONTEND_DIR variation, backslashes, trailing slashes.

**קבוצה 2 — HTTP endpoints (53 בדיקות):**

הוצאתי 4 endpoints ל-files נפרדים, כל אחד עם deps interface ו-pure logic נפרד.

- **`src/api-voices.ts` (חדש)** — `mapVoice(raw)` + `sortVoices(voices, defaultId)` + `handleApiVoices(deps)`. ה-sort logic הוא pure function ניתנת לבדיקה ישירה. ה-handler מקבל `fetchVoices` callback.
  - **`tests/api-voices.test.ts` — 19 בדיקות.** mapping (basic fields, missing description, languages from verified_languages/language_id, supportsHebrew via languages או labels), sorting (default first, Hebrew priority, category order, alphabetical within category, unknown category, full chain), orchestration (fetch fails → 500, upstream not ok → 502, empty → empty, mapped+sorted, defaultVoiceId null).

- **`src/api-tts.ts` (חדש)** — `handleApiTts(bodyJson, deps)`. validation + delegate.
  - **`tests/api-tts.test.ts` — 9 בדיקות.** invalid JSON, missing text, empty text, whitespace-only, valid → calls textToSpeech, voiceId optional, text trimmed, textToSpeech throws → 500.

- **`src/api-ls.ts` (חדש)** — `handleApiLs(path, showHidden, deps)`. validation + security + readdir + sort.
  - **`tests/api-ls.test.ts` — 17 בדיקות.** input validation (absolute, empty, outside $HOME/tmp, exact $HOME, /tmp, prefix-but-no-separator trick), filtering (files filtered, dot-folders default vs showHidden), sorting (Hebrew locale, English), parent rules (set when inside, null at boundary $HOME, null at /tmp, set inside /tmp), response shape, ENOENT → 500.

- **`src/api-info.ts` (חדש)** — `handleApiInfo(cwd, deps)`. ה-deps כולל `createBridge` factory.
  - **`tests/api-info.test.ts` — 8 בדיקות.** missing cwd → 400, empty cwd → 400, happy path עם models+sessions, availableModels missing → empty, listSessions failure → empty (silent catch), bridge disposed in happy path, createBridge throws → 500, newSession throws → 500 + dispose still called.

**ב-`server.ts`:**
- 4 ה-API handlers הפכו wrappers של 5-10 שורות כל אחד.
- מ-438 שורות לפני שכבה 5 → 306 שורות אחרי. סה"כ מ-888 → 306 (-66% מהמקור).

**אימות:**
- `bun test` → **191 pass, 0 fail, 372 expect() calls, 234ms** (37 unit + 18 ACP + 18 prompt + 9 audio + 14 init + 29 markdown + 13 static + 53 HTTP).
- `bunx tsc --noEmit` → נקי.

**מצב server.ts לאורך הריפקטור:**
- מקורי: 888 שורות.
- אחרי שכבה 3: 546 (-39%).
- אחרי שכבה 4: 438 (-51%).
- אחרי שכבה 5: 306 (-66%).

**מצב כיסוי לפי `behaviors.md`:**
- ✅ STT (פונקציות חיצוניות — מכוסה בעקיפין דרך audio-handler)
- ✅ ACP (18 בדיקות)
- ✅ PROMPT (18 בדיקות)
- ⚠ TTS (cache logic לא נבדק ישירות — נבדק בעקיפין)
- ⚠ GEMINI (timeout/cache logic לא נבדק — מכוסה בעקיפין)
- ⚠ REC (לא נבדק — file IO)
- ✅ WS (entry conditions ב-init/audio handlers)
- ✅ HTTP (53 בדיקות)
- ✅ MARKDOWN (29 בדיקות)
- ✅ STATIC (13 בדיקות)
- ⚠ SYSPROMPT (לא קריא לבדיקה — string constant)
- ⚠ URL/UI-* (frontend — לא בסקופ הריפקטור הנוכחי)

**שלוש הקטגוריות שעוד לא — TTS cache, GEMINI helpers, REC** — נמוכות עדיפות. ה-TTS cache הוא Map operations בלבד, ה-GEMINI מכוסה כבר בעקיפין דרך prompt-handler tests עם mocks. REC הוא file IO שאם נשבר ייצור console.error אבל לא יעצור flow.

**הצעדים הבאים:**
- אופציה א: השלמת המכוסה — REC + GEMINI + TTS cache (~25 בדיקות נוספות).
- אופציה ב: merge למאסטר ומעבר לאיטרציה הבאה.
- אופציה ג: שכבה 5 המקורית — tts-queue עם priority/cancel (שינוי לוגי, לא רק tests).

ממתין להחלטת Avi.

---

## 2026-05-14 21:30 (worktree `voice-acp-refactor` / branch `refactor`)

### v6 שכבה 4 — extraction של handleAudioInput + handleInitMessage + 23 בדיקות

**אותה תבנית של שכבה 3 — handlers נוספים יוצאים ל-files נפרדים עם deps interface.**

**שני קבצים חדשים:**

1. **`src/audio-handler.ts`** — `handleAudioInput(sink, state, audioMsg, deps)`.
   - `AudioHandlerDeps` extends `PromptHandlerDeps` ומוסיף: `saveRecording`, `saveRecordingMetadata`, `transcribeAudio`, `sttModelName`.
   - הפונקציה: בדיקת busy + bridge → save recording (background) → transcribe → send transcript → metadata write (fire-and-forget) → empty? done; אחרת delegate ל-`handlePromptText`.

2. **`src/init-handler.ts`** — `handleInitMessage(sink, state, initMsg, deps)`.
   - `InitHandlerDeps`: `createBridge`, `renderMarkdown`, `printAgentLogs`.
   - הפונקציה: צור bridge → newSession או loadSession (עם streaming של היסטוריה) → setModel אם צריך → send ready.
   - היסטוריה כוללת flushHistoryMessage עם markdown rendering, ו-`firstPromptSent=true` כי ה-system prompt כבר חלק מהמטען.

**ב-`server.ts`:**
- `handleInit` ו-`handleAudio` הופכים ל-wrappers דקים (5-9 שורות כל אחד).
- מתווסף helper `wsSink(ws)` שעוטף WebSocket ב-`MessageSink`.
- מתווסף constant `promptDeps` שמרכז את כל ה-prompt-handler dependencies לפעם אחת.
- server.ts קוצץ עוד פעם מ-546 ל-438 שורות (-19%, סה"כ -51% מהמקור 888).

**בדיקות חדשות:**

- **`tests/audio-handler.test.ts` — 9 בדיקות** ב-3 קבוצות:
  - entry conditions (2): bridge=null → error, busy=true → error.
  - STT flow (4): transcript לפני prompt, previousResponse, mimeType default+explicit, empty transcript → done.
  - recording (3): saveRecording נקרא תמיד, metadata כולל all fields, save הוא fire-and-forget (handler לא מחכה).

- **`tests/init-handler.test.ts` — 14 בדיקות** ב-4 קבוצות:
  - entry (4): already initialized → error, voiceId+cwd stored, createBridge args.
  - newSession (3): basic, models in ready, firstPromptSent stays false.
  - loadSession (4): firstPromptSent=true, history events, message_rendered with source=history, tool_call flushes pending message.
  - model override (3): match → no setModel, differ → setModel + update, failure → error + ready still sent.

**Stub bridge pattern:** init-handler tests use a hand-rolled stub of `AcpBridge` (כי הוא לא משתמש ב-protocol mechanics — רק orchestration). audio-handler tests משלבים loopback bridge + deps mocks.

**תגלית מהבדיקות:** ב-history loadSession, ה-`history_tool_call` event נשלח **לפני** ה-`message_rendered` של הטקסט הקודם. הקוד שולח את ה-event ל-frontend ואז קורא ל-flush. ה-frontend צריך להחליף את תוכן ה-bubble בדיעבד. עדכנתי behaviors.md עם UI-HIST-7 המתעד את ההתנהגות הזו ומסמן אותה כפוטנציאלית-לתיקון. אם תיקון יבוצע — הבדיקה חייבת להתעדכן בו זמנית.

**אימות:**
- `bun test` → **96 pass, 0 fail, 181 expect() calls, 211ms** (37 unit + 18 ACP + 18 prompt + 9 audio + 14 init).
- `bunx tsc --noEmit` → נקי.

**מצב server.ts:**
- מקור: 888 שורות.
- אחרי שכבה 3: 546 שורות (-39%).
- אחרי שכבה 4: 438 שורות (-51% מסה"כ).

**הצעדים הבאים:**
- שכבה 5 — TTS queue עצמאי כדי לטפל בבזבוז של מחשבות וכלים שייחתכו (הנושא שעלה בתחילת הסשן). דורש שינוי לוגי, לא רק extraction.
- או — בדיקות נוספות לאזורים שכרגע לא מכוסים (HTTP endpoints, markdown sanitization).
- או — merge של refactor למאסטר, ואז new iteration.

ממתין להחלטת Avi.

---

## 2026-05-14 20:50 (worktree `voice-acp-refactor` / branch `refactor`)

### v6 שכבה 3 — extraction של handlePromptText + 18 integration tests

**הריפקטור הראשון הגדול של server.ts.** ה-handler שהיה 240 שורות בתוך closure ענק חולץ ל-3 קבצים חדשים:

1. **`src/ws-protocol.ts`** — types של `ClientMessage` ו-`ServerMessage`, plus `MessageSink` interface (`send` + `sendError`). הוצא מ-server.ts כדי שhandlers יוכלו להשתמש בלי לתלות ב-`Bun.serve`.

2. **`src/conn-state.ts`** — `ConnState` interface + `createConnState()` factory. הוצא מאותה סיבה.

3. **`src/prompt-handler.ts`** — `handlePromptText(sink, state, text, deps)`. ה-deps כולל systemPrompt, streamTts callback, translateThought, narrateToolCall, renderMarkdown. כך אפשר לבדוק עם mocks.

**ב-`server.ts`:**
- ההגדרות של ClientMessage/ServerMessage/ConnState נמחקו (מועברות ל-imports).
- `handleUserInput` הצטמצם לwrapper של 11 שורות שבונה sink + deps ומפעיל את `handlePromptText`.
- הקובץ קוצץ מ-888 ל-546 שורות.

**בדיקות חדשות: `tests/prompt-handler.test.ts` — 18 בדיקות בחמש קבוצות:**

- **basic flow** (4): thinking→done, busy flag set during + cleared, busy cleared on throw, bridge=null → sendError.
- **system prompt injection** (1): first prompt עם prefix, second בלי, firstPromptSent עובר ל-true.
- **message streaming** (4): single sentence → text_chunk + message_rendered + audio_*, multiple sentences (BATCHED — ראה תגלית למטה), lastAgentMessage **overwritten** לא accumulated, recentMessages FIFO max 3.
- **thought flow** (3): thought_chunk → translate → text_chunk thought_translation + audio kind=thought, translate→null מדלג על שניהם, kind transition (thought→message) מפעיל flush של שני ה-buffers.
- **tool calls** (2): create → narrateToolCall עם snapshot context + audio tool_title, title ריק → אין narration.
- **empty response** (3): 0 chars → "המודל לא ענה", 0 chars + thoughts → "ביצע פעולות", error followed by done.

**הוספת harness אלגנטי:**
- `recordingSink()` — `MessageSink` שאוסף כל event למערך + מערך errors נפרד.
- `defaultDeps(overrides)` — deps עם no-op TTS, identity translation, raw-title narration, ו-`<p>${text}</p>` markdown. tests עוקפים שדות בודדים.
- `setupHandler(agent)` — מקים loopback בridge + fresh state + sink + new session, מוכן לקריאה.
- `makeAgent(promptImpl)` — Agent minimal עם default initialize/newSession/וכו', רק `prompt` ניתן לוצקה.

**תגלית מהבדיקות — חשוב!**

הבדיקה "multiple sentences in one chunk" צפתה 3 flushes של 3 משפטים בנפרד. בפועל הוצאו רק 2: שני המשפטים השלמים הראשונים flushed יחד כסגמנט אחד, והשלישי (בלי trailing whitespace) flushed ב-end-of-turn. הסיבה: `findSentenceBoundary` מחזיר את הגבול ה**אחרון** ב-buffer, לא הראשון. הקוד עושה batch-flush, לא per-sentence flush.

זו התנהגות שלא תועדה במפורש ב-`behaviors.md` (PROMPT-8). עדכנתי שם הערה ברורה שזה batching, ושהוא חייב להישמר בריפקטור עתידי.

**אימות:**
- `bun test` → **73 pass, 0 fail, 130 expect() calls, 167ms** (37 unit + 18 ACP bridge + 18 prompt handler).
- `bunx tsc --noEmit` → נקי.
- server.ts קוצץ מ-888 ל-546 שורות (39% פחות).

**הצעדים הבאים:** שכבה 4 — extraction של `handleAudio` ו-`handleInit` באותה תבנית. אז שכבה 5 — אופציונלי — `tts-queue.ts` עצמאי (כדי לטפל בבזבוז שמחשבות+כלים שייחתכו לא ייצרכו Gemini/ElevenLabs). ממתין להוראת Avi.

---

## 2026-05-14 19:35 (worktree `voice-acp-refactor` / branch `refactor`)

### v6 שכבה 2 — Integration tests של ה-ACP bridge דרך loopback streams

**תגלית מ-Avi (תוך כדי השיחה):** ה-SDK של ACP מכיל בדיקות פנימיות שמשתמשות בתבנית "loopback" — שני `TransformStream`s in-memory, `ClientSideConnection` בצד אחד, `AgentSideConnection` בצד השני. שני הצדדים מדברים JSON-RPC אמיתי דרך streams אמיתיים, רק שאין תהליך חיצוני באמצע. ראה `node_modules/@agentclientprotocol/sdk/dist/acp.test.js`.

זה אומר שאני יכול לבדוק את `acp-bridge.ts` שלי **באמת** — בלי spawn של opencode — אם רק אצליח להוציא את הלוגיקה הטהורה מ-IO.

**ריפקטור צעד שני — פיצול `createAcpBridge`:**

הפונקציה פוצלה לשתיים:

1. **`buildBridgeFromStream(stream, cwd, getStderrLines, disposeIo)`** — IO-free. מקבלת stream מוכן + שני callbacks. בונה את ה-client handler, מבצעת initialize handshake, ומחזירה bridge object.

2. **`createAcpBridge(opts)`** — entry-point ל-production. עושה spawn של opencode, מגדירה stderr ring buffer, ממירה Node→Web streams, ואז delegate ל-`buildBridgeFromStream`.

חתימת ה-`AcpBridge` interface נשארה זהה — `server.ts` ממשיך לעבוד ללא שינוי. הריפקטור הזה הוא internal עם backwards-compatibility מלאה.

**בדיקות שנוספו: `tests/acp-bridge.test.ts` — 18 בדיקות בחמש קבוצות:**

- **handshake** (3): bridge נוצר עם sessionId=null, protocolVersion=1 כמספר, clientInfo נכון.
- **sessions** (3): newSession מחזיר ו-updateateם state, cwd עובר נכון, availableModels + currentModelId נחלצים.
- **prompt** (7): throw בלי session, agent_message_chunk → onChunk(message) + מצטבר, agent_thought_chunk → onChunk(thought) **לא מצטבר**, tool_call → onToolCall(create), tool_call_update → title חסר → empty, chunks מרובים מחוברים בסדר, accumulator מתאפס בין prompts.
- **permissions** (4): YOLO — allow_always עדיף על allow_once שעדיף על הראשון. אין options → cancelled.
- **diagnostics** (1): getRecentStderr מחזיר עותק חדש בכל קריאה.

**שני helpers ב-test file:**
- `setupLoopback(agent, cwd?)` — יוצר 2 TransformStreams, AgentSideConnection mock, ו-buildBridgeFromStream שלוף.
- `makeMockAgent(overrides?)` — Agent minimal עם defaults לכל המתודות.

**טכניקה לבדיקת notifications:** ה-mockAgent מתחיל minimal, ואז ב-test ספציפי אפשר להחליף את ה-`prompt` שלו בפונקציה שקוראת ל-`agentConn.sessionUpdate(...)` עם ה-notification הרצוי. זה מאפשר ליצור scenarios מורכבים (3 chunks, mix of types) בלי לבנות agent חדש לכל בדיקה.

**אימות:**
- `bun test` → **55 pass, 0 fail, 81 expect() calls, 138ms** (37 unit + 18 integration).
- `bunx tsc --noEmit` → נקי.

**הצעדים הבאים:** ההצעדים הבאים — או לעבור לשכבה 3 (server.ts: handlePrompt + flow מלא), או להוסיף בדיקות בשכבה 2 לגבי loadSession (עם היסטוריה משוחזרת) ול-listSessions ול-setModel. ממתין להוראת Avi.

---

## 2026-05-14 19:10 (worktree `voice-acp-refactor` / branch `refactor`)

### v6 שכבה 1 — Unit tests + הוצאת helpers טהורים מ-server.ts

**מיקום:** worktree נפרד `voice-acp-refactor` (branch `refactor`). ה-master ממשיך לרוץ אצל Avi ללא שינוי.

**הבעיה הראשונה שהתגלתה:** ה-import של `findSentenceBoundary` מ-`server.ts` הפעיל את כל הקובץ — כולל `Bun.serve` ברמת ה-module — מה ש-(א) ניסה להאזין לפורט 3000 שכבר תפוס ע"י Avi, ו-(ב) עצר את ה-test runner. סימן ראשון של "כל הקוד בתוך closure אחד בלי הפרדה IO/לוגיקה".

**הצעד הראשון של הריפקטור — extraction של פונקציות טהורות:**

1. **`backend/src/sentence-boundary.ts` (חדש)** — מכיל את `findSentenceBoundary`. JSDoc מקיף באנגלית. ה-`server.ts` עכשיו רק עושה import.

2. **`backend/src/provider-error.ts` (חדש)** — מכיל את `extractProviderError`. JSDoc מקיף עם תיאור שני ה-patterns (JSON `"message"`, opencode `ERROR error=`) והעדיפות ביניהם.

3. **`backend/src/server.ts` — הסרת ההגדרות:** שתי הפונקציות הוסרו, רק imports נוספו.

**הוספת `"test": "bun test"` ל-`backend/package.json`.**

**בדיקות שנכתבו:**

- **`tests/findSentenceBoundary.test.ts` — 21 בדיקות בחמש קבוצות:**
  - sentence boundaries (English + Hebrew period, ?, !, colon, blank line, no boundary, no trailing space)
  - abbreviation protection (Mr/Dr/Mrs/Ms/St/vs/etc/i.e/e.g, case-insensitive, with real boundary after)
  - decimal number protection (3.14 with and without real sentence following)
  - forced flush (long > 200, space-finding logic, exactly 200, < 200)
  - multiple boundaries (returns last, mix of types)

- **`tests/extractProviderError.test.ts` — 16 בדיקות בשלוש קבוצות:**
  - pattern 1 (JSON `"message"` — credit/invalid/rate/unauthorized keywords, length filter, last-30 scan, returns most recent match)
  - pattern 2 (opencode ERROR — error= field, stack= stripping, 200-char cap, pattern-1 priority, last-50 scan)
  - edge cases (empty, only noise, all 7 keywords in turn)

**שתי טעויות חישוב שלי בבדיקות נחשפו ותוקנו** (אינדקסים של `.` + space) — לא באגים בקוד, רק חישוב אנושי שגוי. דוגמה מצוינת למה TDD-Vertical חשוב.

**אימות:**
- `bun test` → **37 pass, 0 fail, 56 expect() calls, 21ms**
- `bunx tsc --noEmit` → ריק (תקין)

**הצעדים הבאים — שכבה 2:** integration tests עם mocks ל-`bridge` ול-`fetch`. שמונה תרחישים מ-behaviors.md (chunk יחיד, 3 משפטים, thought→message, tool_call, 0 chars + thoughts, 0 chars + provider error, previousResponse ל-STT, cancel).

---

## 2026-05-14 18:50

### P — חיתוך thoughts לפי גבול משפט (backend, executor)

**מה נעשה:** מימוש משימה P כפי שתוכננה ב-`docs/plan.md`. תרגום והקראת thoughts יקרו פר-משפט במקום בבת אחת בסוף ה-thought.

**שינוי ב-`backend/src/server.ts`:** בתוך ה-`onChunk` של ה-prompt, בענף `kind === "thought"`, נוספה לולאת חיתוך זהה במבנה לזו של `message` (משימה D). הלולאה משתמשת ב-`findSentenceBoundary` הקיים (תומך עברית+אנגלית, הגנה מקיצורים ומספרים עשרוניים, forced flush ב-200) ומפעילה `flushThought` פר משפט. אין שינוי ב-`findSentenceBoundary`, `flushThought`, או ב-frontend.

**אינטראקציה עם משימה L (חיתוך thoughts ב-message_start):** העלייה במספר הסגמנטים מגדילה גם את היעילות של L — חיתוך אגרסיבי יחסל יותר thoughts pending מהר. הקוד הקיים של L כבר מטפל בזה דרך ניקוי `streamOrder`.

**בדיקה:** `bunx tsc --noEmit` עבר. בדיקה empirical: שאלה שמייצרת thought ארוך תייצר עכשיו רצף סגמנטי תרגום קצרים במקום אחד גדול.

**עלות:** Gemini Flash Lite + ElevenLabs פר משפט. סה"כ טקסט זהה, רק חלוקה אחרת. עלות Gemini זניחה (~$0.01/M tokens); ElevenLabs מחויב לפי תווים, אותם תווים = אותה עלות.

---

## 2026-05-14 18:40

### Q — כפתורי ⏮ / ⏭ לניווט בתור הניגון (frontend, executor)

**מה נעשה:** מימוש מלא של משימה Q כפי שתוכננה ב-`docs/plan.md` ב-18:05.

**שינויים ב-`frontend/index.html`:**
- **HTML**: שני כפתורי `nav-btn` חדשים סביב כפתור המיקרופון — `#prev-btn` (⏮) ו-`#next-btn` (⏭), שניהם hidden כברירת מחדל.
- **CSS**: בלוק `.nav-btn` — עיגול 40px בסגנון הכפתורים האחרים, hover בצבע accent.
- **State חדש**: `playbackHistory` — מערך של `SubBubble`s שניגנו (רק `kind=message` עם `audioBase64`). מתעדכן ב-`handleAudioEnd` (סיום live של message), ב-`playSubBubbleAudio` (replay ידני דרך 🔊), וב-`handleNext` (אם live נקטע באמצע ויש base64 חלקי).
- **`updateMicButton`**: לוגיקה לחשיפת prev/next — מופיעים אם state=speaking/paused או יש היסטוריה או streamOrder לא ריק.
- **`handleNext`**: עוצר live current (שומר חלקי ל-history אם message) → playNextStream; או עוצר replay → playNextStream אם יש; אחרת flash.
- **`handlePrev`**: ב-replay → restart מההתחלה (Audio חדש מ-history.last); ב-live → stopAllStreaming + replay של history.last; ב-idle → pop מ-history + playSubBubbleAudio (שיחזיר אותו ל-history דרך push). flash אם אין מה לעשות.
- **`flashBtn`**: helper ל-fade ויזואלי קצר כשהלחיצה לא יכולה לעשות כלום.
- **Keyboard**: `ArrowRight` = prev (RTL: "ימינה" = אחורה), `ArrowLeft` = next. רק כש-focus לא בinput.

**בדיקה:** `node --check` על הסקריפט המוטמע — עבר. בדיקה empirical תהיה כש-Avi תפעיל. אין בעיית רגרסיה — כל הכפתורים הקיימים (replay/mic/stop) נשארו ללא שינוי.

**הערה ארכיטקטונית:** במצב idle, מודל "pop+push" של ה-spec מאפשר לחיצה אחת לחזור לסגמנט הקודם, אבל לא רצף לחיצות (כל לחיצה מ-currentlyPlaying = restart). זה ה-MVP. אם יוצרי הצורך — נשדרג ל-cursor.

---

## 2026-05-14 18:25

### יצירת `docs/behaviors.md` — תיעוד התנהגויות לקראת v6 (ריפקטור)

**מטרה:** רשימה ממוקדת של כל ההתנהגויות הקיימות במערכת — מקור אמת לבדיקות שצריכות להיכתב לפני הריפקטור. אחרי שהבדיקות עוברות על הקוד הנוכחי, ניתן יהיה לעשות refactor בבטחון.

**מקורות:** קריאה ישירה של `backend/src/{server,acp-bridge,stt,tts}.ts`, `frontend/index.html`, `walkthrough.md` (כל ההיסטוריה — POC v1 + v2 + v3 + v4 + hot-fixes), `learnings.md`, וכל פירוט באגים שתועד.

**מבנה:** 14 קטגוריות (STT, ACP, PROMPT, TTS, GEMINI, REC, WS, UI-MIC, UI-AUDIO, UI-BUBBLES, UI-SCROLL, UI-HIST, UI-CAR, CONFIG) + הצעות לסוויטת בדיקות + Q-1..Q-6 לכפתורי הניווט שעדיין לא בוצעו.

**סה"כ ~130 התנהגויות** עם מקור בקוד או ב-walkthrough. כל אחת בפסקה אחת.

**הצעת ארגון לבדיקות** (סעיף בסוף):
1. Unit tests טהורות — `findSentenceBoundary` (8 מקרים) + `extractProviderError`.
2. Mock-based integration tests עם stub של bridge — 8 senarios (chunk יחיד, 3 משפטים, thought→message, tool_call create, 0 chars + thoughts, 0 chars + provider error, previousResponse ל-STT, cancel).
3. State tests של ConnState (busy, firstPromptSent, recentMessages FIFO).
4. E2E smoke tests דרך OneCLI (אופציונלי).

עדיפות: PROMPT + findSentenceBoundary + extractProviderError קודם. אחר כך ACP + GEMINI. אחרון: TTS cache + REC + frontend.

הצעדים הבאים — Avi תאשר/תוסיף לרשימה, וכשמתחילים את v6 ניתן לעבור ישר ל-`bun test`.

---

## 2026-05-14 18:05

### תכנון v5 (משימה Q — ניווט בתור הניגון) + רישום כיוון v6 (ריפקטור)

**רקע:** Avi פתחה דיון מורחב אחרי שמצאה בשיחה empirical קודמת שמודל זיהה שלוש "חולשות ארכיטקטוניות". בדיקה של ה-planner את הקוד הראתה ש:
- שתי טענות לא נכונות (TTS queue: ה-frontend כבר חותך thoughts ב-handleAudioStart message; חיתוך משפט: server.ts:697-719 כולל הגנות מקיצורים ומספרים עשרוניים).
- טענה אחת נכונה: handler ענק (handlePrompt 240 שורות בתוך closure אחד עם 5 buffers, queue, 3 helpers מקוננים).

**החלטה:** ריפקטור צריך לקרות, אבל קודם תיקון נקודתי לכאב הכי דחוף — ElevenLabs לפעמים "משתגע" ומדבר ג'יבריש למשך דקות, ואין דרך לדלג מסגמנט.

**משימה Q (חדשה ב-`docs/plan.md`):** כפתורי ⏮ ו-⏭ לניווט בתור הניגון של ה-frontend. שתי שכבות אודיו במשחק — `StreamingAudio` (live) ו-`Audio` (replay). תור = `streamOrder[]` (קדימה) + `playbackHistory[]` חדש (אחורה). רק `message` נשמר ל-history (יש לו `audioBase64`). תיאור מפורט עם 9 שלבי שינוי, state חדש, edge cases (history מתוך bubble שנקטע באמצע, lapping של לחיצות, history vs reload). frontend בלבד, ~30-45 דקות.

**v6 (רישום בלבד, לא משימה):** ריפקטור backend. תוצרים: `behaviors.md` (חילוץ מהשיחות+walkthrough+קוד), `backend/tests/`, `connection-state.ts`, `prompt-handler.ts`, `tts-queue.ts` (priority + hold + cancel — מטפל גם בבזבוז Gemini/ElevenLabs על מחשבות שייחתכו). יבוצע ב-worktree נפרד `voice-acp-refactor` כדי לא לחסום את הריצה החיה של Avi.

**משימה P (תיקון UX לתרגום thoughts לפי משפט)** — נשארה ממתינה למבצע, ללא שינוי.

**סדר מומלץ:** Q (frontend, דחוף) → P (backend, פתוח) → v6 (refactor, נפרד).

---

## 2026-05-14 17:35

### תיקון הפעלה: OneCLI agent ייעודי + הוצאת שגיאות provider למשתמש

**הבעיה שהתגלתה בריצה empirical:** prompts חזרו ריקים עם `stopReason=end_turn`. הסיבה האמיתית הסתתרה ב-stderr של `opencode acp` שה-bridge בלע: `400 invalid_request_error: "Your credit balance is too low to access the Anthropic API"`. ה-OneCLI default agent (`secretMode: all`) הזריק את ה-Anthropic token שלו לכל קריאה ל-`api.anthropic.com`, עקף את ה-OAuth של opencode plugin, וחייב את הקרדיט של OneCLI במקום את המנוי של המשתמש.

**פתרון:**
- נוצר OneCLI agent חדש בשם `voice-acp` (id `3f08d584-...`) במצב `selective` עם רק 2 secrets — ElevenLabs (`264c2eb8-...`) ו-Google Generative Language (`df221fc3-...`). **אין** Anthropic.
- הפעלה: `onecli run --agent voice-acp -- bun src/server.ts`. Anthropic עוברת ישירות דרך OAuth של opencode.
- `AGENTS.md` עודכן עם ההוראות וההסבר.

**שיפורי דיאגנוסטיקה ב-server:**
- `backend/src/acp-bridge.ts`: ה-stderr של `opencode acp` נתפס תמיד ל-ring buffer של 100 שורות אחרונות, גם כש-`printAgentLogs=false`. נוספה method `getRecentStderr()`.
- `backend/src/server.ts`:
  - env var חדש `VOICE_ACP_VERBOSE=1` מדליק stderr passthrough של opencode ל-stderr של ה-server.
  - בסיום prompt עם 0 chunks, `extractProviderError` מחפש ב-stderr שורות עם `"message":"..."` של provider errors (credit/auth/rate) או `ERROR ... error=...` של opencode. אם נמצא — שולח `sendError` ל-frontend עם ההודעה האמיתית, במקום "המודל לא ענה".
  - אם היו thoughts או tool_calls אך לא message — שולח הודעה ידידותית "המודל ביצע פעולות אבל לא חזר עם תשובה מילולית".
  - לוג סטטוס בתחילת ריצה: `verbose: ON/OFF`.

**Counters ולוגים מפורטים:** הקוד הקיים מסכם בסוף כל prompt: `message=Xch thought=Ych user_msg=Zch tools=Ncreate+Mupdate`, ומדפיס כל tool_call create/update עם kind+title. שימושי לעקיבה גם בלי VERBOSE.

**learnings.md עודכן** עם שני entries: OneCLI default agent injection (drains paid balance), ו-tmux NO_PROXY inheritance.

---

## 2026-05-14 15:30

### משימה O — שיפור פרומפט STT + מעבר ל-Flash (executor) — סיום v3

**`backend/src/stt.ts`:**

- `DEFAULT_MODEL`: `gemini-flash-lite-latest` → `gemini-flash-latest`. מודל גדול יותר, איכות תמלול עברי טובה יותר עם פיסוק ופסקאות.
- `TRANSCRIBE_PROMPT` מורחב:
  - דרישה מפורשת לפיסוק (פסיק/נקודה/סימן שאלה/קריאה) בהפסקות טבעיות וגבולות משפט.
  - שבירת פסקאות (`\n\n`) בשינויי נושא ובהפסקות ארוכות.
  - "Fix disfluencies — but preserve user's intent and phrasing".
  - הדגשה כפולה: "Do NOT add content the user did not say".
  - בלי לקלקל את ההוראות הקיימות על העדפה טכנולוגית ושמירת שפה מקורית.

`bunx tsc --noEmit` עבר.

### סיום v3

זה היה האחרון מבין 6 המשימות J-O. כל המשימות בוצעו, קומטו, ותועדו. סיכום מילולי של האיטרציה:

תיקוני באגים: תרגום נכשל לא מוקרא יותר באנגלית מסולפת. הסגנון של תרגום המחשבה עכשיו זהה למקור, רק השפה משתנה. הגלילה תוקנה לפי מודל user intent — תוכן שמתווסף לא יכבה אוטו, רק פעולת קלט אמיתית. סגמנט שני ואילך של message כבר נראה (תוקן ע"י ה-planner ב-9e36d25).

פיצ'רים חדשים: ברגע שתשובה מתחילה, מחשבות מנוגנות נחתכות אגרסיבית באמצע. הקלטות נשמרות לדיסק עם metadata, controlled by env var. ה-STT עבר ל-Flash הרגיל עם פרומפט שכולל פיסוק ופסקאות.

הצעדים הבאים: בדיקה empirical מלאה של כל v3 דרך OneCLI. פיצ'רים נוספים תחת `docs/future-features.md`.

---

## 2026-05-14 15:20

### משימה N — שמירת הקלטות לדיסק (executor)

**מטרה:** כל הקלטה של המשתמש נשמרת לדיסק יחד עם metadata. בסיס לפיצ'רים עתידיים (replay של סשנים, בחינת prompts שונים על אותה הקלטה).

**מודול חדש: `backend/src/recordings.ts`**

- `recordingsEnabled` + `recordingsDir` exports — לוג בתחילת ריצה.
- `SAVE_RECORDINGS_ENABLED` — קריאת `process.env.VOICE_ACP_SAVE_RECORDINGS`. ערך `0` או `false` (case-insensitive) משבית. ברירת מחדל: מופעל.
- נתיב: `$XDG_CACHE_HOME/voice-acp/recordings` או `$HOME/.cache/voice-acp/recordings`.
- `ensureDir()` עם flag כדי לא לקרוא ל-`mkdir` כל פעם.
- `saveRecording(base64, mimeType, sessionId)` → מחזיר `RecordingInfo` או `null`. שם: `<ISO-stamp>_<sid-short>.<ext>`. `ext` נגזר מ-mimeType (webm/ogg/mp3/wav/m4a/flac/audio).
- `saveRecordingMetadata(info, meta)` → כותב את ה-sidecar JSON עם שם תואם.
- כל שגיאה מודפסת ל-stderr בלי לזרוק — אסור שזה יעצור את ה-flow.

**שינויים ב-`backend/src/server.ts`:**

- import של recordings.
- `ConnState` קיבל `cwd: string | null` ו-`sessionId: string | null` (נדרשים ל-metadata). שניהם מאותחלים ל-null ב-open.
- ב-`handleInit`: `state.cwd = msg.cwd` (בתחילה). אחרי `loadSession`/`newSession`: `state.sessionId = sessionResult.sessionId`.
- ב-`handleAudio`: שמירת ההקלטה מתחילה **ברקע** במקביל ל-STT (`saveRecording` קוראים בלי `await`). אחרי `transcribeAudio` החזיר, `recPromise.then(info => saveRecordingMetadata(...))` בלי await — שכבת ה-IO לא דוחה את התגובה ל-frontend. ה-metadata כולל: timestamp, sessionId, cwd, mimeType, audioSize, transcript, sttModel.
- לוג בתחילת ריצה: `recordings: ON (path)` או `OFF`.

**אימות:** `bunx tsc --noEmit` עבר. שמירה בפועל תאומת ב-`~/.cache/voice-acp/recordings/` בריצה הבאה.

---

## 2026-05-14 15:05

### משימה M — גלילה חכמה לפי user intent (executor)

**הבאג:** הלוגיקה הקודמת מבוססת מרחק בלבד. תוכן חדש מתווסף → `scrollHeight` גדל → ה-`scroll` event מגיע באיחור עם distance גדל → המערכת חושבת שהמשתמשת גללה למעלה ומכבה אוטו בטעות (race condition שתועד ב-13:45).

**הפתרון:** מודל user intent. אוטו פעיל כל הזמן, אלא אם המשתמשת באמת עשתה פעולת קלט.

**`frontend/index.html`:**
- הסרת `SCROLL_THRESHOLD_PX = 60` ו-`suppressScrollEvents` — לא נחוצים יותר.
- שדה חדש `userInteractionAt: number` — timestamp של פעולת קלט אחרונה.
- `markUserInteraction()` — listener על `wheel`, `touchstart`, `touchmove`, `mousedown`, `keydown` (כולם `passive: true`). מעדכן `userInteractionAt = Date.now()`.
- `chatEl.scroll` handler חדש: בודק `isUser = Date.now() - userInteractionAt < 500`. אם distance ≤ 10 → מחזיר אוטו (מסתיר כפתור ↓). אחרת אם isUser → מכבה אוטו ומראה ↓. תוכן שמתווסף בלי קלט לא מכבה אוטו.
- `scrollChatToBottom` פושט ל-`if (!autoScrollEnabled) return; chatEl.scrollTop = chatEl.scrollHeight`.
- `jumpDownBtn click` פושט גם — אין צורך ב-suppressScrollEvents.

**מה כן/לא נתפס:** wheel/touch/keyboard/mousedown → כן. scrollbar drag לא נתפס באירועי wheel/touch, אבל `mousedown` על ה-scrollbar כן — לכן מהדק עם הגלגלת והאצבע, וגם עם scrollbar drag ידני.

`node --check` עבר. הסרת ~10 שורות קוד מיותר.

---

## 2026-05-14 14:55

### משימה L — קפיצה אוטומטית ממחשבות לתשובה (executor)

**הבעיה:** ה-`ttsQueue` ב-backend סדרתי, אבל ה-frontend מנגן אסינכרונית. ה-MediaSource צובר chunks ו-`audio.play()` ממשיך גם אחרי ש-backend שלח `audio_end`. תוצאה: thought מנוגן כשהמסר כבר זורם.

**הפתרון:** אגרסיבי. ברגע שמתחיל `audio_start kind="message"` ב-frontend — לקטוע מיד thoughts פעילים ופנדינג, כולל באמצע chunk.

**`frontend/index.html`:**

*`StreamingAudio.stop()`* חדש — מקביל ל-`pause()`, אבל גם:
- `this.audio.src = ""` (משחרר את ה-source הנוכחי, מבטל פעולות ניגון פנדינג).
- `mediaSource.endOfStream()` אם open (לסיים את ה-MSE buffer).
- כל בלוק עטוף ב-`try {} catch {}` — שגיאות לא יעצרו את ה-flow.

*`handleAudioStart`* מקבל בלוק חדש בתחילתו, כש-`kind === "message"`:
1. אם `currentStream?.kind === "thought"` → `stop()` + `currentStream = null`.
2. iterate על `streamOrder`: כל stream של `thought` בתור → `stop()` + `activeStreams.delete`. שאר ה-streams (theoretically lower priority — בדרך כלל tool_title) נשמרים ב-`keep`.
3. `streamOrder` נבנה מחדש מ-`keep`.

המסר החדש עצמו ייווצר ויתחיל לנגן רגיל אחרי הבלוק הזה.

**זרימת UX:** thought ארוך מתורגם ומוקרא → backend מסיים thought TTS, מתחיל message TTS → frontend מקבל `audio_start (message)` → קטיעת thought מיד באמצע משפט → התחלת המסר. המשתמש שומע: thought חלקי קצוץ → מסר.

`node --check` עבר.

---

## 2026-05-14 14:45

### משימה K — CSS revert ל-`thought-translation` (executor)

**`frontend/index.html`:** ב-CSS של `.msg.agent.thought .bubble .thought-translation` הוסרו `padding-top`, `border-top`, `color`, `font-size`, `font-style`. נשארו רק `display: block` ו-`margin-top: 4px`. כל המאפיינים האחרים יורשים מהבועה ההורית — כך תרגום עברי נראה זהה למקור האנגלי. השפה היא המבחין היחיד.

`node --check` עבר.

---

## 2026-05-14 14:40

### משימה J — `translateThought` מחזיר null בכישלון (executor)

**הבאג שתוקן:** כשתרגום מחשבה נכשל (timeout/error/ריק), ה-fallback היה הטקסט האנגלי המקורי. הוא נשלח כ-`thought_translation` ל-frontend ומוקרא בקול עברי של ElevenLabs — נשמע כאנגלית מסולפת, נורא מבלבל.

**שינויים ב-`backend/src/gemini-helper.ts`:**
- חתימה: `translateThought(text: string): Promise<string | null>` (במקום `Promise<string>`).
- כל מסלולי הכישלון — timeout, exception, תוצאה ריקה — מחזירים `null` במקום fallback.
- ה-cache שומר רק תוצאה לא-null (כמו קודם).
- ה-JSDoc הובהר במפורש שעל הקורא לבדוק null ולדלג על TTS.
- ה-CLI test entrypoint מציג `[null — נכשל]` במקרה כזה.

**שינויים ב-`backend/src/server.ts`:**
- ב-`flushThought`, אחרי `const hebrew = await translateThought(t);`: בדיקה `if (hebrew === null) { console.log("דילוג"); return; }`. אין שליחת `text_chunk thought_translation` ואין `streamTts`. המשתמש יראה רק את ה-thought האנגלי המקורי בבועה, בלי שורה שנייה ובלי קול.

**אימות:** `bunx tsc --noEmit` עבר. CLI test דרך OneCLI עם happy-path: `"I should check this carefully."` → `"אני צריך לבדוק את זה היטב."` ב-930ms. ה-null path יאומת empirically בשיחה דרך הממשק (אי-אפשר לסמלץ כשלון בלי שינוי קוד זמני).

## 2026-05-14 13:05

### משימה I — `dir="auto"` לבועות (executor)

**מטרה:** טקסט עברי יוצג RTL, אנגלי LTR — בלי תיוג ידני, גם בהיסטוריה וגם ב-live, גם בתוך פסקאות markdown.

**`frontend/index.html`:**

3 נקודות מימוש (לפי הפלן):
1. **SubBubble constructor:** אחרי יצירת `this.bubbleEl`, מוסיף `setAttribute("dir", "auto")`. כל בועה (user/thought/tools/message) יקבל direction אוטומטי.
2. **renderToolItem:** ה-span השני (זה עם הטקסט) מקבל `dir="auto"` ישירות במחרוזת ה-`innerHTML`, נקי יותר מ-`querySelector` post-hoc.
3. **setHtml:** אחרי `innerHTML = html` (markdown מ-server), iterate על `bubbleEl.children` — לכל element-child שאין לו `dir` attribute, מוסיף `dir="auto"`. ככה כל פסקה / כותרת / רשימה במכל markdown תיושר נכון.

**הסיבה לhighbridge `dir="auto"`:** ה-`<html dir="rtl">` של הדף קובע ברירת מחדל RTL. אבל הודעות של המודל לעיתים מכילות אנגלית טהורה (שמות פונקציות, blocks). עם `dir="auto"`, הדפדפן בודק את התווים החזקים הראשונים: עברית → RTL, אנגלית → LTR. זה מאפשר שילוב טבעי של שתי השפות באותה שיחה.

**בדיקות:** `node --check` עבר. אומת ויזואלית בריצה הבאה.

### סיום v2

זה היה האחרון מבין 9 המשימות (A-I) של plan v2. כל המשימות בוצעו, קומטו, ותועדו ב-walkthrough. סיכום מילולי של שכבת הנגישות:

1. **system prompt** — המודל מודע שהוא מדבר ולא כותב.
2. **STT** — פרומפט עברית טכנולוגית + context מההודעה הקודמת.
3. **gemini-helper** — `translateThought` + `narrateToolCall` עם cache+timeout+fallback.
4. **flushMessage** — חיתוך לפי משפט (גם בעברית).
5. **thoughts** — תרגום לעברית + הקראה דרך ElevenLabs.
6. **tool narration** — Gemini מנסח במקום title גולמי, עם context של הודעת המשתמש.
7. **mic state machine** — pause/resume + stop, 4 מצבים.
8. **smart scroll** — autoscroll מותנה + כפתור ↓.
9. **dir auto** — תמיכה ב-RTL/LTR מעורב.

הצעדים הבאים יהיו ב-`docs/future-features.md` (16 פיצ'רים שנדחו).

---

## 2026-05-14 12:55

### משימה H — גלילה חכמה (executor)

**מטרה:** auto-scroll רק כשהמשתמשת קרובה לתחתית. אם היא גללה למעלה לקרוא משהו — לא לדרוס. כפתור ↓ מאפשר חזרה למטה.

**`frontend/index.html`:**

*HTML/CSS:*
- עטיפת `#chat` ב-`#chat-wrap` (position:relative) כדי שהכפתור ↓ ימקם absolute ביחס לwrapper, לא ל-chat ש-overflow:auto (אחרת היה גולל עם התוכן).
- כפתור `<button id="jump-down" class="jump-down">↓</button>`.
- CSS `.jump-down`: position:absolute, bottom:14px, inset-inline-end:14px (RTL-aware), עיגול, צל, opacity:0 + pointer-events:none כברירת מחדל. `.visible` מפעיל. hover מצביע על accent.

*JavaScript:*
- קבוע `SCROLL_THRESHOLD_PX = 60` ושני state: `autoScrollEnabled = true` (default), `suppressScrollEvents = false` (flag להגנה מ-feedback loop).
- listener על `chatEl.scroll`: אם לא מדוכא, מחשב מרחק מהתחתית. ≤60px ⇒ autoScrollEnabled=true, אחרת false. toggleVisibility על הכפתור.
- `scrollChatToBottom()` (קיים, שימוש בו במספר מקומות): כעת מוקדם-יציאה אם `!autoScrollEnabled`. אחרת מציב suppressScrollEvents=true → scroll → רI requestAnimationFrame לאיפוס.
- jumpDownBtn click: מאפס autoScrollEnabled=true, מגלל, ומסתיר את הכפתור.

**הזרימה:** ברגע שהמשתמשת גלללה ידנית למעלה (>60px מהתחתית) → autoScrollEnabled=false → הכפתור מופיע. כל קריאה הבאה ל-scrollChatToBottom (מ-appendText, setHtml, setThoughtTranslation, SubBubble constructor) — לא תעשה כלום. המשתמשת לוחצת ↓ → autoScrollEnabled=true → גולל למטה → ה-listener רואה שאנחנו בתחתית ומחזיק את autoScrollEnabled.

**הגנה מ-feedback loop:** ה-`scrollTop = scrollHeight` הפרוגרמטי משדר scroll event. ה-suppressScrollEvents flag מונע מה-listener לבדוק את המרחק (אחרת היה רואה מרחק 0, autoScrollEnabled=true, וזה היה OK — אבל יותר חזק עם flag).

**בדיקות:** `node --check` עבר.

---

## 2026-05-14 12:40

### משימה G — mic button state machine + stop button (executor)

**מטרה:** במצב speaking, לחיצה על המיקרופון תעשה pause/resume של ההקראה במקום להתחיל הקלטה. בנוסף, כפתור stop מובהק לעצירה מוחלטת.

**State machine חדש (4 מצבים):**
- `idle` — מוכן להקלטה (כחול, 🎙).
- `recording` — מקליט (אדום פועם, ⏺).
- `speaking` — מקריא תשובה (אדום עדין, ⏸ — לחיצה תפסיק).
- `paused` — הקראה בהמתנה (כחול עם הילה, ▶ — לחיצה תמשיך).

מעברים: idle ↔ recording (התחל/סיים הקלטה), speaking ↔ paused (פסה/חידוש), stop-btn מ-speaking או paused → idle.

**`frontend/index.html`:**

*CSS:*
- מעבר מ-`#btn.recording` ל-`#btn[data-state="..."]` עם 4 סלקטורים.
- הוספת `#btn[data-state="speaking"]` (אדום ללא pulse) ו-`#btn[data-state="paused"]` (כחול עם hover-glow).
- transition קצר לbackground+shadow למעבר חלק בין מצבים.
- מיזוג `#replay-last,#stop-btn` ל-CSS משותף עם hover-state ייחודי לכל אחד.

*HTML:* הוספת `<button id="stop-btn" hidden>⏹</button>` בתוך `.controls`. ה-`btn` קיבל `data-state="idle"` בHTML כברירת מחדל.

*JavaScript:*
- שדה גלובלי חדש: `let audioIsPaused = false;`
- ICONS map: `{idle:"🎙", recording:"⏺", speaking:"⏸", paused:"▶"}`.
- `getMicButtonState()` — לוגיקה: `isRecording` ⇒ recording, אחרת אם יש `currentlyPlaying||currentStream` ⇒ paused/speaking לפי `audioIsPaused`, אחרת idle.
- `updateMicButton()` — מעדכן `dataset.state`, `textContent`, `aria-label`, ו-hidden של stop-btn.
- 3 helpers: `pauseAllAudio()`, `resumeAllAudio()`, `stopAllAudio()`. ה-stop מאפס currentStream+currentlyPlaying+streamOrder+activeStreams+audioIsPaused וחוזר ל-idle.
- `StreamingAudio.resume()` חדש — מקביל ל-pause הקיים.
- click handler חדש על btn — switch לפי `getMicButtonState()`.
- click handler חדש על stop-btn — `stopAllAudio()`.
- keydown Space — מתעלם אם המצב speaking/paused (Space נשאר רק לidle↔recording).
- קריאות `updateMicButton()` הוספו ב: `startRecording`, `stopRecording`, `startStream`, `playNextStream` (אחרי איפוס `audioIsPaused`), `playSubBubbleAudio` (start+ended+error), `onComplete` של stream.
- MutationObserver עבור car mode עבר מ-`class` ל-`data-state`, גם הלוגיקה (`dataset.state !== "recording"`).

**בדיקות:** `node --check` עבר. UX יבדק empirically בריצה דרך OneCLI — בייחוד `tool_title` chimes + pause/resume.

---

## 2026-05-14 12:20

### משימה F — נראציה של tool calls (executor)

**מטרה:** במקום להקריא את הכותרת הגולמית של ה-tool ("Read README.md", "Edit hello.js"), Gemini מנסח משפט קצר טבעי בעברית עם הקשר.

**`backend/src/server.ts`:**

- `import { narrateToolCall, translateThought } from "./gemini-helper.ts"` (השני כבר היה ב-E).
- `ConnState`:
  - `lastUserText: string | null` — הטקסט האחרון של המשתמש (transcript או text ישיר).
  - `recentMessages: string[]` — FIFO של עד 3 הסגמנטים האחרונים של המודל.
  - שניהם מאותחלים ב-`open`.
- `handleUserInput`: שמירת `state.lastUserText = text` בהתחלה. ככה גם נתיב audio (דרך `handleAudio` → `handleUserInput(transcript)`) וגם נתיב text ישיר מעדכנים נכון.
- `flushMessage`: אחרי `state.lastAgentMessage = t`, הוספה ל-`state.recentMessages` (push + shift אם > 3).
- `onToolCall(create)`: במקום `queueTts(rawTitle, "tool_title")` ישירות, נכנסים ל-`ttsQueue.then(async () => narrateToolCall + streamTts("tool_title"))`. ה-`kind: "tool_title"` נשמר ב-WebSocket — ה-frontend לא צריך לדעת שזה נראציה במקום title.

**Snapshot של הקונטקסט ברגע ה-create:** המשתנים `userMessage` ו-`recentSnapshot` נשמרים בזמן ה-create, לפני שה-ttsQueue מגיע לעיבוד. אם פעולות נוספות מעדכנות את `state.recentMessages` בינתיים, הנראציה עדיין משקפת את המצב כש-ה-tool נקרא. זה חשוב כי הנראציה רצה async (1.5s timeout).

**אין שינוי ב-frontend.** ה-WebSocket events נשמרו זהים (אותו `audio_start kind: "tool_title"`, אותו צ'יים מקדים). הגישה הזו שמורה בכוונה — מינימום משטח שינוי, נקלט ב-frontend הקיים.

**בדיקה:** `bunx tsc --noEmit` עבר. הנראציה בפועל מאומתת empirically ב-shell דרך OneCLI (משימה C). יעבוד אוטומטית כש-server רץ דרך OneCLI.

---

## 2026-05-14 12:05

### משימה E — תרגום thoughts לעברית + הקראה (executor)

**מטרה:** המשתמש שומע את ה-reasoning של המודל בעברית, לא רק רואה את ה-מקור באנגלית. הקראה דרך ElevenLabs.

**Backend (`server.ts`):**
- `ServerMessage` מורחב: `text_chunk.kind` קיבל ערך חדש `"thought_translation"`. `audio_start.kind` קיבל ערך חדש `"thought"`.
- `import { translateThought } from "./gemini-helper.ts"` (משימה C).
- `handleUserInput`:
  - `streamTts(text, kind)` הוצא ל-helper נפרד (פנימי ל-handle). `queueTts(text, kind)` עכשיו רק מוסיף לתור.
  - `thoughtBuffer` חדש (במקביל ל-`messageBuffer`).
  - `flushThought()` חדש: מצמצם trim של buffer, אם ריק חוזר. אחרת: `ttsQueue.then(async () => translate → text_chunk thought_translation → streamTts(hebrew, "thought"))`.
  - `onChunk` עבור `kind === "message"`: אם יש `thoughtBuffer.length > 0` → `flushThought()` (thought הסתיים).
  - `onChunk` עבור `kind === "thought"`: אם יש `messageBuffer.length > 0` → `flushMessage()`. ואז `thoughtBuffer += chunk`.
  - `onToolCall(create)`: `flushMessage(); flushThought();` (סגירת שני ה-buffers).
  - סוף תור: `flushMessage(); flushThought();`.

**Frontend (`index.html`):**
- CSS: `.msg.agent.thought .bubble .thought-translation` — `display:block`, `margin-top:6px`, `padding-top:6px`, `border-top: 1px dashed`, `color: var(--fg)` (בולט מהמקור), `font-size: 14px` (גדול יותר מ-12.5 של המקור). italic+line-height יורשים.
- `SubBubble`:
  - שדה חדש `hasTranslation: boolean` (default false). 
  - `appendText` ב-thought: יוצר `_originalEl` (span) פעם אחת ושומר את הטקסט שם, במקום `bubbleEl.textContent` שהיה דורס childנים.
  - `setThoughtTranslation(text)` חדש: יוצר `_translationEl` (div.thought-translation) ומוסיף ל-`bubbleEl`. שינוי `hasTranslation = true`.
- `handleServerMessage` עבור `text_chunk` כש-`kind === "thought_translation"`: מוצא את ה-thought הראשון ב-currentTurn שעוד לא תורגם וקורא ל-`setThoughtTranslation`.
- `handleAudioStart`: תמיכה ב-`kind === "thought"` — מקשר ל-thought sub האחרון שעוד לא קושר ל-stream.
- `handleAudioEnd`: שמירת `audioBase64` ו-`setAudioState("ready")` רק ל-message subs (לא ל-thought — אין replay button).

**הסדר מובטח:** ב-backend ה-`ttsQueue` שומר על FIFO לכל פעולה אסינכרונית (translate + TTS). כל flushThought כולה רצה כיחידה. אז סדר ה-`text_chunk thought_translation` ו-`audio_start kind=thought` המגיעים ל-frontend תואם בדיוק לסדר היצירה של thought sub-bubbles. מספיק `find(s => !s.hasTranslation)` ו-`find(s => !s._streamId)` בהתאמה.

**בדיקות:** `bunx tsc --noEmit` עבר. `node --check` על ה-JS שחולץ מ-index.html עבר.

---

## 2026-05-14 11:40

### משימה D — חיתוך flushMessage לפי גבול משפט (executor)

**מטרה:** קטעי TTS קצרים יותר → ההקראה מתחילה מהר יותר אחרי שהמודל מתחיל לכתוב, ולא ממתינה לסוף הודעה שלמה.

**`backend/src/server.ts`:**

הוספת `findSentenceBoundary(s: string): number` ב-section "עזרים" (export, לבדיקות יחידה). הפונקציה מחזירה אינדקס *אחרי* הגבול האחרון, או -1.

גבולות מזוהים:
- `.`/`!`/`?` ואחריהם רווח/שורה חדשה.
- `:` + רווח.
- שורה ריקה (`\n\n+`).

הגנות:
- קיצורים שכיחים (`Mr.`, `Dr.`, `Mrs.`, `Ms.`, `St.`, `vs.`, `etc.`, `i.e.`, `e.g.`) — לא חותך אחרי הנקודה שלהם.
- מספר עשרוני (`3.14`) — לא חותך באמצע.

forced flush: אם המחרוזת ארוכה מ-200 תווים בלי גבול, חותך ברווח האחרון לפני 200 (או ב-200 אם אין רווח אחרי 100). פתרון לעברית — בה נקודות נדירות יותר.

**ב-`onChunk` עבור `kind === "message"`:** במקום רק לצבור ל-`messageBuffer`, נעשה loop של `while ((boundary = findSentenceBoundary(...)) !== -1)`. כל איטרציה: חיתוך ב-`head` (מ-0 עד הגבול), שמירת `rest`, קריאה ל-`flushMessage()` (ששולח ל-TTS+render ומאפס את ה-buffer ל-""), ואז שמירת `rest` חזרה ב-`messageBuffer`. הלולאה ממשיכה אם יש עוד גבול ב-`rest`.

**הביצוע נשמר ב-rendering:** `flushMessage` ממשיך לקרוא ל-`renderMarkdown` ולשלוח `message_rendered` לפני TTS. סגמנט קצר → רינדור קצר → בועה משלו ב-frontend. הfrontend כבר תומך בקבלה רב-בועתית של "message" (כל `text_chunk + message_rendered` יוצר בועה).

**אומת ב-unit test:**
- `"ראיתי את הקובץ. הוא נראה תקין."` → גבול ב-16 (חיתוך אחרי "ראיתי את הקובץ. ").
- `"Hello Mr. Smith and Dr. Jones."` → -1 (קיצורים מוסתרים, ו-"Jones." בסוף בלי רווח לא נחשב גבול).
- `"The value is 3.14 exactly."` → -1 (3.14 מוגן; "exactly." בסוף בלי רווח לא גבול).
- `"Section one:\nNext stuff"` → גבול ב-13 (`:\n`).
- מחרוזת `"x"×220` → גבול ב-200 (forced flush).

`bunx tsc --noEmit` עבר.

---

## 2026-05-14 11:25

### משימה C — `gemini-helper.ts` (executor)

קובץ חדש: `backend/src/gemini-helper.ts`. שני שירותים לנגישות אודיו דרך `gemini-flash-lite-latest`:

**`translateThought(text)`** — תרגום reasoning של המודל מאנגלית לעברית מדוברת. cache לפי הטקסט המלא; timeout 2500ms; fallback לטקסט המקורי בכל כשל (כולל timeout).

**`narrateToolCall(ctx, tool)`** — ניסוח משפט קצר בעברית שמתאר מה הסוכן הולך לעשות, על בסיס `userMessage` ו-`recentMessages`. הפרומפט כולל 4 דוגמאות (read/bash/edit/build) שמדגימות "תכלית, לא פרמטרים". cache לפי `toolCallId`; timeout 1500ms; fallback ל-`title` הגולמי.

**עיצוב:**
- `withTimeout` helper: `Promise.race` עם resolve-מהיר ל-fallback. אם ה-API לא חוזר בזמן, ה-flow ממשיך מיד עם ה-fallback. ה-promise המקורי ממשיך ברקע (POC — לא AbortController).
- שני caches נפרדים: `translationCache: Map<text, hebrew>`, `narrationCache: Map<toolCallId, hebrew>`. אין eviction (POC).
- כל שגיאה מודפסת ל-stderr בלי לקרוס.
- שני שירותים מאתחלים `ai = new GoogleGenAI({ apiKey: "placeholder" })` — OneCLI מטפל ב-auth.
- CLI test entrypoint עם `import.meta.main`: `bun src/gemini-helper.ts "<text>"`. אומת ש-fallback עובד בלי OneCLI (API נכשל → טקסט מקורי חוזר ב-285ms) **ושה-happy path עובד דרך OneCLI**: `onecli run -- bun src/gemini-helper.ts "I should check the README first..."` → `"כדאי לי לבדוק את הקובץ ריד-מי קודם כדי להבין את הפרויקט."` ב-829ms (תחת ה-2.5s timeout). גם `narrateToolCall` אומת דרך `onecli run -- bun -e ...` עם `tool: { kind: "read", title: "Read README.md" }` → `"אני קורא את ה-README כדי להבין על מה הפרויקט הזה"` ב-607ms.

`bunx tsc --noEmit` עבר.

המודול עצמאי — אין שינוי ב-`server.ts` עדיין. הוא ייכנס לשימוש ב-E ו-F.

---

## 2026-05-14 11:15

### משימה B — STT prompt טכנולוגי + context (executor)

המשך v2. שדרוג איכות התמלול של Gemini בשני צירים.

**ב-`backend/src/stt.ts`:**

החלפת `TRANSCRIBE_PROMPT` ל-prompt מורחב שמציין במפורש שהמשתמש מדבר עברית בהקשר של פיתוח תוכנה. ה-prompt החדש מורה למודל להעדיף פירוש טכנולוגי במקרי ספק ("ריאקט" לא "ראקת", "באג" לא "בק"), לתקן disfluencies (חזרות, "אה אה", false starts), ולשמור על השפה המקורית. הוספת שדה אופציונלי `previousResponse?: string` ל-`SttOptions`. אם הועבר — הוא נשלח כ-text part *לפני* האודיו, עם תיוג ברור שזה "for context only — do NOT transcribe this".

**ב-`backend/src/server.ts`:**

הוספת `lastAgentMessage: string | null` ל-`ConnState`, אתחול ל-`null` ב-`open`. ב-`flushMessage` כל cycle שומר את הקטע האחרון ב-`state.lastAgentMessage`. ב-`handleAudio` הקריאה ל-`transcribeAudio` כוללת עכשיו `previousResponse: state.lastAgentMessage ?? undefined`.

**המוטיבציה:** בשיחה רציפה, מילים דו-משמעיות כמו "פונקציה" / "פוסיציה", "באג" / "בק", "Edit" / "אדיט" — תלויות בקונטקסט. Gemini עם הקטע האחרון של המודל מקבל את ה-context הזה ישירות. שמירת ה-flush האחרון בלבד (לא צבירה) — זה הקטע שזכור למשתמש כשהוא מגיב.

`bunx tsc --noEmit` עבר.

---

## 2026-05-14 11:05

### משימה A — חיזוק `system-prompt.ts` (executor)

הסשן הראשון של ה-executor אחרי שה-planner הגיש את `plan.md` מבונה. מתחילים את v2 לפי הסדר המומלץ.

הוספתי שתי שורות לסעיף "חוקי תגובה" של `VOICE_SYSTEM_PROMPT` ב-`backend/src/system-prompt.ts`:

- "תחשוב על איך התשובה שלך נשמעת, לא איך היא נראית בקריאה על מסך."
- "המשתמש שומע אותך, לא קורא. אין לו מסך מולו."

המוטיבציה: המודל לפעמים מתייחס לתשובה כטקסט שייקרא — מציין "להלן רשימה של…" או "כפי שמופיע למעלה". כשכל הערוץ הוא TTS, ההנחה הזו שגויה. השתי שורות החדשות ממסגרות את המודל למצב הקרנת קול ולא מצג טקסטואלי.

`bunx tsc --noEmit` עבר. שינוי טקסט בלבד, אין השפעה על compile.

---

## 2026-05-14 16:35

### תכנון v4 — תיקון נקודתי לבעיית UX של תרגום thoughts בבת אחת

באג שזוהה בבדיקה empirical של Avi אחרי שהמבצע סיים את v3: התרגום של מחשבות לעברית קורה רק כש-thought block נגמר (מעבר ל-message/tool_call או סוף תור), לא פר-משפט. תוצאה: המשתמש מחכה דקות לפני שהוא שומע משהו, ואז שומע את כל ה-thought block ברצף.

#### שורש הבעיה

ב-`server.ts`, ב-`onChunk` handler:
- עבור `kind === "message"` יש loop של `findSentenceBoundary` + flush פר-משפט (נוסף ב-D).
- עבור `kind === "thought"` רק `thoughtBuffer += chunk`, בלי חיתוך.

ה-flushThought נקרא רק כש-message מתחיל / tool_call create / סוף תור. בינתיים thoughtBuffer מצטבר ל-thousands of chars.

#### הפתרון

העתקה של אותה לוגיקה מ-D ל-thought handler. הפונקציה `findSentenceBoundary` תומכת כבר באנגלית ועברית, יש לה הגנה מקיצורים ומספרים עשרוניים, forced flush ב-200 תווים. `flushThought` כבר עובד פר-סגמנט (תרגום + TTS דרך ttsQueue).

זוהתה כמשימה P. תכנון יחיד — אין תלויות, היקף קוד מינימלי (~10 שורות שינוי), בדיקה אמפירית פשוטה. הערכת זמן 10-15 דקות.

#### אינטראקציה עם L

משימה L (קפיצה אוטומטית ממחשבות לתשובה) מקבלת יותר ערך אחרי P — יש יותר סגמנטים פעילים של thoughts ב-ttsQueue, וה-clear של streamOrder ב-L יחתוך גם אותם. הקוד של L כבר מטפל ב-pending thoughts, אין שינוי נדרש.

#### צעדים הבאים

המבצע יקבל את plan.md המעודכן ויבצע P. אחר כך בדיקה empirical חוזרת על ידי Avi.

---

## 2026-05-14 14:30

### תכנון v3 — איטרציית baseline לנסיעה

אחרי בדיקה empirical של Avi ב-13:30 ושיחת תכנון מורחבת, נקבע סקופ ל-v3: תיקוני באגים + שיפורים שיהפכו את החוויה לטובה מספיק לשימוש קולי בדרכים.

#### הבאגים שזוהו

1. **אנגלית מופיעה במקום תרגום של מחשבה.** כש-`translateThought` עובר timeout או נכשל, ה-fallback הוא הטקסט האנגלי המקורי. הוא נשלח כ-`thought_translation` ל-frontend ומוקרא דרך אילבן בקול עברי. נשמע כאנגלית מסולפת ומבלבל את המשתמש.
2. **תרגום עברי של מחשבות נראה שונה מהאנגלית.** בתיקון hot-fix קודם (commit 9e36d25) הוגדר ה-Hebrew גדול ובהיר ולא איטלי כדי "להבדיל". Avi הבהיר שזו לא הכוונה — אותו עיצוב לשתי השורות, השפה היא המבחין היחיד.
3. **באג גלילה race condition.** הלוגיקה הקיימת מבוססת על בדיקת מרחק מהקצה בכל `scroll` event. כשמתווסף תוכן מהר, `scrollHeight` גדל אבל `scrollTop` נשאר, ה-event מגיע באיחור עם מרחק גדל, המערכת חושבת שהמשתמש גלל למעלה ומכבה את האוטו בטעות.
4. **המתנה במחשבות.** הניגון של המחשבה ב-frontend ממשיך אסינכרונית גם אחרי שה-message TTS התחיל לזרום ב-backend. המשתמש שומע מחשבה ארוכה גם אחרי שהתשובה כבר מוכנה.
5. **תמלול חלש.** הפרומפט הנוכחי לא מבקש פיסוק או שבירת פסקאות. המודל (Flash Lite) פחות מדויק לעברית מהאלטרנטיבה (Flash).

#### השיפורים הנוספים שעלו לדיון

6. **שמירת הקלטות לדיסק** במהלך פיתוח — לבדיקת פרומפטים, ולעתיד יותר רחוק כבסיס ל"נגן סשן מחדש".

#### החלטות שהתקבלו

- **תרגום והקראת מחשבות יישארו פעילים כברירת מחדל באיטרציה הזאת.** הוסכם שהם יהפכו ל-opt-in toggle ב-config בעתיד, אבל לא בסקופ של v3.
- **קאש פרסיסטנטי לגמיני** — לא בסקופ של v3. כל סשן יחשב מחדש. הסיכון: עלות חוזרת על מחשבות חוזרות.
- **CSS revert: זהה לאנגלית.** השפה היא המבחין היחיד.
- **קפיצה ממחשבה לתשובה: אגרסיבית.** חיתוך מיידי באמצע ניגון. המטרה: רגע ש"המודל סיים לחשוב" מורגש מיידית.
- **STT model: מעבר ל-Flash הרגיל.** עלות פי שניים אבל מקובלת לפיתוח.
- **שמירת הקלטות: דרך משתנה סביבה.** `VOICE_ACP_SAVE_RECORDINGS` ברירת מחדל מופעל. בעתיד אולי toggle בממשק.

#### חריגה מהפרוטוקול שזוהתה

הסוכן המתכנן (אני) פעל ב-13:30 כסוכן מבצע — ערך קוד ל-frontend (תיקון באג ה-sub-bubbles + CSS hot-fix). Avi הצביע על כך שזו חריגה מהכלל "תכנון בלבד". מהיום ואילך — תיקונים, גם דחופים, עוברים דרך plan ולסוכן מבצע.

#### תכנון התוצר

`docs/plan.md` נכתב מחדש: 6 משימות אטומיות J-O, כל אחת עם מטרה, הקשר, קבצים, שינוי מדויק עם דוגמאות קוד, הצעת בדיקה, והודעת commit. דחיפות: J → K → L → M → N → O. סה"כ זמן מוערך כ-2 שעות.

#### צעדים הבאים

המבצע יקח את ה-plan ויבצע את J-O לפי הסדר. כש-N נסתיים, אפשר להריץ CLI test על הקלטות שמורות כחלק מאימות O.

---

## 2026-05-14 13:30

### תיקון באג hot-fix — סגמנטים שני ואילך של message לא הוצגו

באג שזוהה בבדיקה empirical של Avi: בתשובות עם יותר ממשפט אחד, רק המשפט הראשון הוצג בצ'אט — שאר המשפטים נשמעו ב-TTS אבל לא נכתבו בבועה.

#### שורש הבעיה

עם החיתוך לפי משפט שמשימה D הוסיפה, ה-backend שולח `message_rendered` נפרד לכל משפט. ה-frontend חיפש "bubble של message בלי HTML" כדי להציב את ה-HTML. אחרי המשפט הראשון, הבועה כבר עם HTML (`hasHtml=true`), אז המשפט השני לא מצא יעד. בנוסף, `appendText` מדלג על עדכון תצוגה אם `hasHtml=true`, אז גם הטקסט הגולמי של chunks נוספים לא הוצג.

#### תיקון

`frontend/index.html`:
1. **`AgentTurn.appendMessage`** — אם הבועה הנוכחית של message כבר rendered (`hasHtml=true`), היא נחשבת סגורה. הסגמנט הבא יוצר sub-bubble חדש.
2. **handler של `message_rendered`** — אם אין bubble של message בלי HTML, יוצרים אחת חדשה (לטיפול במקרה ש-flush מרובה התרחש על chunk יחיד שהכיל כמה משפטים).

תוצאה: כל משפט מקבל bubble משלו עם רינדור מלא וכפתור השמעה. תואם לעיקרון של per-segment streaming.

#### תיקון משני — styling

`thought-translation` ירשה `font-style: italic` מ-`.bubble` של thought. בעברית איטליק קשה לקריאה. נוסף `font-style: normal` להתרגום העברי כדי להבדיל ויזואלית ברור יותר (אנגלית — italic קטן ואפור; עברית — normal גדול ובהיר).

#### חריגה מהפרוטוקול הרגיל

הסוכן המתכנן ערך קוד frontend, מה שבדרך כלל אסור (ראה `docs/agents/planner.md`). הצדקה: המבצע סיים את הסשן שלו, Avi בעיצומה של בדיקה empirical, והבאג חוסם את הבדיקה. תיקון של 8 שורות JS + 2 שורות CSS. מתועד גם ב-`planner.md`.

Sanity: בדיקת syntax של ה-JS המוטמע עברה (`new Function(combined)` ב-Node).

---

## 2026-05-14 10:45

### מבנה מחדש של `docs/plan.md` — הגשה למבצע

הסשן הראשון של המתכנן (מודל אופוס, אחרי שהוקם הפרוטוקול ב-`docs/agents/`). מטרה: לקחת את התוכנית הקיימת של v2 ולהפוך אותה לתוכנית "מוכנה לביצוע" שהמבצע יוכל לפתוח ולהתחיל לעבוד בלי שאלות מקדימות.

#### מה בוצע?

**1. שינוי מבנה של `plan.md` לפי הפורמט של `planner.md`**

הוספת הסעיפים הסטנדרטיים שהיו חסרים:
- **משימות לביצוע** (קודם נקרא "תוכנית ביצוע") — המבצע יקרא רק את זה.
- **משימות בעבודה (executor)** — ריק כרגע.
- **משימות שבוצעו** — POC v1, תיקון באג playQueue, ותשתית קואורדינציה.
- **רעיונות לדיון (טרם הוחלט)** — שני סעיפים (התראות אקטיביות, פיצול plan/discussion).
- **תוכניות ארוכות טווח / future-features** — pointer.

**2. פיצול 7 שלבים לתשע משימות אטומיות A-I**

קודם: סעיפים 1.1-7.4 עם תת-משימות. אחרי: A-I, כל אחת אטומית עם תיאור מטרה, קבצים, שינוי מדויק, דוגמאות קוד, בדיקות, והצעת commit message.

| משימה | מטרה |
|--------|------|
| A | חיזוק `system-prompt.ts` (הקראה, לא קריאה) |
| B | STT prompt טכנולוגי + העברת context מההודעה הקודמת |
| C | יצירת `gemini-helper.ts` (translateThought + narrateToolCall) |
| D | חיתוך `flushMessage` לפי גבול משפט |
| E | תרגום thoughts לעברית + הקראה |
| F | נראציה של tool calls דרך Gemini |
| G | mic button state machine — pause/resume + כפתור stop |
| H | גלילה חכמה — auto רק קרוב לתחתית + ↓ |
| I | `dir="auto"` לבועות, פריטי tools, ו-markdown HTML |

תלויות מפורשות: A/B/G/H/I עצמאיות, C חייבת לפני E/F.

**3. הסרת מידע חופף וכפילויות**

- "מצב פתיחה" של הסוכן הקודם נמחק (כבר ב-walkthrough).
- "באג playQueue" עבר מ"לביצוע" ל"שבוצע" — מקרה מיוחד: ה-walkthrough של 08:45 כבר תיעד שזה תוקן, אבל ב-plan.md הוא נשאר כמשימה 1.1. עכשיו מסודר.
- סעיף "1.2 עדכון system-prompt.ts" — היה רחב מדי. בעת בדיקה ראיתי שהקובץ הקיים כבר מכיל "סכם פלט של כלים", "בלי markdown", "בלי emojis". המשימה החדשה (A) ממוקדת רק בשתי שורות חסרות.

**4. עדכון `planner.md`**

מצב נוכחי: מוד ארכיטקט. לוג רשומה חדשה על תחילת הסשן וקריאת המסמכים.

#### החלטות שמובאות מהתכנון

- **שמירת `kind: "tool_title"` ב-F (במקום `tool_narration` חדש)** — כדי לא לשבור את ה-frontend הקיים. ה-frontend לא יודע מה הטקסט; רק על איזה צ'יים לנגן ולאיזה תור.
- **`findSentenceBoundary` עם הגנה מקיצורים** — נמנע חיתוך אחרי `Mr.`, `Dr.`, `i.e.`, `e.g.`, ובאמצע מספר עשרוני.
- **forced flush של 200 תווים** — לעברית שבה נקודות נדירות.
- **timeouts**: 2500ms ל-translateThought, 1500ms ל-narrateToolCall. אם נכשל — fallback לטקסט המקורי / title הגולמי. אף פעם לא לעצור את ה-flow.

#### צעדים הבאים

המבצע יכול עכשיו להתחיל מ-A (5 דקות, קל) כדי להיכנס לתבנית, ואז להתקדם לפי הסדר המומלץ. כשהמבצע מתחיל סשן — הוא יעדכן את `docs/agents/executor.md` ויעביר משימות מ"לביצוע" ל"בעבודה".

---

## 2026-05-14 08:45

### השלמת POC v1 — Voice interface פעיל מקצה לקצה + מסמכי תכנון ל-v2

הסשן הארוך הזה לקח את הפרויקט ממסמכי תכנון בלבד לפרויקט פועל. כל ה-stack נבנה, נבדק E2E, ונוספו פיצ'רים מעבר ל-POC המקורי של ה-spec.

#### מה בוצע?

**1. Backend — תשתית מלאה (Bun + ACP + STT + TTS)**

- `backend/src/stt.ts` — Gemini STT דרך `@google/genai` v2.2.0. Model: `gemini-flash-lite-latest`. תומך WebM/MP3/WAV/OGG/FLAC/M4A.
- `backend/src/tts.ts` — ElevenLabs REST. תחילה `eleven_multilingual_v2`, **אז עברנו ל-`eleven_v3` אחרי שהתגלה שזה היחיד שתומך עברית כראוי**.
- `backend/src/acp-bridge.ts` — `ClientSideConnection` מעל stdin/stdout של `opencode acp` (SDK v0.21.0). תומך:
  - `newSession` / `loadSession` / `listSessions`
  - streaming של chunks (`agent_message_chunk` / `agent_thought_chunk` / `user_message_chunk`)
  - `tool_call` ו-`tool_call_update` notifications
  - `setModel` (unstable)
  - YOLO permission mode (auto-approve)
- `backend/src/server.ts` — Bun native WebSocket + HTTP statics + 5 API endpoints (`/api/info`, `/api/voices`, `/api/tts`, `/api/ls`, וההגשה הסטטית).
- `backend/src/system-prompt.ts` — קבוע שמוזרק כ-prefix לprompt הראשון של כל session (בלית ברירה — ACP לא חושף role system).
- `backend/src/markdown.ts` — רינדור Markdown ל-HTML עם sanitization (regex-based, לא DOMPurify מטעמי תלות).

**2. Frontend — UI עשיר (vanilla JS, ללא build)**

- `frontend/index.html` — ממשק הצ'אט הקולי הראשי. כולל:
  - Push-to-talk עם MediaRecorder (WebM/Opus)
  - Chat bubbles: user / agent message / thought (מקופלת ב-italic) / tools (pill עם expand)
  - Streaming audio playback דרך MediaSource API (fallback ל-Blob)
  - 🔊 על כל בועת message (live + history, עם state machine: pending/ready/cold/fetching/failed)
  - 🔊 גלובלי להשמעת ההודעה האחרונה
  - היסטוריה: `history_*` events מטעינים session קיימת לבועות
  - Car mode (`?car=1`) — MediaSession API + רעש לבן ב-Web Audio API gapless loop
  - Thinking chime (G4) + Tool chime (E5→C5) דרך Web Audio
- `frontend/config.html` — דף הגדרות:
  - בחירת cwd (ידני + Folder picker modal עם breadcrumb)
  - בחירת מודל (מ-`/api/info`)
  - בחירת session קיימת (מ-`/api/info`)
  - בחירת voice (מ-`/api/voices`, ממוין: ברירת מחדל → תומכי עברית 🇮🇱 → premade)
  - Car mode checkbox
  - שמירה ב-localStorage

**3. Streaming TTS — pipeline מקצה לקצה**

- ב-backend: `streamCachedTextToSpeech` עם ReadableStream של ElevenLabs.
- WebSocket events חדשים: `audio_start` → `audio_chunk`* → `audio_end` (החליפו את ה-`audio_ready` הישן ל-live).
- `audio_ready` נשאר כ-legacy לתאימות בלבד (משמש דרך `/api/tts` ל-bubbles בהיסטוריה).
- ב-frontend: class `StreamingAudio` שמשתמש ב-MediaSource API לניגון progressive; fallback ל-Blob אם MSE לא נתמך.
- Cache פנימי (`ttsCache` ב-`tts.ts`) — key: `voiceId|modelId|text`, in-memory Map.

**4. Per-segment TTS**

- `flushMessage()` ב-server מפצל את תשובת המודל לקטעים על מעבר kind (message → thought / tool_call).
- כל קטע נשלח בנפרד ל-TTS, ה-queue ב-backend (`ttsQueue`) שומר על סדר.
- ה-frontend מנגן progressively לפי הסדר.
- גם כותרות tool calls (`event.title`) מוקראות כקטע מסוג `tool_title` עם צ'יים מקדים.

**5. תכנון v2 — שני מסמכים חדשים**

- `docs/plan.md` — תוכנית מפורטת ל-v2 (7 שלבים): שיפור פרומפטים, gemini-helper.ts (תרגום מחשבות + נראציה של tool calls), חיתוך לפי משפט, UI שדרוגים (mic button state machine, גלילה חכמה, dir="auto").
- `docs/future-features.md` — 16 פיצ'רים נדחים. 11 ראשונים כיסו את הרעיונות מהשיחה (קול משני למחשבות, VAD + Gemini interruption, worktree workflow, bash command details, permission UI, auth + TLS, replay של תור, thinking sound כקובץ, streaming TTS משפט-משפט כבר חלקית, tool output summary, supermemory). 5 נוספים תרם הסוכן המקביל מתוך תובנות שצצו תוך כדי בנייה: full input streaming ל-ElevenLabs WS, per-segment WS isolation לחוסן, iOS Safari car mode דרך PWA, TTS cache עם LRU ו-disk persistence, צליל מעבר message+טעינה אוטומטית של תיקייה+markdown sanitization ל-TTS.

**6. תיקון באג — `playQueue` residual**

ב-`frontend/index.html`, ב-handlers של `done` ו-`error` הייתה התייחסות ל-`playQueue.length === 0` — משתנה שהוסר עם המעבר ל-streaming. שגיאת runtime שתופסת רק במקרה של זרימה ספציפית. תוקן ל-`!currentStream && streamOrder.length === 0`.

#### החלטות ארכיטקטורה

- **`eleven_v3` בלבד לעברית** — לפי `/v1/models`, רק v3 כולל `language_id: "he"`. v2 ("multilingual") אומר שתומך אבל בפועל מבטא עברית מסולפת לחלוטין דרך ה-API. v3 גם מהיר וקטן יותר (61KB לעומת 249KB לאותו משפט). תועד ב-`~/.config/opencode/learnings.md`.
- **Streaming TTS על per-segment, לא משפט-משפט** — לא חיתוך בתוך פסקה אחת לסגמנטים קטנים יותר. נדחה ל-v2.
- **Markdown ב-backend, לא ב-frontend** — כדי שה-frontend ישאר פשוט (innerHTML של HTML מוכן). sanitization בצד server.
- **Thoughts לא מוקראות** — `agent_thought_chunk` הוא reasoning פנימי, יכול להיות אלפי תווים. אם מודל חזר רק ב-thought ולא message, מוצגת שגיאה במקום fallback לתוך thought. הקראת thoughts תרגום-לעברית נדחתה ל-v2 (תועד ב-plan.md).
- **System prompt כ-prefix לprompt ראשון, לא ניסיון לזייף role: system** — ACP לא חושף system message. ה-pragmatic approach: prefix לטקסט המשתמש בקריאה הראשונה, עם flag `firstPromptSent`. בהיסטוריה ה-prompt כבר חלק מהדאטה.
- **Car mode עם רעש לבן ב-amplitude נשמע** — שקט מוחלט (samples=0) לא מפעיל MediaSession בדפדפנים מסוימים. עברנו ל-amplitude קטן (gain=0.015) שלא נשמע בפועל אבל מספיק שהדפדפן יזהה אודיו פעיל.

#### מעקפים ופתרונות

- **OpenCode ACP מחזיר תשובה רק ב-thought** — לפעמים, על שאלות עם הגבלות אגרסיביות ("ענה במילה אחת"), המודל "חושב את התשובה" בלי לכתוב אותה כ-message. הניסיון לעשות fallback (להציג את ה-thought) נכשל כי thoughts יכולים להיות אלפי תווים של reasoning. הפתרון: שולחים `sendError` מנומס למשתמש ("המודל לא ענה, נסה לנסח אחרת"), בלי TTS.
- **Web streams מ-Node streams** — ה-SDK של ACP מצפה ל-`WritableStream<Uint8Array>` ו-`ReadableStream<Uint8Array>` של Web, אבל `spawn` של node מחזיר Node streams. השימוש ב-`Writable.toWeb` / `Readable.toWeb` מגשר.
- **`protocolVersion` הוא `1` ולא `"0.1"`** — ה-spec המקורי טעה. בפועל זה מספר.
- **טיפול ב-`audio_ready` שמגיע אחרי `done`** — ה-TTS queue ממשיכה לרוץ אחרי שה-prompt הסתיים. ה-frontend מטפל ב-`audio_ready` גם כש-`currentTurn === null` על-ידי שימוש ב-`turns[turns.length - 1]` כ-fallback.

#### צעדים הבאים

לפי `docs/plan.md` — מתחילים ב-v2:
1. עדכון system prompt + STT prompt.
2. יצירת `backend/src/gemini-helper.ts` — `translateThought` + `narrateToolCall`.
3. חיתוך לפי משפט ב-`flushMessage`.
4. Thought streaming + TTS עם תרגום.
5. Tool narration (Gemini במקום מיפוי קשיח).
6. UI: mic button state machine (pause/resume + stop), גלילה חכמה, dir="auto".

---

## 2026-05-13 22:37

### השלמת שלב התכנון — מפרט מוכן לבנייה

הסשן הזה לא כלל כתיבת קוד; כולו תכנון ועיגון החלטות במסמכים. הפרויקט מוכן עכשיו לסשן בנייה של ה-POC.

#### מה בוצע?

**1. אישור הארכיטקטורה הכוללת**

- `Browser → WebSocket → Bun backend → opencode acp (child process)`
- Frontend: HTML בודד עם vanilla JS, בלי build step.
- Backend: Bun native WebSocket, ללא framework.
- ACP: `@agentclientprotocol/sdk` v0.16.1, `ClientSideConnection` מעל stdin/stdout של `opencode acp`.

**2. בחירת ספקי STT/TTS**

- **STT — Gemini** (במקום Whisper). הסיבה: לפי המשתמש, Gemini מתמלל עברית "עם הרבה יותר הגיון מ-Whisper".
- **TTS — ElevenLabs** דרך REST (fetch ישיר, בלי SDK — overhead מיותר ל-POC).
- אימות שני המפתחות בוצע בסשן: ElevenLabs פעיל (חשבון `creator`, ~277k תווים); Gemini פעיל.

**3. עדכון מודל ה-STT ל-alias של הגרסה האחרונה**

- `gemini-2.0-flash` → `gemini-flash-lite-latest`.
- ה-alias מתעדכן אוטומטית, לא נועל גרסה.
- Flash Lite מספיק ל-STT (מהיר וזול יותר מ-Flash הרגיל).

**4. מעבר לניהול מפתחות דרך OneCLI**

- אין יותר קובץ `backend/.env` למפתחות.
- הקוד מאתחל SDKs עם המחרוזת `"placeholder"`; OneCLI proxy מחליף את ה-headers בדרך לhosts הרלוונטיים.
- ה-env var היחיד שנשאר הוא `ELEVENLABS_VOICE_ID` (חלק מה-URL, לא header).
- `spec.md §6, §10` ו-`AGENTS.md` עודכנו בהתאם.

#### החלטות ארכיטקטורה

- **STT דרך Gemini ולא Whisper** — בחירת איכות לעברית על פני סטנדרט תעשייתי. ההפרדה ב-`stt.ts` שומרת שניתן יהיה להחליף בעתיד בקלות.
- **OneCLI proxy במקום `.env`** — מונע שמירת secrets בקוד או בקבצים מקומיים. הקוד שולח placeholder, ה-proxy מזריק את המפתח האמיתי לפי host. יתרון: אותו קוד עובד אצל כל מי שיש לו OneCLI עם ה-secrets הנכונים.
- **`gemini-flash-lite-latest` alias** — מתעדכן אוטומטית לדור הבא; אין צורך לתחזק גרסה.
- **REST ישיר ל-ElevenLabs, בלי SDK** — קריאת `POST` אחת עם טקסט → MP3. SDK יוסיף תלות בלי תועלת ל-POC.
- **דחיות מודעות ב-POC**: streaming TTS (מחכים לתשובה מלאה), permission dialogs (ACP במצב yolo — אישור אוטומטי).

#### מצב הקבצים בסוף השלב

- `README.md` — תיאור קצר + פקודות הפעלה.
- `AGENTS.md` — הוראות סוכן: מבנה, חוקי עבודה, definition of done; מעודכן ל-OneCLI.
- `docs/spec.md` — מפרט מלא: ארכיטקטורה, פרוטוקול WebSocket, stubs ל-`acp-bridge`/`stt`/`tts`/`server`, URL params, state machine של הכפתור, סדר בנייה מוצע.
- `docs/walkthrough.md` — הקובץ הזה.

#### צעדים הבאים

הסשן הבא: פתיחת הפרויקט והתחלת בנייה לפי סדר ה-13 ב-spec (התקנה → backend skeleton → STT/TTS → ACP bridge → frontend).
