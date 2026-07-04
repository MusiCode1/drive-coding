# Slice R3 — producer-ownership — תוכנית

> **תאריך**: 2026-07-04
> **סטטוס**: מאושר — אביגיל READY r2 (r1: 4 findings confusion/framing → תוקנו)
> **Complexity**: 8/10 (verifier: **calev-heavy**)
> **base**: `slice/playlist-pure-decision` @ `9c13140` (R1 — calev GO, טרם מוזג)
> **depends_on**: `[playlist-pure-decision]`
> **רקע**: שני בשרשרת R1→R4. R1 חילץ את ההחלטה ל-core והשאיר את ה-`fetch` כ-adapter
> זמני (`#factsFor` ממפה `item.state`+`needsRefetch`). R3 מוציא את **בעלות-ה-fetch**
> מהפלייליסט ליצרן דרך `SegmentProducer`, מוחק את ה-`refetch` thunk + `needsRefetch`,
> וסוגר את ה-ghost-bug (fetchJob ישן קורא markReady/markError אחרי cancel). R4 (הבא)
> ימחק את `item.state` הנותר.

## §0 — Pre-flight

### Worktree

```bash
# ⚠️ base = slice/playlist-pure-decision (R1), לא dev ולא nav-retain!
git worktree add .worktrees/producer-ownership -b slice/producer-ownership slice/playlist-pure-decision
cd .worktrees/producer-ownership
pnpm install && pnpm hooks:install
```

### Run

- ‏slice **טסטים-בלבד** — אין BE/FE חיים, אין OneCLI, אין preview. אימות = vitest + typecheck.
- ‏אימות-חי (preview/Gemini) ברמת-השרשרת ע"י המתכנן אחרי R4, לא כאן.
- ‏הרצת טסטים: מ-root. ⚠️ `packages/core` **אין לו** `test` script — הרץ core דרך root
  `npx vitest run <pattern>` או `pnpm --filter @drive-coding/frontend test`.

### Browser
לא נדרש.

### Reading list

**must-read לפני**:
- `packages/frontend/src/lib/engines/audio-playlist.svelte.ts` (539 שורות — הקוד המשוכתב של R1;
  קרא במיוחד `#factsFor` [356-395], `#navigate` [252-276], `reserve` [128-151], `request-fetch`
  [454-481], `stop` [283-302])
- `packages/frontend/src/lib/view-models/speaker.svelte.ts` — היצרן הראשי. קרא: `#jobs`+`TtsJob`
  [54-69], `#enqueue` [333-360], `refetchSegment` [368-376], `#pumpFetchLoop` [378-389],
  `#fetchJob` [391-478], `#stopAndClear` [620-649]
- `packages/frontend/src/lib/view-models/bubble-player.svelte.ts` — היצרן השני. קרא `#reserveAndPlay`
  [131-208] (ה-thunk-בסקופ שיוחלף ב-producer)
- `packages/core/src/voice/playlist-decision.ts` — `SegmentFacts.fetch` (לא משתנה; רק המקור שלו)
- `reports/drive-coding/playlist-pure-decision-calev.md` §F1 — חוב-הרשת ל-stop-during-play (Commit 4 כאן סוגר)

**reference**:
- ה-decision entry ב-`docs/decisions/voice-acp.md` (R1 — כולל 2 הסטיות של `#factsFor` ש-R3 מבטל)

## §1 — מטרה

