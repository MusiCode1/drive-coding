# חקירה — עיצוב-מחדש של בעלות בנתיב ההשמעה (playlist / sink / producers)

> **תאריך:** 2026-07-04 · **סטטוס:** חקירה ארכיטקטונית (read-only) — feed ל-brief עתידי
> **טריגר:** 3 באגים באותו אזור בתוך שעת בדיקה-חיה אחת (`c39bc1e`, `3c3a0b7`) — סימן לתפרים דולפים
> **נבדק על:** worktree `.worktrees/playback-nav-retain`, branch `slice/playback-nav-retain` @ `3c3a0b7` (base: dev v0.10.2)
> **קבצי-ליבה:** `audio-playlist.svelte.ts` · `playable-sink.ts` · `segments/*` · `speaker.svelte.ts` · `bubble-player.svelte.ts`

---

## 0. תקציר-מנהלים

נתיב ההשמעה בנוי היום משלושה בעלי-עניין — **יצרנים** (Speaker/BubblePlayer, ייצור TTS),
**פלייליסט** (AudioPlaylist, סדר+ניווט), ו-**sink** (PlayableSink, אודיו בפועל) — אבל
**אף אחד מהם אינו מקור-אמת**: הפלייליסט מחזיק עותק מקומי (`item.state`, 7 ערכים) של מצב
שהבעלים האמיתיים שלו הם אחרים (fetch אצל היצרן, buffer אצל ה-sink), ומסנכרן אותו על פני
**חמישה ערוצים** ו-**ארבעה resolvers** נפרדים. כשהעותק סוטה מהאמת — הלולאה פועלת על שקר,
וזה בדיוק המנגנון של שלושת הבאגים.

ממצאי-מפתח של החקירה:

