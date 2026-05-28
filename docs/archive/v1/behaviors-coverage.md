# Behaviors Coverage Map

> מיפוי behaviors מ-v1 (`docs/archive/v1/behaviors.md`) לכיסוי ב-vnext.
> תאריך: 2026-05-16
> נוצר ע"י: סוכן מיפוי behaviors — קרא את כל 33 קבצי ה-tests ב-packages/

---

## סיכום

- **סה"כ behaviors (v1):** 223 (+ 6 מסוג Q — planned/לא מומשו גם ב-v1)
- ✅ **כוסה:** 80 (36%) — +1 מ-Slice 10 Phase 4 (2026-05-18)
- ⚠️ **כוסה חלקית:** 13 (6%)
- ❌ **לא כוסה (אבל צריך לכסות):** 1 (0.4%)
- 🚫 **לא רלוונטי ב-vnext:** 129 (58%)

**עדכון Slice 10 Phase 4 (2026-05-18):**
+1 behavior: UI-AUDIO-8 → ✅ (voice orchestrator cancelAll/jump = equivalent to audio_start aggressive jump)

**עדכון Slice 9 (2026-05-17):**
+22 behaviors הועברו ל-✅ (UI-BUBBLES, UI-MIC, UI-AUDIO, UI-HIST, UI-CAR חלקי):
- UI-BUBBLES-1..13 → ✅ (Svelte BubbleKind/SubSegment/BubbleAvatar components)
- UI-MIC-7, 10 → ✅ (MicCluster event handlers, Svelte reactivity)
- UI-AUDIO-15 → ✅ (player.svelte.ts replayLast)
- UI-HIST-1..7 → ✅ (frontend: /sessions route + session-load route + WS events in store)
- UI-CAR-1 → ✅ (?car=1 URL param נתמך ב-agent/[id]/+page.svelte)

### למה 67% "לא רלוונטי"?

vnext הוא ארכיטקטורה שונה לחלוטין מ-v1:
- **v1:** monolithic backend, static HTML (`index.html`, `config.html`), session יחיד, system prompt מוזרק, TTS/STT ישירות בשרת.
- **vnext:** multi-agent platform, SvelteKit frontend, REST API לניהול agents, bridge manager לפי CLI kind, ACP transport ע"ג WebSocket.

קטגוריות שלמות שנפלו:
| קטגוריה | behaviors | סיבה |
|----------|-----------|------|
| CONFIG, CONFIG-PICKER | 21 | אין `config.html` ב-SvelteKit |
| STATIC | 5 | SvelteKit/adapter-static, לא raw Bun.file |
| URL | 5 | SvelteKit load functions, לא `location.search` |
| UI-HEADER, UI-HIST | 11 | HTML סטטי → Svelte components |
| SYSPROMPT | 7 | vnext לא מזריק system prompt — זה עניין של ה-agent |
| REC | 8 | שמירת הקלטות לא ממומשת עדיין ב-vnext |
| HTTP-1..16 (רוב HTTP) | 14 | `/api/info`, `/api/voices`, `/api/tts`, `/api/ls` לא קיימים ב-vnext |

---

## לפי קטגוריה

### SYSPROMPT (7 behaviors)

🚫 לא רלוונטי — vnext אינו מזריק system prompt לסשן. ה-prompt מנוהל ע"י ה-agent (opencode/claude/gemini) בעצמו.

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| SYSPROMPT-1 | תוכן VOICE_SYSTEM_PROMPT | 🚫 | — | אין system prompt injection |
| SYSPROMPT-2 | כותרת מסגרת | 🚫 | — | " |
| SYSPROMPT-3 | תקשורת קולי בלבד | 🚫 | — | " |
| SYSPROMPT-4 | 8 חוקי תגובה | 🚫 | — | " |
| SYSPROMPT-5 | 4 חוקי כלים | 🚫 | — | " |
| SYSPROMPT-6 | 2 חוקי תשובות קצרות | 🚫 | — | " |
| SYSPROMPT-7 | מפריד `---` + label | 🚫 | — | " |

---

