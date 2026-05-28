# Logging Plan — voice-acp-v2

> תכנון יישום של מערכת ה-logging לפי `docs/logging-template.md`.
> ספציפי לrepo הזה: קבצים, namespaces, מה לוגוט בכל מקום, ופרומפט לסוכן.

---

## מטרות

1. לסגור פערי debugging ב-pipeline ה-voice (audio_chunk לפעמים לא נשלח, ttsActive race, history reconnect).
2. לחשוף את ה-`try/catch` השותקים ב-FE ו-BE.
3. לאפשר reproduction של bugs ע"י קישור URL: `?log=debug&logRemote=1`.
4. ליצור wire-level tracing לשתי השכבות:
   - **CLI ↔ Backend** (ACP NDJSON)
   - **Backend ↔ Frontend** (WS פרוטוקול שלנו)

---

## ה-Phases

| Phase | מה | הערכת זמן | Verifier-phase אחרי? |
|-------|------|--------------|------------------------|
| 1 | core/log + tests | 30 דק | ❌ pure logic + TDD |
| 2 | wire tracing (ACP wire + WS wire + FE wire) | 15 דק | ✅ protocol change — וודא wire מציג NDJSON |
| 3 | Backend conversion + correlation IDs + silent errors | 35 דק | ❌ convert + tests מספיקים |
| 4 | Frontend conversion + silent errors | 25 דק | ✅ וודא אין regression ב-voice flow |
| 5 | Remote sink (POST /api/client-log + browser.transmit) | 20 דק | ✅ new endpoint — וודא `?logRemote=1` פועל |
| 6 | Walkthrough update | 5 דק | ❌ docs |

סה"כ: ~2 שעות + verifier overhead. **בסוף ה-slice — חובה verifier-slice מלא.**

---

## Anti-patterns ידועים — אל תעשה

### Logger lifecycle
- ❌ לעולם לא `import { log } from './log-setup'` כ-singleton גלובלי. תמיד `createLogger(ns)` בראש הקובץ ברמת module.
- ❌ לא ליצור logger בתוך function body — יצירה חוזרת בכל call. module-level בלבד.
- ❌ לא להשאיר אף `console.log/warn/error` אחרי המעבר. Bypass של ה-Logger = איבוד namespace/level filter. Tests של הפרויקט כבר תופסים `console.warn` ב-2 מקומות — אם תוסיף, tests ייכשלו.
- ❌ לעולם לא `console.log('[some] message')` כ-fallback "רק לdebug עכשיו". אם זה ראוי ל-log — Logger. אם לא — מחק.

### Correlation IDs
- ❌ לא לוגוט `promptId`/`agentId` ידנית בכל קריאה. צור `log.child({ promptId })` פעם אחת ב-תחילת `sendAudioPrompt`/`sendPrompt`.
- ❌ לא להעביר `agentId` כ-argument לפונקציות עמוקות רק כדי לוגוט. העבר logger child (parameter אופציונלי `parentLog = baseLog`).
- ❌ לא להחזיק `let log = baseLog` ולעדכן ב-runtime עם child — זה race condition בין concurrent prompts. תמיד `const log = baseLog.child(...)` ב-scope של הfunction.

### Sensitive data
- ❌ לעולם לא: `log.debug({ audioBytes: base64 }, ...)` — רק `{ bytes: N }`.
- ❌ לעולם לא: `log.info({ apiKey, token, authorization }, ...)` — לא ב-fields, לא ב-msg.
- ❌ לעולם לא: `log.trace({ fileContent }, ...)` — רק `path` ו-`size`.
- ❌ לעולם לא: `log.debug({ headers: req.headers }, ...)` — headers מכילים cookies/auth. פלטר מראש.

### Truncation
- ❌ לא לוגוט text ארוך ללא חיתוך. helper `trunc(text, 200)` או 80 ל-debug.
- ❌ לא להעביר object שלם שצריך JSON.stringify בלי לחשוב על גודלו. arrays של 100+ items שווה לוגוט `{ count: N, first3: arr.slice(0, 3) }`.

### Wire-level
- ❌ לא לוגוט wire-level ב-`debug`. רק `trace`. NDJSON עלול להציף את הDevTools/terminal.
- ❌ לא לוגוט raw frame בלי `trunc(text, 2000)`. tool outputs יכולים להיות 100KB.

### Library compatibility
- ❌ לא להוסיף transports של pino מצד-שלישי (`pino-elasticsearch`, `pino-logflare`) — זה outside scope של ה-MVP. אם רוצה — זה דורש brief נפרד.
- ❌ לא להחליף את pino ב-winston/bunyan באמצע. ה-template כבר התלבט והחליט.

### Refactor vs rebuild
- אם הplan אומר "החלף `console.log("[acp]...")` ב-`log.debug(...)`" — מחק את ה-console ולא להשאיר מעליו `// TODO: convert later`.
- אם הplan אומר "הסר try/catch ריק" — מחק את ה-`catch {}` והחלף ב-`catch (e) { log.warn({ err: e }, ...) }`. לא להשאיר ריק.

### Performance
- ❌ לא לוגוט בלולאות hot (ב-`for (const s of sentences)` לכל sentence). אם חייב — `trace`, לא debug.
- ❌ לא לחשב fields כבדים שלא ישמשו: `log.debug({ stringified: JSON.stringify(bigObj) })` רץ גם אם debug כבוי. השתמש ב-`log.isLevelEnabled?.('debug')` אם החישוב כבד.

---

## Phase 1 — core/log + tests

### קבצים ליצירה

