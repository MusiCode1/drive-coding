# logging-infra — Verification Report

> **תאריך:** 2026-05-17
> **Commit בסיס:** `aa4244d` (base before slice)
> **Commits בסליס:** `aa4244d..daae5b5` (7 commits)
> **שיטה:** browser חי (linux-gui CDP), curl, קוד analysis, BE logs live
> **Screenshots:** `/tmp/verify/logging-infra/*.png`

---

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 19/27 |
| Regressions | 0 |
| Bugs חדשים (missing coverage) | 8 |
| Tests — core+backend | 489/490 (1 pre-existing flaky) |
| Tests — frontend | 119/119 ✅ |
| `LOG_WIRE=acp` NDJSON | ✅ עובד |
| `logRemote=1` → BE | ✅ עובד |
| `console.log` נותרו | ✅ אפס |
| ttsActive transitions | ✅ debug logging (⚠️ ns שגוי בDoD) |

---

## טבלת DoD items

### Phase 1 — core/log + tests

| # | Item | סטטוס | עדות |
|---|------|--------|------|
| 1 | `packages/core/src/log/types.ts` — Level, Fields, LogConfig, Logger | ✅ | קוד קיים, TypeScript valid |
| 2 | `packages/core/src/log/namespace.ts` — isEnabledForNs עם patterns | ✅ | 8 tests ירוקים |
| 3 | `packages/core/src/log/config.ts` — parseLogConfig + parseEnvConfig עם LOG_WIRE | ✅ | 13 tests + LOG_WIRE verified live |
| 4 | `packages/core/src/log/index.ts` — Node entry עם pino dual transport | ✅ | BE logs מופיעים ב-stdout+stderr |
| 5 | `packages/core/src/log/browser.ts` — Browser entry עם transmit | ✅ | logRemote=1 verified live |
| 6 | `package.json exports` — `"./log"` עם browser/default condition | ✅ | FE imports מצליחים |
| 7 | Tests: namespace.test.ts (8), config.test.ts (13), api.test.ts (9) = 30 | ✅ | 30/30 ירוקים |

### Phase 2 — Wire tracing

| # | Item | סטטוס | עדות |
|---|------|--------|------|
| 8 | ACP wire: `backend.acp.wire.tx/rx` — `TRACE frame` עם NDJSON | ✅ | `LOG_WIRE=acp` → TRACE frames עם JSON-RPC objects |
| 9 | BE↔FE wire: `backend.ws.wire.tx/rx` — traces ב-ws-agent.ts | ✅ | קוד קיים, namespace verified |
| 10 | FE wire: `fe.ws.wire.tx/rx` — traces ב-agent-session.svelte.ts | ✅ | `wireLog` initialized in code |
| 11 | pnpm typecheck + lint + test ירוקים (Phase 2) | ✅ | typecheck clean, lint 0 errors |

### Phase 3 — Backend conversion

| # | Item | סטטוס | עדות |
|---|------|--------|------|
| 12 | `server.ts` — `log.info({ port }, "listening")` | ✅ | BE log: `INFO (backend.server) listening port=4000` |
| 13 | `agent-orchestrator.ts` — createAndSpawn start/done, deleteAndKill | ✅ | BE log מאומת |
| 14 | `bridge-manager.ts` — spawn ok, kill, crash handler | ✅ | BE log מאומת |
| 15 | `acp-transport.ts` — initialize done, newSession done | ✅ | BE log מאומת |
| 16 | `agent-session.ts` — sendAudioPrompt start/done, STT done, ACP prompt | ✅ | קוד מאומת — 5 info lines לvoice prompt |
| 17 | `ws-agent.ts` — WS connect/disconnect, JSON parse warn | ✅ | BE log: `INFO (backend.ws.agent) WS connect/disconnect` |
| 18 | Correlation IDs: `promptId` ב-sendAudioPrompt via `log.child` | ✅ | קוד: `log = baseLog.ns("audio").child({ promptId })` |
| 19 | Silent errors: ws-agent JSON parse → log.warn | ✅ | `log.warn({raw},"JSON parse failed")` בקוד |
| 20 | **`voice/pipeline.ts` — parentLog parameter + logs** | ❌ | **MISSING** — 0 שורות logging ב-pipeline.ts |
| 21 | **`voice/narration.ts` — backend.voice.narration logs** | ❌ | **MISSING** — 0 שורות logging ב-narration.ts |
| 22 | **`agent-session.ts:385` — narrationGenerator catch → log.warn** | ❌ | **MISSING** — `} catch { return "" }` עדיין שותק |