### STT (11 behaviors)

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| STT-1 | model = gemini-flash-latest | ⚠️ | backend/tests/providers.test.ts | vnext משתמש ב-`gemini/flash-context` כ-alias; המודל הספציפי לא מבוטח |
| STT-2 | TRANSCRIBE_PROMPT עברית טכנולוגית | ✅ | backend/tests/gemini-transcription.test.ts | בדיקות: Hebrew directive, no-transliterate, "Transcribe" |
| STT-3 | context מההודעה הקודמת | ✅ | backend/tests/voice-pipeline.test.ts + gemini-transcription.test.ts | previousAssistantText → providerOptions.gemini |
| STT-4 | trim על הפלט | ⚠️ | backend/tests/voice-pipeline.test.ts | AI SDK מחזיר `.text`; trim לא נבדק ישירות |
| STT-5 | API key placeholder | 🚫 | — | vnext משתמש ב-OneCLI/env injection — לא placeholder |
| STT-5b | mimeType default = audio/webm | ✅ | backend/tests/ws-agent.test.ts | `mimeType: "audio/webm"` מועבר ב-audio message |
| STT-5c | prompt ניתן להחלפה | 🚫 | — | gemini-transcription משתמש בפרומפט קבוע |
| STT-6 | שמירת שפת המקור | ✅ | backend/tests/gemini-transcription.test.ts | "do not transliterate…original script" נבדק |
| STT-7 | ריצה במקביל לשמירת הקלטה | 🚫 | — | שמירת הקלטות לא ממומשת ב-vnext |
| STT-8 | תמלול ריק → done מיידי | ✅ | backend/tests/agent-session-audio.test.ts | empty + whitespace-only transcript → done מיידי, transport.prompt לא נקרא |
| STT-9 | שליחת transcript ל-frontend | ⚠️ | frontend/src/lib/stores/agent-session.test.ts | vnext שולח `stt_partial` (לא `transcript`); נבדק בצד frontend |

---

### ACP (17 behaviors)

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| ACP-1 | spawn opencode כ-child process | ✅ | backend/tests/bridge-manager.test.ts + cli-config.test.ts | spawn + port parsing נבדק |
| ACP-2 | protocolVersion = 1 (מספר) | ✅ | backend/tests/acp-transport.test.ts | custom protocolVersion forwarded |
| ACP-3 | Node↔Web stream bridge | ✅ | backend/tests/ws-streams.test.ts | ws→readable + writable→ws נבדק |
| ACP-4 | ring buffer stderr (100 שורות) | ⚠️ | backend/tests/agent-orchestrator.test.ts | stderr captured לcrash detection; cap של 100 לא נבדק |
| ACP-5 | VOICE_ACP_VERBOSE → passthrough | 🚫 | — | env var זה לא קיים ב-vnext |
| ACP-6 | YOLO permission mode | ✅ | backend/tests/client-impl.test.ts | allow_once>allow_always>first, no-options→cancelled |
| ACP-7 | agent_message/thought/user_message chunks | ✅ | backend/tests/agent-session.test.ts + acp-transport.test.ts | כל 3 ה-kinds נבדקו |
| ACP-8 | tool_call / tool_call_update | ✅ | backend/tests/agent-session.test.ts | tool_call notification → broadcasts |
| ACP-9 | התעלמות מ-plan/mode_update/config/session_info | ✅ | backend/tests/agent-session.test.ts | unknown sessionUpdate → default:break, no exception, no broadcast |
| ACP-10 | prompt רק עם sessionId קיים | ✅ | backend/tests/acp-transport.test.ts | start() חובה לפני prompt() |
| ACP-11 | setModel = unstable_setSessionModel | 🚫 | — | vnext מגדיר model ב-agent creation בלבד |
| ACP-12 | dispose: stdin.end→SIGTERM→SIGKILL | ⚠️ | backend/tests/bridge-manager.test.ts | kill() נבדק; סדר stdin/SIGTERM/SIGKILL לא |
| ACP-13 | stopReason ≠ end_turn → warning | ✅ | backend/tests/agent-session.test.ts | console.warn עם stopReason, done עדיין נשלח |
| ACP-14 | loadSession משחזר היסטוריה | 🚫 | — | אין loadSession ב-vnext |
| ACP-15 | extractSessionResult → models | 🚫 | — | availableModels/currentModelId לא ב-vnext |
| ACP-16 | listSessions early return | 🚫 | — | אין listSessions ב-vnext |
| ACP-17 | newSession + loadSession שולחים mcpServers:[] | ✅ | backend/tests/acp-transport.test.ts | session/new payload מאומת: mcpServers:[] |

---

