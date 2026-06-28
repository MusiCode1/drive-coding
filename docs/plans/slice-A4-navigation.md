# Slice A4 — ניווט prev/next/jump + איחוד BubblePlayer — תוכנית

> **תאריך**: 2026-06-28
> **סטטוס**: מאושר (אביגיל דולגה לבקשת המשתמשת)
> **Complexity**: 8/10 (verifier: heavy — refactor בעלות + streaming)
> **תלות**: [A3] · **base**: branch `slice/playback-core-a3`
> **שייך ל**: `docs/plans/playback-run-control-roadmap.md` (slice 4/6)
>
> ⚠️ **carry מ-A2 (known-bug BUG-1, דחייה מאושרת):** סגמנט **late-early** — שנפלט ב-flush של
> turn-end אחרי שה-cursor החי כבר עבר (זנב-מחשבה טיפוסי) — נשאר בפלייליסט sorted+`ready` ו**לא
> נוגן חי**. **A4 חייב:** (1) שהניווט (`prev`/`jumpTo`/`jumpToBubble`) יחשוף ויקריא גם פריט
> `ready`-שלא-נוגן-חי (לא להתעלם ממנו ולא להניח שכל פריט מאחורי cursor=`done`); (2) להחליט
> אסטרטגיית-buffer עבורו (כמו §9 Q2 — לשמר או re-fetch ב-jumpTo). זה **לא** `skipped` — יש לו
> ערך-ניווט. ר' `decisions/voice-acp.md` 2026-06-29.

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/playback-core-a4 -b slice/playback-core-a4 slice/playback-core-a3
cd .worktrees/playback-core-a4
pnpm install && pnpm hooks:install
```

### Run / Browser
- BE עם OneCLI; אימות ניווט דורש קול חי + כמה הודעות בשיחה.

### Reading list
**must-read**:
- `packages/frontend/src/lib/engines/audio-playlist.svelte.ts` — מ‑A2/A3 (cursor, transport).
- `packages/frontend/src/lib/view-models/bubble-player.svelte.ts` — כל הקובץ (מתאחד).
- `packages/frontend/src/lib/view-models/speaker.svelte.ts` — מי מחזיק את ה‑playlist (`#player`).
- `packages/frontend/src/lib/context.ts` — דפוס setContext/getContext לישויות.
- `packages/frontend/src/routes/+layout.svelte` — composition root (יצירת VMs).
- `packages/frontend/AGENTS.md` + `docs/conventions/parallel-safe-code.md` — context.ts/+layout משותפים.

## §1 — מטרה

