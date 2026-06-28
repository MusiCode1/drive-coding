# Slice A2 — AudioPlaylist + reserve‑on‑enqueue — תוכנית

> **תאריך**: 2026-06-28
> **סטטוס**: 🔴 **calev-heavy NO-GO** — BUG-1 (סדר-השמעה, לב ה-DoD): סגמנט נשמט כש-reserve נופל מאחורי cursor רץ. דורש fix-in-place + re-verify. (אביגיל r1 READY; build ירוק 378/378; `reports/drive-coding/A2-calev.md`)
> **Complexity**: 8/10 (verifier: **heavy** — state‑model refactor + streaming)
> **תלות**: [] · **base**: `dev` @ `3a23195` (A1 בוטל — ר' roadmap §הפירוק)
> **שייך ל**: `docs/plans/playback-run-control-roadmap.md` (ראש השרשרת הנקייה)

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/playback-core-a2 -b slice/playback-core-a2 dev
cd .worktrees/playback-core-a2
pnpm install && pnpm hooks:install
```

### Run / Browser / OneCLI
- כמו A1. **אימות סדר דורש TTS חי** → BE עם `onecli run --agent voice-acp`, Gemini‑TTS
  בהגדרות (ה‑race בולט שם), משפט ארוך מרובה‑סגמנטים.

### Reading list
**must-read**:
- `packages/frontend/src/lib/engines/player.svelte.ts` — ה‑`Player` כולו (מקור ה‑refactor).
- `packages/frontend/src/lib/engines/audio-sink.ts` — interface `AudioSink` + `SegmentOpts`.
- `packages/frontend/src/lib/view-models/speaker.svelte.ts` — §`#enqueue` (322‑343),
  §`#fetchJob` (358‑431), §`#pumpFetchLoop` (345‑356).
- `packages/core/src/voice/tts-queue.ts` — `OrderedQueue`/`OrderKey`/`compareOrderKey`.
- `docs/plans/playback-run-control-roadmap.md` — §עיקרון מאחד.

**reference**:
- `pcm-audio-stream.ts` / `audio-stream.ts` — איך `play()` כבר ממתין על `loading` (לא משנים כאן).

## §1 — מטרה

אחרי הסבב: סגמנטים מושמעים תמיד **בסדר הכרונולוגי הנכון** — גם ב‑Gemini, גם תחת fetch
מקבילי שחוזר הפוך. הסיבה: כל סגמנט נכנס לפלייליסט **בזמן ה‑enqueue** (לא אחרי ה‑fetch),
וה‑cursor ממתין לסגמנט המוקדם‑בתור עד שה‑streaming שלו מתחיל — או, אם נתקע מעבר ל‑timeout,
מדלג עליו וממשיך. זה גם המבנה שעליו A3 (pause/stop) ו‑A4 (prev/next) ייבנו.

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| `AudioPlaylist` engine (refactor מ‑`Player`) | ✅ | — |
| reserve‑on‑enqueue + markReady/markError | ✅ | — |
| cursor + items[] עם state פר‑סגמנט | ✅ | — |
| המתנה‑לסגמנט‑בתור + timeout→skip | ✅ | — |
| pause / resume / stop | ❌ | A3 |
| next / prev / jumpTo | ❌ | A4 (cursor כבר קיים כאן) |
| איחוד BubblePlayer | ❌ | A4 |
| שינוי ב‑AudioSink (`play`/`prepareSegment`) | ❌ | משתמשים כמו שהם |

## §3 — Architecture diagram

```
engines/audio-playlist.svelte.ts (היה player.svelte.ts — refactor)
  items: PlaylistItem[]  (ממוין לפי orderKey, לא נמחק)
  cursor: number
  reserve(segmentId, orderKey)  ← Speaker.#enqueue (מיד)
  markReady(segmentId)          ← Speaker.#fetchJob (אחרי prepareSegment)
  markError(segmentId)          ← Speaker.#fetchJob (catch)
  #playLoop: נע על cursor; ממתין על item עד ready/timeout → play(id) דרך AudioSink

view-models/speaker.svelte.ts
  #enqueue   → + playlist.reserve(segmentId, orderKey)
  #fetchJob  → markReady/markError במקום player.addSegment
```

`AudioSink` (PcmAudioStream / AudioStream / RoutingAudioSink) — **ללא שינוי**.

## §4 — Commits

### Commit 0 — `AudioPlaylist` skeleton + reserve/markReady (approach: manual)

**קבצים חדשים**: `packages/frontend/src/lib/engines/audio-playlist.svelte.ts`
**קבצים שמוסרים**: `player.svelte.ts` (תוכן עובר ל‑audio‑playlist; rename לוגי)
**dead code שלא מועבר** (אביגיל #1): `jumpToSegment` (public method ב‑`player.svelte.ts:48`, **0 צרכנים** בכל ה‑codebase) — נמחק, לא מועתק. ה‑cursor + `jumpTo` (A4) מחליפים אותו.

**API skeleton**:
```ts
export type PlaylistItemState =
  | "reserved" | "loading" | "ready" | "playing" | "done" | "error" | "skipped"

export type PlaylistItem = {
  orderKey: OrderKey
  segmentId: string
  state: PlaylistItemState
}

export class AudioPlaylist {
  state: "idle" | "playing" = $state("idle")          // transport מלא ב-A3
  currentSegmentId: string | null = $state(null)
  items: PlaylistItem[] = $state([])                  // ממוין; reactive לתצוגה עתידית

  constructor(audioStream: AudioSink, onPlaybackStart?: () => void,
              opts?: { reserveTimeoutMs?: number })   // default 20_000

  /** מכניס item ממוין לפי orderKey, state=reserved. מתחיל #playLoop אם idle. */
  reserve(segmentId: string, orderKey: OrderKey): void
  /** ה-stream מוכן ב-AudioSink (prepareSegment הסתיים). reserved/loading → ready. */
  markReady(segmentId: string): void
  /** ה-fetch נכשל. → error (ה-#playLoop ידלג). */
  markError(segmentId: string): void

  stop(): void   // קיים — מנקה הכל (A3 ירחיב ל-pause/resume)
}
```
- `reserve` עושה sorted‑insert לפי `compareOrderKey` (כמו `OrderedQueue.insert`).
- `items` הוא `$state` (לקראת תצוגת פלייליסט ב‑B1) — שים לב לכללי reactivity על מערך.

**Verification**: `pnpm --filter @drive-coding/frontend test` + typecheck.

### Commit 1 — `#playLoop` עם cursor + המתנה + timeout (approach: manual)

**קבצים שמשתנים**: `audio-playlist.svelte.ts`

- `#playLoop`: כל עוד `cursor < items.length`:
  - `item = items[cursor]`.
  - אם `state ∈ {reserved, loading}` → המתן (poll ~20ms או signal) עד `ready`/`error`,
    או עד `reserveTimeoutMs` → `markSkipped` + `cursor++` + continue.
  - אם `state === ready` → `state=playing`, `currentSegmentId=id`, `await audioStream.play(id)`
    (catch → skip), אז `state=done`, `cursor++`.
  - אם `state ∈ {error, skipped}` → `cursor++`.
- `state` (idle/playing) נגזר מ‑`#playLoop` כמו ב‑`Player` הקיים.
- **לא מסירים items** (cursor‑based) — שונה מ‑`takeNext()` הישן. זה מה שמאפשר prev/next ב‑A4.

**Verification**: integration test (Commit 2).

### Commit 2 — integration tests לסדר (approach: TDD/integration)

**קבצים חדשים**: `packages/frontend/src/lib/engines/audio-playlist.test.ts`

- mock `AudioSink` שמשהה `play()` עד שמסומן ready ידנית, ופותר לפי בקשה.
- **תרחיש הסדר ההפוך**: `reserve(s0,seq0)`, `reserve(s1,seq1)`; `markReady(s1)` לפני `markReady(s0)`
  → ה‑playLoop משמיע **s0 לפני s1** (ממתין ל‑s0 שהגיע מאוחר).
- **timeout**: `reserve(s0)` בלי markReady; אחרי `reserveTimeoutMs` (mock timers) → s0 `skipped`,
  s1 מתנגן.
- **error skip**: `markError(s0)` → s0 מדולג, s1 מתנגן.

**Verification**: `pnpm --filter @drive-coding/frontend test -- audio-playlist`

### Commit 3 — חיווט Speaker ל‑reserve/markReady (approach: manual)

**קבצים שמשתנים**: `speaker.svelte.ts`

- ב‑constructor: `new AudioPlaylist(...)` במקום `new Player(...)`.
- `#enqueue` (וה‑enqueue של tool ב‑`#processToolBubbles`): אחרי הקצאת `orderKey` →
  `this.#player.reserve(segmentId, orderKey)`. **שמור על אותו `segmentId`** שנשמר ב‑job.
  ⚠️ (אביגיל #2) ה‑`segmentId` נוצר היום inline ב‑push (`segmentId: crypto.randomUUID()`, `speaker.svelte.ts:333`) → extract‑to‑var לפני ה‑reserve. ה‑`orderKey` כבר משתנה (331), אז חצי מהדרישה עומדת.
- `#fetchJob`: אחרי `await this.#audioStream.prepareSegment(...)` → `markReady(segmentId)`
  (במקום `addSegment`). ב‑`catch` (MIN‑5) → `markError(segmentId)`.
- `#stopAndClear`: `player.stop()` כבר קיים — ודא שהוא מנקה items+cursor.

**Verification**: typecheck + `pnpm --filter frontend test` + אימות חי (DoD).

## §5 — DoD

| בדיקה | איך |
|---|---|
| סדר נכון תחת markReady הפוך | integration test (Commit 2) ירוק |
| timeout → skip, ממשיך | integration test ירוק |
| error → skip | integration test ירוק |
| אימות חי Gemini: 4+ משפטים ארוכים → סדר נכון | האזנה ב‑preview (כלב heavy) |
| אימות חי ElevenLabs: עדיין תקין (regression) | האזנה |
| `#enqueue`/`#fetchJob` קוראים reserve/markReady | קריאת diff |
| build‑gate | typecheck + core test + frontend test ירוקים |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| WebAudio/MediaSource לא ב‑JSDOM | README §1 + audio‑stream.ts הערה | ה‑integration test מ‑mock‑מ `AudioSink` (לא נוגע ב‑WebAudio אמיתי). אימות חי ב‑browser. |
| Svelte 5 reactivity על `items` array | learnings; README §6 #2 | mutate דרך החלפת מערך/`items = [...]` או reactive‑safe; קרא `.length` בצרכנים. |
| ה‑`#playLoop` נכנס re‑entrant פעמיים | Player קיים — `#playing` guard | שמר את ה‑guard. |
| timeout מבטל סגמנט שכן יגיע (false skip) | החלטה #6 ב‑roadmap | `reserveTimeoutMs=20s` נדיב; רק safety‑net. |
| segmentId לא תואם בין reserve ל‑prepareSegment | — | אותו `job.segmentId` בשני המקומות; integration test מוודא. |

## §7 — Escalation triggers

- ה‑`AudioSink.play()` הקיים לא מסתדר עם המתנה‑לפני‑prepareSegment (race) → שאל מרדכי
  (אולי צריך `prepareSegment` להיקרא לפני `play` תמיד — לאשר את ה‑contract).
- מסתבר ש‑BubblePlayer גם תלוי ב‑`Player` (לא רק Speaker) → scope creep, שאל.
- WebAudio gap‑less (`#nextStartTime` ב‑PcmAudioStream) נשבר עם cursor‑replay → A3/A4, סמן.

## §8 — Complexity score

8/10: state‑model refactor (+2), streaming pipeline (+2), 4 commits (+1), engine חדש (+1),
חיווט VM (+1), reactivity risk (+1). → **verifier: heavy** (calev‑heavy), עם phase‑verify על Commit 1.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | rename הקובץ `player.svelte.ts`→`audio-playlist.svelte.ts` או להשאיר שם? | rename (משקף את המודל החדש) | ❌ |
| 2 | `reserveTimeoutMs` — 20s? | 20s (החלטת roadmap #6) | ❌ |
| 3 | המתנה ב‑`#playLoop` — poll 20ms או event/Promise per‑item? | poll 20ms (פשוט, עקבי עם AudioSink הקיים) | ❌ |
| 4 | `items` reactive עכשיו או רק ב‑B1? | reactive עכשיו (`$state`) — חוסך refactor ב‑B1 | ❌ |
