# Behaviors Coverage Map — v2

> מיפוי behaviors מ-v1 (`docs/archive/v1/behaviors.md`) לכיסוי ב-`packages/frontend-v2/`.
> תאריך איפוס: 2026-05-27 (slice 0 — בנייה מאפס במבנה החדש).
> איפוס בוצע על בסיס `docs/archive/v1/behaviors-coverage.md` (סטטוס v1, קפוא).

---

## מה השתנה באיפוס

`packages/frontend-v2/` נבנה מאפס. הקובץ המקורי (כעת בארכיון) סימן ✅ כל behavior שנכוסה ב-`packages/frontend/` הישן — קוד ש-v2 לא משתמש בו.

לכן באיפוס הזה:

- ✅ **נשמרו** רק כיסויים ב-`packages/core/` ו-`packages/backend/` — חבילות משותפות שעדיין רלוונטיות ל-v2.
- ❌ **אופסו** כל הכיסויים ב-`packages/frontend/` (כעת `v1-covered, v2-pending`).
- 🚫 **נשמרו** כפי שהיו — אלו החלטות ארכיטקטורה (vnext) ולא תלויות באיזה frontend בנוי.
- ⚠️ הוסבו ל-❌ במקרים של `packages/frontend/`, ונשמרו במקרים של core/backend.

---

## סיכום נוכחי (v2)

- **סה"כ behaviors (v1):** 223 (+ 6 Q — planned)
- ✅ **כוסה ב-v2:** ~57 (core + backend בלבד)
- ⚠️ **כוסה חלקית:** ~7 (core + backend בלבד)
- ❌ **לא כוסה (כיסוי v1 קיים, v2 pending):** ~37
- 🚫 **לא רלוונטי ב-vnext:** 129 (58%)

> מספרים מדויקים — ראה ספירה בקטגוריות. מומלץ לעדכן את הסיכום הזה אחרי כל slice ב-v2.

---

## DoD per slice

בסיום כל slice של v2 — עדכן את הקובץ הזה:
- סמן ✅ עבור behaviors שכוסו ב-slice (עם test path).
- עדכן את ה"סיכום נוכחי" למעלה.
- הוסף שורה ב"לוג עדכונים" למטה.

---

## לוג עדכונים (v2)

| תאריך | Slice | שינוי |
|-------|-------|-------|
| 2026-05-27 | slice 0 | התחלת `packages/frontend-v2/` — text-only chat. עדיין לא נספרו behaviors. |

---

## למה 67% "לא רלוונטי"?

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
| STT-2 | TRANSCRIBE_PROMPT עברית טכנולוגית | ✅ | backend/tests/gemini-transcription.test.ts | Hebrew directive, no-transliterate, "Transcribe" |
| STT-3 | context מההודעה הקודמת | ✅ | backend/tests/voice-pipeline.test.ts + gemini-transcription.test.ts | previousAssistantText → providerOptions.gemini |
| STT-4 | trim על הפלט | ⚠️ | backend/tests/voice-pipeline.test.ts | AI SDK מחזיר `.text`; trim לא נבדק ישירות |
| STT-5 | API key placeholder | 🚫 | — | vnext משתמש ב-OneCLI/env injection |
| STT-5b | mimeType default = audio/webm | ✅ | backend/tests/ws-agent.test.ts | `mimeType: "audio/webm"` מועבר ב-audio message |
| STT-5c | prompt ניתן להחלפה | 🚫 | — | gemini-transcription משתמש בפרומפט קבוע |
| STT-6 | שמירת שפת המקור | ✅ | backend/tests/gemini-transcription.test.ts | "do not transliterate…original script" נבדק |
| STT-7 | ריצה במקביל לשמירת הקלטה | 🚫 | — | שמירת הקלטות לא ממומשת ב-vnext |
| STT-8 | תמלול ריק → done מיידי | ✅ | backend/tests/agent-session-audio.test.ts | empty + whitespace-only transcript → done מיידי |
| STT-9 | שליחת transcript ל-frontend | ❌ | — | v1-covered (frontend test), v2-pending |

---

