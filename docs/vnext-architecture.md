# vNext Architecture — voice-acp

> **סטטוס:** טיוטה ראשונה (שכבה 1 — עקרונות, החלטות, חלוקה למודולים).
> **כותב:** Tama (planner agent), בדיון עם Avi.
> **תאריך התחלה:** 2026-05-15.
> **לא קוד פעיל** — תיעוד תכנון. הקוד יבוצע ב-worktree נפרד `voice-acp-v2`.

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

ממשק שיחה רב-לשוני, רב-משתמש (אנונימי בהתחלה), שמתפקד כשכבה קולית מעל **כל CLI agent שמדבר ACP** — לא רק opencode. רץ בענן, נגיש מכל דפדפן, עם dashboard לניהול סשנים פעילים.

### מה הגרסה הבאה איננה

- **לא ריפקטור** של ה-POC. greenfield. ה-POC ימשיך לחיות ב-master עד שהחדש כשיר.
- **לא רק עברית.** רב-לשוני מהיום הראשון.
- **לא single-page app.** אפליקציה מלאה — routing, dashboard, multi-session, התחלה של auth.
- **לא DB משלנו.** stateless ככל הניתן. רק cache של קריאות יקרות (תרגום/תמלול/הקראה).
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

| Layer | Persistent? | איפה |
|-------|-------------|------|
| Session content (history of messages) | לא | ה-CLI agent עצמו (opencode/Gemini) שומר את זה במקור |
| Agent process state (alive/dead, pid, cwd) | רק בזיכרון | proc orchestrator |
| User identity | קל (token) | localStorage / cookie |
| User preferences (voice, language) | קל | localStorage; בעתיד אולי K/V |
| TTS cache | כן | R2 / disk volume |
| STT cache | כן (אופציונלי) | R2 / disk volume |
| Translation cache | כן | KV / R2 |

הכלל: אם נאבד את זה ב-restart — האם המשתמש ירגיש? אם לא — זיכרון בלבד.

### 2.5 Backend ו-frontend מנותקים מהיום הראשון

אין SSR שמערבב לוגיקת backend בתוך SvelteKit endpoints. ה-backend הוא service נפרד עם API מתועד. SvelteKit עוסק ב-UI בלבד.

זה מכפיל את הסיכוי שיום אחד נפרד ל-Go ב-backend בלי לגעת ב-frontend, ומאפשר deployment נפרד (frontend ל-Cloudflare Pages, backend ל-Fly.io, נגיד).

### 2.6 Types משותפים

הפרוטוקול בין front ל-back מוגדר ב-package אחד מתועד (`@voice-acp/protocol`), שמיובא משני הצדדים. אין JSON ad-hoc.

### 2.7 i18n מובנה, לא bolted-on

מההתחלה — אין מחרוזת hardcoded בעברית בקוד. כל טקסט עובר דרך i18n layer (frontend + backend). שפת ברירת מחדל = שפת הדפדפן או שפה שנשמרה ב-preferences.

---

## 3. דרישות מאבי

תיעוד מילולי של מה שאבי אמר בדיון, כדי שלא נשכח:

1. **רב-לשוני.** לא רק עברית.
2. **רץ בענן.** עדיף Cloudflare/Vercel אם אפשר (התשובה: Cloudflare Containers / Fly.io / VPS — לא Workers/serverless).
3. **בלי DB משלנו.** רק cache לחיסכון על קריאות ל-Gemini ו-ElevenLabs.
4. **ACP על פני API ספציפי של opencode** — תמיכה ב-CLIs נוספים.
5. **שווה לשקול ACP-over-HTTP** אם יש implementation אמינה ומשתלמת על stdio.
6. **CLI ממשיך לרוץ אם המשתמש סוגר דף.** דרישה קשה.
7. **הפעלה/כיבוי מפורשים** של ה-CLI כמו codenomad.
8. **ריבוי סשנים בממשק.** dashboard.
9. **Worktree** — הממשק הנוכחי ימשיך לפעול עד שהמחליף כשיר.
10. **TypeScript** — לא Go לעת עתה. SvelteKit ל-frontend.
11. **Functional core** — כדי לאפשר port עתידי ל-Go בלי שיחות.
12. **Frontend = אפליקציה מלאה**, לא SPA יחיד. כולל routing, dashboard.

---

## 4. החלטות שנלקחו (locked)