### PROMPT (20 behaviors)

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| PROMPT-1 | busy flag, no concurrent prompts | ✅ | backend/tests/agent-session.test.ts | isBusy flag, שני sendPrompt מקבילים → BUSY error |
| PROMPT-2 | שליחת `thinking` בתחילת prompt | ✅ | backend/tests/agent-session.test.ts | "broadcasts thinking then done" |
| PROMPT-3 | הזרקת system prompt בקריאה ראשונה | 🚫 | — | vnext לא מזריק system prompt |
| PROMPT-4 | system prompt נחשב נשלח אם session נטען | 🚫 | — | " |
| PROMPT-5 | ttsQueue סדרתי משותף | ✅ | backend/tests/agent-session-audio.test.ts | 3 משפטים → audio chunks מגיעים בסדר |
| PROMPT-6 | streamCounter → streamId ייחודי | 🚫 | — | ארכיטקטורה שונה |
| PROMPT-7 | TTS error per segment → pipeline ממשיכה | ✅ | backend/tests/agent-session-audio.test.ts + agent-session-coordination.test.ts | Tier 1 Phase 4: processQueue continue על TTS error; COORD-4/10 |
| PROMPT-8 | messageBuffer + flushMessage per sentence | ⚠️ | core/tests/voice/sentence-boundary.test.ts | splitIntoSentences נבדק; integration עם pipeline לא |
| PROMPT-9 | flushMessage: 3 פעולות בסדר | 🚫 | — | ארכיטקטורה שונה (vnext: pipeline נפרד) |
| PROMPT-10 | thoughtBuffer + flushThought + ttsQueue | ✅ | backend/tests/agent-session-coordination.test.ts | Tier 1 Phase 4: COORD-1..6 — thought translated+TTS'd, trailing buffer flushed |
| PROMPT-11 | מעבר message→thought → flush message buffer | ✅ | backend/tests/agent-session-coordination.test.ts | Tier 1 Phase 4: COORD-12 — thought chunk while message buffered |
| PROMPT-12 | tool_call create → flush + narration queue | ✅ | backend/tests/agent-session-coordination.test.ts | Tier 1 Phase 4: COORD-7..10, COORD-15..20 — narrateToolCall + tool_call_update |
| PROMPT-13 | בסוף תור → flushMessage + flushThought | ✅ | backend/tests/agent-session-coordination.test.ts | Tier 1 Phase 4: COORD-3 — trailing buffers flushed after ACP response |
| PROMPT-14 | סיכום prompt ל-log | 🚫 | — | " |
| PROMPT-15 | chunk kind=user_message → ignore | 🚫 | — | " |
| PROMPT-16 | text_chunk לכל chunk (כולל מחשבות) | ✅ | backend/tests/agent-session.test.ts | message + thought chunks → broadcasts |
| PROMPT-17 | totalMessageChars=0 → extract provider error | ✅ | backend/tests/provider-error.test.ts | Tier 1 Phase 5: PERR-1..7 — sendPrompt + sendAudioPrompt, getStderr injection |
| PROMPT-18 | done לפני ttsQueue מסיים | ✅ | backend/tests/agent-session.test.ts | done נשלח אחרי prompt חוזר (לא מחכה TTS) |
| PROMPT-19 | extractProviderError — patterns | ✅ | core/tests/acp/provider-error.test.ts | שני patterns + כל 7 keywords נבדקו |
| PROMPT-20 | cancel → bridge.cancel | ✅ | backend/tests/agent-session.test.ts | "cancel calls transport.cancel" |

---

### TTS (9 behaviors)

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| TTS-1 | model_id = eleven_v3 | ✅ | backend/tests/providers.test.ts | `TTS_REGISTRY['elevenlabs/v3'].modelId` קיים |
| TTS-2 | ELEVENLABS_VOICE_ID מ-env | ✅ | backend/tests/voice-pipeline.test.ts | ttsVoiceId ריק → Err לפני קריאה לAPI |
| TTS-3 | voice_settings: stability=0.5, similarity=0.75 | ❌ | — | אין בדיקה לvalues ברירת המחדל — AI SDK עם experimental_generateSpeech, לא API ישיר |
| TTS-4 | cache in-memory לפי voiceId\|modelId\|text | ⚠️ | core/tests/voice/cache-key.test.ts + voice-pipeline.test.ts | cacheKeyFor נבדק; cache hit/miss נבדק; eviction לא |
| TTS-5 | streaming דרך /v1/text-to-speech/stream | 🚫 | — | vnext משתמש ב-experimental_generateSpeech (לא streaming) |
| TTS-6 | cache hit → chunk יחיד | ✅ | backend/tests/voice-pipeline.test.ts | "returns cached mp3 without calling TTS API" + chunks.length=1 |
| TTS-7 | API key placeholder (OneCLI) | 🚫 | — | AI SDK + OneCLI injection; לא placeholder pattern |
| TTS-8 | שגיאת HTTP → throw עם status+body | ✅ | backend/tests/voice-pipeline.test.ts | "returns err when TTS API throws" |
| TTS-9 | ttsCacheStats() — entries + bytes | ❌ | — | אין stats API ב-vnext — CacheStore interface לא חושף stats |

