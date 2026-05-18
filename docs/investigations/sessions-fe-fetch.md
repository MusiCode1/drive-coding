# Investigation: sessions-fe-fetch

> ‏‏‏‏מטרה: ‏העברת ‏שליפת ‏ה-sessions ‏מ-BE ‏ל-FE ‏‏‏מעל ‏ה-ACP WebSocket ‏הקיים. ‏החלפת ‏‏הendpoint ‏ה-BE-spawned ‏‏שכיום ‏שבור-מתוך-עיצוב ‏(F-1 followup ‏‏‏השאיר ‏אותו ‏‏‏ללא ‏wsUrl).
>
> ‏תאריך: 2026-05-18.
> ‏Mode: code-only investigation (no runtime reproduction).
> ‏Base commit: ‏main ‏@ ‏`be5beb9` ‏(post-F-5 ‏merge). ‏ה-bug ‏‏‏שתואר ‏ב-prompt ‏‏‏‏ב-`c903102` ‏‏עדיין ‏חי ‏‏ב-HEAD — ‏F-5 ‏‏לא ‏‏נגע ‏ב-`fetchSessions`.
>
> **‏‏הוראה ‏לסוכן ‏‏שמעדכן ‏‏‏את ‏המסמך ‏הזה ‏‏בעתיד:** ‏אל ‏תמחק ‏טקסט ‏קיים. ‏‏‏הוסף ‏Revision ‏‏בסוף ‏עם ‏תאריך ‏וציון ‏אילו ‏‏סעיפים ‏‏מהקודמים ‏‏לא ‏רלוונטיים ‏יותר.

## Bug recap

‏`GET /api/sessions` ‏‏‏‏‏ו-`GET /api/projects/:cwdHash/sessions` ‏מחזירים ‏‏תמיד ‏`{"sessions":[]}` ‏‏בעקבות ‏ההסרה ‏של ‏stdio-to-ws ‏ב-F-1 followup (`0446044`). ‏‏הflow ‏ב-BE:

1. ‏`http-history.ts:80` → `fetchSessions(cwd)` ‏על ‏cache miss
2. ‏`server.ts:73` → `bridgeManager.spawn(...)` — ‏ה-spawn ‏עצמו ‏מצליח
3. ‏`server.ts:78` → `listSessionsFromBridge({ wsUrl: handle.wsUrl, ... })`
4. ‏`bridge-manager.ts:110` ‏מחזיר ‏`wsUrl: ""` ‏‏‏‏(in-process pipes — ‏‏‏‏אין ‏יותר ‏WS ‏פנימי)
5. ‏`session-types.ts:33` → `new WebSocket("")` ‏זורק ‏מיד
6. ‏ה-`try/catch` ‏ב-`server.ts:80-82` ‏‏בולע ‏את ‏השגיאה ‏‏‏ומחזיר ‏`[]`
7. ‏`finally` ‏הורג ‏‏מיידית ‏‏את ‏ה-bridge ‏שזה ‏עתה ‏נוצר

‏‏Logs ‏מאשרים: ‏`spawn ok → kill → child exit` ‏‏ברצף ‏‏‏‏בלי ‏‏שום ‏פעילות ‏ביניהם.

## Root cause

### ‏‏1. ‏‏ארכיטקטונית — ‏`listSessionsFromBridge` ‏יתום ‏מאז ‏F-1 ‏followup

‏F-1 ‏followup ‏(`0446044`) ‏‏‏עבר ‏מ-stdio-to-ws ‏‏‏(WS ‏‏פנימי ‏per-bridge) ‏ל-in-process pipes ‏(`ws-agent.ts:73-91` — ‏readline ‏‏‏על ‏child.stdout ‏‏ישירות ‏ל-feWs). ‏ה-CLI ‏subprocess ‏‏‏לא ‏‏‏מאזין ‏‏יותר ‏‏‏ב-port ‏ולא ‏‏מספק ‏‏‏WS endpoint — ‏הוא ‏רק ‏stdio.

‏`session-types.ts` ‏‏(שעוד ‏לא ‏נמחק ‏אחרי ‏ה-cleanup) ‏‏מנסה ‏לפתוח ‏`new WebSocket(wsUrl)` ‏מ-Node ‏בתוך ‏ה-BE ‏‏‏אל ‏ה-bridge. ‏מאחר ‏וה-wsUrl ‏‏הוא ‏מחרוזת ‏ריקה, ‏זה ‏אף ‏פעם ‏לא ‏‏יעבוד. ‏‏גם ‏אילו ‏‏‏מילאנו ‏פורט, ‏לא ‏היה ‏‏‏מי ‏שיענה ‏בו.

‏**מסקנה:** ‏ה-helper ‏‏הזה ‏הוא ‏שיירים. ‏‏הוא ‏חייב ‏או ‏‏להתפרק ‏‏ולעבור ‏ל-FE (‏המלצה), ‏או ‏‏להיכתב ‏מחדש ‏לעבוד ‏מול ‏ה-child stdin/stdout ‏‏ישירות ‏(in-process JSON-RPC).

### ‏‏2. ‏FE ‏‏‏כבר ‏יכול ‏‏‏לעשות ‏את ‏זה — ‏‏הכל ‏בנוי

‏`packages/frontend/src/lib/acp/client.ts:131-133`:

```ts
async listSessions() {
  return conn.listSessions({})
}
```

