# Slice — playback-nav-retain — פלייליסט ממומש: sink מאוחד + retain-and-replay

> **תאריך**: 2026-07-03
> **סטטוס**: הושלם — 4 commits (2b2dcbf..827f95f). ⚠️ calev-heavy ממתין למפתח Gemini תקין לאימות נתיב PCM (§9 Q3)
> **Complexity**: 9/10 (verifier: **calev-heavy**)
> **base**: `slice/playback-ui` @ `48b3403` (לא dev — קוד הפלייליסט A2–A5 עדיין לא מוזג)
> **depends_on**: `[playback-ui]` (השרשרת A2→A3→A4→A5→B1)
> **מהפך decision**: §9 Q2 (re-fetch-on-nav) + מבנה ה-sink הכפול (RoutingAudioSink)

## §1 — מטרה

היום לחצני ⏮/⏭ "עוצרים" את ההשמעה ל-~20 שניות ואז מדלגים — כי הפלייליסט מאפס
את ה-item ל-`reserved`, מצפה ל-re-fetch שאף אחד לא מפעיל, ונתקע עד
`#reserveTimeoutMs = 20_000`. אחרי הסלייס: הפלייליסט הוא **רשימה ממומשת שנשארת חיה** —
כל סגמנט שהוקרא נשאר בזיכרון כ-buffer מוכן, וניווט (עדין ⏮/⏭ או גס נגיעה-בבועה) הוא
**הזזת-סמן + ניגון-מיָדי**, בלי מחיקה ובלי re-synthesize. אפשר לקפוץ לכל מקום בכל רגע,
גם אחרי שההשמעה הסתיימה.

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| sink מאוחד בעל-יחיד (`PlayableSink`) + `PlayableSegment` mp3/pcm | ✅ | commit 1 |
| retain-and-replay (אל תמחק בניווט; נגן מחדש) | ✅ | commit 0+1 |
| skip-cancel: דילוג על סגמנט **שעדיין ב-fetch** מבטל את הבקשה | ✅ | commit 0+2 |
| re-fetch-on-visit (סגמנט שנזרק/נכשל — סינתוז מחדש מ-cache בביקור מפורש) | ✅ | commit 2 |
| הפלייליסט נשאר navigable אחרי שההשמעה הסתיימה | ✅ | commit 0 |
| אינדיקטור "מתנגן עכשיו" + הדגשת בועה/משפט | ❌ | slice `playback-nowplaying` (תצוגה) |
| auto-advance חכם: סוף מחשבה/כלי→קפוץ-להודעה; כלי-בלי-הודעה→כלי-אחרון | ❌ | slice `playback-smart-advance` (מדיניות) |
| חלון-LRU / eviction לזיכרון | ❌ | future — MVP שומר-הכל-לשיחה (ר' §9 Q1) |
| שינוי חוזה `AudioSink` הציבורי (prepare/play/cancel/clear/pause/resume) | ❌ | נשאר — הרפקטור פנימי |

## §3 — Architecture diagram

```
view-models      Speaker ─────┐   BubblePlayer ──┐   (מחזיקים AudioSink + AudioPlaylist)
                              │  onNeedFetch(id)  │   ← חדש: callback re-fetch
                              ▼                   ▼
engines          AudioPlaylist  (cursor + navigate + playLoop)   ← rework: retain-and-replay
                              │  sink.play/pause/isComplete/cancel
                              ▼
                 PlayableSink (implements AudioSink)   ← חדש: בעלים-יחיד. סופג RoutingAudioSink
                   #segments: Map<id, PlayableSegment>
                        ├── Mp3Segment   (MediaSource + <audio>)   ← מ-AudioStream
                        └── PcmSegment   (WebAudio, retained AudioBuffer[])  ← מ-PcmAudioStream
```

הגבול הפולימורפי עובר מ"**sink שלם**" ל"**סגמנט**": כל לוגיקת מחזור-החיים (retain / replay /
מתי-למחוק) חיה **פעם אחת** ב-`PlayableSink`; רק הקודק (פענוח, seek-לאפס, יצירת source) פר-פורמט.

## §4 — Commits בסדר

### Commit 0 — playlist retain-and-replay + skip-cancel (approach: **TDD**)

**קובץ**: `packages/frontend/src/lib/engines/audio-playlist.svelte.ts`
**טסטים (שכתוב)**: `packages/frontend/src/lib/engines/audio-playlist.nav.test.ts`

מה משתנה ב-`#navigate(newIndex, ...)`:
- **אין** יותר `cancel()` + `state="reserved"` על ה-item הנוכחי אם ה-fetch שלו **הושלם**
  (`sink.isComplete(id) === true`) — פשוט מזיזים cursor + navSignal; ה-buffer נשמר.
- אם ה-item הנוכחי **עדיין ב-fetch** (`isComplete===false`) ומדלגים ממנו → `sink.cancel(id)`
  (abort + drop) + `item.state="reserved"` (ביקור עתידי יפעיל re-fetch). זה כלל ה-**skip-cancel**.
- ה-item היעד: אם `done`/`ready`/`playing` **לא מאפסים** ל-reserved (זו הייתה הבאג) — נגן מחדש.

מה משתנה ב-`#playLoop`:
- נחיתה על item `done`/`ready`/`playing` אחרי ניווט → `await #playWithNav(id)` שמנגן מחדש
  (ה-sink מאפס מיקום; ר' commit 1). **לא** ממתינים ל-markReady.
- נחיתה על item `reserved` **ללא fetch חי** (נזרק/נכשל) → קורא ל-`item.refetch?.()` (thunk שה-owner
  סיפק ב-`reserve()` — ר' finding #1), ואז `#waitForItem` (ההמתנה כעת אמיתית — fetch בדרך).
  `reserved`/`loading` עם fetch-בדרך → ממתין כרגיל.
- **הלולאה לא מתה בסוף**: כשמגיעים ל-`#cursor >= items.length` — במקום לצאת, ממתינים על
  ה-resolver `#navResolve` (idle-park) עד ניווט חדש או `reserve()`/`stop()`. כך הפלייליסט נשאר
  navigable אחרי סוף. **⚠️ שם השדה בפועל `#navResolve`** (התיעוד מדבר על "navSignal" — הערות בלבד).
- **בזמן idle-park: `this.state = "idle"`** (finding #2) — כדי שמחוון "מדבר" יהיה נכון.
  `speaker.state` נגזר מ-`#player.state==="playing"` (`speaker.svelte.ts:98`), וממנו
  `modelStatus.phase` (`view-models/derived/model-status.svelte.ts:32`) והמיקרופון/cue.
  אין להשאיר `"playing"` בדממה. על ניווט חדש → `state="playing"` שוב.
  (זמינות הכפתורים אחרי-סוף מטופלת ב-Commit 3, לא דרך state.)
- **⚠️ idle-park שומר `#playing = true`** (לא מגיע ל-`finally`, ממתין בתוך ה-while) — **זו בכוונה**:
  `next()/prev()` פותחים ב-`if (!this.#playing) return`, אז בלי זה ניווט-אחרי-סוף לא יעבוד.
- **⚠️ idle-park ממתין על `#navResolve`** — אותו שדה של `#playWithNav`. בטוח: ב-idle-park אין
  `play()` in-flight (`#cursor >= items.length`), אז אין תפיסה כפולה של ה-resolver.
- `#reserveTimeoutMs` נשאר — אך רק כרשת-ביטחון ל-fetch אמיתי שנתקע, לא על נתיב-הניווט.

**API skeleton** (תוספות/שינויים ל-`AudioPlaylist`):
```ts
class AudioPlaylist {
  // שינוי: reserve מקבל thunk אופציונלי לסינתוז-מחדש (owner-agnostic — ר' finding #1).
  // ה-thunk מייצר מחדש stream→prepareSegment→markReady/markError לאותו segmentId.
  // Speaker מעביר thunk שמריץ refetchSegment; BubblePlayer מעביר thunk עם הטקסט שלו בסקופ.
  reserve(segmentId: string, orderKey: OrderKey, bubbleId: string, refetch?: () => void): void
  // ה-sink כעת חושף isComplete(id) (ר' commit 1) — הפלייליסט צורך אותו ב-#navigate ל-skip-cancel
}
```
> **finding #1**: המודל הקודם (`onNeedFetch` גלובלי → Speaker) נכשל לסגמנטים של **BubblePlayer** —
> להם אין `TtsJob` ב-Speaker, אז לא היה מאיפה לשלוף טקסט. ה-thunk-פר-item פותר: כל owner צורר
> את מקור-הסינתוז שלו בסקופ. `PlaylistItem` מקבל שדה `refetch?: () => void`.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend test -- audio-playlist
pnpm --filter @drive-coding/frontend typecheck
```
הטסטים החדשים חייבים לוודא: (א) prev/next ל-item `done` מנגן **מיָדית** בלי markReady חוזר;
(ב) item שנשאר `done` (לא `reserved`) אחרי ניווט; (ג) skip על item ב-`loading` קורא `sink.cancel`;
(ד) ניווט אחרי שהלולאה הגיעה לסוף עדיין עובד; (ה) `reserved`-ללא-fetch קורא ל-`refetch` thunk.
+ עדכן את ה-docstring של `nav.test.ts` (אומר "6 tests", יש 7 — finding #7).

### Commit 1 — PlayableSink מאוחד + PlayableSegment (mp3/pcm) (approach: **manual**, browser)

**קבצים חדשים**:
- `packages/frontend/src/lib/engines/playable-sink.ts` — `PlayableSink implements AudioSink`
- `packages/frontend/src/lib/engines/segments/playable-segment.ts` — ממשק `PlayableSegment`
- `packages/frontend/src/lib/engines/segments/mp3-segment.ts` — מ-`audio-stream.ts`
- `packages/frontend/src/lib/engines/segments/pcm-segment.ts` — מ-`pcm-audio-stream.ts`

**נמחקים/נספגים**: `routing-audio-sink.ts`, `audio-stream.ts`, `pcm-audio-stream.ts`
(הלוגיקה הקודֶקית עוברת ל-`*-segment.ts`; מחזור-החיים ל-`PlayableSink`).

**שינוי wiring**: `packages/frontend/src/routes/+layout.svelte:81`
`new RoutingAudioSink(new AudioStream(), new PcmAudioStream())` → `new PlayableSink()`
(הפורמט נבחר פר-סגמנט מ-`opts.format` בתוך `PlayableSink.prepareSegment`).

**API skeleton**:
```ts
interface PlayableSegment {
  readonly segmentId: string
  prepare(stream: ReadableStream<Uint8Array>, ac: AbortController): void // צורך ברקע
  play(): Promise<void>   // מנגן מ-ההתחלה. ניתן לקרוא שוב = replay (mp3: currentTime=0; pcm: sources חדשים)
  pause(): void
  resume(): void
  isComplete(): boolean   // ה-fetch/decode הושלם — buffer שלם וניתן-לניגון-מחדש,
                          // **בלי תלות במצב-הניגון** (finding #4):
                          //   mp3: state ∈ {ready, playing, ended}  (לא רק ready — ended אחרי ניגון!)
                          //   pcm: streamDone === true
  dispose(): void         // teardown מלא (abort + drop + free)
}

class PlayableSink implements AudioSink {
  // prepareSegment: בוחר Mp3Segment/PcmSegment לפי opts.format, שומר ב-#segments (לא מוחק בניווט)
  prepareSegment(id, stream, ac, opts?): Promise<void>
  play(id): Promise<void>            // מאציל ל-segment.play() (replay-able)
  pause(): void; resume(): void      // על ה-current
  isComplete(id): boolean            // חדש — הפלייליסט משתמש בו ל-skip-cancel
  cancel(id): void                   // teardown של סגמנט יחיד (skip-cancel / stop)
  clear(): void                      // teardown של הכל (סוף חיי-פלייליסט)
}
```

**נקודות-קודק קריטיות** (מקור הבאגים אם יפוספסו):
- **PCM**: היום `play()` עושה `seg.buffers.splice(0)` (הרסני) ו-`BufferSourceNode` הוא **חד-פעמי**.
  ב-`PcmSegment`: שמור את ה-`AudioBuffer[]` המפוענחים **בלי splice**; בכל `play()` צור
  `BufferSourceNode` **חדשים** מהמערך השמור. `isComplete()` = `streamDone`.
- **MP3**: `Mp3Segment.play()` חוזר = `audio.currentTime = 0` + `audio.play()` + האזנה-מחדש
  ל-`ended`. `isComplete()` = הזרם נצרך עד `endOfStream()`, כלומר `state ∈ {ready, playing, ended}`
  (**לא רק `ready`** — finding #4; `state` הופך ל-`ended` אחרי ניגון). לא `revokeObjectURL` אלא ב-`dispose()`.

**Verification**: build + preview חי (ר' §0 Run) — calev-heavy מאמת אודיו אמיתי.

### Commit 2 — re-fetch-on-visit wiring (Speaker + BubblePlayer) (approach: **manual**)

**קבצים**: `speaker.svelte.ts`, `bubble-player.svelte.ts`

מודל ה-refetch הוא **thunk פר-item** (finding #1) — כל owner מעביר אותו ב-`reserve()`, בלי `+layout`:
- **Speaker**: כשקורא `#player.reserve(segmentId, orderKey, bid, refetch)` — מעביר
  `refetch = () => this.refetchSegment(segmentId)`. המתודה `refetchSegment(segmentId)`:
  מוצאת את ה-`TtsJob` לפי `segmentId`, **יוצרת `AbortController` חדש** (finding #5 — ה-abort
  הישן כבר בוצע ב-skip-cancel; שימוש חוזר בו יבטל את ה-fetch מיָדית), מאפסת `status="pending"`,
  ומריצה `#pumpFetchLoop()`.
- **BubblePlayer**: ב-`#reserveAndPlay`, כל `reserve()` מקבל thunk שצורר את הטקסט-של-הסגמנט
  + provider בסקופ (יש לו את `parts[i]` — אין תלות ב-`#jobs` של Speaker).
- **retry-on-visit לכשל**: item ב-`error` שמנווטים אליו **מפורשות** → מטופל כ-`reserved` וקורא
  ל-`item.refetch`. auto-advance עדיין מדלג על `error` (ללא retry).

> **finding #3 — עלות a-סימטרית**: re-fetch מ-cache זול רק בנתיב **mp3/ElevenLabs**
> (`x-cache-key`). נתיב **pcm/Gemini חסר cache** → refetch = סינתוז מלא (איטי + quota).
> **מסקנה מחזקת**: לעולם לא לזרוק buffer של pcm שהושלם — retain-and-replay הוא הנתיב
> המהיר; refetch הוא recovery בלבד (לסגמנט שדולג-באמצע-fetch / נכשל).

**Verification**: preview חי — נווט אחורה לסגמנט שנזרק, ודא ניגון (mp3 ~מיָדי מ-cache; pcm סינתוז-מחדש).

### Commit 3 — PlaybackControls: שחרור ה-band-aid + זמינות אחרי-סוף (approach: **manual**)

**קובץ**: `packages/frontend/src/lib/components/chat/PlaybackControls.svelte`

- ה-`isCurrentLoading` (carry A4 #2) שחסם prev/next בזמן `reserved`/`loading` — **מרוכך**:
  ניווט ל-item ממומש הוא מיָדי, אין latency-glitch לחסום. השאר disable רק כשאין לאן לנווט
  (`items.length<2` / קצה).
- **זמינות-אחרי-סוף (finding #2)**: היום `showPlaybackControls = phase ∈ {speaking, pending-tts}`,
  ו-`phase="speaking"` ⟺ `playlist.state="playing"` (חוט: `view-models/derived/model-status.svelte.ts:32`→`speaker.svelte.ts:98`→`#player.state`).
  מכיוון ש-idle-park מחזיר `state="idle"` (Commit 0), הכפתורים היו נעלמים אחרי-סוף. **התיקון**:
  הרחב את תנאי-ההצגה — הצג כפתורי-השמעה כש-`phase ∈ {speaking, pending-tts}` **או**
  `playlist.items.length > 0` (פלייליסט navigable קיים). חושף `playlist.items.length` דרך ה-context
  שכבר קיים (`getAudioPlaylist()` בשורה 23).

**Verification**: preview — אחרי סיום השמעה, ⏮/⏭ עדיין מוצגים ומנווטים; מחוון-מיקרופון חזר ל-idle.

## §5 — DoD

| בדיקה | איך |
|---|---|
| prev/next מנגן **מיָדית** (אין 20ש') על סגמנט שכבר הוקרא | preview חי: הקרא תשובה, ⏮/⏭ — קול מיָדי |
| שום re-synthesize על ניווט לסגמנט מומש | DevTools Network: 0 קריאות-TTS חדשות בניווט אחורה |
| skip על סגמנט שעדיין נטען → הבקשה מבוטלת | Network: הבקשה עוברת ל-cancelled בעת דילוג |
| חזרה לסגמנט שדולג-בזמן-fetch → re-fetch מ-cache | Network: קריאה חדשה, מהירה (cache hit) |
| ניווט עובד גם אחרי סיום ההשמעה | preview: המתן לסוף, ⏮/⏭ עדיין עובדים |
| שני הנתיבים (ElevenLabs mp3 + Gemini pcm) מתנגנים-מחדש נכון | preview: בדוק בכל ספק בנפרד |
| pause/resume/stop לא נשברו | preview: רגרסיה על 3 הכפתורים |
| typecheck 0 · טסטי playlist ירוקים | `pnpm typecheck` · `pnpm test -- audio-playlist` |

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| PCM: ניגון-מחדש נכשל כי `BufferSourceNode` חד-פעמי / buffers עברו splice | קריאת-קוד `pcm-audio-stream.ts:184` | commit 1: שמור buffers בלי splice, source חדש בכל play. calev-heavy מאמת אודיו חי |
| Svelte 5 reactivity על `items[]` | learnings §6 #2 | `items` כבר `$state`; שינויי-state על item דרך החלפת-אובייקט/`.length` נקרא ב-consumers |
| `#nextStartTime` (PCM gap-less clock) מתפזר בניגון-מחדש מאמצע | `pcm-audio-stream.ts:164` | replay מאתחל scheduling ל-`ctx.currentTime`; לאמת אין gap/drift חי |
| זרם שעדיין רץ ברקע כשמדלגים — memory/CPU | תכנון skip-cancel | skip-cancel קורא `dispose()`/`cancel` על in-flight → abort אמיתי של ה-reader |
| הרפקטור שובר את חוזה `AudioSink` לצרכנים | — | חוזה ציבורי לא זז; רק תוספת `isComplete`. Speaker/BubblePlayer/playlist קומפילינג |
| מפתח Gemini שרוף → אי-אפשר לאמת נתיב PCM חי | roadmap 2026-07-01 | **חוסם runtime-gate בלבד** — ר' §9 Q3. brief+אביגיל+commits אפשריים עכשיו |

## §7 — Escalation triggers

עצור ושאל את מרדכי ב-parent task אם:
- MediaSource/WebAudio לא מאפשר ניגון-מחדש (currentTime=0 / fresh source) כפי שהונח — ייתכן צורך בעיצוב-אחר.
- `isComplete` לא ניתן לקבוע חד-משמעית באחד הנתיבים (מרוץ streamDone/endOfStream).
- ה-refetch-on-visit דורש שינוי >50 שורות ב-Speaker (חצייה של גבול playlist↔session מעבר לצפוי).
- מתגלה שה-skip-cancel מתנגש עם lookahead של Speaker (מי הבעלים של ה-AbortController).

## §8 — Complexity score

**9/10** → **calev-heavy**. פרמטרים: refactor של state model (+2), streaming/async pipelines
(+2), 4 commits, 4 קבצים חדשים/נספגים בשכבת engine, 2 נתיבי-אודיו (WebAudio + MediaSource).
אין שינוי protocol BE↔FE. אימות חי חובה (אודיו אמיתי בשני הספקים).

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | זיכרון: שמור-הכל-לשיחה מול חלון-LRU+cache | **שמור-הכל** (אושר ע"י המשתמשת); LRU=future | ❌ |
| 2 | retry-on-visit לסגמנט שנכשל | **כן** בניווט מפורש; auto-advance מדלג (אושר) | ❌ |
| 3 | אי-אפשר לאמת נתיב PCM/Gemini חי (מפתח שרוף) | brief+אביגיל+commits עכשיו; **runtime-gate של calev-heavy ממתין למפתח TTS תקין** | 🟡 חוסם merge בלבד |
| 4 | בעלות ה-AbortController ל-skip-cancel (Speaker `job.abort` מול sink `ac`) | ה-sink מחזיק את ה-`ac` שהועבר ב-prepareSegment; `cancel`/`dispose` קוראים `ac.abort()` | ❌ |
