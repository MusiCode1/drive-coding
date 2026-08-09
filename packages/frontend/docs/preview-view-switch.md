# Preview runbook — slice view-switch

FE שרץ בשני מצבים — `local` (הנתיב הקיים, ברירת-מחדל) ו-`remote`
(`RemoteSessionView` → BE `SessionHost` דרך HTTP+SSE) — נבנה **פעם אחת**
(production build), ונבדק דרך **שני URL-ים** מאותו build.

> מקור מלא של פקודות ה-build/serve/tunnel:
> `/home/user/Projects/docs-repo/drive-coding/running-locally.md` §53-70.

## הפעלה

⚠️ **ה-BE על port 4000 הוא ההורה של סוכני-ריצה — לעולם לא להרוג/להפעיל-מחדש אותו.**
ה-preview הזה רץ על **`PORT=4100`**.

```bash
# 1. build production — לא HMR
bun run --filter @drive-coding/frontend build

# 2. serve single-origin: FE_STATIC_DIR מגיש את ה-build הבנוי מעל ה-BE
cd packages/backend
FE_STATIC_DIR="<abs>/packages/frontend/build" \
  PORT=4100 onecli run --agent voice-acp -- bun src/server.ts   # onecli חובה (TTS proxy)

# 3. מנהרת HTTPS — pico + tuns (המשתמשת חייבת URL של https, לא http חיצוני)
ssh -i ~/.ssh/pico -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 \
  -R <subdomain>:80:localhost:4100 tuns.sh http
# מחזיר: HTTPS: https://<subdomain>.<region>.tuns.sh
```

> ⚠️ **נצפה בפועל בריצה הזו**: `onecli` לא היה מותקן בסביבת ה-executor (`onecli not found`).
> לפי `docs-repo/drive-coding/running-locally.md` §חסמים — onecli נחוץ **רק** ל-proxy של
> TTS (ElevenLabs/Google); בלעדיו `/proxy/*` מחזיר 401/400 אבל ACP/WS/session תקינים
> לגמרי. שרתתי עם `bun src/server.ts` ישיר (בלי onecli) — כל הצ'ק-ליסט מלבד TTS (#7)
> נבדק במלואו. **TTS לא נבדק בריצה הזו** — דורש onecli זמין.

## שני ה-URL-ים (מאותו build)

| מצב | URL |
|-----|-----|
| local (ברירת-מחדל) | `<base>/` |
| remote | `<base>/?sessionTransport=remote` |

`?sessionTransport=` נשמר ל-`sessionStorage` בחיבור הראשון (`connect-agent.ts`) —
שורד `goto("/chat")` ו-refresh. **חובה ללחוץ "נתק" לפני חזרה ל-`/`** — ניווט לבד לא
מנתק, וניסיון-חיבור חוזר יידחה עם `cannot attach in status connected`.

## צ'ק-ליסט

✅ = נבדק אמפירית ע"י אליעזר (playwright automation דרך ה-tunnel, claude CLI אמיתי,
cwd=`/home/user/Projects/drive-coding/dev`) — לא תחליף לעיניים אנושיות; ☐ = טרם נבדק
(דורש עין אנושית — tool call/permission-dialog/cancel/TTS/מעבר-מצבים לא אוטומטו).

