# Session Delete & Rename — חקירת תמיכת הפרוטוקול

> **תאריך**: 2026-06-03
> **הקשר**: בקשת משתמשת להוסיף מחיקה ועריכת-שם של סשנים ב-UI (טופס connect + רשימת
> סשנים ב-sidebar). השאלה: האם הפרוטוקול (ACP) והכלים שלנו (opencode CLI) תומכים בזה?
> **שורה תחתונה**: **מחיקה** — בדרך (RFD ב-Preview), עדיין לא זמינה אצלנו. **עריכת-שם
> ע"י המשתמש** — לא קיימת בפרוטוקול כלל; הסוכן הוא שקובע שמות.

---

## TL;DR — טבלת הכרעה

| פעולה | בספק ACP | ב-SDK שלנו `0.21.1` | ב-opencode `1.15.12` | המלצה |
|--------|----------|----------------------|----------------------|--------|
| **מחיקה** (`session/delete`) | ✅ Preview (מ-2026-06-02) | ❌ לא חשוף | ❌ `-32601` | **לדחות** עד שדרוג SDK+CLI |
| **עריכת-שם ע"י המשתמש** | ❌ לא קיים כלל | ❌ | ❌ `-32601` | **לוותר** / עקיפה ל-opencode HTTP (לא מומלץ) |
| **שם שנקבע ע"י הסוכן** (`SessionInfoUpdate`) | ✅ Preview | ✅ (notification נכנס) | ✅ (כבר עובד) | קיים — קריאה בלבד |

---

## 1. מה בדקנו אמפירית (opencode 1.15.12)

הרצנו handshake גולמי מול `opencode acp` דרך stdio (script: `/tmp/acp-delete-probe.mjs`,
ארעי). יצרנו סשן, ניסינו לסגור/למחוק/לשנות-שם, וספרנו את `session/list` לפני ואחרי.

### תוצאות

```
CREATED: ses_17112b3d0ffe9tVD4aSgEQ9ygP
list BEFORE close — total: 100   contains new? true
session/close result: {}
list AFTER close  — total: 100   contains new? true       ← לא נמחק!
session/delete   : ERROR code=-32601 "Method not found": session/delete
session/remove   : ERROR code=-32601 "Method not found": session/remove
session/update   : ERROR code=-32601 "Method not found": session/update
session/setTitle : ERROR code=-32601 "Method not found": session/setTitle
session/rename   : ERROR code=-32601 "Method not found": session/rename
```

### מסקנות אמפיריות

1. **`session/close` ≠ מחיקה.** מחזיר `{}` (הצלחה) אבל הסשן עדיין מופיע ב-`session/list`.
   `close` משחרר משאבים/תהליך (כמו ש-`session/cancel` היה נקרא), לא מוחק היסטוריה.
2. **opencode 1.15.12 לא חושף שום method למחיקה/שינוי-שם דרך ACP.** כל הניסיונות
   החזירו `-32601 Method not found`.

### מה כן עובר בלחיצת היד (`initialize`)

```jsonc
{
  "agentCapabilities": {
    "loadSession": true,
    "sessionCapabilities": { "close": {}, "fork": {}, "list": {}, "resume": {} }
    //                                              ↑ אין "delete" כאן
  },
  "agentInfo": { "name": "OpenCode", "version": "1.15.12" }
}
```

ה-`sessionCapabilities` של opencode הנוכחי כולל `close/fork/list/resume` — **אין `delete`.**

---

## 2. מצב ה-SDK שלנו (`@agentclientprotocol/sdk@0.21.1`)

מותקן ב-`packages/{core,backend,frontend}/package.json` כ-`^0.21.1`.

הטיפוס `SessionCapabilities` ב-`dist/schema/types.gen.d.ts` כולל:
`additionalDirectories?`, `close?`, `fork?`, `list?`, `resume?` — **אין `delete`.**
ו-`ClientSideConnection` ב-`dist/acp.d.ts` לא חושף `deleteSession` (grep ריק).