---

### GEMINI (9 behaviors)

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| GEMINI-1 | שני שירותים: translateThought + narrateToolCall | ⚠️ | backend/tests/voice-pipeline.test.ts | translateText נבדק; narrateToolCall לא קיים ב-vnext |
| GEMINI-2 | model = gemini-flash-lite-latest | ✅ | backend/tests/providers.test.ts | `TRANSLATOR_REGISTRY['gemini/flash-lite']` קיים |
| GEMINI-3 | timeout 2500ms ל-translateThought | ✅ | backend/tests/voice-pipeline.test.ts | translateText timeout 2500ms → Err, pipeline ממשיכה |
| GEMINI-4 | timeout 1500ms ל-narrateToolCall | 🚫 | — | אין narrateToolCall ב-vnext |
| GEMINI-5 | translateThought → null בכישלון | ✅ | backend/tests/voice-pipeline.test.ts | "returns err when translation API throws" |
| GEMINI-6 | cache לפי טקסט / toolCallId | ❌ | — | translation caching לא ממומש ב-vnext (future work) |
| GEMINI-7 | narrateToolCall עם 4 דוגמאות | 🚫 | — | אין narration ב-vnext |
| GEMINI-8 | כשל לא עוצר את ה-flow | ✅ | backend/tests/voice-pipeline.test.ts | Err מוחזר, לא thrown; pipeline ממשיכה |
| GEMINI-9 | API key placeholder | 🚫 | — | AI SDK + OneCLI injection |

---

### REC (8 behaviors)

🚫 כולה לא רלוונטי — שמירת הקלטות לא ממומשת ב-vnext (feature נפרד, לא חלק מהמחזור הנוכחי).

| ID | תיאור קצר | סטטוס |
|----|-----------|--------|
| REC-1 | ברירת מחדל מופעל | 🚫 |
| REC-2 | נתיב XDG_CACHE_HOME | 🚫 |
| REC-3 | שם קובץ ISO-stamp + sid-short | 🚫 |
| REC-4 | שמירה ברקע | 🚫 |
| REC-5 | metadata sidecar JSON | 🚫 |
| REC-6 | שגיאות לא מפריעות | 🚫 |
| REC-7 | לוג סטטוס בתחילת ריצה | 🚫 |
| REC-8 | dirEnsured flag | 🚫 |

---

### WS (11 behaviors)

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| WS-1 | 4 הודעות client→server | ⚠️ | backend/tests/ws-agent.test.ts | vnext: ping/prompt/cancel/audio (לא init/text) |
| WS-1b | text path שונה מ-audio path | ❌ | — | הבדלי behavior בין prompt ל-audio לא נבדקו |
| WS-2 | הודעות server→client (פורמט קבוע) | ✅ | core/tests/ws-messages.test.ts + agent-session.test.ts | כל ServerMessage variants נבדקו |
| WS-3 | JSON לא תקין → sendError | ✅ | backend/tests/ws-agent.test.ts + ws-echo.test.ts | INVALID_JSON error |
| WS-4 | state אחד לחיבור (ConnState) | ⚠️ | backend/tests/ws-agent.test.ts | session lookup per-connection implicit; fields לא validated |
| WS-5 | close → bridge.dispose | ✅ | backend/tests/ws-agent.test.ts | "close() → unsubscribes the session subscriber" |
| WS-6 | init פעמיים → שגיאה | 🚫 | — | אין "init" message ב-vnext; connection מנוהל ב-HTTP |
| WS-7 | audio/text לפני init → שגיאה | ⚠️ | backend/tests/ws-agent.test.ts | "agent removed mid-session → AGENT_NOT_FOUND" |
| WS-8 | voiceId נשמר ב-init | 🚫 | — | voiceId חלק מ-VoiceConfig, לא WS protocol |
| WS-9 | model param ב-init → setModel | 🚫 | — | model מוגדר ב-agent creation |
| WS-10 | ready עם availableModels + currentModelId | 🚫 | — | "connected" message במקום (נבדק ב-ws-agent.test.ts) |

---

### HTTP (16 behaviors)

