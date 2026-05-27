# Frontend Reorganization Plan

> ‏טיוטה — 2026-05-18.
> ‏מסמך-עבודה לסידור מחדש של `packages/frontend/`. הראוטים יידונו בנפרד אחרי שהארכיטקטורה תהיה סגורה.

---

## 1. מטרות

1. ‏לפתור את ההצמדה בין Routes ל-business logic (כיום `routes/agent/[id]/+page.svelte` הוא 989 שורות).
2. ‏לפתור את ה-anti-pattern של יצירת stores מחדש ב-`$effect` בעת שינוי `agentId`.
3. ‏להחליף את ה-factory closures ב-Svelte 5 classes כדי לאפשר:
   - ‏instance יציב + `attach/detach` במקום הריסה ובנייה.
   - ‏Context API ‎להפצה במקום DI ידנית דרך props.
   - ‏Devtools-friendly debugging.
4. ‏להפריד שלוש שכבות עם חוקי import ברורים (view-models / engines / adapters).
5. ‏לאחד 4 מנגנוני localStorage עצמאיים ל-engine אחד.
6. ‏להוציא לוגיקה טהורה ל-`core/` כדי שתהיה משותפת עם backend.
7. ‏לתכנן מראש את ה-feature "גיבוי הקלטות + replay של שיחה מלאה" כך שייכנס לארכיטקטורה בלי לשבור אותה.

‏המטרה **לא** היא rewrite — זה refactor מובנה, בשלבים, עם tests ירוקים בכל commit.

---

## 2. המודל המנטלי

> ‏**האפליקציה היא מתורגמנית שלה שלושה אברים (אוזן, שיחה, פה) ולוח תצוגה. המשתמשת מדברת אל האוזן, השיחה מתווכת בטקסט אל הסוכן, התשובה של הסוכן מתפצלת בין הפה שמקריא ללוח שמציג — שניהם בו-זמנית.**

```
                                                    ┌──► UI bubbles (visual)
User ──🎙──► Mic ──text──► AgentSession ──chunks──┤
                                ▲                   └──► Speaker ──🔊──► User
                                │
                                └── Agent (ACP)
```

| תפקיד | View Model | ‏מה הוא עושה |
|--------|-----------|----------------|
| 👂 ‏אוזן | `Mic` | ‏מקליטה את המשתמשת, ‏ממירה לטקסט, ‏מעבירה ל-AgentSession |
| 💬 ‏שיחה | `AgentSession` | ‏ה-hub. מנהלת WS עם הסוכן, ‏מצברת bubbles, ‏מפצלת chunks |
| 🗣 ‏פה | `Speaker` | ‏מקבל chunks מ-AgentSession, ‏מתרגם/מתאר, ‏מסנתז TTS, ‏משמיע |
| 🎚 ‏לוח שעון | `VoiceMode` (derived) | ‏מסכם את שלושת ה-pipelines ל-state אחד שכפתור המיקרופון צריך |

‏האסימטריה (שיחה=class אחד, ‎mic+speaker=שני classes) נובעת מה-modality: ‏הסוכן מדבר טקסט בשני כיוונים, ‏המשתמשת משתמשת בשני engines שונים (MediaRecorder ל-in, ‎MediaSource ל-out).

---

## 3. ארכיטקטורה — ‏חמש שכבות

```
┌──────────────────────────────────────────────────┐
│ Components (.svelte) ── VIEW                     │
│   קוראים get*() ‏מ-context. dumb.                │
└──────────────────┬───────────────────────────────┘
                   │ reactive read
                   ▼
┌──────────────────────────────────────────────────┐
│ view-models/ — ‏Reactive UI Logic                 │
│   .svelte.ts classes עם $state + $derived         │
│   primary (שורש) ‏או derived/                       │
└──────────────────┬───────────────────────────────┘
                   │ method call + event subscribe
                   ▼
┌──────────────────────────────────────────────────┐
│ actions/ — ‏Cross-layer procedures                │
│   ‏לדוגמה: ‏recoverAgent (טעינת cache → POST →    │
│   goto + notification). ‏מותר לייבא VMs+adapters. │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│ engines/ — ‏Imperative Resource Owners            │
│   .ts classes ‏בלי $state. ‏מחזיקים WS, audio, mic │
└──────────────────┬───────────────────────────────┘
                   │ network / browser APIs
                   ▼
┌──────────────────────────────────────────────────┐
│ adapters/ + util/ + core/                        │
│   adapters — I/O, ‏Promises. ‏ללא state.           │
│   util — DOM helpers (cues, scroll math).        │
│   core/ — ‏לוגיקת דומיין טהורה (משותפת עם BE).      │
└──────────────────────────────────────────────────┘
```

### חוקי import (חד-כיווניים)

| משכבה | מותר לייבא מ | אסור לייבא מ |
|---------|----------------|------------------|
| `routes/` | view-models, actions, components, util | engines, adapters ‏(ישירות) |
| `components/` | view-models (דרך context), util | engines, adapters, actions |
| `actions/` | view-models, adapters, engines, util, core, ‏SvelteKit navigation, notifications | components |
| `view-models/` | engines, adapters, util, core | components, routes, actions |
| `view-models/derived/` | view-models (primary בלבד), core | engines, adapters, actions |
| `engines/` | adapters, util, core | view-models, components, actions |
| `adapters/` | core | view-models, engines, components, actions |
| `util/` | core | ‏שום דבר אחר |
| `core/` | — | ‏שום דבר ב-frontend |

‏הפרת חוק = ‏הקוד פשוט לא יקומפל (TypeScript) או יישבר בbuild. ‏זה ההגנה היחידה שתעמוד בלחץ של פיתוח מהיר.

### ‏למה ‎`actions/` ‎נפרד?

‏יש פעולות שחוצות שכבות במהותן: ‏`recoverAgent` ‎צריך לקרוא view-model (`notifications`), ‏לקרוא adapter (`createAgent`), ‏ולנווט (`goto`). ‏אם נדחוף אותו ל-VM — ‎ה-VM יידע על navigation; ‏אם לadapter — ‎הוא יידע על VMs. ‏שתי הפרות. ‏`actions/` ‎הוא הקטגוריה הלגיטימית לprocedures כאלה. ‏Route מותר לייבא ‏ולקרוא action ישירות.

---

## 4. View Models — ‏המלאי המלא

### Primary (שורש `lib/view-models/`)

| Class | קובץ | $state | תלוי ב |
|--------|------|----------|----------|
| `AgentSession` | `agent-session.svelte.ts` | bubbles, status, error, agentId, currentSessionId | — |
| `Mic` | `mic.svelte.ts` | state, sttText, error | AgentSession |
| `Speaker` | `speaker.svelte.ts` | isPlaying, currentSegmentId, error | AgentSession, Player |
| `Player` | `player.svelte.ts` | playlist, currentIndex | — |
| `Settings` | `settings.svelte.ts` | voiceId, audioCues | — |
| `CarMode` | `car-mode.svelte.ts` | isActive, playbackState | Mic |
| `ProjectsRegistry` | `projects.svelte.ts` | projects, isLoading, error | — |
| `Notifications` | `notifications.svelte.ts` | items | — |
| `FsBrowser` | `fs-browser.svelte.ts` | currentPath, entries, history, loading, error | — |
| `Voices` | `voices.svelte.ts` | voices: VoiceInfo[], isLoading, error | — |
| `SidebarUI`, `SheetUI`, `Device` | `ui-state.svelte.ts` | (קטנים) | — |

### Derived (`lib/view-models/derived/`)

| Class | קובץ | $derived | תלוי ב |
|--------|------|------------|----------|
| `VoiceMode` | `voice-mode.svelte.ts` | ‏state: ‎`idle\|recording\|transcribing\|thinking\|speaking` | Mic, AgentSession, Speaker |

