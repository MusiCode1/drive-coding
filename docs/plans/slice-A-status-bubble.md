# Brief: slice A — בועת-סטטוס-מודל + הפרדת חיבור/פעילות

> סטטוס: brief מוכן לאימות (אביגיל) → executor. complexity: 7/10.
> verifier: calev light. depends_on: [] (קוד wake-word כבר ב-dev, לא נדרש כאן).
> base: dev (tip עדכני — אמת `git -C dev log --oneline -1` לפני worktree).
> ⚠️ זה refactor invasive ב-state model + תוספת UI. שני commits.

## 0. הקשר וסביבה

**מטרה (שתי הפרדות, מסמך תכנון `input-modes-and-status-bubble-design.md`):**
1. **הפרדת state** — `AgentSession.status` מערבב חיבור (connecting/connected) עם
   פעילות-מודל (`thinking`). מפרידים: `status` = חיבור בלבד; `turnState` חדש = מה
   המודל עושה בתור (waiting/thinking/responding/calling-tool).
2. **בועת-סטטוס** — בסגנון WhatsApp ("typing…"): בועה בתחתית שטף השיחה שמראה מה
   המודל עושה ("ממתין לתגובה" / "חושב" / "כותב תשובה" / "קורא לכלי" / "ממתין
   להקראה" / "מקריא") + לוגו. מנותקת משיטת-הקלט (זהה ב-record/typing/wake-word).

**שם package FE:** `@drive-coding/frontend-v2` (כל `pnpm --filter`).

**worktree:**
```bash
git worktree add .worktrees/slice-A-status-bubble -b slice-A-status-bubble dev
cd .worktrees/slice-A-status-bubble && pnpm install && pnpm hooks:install
```

**מקורות-אמת:** `packages/frontend/AGENTS.md` (5 שכבות + חוקי זהב), מסמך התכנון
(ב-branch poc-wake-word: `docs/plans/input-modes-and-status-bubble-design.md`).

## 1. מודל ה-state החדש (מוסכמה)

המוסכמה הקיימת: `status` = lifecycle (רק ל-AgentSession), `state` = FSM פנימי
(Mic/Speaker/VoiceMode), `mode` = בחירת-מצב (WakeWord). השם החדש `turnState`
עוקב — "מצב התור הנוכחי".

```
AgentSession.status    = "idle" | "connecting" | "connected" | "error"   ← חיבור (הוסר thinking)
AgentSession.turnState = "idle" | "waiting" | "thinking" | "responding" | "calling-tool"   ← חדש
Speaker.state          = "idle" | "speaking"   (קיים, getter)
Speaker.hasPendingNarration = boolean   ← getter חדש (#jobs.length>0 || #activeFetches>0)
```

מיפוי turnState ל-ACP updates (ב-`#onSessionUpdate` / `sendPrompt`):
| טריגר | turnState |
|---|---|
| `sendPrompt` נשלח, טרם chunk | `waiting` |
| `agent_thought_chunk` | `thinking` |
| `agent_message_chunk` | `responding` |
| `tool_call` / `tool_call_update` (pending/in_progress) | `calling-tool` |
| תור הסתיים (sendPrompt resolved) | `idle` |

## 2. Commit 1 — refactor: הפרדת status/turnState

**עיקרון:** `status` כבר לא יכיל `thinking`. כל consumer של `status === "thinking"`
עובר ל-`turnState`. אסור חצי-refactor (חוק זהב #5) — מתקנים את **כל** ה-consumers
באותו commit. בלי שינוי UI נראה — התנהגות זהה, רק state מסודר.

### 2.1 AgentSession (`view-models/agent-session.svelte.ts`)
- `AgentSessionStatus` type (:39) — **הסר** `"thinking"`. נשאר idle/connecting/connected/error.
- הוסף `export type TurnState = "idle" | "waiting" | "thinking" | "responding" | "calling-tool"`.
- הוסף שדה `turnState = $state<TurnState>("idle")` (:65 ליד status).
- `sendPrompt` (:194): היום `#setStatus("thinking")`. שנה ל: `status` נשאר `connected`,
  `turnState = "waiting"`. (:198): `if (this.status === "thinking") #setStatus("connected")`
  → היום זה ה-guard לסיום תור. שנה ל-`turnState = "idle"` בסיום (resolved/finally).
- guards :177 ו-:363 (`status !== "connected" && status !== "thinking"`) → היום מתירים
  שליחה גם בזמן thinking. שנה ל-`status !== "connected"` (כי thinking כבר לא ב-status;
  אם צריך לחסום שליחה כפולה בזמן תור — בדוק `turnState !== "idle"` במקום).
  ⚠️ **לוגיקה עדינה** — ראה §4.1.
- `#onSessionUpdate` (:581+): הוסף עדכון `turnState` לפי סוג ה-update (טבלה §1).
  - `agent_message_chunk` (:616) → `turnState = "responding"`
  - `agent_thought_chunk` (:618) → `turnState = "thinking"`
  - `#handleToolCall` (:602/630) → `turnState = "calling-tool"`
- cue (:454): `if (next === "thinking") #cues.play("thinking")` — היום על שינוי status.
  עבור ל-effect/setter על `turnState` (play "thinking" כשנכנסים ל-waiting/thinking).
  ⚠️ ראה §4.2 (מתי הצליל מתנגן).

### 2.2 VoiceMode (`view-models/derived/voice-mode.svelte.ts`)
- :45 `if (this.#session.status === "thinking") return "thinking"` → `if (turnState !== "idle") return "thinking"`
  (כל פעילות-מודל = "thinking" ל-VoiceMode, ששומר על 6 המצבים שלו ל-MicLarge).
- :59 (ב-$effect reset isCancelling) `status !== "thinking"` → `turnState === "idle"`.
- VoiceModeState type (:24-30) — **לא משתנה** (נשאר thinking ל-MicLarge).

### 2.3 Speaker (`view-models/speaker.svelte.ts`)
- :269 `if (status === "thinking" && #prevStatus !== "thinking")` — טריגר ל-cue speaking.
- :275 `#prevStatus === "thinking" && (status === "connected"||"error")`.
- :101 `#prevStatus: AgentSessionStatus`.
- **שנה את הלוגיקה לקרוא `turnState` במקום `status`** ל-thinking. ה-effect (:128-167)
  קורא היום `this.#session.status` (:131) — הוסף קריאת `turnState` (tracked) והעבר את
  ההשוואות ל-thinking ל-turnState. `#prevStatus` → `#prevTurnState: TurnState`.
  ⚠️ **לוגיקה עדינה ביותר** — ה-cue "speaking" מתנע ע"י המעבר. ראה §4.3.

### 2.4 Components שקוראים status==="thinking"
- `components/chat/TypeArea.svelte` :19 — `status !== "connected" && status !== "thinking"`
  (disable input). היום מתיר הקלדה בזמן thinking. שנה ל-`status !== "connected"` (thinking
  כבר לא ב-status; הקלדה מותרת כשמחוברים).
- `components/layout/AppHeader.svelte` :77 — `status === 'connected' || status === 'thinking'`
  (styling של dot חיבור). שנה ל-`status === 'connected'` (thinking לא רלוונטי לחיבור).
- `components/chat/MicLarge.svelte` :44/69 — קורא `voiceMode.state === "thinking"`, **לא**
  status. VoiceMode עדיין מחזיר "thinking" (§2.2) → **MicLarge לא משתנה.**

### 2.5 DoD Commit 1
- typecheck נקי (הסרת thinking מ-type → קומפיילר יתפוס כל consumer שפספסנו — זה ה-safety net).
- כל הטסטים הקיימים עוברים (התנהגות זהה).
- ידני: שליחת פרומפט → cue thinking מתנגן, תגובה זורמת, cue speaking בהשמעה, חזרה ל-idle.
- testing: **manual + הטסטים הקיימים** (אין שינוי התנהגות → אסור שטסט ישבר).

## 3. Commit 2 — בועת-סטטוס

### 3.1 Speaker getter (`speaker.svelte.ts`)
- הוסף `get hasPendingNarration(): boolean { return this.#jobs.length > 0 || this.#activeFetches > 0 }`.
  ⚠️ ודא ש-`#jobs`/`#activeFetches` הם state-tracked או נגזרים נכון (הם רגילים — §4.4).

### 3.2 ModelStatus (`view-models/derived/model-status.svelte.ts` — חדש)
derived VM (כמו VoiceMode). קורא session.turnState + speaker.
```ts
export type ModelPhase = "waiting" | "thinking" | "responding" | "calling-tool"
  | "pending-tts" | "speaking" | null
export class ModelStatus {
  // constructor({ session, speaker })
  phase: ModelPhase = $derived.by(() => {
    if (speaker.state === "speaking")        return "speaking"
    if (session.turnState === "calling-tool")return "calling-tool"
    if (session.turnState === "responding")  return "responding"
    if (session.turnState === "thinking")    return "thinking"
    if (session.turnState === "waiting")     return "waiting"
    if (speaker.enabled && speaker.hasPendingNarration) return "pending-tts"
    return null
  })
}
```
- נוצר ב-`+layout.svelte` + setContext (additive — ראה §4.5). context.ts: זוג חדש
  `getModelStatus/setModelStatus` ב-section חדש `// ─── model-status ───`.

### 3.3 StatusBubble (`components/chat/StatusBubble.svelte` — חדש)
- `getModelStatus()` + `getI18n()`. props: אין (קורא context).
- אם `phase === null` → לא מרנדר כלום (`{#if}`).
- אחרת: בועה עם לוגו/אנימציה + טקסט i18n לפי phase.
- מחרוזות i18n חדשות (core/i18n): `status.waiting`/`thinking`/`responding`/`callingTool`/`pendingTts`/`speaking`.

### 3.4 רינדור ב-ChatBubbles (`components/chat/ChatBubbles.svelte`)
- אחרי ה-`{#each session.bubbles}` (:19-21), הוסף `<StatusBubble />`.
- הבועה **לא** ב-session.bubbles (transient, נגזרת) — מרונדרת בנפרד בסוף הרשימה.
- ⚠️ auto-scroll: אם ChatBubbles עושה auto-scroll ל-bubble אחרון, ודא שהבועה
  נכללת בגלילה (§4.6).

### 3.5 DoD Commit 2
- typecheck + build + lint:i18n נקי.
- ידני: שליחת פרומפט → בועה "ממתין לתגובה" → "חושב"/"כותב תשובה" → (אם כלי) "קורא
  לכלי" → "ממתין להקראה" → "מקריא" → נעלמת. בכל שיטות הקלט.

## 4. נקודות עדינות (קרא לפני קוד)

1. **guards של sendPrompt (:177/:363):** היום מתירים שליחה ב-thinking (תור פעיל).
   אחרי הפיצול — `status` תמיד `connected` בתור. אם הכוונה הייתה לחסום שליחה כפולה
   בזמן תור פעיל, התנאי צריך `turnState !== "idle"`. **אבל** ייתכן שהמתירנות מכוונת
   (queue). בדוק את ההתנהגות המקורית — אל תשנה סמנטיקה בלי לוודא. אם לא ברור → שאל מרדכי.
2. **cue "thinking" (:454):** היום על מעבר status→thinking. אחרי: על מעבר turnState
   idle→(waiting/thinking). ודא שלא מתנגן פעמיים (waiting→thinking הוא מעבר נוסף).
   נגן רק על היציאה מ-idle.
3. **cue "speaking" ב-Speaker (:269/275):** הטריגר המקורי = מעבר status thinking→connected
   (סוף תור) מפעיל בדיקת השמעה. עכשיו = turnState→idle. ⚠️ זה ה-mechanism הכי שביר —
   ה-`#prevTurnState` חייב לעקוב נכון, אחרת cue speaking לא יתנגן. בדוק שה-effect
   קורא turnState (tracked) ושה-untrack לא בולע אותו.
4. **hasPendingNarration:** `#jobs`/`#activeFetches` הם שדות רגילים (לא $state) —
   getter שקורא אותם **לא יהיה reactive** ל-ModelStatus $derived! צריך לוודא
   reactivity: או להפוך אותם ל-$state, או לחשוף ספירה כ-$state. ⚠️ זו נקודה טכנית
   קריטית — בלי reactivity הבועה "ממתין להקראה" לא תתעדכן. בדוק במקור.
5. **+layout.svelte + context.ts** — קבצים משותפים (parallel-safe). הוספת ModelStatus
   = additive (section חדש). ModelStatus צריך את session+speaker שכבר נוצרים שם.
6. **auto-scroll ב-ChatBubbles** — אם קיים, הבועה הנגזרת צריכה להיכלל.

## 5. DoD כולל (calev light)
1. core typecheck + tests; frontend-v2 typecheck + build + lint:i18n — נקי.
2. הטסטים הקיימים עוברים (Commit 1 לא משנה התנהגות).
3. בועת-סטטוס מופיעה/מתחלפת/נעלמת לפי 6 ה-phases, בכל שיטות-קלט.
4. cues (thinking/speaking) עדיין מתנגנים בעיתוי הנכון (regression — §4.2/4.3).
5. `git diff --stat dev`: AgentSession, VoiceMode, Speaker, TypeArea, AppHeader,
   ChatBubbles (commit1) + ModelStatus/StatusBubble/context/layout/i18n (commit2).
   MicLarge **לא** משתנה.

## 6. out of scope
- מצב-קלט wake-word (brief B נפרד).
- פיצול VoiceMode (נשאר כמו שהוא, רק consumer מתוקן).
- שינוי עיצוב הבועה מעבר ל-MVP (לוגו+טקסט+אנימציה בסיסית).