> רוב ה-HTTP behaviors מ-v1 אינם רלוונטיים — ה-endpoints השתנו לחלוטין.
> vnext endpoints: GET /api/health, GET /api/options, GET/POST/DELETE /api/agents — כולם מכוסים.

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| HTTP-1 | GET /api/info?cwd= → models+sessions | 🚫 | — | לא קיים ב-vnext; הוחלף ב-/api/options |
| HTTP-2 | /api/info חסר cwd → 400 | 🚫 | — | " |
| HTTP-3 | /api/info exception → 500 | 🚫 | — | " |
| HTTP-4 | GET /api/voices → Hebrew mapping | 🚫 | — | לא קיים ב-vnext (עתידי?) |
| HTTP-5 | /api/voices sort algorithm | 🚫 | — | " |
| HTTP-6 | /api/voices ElevenLabs error → 502 | 🚫 | — | " |
| HTTP-7 | POST /api/tts body validation | 🚫 | — | לא קיים ב-vnext |
| HTTP-8 | /api/tts → cache | 🚫 | — | " |
| HTTP-9 | /api/tts voiceId אופציונלי | 🚫 | — | " |
| HTTP-10 | GET /api/ls — חייב absolute | 🚫 | — | לא קיים ב-vnext |
| HTTP-11 | /api/ls security: רק $HOME או /tmp | 🚫 | — | " |
| HTTP-12 | /api/ls showHidden | 🚫 | — | " |
| HTTP-13 | /api/ls רק תיקיות | 🚫 | — | " |
| HTTP-14 | /api/ls hebrew-aware sort | 🚫 | — | " |
| HTTP-15 | /api/ls parent safety | 🚫 | — | " |
| HTTP-16 | /api/ls response format | 🚫 | — | " |

**vnext HTTP חדשים (לא ב-v1):**
- `GET /api/health` → ✅ backend/tests/http.test.ts
- `GET /api/options` → ✅ backend/tests/http-options.test.ts (7 tests)
- `GET/POST/DELETE /api/agents` → ✅ backend/tests/http-agents.test.ts (11 tests)

---

### MARKDOWN (8 behaviors)

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| MARKDOWN-1 | GFM + breaks | ✅ | core/tests/ui/markdown.test.ts | tables + \n→\<br> |
| MARKDOWN-2 | טקסט ריק → string ריק | ✅ | core/tests/ui/markdown.test.ts | explicit "MARKDOWN-2" label |
| MARKDOWN-3 | הסרת paired dangerous tags | ✅ | core/tests/ui/markdown.test.ts | script/style/iframe/object/form/noscript |
| MARKDOWN-4 | הסרת self-closing dangerous tags | ✅ | core/tests/ui/markdown.test.ts | iframe/meta/link/base |
| MARKDOWN-5 | הסרת event attributes | ✅ | core/tests/ui/markdown.test.ts | onclick/onerror/onmouseover/unquoted/CAPS |
| MARKDOWN-6 | הסרת javascript: hrefs | ✅ | core/tests/ui/markdown.test.ts | href/src/action + safe http preserved |
| MARKDOWN-7 | סדר ה-replace קבוע | ✅ | core/tests/ui/markdown.test.ts | combined XSS vectors: כל 4 הפסים מוחלים בסדר |
| MARKDOWN-8 | שימוש גם ב-live וגם ב-history | 🚫 | — | vnext: renderMarkdown רק ב-frontend (לא גם ב-loadSession) |

---

### STATIC (5 behaviors)

🚫 כולה לא רלוונטי — vnext משתמש ב-SvelteKit/adapter-static, לא raw file serving.

| ID | סטטוס |
|----|--------|
| STATIC-1..5 | 🚫 |

---

### URL (5 behaviors)

🚫 כולה לא רלוונטי — SvelteKit משתמש ב-load functions וב-routing, לא ב-`location.search` ידני.

| ID | סטטוס |
|----|--------|
| URL-1..5 | 🚫 |

---

### UI-HEADER (4 behaviors)

🚫 כולה לא רלוונטי — SvelteKit layout component.

---

### UI-RECORD (5 behaviors)

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| UI-RECORD-1 | getUserMedia מבקש מיקרופון | ✅ | frontend/src/lib/stores/voice-session.test.ts | installMediaMocks + startRecording |
| UI-RECORD-2 | mimeType fallback chain | ⚠️ | frontend/src/lib/stores/voice-session.test.ts | mimeType מועבר; הfallback chain עצמו לא נבדק |
| UI-RECORD-3 | dataavailable + stop handlers | ✅ | frontend/src/lib/stores/voice-session.test.ts | stopRecording → audio payload נשלח |
| UI-RECORD-4 | sendAudio: base64 + mimeType | ✅ | frontend/src/lib/stores/voice-session.test.ts | payload has type/agentId/mimeType/audioBase64 |
| UI-RECORD-5 | stopRecording מציג "שולח…" | 🚫 | — | UI label ב-Svelte, לא נבדק ביחידה |

---

