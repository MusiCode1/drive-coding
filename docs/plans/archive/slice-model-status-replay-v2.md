# Brief: slice — מצב-מודל + בקרת-סוכן + השמעה (מימוש מחדש על dev)

> ✅ **בוצע · אומת · מוזג ל-dev.** אורכב ב-2026-06-27 (הסטטוס אומת מול היסטוריית git/roadmap; פרטי הביצוע והאימות בהמשך הקובץ).

> סטטוס: **הושלם** (2026-06-14). complexity: **8/10** → verifier-slice-**heavy**.
> base: **`dev`** (tip בזמן כתיבה — אביגיל תאמת line numbers מול ה-tip בזמן dispatch).
> depends_on: [] — כל התלויות כבר ב-dev (sessions-inline, wake-word infra, ws-reconnect-infra).
> verifier-phase אחרי Commit 1 (state refactor), Commit 3 (cancelTurn), Commit 4 (I/O recordings).

## למה brief חדש (ולא merge של slice-model-status-control-replay)

ה-slice המקורי (`slice-model-status-control-replay`, branch `aae715f`) **הושלם ואומת**
(כלב-heavy r2 GO, 3 blockers סגורים) — אבל **לא ניתן למזג מכנית** ל-dev: בזמן שישב בצד
11 יום, dev קיבל refactor של **auto-reconnect** (~382 שורות, slices `ws-reconnect-infra`
+ `ws-reconnect-fix-nbug2`) על אותו `agent-session.svelte.ts`. שני ה-refactors נוגעים
באותו state machine (`status`) בכיוונים מנוגדים → קונפליקט לא-מכני (אומת: `git merge dev`
→ 8 קבצים בקונפליקט, אי-עקביות turnState↔thinking).

**הבשורה הטובה (אומת):** ה-reconnect של dev **אורתוגונלי** לפעילות-המודל — הוא לא
מתייחס כלל ל-`"thinking"` (grep ריק ב-reconnect logic). לכן הפיצול `turnState` הוא
**אדיטיבי מעל** מודל dev, וה-slice המקורי תקף כ-reference כמעט במלואו. ה-branch הישן
משמש reference לקוד (כל commit + API skeleton + דוח כלב r2).

---

## 0. הקשר וסביבה

**מטרה (שלוש שכבות — זהה למקורי):**
1. **הפרדת state** — `AgentSession.status` מערבב חיבור עם פעילות-מודל (`thinking`).
   מפרידים: `status` = חיבור בלבד; `turnState` חדש = מה המודל עושה בתור.
2. **בועת-סטטוס** + **עצירת-סוכן** — בועה ("typing…") שמראה מה המודל עושה, וכפתור
   שעוצר את הסוכן באמת (ACP cancel) ומתקן את באג ה-"X שמהבהב לנצח".
3. **השמעה** — חיבור הקלטות-המשתמש ל-BE + כפתור ▶ להשמעת בועה בודדת.

**שם package FE:** `@drive-coding/frontend-v2`.

**worktree:**
```bash
git worktree add .worktrees/slice-msr-v2 -b slice-msr-v2 dev
cd .worktrees/slice-msr-v2 && pnpm install && pnpm hooks:install
# worktree חדש: הרץ svelte-kit sync לפני vitest (אחרת tsconfig extends נכשל)
pnpm --filter @drive-coding/frontend-v2 exec svelte-kit sync
```

**איך מריצים (Linux — סטנדרטי):**
```bash
cd packages/backend
PORT=4013 onecli run --agent voice-acp -- bun --watch src/server.ts   # OneCLI: proxy + recordings
BE_PORT=4013 pnpm --filter @drive-coding/frontend-v2 dev
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 test
pnpm lint:i18n
```

