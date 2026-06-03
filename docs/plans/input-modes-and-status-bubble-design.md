# מסמך תכנון: מצבי-קלט (כולל wake-word) + בועת-סטטוס-מודל

> תאריך: 2026-06-02
> סטטוס: תכנון — לפני brief. **לא ביצוע.**
> תלוי ב: `slice-wake-word-infra` (התשתית — engine/VM/VoiceOrb כבר נבנו).
> מקורות-אמת: `packages/frontend/AGENTS.md`, `RecordFooter.svelte`,
> `voice-mode.svelte.ts`, `agent-session.svelte.ts`, `speaker.svelte.ts`.

## 1. הרעיון המרכזי — שתי הפרדות

הבעיה היום: ה-`VoiceMode` (derived FSM) **מערבב שני דברים שונים**:
- מה ה**קלט/משתמש** עושה: `idle`, `recording`, `transcribing`.
- מה ה**מודל** עושה: `thinking`, `speaking`, `cancelling`.

שתי ההפרדות שהמסמך הזה מתכנן:

**הפרדה A — חיווי-מודל יוצא מאזור-הקלט אל "בועת-סטטוס" בשטף השיחה.**
בסגנון WhatsApp ("typing..."): בועה בתחתית ה-bubbles שמראה מה המודל עושה
("חושב" / "עונה" / "ממתין להקראה" / "מקריא") + לוגו/אנימציה. מנותקת לגמרי
משיטת-הקלט — זהה בין record / typing / wake-word.

**הפרדה B — מצב-קלט רביעי: wake-word.**
ה-toggle ב-RecordFooter (record / typing / hidden) מקבל מצב רביעי **wake-word**,
עם pane משלו (ה-`VoiceOrb` שבנינו: אפור=כבוי, כחול=מאזין, אדום=מקליט). שכפול
מ-record מכוון — החיווי שונה (מאזין-אך-לא-מקליט הוא מצב שלא קיים ב-push-to-talk).

## 2. מצב נוכחי (מה קיים)

- `RecordFooter.svelte`: toggle 3 כפתורים (record/typing/hidden), `mode` = `$state`
  מקומי. 2 panes (MicLarge / TypeArea) בגובה משתנה (grid 0fr/1fr).
- `VoiceMode` (derived): מסכם mic+session+speaker ל-6 מצבים, מניע את MicButton.
- `AgentSession.status`: `idle | connecting | connected | thinking | error`.
- `Speaker.state` (getter נגזר מ-Player): `idle | speaking`. `Speaker.enabled`: boolean.
- תשתית wake-word: `WakeWordVM` (mode off/listening/recording, level, flashCount,
  currentClipUrl, logs), `WakeWordEngine`, `WakeWordCapture`, `VoiceOrb.svelte`.
  קיימים ב-`slice-wake-word-infra` (route בדיקה `/wake-word-test`).

## 3. הפרדה A — בועת-סטטוס-מודל

### 3.1 מה הבועה מציגה (4 מצבים נגזרים)

| מצב בועה | תנאי נגזר | טקסט (i18n) |
|---|---|---|
| **חושב** | `session.status === "thinking"` | "חושב…" |
| **ממתין להקראה** | תשובה הגיעה (status חזר ל-`connected` אחרי thinking) **ו** יש תוכן שטרם הוקרא **ו** `speaker.state === "idle"` (ה-TTS עוד לא התחיל / הקראה ידנית) | "ממתין להקראה" |
| **מקריא** | `speaker.state === "speaking"` | "מקריא…" |
| **מבטל** | `voiceMode.isCancelling` (או מקבילה) | "מבטל…" |
| (אין בועה) | idle מלא — אין thinking/speaking/pending | — |

⚠️ **"ממתין להקראה" הוא state נגזר חדש** — לא קיים היום ב-Speaker. צריך לגזור
אותו: "התקבלה תשובה חדשה שטרם הוקראה". להכרעה ב-brief איך בדיוק מזהים "טרם
הוקרא" (האם Speaker חושף `hasPendingNarration`? או נגזר מ-bubbles האחרון מול
`#bubbleStates`?). זו הנקודה הטכנית העדינה ביותר במסמך.

### 3.2 איפה הבועה חיה (ארכיטקטורה)

- **לא נשמרת ב-`session.bubbles`** — היא transient, נגזרת. כמו ש-WhatsApp לא
  שומר "typing" כהודעה. מתווספת **ויזואלית** בסוף רשימת ה-bubbles.
- שכבה: **component** חדש `StatusBubble.svelte` שמרונדר ב-`ChatBubbles.svelte`
  אחרי ה-`#each bubbles`. קורא getContext (session+speaker+voiceMode).
- ה-state נגזר: או ב-component (אם פשוט), או — עדיף — **VM/derived חדש**
  `ModelStatus` (derived מ-session+speaker+voiceMode) שחושף `phase: "thinking" |
  "pending-tts" | "speaking" | "cancelling" | null` + helper לטקסט. ה-component
  קורא אותו.

> שאלה ל-brief: `ModelStatus` כ-derived VM נפרד (נקי, testable) או חישוב inline
> ב-StatusBubble component? נטייה: derived VM (זה entity-status, חי בלי תלות ב-screen).

### 3.3 מה זה משחרר