### חוקים ל-derived

1. ‏**אין** `$state` ‏משל עצמו. ‏בכלל.
2. ‏רק `$derived` ‏ו-getters.
3. ‏ללא methods עם side effects.
4. ‏תלוי **רק** ב-view-models primary.
5. ‏נוצר אחרון ב-`+layout.svelte`.

### `AgentSession` — ‏API ציבורי חדש

‏מעבר ל-`attach/detach/sendPrompt/cancel` ‎הקיימים, ‏מתווסף:

```ts
class AgentSession {
  // ‏... ‏שדות $state

  /** ‏‏טוען session ישן ב-agent הנוכחי. ‏אם CLI לא תומך (-32601), ‏נופל ל-newSession. */
  loadSession(sid: string): Promise<void>

  /** ‏גם newSession ציבורי — ‏לכפתור "סשן חדש" ב-/sessions */
  newSession(): Promise<void>
}
```

‏שתי השיטות מבצעות פנימית את אותו flow שהיום קיים רק ב-`connect()` ‎בתנאי. ‏הצורך עולה מ-`/sessions` ‎שמאפשר ‏החלפת session **בלי restart של agent** (אם CLI תומך).

### ‏שני patterns של singletons היום — ‏אחד אחרי המעבר

‏הקוד הקיים מערבב שני סוגי singletons:

| Pattern | ‏קבצים | ‏המעבר |
|----------|---------|---------|
| **Factory** ‎(`createX()`) | agent-session, voice-session, player, car-mode, projects, fs-browser | `createX()` → `new X()` |
| **Module-level** ‎(`export const x`) | settings, notifications, sidebar-state, sheet-state, device | `import { x }` → ‎`getX()` ‎דרך context |

‏שניהם הופכים ל-class + context. ‏שינוי קונסומרים ב-module-level יותר רחב: ‏כל ‎`import { settingsStore }` ‎הופך ל-`const settings = getSettings()`. ‏בכל ‎`<script>` ‎של component.

---

## 5. Engines — ‏המלאי המלא

| Class | קובץ | משאב | API |
|--------|------|--------|-----|
| `AcpClient` | `engines/acp/client.ts` | WebSocket + JSON-RPC | createAcpClient(), close() |
| (impl) | `engines/acp/client-impl.ts` | — (עוזר ל-AcpClient) | — |
| (glue) | `engines/acp/ws-to-streams.ts` | — (WS↔stream) | — |
| `Recorder` | `engines/recorder.ts` | MediaRecorder | start(), stop(), abort() |
| `AudioStream` | `engines/audio-stream.ts` | MediaSource | prepareSegment(), play(), on() |
| `WebStorageSync` | `engines/web-storage-sync.ts` | localStorage **+ sessionStorage** | get<T>(), set<T>(), remove() |

‏ה-engines **לא** מייצאים `$state`. ‏הם מייצאים methods + event subscriptions. ‏ה-view-models מתרגמות את האירועים שלהם ל-`$state` mutations.

### ‏‎הערה: 5 storage systems → 1

| ‏‎קובץ ישן | ‏‎sub-system |
|------------|---------------|
| `stores/agent-storage.ts` | localStorage — agent metadata |
| `stores/playback-storage.ts` | localStorage — playback position |
| `stores/sessions-cache.ts` | localStorage — sessions list cache |
| `stores/settings-store.svelte.ts` | localStorage — settings |
| `stores/sidebar-state.svelte.ts` | **sessionStorage** — sidebar collapse |

‏‎לכן ‎`WebStorageSync` ‎(לא ‎`LocalStorageSync`) ‎— ‏‎שני סוגי storage ב-API אחד עם flag.

---

## 5b. Actions — ‏‎procedures חוצי-שכבות

| Action | קובץ | ‏‎תפקיד |
|---------|------|---------|
| `recoverAgent` | `actions/recover-agent.ts` | ‏‎טעינת cache → POST /api/agents → goto + notification |
| `connectAgent` | `actions/connect-agent.ts` | ‏‎/ flow: createAgent → session.attach → goto /sessions |
| `pickSession` | `actions/pick-session.ts` | ‏‎/sessions flow: session.loadSession ‏‎(או newSession) ‎→ goto /chat |
| `cancelAndReset` | `actions/cancel-and-reset.ts` | ‏‎mic.cancel + speaker.cancelAll + session.cancel (‏‎3 ‎קריאות מתואמות) |

‏‎Actions הם פונקציות (לא classes) — ‏‎אין להן state. ‏‎הן מקבלות את ה-deps כפרמטר או דרך context באמצעות helper.

‏‎פעולת ‎`recoverAgent` ‎שבטעות סווגה כ-adapter בגרסה הקודמת של המסמך — ‏‎מועברת לכאן. ‏‎היא מערבת ‎`goto()` (SvelteKit), `notifications.push()` (view-model), `createAgent()` (adapter), `loadAgentMetadata()` (engine). ‏‎אדפטרים אסור להם לעשות את הצירוף הזה.

---

## 6. Adapters — ‏המלאי המלא

```
lib/adapters/
├── agents-api.ts                   # REST /api/agents
├── sessions-api.ts                 # REST /api/projects, /api/sessions
├── sessions-list-via-acp.ts        # מורכב — יוצר ACP client זמני (היה sessions-ws.ts)
├── recordings.ts                   # ‏הרחבה: saveRecording, getRecording, listRecordings (‏‎ראה §13)
├── options.ts                      # ⭐ ‏‎חדש — GET /api/options (cli list + projects + models)
├── sdks.ts                         # ‏singleton SDK instances (Google AI + GenAI)
└── voice/
    ├── transcribe.ts               # POST /api/stt
    ├── synthesize.ts               # POST /api/tts (streaming)
    ├── translate.ts                # text(en) → text(he)
    ├── describe-tool.ts            # ACP toolCall → prose
    └── voices.ts                   # ⭐ GET https://api.elevenlabs.io/v1/voices ‏‎(דרך OneCLI gateway)
```

‏כל adapter:
- ‏מקבל primitives.
- ‏מחזיר Promise/AsyncIterable.
- ‏אין state.
- ‏אם נכשל — זורק. ‏לא מטפל ב-UI feedback.

**‏‎ה-`agent-recovery` ‎לא כאן** ‎— ‏‎הוא ב-`actions/` ‎(§5b), ‎לא ב-adapters.

### ‏‎דרישה: OneCLI agent עדכון

‏‎ה-`adapters/voice/voices.ts` ‎יקרא ל-`api.elevenlabs.io/v1/voices`. ‏‎צריך לוודא ש-OneCLI agent ‎`voice-acp` ‎מוגדר ל-inject ‎`xi-api-key` ‎על כל ‎`api.elevenlabs.io/*` ‎(לא רק על /v1/text-to-speech). ‏‎פרט ניהולי לפני שלב 0.

---

## 7. Util — ‏המלאי המלא

```
lib/util/
├── cues.ts              # Web Audio cues (recording start/stop, thinking, error)
├── scroll-derive.ts     # deriveScrollState(scrollHeight, scrollTop, ...)
├── use-wake-lock.svelte.ts  # composable
└── log.ts               # createLogger (אם לא עובר ל-core)
```

‏**נמחקים:**
- ‏`mic-state-derive` ‏— מוחלף ע"י `VoiceMode.state`.

---

## 8. ‏מה עובר ל-`core/`

