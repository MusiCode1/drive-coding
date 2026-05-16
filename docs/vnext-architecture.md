# vNext Architecture — drive-coding (לשעבר voice-acp)

> **סטטוס:** טיוטה שנייה (שכבה 1.5 — עקרונות, החלטות, מודולים, UX, תשובות לשאלות פתוחות).
> **כותב:** Tama (planner agent), בדיון עם אבי.
> **תאריך התחלה:** 2026-05-15.
> **שם מועדף:** `drive-coding` (אבי לאישור).
> **לא קוד פעיל** — תיעוד תכנון. הקוד יבוצע ב-worktree נפרד `drive-coding` (או `voice-acp-v2` זמני).

---

## תוכן עניינים

1. [מטרה ויעדים](#1-מטרה-ויעדים)
2. [עקרונות מנחים](#2-עקרונות-מנחים)
3. [דרישות מאבי](#3-דרישות-מאבי)
4. [החלטות שנלקחו (locked)](#4-החלטות-שנלקחו-locked)
5. [שאלות פתוחות](#5-שאלות-פתוחות)
6. [Mental Model — מה המוצר עושה](#6-mental-model)
7. [ארכיטקטורה ברמת domains](#7-ארכיטקטורה-ברמת-domains)
8. [Module map (backend + frontend)](#8-module-map)
9. [Deployment](#9-deployment)
10. [תהליך פיתוח (worktree, מיגרציה)](#10-תהליך-פיתוח)
11. [Roadmap](#11-roadmap)

---

## 1. מטרה ויעדים

### מה הגרסה הבאה עושה

**ממשק קולי לסוכני CLI לשימוש hands-free.**

ממשק שיחה רב-לשוני (עברית קודם, אנגלית אחר כך), רב-משתמש (אנונימי), שמתפקד כשכבה קולית מעל **כל CLI agent שמדבר ACP** — opencode, Gemini CLI, Claude Code (דרך adapter), וכל מה שיגיע. מיועד בעיקר לשימוש במצבים שהידיים תפוסות: **נהיגה ("drive coding"), שטיפת כלים, ריצה, בישול**. רץ בקונטיינר אצל אבי בפרוקסמוקס, נגיש דרך מנהרת Cloudflare, מיועד לאימוץ קהילתי של מפתחים.

### תיאור בכמה מילים (אבי, 2026-05-15)

> ממשק קולי לסוכני CLI. יש ממשקים גרפיים כמו codenomad או opencode WEB. אני יוצר ממשק קולי שבו ניתן לנהל את ה-CLI בשיחה קולית בזמן נהיגה או שטיפת כלים. אפשר להתחבר לכל CLI תומך ACP, גם Claude Code תומך עם מתאם.

### מה הגרסה הבאה איננה

- **לא ריפקטור** של ה-POC. greenfield. ה-POC ימשיך לחיות ב-master עד שהחדש כשיר.
- **לא רב-לשוני ב-MVP** — עברית בלבד (D20). i18n layer מובנה לעתיד.
- **לא single-page app.** אפליקציה מלאה — routing, dashboard, multi-session.
- **לא DB משלנו.** stateless ככל הניתן. רק cache של קריאות יקרות (תרגום/תמלול/הקראה) בקבצים. agent registry בזיכרון.
- **לא identity / auth ב-MVP.** רץ אצל אבי, אין משתמשים אחרים. localStorage ל-preferences בלבד.
- **לא vendor lock-in ל-opencode.** ACP transport מופשט מספיק לתמוך גם ב-Gemini CLI, Claude Code, וכל מי שיהיה.

### יעדים מדידים

| יעד | מדד |
|-----|-----|
| Time-to-first-audio | ≤ 1.5s מסיום הקלטה ועד התחלת השמעה (היום ~2-3s) |
| Reconnect-survival | סוכן ממשיך לרוץ גם אם המשתמש סוגר את הדפדפן ל-30 דקות |
| Multi-session | משתמש יכול לעבוד במקביל על 5+ סוכנים פעילים |
| Port-ability | ה-core (פונקציות טהורות) ניתן ל-port ל-Go עם < שבוע עבודה |
| Cache hit rate | > 30% על תרגום/הקראה אחרי שבוע ריצה |
| Cold start | < 3s מ-spawn של agent process עד מוכן לקלט |

---

## 2. עקרונות מנחים

### 2.1 Functional core, imperative shell

כל לוגיקה שמחליטה משהו (parsing, routing, decision-making, state transitions) — פונקציות טהורות שמקבלות data ומחזירות data. ה-IO (WebSocket, spawn, fetch, filesystem) — עוטף דק שקורא ל-core.

**מה זה אומר בפועל:**
- אין singletons שמחזיקים state גלובלי.
- אין "manager" classes שמערבבים IO עם החלטות.
- כל פונקציה שאי אפשר לבדוק עם input/output בלי mock — חשד.
- `ConnectionState` הוא data, לא class עם methods שמתקשרים החוצה.

**מה זה לא אומר:**
- לא monads, לא Effect.ts, לא fp-ts.
- לא immutability דוגמטית — `Map` ו-`Array` רגילים מותרים, פשוט נטו לא לחלוק אותם בין closures.
- לא higher-kinded types או ML-style discipline.

### 2.2 ACP-agnostic core, transport-pluggable

הקוד שלנו מדבר ACP. מה הוא לא מכיר:
- האם ACP רץ על stdio או HTTP.
- אם הסוכן הוא opencode, Gemini CLI, או משהו אחר.
- אם זה רץ אצלי או בענן.

`AcpTransport` הוא interface. יש implementations: `StdioTransport`, `HttpTransport` (אם קיים/נצטרך לבנות), ובעתיד אולי `WebSocketTransport`.

### 2.3 Agent process = entity עצמאית עם זהות

כמו שלמדנו ב-tmux: שרת רץ ברקע, clients מתחברים ומתנתקים. אצלנו:

- כל agent process (opencode/Gemini/וכו') הוא "Agent Instance" עם UUID.
- מחזור החיים שלו לא תלוי בחיבור הדפדפן.
- ה-WebSocket של הדפדפן הוא subscription לעדכונים ממנו.
- כשהדפדפן נסגר — ה-agent ממשיך. כשהוא חוזר — מתחבר מחדש למזהה.
- "כיבוי" הוא פעולה מפורשת של המשתמש (כמו codenomad).

### 2.4 Stateless כמה שאפשר, persistent רק כשחייב

| Layer | Persistent? | איפה | Scope |
|-------|-------------|------|-------|
| Conversation content | לא | ה-CLI agent עצמו (opencode/Gemini) שומר; `session/load` ב-reconnect | mvp |
| Agent registry (id, cliKind, cwd, status, bridgePort) | לא | `Map<id, Agent>` בזיכרון | mvp |
| Bridge processes | חיצוני | `@rebornix/stdio-to-ws` עם `--persist` שורד נפילת backend | mvp |
| TTS cache | כן | disk files (`/data/cache/tts/<hash>.mp3`) | mvp |
| STT cache | אופציונלי | disk files | mvp |
| Translation cache | כן | disk files | mvp |
| User preferences (voice, language, providers) | קל | `localStorage` ב-frontend | mvp |
| User identity / tokens | — | אין ב-MVP. אם בעתיד נפתח לכמה משתמשים — anonymous tokens ב-localStorage + K/V backend | future |

**הכלל:** אם נאבד את זה ב-restart — האם המשתמש ירגיש?
- agent registry: כן (יוצר חדש, ~5 שניות)
- conversation content: לא (CLI שומר)
- cache: לא (יבנה מחדש בהדרגה, רק עלות זמנית)

backend נפילה ב-MVP = `pct restart` של הקונטיינר + יצירת agents חדשים. acceptable.

### 2.5 Backend ו-frontend מנותקים מהיום הראשון

אין SSR שמערבב לוגיקת backend בתוך SvelteKit endpoints. ה-backend הוא service נפרד עם API מתועד. SvelteKit עוסק ב-UI בלבד.

זה מכפיל את הסיכוי שיום אחד נפרד ל-Go ב-backend בלי לגעת ב-frontend, ומאפשר deployment נפרד (frontend ל-Cloudflare Pages, backend ל-Fly.io, נגיד).

### 2.6 Types משותפים

הפרוטוקול בין front ל-back מוגדר ב-package אחד מתועד (`@voice-acp/protocol`), שמיובא משני הצדדים. אין JSON ad-hoc.

### 2.7 i18n מובנה, לא bolted-on

מההתחלה — אין מחרוזת hardcoded בעברית בקוד. כל טקסט עובר דרך i18n layer (frontend + backend). שפת ברירת מחדל = שפת הדפדפן או שפה שנשמרה ב-preferences.

---

## 3. דרישות מאבי

תיעוד מילולי של מה שאבי אמר בדיוני התכנון. **חלק מהדרישות הן vision לעתיד ולא ל-MVP** — מסומן בעמודה Scope.

| # | דרישה | Scope | הערה |
|---|--------|-------|------|
| 1 | רב-לשוני (לא רק עברית) | future | D20: עברית בלבד ב-MVP. i18n מובנה |
| 2 | רץ בענן | future | D14: Proxmox container אצל אבי ב-MVP. ענן ציבורי אם הקהילה תגדל |
| 3 | בלי DB משלנו, רק cache | mvp | D8 |
| 4 | ACP על פני vendor lock-in ל-opencode | mvp | D6 + D33 |
| 5 | שקילת ACP-over-HTTP אם משתלם | done | D33: spawn `@rebornix/stdio-to-ws` |
| 6 | CLI ממשיך לרוץ אם המשתמש סוגר דף | mvp | D33: `--persist --grace-period -1` |
| 7 | הפעלה/כיבוי מפורשים של ה-CLI | mvp | UI + API endpoint |
| 8 | ריבוי סשנים בממשק (dashboard) | mvp | D12 |
| 9 | Worktree לפיתוח מקביל ל-POC | mvp | D4 — נעשה ב-Slice 1 |
| 10 | TypeScript (לא Go לעת עתה) | mvp | D1 |
| 11 | Functional core (לאפשר port ל-Go בעתיד) | mvp | D5 + D28 |
| 12 | Frontend = אפליקציה מלאה (routing, dashboard) | mvp | D2 + D21 |

---

## 4. החלטות שנלקחו (locked)

**Scope tags:** `[mvp]` = ב-MVP אצל אבי. `[future]` = vision לעתיד, לא ב-MVP. `[both]` = עיקרון יסוד שתקף לשני המצבים.

| # | Scope | החלטה | הקשר |
|---|-------|-------|------|
| D1 | [both] | TypeScript + Bun ב-backend | אבי מכיר; port עתידי ל-Go אפשרי דרך פונקציונלי |
| D2 | [both] | SvelteKit ב-frontend | אבי בחר במפורש |
| D3 | [both] | Greenfield, לא ריפקטור | "לתכנן את הכל מחדש" |
| D4 | [both] | Worktree `voice-acp-v2` | master ימשיך לעבוד עד מעבר |
| D5 | [both] | Functional core, imperative shell | לא fp library מלא |
| D6 | [both] | ACP transport מופשט | תמיכה ב-multi-CLI; transport pluggable |
| D7 | [both] | Agent process = entity עצמאית | שורד סגירת דף (ה-bridge ב-D33, לא הregistry) |
| D8 | [both] | אין DB משלנו | cache בקבצים. agent registry בזיכרון. localStorage ל-prefs. CLI שומר conversation |
| D9 | [both] | Backend ו-frontend נפרדים | services נפרדים, API מתועד, types משותפים |
| D10 | [both] | i18n layer מובנה מהתחלה | אין hardcoded strings; **שפת ברירת מחדל: עברית** |
| **D11** | **[future]** | **אין identity ב-MVP.** אנונימי + tokens רק אם נפתח לכמה משתמשים | תוקן 2026-05-16: ב-MVP אבי לבדו. אין auth, אין tokens, אין `ownerId` |
| D12 | [both] | Multi-session מהתחלה | dashboard, routing. אבל ללא identity — כל ה-agents שייכים ל-instance |
| D13 | [both] | שם הפרויקט: `drive-coding` | משקף את היעד — voice-first hands-free |
| D14 | [mvp] | Deployment ראשון: Proxmox container + CF tunnel | אצל אבי. ענן ציבורי [future] אם הקהילה תגדל |
| ~~D15~~ | — | ~~ACP transport: stdio בלבד ל-MVP~~ | מבוטל ב-D33 |
| ~~D16~~ | — | ~~Agent dies with backend (MVP)~~ | מבוטל ב-D23/D33 |
| D17 | [mvp] | Cache: disk בלבד ל-MVP | `/data/cache/{tts,stt,translations}/<hash>.*`. R2/KV ב-[future] |
| D18 | [both] | Pricing: BYOC (Bring Your Own CLI) | משתמש משתמש ב-CLI עם המינוי שלו. STT/TTS אצל אבי ב-MVP, BYOK ב-[future] |
| D19 | [both] | UX: כפתור גדול יחיד | start/stop + cancel של model במצב "speaking" |
| D20 | [mvp] | שפות התחלה: עברית בלבד | אנגלית [future] כשירגיש בשל |
| D21 | [both] | Frontend routes: `/`, `/agent/new`, `/agent/:id`, `/settings` | (Q8 closed) |
| D22 | [mvp] | אין הקלדה ב-MVP | קולי בלבד. לא נעול — נשקול אחר כך |
| D23 | [both] | bridges שורדים נפילת backend | דרך D33: `--persist --grace-period -1` |
| D24 | [both] | Claude Code דרך `@agentclientprotocol/claude-agent-acp` | adapter רשמי, 1.9k★ |
| ~~D25~~ | — | ~~`@flutur/acp-http-bridge`~~ | מבוטל ב-D33 |
| D26 | [future] | התאם WS ל-ACP Streamable HTTP RFD | רלוונטי רק אם נחשוף את ה-bridge בעתיד. ב-MVP ה-FE↔BE protocol שלנו (drive-coding-ws), לא RFD |
| ~~D27~~ | — | ~~neverthrow + Zod~~ | מעודכן ב-D31 |
| D28 | [both] | Hexagonal architecture מינימלי | 2 packages (`core` + `backend`). שכבות בתוך `backend/` הן תיקיות |
| ~~D29~~ | — | ~~`voice-coda` כ-reference~~ | מעודכן ב-D32 (license missing) |
| ~~D30~~ | — | ~~`acp-bridge` משלנו~~ | מבוטל ב-D33 |
| D31 | [both] | ArkType + neverthrow | ביצועים, syntax, מה שאבי כבר משתמש |
| D32 | [mvp] | לא להישען על voice-coda — לפנות בנימוס ל-license | בינתיים independent build |
| D33 | [both] | spawn `@rebornix/stdio-to-ws` כ-bridge | npm published, `--persist`, `--grace-period`, Dev Tunnels |
| D34 | [future] | `acp-ui` של formulahendry קיים — awareness | 274⭐, MIT, alternative client. drive-coding מתמקד במקום אחר (D41) |
| D35 | [mvp] | Audio cues — צלילי feedback | recording_start/stop, thinking, tool_call, error |
| D36 | [mvp] | Provider catalog ב-UI | `GET /api/providers` + dropdown ב-`/settings` |
| ~~D37~~ | — | ~~SttProvider capability flags~~ | מבוטל ב-D38 |
| D38 | [both] | **Vercel AI SDK** כליבת provider abstraction ⭐ | `TranscriptionModelV3`/`SpeechModelV3`/`LanguageModelV3`. 25+ providers רשמיים + custom (D39) |
| D39 | [both] | Custom Gemini transcription provider | AI SDK לא תומך. ~80 שורות. previousAssistantText context |
| D40 | [both] | Hexagonal layer 2 = AI SDK contracts | עדכון D28 |
| D41 | [both] | Build from scratch, לא fork acp-ui | drive-first הוא הייחוד; SvelteKit |
| D42 | [mvp] | Audio cues — 5 צלילים | minimal MVP. theme picker [future] |
| D43 | [mvp] | Provider scope per-user | ב-`/settings`. per-agent [future] |
| D44 | [mvp] | קונטיינר 134 (voice-coda) נשמר | reference |
| D45 | [both] | Runtime-agnostic: Node 22+ ו-Bun | Hono אגנוסטי. `npx`/`bunx` שניהם |
| D46 | [both] | TDD חלקי — core full, backend partial | `/tdd` skill ב-executor |
| D47 | [both] | Port pure tests מ-v1 | ~96 בדיקות port-able |
| D48 | [both] | Vitest כtest runner | universal Node+Bun |
| D49 | [both] | Mock agent מתוך SDK ל-integration tests | `@agentclientprotocol/sdk/src/examples/agent.ts` |
| D50 | [both] | acpx conformance suite ב-CI nightly | `openclaw/acpx/conformance/` + real adapters |
| **D45** | **Runtime-agnostic: Node 22+ ו-Bun** | Hono ל-HTTP/WS (אגנוסטי). `node:sqlite` או `better-sqlite3`. `npx drive-coding` ו-`bunx drive-coding` שניהם עובדים |
| **D46** | **TDD חלקי — core full, backend partial** | `/tdd` skill ב-executor mode. core (sentence-boundary, cancel, custom Gemini provider) ב-red-green-refactor. delivery עם validation tests. IO heavy עם integration |
| **D47** | **Port pure tests מ-v1** | ~96 בדיקות עוברות 1:1 (sentence-boundary, provider-error, markdown, tts-cache, recordings paths). ~193 לא רלוונטיות בגלל D33+D38 |
| **D48** | **Vitest כtest runner** | universal Node+Bun. `pnpm workspaces`. tests ב-`packages/{core,backend}/tests/` |
| **D49** | **Mock agent ל-integration tests מתוך SDK** | `@agentclientprotocol/sdk/src/examples/agent.ts` — ACP-compliant mock מובנה. שני patterns: loopback streams (in-process) או spawn child (יותר ריאלי). חוסך לנו לכתוב mock agent משלנו |
| **D50** | **acpx conformance suite ב-CI nightly** | `openclaw/acpx/conformance/` — 20 required cases ב-JSON, runner ב-TS, mock adapter מובנה, normative spec ב-`spec/v1.md`. נריץ נגד ה-AcpTransport שלנו ונגד real adapters (opencode/claude/gemini) ב-nightly |

---

## 5. שאלות שנסגרו — היסטוריה

כל ה-Q questions נסגרו בסבבים 1-7 והם משוקעים ב-D-table:

| Q# | נושא | תוצאה | D# |
|----|------|--------|-----|
| Q1 | איפה לפרוס | Proxmox + CF tunnel אצל אבי | D14 |
| Q2 | ACP transport | spawn `@rebornix/stdio-to-ws` | D33 |
| Q3 | Agent orchestration | bridges שורדים נפילת backend | D33 |
| Q4 | Cache | disk ל-MVP | D17 |
| Q5 | Identity | אין ב-MVP | D11 |
| Q6 | Pricing | BYOC | D18 |
| Q7 | i18n | עברית בלבד ב-MVP, layer מובנה | D20 |
| Q8 | Frontend routes | טיוטה אושרה | D21 |
| Q9 | שם פרויקט | `drive-coding` | D13 |
| Q10 | Stop mechanism | אותו כפתור הקלטה | D19 |
| Q11 | Wake word | POC אחרי MVP | (future) |
| Q12 | Backend survival | reactive (פתור גם דרך D33) | — |
| Q13 | הקלדה | לא ב-MVP | D22 |
| Q14 | UI Components | כפתור גדול + בועות + סטטוס | D19 + §9.6 |
| Q14a | Bridge protocol pieces | פתור ע"י stdio-to-ws ישירות | D33 |
| Q14b | Wake word library | openWakeWord (future) | (future) |
| Q15 | State machine | כפי שב-§9.6 | (כיוון D19) |
| Q16 | Settings split | עמוד אחד ב-MVP | D21 |
| Q17 | Image format | Docker | D14 |
| Q18 | Multi-CLI adapter | Claude Code adapter רשמי | D24 |
| Q-NEW-1 | Bridge as-is/contribute/fork | spawn ה-CLI שלהם | D33 |
| Q-NEW-2 | Whisper+Piper local | מתווסף בקלות דרך AI SDK | D38 |
| Q-NEW-3 | ללמוד מ-voice-coda | inspiration רעיונית בלבד | D32 |
| Q-NEW-4 | Build vs fork acp-ui | Build (drive-first הייחוד) | D41 |
| Q-NEW-5 | Audio cues theme | 5 צלילים minimal | D42 |
| Q-NEW-6 | Provider scope | per-user | D43 |
| Q-NEW-7 | Container 134 voice-coda | נשמר ל-reference | D44 |

**אם יעלו שאלות חדשות**, יוסיפו כ-Q-NEW-8 ואילך.

---

## 6. Mental Model

### דמיון מועיל: tmux לסוכני AI

- **tmux server** = backend service שלנו.
- **tmux session** = Agent Instance (CLI process חי).
- **tmux client (`tmux attach`)** = פתיחת דפדפן עם החיבור ל-agent.
- **`tmux ls`** = ה-dashboard של ה-agents.
- **`tmux kill-session`** = כפתור "כיבוי" של agent.

### זרימת חיים של agent

```
1. User: "צור סוכן חדש"
   → POST /api/agents { cliKind, cwd, model }    (אין auth header — MVP)
   → Backend: BridgeManager.spawn — spawn `npx @rebornix/stdio-to-ws "opencode acp" --port 0 --persist --grace-period -1`
   → Backend: register in in-memory Map<id, Agent>
   → Backend: ACP handshake (initialize + session/new) דרך WS לbridge
   → Response: { agentId }

2. User: "פתח חיבור" (auto on agent page load)
   → WebSocket connect /ws/agent/:id  (אין auth header — MVP)
   → Backend: subscribe browser to agent's event stream
   → Browser: receives 'connected' עם voice settings + history (אם יש מ-CLI דרך session/load)

3. User: "תגיד לסוכן X"
   → Browser → WS → Backend → AcpTransport.prompt(...)
   → Agent processes, streams session/update notifications דרך bridge → backend
   → Backend → voice pipeline (transcribe done already, now translate+TTS) → WS → Browser

4. User: סוגר דף
   → WebSocket closes
   → Bridge ממשיך לרוץ (--persist)
   → ה-CLI ממשיך לעבד דרך ה-bridge
   → Backend מאזין ל-bridge ומאחסן events בbuffer בזיכרון (לreconnect מהיר)

5. User: חוזר אחרי 10 דקות
   → Browser → WS connect → 'connected' event עם history
   → Backend: שולח את ה-buffered events
   → ממשיך כרגיל

6. User: "כבה את הסוכן"
   → DELETE /api/agents/X
   → Backend: cancel ל-bridge, kill process, remove from in-memory Map

7. backend crash (תרחיש קצה)
   → Bridges שורדים (--persist)
   → backend חוזר תוך שניות (systemd)
   → in-memory Map ריקה → frontend מציג dashboard ריק
   → User יוצר agents חדשים. ה-bridges הישנים שלא נוצרים אליהם — נמתין שיעצרו על ידי grace period או יהרגו ידנית
```

---

## 7. ארכיטקטורה ברמת domains

7 domains, כל אחד עם responsibility ברורה ו-API מתועד:

### 7.1 Transport
**מה:** WebSocket / HTTP בין frontend ל-backend.
**אחריות:** serialization, authentication, routing של messages.
**Pure?** כן (parsing/routing). IO רק ב-edges.

### 7.2 ~~Identity~~ (לא ב-MVP)

ב-MVP אין identity. רץ אצל אבי, instance יחיד, כל ה-agents שייכים ל-instance.

**אם בעתיד נפתח לכמה משתמשים** (`[future]`):
- anonymous tokens ב-localStorage
- agent ownership map דרך `ownerId` ב-Agent
- אופציונלית — OAuth

זה refactor בעתיד אם יידרש. interface ה-`AgentRegistry` מקבל כיום `Map<agentId, Agent>` בלי `ownerId`; אם נצטרך, נוסיף אופציונלי בלי שינוי שיברה.

### 7.3 Agent Orchestration
**מה:** ניהול mahzor חיים של CLI processes (דרך bridges).
**אחריות:** spawn דרך BridgeManager, kill, registry, subscribe, broadcast events ל-WS clients.
**State:** in-memory `Map<agentId, AgentInstance>`. נאבד ב-backend restart (acceptable ב-MVP).

### 7.4 ACP
**מה:** abstraction של פרוטוקול ACP.
**אחריות:** initialize, session/new, session/prompt, session/cancel, parsing של session/update.
**Sub-domains:** `AcpTransport` (websocket-to-bridge / stdio), `AcpClient` (logic).

### 7.4a ACP Bridge — צרכן של `@rebornix/stdio-to-ws` (עדכון D33)

הרעיון של אבי ממומש בpackage בוגר ב-npm. אנחנו לא בונים — אנחנו spawn-ים.

**מה זה:** `@rebornix/stdio-to-ws` (fork של `marimo-team/stdio-to-ws`) הוא בinary שעוטף **כל** stdio process ב-WebSocket. ב-npm, Apache-2.0, v0.2.0. משמש ב-`acp-ui` (274★) שזה ה-web client הכי בוגר ל-ACP.

**איך אנחנו משתמשים בו:**
```ts
// packages/backend/src/adapters/bridge-spawn.ts
import { spawn, type ChildProcess } from "node:child_process"

export type BridgeHandle = {
  readonly port: number
  readonly process: ChildProcess
  readonly wsUrl: string
}

export async function spawnBridge(opts: {
  cliCommand: string         // e.g., "opencode acp"
  port: number               // OS-assigned (use 0)
  cwd: string
  persist?: boolean          // keep CLI alive on disconnects
  gracePeriod?: number       // -1 for infinite (mobile)
  tunnelName?: string        // optional Dev Tunnel
}): Promise<BridgeHandle> {
  const args = [
    "@rebornix/stdio-to-ws",
    opts.cliCommand,
    "--port", String(opts.port),
    ...(opts.persist ? ["--persist"] : []),
    ...(opts.gracePeriod !== undefined
      ? ["--grace-period", String(opts.gracePeriod)]
      : []),
    ...(opts.tunnelName
      ? ["--tunnel-name", opts.tunnelName]
      : []),
  ]
  const proc = spawn("npx", args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] })
  // Parse port from stdout, return handle
  // ...
}
```

**מה אנחנו מקבלים חינם:**
- ✅ stdio↔WebSocket wrapping (line / NDJSON framing — ACP native)
- ✅ **`--persist` + `--grace-period -1`** — CLI שורד disconnects (חיוני למובייל ולנהיגה)
- ✅ Client-Id replay buffer
- ✅ **Microsoft Dev Tunnels integration** (`--tunnel-name`) — `wss://` URL יציב מבלי TLS/proxy ידני
- ✅ בinary בלבד, ללא integration code שלנו לתחזוקה

**מה אנחנו עדיין צריכים לעשות:**
- כתיבת `BridgeManager` ב-`backend/adapters/` שspawn-ים, מנטר, ו-killing את ה-bridge processes
- כתיבת `AcpTransport` adapter שמתחבר ל-WS שה-bridge חושף ומדבר ACP JSON-RPC
- (זה מה ש-`@agentclientprotocol/sdk` עושה — שני שלבים שמקצרים ל-~100 שורות)

**Survival flow:**
1. Backend spawn-ים `npx @rebornix/stdio-to-ws "opencode acp" --port 0 --persist --grace-period -1`
2. ה-bridge מדפיס "Listening on ws://127.0.0.1:7100"
3. Backend connect ל-WS, מבצע ACP handshake, מקבל `connectionId` + `sessionId`
4. Backend נופל / מתעדכן → ה-bridge ממשיך, מצבר sessionUpdate notifications, ה-CLI ממשיך לעבד
5. Backend חוזר → reconnect ל-WS עם `X-Client-Id` header → bridge עושה replay של ה-buffered events

### 7.5 Voice Pipeline (D38 — Vercel AI SDK)

**מה:** STT → translator/narrator → TTS, כל אחד עם בחירת provider דינמית.

**אחריות:** orchestration (sentence boundary, cancel, cache). ה-provider abstraction מ-Vercel AI SDK.

**Provider registry** (`backend/voice/providers.ts`):
```ts
import { openai } from '@ai-sdk/openai'
import { elevenlabs } from '@ai-sdk/elevenlabs'
import { deepgram } from '@ai-sdk/deepgram'
import { google } from '@ai-sdk/google'
import { geminiTranscription } from './providers/gemini-transcription' // D39

import type { TranscriptionModelV3, SpeechModelV3, LanguageModelV3 } from '@ai-sdk/provider'

export const STT_REGISTRY: Record<string, TranscriptionModelV3> = {
  'gemini/flash-context': geminiTranscription('gemini-flash-latest'),  // ייעודי שלנו, תומך context
  'openai/whisper-1': openai.transcription('whisper-1'),
  'openai/gpt-4o-transcribe': openai.transcription('gpt-4o-transcribe'),
  'deepgram/nova-3': deepgram.transcription('nova-3'),
  'elevenlabs/scribe': elevenlabs.transcription('scribe_v1'),
}

export const TTS_REGISTRY: Record<string, SpeechModelV3> = {
  'elevenlabs/v3': elevenlabs.speech('eleven_v3'),     // הכי טוב לעברית
  'openai/tts-1': openai.speech('tts-1'),
  'openai/tts-1-hd': openai.speech('tts-1-hd'),
  'google/wavenet-he': google.speech('wavenet-he-IL'),
}

export const TRANSLATOR_REGISTRY: Record<string, LanguageModelV3> = {
  'gemini/flash-lite': google('gemini-flash-lite-latest'),  // הקיים מה-POC
  'openai/gpt-4o-mini': openai('gpt-4o-mini'),
  'anthropic/haiku': anthropic('claude-haiku-latest'),
}
```

**Pipeline orchestration** (`backend/voice/pipeline.ts`):
```ts
import { experimental_transcribe as transcribe, experimental_speech as speech, generateText } from 'ai'

export async function voiceRoundtrip(input, deps, settings) {
  // STT
  const sttResult = await transcribe({
    model: STT_REGISTRY[settings.sttModel],
    audio: input.audioBytes,
    providerOptions: settings.sttOptions,  // למשל לGemini: { gemini: { previousAssistantText: '...' } }
  })

  // הfeedback ל-frontend
  deps.sendThinking(sttResult.text)

  // ACP prompt (לא דרך AI SDK — דרך acp-bridge)
  await deps.acpPrompt(sttResult.text)
  // ה-ACP מחזיר session/update events. ב-onChunk נחתוך משפטים ונשלח ל-TTS.

  // ל-thoughts — translator
  for (const thought of accumulatedThoughts) {
    const { text: translated } = await generateText({
      model: TRANSLATOR_REGISTRY[settings.translatorModel],
      prompt: TRANSLATE_THOUGHT_PROMPT(thought, settings.language),
    })
    deps.sendThoughtTranslation(translated)
    // TTS
    const audio = await speech({
      model: TTS_REGISTRY[settings.ttsModel],
      text: translated,
      voice: settings.ttsVoiceId,
    })
    deps.sendAudio(audio.audioBytes)
  }
}
```

**Pure?** הליבה (sentence boundary, cancel logic, cache key derivation) — כן. הקריאות עצמן ב-pipeline shell.

**Sub-modules:** `pipeline.ts` (orchestration), `providers.ts` (registries), `providers/gemini-transcription.ts` (custom D39), `cache.ts`.

### 7.6 Cache
**מה:** persistence של קריאות יקרות.
**אחריות:** lookup, store, eviction, TTL.
**Implementation:** pluggable (memory / disk / R2 / KV).

### 7.7 i18n
**מה:** תרגום UI strings, ניהול locale.
**אחריות:** load locale bundles, format messages.
**Where:** משותף ל-frontend ו-backend (שרת מחזיר messages מתורגמים).

---

## 8. Module map

### 8.1 Monorepo structure (D28 — 2 packages + frontend)

מינימלי. הוספת `packages/protocol/` כ-package נפרד תקרה רק כשטיפוסים יתחילו לחזור על עצמם וצריך isolation (אולי Slice 6+).

```
drive-coding/
├── packages/
│   ├── core/              # ⭐ Pure functional core — NO IO
│   │   ├── src/
│   │   │   ├── schemas/         # ArkType (משותף ל-backend + frontend)
│   │   │   │   ├── agent.ts          # Agent, CliKind, AgentStatus
│   │   │   │   ├── voice-settings.ts # VoiceSettings
│   │   │   │   ├── bubble.ts         # Bubble
│   │   │   │   └── ws-messages.ts    # FE↔BE WS protocol
│   │   │   ├── ports.ts         # AcpTransport, BridgeManager, CacheStore
│   │   │   ├── voice/           # sentence-boundary, cancel logic
│   │   │   ├── acp/             # message parsing, provider-error
│   │   │   ├── cache/           # cache key derivation
│   │   │   └── i18n/            # message catalogs
│   │   ├── tests/               # 100% pure unit tests (TDD per D46)
│   │   └── package.json
│   │
│   ├── backend/           # Imperative shell
│   │   ├── src/
│   │   │   ├── server.ts        # entry: Hono HTTP + WS server
│   │   │   ├── boot.ts          # wire registries + dependencies
│   │   │   ├── acp/             # ACP integration (D33)
│   │   │   │   ├── bridge-spawn.ts        # spawn @rebornix/stdio-to-ws
│   │   │   │   ├── bridge-manager.ts      # in-memory Map, lifecycle
│   │   │   │   └── acp-transport.ts       # wraps ClientSideConnection
│   │   │   ├── voice/           # voice pipeline + providers (D38)
│   │   │   │   ├── providers.ts            # STT/TTS/translator registries
│   │   │   │   ├── providers/
│   │   │   │   │   └── gemini-transcription.ts   # custom (D39)
│   │   │   │   ├── pipeline.ts             # round-trip orchestration
│   │   │   │   └── cache.ts                # disk files
│   │   │   ├── app/             # application orchestration
│   │   │   │   ├── voice-orchestrator.ts
│   │   │   │   └── agent-orchestrator.ts
│   │   │   └── delivery/        # HTTP routes, WS handlers
│   │   │       ├── http-api.ts             # /api/health, /api/agents, /api/providers
│   │   │       └── ws-handler.ts           # /ws/agent/:id, /ws/echo
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── frontend/          # SvelteKit (drive-first UI)
│       ├── src/
│       │   ├── routes/
│       │   │   ├── +page.svelte             # dashboard
│       │   │   ├── agent/[id]/+page.svelte  # ממשק קולי (כפתור גדול)
│       │   │   ├── agent/new/+page.svelte   # יצירת agent חדש
│       │   │   └── settings/+page.svelte
│       │   ├── lib/
│       │   │   ├── components/
│       │   │   │   ├── BigButton.svelte
│       │   │   │   ├── BubbleChat.svelte
│       │   │   │   └── AgentCard.svelte
│       │   │   ├── stores/
│       │   │   │   ├── agent.ts             # per-agent store factory
│       │   │   │   ├── dashboard.ts
│       │   │   │   └── settings.ts          # ב-localStorage
│       │   │   ├── api/                     # WS+HTTP clients (אין auth header)
│       │   │   ├── audio/                   # MediaRecorder + playback + cues (D42)
│       │   │   └── i18n/                    # locale loading
│       │   ├── static/sounds/               # 5 mp3 cues (D42)
│       │   └── app.html
│       └── package.json
│
├── docs/                  # spec + architecture + research + briefs
├── docker-compose.yml
├── pnpm-workspace.yaml
├── biome.json
├── vitest.config.ts
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

**הערות:**
- אין `app/identity.ts` ב-MVP (אין identity)
- `cache.ts` ב-backend עובד עם disk files; אין SQLite
- `settings.ts` ב-frontend stores נתונים ב-localStorage (per-user prefs)
- frontend מקבל ServerMessage/ClientMessage ישירות מ-`@drive-coding/core/schemas/ws-messages`

**Dependencies חיצוניים מרכזיים:**

Runtime layer (D45 — Node+Bun universal):
- `hono` — HTTP+WS framework. אגנוסטי. (`@hono/node-server` + `@hono/node-ws` נדרשים ל-Node; ב-Bun משתמשים native `Bun.serve`)
- `vitest` — tests (D48)
- `pnpm` workspaces
- אין DB. cache בקבצים. agent registry בזיכרון. (D8)

ACP transport:
- **`@rebornix/stdio-to-ws`** — bridge לכל CLI (D33). spawn דרך `npx`/`bunx`.
- `@agentclientprotocol/sdk` — JSON-RPC types + ClientSideConnection
- `@agentclientprotocol/claude-agent-acp` — Claude Code adapter (D24)

Voice (D38 — Vercel AI SDK):
- `ai` — core SDK (`transcribe`, `speech`, `generateText`)
- `@ai-sdk/provider` — types ל-custom providers (D39)
- `@ai-sdk/openai` — Whisper, GPT-4o-transcribe, TTS, GPT-4o-mini (translator)
- `@ai-sdk/elevenlabs` — Scribe (STT), Eleven v3 (TTS — הכי טוב לעברית)
- `@ai-sdk/deepgram` — Nova-3 (STT הכי מהיר)
- `@ai-sdk/google` — Gemini Flash (translator + native API ל-custom STT)
- `@ai-sdk/anthropic` — Claude Haiku (translator fallback, אופציונלי)
- `@google/genai` — used by custom Gemini transcription provider (D39)

Schemas + utilities:
- `neverthrow` — `Result<T, E>` ב-core (D31)
- `arktype` — schemas ב-`core/schemas.ts` (D31)

Future:
- `@ricky0123/vad-web` — VAD (לא ב-MVP)
- `@ai-sdk/groq` / `@ai-sdk/mistral` / ... — תוספות לפי דרישת משתמש

**הסרה משמעותית:** ה-package `packages/acp-bridge/` שתוכנן ב-D23 ושוב ב-D30 — בוטל סופית ב-D33. ה-adapters המותאמים אישית ל-STT/TTS שתוכננו ב-D27 הוחלפו ב-Vercel AI SDK packages (D38). חיסכון מוערך: ~800-1000 שורות backend.

### 8.2 Key boundaries

- `core/` **לא יכול** לייבא מ-`backend/` או `frontend/`. רק טיפוסים מ-`protocol/`.
- `backend/` יכול לייבא מ-`core/` ו-`protocol/`.
- `frontend/` יכול לייבא מ-`protocol/` בלבד.
- אין שיתוף קבצים דרך symlinks. הכל workspace dependencies.

### 8.3 דוגמה ל-pure function ב-core

```ts
// packages/core/src/voice/sentence-boundary.ts
export function findSentenceBoundary(text: string): number {
  // הקיים מ-v6 — pure, נבדק, port-able ל-Go
}

// packages/core/src/pipeline/decide-tts-priority.ts
export function decideTtsPriority(
  state: PipelineState,
  event: AcpEvent,
): TtsAction {
  // pure decision: האם לשלוח ל-TTS, לבטל, להמתין
  // החלפת ה-imperative queue הקיים ב-decision pure
}
```

ה-shell ב-`backend/` קורא לפונקציות האלה ומבצע IO לפי ההחלטה.

### 8.4 Frontend store strategy

SvelteKit עם stores. אין state גלובלי — כל agent הוא store עצמאי.

```ts
// packages/frontend/src/lib/stores/agent.ts
export function createAgentStore(agentId: string) {
  // WebSocket subscription
  // local cache of bubbles, audio, status
  // returns readable + actions
}
```

ב-route `/agent/:id`, ה-store נוצר on-mount, מתפרק on-unmount. Dashboard ב-`/` מאזין ל-orchestrator events דרך WebSocket נפרד.

---

## 9. Deployment

### 9.1 Architecture diagram

```
              ┌────────────────────────────┐
              │   Public users (mobile,    │
              │   browser, in-car)         │
              └──────────────┬─────────────┘
                             │ HTTPS / WSS
                             ▼
                  ┌──────────────────────┐
                  │  Cloudflare Tunnel   │ (no public IP)
                  └──────────┬───────────┘
                             │
                             ▼
   ┌────────────────────────────────────────────────────────┐
   │   Proxmox host (אצל אבי)                                │
   │  ┌──────────────────────────────────────────────────┐  │
   │  │  Container: drive-coding                          │  │
   │  │                                                   │  │
   │  │  ┌──────────────────────────┐                     │  │
   │  │  │  Backend (Bun)           │                     │  │
   │  │  │  - HTTP + WebSocket (FE) │                     │  │
   │  │  │  - Voice Pipeline        │                     │  │
   │  │  │  - Static frontend serve │                     │  │
   │  │  │  - bridge-client (per-id)│                     │  │
   │  │  └─────┬────────────────────┘                     │  │
   │  │        │ WebSocket (JSON-RPC ACP)                 │  │
   │  │        │ localhost:7100..7199                     │  │
   │  │  ┌─────▼──────────────────────────────────────┐   │  │
   │  │  │  acp-bridge processes (one per agent)      │   │  │
   │  │  │  ┌─────────────┐  ┌─────────────┐          │   │  │
   │  │  │  │  bridge #1  │  │  bridge #2  │  ...     │   │  │
   │  │  │  │  WS :7100   │  │  WS :7101   │          │   │  │
   │  │  │  │     │       │  │     │       │          │   │  │
   │  │  │  │     ▼ stdio │  │     ▼ stdio │          │   │  │
   │  │  │  │   opencode  │  │   gemini    │          │   │  │
   │  │  │  └─────────────┘  └─────────────┘          │   │  │
   │  │  │  Each bridge survives backend crashes      │   │  │
   │  │  └────────────────────────────────────────────┘   │  │
   │  │                                                   │  │
   │  │  Volume mount: /data/cache (TTS, STT, transl.)   │  │
   │  └──────────────────────────────────────────────────┘  │
   └────────────────────────────────────────────────────────┘
                             │
              ┌──────────────┴───────────────┐
              ▼                              ▼
     ┌──────────────────┐          ┌──────────────────┐
     │  Gemini API      │          │  ElevenLabs API  │
     └──────────────────┘          └──────────────────┘
```

**זרימת מקרי קצה (D8 — אין persistence):**
- **Backend נופל:** bridges ממשיכים לרוץ (`--persist`) ומצברים events מ-CLI. אבל ה-in-memory Map של ה-agent registry אבד.
- **Backend עולה מחדש:** Map ריקה. ה-dashboard ב-frontend מציג agents=0. ה-bridges הישנים שלא מחוברים אליהם — נמתין שיעצרו עצמאית (grace period) או הריגה ידנית (`pkill stdio-to-ws`). המשתמש פותח agents חדשים.
- **Bridge נופל:** backend מזהה (connection error), מסמן את ה-agent כ-`crashed` ב-Map. user רואה ב-dashboard, יכול לפתוח חדש.
- **Cloudflare tunnel נופל:** משתמשים מקבלים 521. backend ו-bridges ממשיכים פנימית.

**אם backend-crash הופך לכאב** (`[future]`): נשקול persistence של agent registry ב-SQLite + reconnect-on-startup לbridges קיימים. לא ב-MVP.

### 9.2 Environments

| Env | Where | Purpose |
|-----|-------|---------|
| `dev` | Coder workspace / מחשב אישי | פיתוח יומיומי |
| `prod` | Proxmox container אצל אבי | היחיד לעת עתה |

### 9.3 Frontend deploy

**שלב 1 (MVP):** Frontend נבנה ל-static (SvelteKit adapter-static) ומוגש על-ידי ה-backend עצמו על אותו origin. פשטות מעל הכל.

**שלב 2 (אם הקהילה גדלה):** SvelteKit ל-Cloudflare Pages, backend נשאר ב-Proxmox עם CORS. עוזר ל-latency גלובלי ול-edge caching של static assets.

### 9.4 Backend deploy

Bun ב-Docker בתוך LXC. Container תקין כ-Docker host. אם נעדיף LXC native — Bun מותקן ישירות, יותר קליל אבל פחות isolated.

Volume mount ל-`/data/cache` (TTS audio, translation text, STT cache).

Cloudflare tunnel (`cloudflared`) רץ או על ה-host או בקונטיינר נפרד, מצביע ל-`localhost:3000`.

### 9.5 Updates

- Push ל-`main` branch (אחרי שעוברים מ-worktree).
- GitHub Actions: build + push Docker image ל-ghcr.io.
- Container אצל אבי משתמש ב-Watchtower או webhook להזנקת `docker pull && restart`.

לעת עתה זה future. בשלב הראשון — `git pull && docker compose up -d --build` ידני.

---

## 9.6 UX Principles — Drive-First

זה הדגש המרכזי שמבדיל את הפרויקט מ-codenomad או opencode web. כל החלטת UI נשפטת לפי **"האם זה עובד עם ידיים על ההגה ועיניים על הכביש?"**.

### עקרונות

1. **כפתור אחד גדול במרכז.** start/stop של הקלטה + cancel של מודל. אין כפתור נפרד לכל פעולה.
2. **Touch targets מינימום 80px.** אצבע בנהיגה לא מדייקת.
3. **High contrast, large text.** הבועות גדולות, ניתנות לקריאה גם במבט קצר.
4. **TTS-first feedback.** כל מצב חשוב גם נשמע (לא רק נראה). למשל "מקליט" לא רק טקסט קטן — גם צליל אישור.
5. **בלי modals/dialogs.** הם דורשים אצבע מדויקת והסתכלות.
6. **בלי scroll מורכב.** scroll הבועות אוטומטי, אין pinch-zoom.
7. **Wake lock + landscape lock.** המסך לא יכבה, ולא יסתובב באמצע ריצה.
8. **Media Session API.** כפתור bluetooth ברכב יוכל להפעיל/לעצור הקלטה.

### UI Surfaces

| Surface | Purpose | Style |
|---------|---------|-------|
| Dashboard `/` | רשימת agents חיים + כפתור "+ חדש" | cards גדולים, scroll vertical |
| Agent live `/agent/:id` | ממשק קולי פעיל | כפתור גדול במרכז, בועות מעליו |
| Settings `/settings` | קולות, שפה, מפתחות BYOK בעתיד | רגיל, לא drive-friendly |
| Agent new `/agent/new` | בחירת CLI, cwd, model | רגיל. רק לפני הנהיגה |

### State Machine של הכפתור הגדול

```
                    ┌──────────────────┐
              ┌────►│      idle         │◄────┐
              │     └─────────┬────────┘     │
              │               │ click         │
              │               ▼               │ done speaking
              │     ┌──────────────────┐     │ (no user click)
              │     │   recording       │     │
              │     └─────────┬────────┘     │
              │               │ click         │
              │ click         ▼               │
              │     ┌──────────────────┐     │
              │     │  processing       │     │
              │     │ (STT + ACP)       │     │
              │     └─────────┬────────┘     │
              │               │ first chunk   │
              │               ▼               │
              │     ┌──────────────────┐     │
              │     │   speaking        │─────┘
              │     │ (model streaming) │
              │     └─────────┬────────┘
              │               │ click (interrupt)
              │               ▼
              │     ┌──────────────────┐
              └─────│   cancelling      │
                    │ (cancel + audio   │
                    │  stop)            │
                    └──────────────────┘
                             │
                             ▼
                       (back to recording)
```

### צבעי המצב (לכפתור הגדול)

| State | Color | אנימציה |
|-------|-------|---------|
| idle | אפור כחלחל | אין |
| recording | אדום עז | פעימה רכה (1Hz) |
| processing | סגול | rotation slow |
| speaking | ירוק | waveform או pulse לפי volume |
| cancelling | כתום | flash מהיר |

ממתין לאישור / שיפור.

---

## 10. תהליך פיתוח

### 10.1 Worktree

**✅ נעשה ב-Slice 1.**

```bash
# הפקודה שבוצעה
git -C /home/user/projects/voice-acp worktree add ../voice-acp-v2 -b vnext
```

ה-master ימשיך לקבל hotfixes רק במידת הצורך. כל v2 חי ב-`vnext` branch ב-`/home/user/projects/voice-acp-v2`.

### 10.2 Migration strategy

לא migration — paralllel run.
1. ה-POC הקיים ימשיך לעבוד אצל אבי על port 3000.
2. v2 יבנה מאפס ב-port אחר (3010) ב-dev.
3. כשמרגיש מוכן — אבי בודק את שניהם זמנית (URLs נפרדים).
4. כש-v2 כשיר ל-100% — אבי עובר אליו, ה-POC נכבה.
5. לא נמחק את הקוד הישן עוד חודשיים — אולי נצטרך reference.

### 10.3 Vertical slices

ה-roadmap הסופי + DoD לכל slice — ראה `vnext-spec.md` §8.5.

תקציר עם סטטוס:

| # | תוכן | סטטוס | Commit |
|---|------|--------|--------|
| 1 | Foundation: echo WS מהדפדפן ל-backend | ✅ הושלם | `68a2b18` |
| 2 | Dashboard + agent creation (in-memory Map, אין identity) | — | — |
| 3 | BridgeManager — spawn `@rebornix/stdio-to-ws` | — | — |
| 4 | AcpTransport (ClientSideConnection) + chat טקסטואלי | — | — |
| 5 | Voice pipeline (AI SDK + Gemini custom STT) | — | — |
| 6 | Multi-session + disk cache + reconnect | — | — |
| 7 | Drive-first UX מלא + audio cues (D42) | — | — |
| 8 | Provider catalog UI (D36) | — | — |
| 9 | i18n infra + תוכן עברית | — | — |
| 10 | Production deploy (Docker + CF tunnel + systemd) | — | — |

### 10.4 Testing

- **Pure functions ב-core:** unit tests מקיפים (כמו ב-v6).
- **Backend imperative shell:** integration tests עם mocks של ACP/Gemini/ElevenLabs.
- **Frontend:** Vitest ל-stores ול-components, Playwright ל-e2e flows.
- **Cross-package:** smoke tests של slices.

מטרה: כל slice יוצא עם בדיקות עוברות.

---

## 11. Roadmap

### Phase 0 — תכנון

- [x] שיחות תכנון (7 סבבים)
- [x] D1-D50 ננעלו
- [x] `vnext-spec.md` + `slice-1-brief.md`
- [x] D-table lint (סבב 8, 2026-05-16)

### Phase 1 — Foundation

- [x] worktree `voice-acp-v2` על branch `vnext`
- [x] monorepo scaffold (core + backend + frontend)
- [x] Slice 1 — echo WS (commit `68a2b18`)
- [ ] Slice 2 — Dashboard + agent creation
- [ ] Slice 3 — BridgeManager
- [ ] Slice 4 — AcpTransport + chat טקסטואלי

### Phase 2 — Voice MVP

- [ ] Slice 5 — Voice pipeline (AI SDK + Gemini custom)

### Phase 3 — Production-readiness

- [ ] Slice 6 — Multi-session + disk cache + reconnect
- [ ] Slice 7 — Drive-first UX מלא + audio cues
- [ ] Slice 8 — Provider catalog UI

### Phase 4 — i18n + Deploy

- [ ] Slice 9 — i18n infra
- [ ] Slice 10 — Production deploy

### Phase 5 — מעבר

- [ ] בדיקת acceptance של אבי
- [ ] כיבוי של POC (master)

---

## נספח A — מה מהPOC עובר?

הצעה ראשונית למה ב-`backend/src/` של ה-POC נשמע "port-able" כפונקציות טהורות:

| מה | יעד ב-vNext |
|-----|------------|
| `sentence-boundary.ts` | `core/voice/sentence-boundary.ts` (כמעט copy) |
| `provider-error.ts` | `core/acp/provider-error.ts` |
| `markdown.ts` | `core/voice/markdown.ts` |
| `tts-cache.ts` (logic) | `core/cache/tts-cache.ts` (חסר IO) |
| `gemini-helper.ts` (decisions) | `core/voice/translator.ts` (חסר fetch) |
| `system-prompt.ts` | `core/voice/system-prompt.ts` |
| `static-path.ts` | מיותר (frontend ב-CDN) |
| `recordings.ts` (logic) | `core/voice/recording-paths.ts` (paths only) |

מה לא עובר: `server.ts`, `acp-bridge.ts`, `audio-handler.ts`, `init-handler.ts`, `message-router.ts`, `prompt-handler.ts` — אלה IO-shells שייכתבו מחדש.

---

## נספח A2 — Comparison: drive-coding vs existing tools

| כלי | Voice? | Multi-CLI? | RTL? | Hands-free? | OS / Platform |
|-----|--------|------------|------|-------------|---------------|
| **codenomad** | ❌ | ❌ (opencode only) | ✅ | ❌ | Web |
| **opencode web** | ❌ | ❌ | ⚠️ חלקי | ❌ | Web |
| **Zed** | ❌ | ✅ (ACP) | ❌ (כתב מראה!) | ❌ | Desktop |
| **Claude desktop** | ⚠️ TTS only | ❌ | ✅ | ❌ | Desktop |
| **drive-coding (vNext)** | ✅ | ✅ (ACP) | ✅ | ✅ | Web (mobile-first) |

ה-niche הייחודי שלנו: **voice + multi-CLI + RTL + drive-friendly**. אין מתחרה ישיר. ה-CLI החזק ביותר עם voice היום הוא Whisper.cpp + ChatGPT plugins, אבל זה לא מחובר לקודינג עם ACP.

ה-prior art שכן קיים — Whisperflow, Wispr Flow — הם כללי לכל typing, לא ל-coding workflow. drive-coding ממוקד בסוכני קוד.

### השלכה ל-codenomad

אבי הזכיר: "הייתי רוצה ש-codenomad יתחבר דרך ACP ל-CLI מרובים ולא רק לאופנקוד".

הפרויקט שלנו מאיץ את זה — הקוד של `acp-bridge` ו-`AcpClient` שיתפתחו כאן יוכלו בעתיד להיות package נפרד שמשרת גם את codenomad וגם את drive-coding. שווה לחשוב על זה כשמגיעים ל-slice 3.

### CLIs נתמכים מהיום הראשון

| CLI | Adapter | Status |
|-----|---------|--------|
| opencode | native ACP (built-in) | ✅ נתמך ב-POC |
| Gemini CLI | ?? לבדוק במחקר | ⚠️ צריך בדיקה |
| **Claude Code** | **`@agentclientprotocol/claude-agent-acp`** v0.34.0 | ✅ adapter רשמי (1.9k★) |

ה-Claude Code adapter תומך ב: context @-mentions, images, tool calls, edit review, TODO lists, terminals (interactive + background), slash commands, MCP servers. הכל דרך ACP — כך שאנחנו לא צריכים adapter משלנו, רק להפעיל את התהליך הזה דרך `acp-bridge`.

---

## נספח B — שאלות שעוד פתוחות לאבי (אחרי סבב 3)

**עיקרי הסבב הזה:**

1. **Q9.** שם הפרויקט — האם `drive-coding` מאושר?
2. **Q10.** Stop mechanism — אופציה B (אותו כפתור)?
3. **Q11.** Wake word ב-MVP — POC נפרד אחרי MVP?
4. **Q13.** הקלדה ב-MVP — לא?
5. **Q14.** UI Components — פירוט אושר?
6. **Q14a.** ACP Bridge protocol — האם ההמלצות שלי (WS + OS-port + mini-supervisor + 500-buffer + no auth + registry קובץ) מאושרות?
7. **Q14b.** Wake word library — openWakeWord לבחירה לכשנגיע אליו?
8. **Q15.** State machine של הכפתור — משקף נכון?
9. **Q16.** Frontend `/settings` — עמוד אחד או פיצול?
10. **Q17.** Image format — Docker או LXC native?

**~~נסגרו~~ בסבב הזה (3):**
- ~~Q12. Backend survival~~ → נפתר עם D23 (acp-bridge).
- ~~Q18. Multi-CLI adapter~~ → Claude Code דרך adapter רשמי (D24).

---

### ⏳ שאלה אסטרטגית קריטית — Q-NEW-4

**הקשר:** מצאנו את `formulahendry/acp-ui` (274★, MIT, Vue 3 + Tauri) — web/mobile/desktop client בוגר ל-ACP עם 11 agents pre-configured. הוא **לא** תומך ב-voice וב-RTL. הוא משמש בעצמו את `@rebornix/stdio-to-ws` כ-bridge.

זה משנה את הבחירה האסטרטגית הגדולה. שלוש אופציות:

#### אופציה A: Build from scratch (התוכנית המקורית)

- כותבים SvelteKit frontend חדש לחלוטין.
- backend Bun, ports/adapters, voice pipeline, drive-first UX מהיום הראשון.
- שולטים בכל קווי הקוד.

**יתרונות:**
- 100% ייחוד — drive-first, RTL, voice, Hebrew מהיום הראשון.
- SvelteKit כמו שאבי בחר.
- אין תלות בעדכוני upstream.
- learning experience עמוק.

**חסרונות:**
- ~10 slices, חודשי עבודה.
- צריך לכתוב מחדש: routing, agent management UI, sessions list, permission dialogs, slash commands, tool call visualization, model picker, traffic monitor.
- חלק מהדברים חופפים ל-acp-ui.

#### אופציה B: Fork `acp-ui` והוסף voice + RTL

- מתחילים ב-fork של formulahendry/acp-ui.
- מוסיפים voice layer (STT/TTS/translator) + RTL + drive-first UX.
- שומרים את כל ה-multi-agent + cross-platform support.

**יתרונות:**
- חיסכון של ~70% מהעבודה — הbase מוכן ועובד.
- 11 agents כבר נתמכים.
- Mobile/Web/Desktop builds ready.
- session/load + foreground reconnect כבר ממומשים.
- MIT license — חופשי לחלוטין.

**חסרונות:**
- **Vue 3, לא SvelteKit** — אבי הצהיר על SvelteKit.
- Tauri — תלות נוספת (ל-desktop builds).
- צריך לחיות עם החלטות UX שלא בחרנו (chat-first, לא drive-first).
- עדכוני upstream דורשים merge work.
- branding שלהם — צריך לעשות rename ל-drive-coding.

#### אופציה C: Hybrid — voice gateway נפרד + שמירה על acp-ui כ-alternative

- אנחנו בונים backend עם voice pipeline + Svelte frontend ייעודי ל-drive mode.
- ה-backend חושף את ה-WS protocol של drive-coding.
- במקביל, ה-bridge עצמו (`stdio-to-ws`) חי כ-CLI נפרד שגם משמש את acp-ui.
- המשתמש יכול לבחור: drive-coding (drive-first) או acp-ui (chat-first), שניהם מתחברים לאותם CLIs.

**יתרונות:**
- Drive-first UX שלם בחירת SvelteKit.
- אופציה backup — אם משהו לא עובד ב-drive-coding, יש acp-ui כ-alternative client לאותו setup.
- contribution לקהילה (קל יותר לתרום ל-stdio-to-ws + לעודד שימוש שכן עובד).

**חסרונות:**
- כמעט כמו אופציה A מבחינת היקף.
- "alternative client" הוא יתרון מינורי לרוב המשתמשים שיבחרו אחד מהם.

#### ההמלצה שלי

**אופציה C — בעצם כמעט A אבל עם awareness של acp-ui.**

הסיבות:
1. SvelteKit הוא המבחר שלך, לא Vue. למעבר ל-Vue יש tax לא-תרומתי.
2. drive-first UX הוא הייחוד שלנו — הוא מצדיק build מאפס.
3. ה-bridge (stdio-to-ws) גם ככה לא משלנו — חסכנו שם 40% מהעבודה.
4. ה-CLIs פותחים את הברירה — אפילו אם נבחר A, משתמש שלא רוצה drive-mode יוכל להשתמש ב-acp-ui עם אותו setup.

**ממתין להחלטה.** אם תבחר B (fork), כל ה-spec ב-`vnext-spec.md` משתנה דרסטית. אם תבחר A או C, נמשיך כמתוכנן עם תיקון ה-bridge ל-`@rebornix/stdio-to-ws`.

---

## נספח C — Roadmap מפורט אחרי תשובות

(טיוטה — יוחלף אחרי שכבה 2)

לקראת **shipping אצל אבי**:
1. סגירת שאלות Q9-Q18 (סבב נוסף).
2. שכבה 2 של המסמך — data models, API spec, WS protocol spec.
3. scaffold worktree + monorepo.
4. Slices 1-5 (foundations + voice MVP).
5. בדיקה משותפת — אבי משווה ל-POC.
6. החלפה.

לקראת **shipping לקהילת מפתחים**:
7. Slices 6-7 (multi-session, ניקוי + dashboard).
8. Slice 8 (cache פרסיסטנטי).
9. Slice 9 (i18n + אנגלית).
10. Slice 10 (deploy hardening, supervisor, monitoring).
11. README + onboarding מסמך + video demo.
12. הכרזה (HN? Reddit? Lobste.rs? Twitter?).

---

> **המשך:** שכבה 2 של מסמך זה תיכתב אחרי שאבי יחזור עם תשובות לסבב Q9-Q18.
> שכבה 2 תכלול: data models מלאים, sequence diagrams, פירוט API, ו-protocol spec.
