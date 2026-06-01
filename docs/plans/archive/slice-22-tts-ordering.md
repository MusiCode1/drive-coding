# Slice 22 — TTS ordering + tool narration playback — תוכנית

> **תאריך**: 2026-05-30
> **סטטוס**: ✅ הושלם (2026-06-01) — branch slice-22-tts-ordering, commits fc80767..87da8f8
> **Complexity**: 7/10 (verifier: light + verifier-phase על Phase 2 ו-Phase 4)
> **תלות**: אין (additive על dev tip). slice 10 (persistence/replay) יבנה מעל ה-provenance שמונח כאן.
> **depends_on**: [] (ריק — additive בלבד)
> **Base**: dev tip `62b41a0` (היה `0da16aa`; הcommit הנוסף — qoder support ב-`cli-config.ts` בלבד — לא נוגע בקבצי ה-slice. line-numbers תקפים, אומת ב-git log)

---

## §0 — Pre-flight

> ה-boilerplate המלא ב-`docs/plans/EXECUTOR_DISPATCH.md` (§0-§10). אל תחזור עליו. מה שספציפי ל-slice הזה:

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-22-tts-ordering -b slice-22-tts-ordering dev
cd .worktrees/slice-22-tts-ordering
pnpm install && pnpm hooks:install
pnpm build --force   # monorepo: בנה core dist לפני typecheck (recommendations §14.1)
```

### איך להריץ

- **BE**: port 4000 אם פנוי, אחרת 4001+. חובה OneCLI (TTS+narrate עוברים דרך proxy):
  ```bash
  cd packages/backend
  PORT=<port> onecli run --agent voice-acp -- bun --watch src/server.ts
  ```
- **FE**: `BE_PORT=<port> pnpm --filter @drive-coding/frontend dev` (Vite OS-assigned port)
- **Tests**: `pnpm test` (כל החבילות) | `pnpm --filter @drive-coding/core test` (ליבת ה-ordering)
- **Tunnel**: לא נדרש (אין בדיקת Mic/mobile חדשה ב-slice הזה — אפשר לבדוק ב-localhost).

### Browser

linux-gui + `pw-clean.sh` (reference: `~/.config/opencode/memory` 2026-05-10). או דפדפן מקומי על ה-Vite URL. אין צורך ב-HTTPS — אין Mic.

### OneCLI agent

שם: `voice-acp` (ID `3f08d584-4da0-4cb4-87b4-9611ae0fa9c0`). מזריק `xi-api-key` ל-ElevenLabs ו-`x-goog-api-key` ל-Gemini. לא מזריק Anthropic (מכוון).

### Reading list

**must-read** (לפני שמתחילים):
- `packages/frontend/src/lib/view-models/speaker.svelte.ts` — כל הקובץ. ה-VM שמשתנה הכי הרבה.
- `packages/frontend/src/lib/engines/player.svelte.ts` — תור ה-FIFO הנוכחי שמוחלף.
- `packages/frontend/src/lib/engines/audio-stream.ts` — `prepareSegment` (מוסיף provenance param).
- `packages/core/src/voice/cache-key.ts` — `cacheKeyFor()` הקיים — זה ה-textHash.
- `packages/frontend/AGENTS.md` — חמשת חוקי הזהב + Parallel-safe additive design.

**reference** (בזמן עבודה):
- `packages/frontend/src/lib/adapters/voice/narrate.ts` — `narrate()` הקיים (לא משתנה — רק נקרא ממקום חדש).
- `packages/core/src/voice/sentence-boundary.ts` — `splitIntoSentences` (לא משתנה).
- `packages/frontend/src/lib/types/bubble.ts` — מודל ה-Bubble.

---

## §1 — מטרה

כשהסוכן מדבר, מחשבות, הודעות וקריינות-כלים נשמעים **בסדר הכרונולוגי הנכון** — גם כשה-TTS של משפט מאוחר חוזר מ-ElevenLabs לפני משפט מוקדם (fetch מקבילי), וגם כשקריינות כלי מתעכבת בגלל קריאת Gemini אסינכרונית. בנוסף, קריינות הכלים (שהיום רק מוצגת כטקסט) **נשמעת קולית** בנקודה הכרונולוגית שלה. הסדר נקבע ע"י orderKey דטרמיניסטי שה-Speaker מקצה, לא ע"י סדר הגעת ה-fetch.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| תור TTS ממוין לפי orderKey (סדר נכון תחת fetch מקבילי) | ✅ | ה-slice הזה |
| קריינות כלים נשמעת קולית (לא רק טקסט) | ✅ | ה-slice הזה |
| provenance (messageId + textHash) על job + על AudioSegment | ✅ | ה-slice הזה — **כתיבה בלבד, אין צרכן** |
| best-effort skip של narration שלא הספיק | ✅ | ה-slice הזה |
| persistence של narration/audio ל-reload | ❌ | slice 10 |
| jumpToSegment / replay אמיתי לפי provenance | ❌ | slice 10 |
| lookup של segment לפי messageId/textHash | ❌ | slice 10 (אסור להוסיף צרכן כאן — Escalation) |
| שינוי LOOKAHEAD / מקביליות ה-fetch | ❌ | נשאר 2 — ה-ordering מתקן את הסדר, לא את המקביליות |

> זו לא טבלת TODO. זו הגנה מ-scope creep. במיוחד: **אל תוסיף שום קוד שקורא את ה-provenance.**

---

## §3 — Architecture diagram

```
                  Speaker (view-model)
                  ┌───────────────────────────────────┐
  bubbles ───────▶│ #enqueue: #orderAlloc.next(bid)    │
  (message/        │   → orderKey = (seq, segmentIndex) │
   thought/tool)   │   (לוגיקה ב-core OrderAllocator)   │
                  │                                    │
                  │ #fetchJob:                         │
                  │   thought → translate              │
                  │   tool    → narrate (NEW)          │
                  │   textHash = cacheKeyFor(text,...)  │
                  │   synthesizeStreaming              │
                  │   → audioStream.prepareSegment(     │
                  │        segId, stream, ac,           │
                  │        {messageId, textHash})  NEW  │
                  │   → player.addSegment(segId,        │
                  │        orderKey)              CHANGED│
                  └───────────────┬───────────────────┘
                                  │
                                  ▼
                  Player (engine) ── uses ──▶ core/voice/tts-queue.ts  ← NEW (pure, TDD)
                  ┌───────────────────────────────────┐  ┌──────────────────────┐
                  │ #queue: OrderedQueue<segId>        │  │ OrderKey type         │
                  │ addSegment(segId, orderKey)        │  │ compareOrderKey()     │
                  │ #playLoop:                         │  │ OrderedQueue          │
                  │   play in orderKey order,          │  │ OrderAllocator        │
                  │   skip-if-not-ready (best-effort)  │  │   .next(bid)/.clear()  │
                  └───────────────┬───────────────────┘  └──────────────────────┘
                                  │
                                  ▼
                  AudioStream (engine)
                  ┌───────────────────────────────────┐
                  │ AudioSegment += {messageId?,        │  ← provenance (כתיבה בלבד)
                  │   textHash?}                        │
                  │ prepareSegment(...,provenance?)    │  ← param אופציונלי חדש
                  └───────────────────────────────────┘