### Phase 4 — Frontend conversion

| # | Item | סטטוס | עדות |
|---|------|--------|------|
| 23 | `agent-session.svelte.ts` — fe.session, WS lifecycle logs | ✅ | Browser console: `INFO (fe.session) WS connect attempt/open/close` |
| 24 | `voice-session.svelte.ts` — fe.voice state transitions + audio_chunk | ✅ | `setState` → `log.info({from,to},"state transition")`; audio_chunk → `log.debug` |
| 25 | `audio/player.ts` — fe.audio.player enqueue + tick + warn | ✅ | קוד מאומת, log.warn ל-autoplay blocked |
| 26 | **`audio/recorder.ts` — fe.audio.recorder logs** | ❌ | **MISSING** — 0 שורות logging |
| 27 | **`stores/projects-store.svelte.ts` — fe.api debug+warn** | ❌ | **MISSING** — 0 שורות logging |
| 28 | **`stores/settings-store.svelte.ts` — fe.settings debug+warn** | ❌ | **MISSING** — 0 שורות logging |
| 29 | **`routes/agent/[id]/+page.svelte` — fe.route.agent logs** | ❌ | **MISSING** — 0 שורות logging |
| 30 | Silent errors FE: voice-session parse → log.warn | ✅ | `log.warn({err,raw},"voice msg parse failed")` בקוד |
| 31 | Silent errors FE: audio/player replay → log.warn | ✅ | `log.warn({err},"replay autoplay blocked")` בקוד |

### Phase 5 — Remote sink

| # | Item | סטטוס | עדות |
|---|------|--------|------|
| 32 | `POST /api/client-log` — 204 עם payload תקין | ✅ | `curl → HTTP 204`, BE log: `INFO (client.fe.test) test from client` |
| 33 | `POST /api/client-log` — 400 עם bad JSON | ✅ | `curl -d 'not json' → HTTP 400 {"error":"bad json"}` |
| 34 | `POST /api/client-log` — 400 עם invalid level ("verbose") | ✅ | `curl → HTTP 400 {"error":"...must be..."}` |
| 35 | `POST /api/client-log` — 429 ב-501 entries | ✅ | `curl עם 501 entries → HTTP 429` |
| 36 | ns prefix: `fe.audio.player` → `client.fe.audio.player` | ✅ | בדוק בקוד + manual curl |
| 37 | `?logRemote=1` שולח לגITT BE | ✅ | Browser → BE log: `INFO (client.fe.session) WS connect attempt/open` |
| 38 | ללא `?logRemote=1` → אין קריאות ל-`/api/client-log` | ✅ | Default `remote: false` בקוד |
| 39 | `http-client-log.test.ts` — 6 tests | ✅ | קובץ קיים עם 6 test cases |
| 40 | pnpm test ירוקים (כולל http-client-log) | ⚠️ | 489/490 (1 pre-existing timeout ב-bridge-manager) |

### Phase 6 — Walkthrough

| # | Item | סטטוס | עדות |
|---|------|--------|------|
| 41 | `docs/walkthrough.md` עדכון עם logging-infra entry | ✅ | Commit `daae5b5` |

---

## שאלות המפתח — תשובות

### 1. האם 5-7 שורות info לvoice prompt?

**✅ כן — 5 שורות בדיוק** (per code analysis, מכיוון שלא הצלחתי לבצע voice prompt אמיתי בסביבת הverification):

```
INFO (backend.session.audio)  sendAudioPrompt start    agentId=X promptId=Y bytes=N
INFO (backend.session.audio)  STT done                 dur=N len=N
INFO (backend.session.audio)  → ACP prompt             len=N
INFO (backend.session.audio)  ← ACP prompt done        dur=N stopReason=end_turn
INFO (backend.session.audio)  sendAudioPrompt done     dur=N stopReason=end_turn
```

