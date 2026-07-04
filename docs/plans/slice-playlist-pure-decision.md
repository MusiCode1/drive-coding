# Slice R1 — playlist-pure-decision — תוכנית

> **תאריך**: 2026-07-04
> **סטטוס**: מאושר — אביגיל **READY r3** (r1: 4 findings→תוקנו, כולל היפוך-סדר commits; r2: 3 findings→תוקנו; r3: 0). דוחות: `reports/drive-coding/playlist-pure-decision-avigail-r{2,3}.md`
> **Complexity**: 9/10 (verifier: **calev-heavy**)
> **base**: `slice/playback-nav-retain` @ `3c3a0b7` (קוד-גמור, טרם מוזג ל-dev)
> **depends_on**: `[playback-nav-retain]`
> **רקע**: תוך שעת בדיקה-חיה נמצאו 3 באגים בנתיב-ההשמעה (`c39bc1e`, `3c3a0b7`),
> ובחקירה נמצא באג רביעי (else אבוד ב-merge). כולם מאותה משפחה: החלטות ("מה לנגן
> עכשיו") שזורות בלולאה אימפרטיבית עם 4 ערוצי-השכמה נפרדים. ה-slice מחלץ את
> ההחלטה לפונקציה טהורה ב-core, מאחד את ההשכמה לערוץ אחד, ומתקן את חוזה-הסיום
> של `play()`. זהו הראשון בשרשרת R1→R4 (ר' §2).

## §0 — Pre-flight

### Worktree

```bash
# ⚠️ ה-base הוא slice/playback-nav-retain — לא dev!
git worktree add .worktrees/playlist-pure-decision -b slice/playlist-pure-decision slice/playback-nav-retain
cd .worktrees/playlist-pure-decision
pnpm install && pnpm hooks:install
```

### Run

- טסטים (הליבה של ה-slice — רוב העבודה כאן):
  ```bash
  pnpm --filter @drive-coding/core test
  pnpm --filter @drive-coding/frontend test
  pnpm typecheck
  ```
- ‏BE/FE חיים **לא נדרשים** ל-slice הזה (אין אימות-חי בתוכו — ה-runtime-gate של
  השרשרת ירוץ בנפרד ע"י המתכנן). אין צורך ב-OneCLI/tunnel.

### Browser

לא נדרש. (calev-heavy יריץ build-gate + טסטים; אימות-חי מלא — ברמת השרשרת.)

### Reading list

**must-read לפני**:
- `packages/frontend/src/lib/engines/audio-playlist.svelte.ts` — הקובץ המרכזי שמשוכתב (629 שורות, קרא הכל כולל ההערות ההיסטוריות A2/A3/A4/nav-retain)
- `packages/frontend/src/lib/engines/playable-sink.ts` + `engines/segments/*.ts` (3 קבצים: mp3-segment, pcm-segment, playable-segment)
- `packages/frontend/src/lib/view-models/bubble-player.svelte.ts` — בשביל Commit 0
- `docs/design-principles.md` §1.3 (מה זה engine) + §2.2 (מתי method ולא effect)
- שני קבצי הטסט: `engines/audio-playlist.test.ts`, `engines/audio-playlist.nav.test.ts` — הם ה-spec ההתנהגותי הקיים

**reference בזמן עבודה**:
- `packages/frontend/src/lib/view-models/speaker.svelte.ts` — הצרכן הראשי (reserve/markReady/markError/stop) — לא משתנה ב-slice הזה
- `git show a16893d:packages/frontend/src/lib/view-models/bubble-player.svelte.ts` — הגרסה התקינה של `toggle()` (לפני שה-merge איבד את ה-else)
- `packages/core/src/voice/sentence-boundary.ts` + הטסט שלו ב-`packages/core/tests/voice/sentence-boundary.test.ts` — התקדים למודול core TDD (⚠️ מבנה-הטסטים ב-core **מעורב**: הרוב ב-`tests/` [כולל sentence-boundary, tts-queue], מיעוט co-located [pcm, select]. את הטסט החדש מקם ב-`tests/voice/` — לפי תקדים `tts-queue`, השכן הקרוב ביותר)

## §1 — מטרה

אחרי ה-slice: ההחלטה "מה הפלייליסט עושה עכשיו" חיה בפונקציה טהורה אחת ב-core
(נבדקת ממצה ב-unit, בלי mocks/timers), הלולאה ב-engine היא interpreter דק, וכל
אירוע חיצוני (סגמנט חדש, fetch שהסתיים, ניווט, pause) הוא עדכון-עובדה + אות-השכמה
יחיד. `play()` של sink מסיים תמיד (גם על עצירה) — אין יותר "נטישת" promise ואין
race בניווט. מנקודת-מבט המשתמשת: אותה התנהגות בדיוק (ניגון רציף, prev/next,
pause/resume, ▶ על בועה — שחוזר לעבוד אחרי התיקון ב-Commit 0), בלי הקטגוריה של
באגי קקפוניה/שקט/דילוג-איטי.

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| החזרת ה-else האבוד ב-`BubblePlayer.toggle` | ✅ Commit 0 | — |
| ‏`decidePlaylistAction` + `applyNavigation` טהורים ב-core | ✅ Commit 1 | — |
| חוזה-סיום `play()` (mp3 resolve-on-stop, pcm stop-flag) + `stopCurrent`/`isPlayable` | ✅ Commit 2 | — |
| תיקון ה-mocks (isComplete-אחרי-fetch; השלמת isComplete/isPlayable ל-mock החסר) | ✅ Commit 3 | — |
| שכתוב `#playLoop` ל-interpreter + ערוץ-השכמה יחיד | ✅ Commit 4 | — |
| ‏`SegmentProducer` interface + ביטול-fetch אצל היצרן + מחיקת refetch-thunk/`needsRefetch` | ❌ | ‏slice R3 (`producer-ownership`) |
| מחיקת `item.state` בן 7 הערכים / `playingBubbleId` → נגזרות | ❌ | ‏slice R4 (`state-dedup`) — ב-R1 הם נשארים כ-adapter פנימי |
| ‏pause ממוקד-`#current` (היום גורף על כל ה-segments) | ❌ | ‏R4 |
| ‏mp3 progressive playback (ניגון לפני endOfStream) | ❌ | ‏future — `isPlayable(mp3)` ב-slice הזה ≡ `isComplete` בכוונה |
| ‏R4-ghost (fetchJob ישן קורא markReady אחרי cancel) | ❌ known-limitation שנשאר | ‏R3 (ביטול אצל היצרן סוגר) |
| שינוי UI כלשהו (PlaybackControls/StatusBubble) | ❌ | אין צורך — API חיצוני נשמר |
| ‏smart-advance / nowplaying | ❌ | ‏slices עתידיים (נהנים מהתשתית) |

**כלל-על ל-scope**: החתימות שהצרכנים (Speaker / BubblePlayer / UI) קוראים —
`reserve`, `markReady`, `markError`, `next`, `prev`, `jumpTo`, `jumpToBubble`,
`pause`, `resume`, `stop`, `prepareSegmentForBubble`, `setOnPlaybackStart`,
`state`, `transport`, `items`, `currentSegmentId`, `cursor` — **לא משתנות**.
‏Speaker ו-BubblePlayer לא נערכים ב-slice הזה מלבד Commit 0 (ה-else).

## §3 — Architecture diagram

```
core/voice/
  playlist-decision.ts            ← חדש (Commit 1): decidePlaylistAction + applyNavigation
  playlist-decision.test.ts       ← חדש (Commit 1): TDD ממצה
  tts-queue.ts                    (קיים — OrderKey, לא משתנה)

frontend/src/lib/
  engines/
    audio-playlist.svelte.ts      ← משוכתב (Commit 4): interpreter + bump/changed
    playable-sink.ts              ← Commit 2: stopCurrent() + isPlayable()
    audio-sink.ts                 ← Commit 2: isPlayable?/stopCurrent? (optional, additive)
    segments/playable-segment.ts  ← Commit 2: isPlayable() ב-interface
    segments/mp3-segment.ts       ← Commit 2: resolve-on-stop + ניקוי listeners
    segments/pcm-segment.ts       ← Commit 2: #stopRequested flag
    audio-playlist.test.ts        ← Commit 3: תיקון mock + יישור (לפני השכתוב!)
    audio-playlist.nav.test.ts    ← Commit 3: תיקון mock + יישור (לפני השכתוב!)
  view-models/
    bubble-player.svelte.ts       ← Commit 0 בלבד: החזרת ה-else
    bubble-player.toggle.test.svelte.ts ← חדש (Commit 0): 3 טסטי-רגרסיה
    speaker.svelte.ts             (לא נגעים)
```

זרימת ההחלטה אחרי Commit 4:

```
עובדות: item.state+needsRefetch (adapter) · sink.isPlayable/isComplete · transport · cursor
   │ snapshot()
   ▼
decidePlaylistAction (core, טהור) ──► action: exit|wait|park|play|request-fetch|wait-fetch|skip
   │
   ▼
#runLoop (interpreter דק) ──► sink.play / item.refetch / cursor++ / await #changed(seen)
   ▲
   │ #bump()  ← reserve · markReady · markError · navigate · pause · resume · stop
```

## §4 — Commits

> כל commit ירוק בפני עצמו: `pnpm typecheck && pnpm --filter @drive-coding/frontend test && pnpm --filter @drive-coding/core test`.

### Commit 0 — hotfix: החזרת ה-else האבוד ב-BubblePlayer.toggle (approach: TDD)

**רקע-שורש**: ב-merge `1328b9d` (reconcile מול dev) נמחק ה-`else` בין ענף
`alreadyInPlaylist` לענף "בועה היסטורית" ב-`toggle()`. התוצאה כפולה:
(א) בועה שכבר בפלייליסט — אחרי ה-if/else הפנימי רץ **גם** קוד הענף ההיסטורי
(`stop()` שדורס את ה-jump + `#reserveAndPlay` שמכניס כפילויות);
(ב) בועה היסטורית (לא בפלייליסט) — **שום דבר לא רץ** (▶ מת).
הגרסה התקינה: `git show a16893d:packages/frontend/src/lib/view-models/bubble-player.svelte.ts`
(שורות 103-125 שם).

**קבצים שמשתנים**: `packages/frontend/src/lib/view-models/bubble-player.svelte.ts` —
שחזור המבנה:

```ts
if (alreadyInPlaylist) {
  if (this.#playlist.state === "idle") {
    // carry A4 #1: restart
    this.stop()
    this.playingBubbleId = bubbleId
    this.#abortCtrl = new AbortController()
    void this.#reserveAndPlay(bubbleId, text, this.#abortCtrl)
  } else {
    this.#playlist.jumpToBubble(bubbleId)
    this.playingBubbleId = bubbleId
  }
} else {
  // בועה היסטורית — split + reserve לכל משפט → jumpToBubble
  this.stop()
  this.playingBubbleId = bubbleId
  this.#abortCtrl = new AbortController()
  void this.#reserveAndPlay(bubbleId, text, this.#abortCtrl)
}
```

**קבצים חדשים**: `packages/frontend/src/lib/view-models/bubble-player.toggle.test.svelte.ts`
(תבנית-הרצה כמו `agent-session.watchdog.test.svelte.ts` הקיים; mocks מינימליים —
ה-ctor מקבל הכל בהזרקה: `session` = אובייקט עם `turnState:"idle"` + `bubbles`,
`settings` = stub, `playlist` = stub עם `items`/`state`/`jumpToBubble`/`reserve`/
`prepareSegmentForBubble`/`markReady`/`markError` מרוגלים ב-`vi.fn()`).

שלושת הטסטים (RED לפני התיקון — כתוב אותם קודם וודא שהם נכשלים על הקוד הנוכחי):
1. בועה בפלייליסט + `playlist.state==="playing"` → `jumpToBubble` נקרא **ואף fetch
   חדש לא מתחיל** (`reserve` לא נקרא, `playingBubbleId` נקבע).
2. בועה בפלייליסט + `playlist.state==="idle"` → `#reserveAndPlay` רץ **פעם אחת**
   (`reserve` נקרא בדיוק N פעמים עבור N משפטים — לא 2N).
3. בועה שאינה בפלייליסט (היסטורית) → `reserve` נקרא (הענף ההיסטורי רץ) —
   על הקוד הנוכחי זה נכשל כי כלום לא רץ.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend test -- bubble-player
pnpm typecheck
```

### Commit 1 — core: `playlist-decision.ts` — ההחלטה כפונקציה טהורה (approach: TDD)

**קבצים חדשים**:
- `packages/core/src/voice/playlist-decision.ts`
- `packages/core/tests/voice/playlist-decision.test.ts` (ב-`tests/voice/` — לפי תקדים `tts-queue.test.ts` ו-`sentence-boundary.test.ts`. הערה: ב-core קיים גם מיעוט co-located [`src/voice/{pcm,select}.test.ts`] — **לא** ללכת לפיו כאן)

**אפס נגיעה ב-runtime בקומיט הזה** — המודול נבנה ונבדק בצד; החיווט ב-Commit 4.

**API skeleton (מחייב — לא לשנות חתימות)**:

```ts
// playlist-decision.ts — pure decision core for the audio playlist.
// No IO, no browser globals, no timers. The FE engine builds a snapshot
// and interprets the returned action.

export type FetchState = "idle" | "in-flight" | "failed"

export type SegmentFacts = {
  readonly segmentId: string
  /** Production status — derived by the shell (R1: from item.state+needsRefetch). */
  readonly fetch: FetchState
  /** Sink has enough buffer to start playing (pcm: first chunk; mp3: complete). */
  readonly playable: boolean
  /** Sink holds the full buffer — replay without re-fetch. */
  readonly buffered: boolean
  /** Finished a full natural playback at least once (display / future smart-advance). */
  readonly playedToEnd: boolean
  /** Shell-measured: waited on this fetch longer than the reserve timeout. */
  readonly waitedTooLong: boolean
}

export type PlaylistTransport = "playing" | "paused" | "stopped"

export type PlaylistSnapshot = {
  readonly items: readonly SegmentFacts[]
  readonly cursor: number
  readonly transport: PlaylistTransport
  /** True when the cursor landed here via explicit navigation (retry failed items). */
  readonly explicitVisit: boolean
}

export type PlaylistAction =
  | { kind: "exit" }                             // transport stopped — loop terminates
  | { kind: "wait" }                             // paused — sleep until change
  | { kind: "park" }                             // cursor past end — idle-park until change
  | { kind: "play"; index: number }              // sink.play(items[index])
  | { kind: "request-fetch"; index: number }     // ask producer to (re)synthesize, then wait
  | { kind: "wait-fetch"; index: number }        // fetch in flight — sleep until change/timeout
  | { kind: "skip"; index: number }              // give up on item — advance cursor

export function decidePlaylistAction(s: PlaylistSnapshot): PlaylistAction

export type NavigationDecision = {
  readonly cursor: number
  /** Segment ids whose sink buffers / live fetches must be cancelled (skip-cancel). */
  readonly cancel: readonly string[]
  /** Segment ids to mark "needs re-synthesis on next visit" (R1: reserved+needsRefetch). */
  readonly resetToPending: readonly string[]
}

export function applyNavigation(
  s: PlaylistSnapshot,
  target: number,
  resetTarget: boolean,
): NavigationDecision
```

**לוגיקת `decidePlaylistAction`** (סדר הבדיקות מחייב):
1. `transport === "stopped"` → `exit`
2. `transport === "paused"` → `wait`
3. `cursor >= items.length` → `park`
4. ‏item לא קיים (חור) → `skip`
5. `playable || buffered` → `play` (replay ו-first-play הם מסלול אחד)
6. `playedToEnd` → `skip` — ‏item שנוגן-עד-הסוף אבל ה-buffer כבר לא ב-sink
   (בהכרח `!buffered` — אחרת כלל 5 היה תופס). משמר את ההתנהגות היום: "done ללא
   isComplete → המשך" (דילוג שקט ב-auto-advance). **ביקור מפורש** ב-item כזה
   (prev/jumpTo) מסונתז-מחדש בכל זאת — אבל דרך `applyNavigation.resetToPending`
   (שהופך אותו ל-pending לפני שה-decide רואה אותו), לא דרך הכלל הזה.
7. `fetch === "in-flight"` → `waitedTooLong ? skip : wait-fetch`
8. `fetch === "failed"` → `explicitVisit ? request-fetch : skip`
9. אחרת (`fetch === "idle"`) → `request-fetch`

**לוגיקת `applyNavigation`** (שיקוף של `#navigate` הקיים אחרי שני ה-fixes, במונחי
facts — **עם חריגה מוצהרת אחת**, ר' ⚠️ למטה):
- ‏target מחוץ לטווח (`< 0` או `>= items.length`) → `{ cursor: s.cursor, cancel: [], resetToPending: [] }` (no-op).
- ‏current (ב-`s.cursor`, אם קיים): אם `!buffered` → הוסף ל-`cancel` + `resetToPending`.
- ‏target (אם `!== current` וקיים): אם `resetTarget && !buffered` → הוסף ל-`cancel` + `resetToPending`.
- `cursor = target`.
- (סמנטיקה: `next` נקרא עם `resetTarget=false`; `prev`/`jumpTo`/`jumpToBubble` עם `true` — כמו היום.)

> ⚠️ **החריגה המוצהרת מ-`#navigate` הקיים** (צד ה-current): הקוד הקיים מאפס רק
> ‏state ∈ {playing, ready, reserved, loading} — `done` מוגן ב-guard ולכן
> ‏done-בלי-buffer נשאר done (והלולאה מדלגת בשקט). ה-spec הטהור **מרחיב**: כל
> `!buffered` מאופס, כולל done-בלי-buffer → ביקור חוזר יסנתז מחדש. זהו אותו
> שינוי-התנהגות מוצהר של כלל-6 + ה-invariant (ר' שם) — **אל תשכפל את ה-state-guard
> הישן** לתוך `applyNavigation`; ה-guard הישן הוא בדיוק מה שהופך להתנהגות החדשה.
> (צד ה-target **כן** 1:1 מול הקוד הקיים.)

**טסטים — כיסוי ממצה** (זו הליבה של ה-slice; ~25-35 cases):
- כל ענף של decide (9 הכללים) + הצירופים: `buffered && fetch==="failed"` (buffered
  מנצח — play), `playable && waitedTooLong` (play מנצח), paused-לפני-הכל,
  stopped-מנצח-paused, `playedToEnd && !buffered` → skip (כלל 6 — גם עם
  `explicitVisit=true`: ה-decide עדיין skip; ה-retry המפורש מגיע מ-navigation),
  `playedToEnd && buffered` → play (כלל 5 קודם).
- ‏`park` בדיוק ב-`cursor === items.length`; רשימה ריקה.
- ‏applyNavigation: no-op מחוץ-לטווח · current-in-fetch מבוטל · current-buffered
  נשמר · prev ל-target-buffered לא מבטל (replay) · prev ל-target-in-fetch מבטל ·
  next ל-target-in-fetch לא מבטל (ממשיך להיטען) · target===current (ניווט-עצמי).

**Verification**:
```bash
pnpm --filter @drive-coding/core test -- playlist-decision
pnpm typecheck
```

### Commit 2 — חוזה-סיום ל-play + stopCurrent/isPlayable ב-sink (approach: mixed — TDD היכן שאפשר)

**העיקרון**: `PlayableSegment.play()` מחזיר Promise ש**מסיים תמיד** — resolve על
סוף-טבעי **וגם** על `stop()`. בלי זה, הסרת ה-race ב-Commit 4 תגרום deadlock
(mp3 היום: `stop()` = `audio.pause()` → אירוע `ended` לא נורה → ה-promise תלוי לנצח).

**קבצים שמשתנים**:

1. `engines/segments/playable-segment.ts` — הוספה ל-interface (additive):
```ts
/** Enough data to start playback now (pcm: ≥1 buffer or done; mp3: complete). */
isPlayable(): boolean
```
   ועדכון ה-doc של `play()`: "resolves on natural end **or** on stop()".

2. `engines/segments/mp3-segment.ts`:
   - שדות חדשים: `#playResolve: (() => void) | null`, `#playCleanup: (() => void) | null`.
   - ‏`play()`: שמור את `resolve` ב-`#playResolve` ואת פונקציית הסרת-ה-listeners
     ב-`#playCleanup` (refs ל-`onEnded`/`onError` כדי להסיר ב-stop — היום הם
     `once:true` ונשארים תלויים אם resolve מגיע מבחוץ).
   - ‏`stop()`: `audio.pause()` → `#playCleanup?.()` (הסרת שני ה-listeners) →
     `#playResolve?.()` → איפוס שניהם ל-null. **אסור** לגעת ב-`#state` (נשאר
     `"playing"`→ ה-play הבא יאפס; `isComplete` כבר סובל את זה).
   - ‏guard כפילות: `onEnded` בודק שה-resolver עדיין שלו (השווה ref או בדוק null)
     — מונע double-resolve ו-דריסת `#state="ended"` על play מאוחר יותר.
   - ‏`isPlayable(): boolean` → `return this.isComplete()` (**בכוונה** — mp3 מנגן
     היום רק אחרי endOfStream; progressive = future, לא לשנות).

3. `engines/segments/pcm-segment.ts`:
   - שדה חדש: `#stopRequested = false`.
   - ‏`stop()`: מציב `#stopRequested = true` **לפני** עצירת ה-sources (הקוד הקיים
     נשאר). **באג סמוי מתוקן כאן**: היום אחרי `stop()` באמצע-streaming,
     `scheduleNext` ממשיך לתזמן buffers חדשים שמגיעים מה-stream — הקול "קם לתחייה".
   - ‏`play()`: מאפס `#stopRequested = false` בתחילתו. בתוך `scheduleNext`: בדיקה
     ראשונה — `if (this.#stopRequested) { resolve-once; return }` (resolve, לא
     reject — עצירה היא סיום תקין). אותה בדיקה גם ב-branch של ה-polling
     (`setTimeout(scheduleNext, 20)`).
   - ‏`isPlayable(): boolean` → `return this.#buffers.length > 0 || this.#streamDone`
     (משקף את `#waitForSomeData` — first-audio מוקדם נשמר).

4. `engines/playable-sink.ts`:
```ts
/** Stops the currently playing segment (buffer retained). Its play() resolves. */
stopCurrent(): void {
  this.#current?.stop()
  this.#current = null
}
/** Whether the sink can start playing this segment right now. */
isPlayable(segmentId: string): boolean {
  return this.#segments.get(segmentId)?.isPlayable() ?? false
}
```
   (‏`play()` האטומי הקיים — עוצר `#current` לפני חדש — נשאר; הוא הופך מחוזה-בדיעבד
   לחוזה מתועד ב-doc.)

5. `engines/audio-sink.ts` — additive, optional (mocks ישנים לא נשברים):
```ts
export interface AudioSink {
  // ... existing members unchanged ...
  /** Optional (PlayableSink implements): full buffer retained — replayable. */
  isComplete?(segmentId: string): boolean
  /** Optional: enough buffered to start now. Fallback: isComplete. */
  isPlayable?(segmentId: string): boolean
  /** Optional: stop current playback, keep buffer; its play() promise resolves. */
  stopCurrent?(): void
}
```

**טסטים** (חדשים, ב-`engines/segments/` — סביבת vitest קיימת; WebAudio/MediaSource
לא זמינים ב-JSDOM ⇒ בדוק רק את מה שבדיק לוגית): ל-pcm — `#stopRequested` דרך
מבנה: `play()` על segment עם buffer מדומה... **אם JSDOM חוסם** (אין AudioContext) —
דלג על unit לסגמנטים ותעד ב-walkthrough; הכיסוי האמיתי מגיע מטסטי ה-playlist עם
ה-mock (Commit 3) ומה-runtime-gate של השרשרת. **אל תשקיע ביותר מניסיון אחד** לבנות
harness ל-WebAudio.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend test
pnpm typecheck
```

### Commit 3 — תיקון ה-mocks בשני קבצי-הטסט + יישור assertions (approach: TDD)

> **למה לפני השכתוב** (אביגיל r1, finding מרכזי): ה-mock של `audio-playlist.test.ts`
> חסר `isComplete`/`isPlayable` לגמרי, וה-mock של `nav.test` מסמן complete רק
> אחרי-play. אילו השכתוב היה קודם — רוב הטסטים היו נשברים בדיוק ב-commit הרגיש,
> ומרוקנים את רשת-הביטחון. לכן: קודם מיישרים את הרשת מול **הקוד הקיים** (הכל
> ירוק על nav-retain), ורק אז משכתבים תחתיה.

**הבעיה** (נמצאה בחקירה + אומתה ע"י אביגיל): ב-`audio-playlist.nav.test.ts` ה-mock
מסמן `completedSegments.add(id)` בתוך `resolvePlay` — "complete רק אחרי שנוגן".
במציאות `isComplete=true` בסוף ה-**fetch** (לפני כל play). וב-`audio-playlist.test.ts`
ה-mock בכלל לא מממש `isComplete`/`isPlayable`.

**קבצים שמשתנים**: `engines/audio-playlist.test.ts`, `engines/audio-playlist.nav.test.ts`.

- ‏mock מתוקן (בשני הקבצים — עדיף לחלץ ל-helper משותף `makeMockSink` אחד):
  - ‏`completeSegment(id)` helper מפורש שהטסט קורא (טבעי: מיד אחרי `markReady`) —
    מסמן `completedSegments.add(id)`. ‏`resolvePlay` **לא** נוגע ב-completed.
  - ‏`isComplete: (id) => completedSegments.has(id)` — בשני ה-mocks.
  - ‏`isPlayable: (id) => completedSegments.has(id)` + ‏`stopCurrent: vi.fn()` —
    נוכחים כברירת-מחדל; לפחות טסט אחד מריץ mock **בלי** `isPlayable` (לכיסוי
    ה-fallback `?? isComplete` של Commit 4).
- עדכוני-assertions צפויים ומאושרים (לתעד כל אחד ב-walkthrough):
  - טסט "prev → re-fetch": עם mock נכון, prev ל-item שהושלם-fetch → **replay בלי
    re-fetch** (התנהגות nav-retain הרצויה — הקוד הקיים כבר תומך בה; ה-mock הישן
    הסתיר אותה). ה-assertion מתעדכן בהתאם.
  - ‏re-entry אחרי stop, idle-park, skip-cancel, refetch-once, timeout — כל אלה
    חייבים להישאר מכוסים (אם ניסוח הטסט השתנה — ההתנהגות הנבדקת לא).
- ‏אסור: למחוק טסט התנהגותי בלי תחליף. ‏baseline: **22 it-blocks** בשני הקבצים
  (ספור מחדש לפני תחילה — `grep -c "it(" <file>`); בסוף ה-commit ≥ 22, הכל ירוק
  **על הקוד הקיים** (עוד לא שוכתב דבר).

**Verification**:
```bash
pnpm --filter @drive-coding/frontend test -- audio-playlist   # הכל ירוק על הקוד הקיים
pnpm typecheck
```

### Commit 4 — שכתוב הלולאה: interpreter + ערוץ-השכמה יחיד (approach: manual, מוגן ע"י הרשת המיושרת מ-Commit 3)

**קבצים שמשתנים**: `engines/audio-playlist.svelte.ts` בלבד.

**מה נמחק** (ואסור שיישאר): `#itemResolvers`, `#pauseResolve`, `#navResolve`,
`#parkResolve`, `#waitForItem`, `#waitForResume`, `#waitForNav`, `#playWithNav`,
`#stopped`, שני מסלולי-ה-play הכפולים בלולאה (replay-branch + ready-branch).

**מה נשאר ללא שינוי** (adapter פנימי עד R3/R4): `PlaylistItem` על כל שדותיו
(`state` בן 7 הערכים, `needsRefetch`, `refetch` thunk), `items` כ-`$state`,
`reserve`/`markReady`/`markError` כחתימות, `transport`, `currentSegmentId`,
`prepareSegmentForBubble`, `setOnPlaybackStart`, `#reserveTimeoutMs` (20s).

**מבנה חדש (skeleton מחייב)**:

```ts
export class AudioPlaylist {
  state: AudioPlaylistState = $state("idle")        // הלולאה כותבת (לא נגזרת — ר' הערה)
  transport: AudioPlaylistTransport = $state("playing")
  currentSegmentId: string | null = $state(null)
  items: PlaylistItem[] = $state([])
  #cursor = $state(0)

  // single wake channel — replaces all four resolvers
  #version = 0
  #wake: (() => void) | null = null
  #runPromise: Promise<void> | null = null
  #fetchWaitStartedAt = new Map<string, number>()   // for waitedTooLong
  #explicitVisit = false                            // set by prev/jumpTo/jumpToBubble

  #bump(): void
  /** Sleeps until #bump() — unless version already moved (no lost wake-ups). */
  #changed(seen: number): Promise<void>

  #snapshot(): PlaylistSnapshot                      // builds facts via #factsFor
  #factsFor(item: PlaylistItem): SegmentFacts        // the R1 adapter (see mapping)
  #ensureRunning(): void                             // starts #runLoop if #runPromise===null
  async #runLoop(): Promise<void>                    // the thin interpreter
}
```

**ה-mapping של ה-adapter — `#factsFor` (מחייב, 1:1)**:

| ‏item.state (קיים) | ‏fetch | הערה |
|---|---|---|
| `reserved` + `needsRefetch===true` | `"idle"` | נזרק — ביקור יזמין refetch |
| `reserved` / `loading` (בלי needsRefetch) | `"in-flight"` | ה-fetch הראשוני של Speaker בדרך |
| `error` / `skipped` | `"failed"` | ‏explicitVisit → retry |
| `ready` / `playing` / `done` | `"idle"` | התוצר אצל ה-sink; buffered/playable יכריעו |

- `playable` = `sink.isPlayable?.(id) ?? sink.isComplete?.(id) ?? false`
- `buffered` = `sink.isComplete?.(id) ?? false`
- `playedToEnd` = `item.state === "done"`
- `waitedTooLong` = `Date.now() - (#fetchWaitStartedAt.get(id) ?? now) > #reserveTimeoutMs`

> **‏invariant** (אביגיל r1): אין מצב `done`+`needsRefetch` — `resetToPending` של
> הניווט תמיד מציב `state="reserved"` יחד עם `needsRefetch=true`, ושום מסלול אחר
> לא מסמן needsRefetch. לכן שורת ה-done ב-mapping לא צריכה לבדוק needsRefetch;
> ‏item done-בלי-buffer ב-auto מטופל ע"י כלל 6 של decide (skip — כמו היום).

**ה-interpreter — התנהגות פר-action**:

- `exit` → `return` (ה-`finally` מנקה: `#runPromise=null`, `state="idle"`,
  `currentSegmentId=null`, `#wake=null`).
- `wait` / `park` → ב-park בלבד: `state="idle"`, `currentSegmentId=null` (שימור
  התנהגות nav-retain — מחוון "מדבר" כבה); `await #changed(seen)`; אחרי השכמה
  מ-park: `state="playing"` + `#onPlaybackStart?.()` (שימור ה-cue).
- `wait-fetch` → אם אין רישום ב-`#fetchWaitStartedAt` — רשום עכשיו;
  `await Promise.race([#changed(seen), sleep(remaining)])` — **הטיימר נשאר כאן,
  ב-shell** (זה ה-imperative concern היחיד שנשאר; ה-core רק מקבל `waitedTooLong`
  כעובדה).
- `request-fetch` → `item.needsRefetch=false; item.refetch?.()` (חד-פעמי — ה-gate
  מ-`c39bc1e` נשמר דרך ה-mapping: אחרי הקריאה fetch="in-flight" כי needsRefetch
  ירד ו-state עדיין reserved) + רישום `#fetchWaitStartedAt` + `await Promise.race`
  כמו wait-fetch. אם `refetch===undefined` → `item.state="skipped"` + `cursor++`.
- `skip` → אם `item.state!=="error"` → `item.state="skipped"`; מחק מ-
  `#fetchWaitStartedAt`; `#cursor++`.
- `play` → `item.state="playing"`; `currentSegmentId=id`;
  `await sink.play(id)` בתוך try/catch (שגיאה → כמו skip);
  אחרי: אם `items[#cursor]?.segmentId === id` (לא נווט) → `item.state="done"`,
  `#cursor++`; תמיד `currentSegmentId=null`; מחק את ה-item מ-`#fetchWaitStartedAt`.
  **אין `Promise.race` — ה-play מסיים תמיד** (Commit 2).

**ניווט** (`next`/`prev`/`jumpTo`/`jumpToBubble` — חתימות קיימות):

```ts
#navigate(target: number, resetTarget: boolean, explicit: boolean): void {
  const nav = applyNavigation(this.#snapshot(), target, resetTarget)
  for (const id of nav.cancel) { try { this.#audioStream.cancel(id) } catch {} }
  for (const id of nav.resetToPending) {
    const it = this.items.find((x) => x.segmentId === id)
    if (it) { it.state = "reserved"; it.needsRefetch = true }
    this.#fetchWaitStartedAt.delete(id)
  }
  this.#cursor = nav.cursor
  this.#explicitVisit = explicit          // consumed by next #snapshot
  this.#audioStream.stopCurrent?.()       // the in-flight play resolves NOW
  this.#bump()
}
```
- ‏`next` → `(cursor+1, resetTarget=false, explicit=false)`; `prev` →
  `(cursor-1, true, true)`; `jumpTo(i)`/`jumpToBubble` → `(i, true, true)`.
- ‏guards קיימים נשמרים: ניווט הוא no-op כשהלולאה לא רצה (`#runPromise===null`).
- ‏`#explicitVisit` מתאפס ל-false אחרי בניית snapshot אחד (one-shot).

**‏stop() — נשאר sync (חתימה קיימת)**: `transport="stopped"` →
`#audioStream.stopCurrent?.()` → cancel לכל item לא-סופי (כמו היום) → ניקוי
`items=[]`, `#cursor=0`, `#fetchWaitStartedAt.clear()`, `currentSegmentId=null`,
`state="idle"` → `#bump()`. הלולאה תתעורר, decide→exit, ותצא. `#runPromise`
מתאפס רק ב-`finally` של הלולאה — ו-`#ensureRunning` בודק אותו ⇒ **אין שתי לולאות
במקביל** (סוגר את חשש-R5): reserve מיד-אחרי-stop או ממשיך את הלולאה החיה (decide
יראה transport="playing" מחדש) או מתניע חדשה אחרי שהישנה יצאה — שני המסלולים תקינים.

- ⚠️ `state`/`transport`: הסמנטיקה הקיימת נשמרת בדיוק — `state="playing"` כל עוד
  הלולאה פעילה ולא-חונה (**גם** בזמן wait-fetch בין סגמנטים — לא לגזור מ-
  `currentSegmentId`, זה ישבור את מחוון-"מדבר" של Speaker); ב-pause `state` נשאר
  `"playing"` (ר' ההערה ההיסטורית בראש הקובץ — Speaker.get state תלוי בזה).

**Verification** (הרשת מ-Commit 3 היא ה-spec — כל 22+ הטסטים חייבים להישאר
ירוקים אחרי השכתוב. חריגים מותרים רק אם השכתוב חושף שטסט בדק *מנגנון פנימי*
שנמחק ולא התנהגות — למשל טסט שמרגל ישירות על resolver; עדכון כזה מתועד
ב-walkthrough עם נימוק. שינויי-תזמון: תקן עם `advanceTimersByTimeAsync`/`vi.waitFor`,
לא עם sleeps אמיתיים):
```bash
pnpm --filter @drive-coding/frontend test -- audio-playlist   # הכל ירוק
pnpm --filter @drive-coding/core test
pnpm typecheck && pnpm lint
```

## §5 — DoD

| בדיקה | איך |
|---|---|
| ‏core decide+navigation מכוסים ממצה | `pnpm --filter @drive-coding/core test -- playlist-decision` — כל 9 ענפי decide + 7 תרחישי navigation ירוקים |
| שלושת טסטי ה-toggle של Commit 0 ירוקים (והיו RED לפני) | ‏walkthrough מציג את ריצת-ה-RED; `pnpm --filter @drive-coding/frontend test -- bubble-player` |
| ‏Commit 3 ירוק **על הקוד הקיים** (הרשת יושרה לפני השכתוב) | ‏git log מראה ש-Commit 3 (mocks) קודם ל-Commit 4 (שכתוב); בכל commit הריצה ירוקה |
| כל טסטי הפלייליסט ירוקים אחרי השכתוב | `pnpm --filter @drive-coding/frontend test -- audio-playlist` |
| אף resolver ישן לא שרד | `grep -n "navResolve\|parkResolve\|pauseResolve\|itemResolvers\|playWithNav" packages/frontend/src/lib/engines/audio-playlist.svelte.ts` → 0 תוצאות |
| ‏mp3 play-promise נפתר על stop | טסט/הוכחת-קוד: `stop()` קורא `#playResolve` + מסיר listeners (אם JSDOM חוסם unit — הפניה מדויקת לשורות ב-walkthrough) |
| ‏pcm לא "קם לתחייה" אחרי stop באמצע-stream | `#stopRequested` נבדק בשתי הכניסות של `scheduleNext` (unit אם אפשר, אחרת הפניית-קוד) |
| חתימות הצרכנים לא השתנו | `git diff slice/playback-nav-retain -- packages/frontend/src/lib/view-models/speaker.svelte.ts` → ריק; typecheck 0 |
| סך טסטים ≥ baseline | ‏baseline על ה-base: **22 it-blocks** ב-2 קבצי הפלייליסט (אומת ע"י אביגיל r1; ספור מחדש לפני תחילה — `grep -c "it(" <file>`); בסוף ≥ 22 + החדשים (toggle ×3, core ~25-35) |
| ‏build-gate מלא | `pnpm typecheck && pnpm lint && pnpm test` — ירוק (מלבד 6 הכשלים ה-pre-existing המוכרים: spawn-ENOENT + TLS-cert-Windows, שאינם בפלייליסט) |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| שינוי סמנטי סמוי ב-`state`/`transport` שובר את Speaker.get state / מחוון-"מדבר" | ההערה ההיסטורית A3 בראש `audio-playlist.svelte.ts` | ‏§4/Commit 4 מקבע: state נכתב ע"י הלולאה בדיוק בנקודות של היום; **לא** נגזרת מ-currentSegmentId |
| ‏deadlock אם השכתוב מגיע לפני חוזה-הסיום | ניתוח: mp3 `stop()` לא פותר את ה-play-promise היום | סדר-commits מחייב: 2 לפני 4; ה-DoD בודק resolve-on-stop |
| שכתוב על רשת-ביטחון שבורה (mock חסר isComplete) | אביגיל r1 finding: ה-mock של `audio-playlist.test.ts` ריק מ-isComplete/isPlayable | סדר-commits מחייב: 3 (mocks) לפני 4 (שכתוב); ‏DoD בודק ש-3 ירוק על הקוד הקיים |
| ‏double-resolve / דריסת `#state="ended"` ב-mp3 (listener ישן יורה אחרי replay) | ‏once:true לא מוסר על resolve חיצוני | ‏Commit 2 מחייב `#playCleanup` (הסרת listeners מפורשת) + guard על ה-resolver |
| ‏lost-wakeup: bump בין `#snapshot()` ל-`await #changed` | דפוס check-then-sleep קלאסי | ‏`#changed(seen)` משווה `#version` לפני השינה — bump שקרה מוקדם = חוזרים מיד |
| ‏Svelte 5: `items` הוא `$state` — mutations בתוך async loop | ‏gotcha 2026-05-16 (learnings) + §4 הקיים כבר עושה זאת | אותו דפוס בדיוק כמו הקוד הקיים (mutation ישירה על proxy); אין `$effect` חדש; אין קריאת-state בתוך untrack הפוך |
| ‏i18n lint (עברית בקוד) | ‏pre-commit hook | כל ההערות החדשות בקבצי code — באנגלית (כמו ה-skeletons כאן); אין מחרוזות-UI חדשות בכלל |
| הטסטים הקיימים נשענים על תזמוני-microtask של המימוש הישן | ‏fake timers + `await vi.advanceTimersByTimeAsync` | אם טסט flaky אחרי השכתוב — תקן עם `advanceTimersByTimeAsync`/`vi.waitFor`, לא עם sleeps אמיתיים; תעד |
| ‏regression ב-BubblePlayer מעבר להחזרת ה-else | ‏merge-דריפט (כבר קרה פעם) | ‏Commit 0 הוא diff כירורגי מול הגרסה מ-`a16893d`; שום שינוי אחר בקובץ |

## §7 — Escalation triggers

- אם שימור חתימת `stop()` כ-sync מתגלה כבלתי-אפשרי (למשל: race אמיתי בטסטים בין
  cleanup ללולאה היוצאת) — **עצור ושאל את מרדכי** (המוצא המוכן: async stop +
  עדכון Speaker.#stopAndClear — אבל זה נוגע ב-Speaker, מחוץ ל-scope המוצהר).
- אם מתגלה צרכן נוסף של `AudioPlaylist` / `PlayableSink` שלא ברשימת §2 (grep לפני
  שינוי: `grep -rn "AudioPlaylist\|PlayableSink" packages/frontend/src --include="*.ts" --include="*.svelte"`) — עצור ודווח.
- אם `decidePlaylistAction` לפי 9 הכללים סותר טסט קיים **התנהגותית** (לא סמנטיקת-mock)
  — אל תתקן את ה-core כדי לרצות את הטסט; עצור והצג את הסתירה.
- אם ה-JSDOM harness לסגמנטים דורש יותר מניסיון אחד — דלג (מותר במפורש), אל תשקיע.
- החלטה ארכיטקטונית לא-מכוסה (D1-D50) — כרגיל, parent task.

## §8 — Complexity score

- ‏commits: 5 (סביר-גבוה) → +1
- שכבות: core חדש + engine משוכתב + segments = 3 → +2
- ‏APIs חיצוניים: 0
- ‏async pipeline refactor (הסרת 4 resolvers, ערוץ יחיד) → +2
- ‏state-model refactor (לב ה-slice) → +2
- ‏protocol BE↔FE: 0
- רשת-ביטחון חזקה (22 it-blocks קיימים, מיושרים ב-Commit 3 לפני השכתוב + core TDD חדש) → −0 (לא מוריד score, מוריד סיכון)

**סה"כ: 9/10 → calev-heavy**. ‏phase-verification מומלץ אחרי Commit 4 (הרגיש ביותר).

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | ‏`#explicitVisit` one-shot: מתאפס אחרי snapshot אחד או אחרי play מוצלח? | אחרי snapshot אחד (הפשוט; מספיק כי ה-decide הצמוד לניווט הוא שקובע retry) | ❌ |
| 2 | ‏timeout ל-request-fetch שנכשל שקט (refetch שלא קורא markReady/markError לעולם) | אותו `#reserveTimeoutMs` דרך אותו מנגנון `Promise.race` — ואז skip | ❌ |
| 3 | האם `onPlaybackStart` צריך לירות גם ביציאה מ-wait-fetch ארוך (לא רק park)? | לא — רק כניסת-loop + wake-from-park (שימור התנהגות היום בדיוק) | ❌ |
| 4 | ‏unit לסגמנטים ב-JSDOM (AudioContext/MediaSource חסרים) | ‏best-effort ניסיון אחד; אחרת הפניית-קוד ב-walkthrough + כיסוי דרך mock-playlist | ❌ |

---

## נספח — הקשר לשרשרת R1→R4 (למתכנן; לא לביצוע כאן)

- **R2 `sink-completion-contract` המקורי נבלע ברובו לתוך Commit 2 כאן** (הוקדם —
  ‏Commit 4 תלוי בו). מה שנשאר ל-R4: pause ממוקד-current, ניקויים.
- **R3 `producer-ownership`**: ‏SegmentProducer, ביטול-fetch אצל היצרן, מחיקת
  refetch-thunk/needsRefetch, סגירת R4-ghost.
- **R4 `state-dedup`**: מחיקת `item.state`/`needsRefetch` (ה-adapter `#factsFor`
  נהיה קריאה ישירה ל-producer/sink), `playingBubbleId` → נגזרת, איחוד stop/clear.