### ACP (17 behaviors)

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| ACP-1 | spawn opencode כ-child process | ✅ | backend/tests/bridge-manager.test.ts + cli-config.test.ts | spawn + port parsing נבדק |
| ACP-2 | protocolVersion = 1 (מספר) | ✅ | backend/tests/acp-transport.test.ts | custom protocolVersion forwarded |
| ACP-3 | Node↔Web stream bridge | ✅ | backend/tests/ws-streams.test.ts | ws→readable + writable→ws נבדק |
| ACP-4 | ring buffer stderr (100 שורות) | ⚠️ | backend/tests/agent-orchestrator.test.ts | stderr captured; cap של 100 לא נבדק |
| ACP-5 | VOICE_ACP_VERBOSE → passthrough | 🚫 | — | env var זה לא קיים ב-vnext |
| ACP-6 | YOLO permission mode | ✅ | backend/tests/client-impl.test.ts | allow_once>allow_always>first |
| ACP-7 | agent_message/thought/user_message chunks | ✅ | backend/tests/agent-session.test.ts + acp-transport.test.ts | כל 3 ה-kinds |
| ACP-8 | tool_call / tool_call_update | ✅ | backend/tests/agent-session.test.ts | tool_call notification → broadcasts |
| ACP-9 | התעלמות מ-plan/mode_update/config/session_info | ✅ | backend/tests/agent-session.test.ts | unknown sessionUpdate → silent ignore |
| ACP-10 | prompt רק עם sessionId קיים | ✅ | backend/tests/acp-transport.test.ts | start() חובה לפני prompt() |
| ACP-11 | setModel = unstable_setSessionModel | 🚫 | — | vnext מגדיר model ב-agent creation בלבד |
| ACP-12 | dispose: stdin.end→SIGTERM→SIGKILL | ⚠️ | backend/tests/bridge-manager.test.ts | kill() נבדק; סדר לא |
| ACP-13 | stopReason ≠ end_turn → warning | ✅ | backend/tests/agent-session.test.ts | console.warn עם stopReason |
| ACP-14 | loadSession משחזר היסטוריה | 🚫 | — | אין loadSession ב-vnext |
| ACP-15 | extractSessionResult → models | 🚫 | — | availableModels/currentModelId לא ב-vnext |
| ACP-16 | listSessions early return | 🚫 | — | אין listSessions ב-vnext |
| ACP-17 | newSession + loadSession שולחים mcpServers:[] | ✅ | backend/tests/acp-transport.test.ts | session/new mcpServers:[] |

---

### PROMPT (20 behaviors)

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| PROMPT-1 | busy flag, no concurrent prompts | ✅ | backend/tests/agent-session.test.ts | isBusy flag, BUSY error |
| PROMPT-2 | שליחת `thinking` בתחילת prompt | ✅ | backend/tests/agent-session.test.ts | "broadcasts thinking then done" |
| PROMPT-3 | הזרקת system prompt בקריאה ראשונה | 🚫 | — | vnext לא מזריק system prompt |
| PROMPT-4 | system prompt נחשב נשלח אם session נטען | 🚫 | — | " |
| PROMPT-5 | ttsQueue סדרתי משותף | ✅ | backend/tests/agent-session-audio.test.ts | 3 משפטים → audio chunks בסדר |
| PROMPT-6 | streamCounter → streamId ייחודי | 🚫 | — | ארכיטקטורה שונה |
| PROMPT-7 | TTS error per segment → pipeline ממשיכה | ✅ | backend/tests/agent-session-audio.test.ts + agent-session-coordination.test.ts | COORD-4/10 |
| PROMPT-8 | messageBuffer + flushMessage per sentence | ⚠️ | core/tests/voice/sentence-boundary.test.ts | splitIntoSentences; integration לא |
| PROMPT-9 | flushMessage: 3 פעולות בסדר | 🚫 | — | ארכיטקטורה שונה |
| PROMPT-10 | thoughtBuffer + flushThought + ttsQueue | ✅ | backend/tests/agent-session-coordination.test.ts | COORD-1..6 |
| PROMPT-11 | מעבר message→thought → flush message buffer | ✅ | backend/tests/agent-session-coordination.test.ts | COORD-12 |
| PROMPT-12 | tool_call create → flush + narration queue | ✅ | backend/tests/agent-session-coordination.test.ts | COORD-7..10, 15..20 |
| PROMPT-13 | בסוף תור → flushMessage + flushThought | ✅ | backend/tests/agent-session-coordination.test.ts | COORD-3 |
| PROMPT-14 | סיכום prompt ל-log | 🚫 | — | " |
| PROMPT-15 | chunk kind=user_message → ignore | 🚫 | — | " |
| PROMPT-16 | text_chunk לכל chunk | ✅ | backend/tests/agent-session.test.ts | message + thought chunks |
| PROMPT-17 | totalMessageChars=0 → extract provider error | ✅ | backend/tests/provider-error.test.ts | PERR-1..7 |
| PROMPT-18 | done לפני ttsQueue מסיים | ✅ | backend/tests/agent-session.test.ts | done לא מחכה TTS |
| PROMPT-19 | extractProviderError — patterns | ✅ | core/tests/acp/provider-error.test.ts | 2 patterns + 7 keywords |
| PROMPT-20 | cancel → bridge.cancel | ✅ | backend/tests/agent-session.test.ts | "cancel calls transport.cancel" |