⚠️ **הערה:** TTS "tts done" lines חסרות (pipeline.ts ריק מlogging) — אבל זה מוריד ל-5 שורות, not violating 5-7 rule.

### 2. האם LOG_WIRE=acp באמת מציג NDJSON?

**✅ כן.** הפעלת `LOG_WIRE=acp bun run src/server.ts` + יצירת agent:

```
TRACE (backend.acp.wire.tx) frame  len=203  text={"jsonrpc":"2.0","id":0,"method":"initialize",...}
TRACE (backend.acp.wire.rx) frame  len=433  text={"jsonrpc":"2.0","id":0,"result":{...}}
TRACE (backend.acp.wire.tx) frame  len=87   text={"jsonrpc":"2.0","id":1,"method":"session/new",...}
TRACE (backend.acp.wire.rx) frame  len=2894 text={"jsonrpc":"2.0","id":1,"result":{"sessionId":...}}
```

⚠️ **gotcha discovered:** Log ריק עד שה-process מבצע פעולה ראשונה. stdout buffer לא נשטף על boot בלבד.

### 3. האם ?logRemote=1 באמת שולח לBE?

**✅ כן.** ניווט ל-`http://192.168.x.x:5173/agent/AGENT_ID?logRemote=1&log=info` → BE log קיבל:

```
INFO (client.fe.session)  WS connect attempt  agentId=79b42429...
INFO (client.fe.session)  WS open             agentId=79b42429...  retries=0
```

### 4. האם כל ה-console.log הקיימים הוסבו ל-Logger?

**✅ כן.** grep על backend + frontend לא מצא אף `console.` בקוד src:

```bash
grep -rn "console\." packages/{backend,frontend}/src/ --include="*.ts" --include="*.svelte"
# → 0 results
```

### 5. האם 5+ silent try/catch חשופים עם log.warn?

**⚠️ חלקית — 4/6 מהplaned items בוצעו:**

| item | סטטוס |
|------|--------|
| ws-agent.ts JSON parse → log.warn | ✅ |
| voice-session.svelte.ts voice msg parse → log.warn | ✅ |
| audio/player.ts replay autoplay → log.warn | ✅ |
| audio/player.ts play() autoplay → log.warn | ✅ |
| agent-session.ts:385 narrationGenerator catch{return ""} → log.warn | ❌ עדיין שותק |
| +page.svelte agent: deleteAgent silent, polling silent | ❌ לא נוגעו |

### 6. האם ttsActive transitions מודפסים ב-LOG_LEVEL=debug LOG_NS=backend.session.tts?

**❌ לא** — ה-DoD Q6 כפי שנוסח לא עובד. הסיבה:

- ה-namespace האמיתי הוא **`backend.session.audio.tts`** (לא `backend.session.tts`)
- `log` ב-sendAudioPrompt = `baseLog.ns("audio").child({ promptId })` → ns=`backend.session.audio`
- processQueue קורא `log.ns("tts")` → ns=`backend.session.audio.tts`
- Pattern `backend.session.tts` **לא מתאים** ל-`backend.session.audio.tts` (verified with isEnabledForNs test)

✅ **ttsActive transitions קיימים** ועובדים — פשוט צריך `LOG_NS=backend.session.audio.*` או `LOG_NS=backend.session.audio.tts`.

### 7. האם הbug של audio_chunk-missing נחשף עכשיו?

**⚠️ חלקית** — ה-logging שהוסף (`audio_chunk received`, `ttsActive false→true`, `ttsActive true→false`) יאפשר debugging אם הבאג יתרחש. אך:
- **pipeline.ts חסר logging** — אם TTS נכשל שם, לא נדע
- **narrationGenerator השותק** עדיין מסתיר שגיאות אפשריות
- Flow לא בוצע בפועל בverification (voice prompt דורש mic)

---

## Flows שעבדו מקצה לקצה