| # | מה בודקים | local | remote |
|---|-----------|-------|--------|
| 1 | חיבור → ניווט ל-`/chat` | ✅ | ✅ |
| 2 | פרומפט → תשובה זורמת | ✅ ("pong" חזר בזמן-אמת מ-claude אמיתי) | ✅ (זהה) |
| 3 | בועת-משתמש **פעם אחת** | ✅ | ✅ (מסונתזת בשרת — אומת ב-screenshot: מופיעה פעם אחת) |
| 4 | tool call מוצג ומתעדכן | ☐ | ☐ |
| 5 | בקשת-הרשאה → דיאלוג → אישור → ממשיך | ☐ | ☐ |
| 6 | **המחוון נשאר עד התשובה**; ביטול-תור עובד; הדיאלוג נסגר | ☐ | ☐ |
| 7 | TTS פעם אחת, בלי כפילות | ☐ (onecli לא זמין בריצה זו — ר' למעלה) | ☐ (onecli לא זמין) |
| 8 | **מעבר local↔remote באותו טאב** — חובה ללחוץ "נתק" קודם | ☐ | ☐ |
| 9 | **כשל מוצג** — פרומפט שנכשל מציג שגיאה (לא שקט) | ☐ | ☐ |

> screenshots: `/tmp/view-switch-preview/{local,remote}-chat.png` (בסביבת ה-executor,
> לא ב-repo — לצירוף ל-דוח בלבד).

## known-gaps ב-remote (מחוץ לצ'ק-ליסט — מתועדים, לא נסגרים ב-S6)

- **רשימת-סשנים ריקה** — `newSession`/`loadSession`/`listSessions`/`deleteSession`
  דוחים; ה-BE מנהל sessions, ה-FE לא.
- **אין תמונות מודבקות** — `RemoteSessionView.prompt` תומך בטקסט בלבד
  (`PromptBlocks` זורק).
- **אין נגינה-חוזרת של הקלטת-המשתמש** — Speaker water-mark (getters קיימים,
  אך אינם על ה-port).
- **refresh מחזיר ל-`/`** — `attachRemote` תמיד יוצר agent חדש; `chat/+page.svelte`
  (guard על `status==="idle"`) מקפיץ ל-`/`.
- **toggle של config לא מהדהד** — `host.setConfigOption` לא פולט patch; `modes`/
  `models` מתעדכנים רק כשמגיע `*_update` אמיתי מה-wire (לא מתשובת ה-RPC, כמו local).
- **`<select>` מודל מבוסס-`models` לא מוצג** — `SessionState` ללא שדה `models`
  (רק `configOptions`-based select עובד).
- **`systemPrompt` אינו נתמך ב-remote** — `attachRemote` אין לו פרמטר כזה.
- **`leaveRunning` לא נתמך ב-remote** — מתנהג כ-detach מלא ("השארת סוכן רץ" אינה
  אפשרית מהנתיב המרוחק — אין `attachToLiveAgent` חוזר ב-remote).
- **`bypassActive` auto-allow לא פעיל ב-remote** — ה-pending מגיע מהשרת ואינו עובר
  ב-`#onRequestPermission` (שם ההיתר נבדק ב-local).
- **ערוץ-אזהרות ≠ `session.error`** — אזהרה חולפת (attachments לא נתמכות,
  `reply failed`) לא נמחקת עד תור חדש שמנקה `lastTurnError`; אם לא מגיע תור חדש,
  היא נשארת על המסך עד סוף הסשן.

## שלושה ערוצי-כשל ב-remote

| # | ערוץ | איך מגיע | מי מדווח |
|---|------|----------|----------|
| 1 | דחיית-שיגור (HTTP 400/404/500) | rejection מ-`view.prompt()` | `catch` ב-`sendPrompt` |
| 2 | כשל-ביצוע-תור (ה-CLI זרק) | patch `lastTurnError` | `#syncFromViewState` → `session.error` |
| 3 | 🔴 **מוות ה-SSE (known-gap)** | `SSEReader` מנסה reconnect **לנצח**, בלי שינוי סטטוס | **אף אחד** — BE שמת באמצע תור נותן "ממתין" קפוא בלי שגיאה. סגירתו דורשת סיגנל reconnect מה-`SSEReader` אל ה-view ואל ה-VM (שינוי ב-S5, קפוא) — לא ב-scope של S6. |

## 🔴 באג שנתפס ונתקן ב-C4 (לא נראה ב-C1/C2, רק בדפדפן אמיתי)

`createRemoteView()` (C2) חישב `baseUrl ?? beUrl("")`. `beUrl("")` מחזיר
`location.origin` **עם לוכסן-סוגר** (path ריק מנורמל ל-`"/"`), ו-`RemoteSessionView`
(`#eventsUrl`/`#rpcUrl`/`#replyUrl`) תמיד מוסיף `/api/agents/...` — יחד: `//api/agents/...`
(לוכסן כפול). ה-C1/C2 test suites לא תפסו את זה כי הם תמיד מזריקים `baseUrl` מפורש
בלי לוכסן-סוגר (`"http://be.local"`), אף פעם לא דרך `beUrl("")` האמיתי עם `location`
אמיתי. בפועל בדפדפן: `attachRemote` נכשל-מהיר על כל ניסיון (fast-fail / reconnect-loop
תלוי-תזמון), בזמן ש-`curl` ישיר לאותו endpoint עבד מושלם (ה-baseUrl שם לא הכיל
לוכסן-סוגר). תוקן ב-`create-session-view.ts`: `.replace(/\/$/, "")` על ה-baseUrl
לפני השרשור, + 2 טסטי-רגרסיה חדשים (`create-session-view.test.ts`).

## Q5 — ברירת-מחדל local/remote

`local` הוא ברירת-המחדל ב-S6. ההכרעה הסופית (האם להפוך את remote לברירת-מחדל)
פתוחה — המשתמשת מכריעה אחרי שראתה את שני המצבים כאן; ההכרעה נרשמת ב-
`docs-repo/drive-coding/decisions/voice-acp.md` ע"י מרדכי.