אחרי הסבב: בזמן הקראה אפשר לנווט **קדימה/אחורה בין משפטים** (⏮/⏭), ולקפוץ ישירות
למשפט ע"י לחיצה על בועה. ה‑`AudioPlaylist` הופך למקור‑אמת **יחיד** לכל ההשמעה — גם הזרם
החי (Speaker) וגם השמעת בועות בודדות (BubblePlayer מתאחד לתוכו). הפלייליסט מכסה את
היסטוריית השיחה: בועה ישנה שנלחצת מצטרפת לפלייליסט (TTS on‑demand) וניתן לנווט ממנה.

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| `next`/`prev`/`jumpTo` (cursor, בין משפטים) | ✅ | — |
| `bubbleId` פר‑item (מיפוי בועה↔סגמנטים) | ✅ | — |
| AudioPlaylist → entity משותף (context) | ✅ | — |
| איחוד BubblePlayer (לחיצה→jump/reserve) | ✅ | — |
| TTS on‑demand לבועה היסטורית שנלחצת | ✅ | — |
| הקלטות‑משתמש בפלייליסט (user bubble nav) | ❌ | future (hook בלבד — החלטה #2) |
| UI כפתורי ⏮/⏭ | ❌ | B1 |

## §3 — Architecture diagram

```
view-models/audio-playlist.svelte.ts  (עולה מ-engine ל-VM/entity? — ר' §9 Q1)
  items: PlaylistItem[]  (+ bubbleId, + sentenceText למקרה reserve-from-history)
  cursor
  next() / prev() / jumpTo(index) / jumpToBubble(bubbleId)
  reserveFromText(bubbleId, segmentId, text)  ← ל-on-demand (BubblePlayer)

context.ts          + getAudioPlaylist/setAudioPlaylist
+layout.svelte      יוצר AudioPlaylist אחד, setContext

Speaker     ── מחזיק ref ל-playlist המשותף (במקום #player פרטי); reserve/markReady אליו
BubblePlayer ── toggle(bubbleId):
   item-of-bubble קיים בפלייליסט? → playlist.jumpToBubble(id)
   אחרת (היסטוריה)               → split → reserveFromText + fetch → markReady → jumpTo
   user bubble                    → playUserRecording (כמו היום; nav לא בסקופ)
```

## §4 — Commits

### Commit 0 — next/prev/jumpTo ב‑AudioPlaylist (approach: manual + integration)

**קבצים שמשתנים**: `audio-playlist.svelte.ts`

```ts
class AudioPlaylist {
  next(): void           // cursor→הבא; עוצר נוכחי; מתחיל ניגון מ-cursor
  prev(): void           // cursor→הקודם (לפחות 0); השמעה מחדש מ-cursor
  jumpTo(index: number): void   // cursor=index ; restart playback
  // jumpToSegment הישן → jumpTo(indexOf(segmentId))
}
```
- ניווט = עצור current (`audioStream.cancel(currentSegmentId)`), הזז cursor, ה‑`#playLoop`
  ממשיך מ‑cursor החדש. שמור transport (אם paused — לא להתחיל אוטומטית).
- ⚠️ סגמנט שכבר `done` ומנווטים אליו אחורה: צריך **לנגן מחדש**. אם ה‑AudioSink כבר ניקה
  אותו (PCM `cancel` מוחק) — צריך לשמר/לייצר מחדש. ר' §7.

**Verification**: integration test (Commit 3).

### Commit 1 — `bubbleId` פר‑item + jumpToBubble (approach: manual)

**קבצים שמשתנים**: `audio-playlist.svelte.ts`, `speaker.svelte.ts`

- `PlaylistItem` מקבל `bubbleId: string`. `reserve(segmentId, orderKey, bubbleId)`.
- ב‑`Speaker.#enqueue` מעבירים `bubbleId` (כבר זמין).
- `jumpToBubble(bubbleId)` → `jumpTo` ל‑item הראשון של אותה בועה.

**Verification**: typecheck.

### Commit 2 — AudioPlaylist ל‑context משותף (approach: manual)

**קבצים שמשתנים**: `context.ts`, `+layout.svelte`, `speaker.svelte.ts`, `bubble-player.svelte.ts`

- צור `AudioPlaylist` אחד ב‑`+layout.svelte`, `setAudioPlaylist` (section additive — parallel‑safe).
- `Speaker` מקבל אותו בבנאי (במקום ליצור `#player` משלו).
- `BubblePlayer` מקבל אותו; מסיר את ה‑`#sink` הפרטי.
- ⚠️ invasive ל‑context.ts/+layout — **additive בלבד** (זוג getter/setter חדש). אם דורש
  שינוי לא‑additive → escalate.

**Verification**: typecheck + smoke (האפליקציה עולה).

### Commit 3 — איחוד BubblePlayer.toggle (approach: manual + integration)

**קבצים שמשתנים**: `bubble-player.svelte.ts`, `audio-playlist.svelte.ts`

- `reserveFromText(bubbleId, segmentId, text)` — מוסיף item לסוף הפלייליסט, מתחיל fetch
  (resolveTts → prepareSegment → markReady). משותף עם מסלול ה‑on‑demand.
- `BubblePlayer.toggle`: message/thought → אם הבועה כבר בפלייליסט → `jumpToBubble`;
  אחרת → split (`splitIntoSentences`) + `reserveFromText` לכל משפט → `jumpToBubble`.
  user → `playUserRecording` כמו היום (לא נכנס לפלייליסט — future).
- guard קיים (`turnState !== "idle"` no‑op) — לשקול: עכשיו ניתן לנגן היסטוריה גם בזמן תור?
  ברירת מחדל: שמור את ה‑guard (להכריע §9 Q3).

**Verification**: integration (Commit נ) + אימות חי.

### Commit נ — integration tests לניווט (approach: TDD/integration)

**קבצים חדשים**: `audio-playlist.nav.test.ts`

- reserve 3 סגמנטים, נגן, `next()` → cursor מתקדם; `prev()` → חוזר ומנגן מחדש (mock sink).
- `jumpToBubble` → cursor קופץ ל‑item הנכון.
- `reserveFromText` → item נוסף עם bubbleId, מתנגן בתורו.

**Verification**: `pnpm --filter frontend test -- audio-playlist.nav`

## §5 — DoD

| בדיקה | איך |
|---|---|
| ⏭ מדלג למשפט הבא, ⏮ חוזר וקורא מחדש | integration + האזנה חיה |
| לחיצה על בועה היסטורית → מושמעת + ניתן לנווט ממנה | האזנה חיה |
| Speaker + BubblePlayer חולקים playlist אחד | קריאת diff (אין `#sink`/`#player` כפולים) |
| ניגון‑מחדש של סגמנט done (אחרי prev) עובד | האזנה — תשומת‑לב |
| regression: זרם חי רגיל עדיין משמיע בסדר | האזנה |
| build‑gate | typecheck + tests ירוקים |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| סגמנט `done` שנוקה ב‑AudioSink → אי‑אפשר prev | pcm/audio‑stream `cancel` מוחק | **אל תמחק על done** — רק על stop/clear; או reserveFromText‑מחדש ב‑prev. להכריע §7. |
| context.ts/+layout שינוי לא‑additive | parallel‑safe‑code.md | זוג getter/setter חדש בלבד; escalate אם יותר. |
| Svelte 5 reactivity על items+cursor | learnings | `$state`, mutate בהחלפה; צרכנים קוראים `.length`. |
| double‑ownership בזמן refactor (Commit 2) | — | להעביר בבת אחת; typecheck גייט. |
| TTS on‑demand כפול (Speaker + BubblePlayer לאותה בועה) | — | `jumpToBubble` אם כבר קיים; לא reserve כפול. |

## §7 — Escalation triggers

- ניגון‑מחדש (prev לסגמנט done) דורש לשמר AudioBuffers/blobs בזיכרון → החלטת זיכרון,
  שאל מרדכי (אולי לייצר מחדש on‑demand במקום לשמר).
- איחוד ה‑context שובר את ה‑5‑layer (BubblePlayer צריך גישה ל‑Settings+Session+Playlist) → שאל.
- guard ה‑`turnState idle` — אם המשתמשת רוצה לנגן היסטוריה תוך כדי תור → החלטת UX, שאל.

## §8 — Complexity score

8/10: ownership refactor (+2), streaming replay (+2), context משותף (+1), 4‑5 commits (+1),
איחוד שני VMs (+1), reactivity (+1). → **verifier: heavy**.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | AudioPlaylist נשאר engine או עולה ל‑VM? | engine שמוחזק כ‑entity ב‑context (יש בו `$state` כבר) | ❌ |
| 2 | prev לסגמנט done — לשמר buffer או לייצר מחדש? | לייצר מחדש (reserveFromText) — פשוט יותר, פחות זיכרון | ❌ |
| 3 | לנגן היסטוריה תוך‑כדי תור פעיל? | שמור guard (no‑op בתור) כמו היום | ❌ |
| 4 | הקלטות‑משתמש בפלייליסט? | לא — future (החלטה #2) | ❌ |