‏המתודה ‏‏‏קיימת, ‏typed, ‏‏‏‏‏ולא ‏‏‏בשימוש ‏על ‏ידי ‏‏שום ‏caller. ‏‏‏‏ה-SDK ‏(`@agentclientprotocol/sdk` 0.21.1) ‏‏‏מספק ‏‏אותה ‏‏‏‏על ‏`ClientSideConnection`. ‏‏רק ‏צריך ‏לחבר ‏לה ‏‏‏consumer ‏‏‏ב-store.

### ‏‏3. ‏‏`/api/sessions` ‏ה-union ‏הוא ‏‏‏עיוות ‏‏‏‏מתקופת ‏stdio-to-ws

‏‏ה-union ‏‏‏‏עבד ‏‏‏‏‏‏רק ‏כי ‏ה-spawn ‏היה ‏זול (port ‏‏מהיר ‏לעלות), ‏‏ה-stdio-to-ws ‏‏שמר ‏לחוד ‏את ‏ה-state, ‏‏‏וה-cache ‏‏ב-`sessions-cache.ts` ‏‏ניטרל ‏‏את ‏הvolume. ‏אחרי ‏‏ההעברה ‏ל-in-process: ‏כל ‏spawn ‏‏מעלה ‏child ‏מלא ‏(opencode ‏acp = ‏~300ms ‏‏בלי ‏האימיוט). ‏אם ‏‏היה ‏‏פועל ‏בכלל, ‏10 ‏פרויקטים ‏=‏ ‏10 ‏children ‏זמניים ‏‏‏‏שמתים ‏‏מיד ‏=‏ ‏‏בזבוז ‏‏גדול.

## Affected files

‏BE ‏(‏יוסר/יתבטל):
- ‏`packages/backend/src/server.ts:64-85` — ‏`fetchSessions` ‏הפונקציה ‏עצמה
- ‏`packages/backend/src/server.ts:92` — ‏`registerProjectsHttp({ ..., fetchSessions })` ‏‏ההעברה
- ‏`packages/backend/src/delivery/http-history.ts:25-94` — ‏`registerProjectsHttp` ‏(‏‏‏שני ‏ה-endpoints ‏‏‏ש‏שולפים ‏sessions)
- ‏`packages/backend/src/app/sessions-cache.ts:1-46` — ‏‏הקובץ ‏כולו ‏(‏‏‏לא ‏‏יהיה ‏יותר ‏cache ‏ב-BE)
- ‏`packages/backend/src/acp/session-types.ts:26-183` — ‏`_openAndInitialize` + `listSessionsFromBridge` (‏‏‏שאריות ‏stdio-to-ws). ‏רק ‏ה-`SessionInfo` type ‏‏(‏‏‏‏שורות ‏16-24) ‏עשוי ‏‏‏עוד ‏‏לשרת ‏‏‏‏‏יבוא ‏ב-`http-history.ts` ‏‏‏‏‏‏עד ‏‏הקילר. ‏בסוף ‏יש ‏‏‏להעביר ‏‏את ‏ה-type ‏ל-core/ ‏או ‏ל-FE ‏types.

‏FE ‏(‏יוסף/יורחב):
- ‏`packages/frontend/src/lib/acp/client.ts:131-133` — ‏`listSessions()` ‏‏כבר ‏שם. ‏‏צריך ‏consumer.
- ‏`packages/frontend/src/lib/stores/projects-store.svelte.ts:33` — ‏`Promise.all([listSessions(), listProjects()])` ‏‏‏יישבר ‏‏אחרי ‏‏הסרת ‏ה-endpoint. ‏‏‏יעבור ‏ל-`listProjects()` ‏בלבד, ‏‏‏‏ה-sessions ‏‏‏ייטענו ‏per-project.
- ‏`packages/frontend/src/lib/api/sessions.ts:24-29` — ‏`listSessions()` ‏‏יוסר. ‏‏`listProjectSessions()` ‏‏יוחלף ‏‏‏ב-helper ‏FE-driven.
- ‏`packages/frontend/src/routes/sessions/+page.svelte:46-52` — ‏‏ה-tab ‏"‏כל ‏השיחות" ‏יוסר ‏או ‏יוחלף ‏ב-fallback ‏אחר ‏(‏ראה ‏אופציות ‏‏למטה).
- ‏`packages/frontend/src/routes/sessions/[cwdHash]/+page.svelte:18` — ‏`store.loadProjectSessions(cwdHash)` ‏‏יקרא ‏‏‏‏‏ל-flow ‏החדש.

‏BE ‏(‏נשאר ‏‏‏ללא ‏שינוי, ‏זה ‏source of truth ‏‏‏‏‏אחר ‏ה-fetch):
- ‏`packages/backend/src/app/projects-registry.ts` — ‏‏מתעד ‏cwd + lastSessionId. ‏‏ממשיך ‏‏לתפקד ‏בלי ‏שינוי.
- ‏`packages/backend/src/delivery/http-agents.ts:98-133` — ‏`session-attached` ‏‏מעדכן ‏`lastSessionId` ‏ב-projects-registry. ‏ממשיך.

## Reproduction

‏‏לא ‏שוחזר ‏(read-only ‏protocol). ‏ה-evidence ‏ב-prompt + ‏מעקב ‏הקוד ‏חד-משמעיים: ‏`bridge-manager.ts:110` ‏מחזיר ‏`wsUrl: ""`, ‏`session-types.ts:33` ‏‏‏בודק ‏אותו ‏‏ישירות, ‏אין ‏בכלל ‏אפשרות ‏שזה ‏יעבור ‏ל-success path.

## ‏Architectural options

‏ארבע ‏אופציות ‏שקולות. ‏‏המלצה ‏‏בסוף ‏הסעיף.

