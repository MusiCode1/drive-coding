# חקירה — בריאות כיבוי-BE וניהול סוקטים/תהליכים

> **תאריך**: 2026-07-01
> **סטטוס**: תיעוד-מצב + ראיות חיות. **לא לביצוע מיידי** — נאסף אגב דיבוג "codex לא נפתח".
> **רלוונטי ל**: יציבות ה-BE, Track F (WS robustness), פורטים שלא משתחררים (כאב חוזר)
> **קשור**: `2026-07-01-warm-reattach-initialize.md` (לולאת reconnect = מקור הצטברות-סוקטים)

## תקציר

תוך דיבוג "codex לא נפתח במחשב" התגלה שהשורש המיידי **אינו** codex ואינו הסלייס
`warm-reattach-skip-init` — אלא ש**ה-BE עצמו על פורט 4000 היה תקוע**: מאזין אבל לא מגיב
ל-HTTP, עם ערימת ~60 סוקטים חצי-סגורים. סגירת הטרמינל לא הרגה אותו, והפורט **לא השתחרר
גם אחרי שהתהליך מת** — כאב שהמשתמשת ציינה שהיא מבחינה בו "מזמן".

נאספו כאן 5 פערי-חוסן מאותה משפחה, עם ראיות חיות. המסמך מתעד אותם כדי שלא יתאדו,
ומציע כיווני-תיקון — לביצוע כשלב-חוסן ייעודי, לא עכשיו.

## הראיות (חיות, 2026-07-01, מחשב Windows)

### מצב שני ה-BE שרצו במקביל

| פורט | PID | תגובת HTTP | סוקטים על הפורט |
| --- | --- | --- | --- |
| **4000** | 67512 | `http=000` (timeout 3ש' וגם 8ש') — **תקוע** | ~60: 13 CLOSE_WAIT · 13 FIN_WAIT_2 · 19–38 ESTABLISHED · 2 LISTENING |
| **4001** | 57388 | `http=200` תוך 13ms — **בריא** | תקין |

### 4000 מת אך הפורט לא השתחרר

```text
$ taskkill //F //PID 67512
ERROR: The process "67512" not found.          # התהליך כבר מת

$ Get-NetTCPConnection -LocalPort 4000 -State Listen
4000 held by PID 67512   alive=False   name=(ריק)   # הסוקט עדיין רשום על PID מת
```

הריגת **4 תהליכי `@zed-industries/codex-acp` יתומים** (PIDs 29584, 14536, 51696, 29960 —
חלקם בני ה-BE המת, חלקם בני probe-ים ידניים) **לא שחררה את 4000**. כלומר אף אחד מהם לא
היה מחזיק ה-handle; המחזיק הוא תהליך אחר בשרשרת ההרצה (bun → dc-launch → pnpm → shell).

## חמשת הממצאים

### 1. אין graceful-shutdown (SIGINT / SIGTERM)

`grep -rn "SIGINT|SIGTERM|beforeExit|process.on(\"exit" packages/backend/src` → **ריק**.
היחיד שקיים ב-`packages/backend/src/server.ts`:
- שורה 19: `process.on("uncaughtException", ...)`
- שורה 36: `process.on("unhandledRejection", ...)`

אין שום handler שסוגר בצורה מסודרת את ה-HTTP server (`serve()` מ-`@hono/node-server`),
את ה-`WebSocketServer` (ws), ואת תהליכי-הבן. הכיבוי מסתמך כולו על ה-OS שיהרוג — וכשה-
event-loop תקוע, גם זה לא עובד.

### 2. event-loop שנתקע ולא מגיב

4000 היה `LISTENING` אך HTTP החזיר `http=000` (timeout מלא). event-loop חסום → אפילו
אירוע סגירת-קונסולה של Windows (שמעובד דרך הלולאה) לא רץ → התהליך שרד סגירת-טרמינל.
**השורש למה הלולאה נחסמה טרם אותר** — מועמדים: הצטברות הסוקטים (ממצא 3+4), פעולה
סינכרונית חוסמת, או deadlock. דורש חקירה נוספת (repro + profiler/`--inspect`).

### 3. הפורט לא משתחרר אחרי מות התהליך (handle-inheritance)

מנגנון סביר: ה-listen socket נוצר כניתן-לירושה, ותהליך ששרד בשרשרת ההרצה מחזיק handle
פתוח אליו → הקרנל לא משחרר את הבינדינג. `spawn-core.ts:107-111` יוצר בנים עם
`stdio: ["pipe","pipe","pipe"]` בלבד — **בלי** `windowsHide`, **בלי** `detached`, בלי
בקרת-inheritance מפורשת. (Node לא מוריש handles שאינם-stdio כברירת-מחדל, ולכן החשוד
הוא boundary אחר בשרשרת — bun/wrapper. לפינפוינט מדויק צריך `handle.exe` של Sysinternals.)
**עובדה מאומתת**: הפורט נשאר תפוס על PID מת גם אחרי הריגת כל בני-ה-codex.

