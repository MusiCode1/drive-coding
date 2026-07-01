# חקירה — צרכני "ברז-2" (turn-end flush): חיתוך-מילים + סדר-השמעה

> **תאריך:** 2026-06-28 (עודכן 2026-06-29) · **סטטוס:** פתוח — דורש נתונים חיים · **בעלים:** מרדכי
> **קודם היה:** `slice-A1-turnstate-stability.md` (בוטל — אבחון חלקי, ר' §הפרכה)
> **שייך ל:** `docs/plans/playback-run-control-roadmap.md` (הבאג בודד מהשרשרת)
>
> **שתי תופעות, שורש אחד:** החקירה כיסתה במקור **חיתוך-מילים** (תסמין-טקסט). ב-2026-06-29
> calev-heavy על A2 חשף **BUG-1 — סדר-השמעה** (תסמין-סדר). שניהם נובעים מ**ברז-2** (`#handleStatusTransition`
> justFinished) הפולט את `state.buffer` על מעבר turnState→idle, **בלי סיגנל-אמין של סוף-הודעה**.

## למה זה brief‑חקירה ולא brief‑ביצוע

האבחון הראשון (A1) טען שהשורש הוא `justFinished` flush מוקדם בגלל ה‑opencode‑tail. **המשתמשת
הפריכה אותו בשתי נקודות שמחייבות חקירה מול נתונים אמיתיים לפני שכותבים תיקון:**

1. **החיתוך קורה גם ב‑claude‑code**, ולא רק ב‑opencode. ל‑claude אין tail (RESP מגיע בסוף),
   כך ש‑`justFinished` נורה פעם אחת בסוף האמיתי. אם החיתוך קורה שם בכל זאת → ה‑flush‑המוקדם
   הוא **לא** השורש, או לא היחיד.
2. **אין סיגנל אמין של "סוף הודעה".** התיקון המוצע (`onTurnSettled` = debounce של שקט) הוא
   היוריסטיקה: אם הסוכן שוהה באמצע (חשיבה ארוכה / כלי איטי / רשת) → השקט יורה settle *באמצע*
   → flush של fragment → בדיוק החיתוך. מחליף בעיית‑timing אחת באחרת.

**המסקנה:** צריך לראות *איפה בדיוק* נחתך הטקסט, מול שני הספקים, ולהבין את המנגנון לפני תיקון.

## רקע — הצנרת (מה כבר ידוע, מאומת מקריאת‑קוד)

הטקסט מגיע ל‑TTS משני "ברזים" ב‑`packages/frontend/src/lib/view-models/speaker.svelte.ts`:

- **ברז 1 — הזרם הרגיל** `#processBubbles` (≈244‑287): מצרף chunks ל‑`state.buffer`, מריץ
  `splitIntoSentences`, פולט **רק משפטים שלמים**; השארית נשמרת ב‑`state.buffer`.
- **ברז 2 — flush השארית** `#handleStatusTransition` justFinished (≈303‑318): פולט את
  `state.buffer` **כמו שהוא, בלי `splitIntoSentences` ובלי forceSplit**, על מעבר turnState→idle.

הסגמנטציה עצמה: `packages/core/src/voice/sentence-boundary.ts` — `splitIntoSentences`
(Intl.Segmenter granularity:"sentence") + `forceSplitWords` (granularity:"word") למשפטים >200 תווים.

## תופעה שנייה מאותו שורש — סדר-השמעה (BUG-1, נתפס ב-calev-heavy A2, 2026-06-29)

ברז-2 פולט את שארית ה-buffer ב-`#enqueue` → `#orderAlloc.next(bid)`. לבועה שכבר פלטה משפט
תוך-כדי-stream (תפסה `seq`), השארית מקבלת orderKey **(אותו seq, segmentIndex הבא)** — שממוין
**לפני** בועה מאוחרת יותר. אם הבועה המאוחרת (הודעה) כבר **נוגנה** עד רגע ה-flush, הזנב (מחשבה)
נכנס לפלייליסט **מאחורי ה-cursor החי** → לא מנוגן בזמן-אמת.

- **תרחיש:** זנב-מחשבה בלי טרמינטור נשאר ב-buffer → הודעה זורמת ומוקראת → flush של turn-end
  פולט את זנב-המחשבה עם orderKey נמוך מההודעה שכבר נוגנה. צר (דורש שההשמעה הדביקה את ההודעה
  עד ה-flush), אבל אמיתי ומשוחזר מול הקוד (`reports/drive-coding/A2-calev.md`).
- **הכרעה (2026-06-29, מאושרת):** **לא מתקנים בפלייליסט.** הסגמנט נשאר sorted+`ready`
  ונָוויגבילי (A4 יקריא אותו ב-prev/jump — יש לו ערך-ניווט; **לא** `skipped`). השורש = turn-end,
  נחקר כאן. ר' `decisions/voice-acp.md` 2026-06-29. **אין שינוי-קוד ב-A2.**
- **קשר לחיתוך-מילים:** אותו ברז, אותו חוסר-סיגנל. אם הפתרון יהיה **סיגנל-ACP אמיתי לסוף-message**
  (H3/H4 למטה / `stopReason`) — הוא פותר את **שתי** התופעות יחד: flush מדויק לא יחתוך מילה
  *וגם* לא יאחר orderKey. זו הסיבה לאחד אותן לחקירה אחת.
- **לאסוף ב-WIRE_RECORD (בנוסף):** האם יש גבול-message/`stopReason` ב-wire שאפשר לסמוך עליו
  במקום ה-`justFinished` timing; ומה ה-timing בין flush להשמעה (מתי ההשמעה מדביקה).

## השערות פתוחות — לבדוק לפי סדר עדיפות

| # | השערה | למה סבירה | איך לבדוק |
|---|---|---|---|
| **H1** ⭐ | **תווי כיווניות/ניקוד (RLM `U+200F`, RTL marks, ניקוד) משבשים את `Intl.Segmenter`** — חיתוך משפט/מילה במקום לא צפוי. | מסבירה **שני** הספקים (לא תלוי tail). מתחבר לבאג RLM הידוע ב‑roadmap ("RLM/תווים משבשי‑markdown"). המשתמשת מזריקה RLM, והמודל פולט תווי‑כיווניות בעברית. | חפש ב‑cache TTS מחרוזות עם `U+200F`/`U+200E`/ניקוד ליד נקודת‑החיתוך. הרץ `splitIntoSentences` על טקסט עברי עם RLM מוטמע (unit). |
| **H2** | `forceSplitWords` (>200 תווים) חותך לא בגבול מילה בעברית | אם ICU word‑segmentation בעברית לא מושלם, או מתערבב עם H1 | unit: משפט עברי >200 תווים → בדוק את נקודות החיתוך |
| **H3** | ברז‑2 פולט `state.buffer` **בלי `splitIntoSentences`** → אם השארית >200 או חצי‑מילה (זרם נקטע) → job פגום | מקור ודאי‑בקוד; ב‑claude קורה בסוף האמיתי | בדוק ב‑cache אם הטקסטים החתוכים הם תמיד **אחרונים בתור** |
| **H4** | `justFinished` מוקדם (opencode‑tail) — האבחון המקורי | עדיין תקף ל‑opencode (חלקי) | WIRE_RECORD על opencode: ספור כמה פעמים turnState→idle בתור |
| **H5** | chunk boundary של ACP נופל באמצע מילה ו‑split רץ לפני האיחוד | תיאורטי — אבל `remaining` אמור לכסות | WIRE_RECORD: בדוק chunks גולמיים מול הטקסט שנשלח ל‑TTS |

> **הניחוש המוביל: H1.** הוא היחיד שמסביר את שני הספקים בלי timing, והוא מתחבר לבאג קיים.

## נתונים לאסוף (חי, על cli‑agents)

הסביבה: container **125** (`llm-clis`) על proxmox `192.168.x.x`, משתמש `user`,
BE רץ ב‑`/home/user/projects/drive-coding/dev` (`bun packages/backend/src/server.ts`).

```bash
ssh proxmox-root -o HostName=192.168.x.x
pct exec 125 -- bash -lc '...'
```

1. **cache TTS** — מה *בדיוק* נשלח ל‑TTS (הטקסט אחרי הסגמנטציה):
   - מצא את ה‑cache: `readlink /proc/<BE-pid>/cwd` → `<cwd>/packages/backend/data/cache`.
     (היה ריק ב‑28/06 — TTL/DATA_DIR? ודא שמופעל ושהריצה טרייה.)
   - חפש קבצים סמוכים שנחתכים באמצע מילה. בדוק את ה‑bytes ל‑`U+200F` (H1).
2. **WIRE_RECORD** — ה‑chunks הגולמיים מ‑ACP + timing:
   ```bash
   cd packages/backend && WIRE_RECORD=1 PORT=4000 bun src/server.ts
   # connect + prompt שמייצר פסקה ארוכה בעברית, ואז:
   jq -r 'select(.raw|fromjson|.params.update.sessionUpdate=="agent_message_chunk")
          | (.raw|fromjson|.params.update.content.text)' data/wire-recordings/*.jsonl
   ```
   - בדוק: האם chunk גולמי מכיל RLM/ניקוד? איפה גבולות ה‑chunks מול החיתוך?
   - ספור turnState→idle בתור (H4, opencode בלבד).
3. **הרצה מבוקרת** מול **שני** הספקים (claude + opencode), אותו prompt עברי ארוך,
   האזנה + לוג — לאשר/לפסול שהחיתוך תלוי‑ספק.

## כיוון פתרון אפשרי (לא נעול — תלוי בממצאים)

- **אם H1:** נרמול תווי‑כיווניות/ניקוד **לפני** `splitIntoSentences` (לא לפני הצגה — רק לפני
  הסגמנטציה ל‑TTS). מתאם עם slice ה‑RLM הקיים (ר' roadmap Track C "RLM/תווים משבשי‑markdown").
- **אם H3/H4:** להישען על **סיגנל ACP אמיתי** לסיום‑message במקום timing — לבדוק אם
  `agent_message_chunk` נושא גבול‑message, או `stopReason` בתגובת `session/prompt`, או
  message‑boundary ב‑ACP. flush רק על סיגנל ודאי, לא על debounce.
- **בכל מקרה:** ברז‑2 צריך להריץ `splitIntoSentences`/forceSplit על השארית לפני enqueue
  (לא לפלוט גולמי) — תיקון‑הגנה זול שלא תלוי באבחון.

## קוד רלוונטי

| מה | path |
|---|---|
| שני הברזים | `packages/frontend/src/lib/view-models/speaker.svelte.ts` (`#processBubbles` 244‑287, `#handleStatusTransition` 289‑320, `#enqueue` 322‑343) |
| הסגמנטציה | `packages/core/src/voice/sentence-boundary.ts` (`splitIntoSentences`, `forceSplitWords`) |
| turnState/RESP | `packages/frontend/src/lib/view-models/agent-session.svelte.ts` (`sendPrompt` 583‑596, `#scheduleIdle` 122‑144, `#onSessionUpdate` 1252‑1287) |
| RLM/markdown (קשור H1) | roadmap Track C — "RLM/תווים משבשי‑markdown" (slice בעבודה) |

## הגדרת‑הצלחה לחקירה

- נקבע איזו השערה (H1‑H5) היא השורש, מגובה בדוגמאות מ‑cache/wire של **שני** הספקים.
- מוכרע אם הפתרון = נרמול‑תווים, סיגנל‑ACP, או הגנת‑split בברז‑2.
- אז — ורק אז — נכתב brief‑ביצוע.
