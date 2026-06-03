# Slice C — פלייליסט מלא (replay של שיחה: רצף, קדימה/אחורה, loop, התחל-מנקודה)

> **תאריך**: 2026-06-02 (עודכן 2026-06-03 — עוגן מול skeletons של המאוחד)
> **סטטוס**: **READY** (אביגיל round 2) — מעוגן מול skeletons של `slice-model-status-control-replay`.
> ⚠️ תלוי-מאוחד: כל מה שמרחיב BubblePlayer/turnState — לאמת מול המימוש בפועל אחרי שהמאוחד נחת.
> **לא ל-dispatch לפני שהמאוחד מוזג ומאומת** (C מרחיב את ה-`BubblePlayer` שלו).
> **base**: `dev` **אחרי** merge של `slice-model-status-control-replay` (המאוחד — בולע AB).
> **depends_on**: `[slice-model-status-control-replay]`.
> ⚠️ המאוחד יוצר: `BubblePlayer` (Commit 5: `playingBubbleId`/`toggle`/`stop`, ctor `{session,settings}`),
> `play-bubble.ts` (`playUserRecording`/`playAgentText`), `recordings.ts`, + `turnState` (Commit 1).
> C מרחיב אותם. **לאמת אחרי שהמאוחד נחת**: ש-ה-skeletons תואמים למימוש בפועל.
> **complexity**: 6 → verifier-slice-light (+ verifier-phase אחרי Commit 2 — לב ה-FSM)

---

## §0 — Pre-flight

**Worktree**:
```bash
# אם המאוחד כבר מוזג ל-dev → base=dev. אחרת שרשור על branch המאוחד:
git worktree add .worktrees/slice-C-playlist-replay -b slice-C-playlist-replay slice-model-status-control-replay
cd .worktrees/slice-C-playlist-replay
pnpm install && pnpm hooks:install
```

**איך מריצים** (זהה ל-AB):
```bash
cd packages/backend
PORT=4012 onecli run --agent voice-acp -- bun --watch src/server.ts
BE_PORT=4012 pnpm --filter @drive-coding/frontend dev
pnpm --filter @drive-coding/frontend typecheck && pnpm --filter @drive-coding/frontend test && pnpm lint:i18n
```

**OneCLI agent**: `voice-acp` (דרוש — replay של בועות-סוכן = `synthesizeStreaming` → proxy → cache hit).
**Browser**: linux-gui Chrome :9222 profile voice-acp, `playwright-cli -s=vacp attach --cdp=...`.
**mock**: `/chat?mock=salary-attendance` (הסשן הארוך — טוב לבדיקת רצף/קדימה/אחורה). reload מלא.

