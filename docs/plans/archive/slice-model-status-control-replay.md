# Brief: slice — מצב-מודל + בקרת-סוכן + השמעה (מאוחד A+AB)

> 🛑 **SUPERSEDED — לא ימוזג. branch = reference בלבד, מועמד למחיקה.** (עודכן 2026-06-16)
> ה-slice הזה הושלם ואומת (כלב-heavy r2 GO), אבל **הוחלט במכוון לא למזג אותו מכנית** ל-dev
> בגלל קונפליקט לא-מכני (`git merge dev` → 8 קבצים בקונפליקט, אי-עקביות `turnState`↔`thinking`
> ב-`AgentSession.status` enum + חתימות `speaker.svelte.ts`). במקומו נכתב brief חדש
> **`slice-model-status-replay-v2`** שמימש מחדש את אותה עבודה ו**הושלם, אומת (כלב-heavy) ומוזג ל-dev (2026-06-14)**.
> כל הפיצ'רים כבר ב-dev בגרסת v2: `StatusBubble`, `model-status`, `bubble-player`, `play-bubble`,
> כפתורי ▶, `cancelTurn`, ותיקוני turnstate (`#turnEnded`/`scheduleIdle`/`TAIL_MS`/`resetTurnTracking`).
> ה-branch הזה נשמר כ-reference לקוד + דוח כלב r2 בלבד.
>
> סטטוס מקורי: **הושלם + מאומת** (אליעזר 2026-06-03; turnstate-fix; **כלב-heavy r2 GO 2026-06-13** — 3 ה-blockers סגורים, 0 regression). complexity: **8/10** → verifier-slice-**heavy**.
> 2 env-blocks תיעוד: תור-opencode-חי (WS-over-tunnel) + TTS-▶ (ElevenLabs quota=0).
> verifier-phase אחרי Commit 1 (state refactor), Commit 3 (cancelTurn/FSM), Commit 4 (I/O recordings).
> base: `poc-wake-word` (מוזג עם dev `6e8b504` — מכיל את כל קוד dev + ה-brief הזה).
> ה-line numbers אומתו מול dev `6e8b504` = ה-merge-base, תקפים ב-poc-wake-word.
> depends_on: [] (sessions-inline כבר ב-dev; wake-word infra כבר ב-dev).
> ⚠️ מאחד את `slice-A-status-bubble.md` (refactor state + בועה) עם slice-AB
> (cancelTurn + הקלטות + נגן-בודד). `slice-A-status-bubble.md` ו-`slice-AB-*` הם
> **superseded** ע"י ה-brief הזה.

---

## 0. הקשר וסביבה

**מטרה (שלוש שכבות):**
1. **הפרדת state** — `AgentSession.status` מערבב חיבור (`connecting/connected`) עם
   פעילות-מודל (`thinking`). מפרידים: `status` = חיבור בלבד; `turnState` חדש = מה
   המודל עושה בתור.
2. **בועת-סטטוס** + **עצירת-סוכן** — בועה בסגנון WhatsApp ("typing…") שמראה מה המודל
   עושה, וכפתור שעוצר את הסוכן באמת (ACP cancel) ומתקן את באג ה-"X שמהבהב לנצח".
3. **השמעה** — חיבור הקלטות-המשתמש ל-BE (היום נזרקות) + כפתור ▶ להשמעת בועה בודדת
   (הקלטה של המשתמש / TTS מחדש לבועת-סוכן עם cache hit).

**שם package FE:** `@drive-coding/frontend-v2` (כל `pnpm --filter`).

**worktree:** (נגזר מ-`poc-wake-word` — שם ה-brief; מכיל את כל קוד dev אחרי המיזוג)
```bash
git worktree add .worktrees/slice-model-status-control-replay -b slice-model-status-control-replay poc-wake-word
cd .worktrees/slice-model-status-control-replay && pnpm install && pnpm hooks:install
# ה-brief: docs/plans/slice-model-status-control-replay.md (נמצא ב-worktree אחרי הגזירה)
```

