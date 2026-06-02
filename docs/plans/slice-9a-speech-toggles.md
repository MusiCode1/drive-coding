# Slice 9a — Speech Toggles + Voice Picker UI — ‏תוכנית

> **‏תאריך**: 2026-06-01
> **‏סטטוס**: ❌ DISCARDED (2026-06-02, החלטת משתמשת) — ‏מומש בצורה אחרת במהלך ה-redesign.
>   ‏3 ה-toggles (speakThoughts/narrateTools/translateThoughts) + VoicePicker + לוגיקת
>   ‏translateDisabled קיימים ב-dev: `Settings VM` (229-260) + `SettingsScreen.svelte`
>   ‏(72/78-90). ‏אומת מול dev tip 718be28. ‏ה-brief מיותר. ‏ראה decisions/voice-acp.md.
> **Complexity**: 3/10 (verifier: calev light)
> **‏תלויות (`depends_on`)**: [] — ‏בנוי ישירות על dev. ‏(slice 6 audio-cues **‏לא** ‏תלות — ‏ראה §2.)
> **‏Base**: dev
> **‏Dev tip**: `7859964`

---

## §0 — Pre-flight

### ‏תלויות (‏חובה!)

‏slice זה **‏אין לו תלויות** — ‏בנוי ישירות על dev (tip `7859964`).

‏הקבצים שהוא נוגע בהם כבר merged ל-dev:
- ‏`Settings` VM (slice 0.5 + 9 voice fields) — ‏קיים.
- ‏`Speaker` VM (slice 22 — tool narration + thought translate pipeline) — ‏קיים.
- ‏`/settings` route (slice 15b — beUrl) — ‏קיים, ‏יורחב.
- ‏`VoicePicker.svelte` component (slice 9, layout-agnostic) — ‏קיים, ‏יעבור reuse.