| # | החלטה | הקשר |
|---|-------|------|
| D1 | TypeScript + Bun ב-backend | אבי מכיר; port עתידי ל-Go אפשרי דרך פונקציונלי |
| D2 | SvelteKit ב-frontend | אבי בחר במפורש |
| D3 | Greenfield, לא ריפקטור | "לתכנן את הכל מחדש" |
| D4 | Worktree `voice-acp-v2` | master ימשיך לעבוד עד מעבר |
| D5 | Functional core, imperative shell | לא fp library מלא |
| D6 | ACP transport מופשט | תמיכה ב-multi-CLI; transport pluggable |
| D7 | Agent process = entity עצמאית | "tmux for AI agents" — שורד סגירת דף |
| D8 | אין DB משלנו | רק cache (KV/R2/disk) ל-Gemini+ElevenLabs |
| D9 | Backend ו-frontend נפרדים | services נפרדים, API מתועד, types משותפים |
| D10 | i18n מובנה מהתחלה | אין hardcoded strings |
| D11 | Identity אנונימי בהתחלה | token ב-localStorage; auth אמיתי בעתיד |
| D12 | Multi-session מהתחלה | dashboard, routing |

---

## 5. שאלות פתוחות

### Q1. איפה לפרוס את ה-backend?

האופציות:

| אופציה | יתרונות | חסרונות |
|--------|---------|---------|
| **Fly.io** | persistent volumes, multi-region, container native, זול | לא Cloudflare-native |
| **Cloudflare Containers** (beta) | Cloudflare-native, אינטגרציה עם R2/KV, edge | beta — risky for production |
| **Railway / Render** | פשוט להתחיל, deploy מ-git | פחות שליטה |
| **VPS פרטי (Hetzner/DO)** | זול, שליטה מלאה | תחזוקה ידנית |
| **Coder Workspaces** (אצלי) | חינם לי | רק לדוגמה ולפיתוח |

**המלצה לעת עתה:** להתחיל עם **Coder workspace** לפיתוח ו-staging, ולתכנן ל-**Fly.io** ל-production. Cloudflare Containers נשמור כיעד ארוך-טווח אם תתבגר.

**ממתין להחלטת אבי.**

### Q2. ACP transport — stdio או HTTP?

מצב נוכחי:
- ACP הוא JSON-RPC 2.0, transport-agnostic מבחינה תיאורטית.
- אין implementation רשמית של ACP-over-HTTP שמצאתי. כולם משתמשים ב-stdio (subprocess).
- opencode חושף **HTTP API משלו** (לא ACP — API פנימי שגיליתי בעבר ב-port אקראי, ראה learnings 2026-05-11). זה יעזור לבעיית "agent ממשיך לרוץ אחרי סגירת דף", אבל יקבע אותנו ל-opencode.

**הצעה:** לבנות `AcpTransport` interface מההתחלה. לעת עתה — `StdioTransport` (כמו היום). אם בעתיד תגיע HTTP transport רשמית, נוסיף `HttpTransport` בלי לשבור כלום. ה-CLIs האחרים (Gemini CLI, Claude Code) רובם מדברים stdio בכל מקרה.

**ממתין לאישור אבי.**

### Q3. Agent process orchestration — איך מנהלים את הdaemons?

הדרישה: agent process חי גם אחרי שהדפדפן נסגר. צריך service ב-backend שמחזיק registry של agents חיים.

האופציות:

**A. Single backend process מנהל כל ה-agents כ-children שלו.**
- פשוט. ה-backend הוא parent ל-spawn(opencode).
- בעיה: אם ה-backend נופל, כל ה-agents מתים.
- בעיה: scaling — agent אחד לא יכול לעבור בין backends.

**B. Daemon per agent — systemd / supervisord.**
- כל agent הוא service נפרד ברמת ה-OS.
- ה-backend רק מדבר איתו (דרך socket/HTTP).
- שורד נפילת backend.
- מורכב יותר ל-deploy.

**C. Container per agent.**
- כמו ב-Coder. כל agent הוא container.
- isolation מקסימלי.
- overhead גדול יותר.

**המלצה ראשונית:** **A** ל-MVP. ה-backend הוא parent. אם נצטרך resilience, נעבור ל-B אחר כך. **ממתין להחלטה.**

### Q4. Cache — איפה לאחסן?

לפי הסביבה:

| סביבה | TTS audio | Translation text | STT text |
|-------|-----------|------------------|----------|
| dev (Coder) | disk (`./cache/`) | in-memory + disk | in-memory + disk |
| Fly.io | volume (mounted) | volume | volume |
| Cloudflare Containers | R2 | KV | R2 (אם כדאי) |

