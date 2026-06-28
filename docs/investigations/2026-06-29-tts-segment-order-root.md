# חקירה — סדר-השמעת סגמנטי TTS הפוך (שורש מאומת בקוד)

> **תאריך**: 2026-06-29 · **כותב**: מרדכי (לבקשת המשתמשת — "תעיף מבט על ההקלטות")
> **סטטוס**: שורש מאומת · **התיקון כבר קיים ב-`slice/playback-core-a2`** (טרם מוזג)
> **רלוונטי ל**: Track C — בקרת השמעה+פלייליסט (`playback-run-control-roadmap.md`)

## מה נצפה

המשתמשת שמעה (חי, Gemini TTS, 2026-06-29) שסגמנטי-אודיו של תשובה אחת **מושמעים לא לפי הסדר**.

## מאיפה (לא) הגיעו הנתונים

- **TTS audio לא נשמר לדיסק** — בדקתי את `~/.config/drive-coding/cache/proxy`: 13 entries, מתוכם
  10 `translate` + 3 `narrate` (JSON), **0 TTS**. ה-Gemini TTS הוא PCM streaming שלא עובר ל-disk cache.
- **`recordings/`** = הקלטות-מיקרופון (`audio/webm;codecs=opus`), לא סגמנטי-TTS.
- ⇒ סדר-הסגמנטים **אינו נשמר בשום מקום** — זה באג runtime בצד ה-FE. השורש אותר בקריאת-קוד.

## השורש (מאומת בקוד dev הנוכחי)

שלושה גורמים מצטברים ב-`packages/frontend`:

1. **fetch מקבילי** — `speaker.svelte.ts:345 #pumpFetchLoop` מריץ עד `LOOKAHEAD = 2` (שורה 54)
   jobs **במקביל**. סיום ה-fetch של כל job תלוי-latency.
2. **הכנסה-לתור אחרי-fetch** — `speaker.svelte.ts:419 #player.addSegment(...)` נקרא **אחרי**
   ה-`await` של `prepareSegment` (שורה 414). כלומר הסגמנט נכנס לתור-הנגן רק כשה-fetch שלו הסתיים.
3. **אין gating על ה-head הצפוי** — `tts-queue.ts:53 OrderedQueue.takeNext()` הוא פשוט
   `this.#entries.shift()` → מחזיר את ה-orderKey **המינימלי הזמין כרגע בתור**, בלי להמתין לסגמנט
   בעל orderKey נמוך יותר שעדיין ב-fetch.

**התרחיש**: seg#2 (orderKey גבוה) מסיים fetch לפני seg#1 → `addSegment(seg2)` ראשון → ה-player
מתחיל לנגן (`#playLoop`) → `takeNext` מחזיר את seg2 (היחיד בתור) → **seg2 מנוגן לפני seg1**.

## למה דווקא Gemini (ולא ElevenLabs)

ה-`OrderedQueue`+`orderKey` (slice 22) ממיין נכון רק את מה ש**כבר הושלם-fetch**. ב-Gemini ה-PCM
streaming סובל מ-variance גבוה ב-latency של ה-first-chunk + decode → סיום-fetch מחוץ-לסדר **שכיח**.
ב-ElevenLabs (MP3/MediaSource) ה-variance נמוך → הבאג כמעט לא מתבטא.

## התיקון — כבר קיים ב-`slice/playback-core-a2` (טרם מוזג)

ה-worktree `playback-core-a2` מחליף את `Player`/`OrderedQueue` ב-`AudioPlaylist`
(`engines/audio-playlist.svelte.ts`) שמתקן בדיוק את שלושת הגורמים:

- **`reserve(segmentId, orderKey)`** — נקרא ב-`#enqueue` **לפני** ה-fetch (state=`reserved`).
  התור מכיר את כל הסגמנטים לפי orderKey מההתחלה (reserve-on-enqueue).
- **`markReady(segmentId)`** — אחרי `prepareSegment`.
- **`#playLoop` cursor-based** — נע על cursor ו**ממתין** על ה-item הנוכחי עד `ready`/`error`/timeout,
  במקום `shift()` שמדלג. ה-head לעולם לא מדולג גם אם סגמנט מאוחר מוכן ראשון.
- ✅ יש כבר integration test ל-"סדר-הפוך" + timeout→skip + error→skip.

**המלצה**: זהו התיקון הנכון לבאג שהמשתמשת ראתה. A2 ממתין ל-runtime-gate (calev) + מיזוג.
אין צורך בעבודה נוספת על השורש — רק להעביר את A2 דרך ה-gate.