- ✅ **Backend startup** — `INFO (backend.server) listening port=4000` תוך <1s
- ✅ **Agent creation** — `createAndSpawn start/done`, `spawn ok`, `initialize done`, `newSession done`
- ✅ **WS connect** — FE מתחבר ל-BE, שני הצדדים לוגוטים connect/disconnect
- ✅ **WS reconnect after reload** — reload → `WS close` → `WS open` — documented ב-BE log
- ✅ **LOG_WIRE=acp** — NDJSON frames ב-trace level, truncated ל-2000 chars
- ✅ **logRemote=1** — FE logs מגיעים ל-BE תחת `client.fe.*` namespace
- ✅ **POST /api/client-log** — 204, 400 (bad JSON), 400 (invalid level), 429 (rate limit)
- ✅ **FE Logger initialization** — `window.__LOG__` נטען מURL params, pino/browser מאותחל
- ✅ **Mobile + Desktop render** — UI מוצג נכון ב-390×844 וב-1280×800

---

## Flows שנשברו

- ❌ **DoD Q6 exact** — `LOG_NS=backend.session.tts` לא חושף ttsActive (ns שגוי ב-DoD)
- ⚠️ **Voice prompt E2E** — לא בוצע בפועל (דורש mic access בסביבת linux-gui)

---

## Regressions

**אין.** בדיקות regression:
- `pnpm test` frontend: 119/119 ✅ (זהה לפני)
- `pnpm test` core+backend: 489/490 (1 timeout ב-bridge-manager — pre-existing, last modified slice-3)
- `pnpm typecheck`: 0 errors ✅
- Visual regression: UI מוצג נכון, "connected" badge פועל

---

## Bugs חדשים שלא ברשימה (missing coverage from plan)

### NBug1: `voice/pipeline.ts` — אפס logging ❌
**מניפסטציה:** `LOG_LEVEL=debug LOG_NS=backend.voice.*` לא מציג כלום מ-pipeline.ts (STT, TTS)
**Plan אמר:** `parentLog` parameter ל-`transcribeUserAudio`, `speakSentence`, plus `log.info("tts done")`, `log.debug("cache hit/miss")`
**חומרה:** Medium — TTS failures שותקים, אי-אפשר לדבג audio_chunk-missing bug כפי שהplan ייעד
**שורות: 0** ב-`packages/backend/src/voice/pipeline.ts`

### NBug2: `voice/narration.ts` — אפס logging ❌
**מניפסטציה:** narration cache hits/misses שותקים
**Plan אמר:** `backend.voice.narration` — `debug`: cache hit/miss; `info`: narrate done (dur, len)
**חומרה:** Low — narration שגיאות מוחזרות כ-err(), לא שותקות לגמרי

### NBug3: `agent-session.ts:385` narrationGenerator — silent catch ❌
```ts
try {
  const { text } = await generateText({ model, prompt })
  return text
} catch {
  return ""  // ← STILL SILENT
}
```
**חומרה:** Medium — narration failures שותקות לחלוטין. Plan Q5 פירוש "generate Text.catch(() => '') → log.warn"

### NBug4: `stores/projects-store.svelte.ts` — אפס logging ❌
**Plan Phase 4 Coverage Map אמר:** `fe.api` — debug: fetch projects/sessions; warn: failed
**חומרה:** Low-Medium — fetch failures שותקות (catch→return[])

### NBug5: `stores/settings-store.svelte.ts` — אפס logging ❌
**Plan Phase 4 Coverage Map אמר:** `fe.settings` — debug: load/save; warn: localStorage errors
**חומרה:** Low — localStorage parse failures שותקות (catch→return DEFAULTS)

### NBug6: `audio/recorder.ts` — אפס logging ❌
**Plan Phase 4 Coverage Map אמר:** `fe.audio.recorder` — info: start, stop (bytes, dur); error: mic permission denied
**חומרה:** Medium — mic permission denied לא נלוג ב-recorder (רק ב-voice-session wrapper)

### NBug7: `routes/agent/[id]/+page.svelte` — אפס logging ❌
**Plan Phase 4 Coverage Map אמר:** `fe.route.agent` — info: mount, agentId; debug: navigation
**חומרה:** Low — 2 silent catches נוספים (polling fetch fail, deleteAgent fail)