1. **שלושת התפרים שזוהו — מאומתים**, ושניים מהם רחבים מהניסוח המקורי (ר' §3).
2. **נמצא באג רביעי חי, טרם דווח**: `else` שאבד ב-merge resolution (`1328b9d`) ב-`BubblePlayer.toggle`
   — ▶ על בועה היסטורית הוא כעת no-op מוחלט, ו-▶ על בועה חיה מייצר **סגמנטים כפולים** (§1.4).
   העובדה ש-merge ידני שבר את הקוד בלי ש-typecheck או טסט תפסו — היא עצמה עדות לשבירות המבנה.
3. **נמצאו שני races מבניים נוספים** שטרם נצפו חיים: ghost-segment ריק-אך-complete
   (cancel מתחרה ב-prepare, §2.5 R4) ו-שתי `#playLoop` חיות במקביל (stop-then-reserve, §2.5 R5).
4. **היפותזת ה-target נכונה אך חסרה**: "ה-sink בעלים יחיד של מה-מתנגן" פותרת את באגים 1+3,
   אבל באג 2 דורש צלע שלישית — **בעלות-fetch אצל היצרן** (`ensureFetch` אידמפוטנטי במקום
   thunk+דגל-ניחוש), ובנוסף נדרש **חוזה-סיום ל-`play()`** (היום promise ננטש; ב-mp3 הוא לא
   מסתיים לעולם אחרי ביטול). ר' §5.
5. **הלב הניתן לחילוץ טהור**: החלטת "מה לעשות עכשיו" — כ-90 שורות מפוזרות ב-`#playLoop` —
   מחולצת לפונקציה `decidePlaylistAction(snapshot) → action` ב-core, נבדקת TDD ממצה. הלולאה
   הופכת ל-interpreter דק עם **ערוץ-השכמה יחיד** (condition variable + version) במקום 4 resolvers. ר' §4.
6. **המעבר הדרגתי** — 5 commits + hotfix מקדים, כל שלב ירוק בפני עצמו; ה-API הציבורי
   (`reserve/markReady/markError/next/prev/jumpTo/stop`) לא זז, ולכן 984 שורות-הטסט הקיימות
   נשארות רשת-ביטחון (בכפוף לתיקון פער-סמנטיקה אחד ב-mock — §6.3). ר' §6.

---

## 1. העדות — ארבעה באגים באותו אזור

### 1.1 באג 1 — קקפוניה: `reserve()` בזמן נגינה קטע את ה-play (תוקן ב-`c39bc1e`)

‏`#navResolve` שירת שני לקוחות שונים: קטיעת `await play` בניווט (play-race) **וגם** השכמת
idle-park. `reserve()` שהגיע בזמן נגינה פתר את ה-resolver → הלולאה "חשבה" שניווט קרה,
התקדמה, והתחילה את הסגמנט הבא בעוד הקודם מתנגן → כל הסגמנטים במקביל.
**התיקון:** הפרדה ל-`#parkResolve` נפרד (`audio-playlist.svelte.ts:93-95`).
**אבחנה:** תוקן הסימפטום (resolver רביעי), לא השורש (ריבוי ערוצי-השכמה שכל אחד נושא סמנטיקה
שונה — ר' §2.4).

### 1.2 באג 2 — שקט: סופת-refetch על כל item reserved (תוקן ב-`c39bc1e`)

לכל item יש `refetch` thunk (מ-nav-retain Commit 2). ה-`#playLoop` קרא `refetch()` על **כל**
item ב-reserved — כולל items רגילים שה-fetch החי שלהם כבר בדרך דרך `Speaker.#pumpFetchLoop` →
‏~6 קריאות synthesize/ms שריסקו את הסגמנטים.
**התיקון:** דגל `needsRefetch` שמודלק רק כש-item "נזרק" (`audio-playlist.svelte.ts:56-60, 486-491`).
**אבחנה:** הדגל הוא **ניחוש של הפלייליסט על מצב שאינו שלו** — "האם יש fetch חי?" היא שאלה
שרק היצרן יכול לענות עליה. ראיה: `Speaker.refetchSegment` מגן על עצמו באידמפוטנטיות
(`speaker.svelte.ts:371` — `if fetching||ready return`), אבל ה-thunk של `BubblePlayer`
(`bubble-player.svelte.ts:151-168`) **חסר guard כזה** — כל קריאה אליו יוצרת synthesize מלא.
הדגל בפלייליסט מכסה על החוסר הזה במקום לתקן אותו במקור.

### 1.3 באג 3 — קקפוניה בניווט: `PlayableSink.play` לא עצר את הקודם (תוקן ב-`3c3a0b7`)

‏`#playWithNav` "נוטש" את ה-`play()` promise ב-`Promise.race` בלי לעצור את הקול; ה-sink החדש
(`PlayableSink`) — בניגוד ל-`AudioStream` הישן — לא עצר את המתנגן לפני play חדש.
**התיקון:** `#current` tracking + `segment.stop()` (עצירת-קול משמרת-buffer)
(`playable-sink.ts:23-25, 56-58`).
**אבחנה:** התיקון מיישם בפועל חלק מהיפותזת ה-target (play אטומי = stop-then-play), אבל
**מודל-הנטישה נשאר**: ה-promise הנטוש ב-`#playWithNav` (`audio-playlist.svelte.ts:591-600`)
עדיין תלוי באוויר, וחוזה-הסיום שלו לא מוגדר (§3.ב).

### 1.4 באג 4 — 🆕 נמצא בחקירה: `else` שאבד ב-merge — `BubblePlayer.toggle` שבור

ב-merge `1328b9d` (dev → `slice/playback-nav-retain`; conflict מוצהר ב-`bubble-player.svelte.ts`)
אבד ה-`else` החיצוני של `if (alreadyInPlaylist)`. אימות: ב-`a16893d` (B1) המבנה תקין
(`if {…} else { /* בועה היסטורית */ }`); ב-`1328b9d` ואילך בלוק ה"בועה היסטורית" נמצא
**בתוך** ה-`if`, אחרי ה-if/else הפנימי (`bubble-player.svelte.ts:103-123` בגרסה הנוכחית).

ההשלכות (קריאת-קוד, טרם אומת חי — runtime-gate חסום על מפתח Gemini):

| תרחיש | התנהגות בפועל |
|---|---|
| ‏▶ על בועה היסטורית (לא בפלייליסט) | **no-op מוחלט** — הפיצ'ר מת; שום ענף לא רץ |
| ‏▶ על בועה שבפלייליסט, playlist מנגן | `jumpToBubble` → ואז מיד `stop()` + `#reserveAndPlay` → **סגמנטים כפולים** של אותה בועה נכנסים לפלייליסט (אותו `seq` מה-allocator, `segmentIndex` ממשיך לעלות) → הבועה תושמע, ואז **תושמע שוב** לפני הבועה הבאה |
| ‏▶ על בועה שבפלייליסט, playlist idle | `#reserveAndPlay` רץ **פעמיים** במקביל → כפל סגמנטים + שני מסלולי-fetch |

**לקח מבני:** ה-conflict resolution נעשה על מבנה if/else עמוק בן ~60 שורות עם שלושה מסלולים
שקומפל תקין בכל שילוב — typecheck עיוור לזה, ואין אף טסט על `BubblePlayer.toggle`.
זה בדיוק מחיר "לוגיקת-החלטה שזורה ב-imperative flow": היא לא ניתנת לבדיקה, וכל עריכה בה מסוכנת.

> **המלצה מיידית (לא מחכה ל-redesign):** hotfix קטן שמחזיר את ה-`else` + טסט מינימלי על
> שלושת מסלולי toggle. ר' §6.1 שלב 0.

---

## 2. המפה המלאה — מי מחזיק איזה state, ומי כותב אותו (שאלה 1)

### 2.1 טבלת בעלי-state

| בעלים | שדה | סוג | מי כותב (כל הכותבים) |
|---|---|---|---|
| **Speaker** (VM) | `#jobs: TtsJob[]` · `job.status` (pending/fetching/ready/error) | מקור-אמת של **ייצור** | `#enqueue` (push) · `#pumpFetchLoop` (→fetching) · `#fetchJob` (→ready/error) · `refetchSegment` (→pending + abort חדש) · `#stopAndClear` (איפוס) |
| **Speaker** | `#activeFetches` · `#pendingCount` ($state) · `#bubbleStates` · `#orderAlloc` | עזר-ייצור | ‏Speaker בלבד ✅ (מקומי, תקין) |
| **AudioPlaylist** (engine) | `items: PlaylistItem[]` · `item.state` (**7 ערכים**: reserved/loading/ready/playing/done/error/skipped) · `item.needsRefetch` | **עותק-סנכרון** — לא מקור-אמת | **ארבעה כותבים**: `reserve` (יצירה) · `markReady`/`markError` (מהיצרן) · `#navigate` (→reserved+needsRefetch) · `#playLoop` (→playing/done/skipped, כיבוי needsRefetch) |
| **AudioPlaylist** | `state` (idle/playing) · `transport` (playing/paused/stopped) · `#playing` (bool) · `#stopped` (bool) | **4 שדות ל-lifecycle אחד** | `#playLoop` · `stop` · `pause`/`resume` · `reserve` (transport reset) |
| **AudioPlaylist** | `#cursor` ($state) · `currentSegmentId` ($state) | מקור-אמת של **כוונה** (מיקום) | `#playLoop` · `#navigate` · `stop` |
| **AudioPlaylist** | `#itemResolvers: Map` · `#pauseResolve` · `#navResolve` · `#parkResolve` | **4 מנגנוני-השכמה** | ר' §2.4 |
| **PlayableSink** (engine) | `#segments: Map<id,PlayableSegment>` · `#current` | מקור-אמת של **מציאות-אודיו** | `prepareSegment` (set — **גם על id שבוטל**, ר' R4) · `cancel` (delete) · `clear` · `play` (#current) |
| **PlayableSegment** | `#state` (loading/ready/playing/ended/cancelled) · `#streamDone` (pcm) · buffers/sources/MediaSource | מקור-אמת של **buffer** | הסגמנט עצמו + `dispose`/`stop` מה-sink |
| **BubblePlayer** (VM) | `playingBubbleId` ($state) · `#abortCtrl` · `#orderAlloc` (נפרד!) | עותק-UI | `toggle` · `stop` · `#reserveAndPlay` (cleanup **בסוף ה-fetch, לא בסוף ההשמעה** — `bubble-player.svelte.ts:203-206`) |

### 2.2 שישה ייצוגים ל"מה מתנגן עכשיו"

לשאלה אחת — "מה מושמע כרגע?" — יש שישה ייצוגים שצריכים להסתנכרן ידנית:

1. `AudioPlaylist.currentSegmentId`
2. `PlaylistItem.state === "playing"`
3. `PlayableSink.#current`
4. `PlayableSegment.#state === "playing"`
5. `Speaker.state` (getter נגזר מ-`playlist.state`) → מזין `modelStatus.phase` → מיקרופון/cues
6. `BubblePlayer.playingBubbleId` (מתעדכן ידנית, **לא** מסונכרן חזרה כשהפלייליסט ממשיך לבועה
   הבאה או כשההשמעה מסתיימת — ה-UI של הבועה משקר בשני כיוונים)

וכן **ארבעה שדות ל-lifecycle של הלולאה עצמה** (`state`, `transport`, `#playing`, `#stopped`) עם
כללי-עקביות לא-כתובים ביניהם (למשל: idle-park = `state="idle"` אבל `#playing=true`; paused =
`state="playing"` אבל `transport="paused"`).

### 2.3 ערוצי הסנכרון — הדיאגרמה האמיתית

```
                 (1) reserve(id, orderKey, bubbleId, refetchThunk)
   Speaker ────────────────────────────────────────────► AudioPlaylist
      │          (2) markReady(id) / (3) markError(id)        │
      │  ◄──(4) item.refetch() thunk ─────────────────────────┤
      │                                                       │ (6) play/cancel/pause/
      │ (5) prepareSegment(id, stream, ac) — ישיר, עוקף!      │     resume/isComplete
      ▼                                                       ▼
   PlayableSink ◄─────────────────────────────────────── PlayableSink
      ▲                                                 (אותו instance)
      │ (5ב) prepareSegmentForBubble — דרך wrapper בפלייליסט
   BubblePlayer ──(1)(2)(3)(4) כמו Speaker אבל בלי job-state ─► AudioPlaylist
      └──(7) Speaker.#stopAndClear: player.stop() וגם audioStream.clear() — שני מסלולי-מחיקה
```

תצפיות:

- **חמישה ערוצים** בין יצרן לפלייליסט/sink (reserve / markReady / markError / refetch-thunk /
  prepareSegment) — ה-brief של nav-retain ניסח "3 ערוצים"; בפועל יש יותר, כולל ערוץ שעוקף
  את הפלייליסט לגמרי (5).
- **חוסר-סימטריה בין היצרנים:** Speaker מדבר ישירות עם ה-sink (5) ומחזיק `TtsJob` עם
  אידמפוטנטיות; BubblePlayer עובר דרך wrapper (5ב) ואין לו job-state בכלל → ה-thunk שלו
  לא-אידמפוטנטי. אותו תפקיד ("יצרן"), שני חוזים שונים.
- **שני `OrderAllocator` נפרדים** (Speaker + BubblePlayer) מזינים playlist אחד. ה-`#nextSeq`
  של כל אחד מתחיל מ-0 ועולה עצמאית → orderKeys משני המקורות **מתנגשים במרחב** (seq=3 של
  Speaker ו-seq=3 של BubblePlayer שקולים ל-sorted-insert). בפועל הסיכון ממותן כי BubblePlayer
  פעיל רק כש-turnState=idle, אבל זו הגנה התנהגותית, לא מבנית.
- **כפילות בעלות על ניקוי ה-sink** (7): `playlist.stop()` כבר מבטל את כל ה-items הלא-גמורים
  ב-sink, ואז `Speaker.#stopAndClear` קורא בנוסף `audioStream.clear()` (`speaker.svelte.ts:634-635`).
  מי אחראי על חיי-הסגמנטים? שניהם — כלומר אף אחד.

### 2.4 ארבעת ה-resolvers ולוח-ההשכמות

| resolver | מי ממתין עליו | מי פותר אותו | סמנטיקה |
|---|---|---|---|
| `#itemResolvers[id]` (+timeout 20s) | ‏`#playLoop` ב-`#waitForItem` | `markReady` · `markError` · `stop` (כולם) | "ה-item הזה השתנה" |
| `#pauseResolve` | ‏`#playLoop` ב-`#waitForResume` (3 אתרים!) | `resume` · `stop` | "צא מ-pause" |
| `#navResolve` | ‏`#playWithNav` (race מול play) | `#navigate` · `stop` | "נטוש את ה-play הנוכחי" |
| `#parkResolve` | ‏`#playLoop` ב-idle-park | `#navigate` · `reserve` · `stop` | "יש עבודה חדשה אחרי הסוף" |

הבעיה אינה מספר ה-resolvers אלא **הסמנטיקה הפר-ערוצית**: כל צירוף (מי-פותר × מי-ממתין) חייב
להיות נכון בנפרד, וכל ערוץ חדש מכפיל את מרחב-הצירופים. באג 1 היה בדיוק צירוף שגוי אחד
(reserve→navResolve). המודל הנכון (ר' §4) הוא ערוץ אחד עם סמנטיקה אחת: "המצב השתנה —
שקול הכל מחדש", והלולאה מחליטה לבד מה לעשות לפי snapshot.

### 2.5 קטלוג races

| # | תרחיש | מצב | שורש |
|---|---|---|---|
| ‏R1 | `reserve` בזמן play פותר play-race | תוקן (`c39bc1e`) — סימפטומטית | ריבוי-ערוצים (§2.4) |
| ‏R2 | סופת-refetch על reserved | תוקן (`c39bc1e`) — סימפטומטית | ניחוש-fetch בפלייליסט (§3.א) |
| ‏R3 | play חדש בלי לעצור קודם | תוקן (`3c3a0b7`) — נכון (play אטומי) | מודל-נטישה (§3.ב) |
| ‏R4 🆕 | **ghost-segment**: `#navigate`→`sink.cancel(id)` (dispose+delete) מתחרה ב-`#fetchJob` שנמצא בין `synthesize` ל-`prepareSegment`. אם `prepareSegment` רץ **אחרי** ה-cancel: נוצר segment **חדש** ב-map עם `ac` שכבר aborted → הצריכה נעצרת מיד → mp3: `endOfStream()` על buffer ריק/חלקי → `state="ready"` → **`isComplete()===true` על שקט**; pcm: `streamDone=true` עם `buffers=[]` → "ניגון" ריק שמסתיים מיד. אם `markReady` רץ אחרי ה-cancel (ו-prepare לפני): item חוזר ל-ready בלי segment ב-map → `play` יזרוק → הלולאה תסמן **done** שגוי ותדלג | 🆕 מאומת בקריאת-קוד (`playable-sink.ts:34-50,87-93` · `speaker.svelte.ts:450-463` · `mp3-segment.ts:102-107` · `pcm-segment.ts:89-92`) — **מועמד להסבר ה"שקט" שנצפה** | ביטול מפוצל: הפלייליסט מבטל ב-sink, אבל ה-fetch שייך ליצרן; אין נקודת-ביטול אחת |
| ‏R5 🆕 | **שתי לולאות חיות**: `stop()` קובע `#stopped=true` ומאפס אותו ל-`false` **באותו tick סינכרוני** (`audio-playlist.svelte.ts:369,399`). ה-continuations של הלולאה הישנה רצים רק ב-microtask הבא — ורואים `#stopped===false`. הלולאה הישנה יוצאת רק דרך `transport==="stopped"` בראש האיטרציה הבאה; אבל אם `reserve()` הספיק לרוץ בינתיים (ואיפס `transport="playing"` + הפעיל `#playLoop` שני כי `#playing===false`) — **שתי לולאות רצות על אותו `#cursor` משותף**: דריסת resolvers הדדית ב-`#itemResolvers.set`, כפל-play על אותו segment (pcm: double-schedule = קול כפול), timeout-skip פנטום אחרי 20ש' | 🆕 מאומת מבנית; תלוי-תזמון (stop ואז reserve לפני flush של microtasks) — נדיר אך אפשרי (cancel-ואז-הודעה-חדשה) | ‏lifecycle של הלולאה מיוצג ב-4 שדות בלי בעלות; `#stopped` מאופס לפני שהלולאה אישרה יציאה |
| ‏R6 | `markReady` לא מנקה `needsRefetch`; item שנזרק וחזר דרך fetch חיצוני נשאר עם דגל דלוק → `refetch()` מיותר בביקור הבא (ממותן ע"י האידמפוטנטיות של Speaker; **לא** ממותן ב-BubblePlayer) | קיים, minor | דגל-הניחוש (§3.א) |
| ‏R7 | `#navigate` על item ב-state="done" אבל `isComplete=false` (buffer נמחק): ה-reset מדלג על done (`audio-playlist.svelte.ts:317-334` בודק רק ready/playing/reserved/loading) → אין refetch, והלולאה מדלגת בשקט (`:548`) — הסגמנט אבוד לניווט לתמיד | קיים, edge (dispose ידני בלבד) | ‏"done" מניח לנצח שה-buffer קיים — אבל הבעלות על ה-buffer אצל אחר (§3.ג) |

---

## 3. שלושת התפרים — אימות, הפרכה, הרחבה

### 3.א — סנכרון Speaker↔Playlist "על 3 ערוצים" → **מאומת ומורחב: 5 ערוצים + ניחוש-מצב**

מאומת. ובפועל רחב יותר מהניסוח: לא רק reserve/markReady/refetch אלא גם `markError`,
`prepareSegment` ישיר ל-sink (עוקף את הפלייליסט), ו-wrapper נפרד ל-BubblePlayer (§2.3).
הליבה: **הפלייליסט מנחש מצב-fetch** (`needsRefetch`) כי אין לו דרך לשאול את הבעלים.
ההוכחה החותכת: ליצרן **כבר יש** את מקור-האמת — `TtsJob.status` — והפלייליסט מנהל לו צל
(`item.state` reserved/loading/ready/error) שמתעדכן באיחור ובכפילות. `loading` אף פעם לא
נכתב בפועל (אין אף `state = "loading"` בקוד — ערך מת ב-union).

### 3.ב — ה-race ב-`#playWithNav` נוטש play בלי לעצור → **מאומת ומורחב: חוזה-סיום חסר**

מאומת כשורש של #1 ו-#3. ההרחבה: גם אחרי תיקון ה-`#current`, **גורל ה-promise הנטוש אינו
מוגדר בחוזה** `PlayableSegment.play()`:

- ‏**Mp3Segment**: `stop()`/`dispose()` עושים `audio.pause()` — לא נורה `ended` ולא `error` →
  **ה-promise לא מסתיים לעולם** (`mp3-segment.ts:130-144,152-154,171-187`). המערכת "ניצלת"
  רק כי `Promise.race` הפסיק להאזין. בנוסף, ה-listener הישן (`once`) נשאר רשום; ב-replay נרשם
  שני, ובסוף הניגון הבא שניהם יורים (resolve כפול שקט + `#state="ended"` כפול).
- ‏**PcmSegment**: `dispose()` → sources נעצרים → `onended` → `scheduleNext` → `state==="cancelled"`
  → **reject**. כלומר mp3 ו-pcm עונים תשובות שונות לאותה שאלה.

מודל-הנטישה הוא בדיוק ההפך מ"play אטומי": כל promise חייב להסתיים (resolve/reject) כשה-segment
נעצר — אחרת כל צרכן עתידי של `play()` יצטרך race משלו.

### 3.ג — דואליות `PlaylistItem.state` מול `segment.state`+`isComplete` → **מאומת + חידוד קריטי**

מאומת, עם חידוד שהוא לב-הבעיה: **"ready" של הפלייליסט לא אומר "מוכן"**.
`markReady` נורה ב-`Speaker.#fetchJob` מיד אחרי `await prepareSegment(...)` — אבל
`prepareSegment` **חוזר מיד** ("stream נצרך ברקע", `playable-sink.ts:49`). כלומר:

> ‏`item.state="ready"` = "ה-synthesize חזר וההזרמה **התחילה**"
> ‏`segment.isComplete()` = "ה-buffer **שלם** וניתן ל-replay"

שני מושגי-"מוכנות" שונים תחת שם אחד. התוצאה הישירה: `#playLoop` נאלץ לשני מסלולי-play שונים
(`(done|ready)&&isComplete` → replay ב-`:452-483`; `ready` בלי isComplete → play רגיל ב-`:517-546`),
ובנוסף קיימות **שלוש שכבות-המתנה כפולות**: `#waitForItem` (playlist, resolver+timeout 20s),
`#waitForReady`/`#waitForSomeData` (segment, polling 20-50ms!), וה-play promise עצמו. ה"עוצרים
‏~20 שניות" מהבאג המקורי של nav-retain היה בדיוק התנגשות בין השכבות האלה.

### 3.ד — תפרים נוספים שהחקירה חשפה

1. **ביטול מפוצל** (שורש R4): הפלייליסט מבטל ב-sink (`cancel` = dispose+delete), אבל ה-fetch
   החי שייך ליצרן והוא ממשיך לרוץ ולכתוב ל-sink אחרי הביטול. אין נקודת-ביטול אחת פר-segment.
2. **‏lifecycle של הלולאה ללא בעלות** (שורש R5): `#stopped` מאופס סינכרונית לפני שהלולאה יצאה.
3. **`pause`/`resume` גורפים**: `PlayableSink.pause()` משהה את **כל** הסגמנטים, וב-pcm —
   `ctx.suspend()` על ה-AudioContext **המשותף** (`playable-sink.ts:63-74`, `pcm-segment.ts:178-182`).
   עובד-בפועל כשרק אחד מתנגן; ישבר ברגע שסגמנט שני scheduled. `#current` שנוסף ב-fix 3 כבר
   מאפשר pause ממוקד — הקוד פשוט לא עודכן.
4. **‏UI נגזר משקר כפול**: `BubblePlayer.playingBubbleId` לא מתעדכן כשהפלייליסט ממשיך הלאה,
   ומאופס בסוף ה-**fetch** ולא בסוף ה-**השמעה** (`bubble-player.svelte.ts:203-206`). ההדגשה
   "מתנגן עכשיו" (slice עתידי `playback-nowplaying`) תצטרך ממילא נגזרת אמת:
   `currentSegmentId → item.bubbleId`.

---

## 4. החילוץ הטהור — `decidePlaylistAction` (שאלה 2)

### 4.1 מה טהור כאן באמת

ההחלטה "בהינתן המצב — מה הפעולה הבאה" מפוזרת היום על ~90 שורות ב-`#playLoop`
(`audio-playlist.svelte.ts:420-550`) שזורה ב-awaits, ותלויה ב: `cursor`, `item.state`,
`needsRefetch`, `isComplete(sink)`, `transport`, `#stopped`. כל אלה **עובדות snapshot-יות** —
ההחלטה עצמה אינה זקוקה ל-IO. זה בדיוק ה-functional-core של D5/§1.1, ויש תקדים ישיר ב-core:
`tts-queue.ts` (OrderAllocator/OrderedQueue) ו-`sentence-boundary`.

### 4.2 החתימה המוצעת

מיקום: `packages/core/src/voice/playlist-decision.ts` (טהור, אפס Svelte/DOM; ה-engine מעביר
snapshot של POJOs).

```ts
// ─── עובדות (inputs) ─────────────────────────────────────────────
export type SegmentFacts = {
  readonly segmentId: string
  /** מהיצרן — מקור-אמת יחיד לייצור (מחליף את reserved/loading/error+needsRefetch) */
  readonly fetch: "idle" | "in-flight" | "failed"
  /** מה-sink — מקור-אמת יחיד ל-buffer (isComplete) */
  readonly buffered: boolean
  /** של הפלייליסט עצמו — עובדת-היסטוריה (לניווט-אחרי-סוף ו-auto-advance) */
  readonly playedToEnd: boolean
  /** timeout ל-fetch תקוע — נמדד ב-shell, מוזן כעובדה */
  readonly waitedTooLong: boolean
}

export type PlaylistSnapshot = {
  readonly items: readonly SegmentFacts[]  // ממוין (orderKey נשאר בבעלות ה-shell)
  readonly cursor: number
  readonly transport: "playing" | "paused" | "stopped"
}

// ─── פעולה (output) — בדיוק אחת, דטרמיניסטית ─────────────────────
export type PlaylistAction =
  | { kind: "exit" }                                  // transport=stopped
  | { kind: "wait" }                                  // paused / אין מה לעשות עדיין
  | { kind: "park" }                                  // cursor אחרי הסוף — navigable, idle
  | { kind: "play"; index: number }                   // buffered → נגן (replay==first-play)
  | { kind: "request-fetch"; index: number }          // fetch=idle/failed בביקור → בקש מהיצרן, ואז wait
  | { kind: "wait-fetch"; index: number }             // fetch=in-flight → המתן לשינוי
  | { kind: "skip"; index: number }                   // failed-ולא-בביקור-מפורש / waitedTooLong

export function decidePlaylistAction(s: PlaylistSnapshot): PlaylistAction
```

הערות עיצוב:

- **אין יותר `PlaylistItem.state` בן 7 ערכים** — הוא נגזרת-תצוגה בלבד (אם בכלל נחוץ ל-UI):
  `playing` = `cursor===i && shellIsPlaying`; `done` = `playedToEnd`; `ready` = `buffered`;
  וכו'. שלושת מקורות-האמת (fetch/buffered/cursor) לא משוכפלים.
- **`play` יחיד** — ההבחנה replay/first-play נעלמת: `buffered===true` → נגן. סגמנט באמצע-streaming
  (fetch=in-flight, buffered=false) → `wait-fetch`; ה-shell מתעורר על כל `markReady` **וגם**
  יכול לנגן-תוך-streaming אם נרצה לשמר את ההתנהגות (ר' §5.4 E7 — הכרעה למרדכי).
- **ההחלטה נבדקת TDD ממצה**: כל שילוב (fetch × buffered × transport × cursor-position) הוא
  טסט-שורה טהור, בלי mocks, בלי timers, בלי async. זו בדיוק הלוגיקה שהיום אי-אפשר לבדוק
  בלי לתזמר 4 resolvers ו-fake-timers.

### 4.3 ה-shell — לולאה-מפרשת עם ערוץ-השכמה יחיד

```ts
// בתוך AudioPlaylist (engine) — פסאודו-קוד
#version = 0
#wake: (() => void) | null = null
#bump(): void { this.#version++; this.#wake?.(); this.#wake = null }
async #changed(seen: number): Promise<void> {
  if (this.#version !== seen) return            // אין lost-wakeup
  await new Promise<void>(r => { this.#wake = r })
}

async #runLoop(): Promise<void> {
  while (true) {
    const seen = this.#version
    const action = decidePlaylistAction(this.#snapshot())
    switch (action.kind) {
      case "exit": return
      case "wait": case "park": case "wait-fetch":
        await this.#changed(seen); break
      case "request-fetch":
        this.#producerFor(action.index).ensureFetch(id); await this.#changed(seen); break
      case "skip":
        this.#markPlayed(action.index, /*skipped*/); this.#cursor++; break
      case "play":
        await this.#playCurrent(action.index)   // sink.play אטומי; מתעורר גם על bump
        break
    }
  }
}
// כל mutation חיצוני — reserve/markReady/markError/navigate/pause/resume/stop — קורא #bump()
```

- **resolver אחד** במקום ארבעה; הסמנטיקה היחידה: "משהו השתנה — החלט מחדש". צירופי
  מי-פותר×מי-ממתין נעלמים כקטגוריה.
- ניווט = `cursor=n; bump()`. ה-`#playCurrent` שרץ מזהה אחרי ההתעוררות ש-decision השתנה
  ועוצר דרך ה-sink (או שה-`sink.play` הבא עוצר אטומית) — **אין נטישה**: play-promise מסתיים
  תמיד (חוזה מתוקן, §5.3-ג).
- ‏timeout: נמדד ב-shell (timestamp כש-fetch התחיל) ומוזן כ-`waitedTooLong` — ההחלטה נשארת טהורה.

---

## 5. ביקורת היפותזת ה-target (שאלה 3)

### 5.1 מה ההיפותזה פותרת — אימות מול שלושת הבאגים

| באג | שורש | האם ה-target סוגר? |
|---|---|---|
| ‏1 — קקפוניה (reserve קוטע play) | ערוץ-השכמה עם סמנטיקה כפולה | ✅ ערוץ יחיד "שקול מחדש"; reserve רק מוסיף עובדה; ה-play הנוכחי נעצר רק אם ה-decision השתנה בפועל |
| ‏2 — סופת-refetch | הפלייליסט מנחש מצב-fetch | ✅ אבל **רק עם הצלע השלישית** (§5.2): `fetch` כעובדה מהיצרן + `ensureFetch` אידמפוטנטי. בלי זה ההיפותזה כמות-שנוסחה לא מכסה את הבאג |
| ‏3 — קקפוניה בניווט | play לא-אטומי + נטישה | ✅ `sink.play` אטומי (כבר יושם ב-`3c3a0b7`) + חוזה-סיום ל-promise (משלים את החצי החסר) |
| ‏4 — else אבוד (toggle) | לוגיקת-החלטה שזורה ו-לא-נבדקת | ✅ עקיף: `toggle` הופך לזעיר — "בפלייליסט? navigate : producer.materialize+navigate" — כשההחלטות למטה טהורות ונבדקות |
| ‏R4 — ghost-segment | ביטול מפוצל sink/producer | ✅ ביטול עובר ליצרן (`cancelFetch`): הוא ה-abort-owner, הוא לא ידווח ready אחרי ביטול, וה-sink לא מקבל `prepareSegment` על מבוטל |
| ‏R5 — שתי לולאות | ‏lifecycle ב-4 שדות | ✅ לולאה אחת עם `exit` מפורש; `stop` = `transport="stopped"; bump()` ואין דגל שמאופס-מוקדם. `reserve` אחרי stop יוצר לולאה רק אחרי שה-קודמת אישרה יציאה (await על סיום ה-run promise) |

### 5.2 איפה ההיפותזה כמות-שנוסחה נשברת

1. **חסרה הצלע השלישית — בעלות-ייצור.** "sink בעלים של מה-מתנגן + playlist בעלים של כוונה"
   משאיר את שאלת "האם יש fetch חי / איך מסנתזים מחדש" בלי בעלים. זה בדיוק באג 2. הפתרון:
   **ממשק Producer** צר ומשותף לשני היצרנים:

   ```ts
   interface SegmentProducer {
     /** אידמפוטנטי: אם fetch חי/הושלם — no-op. מדווח דרך markReady/markError. */
     ensureFetch(segmentId: string): void
     /** מבטל fetch חי אם יש; אחרי ביטול — מובטח שלא יגיע markReady מאוחר. */
     cancelFetch(segmentId: string): void
   }
   ```

   ‏Speaker כמעט מממש את זה היום (`refetchSegment` + guard); BubblePlayer יקבל job-map מינימלי
   משלו במקום thunk-בלי-guard. ה-thunk-פר-item ו-`needsRefetch` נמחקים.

2. **"ה-Playlist רק שואל 'X מוכן?'" לא מספיק כ-pull.** מודל pull-בלבד ידרוש polling; חייבים
   לשמר את ה-push (`markReady`/`markError`) — אבל כ-**אות-השכמה בלבד** (`bump()`), לא כמעבר-מצב
   ב-state המקומי. ההבדל דק אך מהותי: ההודעה אומרת "כדאי להסתכל שוב", לא "item X הוא כעת ready".

3. **חוזה-סיום ל-`play()` לא הופיע בהיפותזה** — בלעדיו "ניווט = cursor + sink.play(new)" עדיין
   משאיר promise תלוי-לנצח ב-mp3 (§3.ב). חובה כחלק מה-target.

4. **"מקור-מצב יחיד" צריך דיוק:** לא מקור אחד — אלא **שלושה מקורות שאינם חופפים**:
   כוונה (playlist: סדר+cursor) · ייצור (producer: fetch) · מציאות (sink: buffered+playing).
   הכלל האמיתי: **אף עובדה לא מיוצגת בשני מקומות.** `item.state` הנוכחי מפר את זה שבע פעמים.

### 5.3 ה-target המתוקן (לנעילה ב-brief)

- ‏**(א) Playlist** = בעלים של *כוונה*: רשימה ממוינת (identity+orderKey+bubbleId), `cursor`,
  `transport`, ועובדת-היסטוריה `playedToEnd`. שום מצב-fetch, שום מצב-buffer.
- ‏**(ב) Producer** (Speaker/BubblePlayer דרך ממשק אחד) = בעלים של *ייצור*: `ensureFetch`/
  `cancelFetch` אידמפוטנטיים; מדווח ready/error כאות בלבד.
- ‏**(ג) Sink** = בעלים של *מציאות*: `play(id)` אטומי (stop-then-play — קיים), `isComplete(id)`,
  **וחוזה-סיום**: ה-promise של `play()` מסתיים (resolve="הושמע-עד-סוף-או-נעצר" / reject=שגיאה)
  בכל מסלול, כולל `stop()`/`dispose()` — תיקון נקודתי ב-`Mp3Segment` (resolve על stop) ויישור
  `PcmSegment` (היום reject על cancel — ליישר לאותה סמנטיקה).
- ‏**(ד) ההחלטה** = `decidePlaylistAction` טהורה ב-core (§4.2).
- ‏**(ה) ה-shell** = לולאה-מפרשת אחת + `bump()` יחיד (§4.3).

### 5.4 מטריצת edge-cases — איפה חיפשתי שברים

| # | ‏edge case | התנהגות ב-target | פער/הכרעה |
|---|---|---|---|
| ‏E1 | ‏fetch מקבילי חוזר בסדר הפוך (Gemini מהיר אחרי איטי) | ההחלטה לפי cursor בלבד; ready של מאוחר רק עושה bump שמוביל ל-`wait-fetch` שוב | ✅ זהה להתנהגות היום |
| ‏E2 | ‏skip באמצע fetch (skip-cancel) | ‏decision עובר מ-play/wait ל-item אחר → ה-shell קורא `producer.cancelFetch(old)`; ה-producer הוא abort-owner → אין markReady מאוחר, אין ghost (R4 נסגר) | ✅ בתנאי שה-מדיניות "לבטל את מה שדולג" נשמרת ב-shell (זו מדיניות, לא החלטת-רצף — תקין) |
| ‏E3 | ‏prev אחרי-סוף (park) | `park` → prev מזיז cursor+bump → decision=`play` (buffered) או `request-fetch` (נזרק) | ✅ |
| ‏E4 | ‏pause באמצע play → resume | `wait` בראש; pause בזמן play = `sink.pause()` ישיר (פעולה, לא רצף) | ⚠️ לתקן בדרך: pause ממוקד-`#current` במקום גורף-כל-הסגמנטים + suspend גלובלי של ctx (§3.ד-3) |
| ‏E5 | ‏pause בזמן park ואז reserve של תור חדש | היום: תור חדש נשאר תקוע ב-pause (transport לא מאופס אלא רק מ-stopped), וה-cue "speaking" נורה בזמן paused (`:441-442` רץ לפני בדיקת pause) | 🟡 הכרעת-מדיניות למרדכי: האם תור חדש מבטל pause? (מוצע: כן — pause הוא על השמעה מתמשכת, לא על השיחה) |
| ‏E6 | ‏jumpToBubble לבועה שמתנגנת כרגע (סגמנט אחר שלה) | cursor זז לסגמנט הראשון של הבועה; play אטומי מחליף | ✅ (היום: אם ה-index זהה — הלולאה מפרשת כ"סיום רגיל" ומדלגת — נסגר כי אין ניחוש-navigated) |
| ‏E7 | ‏play-תוך-streaming (סגמנט חלקי מתנגן בזמן שההורדה נמשכת) | ‏decision מנגן רק `buffered===true` → **אובדן התנהגות**: היום mp3/pcm מתחילים לנגן לפני סוף-ההורדה (waitForSomeData) | 🟡 **ההכרעה המרכזית של ה-brief**: או (א) `playable: boolean` נוסף ל-facts ("יש מספיק buffer להתחיל") ו-decision מנגן עליו — משמר first-audio-latency; או (ב) לנגן רק שלמים — פשוט יותר, פוגע ב-latency של סגמנטים ארוכים. מוצע: (א), כי first-audio ~1s הוא דרישת-מוצר (V4a) |
| ‏E8 | ‏mp3 מול pcm (שני ספקים) | הפולימורפיזם נשאר בסגמנטים; ה-decision אגנוסטי לפורמט | ✅ בתנאי יישור חוזה-הסיום (§5.3-ג) בשני המימושים |
| ‏E9 | ‏stop ואז reserve מיידי | `stop` ממתין ליציאת-הלולאה (run-promise) לפני שמתאפשרת לולאה חדשה — או תור-הפעלות | ✅ סוגר R5; דורש שדה `#runPromise` אחד במקום `#playing/#stopped` |
| ‏E10 | ‏timeout על fetch תקוע | ‏shell מודד, מזין `waitedTooLong` → decision=`skip` | ✅ נשמר; נעלמת הכפילות timeout-פלייליסט מול polling-סגמנט |

**שורה תחתונה לשאלה 3:** ההיפותזה פותרת את שלושת הבאגים בשורש **אחרי** שלושה תיקונים:
צלע-Producer (5.2-1), push-כאות (5.2-2), חוזה-סיום (5.2-3). הנקודה היחידה שבה היא "נשברת"
באמת היא E7 (play-תוך-streaming) — שם נדרשת הכרעת-מוצר מפורשת, לא ויתור מובלע.

---

## 6. עלות המעבר (שאלה 4)

### 6.1 שלבים — כל אחד ירוק בפני עצמו

| שלב | תוכן | קבצים | סיכון |
|---|---|---|---|
| ‏**0 — hotfix (מיידי, לפני הכל)** | החזרת ה-`else` שאבד (§1.4) + 3 טסטים על מסלולי `toggle` | `bubble-player.svelte.ts` (+טסט חדש) | זעיר; מחזיר התנהגות B1 המאומתת |
| ‏**1 — חילוץ מכני של ההחלטה** | `decidePlaylistAction` ב-core + TDD ממצה; `#playLoop` הקיים קורא לה בלי לשנות התנהגות (facts נבנים מ-item.state הקיים) | `core/voice/playlist-decision.ts` (חדש) · `audio-playlist.svelte.ts` | נמוך — refactor שקוף; הטסטים הקיימים (984 שורות) חייבים לעבור כמו-שהם |
| ‏**2 — ערוץ-השכמה יחיד** | `#bump`/`#changed`+version מחליפים 4 resolvers; `stop` הופך ל-transport+bump+await-run-exit (סוגר R1-דפוס, R5) | `audio-playlist.svelte.ts` | בינוני — השינוי ההתנהגותי הראשון; ה-API החיצוני זהה, הטסטים בודקים semantics חיצוני |
| ‏**3 — חוזה-סיום ל-play** | `Mp3Segment.stop→resolve`, יישור `PcmSegment`; הסרת `#playWithNav`-race (הלולאה עוצרת דרך sink, לא נוטשת) (סוגר §3.ב) | `segments/*` · `playable-sink.ts` · `audio-playlist.svelte.ts` | בינוני — נגיעה בקודקים; **לא** נוגעים בלוגיקת decode/schedule עצמה |
| ‏**4 — בעלות-ייצור** | ‏`SegmentProducer` (`ensureFetch`/`cancelFetch`); BubblePlayer מקבל job-map מינימלי; מחיקת thunk-פר-item + `needsRefetch`; ביטול-fetch עובר ליצרן (סוגר באג 2-שורש, R4, R6) | `speaker.svelte.ts` · `bubble-player.svelte.ts` · `audio-playlist.svelte.ts` | בינוני-גבוה — נוגע בשני יצרנים; ממותן כי Speaker כבר 90% שם |
| ‏**5 — צמצום ה-state הכפול** | `item.state` (7 ערכים) → נגזרת-תצוגה; `playingBubbleId` → `$derived` מ-`currentSegmentId→bubbleId`; איחוד `stop/clear` לבעלים אחד (§2.3-7); pause ממוקד (§3.ד-3) | `audio-playlist.svelte.ts` · `bubble-player.svelte.ts` · `speaker.svelte.ts` · `PlaybackControls.svelte` | נמוך — בעיקר מחיקות אחרי ש-1-4 עומדים |

סה"כ: **hotfix + 5 commits**, בערך בסדר-גודל של nav-retain עצמו (Complexity ~8-9, calev-heavy).
שלבים 1-2 הם הרוב הקריטי של הערך (מחסלים את קטגוריית ה-race-per-resolver); 4-5 מחסלים את
קטגוריית העותק-הסוטה.

### 6.2 האם הדרגתי? כן — ובקו-עצירה בטוח

אחרי שלב 2 אפשר לעצור ולמזג: ההחלטה טהורה+נבדקת וערוץ-ההשכמה יחיד, גם אם `item.state`
הכפול עוד קיים (facts נגזרים ממנו זמנית). שלבים 3-5 עצמאיים-יחסית זה מזה.
**לא מומלץ** לעצור אחרי שלב 1 בלבד (החילוץ המכני בלי איחוד-ההשכמות משאיר את כל ה-races).

### 6.3 סיכוני רגרסיה ורשתות-ביטחון

- **הטסטים הקיימים** (`audio-playlist.test.ts` 380 ש' + `audio-playlist.nav.test.ts` 604 ש')
  בודקים את ה-API החיצוני — נשארים תקפים. ⚠️ **פער mock↔מציאות שחובה לתקן בדרך**: ה-mock
  מסמן `isComplete=true` רק אחרי `resolvePlay` ("complete אחרי ניגון"), בעוד במציאות
  `isComplete` = stream-הושלם **בלי קשר לניגון** (mp3 `ready` לפני ניגון-ראשון הוא complete).
  הטסטים מקודדים סמנטיקה שגויה → עלולים להעביר קוד שבור ולהכשיל קוד תקין (`nav.test.ts:37-64`).
- **נתיב PCM חי חסום** על מפתח Gemini (אותו חסם של nav-retain) — runtime-gate ידרוש מפתח
  תקין; סטטית אפשר הכל.
- **תזמוני fake-timers**: הפולינג בסגמנטים (20/50ms) נשאר בשלבים 1-2 — טסטים רגישים-לתזמון
  לא אמורים להישבר; שלב 3 מסיר חלק מהפולינג ודורש עדכון טסטים מקומי.
- **‏Svelte reactivity**: `items` נשאר `$state` לתצוגה; ה-snapshot ל-decision הוא read-only
  copy — אין כתיבה-בתוך-effect חדשה (כללי §2.3 ב-design-principles נשמרים).

---

## 7. מה נשאר stateful בהכרח — גבול-ההפרדה (שאלה 5)

| רכיב | טבע | הצדקה |
|---|---|---|
| `PlayableSegment` (mp3/pcm) | ‏imperative גמור | ‏WebAudio/MediaSource הם משאבי-דפדפן עם lifecycle צדדי (sourceopen, onended, suspend). זה ליבו של "engine" לפי §1.3 — נשאר, רק עם חוזה-סיום מתוקן |
| `PlayableSink` | ‏imperative — בעלות-משאב | ‏Map של segments + `#current` + AudioContext משותף. נשאר; החוזה האטומי (play=stop-then-play) הופך מ-fix ל-invariant מוצהר |
| ‏fetch pipeline (Speaker/BubblePlayer) | ‏imperative — IO רשת | ‏synthesize/translate/narrate + AbortControllers. נשאר; מקבל ממשק `SegmentProducer` צר |
| הלולאה `#runLoop` | ‏imperative — דק | ‏interpreter: קורא decision, מבצע await אחד, חוזר. ~40 שורות במקום ~140 |
| `cursor`/`items`/`transport` | ‏$state ריאקטיבי | לתצוגה (PlaybackControls, nowplaying עתידי); mutation רק דרך מתודות-הפלייליסט + `bump()` |
| **`decidePlaylistAction`** | **טהור — core** | כל ה"מה עכשיו". נבדק ממצה בלי דפדפן, בלי timers, בלי mocks |

**הגבול במשפט אחד:** כל מה ש*מחליט* — פונקציה טהורה על snapshot; כל מה ש*ממתין או מפעיל* —
‏shell דק עם ערוץ-השכמה אחד; כל מה ש*מחזיק משאב* — engine עם חוזה אטומי ומסיים-תמיד.

---

## 8. פתוח להכרעת מרדכי (feed ל-brief)

1. **E7 — play-תוך-streaming** (§5.4): להוסיף `playable` ל-facts (משמר first-audio ~1s) או
   לנגן רק buffers שלמים? **מוצע: playable** — first-audio הוא דרישת-מוצר (V4a).
2. **E5 — תור חדש בזמן pause**: האם reserve של תור חדש מבטל pause? **מוצע: כן.**
3. **היקף שלב 0**: hotfix ה-else יכול להיכנס עוד ל-nav-retain (לפני ה-runtime-gate החסום)
   או כ-commit ראשון של ה-redesign. **מוצע: מיד ב-nav-retain** — בלעדיו ה-runtime-gate
   ייכשל על ▶-בועה ממילא.
4. **איחוד OrderAllocator** (§2.3): להעביר להקצאה במקום אחד (הפלייליסט מקצה ב-reserve?) או
   להשאיר שניים עם namespace. אפשר לדחות — לא שורש של אף באג נצפה.
5. **מיקום ה-decision**: core (מוצע — תקדים tts-queue, ניידות-Go) מול `frontend/lib/engines`
   כקובץ טהור. ההשלכה: core לא מכיר "transport" — הטיפוסים יוגדרו ב-core כחלק מהחתימה.
6. **גורל `#reserveTimeoutMs=20s`**: נשאר כרשת-ביטחון (כ-`waitedTooLong`) — לקצר? ה-20ש'
   כבר "כיכבו" בבאג-החוויה של nav-retain.

## נספח א — אינדקס מהיר (file:line @ `3c3a0b7`)

- ‏`audio-playlist.svelte.ts` — resolvers: 86-95 · reserve: 135-168 · markReady/Error: 174-192 ·
  navigate: 284-351 · isComplete-delegation: 359-362 · stop (+איפוס `#stopped` סינכרוני): 368-404 ·
  playLoop: 410-562 · idle-park: 432-444 · replay-path: 452-483 · refetch-gate: 486-491 ·
  regular-play-path: 517-546 · done-בלי-buffer מדלג: 548 · playWithNav (race): 591-600 ·
  waitForItem (+timeout): 607-628
- ‏`playable-sink.ts` — `#current`: 23-25 · play אטומי: 52-61 · pause גורף: 63-74 · cancel: 87-93 ·
  prepareSegment (set ללא בדיקת-ביטול): 34-50
- ‏`segments/mp3-segment.ts` — play-promise (ended/error בלבד): 130-144 · stop=pause בלבד: 152-154 ·
  isComplete: 164-168 · consumeStream (endOfStream על partial): 102-107
- ‏`segments/pcm-segment.ts` — play/scheduleNext (polling 20ms): 99-176 · stop: 188-197 ·
  isComplete=streamDone: 206-208 · waitForSomeData (polling): 225-236
- ‏`speaker.svelte.ts` — enqueue+reserve+thunk: 333-360 · refetchSegment (idempotent): 368-376 ·
  pumpFetchLoop: 378-389 · fetchJob (synthesize→prepare→markReady): 391-478 ·
  stopAndClear (stop+clear כפול): 620-649
- ‏`bubble-player.svelte.ts` — toggle (ה-else האבוד): 58-124 · reserveAndPlay (thunk בלי guard:
  151-168 · cleanup-על-fetch: 203-206)
- ‏commits: `c39bc1e` (fixes 1+2) · `3c3a0b7` (fix 3) · `1328b9d` (merge שאיבד את ה-else) ·
  `ddd49f3` (nav-retain C2 — thunks) · `a16893d` (B1 — toggle תקין)