### Option ‏‏‏‏‏A — ‏FE driven, ‏per-project ‏‏on-demand (‏‏‏‏מומלץ)

‏ה-FE ‏מנהל ‏‏את ‏‏‏השליפה. ‏‏שני ‏מסלולים:

‏-‏ **‏סשנים ‏לפרויקט ‏עם ‏agent ‏פעיל ‏‏‏בtab ‏הזה**: ‏השתמש ‏ב-WS ‏הקיים. ‏‏‏‏‏הקריאה ‏`listSessions()` ‏‏‏מתבצעת ‏על ‏ה-`ClientSideConnection` ‏‏‏שכבר ‏passed initialize.
‏-‏ **‏סשנים ‏לפרויקט ‏‏‏‏‏‏שאין ‏לו ‏agent ‏פעיל**: ‏ספאון ‏זמני ‏‏on-demand ‏‏‏‏‏‏(POST /api/agents ‏→ ‏פתח ‏WS ‏→ ‏initialize ‏→ ‏listSessions ‏→ ‏DELETE /api/agents).

‏אופצית ‏‏הספאון ‏‏הזמני ‏‏זהה ‏‏‏‏‏‏עקרונית ‏‏‏‏לרעיון ‏‏‏(א) ‏‏‏בprompt, ‏‏אבל ‏‏‏מבוצעת ‏ב-FE ‏‏‏ולא ‏‏‏ב-BE. ‏‏זה ‏‏מאפשר ‏ל-FE ‏‏‏‏לבחור ‏מתי ‏לשלם ‏‏את ‏המחיר ‏(‏‏אינטראקציית ‏‏משתמש ‏‏‏מפורשת, ‏‏‏עם ‏spinner ‏‏‏ברור), ‏‏‏‏‏‏ולהציג ‏‏את ‏המידע ‏שיש ‏(‏`lastSessionId` ‏מ-`/api/projects`) ‏‏מיידית.

‏יתרון ‏גדול: ‏‏אם ‏‏המשתמש ‏‏‏בעצם ‏‏רק ‏רצה ‏‏‏‏לחזור ‏ל-session ‏‏האחרון ‏‏(use case ‏השכיח), ‏הוא ‏‏‏‏לא ‏‏צריך ‏את ‏הרשימה ‏המלאה — ‏רק ‏‏‏‏‏‏את ‏‏‏ה-`lastSessionId`, ‏‏‏שיש ‏לנו ‏‏‏בלי ‏ספאון.

### Option B — ‏BE ‏‏‏מספק ‏endpoint ‏מאוחד ‏מ-in-process bridges הקיימים

‏BE ‏‏שומר ‏רשימת ‏סשנים ‏‏‏per-cwd ‏‏‏מצטברת ‏מ-agent יוצרים ‏‏פעילים. ‏כאשר ‏FE ‏‏פותח ‏WS ‏ל-agent ‏ו‏עושה ‏initialize+newSession, ‏ה-BE ‏‏‏‏‏מתעד ‏‏‏‏בצד ‏את ‏הסשן. ‏‏`/api/sessions` ‏‏מחזיר ‏‏אגירה ‏‏‏‏פנימית.

‏❌ ‏לא ‏פותר ‏‏את ‏המקרה ‏שאין ‏agent ‏פעיל. ‏‏‏שטחי. ‏‏שווה ‏ערך ‏ל-projects-registry ‏(‏‏שגם ‏ככה ‏שומר ‏רק ‏לאחרון). ‏‏אם ‏‏זה ‏מספיק — ‏‏‏‏הפיכון ‏‏‏‏הוא ‏‏‏פשוט ‏‏לוותר ‏על ‏הרשימה ‏הזאת ‏לגמרי.

### Option C — ‏FE ‏שומר ‏locally ‏מה ‏‏שראה (localStorage)

‏‏בכל ‏פעם ‏ש-FE ‏רואה ‏session/list ‏‏או ‏‏‏‏צובר ‏updates ‏מ-acpSession, ‏הוא ‏‏‏שומר ‏ב-localStorage ‏‏‏(‏key per cwd). ‏‏‏‏בעת ‏‏הצורך — ‏הצג ‏מ-cache.

‏❌ ‏‏‏מאבד ‏cross-device (‏‏‏שאלון ‏‏‏שאבי ‏‏ביקש ‏‏לציין). ‏❌ ‏‏לא ‏‏מטפל ‏ב-first visit. ‏‏✅ ‏‏מהיר ‏‏‏‏‏‏בvisits ‏חוזרים, ‏✅ ‏‏‏‏‏מנקה ‏stale cache ‏‏ב-TTL.
‏סביר ‏‏‏‏כתוספת ‏ל-A (‏‏ראה ‏Option ‏‏E ‏‏‏למטה), ‏‏לא ‏‏‏‏בפני ‏עצמו.

### Option D — ‏‏ברירת מחדל: ‏אין ‏רשימה ‏מלאה, ‏רק ‏`lastSessionId` ‏מ-projects-registry

‏‏‏לא ‏‏מציגים ‏‏‏‏‏סשנים ‏ב-`/sessions`. ‏‏רק ‏פרויקטים, ‏‏עם ‏‏‏לחצן ‏"‏המשך ‏את ‏‏האחרון" ‏שצריך ‏רק ‏‏‏‏את ‏‏ה-`lastSessionId` ‏‏‏‏שכבר ‏יש ‏ב-`/api/projects`. ‏‏אם ‏רוצים ‏לחזור ‏‏לסשן ‏ישן ‏יותר — ‏צריך ‏‏לפתוח ‏את ‏ה-CLI ‏‏ידנית ‏ולהריץ ‏`opencode list`.