**הצעה:** abstraction `CacheStore` עם implementations: `MemoryCache`, `DiskCache`, `R2Cache`, `KvCache`. ה-app בוחר בזמן ריצה לפי env.

**ממתין לאישור אבי.**

### Q5. Identity — איך מתחיל, איך מתבגר?

**שלב 1 (MVP):** anonymous token ב-localStorage. הdashboard של המשתמש = כל ה-agents שיש ל-token שלו.
- **חיסרון:** אם המשתמש מנקה את ה-localStorage או עובר דפדפן — מאבד את הסשנים.

**שלב 2 (אם נדרש):** OAuth (GitHub / Google) או magic link — token נשמר ב-server-side K/V עם user ID.

**הצעה:** להתחיל עם anonymous, לתכנן את ה-data model כך שמעבר ל-authenticated לא ידרוש שינוי שיברה. **ממתין לאישור.**

### Q6. Pricing — מי משלם על Gemini ו-ElevenLabs?

ב-POC המקומי — הכל אבי. בענן עם משתמשים אנונימיים — מי משלם?

**אופציות:**
1. **חינם (אבי משלם הכל)** — נפתח לעולם, נראה מה קורה. מסוכן אם viralizes.
2. **BYOK (Bring Your Own Key)** — המשתמש מזין את ה-keys שלו ל-Gemini/ElevenLabs. אין עלות ל-host.
3. **Quota** — חינם עד X דקות/חודש, אחרי זה צריך מפתח משלך.

**הצעה:** BYOK בהתחלה — הכי בטוח. UI שמבקש מפתחות בשימוש ראשון, שומר ב-localStorage או על השרת ל-token שלו. **דרושה החלטה.**

### Q7. i18n — מאיפה השפה נקבעת?

**אופציות:**
1. שפת הדפדפן (`Accept-Language` header).
2. ידנית ב-preferences של המשתמש.
3. גם וגם — auto-detect אבל ניתן לשנות.

**הצעה:** #3. **אבל גם:** השפה של ה-conversation (מה שהמודל יענה ובמה אבי מדבר) היא **נפרדת** משפת ה-UI. למשל, UI באנגלית אבל אבי מדבר בעברית.

### Q8. Frontend routes / pages — מה יש?

טיוטה ראשונית:

```
/                   — landing / dashboard (רשימת agents חיים)
/agent/new          — יצירת agent חדש (בחירת CLI, cwd, model)
/agent/:id          — הממשק הקולי עצמו (חי)
/settings           — preferences (voice, language, API keys)
/login              — בעתיד (auth)
```

**ממתין לאישור.**

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
   → POST /api/agents { cli: "opencode", cwd: "/foo", model: "sonnet" }
   → Backend: spawn(opencode acp), assign UUID
   → Backend: register in AgentRegistry
   → Response: { agentId, wsUrl }

2. User: "פתח חיבור" (auto on agent page load)
   → WebSocket connect to wsUrl
   → Backend: subscribe browser to agent's event stream
   → Browser: receives history if exists, then live updates

3. User: "תגיד לסוכן X"
   → Browser → WS → Backend → AcpTransport.prompt(...)
   → Agent processes, streams session/update notifications
   → Backend → STT/translation/TTS pipeline → WS → Browser

4. User: סוגר דף
   → WebSocket closes
   → Agent ממשיך לרוץ
   → Backend ממשיך לקבל session/update events, אבל לא שולח לאף אחד
   → אופציונלי: לשמור updates ב-buffer קצר למקרה של reconnect

5. User: חוזר אחרי 10 דקות
   → Browser → WS connect → "קח אותי ל-agent X"
   → Backend: שולח את ה-buffered updates שהצטברו
   → ממשיך כרגיל

6. User: "כבה את הסוכן"
   → DELETE /api/agents/X
   → Backend: graceful shutdown של ACP, kill process, remove from registry