```

---

## §4 — Commits בסדר

### Commit 0 — core: tts-queue pure ordering module (approach: tdd)

> מכיל **שלושה** building blocks pure: `compareOrderKey` (השוואה), `OrderedQueue` (תור ממוין לתזמון ב-Player), ו-`OrderAllocator` (הקצאת orderKey לבועות — חולץ מ-Speaker כדי שיהיה ניתן לבדיקת יחידה). כל השלושה ב-TDD מלא — זו כל הלוגיקה הבדיקה של ה-slice; שאר ה-commits הם IO-wiring שנבדק בדפדפן.

**קבצים חדשים**:
- `packages/core/src/voice/tts-queue.ts`
- `packages/core/tests/voice/tts-queue.test.ts` — **שים לב: `tests/` (plural)**. כל test files של core יושבים שם (למשל `packages/core/tests/voice/cache-key.test.ts`). קובץ ב-`test/` (singular) **לא ירוץ** ב-`pnpm test`.

**API skeleton** (החתימה המדויקת — executor אסור לשנות):

```ts
/** מפתח סדר דו-מימדי. seq ראשי, segmentIndex משני. */
export type OrderKey = {
  /** מונה מונוטוני שמוקצה ע"י המפיק (Speaker) — סדר הבועות. */
  seq: number
  /** אינדקס המשפט בתוך הבועה (0-based). */
  segmentIndex: number
}

/** השוואה לקסיקוגרפית: seq, אז segmentIndex. <0 / 0 / >0. */
export function compareOrderKey(a: OrderKey, b: OrderKey): number

/**
 * תור ממוין גנרי לפי OrderKey. insert שומר על מיון.
 * takeNext מחזיר את הערך עם ה-OrderKey הקטן ביותר (ומסיר אותו), או undefined אם ריק.
 * peekNext מחזיר בלי להסיר.
 */
export class OrderedQueue<T> {
  get size(): number
  insert(key: OrderKey, value: T): void
  takeNext(): { key: OrderKey; value: T } | undefined
  peekNext(): { key: OrderKey; value: T } | undefined
  clear(): void
}

