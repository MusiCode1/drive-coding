# Design Principles — drive-coding

> **מעמד:** טיוטה לאישור. מיועד להפוך ל-**מקור-אמת canonical** לעקרונות העיצוב
> והסטנדרטים של הקוד (לא של ה-UX — לזה יש `frontend-spec.md`, ולא של הארכיטקטורה
> רקע התכנון — לזה יש `vnext-planning.md`).
> **נכתב:** 2026-06-01, מתוך review של הקוד החי + 5 מסמכי המקור.
> **קהל יעד:** כל סוכן/אדם שכותב או סוקר קוד בפרויקט. הכתובת **הראשונה** לפני כתיבת קוד.

---

## 0. איך לקרוא את המסמך הזה

מסמך זה **מרכז ומכריע** עקרונות שהיו מפוזרים ולעיתים סותרים על פני 5 מסמכים.
הוא תמציתי בכוונה — לכל נושא יש הצבעה למסמך-העומק.

| שאלה | פנה ל |
|------|-------|
| שכבות, reactivity, state machines, מתי effect | **המסמך הזה (§1-5)** |
| 50 ההחלטות הארכיטקטוניות (D1-D50) | **המסמך הזה (§6)** |
| איך ה-UI נראה ומרגיש (drive-first, צבעים, mic states) | `frontend-spec.md` |
| additive design לקבצים משותפים (עבודה מקבילה) | `conventions/parallel-safe-code.md` |
| רציונל פר-slice (למה הקוד ככה) | `decisions/voice-acp.md` |
| 5 חוקי הזהב של ה-FE (גרסה מקורית) | `packages/frontend/AGENTS.md` |
| רקע תכנון היסטורי (איך הגענו ל-D1-D50) | `vnext-planning.md` (לשעבר `vnext-architecture.md`) |

---

## 1. שכבות ותפקידן — מקור-אמת אחד

### 1.1 שלוש החבילות (packages)

```
core/      — לוגיקה טהורה. אפס IO, אפס browser globals, אפס framework.
backend/   — Hono + adapters. ה-imperative shell של השרת.
frontend/  — SvelteKit drive-first PWA. 5 שכבות (להלן).
```

חוק יסוד (`vnext-planning.md §2.1`): **functional core, imperative shell.**
כל לוגיקה שמחליטה משהו (parsing, routing, state transitions, cache-key derivation)
היא פונקציה טהורה ב-`core/`. ה-IO עוטף דק שקורא ל-core.

**כללי import בין חבילות** (`vnext-planning.md §8.2`):
- `core/` לא מייבא מאף אחד (חוץ מ-deps חיצוניים טהורים: arktype, neverthrow).
- `backend/` מייבא מ-`core/`.
- `frontend/` מייבא מ-`core/` בלבד (לא מ-`backend/`).

> **הבהרה חשובה (בלבלה את ה-planner):** מותר ל-`core/` להחזיק **נתונים סטטיים**
> שקשורים ל-IO, כל עוד הם לא מבצעים IO. דוגמה: `CLI_SPECS` (bin/args של ה-CLIs)
> יושב ב-`core/schemas/agent.ts` — אלו מחרוזות, לא spawn. ה-spawn עצמו (IO) חי
> ב-`backend/`. ההפרדה: *הגדרה סטטית* → core; *resolution תלוי-סביבה* → backend.
> ראה `decisions/voice-acp.md` (2026-06-01, refactor CLIs).

### 1.2 חמש שכבות ה-FE

(מקור: `packages/frontend/AGENTS.md`. כאן — הגרסה ה-canonical התמציתית.)

```
routes/         — shells דקים. composition בלבד. ≤ 150 שורות.
components/     — leaves. props או getContext. ללא business logic. <script> < 50 שורות.
view-models/    — classes עם $state. reactive shell. מייצגים entity דומיין.
  └ derived/    — VMs נגזרים (ראה §4 — הכרעה).
actions/        — procedures חוצי-שכבה (goto, multi-VM, notifications).
engines/        — imperative resource owners (ראה §1.3 — הגדרה חד-משמעית).
adapters/       — I/O. פונקציות שמחזירות Promises.
```

