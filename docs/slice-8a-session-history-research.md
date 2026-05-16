# Slice 8a — Session History (חקר + הצעה)

> תאריך: 2026-05-16
> מטרה: להחזיר את הפיצ'ר שהיה ב-v1 — UI לרשימת sessions ישנים ולטעינתם
> דרך ACP `session/list` + `session/load`.

---

## רקע

ב-v1 היה pipe מלא:

- `acp-bridge.listSessions()` — ACP `session/list`
- `acp-bridge.loadSession(sessionId, opts)` — ACP `session/load`
- `/api/info?cwd=...` — `{models, availableModels, currentModelId, sessions[]}`
- `config.html` — בחירת cwd + רשימת sessions
- `init-handler` — אם init message מכיל `sessionId` → `loadSession` במקום `newSession`
- WS events: `history_start`, `history_chunk`, `history_tool_call`, `history_done`
- כל history bubble נוצרה עם `audioState="cold"` — כפתור 🔊 ידני

ב-vnext היום — **0% מהפיצ'ר ממומש**. ה-capability `loadSession` נקרא ב-acp-transport
אבל לא מנוצל בשום מקום.

## ACP support — בדיקה חיה (probe-acp-sessions.ts)

הסקריפט `/tmp/probe-acp-sessions.ts` הריץ initialize + `session/list` על
כל 4 ה-CLIs המותקנים.

| CLI | `loadSession` capability | `session/list` | Sessions שנמצאו | Schema |
|-----|---|---|---|---|
| **opencode** | ✅ | ✅ | 19 (אצל אבי) | `sessionId, cwd, title, updatedAt` |
| **claude** | ✅ | ✅ | 2 | אותו schema |
| **gemini** | ✅ (capability בלבד) | ❌ `-32601 Method not found` | — | תומך ב-load בלבד, לא ב-list |
| **codex** | ✅ | ✅ | 0 | אותו schema |

### מסקנות

1. **3 מתוך 4 תומכים מלא.** Schema זהה — אין צורך בנירמול per-CLI.
2. **Gemini fallback** — `.catch(() => [])` כמו ב-v1. Gemini פשוט לא יציג sessions
   בדף הרשימה. עדיין יכול לטעון session ספציפי אם sessionId ידוע.
3. **`agentCapabilities.sessions` תמיד `null`** — ה-capability החדש (`sessions.list`)
   לא מוצהר על-ידי אף CLI. Detection הנכון הוא try-and-catch, לא הסתמכות
   על capabilities.
4. **Claude shows noise** — `title: "/usage"` נצפה. claude שומר גם פקודות
   קצרצרות → רשימה עלולה להיות מבולגנת. נצטרך `sort by updatedAt DESC + limit 50`.

---

## מבנה מוצע

### Routes ב-frontend

```
/                            dashboard — agents חיים (כמו היום)
/sessions                    history browser — כל הפרויקטים + sessions
/sessions/[cwdHash]          sessions של פרויקט ספציפי
/agent/[agentId]             agent חי (כמו היום; כעת תומך ב-history)
/settings                    (Slice 8b — לא בסליס הזה)
```

### Backend endpoints חדשים

```
GET  /api/projects                          רשימת cwds שהbackend "ראה" (registry)
GET  /api/projects/:cwdHash/sessions        SessionInfo[] של cwd ספציפי (per CLI)
GET  /api/sessions                          איחוד של כל הסשנים בכל ה-cwds (cached)
POST /api/agents                            קיים — מוסיפים שדה existingSessionId אופציונלי
                                            אם יש → loadSession במקום newSession
```

### Backend modules חדשים

- `acp-transport.listSessions(cwd)` — חדש (קריאה ל-ACP `session/list`)
- `acp-transport.loadSession(sessionId, cwd)` — חדש (קריאה ל-ACP `session/load`)
- `projects-registry.ts` — שומר על-דיסק `{ cwd, kind, lastSeen, lastSessionId }[]`
  (יושב ב-cache dir, כמו `cache-disk.ts`)
- `sessions-cache.ts` — TTL cache (5 דקות) של תוצאות `session/list` per cwd

### WS events חדשים (agent-session → frontend)

לפי `behaviors.md` UI-HIST:

- `history_start` — מתחיל replay של היסטוריה (frontend מאפס chat area)
- `history_chunk` — בועה היסטורית (כיוון: assistant/user/thought)
- `history_tool_call` — בועה היסטורית של tool_call
- `history_done` — נגמר replay (frontend מאפשר אינטראקציה)

---

## זרימת המשתמש

