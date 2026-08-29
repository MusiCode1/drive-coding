# AGENTS.md — frontend

## מה זה

ה-FE של הפרויקט. נבנה מאפס ב-2026-05-27 כ-`frontend-v2/` במבנה החדש
(view-models classes + Context + 5 שכבות) אחרי שה-FE הישן הצטבר לכאוס
(989 שורות ב-route אחד). שונה השם ל-`frontend/` ב-2026-05-28 (cutover early).

ה-FE הישן עוד קיים בענף `main` בלבד — לעיון היסטורי. ב-`dev` הוא נמחק.

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

> הספיק **אינו נאכף היום.** מדידת החקירה (`docs-for-llm/investigations/2026-08-29-architecture-compliance/00-census.json`, 2026-08-29T12:12Z): **4** קבצי-route מעל 150 שורות. המספר בחוק לא עודכן — הכרעת מרדכי פתוחה (לעדכן סף או לאכוף).

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

> ההיוריסטיקה **אינה נאכפת היום.** אותה מדידה: **30** קומפוננטות מעל 50 שורות-`<script>` (3 מהן test). המספר בחוק לא עודכן — אותה הכרעה פתוחה.

> **שאלה פתוחה (לא כלל):** אין כלל כתוב ל-composition shells כמו `AppShell` (`<script>` 347) ו-`SessionOptionsPanel` (`<script>` 262). חוק #3 אומר components הם leaves — והם לא. האם מעטפת-layout היא קטגוריה שלישית, או הפרה? הכרעה למרדכי — אל תמציא כלל.

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

## Parallel-safe additive design

ל-`docs-for-llm/conventions/parallel-safe-code.md` יש קונבנציה מחייבת לשינויים
בקבצים משותפים (`context.ts`, `+layout.svelte`, `chat/+page.svelte`,
`i18n/keys.ts`, וכל קובץ שצפוי להיגעת ב-2+ slices עתידיים).

**TL;DR**:
- Additive only: הוסף, אל תשנה.
- Section headers (`// ─── domain ───`) → עבוד רק בsection שלך.
- שינוי invasive → עצור ושאל את מרדכי.

חובה לקרוא לפני נגיעה בקובץ משותף.

---

## מבנה התיקיות

```
src/
├── app.html / app.css / app.d.ts
├── lib/
│   ├── context.ts              — createContext זוגות (set + get לכל singleton)
│   ├── view-models/            — primary $state classes
│   │   └── derived/            — VoiceMode, ModelStatus
│   ├── engines/                — imperative resource owners
│   ├── adapters/               — I/O wrappers
│   └── actions/                — procedures חוצי-שכבה
└── routes/                     — 7 קבצי .svelte (+ +layout.ts)
    ├── +layout.svelte          — composition root (יוצר VMs + setContext)
    ├── +layout.ts              — ssr=false
    ├── +page.svelte            — /
    ├── chat/+page.svelte       — /chat
    ├── chat/[cliKind]/[sessionId]/+page.svelte
    ├── settings/+page.svelte   — /settings
    ├── bt-test/+page.svelte    — harness
    └── wake-word-test/+page.svelte
```

**`+layout.svelte` הוא המקום** שיוצר את ה-view-models הראשיים (`new X()`).
חריגות שנמדדו: `bt-test/+page.svelte` (`new BtRemoteEngine`), `wake-word-test/+page.svelte` (`new WakeWordVM`), `ChatScreen.svelte` (`new BtRemoteEngine` — חריגה מתועדת מחוק #3).
כל route-מוצר אחר משתמש ב-`getContext()` בלבד.

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

## מצב נוכחי (נמדד 2026-08-29 — הרבה אחרי slice 3)

הכותרת הישנה «slice 3 הושלם / slice הבא = 4» **מיושנת.** עשרות slices אחרי 3 כבר ב-`dev`.
ראה `docs-for-llm/frontend/slices.md` לטבלה — גם היא עלולה להיות מאחור.
<!-- TODO: לאמת איזה slice הוא tip מול slices.md החי -->

✓ שיחה קולית: מיקרופון → STT (Gemini) → sendPrompt → Speaker TTS.
✓ ACP דרך `WsAcpTransport` + `@drive-coding/core/acp`.
✓ i18n: `@drive-coding/core/i18n` + lint (`scripts/lint-no-hebrew-in-code.sh`).
✓ SPA-only (`+layout.ts` עם `ssr=false`).

**Routes** — 7 קבצי `.svelte` תחת `src/routes/` (ועוד `+layout.ts`):
`/` · `/chat` · `/chat/[cliKind]/[sessionId]` · `/settings` · `/bt-test` · `/wake-word-test` · ו-`+layout.svelte`.

**View-models שנוצרים ב-`+layout`:** Settings, I18nVM, AgentSession, Mic, Live, Speaker, VoiceMode (derived), ModelStatus (derived), BubblePlayer, ThemeVM, ResponsiveVM, UiShellVM, ModalsVM, ContentViewerVM, ActiveAgents, RecentProjects, CliAvailability, PresencePoller.

**קיים — אל תבנה מחדש:**
- Settings page — route דק (14 שורות) + `SettingsScreen`.
- Session picker — inline בסיידבר (`SessionOptionsPanel`, מחליף `SessionsDialog`). אין route `/sessions`.
- Bubble polish (slice 4, מאי 2026) — `ThoughtBubble` / `ToolBubble` / `MarkdownContent`.
- Recovery — reconnect-recovery ב-`AgentSession` (`#errorSurfaced`, `preserveContextOnError`).
- Error surface — באנר `role="alert"` ב-`ChatScreen` + `DisconnectBanner`. **אין** רכיב toast (`grep toast` = 0).
- Recordings — adapter `POST /api/recordings` חי; גלריית-replay עדיין לא (הערה ב-`agent-session`: «יתווסף ב-slice 10»).
- CarMode — דגל+טוגל ב-Settings; חיווט ריק (אין צרכן מחוץ לטוגל). `context.ts` עדיין אומר «slice 7 יוסיף כאן».

אל תפתח `/settings` שני, `/sessions`, מערכת-toast, או `POST /api/recordings` שני.

---

## i18n — איך להוסיף מחרוזת חדשה

1. ‎הוסף ‎key ‎ל-`packages/core/src/i18n/keys.ts` (union type `MessageKey`).
2. ‎הוסף ‎ערך ‎ב-`packages/core/src/i18n/catalogs/he.ts` (‎חובה).
3. ‎הוסף ‎scaffold ‎ב-`packages/core/src/i18n/catalogs/en.ts` (יכול ‎להיות ‎אנגלית ‎placeholder).
4. ‎השתמש: ‎`const t = getI18n().t` ‎ב-`<script>`, ‎ואז ‎`{t("your.key")}` ‎ב-markup.
5. ‎הרץ ‎`scripts/lint-no-hebrew-in-code.sh` ‎לוודא ‎שלא ‎הוספת ‎מחרוזת ‎עברית ‎ישירות ‎בקוד.

---

## פקודות

```bash
bun install
bun run --filter @drive-coding/frontend dev          # port: OS-assigned, see startup log
bun run --filter @drive-coding/frontend typecheck
bun run --filter @drive-coding/frontend build
```

ה-BE רץ נפרד על 4000 (`bun run --filter @drive-coding/backend dev`).
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