import חד-כיווני (מלמעלה למטה):
- routes → view-models, actions, components
- components → getContext + util בלבד
- view-models → engines, adapters
- engines/adapters → `@drive-coding/core` בלבד

`+layout.svelte` הוא **המקום היחיד** שיוצר instances (`new X()`).
כל route אחר משתמש ב-`getContext()`.

### 1.3 מה זה "engine" כאן — הגדרה חד-משמעית

> **זו הבהרה שבלבלה אפילו את ה-planner.** "engine" בפרויקט הזה הוא **לא**
> shared client/server logic ו**לא** core. הוא ספציפי ל-FE.

**engine = imperative resource owner של ה-FE, browser-only.**

מאפיינים:
- **בעלים של resource של הדפדפן**: `AudioContext`, `MediaRecorder`, `WebSocket`,
  `MediaSource`. הוא זה שיוצר, מחזיק, ומשחרר את ה-resource.
- **imperative, לא reactive**: ה-API שלו הוא מתודות (`start()`, `play()`, `stop()`),
  לא reactive state שצרכנים מאזינים לו. (יוצא דופן: אם ה-engine מחזיק `$state`
  קטן לתצוגה — כמו `Player.state` — זה מותר, אבל ה-state הזה משרת VM, לא לוגיקה.)
- **browser-only**: לא ירוץ ב-SSR/Node. תלוי ב-globals של הדפדפן.
- **לא יודע על framework concepts**: engine לא מכיר "bubbles", "cues", או VMs.
  הוא מקבל callback גנרי אם צריך להודיע החוצה (ראה דוגמת `Player.onPlaybackStart`).

דוגמאות קיימות: `Recorder` (MediaRecorder), `Player` (תזמור ניגון), `AudioStream`
(MediaSource), `WsAcpTransport` (WebSocket).

**ההבדל מ-`core/`:** `core/` הוא ה-shared layer של לוגיקה טהורה (port-able ל-Go).
`engines/` הוא client-only ותלוי-דפדפן. אם לוגיקה ניתנת לשיתוף (למשל טבלת
frequencies, sentence-boundary) — היא יורדת ל-`core/`, לא נשארת ב-engine.

---

## 2. כללי Reactivity (Svelte 5 runes)

### 2.1 הכלים

| Rune | מתי |
|------|-----|
| `$state` | data שמשתנה ומניע UI. שדה ב-VM, או state transient ב-route. |
| `$derived` / `$derived.by` | ערך **נגזר** מ-state אחר, בלי side effect. טהור. |
| `$effect` | side effect כתגובה ל-state. **ברירת המחדל: הימנע** (ראה §2.2). |

### 2.2 ההכרעה המרכזית: מתי `$effect` ומתי מתודה/callback מפורש

> **זו השאלה שהניעה את כתיבת המסמך.** ב-codebase יש את שני הדפוסים, ולא היה
> כלל ברור. ההכרעה:

**ברירת המחדל — העדף מתודה/callback מפורש על `$effect`.**

`$effect` הוא reactive-magic: רץ כש-Svelte מחליט, קשה ל-debug, וסיכון ללולאה
(ראה gotcha 2026-05-16: effect שכותב state שהוא קורא = לולאה אינסופית).
מתודה/callback מפורש = ה-call site נראה, ה-flow לינארי, אין הפתעות.

**הכלל:**