אחרי ה-slice: מקור-האמת ל"האם יש fetch חי/נכשל לסגמנט" הוא **היצרן** (Speaker/BubblePlayer)
דרך `SegmentProducer`, לא עותק-מצב בפלייליסט. ה-`refetch` thunk וה-`needsRefetch` נמחקים;
ביטול-fetch עובר ליצרן (שמבטיח: אין markReady/markError מאוחר אחרי cancel → ghost-bug סגור);
ושתי הסטיות של `#factsFor` (R1) מוחלפות בקריאה ישירה ל-`producer.fetchState()`. מנקודת-מבט
המשתמשת: **אותה התנהגות בדיוק** (ניגון, prev/next, retain-replay) — אין שינוי נראה. זהו refactor
מבני שמכין את R4.

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| ‏`SegmentProducer` interface + מימוש ב-Speaker + BubblePlayer | ✅ Commit 1-3 | — |
| ‏`reserve(…, producer?)` מחליף `reserve(…, refetch?)` | ✅ Commit 1 | — |
| ‏Playlist מחזיק `Map<segmentId, SegmentProducer>` | ✅ Commit 1 | — |
| מחיקת `refetch?` + `needsRefetch?` מ-`PlaylistItem` | ✅ Commit 4 | — |
| `#factsFor.fetch` ← `producer.fetchState()` (מבטל 2 סטיות R1) | ✅ Commit 4 | — |
| ביטול-fetch אצל היצרן (`cancelFetch`) — סוגר ghost | ✅ Commit 2-4 | — |
| ‏F1 [MED] — טסט stop-during-play | ✅ Commit 5 | — |
| מחיקת `item.state` בן 7 הערכים / `playingBubbleId`→נגזרת | ❌ | ‏R4 (`state-dedup`) — `item.state` נשאר ל-playing/done/skipped |
| ‏pause ממוקד-`#current` | ❌ | ‏R4 |
| שינוי `decidePlaylistAction`/`applyNavigation` (core) | ❌ | לא נוגעים — `SegmentFacts` זהה, רק המקור |
| שינוי UI/חתימות-הצרכן החיצוניות (next/prev/pause/…) | ❌ | רק `reserve` משנה פרמטר-אחרון |

**כלל-על**: החתימות הציבוריות `next/prev/jumpTo/jumpToBubble/pause/resume/stop/markReady/markError/
prepareSegmentForBubble/setOnPlaybackStart/state/transport/items/currentSegmentId/cursor` — **לא
משתנות**. רק `reserve` מחליף פרמטר רביעי (`refetch?: ()=>void` → `producer?: SegmentProducer`).

## §3 — Architecture diagram

```
core/voice/playlist-decision.ts        (לא משתנה — SegmentFacts.fetch זהה)

frontend/src/lib/
  engines/
    segment-producer.ts                ← חדש (Commit 1): interface SegmentProducer
    audio-playlist.svelte.ts           ← Commit 1 (Map<id,producer>, reserve param), Commit 4 (#factsFor)
  view-models/
    speaker.svelte.ts                  ← Commit 2: implements SegmentProducer (ensureFetch/cancelFetch/fetchState)
    bubble-player.svelte.ts            ← Commit 3: implements SegmentProducer (job-map)
    speaker.producer.test.svelte.ts    ← חדש (Commit 2)
    bubble-player.producer.test.svelte.ts ← חדש (Commit 3)
  engines/audio-playlist.*.test.ts     ← Commit 4 (mock producer) + Commit 5 (stop-during-play)
```

זרימת ה-fetch אחרי R3:

```
Speaker/BubblePlayer.reserve(id, key, bid, THIS)   ← מעביר ref לעצמו כ-producer
   │
   ▼
Playlist: #producers.set(id, producer); items.push({... no thunk, no needsRefetch})
   │ #factsFor(item):
   │   fetch = #producers.get(id)?.fetchState(id) ?? "idle"     ← מקור-אמת חי
   ▼
decide → request-fetch → #producers.get(id)?.ensureFetch(id)    ← יצרן מסנתז
decide → (navigate) → #producers.get(id)?.cancelFetch(id)       ← יצרן מבטל, אין markReady מאוחר
```

## §4 — Commits

