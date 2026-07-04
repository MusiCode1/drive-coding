# Slice R4a — producer-test-hardening — תוכנית

> **תאריך**: 2026-07-05
> **סטטוס**: מאושר — אביגיל READY r2 (r1: 3 findings helper/state → תוקנו)
> **Complexity**: 6/10 (verifier: **calev-heavy** — כי ה-DoD הוא mutation-gate)
> **base**: `slice/producer-ownership` (R3) @ `4adbdf9`
> **depends_on**: `[producer-ownership]`
> **רקע**: ה-calev-heavy של R3 החזיר **PARTIAL** — הקוד נכון-runtime אבל רשת-הטסטים חורית:
> 5/7 מוטציות שרדו (כל ה-ghost-guards + 2 קריאות-הליבה). ה-slice הזה סוגר את חוב-הרשת
> (H1+H2), מתקן באג-קוד אחד (M1), ומחזק flake (L1). **תנאי-שער: mutation re-run — 7/7 נתפסות.**
> זהו ה-slice האחרון **החוסם** בשרשרת R1→R3→R4a לפני preview+merge. `state-dedup` (מחיקת
> `item.state`) נדחה ל-follow-up (לא חוסם — ניקוי-חוב מבני).

## §0 — Pre-flight

### Worktree

```bash
# ⚠️ base = slice/producer-ownership (R3), הנתיב מקונן!
cd D:/UserProjects/AI/drive-coding/dev/.worktrees/playlist-pure-decision/.worktrees/producer-ownership
git worktree add ../../../.worktrees/producer-test-hardening -b slice/producer-test-hardening slice/producer-ownership
# → D:/UserProjects/AI/drive-coding/dev/.worktrees/producer-test-hardening
cd D:/UserProjects/AI/drive-coding/dev/.worktrees/producer-test-hardening
pnpm install && pnpm hooks:install
```

### Run
- ‏slice **טסטים-בלבד**. אין BE/FE/preview. `packages/core` אין test script → הרץ דרך root:
  `pnpm --filter @drive-coding/frontend test`, `npx vitest run <pattern>`, `pnpm typecheck`.

### Browser
לא נדרש.

### Reading list
**must-read**:
- `reports/drive-coding/producer-ownership-calev.md` — **קרא את כל 4 ה-findings + טבלת-המוטציות (7 שורות)**. זה ה-spec של ה-slice.
- `packages/frontend/src/lib/view-models/speaker.producer.test.svelte.ts` — הטסטים ה-vacuous שיתוקנו (H1). שים לב ל-`makeSession`/`makePlaylist` helpers.
- `packages/frontend/src/lib/view-models/bubble-player.producer.test.svelte.ts` — vacuous גם (H1).
- `packages/frontend/src/lib/view-models/speaker.svelte.ts` — `#enqueue` [337-364] (יוצר job+reserve), `#fetchJob` [391-478] (ghost-guards [507]/[513]), `#pumpFetchLoop` [421-431], `$effect.root` בבנאי [158-199].
- `packages/frontend/src/lib/view-models/bubble-player.svelte.ts` — `#reserveAndPlay` שלב-3 [186-220] (M1: `abortCtrl` המשותף מועבר ל-synthesize/prepareSegmentForBubble; `job.abort` [173] לא בשימוש).
- `packages/frontend/src/lib/engines/audio-playlist.svelte.ts` — `#navigate` [272] (`cancelFetch`), `request-fetch` [474] (`ensureFetch`) — ה-wiring של H2.

## §1 — מטרה

אחרי ה-slice: רשת-הטסטים **באמת** מכסה את R3 — הזרקת job דרך ה-flow האמיתי (לא cast ל-`#private`),
ghost-guard/fetchState/wiring נבדקים ונתפסים במוטציה; באג ה-abort הכפול (M1) מתוקן; ו-mutation-suite
של 7 המוטציות של calev **כולן נתפסות**. אין שינוי-התנהגות נראה למשתמשת — זה חיזוק-איכות + תיקון-בזבוז.

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| ‏H1 — seam אמיתי ל-producer-tests (Speaker+BubblePlayer) | ✅ Commit 0-1 | — |
| ‏H2 — טסט-wiring חיובי בפלייליסט (cancelFetch/ensureFetch) | ✅ Commit 2 | — |
| ‏M1 — תיקון abort הכפול ב-BubblePlayer initial-play | ✅ Commit 3 | — |
| ‏NBug2 — מחיקת `refetchSegment` alias (§9 Q4 של R3) | ✅ Commit 3 | — |
| ‏L1 — חיזוק F1 flake (fake-timers דטרמיניזם) | ✅ Commit 4 | — |
| מחיקת `item.state` / `playingBubbleId`→נגזרת / pause ממוקד | ❌ | ‏`state-dedup` (follow-up, לא חוסם merge) |
| שינוי קוד-פרודקשן מעבר ל-M1 + מחיקת alias | ❌ | — (רוב ה-slice = טסטים) |

