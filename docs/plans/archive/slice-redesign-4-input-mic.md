# Slice redesign-4 — Input Toggle + Mic גדול — תוכנית

> **תאריך**: 2026-06-01
> **סטטוס**: טיוטה
> **Complexity**: 6/10 (verifier: light)
> **תלות**: depends_on: [redesign-1, redesign-2]
> **base**: branch `slice-redesign-2-layout-shell` (שרשור — מקביל-לוגית ל-3, אבל בשרשרת סדרתית: base = הקודם בתור)

> **הערה על base בשרשרת סדרתית**: בריצה סדרתית, ה-base בפועל הוא ה-branch של ה-slice שרץ לפניו
> (redesign-3), לא redesign-2. התלות הלוגית היא [1,2] (לא תלוי ב-3), אבל git-wise נגזר מהקצה הנוכחי
> של השרשרת. זה בטוח כי 3 ו-4 נוגעים בקבצים שונים (3=settings, 4=footer/mic). ה-executor יגזור מהקצה.

---

## §0 — Pre-flight

> ⚠️ **brief בשרשרת — אומת מול תכנון, לא מול קוד קיים.** `getResponsive`/AppShell (redesign-2)
> טרם קיימים ב-dev. ה-base חייב להיות ה-branch של ה-slice הקודם בשרשרת (שכבר כולל את 1+2), **לא dev**.
> אם redesign-1+2 טרם בוצעו → עצור. (אביגיל אימתה מול dev tip 80ba325 — שם הקבצים לא קיימים; צפוי.)

### Worktree (שרשור — מהקצה הנוכחי של השרשרת)
```bash
cd /home/user/projects/voice-acp
# base = ה-branch של ה-slice שרץ לפני זה בשרשרת (בד"כ slice-redesign-3-settings)
git worktree add .worktrees/slice-redesign-4-input-mic -b slice-redesign-4-input-mic <branch-של-הקודם>
cd .worktrees/slice-redesign-4-input-mic
pnpm install && pnpm hooks:install
```

### Run / Browser / OneCLI
- FE: `pnpm --filter @drive-coding/frontend-v2 dev`
- **BE חובה** (mic → STT → sendPrompt → TTS צריך OneCLI): `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts`
- Chrome מקומי **עם הרשאת מיקרופון**. בדיקה: toggle הקלדה⇄הקלטה, לחיצה על mic → הקלטה → תמלול → תשובה.
- שם package: `@drive-coding/frontend-v2`.

### Reading list
**must-read**:
- `dev/docs/plans/redesign-vnext-mockup.html` — `RecordFooter` (420-470): toggle הקלטה/הקלדה (432-441),
  mic 110px (447-456), stop button absolute (452-455), type-area (459-466). לוגיקת setMode (914-953):
  crossfade record↔type, מצבי mic (idle/recording/speaking), stop מוצג ב-speaking בלבד.
  mic-card style (176-191): דסקטופ=כרטיס, מובייל=fade. helpers `.mic-rec`/`.mic-speak` (162-163).
- `view-models/derived/voice-mode.svelte.ts` — FSM (idle/recording/transcribing/thinking/speaking/cancelling).
  ה-mic החדש מציג לפי `voiceMode.state` (כמו MicButton הקיים).
- `view-models/mic.svelte.ts` — `mic.toggle()` / `mic.error`.
- `components/chat/MicButton.svelte` + `ChatInput.svelte` — הקוד הקיים שמוחלף.
- `packages/frontend/AGENTS.md` — חוקי זהב.

**reference**: `view-models/agent-session.svelte.ts` — `sendPrompt(text)` (קלט הקלדה).

---

## §1 — מטרה

אזור הקלט (תחתית /chat) נכתב מחדש לפי המוקאפ: toggle שמחליף בין מצב הקלדה (textarea+שליחה) למצב
הקלטה (לחצן mic גדול 110px, פועם באדום בהקלטה / ירוק בהשמעה, עם stop צף). ה-mic תמיד ממורכז
(כפתורי-צד absolute, לא דוחפים). אנימציות crossfade בין המצבים. בדסקטופ ה-footer הוא כרטיס
עולה-מלמטה; במובייל fade מקצה-לקצה. כל זה דרך ה-VoiceMode FSM הקיים — אין שינוי בלוגיקת mic/STT.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| RecordFooter: toggle הקלדה/הקלטה (B1) | ✅ | כאן |
| mic 110px + states idle/recording/speaking (B2) | ✅ | כאן |
| mic תמיד ממורכז + stop צף absolute (B2a/B3) | ✅ | כאן |
| crossfade אנימציות בין מצבים (B4) | ✅ | כאן |
| footer: כרטיס(דסקטופ) / fade(מובייל) — דרך responsive | ✅ | כאן |
| type-mode: textarea + שליחה (reuse לוגיקת ChatInput) | ✅ | כאן |
| **⏮/⏭ navigation** (השמע אחורה/קדימה) | ❌ | slice עתידי (B3 — נמחק מהמוקאפ) |
| **"השמע אחרון" (🔊)** | ❌ | נמחק (החלטת משתמשת) |
| שינוי בלוגיקת Mic/STT/VoiceMode FSM | ❌ | — (משתמש ב-FSM הקיים as-is) |
| audio cues / car mode | ❌ | slice 6 / 7 |