> ‏slice 6 (audio cues) **‏אינו** ‏תלות. ‏slice 9a לא נוגע ב-`CuesEngine`. ‏ה-toggles ‏של ה-cues
> ‏(volume / per-cue mute) ‏שייכים ל-slice 9b ‏שיבוא **‏אחרי** slice 6. ‏ראה §2.

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-9a-speech-toggles -b slice-9a-speech-toggles dev
cd .worktrees/slice-9a-speech-toggles
pnpm install && pnpm hooks:install
```

### ‏איך להריץ

| ‏מה | ‏פקודה |
|---|---|
| ‏BE (לבדיקה ידנית — ‏צריך OneCLI ל-translate/narrate/voices) | `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` |
| ‏FE | `pnpm --filter @drive-coding/frontend-v2 dev` |
| ‏tests | `pnpm --filter @drive-coding/frontend-v2 test` |
| ‏typecheck | `pnpm --filter @drive-coding/frontend-v2 typecheck` |
| ‏build | `pnpm --filter @drive-coding/frontend-v2 build` |
| ‏i18n lint | `pnpm lint:i18n` |

> **‏הערה על שם ה-package**: ‏ה-`package.json` ‏של ה-FE עדיין `@drive-coding/frontend-v2`
> ‏(ה-cutover ל-`frontend` ‏הוא slice 13). ‏השתמש ב-`frontend-v2` ‏בפקודות `pnpm --filter`.

> **‏למה צריך OneCLI לבדיקה ידנית**: ‏ה-toggles משפיעים על pipeline ‏שעובר דרך BE proxy
> ‏(translate=Gemini, narrate=Gemini, TTS=ElevenLabs, voices=ElevenLabs). ‏בלי OneCLI כל
> ‏הקריאות יחזירו 401/400 ‏ולא תוכל לאמת את ההתנהגות. ‏ה-voice picker דורש `GET /v1/voices`.

### Browser

‏Chrome רגיל מקומי. ‏בדיקה ידנית: ‏שלח פרומפט שמייצר מחשבות (thoughts) ‏וקריאות כלים (tools),
‏ושמע איך כל toggle משנה את ההקראה.

### OneCLI agent

- ‏שם: `voice-acp`
- ‏מזריק: `xi-api-key` ‏ל-ElevenLabs, `x-goog-api-key` ‏ל-Gemini. ‏לא מזריק Anthropic (מכוון).

### Reading list

**must-read** (~‎10 דקות):

1. ‏`packages/frontend/AGENTS.md` — 5 ‏חוקי זהב + ‏מבנה 5 ‏שכבות. **‏במיוחד חוק #4** (side effect ‏אצל owner של ה-state) ‏ו**‏חוק #1** (routes הם shells דקים, ‏ספיק 150 ‏שורות).
2. ‏`docs/conventions/parallel-safe-code.md` §1, §4 — additive only, ‏קטלוגי i18n append-only.
3. ‏`packages/frontend/src/lib/view-models/settings.svelte.ts` — ‏ה-VM ‏שמוסיפים אליו (הערת ה-additive בראש הקובץ ‏היא ה-checklist המדויק).
4. ‏`packages/frontend/src/lib/view-models/speaker.svelte.ts` — ‏שורות 183-341 ‏(ה-pipeline ‏שצריך לקצר לפי ה-toggles).

**reference** (‏בזמן עבודה):

- ‏`packages/frontend/src/lib/components/chat/VoicePicker.svelte` — ‏component מוכן ל-reuse ב-`/settings`.
- ‏`packages/frontend/src/routes/settings/+page.svelte` — ‏ה-route שמרחיבים.
- ‏`packages/core/src/i18n/catalogs/he.ts` + `en.ts` + `keys.ts` — ‏הוספת מפתחות.
- ‏`packages/frontend/src/lib/view-models/settings.test.svelte.ts` — ‏פטרן הטסטים ל-Settings.

---

## §1 — ‏מטרה

‏אחרי slice 9a: ‏האישה נכנסת ל-`/settings` ‏(דרך ה-⚙️ ‏ב-ChatHeader) ‏ורואה 3 ‏מתגים (toggles)
‏שנשמרים בין sessions: ‏(1) **‏הקראת מחשבות** — ‏האם להקריא את ה-thoughts ‏של הסוכן בקול;
‏(2) **‏קריינות כלים** — ‏האם להקריא תיאור קולי של קריאות הכלים; ‏(3) **‏תרגום מחשבות** —
‏האם לתרגם את המחשבות לעברית לפני ההקראה (‏ה-toggle מנוטרל ב-UI ‏כשהקראת מחשבות כבויה,
‏כי אין מה לתרגם). ‏בנוסף, ‏בורר הקול (voice picker) ‏עובר ל-`/settings` ‏כך שאפשר לבחור קול
‏גם מתוך עמוד ההגדרות. ‏כל שינוי משפיע מיד על ה-Speaker — ‏המחשבות/כלים מפסיקים/חוזרים להישמע
‏בלי refresh.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| 3 ‏שדות `$state` ‏שמורים ‏ב-`Settings` (speakThoughts, narrateTools, translateThoughts) | ✅ | ‏Commit 0 |
| 3 ‏toggles ‏ב-`/settings` (checkboxes) + voice picker | ✅ | ‏Commit 2 |
| ‏Speaker מכבד את 3 ‏ה-toggles (‏דילוג על thought/tool/translate) | ✅ | ‏Commit 1 |
| ‏נטרול-UI ‏של toggle התרגום ‏כשהקראת מחשבות כבויה | ✅ | ‏Commit 2 |
| ‏Voice picker ‏ב-`/settings` (reuse של ה-component הקיים) | ✅ | ‏Commit 2 |
| ‏Cue volume slider / per-cue mute | ❌ | ‏slice 9b (‏אחרי slice 6) |
| ‏`CuesEngine.enabled` ‏toggle | ❌ | ‏slice 9b (‏אחרי slice 6) |
| ‏Locale override (he/en) | ❌ | ‏future (‏slices.md §locale) |
| ‏cliKind / lastCwd ‏ב-UI (כבר ב-AgentOptions panel) | ❌ | ‏slice 23 (‏קיים) |

> **‏החלטת מרדכי על cue toggles**: ‏ה-toggles של ה-cues ‏(slice 9 ‏המקורי הזכיר "audio cues toggles")
> ‏**‏נדחים ל-9b** ‏כי slice 6 (שמייצר את ה-`CuesEngine`) ‏עדיין לא merged. ‏אין על מה לקשור toggle.
> ‏slice 9a ‏מתמקד בשלושת ה-**‏speech** ‏toggles + voice picker — ‏כולם נשענים על קוד שכבר merged.

---

## §3 — Architecture

```
+layout.svelte (composition root — ‏ללא שינוי)
  │  const settings = new Settings()   ← ‏כבר קיים, ‏3 ‏שדות חדשים פנימה
  │  const speaker = new Speaker({ session, settings })  ← ‏כבר מקבל settings
  ▼
