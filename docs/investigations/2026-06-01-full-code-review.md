# Code Review מלא — drive-coding (voice-acp)

> **נכתב:** 2026-06-01 (מרדכי) · **tip:** `115419d` · **סוג:** review ארכיטקטוני יזום
> **scope:** כל הפרויקט — FE (5 שכבות), backend, core, **טסטים**. דגש על: יעילות
> effects, באגים שפוגעים במשתמש תמים, אנטי-דפוסים, לוגיקה מפוזרת, איכות טסטים.
> **מצב baseline בעת ה-review:** `pnpm typecheck` נקי, ~471 טסטים, build 0.
> **שיטה:** סבב 1 (מרדכי, ידני) על ה-hot path; סבב 2 (3 sub-agents מקבילים)
> על BE delivery+fs, FE components+adapters, ואיכות הטסטים. החלקים A-G הם סבב 1,
> H-J הם סבב 2.

מסמך זה הוא **ממצאים**, לא תוכנית-תיקון. כל פריט מסומן בחומרה + פעולה מוצעת.
הפריטים שכבר על ה-roadmap או שיש להם brief מסומנים ככאלה.

---

## תקציר מנהלים

הקוד בריא יחסית, אבל הביקורת המעמיקה חשפה תמונה **דו-קוטבית**: ה-functional
core (logic טהורה) מכוסה היטב ב-TDD אמיתי; ה-**imperative shell הקולי** (Speaker,
Mic, AgentSession, Player, AudioStream — לב הפרודקט) **כמעט ללא טסטים בכלל**.
זה בדיוק האזור שבו ישבו 19 הבאגים של slice 9. הריצה הירוקה הנוכחית **אינה
ראיה** שצינור הקול עובד.

ה-`design-principles.md` כבר תיעד את שני ה-smells הגדולים (state machine מפוזר,
מתי `$effect`). ה-review מאשר אותם בקוד החי ומוסיף **באגים אמיתיים רבים**, מתוכם
מספר קריטיים שלא היו ידועים.

**הממצאים החמורים החדשים:**
- **B2** — dedup של agents מת לחלוטין (`bridgePort=0` תמיד-falsy).
- **H1** — race ב-registries: פרויקט/הקלטה "נעלמים" בתרחיש multi-agent רגיל (איבוד נתונים).
- **F1** — "נשמר" ב-settings תקוע לנצח (`$derived` עם `Date.now()` לא-reactive).
- **F3** — mic נתקע ב-`transcribing` לנצח אם STT תלוי (אין timeout, אין escape).
- **H2** — sync IO ב-`/api/options` חוסם את כל ה-event loop עד 5s.

