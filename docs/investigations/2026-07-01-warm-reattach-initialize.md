# חקירה — warm reattach שולח `initialize` מיותר ומזיק

> **תאריך**: 2026-07-01  
> **סטטוס**: שורש מאומת ב-wire + בדיקת raw WS חיה  
> **רלוונטי ל**: `attachToLiveAgent`, `#warmReconnect`, active agents reconnect, Codex ACP

## תקציר

כפתור "Reconnect" בפאנל התהליכים הפעילים נכשל מול Codex ACP משום שהוא מנסה להתחבר
ל-agent חי דרך יצירת `AcpClient` חדש. ה-wrapper שלנו `createAcpClient()` תמיד שולח
`initialize`, גם כאשר ה-agent process כבר עבר initialize בחיבור קודם.

מול `@agentclientprotocol/codex-acp` זה נכשל עם:

```text
Internal error: Already initialized
```

זה אינו כשל של `session/load`. להפך: `session/load` עצמו עובד גם מול process חי, אם
שולחים אותו ישירות בלי `initialize` חוזר. לכן השורש הוא handshake מיותר ומזיק בנתיב
warm reattach.

## רקע

יש שני נתיבי חזרה לסשן:

1. **cold load** — יוצרים agent/process חדש, עושים `initialize`, ואז `session/load`.
   זה תקין, כי מדובר בחיבור ACP חדש מול process חדש.
2. **warm reattach** — מתחברים ל-agent/process חי שכבר קיים ב-backend, ורוצים לטעון
   את אותו `sessionId` מחדש.

הנתיב שנכשל הוא warm reattach:

```text
routes/+page.svelte handleReconnect
→ AgentSession.attachToLiveAgent(...)
→ #warmReconnect(agentId)
→ createAcpClient(transport, ...)
→ conn.initialize(...)
→ client.loadSession(...)
```

הבעיה: `initialize` ב-warm reattach אינו נחוץ. הוא גם לא נסבל על ידי Codex ACP אחרי
שה-process כבר אותחל.

## ראיות מה-wire

הקלטה הופעלה עם:

```bash
WIRE_RECORD=1 LOG_WIRE=acp LOG_LEVEL=debug LOG_NS='backend.server,backend.process,backend.orchestrator,backend.ws.agent,backend.acp.wire.*,backend.proxy,client.*' LOG_FORMAT=both pnpm start
```

הקבצים נכתבו תחת:

```text
~/.config/drive-coding/wire-recordings/
```

בכל ההקלטות של הכשל ה-agent היה Codex:

```json
{
  "name": "@agentclientprotocol/codex-acp",
  "title": "Codex",
  "version": "1.0.2"
}
```

דוגמה לכשל מתוך `4a4a9aa8-...jsonl`:

```text
13:31:38 out initialize
13:31:41 in  initialize OK
13:31:51 out session/load
13:31:52 in  session/load OK
...
13:35:14 out initialize
13:35:14 in  error: Already initialized
13:35:15 out initialize
13:35:15 in  error: Already initialized
```

דוגמה נוספת מתוך `b07bcdcc-...jsonl`:

```text
13:35:15 out initialize
13:35:19 in  initialize OK
13:35:19 out session/load
13:35:20 in  session/load OK
13:35:24 out initialize
13:35:24 in  error: Already initialized
13:35:25 out initialize
13:35:25 in  error: Already initialized
```

המסקנה: `session/load` תקין. הכשל מתחיל רק כשנתיב warm reattach שולח `initialize`
נוסף לאותו process.

## בדיקה חיה ללא שינוי קוד

בוצעה בדיקה ידנית מול agent חי לא מחובר:

1. פתיחת WebSocket ל-`/ws/agent/:agentId`.
2. שליחת frame גולמי:

```json
{
  "jsonrpc": "2.0",
  "id": 99,
  "method": "session/load",
  "params": {
    "sessionId": "019f1dd2-3ee7-7013-a0da-21d3040851de",
    "cwd": "/data/data/com.termux/files/home/projects/drive-coding",
    "mcpServers": []
  }
}
```

לא נשלח `initialize`.

התוצאה:

```text
OPEN
session/update ...
id:99 resultKeys: ["models","modes","configOptions"]
CLOSE 1000 done
```

כלומר Codex ACP מקבל `session/load` על process שכבר initialized, אם לא שולחים לו
`initialize` חוזר. זו הראיה המרכזית שאין צורך ב-fork של ה-SDK.

## למה ה-SDK אינו מחייב fork

ב-`@agentclientprotocol/sdk`, `ClientSideConnection` חושף פעולות נפרדות:

```ts
const conn = new ClientSideConnection(...)
conn.initialize(...)
conn.loadSession(...)
```

המחלקה עצמה אינה מחייבת לקרוא ל-`initialize` לפני `loadSession`.

החובה אצלנו נמצאת ב-wrapper:

```text
packages/provider/src/client/client.ts:createAcpClient()
```

הפונקציה `createAcpClient()` תמיד עושה:

```ts
const initResult = await conn.initialize(...)
```