---

### TTS (9 behaviors)

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| TTS-1 | model_id = eleven_v3 | ✅ | backend/tests/providers.test.ts | `TTS_REGISTRY['elevenlabs/v3'].modelId` |
| TTS-2 | ELEVENLABS_VOICE_ID מ-env | ✅ | backend/tests/voice-pipeline.test.ts | ttsVoiceId ריק → Err |
| TTS-3 | voice_settings: stability=0.5, similarity=0.75 | ❌ | — | AI SDK עם experimental_generateSpeech, לא חשוף |
| TTS-4 | cache in-memory לפי voiceId\|modelId\|text | ⚠️ | core/tests/voice/cache-key.test.ts + voice-pipeline.test.ts | cacheKeyFor + hit/miss; eviction לא |
| TTS-5 | streaming דרך /v1/text-to-speech/stream | 🚫 | — | vnext: experimental_generateSpeech (לא streaming) |
| TTS-6 | cache hit → chunk יחיד | ✅ | backend/tests/voice-pipeline.test.ts | chunks.length=1 |
| TTS-7 | API key placeholder (OneCLI) | 🚫 | — | AI SDK + OneCLI injection |
| TTS-8 | שגיאת HTTP → throw עם status+body | ✅ | backend/tests/voice-pipeline.test.ts | "returns err when TTS API throws" |
| TTS-9 | ttsCacheStats() — entries + bytes | ❌ | — | CacheStore interface לא חושף stats |

---

### GEMINI (9 behaviors)

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| GEMINI-1 | שני שירותים: translateThought + narrateToolCall | ⚠️ | backend/tests/voice-pipeline.test.ts | translateText נבדק; narrateToolCall לא קיים |
| GEMINI-2 | model = gemini-flash-lite-latest | ✅ | backend/tests/providers.test.ts | `TRANSLATOR_REGISTRY['gemini/flash-lite']` |
| GEMINI-3 | timeout 2500ms ל-translateThought | ✅ | backend/tests/voice-pipeline.test.ts | timeout → Err, pipeline ממשיכה |
| GEMINI-4 | timeout 1500ms ל-narrateToolCall | 🚫 | — | אין narrateToolCall ב-vnext |
| GEMINI-5 | translateThought → null בכישלון | ✅ | backend/tests/voice-pipeline.test.ts | "returns err when translation API throws" |
| GEMINI-6 | cache לפי טקסט / toolCallId | ❌ | — | translation caching לא ממומש (future) |
| GEMINI-7 | narrateToolCall עם 4 דוגמאות | 🚫 | — | אין narration ב-vnext |
| GEMINI-8 | כשל לא עוצר את ה-flow | ✅ | backend/tests/voice-pipeline.test.ts | Err מוחזר, לא thrown |
| GEMINI-9 | API key placeholder | 🚫 | — | AI SDK + OneCLI injection |

---

### REC (8 behaviors)