‏✅ ‏‏פשוט ‏ביותר, ‏‏‏0 ‏ספאונים, ‏‏0 ‏cache, ‏‏‏0 ‏רגישות ‏‏‏לarchitecture. ‏‏‏‏‏מתאים ‏לhands-free ‏voice-first ‏‏‏(‏שזה ‏‏‏‏ה-USP ‏של ‏המוצר). ‏‏❌ ‏מוריד ‏פיצ'ר. ‏‏‏‏‏ייתכן ‏ש-Avi ‏‏‏‏‏מעדיף ‏מסלול ‏ביניים — ‏‏רואה ‏רשימה ‏אם ‏‏‏יש ‏‏‏agent ‏פעיל, ‏‏‏אבל ‏לא ‏‏מספאן ‏לעולם ‏רק ‏ל-listing.

### Option E — ‏‏היברידי ‏A+D+C (‏המלצה ‏מוצקת)

1. ‏ב-`/sessions` ‏(‏‏מסך ‏ראשי): ‏‏רק ‏‏רשימת ‏פרויקטים ‏מ-`/api/projects` ‏+ ‏‏שורה ‏אחת ‏לכל ‏פרויקט ‏‏עם ‏ה-`lastSessionId` (‏כפעולה ‏מהירה "‏המשך"). ‏‏אין ‏‏tab ‏"‏כל ‏‏‏השיחות" — ‏או ‏‏שהוא ‏‏מוסר, ‏‏‏או ‏‏שהוא ‏‏מציג ‏רק ‏‏‏את ‏‏‏‏סשנים ‏‏שראינו ‏‏עכשיו ‏‏‏ב-cache ‏‏(‏Option ‏C).
2. ‏ב-`/sessions/[cwdHash]` ‏(‏drill-down): 
   - ‏אם ‏יש ‏agent ‏פעיל ‏‏לcwd ‏הזה (‏‏‏‏‏מ-`listAgents()`) — ‏פתח ‏WS, ‏listSessions, ‏הצג.
   - ‏אחרת — ‏‏הצג ‏רק ‏‏‏‏את ‏ה-`lastSessionId` ‏‏‏‏עם ‏‏‏לחצן ‏"‏‏‏‏ראה ‏‏את ‏כל ‏‏‏הסשנים" ‏‏‏שspawn ‏‏זמני ‏‏‏on-click ‏(‏‏‏‏‏מתחילים ‏עם ‏spinner ‏ברור, ‏‏‏‏‏‏הספאון ‏‏‏‏אינו ‏יתום).
3. ‏FE ‏cache (Option ‏C ‏‏‏מצומצם): ‏‏אחרי ‏‏‏שליפה ‏‏‏מוצלחת — ‏‏שמור ‏ב-localStorage ‏עם ‏TTL ‏(15 ‏דקות). ‏ב-visit ‏חוזר ‏‏‏מציגים ‏cache ‏‏‏ומבצעים ‏‏revalidate ‏‏‏‏ברקע ‏‏(‏stale-while-revalidate, ‏‏‏‏‏רק ‏אם ‏‏יש ‏agent ‏פעיל ‏ולא ‏צריך ‏ספאון).

### ‏‏השוואה ‏‏טבלאית

| ‏קריטריון | A ‏(‏FE drove) | B ‏(BE union) | C ‏(localStorage ‏בלבד) | D ‏(אין ‏רשימה) | **E ‏(‏‏‏היברידי)** |
|----------|----------------|--------------|------------------------|---------------|--------------------|
| ‏מציג ‏רשימה ‏ל-active project | ✅ ‏מיידי | ✅ ‏‏אם ‏‏‏BE ‏אגר | ✅ ‏‏אם ‏‏‏יש ‏‏‏cache | ❌ | ✅ ‏‏מיידי |
| ‏מציג ‏רשימה ‏ל-inactive project | ✅ ‏‏באישור ‏משתמש (‏ספאון) | ❌ | ⚠️ ‏‏‏רק ‏‏‏‏מ-cache | ❌ ‏(‏‏רק ‏lastSessionId) | ✅ ‏‏באישור ‏‏‏משתמש |
| ‏מציג ‏cross-device | ✅ | ✅ | ❌ | ✅ ‏(‏רק ‏lastSessionId) | ✅ |
| ‏עלות ‏‏‏ספאון ‏בvisit ‏רגיל | 0 | 0 | 0 | 0 | 0 (‏רק ‏‏בלחיצה ‏‏‏מפורשת) |
| ‏שינויי ‏BE | ‏הסרת ‏3 ‏endpoints + ‏cache | ‏‏‏רחב | ‏הסרת ‏‏3 ‏‏endpoints | ‏הסרת ‏3 ‏endpoints | ‏‏הסרת ‏‏3 ‏endpoints |
| ‏שינויי ‏FE | בינוני | ‏‏מינימלי | ‏מינימלי | ‏‏‏מינימלי | ‏בינוני |
| ‏תואם ‏Gemini (‏אין ‏session/list) | ✅ ‏(‏fallback ‏ל-`lastSessionId`) | ❌ ‏(‏‏אין ‏מקור) | ❌ | ✅ | ✅ |
| ‏עמיד ‏‏ל-BE restart | ⚠️ ‏(‏‏‏לא ‏‏מאבד ‏‏‏cwds, ‏‏‏‏‏‏‏רק ‏active sessions) | ❌ (‏‏cache ‏in-mem) | ⚠️ (‏‏cache ‏‏אבל ‏stale) | ✅ | ⚠️ (‏‏לא ‏‏מאבד ‏cwds) |
| ‏מורכבות ‏‏‏לתחזוקה | ‏בינוני | ‏גבוה | ‏בינוני | ‏‏נמוך | ‏בינוני |

