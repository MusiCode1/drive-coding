# Roadmap — בקרת השמעה + בקרת ריצה (playback & run control)

> **תאריך:** 2026-06-28 · **סטטוס:** מאושר (תכנון נעול) · **planner:** מרדכי
> **base:** `dev` @ `3a23195`
> **אופן ביצוע:** שרשרת אחת, **merge יחיד בסוף** (החלטת המשתמשת). הרצה רצופה ללא אישורי‑ביניים.
> **אימות:** אביגיל הורצה על שני ה-roots לפני dispatch (2026-06-28): **A2 ✅ READY** (r1, 2×🟢 הוטמעו) ·
> **A5 ✅ READY** (r2, 3×🟡 תוקנו). A3/A4/B1 — אביגיל JIT אחרי שה-base שלהם ינחת. כלב כרגיל בסוף.

## חזון

ההשמעה הקולית הופכת מ"תור שמתרוקן" ל**פלייליסט אמיתי** מעל כל היסטוריית השיחה: סדר נכון
מובטח, ניווט קדימה/אחורה בין משפטים, השהיה/המשך/עצירה — בהפרדה מלאה מ**בקרת הריצה**
של הסוכן (עצירת חשיבה/פעולה). כל זה מעל תיקון שורש אחד: `turnState` כסמן סוף‑תור יציב.

## הכרעות (נעולות עם המשתמשת, 2026-06-28)

| # | נושא | הכרעה |
|---|---|---|
| 1 | יחידת ניווט prev/next | **בין משפטים** (סגמנטים) |
| 2 | טווח הפלייליסט | **כל היסטוריית השיחה**. הקלטות‑משתמש = hook בלבד, **לא בסקופ** |
| 3 | "עצור חשיבה" / "עצור פעולה" | פעולת `session/cancel` אחת (טקסט/אייקון לפי `turnState`), **+ עוצרת גם השמעה (stop)** |
| 4 | בקרת השמעה עצמאית | **pause** (זמני, resume) ו‑**stop** (סופי) — נפרדים זה מזה ומ‑cancel‑run |
| 5 | פיצול worktrees | תשתית ב‑worktree ראשי; UI ב‑worktree נפרד שמבוסס עליו (merge תשתית בלי UI) |
| 6 | timeout בתור | בעיקרון **מחכים** (הסדר קדוש). safety‑net: סגמנט שלא התחיל לזרום תוך ~20ש' → skip |
| 7 | חיתוך‑מילים | ⚠️ **בודד מהשרשרת** — האבחון הראשון (A1) הופרך (קורה גם ב‑claude; אין סיגנל סוף‑הודעה אמין). עבר לחקירה: `docs/investigations/2026-06-28-sentence-cutting-mid-word.md` |

## אבחון השורש (מאומת מהקוד, 2026-06-28)