| מצב | פתרון | למה |
|-----|-------|-----|
| ה-transition **ידוע ומקומי** — נקודת-call אחת יודעת מתי הוא קורה | **מתודה / קריאה ישירה / callback** | אין מה לנחש — מי שמשנה את ה-state יודע מתי |
| ה-state **מפוזר ממקורות מרובים**, ואין נקודת-call אחת שיודעת | `$effect` (ממורכז, כתיבות ב-`untrack`) | אין נקודת-trigger אחת — חייבים להאזין |
| ערך **נגזר** מ-state, בלי side effect | `$derived` | זו בדיוק מטרת ה-derived |
| side effect שדורש **DOM node ספציפי** (`bind:this`) | `$effect` ב-**component** שמחזיק את ה-node | הסייג של חוק זהב #4 |

**דוגמאות קונקרטיות מהקוד:**

- ✅ **`Mic.toggle()`** (`mic.svelte.ts`) — transition `idle→recording` ידוע ומקומי.
  הקוד כותב `this.state = "recording"` ישירות במתודה. cue ינוגן בקריאה ישירה
  באותו מקום. **לא** effect.

- ✅ **`Player.#playLoop()`** (`player.svelte.ts`) — המעבר ל-`playing` קורה בנקודה
  אחת. ה-Player חושף callback גנרי (`onPlaybackStart?`) — לא effect חיצוני שמנחש
  מתי הוא התחיל לנגן.

- ✅ **`Speaker`** (`speaker.svelte.ts`) — `$effect.root` יחיד **מוצדק**: ה-Speaker
  מגיב ל-state מ-**שלושה** מקורות (`session.bubbles`, `session.status`, `enabled`)
  בלי נקודת-call אחת. כל הכתיבות ב-`untrack` (gotcha 2026-05-16).

- ✅ **`VoiceMode`** (`derived/voice-mode.svelte.ts`) — `$derived.by` ל-state
  (נגזר מ-3 מקורות) + `$effect` יחיד שמאפס `isCancelling` כשהכל נרגע. ה-effect
  כותב רק `isCancelling = false` ורק כשהתנאי כבר false → אין לולאה.

- ✅ **effects ב-components** (`ChatBubbles` auto-scroll, `VoicePicker`,
  `AgentOptionsPanel`) — מוצדקים: הם צריכים DOM node ספציפי, ולכן ה-effect חי
  ב-component שמחזיק את ה-node (לא ב-route). חוק זהב #4, הסייג.

- ❌ **anti-pattern** (לא קיים בקוד — להימנע): "Cues VM" חיצוני עם `$effect`
  שעוקב אחרי `voiceMode.state` ומנחש איזה cue לנגן. ה-owner של ה-transition
  (Mic/Speaker/Session) יודע בדיוק מתי — שינגן ישירות.

### 2.3 גוטצ'ות Svelte 5 (חובה)

- `$effect` שכותב ל-`$state` שהוא גם **קורא** = לולאה אינסופית. אם חייבים —
  עטוף את הכתיבה ב-`untrack()`. (gotcha 2026-05-16.)
- `$derived` שקורא ל-constructor = instance חדש בכל render. השתמש ב-`$state` +
  `$effect` עם `untrack` שמתעדכן רק כשהמפתח משתנה. (`frontend-spec.md §18`.)
- `$state.snapshot` לא מכבד `toJSON` על object literal. (gotcha 2026-05-17.)

---

## 3. State Machines — נקודת-mutation אחת

> **code smell מזוהה בקוד החי.** `AgentSession.status` נכתב ב-**~10 מקומות
> מפוזרים** על פני 4 מתודות (`attach`, `detach`, `sendPrompt`, `loadSession`),
> ללא setter מרכז. ראה `agent-session.svelte.ts` שורות 94, 115, 132, 136, 144,
> 173, 177, 180, 199, 217, 239, 243.

**הסטנדרט: ל-state machine עם מעברים על פני מתודות מרובות — נקודת-mutation אחת.**

```ts
// במקום this.status = X מפוזר:
#setStatus(next: AgentSessionStatus): void {
  const prev = this.status
  if (next === prev) return
  this.status = next
  // נקודה אחת לכל side-effect-on-transition (cues, logging, metrics)
}
```