### NBug8: DoD Q6 namespace mismatch ⚠️
**תיאור:** Plan אומר `LOG_NS=backend.session.tts` אבל actual namespace הוא `backend.session.audio.tts`
**השפעה:** כל user שינסה להפעיל ttsActive debug לפי הדוקומנטציה יקבל תוצאה ריקה
**תיקון:** `LOG_NS=backend.session.audio.*` עובד. Plan צריך עדכון.
**חומרה:** Low-Medium (documentation bug)

---

## סיווג ל-patterns.md

| באג | קטגוריה | הערה |
|-----|---------|------|
| pipeline.ts no logging | קטגוריה 3 (Spec Drift) | Brief specified parentLog — not implemented |
| narration.ts no logging | קטגוריה 3 (Spec Drift) | Brief specified backend.voice.narration — missing |
| narrationGenerator silent catch | קטגוריה 2 (Cross-store data) | Silent error hides failures in voice generation |
| projects/settings/recorder/route stores no logging | קטגוריה 3 (Spec Drift) | Coverage Map listed them — executor missed |
| DoD Q6 ns mismatch | קטגוריה 3 (Spec Drift) | Committed to ns=session.tts, actual is session.audio.tts |

---

## סיכום לסוכן הבא (executor של ה-fix)

**עדיפות לתיקון:**

1. **[Critical] `agent-session.ts:385` narrationGenerator** — הוסף `log.warn` לcatch:
   ```ts
   } catch (e) {
     log.warn({ err: String(e) }, "narration gen failed — returning empty")
     return ""
   }
   ```

2. **[High] `voice/pipeline.ts`** — הוסף `parentLog` parameter ל-`transcribeUserAudio` ו-`speakSentence`:
   ```ts
   export async function transcribeUserAudio(audio, config, registries, parentLog = baseLog)
   export async function speakSentence(text, config, registries, cache, onChunk, parentLog = baseLog)
   ```
   הוסף `log.info("tts done")`, `log.debug("cache hit/miss")`.

3. **[High] DoD Q6 תיקון דוקומנטציה** — `docs/logging-plan.md` צריך לשנות:
   ```
   LOG_NS=backend.session.tts → LOG_NS=backend.session.audio.*
   ```

4. **[Medium] `audio/recorder.ts`** — הוסף `createLogger("fe.audio.recorder")` + log.info start/stop + log.error mic denied

5. **[Medium] `stores/projects-store.svelte.ts` + `settings-store.svelte.ts`** — הוסף logger + log.warn בcatch

6. **[Low] `routes/agent/[id]/+page.svelte`** — הוסף log.warn לcatch של polling ו-deleteAgent

7. **[Low] `voice/narration.ts`** — הוסף `createLogger("backend.voice.narration")` + cache hit/miss + narrate done

---

## צילומי מסך

| קובץ | תיאור |
|------|-------|
| `/tmp/verify/logging-infra/tunnel-home.png` | דף הבית desktop |
| `/tmp/verify/logging-infra/agent-mobile.png` | agent page mobile 390×844 |
| `/tmp/verify/logging-infra/agent-fe-debug.png` | agent page desktop עם debug logging |

---

## ראיות LOG_WIRE=acp (5 שורות מהוצאה)

```
TRACE (backend.acp.wire.tx) frame  len=203  text={"jsonrpc":"2.0","id":0,"method":"initialize",...}
TRACE (backend.acp.wire.rx) frame  len=433  text={"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,...}}
TRACE (backend.acp.wire.tx) frame  len=87   text={"jsonrpc":"2.0","id":1,"method":"session/new",...}
TRACE (backend.acp.wire.rx) frame  len=2894 text={"jsonrpc":"2.0","id":1,"result":{"sessionId":"5ac3b9c5",...}}
TRACE (backend.acp.wire.rx) frame  len=5400 text={"jsonrpc":"2.0","method":"session/update",...}
```

---

---

# logging-infra — Verification Report (Round 2)

> **תאריך:** 2026-05-17
> **Commit בסיס (round 2):** `d75ecb2` (fix commit after round 1)
> **שיטה:** browser חי (linux-gui CDP via pw-clean.sh), curl, BE process logs, code analysis
> **Screenshots:** `/tmp/verify/logging-infra2/*.png`

