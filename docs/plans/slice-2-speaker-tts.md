# Slice 2 — Speaker + TTS — תוכנית

> **תאריך**: 2026-05-28
> **סטטוס**: ‏טיוטה — ‏מחכה לאישור לפני יצירת worktree
> **Complexity**: 9/10 (verifier: heavy)
> **תלות**: ‏slice 0.5 (i18n) ✅ הושלם. ‏slice 1 (Mic+STT) — **מדולג**, ‏נחזור אליו ב-slice 3
> **מתבסס על**: ‏`docs/plans/README.md` — ‏מבנה תוכניות

---

## §0 — Pre-flight

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-2-speaker-tts -b slice-2-speaker-tts dev
cd .worktrees/slice-2-speaker-tts
pnpm install
pnpm hooks:install   # ‏חובה — ‏מפעיל pre-commit hook ל-Hebrew lint
```

‏בלי `hooks:install` ה-pre-commit לא ירוץ, ‏ומחרוזת עברית בקוד תיכנס לcommit. ‏ראה root AGENTS.md →§Worktrees.

### איך להריץ

| ‏מה | ‏פקודה | ‏Port |
|---|---|---|
| ‏BE | `pnpm --filter @drive-coding/backend dev` | 4000 (fixed) |
| ‏FE | `pnpm --filter @drive-coding/frontend dev` | OS-assigned (ראה לוג Vite) |

‏שני terminals נפרדים. ‏ה-FE מאזין לproxy של `/api`, `/proxy`, `/ws` ‏→ ‏BE 4000.

**Critical**: ‏מ-learnings 2026-05-14, ‏אם רץ בtmux — ‏לוודא `NO_PROXY=localhost,127.0.0.1,::1` ‏לפני init של ה-tmux server. ‏אחרת ACP plugins נכשלים ב-"No models available".

### Tunnel (לבדיקה ממכשיר נייד או חיצוני)

```bash
ssh -i ~/.ssh/pico -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 \
  -R drive-coding:80:localhost:<vite-port> tuns.sh http
```

‏URL: ‏`https://your-app.nue.tuns.sh`

### Browser

‏Chrome רגיל (localhost) או linux-gui (`pw-clean.sh`) ‏אם צריך לבדוק bot detection.
‏לבדיקת mobile: ‏OnePlus דרך ה-tunnel ‏(`https://your-app.nue.tuns.sh`).

### OneCLI agent

‏שם: ‏`voice-acp` (id `3f08d584-4da0-4cb4-87b4-9611ae0fa9c0`)
‏מזריק: ‏`xi-api-key` ל-`api.elevenlabs.io`, ‏`x-goog-api-key` ל-`generativelanguage.googleapis.com`
‏שימוש: ‏`onecli run --agent voice-acp -- <cmd>` ‏(לבדיקות SDK ידניות)

‏⚠️ ‏לא מזריק Anthropic — ‏מכוון, ‏מ-learnings 2026-05-14.

### Reading list