**איך מריצים:**
```bash
cd packages/backend
PORT=4013 onecli run --agent voice-acp -- bun --watch src/server.ts   # OneCLI חובה (Commit 4-5: proxy + recordings)
BE_PORT=4013 pnpm --filter @drive-coding/frontend-v2 dev
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 test
pnpm lint:i18n
```

**Browser**: linux-gui Chrome :9222 profile voice-acp. `playwright-cli -s=vacp attach --cdp=http://localhost:9222`.
מצבי-mock לבדיקת UI ללא BE: `/chat?mock=greeting` (reload מלא).

**מקורות-אמת:** `packages/frontend/AGENTS.md` (5 שכבות + חוקי זהב), מסמך התכנון
`docs/plans/input-modes-and-status-bubble-design.md` (ב-branch זה).

---

## 1. מודל ה-state החדש (מוסכמה)

המוסכמה הקיימת: `status` = lifecycle (רק ל-AgentSession), `state` = FSM פנימי
(Mic/Speaker/VoiceMode), `mode` = בחירת-מצב (WakeWord). השם החדש `turnState` עוקב.

```
AgentSession.status    = "idle" | "connecting" | "connected" | "error"   ← חיבור (הוסר thinking)
AgentSession.turnState = "idle" | "waiting" | "thinking" | "responding" | "calling-tool"   ← חדש
Speaker.state          = "idle" | "speaking"   (קיים, getter)
Speaker.hasPendingNarration = boolean   ← getter חדש
```

מיפוי `turnState` ל-ACP updates:
| טריגר | turnState |
|---|---|
| `sendPrompt` נשלח, טרם chunk | `waiting` |
| `agent_thought_chunk` | `thinking` |
| `agent_message_chunk` | `responding` |
| `tool_call` / `tool_call_update` (pending/in_progress) | `calling-tool` |
| תור הסתיים (sendPrompt resolved) **או** `cancelTurn` | `idle` |

> ⚠️ ה-line numbers בכל ה-brief אומתו מול dev tip `6e8b504`. אם ה-base שונה — אמת מחדש.

---

## 2. Commit 1 — refactor: הפרדת status/turnState
**Approach**: manual + typecheck safety-net. **verifier-phase אחרי commit זה.**