/**
 * מקצה orderKey לבועות. pure — מחזיק רק את ה-state של ההקצאה (מונים), בלי IO.
 * ה-Speaker מחזיק instance אחד וקורא ל-next() לכל job. חולץ מ-Speaker כדי
 * שלוגיקת ההקצאה (seq יציב פר-bubble, segmentIndex עולה) תהיה ניתנת לבדיקת יחידה.
 */
export class OrderAllocator {
  /**
   * מחזיר orderKey ל-job הבא של bubbleId נתון.
   * - bubbleId שלא נראה → seq חדש (מונוטוני), segmentIndex=0.
   * - bubbleId שכבר נראה → אותו seq, segmentIndex עולה ב-1 בכל קריאה.
   */
  next(bubbleId: string): OrderKey
  /** מנקה את מצב הבועות. שים לב: ה-seq הגלובלי **לא** מתאפס (מונוטוניות בין שיחות). */
  clear(): void
}
```

**Tests (TDD — אדום קודם)**:

*compareOrderKey + OrderedQueue:*
- `compareOrderKey`: seq שונה → לפי seq. seq זהה → לפי segmentIndex. שווים → 0.
- `compareOrderKey({seq:-1, segmentIndex:0}, {seq:0, segmentIndex:0}) < 0` — **seq שלילי תמיד ראשון. זה ה-guard ל-`jumpToSegment` (Commit 2) שמשתמש ב-seq=-1. ודא שההשוואה signed (חיסור רגיל, לא bitwise/unsigned).**
- `OrderedQueue`: insert בסדר אקראי → takeNext מחזיר בסדר ממוין.
- insert של (seq=2,idx=0) לפני (seq=1,idx=0) → takeNext מחזיר (1,0) קודם. **זה ה-regression test לבאג ה-fetch המקבילי.**
- insert של (seq=1,idx=1) ואז (seq=1,idx=0) → (1,0) קודם.
- takeNext על ריק → undefined. clear מרוקן.

*OrderAllocator (זה הטסט שתופס off-by-one + seq-stability ב-Speaker):*
- bubble חדש "A" → `{seq:0, segmentIndex:0}`. קריאה שנייה ל-"A" → `{seq:0, segmentIndex:1}` (אותו seq, idx עולה).
- "A" אז "B" → A מקבל seq=0, B מקבל seq=1 (seq מונוטוני, יציב פר-bubble).
- סדר interleaved: A, B, A → `{0,0}`, `{1,0}`, `{0,1}` (seq של A יציב גם אחרי ש-B נכנס).
- `clear()` → bubble "A" חדש מקבל seq חדש (לא 0 — ה-seq הגלובלי לא מתאפס). אמת ש-segmentIndex כן מתאפס (A "חדש" אחרי clear → idx=0).

**Export**: ה-`voice/*` כבר מיוצא ב-`packages/core/package.json` (`"./voice/*": "./src/voice/*.ts"`) — אין צורך לערוך exports. ה-import בצד FE: `import { OrderedQueue, OrderAllocator, compareOrderKey, type OrderKey } from "@drive-coding/core/voice/tts-queue"`.

**Verification**:
```bash
pnpm --filter @drive-coding/core test
pnpm --filter @drive-coding/core typecheck
```

---

### Commit 1 — engine: AudioStream provenance param (approach: manual)

> **למה manual ולא integration**: השינוי הוא תוספת metadata על מבנה שמחזיק MediaSource/HTMLAudioElement. אין מה לבדוק אוטומטית — MediaSource לא קיים ב-happy-dom (audio-stream.ts:11), וכל mock היה בודק את ה-mock. אימות: typecheck (החתימה תואמת) + build. אין test runner חדש כאן בכוונה.

**קבצים שמשתנים**:
- `packages/frontend/src/lib/engines/audio-stream.ts`

**שינוי 1** — הוסף שדות אופציונליים ל-`AudioSegment` (אחרי `state`, audio-stream.ts:23):
```ts
export type AudioSegment = {
  segmentId: string
  audio: HTMLAudioElement
  mediaSource: MediaSource
  sourceBuffer: SourceBuffer | null
  abortController: AbortController
  state: AudioSegmentState
  // ─── slice 22: provenance (metadata בלבד — אין צרכן ב-slice זה) ───
  messageId?: string | null
  textHash?: string
}
```

**שינוי 2** — הוסף פרמטר אופציונלי ל-`prepareSegment` (audio-stream.ts:38-42):
```ts
async prepareSegment(
  segmentId: string,
  stream: ReadableStream<Uint8Array>,
  ac: AbortController,
  provenance?: { messageId: string | null; textHash: string },  // ← חדש
): Promise<void> {
```
בתוך הבנייה של `seg` (audio-stream.ts:47-54), הוסף:
```ts
const seg: AudioSegment = {
  segmentId,
  audio,
  mediaSource,
  sourceBuffer: null,
  abortController: ac,
  state: "loading",
  messageId: provenance?.messageId,
  textHash: provenance?.textHash,
}
```

> **אסור**: שום קוד שקורא את `seg.messageId` / `seg.textHash`. רק כתיבה. אם מתעורר פיתוי "לחפש segment לפי hash" — Escalation (זה slice 10).

**אימות** (manual): typecheck מאמת שהחתימה תואמת. ה-wiring האמיתי (provenance מגיע לשדות) נבדק ב-verifier-phase של Commit 2 + DoD #6 (console.log בדפדפן).

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck
pnpm --filter @drive-coding/frontend build
```

---

### Commit 2 — engine: Player ordered queue (approach: manual)  ⚠️ verifier-phase אחרי commit זה

> **למה manual ולא integration**: לוגיקת הסדר עצמה (compare/insert/takeNext) כבר נבדקה ב-Commit 0 (OrderedQueue, TDD). מה ש-`#playLoop` מוסיף מעבר לזה הוא רק `await audioStream.play(id)` — IO טהור על MediaSource שלא ניתן לבדיקה בלי mock. לכן אין integration test כאן; ה-wiring נבדק ב-verifier-phase (דפדפן אמיתי, DoD #3).

**קבצים שמשתנים**:
- `packages/frontend/src/lib/engines/player.svelte.ts`

**שינוי החתימה** (invasive על Player, אבל ה-consumer היחיד הוא Speaker — בטוח):

```ts
import { OrderedQueue, type OrderKey } from "@drive-coding/core/voice/tts-queue"

export class Player {
  state: PlayerState = $state("idle")
  currentSegmentId: string | null = $state(null)

  #audioStream: AudioStream
  #queue = new OrderedQueue<string>()   // היה: string[]
  #playing = false

  // CHANGED signature: מקבל orderKey
  addSegment(segmentId: string, orderKey: OrderKey): void {
    this.#queue.insert(orderKey, segmentId)
    if (this.#playing) return
    void this.#playLoop()
  }
  // ...
}
```

**הערות line-number** (אומתו מול dev tip `62b41a0`): `#queue` שורה 21, `addSegment` שורה 32, `jumpToSegment` שורה 42, `stop()` שורה 55, `#playLoop` שורה 66. הקובץ ב-`packages/frontend/src/lib/engines/player.svelte.ts` (engine, לא view-model).

**#playLoop — "play in order, skip-if-not-ready"** (מחליף את הלולאה ב-player.svelte.ts:66-85):
```ts
async #playLoop(): Promise<void> {
  this.#playing = true
  this.state = "playing"
  try {
    let next = this.#queue.takeNext()
    while (next !== undefined) {
      const id = next.value
      this.currentSegmentId = id
      try {
        await this.#audioStream.play(id)
      } catch (_e) {
        // MIN-5: בוטל / שגיאה / לא-מוכן → דלג, המשך לבא בתור (best-effort).
      }
      next = this.#queue.takeNext()
    }
  } finally {
    this.#playing = false
    this.state = "idle"
    this.currentSegmentId = null
  }
}
```

> **הערת ordering חשובה**: ה-best-effort הנבחר הוא — `AudioStream.play` כבר ממתין אם `state==="loading"` ודוחה אם `"cancelled"` (audio-stream.ts:130-137). זה בדיוק "המתן אם הבא בתור עוד fetching, דלג אם נכשל". **אל תוסיף timeout-skip נוסף ב-Player** — ההתנהגות הקיימת של AudioStream.play היא ה-best-effort הנכון. ה-narration שלא יספיק יידחה דרך abort (ראה Commit 3).

**שינוי `stop()`** (player.svelte.ts:55-64): `this.#queue` כבר לא array. החלף:
```ts
stop(): void {
  const ids: string[] = []
  let n = this.#queue.takeNext()
  while (n !== undefined) { ids.push(n.value); n = this.#queue.takeNext() }
  if (this.currentSegmentId !== null) ids.push(this.currentSegmentId)
  this.#queue.clear()
  for (const id of ids) this.#audioStream.cancel(id)
  this.#playing = false
  this.state = "idle"
  this.currentSegmentId = null
}
```

**`jumpToSegment`** (player.svelte.ts:42-50): מסומן "slice 10, לא בשימוש". **השאר אותו עובד מבחינת types** — צריך orderKey עכשiv. הפתרון המינימלי: תן לו orderKey של `{seq: -1, segmentIndex: 0}` (תמיד ראשון) ושמור התנהגות:
```ts
jumpToSegment(segmentId: string): void {
  this.#queue.clear()
  this.#queue.insert({ seq: -1, segmentIndex: 0 }, segmentId)
  if (this.#playing) return
  void this.#playLoop()
}
```
> אם זה נראה מאולץ — מותר. זו פונקציה לא-בשימוש שצריכה רק לעבור typecheck. אל תשקיע בה.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck
pnpm --filter @drive-coding/frontend build
```

**verifier-phase אחרי commit זה**: כן — זה הליבה שיכולה לשבור את כל ה-TTS. ה-verifier יריץ flow קולי ויאמת שמשפטים נשמעים בסדר (ראה §5 DoD #3).

---

### Commit 3 — speaker: orderKey + textHash + tool narration job (approach: integration)

**קבצים שמשתנים**:
- `packages/frontend/src/lib/view-models/speaker.svelte.ts`

**שינוי 1 — `TtsJob` type** (speaker.svelte.ts:45-54). הוסף `"tool"` ל-kind, והוסף שדות:
```ts
export type TtsJob = {
  segmentId: string
  kind: "message" | "thought" | "tool"   // היה: "message" | "thought"
  messageId: string | null
  text: string
  status: TtsJobStatus
  abort: AbortController
  bubbleId?: string
  // ─── slice 22 ───
  orderKey: OrderKey            // (seq, segmentIndex)
  /** ל-tool: toolCallId לכתיבת narration חזרה לבועה אחרי ה-fetch. */
  toolCallId?: string
}
```
import: `import { OrderAllocator, type OrderKey } from "@drive-coding/core/voice/tts-queue"` ו-`import { cacheKeyFor } from "@drive-coding/core/voice/cache-key"`.

**שינוי 2 — OrderAllocator instance** (שדה חדש ליד ה-private fields, speaker.svelte.ts:80-89). **כל לוגיקת ה-seq/segmentIndex עברה ל-`OrderAllocator` ב-core (Commit 0) — אל תשכפל אותה כאן עם Maps ידניים.**
```ts
/** slice 22: מקצה orderKey לבועות. לוגיקה ב-core (נבדק unit). */
readonly #orderAlloc = new OrderAllocator()
```

**שינוי 3 — `#enqueue`** (speaker.svelte.ts:244-260): קרא ל-`#orderAlloc.next(bid)`. ה-seq יציב פר-bubble; ה-segmentIndex עולה פר משפט — **הכל בתוך ה-allocator**.