**כלל-על**: **אפס שינוי-התנהגות**. Commit 0-2,4 = טסטים בלבד. Commit 3 = תיקון-קוד ממוקד (abort wiring + מחיקת dead alias). חתימות ציבוריות לא משתנות.

## §3 — Architecture diagram

```
frontend/src/lib/view-models/
  speaker.svelte.ts               ← Commit 3 בלבד: מחיקת refetchSegment alias
  bubble-player.svelte.ts         ← Commit 3: M1 — AbortSignal.any לבקשה הראשונית
  speaker.producer.test.svelte.ts ← Commit 0: seam אמיתי (flow-based job injection)
  bubble-player.producer.test.svelte.ts ← Commit 1: seam אמיתי
frontend/src/lib/engines/
  audio-playlist.*.test.ts        ← Commit 2 (wiring test) + Commit 4 (F1 determinism)
```

## §4 — Commits

> ⚠️ **DoD = mutation re-run.** אחרי Commit 4, הרץ את 7 המוטציות של calev (§5) וּודא שכולן נתפסות.

### Commit 0 — H1a: seam אמיתי ל-Speaker producer tests (approach: TDD-refactor)

**הבעיה** (calev H1): הטסטים ב-`speaker.producer.test.svelte.ts` ניגשים ל-`#jobs` דרך
`(speaker as…)["#jobs" as never]` → **`undefined`** (hash-private לא-נגיש). כל ה-assertions
המהותיות מתות. מוטציות 1-3 (הסרת ghost-guards + idempotency) שרדו.

**הפתרון — הזרקה דרך ה-flow האמיתי** (לא cast ל-`#private`):
ה-`$effect.root` בבנאי [158-199] רץ **initial** ביצירת ה-Speaker. אם ה-session מכיל bubble+segment
**לפני** `new Speaker(...)`, ה-initial run יקרא `#processBubbles`→`#enqueue`→`reserve(this)`+`#pumpFetchLoop`,
ויֵצור job אמיתי. ה-`segId` (crypto.randomUUID) נתפס מ-`reserveCalls` של ה-playlist mock.

**קבצים שמשתנים**: `speaker.producer.test.svelte.ts`

**helper חדש** (הזרקת-flow):
```ts
import { flushSync } from "svelte"

// session עם segment כבר בפנים (message bubble, enabled=true דרך settings.muted=false)
function makeSessionWithSegment(text: string): AgentSession {
  return { ...makeSession(),
    bubbles: [{ kind: "message", id: "b1", messageId: "m1", segments: [{ id: "s1", text }] }],
  } as unknown as AgentSession
}

// יוצר Speaker → flushSync מריץ את ה-$effect initial → job נוצר → מחזיר segId
// ⚠️ הטקסט חייב לפלוט sentence שלם: terminator (.!?) + ≥ MIN_CHARS(20). אחרת
//    splitIntoSentences מחזיר אותו כ-remaining ולא כ-sentence → #enqueue לא נקרא →
//    reserveCalls ריק → segId=undefined בשקט (אביגיל finding #1). זה מחזיק גם אם
//    ה-mock של splitIntoSentences יוסר/ישתנה.
function seedJob(text = "This is a full narration sentence."): { speaker: Speaker; segId: string } {
  session = makeSessionWithSegment(text)
  const pm = makePlaylist(sink)
  const speaker = new Speaker({ session, settings, playlist: pm.playlist, audioStream: sink })
  flushSync()                                  // runs $effect.root initial → #enqueue
  const segId = pm.reserveCalls[0]?.[0] as string   // captured from reserve(this) call
  if (segId === undefined) throw new Error("seedJob: no job created — text produced no sentence")
  return { speaker, segId }                     // segId now has a live job (pending→fetching)
}
```