```
packages/core/src/log/
├── types.ts        ← Level, Fields, LogConfig, Logger, LogEntry
├── namespace.ts    ← isEnabledForNs(ns, pattern)
├── config.ts       ← parseLogConfig({ env?, search?, localStorage? })
├── index.ts        ← Node entry — createLogger, initLogger, addSink, getLogConfig
└── browser.ts      ← Browser entry — אותו API, pino/browser

packages/core/tests/log/
├── namespace.test.ts
├── config.test.ts
└── api.test.ts
```

### `package.json` — `exports` מעודכן

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./schemas/*": "./src/schemas/*.ts",
    "./voice/*": "./src/voice/*.ts",
    "./acp/*": "./src/acp/*.ts",
    "./ui/*": "./src/ui/*.ts",
    "./cache/*": "./src/cache/*.ts",
    "./log": {
      "browser": "./src/log/browser.ts",
      "default": "./src/log/index.ts"
    }
  }
}
```

### Tests — מה לכסות

**`namespace.test.ts`:**
- `*` → מתאים לכל
- `voice.*` → מתאים `voice`, `voice.pipeline`, `voice.pipeline.tts`; לא `voicemail`
- `voice.pipeline` exact → רק exact (לא `voice.pipeline.tts`)
- `-noisy.x` → מחריג (חזק יותר מinclude)
- צירופים: `voice.*,acp.*,-acp.heartbeat`
- empty/invalid input → fallback ל-default

**`config.test.ts`:**
- Precedence: URL > LS > env > default
- `parseLogConfig({ env: { LOG_LEVEL: "debug" } })` → `level: "debug"`
- `parseLogConfig({ search: "?log=trace" })` → `level: "trace"`
- שילובים: URL מבטל LS
- `logSticky=1` → writes ל-LS (mock LS)
- invalid level → fallback ל-`info`

**`api.test.ts`:**
- `createLogger("a").info(...)` עובד
- `log.child({ x: 1 })` → fields יורשים בכל cell
- `log.ns("sub").ns("deeper")` → namespace `a.sub.deeper`
- `addSink(fn)` → fn נקרא עם entry
- `level=silent` → no-op מוחלט

### Logger API — החוזה

```ts
// packages/core/src/log/types.ts
export type Level = "silent" | "error" | "warn" | "info" | "debug" | "trace"
export type Fields = Record<string, unknown>

export type LogEntry = {
  ts: number
  level: Level
  ns: string
  msg?: string
  fields?: Fields
}

export type LogConfig = {
  level: Level
  ns: string                       // CSV pattern; "*" default
  format: "pretty" | "json" | "both"
  remote?: boolean
}

export interface Logger {
  trace(fields?: Fields, msg?: string): void
  debug(fields?: Fields, msg?: string): void
  info(fields?: Fields, msg?: string): void
  warn(fields?: Fields, msg?: string): void
  error(fieldsOrErr?: Fields | Error, msg?: string): void
  child(fields: Fields): Logger
  ns(suffix: string): Logger
}
```

### initLogger — Backend (Node)

```ts
// packages/backend/src/log-setup.ts
import { initLogger } from "@drive-coding/core/log"

const config = parseEnvConfig()

// LOG_WIRE shortcut — מאפשר wire tracing בלי לזכור LOG_LEVEL+LOG_NS
if (process.env.LOG_WIRE) {
  config.level = "trace"
  const wireNs = {
    acp: "backend.acp.wire.*",
    ws: "backend.ws.wire.*",
    "1": "backend.acp.wire.*,backend.ws.wire.*",
  }[process.env.LOG_WIRE] ?? ""
  if (wireNs) {
    config.ns = config.ns === "*" ? wireNs : `${config.ns},${wireNs}`
  }
}

initLogger(config)
```

ב-`server.ts` — השורה הראשונה:
```ts
import "./log-setup.js"   // חייב להיות לפני שאר ה-imports
```

### initLogger — Frontend

ב-`app.html`:
```html
<script>
(function () {
  var p = new URLSearchParams(location.search);
  function pick(k, ls) {
    var v = p.get(k);
    if (v != null) {
      if (p.get('logSticky') === '1') localStorage.setItem(ls, v);
      return v;
    }
    return localStorage.getItem(ls);
  }
  // ?wire=1|acp|ws — shortcut
  var wire = p.get('wire') || localStorage.getItem('LOG_WIRE');
  window.__LOG__ = {
    level: pick('log', 'LOG_LEVEL') || (wire ? 'trace' : 'info'),
    ns: pick('logNs', 'LOG_NS') || (wire === '1' ? 'fe.ws.wire.*' :
                                     wire === 'ws' ? 'fe.ws.wire.*' : '*'),
    format: pick('logFormat', 'LOG_FORMAT') || 'pretty',
    remote: pick('logRemote', 'LOG_REMOTE') === '1',
  };
})();
</script>
```

ב-`packages/frontend/src/lib/log.ts`:
```ts
import { initLogger, createLogger } from "@drive-coding/core/log"

declare global {
  interface Window { __LOG__: import("@drive-coding/core/log").LogConfig }
}

initLogger(window.__LOG__)
export { createLogger }
```

### Dual transport (Backend)

לבחור: nativeLog עם pino transport, או פשוט להכניס שני sinks (`addSink`) לpretty+json. הפתרון הפשוט יותר:

```ts
// ב-log/index.ts (Node)
if (config.format === "pretty" || config.format === "both") {
  addSinkStderrPretty()
}
if (config.format === "json" || config.format === "both") {
  addSinkStdoutJson()
}
```

השני יותר טבעי כי מאפשר sink-ים מותאמים בהמשך (remote, file, וכו') בלי לערב את pino.

---

## Phase 2 — Wire-level tracing

שלוש הוספות בלבד:

### א. ACP wire ב-`packages/backend/src/acp/ws-streams.ts`

```ts
import { createLogger } from "@drive-coding/core/log"

const wireRx = createLogger("backend.acp.wire").ns("rx")
const wireTx = createLogger("backend.acp.wire").ns("tx")

// ב-incoming (line 47, אחרי filter ה-stdio-to-ws):
wireRx.trace(
  { len: text.length, text: text.length > 2000 ? `${text.slice(0, 2000)}…` : text },
  "frame"
)

// ב-outgoing write (line 92, אחרי ws.send):
wireTx.trace(
  { len: line.length, text: line.length > 2000 ? `${line.slice(0, 2000)}…` : line },
  "frame"
)
```

### ב. BE↔FE wire ב-`packages/backend/src/delivery/ws-agent.ts`

```ts
import { createLogger } from "@drive-coding/core/log"

const wsWireLog = createLogger("backend.ws.wire")

// ב-message handler (line 68):
wsWireLog.ns("rx").trace(
  { agentId: ws.data.agentId, len: String(raw).length,
    text: String(raw).length > 1000 ? `${String(raw).slice(0, 1000)}…` : String(raw) },
  "frame"
)

// ב-send() helper (line 15):
function send(ws, msg) {
  const json = JSON.stringify(msg)
  wsWireLog.ns("tx").trace(
    { agentId: ws.data.agentId, type: msg.type, len: json.length },
    "frame"
  )
  try { ws.send(json) } catch { /* closed */ }
}
```

### ג. FE wire ב-`packages/frontend/src/lib/stores/agent-session.svelte.ts`

```ts
import { createLogger } from "$lib/log"
const wireLog = createLogger("fe.ws.wire")