> הערה: `#enqueue` משרת רק `message`/`thought` (הוא נקרא מ-`#processBubbles`/`#handleStatusTransition`). **tool jobs נוצרים ישירות ב-`#processToolBubbles`** (שינוי 5), לא דרך `#enqueue` — לכן החתימה של `#enqueue` נשארת `kind: "message" | "thought"` בלי `"tool"`. זה מכוון.
```ts
#enqueue(
  kind: "message" | "thought",
  messageId: string | null,
  text: string,
  bubbleId?: string,
): void {
  if (text.length === 0) return
  const bid = bubbleId ?? messageId ?? crypto.randomUUID()
  const orderKey = this.#orderAlloc.next(bid)
  this.#jobs.push({
    segmentId: crypto.randomUUID(),
    kind,
    messageId,
    text,
    status: "pending",
    abort: new AbortController(),
    bubbleId,
    orderKey,
  })
}
```

**שינוי 4 — `#fetchJob`: textHash + addSegment עם orderKey** (speaker.svelte.ts:275-311). אחרי שלב התרגום, חשב textHash על ה-**טקסט שמסונתז**, והעבר provenance + orderKey:
```ts
async #fetchJob(job: TtsJob): Promise<void> {
  try {
    let text = job.text

    if (job.kind === "thought") {
      const result = await translate(text, TARGET_LANG, job.abort.signal)
      if (result !== null && result.status === "translated") {
        if (job.bubbleId !== undefined) {
          this.#persistThoughtTranslation(job.bubbleId, job.text, result.text)
        }
        text = result.text
      }
    } else if (job.kind === "tool") {
      // slice 22: narration נוצר כאן (best-effort). null → דלג על ה-job.
      const narrationText = await this.#narrateForJob(job)
      if (narrationText === null) { job.status = "error"; return }
      text = narrationText
    }

    if (job.abort.signal.aborted) { job.status = "error"; return }

    const textHash = await cacheKeyFor(text, this.#settings.voiceId, "eleven_v3")
    const stream = await synthesizeStreaming({
      text,
      voiceId: this.#settings.voiceId,
      signal: job.abort.signal,
    })
    await this.#audioStream.prepareSegment(job.segmentId, stream, job.abort, {
      messageId: job.messageId,
      textHash,
    })
    this.#player.addSegment(job.segmentId, job.orderKey)
    job.status = "ready"
  } catch (e) {
    job.status = "error"
    console.warn("TTS job failed, skipping segment", {
      id: job.segmentId,
      err: e instanceof Error ? e.message : String(e),
    })
  }
}
```