🚫 כולה לא רלוונטי — שמירת הקלטות לא ממומשת ב-vnext (feature נפרד).

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
| WS-1 | 4 הודעות client→server | ⚠️ | backend/tests/ws-agent.test.ts | vnext: ping/prompt/cancel/audio |
| WS-1b | text path שונה מ-audio path | ❌ | — | הבדלי behavior לא נבדקו |
| WS-2 | הודעות server→client (פורמט קבוע) | ✅ | core/tests/ws-messages.test.ts + agent-session.test.ts | כל ServerMessage variants |
| WS-3 | JSON לא תקין → sendError | ✅ | backend/tests/ws-agent.test.ts + ws-echo.test.ts | INVALID_JSON error |
| WS-4 | state אחד לחיבור (ConnState) | ⚠️ | backend/tests/ws-agent.test.ts | session lookup implicit; fields לא validated |
| WS-5 | close → bridge.dispose | ✅ | backend/tests/ws-agent.test.ts | unsubscribes session subscriber |
| WS-6 | init פעמיים → שגיאה | 🚫 | — | אין "init" message ב-vnext |
| WS-7 | audio/text לפני init → שגיאה | ⚠️ | backend/tests/ws-agent.test.ts | AGENT_NOT_FOUND |
| WS-8 | voiceId נשמר ב-init | 🚫 | — | voiceId חלק מ-VoiceConfig |
| WS-9 | model param ב-init → setModel | 🚫 | — | model מוגדר ב-agent creation |
| WS-10 | ready עם availableModels + currentModelId | 🚫 | — | "connected" message במקום |

---

### HTTP (16 behaviors)

> רוב ה-HTTP behaviors מ-v1 אינם רלוונטיים. vnext endpoints: GET /api/health, GET /api/options, GET/POST/DELETE /api/agents — כולם מכוסים.

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| HTTP-1..3 | /api/info | 🚫 | — | הוחלף ב-/api/options |
| HTTP-4..6 | /api/voices | 🚫 | — | לא קיים (עתידי?) |
| HTTP-7..9 | /api/tts | 🚫 | — | לא קיים |
| HTTP-10..16 | /api/ls | 🚫 | — | לא קיים |

**vnext HTTP חדשים:**
- `GET /api/health` → ✅ backend/tests/http.test.ts
- `GET /api/options` → ✅ backend/tests/http-options.test.ts (7 tests)
- `GET/POST/DELETE /api/agents` → ✅ backend/tests/http-agents.test.ts (11 tests)

---

### MARKDOWN (8 behaviors)

| ID | תיאור קצר | סטטוס | test path | הערה |
|----|-----------|--------|-----------|------|
| MARKDOWN-1 | GFM + breaks | ✅ | core/tests/ui/markdown.test.ts | tables + \n→\<br> |
| MARKDOWN-2 | טקסט ריק → string ריק | ✅ | core/tests/ui/markdown.test.ts | |
| MARKDOWN-3 | הסרת paired dangerous tags | ✅ | core/tests/ui/markdown.test.ts | script/style/iframe/object/form/noscript |
| MARKDOWN-4 | הסרת self-closing dangerous tags | ✅ | core/tests/ui/markdown.test.ts | iframe/meta/link/base |
| MARKDOWN-5 | הסרת event attributes | ✅ | core/tests/ui/markdown.test.ts | onclick/onerror/onmouseover |
| MARKDOWN-6 | הסרת javascript: hrefs | ✅ | core/tests/ui/markdown.test.ts | href/src/action |
| MARKDOWN-7 | סדר ה-replace קבוע | ✅ | core/tests/ui/markdown.test.ts | combined XSS vectors |
| MARKDOWN-8 | שימוש גם ב-live וגם ב-history | 🚫 | — | vnext: רק ב-frontend |

---

### STATIC (5 behaviors)

🚫 כולה לא רלוונטי — SvelteKit/adapter-static.

---

### URL (5 behaviors)

🚫 כולה לא רלוונטי — SvelteKit load functions ו-routing.

---

### UI-HEADER (4 behaviors)

🚫 כולה לא רלוונטי — SvelteKit layout component.

---

### UI-RECORD (5 behaviors)

| ID | תיאור קצר | סטטוס | הערה |
|----|-----------|--------|------|
| UI-RECORD-1 | getUserMedia מבקש מיקרופון | ❌ | v1-covered, v2-pending |
| UI-RECORD-2 | mimeType fallback chain | ❌ | v1-partial, v2-pending |
| UI-RECORD-3 | dataavailable + stop handlers | ❌ | v1-covered, v2-pending |
| UI-RECORD-4 | sendAudio: base64 + mimeType | ❌ | v1-covered, v2-pending |
| UI-RECORD-5 | stopRecording מציג "שולח…" | 🚫 | UI label, לא נבדק ביחידה |

---

### UI-MIC (12 behaviors)