// ws.onmessage:
ws.onmessage = (e) => {
  const raw = String(e.data)
  wireLog.ns("rx").trace(
    { len: raw.length, text: raw.length > 1000 ? `${raw.slice(0, 1000)}…` : raw },
    "frame"
  )
  handle(raw)
}

// ב-sendPrompt/sendRaw/cancel — רגע לפני ws.send():
wireLog.ns("tx").trace({ type: "prompt", len: json.length }, "frame")
ws.send(json)
```

### Phase 2 — DoD

- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test` ירוקים
- [ ] **הפעלה ידנית BE:** עצור את backend ב-tmux `be`, הרץ `LOG_WIRE=acp bun --watch src/server.ts`, צור agent חדש (curl ל-`POST /api/agents`), שלח prompt, וודא שמופיע פלט `TRACE (backend.acp.wire.rx) frame ...` עם NDJSON של ACP. **צלם 5 שורות של הפלט וצטט ב-commit message.**
- [ ] **הפעלה ידנית FE:** פתח tab בdpdfn ל-`https://your-app.nue.tuns.sh/?wire=1`, פתח DevTools console, ש-`fe.ws.wire` לוגים מופיעים. צטט console output ב-commit.
- [ ] **וודא שאין regression:** שלח voice prompt, וודא שAUTH_chunk באמת מתקבל ב-FE ומושמע. **Wire tracing לא אמור להפיל פונקציונליות.**
- [ ] הרץ `Task(subagent_type="verifier-phase", ...)` — ראה תבנית בסוף ה-plan
- [ ] Commit: `feat(log): wire-level tracing ל-ACP + FE↔BE WS`

---

## Phase 3 — Backend conversion + correlation IDs

### Coverage Map

| קובץ | Namespace ראשי | Logs |
|--------|----------------|------|
| `server.ts` | `backend.server` | `info`: listening; `error`: boot failures |
| `agent-orchestrator.ts` | `backend.orchestrator` | `info`: createAndSpawn (start+done), deleteAndKill; `warn`: crash with code; `error`: cleanup failures |
| `bridge-spawn.ts` | `backend.bridge.spawn` | `info`: spawn args + port detected (dur); `warn`: timeout; `error`: ENOENT; **`trace`**: stderr lines (one per line) |
| `bridge-manager.ts` | `backend.bridge.manager` | `info`: spawn ok (port, pid); `info`: kill; `warn`: crash handler threw |
| `acp-transport.ts` | `backend.acp.transport` | `debug`: rpcs (`→ initialize`, `← initialize ok`, `→ newSession`, ...); `info`: phase boundaries (initialize done dur, newSession done sessionId); `warn`: auth_required, `-32601` listSessions fallback |
| `ws-streams.ts` | `backend.acp.streams` + `backend.acp.wire` | `debug`: non-ACP frame swallowed (type); `trace`: wire (Phase 2) |
| `client-impl.ts` | `backend.acp.client` | `debug`: incoming session_update type; `trace`: fs handler hits |
| `agent-session.ts` | `backend.session` + `.audio` + `.tts` | ראה פירוט למטה |
| `voice/pipeline.ts` | `backend.voice.{stt,translate,tts}` | ראה פירוט למטה |
| `voice/narration.ts` | `backend.voice.narration` | `debug`: cache hit/miss + key; `info`: narrate done (dur, len) |
| `ws-agent.ts` | `backend.ws.agent` + `.wire` | `info`: connect/disconnect; `warn`: silent JSON parse; `trace`: wire (Phase 2) |
| `http-agents.ts` | `backend.http.agents` | `debug`: hits; `info`: create/delete; `warn`: errors |
| `http-history.ts` | `backend.http.{projects,sessions,recordings,fs}` | `debug`: hits; `warn`: 404/403 |