> **הערה על "eleven_v3" hardcoded**: ה-modelId מוגדר ב-`tts.ts:22` כ-default `"eleven_v3"`. כאן אנחנו משכפלים את הקבוע כדי לחשב hash תואם. זה ערך טכני (לא מחרוזת UI) — מותר ב-lint. אם רוצים לחלץ ל-const משותף — מותר אבל לא נדרש.

**שינוי 5 — `#processToolBubbles`: enqueue במקום כתיבה ישירה** (speaker.svelte.ts:317-366). היום ה-narration נכתב רק לתצוגה. עכשiv: צור job עם orderKey כרונולוגי, וכתיבת ה-narration לבועה תקרה בתוך ה-job.

> **החלטה (סגורה — לא optional): הסר את `#narratingCallIds` Set לגמרי.**
> ה-guard האמיתי נגד re-narrate הוא `#processedNarrationCallIds` (נוסף לפני יצירת ה-job, נשאר לתמיד). ה-`#narratingCallIds` היה נחוץ במודל ה-`.then().finally()` הישן כדי לסמן "בטיסה" — אבל עכשiv ה-tool הוא job רגיל שעובר דרך `#jobs`/`#pumpFetchLoop`, וה-`status` של ה-job + `#processedNarrationCallIds` מכסים את הכל. **מחק את ההצהרה (speaker.svelte.ts:86-87), את ה-`.add` ואת ה-`.has` check.** אל תשאיר Set בלי delete (זה memory leak).