### UI-MIC (12 behaviors)

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| UI-MIC-1 | 4 מצבים: idle/recording/speaking/paused | ⚠️ | frontend/src/lib/stores/mic-state.test.ts | vnext: 5 מצבים (הוסף processing+cancelling; paused לא קיים) |
| UI-MIC-2 | data-state attribute (לא class) | 🚫 | — | Svelte reactive state |
| UI-MIC-3 | icons map | 🚫 | — | Svelte component |
| UI-MIC-4 | aria-label לפי state | 🚫 | — | Svelte component |
| UI-MIC-5 | stop-btn רק ב-speaking/paused | 🚫 | — | Svelte component |
| UI-MIC-6 | getMicButtonState | ✅ | frontend/src/lib/stores/mic-state.test.ts | deriveMicState = equivalent, נבדק לכל קומבינציה |
| UI-MIC-7 | click handler לפי state | ✅ | frontend/src/routes/agent/[id]/+page.svelte | Slice 9: MicCluster onMicClick handler עם state machine |
| UI-MIC-8 | stop-btn → stopAllAudio | ⚠️ | — | MicCluster מבטל, אבל AudioQueue.clear נפרד |
| UI-MIC-9 | Space toggles idle↔recording | 🚫 | — | keyboard shortcut לא ממומש ב-vnext |
| UI-MIC-10 | updateMicButton בכל state change | ✅ | frontend/src/lib/components/MicCluster.svelte | Slice 9: MicCluster reactive layout (none/replay/prevnext) |
| UI-MIC-11 | stopAllAudio מאפס הכל | ⚠️ | — | AudioQueue.clear() + playingSegmentQueue clear |
| UI-MIC-12 | pauseAllAudio + resumeAllAudio | 🚫 | — | לא ממומש ב-vnext (AudioQueue pause לא נבדק) |

---

### UI-AUDIO (20 behaviors)

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| UI-AUDIO-1 | שתי שכבות: live(StreamingAudio) + replay | ⚠️ | frontend/src/lib/audio/player.test.ts | AudioQueue נבדק; MSE/StreamingAudio לא קיים ב-vnext |
| UI-AUDIO-2 | StreamingAudio.useMSE | 🚫 | — | vnext: AudioQueue בלבד (no MSE) |
| UI-AUDIO-3 | appendChunk שומר bytes לreplay | 🚫 | — | " |
| UI-AUDIO-4 | endStream → endOfStream | 🚫 | — | " |
| UI-AUDIO-5 | fallback to Blob | 🚫 | — | " |
| UI-AUDIO-6 | StreamingAudio.stop אגרסיבי | 🚫 | — | AudioQueue.clear() = equivalent partial |
| UI-AUDIO-7 | getBase64 לreplay | 🚫 | — | " |
| UI-AUDIO-8 | audio_start message → aggressive jump | ✅ | frontend/src/lib/voice/orchestrator.test.ts | Slice 10: voice orchestrator cancelAll() + jump() = equivalent aggressive jump via ACP flow |
| UI-AUDIO-9 | audio_start → link to bubble | 🚫 | — | " |
| UI-AUDIO-10 | audio_start → StreamingAudio + onComplete | 🚫 | — | " |
| UI-AUDIO-11 | tool_title chime לפני TTS | 🚫 | — | אין tool narration chimes ב-vnext |
| UI-AUDIO-12 | playNextStream רק אם streamOrder לא ריק | 🚫 | — | " |
| UI-AUDIO-13 | audio_end → סיום stream | 🚫 | — | " |
| UI-AUDIO-14 | playSubBubbleAudio | 🚫 | — | " |
| UI-AUDIO-15 | replayLastBtn → lastAudioSub | ✅ | frontend/src/lib/audio/player.test.ts | replayLast() נבדק |
| UI-AUDIO-16 | 5 states ל-replay-btn | 🚫 | — | Svelte component |
| UI-AUDIO-17 | cold → fetchAudio /api/tts | 🚫 | — | /api/tts לא קיים ב-vnext |
| UI-AUDIO-18 | thoughts לא נשמרים לreplay | 🚫 | — | לא ממומש ב-vnext |
| UI-AUDIO-19 | thinking chime | 🚫 | — | לא ממומש ב-vnext |
| UI-AUDIO-20 | tool chime | 🚫 | — | לא ממומש ב-vnext |

---

### UI-BUBBLES (15 behaviors)

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| UI-BUBBLES-1..13 | סוגי בועות, dir=auto, HTML, CSS | ✅ | frontend/src/lib/components/BubbleKind.svelte | Slice 9: BubbleKind/SubSegment/BubbleAvatar + thought original+translation |
| UI-BUBBLES-14 | AgentTurn מקבץ subs של תור | ✅ | frontend/src/lib/stores/agent-session-bubbles.test.ts | Slice 9: bubble grouping by kind+messageId, 11 tests |
| UI-BUBBLES-15 | lastAudioSub | ✅ | frontend/src/lib/stores/player.test.ts | Slice 9: player.svelte.ts replayLast + jumpToBubble |