**עיקרון:** `status` כבר לא מכיל `thinking`. כל consumer של `status === "thinking"`
עובר ל-`turnState`. אסור חצי-refactor (חוק זהב #5) — מתקנים את **כל** ה-consumers
באותו commit. בלי שינוי UI נראה — התנהגות זהה, רק state מסודר.

### 2.1 AgentSession (`view-models/agent-session.svelte.ts`)
- `AgentSessionStatus` type (:39-44, thinking ב-:43) — **הסר** `"thinking"`. נשאר idle/connecting/connected/error.
- הוסף `export type TurnState = "idle" | "waiting" | "thinking" | "responding" | "calling-tool"`.
- הוסף שדה `turnState = $state<TurnState>("idle")` ליד `status` (שדה status ב-:65).
- **`#setTurnState(next)`** — setter מרכזי חדש (נקודת-mutation יחידה ל-turnState, כמו
  `#setStatus` ל-status, :450). שים בו את ה-cue (§4.2).
- `sendPrompt` (:176-201):
  - :177 guard `status !== "connected" && status !== "thinking"` → `status !== "connected"`
    (thinking כבר לא ב-status; connected מכסה — §4.1).
  - :194 `#setStatus("thinking")` → `#setTurnState("waiting")` (ה-status נשאר connected).
  - :198 `if (status === "thinking") #setStatus("connected")` → `#setTurnState("idle")` (סיום תור).
- :363 guard (applyConfigOption, זהה ל-:177) → `status !== "connected"` (§4.1).
- `#onSessionUpdate` — הוסף עדכון turnState דרך `#setTurnState`:
  - :616 `agent_message_chunk` → `#setTurnState("responding")`
  - :618 `agent_thought_chunk` → `#setTurnState("thinking")`
  - `#handleToolCall` (:630) + `#handleToolCallUpdate` (:668, pending/in_progress) → `#setTurnState("calling-tool")`
- cue (:450-454): היום `#setStatus` מנגן "thinking" כש-`next==="thinking"`. אחרי הפיצול
  turnState לא עובר דרך #setStatus → העבר את ה-cue ל-`#setTurnState`: נגן "thinking" על
  מעבר **idle→waiting** (פעם אחת, §4.2). הסר את ה-cue מ-#setStatus.

### 2.2 VoiceMode (`view-models/derived/voice-mode.svelte.ts`)
- :45 `if (#session.status === "thinking") return "thinking"` → `if (#session.turnState !== "idle") return "thinking"`
  (כל פעילות-מודל = "thinking" ל-VoiceMode, ששומר 6 מצבים ל-MicLarge).
- :59 (ב-$effect reset isCancelling) `#session.status !== "thinking"` → `#session.turnState === "idle"`.
- VoiceModeState type (:24-30) — **לא משתנה** (נשאר thinking ל-MicLarge).

### 2.3 Speaker (`view-models/speaker.svelte.ts`)
- :101 `#prevStatus: AgentSessionStatus` → `#prevTurnState: TurnState` (init "idle").
- ⚠️ **`#handleStatusTransition` מקבל `status` כפרמטר** (:266 — `(status, enabled, speakThoughts)`),
  לא קורא אותו ישירות. הוסף `turnState` כפרמטר: `#handleStatusTransition(status, turnState, enabled, speakThoughts)`,
  והעבר אותו מה-effect (:163 area, ה-call site). ה-effect (:128-167) קורא היום
  `this.#session.status` (:131) — הוסף `const turnState = this.#session.turnState` (tracked)
  והעבר אותו ל-#handleStatusTransition. בתוך #handleStatusTransition העבר את ההשוואות
  ל-thinking ל-turnState:
  - :269 `if (status === "thinking" && #prevStatus !== "thinking")` → turnState.
    ⚠️ **דיוק**: היום `status==="thinking"` = "תור פעיל". ב-turnState המקביל הוא
    `turnState !== "idle"` (כל פעילות). שמור על הסמנטיקה: reset `#spokeThisTurn` על
    מעבר **לתוך** פעילות (idle→non-idle).
  - :275 `#prevStatus === "thinking" && (status === "connected"||"error")` → סיום תור =
    `#prevTurnState !== "idle" && turnState === "idle"`. ⚠️ §4.3 (זה מנוע ה-cue speaking).
  - בסוף ה-untrack: `this.#prevTurnState = turnState` (במקום #prevStatus = status).
  > ה-effect עדיין קורא גם `status` (ל-justFinished error path) — שמור את שתי הקריאות.

### 2.4 Components
- `components/chat/TypeArea.svelte` :19 — `status !== "connected" && status !== "thinking"`
  → `status !== "connected"` (הקלדה מותרת כשמחוברים).
- `components/layout/AppHeader.svelte` :77 — התנאי המורכב
  `session.status === 'connected' || session.status === 'thinking'` (רקע ה-dot) →
  `session.status === 'connected'` בלבד (thinking לא רלוונטי לחיבור). (:78 צבע, :79
  ה-box-shadow כבר משתמש רק ב-'connected' — אל תיגע בו.)
- `components/chat/MicLarge.svelte` :44/69 — קורא `voiceMode.state === "thinking"`, **לא**
  status. VoiceMode עדיין מחזיר "thinking" (§2.2) → **MicLarge לא משתנה.**

### 2.5 DoD Commit 1
- typecheck נקי (הסרת thinking מ-type → קומפיילר תופס כל consumer שפוספס — safety net).
- כל הטסטים הקיימים עוברים (התנהגות זהה).
- ידני: פרומפט → cue thinking, תגובה זורמת, cue speaking בהשמעה, חזרה ל-idle.

---

## 3. Commit 2 — בועת-סטטוס (ModelStatus + StatusBubble)
**Approach**: manual UI.

### 3.1 Speaker getter
- `get hasPendingNarration(): boolean { return this.#pendingCount > 0 }`.
  ⚠️ §4.4 — `#jobs`/`#activeFetches` הם שדות רגילים (לא $state) → getter עליהם **לא
  reactive** ל-$derived. חשוף ספירה כ-`$state` (`#pendingCount`) שמתעדכנת ב-enqueue/
  fetch-done, או הפוך מנגנון אחר reactive. בלי זה הבועה "ממתין להקראה" לא תתעדכן.

### 3.2 ModelStatus (`view-models/derived/model-status.svelte.ts` — חדש)
derived VM (כמו VoiceMode). קורא session.turnState + speaker.
```ts
export type ModelPhase = "waiting" | "thinking" | "responding" | "calling-tool"
  | "pending-tts" | "speaking" | null
export class ModelStatus {
  constructor(opts: { session: AgentSession; speaker: Speaker })
  phase: ModelPhase = $derived.by(() => {
    if (speaker.state === "speaking")          return "speaking"
    if (session.turnState === "calling-tool")  return "calling-tool"
    if (session.turnState === "responding")    return "responding"
    if (session.turnState === "thinking")      return "thinking"
    if (session.turnState === "waiting")       return "waiting"
    if (speaker.enabled && speaker.hasPendingNarration) return "pending-tts"
    return null
  })
}
```
- נוצר ב-`+layout.svelte` + setContext (additive). context.ts: זוג חדש
  `getModelStatus/setModelStatus` ב-section `// ─── model-status ───`.

### 3.3 StatusBubble (`components/chat/StatusBubble.svelte` — חדש)
- `getModelStatus()` + `getI18n()`. props: אין.
- `phase === null` → לא מרנדר (`{#if}`). אחרת: בועה עם לוגו/אנימציה + טקסט i18n.
- i18n (core/i18n) קידומת `modelStatus.*`: `.waiting`/`.thinking`/`.responding`/
  `.callingTool`/`.pendingTts`/`.speaking`. (keys.ts + he.ts חובה + en.ts scaffold.)

### 3.4 רינדור ב-ChatBubbles (`components/chat/ChatBubbles.svelte`)
- אחרי `{#each session.bubbles}` (:19-21), לפני בלוק empty (:22-24) — הוסף `<StatusBubble />`.
  (מרנדר רק כש-phase≠null, לא שובר את ה-empty-state.)
- הבועה **לא** ב-session.bubbles (transient, נגזרת).
- ⚠️ **auto-scroll ב-`components/layout/AppShell.svelte`** (smart-scroll $effect ב-**:65**,
  עוקב `session.bubbles.length` :66). StatusBubble נגזרת ואינה ב-bubbles → ה-$effect לא
  יזהה אותה. כדי שהופעת הבועה תגרור scroll — הוסף `import { getModelStatus }` +
  `const modelStatus = getModelStatus()` באזור ה-imports (:18) + getters (:32-33),
  וקרא `modelStatus.phase` כתלות בתוך ה-$effect (:65). §8.6.

### 3.5 DoD Commit 2
- typecheck + build + lint:i18n נקי.
- ידני: פרומפט → "ממתין לתגובה" → "חושב"/"כותב תשובה" → (כלי) "קורא לכלי" → "ממתין
  להקראה" → "מקריא" → נעלמת. בכל שיטות-הקלט.

---

## 4. Commit 3 — cancelTurn (ACP cancel) + תיקון X-מהבהב
**Approach**: manual. **verifier-phase אחרי commit זה.**

> **למה זה כאן ולא נפרד**: ה-X-מהבהב נגרם מ-`isCancelling` שנתקע ב-voice-mode $effect
> (:55-64). אחרי Commit 1 התנאי הוא `turnState === "idle"`. אבל cancel() **לא** מחזיר
> את turnState ל-idle (הסוכן עדיין רץ ב-BE, sendPrompt לא resolved) → ה-effect לא
> משחרר → X עדיין נתקע. **התיקון האמיתי = ACP cancel שמאלץ turnState=idle.**

**קבצים שמשתנים**:
- `view-models/agent-session.svelte.ts` — מתודה ציבורית חדשה (ADDITIVE, בבלוק prompting):
  ```ts
  /**
   * מבטל את התור הנוכחי דרך ACP cancel. הסוכן מפסיק לייצר.
   * מאלץ turnState=idle מיידית (לא מחכה ל-sendPrompt resolved). no-op אם אין תור פעיל.
   */
  cancelTurn = async (): Promise<void> => {
    if (this.turnState === "idle") return
    if (!this.#client || !this.#sessionId) return
    try {
      await this.#client.cancel(this.#sessionId)   // core/acp/client.ts:161, מאומת
    } catch {
      // best-effort — בכל מקרה נאלץ idle מקומית
    }
    this.#setTurnState("idle")
  }
  ```
- `view-models/derived/voice-mode.svelte.ts` — `cancel()` (:72) מוסיף קריאה:
  ```ts
  cancel(): void {
    this.isCancelling = true
    this.#mic.cancel()
    this.#speaker.stop()
    void this.#session.cancelTurn()   // ← חדש: עוצר את הסוכן → turnState=idle → effect משחרר isCancelling
  }
  ```
  > `#session` כבר שמור בבנאי (:49-52) — נגיש.

**Verification**:
- typecheck 0.
- browser (BE+OneCLI 4013): פרומפט ארוך, לחץ mic ב-thinking/responding → הסוכן נעצר,
  הכפתור **חוזר ל-idle** (מיקרופון), **לא** נתקע ב-X מהבהב. הבועה נעלמת.

---

## 5. Commit 4 — חיבור הקלטות משתמש ל-BE
**Approach**: manual I/O. **verifier-phase אחרי commit זה.**

**קבצים חדשים**:
- `adapters/voice/recordings.ts`:
  ```ts
  import { beUrl } from "$lib/util/be-url"
  import { bytesToBase64 } from "./base64"   // קיים (בשימוש transcribe.ts)

  /**
   * שומר blob הקלטה ל-BE. ⚠️ BE (backend/src/delivery/http-history.ts:66-98) דורש JSON
   * { audioBase64, mimeType } ומחזיר { id } (201) — לא body גולמי.
   */
  export async function saveRecording(
    blob: Blob, opts?: { signal?: AbortSignal },
  ): Promise<{ id: string }> {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const res = await fetch(beUrl("/api/recordings"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64: bytesToBase64(bytes), mimeType: blob.type || "audio/webm" }),
      ...(opts?.signal ? { signal: opts.signal } : {}),
    })
    if (!res.ok) throw new Error(`saveRecording failed: ${res.status}`)
    return (await res.json()) as { id: string }
  }
  export function recordingUrl(id: string): string {
    return beUrl(`/api/recordings/${id}`)
  }
  ```

**קבצים שמשתנים**:
- `adapters/voice/transcribe.ts` — היום מחזיר `recordingId: ""` (stub `Promise.resolve({ id: "" })`).
  הסר את ה-stub, קרא `saveRecording(blob)` (אחרי/במקביל לתמלול). שמור חתימה
  `transcribe(blob, opts?)` + return `{ text, recordingId }`. **שמירה כושלת לא מפילה
  תמלול** — try/catch שמחזיר `recordingId:""` אם נכשל.
  > ⚠️ sessions-inline שינה את הקובץ (timeout 30s + withRetry). עבוד על הקיים — אל
  > תחזיר את ה-stub, שלב saveRecording בזרימה. בדיקת base: `grep -n "withRetry" transcribe.ts`
  > — אם ריק → base שגוי, עצור.
- `view-models/mic.svelte.ts` — כבר מעביר recordingId ל-sendPrompt ב-`#runTranscribe`
  (:153, אחרי sessions-inline).   ה-blob כבר נשמר ב-`#lastBlob = blob` (:93, לפני #runTranscribe; מתאפס ל-null בהצלחה :151). אין שינוי לוגי —
  recordingId פשוט יהיה אמיתי כשה-stub ב-transcribe.ts יוסר. אמת ש-`#runTranscribe`
  קורא ל-transcribe(blob) ומעביר את ה-recordingId הלאה.

**Verification**:
- typecheck 0. browser: הקלט → `ls packages/backend/data/recordings/` מראה קובץ + index.json.
  בועת-משתמש עם recordingId לא-ריק. שגיאת רשת ב-save → תמלול עדיין עובד.

---

## 6. Commit 5 — adapter + VM להשמעת בועה בודדת
**Approach**: manual audio.

**קבצים חדשים**:
- `adapters/voice/play-bubble.ts`:
  ```ts
  /** מנגן הקלטת-משתמש דרך <audio>. resolves כשנגמר/בוטל. */
  export function playUserRecording(recordingId: string, audioEl: HTMLAudioElement): Promise<void>
  /** מסנתז TTS לטקסט בועת-סוכן (cache hit) ומנגן. stream→Blob→objectURL→<audio>. */
  export async function playAgentText(
    text: string, voiceId: string, audioEl: HTMLAudioElement, opts?: { signal?: AbortSignal },
  ): Promise<void>
  ```
  > `synthesizeStreaming` (tts.ts:29) מחזיר ReadableStream → `new Response(stream).blob()` →
  > `URL.createObjectURL` → play. **`URL.revokeObjectURL` חובה אחרי ended/abort** (§4.7).
  > **אל תיגע ב-Player/Speaker/AudioStream** — נתיב `<audio>` פשוט להשמעה חד-פעמית.
- `view-models/bubble-player.svelte.ts` — VM (entity לפי חוק זהב #2):
  ```ts
  export class BubblePlayer {
    playingBubbleId: string | null = $state(null)
    constructor(opts: { session: AgentSession; settings: Settings })
    toggle(bubbleId: string): void   // לחיצה שנייה על אותה בועה → עוצר
    stop(): void
  }
  ```
  > guard: no-op אם `session.turnState !== "idle"` (אל תשמיע בזמן שהסוכן עונה).
  > user bubble → `playUserRecording(recordingId)`. message/thought → `playAgentText(טקסט מאוחד, settings.voiceId)`.
  > tool bubble → אין ▶. **אין $effect** — toggle הוא method ישיר (§4.8).
- `context.ts` — `getBubblePlayer/setBubblePlayer` (additive). `+layout.svelte` —
  `new BubblePlayer({ session, settings })` + setContext.

**Verification**: typecheck 0. (נבדק דרך הכפתור ב-Commit 6.)

---

## 7. Commit 6 — כפתור ▶ על הבועות
**Approach**: manual UI.

**קבצים שמשתנים**:
- `components/chat/bubbles/UserBubble.svelte` — ▶/⏸ (אם `bubble.recordingId`).
- `components/chat/bubbles/MessageBubble.svelte` — ▶/⏸.
- `components/chat/bubbles/ThoughtBubble.svelte` — ▶/⏸ (אופציונלי).
- כל אחד: `getBubblePlayer()`, מציג ▶ / ⏸ כש-`playingBubbleId === bubble.id`,
  onclick `bubblePlayer.toggle(bubble.id)`. הבועה המתנגנת מודגשת.
- **i18n**: `bubble.play` / `bubble.stop` (aria-label) — keys.ts + he.ts + en.ts.

**Verification**: typecheck 0, lint:i18n 0. browser (BE 4013, סשן קצר): ▶ user → ההקלטה;
▶ agent → TTS (cache hit); לחיצה שנייה → עוצר; בזמן thinking → no-op; בועה מודגשת.

---

## 8. נקודות עדינות (קרא לפני קוד)

1. **guards :177 (sendPrompt) ו-:363 (applyConfigOption):** היום שניהם
   `status !== "connected" && status !== "thinking"` (מתירים גם בתור פעיל). אחרי הפיצול
   `status` תמיד `connected` בתור → `status !== "connected"` **שומר סמנטיקה זהה**.
   תקן שניהם זהה. **אל תוסיף** חסימת שליחה-כפולה (ההתנהגות המקורית התירה).
2. **cue "thinking":** היום ב-`#setStatus` (:454). אחרי הפיצול → ב-`#setTurnState`:
   נגן "thinking" על מעבר **idle→waiting** בלבד (פעם אחת ביציאה מ-idle).
   waiting→thinking→responding לא מנגנים שוב. הסר את ה-cue מ-#setStatus.
3. **cue "speaking" ב-Speaker (:269/275):** הטריגר = סוף תור. עכשיו = `#prevTurnState !== "idle"
   && turnState === "idle"`. ⚠️ ה-mechanism הכי שביר — `#prevTurnState` חייב לעקוב נכון.
   בדוק שה-effect קורא turnState (tracked) ושה-untrack לא בולע אותו.
4. **hasPendingNarration reactivity:** `#jobs`/`#activeFetches` רגילים → getter עליהם **לא
   reactive** ל-$derived. חשוף ספירה כ-$state. בלי זה "ממתין להקראה" לא יתעדכן. קריטי.
5. **+layout.svelte + context.ts** — קבצים משותפים (parallel-safe). ModelStatus +
   BubblePlayer = additive (sections חדשים). שניהם צריכים session/speaker/settings שכבר שם.
6. **auto-scroll — ב-AppShell.svelte** (לא ChatBubbles, הועבר ב-redesign-7). הוסף
   `getModelStatus()` ל-AppShell + `modelStatus.phase` לתלויות ה-$effect (additive).
7. **דליפת objectURL** (playAgentText): `URL.revokeObjectURL` חובה אחרי ended/stop/abort.
8. **$effect ב-BubblePlayer:** אין. toggle הוא method ישיר (כמו Mic.toggle). מונע gotcha
   2026-05-16 (effect קורא+כותב state → loop).
9. **POST /api/recordings shape:** JSON `{audioBase64,mimeType}` → `{id}` 201 (אומת
   backend/src/delivery/http-history.ts:66-98). לא body גולמי.
10. **base sessions-inline:** transcribe.ts כבר עם withRetry/timeout30s ב-dev. אל
    תחזיר stub. אם `grep withRetry transcribe.ts` ריק → base שגוי, עצור.

---

## 9. DoD כולל (calev heavy)
1. core typecheck+tests; frontend-v2 typecheck+build+lint:i18n — נקי.
2. הטסטים הקיימים עוברים (Commit 1 לא משנה התנהגות).
3. בועת-סטטוס מופיעה/מתחלפת/נעלמת לפי 6 phases, בכל שיטות-קלט.
4. cues (thinking/speaking) מתנגנים בעיתוי הנכון (regression — §8.2/8.3).
5. **עצירה**: לחיצת mic ב-thinking → סוכן נעצר, כפתור→idle, **אין X מהבהב**.
6. **הקלטה נשמרת**: קובץ ב-data/recordings + recordingId אמיתי. שמירה כושלת לא מפילה.
7. **▶ user**: מנגן הקלטה. **▶ agent**: TTS cache hit. toggle עוצר. thinking→no-op. בועה מודגשת.
8. `git diff --stat dev`: Commit1 (AgentSession,VoiceMode,Speaker,TypeArea,AppHeader),
   Commit2 (ModelStatus,StatusBubble,context,layout,AppShell,i18n,ChatBubbles),
   Commit3 (AgentSession,VoiceMode), Commit4 (recordings,transcribe), Commit5
   (play-bubble,bubble-player,context,layout), Commit6 (bubbles×3,i18n). MicLarge **לא** משתנה ב-Commit1.

---

## 10. Escalation triggers
- הסרת thinking מ-status שוברת consumer שלא מופה (typecheck יתפוס — דווח אם לא ברור).
- cue speaking לא מתנגן אחרי refactor turnState (§8.3 — mechanism שביר).
- POST /api/recordings לא מחזיר `{id}` או דורש multipart.
- ACP cancel גורם לסוכן להיתקע במקום להיעצר (turnState לא חוזר).
- צריך לגעת ב-Player/Speaker/AudioStream להשמעת בועה בודדת → גישה שגויה, שאל.
- guard :177/:363 — אם לא ברור אם המטרה הייתה לחסום שליחה כפולה (§8.1), שאל מרדכי.

---

## 11. out of scope
- מצב-קלט wake-word (brief B נפרד).
- פיצול VoiceMode (נשאר; רק consumer מתוקן).
- פלייליסט מלא — רצף/קדימה/אחורה/loop/סרגל-נגן (slice C נפרד; משתמש ב-turnState החדש).
- replay של סשן ישן שנטען מחדש (טעינת recordings לבועות משוחזרות).