| ID | תיאור קצר | סטטוס | הערה |
|----|-----------|--------|------|
| UI-MIC-1 | 4 מצבים: idle/recording/speaking/paused | ❌ | v1-partial, v2-pending |
| UI-MIC-2 | data-state attribute | 🚫 | Svelte reactive state |
| UI-MIC-3 | icons map | 🚫 | Svelte component |
| UI-MIC-4 | aria-label לפי state | 🚫 | Svelte component |
| UI-MIC-5 | stop-btn רק ב-speaking/paused | 🚫 | Svelte component |
| UI-MIC-6 | getMicButtonState | ❌ | v1-covered, v2-pending |
| UI-MIC-7 | click handler לפי state | ❌ | v1-covered, v2-pending |
| UI-MIC-8 | stop-btn → stopAllAudio | ❌ | v1-partial, v2-pending |
| UI-MIC-9 | Space toggles idle↔recording | 🚫 | keyboard shortcut לא ממומש |
| UI-MIC-10 | updateMicButton בכל state change | ❌ | v1-covered, v2-pending |
| UI-MIC-11 | stopAllAudio מאפס הכל | ❌ | v1-partial, v2-pending |
| UI-MIC-12 | pauseAllAudio + resumeAllAudio | 🚫 | לא ממומש ב-vnext |

---

### UI-AUDIO (20 behaviors)

| ID | תיאור קצר | סטטוס | הערה |
|----|-----------|--------|------|
| UI-AUDIO-1 | שתי שכבות: live + replay | ❌ | v1-partial (AudioQueue בלבד), v2-pending |
| UI-AUDIO-2..7 | StreamingAudio / MSE | 🚫 | vnext: AudioQueue בלבד |
| UI-AUDIO-8 | audio_start message → aggressive jump | ❌ | v1-covered, v2-pending |
| UI-AUDIO-9..14 | audio_start / sub-bubbles / chimes | 🚫 | לא ממומש ב-vnext |
| UI-AUDIO-15 | replayLastBtn → lastAudioSub | ❌ | v1-covered, v2-pending |
| UI-AUDIO-16 | 5 states ל-replay-btn | 🚫 | Svelte component |
| UI-AUDIO-17 | cold → fetchAudio /api/tts | 🚫 | /api/tts לא קיים |
| UI-AUDIO-18..20 | thoughts לreplay, chimes | 🚫 | לא ממומש |

---

### UI-BUBBLES (15 behaviors)

| ID | תיאור קצר | סטטוס | הערה |
|----|-----------|--------|------|
| UI-BUBBLES-1..13 | סוגי בועות, dir=auto, HTML, CSS | ❌ | v1-covered, v2-pending |
| UI-BUBBLES-14 | AgentTurn מקבץ subs של תור | ❌ | v1-covered, v2-pending |
| UI-BUBBLES-15 | lastAudioSub | ❌ | v1-covered, v2-pending |

---

### UI-SCROLL (6 behaviors)

| ID | תיאור קצר | סטטוס | הערה |
|----|-----------|--------|------|
| UI-SCROLL-1 | chat-wrap position:relative | 🚫 | CSS |
| UI-SCROLL-2 | user intent model | ❌ | v1-covered, v2-pending |
| UI-SCROLL-3 | scroll handler: 3 החלטות | ❌ | v1-covered, v2-pending |
| UI-SCROLL-4 | jumpDownBtn → aggressive return | ❌ | v1-covered, v2-pending |
| UI-SCROLL-5 | scrollChatToBottom early-exit | ❌ | v1-covered, v2-pending |
| UI-SCROLL-6 | jump-down RTL-aware | 🚫 | CSS |

---

### UI-HIST (7 behaviors)

| ID | תיאור קצר | סטטוס | הערה |
|----|-----------|--------|------|
| UI-HIST-1 | `/sessions` — רשימת sessions | ❌ | v1-covered (route), v2-pending |
| UI-HIST-2 | טעינת session ישן | ❌ | v1-covered, v2-pending |
| UI-HIST-3 | Dedup — session פעיל → redirect | ⚠️ | backend ✅; frontend v2-pending |
| UI-HIST-4 | `history_start` event | ❌ | v1-covered, v2-pending |
| UI-HIST-5 | `history_chunk` events בסדר | ❌ | v1-covered, v2-pending |
| UI-HIST-6 | `history_tool_call` event | ❌ | v1-covered, v2-pending |
| UI-HIST-7 | `history_done` event | ❌ | v1-covered, v2-pending |