> **קו אדום**: לא נוגעים ב-Mic/VoiceMode/AgentSession. רק UI חדש שצורך את ה-FSM הקיים
> (`voiceMode.state`, `mic.toggle()`, `voiceMode.cancel()`, `session.sendPrompt()`).

---

## §3 — Architecture diagram

```
view-models/input-mode.svelte.ts   ← חדש (InputModeVM: mode "record"|"typing" $state + toggle)
components/chat/RecordFooter.svelte ← חדש (מחליף ChatInput כ-footer; מכיל toggle+mic+type-area)
components/chat/MicLarge.svelte     ← חדש (mic 110px, צבע/אייקון לפי voiceMode.state, stop צף)
components/chat/TypeArea.svelte     ← חדש (textarea+send, reuse לוגיקת ChatInput.onSubmit)
context.ts                          ← additive (setInputMode/getInputMode) — או component-local? ראה §3 הערה
routes/chat/+page.svelte            ← משתנה: <ChatInput/> → <RecordFooter/> (בתוך AppShell content)
i18n/keys.ts + catalogs             ← additive (record/type/mic labels)
```
**מחיקות (חוק זהב #5)**: `ChatInput.svelte` + `MicButton.svelte` — תוכנם נכנס ל-RecordFooter/MicLarge/
TypeArea. מחק, עדכן imports.

> **שאלת VM (חוק זהב #2)**: האם `mode: record|typing` הוא entity? **לא בבירור** — זה UI-state של
> אזור הקלט, חי רק כש-/chat פתוח. **הכרעה: component-local `$state` ב-RecordFooter**, לא VM.
> (אם בעתיד CarMode צריך לכפות mode — אז יהפוך ל-VM. כרגע local.) זה תואם את הטבלה ב-AGENTS.md
> ("ConnectFormState ✗ — $state בroute"). **אל תיצור InputModeVM** אלא אם escalation. תקן את §3:
> `input-mode.svelte.ts` — **לא נוצר**; mode הוא `let mode = $state<"record"|"typing">("record")` ב-RecordFooter.

---

## §4 — Commits

### Commit 1 — i18n keys + MicLarge (approach: manual)
**keys** (בלוק `// ─── record-footer ─── (redesign-4)`): `record.tab.record`, `record.tab.type`,
`record.status.idle`, `record.send`, `record.placeholder`, `mic.stop` (+ reuse `voiceMode.status.*` הקיימים).
**קובץ חדש**: `MicLarge.svelte` — mic 110px (מוקאפ 447-456). צבע/אייקון לפי `voiceMode.state`:
- idle→accent + Mic icon; recording→`.mic-rec` (pulse אדום); speaking→`.mic-speak` + Volume icon;
  transcribing/thinking→spin; cancelling→flash.
- **mapping של state→צבע**: אמץ את ה-state→class של MicButton.svelte הקיים (`.mic-idle`/`.mic-recording`/
  `.mic-speaking`...). **אבל ל-state→אייקון**: MicButton הקיים משתמש ב**אמוג'י** (🎙/⏺/🔊). כאן
  **מחליפים ל-Lucide** (`Mic`/`Square`/`Volume2`/`Loader` ל-spin). אל תעתיק את ה-ICONS map של MicButton —
  בנה חדש עם Lucide. (אביגיל הדגישה: ה-mappings של *צבע* תואמים; ה-*אייקונים* שונים.)
- אייקונים Lucide (`Mic`, `Volume2`, `Square` ל-stop, `Loader2` ל-spin). stop צף absolute, מוצג ב-speaking (מוקאפ 452).
- onClick: כמו MicButton (`voiceMode.cancel()` ב-speaking/thinking; `mic.toggle()` ב-idle/recording).
**Verification**: `typecheck` + `lint:i18n`.

### Commit 2 — TypeArea (approach: manual)
**קובץ חדש**: `TypeArea.svelte` — textarea + send (reuse `ChatInput.onSubmit` logic: trim, sendPrompt,
clear; Enter=שלח, Shift+Enter=שורה). disabled לפי `session.status` כמו היום. Lucide `Send` icon.
**Verification**: `typecheck` + `lint:i18n`.

### Commit 3 — RecordFooter + crossfade (approach: manual)
**קובץ חדש**: `RecordFooter.svelte` (מוקאפ 420-470). `let mode = $state<"record"|"typing">("record")`.
toggle (2 כפתורים). crossfade record-area↔type-area. footer: כרטיס/fade לפי `getResponsive().isMobile`
(מ-redesign-2). מכיל `<MicLarge/>` ו-`<TypeArea/>`.
> **crossfade — שמור על גובה קבוע** (אביגיל): המוקאפ עוטף את שני האזורים ב-wrapper עם `min-height:168px`
> (מוקאפ 443) כדי שהמעבר לא יקפיץ את גובה ה-footer. **שמור על ה-min-height** — שני האזורים ב-grid
> מקונן (`grid place-items-center`) באותו תא, ה-crossfade על opacity. אל תשתמש ב-`{#if}` שמסיר את
> האזור מה-DOM (זה מקריס את הגובה). השתמש ב-opacity/visibility או ב-`{#if}` עם wrapper שמחזיק גובה.
**Verification**: `typecheck` + `build` + `lint:i18n`.

### Commit 4 — חיווט + מחיקת ישנים (approach: manual)
`routes/chat/+page.svelte` — `<ChatInput/>` → `<RecordFooter/>`. מחק `ChatInput.svelte` + `MicButton.svelte`.
**Verification**: `typecheck/build/test/lint:i18n`. ידני: BE+FE, toggle הקלדה⇄הקלטה (crossfade),
mic→הקלטה→תמלול→תשובה→הקראה (mic ירוק+stop). הקלדה→שליחה.

---

## §5 — DoD

| בדיקה | איך |
|---|---|
| typecheck/build/test/i18n נקיים | 4 פקודות |
| toggle הקלדה/הקלטה | 2 כפתורים, מעבר crossfade, האזור הנכון מוצג |
| mic 110px + states | idle=accent, recording=פועם אדום, speaking=ירוק+Volume icon |
| mic ממורכז + stop צף | stop absolute לא דוחף את ה-mic; מוצג ב-speaking בלבד |
| flow קולי שלם | mic→recording→transcribing→thinking→speaking→idle (FSM קיים עובד) |
| הקלדה עובדת | type-mode: כתוב→Enter/שלח→sendPrompt→נשלח |
| footer responsive | דסקטופ=כרטיס; מובייל=fade מקצה-לקצה |
| ChatInput+MicButton נמחקו | קבצים לא קיימים; אין consumer שבור |
| אין InputModeVM | mode הוא $state ב-RecordFooter (לא VM) |
| route < 150 | `wc -l routes/chat/+page.svelte` |

---

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| יצירת VM מיותר ל-mode | חוק זהב #2 | mode = component-local $state. **לא** VM. §3 מפורש. |
| שינוי בטעות ב-VoiceMode FSM | scope creep | המ-mic החדש רק *מציג* את ה-FSM. אם צריך לשנות FSM → escalation. |
| crossfade gotcha (Svelte transition + display) | מוקאפ 921-927 | השתמש ב-Svelte `transition:fade` או `{#if}` עם opacity; אל תחקה את ה-setTimeout הידני של המוקאפ. |
| מחיקת ChatInput/MicButton שוברת consumer | חוק זהב #5 | typecheck. ודא chat/+page מעודכן. |
| Hardcoded Hebrew | hook | t(key) לכל label. |
| stop button RTL positioning | מוקאפ `start-full ms-4` | logical properties (start/ms), לא left/right. |
| mic disabled states | MicButton הקיים | transcribing/cancelling → disabled, כמו היום. |

---

## §7 — Escalation triggers
- צריך לשנות VoiceMode FSM / Mic / AgentSession כדי שה-UI יעבוד → עצור.
- crossfade דורש ספריית-אנימציה חיצונית → עצור (Svelte transitions אמורים להספיק).
- ה-mode (record/typing) מתברר שצריך להישמר/לחצות routes → אז VM, עצור ושאל.

## §8 — Complexity score
**6/10 → light.** commits 4, שכבות: 3 components חדשים (+1), אין API חיצוני חדש (FSM קיים),
crossfade animation (+1), מחיקת 2 קומפוננטות + reuse לוגיקה (+2), responsive footer (+2). ≈6.
בדיקה runtime ויזואלית + flow קולי — light. (mic flow צריך mic פיזי; calev יבדוק ויזואלית את
ה-states, ויסמן את ה-flow הקולי כ-manual אם אין mic.)

## §9 — שאלות פתוחות
| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | mode VM או local? | local $state ב-RecordFooter | ❌ (הוכרע) |
| 2 | crossfade — Svelte transition או opacity {#if}? | transition:fade | ❌ |
| 3 | TypeArea — reuse ChatInput או חדש? | חדש (ChatInput נמחק); העתק את onSubmit logic | ❌ |