| מ-frontend | אל core/ |
|-------------|------------|
| `voice/base64.ts` | `core/util/base64.ts` |
| `voice/translate-cache.ts` | `core/voice/translate-cache.ts` |
| לוגיקת bubble accumulation (חולץ מ-`AgentSession`) | `core/voice/bubble-accumulator.ts` |
| לוגיקת queue/lookahead (חולץ מ-`Speaker`) | `core/voice/queue-policy.ts` |
| סכמות AgentMetadata (מ-`agent-storage`) | `core/schemas/agent-metadata.ts` |
| סכמות PlaybackState | `core/schemas/playback-state.ts` |
| סכמות SessionsCache | `core/schemas/sessions-cache.ts` |
| `type SessionInfo` ‏(מ-`sessions-ws.ts`) | `core/schemas/session-info.ts` |
| `type VoiceInfo` ‏(חדש) | `core/schemas/voice-info.ts` |

**‏‎למה SessionInfo עובר:** ‎ה-`engines/web-storage-sync.ts` ‎צריך לדעת את הסוג כדי לתת cache typed. ‏‎אם הוא נשאר ב-adapter, ‎ה-engine יידרש לייבא מ-adapter — ‏‎חיבור הפוך לחוקים. ‏‎ההעלאה לcore פותרת.

### ‏‎מגבלת `cwdToHash` ‎הקיים

‏‎`packages/core/src/cwd-hash.ts` ‎מקבל ‎`cwd` ‎בלבד, ‎לא ‎`(cwd, cliKind)`. ‏‎אם בעתיד נצטרך להבחין בין ‎"`X` ‎עם ‎opencode" ‎ל-"`X` ‎עם ‎claude" ‎(תלוי בהחלטה ‎שאותה תיקייה יכולה לארח ‎כמה ‎CLIs בו-זמנית), ‏‎נצטרך:
- ‏‎להוסיף ‎`cwdToHash(cwd, cliKind)` ‎גרסה דו-ארגומנט. ‏‎או
- ‏‎להגדיר מפורש: ‎"project ‎= cwd ‎בלבד", ‎ולא לתמוך multi-CLI per directory.

‏‎בתוכנית הנוכחית — ‏‎ההנחה היא project ‎= cwd. ‏‎לתעד שינוי אם נדרש.

‏הסיבה: ‏כל זה לוגיקה דטרמיניסטית בלי DOM/Network. ‏BE יכול לרצות לרוץ עליה (למשל אם נרצה לבצע bubble grouping ב-server-side replay).

---

## 9. Composition Root — `+layout.svelte`

‏היום: 16 שורות ריקות. ‏אחרי המעבר:

```svelte
<script lang="ts">
  import "../app.css"
  import { onMount } from "svelte"
  import {
    AgentSession, Mic, Speaker, Player, Settings, CarMode,
    Projects, Notifications, FsBrowser, Dashboard,
    SidebarUI, SheetUI, Device,
  } from "$lib/view-models"
  import { VoiceMode } from "$lib/view-models/derived/voice-mode.svelte"
  import { setSession, setMic, setSpeaker, setPlayer, setSettings,
    setCarMode, setProjects, setNotifications, setFsBrowser,
    setDashboard, setSidebarUI, setSheetUI, setDevice, setVoiceMode,
  } from "$lib/context"

  let { children } = $props()

  // ── App-level singletons ────────────────────────────────────────
  const settings      = new Settings()       // localStorage sync ב-constructor
  const notifications = new Notifications()
  const projects      = new Projects()
  const fsBrowser     = new FsBrowser()
  const dashboard     = new Dashboard()
  const sidebarUI     = new SidebarUI()
  const sheetUI       = new SheetUI()
  const device        = new Device()         // window.matchMedia בguard

  // ── Per-agent (but lifecycle managed via attach/detach) ─────────
  const session  = new AgentSession()
  const player   = new Player()
  const mic      = new Mic({ session })
  const speaker  = new Speaker({ session, player, settings })
  const carMode  = new CarMode({ mic })
  const voiceMode = new VoiceMode({ mic, session, speaker })

  // ── Register all in context ─────────────────────────────────────
  setSession(session); setMic(mic); setSpeaker(speaker); setPlayer(player)
  setSettings(settings); setCarMode(carMode); setProjects(projects)
  setNotifications(notifications); setFsBrowser(fsBrowser); setDashboard(dashboard)
  setSidebarUI(sidebarUI); setSheetUI(sheetUI); setDevice(device)
  setVoiceMode(voiceMode)

  onMount(() => {
    if (typeof lucide !== "undefined") lucide.createIcons()
  })
</script>

{@render children?.()}
```

‏~‎50 שורות. ‏זה כל ה-wiring של האפליקציה. ‏כל route מתחתיו רק `getContext()`.

---

## 10. ‏מיפוי קבצים — ‏מ⤳אל

### View Models

| ישן | חדש |
|-------|-------|
| `stores/agent-session.svelte.ts` | `view-models/agent-session.svelte.ts` |
| `stores/voice-session.svelte.ts` (חלק קלט) | `view-models/mic.svelte.ts` |
| `voice/orchestrator.ts` | `view-models/speaker.svelte.ts` |
| `stores/player.svelte.ts` | `view-models/player.svelte.ts` |
| `stores/settings-store.svelte.ts` | `view-models/settings.svelte.ts` |
| `stores/car-mode.svelte.ts` | `view-models/car-mode.svelte.ts` |
| `stores/projects-store.svelte.ts` | `view-models/projects.svelte.ts` |
| `stores/notifications-store.svelte.ts` | `view-models/notifications.svelte.ts` |
| `stores/fs-browser-store.svelte.ts` | `view-models/fs-browser.svelte.ts` |
| `stores/sidebar-state` + `sheet-state` + `device` | `view-models/ui-state.svelte.ts` (איחוד) |
| **חדש** | `view-models/voices.svelte.ts` (‏רשימת קולות מ-ElevenLabs) |
| **חדש** | `view-models/derived/voice-mode.svelte.ts` |

### Engines

| ישן | חדש |
|-------|-------|
| `acp/client.ts` + `client-impl.ts` + `ws-to-streams.ts` | `engines/acp/` (3 קבצים) |
| `audio/recorder.ts` | `engines/recorder.ts` |
| `voice/audio-stream.ts` | `engines/audio-stream.ts` |
| **חדש** (חולץ מ-5 קבצים, ‏‎כולל sessionStorage) | `engines/web-storage-sync.ts` |

### Adapters

| ישן | חדש |
|-------|-------|
| `api/agents.ts` | `adapters/agents-api.ts` |
| `api/sessions.ts` | `adapters/sessions-api.ts` |
| `api/sessions-ws.ts` | `adapters/sessions-list-via-acp.ts` |
| `voice/stt-client.ts` | `adapters/voice/transcribe.ts` |
| `voice/tts-client.ts` | `adapters/voice/synthesize.ts` |
| `voice/translate-client.ts` | `adapters/voice/translate.ts` |
| `voice/narrate-client.ts` | `adapters/voice/describe-tool.ts` |
| `voice/recordings-client.ts` | `adapters/recordings.ts` (יורחב — ‏ראה §13) |
| `voice/sdks.ts` | `adapters/sdks.ts` |
| **חדש** | `adapters/voice/voices.ts` (‏רשימת ElevenLabs דרך GET `/v1/voices`) |
| **חדש** (היה inline fetch ב-`/agent/new`) | `adapters/options.ts` (GET /api/options) |

### Actions ‏‎(חדש)

| ישן | חדש |
|-------|-------|
| `stores/agent-recovery.ts` | `actions/recover-agent.ts` |
| ‏‎(לוגיקה פנימית ב-routes) | `actions/connect-agent.ts` ‏‎(חדש) |
| ‏‎(לוגיקה פנימית ב-routes) | `actions/pick-session.ts` ‏‎(חדש) |
| ‏‎(שתי קריאות מתואמות) | `actions/cancel-and-reset.ts` ‏‎(חדש) |