ולכן כל caller שמקבל `AcpClient` דרכה מקבל handshake אוטומטי. זה נכון ל-attach/cold
load, אבל שגוי ל-warm reattach.

## תיקון מוצע

להוסיף וריאנט אצלנו, לא ב-SDK:

```ts
createAcpClient(..., { skipInitialize: true, capabilities })
```

או פונקציה נפרדת:

```ts
createAttachedAcpClient(...)
```

היא תעשה:

1. בניית `ndJsonStream`.
2. בניית `ClientSideConnection`.
3. יצירת אותו facade של `AcpClient`.
4. לא תקרא ל-`conn.initialize`.
5. תקבל `capabilities` מבחוץ או תשתמש ב-fallback לפי `cliKind`.

ואז `#warmReconnect` ישתמש בה:

```text
open WS to existing agent
→ createAttachedAcpClient(..., skip initialize)
→ client.loadSession({ sessionId, cwd })
→ notifySessionAttached(..., replace:true)
→ status=connected
```

## נקודת capabilities

היום `AcpClient.capabilities` מגיע מתשובת `initialize`. ב-warm reattach לא תהיה תשובה
כזאת. אפשרויות:

1. להעביר ל-`createAttachedAcpClient` את ה-capabilities הידועות מה-BE/provider.
2. לשמור ב-FE את capabilities מהחיבור הראשון אם מדובר ב-reconnect פנימי.
3. להשתמש ב-fallback סטטי לפי `cliKind` עד שמתקבל מידע richer.

לנתיב active-processes אחרי refresh, כנראה צריך להרחיב את `/api/agents` או endpoint
ייעודי כדי להחזיר capabilities מספיקות. ל-MVP אפשר להתחיל ב-static fallback, כי מטרת
ה-warm reattach היא קודם כל להחזיר את החיבור וההיסטוריה.

## הערה על Claude Code ו-"in-process"

במהלך החקירה עלתה נקודת ניסוח חשובה: לקרוא לנתיב Claude "in-process" בלי הסתייגות
זה מבלבל.

ב-codebase, `connectInProcess` אומר שה-**ACP adapter** של Claude נטען בתוך תהליך
ה-backend:

```text
packages/provider/src/connection/connect-in-process.ts
```

אבל זה לא אומר ש-Claude Code עצמו אינו process/בינארי חיצוני. `ClaudeAcpAgent` משתמש
ב-`@anthropic-ai/claude-agent-sdk`, וה-SDK מאתר/מריץ Claude Code executable.

ניסוח מדויק יותר:

```text
Claude provider uses an in-backend ACP adapter; Claude Code itself is still managed
by the Anthropic SDK and may run as an external executable.
```

או בעברית:

```text
אדפטר ה-ACP של Claude רץ בתוך ה-backend, אבל Claude Code עצמו אינו "in-process"
במובן הפשוט; הוא מנוהל ומורץ דרך Anthropic SDK.
```

הדיוק הזה חשוב כי הוא משפיע על האבחנה: ההבדל מול Codex אינו בהכרח "process מול
in-process", אלא בשכבת האדפטר ובשאלה מי מקבל את `initialize` החוזר ואיך הוא מתנהג.

## השערה על ההבדל בין Codex ל-Claude

כל ההקלטות שנבדקו היו מול Codex ACP. לא נבדק live מול Claude באותה הרצה.

ייתכן שבסביבות שבהן המשתמשת זוכרת reconnect תקין, היה שימוש ב-Claude Code ולא
ב-Codex. אם כך, יש כמה הסברים אפשריים:

- הנתיב שעבד בפועל היה cold `session/load`, לא warm reattach.
- אדפטר Claude סובל `initialize` חוזר או מנהל אותו אחרת.
- גרסה/ענף אחר עדיין לא כלל את `slice-reconnect-warm-attach`, ולכן הכפתור קרא
  ל-`loadSession` במקום `attachToLiveAgent`.

הראיה הנוכחית לא מוכיחה את התנהגות Claude. היא מוכיחה ש-Codex נכשל בגלל initialize
חוזר, וש-Codex מצליח ב-`session/load` ללא initialize חוזר.

## המלצה

לא לעשות fork ל-`@agentclientprotocol/sdk`.

כן להוסיף אצלנו client-creation path שמדלג על initialize עבור warm reattach, עם בדיקות:

1. unit test ל-provider client: יצירת client בלי קריאה ל-`initialize`, וקריאת
   `loadSession`.
2. VM test: `attachToLiveAgent` משתמש בנתיב skip-init ולא ב-`createAcpClient` הרגיל.
3. live/manual: Codex active agent → leave running → reconnect → אין `initialize`
   חוזר ב-wire, יש `session/load`, וה-UI נכנס ל-chat.

## הערת המשך

הבעיה הגדולה יותר של multi-client/replay עדיין קיימת למסלול שבו שני לקוחות מחוברים
בו-זמנית. המסמך הזה אינו פותר mux/id-NAT. הוא פותר מקרה צר יותר: חיבור מחדש ל-agent
חי כאשר אין כרגע FE מחובר, בלי להרוג את process ה-agent ובלי handshake חוזר.