**טסטים מתוקנים** (החלף את ה-vacuous — כל אחד עכשיו מזריק job אמיתי):
- ‏`fetchState` fetching-job → `"in-flight"` (מיד אחרי seedJob, לפני resolve synthesize).
- ‏`fetchState` אחרי `resolvePrepare`+`markReady` → `"idle"` (job.status=ready).
- ‏`fetchState` אחרי synthesize-reject → `"failed"` (job.status=error).
- ‏`ensureFetch` idempotent: seedJob (job=fetching) → `ensureFetch(segId)` → `#pendingCount` לא עולה
  (בדוק דרך `hasPendingNarration` getter הציבורי, או ספירת reserve/pump — לא #private).
- ‏**ghost (הקריטי)**: seedJob → `cancelFetch(segId)` בזמן ש-`prepareSegment` תלוי → resolve prepareSegment
  → **`markReadyCalls` לא מכיל את segId** (guard [507] תפס). מוטציה: הסר guard → הטסט נופל.
- ‏ghost-catch: seedJob → `cancelFetch` → synthesize/prepareSegment reject → **`markErrorCalls` לא מכיל segId**.

> ⚠️ ה-mock sink `prepareSegment` צריך להיות **controllable** (Promise שנפתר ע"י הטסט) כדי לקבע את
> חלון ה-cancelFetch-בזמן-fetch. הרחב את `makeAudioSink` עם `resolvePrepare(id)` אמיתי (יש כבר שדה רדום).

**Verification**: `npx vitest run speaker.producer`; `pnpm typecheck`. **לכל טסט-ghost — ודא RED על מוטציה** (תעד ב-walkthrough).

### Commit 1 — H1b: seam אמיתי ל-BubblePlayer producer tests (approach: TDD-refactor)

**הבעיה** זהה (`#jobs` Map לא-נגיש). ב-BubblePlayer, ה-jobs נוצרים ב-`#reserveAndPlay` (נקרא מ-`toggle`
על bubble היסטורית). ה-flow: `toggle(bubbleId)` → `#reserveAndPlay` → `#jobs.set` + `reserve(this)`.

**הפתרון**: הזרקה דרך `toggle()` על bubble היסטורית (mock playlist שמחזיר `items:[]` → ענף "היסטורי").
תפוס segId מ-`reserveCalls`. אז `fetchState`/`cancelFetch`/ghost נבדקים דרך ה-flow.

**קבצים שמשתנים**: `bubble-player.producer.test.svelte.ts` — אותו דפוס seam (flow-injection דרך `toggle`),
אבל ⚠️ **מנגנון ה-window שונה מ-Speaker** (אביגיל finding #2): ב-BubblePlayer test ה-`prepareSegmentForBubble`
של ה-mock playlist עושה resolve **מיידי**; ה-timing (חלון ל-cancelFetch-בזמן-fetch) נשלט דרך
**`mockSynthesize`** — Promise שהטסט מחזיק ומשחרר (כמו טסט 9 הקיים, שורה ~265). **אין `resolvePrepare`
ב-BubblePlayer** (הוא קיים רק ב-Speaker test). טסטים: fetchState משקף job · ensureFetch על pending → re-synth ·
**ghost**: `cancelFetch` בזמן ש-`mockSynthesize` תלוי → markReady/markError לא נקראים · stop() מנקה jobs.

**Verification**: `npx vitest run bubble-player.producer`; מוטציה על ghost-guards [209]/[214]/[264]/[269] → RED.

### Commit 2 — H2: טסט-wiring חיובי בפלייליסט (approach: TDD)

**הבעיה** (calev H2): `cancelFetch` ב-`#navigate` [272] ו-`ensureFetch` ב-request-fetch [474] —
**0 טסט חיובי**. מוטציות 4-5 (ניטרול שתיהן) שרדו.

**קבצים שמשתנים**: `audio-playlist.nav.test.ts` (או `.test.ts`)
- ‏mockProducer: `{ ensureFetch: vi.fn(), cancelFetch: vi.fn(), fetchState: vi.fn(() => "idle") }`.
- **טסט cancelFetch**: reserve(seg, key, bubble, mockProducer) → התחל ניגון → `#navigate` ל-item
  לא-buffered (skip-cancel) → **`mockProducer.cancelFetch` נקרא עם ה-segId** (מוטציה: ניטרול [272] → נופל).
- **טסט ensureFetch**: reserve item שדולג (fetchState→"failed") + explicitVisit (prev/jumpTo) →
  decide→request-fetch → **`mockProducer.ensureFetch` נקרא** (מוטציה: ניטרול [474] → נופל).

**Verification**: `npx vitest run audio-playlist`; 2 המוטציות (4,5) → RED.

### Commit 3 — M1 fix + מחיקת alias (approach: TDD למה שאפשר + manual)

**M1** (calev — באג-קוד): `bubble-player.svelte.ts` `#reserveAndPlay` שלב-3 [186-220] מעביר את
`abortCtrl` **המשותף** ל-`synthesize({signal})` ול-`prepareSegmentForBubble(…, abortCtrl)`. לכן
`cancelFetch(segId)` (שמבטל `job.abort`) **לא קוטע** את הבקשה הראשונית — רק מרים flag. הבקשה
ממשיכה עד סיום → בזבוז-רשת בניווט תוך-בועה-חיה.

**התיקון**: הבקשה הראשונית צריכה להיענות ל**שניהם** — ה-`abortCtrl` המשותף (toggle/stop של כל הבועה)
ו-`job.abort` (cancelFetch פר-סגמנט). השתמש ב-`AbortSignal.any`:
```ts
const job = this.#jobs.get(segId)
const combined = job !== undefined
  ? AbortSignal.any([abortCtrl.signal, job.abort.signal])
  : abortCtrl.signal
const stream = await provider.synthesize({ text: part, voiceId, modelId, signal: combined })
await this.#playlist.prepareSegmentForBubble(segId, stream, /* AbortController wrapping combined? */ …)
```
> ⚠️ `prepareSegmentForBubble` מקבל `AbortController`, לא `signal`. אפשרויות: (א) העבר controller חדש
> שמאזין ל-`combined` (`combined.addEventListener("abort", () => ctrl.abort())`); (ב) הרחב את
> `prepareSegmentForBubble` לקבל signal. **ברירת-מחדל: (א)** (לא נוגע בחתימת ה-playlist). אם (א) מסורבל
> מדי — escalate לפני שמרחיבים חתימה.

**טסט M1**: seedJob (BubblePlayer flow) → `cancelFetch(segId)` בזמן ש-synthesize תלוי → **ה-signal
שהועבר ל-synthesize מסומן aborted** (mock synthesize בודק `signal.aborted` אחרי cancelFetch). מוטציה:
החזר ל-`abortCtrl.signal` בלבד → הטסט נופל.

**מחיקת alias** (R3 §9 Q4 / calev NBug2): מחק את `refetchSegment` מ-`speaker.svelte.ts:373` (dead —
אין קורא-פרודקשן; ה-seam החדש מ-Commit 0 לא צריך אותו). `grep -rn "refetchSegment" packages/frontend/src` → 0.

**Verification**: `npx vitest run bubble-player speaker`; `grep refetchSegment` → 0; `pnpm typecheck`.

### Commit 4 — L1: F1 determinism (approach: manual)

**הבעיה** (calev L1): F1 test (stop-during-play) נכשל פעם אחת מ-~5 ריצות תחת עומס-worker מקבילי
(fake timers). לא שוחזר בבידוד.

**התיקון**: החלף `advanceTimersByTimeAsync(0)`/微tasks לא-דטרמיניסטיים ב-`await vi.runAllTimersAsync()`
או `vi.waitFor(...)` סביב נקודת ה-stop-during-play. מטרה: אפס תלות בתזמון-worker.

**Verification**: הרץ `npx vitest run audio-playlist` ×5 → F1 יציב. `pnpm --filter @drive-coding/frontend test` מלא.

## §5 — DoD (mutation-gate — הליבה)

| בדיקה | איך |
|---|---|
| **mutation-suite 7/7 נתפסות** | הרץ ידנית כל מוטציה מטבלת calev (report §שלב-4), הרץ הטסט הרלוונטי, ודא **נופל**, שחזר. תעד ב-walkthrough טבלת 7-שורות (מוטציה→נופל✓). זהו ה-DoD המרכזי. |
| ‏H1 — producer-tests לא-vacuous | ‏grep: אין `["#jobs" as never]` שיורי; הטסטים מזריקים דרך flow (flushSync/toggle) |
| ‏H2 — wiring מכוסה | ‏mockProducer.cancelFetch + ensureFetch מאומתים נקראים |
| ‏M1 — abort הראשוני נקטע | טסט: cancelFetch → signal של synthesize aborted |
| ‏alias נמחק | `grep refetchSegment packages/frontend/src` → 0 |
| ‏F1 יציב | 5 ריצות רצופות ירוקות |
| ‏אפס שינוי-התנהגות | `git diff slice/producer-ownership -- '*.svelte.ts' ':!*.test.*'` — רק M1 (bubble-player) + מחיקת-alias (speaker). audio-playlist.svelte.ts diff ריק |
| ‏build-gate | typecheck 0; frontend suite = baseline+חדשים (מלבד formatting pre-existing) |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| ‏`flushSync` לא מריץ את ה-$effect (session plain, לא reactive) | Explore: $effect initial-run תמיד רץ | ‏initial run של `$effect.root` רץ ב-flushSync ללא-תלות-ב-reactivity; אם לא — נסה `$effect` root ידני או הזרק לפני ctor. escalate אם flushSync לא עובד אחרי ניסיון אחד |
| מנגנון-window לטסט ה-ghost (חלון ל-cancelFetch-בזמן-fetch) | טסט ה-ghost | **Speaker**: הרחב `makeAudioSink.resolvePrepare(id)` ל-Promise אמיתי (השדה רדום קיים). **BubblePlayer**: שלוט דרך `mockSynthesize` (Promise מוחזק, תקדים טסט 9) — **לא** resolvePrepare (אביגיל #2) |
| ‏`AbortSignal.any` לא נתמך בסביבת-הטסט/target | M1 | Node 20+/jsdom מודרני תומך; אם לא — polyfill ידני (listener) שהוא ממילא אופציה (א) |
| ‏מחיקת alias שוברת seam ישן | Commit 0 seam חדש לא צריך alias | ‏grep refetchSegment לפני מחיקה; Commit 0 לפני Commit 3 |
| ‏i18n | pre-commit | אין מחרוזות-UI; הכל טסטים+abort wiring |
| ‏mutation-gate מתפספס (executor "שוכח" להריץ) | DoD | **calev-heavy יריץ mutation מחדש** — זה ה-gate האמיתי. ה-walkthrough חייב טבלת-7. |

## §7 — Escalation triggers

- אם `flushSync()` לא מייצר job (ה-$effect לא רץ עם mock-session) אחרי ניסיון אחד — **עצור ושאל מרדכי**
  (חלופה: session עם $state אמיתי, או seam מפורש — הכרעת-תשתית-טסט).
- אם `prepareSegmentForBubble` דורש הרחבת-חתימה ל-M1 (אופציה ב) — עצור (נוגע ב-API של הפלייליסט).
- אם מוטציה שאמורה להיתפס **עדיין שורדת** אחרי תיקון הטסט — עצור והצג (אולי הטסט עדיין vacuous בדרך אחרת).
- אם `AbortSignal.any` נכשל בסביבה — עצור לפני polyfill מורכב.
- החלטה ארכיטקטונית לא-מכוסה D1-D50 — parent.

## §8 — Complexity score

- ‏commits: 5 → +1
- שכבות: view-models + engine tests → +1
- ‏APIs חיצוניים: 0
- ‏async (abort wiring, fake-timers determinism) → +1
- ‏state-model: 0 (לא נוגע ב-item.state)
- ‏test-infrastructure (seam חדש, mutation-gate) → +2
- ‏קוד-פרודקשן: מינימלי (M1 + מחיקת-alias) → +1

**סה"כ: 6/10.** verifier: **calev-heavy** — כי ה-DoD הוא mutation re-run (heavy מריץ mutation מובנה).

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | ‏flushSync מספיק ל-$effect initial? | כן (initial run תמיד); אם לא → escalate §7 | ❌ (מכוסה escalation) |
| 2 | ‏M1: AbortSignal.any מול listener ידני ל-prepareSegmentForBubble | listener (אופציה א) — לא נוגע בחתימה | ❌ |
| 3 | ‏האם למחוק גם את הטסטים ה-vacuous או לתקן במקום | תקן במקום (שמור את שמות-הטסטים, החלף גוף) | ❌ |
| 4 | ‏state-dedup — מתי | follow-up אחרי merge; לא ב-slice זה | ❌ |

---

## נספח — הקשר לשרשרת (למתכנן)

- **אחרי R4a**: כל השרשרת R1→R3→R4a מאומתת עם mutation-gate. runtime-gate מאוחד: preview חי
  (Gemini/ElevenLabs, המפתח עובד) על כל השרשרת → merge בסדר `playback-ui → nav-retain → R1 → R3 → R4a`
  (`--no-ff`), **אחרי אישור-preview של המשתמשת**.
- **`state-dedup` (follow-up, לא חוסם)**: מחיקת `item.state` (7 ערכים) → נגזרת מ-sink+cursor+producer;
  `playingBubbleId`→`$derived`; pause ממוקד-`#current`. נרשם ב-roadmap כ-💭. ה-adapter הנוכחי
  (`#factsFor` קורא item.state ל-playable/playedToEnd) עובד — חוב-אסתטי בלבד.
