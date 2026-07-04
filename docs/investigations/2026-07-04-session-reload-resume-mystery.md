# חקירה — "אחרי קריסה+ריסטארט, כניסה-מחדש לסשן שהיה באמצע-ריצה ממשיכה לרוץ מעצמה"

**תאריך:** 2026-07-04 · **סוג:** חקירת-runtime (סביבה חיה, claude in-process) · **סטטוס:** ✅ **נפתר**
**נקודת-ייחוס:** `9c9b371` (v0.10.2), עץ-עבודה `dev`
**דווח ע"י המשתמשת:** "התחיל ממש אתמול (03/07)"
**שורש (זוהה ע"י המשתמשת, אומת בנתונים):** התנהגות **upstream של claude-code** — הזרקת
הודעת "background shell ללא completion-record" ב-resume, שמריצה turn חדש מעצמה.

---

## 0. ההכרעה — השורש (upstream claude-code, לא drive-coding)

**המנגנון:**
1. סשן claude-code מכיל **פקודת-shell שרצה ברקע** (Bash background / `run_in_background`).
2. קריסת-BE / ריסטארט-מחשב קוטעים את הסשן → לתת-התהליך אין `completion record`.
3. בכניסה-מחדש (`session/load`/resume), **claude-code מזריק הודעה** (נשמרת ב-session-store
   כ-`type: queue-operation`):
   > *"No completion record was found for this background shell command from the previous
   > session. It may have been stopped (via the UI, Monitor timeout, or agent teardown —
   > these leave no transcript marker), or it may have been running when the previous
   > Claude Code process exited. Check the output file for partial results…"*
4. ההודעה המוזרקת נחשבת **קלט** → claude מגיב עליה → **turn חדש רץ אוטומטית, בלי שהמשתמשת
   שלחה הודעה.** = בדיוק התופעה.

**למה השחזור הנאמן (§3) לא שחזר:** כל מצבי-הקטיעה שבדקתי היו turns של **foreground**
(כלי/טקסט/thinking). הטריגר דורש **shell שרץ ברקע** שגורלו לא-ידוע ב-resume — מצב שלא יצרתי.

**למה "אתמול":** זו תכונת claude-code CLI (מעקב background-shells + הודעת-resume), שהופיעה
עם ה-native-binary / הגרסה שהוטמעה בחלון 02-04/07 — **לא** שינוי drive-coding. לכן התאום ל-in-process.

**ראיה ישירה:** ה-session-store של claude-code (`~/.claude/projects/.../062c8883…jsonl` —
סשן חקירה זה עצמו) מכיל את ההודעה המוזרקת המדויקת; והיא זהה ל-`<task-notification>` שה-CLI
פולט חי כשתת-תהליך רקע נעצר.

**המשמעות ל-drive-coding:** התופעה שקופה ל-BE/FE (dumb-pipe). אם רוצים לשלוט בה — זו
החלטת-מוצר: האם הזרקת-resume אוטומטית של claude-code רצויה, ואם לא — האם לסנן/להתריע עליה
ב-FE. **מתחבר לבאג הפורט התקוע (§7)**: אותם shells-רקע שיורשים socket הם אלה שמייצרים גם את
ה-`http=000` וגם את הודעת-ה-resume.

---

## 1. התופעה (כפי שדווחה)

> אם התהליך הראשי (BE) קרס / **המחשב עבר ריסטארט**, ואני מפעיל מחדש ונכנס לסשן שהיה
> באמצע-ריצה — **בלי ששלחתי הודעה, הוא ממשיך לרוץ ומצטבר תוכן חדש.** לפני זה הייתי
> צריך לשלוח הודעה כדי שימשיך.

מאפיינים מהותיים (אושרו מול המשתמשת):
- **ריסטארט-מחשב מלא** — לא רק ניתוק-FE. כל התהליכים מתים (כולל claude in-process).
- **מצטבר תוכן חדש** — לא רק redraw של replay; טוקנים חדשים.
- **חלון-הזמן:** "אתמול" ≈ 03/07 — תואם למעבר claude/codex ל-**in-process** (merges 02-03/07).

---

## 2. השערות שנשללו בניסוי

| # | השערה | הכרעה | ראיה |
|---|---|---|---|
| H1 | **warm-reattach** (`75fe293`) מחזיר ל-turn חי | ❌ מופרך | ריסטארט-מחשב הורג את התהליך; אין agent חי להתחבר אליו |
| H2 | ה-FE קורא `session/**resume**` (לא `load`) | ❌ מופרך | grep מלא: ה-FE קורא **רק** `loadSession`. אין קורא ל-`session/resume` בכל ה-codebase (ה-handler קיים ב-`in-process-host`, אף אחד לא מפעיל) |
| H3 | ה-BE משחזר/מחדש סוכנים ב-boot | ❌ מופרך | ה-registry בזיכרון בלבד; רק `projects-registry` נשמר לדיסק. אין agent-persistence |
| H4 | `_meta` (`CLAUDE_SESSION_META`) מפעיל resume | ❌ מופרך | תוכנו = `{claudeCode:{options:{thinking:{type:"adaptive",display:"summarized"}}}}` בלבד |
| H5 | `session/attached` endpoint מפעיל resume | ❌ מופרך | רק מעדכן registry ל-`ready` + `projectsRegistry`. אפס טריגר |
| H6 | warm `switchSession` (≠ cold `loadSession`) מחדש | ❌ מופרך | כניסה דרך ה-**FE האמיתי** (Playwright) לסשן קטוע → replay בלבד, 45ש' שקט |

## 3. הבדיקה המרכזית — `session/load` לא מחדש turn, בשום מצב-קטיעה

שוחזר גם ב-**probe headless** (ACP-over-WS ידני) וגם ב-**FE אמיתי** (Playwright headed).
נקודת-הקטיעה: הרצת claude in-process על port ייעודי, `taskkill /T /F` באמצע, ואז BE טרי + `session/load`.

| מצב-הקטיעה (מה נשמר לדיסק לפני הקריסה) | תוצאת `session/load` |
|---|---|
| **אמצע ריצת-כלי** — `tool_call` בלי תוצאה (Bash sleep רץ) | **replay בלבד** → 45ש' שקט |
| **כלי-גמור + טקסט חלקי** — `tool_call`+`tool_result`, assistant חלקי (לא persisted) | **replay בלבד** → 41ש' שקט |
| **אמצע thinking** — הודעת-משתמש בלי שום תשובה | **replay בלבד** → 45ש' שקט |

**מסקנת-הבדיקה:** בסטאק הזה, `session/load` על סשן claude קטוע = **replay של ההיסטוריה בלבד**,
אפס ייצור חדש — **ללא תלות במצב-הקטיעה**. זו תוצאה שלילית עקבית וחזקה.

## 4. נתיב הכניסה האמיתי של ה-FE (מופה)

לחיצה על פרויקט-אחרון → `connectAgent`→`attach` (**`session/new`** על agent חי חדש) → מוצגת
**רשימת-סשנים** → לחיצה על סשן → `switchSession` (**warm `session/load`** על ה-`#client` החי).
ה-`ActiveProcessesPanel` (reconnect ל-agent חי) ריק אחרי ריסטארט (registry בזיכרון).
→ גם הנתיב הזה, לסשן קטוע, **לא חידש** (H6).

## 5. מה שנותר פתוח (לא ניתן לשלול מהצד שלנו)

השחזור הנאמן (probe + FE אמיתי) **לא משחזר** את התופעה. הפער תלוי בגורם ספציפי לסביבת-המשתמשת:

1. **ה-build הרץ אצל המשתמשת שונה מ-HEAD** — נבדק מול `9c9b371`; המופע שלה אולי אחר. (**לבדוק: `git SHA` בהגדרות ה-FE**.)
2. **הגדרת claude-code** ב-`~/.claude` (auto-continue?).
3. **מצב-על-דיסק שקריסה אמיתית / ריסטארט-מחשב** מותירים — לעומת `taskkill` מבוקר.
4. נתיב-כניסה מדויק אצל המשתמשת שלא פגענו בו.

## 6. הצעד המכריע הבא

**רקורד-wire אמיתי מהמופע של המשתמשת** (הסביבה = בדיוק המשתנה שמשחזר):
```bash
# הרצה רגילה + WIRE_RECORD=1 → שחזור → על הקובץ ב-~/.config/drive-coding/wire-recordings/:
jq -c '{dir, m:(.raw|fromjson|.method), su:(.raw|fromjson|.params.update.sessionUpdate)}' <file>.jsonl | tail -40
```
- `agent_message_chunk` **בלי** `session/prompt`/`resume` יוצא לפניו → claude-code מחדש מעצמו (upstream; מתחבר ל"אתמול"=in-process).
- `session/prompt` או `session/resume` **יוצא** לפני → טריגר אצלנו; נאתר את הקורא.

---

## 7. ממצא-צד שאושר (באג אמיתי — מתחבר ל-roadmap)

תוך כדי הבדיקה: הריגת ה-BE **באמצע ריצת-כלי** השאירה את הפורט תפוס — **תת-תהליך ה-Bash ירש
את ה-listen socket**. `tasklist` הראה שה-pid **לא קיים** כתהליך, אך `curl` החזיר **`http=000`**
(מאזין אך תקוע). זה בדיוק הבאג הפתוח ב-roadmap (Track F: "חוסן כיבוי-BE + פורטים שלא
משתחררים / handle-inheritance / http=000", `docs/investigations/2026-07-01-be-shutdown-socket-health.md`).
**מחזק את ההשערה שמה שהמשתמשת חווה כ"התהליך הראשי קרס" עשוי להיות ה-hang/zombie הזה.**

## 8. אנטי-דפוס מתודי (לתיעוד עצמי)

הבדיקה הראשונה נעשתה עם **client מינימלי משלי, לא עם ה-FE** — ולכן לא יכלה לתפוס טריגר
FE-side. המשתמשת הצביעה על כך; רק אז עברנו ל-FE אמיתי (Playwright). **לקח: כששואלים "למה
ה-FE מתנהג כך", לשחזר עם ה-FE — לא עם פרוקסי שמשכפל את מה ש*הנחנו* שה-FE עושה.**