יתרונות:
1. **call site אחד** לכל side effect שתלוי ב-transition (audio cue, log, metric).
2. **קל ל-debug** — breakpoint אחד תופס כל שינוי status.
3. **transition guard** במקום אחד (`if (next === prev) return`).

**מתי הכלל חל:** state machine שנכתב על פני 2+ מתודות (כמו `AgentSession`).
**מתי לא חל:** state machine שכל המעברים שלו במתודה אחת (כמו `Mic.toggle` — שם
ה-flow כבר לינארי וגלוי) או ב-loop פנימי אחד (כמו `Player.#playLoop`).

> **הערה:** ה-refactor של `AgentSession` ל-`#setStatus` הוא **INVASIVE** (נוגע
> ב-state writes קיימים) → דורש תיאום עם מרדכי, לא מתבצע במקביל. ראה רשימת
> ה-refactors המומלצים (דוח נפרד).

---

## 4. VM ראשי מול VM נגזר (derived) — הכרעה

> **מצב נוכחי:** קיימת תיקיית `view-models/derived/` עם **דייר אחד** (`VoiceMode`).
> ההפרדה תוכננה אך לא נוסחה ככלל. הכרעה:

**מאמצים את ההפרדה — עם כלל ברור:**

| סוג | הגדרה | דוגמה | סימן מזהה |
|-----|-------|-------|-----------|
| **VM ראשי** | מחזיק `$state` משלו. owner של data דומיין. | `AgentSession`, `Mic`, `Speaker`, `Settings` | יש בו `$state(...)` שהוא **כותב** |
| **VM נגזר** (`derived/`) | לא מחזיק primary state. **נגזר** מ-VMs אחרים דרך `$derived`. | `VoiceMode` | `$derived.by`, מקבל VMs אחרים ב-ctor |

**הכלל:** אם ה-VM **גוזר** את כל ה-state שלו מ-VMs אחרים (כמו `VoiceMode` שנגזר
מ-mic+session+speaker) → הוא שייך ל-`derived/`. מותר לו שדה `$state` קטן יחיד
ל-flag פנימי (כמו `isCancelling`), כל עוד הליבה היא נגזרת.

אם ה-VM מחזיק data ראשי (bubbles, status, voice settings) → הוא VM ראשי, ב-`view-models/`.

> **דחיית האלטרנטיבה "לזנוח":** שקלנו לזנוח את ההפרדה (לשים את VoiceMode ב-VMs
> הרגילים). נדחה — ההפרדה מתעדת כוונה: "זה לא owner של state, אל תוסיף לו data".
> זה שומר על חוק זהב #2 (VM מייצג entity, לא screen).

---

## 5. Parallel-safe / Additive design

מקור-אמת: `conventions/parallel-safe-code.md`. תקציר:

- **Additive only בקבצים משותפים**: הוסף method/variant/key/section. אל תשנה קיים.
- **Section headers** (`// ─── domain ───`): עבוד רק ב-section שלך.
- **שינוי INVASIVE** (signature, state model, rename, סדר init) → **עצור ושאל את
  מרדכי**. דורש commit preparation נפרד, לא רץ במקביל.

הקבצים הרגישים: `context.ts`, `+layout.svelte`, `i18n/keys.ts`, `chat/+page.svelte`,
וכל קובץ ש-2+ slices עתידיים ייגעו בו.

---

## 6. החלטות ארכיטקטוניות (D1-D50)

> **מקור-אמת ל-50 ההחלטות הננעלות.** הועברו לכאן מ-`vnext-planning.md`
> (מסמך התכנון ההיסטורי, לשעבר `vnext-architecture.md`) ב-2026-06-01, כי הן עדיין canonical והקוד מצביע אליהן
> ("see D8", "per D33"). הרקע ההיסטורי — *איך* הגענו אליהן (7 סבבי תכנון עם אבי) —
> נשאר ב-`vnext-planning.md`.