### 4. תהליכי-בן (codex-acp) יתומים לא מתנקים

4 תהליכי codex-acp שרדו את מות ההורים שלהם (ה-BE + probe-ים). אין kill-tree בכיבוי.
זה גם מבזבז זיכרון (נצפו 14 תהליכי node.exe) וגם משאיר CLI-agents "רצים ברקע" ללא בקרה.

### 5. codex boot (~10ש') מתנגש ב-INIT_TIMEOUT (נספח — flaky connect)

probe ישיר (spawn של `npx -y @zed-industries/codex-acp@latest`, מחוץ ל-BE):

```text
+1.5s  -> initialize            (נשלח מוקדם, לפני שה-CLI סיים לעלות)
+25s   (שום תגובה — נהרג ב-timeout)

+10s   -> initialize            (נשלח אחרי המתנה לעליית ה-CLI)
+10.1s STDOUT: {"result":{"protocolVersion":1,"agentCapabilities":{...}}}   ← מיידי!
```

`npx ...@latest` בודק את רישום ה-npm בכל הרצה → ~10ש' עד ש-codex-acp קורא stdin. זה
מתנגש עם `DEFAULT_INIT_TIMEOUT_MS = 10_000` ב-`packages/provider/src/client/client.ts:37`
→ מירוץ שגורם לכשלי-connect codex אקראיים גם על BE בריא. (מעניין: codex מדווח באמת
`loadSession:true`, `promptCapabilities.image:true`, `mcpCapabilities.http:true`, version
`0.16.0` — בעוד ה-`_drive/capabilities` שהופק לו היה all-false. אי-דיוק ב-gating, לא שובר-חיבור.)

## מה שנשלל (חשוב לתיעוד)

- **`_drive/capabilities` אינו הבעיה.** הוא נשלח `feWs.send()` (`ws-agent.ts:87`) — **BE→FE בלבד**,
  על פתיחת WS. אף פעם אינו עובר דרך `conn.wire.write` לילד → **אינו מופיע בהקלטות ה-wire**
  (שמתעדות רק את הצינור מול הילד). לא יכול לזהם את פרוטוקול ACP של codex.
- **הסלייס `warm-reattach-skip-init` אינו הבעיה** — הבאג של initialize-חוזר מחזיר *error*
  (`Already initialized`); כאן codex לא הגיב בכלל (boot-race, ממצא 5), או שה-BE היה תקוע.

## כיווני-תיקון (לשלב-חוסן ייעודי)

1. **graceful shutdown** — handler ל-`SIGINT`/`SIGTERM`: `httpServer.close()` +
   `wss.close()` + kill לכל תהליכי-הבן (kill-tree) + timeout-fallback ל-`process.exit`.
   זה לבדו פותר את "פורט לא משתחרר" ברוב המקרים (כיבוי מסודר לפני מוות).
2. **child lifecycle** — מעקב אחר כל ה-connections ותהליכי-הבן, וניקוי בכיבוי. אפשר
   `detached:false` + kill-tree; לשקול `windowsHide:true`.
3. **listen socket לא-ניתן-לירושה** — לוודא שה-socket של השרת לא עובר ל-spawned children
   (למנוע pinning של הפורט). לאמת מול spawn boundaries (bun/wrapper).
4. **hang root** — repro של ה-event-loop-block (מתי? אחרי כמה reconnects/סוקטים?) עם
   `--inspect`/profiler. יתכן שקשור לצינור ה-WS ↔ child כשמצטברים חיבורים (ר' ממצא 3+4).
5. **codex boot vs init-timeout** — לנעוץ גרסת codex-acp (להימנע מ-`@latest` שמכריח re-resolve
   בכל הרצה) **או** להגדיל/retry את `INIT_TIMEOUT_MS` פר-ספק.

## הקשר ל-roadmap

נספח ל-Track F (WS robustness). כבר קיימים שם: `slice-ws-error-survival` (ניתוק WS לא
מפיל BE) ו-`slice-wire-observability-bridge`. הממצאים כאן משלימים: **כיבוי מסודר +
ניהול-מחזור-חיים של סוקטים/תהליכים** — הפעם החוסן של ה-*כיבוי*, לא של ה-*ריצה*. הכאב
("פורטים לא משתחררים") מוכר וחוזר לפי המשתמשת — כעת מתועד עם שורש וראיות.