**Reading list**:
- **must-read לפני**:
  - `packages/frontend/AGENTS.md` — חוקי זהב (#2 entity, #4 effect ownership).
  - **תוצרי המאוחד** (חייבים להיות ב-base): `view-models/bubble-player.svelte.ts`,
    `adapters/voice/play-bubble.ts`, `adapters/voice/recordings.ts`. **קרא אותם קודם** —
    C מרחיב אותם. אם הם לא קיימים → ה-base שגוי, עצור (§7).
  - `view-models/agent-session.svelte.ts` — אמת ש-`turnState` קיים (מהמאוחד). C משתמש בו ב-guard.
  - `docs/decisions/voice-acp.md` — entry של המאוחד (החלטות בועה-בודדת + נתיב `<audio>`).
- **reference**:
  - `packages/frontend/docs/slices.md:210-241` — slice 10 המקורי (replay) + "Replay nav buttons" backlog.
  - `packages/frontend/src/lib/view-models/settings.svelte.ts` — `speakThoughts`/`narrateTools` (C מכבד אותן).
  - `docs/conventions/parallel-safe-code.md` — לפני נגיעה ב-`context.ts`/`+layout.svelte`.

---

## §1 — מטרה

המשתמש יוכל **להשמיע שיחה שלמה כפלייליסט**: לוחץ "השמע שיחה" → השיחה מתנגנת מההתחלה,
track-אחרי-track (הקלטת-משתמש → תשובת-סוכן → הקלטה → תשובה…), אוטומטית. תוך כדי הוא יכול
**לדלג קדימה/אחורה** בין הודעות, **להתחיל מנקודה מסוימת** (לחיצה על ▶ של בועה באמצע → מתנגן
משם והלאה), ולהפעיל **loop** (חוזר להתחלה בסוף). סרגל נגן צף מציג מיקום (track N/M) וכפתורי
שליטה גדולים (hands-free / להשמיע לאחרים). הבועה המתנגנת מודגשת. ה-replay מכבד את הגדרות
ה-Speaker הנוכחיות (אם speakThoughts כבוי — מדלג על מחשבות; אם narrateTools כבוי — מדלג כלים).

זה מרחיב את המאוחד (slice-model-status-control-replay): שם ▶ ניגן בועה **בודדת**; כאן ▶ הופך גם ל"התחל פלייליסט מכאן",
ומתווסף סרגל נגן עם רצף+ניווט+loop.

---

## §2 — Scope: מה כן, מה לא

| נושא | בסבב הזה? | הערה |
|---|---|---|
| רצף אוטומטי (track→track) | ✅ Commit 2 | |
| קדימה/אחורה (⏮/⏭) | ✅ Commit 3 | דילוג ל-track הקודם/הבא |
| התחל-מנקודה (▶ על בועה אמצעית → המשך הלאה) | ✅ Commit 2 | מרחיב את toggle מהמאוחד |
| loop (🔁) | ✅ Commit 3 | חוזר ל-track 0 בסוף |
| סרגל נגן גלובלי צף | ✅ Commit 4 | ⏮ ⏯ ⏭ · N/M · 🔁 · ✕ |
| מכבד speakThoughts/narrateTools | ✅ Commit 2 | בניית רשימת ה-tracks מסננת לפי ההגדרות |
| הדגשת בועה מתנגנת | ✅ (קיים מהמאוחד) | playingBubbleId כבר מדגיש; C מעדכן אותו תוך כדי רצף |
| guard: replay חסום בזמן thinking | ✅ Commit 2 | החלטת משתמש |
| **scrubbing בתוך track** (סרגל זמן אורך-track) | ❌ | עתידי. native `<audio>` תומך אבל UI נפרד |
| **replay של סשן ישן שנטען מחדש** | ❌ | דורש טעינת recordings מ-BE לבועות משוחזרות — slice נפרד |
| **שמירת/ייצוא אודיו של שיחה** | ❌ | עתידי |
| **תרגום מחשבות ב-replay** (HE TTS) | ❌ | מנגן את הטקסט כפי שמוצג. תרגום = Speaker חי בלבד |

---

## §3 — Architecture diagram

```
view-models/
  bubble-player.svelte.ts  ← מורחב (מהמאוחד): מ"בועה בודדת" ל"פלייליסט מלא".
                              + playlist state, position, loop, next/prev, מצב replay.
                              (INVASIVE? מרחיב VM קיים מהמאוחד — תוספת שדות $state.
                               ⚠️ אושר מראש ע"י המשתמשת כחלק מ-slice C — ראה §9 Q1)
adapters/
  voice/play-bubble.ts     ← reuse (מהמאוחד): playUserRecording / playAgentText. ללא שינוי מהותי.
components/
  chat/PlayerBar.svelte    ← חדש: סרגל נגן צף (Commit 4)
  chat/bubbles/*Bubble.svelte ← reuse (מהמאוחד): ▶ כבר קורא bubblePlayer.toggle(id).
                                                              C משנה את משמעות toggle (התחל-מכאן) — שקוף לבועה.
  chat/RecordFooter.svelte או shell ← כפתור "השמע שיחה" (Commit 4)
```

> **החלטת ארכיטקטורה**: C ממשיך עם נתיב `<audio>` של המאוחד (`play-bubble.ts`), **לא** ה-Player/
> AudioStream engine. סיבה: `<audio>` נותן native ended/pause/seek; פלייליסט = רצף של
> `<audio>` plays. ה-Player engine בנוי ל-streaming TTS חי (MediaSource+orderKey) — לא מתאים.
> **אל תיגע ב-Player/Speaker/AudioStream.**

---

## §4 — Commits בסדר

### Commit 1 — בניית רשימת ה-tracks (pure, מכבד הגדרות)
**Approach**: TDD (pure logic — input bubbles+settings → output track list).

**קבצים חדשים**:
- `packages/core/src/voice/playlist.ts` — פונקציה טהורה:
  ```ts
  export type Track =
    | { kind: "user"; bubbleId: string; recordingId: string }
    | { kind: "agent"; bubbleId: string; text: string }

  /**
   * בונה רשימת tracks מבועות, לפי הגדרות הקראה.
   * - user bubble עם recordingId → track user
   * - message bubble → track agent (text = איחוד segments)
   * - thought bubble → track agent רק אם speakThoughts
   * - tool bubble → track agent (narration) רק אם narrateTools && יש narration
   * - בועות בלי תוכן בר-השמעה → מדולגות
   */
  export function buildPlaylist(
    bubbles: PlaylistBubble[],
    opts: { speakThoughts: boolean; narrateTools: boolean },
  ): Track[]

  /** טיפוס מינימלי — core בלי תלות ב-FE Bubble. */
  export type PlaylistBubble =
    | { kind: "user"; bubbleId: string; recordingId?: string }
    | { kind: "message"; bubbleId: string; text: string }
    | { kind: "thought"; bubbleId: string; text: string }
    | { kind: "tool"; bubbleId: string; narration?: string }
  ```
  > ⚠️ **שלב מיפוי חובה ב-BubblePlayer** (Commit 2): `buildPlaylist` מקבל `PlaylistBubble[]`,
  > **לא** את `session.bubbles` (שהם FE `Bubble[]`). ה-VM ממפה קודם:
  > - user → `{kind:"user", bubbleId:b.id, recordingId:b.recordingId}`
  > - message/thought → `{kind, bubbleId:b.id, text: b.segments.map(s=>s.text).join("")}`
  > - tool → `{kind:"tool", bubbleId:b.id, narration: b.toolCall.narration}`
  >   (⚠️ narration נמצא תחת **`b.toolCall.narration`** — bubble.ts:69 ב-ToolCall, **לא** top-level.)
  > המיפוי הזה ב-VM (FE), לא ב-core. core מקבל רק את הצורה הנקייה.
- `packages/core/tests/voice/playlist.test.ts` — TDD. ⚠️ הטסט ב-`tests/voice/`
  (קונבניית core — כל 4 טסטי voice שם: tts-queue/sentence-boundary/cache-key/translation-prompt),
  **לא** ליד src/voice/. דפוס לחיקוי: `packages/core/tests/voice/tts-queue.test.ts`.
  - user+message מתחלפים → רשימה לפי סדר.
  - thought כש-speakThoughts=false → מדולג; =true → נכלל.
  - tool בלי narration → מדולג תמיד.
  - user בלי recordingId → מדולג.
  - רשימה ריקה → [].

**קבצים שמשתנים**:
- `packages/core/src/index.ts` — הוסף `export * from "./voice/playlist"` (אחרי שורה 10,
  ליד שאר מודולי voice :7-10). ⚠️ **חובה** — בלי זה ה-FE לא יוכל לייבא `buildPlaylist`
  ו-typecheck יישבר ב-Commit 2.

**Verification**: `pnpm --filter @drive-coding/core test` → ירוק. `pnpm --filter @drive-coding/core build` → ה-export זמין.

---

### Commit 2 — הרחבת BubblePlayer לפלייליסט + רצף + מצב replay
**Approach**: manual (VM glue + audio). **verifier-phase אחרי commit זה.**

**קבצים שמשתנים**:
- `view-models/bubble-player.svelte.ts` (מהמאוחד) — מרחיב מ"בועה בודדת" ל"פלייליסט":
  ```ts
  export class BubblePlayer {
    // ─── מהמאוחד (קיים): ctor({session, settings}), playingBubbleId, toggle, stop ───
    playingBubbleId: string | null = $state(null)
    toggle(bubbleId: string): void   // משמעות מורחבת: מתחיל פלייליסט מהבועה הזו
    stop(): void

    // ─── חדש ב-C ───
    /** true כשמצב replay פעיל (פלייליסט רץ). חוסם mic (slice C §scope). */
    isReplaying: boolean = $state(false)
    /** loop בסוף הרשימה. */
    loop: boolean = $state(false)
    /** אינדקס ה-track הנוכחי ברשימה הנבנית, או -1. */
    position: number = $state(-1)
    /** אורך הפלייליסט הנוכחי (לתצוגת N/M). */
    get total(): number

    /** מתחיל פלייליסט מההתחלה (כפתור "השמע שיחה"). */
    playAll(): void
    /** track הבא. בסוף: loop→0, אחרת stop. */
    next(): void
    /** track קודם. */
    prev(): void
    /** play/pause של ה-track הנוכחי. */
    togglePlayPause(): void
  }
  ```
  > **בניית הרשימה**: `playAll()`/`toggle(id)` ממפים `session.bubbles` ל-`PlaylistBubble[]`
  > (ראה שלב המיפוי ב-Commit 1) ואז קוראים `buildPlaylist(mapped, {speakThoughts, narrateTools})`,
  > שומרים ב-`#tracks`. הרצף: כל track נגמר (`<audio>` 'ended') → `next()` אוטומטי.
  > **track agent → playAgentText צריך voiceId**: ה-BubblePlayer כבר מקבל `settings` בבנאי
  > (מהמאוחד, ctor `{session, settings}`) → מעביר `settings.voiceId` ל-`playAgentText(text, settings.voiceId, audioEl)`.
  > `toggle(id)` (מהמאוחד) = בונה playlist + מתחיל מה-track של אותו bubbleId (התחל-מנקודה).
  > `playingBubbleId` מתעדכן לכל track → ההדגשה הקיימת מהמאוחד עוקבת אחרי הרצף.
  > **guard thinking**: כל playAll/toggle/next no-op אם `session.turnState !== "idle"`.
  > ⚠️ **תלוי ב-slice המאוחד** (`slice-model-status-control-replay`): הוא מסיר `thinking`
  > מ-`status` ומוסיף `turnState`. C נבנה **אחרי** המאוחד → השתמש ב-`turnState !== "idle"`
  > (לא `status === "thinking"` שכבר לא קיים).
  > **חסימת mic**: `isReplaying` נחשף; ה-mic/voiceMode יכבדו אותו (ראה Commit 3 wiring — או
  > כבר ב-AB אם נחשף. אם לא — הוסף כאן).

> ⚠️ **gotcha $effect** (2026-05-16): אל תנהל את הרצף ב-$effect שקורא+כותב position.
> השתמש ב-callback של `<audio>` 'ended' → קריאה ישירה ל-`next()` (method, לא effect).
> כמו `Mic.toggle()`. אין $effect בכלל ב-BubblePlayer.

> ⚠️ **INVASIVE**: הוספת שדות `$state` (isReplaying/loop/position) ל-VM קיים. לפי חוק
> זהב #2 — שינוי state model דורש אישור מרדכי. **המשתמשת אישרה הרחבת BubblePlayer
> מראש כחלק מ-slice C** (ראה §9 Q1). מתעד בהחלטות.

**Verification**:
- typecheck 0.
- browser (mock salary-attendance, reload): "השמע שיחה" → tracks מתנגנים ברצף, ההדגשה זזה.
  לחיצה על ▶ של בועה אמצעית → מתחיל משם. בזמן thinking → no-op.

---

### Commit 3 — next/prev/loop wiring + חסימת mic ב-replay
**Approach**: manual.

**קבצים שמשתנים**:
- `view-models/bubble-player.svelte.ts` — מימוש `next`/`prev`/`loop` (אם לא הושלם ב-Commit 2).
  next בסוף: `loop ? position=0 : stop()`. prev: `position = max(0, position-1)`.
- `view-models/mic.svelte.ts` או `derived/voice-mode.svelte.ts` — חסימת התחלת הקלטה
  כש-`bubblePlayer.isReplaying`. **בדוק את הדרך הנקייה**: או ש-`Mic.toggle()` בודק
  `isReplaying` ועושה no-op, או ש-VoiceMode חושף disabled. בדוק אם המאוחד כבר חיווט משהו
  (סביר שלא — המאוחד עושה בועה-בודדת בלי חסימת mic). אם לא — הדרך המינימלית: `Mic` מקבל
  הפניה ל-bubblePlayer (constructor) ובודק בתחילת toggle. **אם זה דורש שינוי constructor
  של Mic → INVASIVE, שאל מרדכי** (§7).

**Verification**:
- browser: ⏭ מדלג קדימה, ⏮ אחורה. 🔁 דולק → בסוף חוזר ל-0. בזמן replay, לחיצת mic לא מקליטה.

---

### Commit 4 — סרגל נגן צף + כפתור "השמע שיחה"
**Approach**: manual (UI).

**קבצים חדשים**:
- `components/chat/PlayerBar.svelte` — leaf component, מופיע כש-`bubblePlayer.isReplaying`.
  צף תחתון (position: fixed/sticky). כפתורים גדולים (hands-free):
  ```
  ⏮  ⏯  ⏭        track {position+1}/{total}        🔁  ✕
  ```
  - ⏮ → `prev()`, ⏯ → `togglePlayPause()`, ⏭ → `next()`
  - 🔁 toggle `loop` (מודגש כשדולק), ✕ → `stop()` (יוצא מ-replay)
  - קורא `getBubblePlayer()`. אייקונים Lucide (SkipBack/SkipForward/Play/Pause/Repeat/X).

**קבצים שמשתנים**:
- `components/chat/RecordFooter.svelte` (או shell) — כפתור "השמע שיחה" שקורא `playAll()`.
  מוסתר/disabled כשאין bubbles בני-השמעה או בזמן thinking.
- `routes/chat/+page.svelte` או layout — רנדור `<PlayerBar />` (מותנה ב-isReplaying).
- **i18n** — keys חדשים: `player.playAll`, `player.next`, `player.prev`, `player.loop`,
  `player.close`, `player.position` (אם צריך תבנית). keys.ts + he.ts + en.ts.

**Verification**:
- typecheck 0, lint:i18n 0.
- browser: "השמע שיחה" → סרגל מופיע, רץ, N/M מתעדכן. כל הכפתורים עובדים. ✕ סוגר.

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|---|---|
| 1 | typecheck נקי | `pnpm --filter @drive-coding/frontend typecheck` → 0 |
| 2 | core tests | `pnpm --filter @drive-coding/core test` → ירוק (playlist) |
| 3 | lint:i18n נקי | `pnpm lint:i18n` → 0 |
| 4 | buildPlaylist מכבד speakThoughts | thought מדולג כש-כבוי (unit test) |
| 5 | buildPlaylist מכבד narrateTools | tool מדולג כש-כבוי (unit test) |
| 6 | **רצף אוטומטי** | "השמע שיחה" → tracks מתנגנים ברצף בלי התערבות |
| 7 | **התחל-מנקודה** | ▶ על בועה אמצעית → מתחיל משם והלאה |
| 8 | **קדימה** | ⏭ → track הבא מתנגן |
| 9 | **אחורה** | ⏮ → track הקודם |
| 10 | **loop** | 🔁 דולק → בסוף חוזר ל-track 0 |
| 11 | ✕ יוצא | סרגל נעלם, החזרה למצב רגיל |
| 12 | N/M מתעדכן | מונה המיקום נכון תוך כדי רצף |
| 13 | הדגשה עוקבת | הבועה המתנגנת מודגשת ומשתנה עם הרצף |
| 14 | guard thinking | "השמע שיחה"/▶ no-op בזמן שהסוכן עונה |
| 15 | חסימת mic ב-replay | בזמן replay לחיצת mic לא מקליטה |

---

## §6 — Risks + mitigations

**R1 — $effect שקורא+כותב position** (gotcha 2026-05-16, DDoS loop).
→ הרצף מנוהל ב-`<audio>` 'ended' callback → `next()` method ישירה. **אין $effect ב-BubblePlayer.**

**R2 — INVASIVE state ב-VM** (חוק זהב #2).
→ אושר מראש ע"י המשתמשת כחלק מ-slice C (§9 Q1). אם Commit 3 דורש שינוי constructor של
**Mic** (לחסימה) — זה INVASIVE נוסף, **שאל מרדכי** (§7).

**R3 — דליפת objectURL** (כל track agent יוצר Blob URL).
→ reuse של play-bubble.ts מהמאוחד שכבר עושה revokeObjectURL. אמת שהרצף לא מדלג על revoke
(כל track חייב לשחרר לפני הבא).

**R4 — Hardcoded Hebrew** (hook חוסם).
→ Commit 4 מוסיף player.* keys דרך t(). אין מחרוזת ישירה.

**R5 — Svelte 5 reactivity** — position/loop/isReplaying הם $state סקלריים → בטוחים.
ההדגשה דרך playingBubbleId (קיים מהמאוחד, עובד).

**R6 — base תלוי במאוחד שעדיין לא נחת**.
→ בדיקת base חובה (§0): אם `BubblePlayer`/`play-bubble`/`recordings`/`turnState` לא קיימים
→ המאוחד לא מוזג, base שגוי, עצור. ה-skeletons כאן עוגנו מול ה-brief המאוחד המאומת
(אביגיל round 2) — אבל אמת מול המימוש בפועל אחרי שהמאוחד נחת (executor עשוי לסטות מ-skeleton).

**R7 — race: bubbles משתנים תוך כדי replay** (סוכן עונה בזמן replay).
→ guard thinking חוסם התחלת replay בזמן thinking. אבל אם replay רץ ואז מגיע update חי —
ה-#tracks נבנה פעם אחת ב-playAll (snapshot), לא מגיב ל-bubbles חדשים. תיעד: replay עובד על
snapshot של הרגע שלחצת. (החלטת משתמש: replay לא באמצע thinking — אז התרחיש נדיר.)

---

## §7 — Escalation triggers

עצור ושאל את מרדכי אם:
- BubblePlayer/play-bubble.ts/recordings.ts/turnState **לא קיימים** ב-base → המאוחד לא מוזג, base שגוי.
- חסימת mic דורשת שינוי constructor של Mic (INVASIVE לא-מתוכנן).
- `<audio>` 'ended' לא נורה אמין ברצף מהיר (track קצר) → צריך גישה אחרת לרצף.
- buildPlaylist צריך לדעת על תרגום מחשבות (HE) → מחוץ ל-scope, שאל.
- מבנה BubblePlayer אחרי המאוחד שונה מהותית מה-skeleton כאן → התאם/שאל.

---

## §8 — Complexity score: 6 → verifier-slice-light

- 4 commits
- 1 שכבת core חדשה (playlist pure) + הרחבת VM קיים
- 1 API חיצוני (TTS via proxy, reuse מהמאוחד)
- אין protocol change, אין refactor state model (הרחבה תוספתית)
- audio sequencing (לא streaming pipeline) — +1

→ **verifier-slice-light** + **verifier-phase אחרי Commit 2** (לב ה-FSM של הרצף).

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | הרחבת BubblePlayer INVASIVE — מאושר? | **כן, אושר מראש** (slice C = הפלייליסט המלא) | ❌ |
| 2 | replay על snapshot או חי? | snapshot (נבנה ב-playAll). thinking חסום ממילא | ❌ |
| 3 | סרגל נגן — fixed bottom או חלק מ-RecordFooter? | fixed bottom צף (לא תלוי ב-footer) | ❌ |
| 4 | "השמע שיחה" איפה יושב? | ב-RecordFooter ליד mic, או בתפריט אפשרויות | ❌ — executor מחליט, מתעד |
| 5 | ⏯ pause — native `<audio>.pause()` או stop+restart? | native pause (שומר מיקום בתוך track) | ❌ |
| 6 | מה אם track agent נכשל ב-TTS באמצע רצף? | דלג ל-next (best-effort, כמו Speaker) | ❌ |

כל השאלות לא-חוסמות. ⏳ **אחרי שהמאוחד נחת**: לאמת שה-skeletons (BubblePlayer/play-bubble)
תואמים למימוש בפועל של ה-executor, לעדכן line numbers, ואז להריץ אביגיל ול-dispatch.