1. user נכנס ל-`/sessions`
2. רואה:
   - **טאב "כל הסשנים"** — איחוד של כל ה-cwds, ממויין updatedAt DESC, limit 50
   - **טאב "לפי פרויקט"** — רשימת cwds → click → רשימת sessions של ה-cwd
3. כל session מציג: `title`, `updatedAt`, `cwd`, `cli kind`, preview קצר
4. click על session → POST `/api/agents` עם `{ cwd, kind, existingSessionId }`
   → backend spawn-וב bridge + ACP transport + `session/load`
   → ה-CLI מחזיר history events
   → agent-session.ts ב-backend ממיר ל-`history_*` events ב-WS
   → redirect ל-`/agent/[newAgentId]`
5. ב-`/agent/[id]`:
   - bubbles היסטוריות מוצגות עם audioState="cold" + 🔊 כפתור (lazy TTS)
   - user יכול להמשיך לדבר → רגיל

### URL — אופציה ב' (persistent, מומלץ)

```
/session/[cwdHash]/[sessionId]?cli=opencode
```

Backend מאזין: אם יש agent חי עם אותו sessionId → redirect ל-`/agent/[existingAgentId]`.
אם אין → spawn ו-redirect.

יתרון: URL ניתן לשיתוף (לאותו host), refresh עובד, history של דפדפן עובדת.

---

## שאלות פתוחות (טרם הוחלט)

| # | שאלה | המלצה ראשונית |
|---|------|---------------|
| 1 | URL ל-session ישן — option **א** (`/sessions/...` → redirect ל-`/agent/[new]`) או **ב** (`/session/[cwdHash]/[sessionId]` persistent, deduplicates על agent קיים) | **ב** — שיתוף URL + refresh עובד |
| 2 | אותו session כבר טעון ב-agent חי → click → ניווט ל-agent הקיים? | כן, deduplication |
| 3 | History bubbles — 🔊 ידני (כמו v1) או טקסט בלבד? | **🔊 ידני** — תאימות ל-v1, חיסכון API |
| 4 | Edit cwds — UI להוספת cwd ידני? | לא ב-MVP. רק auto-track של agents שנוצרו |

---

## סדר עבודה מוצע (לסוכן ביצוע)

### שלב 1 — Backend (TDD)
1. `acp-transport.listSessions(cwd)` + tests
2. `acp-transport.loadSession(sessionId, cwd)` + tests
3. `projects-registry.ts` (disk-backed) + tests
4. `POST /api/agents` — extend עם `existingSessionId` + tests
5. `GET /api/projects` + `GET /api/projects/:cwdHash/sessions` + `GET /api/sessions`
6. `agent-session.ts` — handle `loadSession` flow → emit `history_*` events

### שלב 2 — Frontend
7. `/sessions/+page.svelte` — list view (טאבים, sort, limit 50)
8. `/sessions/[cwdHash]/+page.svelte` — per-project view
9. `/session/[cwdHash]/[sessionId]/+page.svelte` — loader route (URL persistent)
10. `agent-session.ts` store — handle `history_*` events
11. bubble rendering — history bubble עם 🔊 cold state

### שלב 3 — Polish
12. Empty states (gemini → no sessions, project אין sessions)
13. Loading states (spawn זמני יכול לקחת 3-5s)
14. Error handling (CLI לא תומך, session corrupted)

הערכה: ~6-10 שעות לסוכן Sonnet 4.6 (יכול להתפצל לשני sub-agents:
backend ראשון, frontend אחרי).

---

## הערות לסוכן הבא

- Cache `/api/sessions` ל-5 דקות. spawn זמני של bridge עולה 3-5 שניות —
  אסור לעשות אותו בכל reload.
- אם cwd אחד נכשל ב-session/list (לדוגמה gemini), המשך עם השאר — אל
  תכשל את כל הבקשה.
- ה-`projects-registry` חייב להיות persistent — אם אבי restart-לbackend,
  הרשימה לא נעלמת.
- ב-v1 היה bug ב-history: `history_tool_call` נשלח לפני `message_rendered`
  של הטקסט הקודם. תיעוד ב-UI-HIST-7. עליי לוודא שהsdk החדש לא חוזר על זה,
  או שהfrontend מחליף תוכן בועה בדיעבד.

---

## קישורים

- Source-of-truth של behaviors: `docs/archive/v1/behaviors.md` (UI-HIST-1..7,
  ACP-14..17)
- v1 implementation reference: `/home/user/projects/voice-acp/backend/src/`
  (`acp-bridge.ts`, `init-handler.ts`, `api-info.ts`)
- ACP SDK types: `node_modules/.pnpm/@agentclientprotocol+sdk@0.21.1_*/...`
- Probe script: `/tmp/probe-acp-sessions.ts`
