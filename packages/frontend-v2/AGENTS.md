# AGENTS.md — frontend-v2

## מה זה

בנייה מחדש של ה-FE מאפס, עם המבנה החדש (view-models classes + Context + 5 שכבות).
נוצר ב-`experiment/frontend-v2` אחרי ש-`packages/frontend/` הצטבר לכאוס (989 שורות ב-route אחד).

**ה-FE הקיים ב-`packages/frontend/` עוד עובד.** יוחלף (אולי) כש-v2 יגיע ל-feature parity.

---

## ארכיטקטורה — 5 שכבות

```
routes/         — shells דקים. composition בלבד.
components/     — leaves. props או getContext, בלי business logic.
view-models/    — classes עם $state. reactive shell.
actions/        — procedures חוצי-שכבה (`goto`, multi-VM, notifications).
engines/        — imperative resource owners (WS, audio, recorder).
adapters/       — I/O. פונקציות שמחזירות Promises.
```

חוקי import חד-כיווניים (מלמעלה למטה):
- routes יכולים לייבא view-models, actions, components.
- components יכולים getContext + util בלבד.
- view-models יכולים engines, adapters.
- engines/adapters יכולים @drive-coding/core בלבד.

---

## חמשת חוקי הזהב (מונעים את הכאוס)

### 1. Routes הם shells דקים

**מותר:** `getContext()`, לקרוא ל-actions, לרנדר components, `$state` לdata transient של UI.

**אסור:** ליצור view-models (`new X()` הולך ל-`+layout`), `$effect` עם side effects (cues, wakelock, scroll), polling, window/document listeners, fetch, WebSocket.

**ספיק קשיח: 150 שורות לroute.** יותר = משהו שגוי.

### 2. View-models מייצגים entities, לא screens

שאלה לפני יצירת view-model: "האם זה מתאר entity דומיין שחי בלי קשר לאיזה screen פתוח?"

| דוגמה | שייך? |
|--------|---------|
| AgentSession | ✓ |
| Mic, Speaker, Player | ✓ |
| Settings, Recordings | ✓ |
| ChatScreen | ✗ — route state |
| SidebarOpen | ✗ — UI state |
| ConnectFormState | ✗ — `$state` בroute |

אם זה לא entity, זה לא view-model.

### 3. Components הם leaves, לא composition roots

**מותר:** props או `getContext()`, לקרוא שדה אחד או שניים מ-view-model, לרנדר HTML, לקרוא ל-callback prop.

**אסור:** ליצור view-models, `fetch`, לקרוא ל-actions ישירות (props callbacks → route → action), `$effect` עם side effects חיצוניים.

**Heuristic: `<script>` < 50 שורות.** יותר = הcomponent עושה עבודה לא שלו.

### 4. Side effects שייכים ל-owner של ה-state

"מי מחזיק את ה-state שזה מגיב עליו?" — שם שייך ה-effect.

- `AgentSession.bubbles` צריך persist? → effect ב-AgentSession.
- `Mic.state === "recording"` צריך wake-lock? → ב-Mic.
- Auto-scroll ל-`session.bubbles` חדש? → בcomponent שמחזיק את ה-DOM node (לא בroute).

**הסייג:** effects שצריכים DOM-node ספציפי (`bind:this={el}`) נשארים בcomponent. אבל אז הcomponent כולל את הscroll-container, לא הroute.

### 5. אסור "backward compat in place" — או refactor או הסר

הדפוס "הוסף לצד הישן ואחר כך נמחק" = הדפוס שיצר את `messages` + `bubbles` הכפולים בFE הישן. בפעם הבאה אם יש שינוי בstate model:

- או refactor מלא (שובר consumers שצריך לתקן באותו commit).
- או לא לגעת.

לא לתחזק שתי גרסאות.

---

## מבנה התיקיות

```
src/
├── app.html / app.css / app.d.ts
├── lib/
│   ├── context.ts              — createContext זוגות (set + get לכל singleton)
│   ├── view-models/            — primary $state classes
│   │   └── derived/            — derived $derived classes (לעתיד)
│   ├── engines/                — imperative resource owners
│   ├── adapters/               — I/O wrappers
│   └── actions/                — procedures חוצי-שכבה
└── routes/                     — shells דקים
    ├── +layout.svelte          — composition root (יוצר VMs + setContext)
    ├── +page.svelte            — / (connect)
    └── chat/+page.svelte       — /chat
```

**`+layout.svelte` הוא המקום היחיד** שיוצר instances של view-models (`new X()`).
כל route אחר משתמש ב-`getContext()` בלבד.

---

## ה-domain — 3 ערוצי תקשורת

(האפליקציה היא מתורגמנית בין משתמש לסוכן.)

```
User (voice) → Mic → text → AgentSession → text → Agent (ACP)
                               │ (chunks)
                               ▼
                          ┌────┴────┐
                          ▼         ▼
                       Bubbles   Speaker → audio → User
                       (UI)      (TTS)
```

3 view-models קוליים: `Mic` (אוזן), `AgentSession` (שיחה), `Speaker` (פה).
יחד עם `VoiceMode` (derived) שמסכם את ה-state לdisplay של mic button.

---

## מצב נוכחי (slice 0 — text only)

✓ טקסט בלבד, אין voice עדיין.
✓ View-models: Settings, AgentSession.
✓ ACP integration דרך WsAcpTransport + `@drive-coding/core/acp`.
✓ 2 routes: `/` ו-`/chat`.
✓ typecheck נקי.

**לא קיים עדיין:** Mic, Speaker, VoiceMode, Player, CarMode, recordings, session picker, settings page, recovery flow, error toasts.

---

## slice הבא מומלץ — slice 1: voice input

**הוספת Mic + STT:**
- `view-models/mic.svelte.ts` — class Mic (state: `idle`/`recording`/`transcribing`).
- `engines/recorder.ts` — copy מ-FE הישן (MediaRecorder).
- `adapters/voice/transcribe.ts` — copy מ-FE הישן (Gemini STT).
- `components/MicButton.svelte` — ~50 שורות, מקבל getContext.
- `context.ts` + זוג ל-Mic.
- `+layout` + 4 שורות.
- `/chat/+page.svelte` + `<MicButton />` ליד textarea.

אחרי slice 1: אישה יכולה לדבר במקום להקליד.

**slice 2 בעתיד: voice output (Speaker + TTS + VoiceMode).**

---

## פקודות

```bash
pnpm install
pnpm --filter @drive-coding/frontend-v2 dev          # port 5175
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 build
```

ה-BE רץ נפרד על 4000 (`pnpm --filter @drive-coding/backend dev`).
Vite proxy מעביר `/api`, `/proxy`, `/ws` אליו.

---

## לפני שמוסיפים פיצ'ר חדש

שאל את עצמך:

1. **View-model או component-local state?** (האם זה entity דומיין?)
2. **איזה route רואה אותו?** (אם כולם — singleton ב-layout. אם אחד — possibly לא צריך VM.)
3. **יש שכבה מתאימה?** (VM → action → adapter? או יש קיצור דרך שגוי?)
4. **האם הroute יחרוג מ-150 שורות?** (אם כן — חלץ component.)
5. **יש side effect חדש (timer, listener, polling)?** (לאיזה VM הוא שייך? לא לroute.)

אם כל 5 ברורים — ההוספה לא תוסיף chaos.