> ה-RFD למחיקה עבר ל-Preview רק ב-2026-06-02, אחרי שגרסת ה-SDK שלנו (`0.21.1`) ננעלה.
> שדרוג ה-SDK יחשוף את ה-API — אבל הוא עדיין מסומן unstable/experimental, ועדיין דורש
> שגם ה-CLI (opencode) יתמוך בו בפועל.

---

## 3. מה אומר מפרט ה-ACP

מקור: `github.com/agentclientprotocol/agent-client-protocol` (נבדק ב-HEAD `a7b1e1e`, 2026-06-03).

### 3.1 מחיקה — `session/delete` (RFD ב-Preview)

RFD מלא: [`docs/rfds/session-delete.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/rfds/session-delete.mdx).
Author: [@chazcb](https://github.com/chazcb) · Champion: [@benbrandt](https://github.com/benbrandt).

**Revision history (מתוך ה-RFD):**
- **2026-06-02**: Moved to **Preview**
- 2025-02-03: Fixed capability example
- 2025-01-24: Initial draft

**המבנה לפי ה-RFD:**

- **Capability-gated** — הסוכן מכריז תמיכה ב-initialize:
  ```jsonc
  { "agentCapabilities": { "sessionCapabilities": { "delete": {} } } }
  ```
  > "Agents MUST NOT accept `session/delete` calls unless they advertised
  > `sessionCapabilities.delete` at initialization."

- **בקשה / תשובה:**
  ```jsonc
  // → request
  { "method": "session/delete", "params": { "sessionId": "sess_abc123" } }
  // ← response
  { "result": {} }
  ```

- **סמנטיקה:**
  - *Removes from list* — האפקט העיקרי: הסשן לא מופיע יותר ב-`session/list`.
  - *Implementation-defined storage* — soft delete (הסתרה) או hard delete (מחיקת דאטה) —
    הפרוטוקול לא קובע.
  - *Implementation-defined load* — מה קורה ב-`session/load` על סשן מחוק — תלוי-מימוש.
  - *Idempotent* — מחיקת סשן כבר-מחוק/לא-קיים מצליחה בשקט (לא שגיאה).
  - *Confirmation UX* — עניין של הלקוח, לא הפרוטוקול ("clients can add confirmation
    dialogs, undo... as they see fit").

**היסטוריית ה-PRs בספק:**
- [#1216](https://github.com/agentclientprotocol/agent-client-protocol/pull/1216)
  "feat(unstable): Add unstable session delete support" — **merged 2026-05-16**
  (commit `32833ad`). מאחורי flag unstable.
- [#1222](https://github.com/agentclientprotocol/agent-client-protocol/pull/1222)
  "scaffold session/delete behind `unstable_session_delete`" — **abandoned** (הוחלף ב-1216).
- [#1335](https://github.com/agentclientprotocol/agent-client-protocol/pull/1335)
  "docs(rfd): Move session/delete RFD to Preview" — **merged 2026-06-02** (commit `7053e66`).

ה-schema הלא-יציב כבר מכיל את הטיפוסים:
`schema/schema.unstable.json` — 10 אזכורים של `DeleteSession`/`session/delete`.

### 3.2 עריכת-שם — **אין RFD כזה בכלל**

עברנו על כל ה-RFDs ב-`docs/rfds/`. **אין** RFD ל-rename / set-title / session-update
ע"י הלקוח. אין שום method שבו הלקוח קובע שם לסשן.

מה שכן קיים — וזה **ההפך** — הוא [`session-info-update.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/rfds/session-info-update.mdx)
(Author: [@ignatov](https://github.com/ignatov)). זה notification **מהסוכן ללקוח**:

> "Add a `session_info_update` variant to the existing `SessionUpdate` notification...
> that allows **agents** to update session metadata (particularly title/name)...
> **Agent-initiated, no request/response needed**."

כלומר: הסוכן מייצר/מעדכן את הכותרת (למשל אוטו-כותרת אחרי החילופין הראשון) ושולח אותה
ללקוח. **הלקוח אינו יכול לקבוע שם.** הטיפוס תואם אצלנו ב-SDK: `SessionInfoUpdate`
(`title?: string | null`, "Set to null to clear") — אבל זה נכנס כ-notification, לא יוצא כבקשה.

---

## 4. עקיפה ל-opencode HTTP API (נשקל — לא מומלץ)

ל-opencode יש HTTP server פנימי (לא ACP) עם `DELETE /session/:id` ו-`PATCH` לעדכון
מטא-דאטה. ה-BE שלנו ממילא פותח את תהליך opencode, ויכול תאורטית לדבר עם ה-HTTP server שלו.

**למה לא מומלץ:**
- **שובר CLI-agnosticism** — הפרויקט תוכנן אגנוסטי ל-CLI (opencode/gemini/claude דרך ACP).
  עקיפה כזו עובדת **רק** ל-opencode ויוצרת התנהגות לא-אחידה בין סוכנים.
- **port discovery שביר** — צריך לגלות את הפורט שה-CLI פתח (לא יציב בין גרסאות).
- **כפל ערוצים** — שני פרוטוקולים (ACP + HTTP) לאותו סוכן = מורכבות וחוב.

אם בכל זאת נבחר בזה במודע (כי בפועל opencode הוא ה-CLI היחיד בשימוש), זה ייעשה כהחלטה
מתועדת ב-`docs/decisions/voice-acp.md`, מאחורי בדיקת `cliKind === "opencode"`, עם נפילה
חיננית לשאר ה-CLIs.

---

## 5. המלצה

1. **מחיקה** — לדחות ל-slice עתידי שממתין לתנאי כפול:
   (א) שדרוג `@agentclientprotocol/sdk` לגרסה שחושפת `deleteSession` + `sessionCapabilities.delete`;
   (ב) שדרוג opencode לגרסה שמכריזה על ה-capability ומממשת את ה-method.
   כששני התנאים מתקיימים — ה-slice קטן ונקי, **capability-gated**:
   `initialize` → אם `sessionCapabilities.delete` קיים → הצג כפתור מחיקה →
   `conn.deleteSession({ sessionId })`. CLIs שלא תומכים פשוט לא יראו את הכפתור.

2. **עריכת-שם** — לוותר לעת עתה. לא קיים בפרוטוקול. אם זה הופך לדרישה קשיחה — החלטה
   מודעת לעקוף ל-opencode HTTP API (§4), מתועדת ומגודרת ל-opencode בלבד.

3. **בינתיים** — הכותרות שמוצגות (`SessionInfo.title`) מגיעות מהסוכן ומתעדכנות אוטומטית
   דרך `SessionInfoUpdate`. זו ההתנהגות ה"נכונה" לפי הספק כרגע: הסוכן מנהל שמות, הלקוח מציג.

---

## מקורות

- ACP repo: <https://github.com/agentclientprotocol/agent-client-protocol> (HEAD `a7b1e1e`, 2026-06-03)
- RFD מחיקה: `docs/rfds/session-delete.mdx`
- RFD session-info-update: `docs/rfds/session-info-update.mdx`
- RFD session-close: `docs/rfds/session-close.mdx`
- PR #1216 (unstable delete, merged 2026-05-16): <https://github.com/agentclientprotocol/agent-client-protocol/pull/1216>
- PR #1335 (RFD → Preview, merged 2026-06-02): <https://github.com/agentclientprotocol/agent-client-protocol/pull/1335>
- SDK מותקן: `@agentclientprotocol/sdk@0.21.1` — `dist/schema/types.gen.d.ts`, `dist/acp.d.ts`
- probe אמפירי: `/tmp/acp-delete-probe.mjs` (ארעי), opencode `1.15.12`