```

---

## 7. ארכיטקטורה ברמת domains

7 domains, כל אחד עם responsibility ברורה ו-API מתועד:

### 7.1 Transport
**מה:** WebSocket / HTTP בין frontend ל-backend.
**אחריות:** serialization, authentication, routing של messages.
**Pure?** כן (parsing/routing). IO רק ב-edges.

### 7.2 Identity
**מה:** מי המשתמש? יש לו token? אילו agents שייכים לו?
**אחריות:** token issuance, validation, agent ownership.
**Persistence:** in-memory map לעת עתה; K/V בעתיד.

### 7.3 Agent Orchestration
**מה:** ניהול mahzor חיים של CLI processes.
**אחריות:** spawn, kill, registry, subscribe, broadcast.
**State:** in-memory `Map<agentId, AgentInstance>`.

### 7.4 ACP
**מה:** abstraction של פרוטוקול ACP.
**אחריות:** initialize, session/new, session/prompt, session/cancel, parsing של session/update.
**Sub-domains:** `AcpTransport` (stdio/http), `AcpClient` (logic).

### 7.5 Voice Pipeline
**מה:** STT → LLM router → TTS.
**אחריות:** המרה דו-כיוונית בין אודיו לטקסט, plus translation אם נדרש.
**Sub-modules:** `Stt` (Gemini), `Tts` (ElevenLabs), `Translator` (Gemini), `Cache`.
**Pure?** core כן; HTTP fetches ב-edges.

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

### 8.1 Monorepo structure

```
voice-acp-v2/
├── packages/
│   ├── protocol/          # types משותפים (frontend + backend)
│   │   ├── src/
│   │   │   ├── ws-messages.ts   # WS message types
│   │   │   ├── api.ts           # HTTP API types
│   │   │   └── agent.ts         # Agent/Session domain types
│   │   └── package.json
│   │
│   ├── core/              # functional core (backend logic, pure)
│   │   ├── src/
│   │   │   ├── acp/             # ACP parsing, types
│   │   │   ├── voice/           # STT/TTS/translation logic (pure)
│   │   │   ├── pipeline/        # voice pipeline orchestration
│   │   │   └── i18n/            # i18n core
│   │   └── package.json
│   │
│   ├── backend/           # imperative shell (services, IO)
│   │   ├── src/
│   │   │   ├── server.ts        # entry point, HTTP + WS
│   │   │   ├── identity/        # token issuance/validation
│   │   │   ├── orchestrator/    # agent lifecycle
│   │   │   ├── transport/       # AcpTransport implementations
│   │   │   ├── adapters/        # Gemini, ElevenLabs HTTP clients
│   │   │   └── cache/           # CacheStore implementations
│   │   ├── package.json
│   │   └── Dockerfile
│   │
│   └── frontend/          # SvelteKit app
│       ├── src/
│       │   ├── routes/
│       │   │   ├── +page.svelte          # dashboard
│       │   │   ├── agent/[id]/+page.svelte  # ממשק קולי
│       │   │   └── settings/+page.svelte
│       │   ├── lib/
│       │   │   ├── components/
│       │   │   ├── stores/
│       │   │   ├── api/                  # WS+HTTP clients
│       │   │   └── i18n/                 # locale loading
│       │   └── app.html
│       └── package.json
│
├── docs/                  # תיעוד שמועתק מהPOC + מסמך זה
├── tests/                 # integration tests חוצי-package
├── pnpm-workspace.yaml    # או bun workspace
├── package.json
└── README.md
```

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
┌─────────────────────────┐
│   Browser (SvelteKit)   │
│   served from CDN       │
└──────────┬──────────────┘
           │ WebSocket + HTTPS
           ▼
┌─────────────────────────┐         ┌──────────────────┐
│   Backend Service       │◄────────│  R2 / KV (cache) │
│   (Bun on Fly.io)       │         └──────────────────┘
│   - HTTP API            │
│   - WebSocket           │         ┌──────────────────┐
│   - Agent Orchestrator  │◄────────│  Gemini API      │
│   - Voice Pipeline      │         └──────────────────┘
└──────────┬──────────────┘
           │ stdio                  ┌──────────────────┐
           ▼                        │  ElevenLabs API  │
┌─────────────────────────┐◄────────└──────────────────┘
│  CLI Agent Processes    │
│  (opencode/Gemini/etc)  │
│  spawned as children    │
└─────────────────────────┘
```

### 9.2 Environments

| Env | Where | Purpose |
|-----|-------|---------|
| `dev` | Coder workspace, local | פיתוח יומיומי |
| `staging` | Fly.io app `voice-acp-staging` | בדיקות עם build אמיתי |
| `prod` | Fly.io app `voice-acp` | אבי ועוד אם נוסיף |

### 9.3 Frontend deploy

SvelteKit עם adapter סטטי → Cloudflare Pages. קל, חינם, edge.

חלופה: adapter-node ב-image של ה-backend (אם נרצה SSR לעומס SEO — כנראה לא).

### 9.4 Backend deploy

