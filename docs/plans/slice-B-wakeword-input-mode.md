# Brief: slice B — מצב-קלט wake-word ב-RecordFooter + חיבור ל-flow

> סטטוס: brief מוכן לאימות (אביגיל) → executor. complexity: 7/10.
> verifier: calev light.
> **depends_on: [slice-A-status-bubble]** — B מבוסס על A (הבועה החליפה את חיווי-המודל
> בכל שיטות-הקלט; ה-wake-word pane מסתמך על כך שה-footer כבר לא מציג thinking/speaking).
> base: **תלוי בסדר הביצוע**:
> - אם A כבר בוצע ומוזג ל-dev → `base=dev`.
> - אם A בוצע ויש branch `slice-A-status-bubble` → `base=slice-A-status-bubble` (שרשור).
> - אם A **טרם בוצע** (קיים רק ה-brief) → **אל תתחיל את B** — B חייב את A קודם.
>   ⚠️ נכון לכתיבה, branch `slice-A-status-bubble` לא קיים — B ממתין ל-A.

## 0. הקשר וסביבה

**מטרה:** להוסיף מצב-קלט רביעי **wake-word** ל-RecordFooter (toggle: record / typing /
wake-word / hidden), עם ה-VoiceOrb כ-pane, ולחבר את זיהוי ה-wake-word ל-flow האמיתי
(transcribe → sendPrompt) — כך שדיבור אחרי wake-word מגיע לסוכן בדיוק כמו push-to-talk.

⚠️ קוד התשתית (WakeWordVM/engine/VoiceOrb) **כבר ב-dev** (slice-wake-word-infra מוזג).
אבל ה-WakeWordVM הנוכחי הוא של ה-route בדיקה: הוא **משמיע אוטומטית** את ההקלטה ו**לא**
קורא ל-transcribe/sendPrompt, ו**לא** מקבל session. brief זה משנה אותו ל-flow אמיתי.

**שם package FE:** `@drive-coding/frontend-v2`.

**worktree (שרשור על A):**
```bash
git worktree add .worktrees/slice-B-wakeword-input -b slice-B-wakeword-input slice-A-status-bubble
cd .worktrees/slice-B-wakeword-input && pnpm install && pnpm hooks:install
```

**מקורות-אמת:** `packages/frontend/AGENTS.md`, מסמך התכנון (branch poc-wake-word:
`docs/plans/input-modes-and-status-bubble-design.md` §4), ה-route בדיקה הקיים
(`routes/wake-word-test/+page.svelte`) כ-reference לחיווט ה-VoiceOrb.

## 1. ארכיטקטורה