### ‏המלצה: **‏Option ‏E**

‏‏‏‏מתאים ‏ל-USP ‏‏(‏voice-first): ‏‏ה-UX ‏‏הראשי ‏הוא ‏"‏המשך ‏את ‏‏האחרון" — ‏‏‏שעובד ‏בלי ‏‏‏שום ‏ספאון. ‏‏‏רק ‏‏אם ‏המשתמש ‏‏‏אקטיבית ‏רוצה ‏‏‏לחפש ‏ב-history — ‏‏אז ‏‏הוא ‏‏מקבל ‏‏את ‏‏העלות.

‏‏מהפרספקטיבה ‏של ‏‏אבי ‏(‏ב-prompt): "‏FE ‏ישלוף ‏ישירות ‏מה-WebSocket ‏הקיים" — ‏‏זה ‏מ‏‏מומש ‏ב-step 2 ‏שלב ‏ראשון ‏(active agent). ‏‏‏שלב ‏שני ‏‏(‏inactive) ‏הוא ‏‏פתרון ‏פרגמטי ‏‏לאופציה ‏‏(א) ‏‏‏שהוא ‏עצמו ‏‏‏‏סימן ‏כ-"יקר" — ‏אבל ‏רק ‏עם ‏אישור ‏מפורש ‏‏‏מהמשתמש, ‏‏‏‏לא ‏‏‏‏אוטומטית.

## FE flow ‏-‏ ‏‏Pseudocode

### ‏‏1. ‏API ‏client חדש ‏ב-FE

```ts
// packages/frontend/src/lib/api/sessions-ws.ts (new file)
import { createAcpClient } from "$lib/acp/client"
import type { CliKind } from "@drive-coding/core"
import { createAgent, deleteAgent } from "$lib/api/agents"

export type SessionInfo = {
  sessionId: string
  cwd: string
  title: string
  updatedAt: string
}

/**
 * listSessionsViaActiveAgent — for a project that already has an agent in this tab.
 * Reuses the existing AcpClient connection (no new WS, no spawn).
 */
export async function listSessionsViaActiveAgent(
  acpClient: Awaited<ReturnType<typeof createAcpClient>>,
): Promise<SessionInfo[]> {
  try {
    const res = await acpClient.listSessions()
    const raw = (res as { sessions?: unknown[] }).sessions ?? []
    return raw.map(normalizeSession)
  } catch (e) {
    // -32601: CLI doesn't support session/list (Gemini). Return empty silently.
    if ((e as { code?: number }).code === -32601) return []
    throw e
  }
}

/**
 * listSessionsViaTempAgent — spawn a throwaway agent just to list sessions.
 * Use only on explicit user click ("הצג את כל הסשנים").
 * Caller MUST show a spinner — opencode warm start is ~300-500ms + handshake.
 */
export async function listSessionsViaTempAgent(opts: {
  cwd: string
  cliKind: CliKind
}): Promise<SessionInfo[]> {
  let tempAgentId: string | null = null
  let client: Awaited<ReturnType<typeof createAcpClient>> | null = null
  try {
    const { agentId } = await createAgent({ cwd: opts.cwd, cliKind: opts.cliKind })
    tempAgentId = agentId

    // Listen but don't bind updates — we just want the listSessions response
    client = await createAcpClient(agentId, () => {})

    return await listSessionsViaActiveAgent(client)
  } finally {
    try { client?.close() } catch {}
    if (tempAgentId) {
      // DELETE is fire-and-forget — ws-agent.ts:105 detaches the pipe; BE kills the child.
      void deleteAgent(tempAgentId).catch(() => {})
    }
  }
}

function normalizeSession(s: unknown): SessionInfo {
  const item = s as Record<string, unknown>
  return {
    sessionId: String(item.sessionId ?? ""),
    cwd: String(item.cwd ?? ""),
    title: String(item.title ?? ""),
    updatedAt: String(item.updatedAt ?? ""),
  }
}
```

### ‏‏2. ‏‏שילוב ‏‏ב-`/sessions/[cwdHash]/+page.svelte`

```ts
// On mount:
//   1. Resolve cwdHash → project (cwd, cliKind, lastSessionId)
//   2. Check if there's an active agent for this cwd via listAgents()
//   3. If yes — connect to it, listSessions, show full list.
//   4. If no — show project header + lastSessionId quick-link.
//      Add "ראה את כל הסשנים" button → on click, spinner + listSessionsViaTempAgent.

const projects = await listProjects()
const project = projects.find((p) => p.cwdHash === cwdHash)
if (!project) { /* error: project not found */ return }

const agents = await listAgents()
const activeAgent = agents.find((a) => a.cwd === project.cwd && a.status === "ready")

let sessions: SessionInfo[] = []
let needsExplicitFetch = false

if (activeAgent) {
  // Active agent in registry. We can connect (will fail if another tab holds the WS — 1008).
  // Catch and fall through to needsExplicitFetch.
  try {
    const client = await createAcpClient(activeAgent.id, () => {})
    try {
      sessions = await listSessionsViaActiveAgent(client)
    } finally {
      client.close()
    }
  } catch (e) {
    needsExplicitFetch = true  // 1008 collision, or any other failure
  }
} else {
  needsExplicitFetch = true
}

// FE-side stale-while-revalidate cache (15 min TTL)
const cached = loadCachedSessions(project.cwd)
if (cached && sessions.length === 0) sessions = cached
if (sessions.length > 0) saveCachedSessions(project.cwd, sessions)

// On user click "הצג את כל הסשנים":
async function fetchAll() {
  loading = true
  try {
    sessions = await listSessionsViaTempAgent({ cwd: project.cwd, cliKind: project.cliKind })
    saveCachedSessions(project.cwd, sessions)
    needsExplicitFetch = false
  } finally { loading = false }
}
```