Bun ב-Docker על Fly.io. volume ל-cache. multi-region אם נרצה latency לא ישראלי.

---

## 10. תהליך פיתוח

### 10.1 Worktree

```bash
git worktree add ../voice-acp-v2 -b vnext
```

ה-master ימשיך לקבל hotfixes רק במידת הצורך. כל v2 חי ב-`vnext` branch ב-worktree נפרד.

### 10.2 Migration strategy

לא migration — paralllel run.
1. ה-POC הקיים ימשיך לעבוד אצל אבי על port 3000.
2. v2 יבנה מאפס ב-port אחר (3010) ב-dev.
3. כשמרגיש מוכן — אבי בודק את שניהם זמנית (URLs נפרדים).
4. כש-v2 כשיר ל-100% — אבי עובר אליו, ה-POC נכבה.
5. לא נמחק את הקוד הישן עוד חודשיים — אולי נצטרך reference.

### 10.3 Vertical slices

הפיתוח ב-vertical slices (כמו ב-v6) — כל slice נותן feature שאפשר לראות ולבדוק:

**Slice 1:** scaffold monorepo + protocol package + "hello world" backend + SvelteKit hello + WebSocket שמחזיר echo.

**Slice 2:** identity + dashboard ריק + יצירת agent דמה (בלי CLI אמיתי, רק entity במזיכרון).

**Slice 3:** ACP transport stdio + spawn opencode + session/new + session/prompt בסיסי בלי voice.

**Slice 4:** Voice pipeline — STT + TTS + ECHO ללא agent (הקלטה → תמלול → הקראה).

**Slice 5:** חיבור agent + voice pipeline → ממשק קולי מלא לסשן בודד.

**Slice 6:** Multi-session + dashboard עם agents חיים.

**Slice 7:** Survival של disconnect (agent ממשיך לרוץ).

**Slice 8:** Cache (R2 או disk לפי env).

**Slice 9:** i18n + שפה אחרת מלבד עברית.

**Slice 10:** Deploy ל-Fly.io + Cloudflare Pages.

כל slice = sprint קצר. בסוף כל slice — אבי בודק.

### 10.4 Testing

- **Pure functions ב-core:** unit tests מקיפים (כמו ב-v6).
- **Backend imperative shell:** integration tests עם mocks של ACP/Gemini/ElevenLabs.
- **Frontend:** Vitest ל-stores ול-components, Playwright ל-e2e flows.
- **Cross-package:** smoke tests של slices.

מטרה: כל slice יוצא עם בדיקות עוברות.

---

## 11. Roadmap

### Phase 0 — תכנון (כאן עכשיו)

- [x] שיחת תכנון עם אבי (סשן זה)
- [x] טיוטה ראשונה של מסמך זה
- [ ] תשובות לשאלות פתוחות מ-§5
- [ ] שכבה 2 של מסמך זה — חפירה לעומק בכל domain

### Phase 1 — Foundation

- [ ] worktree `voice-acp-v2`
- [ ] monorepo scaffold
- [ ] Slices 1-3 (echo → dashboard → ACP בסיסי)

### Phase 2 — Voice MVP

- [ ] Slices 4-5 (voice pipeline → first end-to-end)

### Phase 3 — Production-readiness

- [ ] Slices 6-8 (multi-session, survival, cache)

### Phase 4 — Cloud + i18n

- [ ] Slices 9-10 (i18n, deploy)

### Phase 5 — מעבר

- [ ] בדיקת acceptance של אבי
- [ ] כיבוי של POC

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

## נספח B — שאלות שאבי צריך לענות עליהן

(תקציר של §5 לנוחות)

1. איפה לפרוס? (Fly.io / Cloudflare Containers / VPS)
2. ACP transport — להישאר עם stdio בלבד או לבנות גם HTTP?
3. Agent orchestration — backend הוא parent (פשוט) או systemd (resilience)?
4. Cache backend — disk ל-MVP או לקפוץ ישר ל-R2?
5. Identity — אנונימי ל-MVP, OAuth מתי?
6. Pricing — BYOK / quota / hosted?
7. i18n — מה השפות לתמוך? (he, en, אחרות?)
8. Frontend routes — האם הטיוטה ב-§5 Q8 מספקת?

---

> **המשך:** שכבה 2 של מסמך זה תיכתב אחרי שאבי יחזור עם תשובות.
> שכבה 2 תכלול: data models מלאים, sequence diagrams, פירוט API, ו-protocol spec.