`audio_recording_saved` event (backend) — ✅ Slice 8a Phase 5.

---

### UI-CAR (7 behaviors)

| ID | תיאור קצר | סטטוס | הערה |
|----|-----------|--------|------|
| UI-CAR-1 | הפעלה דרך ?car=1 | ❌ | v1-covered, v2-pending |
| UI-CAR-2 | AudioContext + noise loop gapless | 🚫 | לא ממומש ב-vnext |
| UI-CAR-3 | gain=0.015 | 🚫 | " |
| UI-CAR-4 | playStartupChime A5→E6 | 🚫 | " |
| UI-CAR-5 | MediaSession action handlers | ❌ | v1-covered, v2-pending |
| UI-CAR-6 | playbackState עם MutationObserver | ❌ | לא ממומש/נבדק |
| UI-CAR-7 | car mode רק עם MediaSession API | ❌ | v1-covered, v2-pending |

---

### CONFIG (11 behaviors)

🚫 כולה לא רלוונטי — אין `config.html` ב-SvelteKit.

---

### CONFIG-PICKER (10 behaviors)

🚫 כולה לא רלוונטי — אין folder picker modal ב-vnext (תלוי בעתיד `/api/ls`).

---

### Q — Planned behaviors (6)

> Q-1..Q-6 — behaviors שתוכננו אך **לא מומשו גם ב-v1**. לא נכלל בסיכום.
> אם ⏮/⏭ buttons ייושמו ב-v2 — יש לכסות.

---

## פערים פתוחים (core/backend)

| Behavior | סטטוס | סיבה |
|----------|--------|------|
| TTS-3 | ❌ | voice_settings לא חשוף ב-AI SDK |
| TTS-9 | ❌ | אין stats API ב-vnext |
| GEMINI-6 | ❌ | translation caching לא ממומש (future) |
| WS-1b | ❌ | text vs audio path הבדלים — נמוך בסיכון |
| STT-1, STT-4 | ⚠️ | פרטי טיפול לא מבוטחים בבדיקות |
| ACP-4, ACP-12 | ⚠️ | cap/order לא נבדקו |
| PROMPT-8 | ⚠️ | sentence-boundary integration לא נבדק |
| GEMINI-1 | ⚠️ | narrateToolCall לא קיים — שאלה אם לחזור |
| WS-4, WS-7 | ⚠️ | validation עקיף |
| TTS-4 | ⚠️ | eviction לא נבדק |

---

## קבצי Tests רלוונטיים ב-v2 (core + backend)

> Frontend tests יתווספו עם slice 1+.

| קובץ | behaviors v1 שמכוסות |
|------|----------------------|
| core/tests/ui/markdown.test.ts | MARKDOWN-1..7 |
| core/tests/acp/provider-error.test.ts | PROMPT-17, PROMPT-19 |
| core/tests/voice/sentence-boundary.test.ts | PROMPT-8 (חלקי) |
| core/tests/voice/cache-key.test.ts | TTS-4 (חלקי) |
| core/tests/voice/translation-prompt.test.ts | GEMINI-1 (חלקי) |
| core/tests/ws-messages.test.ts | WS-2 |
| backend/tests/gemini-transcription.test.ts | STT-2, STT-3, STT-6 |
| backend/tests/voice-pipeline.test.ts | STT-3, GEMINI-3/5/8, TTS-2/6/8 |
| backend/tests/providers.test.ts | STT-1 (חלקי), TTS-1, GEMINI-2 |
| backend/tests/acp-transport.test.ts | ACP-2, ACP-10, ACP-12 (חלקי), ACP-17 |
| backend/tests/ws-streams.test.ts | ACP-3 |
| backend/tests/client-impl.test.ts | ACP-6 |
| backend/tests/agent-session.test.ts | ACP-7..9, ACP-13, PROMPT-1/2/16/18/20 |
| backend/tests/agent-session-audio.test.ts | STT-8, PROMPT-5 |
| backend/tests/agent-orchestrator.test.ts | ACP-4 (חלקי), PROMPT-17 (חלקי) |
| backend/tests/bridge-manager.test.ts | ACP-1, ACP-12 (חלקי) |
| backend/tests/cli-config.test.ts | ACP-1 |
| backend/tests/ws-agent.test.ts | WS-1 (חלקי), WS-3, WS-5 |
| backend/tests/cache-disk.test.ts | TTS-4 (חלקי) |