### Correlation IDs

**מטרה:** לאפשר `grep promptId=p_abc12 /tmp/be.log` ולקבל את כל ה-pipeline של prompt אחד.

ב-`agent-session.ts`, בתחילת `sendAudioPrompt`:

```ts
const promptId = crypto.randomUUID().slice(0, 8)
const log = baseLog.child({ agentId: opts.agentId, promptId })

log.info({ bytes: audioBytes.length, mimeType }, "sendAudioPrompt start")
const t0 = performance.now()

// שלב 1: recording save
if (opts.recordingsStore) {
  const tRec = performance.now()
  try {
    const { id: recordingId } = await opts.recordingsStore.save(audioBytes, mimeType)
    log.debug({ recordingId, dur: performance.now() - tRec }, "recording saved")
    broadcast({ type: "audio_recording_saved", recordingId, mimeType })
  } catch (e) {
    log.warn({ err: String(e) }, "recording save failed")
  }
}

// שלב 2: STT
const tStt = performance.now()
const sttRes = await transcribeUserAudio({ bytes: audioBytes, mimeType }, voiceConfig, registries, log)
if (sttRes.isErr()) {
  log.warn({ err: sttRes.error }, "STT failed")
  callbacks.onError(sttRes.error)
  return
}
log.info({ dur: performance.now() - tStt, len: sttRes.value.length }, "STT done")
// ...
```

ב-`voice/pipeline.ts` — מקבל logger אופציונלי:

```ts
export async function transcribeUserAudio(
  audio,
  config,
  registries,
  parentLog = baseLog,
): Promise<Result<string, string>> {
  const log = parentLog.ns("stt")
  log.debug({ bytes: audio.bytes.length, model: config.sttModel }, "start")
  // ...
}

export async function speakSentence(text, config, registries, cache, onChunk, parentLog = baseLog) {
  const log = parentLog.ns("tts")
  const key = await cacheKeyFor(text, config.ttsVoiceId, config.ttsModel)
  const cached = await cache.get(key)
  if (cached) {
    log.debug({ cache: "hit", key: key.slice(0, 8), bytes: cached.length }, "served from cache")
    onChunk(...)
    return ok(undefined)
  }
  const t0 = performance.now()
  // ... TTS call ...
  log.info({ cache: "miss", dur: performance.now() - t0, bytes: mp3Bytes.length }, "tts done")
}
```

ב-`processQueue` — ה-`ttsActive` transitions (קריטי לבאג!):

```ts
async function processQueue(): Promise<void> {
  if (ttsActive) {
    log.ns("tts").debug({ queueLen: sentenceQueue.length }, "processQueue called but ttsActive=true — skip")
    return
  }
  log.ns("tts").debug({ queueLen: sentenceQueue.length }, "ttsActive: false→true")
  ttsActive = true
  while (sentenceQueue.length > 0 && !audioPromptCancelled) {
    const job = sentenceQueue.shift()
    if (!job) break
    log.ns("tts").debug({ kind: job.kind, segmentId: job.segmentId.slice(0, 8) }, "processing job")
    // ...
  }
  log.ns("tts").debug({}, "ttsActive: true→false")
  ttsActive = false
}
```

### info budget פר voice prompt

ברירת מחדל `LOG_LEVEL=info`, voice prompt בריא ייראה ככה (~7 שורות):

```
INFO  (backend.session.audio)  sendAudioPrompt start  agent=f0f27 promptId=p_abc12 bytes=14523
DEBUG (backend.session.audio)  recording saved        ... (debug — לא יופיע ב-info)
INFO  (backend.voice.stt)      STT done               agent=f0f27 promptId=p_abc12 dur=767 len=42
INFO  (backend.acp.transport)  → prompt               agent=f0f27 promptId=p_abc12 sessionId=ses_...
INFO  (backend.acp.transport)  ← prompt done          agent=f0f27 promptId=p_abc12 dur=3210 stopReason=end_turn
INFO  (backend.voice.tts)      tts done (segment 1)   agent=f0f27 promptId=p_abc12 dur=543 bytes=18243 cache=miss
INFO  (backend.voice.tts)      tts done (segment 2)   agent=f0f27 promptId=p_abc12 dur=312 bytes=14821 cache=hit
INFO  (backend.session.audio)  sendAudioPrompt done   agent=f0f27 promptId=p_abc12 dur=4521 segments=2
```

כל השאר (sentence boundaries, queue transitions, cache keys, notification types) זה `debug`.
NDJSON גולמי זה `trace` עם `LOG_WIRE=acp`.

### הסבת console.log קיימים

רשימה מלאה (~20 callsites):