> **⚠️ Windows env-blockers (אם בודקים ב-Windows — ראה memory `e2e-on-windows-blockers`):**
> (א) `onecli run -- bun` לא נתמך → הרץ BE ישירות `PORT=4013 bun src/server.ts` (ה-proxy
> נחוץ רק ל-TTS, חסום ממילא ב-quota 401). (ב) `validateCwd` POSIX-only → השתמש ב-CLI שמקבל
> נתיב, או החל את fix מ-`slice-fix-cwd-validate-windows`. (ג) **opencode 1.2.27 קורס** על
> plugin-injection tuple format (`plugin-config.ts`) — **בדוק עם CLI=`claude`** (לא מושפע,
> אומת חי E2E: turnState+cancel עובדים). זה לא חלק מהסליס.

**Browser:** linux-gui Chrome :9222 profile voice-acp. mock UI: `/chat?mock=greeting` (reload מלא).
**כלי דיבוג חי:** `window.__session` חושף (proto) `status`, `turnState`, `bubbles`,
`recentAssistantMessages`, ומתודות `sendPrompt`/`cancelTurn`. דגימה: `playwright-cli eval "() => window.__session.turnState"`.

**מקורות-אמת:** `packages/frontend/AGENTS.md` (5 שכבות + חוקי זהב); ה-brief המקורי
`.worktrees/<branch ישן>/docs/plans/slice-model-status-control-replay.md` (reference מלא ל-API skeletons).

---

## 1. מודל ה-state החדש (מוסכמה)

**ההבדל המרכזי מ-dev:** dev מערבב הכל ב-`status`; אנחנו מפצלים לשני צירים אורתוגונליים.

```
// dev היום:
AgentSessionStatus = idle | connecting | connected | thinking | error | disconnected

// אחרי הסליס:
AgentSession.status    = idle | connecting | connected | error | disconnected   ← חיבור (הוסר thinking; disconnected/reconnect נשמר!)
AgentSession.turnState = idle | waiting | thinking | responding | calling-tool  ← פעילות-מודל (חדש)
Speaker.state          = idle | speaking   (קיים, getter)
Speaker.hasPendingNarration = boolean   ← getter חדש (§3.1)
```

> ⚠️ **קריטי — אל תסיר `disconnected`/`error`.** הם של ה-reconnect state machine (dev),
> **אורתוגונליים** ל-thinking (אומת: ה-reconnect logic לא מתייחס ל-thinking בכלל). הסר
> **רק** את `"thinking"` מ-`status`; ה-reconnect נשאר נוגע ללא שינוי.

מיפוי `turnState` ל-ACP updates (זהה למקורי):
| טריגר | turnState |
|---|---|
| `sendPrompt` נשלח, טרם chunk | `waiting` |
| `agent_thought_chunk` | `thinking` |
| `agent_message_chunk` | `responding` |
| `tool_call` / `tool_call_update` (pending/in_progress) | `calling-tool` |
| תור הסתיים (sendPrompt resolved) **או** `cancelTurn` | `idle` |