### Util

| ישן | חדש |
|-------|-------|
| `audio/cues.ts` | `util/cues.ts` |
| `stores/smart-scroll.ts` | `util/scroll-derive.ts` |
| `log.ts` | `util/log.ts` |

### Core (`packages/core/src/`)

| ישן (frontend) | חדש (core) |
|-----------------|-------------|
| `voice/base64.ts` | `core/util/base64.ts` |
| `voice/translate-cache.ts` | `core/voice/translate-cache.ts` |
| (חולץ מ-`agent-session`) | `core/voice/bubble-accumulator.ts` |
| (חולץ מ-`orchestrator`) | `core/voice/queue-policy.ts` |
| (חולץ מ-`agent-storage`) | `core/schemas/agent-metadata.ts` |

### ‏ייעלמו / יתאחדו

| נמחק | סיבה |
|--------|------|
| `audio/player.ts` (`AudioQueue`) | ‏‎✅ ‎דד-קוד מאומת — ‏‎0 imports בקוד הקיים |
| `stores/agent-storage.ts` | ‏מתאחד ל-`WebStorageSync` |
| `stores/playback-storage.ts` | ‏מתאחד ל-`WebStorageSync` ‎+ ‎ה-load logic הוא TODO — ‏‎להחליט אם להשלים או למחוק את ה-save (‏‎ראה ‎`B2`) |
| `stores/sessions-cache.ts` | ‏מתאחד ל-`WebStorageSync` |
| `stores/sidebar-state.svelte.ts` | ‏מתאחד ל-`WebStorageSync` ‎(sessionStorage backend) |
| `stores/mic-state.svelte.ts` | ‏מוחלף ב-`VoiceMode.state` |
| `messages: ChatMessage[]` ‎ב-AgentSession | ‏‎✅ ‎דד-קוד מאומת — ‏‎0 ‎consumers חיצוניים. ‏‎לא "legacy" אלא נטוש לחלוטין. |
| `segmentCache` ‎ב-VoiceSession | ‏‎✅ ‎דד מאומת — ‎`getSegment` ‎לעולם לא מוצב, ‎תמיד מחזיר `undefined` |
| `lastRecordingId` ‎ב-AgentSession | ‏‎שדה שלא מוצב מעולם. ‏‎מתחלף בפיצ'ר ההקלטות (`recordingId` ‎על ‎Bubble — ‏‎ראה ‎§13 ‎ו-`B1`) |
| `routes/agent/new/+page.svelte` | ‏‎מתאחד עם `/` (‏‎ראה ‎§17) |
| `routes/sessions/+page.svelte` | ‏‎אין dashboard/history יותר |
| `routes/sessions/[cwdHash]/+page.svelte` | ‏‎מתאחד ל-`/sessions` |
| `routes/session/[cwdHash]/[id]/+page.svelte` | ‏‎מתאחד ל-`/sessions` flow |
| `components/ProjectCard.svelte` | ‏‎לבדוק שימוש לאחר מחיקת ‎`/sessions` |
| `components/SessionCard.svelte` | ‏‎נשאר ‎אם נשתמש ב-`/sessions` |

### ‏‎באגים בקוד שייתקנו במהלך המעבר