## TL;DR

| מדד | תוצאה |
|------|--------|
| Bugs מround 1 שתוקנו | 4/8 |
| Bugs מround 1 שנותרו | 4/8 |
| Regressions חדשים | 0 |
| Bug חדש שנמצא ב-round 2 | 1 (critical) |
| `LOG_WIRE=acp` NDJSON | ✅ עובד (מאומת בפועל) |
| `?logRemote=1` → BE | ✅ עובד (מאומת בפועל) |
| `console.log` נותרו | ✅ אפס |

---

## בדיקת 8 ה-Bugs מ-Round 1

### Bug 1: `pipeline.ts` — parentLog + logging

| בדיקה | סטטוס | עדות |
|-------|--------|------|
| `transcribeUserAudio` קיבל `parentLog` parameter | ✅ | `pipeline.ts:50` |
| `speakSentence` קיבל `parentLog` parameter | ✅ | `pipeline.ts:84` |
| `log.debug` STT start/done | ✅ | `pipeline.ts:56, 66` |
| `log.debug` TTS cache hit | ✅ | `pipeline.ts:98` |
| `log.info` TTS done (cache miss) | ✅ | `pipeline.ts:112` |
| **call sites ב-agent-session.ts מעבירים `log` כ-parentLog** | ❌ | **`agent-session.ts:314` ו-`462` — נקראות ללא parentLog** |

**סיכום Bug 1: ⚠️ חלקי** — הsignature תוקן, אבל call sites לא מעבירים `log`. כתוצאה:
- `transcribeUserAudio` רץ תחת `backend.voice.stt` ללא `agentId`/`promptId`
- `speakSentence` רץ תחת `backend.voice.tts` ללא correlation IDs
- לא ניתן לgrep per-promptId על TTS/STT logs

**Bug חדש שנמצא (round 2 — Critical):** STT info ב-pipeline.ts הוא `debug` ולא `info`. שורה 66: `log.debug("done")`. agent-session.ts שורה 325 מוסיף info STT done בנפרד — אבל בלי parentLog correlation מה-pipeline.

---

### Bug 3: `agent-session.ts:385` — narrationGenerator silent catch

**✅ תוקן** — `baseLog.warn({ err: e }, "narration gen returned empty")` קיים ב-שורות 385-388.

---

### Bug 4: `recorder.ts` — logging

| בדיקה | סטטוס | עדות |
|-------|--------|------|
| `createLogger("fe.audio.recorder")` | ✅ | `recorder.ts:5,7` |
| `log.info({}, "start")` | ✅ | `recorder.ts:14` |
| `log.info({ bytes, mimeType }, "stop")` | ✅ | `recorder.ts:37` |
| **`log.error` לmic permission denied** | ❌ | **`getUserMedia` שורה 15 — אין try/catch + log.error** |

**סיכום Bug 4: ⚠️ חלקי** — start/stop מולוגוטים, אבל getUserMedia נכשל שקטית.

---

### Bug 5: `projects-store.svelte.ts` — logging

**✅ תוקן לגמרי** — `createLogger("fe.api")`, `log.debug("fetch")`, `log.warn("fetch failed")`.

---

### Bug 2: `narration.ts` — אפס logging

**❌ לא תוקן** — narration.ts ללא אף logger. Low priority.

---

### NBug5, NBug7, NBug8 מround 1

| Bug | תיקון | סטטוס |
|-----|--------|--------|
| NBug5: `settings-store.svelte.ts` — אפס logging | לא נגעו | ❌ עדיין ריק |
| NBug7: `routes/agent/[id]/+page.svelte` — 2 silent catches (שורות 202, 304) | לא נגעו | ❌ עדיין `} catch { /* ignore */ }` |
| NBug8: DoD Q6 NS שגוי בdocs | לא עודכנו | ❌ `backend.session.tts` → צריך `backend.session.audio.*` |

---

## שאלות מפתח — Round 2

### 1. האם 5-7 שורות info לvoice prompt?

**✅ כן — 5 info שורות correlated** ב-`backend.session.audio.*`:

