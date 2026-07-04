# voice-acp — Project Learnings

Persistent project-specific knowledge. Loaded by agent at session start
via `opencode.jsonc` instructions.

For cross-project knowledge see `~/.config/opencode/learnings.md`.

---

### [2026-05-29] gotcha: claude CLI אינו ACP-compliant
ה-`claude-agent-acp` סוגר את ה-WS עם code 1005 (no status received) מיד אחרי
ה-initialize handshake. ‏לא ניתן ‏לעבוד ‏איתו ‏מ-voice-acp ‏עד ‏שזה מתוקן ב-upstream.
‏רק `opencode` עובד מבין ה-CLIs הנתמכים. ‏נצפה ב-slice 8 בדיקה ידנית.
‏ה-FE ‏מאפשר לבחור claude ב-connect dropdown — ‏כדאי להוסיף אזהרה או disable
‏עד שזה ייתוקן.

### [2026-05-29] gotcha: Gemini CLI לא תומך ב-ACP session/list
‏`gemini-cli --experimental-acp` ‏מחזיר ‏error code -32601 ("method not found")
‏על ‏`session/list`. ‏ה-adapter ‏ב-`packages/frontend/src/lib/adapters/sessions.ts`
‏מטפל בזה ‏ומחזיר ‏[]. ‏Session picker ‏יראה empty state ל-gemini, ‏לא ‏error.

### [2026-05-29] fact: ACP loadSession MUST replay history
‏לפי spec (https://agentclientprotocol.com/protocol/session-setup#loading-sessions):
‏אחרי session/load, ‏ה-Agent ‏MUST שולח את כל ההיסטוריה דרך session/update
‏notifications (user_message_chunk, agent_message_chunk, וכו') ‏לפני שמשיב
‏ל-load. ‏ה-FE שלנו ב-`agent-session.svelte.ts` ‏צריך handler ל-user_message_chunk
‏(מטופל ב-slice 8 hotfix).

‏OpenCode ‏בפועל ‏לא ‏אומת — ‏ייתכן ‏שמיישם ‏חלקית. ‏בדיקה ‏אמפירית ‏ב-BE log
‏(ספור session/update notifications אחרי loadSession).

### [2026-05-29] convention: parallel-safe additive design
‏שני סוכנים שעובדים ב-worktrees נפרדים על אותו ‏branch יכולים לערוך אותו
‏קובץ ‏בלי קונפליקט סמנטי, ‏אם השינויים שלהם additive.
‏מסמך מלא: `docs/conventions/parallel-safe-code.md`. ‏TL;DR ב-AGENTS.md.

‏כללים:
- Additive only ב-context.ts, +layout.svelte, i18n/keys.ts, chat/+page.svelte
- Section headers `// ─── domain ───` בקבצים hot
- Invasive change → planner prep commit נפרד

### [2026-05-29] convention: EXECUTOR_DISPATCH.md ‏מצמצם prompts
‏Boilerplate משותף לכל dispatch ל-executor. ‏Prompts הופכים ל-5 שורות במקום
‏25 ‏שורות. ‏מסמך: `docs/plans/EXECUTOR_DISPATCH.md`.

‏טמפלט dispatch:
```
‏בצע docs/plans/slice-X.md.
‏Pre-conditions ב-docs/plans/EXECUTOR_DISPATCH.md.
‏Dev tip: <HASH>
‏BE port: 4000 אם פנוי, אחרת 4001+ (אל תשאל).
‏Verifier: light/heavy (לפי הbrief).
```

### [2026-05-29] gotcha: BE חייב OneCLI
‏ה-BE proxy ב-`/proxy/elevenlabs/*` ‏ו-`/proxy/google/*` ‏דורש credentials
‏שOneCLI מזריק. ‏הפעלה ‏עם `pnpm dev` רגיל תיכשל עם 401 ‏על כל TTS/translate/STT.

‏פקודה נכונה:
```bash
cd packages/backend
onecli run --agent voice-acp -- bun --watch src/server.ts
```

‏סימנים: ‏BE log עם `proxy upstream non-2xx` warnings, FE ‏רואה `TTS failed: 401`.
‏פירוט ב-AGENTS.md (root) §Backend MUST run through OneCLI.

### [2026-05-29] decision: Voice ID hardcoded ‏לSarah ‏עד slice 9b
‏ב-Speaker VM ‏יש `VOICE_ID = "EXAVITQu4vr4xnSDxMaL"` (Sarah). ‏slice 9a ‏(voice picker)
‏הוסיף UI לבחירת voice ‏ב-Settings, ‏אבל Speaker עדיין קורא מהSettings ב-runtime.
‏אם בעתיד Settings page יוסיף ‏toggle לאודיו on/off ‏או slider ל-volume — ‏slice 9b.

### [2026-05-29] fact: BE proxy cache מטפל בGemini + ‏ElevenLabs
‏`packages/backend/src/delivery/proxy-cache.ts` ‏מטפל ב-2 endpoints:
- ‏POST /v1beta/models/*:generateContent (Gemini translate)
- ‏POST /v1/text-to-speech/{voiceId}/stream (ElevenLabs TTS)

‏Cache key = sha256(method|path|body). ‏Hit/miss מוצג ‏ב-x-cache header.
‏Smoke test (`tests/smoke/cache-replay.mjs`) ‏בודק את ‏זה.

### [2026-05-29] convention: smoke tests עם RESULT JSON
‏ב-`tests/smoke/` ‏יש 4 ‏tests + ‏runner. ‏כל test מוציא `RESULT: {...JSON...}`
‏ב-end לפענוח קל. ‏פירוט: `tests/smoke/README.md`.

‏הרצה ‏אחרי merge ל-dev: ‏`cd tests/smoke && node run-all.mjs` ‏(BE+FE רצים).

### [2026-07-04] gotcha: `taskkill //T` (kill-tree) על Windows הורג את ה-host הלא-נכון
‏בניקוי preview-servers אחרי merge, הרגתי כל preview עם `taskkill //PID <x> //F //T`.
‏ה-**`/T`** הורג את **כל עץ-התהליכים** תחת ה-pid — לא רק ה-server. bun מריץ
‏worker/children תחת shell/launcher משותף; ה-`/T` טיפס על העץ המשותף והרג בטעות
‏את ה-**BE הראשי** (pid 13644, port 4000) — לא הייתי אמור לגעת בו. **סימן חי**:
‏ה-kill של ה-integration server **נקטע אחרי 2 דקות** (exit 1) — טיפוס על עץ גדול
‏ולא-צפוי. **תסמין נלווה**: 4000 נשאר `LISTENING` על pid מת (zombie-socket,
‏handle-inheritance — ר' `docs/investigations/2026-07-01-be-shutdown-socket-health.md` §3).

**‏הכלל**: לעולם לא `taskkill //T` על bun/node servers שחולקים shell. **kill ממוקד
‏בלבד**: `taskkill //PID <pid> //F` (בלי `//T`), *אחרי* אימות ש-pid הוא ה-server
‏הבודד (command-line מ-`Get-CimInstance Win32_Process`). זהו הצד ההפוך של "כשל #2"
‏בחקירת be-shutdown (שם ה-kill הרג *מעט מדי* — רק בן ישיר; כאן `//T` הרג *יותר מדי*).
‏אירוני: הרגתי את ה-host בדיוק כמו ה-`be-shutdown-hardening` שהזהיר מפני זה.