שני תסמינים בשרשרת הנקייה. (התסמין השלישי — **חיתוך‑מילים — בודד לחקירה**, ר' למטה.)

- **חיתוך‑מילים (בודד):** האבחון הראשון (flush מוקדם בגלל opencode‑tail) **הופרך** —
  הבאג קורה גם ב‑claude (שאין לו tail), והתיקון המוצע (`onTurnSettled`=debounce) נשען על
  "סוף‑הודעה" שאין לו סיגנל אמין. → חקירה נפרדת מול cache/wire של שני הספקים:
  `docs/investigations/2026-06-28-sentence-cutting-mid-word.md`. הניחוש המוביל: תווי‑כיווניות
  (RLM)/ניקוד משבשים את `Intl.Segmenter`. **לא חוסם את הפלייליסט.**
- **בועה תקועה:** `turnState` חוזר ל‑idle רק כש‑RESP חוזר. אין watchdog — אם RESP אובד
  (detach/reconnect/`request_permission`), `#turnEnded` נשאר false, `#scheduleIdle` לא רץ,
  הבועה נתקעת על המצב האחרון.
- **סדר השמעה הפוך:** `Player.addSegment` נקרא רק **אחרי** ה‑fetch (`Speaker.#fetchJob:418`).
  תחת LOOKAHEAD=2, אם seq1 מסיים fetch ראשון, ה‑Player מנגן אותו לפני ש‑seq0 הגיע לתור.
  בולט ב‑Gemini (`PcmAudioStream.prepareSegment` חוזר מיד) ונדיר ב‑ElevenLabs
  (`AudioStream` ממתין ל‑`sourceopen`). באג מבני, לא ספק‑ספציפי.

## עיקרון מאחד — reserve‑on‑enqueue

`Player` → `AudioPlaylist`: סגמנט נכנס לתור **בזמן ה‑enqueue** (עם `orderKey` דטרמיניסטי),
במצב `reserved`. ה‑cursor נע על פלייליסט מלא ומסודר מראש. זה פותר בבת אחת: סדר נכון
(ה‑cursor ממתין לסגמנט המוקדם), השמעה מוקדמת (streaming מתחיל → ready), prev/next/resume
(cursor נשמר, סגמנטים לא נמחקים), ו‑skip (timeout פר‑סגמנט).

```
AudioPlaylist (engine)
  items: [{ orderKey, segmentId, state: reserved|loading|ready|playing|done|error|skipped }]
  cursor: index ; transport: "playing" | "paused" | "stopped"
  reserve(segmentId, orderKey)   ← Speaker.#enqueue (מיד)
  markReady(segmentId, stream)   ← Speaker.#fetchJob (כש-fetch חוזר)
  play/pause/resume/stop ; next/prev/jumpTo(index)
```

## הפירוק לשרשרת

> **A1 (turnState‑stability/flush) הוצא מהשרשרת** — חיתוך‑המילים עבר לחקירה. השרשרת הנקייה
> מתחילה ב‑A2 על `dev`. A5 (watchdog) נותק מ‑A1 והוא עצמאי על `dev` (מאלץ idle; ה‑flush
> הקיים נשאר כפי שהוא — לא נוגעים בו עד שהחקירה תכריע).

### 🔧 worktree A — תשתית (branch `slice/playback-core-*`)

| slice | תוכן | depends_on | base |
|---|---|---|---|
| ~~A1~~ | **בודד לחקירה** — `docs/investigations/2026-06-28-sentence-cutting-mid-word.md` | — | — |
| **A2** ✅READY — audio‑playlist | `AudioPlaylist` + reserve‑on‑enqueue + cursor + ממתין לסגמנט‑בתור (timeout=skip) | [] | `dev` |
| **A3** — transport | `pause/resume/stop` בשני ה‑AudioSinks + ב‑AudioPlaylist + הפרדת `cancel()`→`stopPlayback()`/`cancelRun()` | [A2] | A2 |
| **A4** — navigation | prev/next/jump בין משפטים + איחוד `BubblePlayer`→playlist (היסטוריה מלאה) | [A3] | A3 |
| **A5** ✅READY — watchdog | timeout ל‑turnState אם אין RESP/activity → אילוץ idle (עצמאי — לא נשען על A1) | [] | `dev` |

### 🎨 worktree B — UI (branch `slice/playback-ui-*`, base על A4)

| slice | תוכן | depends_on | base |
|---|---|---|---|
| **B1** — controls‑ui | control‑bar/StatusBubble: כפתורי ⏹/⏸▶/⏮/⏭ (phase=speaking) + עצור‑ריצה (thinking/responding/calling‑tool) + wiring | [A4, A5] | A4 (מוזג עם A5) |

**סדר merge בסוף:** A2→A3→A4 (`--no-ff` שרשרת) + A5 (עצמאי), ואז החלטה אם למזג גם B1.

## מיפוי דרישות → slice

| דרישה | slice | מנגנון |
|---|---|---|
| עצירת השמעה | A3 | `stopPlayback()` → `playlist.stop()` |
| המשך השמעה | A3 | `playlist.resume()` |
| השהיית השמעה | A3 | `playlist.pause()` |
| חזור אחורה | A4 | `playlist.prev()` |
| המשך קדימה | A4 | `playlist.next()` |
| עצור חשיבה/פעולה | A3+B1 | `cancelRun()` (= cancelTurn + stop), טקסט לפי phase |
| סדר נכון | A2 | reserve‑on‑enqueue |
| בועה תקועה | A5 | watchdog (אילוץ idle) |
| חיתוך‑מילים | — | **חקירה** (`investigations/2026-06-28-sentence-cutting-mid-word.md`) |

## Decisions קשורות

ר' `docs/decisions/voice-acp.md` — entry 2026-06-28 (ייכתב עם dispatch).