```
INFO (backend.session.audio)  sendAudioPrompt start    agentId=X promptId=Y bytes=N
INFO (backend.session.audio)  STT done                 dur=N len=N
INFO (backend.session.audio)  → ACP prompt             len=N
INFO (backend.session.audio)  ← ACP prompt done        dur=N stopReason=end_turn
INFO (backend.session.audio)  sendAudioPrompt done     dur=N
```

**+ TTS lines** ב-`backend.voice.tts` (non-correlated): אחת per segment cache miss. 2 segments = 7 שורות סה"כ — בגבול העליון.

### 2. האם LOG_WIRE=acp באמת מציג NDJSON?

**✅ כן — מאומת בפועל ב-round 2:**

```
TRACE (backend.acp.wire.tx) frame  len=203   text={"jsonrpc":"2.0","id":0,"method":"initialize",...}
TRACE (backend.acp.wire.rx) frame  len=445   text={"jsonrpc":"2.0","id":0,"result":{...}}
TRACE (backend.acp.wire.tx) frame  len=87    text={"jsonrpc":"2.0","id":1,"method":"session/new",...}
TRACE (backend.acp.wire.rx) frame  len=14610 text={"jsonrpc":"2.0","id":1,"result":{"sessionId":"ses_1c92...",...}}
TRACE (backend.acp.wire.rx) frame  len=28857 text={"jsonrpc":"2.0","method":"session/update",...}
```

### 3. האם ?logRemote=1 שולח לBE?

**✅ כן — מאומת בpידי browser אמיתי:**

```
INFO (client.fe.session)  WS connect attempt  agentId=de7fef05-...
INFO (client.fe.session)  WS open             agentId=de7fef05-...  retries=0
```

### 4. האם console.log הוסרו?

**✅ אפס** — grep על backend + frontend src = 0 results.

### 5. האם 5+ silent try/catch חשופים?

**⚠️ 5/7 — 2 עדיין חסרים:**

| item | סטטוס |
|------|--------|
| ws-agent.ts JSON parse → log.warn | ✅ |
| voice-session parse → log.warn | ✅ |
| audio/player replay → log.warn | ✅ |
| audio/player play() → log.warn | ✅ |
| narrationGenerator catch → log.warn | ✅ תוקן |
| `recorder.ts` getUserMedia → log.error | ❌ שותק |
| `agent/[id]/+page.svelte` polling + deleteAgent → log.warn | ❌ שותק |

---

## Flows שעבדו (round 2)

- ✅ **BE startup + agent creation** — orchestrator/transport logs
- ✅ **WS connect** — `INFO (backend.ws.agent) WS connect` + browser connected badge ירוק
- ✅ **LOG_WIRE=acp** — 5 NDJSON frames מאומתים
- ✅ **logRemote=1** — `client.fe.session` ב-BE log מbrowser
- ✅ **POST /api/client-log** — 204 + `client.fe.test.verify2` ב-BE
- ✅ **400 bad JSON + 400 invalid level** — curl verified
- ✅ **window.__LOG__ מURL params** — `level=debug, ns=fe.voice,fe.audio.*, remote=true` ב-eval
- ✅ **UI desktop** — connected badge ירוק, mic button מוצג

## Regressions

**אין.** WS, UI, logRemote — כולם עובדים.

---

## החלטה

**1 bug critical** (Bug 1b — parentLog לא מועבר בcall sites) + 4 low/medium.

**המלצה: ⚠️ תיקון ממוקד לפני approve**

עדיפות:
1. **[Critical] Bug 1b** — 2 שורות בlast agent-session.ts: הוסף `log` כ-6th arg ל-`speakSentence` וכ-4th arg ל-`transcribeUserAudio`. בלי זה correlation IDs לא מגיעים לTTS/STT logs.
2. **[Medium] Bug 4b** — עטוף `getUserMedia` ב-try/catch עם `log.error`.
3. **[Low]** settings-store, agent/[id] catches, narration.ts — ניתן לדחות.

---

## Screenshots round 2

| קובץ | תיאור |
|------|-------|
| `/tmp/verify/logging-infra2/fe-debug-logging.png` | Home page עם agent list |
| `/tmp/verify/logging-infra2/agent-page.png` | Agent page desktop — connected badge ירוק |