החלף את גוף הלולאה הפנימי (אחרי בדיקות ה-guard) — שים לב שה-`#narratingCallIds.has` check נמחק:
```ts
// guards (ללא #narratingCallIds — נמחק):
//   if (tc.status !== "completed") continue
//   if (tc.narration !== undefined) { #processedNarrationCallIds.add; continue }
//   if (#processedNarrationCallIds.has(tc.toolCallId)) continue
this.#processedNarrationCallIds.add(tc.toolCallId)

// slice 22: הקצה orderKey כרונולוגי לבועת ה-tool (כמו message/thought),
// דרך אותו OrderAllocator — לכן ה-seq של ה-tool נכון יחסית למשפטים סביבו.
const bid = bubble.id
const orderKey = this.#orderAlloc.next(bid)

this.#jobs.push({
  segmentId: crypto.randomUUID(),
  kind: "tool",
  messageId: null,
  text: "",            // יתמלא ב-#narrateForJob
  status: "pending",
  abort: new AbortController(),
  bubbleId: bid,
  toolCallId: tc.toolCallId,
  orderKey,
})
this.#pumpFetchLoop()
```

**שינוי 6 — מתודה פרטית חדשה `#narrateForJob`** (ב-`// ─── פנימיות ───`): קוראת narrate(), כותבת את הטקסט חזרה לבועה (לתצוגה), ומחזירה את הטקסט ל-TTS. מאחדת את הלוגיקה שהייתה ב-`.then()` הישן:
```ts
async #narrateForJob(job: TtsJob): Promise<string | null> {
  if (job.toolCallId === undefined || job.bubbleId === undefined) return null
  const idx = this.#session.bubbles.findIndex((b) => b.id === job.bubbleId)
  if (idx === -1) return null
  const b = this.#session.bubbles[idx]
  if (b === undefined || b.kind !== "tool") return null
  const tc = b.toolCall

  const ctx: NarrateContext = {
    userMessage: this.#session.lastUserMessage,
    recentMessages: this.#session.recentAssistantMessages(3),
  }
  const tool: ToolCallForNarrate = {
    toolCallId: tc.toolCallId,
    kind: tc.kind,
    title: tc.title ?? tc.name,
  }
  const text = await narrate(ctx, tool, job.abort.signal)
  if (text === null) return null

  // כתוב narration חזרה לבועה (תצוגה) — Svelte 5: החלף בועה שלמה.
  const cur = this.#session.bubbles.findIndex((x) => x.id === job.bubbleId)
  if (cur !== -1) {
    const maybe = this.#session.bubbles[cur]
    if (maybe !== undefined && maybe.kind === "tool") {
      this.#session.bubbles[cur] = {
        ...maybe,
        toolCall: { ...maybe.toolCall, narration: text },
      }
    }
  }
  return text
}
```
> נקה את ה-`.then(...).finally(...)` הישן (speaker.svelte.ts:350-364) ואת ה-`narrate` שנקרא שם — כל הלוגיקה הזו עוברת ל-`#narrateForJob`. ה-`#narratingCallIds` נמחק לגמרי (ראה שינוי 5). אין `.delete` בשום מקום כי אין יותר Set.