Settings VM  (view-models/settings.svelte.ts)        [Commit 0]
  + speakThoughts     = $state(true)   ← ‏שמור (persisted)
  + narrateTools      = $state(true)   ← ‏שמור
  + translateThoughts = $state(true)   ← ‏שמור
  + setSpeakThoughts / setNarrateTools / setTranslateThoughts (setters → #persist)
  ▲ ‏(קריאה reactive)
  │
Speaker VM  (view-models/speaker.svelte.ts)          [Commit 1]
  │  ה-$effect ‏הקיים ‏כבר קורא this.#session.bubbles + this.enabled.
  │  ‏מוסיף קריאה של 3 ‏ה-flags (‏reactive) → ‏מעביר ל-#processBubbles / #processToolBubbles / #fetchJob:
  ├─ #processBubbles:     ‏אם !speakThoughts → ‏דלג על bubble.kind==="thought"
  ├─ #handleStatusTransition: ‏אם !speakThoughts → ‏אל תפלוש buffer של thought
  ├─ #processToolBubbles: ‏אם !narrateTools → ‏סמן processed + ‏דלג (‏אל תיצור job)
  └─ #fetchJob (thought): ‏אם !translateThoughts → ‏דלג על translate(), ‏הקרא טקסט מקורי
  ▼
/settings/+page.svelte  (route shell)                [Commit 2]
  + 3 <input type="checkbox"> ‏מחוברים ל-settings.set*
  + <VoicePicker />  (reuse — ‏layout-agnostic)
  + translateThoughts checkbox: disabled={!settings.speakThoughts}
```

**‏עיקרון ארכיטקטוני (‏חוק זהב #4 + ‏הערת Speaker שורה 15-16)**: ‏ה-state ‏של ההעדפות שייך ל-`Settings`
‏(entity ‏של העדפות, ‏persisted ל-localStorage). ‏ה-`Speaker` **‏קורא** ‏את ה-flags מ-`this.#settings`
‏בתוך ה-`$effect` ‏הקיים שלו (‏שכבר עוקב אחרי `bubbles` + `enabled`). ‏זה owner-correct: ‏ה-Speaker
‏הוא ה-owner של החלטת "‏מה להקריא"; ‏ה-Settings ‏הוא ה-owner של "‏מה ההעדפה השמורה". ‏אין VM ‏חדש,
‏אין engine חדש, ‏אין `$effect` ‏חדש — ‏רק תוספת flags ל-VM קיים + ‏branching ב-pipeline קיים.

‏קבצים שמשתנים:

| ‏קובץ | ‏שינוי | ‏סוג |
|---|---|---|
| ‏`src/lib/view-models/settings.svelte.ts` | 3 ‏שדות ל-`Persisted` + `DEFAULTS` + 3 `$state` + 3 setters + ‏עדכון `#persist` ‏ו-ctor. ‏לפי ה-checklist בראש הקובץ. | Additive |
| ‏`src/lib/view-models/speaker.svelte.ts` | ‏קריאת 3 ‏flags ב-`$effect` + ‏העברתם ל-3 ‏המתודות + branching | **‏Invasive-קל** (‏ראה §3 הערה) |
| ‏`src/routes/settings/+page.svelte` | 3 ‏checkboxes + VoicePicker section | Additive (route shell — ‏ספיק 150 ‏שורות) |
| ‏`packages/core/src/i18n/keys.ts` | 6 ‏מפתחות חדשים (`settings.speech.*` + `settings.voice.label`) | Additive (append) |
| ‏`packages/core/src/i18n/catalogs/he.ts` | 6 ‏ערכים | Additive (append ‏בבלוק settings) |
| ‏`packages/core/src/i18n/catalogs/en.ts` | 6 ‏ערכים | Additive |

> **‏הערת parallel-safe על Speaker (invasive-קל, ‏מאושר)**: ‏ה-`$effect` ‏הקיים כבר קורא `bubbles`
> ‏ו-`enabled`. ‏הוספת קריאה של 3 ‏flags ‏היא additive ל-tracked-reads. ‏ה-branching ‏בתוך המתודות
> ‏(`#processBubbles` ‏וכו') **‏לא מוסיף/מסיר state** ‏ולא משנה את ה-effect structure — ‏רק מוסיף
> ‏`if (!flag) skip`. ‏אין worktree מקביל שנוגע ב-Speaker כרגע → ‏מאושר. ‏ה-executor **‏לא** ‏משנה את
> ‏לוגיקת ה-`untrack` / ‏את ה-OrderAllocator / ‏את ה-LOOKAHEAD. ‏אם מתגלה צורך לשנות את מבנה ה-effect
> ‏עצמו — **‏עצור ושאל את מרדכי** (§7).

---

## §4 — Commits ‏בסדר

### Commit 0 — Settings: 3 ‏persisted flags (approach: **tdd**)

‏לוגיקה טהורה ב-VM (persist + load) — ‏הטסטים הקיימים ‏ב-`settings.test.svelte.ts` ‏הם התבנית.

**‏קבצים שמשתנים**:
- ‏`packages/frontend/src/lib/view-models/settings.svelte.ts`
- ‏`packages/frontend/src/lib/view-models/settings.test.svelte.ts` (‏הוסף טסטים)

**‏שינוי מדויק** (‏לפי ה-checklist בראש הקובץ, ‏שורות 6-13):

1. ‏ל-`Persisted` (‏שורה 24-29) ‏הוסף **‏בסוף**:
   ```ts
   speakThoughts: boolean
   narrateTools: boolean
   translateThoughts: boolean
   ```
2. ‏ל-`DEFAULTS` (‏שורה 31-40) ‏הוסף **‏בסוף**:
   ```ts
   speakThoughts: true,
   narrateTools: true,
   translateThoughts: true,
   ```
3. ‏בלוק domain חדש במחלקה (‏אחרי בלוק "‏שרת" ‏שורה 75, ‏לפני ה-ctor):
   ```ts
   // ─── דיבור ───
   speakThoughts = $state<boolean>(DEFAULTS.speakThoughts)
   narrateTools = $state<boolean>(DEFAULTS.narrateTools)
   translateThoughts = $state<boolean>(DEFAULTS.translateThoughts)
   ```
4. ‏ב-ctor (‏שורות 77-84) ‏הוסף **‏אחרי** `this.beUrl = loaded.beUrl`:
   ```ts
   this.speakThoughts = loaded.speakThoughts
   this.narrateTools = loaded.narrateTools
   this.translateThoughts = loaded.translateThoughts
   ```
5. ‏בלוק setters חדש (‏אחרי setters של "‏שרת", ‏לפני "‏פרטי" ‏שורה 154):
   ```ts
   // ─── דיבור ───

   setSpeakThoughts = (v: boolean): void => {
     this.speakThoughts = v
     this.#persist()
   }

   setNarrateTools = (v: boolean): void => {
     this.narrateTools = v
     this.#persist()
   }

   setTranslateThoughts = (v: boolean): void => {
     this.translateThoughts = v
     this.#persist()
   }
   ```
6. ‏ב-`#persist()` (‏שורה 156-163) ‏הוסף לאובייקט הנשמר **‏בסוף**:
   ```ts
   speakThoughts: this.speakThoughts,
   narrateTools: this.narrateTools,
   translateThoughts: this.translateThoughts,
   ```

**Tests** (‏הוסף ל-`settings.test.svelte.ts`, ‏בתבנית הקיימת):

1. ‏ברירת מחדל: `new Settings()` ‏עם localStorage ריק → ‏שלושת הדגלים `=== true`.
2. ‏`setSpeakThoughts(false)` → `s.speakThoughts === false` ‏וגם נשמר ב-localStorage (‏parse → `speakThoughts: false`).
3. ‏`setNarrateTools(false)` → ‏אותו דבר עבור `narrateTools`.
4. ‏`setTranslateThoughts(false)` → ‏אותו דבר עבור `translateThoughts`.
5. ‏`new Settings()` ‏קורא דגלים שמורים: ‏מלא localStorage עם `{ speakThoughts: false, narrateTools: false, translateThoughts: false }` (‏+ ‏שאר השדות) → ‏הדגלים נטענים `false`.
6. ‏Backward-compat: localStorage ‏ישן בלי הדגלים החדשים (‏רק `cliKind`/`voiceId`/`beUrl`) → ‏הדגלים נופלים ל-`DEFAULTS` (‏true) ‏דרך ה-`{ ...DEFAULTS, ...parsed }` ‏הקיים בשורה 47.

> **‏הערה לטסט 6**: ‏זה ה-critical-path. ‏ה-merge `{ ...DEFAULTS, ...(parsed) }` ‏בשורה 47 ‏כבר מטפל
> ‏ב-backward-compat אוטומטית — ‏הטסט מוודא שזה אכן עובד עבור הדגלים החדשים (‏משתמשת קיימת לא
> ‏מאבדת הגדרות, ‏ומקבלת true ‏כברירת מחדל).

**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 test
pnpm --filter @drive-coding/frontend-v2 typecheck
```

---

### Commit 1 — Speaker ‏מכבד את ה-flags (approach: **manual**)

> ‏זה ה-commit ה-invasive-קל. ‏branching ב-pipeline קיים. ‏ראה §3 הערת parallel-safe.

**‏קובץ שמשתנה**: `packages/frontend/src/lib/view-models/speaker.svelte.ts`

**(א) ‏קריאת ה-flags ב-`$effect`** (‏בתוך הבלוק "‏קריאות (נעקבות)", ‏אחרי שורה 121 `const enabled = this.enabled`):
```ts
// slice 9a: ‏העדפות הקראה (reactive — ‏שינוי toggle מפעיל מחדש את ה-effect)
const speakThoughts = this.#settings.speakThoughts
const narrateTools = this.#settings.narrateTools
// translateThoughts ‏נקרא ‏בתוך #fetchJob (‏async, ‏לא חלק מה-tracked reads כאן)
```

**(ב) ‏העברת ה-flags ל-untrack block** (‏שורות 145-150): ‏עדכן את שלוש הקריאות:
```ts
untrack(() => {
  this.#processBubbles(bubbles, enabled, isLoadingHistory, speakThoughts)
  this.#processToolBubbles(bubbles, isLoadingHistory, narrateTools)
  this.#handleStatusTransition(status, enabled, speakThoughts)
  this.#prevStatus = status
})
```

**(ג) ‏`#processBubbles`** (‏שורה 183) — ‏הוסף param `speakThoughts: boolean` ‏לחתימה. ‏בתוך הלולאה
‏הרגילה (‏לא ה-isLoadingHistory branch — ‏שם תמיד מסמנים processed), ‏אחרי שורה 206
‏(`if (bubble.kind !== "message" && bubble.kind !== "thought") continue`), ‏הוסף:
```ts
// slice 9a: ‏הקראת מחשבות כבויה → ‏סמן מעובד ‏ודלג (‏בלי TTS job).
if (bubble.kind === "thought" && !speakThoughts) {
  let state = this.#bubbleStates.get(bubble.id)
  if (state === undefined) {
    state = { processedSegments: 0, buffer: "" }
    this.#bubbleStates.set(bubble.id, state)
  }
  state.processedSegments = bubble.segments.length
  state.buffer = ""
  continue
}
```
> ‏**‏למה לסמן processed ‏ולא רק `continue`**: ‏אם המשתמשת תדליק את ה-toggle באמצע (‏reactive), ‏לא
> ‏רוצים שכל ההיסטוריה של ה-thought שכבר עברה תיכנס פתאום לתור. ‏סימון `processedSegments` ‏מבטיח
> ‏שרק מקטעים **‏חדשים** ‏אחרי ההדלקה ייכנסו — ‏עקבי עם הטיפול ‏ב-`!enabled` (‏שורה 222-226).

**(ד) ‏`#handleStatusTransition`** (‏שורה 242) — ‏הוסף param `speakThoughts: boolean`. ‏בלולאת ה-flush
‏(‏שורה 247-254), ‏אחרי שורה 251 (`if (bubble.kind !== "message" && bubble.kind !== "thought") continue`),
‏הוסף:
```ts
// slice 9a: ‏אל תפלוש buffer של thought כשהקראת מחשבות כבויה.
if (bubble.kind === "thought" && !speakThoughts) {
  state.buffer = ""
  continue
}
```

**(ה) ‏`#processToolBubbles`** (‏שורה 348) — ‏הוסף param `narrateTools: boolean` ‏לחתימה (‏אחרי `isLoadingHistory`).
‏בתוך הלולאה, ‏אחרי שורה 353 (`if (bubble.kind !== "tool") continue`) ‏ו**‏אחרי** ‏שליפת `tc` (‏שורה 354),
‏הוסף:
```ts
// slice 9a: ‏קריינות כלים כבויה → ‏סמן processed ‏ודלג (‏בלי narrate/TTS).
if (!narrateTools) {
  this.#processedNarrationCallIds.add(tc.toolCallId)
  continue
}
```
> ‏**‏למה לסמן processed**: ‏אותו רציונל כמו (ג) — ‏אם תדליק toggle אחר כך, ‏לא רוצים שכל הכלים
> ‏ההיסטוריים יקראו פתאום. ‏רק כלים **‏חדשים** ‏אחרי ההדלקה ינוסחו.

**(ו) ‏`#fetchJob` — translate gate** (‏שורה 294, ‏בתוך `if (job.kind === "thought")` ‏שורה 298):
‏החלף את שורה 298-307 ‏כך שה-translate מותנה ב-flag:
```ts
if (job.kind === "thought") {
  // slice 9a: ‏תרגום מחשבות מותנה ב-toggle. ‏כבוי → ‏הקרא טקסט מקורי (‏אנגלית).
  if (this.#settings.translateThoughts) {
    const result = await translate(text, TARGET_LANG, job.abort.signal)
    if (result !== null && result.status === "translated") {
      if (job.bubbleId !== undefined) {
        this.#persistThoughtTranslation(job.bubbleId, job.text, result.text)
      }
      text = result.text
    }
    // already_in_target ‏או null → ‏שמור טקסט מקורי
  }
} else if (job.kind === "tool") {
  // ... ‏(‏ללא שינוי)
}
```
> ‏**‏הערה**: `this.#settings.translateThoughts` ‏נקרא ‏בתוך `#fetchJob` ‏(async, ‏לא ב-`$effect`).
> ‏זו קריאה רגילה לשדה — ‏לא צריך tracking כאן (‏ה-job כבר נוצר; ‏ה-flag נקרא ברגע ה-fetch).
> ‏זה התנהגות נכונה: ‏toggle התרגום משפיע על jobs ‏שמתבצעים מרגע השינוי, ‏לא רטרואקטיבית.

**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 build
pnpm --filter @drive-coding/frontend-v2 test    # ‏ודא שטסטי speaker/core קיימים לא נשברו
```

‏בדיקה ידנית (browser, ‏עם BE+OneCLI):
- ‏כבה "‏הקראת מחשבות" → ‏שלח פרומפט שמייצר thoughts → ‏המחשבות **‏לא** ‏נשמעות (‏אבל מוצגות בבועות).
- ‏כבה "‏קריינות כלים" → ‏הסוכן קורא כלי → ‏אין קריינות קולית.
- ‏כבה "‏תרגום מחשבות" (‏עם הקראת מחשבות דלוקה) → ‏המחשבות נשמעות **‏באנגלית** ‏(‏הטקסט המקורי).

---

### Commit 2 — `/settings` UI: 3 ‏toggles + voice picker (approach: **manual**)

**‏קובץ שמשתנה**: `packages/frontend/src/routes/settings/+page.svelte`

‏הוסף ‏ל-`<form>` ‏הקיים (‏אחרי ה-`<label>` ‏של beUrl, ‏שורה 55) ‏section חדש. ‏מבנה:

```svelte
<!-- slice 9a: ‏העדפות דיבור -->
<fieldset class="speech">
  <legend>{t("settings.speech.legend")}</legend>

  <label class="toggle">
    <input
      type="checkbox"
      checked={settings.speakThoughts}
      onchange={(e) => settings.setSpeakThoughts(e.currentTarget.checked)}
    />
    <span>{t("settings.speech.speakThoughts")}</span>
  </label>

  <label class="toggle">
    <input
      type="checkbox"
      checked={settings.narrateTools}
      onchange={(e) => settings.setNarrateTools(e.currentTarget.checked)}
    />
    <span>{t("settings.speech.narrateTools")}</span>
  </label>

  <label class="toggle" class:disabled={!settings.speakThoughts}>
    <input
      type="checkbox"
      checked={settings.translateThoughts}
      disabled={!settings.speakThoughts}
      onchange={(e) => settings.setTranslateThoughts(e.currentTarget.checked)}
    />
    <span>{t("settings.speech.translateThoughts")}</span>
  </label>
  <span class="help">{t("settings.speech.translateThoughts.help")}</span>

  <label class="voice">
    <span class="label">{t("settings.voice.label")}</span>
    <VoicePicker />
  </label>
</fieldset>
```

‏ב-`<script>`: ‏הוסף `import VoicePicker from "$lib/components/chat/VoicePicker.svelte"`.

> **‏נטרול-UI ‏של toggle התרגום**: `disabled={!settings.speakThoughts}` ‏על ה-input + ‏`class:disabled`
> ‏על ה-label ‏(‏לעמעום ויזואלי). ‏כשהקראת מחשבות כבויה — ‏אין מה לתרגם, ‏אז ה-toggle ‏מנוטרל.
> ‏**‏לא מאפסים** ‏את ערך `translateThoughts` ‏כשמנטרלים — ‏הוא נשמר, ‏וחוזר פעיל ‏כשמדליקים שוב
> ‏הקראת מחשבות. ‏(reactive: ‏שינוי `speakThoughts` ‏מעדכן את ה-`disabled` ‏מיד.)

‏הוסף ל-`<style>` (‏המשך לסגנון הקיים):
```css
fieldset.speech {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}
legend { font-weight: 600; padding: 0 0.4rem; }
.toggle {
  flex-direction: row;
  align-items: center;
  gap: 0.6rem;
  cursor: pointer;
}
.toggle.disabled { opacity: 0.5; cursor: default; }
.voice { gap: 0.4rem; }
```

> **‏חוק זהב #1 (route shell ≤150 ‏שורות)**: ‏אחרי התוספת ה-route עדיין מתחת ל-150 ‏שורות
> ‏(‏הקובץ הנוכחי 110, ‏התוספת ~45 ‏markup + ~15 ‏css = ‏~170 ‏**‏סה"כ** — ‏חורג מעט). **‏אם חורג מ-150
> ‏שורות בקובץ ה-svelte**: ‏חלץ component `SpeechSettings.svelte` ‏ל-`$lib/components/settings/`
> ‏(‏leaf — getContext + checkboxes + VoicePicker, ‏בלי business logic) ‏וה-route רק `<SpeechSettings />`.
> ‏זו ההעדפה ‏אם חורג. ‏(‏ה-`<style>` ‏לא נספר ב-"‏שורות route" ‏אבל ה-150 ‏הוא heuristic — ‏אם ה-`<script>`+markup
> ‏גדל בהרבה, ‏חלץ.)

**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 build
pnpm lint:i18n
```

‏בדיקה ידנית (browser): ‏פתח `/settings` ‏דרך ה-⚙️ ‏ב-ChatHeader → ‏רואה 3 ‏checkboxes + voice picker.
‏סמן/בטל → ‏refresh → ‏המצב נשמר (localStorage). ‏כבה "‏הקראת מחשבות" → ‏toggle התרגום מתעמעם ומנוטרל.

---

### Commit 3 — i18n + walkthrough (approach: **manual**)

**‏קבצים שמשתנים**:

‏`packages/core/src/i18n/keys.ts` — ‏הוסף ‏ל-union `MessageKey` (‏אחרי `"settings.back"`, ‏שורה 86):
```ts
| "settings.speech.legend"
| "settings.speech.speakThoughts"
| "settings.speech.narrateTools"
| "settings.speech.translateThoughts"
| "settings.speech.translateThoughts.help"
| "settings.voice.label"
```
> ‏(6 ‏מפתחות. ‏`settings.voice.label` ‏הוא חדש; ‏`chat.voicePicker.label` ‏הקיים נשאר ל-aria-label ‏בתוך ה-component.)

‏`packages/core/src/i18n/catalogs/he.ts` — ‏הוסף ‏בבלוק `// ─── settings ───` (‏אחרי שורה 75 `"settings.back"`):
```ts
"settings.speech.legend": "העדפות דיבור",
"settings.speech.speakThoughts": "הקראת מחשבות",
"settings.speech.narrateTools": "קריינות כלים",
"settings.speech.translateThoughts": "תרגום מחשבות לעברית",
"settings.speech.translateThoughts.help": "כשהקראת מחשבות כבויה, אין מה לתרגם.",
"settings.voice.label": "קול",
```

‏`packages/core/src/i18n/catalogs/en.ts` — ‏אותם מפתחות, ‏ערכים באנגלית:
```ts
"settings.speech.legend": "Speech preferences",
"settings.speech.speakThoughts": "Read thoughts aloud",
"settings.speech.narrateTools": "Narrate tool calls",
"settings.speech.translateThoughts": "Translate thoughts to Hebrew",
"settings.speech.translateThoughts.help": "When reading thoughts is off, there is nothing to translate.",
"settings.voice.label": "Voice",
```

> **‏ודא איזון קטלוגים**: `he.ts` ‏ו-`en.ts` ‏חייבים אותם מפתחות בדיוק (‏ה-`Catalog` ‏type ‏אוכף).
> ‏typecheck ‏ייכשל אם חסר מפתח בקטלוג אחד.

**‏walkthrough + slices.md**:
- ‏`docs/walkthrough.md` — entry על slice 9a (3 ‏speech toggles + voice picker ב-settings).
- ‏`packages/frontend/docs/slices.md` — ‏עדכן את שורה 64 (slice 9): ‏ציין ש-9a ‏הושלם (speech toggles + voice picker), ‏9b (cue toggles) ‏ממתין ל-slice 6.
- ‏`docs/plans/slice-9a-speech-toggles.md` (‏זה) — ‏סטטוס → "‏הושלם".

**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 build
pnpm lint:i18n
pnpm --filter @drive-coding/frontend-v2 test
```

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|---|---|
| 1 | typecheck + build + tests ‏ירוקים | `pnpm --filter @drive-coding/frontend-v2 typecheck && ... build && ... test` |
| 2 | lint:i18n ‏נקי | `pnpm lint:i18n` |
| 3 | 3 ‏דגלים default `true`, ‏שמורים ל-localStorage | ‏Test (Commit 0 טסטים 1-4) |
| 4 | Backward-compat: localStorage ‏ישן → ‏דגלים = `DEFAULTS` | ‏Test (Commit 0 טסט 6) |
| 5 | `/settings` ‏מציג 3 ‏checkboxes + voice picker | ‏ידני: ‏פתח `/settings`, ‏ספור 3 ‏checkboxes + `<select>` |
| 6 | toggle התרגום מנוטרל ‏כש"‏הקראת מחשבות" ‏כבוי | ‏ידני: ‏כבה speakThoughts → ‏ה-checkbox של translate מעומעם + `disabled` ב-DOM |
| 7 | ‏הקראת מחשבות כבויה → ‏thoughts ‏לא נשמעים (‏אך מוצגים) | ‏ידני (browser+BE+OneCLI): ‏כבה → ‏פרומפט עם thoughts → ‏אין TTS למחשבות |
| 8 | ‏קריינות כלים כבויה → ‏אין קריינות tool | ‏ידני: ‏כבה → ‏קריאת כלי → ‏אין narration קולי |
| 9 | ‏תרגום כבוי (‏הקראה דלוקה) → ‏מחשבות נשמעות באנגלית | ‏ידני: ‏כבה translate → ‏thought נשמע במקור |
| 10 | ‏שמירה: ‏שינוי toggle → refresh → ‏נשמר | ‏ידני: ‏סמן, ‏refresh, ‏ערך נשמר |
| 11 | regression: voice picker ‏ב-`/` ‏עדיין עובד | ‏ידני: ‏פתח `/`, ‏בחר קול, ‏עובד |
| 12 | regression: ‏הקראה רגילה (messages) ‏לא נשברה | ‏ידני: ‏פרומפט רגיל → ‏התשובה נשמעת בעברית כרגיל |
| 13 | mobile + desktop | screenshot ‏של 2 ‏viewports ‏של `/settings` |

---

## §6 — Risks + mitigations

| # | ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|---|
| 1 | Hardcoded Hebrew strings | pre-commit hook | ‏כל ה-UI strings ‏דרך `t(key)`. ‏6 ‏מפתחות חדשים (Commit 3). `pnpm lint:i18n` ‏ב-DoD. |
| 2 | Svelte 5: `$effect` ‏reactivity על flags | gotcha 2026-05-16 | ‏ה-flags ‏נקראים ‏ב-`$effect` ‏הקיים (read של `$state`) → ‏tracked אוטומטית. ‏אין effect חדש. ‏translateThoughts ‏נקרא ב-`#fetchJob` (async, ‏לא tracked — ‏מכוון). |
| 3 | Backward-compat: ‏משתמשת קיימת מאבדת הגדרות | localStorage merge | ‏`{ ...DEFAULTS, ...parsed }` (‏שורה 47, ‏קיים) ‏כבר מטפל. ‏טסט 6 ‏מוודא. |
| 4 | ‏סימון processed שגוי → ‏thoughts ‏נבלעים אחרי הדלקה | reactivity | ‏סימון `processedSegments = segments.length` ‏עקבי עם טיפול `!enabled` ‏(‏שורה 222). ‏רק מקטעים חדשים אחרי הדלקה נשמעים. ‏בדיקה ידנית DoD 7. |
| 5 | route ‏חורג מ-150 ‏שורות (‏חוק זהב #1) | scope | ‏אם חורג → ‏חלץ `SpeechSettings.svelte` (‏ראה Commit 2 הערה). |
| 6 | `disabled` ‏על input ‏לא מעדכן reactive | Svelte | `disabled={!settings.speakThoughts}` — ‏`settings.speakThoughts` ‏הוא `$state` → ‏reactive. ‏בדיקה ידנית DoD 6. |
| 7 | ‏קטלוגי he/en ‏לא מאוזנים → typecheck נכשל | Catalog type | ‏הוסף את 6 ‏המפתחות ל-**‏שני** ‏הקטלוגים באותו commit. typecheck ב-DoD. |
| 8 | OneCLI placeholder (BE proxy) | learnings 2026-05-14 | ‏לא רלוונטי — ‏slice 9a ‏לא נוגע ב-BE/SDK. ‏ה-pipeline הקיים (translate/narrate/tts) ‏לא משתנה, ‏רק מדלגים עליו. |

> 3 ‏שתמיד נשכחים: (1) ‏Hardcoded strings → ‏i18n ✅ סיכון 1. (2) ‏Reactivity gotchas ✅ סיכונים 2,6. (3) ‏OneCLI placeholder ✅ סיכון 8 (‏לא רלוונטי).

---

## §7 — Escalation triggers

‏עצור ושאל את מרדכי (parent task) ‏אם:

1. ‏הקריאה של ה-flags ‏ב-`$effect` ‏של Speaker ‏דורשת שינוי במבנה ה-effect / ‏ה-`untrack` / ‏ה-OrderAllocator — ‏מעבר להוספת tracked-reads ‏ו-params למתודות.
2. ‏סימון ה-processed ‏(commit 1 ‏ג/ה) ‏מתנגש עם ‏ה-isLoadingHistory branch ‏בצורה לא צפויה (‏thoughts ‏נבלעים גם כשה-toggle דלוק).
3. ‏ה-route ‏חורג מ-150 ‏שורות **‏וגם** ‏חילוץ ה-component ‏מסתבך (‏צריך לקרוא ל-action ‏או business logic — ‏לא אמור).
4. ‏מתגלה שה-`Speaker` ‏לא ה-owner היחיד של החלטת ההקראה (‏יש מסלול שני שמקריא thoughts/tools ‏מחוץ ל-`#processBubbles`/`#processToolBubbles`).
5. ‏ה-brief ‏סותר את עצמו, ‏או ‏שמיקום שורה שצוין ‏לא תואם את הקוד בפועל (‏הקוד זז מ-`7859964`).

‏אחרת: ‏החלט סבירות, ‏רשום ‏ב-commit message, ‏המשך.

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|---|---|
| Cross-store data flow (Settings→Speaker — ‏כבר קיים, ‏רק 3 ‏flags) | +1 |
| Streaming/real-time (‏נוגע ב-TTS pipeline אבל ‏רק מדלג) | +1 |
| Refactor של קוד קיים (‏branching ב-Speaker — ‏invasive-קל) | +1 |
| >5 files ‏ב->2 packages (frontend + core i18n) | +1 |
| State machine / async coordination | 0 |
| ‏ספרייה חיצונית חדשה | 0 |
| Pure logic ‏ב-Settings (Commit 0) | -1 |
| TDD מלא ב-Commit 0 (‏tests מקיפים, ‏תבנית קיימת) | -1 |
| Greenfield UI (route ‏פשוט, checkboxes) | -1 |
| **‏Score** | **‎3 / 10** |

**Tier**: 0-3 → `calev` (Sonnet, mode: light) ‏בלבד. ‏אין verifier-phase.

**‏הצדקה**: ‏הסליס נשען כולו על קוד merged (Settings + Speaker + VoicePicker), ‏ה-Commit ‏היחיד
‏ה-invasive (1) ‏הוא branching ‏פשוט (`if (!flag) skip`) ‏ב-3 ‏נקודות מפורשות. ‏אין state חדש, ‏אין effect
‏חדש, ‏אין protocol. ‏הסיכון העיקרי הוא reactivity (‏מכוסה בטסטים + ‏בדיקה ידנית) ‏ו-route-bloat
‏(‏מכוסה בחוק זהב #1). ‏calev light ‏עם דגש על: ‏(א) ‏3 ‏ה-toggles ‏אכן משנים את ההקראה בפועל
‏(‏שמיעתי), ‏(ב) ‏שמירה ל-localStorage, ‏(ג) ‏נטרול ה-UI, ‏(ד) ‏אין רגרסיה בהקראה רגילה.

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏האם default ‏לשלושת הדגלים `true`? | ‏כן — ‏ההתנהגות הנוכחית (‏הכל מוקרא) ‏היא ה-default. | ❌ |
| 2 | ‏האם "‏תרגום כבוי" ‏צריך לעדכן גם את ‏ה-bubble display (‏להציג רק אנגלית)? | ‏לא — ‏ה-display ‏לא משתנה ‏ב-9a. ‏רק ה-**‏הקראה** ‏מושפעת. ‏ה-`#persistThoughtTranslation` ‏לא נקרא ‏כשלא מתרגמים, ‏אז ה-bubble ‏ממילא מציג מקור. | ❌ |
| 3 | ‏Voice picker ‏ב-`/settings` — ‏להסיר מ-`/` (connect) ‏או להשאיר בשניהם? | ‏להשאיר בשניהם — ‏ה-component ‏layout-agnostic, ‏ה-Settings ‏singleton, ‏אין כפילות state. ‏ב-connect ‏נוח לבחור קול לפני התחברות. | ❌ |
| 4 | ‏cue toggles (slice 9 ‏המקורי) | ‏נדחה ל-9b ‏אחרי slice 6 (§2) | ❌ |

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor ‏תוך כדי)

- ...
