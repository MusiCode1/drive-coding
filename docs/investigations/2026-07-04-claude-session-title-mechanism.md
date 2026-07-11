# חקירה — מנגנון כותרת-הסשן של claude (`generate_session_title`)

> **תאריך**: 2026-07-04 · **סטטוס**: פוענח מלא (עם capture כראיה) · **נגזר**: `slice-claude-session-title`

## התופעה (‏מהמשתמשת)

בחזרה-לסשן-חי מהרקע (`attachToLiveAgent`) אין כותרת. בחקירה התרחב: ה-title בכלל
לא-אמין ב-drive-coding — לעומת claude ב-VSCode extension, ש**כן** מייצר כותרת
("ניסיון תקשורת") אחרי 2-3 הודעות.

## הפענוח — ה-title הוא `control_request`, לא ACP

ה-title **אינו** חלק מ-ACP (`session/update`), אינו ב-transcript, ואינו ב-`session/load`.
הוא **control-protocol של Claude Code SDK** — ערוץ צדדי ל-messages. הוכח ע"י tap על
ה-stdio של claude (‏ה-`claude-protocol-wrapper`, ר' `packages/provider/tools/`).

**Capture-ראיה**: `D:\UserProjects\AI\ClaudeCodeACP\output\captures\2026-07-04T15-54-17-253Z-15652\`

### הבקשה (‏client→claude, `stdin.lines.ndjson`)
```json
{"type":"control_request","request_id":"gaw1v2d5vru",
 "request":{"subtype":"generate_session_title","description":"ניסוי תקשורת.","persist":false}}
```
### התשובה (‏claude→client, `stdout.lines.ndjson`)
```json
{"type":"control_response","response":{"subtype":"success","request_id":"gaw1v2d5vru",
 "response":{"title":"ניסיון תקשורת"}}}
```
### הגדרת ה-protocol (`ClaudeCodeACP/src/protocol/messages.ts:116`)
```ts
interface GenerateSessionTitleRequest { subtype: "generate_session_title"; description: string; persist: boolean; }
```

## חמש עובדות-מפתח (‏כולן מאומתות מה-capture)

1. **יוזם = ה-client, לא claude.** ה-client שולח control_request; claude מגיב. claude **לא** דוחף title מעצמו.
2. **`description` = ההודעה הראשונה של המשתמש, מילה-במילה.** ה-user prompt הראשון היה `[{"type":"text","text":"ניסוי תקשורת."}]`, וה-description היה `"ניסוי תקשורת."` — זהה. claude רק **מלטש** אותו ל-title.
3. **תזמון**: `user → user → user → generate_session_title` — ה-client שלח אחרי כמה turns.
4. **שמירה = `persist` (flag), אין פקודה נפרדת.** ה-union (`messages.ts:169`) מכיל רק `GenerateSessionTitleRequest` — **אין** `set_title`. `persist:false` → claude **לא** שומר (הטרנסקריפט של הסשן `3c281167` ריק מ-title); ה-client שומר בעצמו. `persist:true` → claude שומר (ככל הנראה ב-session-metadata שממנו `session/list` קורא).
5. **למה drive-coding בלי title**: ה-adapter (`claude-agent-acp`) **אף פעם לא שולח** את ה-`generate_session_title` control_request → claude אף פעם לא מייצר → ה-FE נופל ל-`session/list` ה-flaky (ומ-`attach` אפילו זה נמחק, `agent-session:921`).

## ההשלכה — שתי גישות (‏persist=true עדיף)

| גישה | שולחים | מי שומר | ה-FE מקבל |
|---|---|---|---|
| **persist=true** | `{description:<הודעה-ראשונה>, persist:true}` | claude → session-metadata | `session/list` יחזיר title (‏first-class: שורד attach/reload) |
| persist=false | `{…, persist:false}` | drive-coding (‏BE/FE state) | חיווט ישיר מה-control_response |

**persist=true** הופך את ה-title ל-first-class ומייתר את ה-hack הנוכחי + סוגר את הבאג של attach.

## שאלות-design פתוחות (‏ל-slice)

1. **איך שולחים control_request דרך ה-stack** — `claude-agent-acp`→`@anthropic-ai/claude-agent-sdk`. האם ה-SDK חושף control-channel API (‏`query`/control), או שצריך לגעת ב-adapter? (‏ה-grep על `sdk.d.ts` לא מצא `generate_session_title` — צריך לאמת אם ה-SDK מעביר control-requests שרירותיים.)
2. **מתי לשלוח** — אחרי כמה turns? (‏VSCode: אחרי ~3). trigger = turn-count / idle.
3. **persist=true — איפה בדיוק נשמר** ואם `session/list` אכן מחזיר אותו (‏לאמת עם capture נוסף `persist:true`).
4. **description** — הודעה ראשונה בלבד, או תמצית של כמה?

## כלי-העזר

ה-tap שאיתו נלכד ה-frame: `packages/provider/tools/claude-protocol-wrapper.cjs`
(‏passthrough-tap, מבוסס על ClaudeCodeACP; ר' README שם).