- **WakeWordVM** עובר מ-route-מקומי ל-**singleton ב-+layout** (entity, חי בלי תלות
  ב-screen — חוק זהב #2). + context זוג `getWakeWord/setWakeWord`.
- **RecordFooter** מקבל tab רביעי. `mode` נשאר `$state` מקומי ב-component (UI state, §3).
- **חיבור ל-flow**: WakeWordVM, על detect#2 (סוף הקלטה), קורא transcribe→sendPrompt
  במקום auto-play. הלוגיקה (transcribe→sendPrompt) **בתוך WakeWordVM** עצמו (אותו דפוס
  כמו Mic#runTranscribe — VM מייבא adapter transcribe + קורא session.sendPrompt). אין
  helper משותף (ראה הערת §2 — הפרת שכבות).

```
RecordFooter toggle:
  record    → MicLarge   (push-to-talk, קיים)
  typing    → TypeArea   (קיים)
  wake-word → VoiceOrb {vm=wakeWord}   ← חדש
  hidden    → 0          (קיים)

WakeWordVM detect#2 → capture.stop() → transcribe(blob) → session.sendPrompt
                                         (אותה לוגיקה כמו Mic#runTranscribe, בתוך ה-VM)
חיווי-מודל אחרי השליחה → בועת-הסטטוס (מ-slice A), זהה לכל שיטת-קלט.
```

## 2. Commits

> ⚠️ **אין helper משותף / refactor של Mic.** חוקי import (AGENTS.md): `view-models →
> engines, adapters`; `adapters → @drive-coding/core בלבד`. הלוגיקה `transcribe→sendPrompt`
> מערבת adapter (`transcribe`) + view-model (`session.sendPrompt`) — **אף שכבה אחת לא
> רשאית לראות את שתיהן חוץ מ-view-model עצמו**. adapter אסור לו לייבא AgentSession (גם
> type — אין AgentSession ב-core, ואין תקדים). action אסור ל-VM לקרוא לו. לכן הלוגיקה
> **חיה בתוך כל view-model**. Mic כבר מחזיק אותה (`#runTranscribe`) — **לא נוגעים ב-Mic**.
> WakeWordVM מקבל לוגיקה זהה משלו (~6 שורות, כפילות מקובלת — זול מהפרת-שכבות).
> (Commit 1 המקורי — refactor Mic + helper משותף — **בוטל**.)

### Commit 1 — WakeWordVM: session + flow אמיתי
**`view-models/wake-word.svelte.ts`** — שינויים:
- constructor: ⚠️ `WakeWordConfig` הוא **ArkType schema** (`typeof Schema.infer`,
  types.ts:21) — **אי אפשר** לשים בו `AgentSession` (class instance). שנה את חתימת
  ה-ctor ל: `constructor(config: WakeWordConfig, opts?: { session?: AgentSession })`
  (session כפרמטר שני נפרד, לא בתוך ה-schema). ה-`config` ממשיך ל-WakeWordEngine כמו
  היום (:38); ה-session נשמר ב-private field `#session`.
  ⚠️ **חובה אופציונלי** — ה-route בדיקה `routes/wake-word-test/+page.svelte:17` יוצר
  `new WakeWordVM({...})` (config בלבד, בלי opts). ctor שדורש session ישבור את ה-route
  ב-typecheck (DoD#6 — ה-route חייב להמשיך לעבוד). session אופציונלי:
  - **עם** session (production, מ-layout) → detect#2 קורא transcribe→sendPrompt.
  - **בלי** session (route בדיקה) → ההתנהגות הנוכחית נשמרת (auto-play של ה-clip).
- ב-detect#2 (סוף הקלטה): היום בונה blob ו**משמיע אוטומטית** (auto-play setTimeout).
  **שנה ל-מותנה**:
  - **עם** `#session`: `transcribe(blob)` (adapter, מיובא ל-VM כמו ב-Mic) → אם text לא
    ריק → `this.#session.sendPrompt(text, { recordingId })`. אותה לוגיקה כמו
    `Mic#runTranscribe:135-156` (העתק/חקה אותה — VM מותר לייבא adapter ולקרוא ל-VM אחר).
    error → `this.lastError = "mic.error.transcribe"` (או key ייעודי).
  - **בלי** `#session` (route בדיקה): auto-play הקיים נשמר.
- ⚠️ ה-cue end (440Hz) נשאר (חיווי "סיימתי להקליט"). חיווי-מודל (thinking…) מגיע מהבועה.
- testing: **integration** (mock session + transcribe, בדוק שעל detect#2 עם session
  נקרא sendPrompt, ובלי session נשאר auto-play).

### Commit 2 — context + layout: WakeWordVM singleton
- **`context.ts`**: זוג חדש `// ─── wake-word ───` + `export const [getWakeWord, setWakeWord] = createContext<WakeWordVM>()` (additive — section חדש, parallel-safe).
- **`+layout.svelte`**: צור `new WakeWordVM({ keywords, baseAssetUrl }, { session })` + `setWakeWord(...)`
  (config ראשון, opts.session שני — ראה Commit 2)
  (additive — אחרי שאר ה-VMs; session כבר נוצר שם). keywords = 4 **בדיוק כמפתחות
  MODEL_FILE_MAP** (types.ts:30-34): `["hey_jarvis", "alexa", "hey_mycroft", "hey_rhasspy"]`
  (עם `hey_` ל-jarvis/mycroft/rhasspy, בלי ל-alexa). baseAssetUrl = `/wake-word/models`.
  ⚠️ **lazy-load**: אל תקרא `load()` ב-layout (טוען ~10MB). ה-load יקרה כשבוחרים את ה-tab
  (§Commit 3). ה-VM נוצר אבל המודלים לא נטענים עד שצריך.
- testing: **manual** (typecheck — ה-wiring).

### Commit 3 — RecordFooter: tab רביעי + VoiceOrb pane
**`components/chat/RecordFooter.svelte`**:
⚠️ **תלוי ב-Commit 2** — `getWakeWord()` נוצר ב-context.ts רק ב-Commit 2. בצע את
ה-commits בסדר (1→2→3); RecordFooter (קורא getWakeWord) חייב את Commit 2 קודם.
- `type Mode = "record" | "typing" | "wake-word" | "hidden"` (:33).
- כפתור רביעי ב-toggle (אחרי typing, לפני hidden): אייקון (`ear` או `radio` מ-@lucide/svelte)
  + `{t("record.tab.wakeword")}`. אותו דפוס כמו הכפתורים הקיימים (:54-86).
- pane רביעי ב-action-area (אחרי typing pane :102-109) — ⚠️ **חייב את מבנה ה-pane המלא**
  של redesign-4 (לא רק class:is-active): `<div class="record-pane" class:is-active={mode === "wake-word"}>`
  ובתוכו `<div class="record-pane-inner ...">` (אותו דפוס כמו record/typing panes :94-109).
  ה-CSS `.record-pane`/`.record-pane-inner` (:124-161) מטפל באנימציית grid 0fr/1fr —
  ה-pane הרביעי מקבל אותה התנהגות אוטומטית. בתוך ה-inner: `<VoiceOrb {vm} />`.
  `const vm = getWakeWord()`.
  ⚠️ ה-import: `import VoiceOrb from "$lib/components/VoiceOrb.svelte"` — הקובץ ב-
  `components/VoiceOrb.svelte` (**לא** `components/chat/`).
- **lazy-load**: כשנכנסים ל-mode wake-word פעם ראשונה → `vm.load()` (אם טרם נטען).
  `$effect` או onclick. ה-VoiceOrb מציג "loading" עד ready (ה-VM צריך לחשוף flag —
  ראה §4.1).
- ⚠️ **toggle בלעדי**: בחירת wake-word תפעיל האזנה (`vm.toggle()` → listening). מעבר
  ל-tab אחר חייב לכבות (`vm.toggle()` → off) — אחרת המיקרופון נשאר פתוח. ראה §4.2.
- testing: **manual** (ויזואלי + flow).

## 3. i18n (core/i18n)
- `record.tab.wakeword` (לצד `record.tab.record/type/hide` הקיימים).
- `wakeWord.loading` / `wakeWord.ready` (אם VoiceOrb מציג סטטוס טעינה).

## 4. נקודות עדינות

1. **VoiceOrb loading state:** ה-VoiceOrb הנוכחי מקבל `vm` ומצייר לפי mode (off/listening/
   recording). אין לו מצב "loading models". כשבוחרים tab → load() לוקח שניות (~10MB).
   צריך: WakeWordVM חושף `loaded`/`loading` ($state), וה-VoiceOrb/footer מציג חיווי טעינה.
   ⚠️ זה תוספת ל-WakeWordVM + VoiceOrb. בדוק מה ה-VM חושף היום (load() קיים אבל אין flag).
2. **toggle בלעדי בין שיטות-קלט:** היום mode הוא $state מקומי שמחליף panes. עם wake-word,
   מעבר record→wake-word צריך להפעיל האזנה, ו-wake-word→record לכבות. הוסף `$effect` ב-
   RecordFooter שמסנכרן `mode === "wake-word"` ↔ `vm` listening.
   ⚠️ ה-effect קורא mode וכותב ל-vm (לא ל-mode) → בטוח מלולאה.
   ⚠️ **`vm.toggle()` אינו idempotent** (הוא off↔listening flip — קריאה כפולה מחזירה
   למצב הקודם). אל תקרא toggle() ב-$effect ישירות (effect עלול לרוץ שוב). במקום זה:
   קרא לפי היעד המפורש — אם `mode === "wake-word"` ו-`vm.mode === "off"` → toggle();
   אם `mode !== "wake-word"` ו-`vm.mode !== "off"` → toggle(). כלומר guard שמשווה את
   ה-mode הרצוי למצב ה-vm בפועל לפני flip. (או הוסף ל-VM methods מפורשים `startListening()`
   / `stopListening()` idempotent — נקי יותר. להחלטת executor.)
 3. **previousAssistantText — לא רלוונטי:** Mic היום קורא `transcribe(blob)` בלי opts
    (mic.svelte.ts:139), אז גם ב-WakeWordVM בלי. אם בעתיד נרצה להעביר הקשר —
    תוספת נפרדת לשני ה-callers, לא חלק מ-B.
4. **currentClipUrl/logs ב-WakeWordVM:** היו ל-route בדיקה. ב-production לא צריך אותם בהכרח.
   להשאיר (לא מזיק) או לנקות? נטייה: להשאיר את logs מאחורי DEV flag, להסיר auto-play.
   ה-route בדיקה /wake-word-test יכול להישאר כמו שהוא (לא נוגעים בו).

## 5. DoD (calev light)
1. core + frontend-v2 typecheck + build + lint:i18n — נקי.
2. הטסטים הקיימים עוברים (Mic **לא נגעו** — אין refactor; אותה התנהגות).
3. RecordFooter: 4 tabs. בחירת wake-word → טעינת מודלים (חיווי loading) → VoiceOrb אפור→כחול.
4. אמירת wake word → אדום + cue → דיבור → wake word שוב → cue → **הטקסט נשלח לסוכן**
   (sendPrompt), בועת-הסטטוס (slice A) מציגה thinking→responding→speaking.
5. מעבר ל-tab אחר בזמן wake-word → המיקרופון נכבה (לא נשאר מאזין ברקע).
6. `/wake-word-test` (route בדיקה) עדיין עובד (לא נשבר).
7. `git diff --stat`: wake-word VM (flow), context, +layout,
   RecordFooter, VoiceOrb (אם loading), i18n.

## 6. out of scope
- בועת-סטטוס (slice A — תלות).
- אימון מילה חדשה.
- CarMode / Settings ל-wake-word.
- wasm CDN→local (known issue נפרד — reference: todo-wake-word-wasm-cdn-vs-local).
- multi-mode בו-זמנית (wake-word + record יחד) — בלעדי בלבד.