ה-footer/MicButton **כבר לא מציגים** thinking/speaking — זה עובר לבועה. ה-`VoiceMode`
הנוכחי אולי מצטמצם (או נשאר ל-MicButton ב-record בלבד). **להכריע ב-brief** אם
מפצלים את VoiceMode או משאירים ומוסיפים לצדו (חוק זהב #5 — או refactor או לא לגעת).

## 4. הפרדה B — מצב-קלט wake-word

### 4.1 ה-toggle הרביעי

`RecordFooter.svelte`: `type Mode = "record" | "typing" | "wake-word" | "hidden"`.
כפתור רביעי (אייקון — `ear`/`radio`?) + pane רביעי שמרנדר `VoiceOrb`.
- ה-`mode` נשאר `$state` מקומי ב-RecordFooter (לפי §3 — לא VM. זה UI state).
- ה-pane הרביעי: `<VoiceOrb {vm} />` כאשר `vm` = ה-`WakeWordVM`.

### 4.2 איפה ה-WakeWordVM חי

בניגוד ל-route הבדיקה (שיצר VM מקומי), כאן זה חלק מה-app:
- `WakeWordVM` נוצר ב-`+layout.svelte` (composition root) + setContext (חוק זהב:
  VM של entity, חי בלי תלות ב-screen). RecordFooter קורא `getWakeWord()`.
- ⚠️ זה **invasive** ל-`context.ts` + `+layout.svelte` (קבצים משותפים — parallel-safe):
  הוספת זוג context `getWakeWord/setWakeWord` ב-section חדש (additive, מותר).

### 4.3 חיבור ל-flow הקיים (קריטי)

כש-wake-word מזהה ומקליט (detect#1→detect#2), התוצאה צריכה להיכנס ל**אותו flow**
כמו record: `transcribe(blob)` → `session.sendPrompt(text)`. כלומר:
- ה-`WakeWordVM` (או action) קורא ל-`transcribe` על ה-WAV ואז ל-`session.sendPrompt`.
- **המודל מגיב זהה** — והבועה (הפרדה A) מציגה thinking/speaking בדיוק כמו ב-record.
- כלומר wake-word = **ערוץ-קלט חלופי** ל-Mic, עם אותו יעד (sendPrompt), אבל חיווי-קלט
  נפרד (VoiceOrb במקום MicLarge).

> שאלה ל-brief: ה-transcribe+sendPrompt — ב-WakeWordVM עצמו, או ב-action משותף
> שגם Mic משתמש בו? נטייה: action משותף `submitVoiceInput(blob)` — מונע כפילות.

### 4.4 מה ה-VoiceOrb מציג (כבר קיים)

אפור (off) / כחול (listening) / אדום (recording) + flash על detect + גודל/גוון לפי
קול. הכל נבנה ב-`slice-wake-word-infra`. כאן רק מחברים אותו ל-footer + ל-flow.

## 5. תרשים סופי

```
┌─ ChatBubbles ───────────────────────────────┐
│  [bubble] [bubble] ... [bubble]              │
│  ┌─ StatusBubble (אם המודל פעיל) ─┐          │  ← הפרדה A
│  │ 🤖 חושב… / ממתין להקראה / מקריא │          │     (מנותק מהקלט)
│  └────────────────────────────────┘          │
└─────────────────────────────────────────────┘
┌─ RecordFooter ──────────────────────────────┐
│  [record][typing][wake-word][hidden]  ← toggle│  ← הפרדה B
│  pane פעיל:                                   │
│   record    → MicLarge (push-to-talk)         │
│   typing    → TypeArea                          │
│   wake-word → VoiceOrb (אפור/כחול/אדום)       │
│   hidden    → 0                                 │
└─────────────────────────────────────────────┘
```

## 6. נקודות פתוחות להכרעה ב-brief

1. **"ממתין להקראה"** — איך מזהים "תוכן התקבל אך טרם הוקרא"? (Speaker חושף flag חדש,
   או נגזר מ-bubbles מול #bubbleStates). הנקודה הטכנית הקשה.
2. **ModelStatus** — derived VM נפרד או inline ב-StatusBubble component?
3. **VoiceMode** — מפצלים (מוציאים thinking/speaking) או משאירים + מוסיפים לצד?
   (חוק זהב #5 — לא לתחזק שתי גרסאות).
4. **submitVoiceInput** — action משותף ל-Mic+WakeWord, או כפילות?
5. **wake-word ↔ record יחד?** — האם אפשר ששניהם פעילים, או toggle בלעדי?
   (כנראה בלעדי — מצב אחד פעיל. להכריע.)
6. **lazy-load מודלים** — לטעון את מודלי ה-wake-word רק כשבוחרים את ה-tab
   (מ-§3 בהכרעות הקודמות — "כשהמשתמש פותח את האפשרות"). כאן זה המימוש.
7. **wasm מ-CDN** — ה-known issue (reference: todo-wake-word-wasm-cdn-vs-local).
   לבדוק אם לפני production צריך local.
8. **אייקון ה-tab של wake-word** + מחרוזות i18n (record.tab.wakeword וכו').

## 7. תכולה / לא-בתכולה

**בתכולה (ה-slice העתידי הזה):**
- StatusBubble + ModelStatus (הפרדה A).
- מצב-קלט wake-word ב-RecordFooter + חיבור WakeWordVM ל-context/layout (הפרדה B).
- חיבור wake-word → transcribe → sendPrompt (אותו flow).

**לא בתכולה:**
- אימון מילה חדשה (drive-coding/עברי).
- CarMode מלא (slice 7).
- Settings UI ל-wake-word.
- שינוי ה-wasm ל-local (known issue נפרד).

## 8. תלות ומיקום

- מבוסס על `slice-wake-word-infra` (חייב merge ל-dev קודם, או base ממנו).
- נוגע בקבצים משותפים (context.ts, +layout.svelte, ChatBubbles, RecordFooter) →
  parallel-safe additive. שינוי ב-VoiceMode = invasive → עצירה/החלטה.
- ככל הנראה זה **2 slices נפרדים** (A ו-B עצמאיים יחסית), או slice אחד עם 2 חלקים.
  להכריע בכתיבת ה-brief.