| # | ממצא | חומרה | סטטוס | מקור |
|---|------|--------|--------|------|
| B1 | `#cleanup` לא הורג agent ב-BE → דליפת bridges | 🔴 | **brief מאומת (slice 25)** | סבב 1 |
| B2 | `bridgePort=0` שובר dedup לחלוטין | 🔴 | חדש | סבב 1 |
| B3 | `#waitForReady` polling ללא timeout → תקיעה | 🔴 | חדש | סבב 1 |
| H1 | race ב-registries → איבוד פרויקט/הקלטה | 🔴 | חדש | סבב 2 (BE) |
| F1 | "נשמר" תקוע לנצח (`$derived`+`Date.now()`) | 🔴 | חדש | סבב 2 (FE) |
| F3 | transcribe בלי timeout → mic תקוע | 🟠 | חדש | סבב 2 (FE) |
| H2 | sync IO ב-`/api/options` חוסם event loop | 🟠 | חדש | סבב 2 (BE) |
| H3 | cache משותף בין משתמשים, בלי TTL/ניקוי | 🟠 | חלקית slice 24 | סבב 2 (BE) |
| H4 | cache stream write בלי timeout → leak + miss שקט | 🟠 | חדש | סבב 2 (BE) |
| F2 | החלפת מודל כושלת בשקט, UI שקרי | 🟠 | חדש | סבב 2 (FE) |
| F4 | `getAgent` בולע גוף שגיאה | 🟠 | חדש | סבב 2 (FE) |
| B4 | כפילות attach/loadSession + drift | 🟠 | חדש (חוק זהב #5) | סבב 1 |
| B5 | auto-scroll זורק משתמש שגלל למעלה | 🟠 | חדש | סבב 1 |
| E1 | Speaker `$effect` — O(n) tracking על כל tick | 🟠 | חדש | סבב 1 |
| L1 | `status` writes על ~12 אתרים | 🟠 | **מתועד design-principles §3** | סבב 1 |
| T1 | הצינור הקולי כולו — 0 טסטים (Speaker/Mic/...) | 🔴 | חדש | סבב 2 (טסטים) |
| T2 | dedup — טסט יחיד skipped וגם שבור | 🔴 | חדש | סבב 2 (טסטים) |
| T3 | assertions חלשות "מאשרות" את B1/B2 בירוק | 🟠 | חדש | סבב 2 (טסטים) |
| F7 | אין timeout ב-voices/tts → picker תקוע | 🟡 | חדש | סבב 2 (FE) |
| F9 | thought segments נעלמים בזמן streaming | 🟡 | חדש | סבב 2 (FE) |
| H5 | rate-limit map דולף + bucket "anon" משותף | 🟡 | חדש | סבב 2 (BE) |
| E2 | `VoiceMode.isCancelling` race עם הקלטה | 🟡 | חדש | סבב 1 |
| L3 | `#mapToolContent` parsing ב-VM (שייך core) | 🟡 | חדש | סבב 1 |
| D1 | `textHash` provenance — dead, אין צרכן | 🟢 | חדש (YAGNI) | סבב 1+2 |

---

## A. באגים קריטיים 🔴

### B1 — `#cleanup` לא הורג את ה-agent ב-BE → דליפת bridges

**קובץ:** `packages/frontend/src/lib/view-models/agent-session.svelte.ts:335`

```ts
#cleanup(): void {
  try { this.#client?.close() } catch { /* כבר סגור */ }
  this.#client = null
  this.#sessionId = null
  this.agentId = null
}
```

`#cleanup` סוגר רק את ה-WebSocket ומאפס שדות מקומיים. הוא **לא** קורא ל-
`deleteAgent(agentId)`. בצד ה-BE, `ws-agent.ts:121` **בכוונה** לא הורג את
ה-child בסגירת WS (`// חשוב: אל תקרא ל-child.kill()` — בגלל D23, bridges
שורדים נפילת FE).

**תוצאה:** כל `attach→detach`, וכל מסלול error (`attach` catch בשורה 137,
`loadSession` catch בשורה 244), משאיר child process חי ב-BE + רשומה ב-registry
בזיכרון — לנצח. דליפת processes שמצטברת לאורך זמן ריצה.

**סטטוס:** זה בדיוק מה ש-**slice 25 (bridge-leak-fix)** מתקן. ה-brief מאומת
(אביגיל READY סבב 2). גישה B: `#cleanup` שולח `void deleteAgent(agentId).catch(()=>{})`
לפני האיפוס, ב-3 המסלולים (detach / attach-catch / loadSession-catch).
**פעולה: ל-dispatch את slice 25.**

---

### B2 — `bridgePort` הוא תמיד `0` → dedup מת לחלוטין

**קבצים:**
- `packages/backend/src/acp/bridge-manager.ts:122` — `port: 0`
- `packages/backend/src/app/agent-orchestrator.ts:127,165-166`

ב-bridge-manager, מאז המעבר ל-pipe in-process (Phase 3), אין יותר פורט:

```ts
const handle: BridgeHandle = {
  ...
  port: 0, // in-process: ללא פורט. השדה נשמר לתאימות לאחור.
  wsUrl: "", // in-process: ללא כתובת WS.
}
```

לכן ב-orchestrator:

```ts
bridgePorts.set(agent.id, handle.port)   // = 0 תמיד
```

ובדיקת ה-dedup ב-`createAndSpawn`:

```ts
const duplicate = allAgents.find(a => ... a.status === "ready" || "busy")
if (duplicate?.bridgePort) {           // ← 0 הוא falsy → תמיד false
  // dedup — return existing agent   ← קוד מת, לעולם לא רץ
}
```

**תוצאה:** כל קריאת `loadSession` עם `existingSessionId` יוצרת bridge חדש
**למרות** שכבר קיים agent פעיל לאותו (cwd, sessionId). זה גם מחמיר את B1 —
כל duplicate שנוצר ולא נמחק הוא עוד דליפה.

**הערה נוספת:** `wsUrl` בתוצאת ה-dedup (שורה 133) בונה
`ws://127.0.0.1:${duplicate.bridgePort}/` = `ws://127.0.0.1:0/` — URL שבור,
לו ה-dedup היה רץ. כל מסלול ה-dedup מבוסס על שדה שאיבד משמעות במעבר ל-in-process.

**פעולה:** להחליף את תנאי ה-dedup. במודל in-process, הקריטריון הנכון הוא
"agent ready/busy עם אותו acpSessionId קיים ב-registry" — בלי שום תלות ב-port.
החזרת `wsUrl` המבוסס-port צריכה לרדת גם היא (ה-FE בונה את ה-WS URL בעצמו מ-
`location.host` — ראה `agent-session.svelte.ts:106-107`, ה-`wsUrl`/`bridgePort`
מ-`createAgent` כלל לא בשימוש ב-FE).

---

### B3 — `#waitForReady` polling ללא timeout → תקיעה אינסופית אפשרית

**קובץ:** `packages/frontend/src/lib/engines/audio-stream.ts:214-224`

```ts
#waitForReady(seg: AudioSegment): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (seg.state !== "loading") resolve()
      else setTimeout(check, 50)        // ← אין תקרה
    }
    check()
  })
}
```

ה-timeout של 5s ב-`prepareSegment` (שורה 64) מכסה **רק** את אירוע ה-`sourceopen`.
הוא **לא** מכסה את צריכת הזרם (ה-`while(true)` ב-97-118). אם ה-reader נתקע
(שרת TTS שלא סוגר את הזרם, רשת שתלויה אך לא נופלת), ה-segment נשאר במצב
`"loading"` ללא הגבלת זמן. אז:

1. `#waitForReady` עושה poll כל 50ms לנצח.
2. `Player.#playLoop` (`player.svelte.ts:77`) תלוי על `await this.#audioStream.play(id)`
   שלעולם לא יחזור.
3. ה-Player תקוע ב-`state="playing"`, התור לא מתקדם, אין יותר אודיו.

המשתמש יכול לחלץ רק דרך `stop()` ידני (cancel). אין self-healing.

**פעולה:** להוסיף תקרת-זמן ל-`#waitForReady` (למשל 30s — כמו timeout מקסימלי
לסגמנט TTS). בפסק-זמן: `seg.state = "cancelled"` → `play()` ידחה → ה-Player
ידלג (התנהגות MIN-5 הקיימת). תיקון קטן ומקומי.

---

## B. אנטי-דפוסים 🟠

### B4 / L2 — כפילות `attach` ↔ `loadSession` (מפר חוק זהב #5)

**קובץ:** `agent-session.svelte.ts` — `attach` (90-139) מול `loadSession` (191-246).

שתי המתודות מעתיקות מילה-במילה את אותו בלוק WS-setup:

| שלב | attach | loadSession |
|-----|--------|-------------|
| status="connecting" + reset | 94-97 | 199-202 |
| `createAgent` | 101-103 | 206-208 |
| בניית `proto` + `WsAcpTransport` | 106-107 | 211-212 |
| `transport.onClose(...)` (זהה מילה-במילה) | 108-117 | 213-219 |
| `waitForOpen` | 118 | 220 |
| `createAcpClient` | 121 | 223 |
| `notifySessionAttached` | 130 | 237 |

ההבדל היחיד: `newSession` מול `loadSession` + עטיפת `isLoadingHistory`.

זה **בדיוק** הדפוס שחוק זהב #5 (`frontend/AGENTS.md`) אוסר: "לא לתחזק שתי
גרסאות". וכבר יש drift: `loadSession` מקדים `loadSession failed:` להודעת
השגיאה (242), `attach` לא (135). כל תיקון עתידי ל-WS-setup חייב להיעשות
בשני מקומות, ומישהו ישכח.

**פעולה:** לחלץ `#openTransport(input): Promise<AcpClient>` פרטי שמרכז את כל
בלוק ה-setup המשותף. `attach`/`loadSession` נשארים שונים רק בקריאת
`newSession`/`loadSession`. INVASIVE קל (לא משנה state model) — slice קצר.

---

### B5 — auto-scroll מתעלם מגלילה ידנית

**קובץ:** `packages/frontend/src/lib/components/chat/ChatBubbles.svelte:21-36`

```ts
$effect(() => {
  // ...reads bubble count / seg count / last seg len...
  tick().then(() => {
    if (chatEl) chatEl.scrollTop = chatEl.scrollHeight   // force scroll
  })
})
```

ה-effect מבצע scroll-to-bottom בכל chunk חדש, **ללא תנאי**. אם המשתמש גלל
למעלה לקרוא הודעה ישנה בזמן שהסוכן עדיין מדבר (תרחיש שכיח ב-voice UI שבו
הטקסט זורם), הוא נזרק חזרה לתחתית בכל מקטע. UX מתסכל קלאסי.

מבנית ה-effect במקום **הנכון** (component שמחזיק את ה-DOM node, לפי חוק זהב #4)
— רק הלוגיקה חסרה.

**פעולה:** guard "stick-to-bottom": לשמור flag האם המשתמש קרוב לתחתית
(`scrollHeight - scrollTop - clientHeight < ~80px`) ולגלול רק אם כן. תיקון
מקומי ב-component.

---

## C. יעילות effects

### E1 — ה-`$effect` הענק ב-Speaker: O(n) על כל tick

**קובץ:** `packages/frontend/src/lib/view-models/speaker.svelte.ts:117-152`

ה-effect מוצדק ארכיטקטונית (3 מקורות, אין call-site יחיד — `design-principles §2.2`).
הבעיה היא **יעילות**, לא נכונות:

```ts
const _segCounts = bubbles
  .filter(b => b.kind === "message" || b.kind === "thought")
  .map(b => b.segments.length)            // O(n) על כל run
const _toolStatus = bubbles
  .filter(b => b.kind === "tool")
  .map(b => `${tc.toolCallId}:${tc.status}:${tc.narration ?? ""}`)  // O(n) + string alloc
```

שתי המחרוזות-מעקב נבנות **מחדש בכל הפעלת effect**, כלומר בכל chunk שמגיע. עם
שיחה ארוכה (100+ bubbles) זה מאות string allocations + שני סריקות מלאות לכל
מקטע נכנס. ב-voice UI שבו chunks מגיעים בתדירות גבוהה — מורגש.

בנוסף זה **שביר**: מי שמוסיף שדה ל-bubble שצריך לעורר re-run חייב לזכור
להוסיף אותו ידנית ל-`_toolStatus`/`_segCounts`. דפוס "tracking-by-stringification".

**פעולה (עתידי, לא דחוף):** לחשוף ב-`AgentSession` version-counter פשוט
(`mutationVersion = $state(0)`, מוגדל בכל push/replace) שה-Speaker יקרא כ-tracking
יחיד, ולעבד את ה-bubbles אינקרמנטלית (Speaker כבר מחזיק `#bubbleStates` עם
`processedSegments` — יש לו את כל מה שצריך לעבד רק את הדלתא). מסיר את שתי
המחרוזות לגמרי.

### E2 — `VoiceMode.isCancelling` race

**קובץ:** `packages/frontend/src/lib/view-models/derived/voice-mode.svelte.ts:40-64`

ה-`$derived` מעדיף `isCancelling` על כל שאר המקורות (שורה 41). ה-effect מאפס
אותו רק כשהכל נרגע. חלון race: `cancel()` נקראת → `isCancelling=true` → המשתמש
מתחיל הקלטה חדשה (`Mic.toggle()`) **לפני** שה-effect הריץ את האיפוס → ה-state
מציג `"cancelling"` בזמן ש-mic כבר `recording`.

לא קריטי (ה-effect יתקן בטיק הבא), אבל לפי הכלל של design-principles עצמו
(call-site ידוע → איפוס ישיר), `Mic.toggle()` שמתחיל הקלטה הוא call-site ידוע
שיכול לאפס `isCancelling=false` ישירות, במקום להישען על ה-effect.

**פעולה (אופציונלי):** איפוס ישיר ב-call-site שמתחיל פעולה חדשה. ה-effect
נשאר כ-safety net.

---

## D. לוגיקה שהתפזרה / מיקום שכבתי

### L1 — `AgentSession.status` נכתב ב-~12 אתרים

**קובץ:** `agent-session.svelte.ts` — שורות 94, 115, 132, 136, 144, 173, 177,
180, 199, 217, 239, 243.

**כבר מתועד** ב-`design-principles §3` עם פתרון מוצע (`#setStatus`). ה-review
מאשר: זה לא תיאורטי. **slice 6 (audio cues)** צריך לנגן cue על מעבר ל-`thinking`/
`error`. בלי `#setStatus`, slice 6 יצטרך לזרוע `cues.play()` ב-12 מקומות
מפוזרים. ה-refactor INVASIVE.

**המלצה תזמונית:** לבצע את `#setStatus` **לפני** slice 6 (כ-prep commit נפרד),
כי slice 6 בנוי עליו ישירות. ראה הערת ה-INVASIVE ב-design-principles §3.

### L3 — `#mapToolContent` / `#mapLocations`: parsing ב-VM

**קובץ:** `agent-session.svelte.ts:346-397`

שתי המתודות הן **parsing טהור** (צורת ACP `unknown[]` → `ToolContent[]`/
`ToolLocation[]`). הן לא נוגעות ב-`$state`, לא תלויות framework, לא browser.
לפי `design-principles §1.1` ("כל לוגיקה שמחליטה משהו — parsing — היא פונקציה
טהורה ב-core/") הן מועמדות טבעיות לרדת ל-`core/acp/`. בונוס: ניתנות ל-unit test
(כרגע נבדקות רק דרך ה-VM, אם בכלל).

**פעולה (low priority):** להעביר ל-`core/acp/map-tool-content.ts` + unit tests.

---

## E. Dead code / YAGNI 🟢

### D1 — `textHash` provenance: dead, אין צרכן

**קבצים:** `speaker.svelte.ts:320-329`, `audio-stream.ts:24-26,45,58-59`.

`#fetchJob` מחשב `textHash = await cacheKeyFor(...)` (שורה 321) ומעביר אותו
ל-`prepareSegment` כ-provenance. ב-`audio-stream.ts:24` ההערה עצמה מודה:
"provenance (metadata בלבד — **אין צרכן ב-slice זה**)". כלומר בכל מקטע TTS
מתבצעת קריאת hash אסינכרונית (`crypto.subtle.digest`) שתוצאתה נזרקת ל-שדה
שאף אחד לא קורא.

`cacheKeyFor` עצמה (`core/voice/cache-key.ts`) נבדקת ב-unit test אבל בקוד הריצה
משמשת **רק** למילוי ה-provenance המת הזה.

**פעולה:** להסיר את חישוב ה-`textHash` מ-`#fetchJob` (חוסך hash לכל מקטע) ואת
שדות ה-provenance מ-`AudioSegment`, עד ש-slice 10 (replay) באמת יזדקק להם.
לשמור את `cacheKeyFor` + הטסט ב-core (זול, מוכן לעתיד).

### D2 — `jumpToSegment` + ordering ל-seq=-1: scaffolding ל-slice 10

**קובץ:** `player.svelte.ts:45-50`. מקובל כ-scaffolding מתועד ("שמור עבור
slice 10"). לא דורש פעולה — רק מודעות שזה לא בשימוש כרגע.

---

## F. דברים שנבדקו ונמצאו תקינים ✓

לטובת איזון — אלה נבדקו וטובים:

- **`OrderAllocator` / `OrderedQueue`** (`core/voice/tts-queue.ts`) — pure, נקי,
  unit-testable, seq מונוטוני בין שיחות. עיצוב טוב.
- **`recentAssistantMessages`** (`agent-session.svelte.ts:254`) — עוצר מוקדם
  (`result.length < n`), לא סורק יותר מהנדרש.
- **`bridge-manager` crash handling** — רישום מאזינים מיידי לפני async tick,
  טיפול ב-ENOENT סינכרוני של Bun, stderr ring-buffer מוגבל (200 שורות). יסודי.
- **`createClientImpl`** (`core/acp/client-impl.ts`) — pure, auto-permission
  policy ברורה, תיעוד טוב על מה שלא מוצהר (fs caps).
- **`ws-to-streams`** — התיעוד על "אל תוסיף \n למסגרת חלקית" מציל מ-bug אמיתי
  שכבר נתקלנו בו (gotcha NDJSON). מתועד היטב.
- **functional-core / imperative-shell** — ההפרדה core/backend/frontend נשמרת.
  אין browser globals ב-core, אין adapters ב-core.

---

## H. סבב 2 — BE delivery + filesystem

### H1 🔴 — Read-modify-write race ב-registries → איבוד פרויקט/הקלטה
**קבצים:** `projects-registry.ts:45-68`, `recordings-store.ts:71-86`, `http-agents.ts:124-130`

שני המאגרים עובדים בתבנית `load() → mutate → persist()` על קובץ JSON שלם **ללא
נעילה**. ה-instances הם singletons משותפים (`server.ts:56-57`) וה-handlers async.

**תרחיש תום-לב:**
- `http-agents.ts:124-130` מבצע אחרי attach **שני** מחזורי load-persist רצופים
  (`recordCwd` ואז `recordSession`). שני agents שעושים attach כמעט-במקביל (פתיחת
  שני פרויקטים — תרחיש רגיל) → שתי קריאות `load()` רואות אותו state, שתי הכתיבות
  דורסות זו את זו → **פרויקט אחד נעלם מהרשימה**.
- `recordings-store`: שתי הקלטות שנשמרות במקביל (FE מעלה אודיו ברקע במקביל ל-STT)
  → `index.json` של אחת דורס את השנייה → **הקלטה "נעלמת" אף שהקובץ הבינארי על הדיסק**.

**פעולה:** סריאליזציה של כתיבות per-store (promise-chain/mutex), או כתיבה אטומית
(`write tmp + rename`). לכל הפחות לאחד `recordCwd`+`recordSession` למחזור יחיד
(`recordCwdAndSession`).

### H2 🟠 — `/api/options` sync IO חוסם את ה-event loop
**קובץ:** `http-options.ts:29-67,69-96,99`

ה-handler סינכרוני לחלוטין: `execFileSync("opencode", ["models"], {timeout:5000})`
חוסם את **כל** ה-event loop עד 5s, ו-`listProjectDirs` עושה `readdirSync`+`statSync`
על `~`, `~/projects`, `/tmp`. בזמן שמשתמש פותח "agent חדש", אם `opencode models`
איטי/תקוע — כל הבקשות (TTS, WS heartbeat, health) **קופאות עד 5s**.

**פעולה:** להמיר ל-async (`execFile` promisified, `fs/promises`).

### H3 🟠 — proxy cache משותף בין כל המשתמשים, ללא TTL/ניקוי
**קבצים:** `proxy-cache.ts:45-54`, `http-proxy.ts:79-91`

מפתח = `sha256(method|path|body)` בלבד, ללא הפרדת משתמש/agent, persistent על דיסק
לנצח. עבור TTS עם אותו טקסט+voiceId זה רצוי (hit לגיטימי). הסיכון: (א) אין ניקוי
→ דיסק גדל ללא גבול, (ב) אין TTL → תוכן ישן מוגש אחרי שינוי לוגיקה ב-FE שלא משתקף
ב-body. **slice 24 (client-keyed) מטפל בחלק** — אבל לא מוזג. עד אז אין הפרדה.

**פעולה:** להאיץ merge של slice 24 + להוסיף TTL/ניקוי. (תלוי B-gate — slice 24
כבר READY אצל אביגיל.)

### H4 🟠 — cache stream write בלי timeout → leak + miss שקט
**קובץ:** `http-proxy.ts:136-148,161-189`

`cacheStreamInBackground` צובר את **כל** ה-body ל-memory (buffering מלא לכל miss
של TTS ארוך). אם ה-reader נתקע (upstream איטי) — ה-promise תלוי לנצח בלי timeout,
ה-reader לא משוחרר. ה-`catch` (186) **בולע בשקט** תגובה חלקית → לא נשמר ב-cache,
**בלי לוג**, אז המשתמש משלם שוב ושוב על אותו אודיו בלי אינדיקציה.

**פעולה:** timeout ל-reader + `reader.cancel()` ב-finally + לוג על תגובה חלקית.

### H5 🟡 — rate-limit map דולף + bucket "anon" משותף
**קובץ:** `http-client-log.ts:34,51`

`ipBuckets` Map צובר entry לכל IP לנצח (אין מחיקה אחרי `resetAt`). כל הבקשות בלי
`x-forwarded-for` → bucket יחיד `"anon"` שמשתמש אחד יכול למצות ולחסום לוגים לכולם.
single-user → 🟡, אבל design שגוי.

**נבדק ותקין ב-BE:** path-traversal ב-`recordings/:id` (id חייב key מוכר),
fs/browse traversal (trailing-slash guard מגן מ-sibling `/home/user-files`),
`wire-decode` zero-throw, `cors-config` ולידציה, `createDiskCache` concurrency של
mkdir (shared init promise), proxy header sanitization (content-encoding/length →
מונע ERR_CONTENT_DECODING), `session-attached` idempotency (409).

---

## I. סבב 2 — FE components + adapters

### F1 🔴 — "נשמר" ב-settings תקוע לנצח
**קובץ:** `routes/settings/+page.svelte:23`

```js
let showSaved = $derived(savedAt !== undefined && Date.now() - savedAt < 3000)
```

`$derived` מחושב מחדש רק כש-dependency **reactive** משתנה. `Date.now()` לא reactive
→ ה-derived מחושב פעם אחת כש-`savedAt` משתנה ואז לעולם לא מתעדכן. אין timer שמפעיל
reevaluation. **התוצאה:** ההודעה "נשמר" מופיעה ו**נשארת לצמיתות** — ה-timeout של
3000ms שתוכנן לא קיים בפועל.

**פעולה:** `$effect` עם `setTimeout` שמאפס `savedAt` (cleanup ב-return), ו-
`showSaved = $derived(savedAt !== undefined)`.

### F2 🟠 — החלפת מודל כושלת בשקט → UI שקרי
**קבצים:** `AgentOptionsPanel.svelte:56-74`, `agent-session.svelte.ts:279-311`

ה-handlers קוראים `await session.applyConfigOption(...)`. המתודה עושה
`await this.#client.setSessionConfigOption(...)` **ללא try/catch** — כשל רשת/ACP
זורק. ה-`<select>` כבר מציג את הערך החדש (הדפדפן עדכן DOM), אבל ה-state האמיתי
בצד ה-agent לא השתנה → unhandled rejection + המשתמש חושב שהחליף מודל. אין error
state ב-panel כלל.

**פעולה:** `applyConfigOption` תופס ומחזיר Result/מציב error, או ה-panel עוטף
ב-try/catch + מחזיר את ה-`<select>` לערך הקודם.

### F3 🟠 — transcribe בלי timeout → mic תקוע ב-`transcribing` לנצח
**קובץ:** `adapters/voice/transcribe.ts:47-57`

(א) אין timeout עצמאי (בניגוד ל-`translate.ts` שיש לו 2500ms+AbortController). אם
ה-Gemini תלוי → `await generateContent` נתקע. (ב) ה-`abortSignal` מועבר דרך cast
`as Record<string, unknown>` עם הערה "אם נתמך" — לא ידוע אם הביטול בכלל מחובר.
**התוצאה:** STT נתקע → mic נשאר `transcribing` (disabled ב-MicButton) **לנצח**,
אין escape. זה חוסם את ה-use-case המרכזי של הפרודקט.

**פעולה:** timeout+AbortController כמו `translate.ts`. לוודא ב-Mic VM catch שמחזיר
ל-idle. **`translate.ts` הוא התקן שכל שאר ה-adapters צריכים לעמוד בו.**

### F4 🟠 — `getAgent` בולע גוף השגיאה
**קובץ:** `adapters/agents-api.ts:41-43` — זורק רק `${res.status}`, בניגוד ל-
`createAgent`/`deleteAgent` שקוראים `res.text()`. גוף השגיאה (סיבה אמיתית כמו
"process died") נזרק. **פעולה:** ליישר לדפוס הקובץ.

### F7 🟡 — אין timeout ב-`voices`/`tts` → picker תקוע ב-loading
**קבצים:** `voices.ts:31`, `tts.ts:24`. `loadVoices()` נקראת ללא signal; BE תלוי →
`<select>` תקוע ב-disabled "טוען..." (יש fallback ל-voiceId נוכחי כ-option יחיד).
**פעולה:** timeout ב-`loadVoices` (ב-VM).

### F9 🟡 — thought segments נעלמים בזמן streaming
**קובץ:** `bubbles/bubble-rendering.ts:7-9`

```js
const translated = segments.filter(seg => seg.originalText !== undefined)
return translated.length > 0 ? translated : segments
```

ברגע ש-segment **אחד** תורגם, כל הלא-מתורגמים נעלמים מהתצוגה. בזמן streaming של
מחשבות (תרגום מגיע per-segment אסינכרונית) → תוכן "מהבהב"/נעלם חלקית.
**פעולה:** לרנדר תמיד את כל ה-segments, ולכל אחד fallback ל-text המקורי (ה-markup
כבר עושה `{#if seg.originalText}`) — להסיר את הסינון.

**נבדק ותקין ב-FE:** `translate.ts` (תקן-הזהב), `markdown.ts` sanitization,
`be-url.ts`, `VoicePicker` effect (לא לולאה), `Settings.loadVoices` idempotency,
דפוס `<span class="hidden">` לכפיית reactivity על push, **אף component לא יוצר VM
ולא עושה fetch ישיר — חוק זהב #3/#4 נשמרים**, `AgentOptionsPanel` auto-open guard
(לא לולאה), `base64.ts` (8192 args בטוח). F5 (`notifySessionAttached` semantics
עמומים) — 🟡 minor.

---

## J. סבב 2 — איכות הטסטים

> **הלקח של slice 9 (114 ירוקים, 19 באגים) חי.** התמונה דו-קוטבית: core מכוסה
> מצוין, ה-shell הקולי חשוף כמעט לחלוטין.

### T1 🔴 — הצינור הקולי כולו: 0 טסטים
**Speaker (492 שורות), AgentSession, Mic, VoiceMode, Player, AudioStream, Recorder,
ws-to-streams, ws-transport, connect-agent — אפס טסטים.** זה לב הפרודקט (צינור הקול)
ובדיוק היכן ש-19 הבאגים הקודמים ישבו. נתיבים race-prone לא-מכוסים: `#processBubbles`
toggle-בזמן-stream, `#handleStatusTransition` flush race, narration שמחזיר null אבל
ה-id כבר ב-`#processedNarrationCallIds` (retry לא יקרה), `#persistThoughtTranslation`
silent-drop.

**פעולה (ROI יורד):** (1) **Speaker test** — ההשקעה הכי משתלמת, 3 תלויות מוזרקות
= בר-בדיקה. (2) **Mic FSM** — קל, תלות אחת, 4 ענפי שגיאה.

### T2 🔴 — dedup: הטסט היחיד skipped וגם שבור
`agent-orchestrator.test.ts` — אין ולו טסט אחד שקורא `createAndSpawn` עם
`existingSessionId` (כל הנתיב 116-139 לא נורה). `agent-orchestrator-history.test.ts:151`
— כל ה-`describe` של dedup הוא **`describe.skip`**, ואפילו אילו רץ, טסט ה-dedup-hit
(202-223) בונה agent ללא `bridgePort` כך ש-`expect(spawnSpy).not.toHaveBeenCalled()`
היה **נכשל**. הטסט גם skipped וגם לא-תקף. **פעולה:** טסט dedup לא-skipped עם agent
שמחזיק `bridgePort: 0` — ייכשל היום = TDD לתיקון B2.

### T3 🟠 — assertions חלשות "מאשרות" את B1/B2 בירוק
`bridge-manager.test.ts:73-74` — `expect(handle.port).toBeDefined()`: `0` עומד ב-
`toBeDefined` → עובר תמיד, מסתיר ש-port=0 שובר dedup. `ws-agent-pipe.test.ts:165-182`
בודק "child לא נהרג" אבל לא "listeners מנותקים" (דליפת B1 היא בדיוק על cleanup).
**פעולה:** `expect(port).toBe(0)` + הערה מקשרת ל-orchestrator;
`child.stdout.listenerCount('data')===0` אחרי FE-close.

### ממצאי-לוואי מהסבב
- **T4 🟠** `http-proxy` handler (live) — 0 טסטי אינטגרציה. כל ה-sanitization+tee
  לא נבדק. singleton `_cache` module-global לא מאופס בין tests.
- **T5 🟠** `bridge-manager.kill` SIGKILL-after-5s לא נבדק (mock תמיד פולט exit מיד
  → `setTimeout` עלול לדלוף).
- **T6 🟠** `disk-cache` — אין טסט negative ל-key עם `/`/`..`. כיום keys=sha256
  (בטוח), אבל **slice 24 מכניס `narrate:<toolCallId>` ו-`x-cache-key` מהלקוח** →
  path-traversal פוטנציאלי. טסט `cache.set("../escape")` ייכשל היום = חושף צורך
  ב-sanitization **לפני** merge של slice 24. ⚠️ רלוונטי ל-gate של slice 24.
- **T7 🟡** טאוטולוגיה `sentence-boundary.test.ts:92` (`x === 1 ? a : a`), dead code.

**מכוסה היטב באמת (TDD חזק):** sentence-boundary (streaming-equivalence, regression),
tts-queue (parallel-reorder, signed-compare), cache-key, provider-error
(characterization מצוין), bridge-failure-modes (integration עם BE אמיתי+PATH מנוקה),
Settings VM, disk-cache happy-path, ws-agent-pipe (NDJSON delimiter).

---

## K. סיכום פעולות לפי תזמון (מאוחד)

**קריטי — איבוד נתונים / חסימת use-case מרכזי:**
1. **H1** — race ב-registries (איבוד פרויקט/הקלטה). slice קצר. עדיפות עליונה.
2. **F3** — timeout ב-transcribe (mic תקוע = חסימה מוחלטת). slice קצר.
3. **F1** — fix ל-"נשמר" התקוע (כמעט חד-שורתי).

**קריטי — יש brief / תשתית:**
4. **B1** — ל-dispatch slice 25 (bridge-leak). מחכה.
5. **B2** — תיקון תנאי dedup. ל-bundle עם **T2** (טסט שייכשל קודם = TDD).
6. **B3** — timeout ב-`#waitForReady`. ל-bundle עם טסט (**T1**-מתחיל).

**לפני slices תלויים:**
7. **L1** — `#setStatus` refactor (INVASIVE). slice 6 תלוי בו.
8. **T6** — sanitization של cache key + טסט negative. **לפני merge slice 24.**

**איכות / יציבות (אפשר לאגד ל-slice "review fixes"):**
9. **H2** — async IO ב-`/api/options`.
10. **H4** — timeout ב-cache stream write.
11. **F2** — error handling בהחלפת מודל.
12. **F4/F7/F9** — timeout/error fixes ב-adapters+rendering.
13. **B4** — חילוץ `#openTransport`. · **B5** — guard auto-scroll. · **D1** — הסרת textHash.

**השקעת-בדיקות (ROI גבוה, מונע slice-9 חוזר):**
14. **T1** — טסטי Speaker + Mic (לב הפרודקט, 0 כיסוי).
15. **T3/T4/T5** — חיזוק assertions + טסטי אינטגרציה ל-proxy/kill.

**עתידי:**
16. **E1** — version-counter ל-Speaker. · **E2** — `isCancelling` ב-call-site.
    · **L3** — `#mapToolContent` ל-core.