> ⚠️ **NBug1 (opencode tail) — נשמר מהמקורי.** ב-opencode ה-RESP של `session/prompt` מגיע
> באמצע הזרם (issue #17505); chunks מאוחרים דורסים turnState→responding אחרי idle. ה-fix:
> idle-on-RESP + `#turnEnded`-gated tail-debounce (1.5ש') רק על tail-שאחרי-RESP. ב-claude/
> gemini אין tail → ה-net לא מופעל (0 השהיה). **חובה לשמר את ה-fix הזה.**
> **מקור-אמת לשחזור** (ה-fix קיים רק ב-branch הישן, **לא** ב-dev):
> - `git show slice-model-status-control-replay:packages/frontend/src/lib/view-models/agent-session.svelte.ts` — הקוד המלא.
> - commit **`659f0dc`** = ה-fix של NBug1 (idle-on-RESP + debounce-net על tail). זה ה-commit לחקות.
> - commit **`41dd8c0`** = NBug3 (reset turnState=idle אחרי replay) — **גם** צריך שחזור (§2.1 :298/:359/:648 במקורי), אבל זה fix נפרד, לא NBug1.
> - העיצוב המלא: `git show slice-model-status-control-replay:docs/decisions/voice-acp.md` (entry "2026-06-03 slice-fix-turnstate-stuck"). ⚠️ ה-decisions doc ב-**dev** מתאר NBug שונה (reconnect onClose) — אל תסתמך עליו.
> זה ה-DoD#5/#6 הקריטי.

> ⚠️ **line numbers למטה מ-dev tip בזמן כתיבה.** אביגיל מאמתת מול ה-tip בזמן dispatch.

---

## 2. Commit 1 — refactor: הפרדת status/turnState
**Approach**: manual + typecheck safety-net. **verifier-phase אחרי commit זה.**

**עיקרון:** `status` כבר לא מכיל `thinking`. כל consumer של `status === "thinking"` עובר
ל-`turnState`. אסור חצי-refactor (חוק זהב #5) — כל ה-consumers באותו commit. בלי שינוי UI נראה.

> **רשימת ה-consumers אומתה מול dev tip — בדיוק 9 מקומות, אף אחד לא ב-reconnect:**

### 2.1 AgentSession (`view-models/agent-session.svelte.ts`)
- `AgentSessionStatus` type (:39-45) — **הסר רק** `"thinking"` (:43). נשאר idle/connecting/
  connected/error/**disconnected** (disconnected של reconnect — שמור!).
- הוסף `export type TurnState = "idle" | "waiting" | "thinking" | "responding" | "calling-tool"`.
- הוסף שדה `turnState = $state<TurnState>("idle")` ליד `status` (:73).
- **`#setTurnState(next)`** — setter מרכזי חדש (נקודת-mutation יחידה, כמו `#setStatus` :815).
  כולל את ה-cue (§8.2) + את לוגיקת ה-`#turnEnded`/tail-debounce של NBug1 (ראה ⚠️ ב-§1).
- `sendPrompt` (:472):
  - :473 guard `status !== "connected" && status !== "thinking"` → `status !== "connected"` (§8.1).
  - :490 `#setStatus("thinking")` → `#setTurnState("waiting")` (status נשאר connected).
  - :494 `if (status === "thinking") #setStatus("connected")` → idle-on-RESP: `#setTurnState("idle")`
    + הדלקת `#turnEnded` (NBug1 — §1).
- :728 guard (applyConfigOption, זהה ל-:473) → `status !== "connected"` (§8.1).
- `#onSessionUpdate` — הוסף `#setTurnState` + tail-debounce gate (NBug1):
  - :982 `agent_message_chunk` → `#setTurnState("responding")`
  - :984 `agent_thought_chunk` → `#setTurnState("thinking")`
  - `#handleToolCall` (:996) + `#handleToolCallUpdate` (:1034, pending/in_progress) → `#setTurnState("calling-tool")`
  - בכל handler: אם `#turnEnded` דלוק (tail של opencode) → `#scheduleIdle()` (debounce 1.5ש').
- cue (:819): היום `#setStatus` מנגן "thinking" כש-`next==="thinking"`. אחרי הפיצול → ב-`#setTurnState`:
  נגן "thinking" על מעבר **idle→waiting** בלבד (פעם אחת). הסר את ה-cue מ-#setStatus (השאר את ה-error cue :820).

### 2.2 VoiceMode (`view-models/derived/voice-mode.svelte.ts`)
- :45 `if (#session.status === "thinking") return "thinking"` → `if (#session.turnState !== "idle") return "thinking"`.
- :59 (ב-$effect reset isCancelling) `#session.status !== "thinking"` → `#session.turnState === "idle"`.
- VoiceModeState type (:28) — **לא משתנה** (נשאר thinking ל-MicLarge).

### 2.3 Speaker (`view-models/speaker.svelte.ts`)
- `#prevStatus` → `#prevTurnState: TurnState` (init "idle").
- `#handleStatusTransition` מקבל `status` כפרמטר — הוסף `turnState` כפרמטר והעבר מה-effect
  (ה-effect קורא `this.#session.status` — הוסף `const turnState = this.#session.turnState` tracked).
  - :269 `if (status === "thinking" && #prevStatus !== "thinking")` → מעבר **לתוך** פעילות:
    `turnState !== "idle" && #prevTurnState === "idle"` (reset `#spokeThisTurn`).
  - :275 `#prevStatus === "thinking" && (status === "connected"||"error")` → סוף תור:
    `#prevTurnState !== "idle" && turnState === "idle"`. ⚠️ §8.3 (מנוע cue speaking — הכי שביר).
  - בסוף ה-untrack: `this.#prevTurnState = turnState`.
  > ⚠️ **שמור על חתימת ה-dev הנוכחית:** `#processToolBubbles` ו-`#handleStatusTransition` קיבלו
  > פרמטר `enabled` ב-dev — **אל תפיל אותו**; הוסף את `turnState` לצד `enabled` (זה היה אחד
  > מקונפליקטי ה-merge). אמת את החתימה המדויקת מול dev tip.

### 2.4 Components
- `components/chat/TypeArea.svelte` :19 — `status !== "connected" && status !== "thinking"` → `status !== "connected"`.
- `components/layout/AppHeader.svelte` :77 — קיים ודאי (אומת): תנאי `status === 'thinking'` ברקע ה-dot.
  **חובה לערוך** — הסר את `'thinking'` (לא רלוונטי לחיבור). אמת את ה-line מול dev tip בזמן ביצוע.
- `components/chat/MicLarge.svelte` :44/69 — קורא `voiceMode.state === "thinking"`, **לא** status.
  VoiceMode עדיין מחזיר "thinking" (§2.2) → **MicLarge לא משתנה.**

### 2.5 DoD Commit 1
- typecheck נקי (הסרת thinking מ-type → קומפיילר תופס כל consumer שפוספס).
- כל הטסטים הקיימים עוברים. ⚠️ `agent-session.test.ts:242` עושה `session.status = "thinking"` —
  עדכן את הטסט ל-`turnState` (זה לא consumer קוד אלא טסט; עדכן בהתאם).
- ידני: פרומפט → cue thinking, תגובה זורמת, cue speaking בהשמעה, חזרה ל-idle. **reconnect עדיין עובד** (נתק WS → disconnected → reconnect; turnState אורתוגונלי).

---

## 3. Commit 2 — בועת-סטטוס (ModelStatus + StatusBubble)
**Approach**: manual UI. *(זהה למקורי §3 — מועתק עם line-number caveat.)*

### 3.1 Speaker getter
- `get hasPendingNarration(): boolean { return this.#pendingCount > 0 }`.
  ⚠️ §8.4 — `#jobs`/`#activeFetches` רגילים (לא $state) → getter עליהם **לא reactive**.
  חשוף ספירה כ-`$state` (`#pendingCount`) שמתעדכנת ב-enqueue/fetch-done. קריטי.

### 3.2 ModelStatus (`view-models/derived/model-status.svelte.ts` — חדש)
derived VM (כמו VoiceMode). קורא session.turnState + speaker:
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
- נוצר ב-`+layout.svelte` + setContext (additive). context.ts: זוג חדש `getModelStatus/setModelStatus`.

### 3.3 StatusBubble (`components/chat/StatusBubble.svelte` — חדש)
- `getModelStatus()` + `getI18n()`. `phase === null` → לא מרנדר (`{#if}`). אחרת בועה + טקסט i18n.
- i18n (core/i18n) קידומת `modelStatus.*`: `.waiting`/`.thinking`/`.responding`/`.callingTool`/
  `.pendingTts`/`.speaking`. (keys.ts + he.ts חובה + en.ts.)
  ⚠️ dev הוסיף `settings.language.*` keys (rtl-ltr-bidi) — הוסף את שלך לצדם, אל תתנגש.

### 3.4 רינדור ב-ChatBubbles (`components/chat/ChatBubbles.svelte`)
- אחרי `{#each session.bubbles}`, לפני בלוק empty — הוסף `<StatusBubble />` (transient, לא ב-bubbles).
- ⚠️ **auto-scroll ב-`components/layout/AppShell.svelte`** ($effect smart-scroll עוקב
  `session.bubbles.length`). StatusBubble נגזרת → הוסף `getModelStatus()` + קריאת `modelStatus.phase`
  כתלות ב-$effect כדי שהופעת הבועה תגרור scroll. **אמת line numbers מול dev tip.**

### 3.5 DoD Commit 2
- typecheck + build + lint:i18n נקי. ידני: רצף 6 phases בכל שיטות-קלט.

---

## 4. Commit 3 — cancelTurn (ACP cancel) + תיקון X-מהבהב
**Approach**: manual. **verifier-phase אחרי commit זה.**

> ה-X-מהבהב נגרם מ-`isCancelling` שנתקע ב-voice-mode $effect. אחרי Commit 1 התנאי הוא
> `turnState === "idle"`. cancel() לבדו לא מחזיר turnState ל-idle → התיקון = ACP cancel.

- `agent-session.svelte.ts` — מתודה ציבורית חדשה (ADDITIVE, בבלוק prompting):
  ```ts
  /** מבטל את התור דרך ACP cancel. מאלץ turnState=idle מיידית. no-op אם אין תור פעיל. */
  cancelTurn = async (): Promise<void> => {
    if (this.turnState === "idle") return
    if (!this.#client || !this.#sessionId) return
    try { await this.#client.cancel(this.#sessionId) }   // core/acp/client.ts — אמת line
    catch { /* best-effort — נאלץ idle מקומית בכל מקרה */ }
    this.#setTurnState("idle")
  }
  ```
- `view-models/derived/voice-mode.svelte.ts` — `cancel()` מוסיף `void this.#session.cancelTurn()`.

**Verification:** typecheck 0. browser (CLI=claude מומלץ ב-Windows): פרומפט ארוך, לחץ mic
ב-responding → הסוכן נעצר, כפתור→idle (מיקרופון), **לא** X מהבהב. הבועה נעלמת.
*(אומת חי בסשן 2026-06-14 מול claude: `cancelTurn()` ב-responding → turnState=idle מיידי, mic idle icon.)*

---

## 5. Commit 4 — חיבור הקלטות משתמש ל-BE
**Approach**: manual I/O. **verifier-phase אחרי commit זה.**

> ⚠️ **בדיקת base חובה:** `grep -n "withRetry\|recordingId" packages/frontend/src/lib/adapters/voice/transcribe.ts`
> — ה-stub `Promise.resolve({ id: "" })` עדיין ב-dev (אומת: 2 מופעי `id: ""`). אם withRetry ריק → base שגוי.
> `/api/recordings` כבר קיים ב-BE dev (אומת: http-history.ts). 

- `adapters/voice/recordings.ts` (חדש): `saveRecording(blob)` → POST `/api/recordings`
  JSON `{audioBase64, mimeType}` → `{id}` (201); `recordingUrl(id)`. (skeleton מלא ב-brief המקורי §5.)
- `adapters/voice/transcribe.ts` — הסר stub `id:""`, קרא `saveRecording(blob)`. שמור חתימה +
  return `{text, recordingId}`. שמירה כושלת → try/catch מחזיר `recordingId:""` (תמלול לא נופל).
- `view-models/mic.svelte.ts` — כבר מעביר recordingId; אמת שזורם (אין שינוי לוגי).

**Verification:** typecheck 0. browser: הקלט → קובץ ב-`data/recordings/` + recordingId לא-ריק. שגיאת רשת → תמלול עובד.

---

## 6. Commit 5 — adapter + VM להשמעת בועה בודדת
**Approach**: manual audio. *(זהה מקורי §6.)*

- `adapters/voice/play-bubble.ts` (חדש): `playUserRecording(id, audioEl)`; `playAgentText(text, voiceId, audioEl, opts)`.
  > `synthesizeStreaming` (tts.ts) → `new Response(stream).blob()` → `URL.createObjectURL` → play.
  > **`URL.revokeObjectURL` חובה אחרי ended/abort** (§8.7). **אל תיגע ב-Player/Speaker/AudioStream.**
- `view-models/bubble-player.svelte.ts` (חדש): `BubblePlayer { playingBubbleId; toggle(id); stop() }`.
  > guard: no-op אם `session.turnState !== "idle"`. user→`playUserRecording`; message/thought→`playAgentText`;
  > tool→אין ▶. **אין $effect** — toggle method ישיר (§8.8).
- `context.ts` + `+layout.svelte` — `getBubblePlayer/setBubblePlayer` + `new BubblePlayer({session, settings})` (additive).
  ⚠️ dev הוסיף ל-+layout את ה-dir/lang sync (rtl-ltr-bidi) ואת ה-imports — הוסף את שלך לצדם.

**Verification:** typecheck 0.

---

## 7. Commit 6 — כפתור ▶ על הבועות
**Approach**: manual UI. *(זהה מקורי §7.)*
- `UserBubble.svelte` (▶ אם recordingId), `MessageBubble.svelte`, `ThoughtBubble.svelte` (אופציונלי) —
  `getBubblePlayer()`, ▶/⏸ לפי `playingBubbleId === bubble.id`, onclick `toggle(bubble.id)`, בועה מודגשת.
- i18n: `bubble.play`/`bubble.stop` (aria-label) — keys.ts + he.ts + en.ts.

**Verification:** typecheck 0, lint:i18n 0. browser: ▶ user→הקלטה; ▶ agent→TTS (ב-Windows חסום 401 — בדוק על Linux/credits); toggle עוצר; thinking→no-op; בועה מודגשת.

---

## 8. נקודות עדינות (קרא לפני קוד)
1. **guards sendPrompt(:473) ו-applyConfigOption(:728):** היום `status !== "connected" && status !== "thinking"`.
   אחרי הפיצול `status` תמיד `connected` בתור → `status !== "connected"` שומר סמנטיקה. **אל תוסיף** חסימת שליחה-כפולה.
2. **cue "thinking":** עבור מ-`#setStatus`(:819) ל-`#setTurnState`: נגן על מעבר idle→waiting בלבד (פעם אחת).
3. **cue "speaking" ב-Speaker(:269/275):** טריגר = סוף תור = `#prevTurnState !== "idle" && turnState === "idle"`.
   ⚠️ ה-mechanism הכי שביר. בדוק שה-effect קורא turnState (tracked) ושה-untrack לא בולע.
4. **hasPendingNarration reactivity:** חשוף ספירה כ-$state (`#pendingCount`). getter על שדה רגיל לא reactive. קריטי.
5. **reconnect אורתוגונלי (חדש — קריטי):** אל תיגע ב-`disconnected`/reconnect logic (`#runReconnectLoop`/
   `#doReconnect`/`#findReusableAgent`/`#scheduleReconnect`/`#handleUnexpectedClose`). הם לא מתייחסים
   ל-thinking. אחרי הסליס `status` שומר `disconnected`. אמת ב-DoD: נתק WS באמצע תור → reconnect עובד + turnState אורתוגונלי.
6. **NBug1 tail-debounce (קריטי):** שמר את ה-fix מהמקורי (idle-on-RESP + `#turnEnded`-gated debounce 1.5ש'
   על tail-שאחרי-RESP). מקור: commit `659f0dc` של ה-branch הישן (זה NBug1; `41dd8c0` הוא NBug3-replay נפרד) +
   `git show slice-model-status-control-replay:docs/decisions/voice-acp.md`. ⚠️ ה-decisions ב-dev מתאר NBug אחר — אל תסתמך עליו. בלי ה-fix — opencode נתקע ב-responding.
7. **+layout.svelte + context.ts** — additive (sections חדשים). dev הוסיף שם dir/lang sync — אל תתנגש.
8. **auto-scroll ב-AppShell.svelte** — הוסף getModelStatus + modelStatus.phase לתלויות $effect.
9. **objectURL leak** (playAgentText): `URL.revokeObjectURL` חובה.
10. **אין $effect ב-BubblePlayer** — toggle method ישיר.
11. **base sessions-inline:** transcribe.ts עם withRetry/timeout ב-dev. אל תחזיר stub.
12. **שמות package:** `@drive-coding/frontend-v2`. **worktree חדש:** `svelte-kit sync` לפני vitest.

---

## 9. DoD כולל (calev heavy)
1. core typecheck+tests; frontend-v2 typecheck+build+lint:i18n — נקי.
2. הטסטים הקיימים עוברים (Commit 1 לא משנה התנהגות; עדכן `agent-session.test.ts:242`).
3. בועת-סטטוס מופיעה/מתחלפת/נעלמת לפי 6 phases, בכל שיטות-קלט.
4. cues (thinking/speaking) בעיתוי נכון (regression — §8.2/8.3).
5. **עצירה**: לחיצת mic ב-thinking/responding → סוכן נעצר, כפתור→idle, **אין X מהבהב**.
6. **NBug1**: opencode — turnState לא נתקע ב-responding אחרי סוף תור (tail-debounce). claude/gemini — 0 השהיה.
7. **reconnect regression**: נתק WS באמצע תור → disconnected → reconnect → connected; turnState אורתוגונלי לא נשבר.
8. **הקלטה נשמרת**: קובץ ב-data/recordings + recordingId אמיתי. שמירה כושלת לא מפילה.
9. **▶ user**: מנגן הקלטה. **▶ agent**: TTS cache hit. toggle עוצר. thinking→no-op. בועה מודגשת.
10. `git diff --stat dev`: Commit1 (AgentSession,VoiceMode,Speaker,TypeArea,AppHeader,test),
    Commit2 (ModelStatus,StatusBubble,context,layout,AppShell,i18n,ChatBubbles), Commit3 (AgentSession,VoiceMode),
    Commit4 (recordings,transcribe), Commit5 (play-bubble,bubble-player,context,layout), Commit6 (bubbles×3,i18n).
    **reconnect logic ו-MicLarge לא משתנים.**

---

## 10. Escalation triggers
- הסרת thinking מ-status שוברת consumer שלא מופה (typecheck יתפוס — דווח אם לא ברור).
- **reconnect logic מתייחס ל-thinking** (לא צפוי — grep אמר ריק; אם נמצא, עצור ושאל מרדכי).
- cue speaking לא מתנגן אחרי refactor (§8.3 — mechanism שביר).
- POST /api/recordings לא מחזיר `{id}` או דורש multipart.
- ACP cancel גורם לסוכן להיתקע (turnState לא חוזר).
- צריך לגעת ב-Player/Speaker/AudioStream להשמעת בועה בודדת → גישה שגויה, שאל.
- ה-base (dev) לא מכיל את ה-reconnect refactor או את withRetry ב-transcribe → base שגוי.

---

## 11. out of scope
- מצב-קלט wake-word (brief נפרד).
- פיצול VoiceMode (נשאר; רק consumer מתוקן).
- פלייליסט מלא — רצף/קדימה/אחורה/loop/סרגל-נגן (slice C נפרד; משתמש ב-turnState).
- replay של סשן ישן שנטען מחדש (טעינת recordings לבועות משוחזרות).
- תיקון באג plugin-injection של opencode (#17505 workaround נפרד; brief/bug עצמאי).