**שינוי 7 — `#stopAndClear`** (speaker.svelte.ts:407-431): נקה את ה-allocator:
```ts
this.#orderAlloc.clear()
// הערה: ה-seq הגלובלי בתוך ה-allocator לא מתאפס ב-clear() — מונוטוני בין שיחות (מכוון).
```

**אימות (integration — קוד קודם, אז test באותו commit):**

> מאחר שכל לוגיקת ה-orderKey עברה ל-`OrderAllocator` ב-core, היא **כבר מכוסה** ע"י unit tests של Commit 0 (off-by-one, seq-stability, clear). ה-Speaker רק קורא ל-`next()`/`clear()` — אין כאן לוגיקה חדשה לבדוק שלא נבדקה. ה-wiring (Speaker→Player→AudioStream) נבדק ב-verifier-phase + e2e (DoD #3-#6). זה ה-integration: הקוד הניתן-לבדיקה חולץ ונבדק; ה-IO-bound נבדק בדפדפן.

```bash
pnpm --filter @drive-coding/core test       # OrderAllocator + OrderedQueue ירוקים
pnpm --filter @drive-coding/frontend typecheck
pnpm lint:i18n
pnpm --filter @drive-coding/frontend build
```

---

### Commit 4 — manual e2e + walkthrough (approach: manual)  ⚠️ verifier-phase

**קבצים שמשתנים**:
- `packages/frontend/docs/slices.md` (סטטוס slice 22 → done)
- `docs/walkthrough.md` (ערך חדש — השתמש ב-skill `update-walkthrough`)
- ה-brief הזה (סטטוס → הושלם)

**Manual e2e** (תעד ב-commit msg אילו flows רצת — ראה §5):
1. שיחה קולית עם הסוכן שמייצר מספר משפטים + לפחות tool call אחד.
2. ודא שהמשפטים נשמעים **בסדר** (לא מבולגן).
3. ודא ש-narration של הכלי **נשמע** קולית בנקודה הנכונה.
4. ודא regression: thought translation עדיין עובד, toggle off/on עדיין עובד.

**verifier-phase אחרי commit זה**: כן — verifier-slice-light הסופי (ראה §5).

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck + build + tests ירוקים | `pnpm typecheck && pnpm build && pnpm test` |
| 2 | lint:i18n | `pnpm lint:i18n` |
| 3 | **סדר השמעה נכון** | פתח FE+BE(OneCLI), שלח prompt שמייצר 3+ משפטים. הקשב: המשפטים נשמעים בסדר רציף, לא הפוך. (ה-regression test ב-Commit 0 מכסה את הלוגיקה; כאן מאמתים end-to-end.) |
| 4 | **tool narration נשמע** | prompt שגורם ל-tool call (למשל "קרא את הקובץ X"). ודא: (א) ה-narration מוצג כטקסט בבועת ה-tool, (ב) **נשמע קולית** בנקודה הכרונולוגית. |
| 5 | best-effort skip | אם narration איטי (Gemini timeout 3s) — ההשמעה לא נתקעת; ממשיכה למשפט הבא. (קשה לזמן ידנית — אמת שאין deadlock: השמעה תמיד מסתיימת.) |
| 6 | provenance נכתב | ב-DevTools, breakpoint/console.log ב-`prepareSegment` — ודא ש-`seg.messageId` ו-`seg.textHash` מאוכלסים. (אין צרכן — רק מאמתים כתיבה.) |
| 7 | regression: thought translation | thought bubble מציג HE+EN כמו לפני (slice 4). |
| 8 | regression: toggle/stop | כיבוי קול באמצע השמעה עוצר; הדלקה מחדש לא משחזרת היסטוריה. |
| 9 | core unit tests | `pnpm --filter @drive-coding/core test` — tts-queue ירוק: `OrderedQueue` (regression סדר הפוך) + `OrderAllocator` (off-by-one, seq-stability, clear). |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| seq גלובלי גדל ללא הגבלה | OrderAllocator | number JS מחזיק עד 2^53 — לא בעיה מעשית. `clear()` לא מאפס seq (סדר בין שיחות). נבדק unit. |
| seq לא יציב אם bubbleId משתנה | Svelte 5 — bubble מוחלף שלם בכל update | ה-seq ממופה לפי `bubble.id` שלא משתנה (רק התוכן מוחלף). ✓ אומת ב-agent-session:439 — `id` נשמר. OrderAllocator ממפתח לפי bid. |
| Player invasive signature change | AGENTS.md golden rule #5 | ה-consumer היחיד הוא Speaker (+jumpToSegment לא-בשימוש). refactor מלא באותו commit — לא backward-compat. ✓ |
| Hardcoded "eleven_v3" כפול | tts.ts:22 | ערך טכני, לא UI string — lint:i18n מתעלם. אופציונלי לחלץ const. |
| textHash ≠ BE proxy-cache key | proxy-cache.ts:45 ממ-hash את כל ה-request body | **כוונה**: ה-textHash הוא provenance content-stable, לא חייב להתאים byte-ל-byte ל-BE key. שניהם sha256 של תוכן — מספיק. אל תנסה ליישר אותם ב-slice הזה. |
| MediaSource לא ב-happy-dom | audio-stream.ts:11 | לכן ליבת ה-ordering ב-core (pure, נבדק). Player/AudioStream נבדקים ידנית בדפדפן (verifier-phase). |
| $effect reactivity על ה-allocator | learnings 2026-05-16 (Svelte 5 $effect read+write loop) | `OrderAllocator` הוא class רגיל עם Maps פנימיים (לא $state) — לא מפעיל reactivity. נקרא תחת untrack כמו שאר ה-Speaker. ✓ |
| הסרת `#narratingCallIds` משאירה leak | Commit 3 שינוי 5 | **הוחלט: מחק את ה-Set לגמרי.** `#processedNarrationCallIds` הוא ה-guard. אל תשאיר Set בלי delete. |

