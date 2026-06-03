# Brief: slice B — מצב-קלט wake-word ב-RecordFooter + חיבור ל-flow

> סטטוס: brief מוכן לאימות (אביגיל) → executor. complexity: 7/10.
> verifier: calev light.
> **depends_on: [slice-A-status-bubble]** — B מבוסס על A (הבועה החליפה את חיווי-המודל
> בכל שיטות-הקלט; ה-wake-word pane מסתמך על כך שה-footer כבר לא מציג thinking/speaking).
> base: **branch של slice-A** (שרשור — לא dev), כי A טרם מוזג. אם A כבר מוזג ל-dev → base=dev.

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
  במקום auto-play. דרך **action משותף** (ראה §2.3) שגם Mic יכול להשתמש בו (מונע כפילות).

```
RecordFooter toggle:
  record    → MicLarge   (push-to-talk, קיים)
  typing    → TypeArea   (קיים)
  wake-word → VoiceOrb {vm=wakeWord}   ← חדש
  hidden    → 0          (קיים)

WakeWordVM detect#2 → capture.stop() → submitVoiceInput(blob) → session.sendPrompt
                                         (transcribe + sendPrompt, אותו flow כמו Mic)
חיווי-מודל אחרי השליחה → בועת-הסטטוס (מ-slice A), זהה לכל שיטת-קלט.
```

## 2. Commits

### Commit 1 — action משותף submitVoiceInput (refactor Mic + שיתוף)
**`actions/submit-voice-input.ts`** (חדש) — מחלץ את הלוגיקה המשותפת:
- חתימה: `submitVoiceInput(blob: Blob, session: AgentSession, opts?: { previousAssistantText?: string }): Promise<{ ok: boolean; errorKey?: MessageKey }>`
- גוף: `transcribe(blob, opts)` → אם text לא ריק → `session.sendPrompt(text, { recordingId })`.
  מחזיר תוצאה (לא זורק) כדי שכל caller יטפל ב-error לפי דרכו.
- **Mic** (`view-models/mic.svelte.ts` :128-153, `#transcribeAndSend`): שנה לקרוא
  ל-`submitVoiceInput` במקום הלוגיקה הכפולה. שמור על אותה התנהגות (error → `this.error`,
  state → idle). ⚠️ Mic מזריק `previousAssistantText`? בדוק את הקריאה המקורית ושמר.
- testing: **integration** (Mic tests קיימים חייבים לעבור — אותה התנהגות).

### Commit 2 — WakeWordVM: session + flow אמיתי
**`view-models/wake-word.svelte.ts`** — שינויים:
- constructor: הוסף `session: AgentSession` ל-config/opts (מוזרק מ-layout).
- ב-detect#2 (סוף הקלטה): היום בונה blob ו**משמיע אוטומטית** (auto-play setTimeout).
  **החלף** ב: `submitVoiceInput(blob, session)` → ה-blob הולך לסוכן. **הסר** את ה-auto-play
  (`new Audio(url).play()`). ה-currentClipUrl יכול להישאר (debugging) או להוסר — להחלטה.
- error: אם `submitVoiceInput` מחזיר errorKey → `this.lastError = errorKey`.
- ⚠️ ה-cue end (440Hz) נשאר (חיווי "סיימתי להקליט"). חיווי-מודל (thinking…) מגיע מהבועה.
- testing: **integration** (mock session + submitVoiceInput, בדוק שעל detect#2 נקרא
  sendPrompt דרך submitVoiceInput, לא auto-play).

### Commit 3 — context + layout: WakeWordVM singleton
- **`context.ts`**: זוג חדש `// ─── wake-word ───` + `export const [getWakeWord, setWakeWord] = createContext<WakeWordVM>()` (additive — section חדש, parallel-safe).
- **`+layout.svelte`**: צור `new WakeWordVM({ keywords, baseAssetUrl, session })` + `setWakeWord(...)`
  (additive — אחרי שאר ה-VMs; session כבר נוצר שם). keywords = 4 (jarvis/alexa/mycroft/rhasspy),
  baseAssetUrl = `/wake-word/models`.
  ⚠️ **lazy-load**: אל תקרא `load()` ב-layout (טוען ~10MB). ה-load יקרה כשבוחרים את ה-tab
  (§Commit 4). ה-VM נוצר אבל המודלים לא נטענים עד שצריך.
- testing: **manual** (typecheck — ה-wiring).

### Commit 4 — RecordFooter: tab רביעי + VoiceOrb pane
**`components/chat/RecordFooter.svelte`**:
- `type Mode = "record" | "typing" | "wake-word" | "hidden"` (:33).
- כפתור רביעי ב-toggle (אחרי typing, לפני hidden): אייקון (`ear` או `radio` מ-@lucide/svelte)
  + `{t("record.tab.wakeword")}`. אותו דפוס כמו הכפתורים הקיימים (:54-86).
- pane רביעי ב-action-area (אחרי typing pane :102-109): `class:is-active={mode === "wake-word"}`
  עם `<VoiceOrb {vm} />` כאשר `const vm = getWakeWord()`.
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
   RecordFooter שמסנכרן `mode === "wake-word"` ↔ `vm` listening (לפי mode → vm.toggle).
   ⚠️ זהירות מלולאה (gotcha Svelte $effect read+write) — ה-effect קורא mode וכותב ל-vm
   (לא ל-mode), אז בטוח. אבל ודא ש-toggle idempotent.
3. **submitVoiceInput previousAssistantText:** Mic מעביר אותו (להקשר transcribe). wake-word —
   האם יש גישה ל-last assistant text? (session.bubbles אחרון מסוג message). אם לא קריטי —
   אפשר להשמיט ב-wake-word (transcribe עובד גם בלי). להחלטה.
4. **currentClipUrl/logs ב-WakeWordVM:** היו ל-route בדיקה. ב-production לא צריך אותם בהכרח.
   להשאיר (לא מזיק) או לנקות? נטייה: להשאיר את logs מאחורי DEV flag, להסיר auto-play.
   ה-route בדיקה /wake-word-test יכול להישאר כמו שהוא (לא נוגעים בו).

## 5. DoD (calev light)
1. core + frontend-v2 typecheck + build + lint:i18n — נקי.
2. הטסטים הקיימים עוברים (Mic refactor ב-commit 1 לא משנה התנהגות).
3. RecordFooter: 4 tabs. בחירת wake-word → טעינת מודלים (חיווי loading) → VoiceOrb אפור→כחול.
4. אמירת wake word → אדום + cue → דיבור → wake word שוב → cue → **הטקסט נשלח לסוכן**
   (sendPrompt), בועת-הסטטוס (slice A) מציגה thinking→responding→speaking.
5. מעבר ל-tab אחר בזמן wake-word → המיקרופון נכבה (לא נשאר מאזין ברקע).
6. `/wake-word-test` (route בדיקה) עדיין עובד (לא נשבר).
7. `git diff --stat`: submit-voice-input (new), mic, wake-word VM, context, +layout,
   RecordFooter, VoiceOrb (אם loading), i18n.

## 6. out of scope
- בועת-סטטוס (slice A — תלות).
- אימון מילה חדשה.
- CarMode / Settings ל-wake-word.
- wasm CDN→local (known issue נפרד — reference: todo-wake-word-wasm-cdn-vs-local).
- multi-mode בו-זמנית (wake-word + record יחד) — בלעדי בלבד.