| ‏‎קוד | ‏‎באג | ‏‎שלב טיפול |
|--------|---------|--------------|
| `B1`: `voice-session.sendAudioBlob` ‎זורק את ‎`recordingId` ‎שחוזר מ-`transcribe` | ‏‎ה-BE שומר הקלטות, ‏‎אבל ‎FE לא מקשר ל-bubbles | ‏‎שלב 7 ‎(פיצ'ר recordings) — ‏‎ה-fix הוא חלק טבעי |
| `B2`: ‎`loadPlaybackState` ‎ב-`+page.svelte:74-82` ‎נקרא אך לא מבצע restoration (TODO ב-comment) | ‏‎FE כותב ל-localStorage נתונים שאף אחד לא קורא | ‏‎שלב 5 ‎(ניקוי) — ‏‎להחליט: ‏‎להשלים או למחוק |

---

## 11. ‏שלבים — ‏סדר ביצוע

### שלב 0 — חקירה (לפני קוד)

1. ‏‎✅ ‎דד-קוד מאומת: `audio/player.ts`, `segmentCache`, ‎`ChatMessage`, `lastRecordingId`.
2. ‏‎להבהיר עם BE: ‎`POST /api/recordings` ‎ו-`GET /api/recordings/:id` ‎כבר קיימים. ‏‎חסר association sessionId→recordingIds[].
3. ‏‎לעדכן OneCLI agent `voice-acp`: ‎inject ‎`xi-api-key` ‎על ‎`api.elevenlabs.io/*` ‎(לא רק /v1/text-to-speech).
4. ‏‎baseline: `pnpm test`, `pnpm typecheck` ‎ירוקים.
5. ‏Branch: `refactor/view-models`.

### שלב 1 — ‏העברת תיקיות (mechanical, ‏אפס לוגיקה חדשה)

1. ‏יצירת `view-models/`, ‎`engines/`, ‎`adapters/`, ‎`actions/`, ‎`util/`.
2. ‏`git mv` ‎של קבצים — בלי לשנות תוכן. ‏עדכון imports.
3. ‏‎tests ירוקים → commit.

‏רשת ביטחון: כל שגיאה אחרי זה מיוחסת לקוד שינוי, ‏לא להעברת קבצים.

### שלב 2 — Factory/singleton → Class, ‏אחד-אחד (כל אחד commit נפרד)

‏סדר מומלץ (קל → קשה):

1. ‏`Notifications` ‎— 0 ‎תלויות. ‏‎(היום ‎module-level singleton)
2. ‏`Settings` ‎— ‏‎(היום module-level singleton + localStorage)
3. ‏`Player` ‎— ‏‎(היום factory)
4. ‏`Projects` ‎— ‏‎(היום factory)
5. ‏`CarMode` ‎— ‏‎(היום factory)
6. ‏`SidebarUI/SheetUI/Device` ‎(קובץ ‎`ui-state.svelte.ts`) ‎— ‏‎(היום module-level singletons)
7. ‏`AgentSession` ‎— ‏הליבה. ‏הרבה tests. ‏‎**להוסיף ‎public ‎`loadSession()` ‎ו-`newSession()`** (P1).
8. ‏`Mic` ‎— ‏חולץ מ-`voice-session`. ‏‎ה-`sendAudioBlob` ‎חדש מעביר ‎`recordingId` ‎ל-`session.sendPrompt(text, { recordingId })` ‎— ‏‎תיקון ‎`B1`.
9. ‏`Speaker` ‎— ‏חולץ מ-`orchestrator`.
10. ‏`Voices` ‎— ‏‎חדש. ‏‎נטען ב-mount של ‎`/`.
11. ‏`VoiceMode` ‎— ‏חדש.

‏בכל commit: ‏class חדש חי **לצד** ה-factory הישן. ‏ה-route מחליף consumer אחד בלבד. ‏אם נשבר — ‏מחזירים.

### שלב 3 — Context + ‏singletons ב-layout

1. ‏יצירת `lib/context.ts` ‎עם זוגות `createContext`.
2. ‏עדכון `+layout.svelte` ‎עם instantiate + `setContext`.
3. ‏routes קוראים `getContext()` ‏במקום ליצור instances.
4. ‏מחיקת ה-`$state(createX())` ‎הישן ב-routes.
5. ‏‎החלפת ה-`import { settingsStore }` ‎בכל קומפוננטה ב-`getSettings()` ‎(וכן ‎`notifications`, ‎`sidebarState`, ‎`sheetState`, ‎`device`).

### שלב 4 — WebStorageSync unification

1. ‏יצירת `engines/web-storage-sync.ts` ‎— ‏API גנרי `<T>` ‏עם ArkType, ‏‎תומך ‎localStorage ‎ו-sessionStorage.
2. ‏העברת ה-5 ‎הconsumers (`agent-storage`, `playback-storage`, `sessions-cache`, `settings`, ‏`sidebar-state`) ‏אליו.
3. ‏מחיקת הקבצים הישנים.
4. ‏‎`SessionInfo` ‎עובר ל-`core/schemas/session-info.ts` ‎(C1).

### שלב 5 — ‏ניקוי דד-קוד

1. ‏מחיקת `messages` ‎ב-`AgentSession` ‎(D1 — ‎דד מלא, ‎לא רק legacy).
2. ‏מחיקת `segmentCache` ב-`Mic`.
3. ‏מחיקת `audio/player.ts`.
4. ‏מחיקת `mic-state-derive`.
5. ‏‎B2: ‎להחליט על ‎`playback-storage`:
   - ‏‎אופציה A: ‏‎להשלים את ה-restore logic ב-`Player.attach()` ‎(`currentIndex` ‎+ ‎`playlist`).
   - ‏‎אופציה B: ‏‎למחוק את ‎`createPlaybackStorageSync` ‎גם — ‏‎לא לכתוב data שאין מי שיקרא.

### שלב 6 — ‏Core extraction

1. ‏העברה ל-`core/`: ‎`base64`, ‎`translate-cache`.
2. ‏חילוץ `bubble-accumulator` ‎ו-`queue-policy` ‎מה-classes.
3. ‏עדכון `core/package.json` ‎exports.

### שלב 7 — ‏הוספת feature ההקלטות (§13)

1. ‏‎תיקון ‎`B1`: ‎`Mic.stop()` ‎מעביר ‎`recordingId` ‎ל-`session.sendPrompt(text, { recordingId })`. ‏‎הbubble ‎שומר ‎את ‎ה-id.
2. ‏‎BE: ‏‎להוסיף sessionId association + ‎`GET /api/sessions/:id/recordings` ‎(S1, S2).
3. ‏‎FE: ‏‎הרחבת ‎`Player` ‎ו-`Speaker` ‎לתמיכה ב-`user-recording` ‎kind.
4. ‏‎UI: ‏‎כפתור ‎"השמע שיחה מחדש".
5. ‏‎Session restore: ‏‎call ‎`listRecordings(sessionId)` ‎ב-`/sessions` ‎flow.

---

## 12. ‏סיכונים

### א. ‏Singletons ב-layout משנים lifecycle

‏היום `voice-session` ‎נוצר מחדש בכל ניווט. ‏אחרי המעבר הוא singleton ‎עם `attach()`. ‏אם state לא מתנקה ב-`detach()` → ‏באג.

‏**שמירה:** ‏טסט מפורש: `attach A → emit chunks → detach → attach B → ‏bubbles empty?`.

### ב. ‏סדר יצירת singletons חשוב

‏TypeScript יתפוס סדר שגוי (DI מפורש ב-constructor). אבל circular reference בעתיד יישבר רק ב-runtime. ‏לעקוב.

### ג. ‏Tests של factory → ‏class refactor

‏~15 קבצי טסט ב-`stores/`. ‏החלפה מכנית של `createXStore()` ב-`new X()`. ‏סקריפט sed פשוט.

### ד. ‏SSR/hydration

‏`Device`, `SidebarUI` ‎משתמשים ב-`window.matchMedia`. ‏לא קיים ב-SSR. ‏Guard: ‎`if (typeof window !== "undefined")` ‎ב-constructor.

### ה. ‏Recovery flow

‏`recoverAgent` ‎חוצה 4 sub-systems: localStorage, REST, SvelteKit `goto`, notifications. **לא להפוך לchain של method calls בתוך AgentSession**. ‏להישאר adapter פונקציה שמקבלת deps מפורשות.

---

## 13. Feature: ‏גיבוי הקלטות + Conversation Replay

‏פיצ'ר חדש שחייב להיכנס למבנה החדש בצורה נכונה.
**‏אושר 2026-05-18.**

### ‏‎מצב BE קיים (חשוב לדעת)

| ‏‎יכולת | ‏‎סטטוס |
|----------|----------|
| `POST /api/recordings` | ‏‎✅ ‎קיים. ‏‎מקבל bytes+mime, ‎מחזיר ‎`{ id }`. |
| `GET /api/recordings/:id` | ‏‎✅ ‎קיים. ‏‎מחזיר audio stream. |
| `RecordingsStore` ‎(save/get) | ‏‎✅ ‎קיים. ‏‎FS-based ‎(`data/recordings/<uuid>.<ext>`). |
| ‏‎sessionId association ‏‎ב-RecordingsStore | ‏‎❌ ‎חסר — ‎`save()` ‎לא מקבל ‎sid. |
| `GET /api/sessions/:id/recordings` ‏‎(listRecordings) | ‏‎❌ ‎חסר. |
| ‏‎אינדקס sid → recordingIds[] | ‏‎❌ ‎חסר. ‏‎נדרש sidecar JSON או DB. |

**‏‎משמעות:** ‏‎אין צורך לבנות BE מאפס. ‏‎צריך להרחיב — ‏‎להוסיף ‎sid parameter ל-`save()`, ‎sidecar index, ‎ו-list endpoint.

### דרישות עסקיות (אושרו)

1. ‏כל הקלטה של המשתמשת נשמרת בBE (קיים — ‏‎אך ה-id נזנח ב-FE, ‏‎ראה ‎`B1`).
2. ‏כל user bubble מציג כפתור "השמע מחדש את ההקלטה שלי".
3. ‏מצב "Replay כל השיחה" — ‏מנגן את ההקלטות + תגובות הסוכן בסדר הכרונולוגי.
4. ‏Replay חי גם אחרי reload של ה-tab — ‏הנתונים מגיעים מ-BE.
5. ‏**ב-session restore** ‎(/sessions → ‏‎טעינת sid קיים): ‏אם יש הקלטות שמורות ל-session, ‏הן זמינות ל-replay מיד עם הטעינה.
6. ‏**TTS לא נשמר** — ‏המודל לא מקריא נשמר. בעת replay, ‏ה-TTS של הסוכן **נוצר on-the-fly** (אותו pipeline של real-time, ‏רק שה-text מקורו ב-history).

### ‏‎באג קיים שמתקנים תוך כדי (B1)

‏‎ב-`lib/voice/stt-client.ts:62`:
```ts
return { text, recordingId }   // ‏‎חוזרים שניהם
```

‏‎ב-`lib/stores/voice-session.svelte.ts:147`:
```ts
const { text } = await transcribe(finalBlob, {...})   // ⚠️ recordingId ‎נזרק
```

‏‎ה-id חוזר תקין, ‎אבל ‎ה-consumer זורק אותו. ‏‎גם ‎`lastRecordingId` ‎ב-`agent-session.svelte.ts` ‎מוגדר אבל לא מוצב מעולם. ‏‎התיקון נכלל בשלב ‎7.

### השפעה על ה-data model

ל-`Bubble` ‎מסוג `"user"` ‎נוסף שדה:

```ts
type Bubble =
  | { kind: "user";    messageId: null; segments: [...]; recordingId?: string }
  | { kind: "message"; messageId: string | null; segments: [...] }
  | { kind: "thought"; messageId: string | null; segments: [...] }
  | { kind: "tool";    messageId: null; segments: [...] }
```

‏ה-`recordingId` ‎אופציונלי כי:
- ‏Bubbles שנוצרו לפני שהפיצ'ר נכנס לא יהיו עם id.
- ‏Bubbles שמקורן ב-text-input (debug form) לא יהיו עם id.

### השפעה על ה-pipeline

‏**Mic** ‎ירחב את `stop()`:

```ts
async stop() {
  this.state = "transcribing"
  const blob = await this.#recorder.stop()
  if (blob.size === 0) { this.state = "idle"; return }

  // ⭐ ‏הקלטה ל-BE — ‏מקבילית ל-STT
  const [transcriptResult, recordingResult] = await Promise.allSettled([
    transcribe(blob),
    saveRecording(blob),
  ])

  if (transcriptResult.status === "rejected") {
    this.error = "STT failed"; this.state = "idle"; return
  }

  // ⭐ ‏אם saveRecording נכשל — לא קריטי. STT עיקרי.
  const recordingId = recordingResult.status === "fulfilled"
    ? recordingResult.value.id
    : undefined

  this.sttText = transcriptResult.value.text
  this.state = "idle"

  // ⭐ ‏שולחים גם את ה-id ל-session
  this.#session.sendPrompt(transcriptResult.value.text, { recordingId })
}
```

‏**AgentSession.sendPrompt** ‎מקבל את ה-id ושומר ב-bubble:

```ts
sendPrompt = (text: string, opts?: { recordingId?: string }) => {
  this.bubbles.push({
    kind: "user",
    messageId: null,
    segments: [{ text }],
    recordingId: opts?.recordingId,
  })
  this.#acpClient.prompt(this.#sessionId, text)
}
```

### השפעה על ה-replay

‏**שלא להוסיף `ConversationReplay` ‎view-model חדש** — ‏זה ירבה classes. ‏במקום, ‏להרחיב את `Speaker` ‎+ ‎`Player`:

1. ‏`PlaylistItem` ‎מקבל kind חדש: `"user-recording"`:
   ```ts
   type PlaylistItem = {
     segmentId: string
     kind: "message" | "thought" | "narration" | "user-recording"
     messageId: string | null
     recordingId?: string  // ‏רלוונטי רק ל-user-recording
   }
   ```

2. ‏`Speaker` ‎מקבל branch חדש:
   ```ts
   async #fetchSegment(job: TtsJob) {
     if (job.kind === "user-recording") {
       const audio = await getRecording(job.recordingId!)  // adapter
       await this.#audioStream.prepareSegment(job.segmentId, audio)
       return
     }
     // ‏מסלול קיים: ‏translate → describe → TTS
   }
   ```

3. ‏אקשן חדש ב-`Player`:
   ```ts
   replayConversation(bubbles: Bubble[]): void {
     this.clear()
     for (const b of bubbles) {
       if (b.kind === "user" && b.recordingId) {
         this.addSegment(crypto.randomUUID(), "user-recording", null, b.recordingId)
       } else if (b.kind === "message" || b.kind === "thought") {
         // ‏הסגמנטים של הסוכן כבר מ-Speaker — ‏ייצור TTS חדש
         this.addSegment(crypto.randomUUID(), b.kind, b.messageId)
       }
     }
     // ‏Speaker יתחיל לאסוף ולנגן את הplaylist
   }
   ```

4. ‏ב-UI: ‏כפתור "השמע שיחה מחדש" ‏ב-FloatingHeader / ‏בBottomSheet ‏שקורא:
   ```ts
   player.replayConversation(session.bubbles)
   ```

### Adapter `recordings.ts` — ‏API מלא

```ts
export async function saveRecording(blob: Blob): Promise<{ id: string }> {
  // ‏היום — POST /api/recordings עם base64. ‏לשקול multipart במקום.
}

export async function getRecording(id: string): Promise<ReadableStream<Uint8Array>> {
  // ‏GET /api/recordings/:id — ‏מחזיר audio stream
}

export async function listRecordings(sessionId: string): Promise<RecordingInfo[]> {
  // ‏GET /api/sessions/:id/recordings — ‏לשימוש ב-session restore
  // ‏מחזיר: { recordingId, bubbleIndex | userMessageHash, createdAt }[]
}
```

### Session restore flow (חדש)

‏כש-`/sessions` ‏מנתב לסשן קיים:

1. ‏המסלול הקיים: ‏יצירת agent + טעינת session דרך ACP `loadSession`.
2. ‏**חדש:** ‏בנוסף — קריאה ל-`listRecordings(sessionId)`.
3. ‏ה-recordingIds נצמדים ל-user bubbles שמתאימים (לפי סדר או hash של הטקסט).
4. ‏ה-UI מציג את כפתורי ה-replay מהרגע הראשון.

‏**שאלה פתוחה — דחויה:** ‏מי אחראי על הצמדת recordingId ל-bubble היסטורי?
- ‏BE עושה את ההצמדה ושולח bubbles עם `recordingId` ‎כבר משובץ?
- ‏FE עושה הצמדה לפי סדר אחרי שני הdataset הגיעו?
- ‏זה דורש החלטה ארכיטקטונית, אבל **לא חוסם** ‎את ה-refactor הנוכחי. ‏נחזור לזה אחרי שהמבנה החדש יציב.

### השפעה על BE (לא חלק מהמסמך הזה, ‏אבל לציון)

‏נדרש endpoint חדש: ‎`GET /api/recordings/:id` ‎שמחזיר audio. ‏אופציה ל-streaming או full-blob. ‏Auth: ‏המשתמשת היחידה (אין multi-tenant) — ‏לא קריטי.

### השפעה על המסמך הזה

‏ב-§10 העברתי את `recordings-client.ts` ‎ל-`adapters/recordings.ts` ‏(לא נמחק). ‏השלב הקיים §11.7 ‏(הוספת הפיצ'ר) ‏יתבצע אחרי שהמבנה יציב.

---

## 14. ‏מספרים צפויים

| | ‏היום | ‏אחרי |
|---|---------|---------|
| ‏סה"כ קבצי source | ~‎75 | ~‎60 |
| ‏סה"כ שורות ב-routes | 2677 | ~‎650 |
| ‏סה"כ שורות ב-`stores/` | ~‎2500 | 0 (לא קיים) |
| View-models | 0 ‎(mix של factory + singleton) | 11 ‎(10 primary + 1 derived) |
| Actions | 0 | 4 |
| ‏מערכות storage עצמאיות | 5 ‎(4 localStorage + 1 sessionStorage) | 1 ‎(`WebStorageSync`) |
| ‏מערכות אודיו | 2 (אחד מת) | 1 |
| ‏‎ראוטים | 7 | 4 ‎(+4 ‎legacy redirects זמני) |
| ‏זמן משוער | — | ‎4-6 ימי עבודה לכל המעבר |

---

## 15. ‏מה לא נכלל במסמך הזה

- ‏**Component restructuring:** ‏ה-`*.svelte` ‎components לא ישתנו בשלב הראשון. אחרי שהcontext עובד, ‏אפשר להתחיל לקצץ props.
- ‏**Backend changes** ‎(`/api/recordings/:id` ‎endpoint).
- ‏**Testing strategy** ‎לפיצ'ר ההקלטות.
- ‏**XState / RxJS** ‎— ‏הוחלט לא להכניס תלות חדשה בשלב הראשון. ‏אופציה עתידית אם ה-FSM יסתבך.

---

## 16. ‏החלטות

### ‏נסגרו

| # | ‏שאלה | ‏הכרעה | ‏תאריך |
|---|---------|----------|----------|
| 2 | ‏פיצ'ר הקלטות אמיתי? | ‏כן. ‏replay מלא של user + agent. | 2026-05-18 |
| 5 | ‏הרחבת `recordings.ts`? | ‏כן — ‎`save`, `get`, `list`. | 2026-05-18 |
| 6 | ‏Replay גם ב-session restore? | ‏כן, ‏כל עוד יש הקלטות שמורות. ‏TTS נוצר on-the-fly. | 2026-05-18 |
| 9 | ‏מבנה ראוטים? | **‎4 ‎מסכים פשוטים:** ‎`/`, `/sessions`, `/chat`, `/settings`. ‏‎ראה §17. | 2026-05-18 |
| 10 | ‏‎רשימת קולות ב-`/`? | ‏‎דינמית — ‏‎GET `https://api.elevenlabs.io/v1/voices` ‎דרך OneCLI gateway. ‏‎לא קשיחה. | 2026-05-18 |
| 11 | ‏‎דשבורד עם "‏‎חיבורים פעילים" / "‏‎פרויקטים אחרונים"? | ‏‎נמחק. ‏‎מסך ‎`/` ‎(connect) ‎מחליף הכל. ‏‎אם יש חיבור חי בעת ביקור — ‏‎הצעה "המשך עם הקיים". | 2026-05-18 |

### ‏פתוחות

| # | ‏שאלה | ‏שלב |
|---|---------|--------|
| 4 | ‏האם `WebStorageSync` נחוץ עכשיו, או דחיה לאחרי שהבסיס יציב? | 4 |
| 7 | ‏מי מצמיד recordingId ל-bubble היסטורי ב-session restore — BE או FE? | ‏אחרי 13 |
| 8 | ‏האם לפתוח view-model ייעודי ל-replay (`ConversationReplay`) או להישאר עם `Player`+`Speaker` ‎מורחבים? | ‏בתחילת 13 |
| 12 | `B2` ‎— ‏‎להשלים את ‎`playback-storage` ‎(restore logic) ‎או למחוק את ה-save? | 5 |
| 13 | ‏‎`cwdToHash` ‎— ‏‎להרחיב לדו-ארגומנט (`cwd, cliKind`) ‎או להישאר ב-project = cwd? | ‏‎לפי הצורך |
| 14 | ‏‎BE work ל-recordings: ‏‎sidecar JSON או DB ל-`sid → recordingIds[]`? | 7 |

### ‏‎נסגרו (סבב ביקורת 2)

| # | ‏שאלה | ‏הכרעה | ‏‎תאריך |
|---|---------|----------|----------|
| 1 | ‏‎`audio/player.ts` ‎(`AudioQueue`) ‎— ‏‎דד? | ‏‎✅ ‎מאומת: ‎0 imports. ‏‎נמחק בשלב 5. | 2026-05-18 |
| 15 | `B1` ‎— ‎מתי לתקן? | ‏‎שלב 7 ‎(פיצ'ר recordings) — ‎ה-fix הוא חלק מהמסלול הטבעי. | 2026-05-18 |
| 16 | ‏‎`actions/` ‎כקטגוריה חדשה? | ‏‎✅ ‎אושר. ‏‎ראה ‎§3, §5b. ‏‎פעולות חוצות שכבה ‎(recoverAgent, ‎connectAgent, ‎pickSession). | 2026-05-18 |
| 17 | ‏‎`AgentSession.loadSession()`/`newSession()` ‎ציבוריים? | ‏‎✅ ‎אושר. ‏‎נדרש בשביל ‎/sessions ‎flow. ‏‎נוסף בשלב 2.7. | 2026-05-18 |

### ‏בוטלו

| # | ‏שאלה | ‏סיבה |
|---|---------|--------|
| 3 | ‏עד כמה לעמיק את `Dashboard` view-model? | ‏‎אין dashboard יותר. ‏‎ה-VM נמחק מהתוכנית. |

---

## 17. Routes — ‏המבנה הסופי

### ‏4 ‏מסכים בלבד

| Route | ‏מסך | ‏תפקיד |
|--------|--------|--------|
| `/` | **Connect** | ‏בחירת CLI + ‏cwd + ‏קול. ‏ה-entry point. |
| `/sessions` | **Session picker** | ‏אחרי החיבור — ‏בחירת session ישן או חדש. |
| `/chat` | **Voice UI** | ‏המסך הראשי. ‏השיחה. |
| `/settings` | **Settings** | ‏הגדרות מתמשכות. |

### ‏זרימה לינארית

```
/  ──connect──►  /sessions  ──pick──►  /chat
                                         ▲
                                         │
                                         └── /settings (‏מכל מקום)
```

### ‏טיפול ב-state חסר (refresh / direct nav)

‏כל ראוט בודק תנאי מקדים ב-`+page.ts` ‎`load()`. ‏אם לא מתקיים — ‏redirect.

| ‏ניסיון | ‏מצב | ‏פעולה |
|-----------|--------|---------|
| `/sessions` | ‏אין connection | redirect ל-`/` |
| `/chat` | ‏אין connection | redirect ל-`/` |
| `/chat` | ‏יש connection, ‏אין session | redirect ל-`/sessions` |
| `/` | ‏יש connection פעיל | ‏מציע "‏המשך עם הקיים" + "‏חיבור חדש" (‏2 ‏כפתורים) |

‏ה-redirects קורים לפני שה-DOM מתמלא — ‏אין flicker.

### ‏מסך ‎`/` (Connect) — ‏פירוט

‎טופס יחיד:

```
CLI         [opencode ▾]   opencode / claude / gemini / codex
‏‎תיקייה     [/home/user/projects/X ▾]   ‏‎+ "נתיב מותאם"
‏‎קול        [‏‎טוען רשימה...]   ‏‎מ-ElevenLabs API (‏‎דינמי)
‏‎מודל       [‏‎ברירת מחדל ▾]   (‏‎advanced, ‎מוסתר אלא בלחיצה)

         [‏‎חבר →]    [⚙ ‏‎הגדרות]
```

**‏‎רשימת הקולות:** ‏‎נטענת מ-`GET /v1/voices` ‎של ElevenLabs דרך OneCLI gateway. ‏‎ראה ‎`adapters/voice/voices.ts` ‎ו-`view-models/voices.svelte.ts`. ‏‎הרשימה נטענת ב-app start (ב-`+layout`) ‎ו-cache בזיכרון לכל ה-session.

**‏‎שדה ה-cwd:** ‏‎מ-`GET /api/options` ‎(‏‎שכבר קיים). ‏‎הdropdown מכיל את הפרויקטים האחרונים + ‏‎אופציה ל-"נתיב מותאם".

**‏‎בחירת ‏‎model:** ‏‎אופציונלית, ‏‎ברירת מחדל מסתירה את השדה. ‏‎נשלפת מ-`GET /api/options.models[cliKind]`.

‏‎פעולת "חבר" — ‏‎ב-`actions/connect-agent.ts`:
```ts
export async function connectAgent(params: {
  cliKind: CliKind; cwd: string; modelOverride?: string; voiceId: string;
  session: AgentSession; settings: Settings;
}) {
  const { agentId } = await createAgent({
    cliKind: params.cliKind, cwd: params.cwd, modelOverride: params.modelOverride
  })
  params.settings.setVoiceId(params.voiceId)  // ‏‎שומר ל-localStorage
  await params.session.attach(agentId)
  await goto("/sessions")
}
```

‏‎ה-route ‎`/+page.svelte` ‎רק קורא ל-action הזה ‎עם ‎ה-VMs מ-context. ‏‎אין business logic בroute עצמה.

### ‏‎מסך ‎`/sessions` — ‏‎פירוט

```
← ‏‎שנה חיבור               opencode • /home/user/projects/X

‎◯ ‏‎סשן חדש
‎◯ "fix bubble bug" • ‏‎לפני שעתיים
‎◯ "refactor api" • ‏‎אתמול
‎◯ "voice cleanup" • ‎18.5

         [‏‎המשך →]
```

**‏‎מקור הרשימה:** stale-while-revalidate:
‎1. ‎מ-localStorage cache (‎instant) ‎דרך ‎`engines/web-storage-sync.ts`.
‎2. ‏‎במקביל: ‎`listSessionsViaActiveAgent(acpClient)` ‎— ‏‎ה-agent **כבר ‏‎פעיל** ‎אחרי connect. ‏‎לא צריך temp agent בflow הזה (חיסכון משמעותי לעומת הקוד הקיים).

‏‎פעולת "המשך" — ‏‎ב-`actions/pick-session.ts`:
```ts
export async function pickSession(params: {
  sid: string | "new";
  session: AgentSession;
}) {
  if (params.sid === "new") {
    await params.session.newSession()
  } else {
    await params.session.loadSession(params.sid)
  }
  await goto("/chat")
}
```

‏‎שתי השיטות החדשות על ‎`AgentSession` (`loadSession`, `newSession`) ‎הן ‎ה-public API שמוסיפים בשלב 2.7 (‏‎ראה ‎§4 — `AgentSession` ‎API חדש). ‏‎הן עוטפות ‎את ‎`acpClient.loadSession`/`newSession` ‎פנימית עם fallback ל-spawn agent חדש אם CLI לא תומך.

### ‏‎מסך ‎`/chat` — ‏‎פירוט

‎ה-voice UI הקיים — ‏‎בעיקר composition של:
- ‏‎`<MicCluster>` ‎(‏‎הכפתור המרכזי)
- ‏‎`<BubbleList>` ‎(‏‎השיחה)
- ‏‎`<FloatingHeader>` ‎(‏‎mobile)
- ‏‎`<Sidebar>` ‎(‏‎desktop)
- ‏‎`<BottomSheet>` ‎(‏‎mobile menu)

‏‎ה-route דק: ‎~‎150 ‎שורות. ‏‎כל ה-state מ-context (`session`, `mic`, `speaker`, `voiceMode`, `player`).

### ‏‎פירוט ‎`/chat`: ‎מי מקבל ‎כל חתיכה מהקוד הישן

‎`agent/[id]/+page.svelte` ‎(989 ‏‎שורות) ‎מתפצל ‎כך:

| ‏‎חתיכה ישנה | ‏‎יעד חדש |
|---------------|-----------|
| ‎`agent: AgentPublic`, ‎`loadError`, ‎`pollTimer` | ‏‎`AgentSession` ‎— ‏‎פנימי |
| ‎`session, player, voice, carMode` ‎(stores) | ‏‎`getContext()` ‎דרך layout |
| ‎`isCancelling` | ‏‎transient בroute (UI feedback) |
| ‎`prevMicState` + cues `$effect` | ‏‎composable ‎`util/use-audio-cues.svelte.ts` |
| ‎`wakeLock` + ‎`acquireWakeLock`/`releaseWakeLock` | ‏‎composable ‎`util/use-wake-lock.svelte.ts` |
| ‎`chatEl`, `autoScrollEnabled`, `showJumpDown`, `lastUserInteractionAt` | ‏‎component חדש ‎`<ChatScrollContainer>` ‎(או ‎composable) |
| ‎`onChatScroll`, `markUserInteraction`, `jumpToBottom` | ‏‎אותו component/composable |
| ‎`fileInputEl`, `onFileUpload` | ‏‎`Mic.sendFile(blob)` ‎+ ‎`<input type=file>` ‎ב-`<MicCluster>` |
| ‎`onMicClick` (4-way switch) | ‏‎`actions/mic-click.ts` ‎(או method על ‎`VoiceMode`) |
| ‎`onStop`, `onBubblePlayRequest` | ‏‎actions קצרים |
| ‎`isCarMode` (URL param), `enableCarMode` | ‏‎נשאר בroute (URL parsing) |
| ‎debug text form | ‏‎component `<DevPromptForm>` ‎(או למחוק) |
| ‎`schedulePoll` + ‎`loadAgent` (polling /api/agents/[id]) | ‏‎`AgentSession` ‎— ‏‎פנימי (auto-poll while attached) |
| ‎`handleSheetAgentClose` (delete + goto) | ‏‎`actions/disconnect.ts` |
| ‎HTML+CSS (layouts, ‎classes, ‎styles) | ‏‎נשאר בroute |

‎סה"כ ‎route: ~‎150 ‎שורות (מתוכן ‎~100 markup, ‎~50 script).

### ‏‎מסך ‎`/settings`

‎ללא שינוי מהותי. ‏‎שימוש ב-`Settings` ‎+ ‏‎`Voices` ‎view-models. ‏‎קיים גם voice picker כאן (‎שכפול ל-/) — ‏‎שניהם קוראים ל-`settings.setVoiceId()`.

### ‏‎מיפוי מ-current

| ‏‎ראוט היום | ‏‎חדש | ‏‎הערה |
|--------------|--------|--------|
| `/` (dashboard) | `/` (connect) | ‏‎דשבורד נמחק. ‏‎ה-Form מחליף. |
| `/agent/new` | `/` | ‏‎מתאחד. |
| `/agent/[id]` | `/chat` | connId ב-`AgentSession` ‎singleton, ‏‎לא ב-URL. |
| `/sessions` (history list) | **‏‎נמחק** | ‏‎נכלל ב-`/` ‎+ ‏‎`/sessions`. |
| `/sessions/[cwdHash]` | `/sessions` | ‏‎אחרי connect — ‏‎sessions של החיבור הנוכחי. |
| `/session/[cwdHash]/[id]` | **‏‎נמחק** | ‏‎ה-load+redirect מובלע ב-`/sessions` flow. |
| `/settings` | `/settings` | ‏‎ללא שינוי. |

### Legacy redirects (אופציונלי, ‎חודש)

‏‎אם רוצים שbookmarks ישנים יעבדו לחודש-חודשיים:

| ‏‎ראוט legacy | ‏‎redirect ל | ‏‎שיטה |
|----------------|------------|---------|
| `/agent/new` | `/` | `+page.ts` ‎עם ‎`redirect(307, "/")` |
| `/agent/[id]` | `/chat` | `+page.ts` ‎+ ‏‎`session.attach(id)` ‎בload, ‏‎אחר כך redirect |
| `/sessions/[cwdHash]` | `/sessions` | `+page.ts` ‎עם attach לcwd, ‏‎redirect |
| `/session/[cwdHash]/[id]` | `/chat` | `+page.ts` ‎עם attach + loadSession, ‏‎redirect |

‏‎אחרי חודש-חודשיים — ‏‎למחוק.

### Routes — ‏‎מבנה הקבצים

```
src/routes/
├── +layout.svelte                   # composition root + ‏‎ניווט guards
├── +page.svelte                     # / — Connect
├── sessions/
│   └── +page.svelte                 # /sessions — Session picker
├── chat/
│   └── +page.svelte                 # /chat — Voice UI
├── settings/
│   └── +page.svelte                 # /settings
│
└── (legacy redirects — ‏‎חודש)
    ├── agent/
    │   ├── new/+page.ts
    │   └── [id]/+page.ts
    ├── sessions/[cwdHash]/+page.ts
    └── session/[cwdHash]/[id]/+page.ts
```

### ‏‎מספרים מעודכנים (אחרי הפישוט)

| | ‏‎היום | ‏‎אחרי |
|---|---------|---------|
| ‏‎ראוטים פעילים | 7 | 4 |
| ‏‎סה"כ שורות ב-routes | 2677 | ~‎650 |
| ‏‎legacy redirects | 0 | 4 (זמני) |

‏‎הפישוט מקטין את ה-routes לפחות מ-‎25% ‎מהגודל הנוכחי.