> 3 שתמיד נשכחים:
> 1. Hardcoded strings → i18n: אין מחרוזות UI חדשות ב-slice (narration text מגיע מ-Gemini, prompt ב-core whitelisted). ✓
> 2. Reactivity gotchas: מונים = Map רגיל, לא $state. כתיבות תחת untrack. ✓
> 3. OneCLI placeholder: ה-BE חייב OneCLI ל-narrate+TTS. ✓ §0.

---

## §7 — Escalation triggers

> אם X — עצור ושאל את Tama:

- פיתוי להוסיף **צרכן** ל-provenance (lookup לפי messageId/textHash, jumpToSegment אמיתי) — זה slice 10, לא כאן.
- פיתוי לשנות את LOOKAHEAD או את מקביליות ה-fetch — לא ב-scope.
- ה-best-effort skip מצריך timeout נוסף מעבר ל-AudioStream.play הקיים — אם נראה לך שצריך, Escalate (אולי ה-tradeoff השתנה).
- `OrderedQueue` מתגלה כצוואר בקבוק ביצועים (insfor O(n)) — לא צפוי בנפחים שלנו, אבל אם כן — Escalate לפני אופטימיזציה.
- שינוי ב-`AudioStream.play` flow (לא רק הוספת provenance) — invasive ב-engine קריטי.
- Brief סותר את עצמו / קוד בפועל שונה מ-file:line שצוטט.

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| Streaming/real-time (audio chunks, ordering) | +2 |
| State machine / async coordination (queue, races, best-effort) | +2 |
| Refactor של קוד קיים (Player, Speaker) | +1 |
| >5 files? (core×2, audio-stream, player, speaker, docs) ב->2 packages | +1 |
| Pure logic core extraction (tts-queue) — TDD מלא | -1 |
| Cross-store data flow חדש? לא (הכל בתוך FE engines/VM) | 0 |
| ספרייה חיצונית חדשה? לא | 0 |

**Score**: 5 / 10

**Tier**: light + verifier-phase על Phase 2 (Player) ו-Phase 4 (e2e סופי).

**Verifier-phase אחרי commit/phase**: 2, 4.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | להסיר את `#narratingCallIds` לגמרי או להשאיר? | **סגור: הסר לגמרי** (Commit 3 שינוי 5) | ❌ |
| 2 | לחלץ "eleven_v3" ל-const משותף בין tts.ts ל-speaker? | לא — שכפל קבוע מקובל | ❌ |
| 3 | provenance גם על AudioSegment או רק job? | **גם על segment** — הוחלט עם Tama (כתיבה בלבד, hook ל-slice 10) | ❌ (סגור) |

---

## סטיות מהתכנון (מתעדכן ע"י executor תוך כדי)

> ה-executor מתעד פה כל סטייה מה-brief ולמה.

- ...