### ‏‏3. ‏‏עדכון ‏`projects-store.svelte.ts`

```ts
// Remove listSessions() call from load(). Sessions are now per-page.
async function load(force = false): Promise<void> {
  // ... TTL check ...
  loading = true
  try {
    const proj = await listProjects()  // only this — no global sessions
    projects = proj
    lastLoaded = Date.now()
  } catch (e) { ... }
  finally { loading = false }
}
```

### ‏‏4. ‏‏עדכון ‏`/sessions/+page.svelte`

‏‏הסר ‏tab ‏"‏כל ‏השיחות" ‏(‏או ‏החלף ‏ל-tab ‏"‏לפי ‏פרויקט" ‏‏יחיד). ‏‏‏הוסף ‏‏לכל ‏ProjectCard ‏‏לחצן ‏‏מהיר ‏"‏‏המשך ‏‏אחרון" ‏‏שמ‏‏‏‏מנווט ‏ל-`/session/[cwdHash]/[lastSessionId]` ‏‏ב-1 click (‏‏הroute ‏הזה ‏‏כבר ‏‏‏עובד, ‏‏‏יוצר ‏agent ‏עם ‏`existingSessionId`).

## ‏‏‏מה ‏עושים ‏עם ‏ה-BE

### ‏‏Cleanup (‏‏המלצה: ‏‏כן, ‏‏בintro ‏ל-slice ‏הביצוע)

‏‏לאחר ‏שה-FE ‏‏מ‏‏עביר ‏‏‏‏את ‏‏‏‏‏הקריאה — ‏הסר ‏‏ב-BE:
- ‏`server.ts:64-85` (`fetchSessions`)
- ‏`server.ts:92` ‏-‏ ‏העברת ‏`fetchSessions` ל-`registerProjectsHttp`
- ‏`http-history.ts:25-94` ‏-‏ ‏‏שני ‏ה-endpoints ‏ש‏‏‏‏מחזירים ‏sessions
- ‏`sessions-cache.ts` ‏-‏ ‏‏ה-file ‏כולו
- ‏`session-types.ts` ‏-‏ ‏‏כל ‏הקובץ ‏מלבד ‏`SessionInfo` ‏type ‏‏‏‏שעובר ‏‏‏‏ל-FE ‏(‏‏אם ‏‏‏עדיין ‏צריך ‏‏את ‏הtype ‏‏בBE — ‏‏‏שב ‏‏‏ב-core/)
- ‏`server.ts:54-55` ‏-‏ ‏boot ‏של ‏`sessionsCache`
- ‏imports ‏מקבילים

‏זה ‏‏מסיר ‏~300 ‏שורות ‏‏‏שאריות ‏‏‏מ-stdio-to-ws.

### ‏‏Cache ‏ב-BE: ‏‏מבטל ‏לגמרי

‏‏‏ה-cache ‏‏‏‏עם ‏TTL 5 ‏דקות ‏‏‏היה ‏‏‏‏רלוונטי ‏‏‏כי ‏ה-spawn ‏היה ‏‏איטי. ‏עכשיו ‏‏ה-FE ‏‏‏‏מבצע ‏‏את ‏הspawn ‏רק ‏‏בקליק ‏‏‏‏מפורש, ‏ו-FE caching ‏‏‏שונה ‏(‏localStorage ‏‏‏‏עם ‏TTL). ‏אין ‏טעם ‏‏לשמור ‏cache ‏פנימי ‏ב-BE.

## ‏‏סוגיה ‏‏פתוחה ‏-‏ ‏Gemini ‏ללא ‏session/list

‏ה-current BE code ‏‏‏מטפל ‏‏‏ב-`-32601` ‏(method not found) ‏‏‏ב-`session-types.ts:170-176`. ‏‏‏אחרי ‏ההעברה ‏‏ל-FE: ‏ה-`listSessionsViaActiveAgent` ‏‏ב-pseudocode ‏‏‏‏‏‏מעלי ‏עושה ‏fallback ‏זהה ‏(‏‏מחזיר ‏`[]`). ‏‏המשתמש ‏בGemini ‏‏יראה ‏"‏אין ‏שיחות ‏‏קודמות ‏(ה-CLI ‏‏לא ‏‏‏תומך ‏ב-history)". ‏‏‏שווה ‏‏אינדיקציה ‏ברורה ‏‏‏‏‏ב-UI.

## Risks