> כל commit ירוק: `pnpm typecheck && npx vitest run <patterns>` לפני git add.
> ⚠️ סדר: 1 (interface+wiring) → 2 (Speaker) → 3 (BubblePlayer) → 4 (מחיקת thunk+#factsFor) → 5 (F1 test).
> ה-Commit-ים 1-3 שומרים את ה-thunk **במקביל** ל-producer (dual-write) כדי שכל commit ירוק; Commit 4 מוחק את ה-thunk.

### Commit 1 — `SegmentProducer` interface + Playlist wiring (approach: manual)

**קבצים חדשים**: `packages/frontend/src/lib/engines/segment-producer.ts`

```ts
import type { FetchState } from "@drive-coding/core/voice/playlist-decision"

/**
 * A producer owns the TTS fetch lifecycle for the segments it reserved.
 * The playlist asks it "what's the fetch state?" and tells it "(re)fetch / cancel".
 * Idempotent by contract: ensureFetch on a live/ready fetch is a no-op;
 * cancelFetch guarantees no later markReady/markError for that segment.
 */
export interface SegmentProducer {
  /** Start (or restart) synthesis for a segment that is not buffered and not in-flight. Idempotent. */
  ensureFetch(segmentId: string): void
  /** Abort any live fetch; guarantee no subsequent markReady/markError for this segment. */
  cancelFetch(segmentId: string): void
  /** Current production status: in-flight (pending/fetching) | failed (error) | idle (none/done). */
  fetchState(segmentId: string): FetchState
}
```

**קבצים שמשתנים**: `audio-playlist.svelte.ts`
- הוסף `#producers = new Map<string, SegmentProducer>()`.
- ‏`reserve` — פרמטר רביעי הופך ל-`producer?: SegmentProducer` (**החלף** את `refetch?: () => void`).
  שמור `if (producer) this.#producers.set(segmentId, producer)`. **השאר את שדה ה-thunk ב-PlaylistItem
  לפי שעה** (dual-write — נמחק ב-Commit 4). ה-item ממשיך לקבל `refetch: undefined` (אין קורא חדש).
  > ⚠️ **INVASIVE**: `reserve` היא חתימה ציבורית. Speaker+BubblePlayer מעדכנים בו-commit (2,3).
    כדי ש-Commit 1 יהיה ירוק לבדו — הפוך את הפרמטר ל-**union זמני**: `producer?: SegmentProducer | (() => void)`,
    וזהה: אם `typeof === "function"` → התנהגות ישנה (thunk), אחרת producer. ה-union נמחק ב-Commit 4.
    (חלופה: dispatch את 2+3 באותו PR — אבל ה-union שומר commit- ירוקים בלי big-bang.)
- ‏`stop` + `#stopAndClear`-equivalent: נקה `#producers.clear()` (ב-`stop`, ליד `items=[]`).
- **`request-fetch` ו-`#navigate` נשארים על ה-thunk** בינתיים (Commit 4 מעביר ל-producer).

**Verification**: `pnpm typecheck` (union לא שובר את הקוראים הישנים); `npx vitest run audio-playlist` — 22/22.

### Commit 2 — Speaker implements SegmentProducer (approach: TDD)

**קבצים שמשתנים**: `speaker.svelte.ts`
- `export class Speaker implements SegmentProducer`.
- ‏`fetchState(segmentId): FetchState`:
  ```ts
  fetchState(segmentId: string): FetchState {
    const job = this.#jobs.find((j) => j.segmentId === segmentId)
    if (job === undefined) return "idle"
    if (job.status === "pending" || job.status === "fetching") return "in-flight"
    if (job.status === "error") return "failed"
    return "idle" // ready ⇒ product handed to sink; no live production
  }
  ```
- ‏`ensureFetch(segmentId)`: **בדיוק `refetchSegment` הקיים** (368-376), rename + guard זהה
  (`fetching`/`ready` → no-op). השאר `refetchSegment` כ-alias שקורא ל-`ensureFetch` (BubblePlayer/dual-write).
- ‏`cancelFetch(segmentId)`:
  ```ts
  cancelFetch(segmentId: string): void {
    const job = this.#jobs.find((j) => j.segmentId === segmentId)
    if (job === undefined) return
    job.canceled = true          // NEW flag on TtsJob — see below
    try { job.abort.abort() } catch {}
  }
  ```
- **`TtsJob` [56-69] הוסף שדה** `canceled?: boolean` (אין שדה כזה היום; יש `abort: AbortController` [61]).
  **סגירת ה-ghost — בדיוק 2 נקודות** (אביגיל אימתה את מבנה `#fetchJob` [391-478]):
  1. **לפני `markReady` [463]** — ה-`markReady` הוא **bare** (בגוף ה-try, אחרי 2 awaits: `synthesize` [450]
     + `prepareSegment` [457]). אם `job.canceled` נקבע בזמן ה-await של `prepareSegment`, הוסף
     `if (job.canceled) return` **בין [457] ל-[463]** — לפני `markReady`.
  2. **בתוך ה-`catch` לפני `markError` [469]** — `if (job.canceled) return` (abort זורק → נופל ל-catch → אל תקרא markError).
  > ⚠️ ה-`finally` [474-477] **אינו** נקודת-ghost — הוא רק `pendingCount -= 1`, לא נוגע ב-playlist. אל תוסיף שם guard.
  > תקדים קיים: יש כבר `if (job.abort.signal.aborted)` ב-[426] (אחרי translate/narrate) — הרחב את אותה תבנית ל-`job.canceled`.
- ‏`#enqueue` [358] + `#processToolBubbles` [539]: `this.#player.reserve(segmentId, orderKey, bid, this)`
  (מעביר `this` כ-producer במקום ה-thunk `() => this.refetchSegment(segmentId)`).
- ‏`#stopAndClear`: אפס `job.canceled` בעת ניקוי (jobs חדשים).

**קובץ חדש**: `speaker.producer.test.svelte.ts` — TDD:
- ‏`fetchState`: pending→in-flight, fetching→in-flight, error→failed, ready→idle, לא-קיים→idle.
- ‏`ensureFetch` אידמפוטנטי: על job ready/fetching → no-op (לא מגדיל pendingCount).
- ‏`cancelFetch` → job.canceled=true, abort נקרא; ואז `#fetchJob` שממשיך **לא** קורא markReady (ghost).
  (mock ל-`translate`/`synthesize`/`resolveTts` — כבר יש תקדים ב-`speaker.*.test` קיימים; חקה.)

**Verification**: `npx vitest run speaker`; `pnpm typecheck`.

### Commit 3 — BubblePlayer implements SegmentProducer (approach: TDD)

**רקע**: היום `#reserveAndPlay` [131-208] יוצר **thunk פר-סגמנט בסקופ** (`refetch` עם `partText`+provider).
R3 מחליף אותו ב-job-map קטן שה-BubblePlayer מחזיק, ומ implements SegmentProducer.

**קבצים שמשתנים**: `bubble-player.svelte.ts`
- `implements SegmentProducer`.
- הוסף `#jobs = new Map<string, { text: string; provider…; voiceId; modelId; abort: AbortController; status: "pending"|"fetching"|"ready"|"error"; canceled: boolean }>()`.
- ‏`#reserveAndPlay`: במקום ליצור thunk — רשום job ל-`#jobs` פר-segmentId (עם partText+provider בסקופ),
  ו-`reserve(segmentId, orderKey, bubbleId, this)`. ה-fetch עצמו (שלב 3, `Promise.allSettled`) נשאר,
  אבל מעדכן `job.status`.
- ‏`fetchState/ensureFetch/cancelFetch` — כמו Speaker, מול `#jobs` (Map במקום array).
  - ‏`ensureFetch(id)`: אם job pending/error → צור freshAc, status=fetching, synthesize→prepareSegmentForBubble→markReady/markError.
  - ‏`cancelFetch(id)`: job.canceled=true + abort; ה-fetch-הרץ בודק canceled לפני markReady/markError.
  - ‏`fetchState(id)`: pending/fetching→in-flight, error→failed, ready/missing→idle.
- ‏`stop()`: נקה `#jobs` (abort לכולם + clear).

**קובץ חדש**: `bubble-player.producer.test.svelte.ts` — TDD (mock playlist + provider):
- ‏reserve מעביר `this`; ‏fetchState משקף job; ‏cancelFetch מונע markReady מאוחר.

**Verification**: `npx vitest run bubble-player`; `pnpm typecheck`.

### Commit 4 — Playlist צורך producer, מחיקת thunk+needsRefetch+2-הסטיות (approach: manual, מוגן טסטים)

**קבצים שמשתנים**: `audio-playlist.svelte.ts`
- ‏`reserve`: פרמטר רביעי הופך ל-`producer?: SegmentProducer` בלבד (הסר את ה-union הזמני מ-Commit 1).
- ‏מ-`PlaylistItem`: **מחק** `refetch?` ו-`needsRefetch?`.
- ‏`#factsFor` — `fetch` מגיע מהיצרן:
  ```ts
  const producer = this.#producers.get(id)
  let fetch: FetchState = producer?.fetchState(id) ?? "idle"
  ```
  **מחק** את כל בלוק המיפוי מ-`item.state`+`needsRefetch` [361-375] כולל **2 הסטיות של R1**.
  > ⚠️ שים לב: הסטייה (ב) `state=ready||playing → playable=true` [382] — **בדוק אם עדיין נחוצה**.
    אחרי R3, `fetchState(ready-job)="idle"` ו-`buffered` בא מ-sink. אם ה-sink מחזיר `isComplete=false`
    ל-ready-שלא-נוגן — decide→request-fetch→ensureFetch(ready-job)=no-op→תקוע? **זו נקודת-הסיכון
    המרכזית של R3.** ראה §9 Q1. ברירת-מחדל: **שמר** את `playable = state==="ready"||"playing" ? true : sinkPlayable`
    (הסטייה נשארת כי היא על `item.state` שקיים עד R4, ומשקפת "prepareSegment הסתיים"). מחק אותה רק ב-R4
    עם `item.state`.
- ‏`#navigate` [263-270]: במקום `it.state="reserved"; it.needsRefetch=true` על `resetToPending` —
  קרא `this.#producers.get(id)?.cancelFetch(id)` (היצרן מבטל). את `it.state="reserved"` **השאר**
  (item.state עדיין ה-state של הפלייליסט עד R4; reserved מסמן "לא-נוגן").
  > ⚠️ ה-`nav.cancel` [255-261] היום קורא `#audioStream.cancel(id)` (מוחק buffer ב-sink). זה **נשאר**
    (ביטול ה-buffer ב-sink הוא concern של ה-sink). ה-**הוספה** היא `cancelFetch` על ה-fetch החי.
    כלומר `resetToPending` → גם `sink.cancel(buffer)` [כבר קורה ב-nav.cancel] וגם `producer.cancelFetch(fetch)`.
- ‏`request-fetch` [454-481] — **שני** מקומות תלויי-thunk להמיר (אביגיל finding #4):
  1. ה-guard `if (item.refetch === undefined) → skip` [460-465] → `if (producer === undefined) → skip`
     (`const producer = this.#producers.get(item.segmentId)`).
  2. הקריאה `item.refetch()` [467] → `producer.ensureFetch(item.segmentId)`.
  3. ה-`needsRefetch = false` [466] (one-shot gate) — **נמחק** יחד עם `needsRefetch`. ה-idempotency
     עוברת ל-`ensureFetch` guard של היצרן (`fetching`/`ready` → no-op, Speaker [371]) — ודא שה-one-shot
     לא נשמט (בלי ה-guard של היצרן, decide יקרא ensureFetch שוב ושוב על אותו item).
- **מיגרציית טסט (אביגיל finding #3 — צרכן שלישי של `reserve`):** `audio-playlist.nav.test.ts` Test-12
  (retain-12) [588-618] קורא `reserve("s0", key(0), "bubble-A", thunk)` [600] ומאמת `refetchCount` על
  ה-thunk. אחרי הסרת ה-union, thunk אינו `SegmentProducer` → **typecheck יישבר**. מגר: החלף את ה-thunk
  ב-mock-producer (`{ ensureFetch: vi.fn(), cancelFetch: vi.fn(), fetchState: () => "idle" }`), והחלף את
  `refetchCount` באימות `ensureFetch` נקרא. (זהו הטסט שבודק את מסלול ה-refetch שהופך ל-ensureFetch.)

**Verification**: `npx vitest run audio-playlist playlist-decision`; `pnpm typecheck`;
`grep -n "refetch\|needsRefetch" audio-playlist.svelte.ts` → 0 (כולל הטסט — אין `refetchCount` שיורי).

### Commit 5 — F1: טסט stop-during-active-play (approach: TDD — סוגר חוב-רשת calev)

**רקע**: calev R1 (F1 [MED]) — הסרת `stopCurrent()` מ-`stop()` לא הפילה טסט; ה-mock `stopCurrent`
no-op ואין טסט של stop-בזמן-play-פעיל. ה-brief §5 של R1 הכיר בכך; R3 סוגר.

**קבצים שמשתנים**: `audio-playlist.test.ts` (או `.nav.test.ts`)
- ‏mock sink משופר: `play(id)` מחזיר Promise שנפתר **רק** כשקוראים `resolvePlay(id)` **או** `stopCurrent()`.
  כלומר `stopCurrent()` פותר את ה-play-promise הנוכחי (חוזה Commit 2 האמיתי — לא no-op).
- ‏טסט חדש: reserve+markReady+completeSegment → הלולאה מגיעה ל-`play` → קרא `stop()` בזמן ש-play תלוי
  → ה-play-promise נפתר (דרך stopCurrent), הלולאה יוצאת נקי (`state=idle`, `items=[]`), **בלי hang**.
- ‏טסט-מוטציה (הוכחת-רגישות): ודא שאם מסירים `stopCurrent()` מ-`stop()` — הטסט **נופל** (timeout/hang).
  (executor: הרץ ידנית, תעד ב-walkthrough; אל תשאיר את המוטציה בקוד.)

**Verification**: `npx vitest run audio-playlist`; ריצת-מוטציה מתועדת.

## §5 — DoD

| בדיקה | איך |
|---|---|
| ‏`SegmentProducer` interface קיים + 2 מימושים | `grep -l "implements SegmentProducer" packages/frontend/src/lib/view-models/*.ts` → 2 |
| ‏thunk + needsRefetch נמחקו | `grep -rn "needsRefetch\|refetch" packages/frontend/src/lib/engines/audio-playlist.svelte.ts` → 0 |
| ‏`fetch` ב-#factsFor מהיצרן | ‏code-review: `#factsFor` קורא `producer.fetchState`, אין מיפוי item.state→fetch |
| ‏ghost סגור (cancelFetch מונע markReady מאוחר) | טסט Commit 2/3: cancelFetch→job.canceled→#fetchJob לא קורא markReady |
| ‏F1 סגור: stop-during-play מכוסה + רגיש | טסט Commit 5 + ריצת-מוטציה (הסרת stopCurrent → נופל) מתועדת |
| חתימות ציבוריות (מלבד reserve) לא השתנו | `git diff slice/playlist-pure-decision -- audio-playlist.svelte.ts` — רק reserve param |
| התנהגות משומרת | כל טסטי audio-playlist (22) + core (32) ירוקים |
| ‏build-gate | `pnpm typecheck` 0; frontend suite = baseline+חדשים (מלבד ה-pre-existing: formatting, spawn-ENOENT, TLS) |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| ‏ready-job שלא-נוגן + sink.isComplete=false → decide תקוע (ensureFetch=no-op על ready) | ניתוח R3 (§4 Commit 4 ⚠️) | שמר את סטיית-`playable` (state=ready→playable) עד R4; §9 Q1. אם צץ — escalate |
| ‏`reserve` INVASIVE שובר קוראים | חתימה ציבורית + 2 צרכנים | union זמני ב-Commit 1 (thunk\|producer) → commit-ים ירוקים; הסרה ב-Commit 4 |
| ‏ghost לא-סגור: markReady/markError אחרי cancel | `#fetchJob` [391-478] | **2 נקודות בלבד** (אביגיל): guard `job.canceled` לפני `markReady` [463] (אחרי prepareSegment) + בתוך catch לפני `markError` [469]. ה-`finally` [474] לא נוגע ב-playlist. טסט cancelFetch מאמת |
| ‏BubblePlayer job-map דולף (jobs לא מנוקים) | Map חדש | `stop()` מנקה #jobs; טסט מאמת clear |
| ‏Svelte 5 reactivity על `#producers`/`#jobs` | Map לא-reactive | ה-Maps הם infra פנימי (לא $state) — כמו `#fetchWaitStartedAt` הקיים. אין קריאה reactive |
| ‏i18n / OneCLI | pre-commit | אין מחרוזות-UI חדשות; SDK דרך `resolveTts` הקיים (placeholder) — לא נגעים בו |
| הסטיות של R1 נמחקות מוקדם מדי ושוברות | §4 Commit 4 | (א) refetch=undefined→in-flight: נמחקת — עכשיו fetchState מחזיר idle/in-flight ישירות; (ב) playable: **נשמרת** עד R4 |

## §7 — Escalation triggers

- אם מחיקת סטיית-`playable` (ב) מתבררת כנחוצה כבר ב-R3 (ready-job תקוע) — **עצור ושאל מרדכי**
  (ההכרעה: להזיז חלק מ-R4 קדימה, או להוסיף `sink.isComplete` על ready — נוגע ב-sink).
- אם `SegmentProducer` פר-reserve מתגלה כלא-מספיק (segment בלי producer — reserve ישן/edge) —
  ה-`?? "idle"` ב-`#factsFor` הוא ה-fallback; אם זה יוצר תקיעה — עצור.
- אם `#fetchJob` ב-Speaker מתגלה כבעל נתיב-יציאה שלא ניתן ל-guard נקי (ghost נשאר) — עצור, אל תמציא.
- אם `reserve` INVASIVE שובר צרכן שלא ברשימה (`grep -rn "\.reserve(" packages/frontend/src`) — עצור.
- החלטה ארכיטקטונית לא-מכוסה D1-D50 — parent task.

## §8 — Complexity score

- ‏commits: 5 → +1
- שכבות: engine (interface+playlist) + 2 view-models = חוצה-שכבות → +2
- ‏APIs חיצוניים: 0
- ‏async pipeline (fetch ownership, ghost, cancel) → +2
- ‏state-model refactor (בעלות עוברת, thunk נמחק) → +2
- ‏protocol: 0
- ‏INVASIVE על 2 צרכנים (Speaker+BubblePlayer) → +1
- רשת חזקה (54 טסטים R1 + חדשים) → −0

**סה"כ: 8/10 → calev-heavy**. phase-verify מומלץ אחרי Commit 2 (Speaker — ה-ghost-guard הרגיש).

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | ‏ready-job שלא-נוגן + sink.isComplete=false → decide? | שמר סטיית-`playable` (state=ready→playable=true) עד R4; ה-decide יראה playable→play. מוחקים ב-R4 יחד עם item.state | ❌ (מכוסה) |
| 2 | ‏`ensureFetch` על ready-job — no-op או re-synth? | no-op (ה-guard הקיים `fetching`/`ready`). אם ה-item נזרק (buffer מ-sink) — ה-`cancelFetch` ב-navigate כבר החזיר את ה-job למצב שמאפשר re-synth | ❌ |
| 3 | ‏BubblePlayer job-map מול Speaker array — לאחד? | לא — שני מימושים נפרדים של אותו interface (כמו היום שני OrderAllocator). איחוד = over-engineering | ❌ |
| 4 | ‏`refetchSegment` alias — להשאיר או למחוק? | מחק ב-Commit 4 (אין קוראים אחרי ש-#enqueue עובר ל-producer) | ❌ |

---

## נספח — הקשר לשרשרת (למתכנן)

- **R4 `state-dedup`** (הבא): מוחק `item.state` (7 ערכים) → נגזרת מ-sink+cursor+producer;
  מוחק את סטיית-`playable` הנותרת (ב); `playingBubbleId`→`$derived`; pause ממוקד-`#current`.
  אז ה-Playlist מפסיק להחזיק **כל** עותק-מצב — רק כוונה (order+cursor+transport).
- אחרי R4: runtime-gate מאוחד (preview חי, Gemini/ElevenLabs) על כל R1→R4 → merge בסדר
  playback-ui → nav-retain → R1 → R3 → R4 (`--no-ff`), אחרי אישור-preview של המשתמשת.