**must-read לפני שמתחילים** (סה"כ ~‎15 ‏דקות):

1. ‏`packages/frontend/AGENTS.md` — ‏5 חוקי זהב + ‏מבנה 5 שכבות
2. ‏`packages/frontend/docs/bubble-model.md` — ‏ה-state model החדש שמיושם בcommit 1
3. ‏`docs/plans/README.md` §1 (מתי TDD) + §3 (Section-by-section טיפים — ‏כולל "‏3 gotchas שתמיד נשכחים")
4. ‏`AGENTS.md` ‏(root) §Worktrees, ‏§Ports, ‏§Git hooks, ‏§Working with Tama

**reference בזמן עבודה**:

- ‏`packages/frontend/docs/slices.md` — ‏entry של slice 2 + ‏סדר ה-slices
- ‏`docs/frontend-spec.md §9` (Voice Flow) — ‏רלוונטי ל-Speaker. ‏§7 (Chat Bubbles) ‏רלוונטי ל-bubble rendering ב-commit 1
- ‏`packages/core/src/voice/sentence-boundary.ts` — ‏הקובץ הקיים שעובר refactor
- ‏`packages/backend/src/delivery/proxy-cache.ts` — ‏BE proxy cache (כבר ‏ממוקש Gemini generateContent + ‏ElevenLabs TTS stream)
- ‏`/home/user/projects/voice-acp/main/packages/frontend/src/lib/voice/` — ‏מקור להעתקה (FE הישן, ‏ראה §4 commit 2)
- ‏`~/.config/opencode/learnings.md` — ‏gotchas רוחביים

---

## §1 — מטרה

‏אחרי slice 2: ‏אישה מקלידה prompt ב-textarea, ‏רואה את תגובת הסוכן זורמת כ-bubbles, ‏ושומעת אותה בעברית מושמעת ב-streaming דרך MediaSource. ‏Thoughts באנגלית מתורגמים אוטומטית. ‏Cache ב-BE מבטיח שריצה חוזרת של אותה תשובה = ‏0 API calls.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ‏Speaker + TTS streaming | ✅ | ‏כאן |
| ‏Bubble model מורחב | ✅ | ‏commit 1 (atomic refactor) |
| ‏Sentence splitter עם `Intl.Segmenter` | ✅ | ‏commit 0 |
| ‏BE proxy cache (Gemini + ‏ElevenLabs) | ✅ ‏כבר קיים | `packages/backend/src/delivery/proxy-cache.ts` |
| ‏FE localStorage translate-cache | ❌ ‏מדלגים | ‏BE cache מספיק ל-slice 2. ‏אופציה לעתיד (offline) |
| ‏Audio on/off toggle בroute | ✅ ‏(minimal) | ‏commit 4 |
| ‏Mic + STT | ❌ | slice 3 |
| ‏VoiceMode FSM | ❌ | slice 3 |
| ‏Tool bubbles (rendering) | ❌ | slice 4 |
| ‏Markdown + RTL polish | ❌ | slice 4 |
| ‏Audio cues (chimes) | ❌ | slice 6 |
| ‏Settings page (voice picker) | ❌ | slice 9 — ‏voice ID hardcoded בslice 2 |
| ‏Recordings + ‏Replay UI | ❌ | slice 10 — ‏cache עובד גם בלי UI |
| ‏Smart scroll | ❌ | slice 5 |

---

## §3 — Architecture diagram

```
+layout.svelte
  ├─ new I18nVM()
  ├─ new Settings()
  ├─ new AgentSession()
  └─ new Speaker({ session })                  ← ‏חדש (VM, ‏בלי Settings — ראה §9 Q1)
        │
        │  $effect on session.bubbles:
        │   ├─ buffer per kind (message/thought)
        │   ├─ splitIntoSentences(buffer, {min:20, max:200})
        │   └─ enqueue TTS jobs (lookahead=2)
        │
        ├─ engines/player.ts                    ← ‏חדש
        │   │  ‏queue של segmentIds, ‏state: idle/playing
        │   │  ‏מנגן רצוף, ‏מדלג על cancelled
        │   └─ engines/audio-stream.ts          ← ‏חדש (copy מ-main)
        │      │  ‏MediaSource pool — ‏segment per HTMLAudioElement
        │      │  ‏prepareSegment(id, stream, ac)  → ‏Promise<void>
        │      │  ‏play(id)                       → ‏Promise<void>
        │      │  ‏cancel(id), ‏clear()
        │      │  ‏Element creation internal — ‏לא דרוש layout
        │
        ├─ adapters/voice/sdks.ts               ← ‏חדש (copy מ-main, 41 שורות)
        ├─ adapters/voice/tts.ts                ← ‏חדש (copy מ-main, 50 שורות)
        │   ‏synthesizeStreaming({text, voiceId, signal}) → ‏ReadableStream
        └─ adapters/voice/translate.ts          ← ‏חדש (copy מ-main, ‏ראה commit 2)
            ‏translate(text, targetLang) → ‏{status, text?}
```

**Glue flow** (Speaker → ‏adapters → ‏engines):
```
Speaker.fetchJob(job):
  1. ‏if kind=thought: text = await translate(job.text, "he")
  2. ‏stream = await synthesizeStreaming({text, voiceId: "EXAVITQu4vr4xnSDxMaL", signal})
  3. ‏await audioStream.prepareSegment(job.segmentId, stream, ac)
  4. ‏player.addSegment(job.segmentId)  // ‏מתחיל לנגן אוטומטית אם idle
```

‏שכבות שלא נגעות: ‏actions/, ‏routes/ (חוץ מ-`chat/+page.svelte` ‏ש-loop ה-bubbles שלו מתעדכן ב-commit 1, ‏ו-`+layout.svelte` ‏שמוסיף `new Speaker(...)` ‏ב-commit 3).

---

## §4 — Commits

### Commit 0 — sentence-boundary refactor (approach: **TDD**)

‏ליבה טהורה ב-core, ‏זה הcommit המושלם ל-TDD.

**קבצים שמשתנים**:
- ‏`packages/core/src/voice/sentence-boundary.ts` (rewrite מלא)
- ‏`packages/core/src/voice/sentence-boundary.test.ts` (**יצירה חדשה** — ‏אין test קיים ב-dev)

**API skeleton**:

```ts
export type SplitOptions = {
  /** ברירת מחדל: 20. ‏משפט קצר יותר מאוחד לבא */
  minChars?: number
  /** ברירת מחדל: 200. ‏משפט ארוך יותר נחתך על word boundary */
  maxChars?: number
  /** ברירת מחדל: 'he'. ‏locale ל-Intl.Segmenter */
  locale?: string
}

export function splitIntoSentences(
  buffer: string,
  opts?: SplitOptions
): {
  sentences: string[]
  remaining: string  // ‏האחרון אם אין סיומת ברורה — ‏שמור ל-chunk הבא
}
```

**אלגוריתם** (פסאודו):

```
1. ‏אם buffer ריק → ‏{sentences:[], remaining:""}
2. ‏פיצול ראשון על /\n{2,}/ → ‏paragraphs[]
3. ‏לכל paragraph:
   a. Intl.Segmenter('he', {granularity:'sentence'}) → ‏raw[]
   b. ‏אם paragraph אחרון ו-raw האחרון לא מסתיים ב-/[.!?]\s*$/ ‏או \n →
      ‏הוא remaining (לא ‏emit)
4. ‏לאחר איסוף raw מכל הparagraphs:
   a. ‏Merge קצרים < minChars לבא (אם יש בא)
   b. ‏Force-split ארוכים > maxChars: ‏Intl.Segmenter('he', {granularity:'word'})
      ‏על המשפט. ‏לוקח כמה שיותר מילים שעדיין ≤ maxChars. ‏החלק הנותר → ‏משפט הבא.
5. ‏החזר {sentences, remaining}
```

**Tests חדשים** (vertical slices — ‏לכל אחד test → impl → ‏שלב הבא, ‏לא bulk):

1. ‏determinism: ‏קריאה כפולה על אותו input → ‏אותו output
2. ‏`"Dr. Smith said hello. Then he left."` → ‏`["Dr. Smith said hello.", "Then he left."]` (לא חותך על `Dr.`)
3. ‏`"Visit https://3.14.example.com today. It works."` → 2 sentences, ‏לא חותך על `3.14`
4. ‏`"שלום\n\nעולם"` → `["שלום", "עולם"]` (paragraph break ללא נקודה)
5. ‏minChars: ‏`"OK. ‏Now this is a longer sentence."` ‏עם min=20 → ‏המשפט הראשון מאוחד לשני
6. ‏maxChars: ‏string של 250 chars עם רווחים → ‏נחתך על word, ‏לא באמצע מילה
7. ‏streaming determinism: ‏`"hello world. bye"` ‏מגיע כ-1-char chunks — ‏ה-caller מבצע `buffer = remaining + nextChunk` ‏בכל איטרציה. ‏אחרי כל הchunks אותם sentences כמו אם הגיע במכה אחת
8. ‏`,` ‏ו-`:` ‏לא חותכים (regression: ‏היו חותכים ב-regex הישן)

**‏Caller contract** (חשוב לSpeaker): ‏ה-`remaining` ‏לא יוצא מהsplitter. ‏הcaller שומר ‏אותו ‏ומוסיף לפני chunk הבא: ‏`splitIntoSentences(remaining + newChunk, opts)`. ‏ב-flush סופי, ‏הcaller שולח את ה-`remaining` ‏ידנית ל-TTS גם בלי terminator.

**Verification**:

```bash
pnpm --filter @drive-coding/core test sentence-boundary
pnpm --filter @drive-coding/core typecheck
```

‏שניהם ירוקים לפני git add.

---

### Commit 1 — Bubble model refactor (approach: **manual**, atomic)

‏State model refactor — ‏לא TDD (‏ה-shape של ה-types גלוי, ‏אבל ה-behavior הוא integration עם Svelte 5).

**קבצים שמשתנים**:
- ‏`packages/frontend/src/lib/view-models/agent-session.svelte.ts`
- ‏`packages/frontend/src/lib/types/bubble.ts` ‏**(חדש, ‏לא inline)** — ‏הtype משותף ל-VM, ‏component, ‏Speaker
- ‏`packages/frontend/src/routes/chat/+page.svelte`
- ‏`packages/frontend/src/lib/view-models/agent-session.svelte.test.ts` (אם קיים — ‏עדכן)

**API skeleton** (לפי `bubble-model.md`):

```ts
type Segment = { id: string; text: string }
type ThoughtSegment = Segment & { originalText?: string }

type BubbleBase = { id: string; messageId: string | null; createdAt: number }

type UserBubble = BubbleBase & {
  kind: "user"; messageId: null; segments: Segment[]; recordingId?: string
}
type MessageBubble = BubbleBase & { kind: "message"; segments: Segment[] }
type ThoughtBubble = BubbleBase & { kind: "thought"; segments: ThoughtSegment[] }
type ToolBubble = BubbleBase & {
  kind: "tool"; messageId: null; toolCall: ToolCall; segments: never[]
}

export type Bubble = UserBubble | MessageBubble | ThoughtBubble | ToolBubble
```

**שינוי ב-AgentSession**:
- ‏החליפו את `bubbles: Bubble[]` ‏לטיפוס החדש
- ‏ה-handler של `agent_message_chunk` / ‏`agent_thought_chunk`:
  - ‏Grouping rule: ‏אם ‏ה-bubble האחרון מאותו ‏kind ‏ועם ‏ה-`messageId` ‏הזהה ‏לchunk ‏הנכנס → ‏push ל-`segments[]` ‏(segment חדש לכל chunk)
  - ‏אם ‏ה-chunk ‏מגיע ‏בלי `messageId` ‏(או `null`) → ‏גם ‏יוצרים ‏bubble חדש. ‏שני ‏chunks ‏בלי `messageId` ‏לא ‏מתמזגים.
  - ‏אם ‏ה-kind ‏שונה (message ↔ ‏thought) → ‏bubble חדש, ‏גם ‏עם ‏אותו `messageId`
- ‏Segment.id = `crypto.randomUUID()` ‏(סוגר open Q #1 מ-bubble-model)
- ‏**שינוי API חובה** (slice 1 דולג, ‏אז הסיגנטורה צריכה להתעדכן כאן): ‏`sendPrompt(text: string, opts?: { recordingId?: string }): Promise<void>`. ‏`opts.recordingId` ‏לא מוצב ‏ב-slice 2 — ‏יישוב ב-slice 10. ‏הכנה חיונית כי אין slice ביניים שיוסיף אותה.

**שינוי ב-`chat/+page.svelte`**:

```svelte
{#each session.bubbles as bubble (bubble.id)}
  <div class="bubble bubble-{bubble.kind}">
    {#each bubble.segments as seg (seg.id)}
      <span>{seg.text}</span>
    {/each}
    <!-- ‏קריאה ל-.length מבטיחה reactivity על push לbubble.segments -->
    <span class="hidden">{bubble.segments.length}</span>
  </div>
{/each}
```

**Gotcha**: ‏ראה §6 #2 — ‏Svelte 5 reactivity על push.

**Verification**:

```bash
pnpm --filter @drive-coding/frontend typecheck
pnpm --filter @drive-coding/frontend test
pnpm --filter @drive-coding/frontend build
pnpm lint:i18n
```

‏+ ‏ידני: ‏פתח browser, ‏connect ל-agent, ‏שלח prompt, ‏בדוק שbubbles מופיעים זהה לslice 0.5.

---

### Commit 2 — adapters + engines (approach: **manual**)

‏אינטגרציה עם SDK חיצוני — ‏לא TDD. ‏copy מדויק מהקוד הישן + ‏adapt לpaths חדשים.

**מקור**: ‏`/home/user/projects/voice-acp/main/packages/frontend/src/lib/voice/`

‏לפני ההעתקה — ‏שינויים גלובליים שחלים על **כל הקבצים** מ-main:
- ‏**`$lib/log` ‏לא קיים ב-dev**. ‏החלף `import { createLogger } from "$lib/log"` ‏+ ‏`createLogger(...)` ‏ב-`console.warn/error/info` ‏ישיר. ‏לא להעתיק `$lib/log` ‏מ-main — ‏אם נצטרך logger מבוסס, ‏יישוב בslice נפרד.
- ‏**voice ID hardcoded ב-Speaker, ‏לא בadapter**. ‏ה-adapters לא יודעים על Settings.

**קבצים חדשים**:

| ‏יעד | ‏מקור (main) | ‏שינויים בהעתקה |
|---|---|---|
| ‏`adapters/voice/sdks.ts` | `voice/sdks.ts` (41 שורות) | ‏copy as-is. ‏לוודא `apiKey: "browser-placeholder"` (גוטשה 2026-05-16). ‏`baseURL` (cap) ‏ל-`@ai-sdk/google`, ‏`httpOptions.baseUrl` (lower) ‏ל-`@google/genai` — ‏אל ‏תכתוב מחדש |
| ‏`adapters/voice/tts.ts` | `voice/tts-client.ts` (50 שורות) | ‏copy as-is. ‏`voiceId` ‏נשאר parameter (לא hardcoded ב-adapter). ‏Speaker יעביר אותו |
| ‏`adapters/voice/translate.ts` | `voice/translate-client.ts` (138 שורות) | ‏copy + ‏שני שינויים: ‏(1) ‏הסר import + שימוש ב-`translate-cache` ‏(לא קיים ב-dev — ‏BE cache מספיק); ‏(2) ‏החלף `$lib/log` ‏ב-console |
| ‏`engines/audio-stream.ts` | `voice/audio-stream.ts` (220 שורות) | ‏copy as-is. ‏מנהל לבד את ה-`<audio>` elements (אין צורך בlayout). ‏5s timeout על sourceopen (MED-6) |
| ‏`engines/player.ts` | ‏חדש — ‏לא קיים ב-main | ‏ראה skeleton למטה |

**‏לא ‏מעתיקים מ-main** (במכוון):
- ‏`translate-cache.ts` — ‏BE proxy cache ‏ממוקש Gemini generateContent (verified ב-`packages/backend/src/delivery/proxy-cache.ts` line 35). ‏אין צורך בlocalStorage ב-slice 2.
- ‏`orchestrator.ts` (417 שורות) — ‏מחליפים ב-Speaker view-model (commit 3) ‏שעוקב לחוקי 5 שכבות.
- ‏`narrate-client.ts`, ‏`stt-client.ts`, ‏`recordings-client.ts`, ‏`base64.ts` — ‏לא נדרשים לslice 2.

**`engines/audio-stream.ts` API surface** (מועתק as-is מ-main; ‏זה החוזה ש-Player ו-Speaker צורכים):

```ts
type AudioSegmentState = "loading" | "ready" | "playing" | "ended" | "cancelled"

export class AudioStream {
  /** ‏יוצר <audio> + MediaSource ‏פנימית, ‏מתחיל לצרוך stream ברקע.
   *  ‏מחזיר Promise שמתממש אחרי שsourceopen אירע (≤5s timeout). */
  prepareSegment(segmentId: string, stream: ReadableStream<Uint8Array>, ac: AbortController): Promise<void>

  /** ‏מנגן segment. ‏ממתין ל-ready אם עדיין loading. ‏Reject אם cancelled (caller ידלג). */
  play(segmentId: string): Promise<void>

  /** ‏Abort fetch + ‏pause audio + ‏cleanup */
  cancel(segmentId: string): void

  /** ‏Cancel ‏לכולם */
  clear(): void
}
```

‏הערה חשובה: ‏ה-`<audio>` ‏elements נוצרים internally ‏(אחד לכל segment). ‏אין צורך לbind מ-layout. ‏הם לא מצורפים ל-DOM (audio playback עובד גם בלי append).

**`engines/player.ts` skeleton** (חדש — ‏לא קיים ב-main):

```ts
type PlayerState = "idle" | "playing"

export class Player {
  state: PlayerState = $state("idle")
  currentSegmentId: string | null = $state(null)

  #audioStream: AudioStream
  #queue: string[] = []  // segment IDs ‏בסדר FIFO
  #playing = false       // ‏guard מפני re-entrancy

  constructor(audioStream: AudioStream) { this.#audioStream = audioStream }

  /** ‏מוסיף segment לqueue. ‏אם Player ב-idle — ‏מתחיל לנגן מיד (async). */
  addSegment(segmentId: string): void

  /** ‏לקפיצה ידנית (לעתיד — slice 10 replay). ‏לא בשימוש ב-slice 2. */
  jumpToSegment(segmentId: string): void

  /** ‏עוצר playback של ה-current, ‏מנקה queue, ‏cancel ‏על כל segment ב-AudioStream */
  stop(): void
}

// ‏לוגיקה פנימית (פסאודו):
// addSegment(id):
//   #queue.push(id)
//   if (#playing) return  // ‏כבר רץ — ‏ה-loop יקלוט אוטומטית
//   #playLoop()
//
// async #playLoop():
//   #playing = true
//   state = "playing"
//   while (#queue.length > 0):
//     id = #queue.shift()
//     currentSegmentId = id
//     try: await #audioStream.play(id)  // ‏המתנה עד ended או cancelled
//     catch: continue  // MIN-5 — skip cancelled, ‏לא throw
//   #playing = false
//   state = "idle"
//   currentSegmentId = null
```

**Verification**:

```bash
pnpm --filter @drive-coding/frontend typecheck
pnpm --filter @drive-coding/frontend build
```

‏אין consumer של הקוד החדש עדיין — ‏רק typecheck. ‏typecheck חייב להיות ירוק אחרי הסרת `$lib/log` ‏ו-`translate-cache` imports.

‏ידני (אופציונלי): ‏בdevtools console, ‏`await import('/src/lib/adapters/voice/tts.ts').then(m => m.synthesizeStreaming({text:"שלום", voiceId:"EXAVITQu4vr4xnSDxMaL"}))`. ‏לוודא ש-fetch יוצא ל-`/proxy/elevenlabs/v1/text-to-speech/.../stream` ‏וחוזר עם 200.

---

### Commit 3 — Speaker view-model (approach: **manual**)

‏הglue העיקרי. ‏מורכב — ‏זה החלק שיתפוצץ אם משהו במקבילים שגוי.

**קבצים חדשים**:
- ‏`packages/frontend/src/lib/view-models/speaker.svelte.ts`

**קבצים שמשתנים**:
- ‏`packages/frontend/src/lib/context.ts` — ‏הוספת `getSpeaker`/`setSpeaker` (זוג מ-`createContext`)
- ‏`packages/frontend/src/routes/+layout.svelte` — ‏`new Speaker({ session })` + ‏`setSpeaker(speaker)`

**API skeleton**:

```ts
type TtsJob = {
  segmentId: string
  kind: "message" | "thought"
  messageId: string | null  // ‏ייתכן null (ראה Commit 1 grouping rule)
  text: string
  status: "pending" | "fetching" | "ready" | "error"
}

// ‏Constants ‏ל-slice 2 — ‏slice 9 ‏יחליף ב-Settings
const VOICE_ID = "EXAVITQu4vr4xnSDxMaL"  // ‏Sarah, ‏ElevenLabs (learnings 2026-05-13)
const TARGET_LANG = "he"
const MIN_CHARS = 20
const MAX_CHARS = 200
const LOOKAHEAD = 2

export class Speaker {
  enabled: boolean = $state(true)
  state: "idle" | "speaking" = $derived(this.#player.state === "playing" ? "speaking" : "idle")

  #session: AgentSession
  #player: Player
  #audioStream: AudioStream

  // ‏buffers נפרדים per-kind — ‏flush כשkind משתנה
  #buffer: { message: string; thought: string } = { message: "", thought: "" }
  #jobs: TtsJob[] = []
  #activeFetches = 0  // ‏עד LOOKAHEAD jobs ב-fetch בו-זמנית

  constructor(opts: { session: AgentSession }) {
    // ‏יוצר AudioStream + ‏Player פנימית
    // $effect ‏שמאזין ל-opts.session.bubbles + opts.session.lastStopReason
    // ‏הbody של ה-effect חייב להשתמש ב-untrack() ‏לכתיבות ‏ל-#jobs/#buffer
    // ‏שאם לא — ‏זה infinite loop (learnings 2026-05-16)
  }

  /** ‏Toggle audio on/off (Commit 4 בroute). ‏אם הופך ל-false: ‏#player.stop() + ‏#jobs נמחקים */
  toggle(): void

  destroy(): void  // ‏ניקוי effect + stop
}
```

**‏הערה ל-Settings dep שהוסר**: ‏בbrief המקורי Speaker קיבל גם `settings`. ‏הסרנו כי:
- ‏ב-slice 2 ‏אין שדה ‏רלוונטי ב-Settings (אין `voiceId` ‏עדיין)
- ‏Voice ID hardcoded ב-`VOICE_ID` const
- ‏Slice 9 ‏(Voice picker) ‏יוסיף Settings dep + שדה `voiceId` ‏ל-Settings + ‏יסיר את ה-const

**Pipeline (פסאודו, ‏בתוך $effect שמאזין ל-bubbles)**:

```
‏on chunk arrival (segment חדש ב-bubble אחרון):
  kind = bubble.kind  // ‏message או thought
  ‏if (last processed kind !== kind) flush(other_kind_buffer)
  buffer[kind] += chunk.text
  ‏{sentences, remaining} = splitIntoSentences(buffer[kind], {minChars:20, maxChars:200})
  buffer[kind] = remaining
  ‏לכל sentence: ‏#jobs.push({segmentId, kind, messageId, text:sentence, status:"pending"})
  #pumpFetchLoop()

‏on session.status leaves "thinking" → "connected" or "error" (סוף turn):
  flush(message_buffer)
  flush(thought_buffer)
  // flush = ‏שולח את remaining כסגמנט אחרון גם בלי terminator

‏#pumpFetchLoop():
  while #activeFetches < LOOKAHEAD ‏ויש pending job:
    job = ‏הראשון pending
    job.status = "fetching"
    #activeFetches++
    fetchJob(job).finally(() => { #activeFetches--; #pumpFetchLoop() })

‏async fetchJob(job):
  try:
    text = job.text
    ‏if job.kind === "thought":
      result = await translate(text, "he")  // ‏מ-adapters/voice/translate.ts
      ‏if result.status === "translated": text = result.text
      ‏// ‏אם already_in_target — ‏משאירים text מקורי
    ac = new AbortController()
    stream = await synthesizeStreaming({text, voiceId: VOICE_ID, signal: ac.signal})
    await audioStream.prepareSegment(job.segmentId, stream, ac)
    player.addSegment(job.segmentId)
    job.status = "ready"
  catch (e):
    job.status = "error"  // MIN-5: ‏skip + ‏continue, ‏לא throw
    console.warn("TTS job failed, skipping segment", {id: job.segmentId, err: e})
```

**‏ב-turn end**: ‏Speaker עם ‏`$effect(() => { if (prevStatus === "thinking" && session.status !== "thinking") flushAll() })`. ‏השמירה ב-`prevStatus` ‏צריכה ‏להיות ‏ב-untrack כדי ‏לא ‏לטריגר re-run (gotcha #5).

**Gotchas (חובה לקרוא §6)**:
- #5 (untrack ב-$effect שכותב ל-state)
- #6 (Hebrew transliteration ב-Gemini prompt — ‏ה-prompt ב-translate-client כבר מטפל; ‏לוודא)
- #2 (Svelte 5 reactivity על array.push — ‏הloop בroute חייב לקרוא `.length`)

**Verification**:

```bash
pnpm --filter @drive-coding/frontend typecheck
pnpm --filter @drive-coding/frontend build
pnpm lint:i18n
```

‏ידני (חובה לפני git add):
1. ‏Browser, ‏connect, ‏שלח prompt קצר ("‏שלום")
2. ‏הסוכן עונה במשפט אחד או שניים → ‏שומעים בעברית
3. ‏BE log: ‏לוודא קריאות ל-`/proxy/elevenlabs/v1/text-to-speech/...`
4. ‏שלח שוב את אותו prompt → ‏צריך להגיב מהcache (BE log: `cache hit`)

---

### Commit 4 — UI feedback minimum (approach: **manual**)

**קבצים שמשתנים**:
- ‏`packages/frontend/src/routes/chat/+page.svelte` — ‏הוספת checkbox "‏אודיו on/off"
- ‏`packages/core/src/i18n/catalogs/he.ts` + ‏`en.ts` + ‏`keys.ts` — ‏מפתח חדש `chat.audioToggle`

**API**:
- ‏ב-route: ‏`<input type="checkbox" bind:checked={enabled} onchange={() => speaker.toggle()} />`
  ‏או יותר נכון: ‏`bind:checked={speaker.enabled}` ‏ישירות, ‏בלי toggle()

**Verification**:

```bash
pnpm --filter @drive-coding/frontend typecheck
pnpm --filter @drive-coding/frontend build
pnpm lint:i18n
```

‏ידני: ‏toggle off → ‏שלח prompt → ‏לא נשמע כלום, ‏אבל הbubbles עדיין מופיעים.

---

### Commit 5 — walkthrough + cleanup (approach: **manual**)

**קבצים שמשתנים**:
- ‏`docs/walkthrough.md` — ‏רשומה חדשה בראש
- ‏`packages/frontend/AGENTS.md` — ‏"slice 2 הושלם" + ‏slice 3 כnext
- ‏`packages/frontend/docs/slices.md` — ‏status 💭 → ✅
- ‏`packages/frontend/docs/bubble-model.md` — ‏סגירת השאלות הפתוחות (סעיף "פתוחות")
- ‏`docs/plans/slice-2-speaker-tts.md` — ‏סטטוס → "‏הושלם", ‏הוספת סעיף "‏סטיות מהתכנון" אם רלוונטי

**Verification**: ‏הסקיל `commit` ירוץ pre-flight אוטומטי.

---

## §5 — DoD

| # | ‏בדיקה | ‏איך |
|---|---|---|
| 1 | ‏splitter ‏tests ירוקים | ‏`pnpm --filter core test sentence-boundary` |
| 2 | ‏Bubble model refactor: ‏chat עובד כמו slice 0.5 | ‏ידני בbrowser |
| 3 | ‏אישה שולחת text prompt | ‏ידני |
| 4 | ‏רואה את התגובה כbubbles (message + thought אם יש) | ‏ידני |
| 5 | ‏שומעת את התגובה בעברית | ‏ידני |
| 6 | ‏thoughts באנגלית מתורגמים אוטומטית | ‏prompt שמעורר thought באנגלית |
| 7 | ‏TTFA ≤ 1.5s ‏על message ראשון | ‏Stopwatch ‏ידני / ‏Performance tab |
| 8 | ‏segments מתנגנים בסדר, ‏בלי double-play | ‏ידני |
| 9 | ‏שלוח אותו prompt פעמיים → ‏בריצה שנייה ה-BE לא יוצא ל-`api.elevenlabs.io` / ‏`generativelanguage.googleapis.com` ‏לאותם texts | ‏BE log: ‏cache hit ‏ב-`proxy-cache.ts`. ‏ה-LLM call (מ-OpenCode/Claude) **כן** ‏ייצא — ‏רק TTS/translate ב-cache. ‏ראה `packages/backend/src/delivery/proxy-cache.ts:32-39` |
| 10 | ‏Audio toggle off → ‏אין סנתוז, ‏אין רעש | ‏ידני |
| 11 | ‏typecheck + build + tests | ‏ראה §4 |
| 12 | ‏i18n lint | `pnpm lint:i18n` |
| 13 | ‏pre-commit hook עבר | ‏git commit מצליח |
| 14 | ‏Refresh בbrowser ‏אחרי שיחה → ‏chat ריק (אין persistence ב-slice 2), ‏אין שגיאות, ‏Speaker לא ‏מנסה לנגן רעולות | ‏refresh + ‏בדיקת console |

---

## §6 — Risks + mitigations

| # | ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|---|
| 1 | ‏Hebrew strings בקוד → ‏pre-commit חוסם | ‏i18n-gap 2026-05-17, ‏slice 0.5 | ‏כל מחרוזת חדשה → ‏`t(key)`. ‏הודעות error ב-core באנגלית, ‏FE עוטף |
| 2 | ‏Svelte 5 reactivity לא מתעדכן על `array.push` | ‏general Svelte 5 gotcha, ‏ב-`learnings.md` | ‏ב-`{#each bubble.segments as seg (seg.id)}` ‏יש לקרוא `bubble.segments.length` ‏ב-block. ‏אלטרנטיבה: ‏reassign `bubble.segments = [...bubble.segments, seg]` |
| 3 | ‏OneCLI לא מזריק credentials | ‏learnings 2026-05-16 | ‏SDK חייב לקבל `apiKey: "browser-placeholder"`. ‏OneCLI agent `voice-acp` מזריק `xi-api-key` + ‏`x-goog-api-key` ב-proxy |
| 4 | ‏MediaSource `sourceopen` תקוע | ‏slice 10 MED-6 | ‏5s timeout ב-`audio-stream.ts` (כבר קיים ב-main, ‏לא להוריד) |
| 5 | ‏$effect שכותב ל-state שהוא קורא → ‏infinite loop | ‏learnings 2026-05-16 | ‏`untrack(() => ...)` ‏לכל write שלא אמור לטריגר re-run |
| 6 | ‏Gemini מתרגם לתעתיק לטיני במקום עברית | ‏learnings 2026-05-16 | ‏prompt בtranslate.ts: "Output in original Hebrew script — do NOT transliterate" |
| 7 | ‏TTS error בseg בודד → ‏פיל pipeline | ‏slice 10 MIN-5 | ‏`fetchJob`: ‏catch + ‏skip + ‏continue, ‏לא throw |
| 8 | ‏`baseURL` vs `baseUrl` בSDKs | ‏slice 10 CRIT-1 | ‏copy מדויק מ-main. ‏אל תכתוב מחדש |
| 9 | ‏ElevenLabs voice name במקום voice_id | ‏learnings 2026-05-16 | ‏voice_id `EXAVITQu4vr4xnSDxMaL` (Sarah) hardcoded ב-Speaker `VOICE_ID` const. ‏אל תשתמש ב-`'Sarah'` |
| 10 | ‏NO_PROXY חסר בtmux → ACP fails | ‏learnings 2026-05-14 | ‏`export NO_PROXY=localhost,127.0.0.1,::1` ‏לפני tmux server init |
| 11 | ‏`$lib/log` ‏לא קיים ב-dev | ‏ה-FE החדש לא כולל את התשתית של main | ‏בעת copy מ-main: ‏החלף ב-`console.warn/error`. ‏ראה commit 2 |
| 12 | ‏translate-client.ts ב-main מייבא `translate-cache` | ‏FE localStorage cache קיים רק ב-main | ‏בעת copy: ‏הסר import + ‏הסר ‏את ‏הקריאות ‏ל-getCached/setCached. ‏BE cache מספיק |
| 13 | ‏Long brief → ‏executor מבולבל | ‏planner-executor research | ‏הbrief הזה ~‎600 ‏שורות. ‏אם executor נתקע — ‏לעצור ולשאול, ‏לא להמשיך |

---

## §7 — Escalation triggers

‏עצור והעלה ל-Tama בparent task אם:

- ‏MediaSource לא תומך ב-`audio/mpeg` codec בbrowser שבחרת (לא צפוי — ‏אבל אם)
- ‏BE proxy לא מועבר ל-`api.elevenlabs.io` ‏או ‏`generativelanguage.googleapis.com` (404 / ‏connection refused)
- ‏OneCLI agent `voice-acp` ‏לא קיים, ‏או לא מזריק את ה-headers הצפויים (401 על קריאה ראשונה)
- ‏Svelte 5 reactivity לא מתעדכן גם אחרי mitigation §6 #2
- ‏אחרי 2 ניסיונות לתקן באג Speaker (TTS לא מתחיל, ‏double play, ‏סדר שגוי) ‏הוא לא נפתר — ‏זה סימן לבעיית architecture
- ‏ה-DoD #9 ‏(cache hit ב-replay) ‏לא קורה — ‏ייתכן שcache key בBE שונה בין הריצות
- ‏מצאת שצריך לשנות API ב-`AgentSession` ‏שלא בbrief — ‏לא להחליט לבד

‏אחרת: ‏החלט סבירות, ‏רשום בcommit message, ‏המשך.

---

## §8 — Complexity score: 9/10

‏פרמטרים לפי `docs/plans/README.md` §2:

| ‏פקטור | ‏ניקוד |
|---|---|
| ‏מספר commits (5) | ‏סביר |
| ‏שכבות חדשות (engines, ‏adapters, ‏VM = ‏3) | +3 |
| ‏APIs חיצוניים (ElevenLabs + ‏Google) | +2 |
| ‏Streaming pipeline | +2 |
| ‏Refactor של state model (bubble) | +2 |
| ‏שינוי protocol BE↔FE | 0 |
| ‏סה"כ | **9** |

‏**Verifier choice**:
- ‏`verifier-phase` אחרי commit 1 (state model refactor — ‏שובר UI rendering)
- ‏`verifier-phase` אחרי commit 3 (Speaker integration — ‏הglue הכבד)
- ‏`verifier-slice-heavy` בסוף הסבב (7 שלבים, ‏edge cases + ‏regressions)

---

## §9 — שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏Voice ID — ‏איך מחזיקים | ‏`VOICE_ID` const ב-Speaker. ‏Speaker לא תלוי ב-Settings. ‏Slice 9 ‏יחליף ב-Settings dep | ❌ ‏סגור |
| 2 | ‏MediaSource MIME | `audio/mpeg` (ElevenLabs מחזיר mp3, ‏AudioStream כבר עם זה) | ❌ ‏סגור |
| 3 | ‏OneCLI agent מזריק על ‏**כל** `/v1/text-to-speech/*` | ‏learnings מאשרים. ‏בdiff בdevtools console (commit 2 manual step) ‏לוודא ש-response 200, ‏לא 401 | 🟡 ‏manual check בcommit 2 |
| 4 | ‏ל-`Player` ‏לעשות retry על network error? | ‏לא בslice 2. ‏MIN-5: ‏skip + ‏continue. ‏slice 10 ‏יחליט אם retry | ❌ |
| 5 | ‏אם אישה שולחת prompt שני בזמן ש-Speaker מנגן תגובה לראשון — ‏מה? | ‏cancel ‏את הראשון, ‏מתחיל לנגן את השני (player.stop() + ‏queue חדש). ‏האירוע: ‏על `sendPrompt` ‏ב-AgentSession, ‏Speaker מאזין ל-`session.status` או מקבל callback | ❌ ‏סבירות נמוכה ב-slice 2 (אין Mic), ‏אבל לתעד החלטה |
| 6 | ‏טריגר ל-flush — ‏איך Speaker יודע שה-turn הסתיים? | ‏Speaker עוקב ‏אחרי ‏`session.status` ‏ב-`$effect`. ‏מעבר מ-`"thinking"` ‏ל-`"connected"` ‏או ‏`"error"` ‏= ‏סוף turn → ‏flush. ‏אין צורך לשנות API ב-AgentSession (verified ב-`agent-session.svelte.ts:107-112`). | ❌ ‏סגור |
| 7 | ‏`targetLang` ‏לתרגום | ‏`"he"` hardcoded ב-`TARGET_LANG` const ב-Speaker | ❌ ‏סגור |

---

## §10 — מה אחרי slice 2

‏slice 3 (Mic + ‏STT + ‏VoiceMode FSM) — ‏סוגר את הלולאה. ‏אחרי 3 יש MVP שמיש: ‏אישה מדברת, ‏שומעת תגובה, ‏רואה bubbles. ‏זה הרגע לסיים את הסבב.