1. **‏‏‏‏ספאון ‏זמני ‏‏‏עלול ‏‏‏להיכשל ‏‏‏אם ‏‏הCLI ‏‏לא ‏מותקן**. ‏‏זה ‏‏‏אותו ‏risk ‏‏שיש ‏‏לכל ‏createAgent ‏‏רגיל — ‏הtoast ‏ב-recovery (F-5) ‏‏‏‏‏מטפל ‏‏בזה. ‏‏‏צריך ‏‏לוודא ‏‏ש‏-`listSessionsViaTempAgent` ‏‏גם ‏‏מעלה ‏notification ‏‏אם ‏‏ה-POST ‏נכשל ‏‏‏לפני ‏‏‏שהspinner ‏‏נסגר ‏ללא ‏‏‏מענה.
2. **‏מירוץ ‏עם ‏MED-8**: ‏‏אם ‏המשתמש ‏פתח ‏ב-tab ‏‏אחד ‏‏‏shell ‏‏של ‏סוכן ‏‏‏עם ‏cwd=X, ‏‏ובtab ‏שני ‏ניגש ‏ל-`/sessions/[hash(X)]` ‏‏‏שמנסה ‏לפתוח ‏WS ‏‏‏לאותו ‏סוכן — ‏ws-agent.ts ‏‏‏יסגור ‏‏‏‏ב-1008. ‏ה-pseudocode ‏‏מעלי ‏‏‏‏‏מטפל ‏‏בזה ‏‏(‏fall to ‏needsExplicitFetch). ‏‏אבל ‏‏‏שווה ‏‏‏לציין ‏ב-UI ‏‏‏‏ש‏‏‏ה-listing ‏‏לא ‏יעבוד ‏בlive ‏‏‏בלי ‏‏‏לנעול ‏‏‏סוכן ‏‏שמישהו ‏‏‏‏אחר ‏‏בtab ‏אחר ‏‏‏‏‏‏‏‏מ‏שתמש ‏בו.
3. **‏‏ספאון ‏‏‏זמני ‏שלא ‏‏מתנקה**: ‏אם ‏המשתמש ‏‏‏סוגר ‏‏טאב ‏‏‏בדיוק ‏‏‏בזמן ‏‏‏‏שטרם ‏‏‏הdelete ‏‏‏הסתיים — ‏ה-bridge ‏יישאר ‏עד ‏‏‏‏BE restart. ‏‏‏זה ‏‏סביר ‏‏לטיפול ‏עם ‏cleanup ‏‏‏‏‏periodic ‏‏‏ב-orchestrator (‏‏יתום ‏‏‏יותר ‏מ-10 ‏‏דקות — ‏‏delete), ‏אבל ‏זה ‏‏יוצא ‏מ-scope ‏ה-slice ‏הזה.
4. **‏Cache ‏stale**: ‏localStorage ‏cache ‏‏אם ‏הוא ‏‏רק ‏מ-cwd 1 ‏לפני ‏7 ‏ימים — ‏ה-sessionId ‏‏עלול ‏‏‏להיות ‏rotated ‏‏ב-opencode. ‏ה-route ‏`/session/[cwdHash]/[id]` ‏מטפל ‏‏בכישלון ‏‏ב-`loadSession` ‏‏‏‏ע"י ‏fallback ‏ל-`newSession` (‏‏‏‏‏‏מנגנון ‏קיים). ‏‏‏TTL ‏15 ‏דקות ‏‏ב-pseudocode ‏‏‏ממזער.
5. **‏‏‏בעיית ‏‏SDK -32601 ‏error format**: ‏הקוד ‏‏‏‏ב-`session-types.ts:170` ‏‏בודק ‏`err?.code === -32601`. ‏‏‏‏צריך ‏לוודא ‏‏‏שזה ‏אותו ‏shape ‏גם ‏‏‏‏ב-SDK 0.21.1 ‏‏‏‏‏מהFE side (‏SDK ‏client ‏error ‏יכול ‏לעטוף ‏אחרת). ‏‏‏זה ‏‏‏בדיקה ‏ב-execution, ‏לא ‏ב-research.

## Open questions for Avi

1. **‏Tab "‏‏כל ‏‏‏השיחות"** ‏(‏`/sessions` ‏‏default ‏tab): 
   - ‏‏(I) ‏‏‏מבטלים ‏אותו ‏לגמרי (Option ‏‏D ‏‏‏‏‏‏בחלקו)
   - ‏‏(II) ‏‏מציגים ‏רק ‏‏‏ל-active agents ‏בtab ‏הזה ‏(‏‏‏שילוב ‏‏ל-active ‏בלבד)
   - ‏‏(III) ‏‏מציגים ‏מ-localStorage cache ‏בלבד (‏‏ייתכן ‏ריק ‏‏ב-first visit)
   
   ‏‏ההמלצה ‏‏שלי: ‏(II) ‏או ‏‏(I). ‏‏‏(III) ‏‏‏מבלבל ‏UX.

2. **‏Auto-spawn ‏on visit** ‏‏‏או ‏‏רק ‏‏‏on user click? ‏ב-pseudocode ‏הצעתי ‏on click. ‏‏‏אבל ‏אפשר ‏אוטומטית ‏‏‏ספאון ‏‏‏אחד ‏‏‏‏לכל ‏visit ‏ל-`/sessions/[cwdHash]` ‏‏אם ‏‏‏אין ‏cache ‏רענן ‏(‏‏‏TTL ‏‏עבר). ‏‏‏זה ‏טיפה ‏‏יותר ‏‏‏‏‏‏אגרסיבי, ‏סביר ‏‏‏‏לhands-free UX.

3. **‏localStorage cache ‏‏בלבד ‏או ‏Service Worker cache?** ‏‏ב-PWA, ‏SW ‏cache ‏‏‏שורד ‏‏יותר ‏גרסאות ‏של ‏ה-app. ‏‏לא ‏קריטי ‏‏‏עכשיו; ‏‏localStorage ‏‏מספיק ‏‏ל-MVP.