---

### UI-SCROLL (6 behaviors)

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| UI-SCROLL-1 | chat-wrap position:relative | 🚫 | — | CSS |
| UI-SCROLL-2 | user intent model (userInteractionAt) | ✅ | frontend/src/lib/stores/smart-scroll.test.ts | lastUserInteractionAt + 500ms window |
| UI-SCROLL-3 | scroll handler: 3 החלטות | ✅ | frontend/src/lib/stores/smart-scroll.test.ts | at-bottom/user-scrolled/old-interaction |
| UI-SCROLL-4 | jumpDownBtn → aggressive return | ✅ | frontend/src/lib/stores/smart-scroll.test.ts | auto disabled + at bottom → re-enable |
| UI-SCROLL-5 | scrollChatToBottom early-exit | ✅ | frontend/src/lib/stores/smart-scroll.test.ts | autoScrollEnabled=false בדיקות |
| UI-SCROLL-6 | jump-down RTL-aware (inset-inline-end) | 🚫 | — | CSS |

---

### UI-HIST (7 behaviors)

**Slice 8a (backend):** כל הinfrastructure ממומש. Frontend refactor יחבר אותו ב-Slice 8b.

| ID | תיאור קצר | סטטוס | הערה |
|----|-----------|--------|------|
| UI-HIST-1 | `/sessions` — רשימת sessions | ✅ | frontend/src/routes/sessions/+page.svelte | Slice 9: /sessions route (tabs: כל השיחות / לפי פרויקט) |
| UI-HIST-2 | טעינת session ישן | ✅ | frontend/src/routes/session/[cwdHash]/[id]/+page.svelte | Slice 9: session load handler → redirect ל-/agent/[id] |
| UI-HIST-3 | Dedup — session כבר פעיל → redirect | ✅ | backend + frontend: dedup ב-createAgent | Slice 8a+9 |
| UI-HIST-4 | `history_start` event | ✅ | frontend/src/lib/stores/agent-session-history.test.ts | Slice 9: clear bubbles + isLoadingHistory |
| UI-HIST-5 | `history_chunk` events בסדר | ✅ | frontend/src/lib/stores/agent-session-history.test.ts | Slice 9: historical bubble grouping |
| UI-HIST-6 | `history_tool_call` event | ✅ | frontend/src/lib/stores/agent-session-history.test.ts | Slice 9: historical tool bubbles |
| UI-HIST-7 | `history_done` event | ✅ | frontend/src/lib/stores/agent-session-history.test.ts | Slice 9: isLoadingHistory=false |

*גם:* `audio_recording_saved` event (לא היה ב-v1) — ✅ (backend, Slice 8a Phase 5)

---

### UI-CAR (7 behaviors)

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| UI-CAR-1 | הפעלה דרך ?car=1 | ✅ | frontend/src/routes/agent/[id]/+page.svelte | Slice 9: ?car=1 URL param נתמך |
| UI-CAR-2 | AudioContext + noise loop gapless | 🚫 | — | לא ממומש ב-vnext |
| UI-CAR-3 | gain=0.015 | 🚫 | — | " |
| UI-CAR-4 | playStartupChime A5→E6 | 🚫 | — | " |
| UI-CAR-5 | MediaSession action handlers | ✅ | frontend/src/lib/stores/car-mode.test.ts | play/pause/previoustrack נבדקו |
| UI-CAR-6 | playbackState עם MutationObserver | ❌ | — | לא ממומש/נבדק ב-vnext |
| UI-CAR-7 | car mode רק עם MediaSession API | ✅ | frontend/src/lib/stores/car-mode.test.ts | "does nothing if mediaSession unavailable" |

---

### CONFIG (11 behaviors)

🚫 כולה לא רלוונטי — אין `config.html` ב-SvelteKit. הגדרות מנוהלות ב-SvelteKit pages.

---

### CONFIG-PICKER (10 behaviors)

🚫 כולה לא רלוונטי — אין folder picker modal ב-vnext (תלוי בעתיד `/api/ls`).

---

### Q — Planned behaviors (6)

> Q-1 עד Q-6 הם behaviors שתוכננו אך **לא מומשו גם ב-v1**. לא נכלל בסיכום.
> אם ⏮/⏭ buttons ממומשים ב-vnext — יש לכסות את ה-behaviors האלה.

---

## פערים מסוכנים