**Scope tags:** `[mvp]` = ב-MVP אצל אבי. `[future]` = vision לעתיד. `[both]` = עיקרון יסוד תקף לשניהם.

| # | Scope | החלטה | הקשר |
|---|-------|-------|------|
| D1 | [both] | TypeScript + Bun ב-backend | אבי מכיר; port עתידי ל-Go אפשרי דרך פונקציונלי |
| D2 | [both] | SvelteKit ב-frontend | אבי בחר במפורש |
| D3 | [both] | Greenfield, לא ריפקטור | "לתכנן את הכל מחדש" |
| D4 | [both] | Worktree לפיתוח מקביל ל-POC | master המשיך לעבוד עד המעבר |
| D5 | [both] | Functional core, imperative shell | לא fp library מלא. ראה §1.1 |
| D6 | [both] | ACP transport מופשט | תמיכה ב-multi-CLI; transport pluggable |
| D7 | [both] | Agent process = entity עצמאית | שורד סגירת דף (ה-bridge ב-D33, לא ה-registry) |
| D8 | [both] | אין DB משלנו | cache בקבצים. agent registry בזיכרון. localStorage ל-prefs. CLI שומר conversation. **מנחה כל החלטת persistence** (ראה דחיית BE-persistence ב-slice 24) |
| D9 | [both] | Backend ו-frontend נפרדים | services נפרדים, API מתועד, types משותפים |
| D10 | [both] | i18n layer מובנה מהתחלה | אפס hardcoded strings (נאכף ב-`lint:i18n`); **שפת ברירת מחדל: עברית** |
| D11 | [future] | אין identity ב-MVP | אבי לבדו. אין auth, אין tokens, אין `ownerId`. אנונימי + tokens רק אם נפתח לכמה משתמשים |
| D12 | [both] | Multi-session מהתחלה | dashboard, routing. ללא identity — כל ה-agents שייכים ל-instance |
| D13 | [both] | שם הפרויקט: `drive-coding` | משקף את היעד — voice-first hands-free. (בפועל ה-repo נשאר `voice-acp`) |
| D14 | [mvp] | Deployment ראשון: Proxmox container + CF tunnel | אצל אבי. ענן ציבורי [future] אם הקהילה תגדל |
| ~~D15~~ | — | ~~ACP transport: stdio בלבד ל-MVP~~ | **מבוטל** ב-D33 |
| ~~D16~~ | — | ~~Agent dies with backend (MVP)~~ | **מבוטל** ב-D23/D33 |
| D17 | [mvp] | Cache: disk בלבד ל-MVP | `/data/cache/{tts,stt,translations}/<hash>.*`. R2/KV ב-[future] |
| D18 | [both] | Pricing: BYOC (Bring Your Own CLI) | משתמש ב-CLI עם המינוי שלו. STT/TTS אצל אבי ב-MVP, BYOK ב-[future] |
| D19 | [both] | UX: כפתור גדול יחיד | start/stop + cancel של model במצב "speaking". ראה `frontend-spec.md §5` |
| D20 | [mvp] | שפות התחלה: עברית בלבד | אנגלית [future] כשירגיש בשל |
| D21 | [both] | Frontend routes: `/`, `/agent/new`, `/agent/:id`, `/settings` | — |
| D22 | [mvp] | אין הקלדה ב-MVP | קולי בלבד. לא נעול — נשקול אחר כך |
| D23 | [both] | bridges שורדים נפילת backend | דרך D33: `--persist --grace-period -1` |
| D24 | [both] | Claude Code דרך `@agentclientprotocol/claude-agent-acp` | adapter רשמי, 1.9k★ |
| ~~D25~~ | — | ~~`@flutur/acp-http-bridge`~~ | **מבוטל** ב-D33 |
| D26 | [future] | התאם WS ל-ACP Streamable HTTP RFD | רלוונטי רק אם נחשוף את ה-bridge בעתיד. ב-MVP ה-FE↔BE protocol שלנו (drive-coding-ws), לא RFD |
| ~~D27~~ | — | ~~neverthrow + Zod~~ | **מעודכן** ב-D31 (ArkType במקום Zod) |
| D28 | [both] | Hexagonal architecture מינימלי | 2 packages (`core` + `backend`). שכבות בתוך `backend/` הן תיקיות. ראה §1.1 |
| ~~D29~~ | — | ~~`voice-coda` כ-reference~~ | **מעודכן** ב-D32 (license missing) |
| ~~D30~~ | — | ~~`acp-bridge` משלנו~~ | **מבוטל** ב-D33 |
| D31 | [both] | ArkType + neverthrow | ביצועים, syntax, מה שאבי כבר משתמש. ראה §1.1 + `AGENTS.md` Conventions |
| D32 | [mvp] | לא להישען על voice-coda — לפנות בנימוס ל-license | בינתיים independent build |
| D33 | [both] | spawn `@rebornix/stdio-to-ws` כ-bridge | npm published, `--persist`, `--grace-period`, Dev Tunnels |
| D34 | [future] | `acp-ui` של formulahendry קיים — awareness | 274★, MIT, alternative client. drive-coding מתמקד במקום אחר (D41) |
| D35 | [mvp] | Audio cues — צלילי feedback | recording_start/stop, thinking, tool_call, error. (מורחב ב-D42; ראה `frontend-spec.md §10`) |
| D36 | [mvp] | Provider catalog ב-UI | `GET /api/providers` + dropdown ב-`/settings` |
| ~~D37~~ | — | ~~SttProvider capability flags~~ | **מבוטל** ב-D38 |
| D38 | [both] | **Vercel AI SDK** כליבת provider abstraction ⭐ | `TranscriptionModelV3`/`SpeechModelV3`/`LanguageModelV3`. 25+ providers רשמיים + custom (D39) |
| D39 | [both] | Custom Gemini transcription provider | AI SDK לא תומך. ~80 שורות. previousAssistantText context |
| D40 | [both] | Hexagonal layer 2 = AI SDK contracts | עדכון D28 |
| D41 | [both] | Build from scratch, לא fork acp-ui | drive-first הוא הייחוד; SvelteKit |
| D42 | [mvp] | Audio cues — 5 צלילים | minimal MVP. theme picker [future]. ראה `frontend-spec.md §10` + slice 6 |
| D43 | [mvp] | Provider scope per-user | ב-`/settings`. per-agent [future] |
| D44 | [mvp] | קונטיינר 134 (voice-coda) נשמר | reference |
| D45 | [both] | Runtime-agnostic: Node 22+ ו-Bun | Hono ל-HTTP/WS (אגנוסטי). `npx drive-coding` ו-`bunx drive-coding` שניהם עובדים |
| D46 | [both] | TDD חלקי — core full, backend partial | core (sentence-boundary, cancel, custom Gemini provider) ב-red-green-refactor. IO-heavy עם integration tests |
| D47 | [both] | Port pure tests מ-v1 | ~96 בדיקות עוברות 1:1 (sentence-boundary, provider-error, markdown, tts-cache, recordings paths). ~193 לא רלוונטיות בגלל D33+D38 |
| D48 | [both] | Vitest כ-test runner | universal Node+Bun. `pnpm workspaces` |
| D49 | [both] | Mock agent ל-integration tests מתוך SDK | `@agentclientprotocol/sdk/src/examples/agent.ts` — ACP-compliant mock מובנה (loopback או spawn child) |
| D50 | [both] | acpx conformance suite ב-CI nightly | `openclaw/acpx/conformance/` — 20 required cases. נריץ נגד ה-AcpTransport שלנו ונגד real adapters ב-nightly |

> **הערה על D45-D50:** במסמך התכנון המקורי הם הופיעו פעמיים (גרסה תמציתית +
> מורחבת) — אוחדו כאן לשורה אחת לכל החלטה.