4. **‏הסרה ‏מלאה ‏של ‏ה-BE endpoints**: ‏‏‏‏בשלב ‏‏אחד ‏עם ‏ה-FE flow, ‏‏או ‏ב-slice ‏‏‏cleanup ‏‏נפרד? ‏‏‏מי ‏‏‏שעדיין ‏‏מחזיק ‏build ‏ישן ‏‏‏יקבל ‏404 — ‏‏אבל ‏‏‏‏ה-FE ‏החדש ‏‏‏‏לא ‏‏ייכשל ‏(‏סשנים ‏=‏ ‏[]). ‏‏‏המלצה: ‏‏‏‏באותו ‏ה-slice — ‏‏‏‏מנקה ‏את ‏‏הכל ‏‏‏‏בבת ‏אחת.

5. **‏Tracking של ‏‏‏‏ה-temp agent ‏ב-projects-registry**: ‏‏הספאון ‏הזמני ‏‏‏שולח ‏POST /api/agents ‏‏‏שגורם ‏‏‏ל-`orchestrator.createAndSpawn` ‏‏לתעד ‏‏את ‏ה-cwd ‏ב-`projects-registry.json` (‏שורה ‏124-129 ‏ב-`http-agents.ts` ‏‏מתרחש ‏‏ב-`session-attached`, ‏‏אבל ‏ה-temp agent ‏לעולם ‏לא ‏‏יקרא ‏ל-session-attached). ‏‏לכן ‏אין ‏‏זיהום ‏‏של ‏ה-registry. ‏‏‏טוב.

6. **‏Multi-agent ‏לאותו ‏cwd**: ‏אם ‏‏יש ‏‏‏‏יותר ‏מ-agent ‏‏אחד ‏‏‏לcwd ‏אחד (‏אפשרי ‏עם ‏הdedup ‏‏‏‏‏שב-orchestrator), ‏איזה ‏‏אחד ‏ה-FE ‏‏בוחר? ‏‏המלצה: ‏הראשון ‏ב-`listAgents()` ‏‏‏‏‏שמ‏‏‏‏סטטוס ‏`ready` ‏‏‏‏‏ושטרם ‏נעול ‏ב-tab ‏אחר. ‏‏‏(‏‏לא ‏ידוע ‏מראש ‏אם ‏נעול — ‏‏ה-WS upgrade ‏‏הוא ‏‏‏שגורם ‏‏לזה — ‏‏אז ‏‏‏עושים ‏retry ‏אחד ‏על ‏‏השני ‏אם ‏הראשון ‏‏נסגר ‏‏ב-1008).

## Estimated effort

| ‏חלק | LoC | ‏קבצים | Tests | ‏זמן |
|------|-----|--------|-------|------|
| ‏FE: ‏`sessions-ws.ts` (helpers) | ~80 | 1 ‏חדש | 1 unit (mock acp) | 1 ‏שעה |
| ‏FE: ‏‏עדכון ‏`/sessions/[cwdHash]/+page.svelte` | ~60 | 1 | 1 e2e | 1-2 ‏שעות |
| ‏FE: ‏‏עדכון ‏`projects-store.svelte.ts` (‏‏הסר ‏listSessions) | ~10 | 1 | ‏update ‏קיים | 30 ‏דקות |
| ‏FE: ‏‏עדכון ‏`/sessions/+page.svelte` ‏(‏הסר ‏tab) | ~30 | 1 | ‏update ‏קיים | 30 ‏דקות |
| ‏FE: ‏localStorage ‏cache (‏‏לפי ‏תבנית ‏playback-storage.ts) | ~70 | 1 ‏חדש | 1 ‏unit | 1 ‏שעה |
| ‏BE: ‏‏הסרה ‏‏מלאה ‏(‏`fetchSessions`, ‏endpoints, ‏cache, ‏`session-types.ts`) | -300 | ‏4 ‏(‏‏מעודכן/נמחק) | ‏עדכון ‏קיים | 1-2 ‏שעות |
| ‏FE: ‏‏הסרה ‏`api/sessions.ts:listSessions` ‏+ ‏שאר ‏imports | ~10 | 2-3 | — | 30 ‏דקות |
| **‏סה"כ** | **~260 (‏‏רחב), ‏הסרה ‏~330** | **8-10** | **3-4** | **5-7 ‏‏שעות / ‏‏יום ‏עבודה ‏מלא** |

## ‏‏‏Migration ‏path

‏לא ‏‏צריך ‏feature flag — ‏הendpoint ‏‏הקיים ‏‏מחזיר ‏`[]` ‏גם ‏ככה. ‏‏ה-FE ‏‏‏החדש ‏‏‏מתעלם ‏ממנו. ‏‏ההסרה ‏‏‏‏‏יכולה ‏‏‏ללכת ‏‏‏‏בעדינות:

1. ‏ראשון, ‏‏‏הוסף ‏‏‏את ‏ה-FE flow ‏החדש ‏‏‏לצד ‏הקיים. ‏‏ה-FE ‏עוד ‏עושה ‏fetch ‏‏ל-`/api/sessions` ‏(‏‏מחזיר ‏`[]`), ‏ה-`/sessions` ‏‏‏עובד ‏‏עם ‏ה-flow ‏‏החדש.
2. ‏‏‏באותו ‏commit ‏‏‏או ‏‏בcommit ‏עוקב: ‏הסר ‏‏את ‏ה-BE endpoints + cache + ‏session-types.ts ‏+ ‏את ‏ה-FE `api/sessions.ts:listSessions`.

‏אין ‏שום ‏consumer ‏חיצוני ‏ל-`/api/sessions` ‏‏לפי ‏grep ‏‏שעשיתי ‏(רק ‏FE ‏פנימי). ‏בטוח ‏‏להסיר.