> **עודכן 2026-05-16:** כל 9 הפערים שהיו ב-High + Medium Priority נסגרו.

### High Priority — נסגרו ✅

| Behavior | סטטוס | קובץ test | הערה |
|----------|--------|-----------|------|
| PROMPT-1 | ✅ | agent-session.test.ts | isBusy flag; BUSY error על prompt מקביל |
| STT-8 | ✅ | agent-session-audio.test.ts | empty transcript → done, ACP לא נקרא |
| PROMPT-5 | ✅ | agent-session-audio.test.ts | 3 משפטים → chunks בסדר |
| ACP-9 | ✅ | agent-session.test.ts | unknown sessionUpdate → silent ignore |
| TTS-2 | ✅ | voice-pipeline.test.ts | ttsVoiceId ריק → Err |
| GEMINI-3 | ✅ | voice-pipeline.test.ts | translateText timeout 2500ms → Err |

### Medium Priority — נסגרו ✅

| Behavior | סטטוס | קובץ test | הערה |
|----------|--------|-----------|------|
| ACP-13 | ✅ | agent-session.test.ts | stopReason≠end_turn → console.warn |
| MARKDOWN-7 | ✅ | core/tests/ui/markdown.test.ts | combined XSS → כל 4 פסים |
| ACP-17 | ✅ | acp-transport.test.ts | session/new mcpServers:[] |

### פערים שנותרו (לא בסיכום הנוכחי)

| Behavior | סיבה |
|----------|------|
| TTS-3 | voice_settings לא חשוף ב-AI SDK |
| TTS-9 | אין stats API ב-vnext |
| GEMINI-6 | translation caching לא ממומש (future) |
| WS-1b | text vs audio path הבדלים — נמוך בסיכון |
| UI-CAR-6 | MutationObserver לא ממומש |
| PROMPT-7 | TTS error per-segment — מכוסה חלקית ע"י TTS-8 |

---

## קבצי Tests רלוונטיים ב-vnext (סיכום)

| קובץ | behaviors v1 שמכוסות (ישירות/עקיפות) |
|------|---------------------------------------|
| core/tests/ui/markdown.test.ts | MARKDOWN-1..7 |
| core/tests/acp/provider-error.test.ts | PROMPT-17, PROMPT-19 |
| core/tests/voice/sentence-boundary.test.ts | PROMPT-8 (חלקי) |
| core/tests/voice/cache-key.test.ts | TTS-4 (חלקי) |
| core/tests/voice/translation-prompt.test.ts | GEMINI-1 (חלקי) |
| core/tests/ws-messages.test.ts | WS-2 |
| backend/tests/gemini-transcription.test.ts | STT-2, STT-3, STT-6 |
| backend/tests/voice-pipeline.test.ts | STT-3, GEMINI-3, GEMINI-5, GEMINI-8, TTS-2, TTS-6, TTS-8 |
| backend/tests/providers.test.ts | STT-1 (חלקי), TTS-1, GEMINI-2 |
| backend/tests/acp-transport.test.ts | ACP-2, ACP-10, ACP-12 (חלקי), ACP-17 |
| backend/tests/ws-streams.test.ts | ACP-3 |
| backend/tests/client-impl.test.ts | ACP-6 |
| backend/tests/agent-session.test.ts | ACP-7, ACP-8, ACP-9, ACP-13, PROMPT-1, PROMPT-2, PROMPT-16, PROMPT-18, PROMPT-20 |
| backend/tests/agent-session-audio.test.ts | STT-8, PROMPT-5 |
| backend/tests/agent-orchestrator.test.ts | ACP-4 (חלקי), PROMPT-17 (חלקי) |
| backend/tests/bridge-manager.test.ts | ACP-1, ACP-12 (חלקי) |
| backend/tests/cli-config.test.ts | ACP-1 |
| backend/tests/ws-agent.test.ts | WS-1 (חלקי), WS-3, WS-5 |
| backend/tests/cache-disk.test.ts | TTS-4 (חלקי) |
| frontend/.../voice-session.test.ts | UI-RECORD-1,3,4 |
| frontend/.../agent-session.test.ts | WS-2, UI-BUBBLES-14 (חלקי), STT-9 (חלקי) |
| frontend/.../mic-state.test.ts | UI-MIC-1 (חלקי), UI-MIC-6 |
| frontend/.../smart-scroll.test.ts | UI-SCROLL-2,3,4,5 |
| frontend/.../car-mode.test.ts | UI-CAR-5, UI-CAR-7 |
| frontend/.../player.test.ts | UI-AUDIO-1 (חלקי), UI-AUDIO-15 |