| קובץ:שורה | היום | אחרי |
|------------|--------|--------|
| `server.ts:143` | `console.log("[backend] listening on http://localhost:${port}")` | `log.info({ port }, "listening")` |
| `agent-orchestrator.ts:73` | `console.warn("[orchestrator] bridge ${bridgeId} crashed with code ${exitCode}")` | `log.warn({ bridgeId, exitCode }, "bridge crashed")` |
| `agent-orchestrator.ts:75` | `console.error("[orchestrator] crash cleanup failed:", e)` | `log.error({ err: e }, "crash cleanup failed")` |
| `agent-session.ts:116` | `console.error("[agent-session] subscriber threw:", e)` | `log.error({ err: e }, "subscriber threw")` |
| `agent-session.ts:254` | `console.warn` על stopReason | `log.warn({ stopReason }, "non-end-turn")` |
| `agent-session.ts:298` | `console.warn("[agent-session] failed to save recording:", e)` | `log.warn({ err: e }, "recording save failed")` |
| `agent-session.ts:418` | `console.warn` על translation | `log.warn({ err, charLen }, "translation failed — skip")` |
| `acp-transport.ts:55,181,317` | `console.log` עם timing | `log.debug` (timing אוטומטי ע"י pino time) |
| `ws-streams.ts:47` | `console.warn("[ws-streams] dropped non-ACP frame:", ...)` | `log.warn({ text: trunc(text, 200) }, "dropped non-ACP frame")` |
| `bridge-manager.ts:29` | `console.error("[bridge-manager] crash handler threw:", e)` | `log.error({ err: e }, "crash handler threw")` |
| `ws-agent.ts:97,103,131` | `console.error` על sendPrompt/cancel/sendAudio | `log.error({ err: e, op }, "operation failed")` |
| `player.ts:26,43` (FE) | `console.error("[audio-queue] ...")` | `log.error({ err: e, op }, "playback error")` |

### שגיאות שותקות לחשוף

סוכן חייב להוסיף `log.warn` לכל אחד מאלה:

| קובץ:שורה | מה שותק | Log חדש |
|------------|-----------|----------|
| `ws-agent.ts:71-74` | `JSON.parse` fail → `send error INVALID_JSON` אבל אין log | `log.warn({ raw: trunc(String(raw), 200) }, "JSON parse failed")` |
| `voice-session.svelte.ts:113-115` | `try { ... } catch { /* ignore parse errors */ }` | `log.warn({ err, raw: trunc(raw, 200) }, "voice msg parse failed")` |
| `audio/player.ts:60-62` | `play().catch(() => {})` בreplay | `log.warn({ err: e }, "replay autoplay blocked")` |
| `voice-pipeline (multiple)` | `generateText.catch(() => "")` | `log.warn({ err }, "narration gen returned empty")` |
| `narration.ts (if applicable)` | כל try/catch ריק | `log.debug` עם error |
| `recordings-store.ts` (if applicable) | אם יש silent fs errors | מתאים |

---

## Phase 4 — Frontend conversion

### Coverage Map

| קובץ | Namespace | Logs |
|--------|-----------|------|
| `agent-session.svelte.ts` | `fe.session` + `fe.ws` + `fe.ws.wire` | `info`: connect, reconnect attempt, close; `debug`: bubble add/update, history events, recordingId set; `warn`: silent parse |
| `voice-session.svelte.ts` | `fe.voice` | `info`: state transitions (idle→recording→thinking→speaking); `debug`: audio_chunk received (segmentId, kind, bytes), segmentCache idempotency skip; `warn`: silent parse |
| `audio/player.ts` | `fe.audio.player` | `debug`: enqueue (bytes), tick start/end, ended event; `warn`: autoplay blocked, playback error |
| `audio/recorder.ts` | `fe.audio.recorder` | `info`: start, stop (bytes, dur); `error`: mic permission denied |
| `stores/projects-store.svelte.ts` | `fe.api` | `debug`: fetch projects, fetch sessions; `warn`: failed |
| `stores/settings-store.svelte.ts` | `fe.settings` | `debug`: load/save; `warn`: localStorage errors |
| Routes (`+page.svelte` ב-agent) | `fe.route.agent` | `info`: mount, agentId; `debug`: navigation |

### Lifecycle logging — `agent-session.svelte.ts`

```ts
const log = createLogger("fe.session").child({ agentId })

function connect(): void {
  if (ws) return
  log.info({}, "WS connect attempt")
  // ...
  ws.onopen = () => {
    log.info({ retries: retryCount }, "WS open")
    retryCount = 0
  }
  ws.onclose = () => {
    log.info({ wasOpen: status === "connected", intentional: intentionallyClosed }, "WS close")
    // ...
  }
  ws.onerror = () => {
    log.warn({}, "WS error")
    // ...
  }
}

function scheduleReconnect(): void {
  const attempt = retryCount + 1
  const delay = ...
  log.info({ attempt, delay }, "scheduling reconnect")
  // ...
}
```

### Voice state transitions — `voice-session.svelte.ts`

```ts
const log = createLogger("fe.voice").child({ agentId: agentSession.agentId })

function setState(next: VoiceState) {
  if (voiceState === next) return
  log.info({ from: voiceState, to: next }, "state transition")
  voiceState = next
}

// ב-audio_chunk handler:
log.debug(
  { segmentId: segmentId?.slice(0, 8), kind, originalLen: originalText?.length,
    translatedLen: translatedText?.length, messageId: messageId?.slice(0, 8) },
  "audio_chunk received"
)

if (segmentId && segmentCache.has(segmentId)) {
  log.debug({ segmentId: segmentId.slice(0, 8) }, "duplicate segment — skip")
  break
}
```

### AudioQueue — `audio/player.ts`

```ts
const log = createLogger("fe.audio.player")

enqueue(mp3Base64: string): void {
  log.debug({ bytes: mp3Base64.length, queueLen: this.queue.length, playing: this.playing }, "enqueue")
  // ...
}

private tick(): void {
  if (this.playing) {
    log.debug({}, "tick: already playing — skip")
    return
  }
  const next = this.queue.shift()
  if (!next) {
    log.debug({}, "tick: queue empty")
    return
  }
  log.debug({ queueLeft: this.queue.length }, "tick: play next")
  // ...
}
```

### מתי לוגוט bubble mutations

ב-`appendBubbleChunk`, `appendToolBubble`, `addTranslatedSegment`:
```ts
log.debug(
  { kind, messageId: messageId?.slice(0, 8), op: "appendChunk", len: text.length },
  "bubble update"
)
```

ב-`audio_recording_saved`:
```ts
log.debug({ recordingId: msg.recordingId.slice(0, 8) }, "recording received from BE")
```

### Phase 4 — DoD

- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test` ירוקים
- [ ] **הפעלה ידנית:** פתח דפדפן ל-`https://your-app.nue.tuns.sh/?log=debug&logNs=fe.voice,fe.audio.*`. פתח DevTools console. שלח voice prompt. **חייב לראות**:
   - `INFO (fe.voice) state transition from=idle to=recording`
   - `INFO (fe.voice) state transition from=recording to=transcribing`
   - `INFO (fe.voice) state transition from=transcribing to=thinking`
   - `INFO (fe.voice) state transition from=thinking to=speaking`
   - `DEBUG (fe.audio.player) enqueue bytes=...`
   - `DEBUG (fe.audio.player) tick: play next`
- [ ] **אין regression ב-voice flow:** voice prompt → שמיעה עובד מקצה לקצה.
- [ ] **שגיאות שותקות חשופות:** באג JSON parse ב-`voice-session.svelte.ts:113` וב-`audio/player.ts:60` הופכים ל-`log.warn`. וודא ע"י grep `LOG_LEVEL` שאין `} catch { }` ריקים.
- [ ] הרץ `Task(subagent_type="verifier-phase", ...)` — ראה תבנית בסוף ה-plan
- [ ] Commit: `feat(log): frontend conversion עם state transitions ו-WS lifecycle`

---

## Phase 5 — Remote sink

### Frontend — pino's `browser.transmit`

```ts
// packages/core/src/log/browser.ts
import pino from "pino"

export function initLogger(config: LogConfig) {
  const logger = pino({
    level: config.level,
    browser: {
      asObject: true,
      transmit: {
        level: "info",
        send(level, logEvent) {
          if (!config.remote) return
          const entry = {
            ts: logEvent.ts,
            level,
            ns: extractNs(logEvent),
            msg: logEvent.messages[0],
            fields: logEvent.bindings.reduce((a, b) => ({ ...a, ...b }), {}),
          }
          buffer.push(entry)
          schedule()
        },
      },
    },
  })
  // ...
}

const buffer: LogEntry[] = []
let timer: number | null = null

function schedule() {
  if (buffer.length >= 50) flush()
  else if (!timer) timer = window.setTimeout(flush, 250)
}

function flush() {
  if (timer) { clearTimeout(timer); timer = null }
  if (buffer.length === 0) return
  const payload = JSON.stringify({ entries: buffer.splice(0) })
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/client-log",
      new Blob([payload], { type: "application/json" }))
  } else {
    fetch("/api/client-log", { method: "POST", body: payload, keepalive: true })
      .catch(() => { /* silent */ })
  }
}

window.addEventListener("beforeunload", flush)
window.addEventListener("pagehide", flush)
```

### Backend — `POST /api/client-log`

קובץ חדש: `packages/backend/src/delivery/http-client-log.ts`

```ts
import { createLogger } from "@drive-coding/core/log"
import { type } from "arktype"
import type { Hono } from "hono"

const ClientLogEntry = type({
  ts: "number",
  level: "'error'|'warn'|'info'|'debug'|'trace'",
  ns: "string",
  "msg?": "string",
  "fields?": "object",
})
const ClientLogPayload = type({ entries: [ClientLogEntry] })

const clientLog = createLogger("client")

// rate limit פשוט: max 500 entries / IP / minute
const ipBuckets = new Map<string, { count: number; resetAt: number }>()
function checkRateLimit(ip: string, count: number): boolean {
  const now = Date.now()
  let bucket = ipBuckets.get(ip)
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + 60_000 }
    ipBuckets.set(ip, bucket)
  }
  bucket.count += count
  return bucket.count <= 500
}

export function registerClientLogHttp(app: Hono): void {
  app.post("/api/client-log", async (c) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon"

    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: "bad json" }, 400) }

    const parsed = ClientLogPayload(body)
    if (parsed instanceof type.errors) {
      return c.json({ error: parsed.summary }, 400)
    }

    if (!checkRateLimit(ip, parsed.entries.length)) {
      return c.body(null, 429)
    }

    for (const e of parsed.entries) {
      const sub = clientLog.ns(e.ns)
      const fn = sub[e.level] ?? sub.info
      fn.call(sub, e.fields ?? {}, e.msg ?? "")
    }
    return c.body(null, 204)
  })
}
```

ב-`server.ts`:
```ts
import { registerClientLogHttp } from "./delivery/http-client-log.js"
// ...
registerClientLogHttp(app)
```

### Tests

`packages/backend/tests/http-client-log.test.ts`:
- POST עם payload תקין → 204 + logs מופיעים תחת `client.*`
- POST עם bad JSON → 400
- POST עם entry invalid (`level: "verbose"`) → 400
- 500 entries מאותו IP בדקה → 429 על ה-501
- ns prefix: `entry.ns="fe.audio.player"` → `clientLog.ns("fe.audio.player")` → output ב-namespace `client.fe.audio.player`

### Phase 5 — DoD

- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test` ירוקים (כולל `http-client-log.test.ts` החדש)
- [ ] **הפעלה ידנית:** פתח `https://your-app.nue.tuns.sh/?log=info&logRemote=1`. צפה ב-`tail -f /tmp/be.log` (או tmux pane של be). **חייב לראות**:
   - פעולות FE → שורות בfit tail BE תחת namespace `client.fe.*`
   - לדוגמה: שלח voice prompt → בtail BE: `INFO (client.fe.voice) state transition from=idle to=recording ...`
- [ ] **Rate limit אמיתי:** curl עם 501 entries → מחזיר 429
- [ ] **Bad JSON:** `curl -X POST /api/client-log -d 'not json'` → 400
- [ ] **ולידציה:** entry עם `level: "verbose"` → 400
- [ ] **Off ברירת מחדל:** פתח URL ללא `?logRemote=1` → **אין** קריאות ל-`/api/client-log` ב-Network tab של DevTools
- [ ] הרץ `Task(subagent_type="verifier-phase", ...)` — ראה תבנית בסוף ה-plan
- [ ] Commit: `feat(log): remote sink — FE logs משוגרים ל-BE via POST`

---

## Phase 6 — Walkthrough

עדכון `docs/walkthrough.md` עם entry קצר:

```markdown
## 2026-05-17 ... — Logging infrastructure

### מה בוצע

- הוספת `packages/core/src/log/` מבוסס pino: Logger עם child fields, ns היררכי, sinks pluggable
- Backend: `log-setup.ts` עם dual transport (stdout JSON + stderr pretty)
- Frontend: inline script ב-app.html שטוען LogConfig מ-URL/LS
- Wire tracing: `backend.acp.wire.*` (ACP NDJSON), `backend.ws.wire.*` (FE↔BE), `fe.ws.wire.*` (FE side)
- LOG_WIRE shortcut: `LOG_WIRE=1|acp|ws` ב-BE, `?wire=1|acp|ws` ב-FE
- Remote sink: pino `browser.transmit` → POST /api/client-log → מופיע ב-namespace `client.*`
- גילוי 5 silent try/catch שכרגע אוכלים שגיאות → הופכים ל-warn

### איך להפעיל

- BE: `LOG_LEVEL=debug LOG_NS='backend.voice.*,backend.session.audio.*' bun run src/server.ts`
- BE wire: `LOG_WIRE=acp bun run src/server.ts`
- FE: פתח `?log=debug&logNs=fe.voice,fe.audio.*` ב-URL
- FE remote: `?log=debug&logRemote=1` → לוגים מהbrowser מופיעים ב-BE בtail
- Sticky: הוסף `&logSticky=1` → נשמר ב-localStorage לreload הבא

### Bugs שזיהוי המעקב חשף

- (ימולא ע"י סוכן אם נחשף משהו תוך כדי conversion)
```

---

## כללי שימוש ב-Logger (לסוכן ולעתיד)

### מה לוגוט (✅)

| סוג | Level | דוגמה |
|------|-------|---------|
| Lifecycle boundaries | info | server boot, agent created/crashed/deleted, WS connect/close |
| Request boundaries | info | sendAudioPrompt start/done, ACP prompt start/done |
| שלב במסלול ארוך | info | STT done, TTS done, ACP newSession done (עם dur) |
| State transition קריטי | debug | ttsActive false↔true, voice state transition, mic state |
| Cache hit/miss | debug | translate cache, TTS cache, narration cache |
| Decision branches | debug | sentence boundary detected, empty transcript → skip, history reconnect |
| Errors שמסוננות במידע | warn | translation timeout, empty transcript, retry exhausted, stopReason ≠ end_turn |
| Errors אמיתיים | error | spawn ENOENT, ACP transport down, JSON parse failure שגלוי |
| **שגיאות שכרגע שותקות** | warn | הכל מה-list ב-Phase 3 |

### מה לא לוגוט (❌)

| סוג | למה לא |
|------|---------|
| כניסה לפונקציה רגילה | Noise. רק boundaries. |
| כל text_chunk שמגיע | 50 chunks ל-prompt. רק sentence boundaries. |
| כל tick של AudioQueue | אם רוצה — `trace`, לא debug. |
| Heartbeat WS frames | מציפים. רק כשsuspect מה. |
| Loop iterations | רק boundaries. |
| Successful HTTP routes | `trace` ב-debug ניתן, ב-info לא. |
| Subscribe/unsubscribe רוטיניים | רק boundaries של סשן. |
| Field values שאינם actionable | `log.debug({ x: 1, y: 2 }, "got coords")` שמיש לאף אחד. |
| Audio bytes / image bytes / file content | רק `bytes=N`. |
| API keys / tokens | עיקרון אבטחה. |

### הכלל הקובע — **"5-7 שורות info"**

בbיצור רגיל (`LOG_LEVEL=info`), voice prompt בריא לא צריך לייצר יותר מ-5-7 שורות info. אם יש יותר — רוב הסיכויים ש-`info` הפך ל-`debug`.

### מבחן 4 השאלות

לפני שמוסיפים `log.<level>(...)`:

1. האם זה boundary של שלב במסלול עסקי?
2. האם הfields שאני שולח actionable?
3. האם זה ירוץ ביותר מ-3 פעמים בקריאה אחת ב-info?
4. האם זה fail mode שכרגע שותק?

אם ✅ לכל הארבעה → לוגוט.
אם 1-3 ✅ + 4 ❌ → הורד רמה ל-`debug` או ל-`trace`.
אם 4 ✅ → `warn` (חובה).

---

## Verifier-phase — תבנית קריאה

אחרי Phase 2, 4, 5 — הExecutor חייב להפעיל verifier-phase **לפני** שעובר לphase הבא.

```
Task(
  subagent_type="verifier-phase",
  description="Verify Phase X of logging-infra",
  prompt="""
Phase X של logging-infra הושלם.

Brief: docs/logging-plan.md (Phase X)
Template: docs/logging-template.md (ל-API reference)

Commit: <hash>
   git diff <prev-hash>..HEAD לראות מה השתנה.

הסביבה רצה:
- backend ב-tmux `be` (port 4000)
- frontend ב-tmux `fe` (port 5173)
- linux-gui browser זמין על port 9333
- tunnel: https://your-app.nue.tuns.sh

בדוק שכל ה-DoD items של Phase X באמת עובדים בסביבה אמיתית.
השתמש ב-`tail -f /tmp/be.log` ב-tmux לצפייה בפלט.
ב-FE: פתח DevTools console, הריץ flows קריטיים.

החזר דוח קצר לפי הפורמט שבפרומפט של verifier-phase.
"""
)
```

החלטה לפי הדוח:
- 0 bugs → ✅ commit + phase הבא
- 1-2 bugs → ⚠️ Executor מתקן בתוך אותו phase, commit נוסף
- 3+ bugs → ❌ STOP, החזרת control ל-Opus

---

## Verifier-slice — בסוף

אחרי Phase 6 (walkthrough), לפני "סיימתי":

```
Task(
  subagent_type="verifier-slice",
  description="Final verification of logging-infra",
  prompt="""
Slice logging-infra הושלם. Executor סיים את 6 ה-phases ועשה commit על כולם.

Brief: docs/logging-plan.md
Template: docs/logging-template.md
Commits: git log <base>..HEAD

הסביבה רצה: כמו ב-verifier-phase.

עבור על כל ה-DoD items (כל ה-Phase X DoD ב-plan), חפש regressions בvoice flow,
חפש bugs שלא ברשימה, וכתוב דוח מלא ב-docs/logging-verification-report.md.

שאלות מפתח לתשובה:
1. האם 5-7 שורות info ל-voice prompt? (לא יותר)
2. האם `LOG_WIRE=acp` באמת מציג NDJSON?
3. האם `?logRemote=1` באמת שולח לBE?
4. האם כל ה-`console.log/warn/error` הקיימים הוסבו ל-Logger?
5. האם 5+ silent try/catch חשופים עם log.warn?
6. האם ttsActive transitions מודפסים ב-`LOG_LEVEL=debug LOG_NS=backend.session.audio.*`?
7. האם הbug של audio_chunk-missing נחשף עכשיו?
"""
)
```

---

## איך להפעיל את הסליס

```ts
Task(
  subagent_type="executor",
  description="Implement logging infrastructure",
  prompt="""
Slice: logging-infra
Brief: docs/logging-plan.md
Template: docs/logging-template.md

Environment:
  - worktree (CWD): /home/user/projects/voice-acp-v2
  - branch: vnext (כבר checked out)
  - backend חי ב-tmux `be` (port 4000) — עם `bun --watch`, יתרענן אוטומטית כשתערוך קוד
  - frontend חי ב-tmux `fe` (port 5173, vite — HMR אוטומטי)
  - linux-gui browser זמין על port 9333 ל-verifier-phase
  - tunnel: https://your-app.nue.tuns.sh
  - tests: 308 backend + 119 frontend = 427 ירוקים

בצע את 6 ה-phases לפי המסמך, עקוב אחרי DoD פר phase.

Verifier-phase חובה אחרי Phase 2, 4, 5 (ראה תבנית ב-plan).
Verifier-slice חובה בסוף (ראה תבנית ב-plan).

מותר לערוך:
- packages/{core,backend,frontend}/src/**
- packages/{core,backend,frontend}/tests/**
- packages/{core,backend,frontend}/package.json (רק להוסיף pino + pino-pretty)
- packages/frontend/src/app.html (inline script)
- docs/walkthrough.md (Phase 6)
- docs/logging-verification-report.md (verifier-slice יכתוב)

אסור לערוך:
- docs/archive/**
- docs/reviews/**
- docs/logging-template.md (ה-spec)
- docs/logging-plan.md (המסמך הזה)
- הסקילים של סוכנים (~/.agents/...)

אסור:
- להוסיף תלויות מעבר ל-pino + pino-pretty
- להפיל את backend/frontend ב-tmux (השתמש ב-watch reload)
- לבייפס Logger עם console.log
- לעבור על כללי "מה לא לוגוט"

אם נתקעת:
- STOP, אל תנסה לפתור בעיות ארכיטקטוניות לבד
- החזר STATUS: BLOCKED עם ISSUE/SOURCE/TRIED/NEED
"""
)
```

---

## סדר ביצוע מומלץ

1. Opus סוקר את template + plan פעם אחרונה (✅ בוצע)
2. Opus קורא ל-`Task(subagent_type="executor", ...)` עם הפרומפט למעלה
3. Executor מבצע phase-by-phase, קורא ל-verifier-phase לפי הצורך
4. אם verifier-phase מחזיר 3+ bugs ב-phase → Executor STOP → Opus מתערב
5. בסוף — verifier-slice עם דוח ב-`docs/logging-verification-report.md`
6. Opus קורא דוח, מחליט: approve / fix iteration / brief מתוקן
7. אם הbug של audio_chunk-missing לא נחשף — עם הLogger פעיל, מריצים voice prompt עם `LOG_LEVEL=debug LOG_NS='backend.session.audio.*,backend.voice.*'` ומחפשים את ה-bottleneck
