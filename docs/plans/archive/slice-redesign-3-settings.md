# Slice redesign-3 — Settings/Options Redesign (+ בולע 9a) — תוכנית

> **תאריך**: 2026-06-01
> **סטטוס**: טיוטה
> **Complexity**: 7/10 (verifier: light)
> **תלות**: depends_on: [redesign-1, redesign-2]
> **base**: branch `slice-redesign-2-layout-shell` (שרשור)
> **בולע**: slice 9a (speech toggles) — ראה §1.5. 9a לא יבוצע בנפרד.

---

## §0 — Pre-flight

> ⚠️ **brief בשרשרת — אומת מול תכנון, לא מול קוד קיים.** קבצי redesign-2 (AppShell,
> SessionOptionsPanel, ResponsiveVM) ו-redesign-3 (Bits ui-wrappers) **טרם קיימים ב-dev**. ה-brief
> בנוי על הקצה של השרשרת. אם redesign-2 (ו-1) טרם בוצעו → **עצור, אי-אפשר להתחיל.** ה-base חייב
> להיות ה-branch של ה-slice הקודם בשרשרת, **לא dev**. (אביגיל אימתה את ה-brief מול dev tip 80ba325,
> שם הקבצים האלה לא קיימים עדיין — זה צפוי; האימות האמיתי הוא בזמן הביצוע.)

### Worktree (שרשור)
```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-redesign-3-settings -b slice-redesign-3-settings slice-redesign-2-layout-shell
cd .worktrees/slice-redesign-3-settings
pnpm install && pnpm hooks:install
```
> ⚠️ base = `slice-redesign-2-layout-shell`. צריך את AppShell + SessionOptionsPanel מ-redesign-2.

### Run / Browser / OneCLI
- FE: `pnpm --filter @drive-coding/frontend-v2 dev`
- **BE חובה** (Switch של speech toggles משפיע על pipeline translate/narrate; voice picker צריך `/v1/voices`):
  `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (port 4000)
- Chrome מקומי. בדיקה: שלח פרומפט שמייצר thoughts+tools, שמע איך כל toggle משנה הקראה.
- שם package: `@drive-coding/frontend-v2`.

### ⚠️ הכרעת component-lib — כאן נסגרת
זה ה-slice הראשון שצריך **Switch** (toggles) ו-**Select** (dropdowns מעוצבים). לפי decisions
ההמלצה היא **Bits UI**. **לפני Commit 1 — ודא עם מרדכי שההכרעה Bits UI סגורה.** אם כן:
`pnpm --filter @drive-coding/frontend-v2 add bits-ui`. אם Bits נלחם ב-RTL על Select → fallback
ל-native `<select>` מעוצב ב-Tailwind (ראה §7). ה-Switch — אפשר גם custom (helper `.toggle` כבר
במוקאפ/app.css מ-redesign-1) אם Bits Switch מסורבל. **תעד מה נבחר ב-decisions.**

### Reading list
**must-read**:
- `dev/docs/plans/redesign-vnext-mockup.html` — `SettingsScreen` (584-650): כרטיסי "חיבור" ו-"קול
  ודיבור", 4 toggles (הקראת מחשבות / קריינות כלים / תרגום מחשבות / מצב רכב), כפתורי איפוס+שמור.
- `dev/docs/plans/slice-9a-speech-toggles.md` — **הלוגיקה של 3 ה-toggles** (speakThoughts/narrateTools/
  translateThoughts) שנבלעת לכאן. §4 שלו מתאר בדיוק איפה Speaker קורא כל flag. אמץ את הלוגיקה,
  עצב לפי המוקאפ.
- `dev/docs/decisions/voice-acp.md` — entries: "redesign vNext", "redesign-3" (Bits UI), "slice 9a".
- `packages/frontend/AGENTS.md` — חוקי זהב + i18n.
- Bits UI Svelte 5 docs (Switch, Select) — דרך Context7 או bits-ui.com. **קרא לפני שכותב**.

**reference**:
- `view-models/settings.svelte.ts` — מבנה Persisted + DEFAULTS + setters (תבנית הוספת שדה ב-header).
- `components/chat/VoicePicker.svelte` — layout-agnostic select, reuse.
- `components/chat/AgentOptionsPanel.svelte` — model/mode/configOptions (ימוזג ל-SessionOptionsPanel).
- `view-models/speaker.svelte.ts` — איפה ה-3 flags נצרכים (getters מ-Settings).

---

## §1 — מטרה

מסך ההגדרות (`/settings`) נכתב מחדש לפי המוקאפ: כרטיסים מרווחים ("חיבור": תיקייה+מודל+session;
"קול ודיבור": בורר קול + 4 toggles), גדול ונוח למגע במובייל, Switch ו-Select מעוצבים. בתוך כך
נבלעת הפונקציונליות של slice 9a — 3 toggles אמיתיים (הקראת מחשבות / קריינות כלים / תרגום מחשבות)
שמחווטים ל-Settings ול-Speaker, + toggle מצב-רכב (placeholder ל-slice 7). בנוסף, ה-dropdowns של
סוכן/מודל/חשיבה (היום ב-AgentOptionsPanel) עוברים ל-SessionOptionsPanel (sidebar/sheet) ומחווטים.

## §1.5 — בליעת slice 9a (חשוב)

9a תוכנן עם `base: dev` ועיצוב toggles בסיסי. כדי **לא לעצב toggles פעמיים** (פעם ב-9a CSS גלם,
פעם כאן מחדש ב-Bits/Tailwind), 9a **נבלע לכאן**. הלוגיקה זהה (Settings fields + Speaker getters),
העיצוב לפי המוקאפ. 9a לא יבוצע כ-slice נפרד — מסומן superseded ב-decisions.

ה-3 שדות (מ-9a §4): `speakThoughts`, `narrateTools`, `translateThoughts` — כולם default `true`,
persisted ב-Settings. ה-Speaker קורא אותם כ-getters ומקצר pipeline (if !flag skip). toggle התרגום
disabled ב-UI כשהקראת-מחשבות כבויה (לא מאפסים ערך).

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| SettingsScreen redesign (כרטיסים, מגע) לפי מוקאפ | ✅ | כאן |
| 3 speech toggles (9a) — Settings fields + Speaker getters + UI Switch | ✅ | כאן (בלע 9a) |
| VoicePicker מעוצב מחדש (Select) + העברה ל-/settings | ✅ | כאן |
| dropdowns סוכן/מודל/חשיבה ב-SessionOptionsPanel (מיזוג AgentOptionsPanel) — מחווט | ✅ | כאן |
| Bits UI Switch + Select (או fallback native) | ✅ | כאן |
| toggle מצב-רכב — **UI placeholder בלבד** (Settings field, לא מחווט ל-CarMode) | ✅ | כאן (חיווט מלא: slice 7) |
| **cue toggles** (volume/per-cue mute) | ❌ | slice 9b (אחרי slice 6 merge) |
| **CarMode engine/Bluetooth** | ❌ | slice 7 |
| Dialog/Sheet primitives (folder picker, sessions popup) | ❌ | redesign-6 |
| **רשימת סשנים אמיתית** ב-SessionOptionsPanel | ❌ | redesign-6 |

> **קו אדום**: toggle מצב-רכב הוא placeholder — שדה Settings + Switch, **בלי** לגעת ב-CarMode/Bluetooth.

---

## §3 — Architecture diagram

```
view-models/settings.svelte.ts   ← additive: 4 שדות (speakThoughts/narrateTools/translateThoughts/carMode)
                                    + setters + Persisted + DEFAULTS (כל ברירת-מחדל true, carMode false)
view-models/speaker.svelte.ts    ← משתנה: קורא 3 flags כ-getters מ-settings, מקצר pipeline (9a §4)
components/settings/             ← חדש
  SettingsScreen.svelte          — כרטיסים (מוקאפ 584-650). מרונדר ב-routes/settings/+page.svelte
  SettingToggle.svelte           — Switch (Bits או custom .toggle) + label, מחובר ל-Settings field
  SettingsCard.svelte            — כרטיס wrapper (כותרת uppercase + body)
components/ui/                   ← חדש (אם Bits): wrappers דקים
  Switch.svelte / Select.svelte  — עטיפת Bits עם סגנון הפרויקט (או native fallback)
components/layout/SessionOptionsPanel.svelte  ← משתנה: מחווט dropdowns (מ-AgentOptionsPanel) — model/mode/config
routes/settings/+page.svelte     ← משתנה: מרנדר <SettingsScreen> (במקום beUrl form הישן)
routes/chat/+page.svelte         ← משתנה: AgentOptionsPanel מוסר (תוכנו עבר ל-SessionOptionsPanel)
i18n/keys.ts + catalogs          ← additive: מפתחות settings.* חדשים
```

**מחיקות (חוק זהב #5)**: `AgentOptionsPanel.svelte` — תוכנו עובר ל-SessionOptionsPanel, מוחק.
`VoicePicker` — **אל תמחק!** הוא בשימוש ב-`routes/+page.svelte:92` (connect route). אמתה אביגיל.
**reuse את VoicePicker** בתוך SettingsScreen (הוא layout-agnostic — עוטף בכרטיס). אם רוצים Select
מעוצב בסגנון Bits — עדיף **לעדכן את VoicePicker עצמו** ל-Bits (משרת את שני המקומים), לא ליצור כפיל.

---

## §4 — Commits

### Commit 1 — Settings fields (9a data) (approach: TDD-able)
**קבצים שמשתנים**: `settings.svelte.ts` — הוסף ל-`Persisted`: `speakThoughts/narrateTools/
translateThoughts: boolean` + `carMode: boolean`. ל-`DEFAULTS`: 3 ראשונים `true`, carMode `false`.
שדות `$state` + setters (כל setter קורא `#persist()`), בבלוק domain חדש `// ─── דיבור ───` + `// ─── רכב ───`.
**Verification**: `typecheck`. (אם יש settings.test — הוסף assertion ל-defaults/persist.)

### Commit 2 — Speaker reads flags (9a logic) (approach: manual + בדיקה ידנית)
**קבצים שמשתנים**: `speaker.svelte.ts` — לפי 9a §4: speakThoughts/narrateTools ב-enqueue
(skip אם כבוי; סימון processedSegments מונע בליעה אחרי הדלקה), translateThoughts ב-#fetchJob (async).
**API**: ה-Speaker כבר מקבל `settings` בconstructor — קורא `this.#settings.speakThoughts` וכו'.
**Verification**: `typecheck` + `test`. ידני: BE+FE, פרומפט עם thoughts/tools, toggle כל flag → הקראה משתנה.
> **קרא את 9a §4 בדיוק** — שם מתואר איפה כל flag נכנס ולמה processedSegments חשוב (מונע בליעה).

### Commit 3 — Bits UI (או fallback) + ui wrappers (approach: manual)
**אחרי אישור מרדכי על Bits.** `pnpm add bits-ui`. צור `components/ui/Switch.svelte` +
`components/ui/Select.svelte` — עטיפות דקות עם סגנון הפרויקט (Tailwind). אם Bits נלחם → native fallback.
**Verification**: `typecheck` + `build`. proof: Switch אחד מרונדר ועובד (toggle).

### Commit 4 — SettingsScreen + toggles UI (approach: manual)
**קבצים חדשים**: `components/settings/SettingsScreen.svelte`, `SettingsCard.svelte`, `SettingToggle.svelte`.
מבנה מוקאפ 584-650: כרטיס "חיבור" (תיקייה+כפתור בחר[placeholder ל-redesign-6]+מודל+session),
כרטיס "קול ודיבור" (Select קול + 4 SettingToggle). כפתורי איפוס+שמור.
4 ה-toggles מחווטים: speakThoughts/narrateTools/translateThoughts (Settings) + carMode (placeholder).
translateThoughts disabled כש-!speakThoughts.
**i18n keys חדשים** (בלוק `// ─── settings-redesign ─── (redesign-3)`): `settings.connection`,
`settings.voiceSpeech`, `settings.folder.label`, `settings.folder.pick`, `settings.model.label`,
`settings.session.label`, `settings.toggle.speakThoughts`, `settings.toggle.narrateTools`,
`settings.toggle.translateThoughts`, `settings.toggle.carMode`, `settings.reset`, `settings.saveOpen`.
(he.ts חובה + en.ts placeholder.)
**קבצים שמשתנים**: `routes/settings/+page.svelte` → `<SettingsScreen/>`. מחק VoicePicker אם הוחלף.
**i18n**: מפתחות חדשים. **Verification**: `typecheck/build/lint:i18n`. ידני: /settings מעוצב, toggles עובדים+נשמרים.

### Commit 5 — SessionOptionsPanel חיווט dropdowns (approach: manual)
**קבצים שמשתנים**: `SessionOptionsPanel.svelte` — חווט את 3 ה-dropdowns (סוכן/מודל/חשיבה) מתוך
הלוגיקה של `AgentOptionsPanel` (model/mode/configOptions, `session.applyConfigOption`). השתמש ב-Select.
`routes/chat/+page.svelte` — הסר `<AgentOptionsPanel/>`. מחק `AgentOptionsPanel.svelte`.
**Verification**: `typecheck/build/test/lint:i18n`. ידני: connect → אפשרויות בסיידבר/שיט עובדות (החלפת מודל).

---

## §5 — DoD

| בדיקה | איך |
|---|---|
| typecheck/build/test/i18n נקיים | 4 פקודות ירוקות |
| SettingsScreen מעוצב | /settings: 2 כרטיסים, שדות גדולים-למגע, לפי מוקאפ |
| 3 speech toggles עובדים+נשמרים | toggle כל אחד → reload → נשמר. BE: השפעה על הקראה (thoughts/tools/translate) |
| translateThoughts disabled לוגית | כבה הקראת-מחשבות → toggle תרגום disabled, ערך לא מתאפס |
| carMode placeholder | toggle קיים+נשמר, **לא** מפעיל CarMode (slice 7) |
| voice picker מעוצב | Select קול ב-/settings, נטען מ-ElevenLabs, בחירה נשמרת |
| dropdowns ב-sidebar/sheet | connect → החלפת מודל/סוכן עובדת (applyConfigOption) |
| AgentOptionsPanel נמחק | הקובץ לא קיים; chat/+page לא מייבא אותו; אין כפילות |
| Bits/fallback מתועד | decisions: מה נבחר (Bits Switch/Select או native) |
| route < 150 | `wc -l routes/settings/+page.svelte` + `routes/chat/+page.svelte` |

---

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| Bits UI RTL issues על Select | component-lib פתוח | fallback native styled select. בדוק RTL מוקדם ב-Commit 3 proof. |
| בליעת thoughts אחרי הדלקת toggle | 9a §4 | processedSegments מסומן גם כשכבוי → הדלקה לא בולעת. **קרא 9a §4 בדיוק.** |
| מיזוג AgentOptionsPanel שובר model/mode flow | slice 23 | העתק הלוגיקה (flattenSelectOptions, applyConfigOption) ככתבה. test קיים? בדוק. |
| Speaker reactivity (getters מ-settings ב-$effect) | learnings | קריאת `settings.speakThoughts` בתוך ה-$effect של Speaker נעקבת אוטומטית → toggle מפעיל re-eval. |
| Hardcoded Hebrew | hook | כל label/aria → t(key). |
| מחיקת VoicePicker/AgentOptionsPanel שוברת consumer | חוק זהב #5 | typecheck תופס. ודא אין import נשאר. |
| 9a base=dev סתירה | בליעה | 9a לא רץ בנפרד; כל הקוד שלו כאן. עדכן decisions (9a superseded). |

---

## §7 — Escalation triggers
- Bits UI לא תומך RTL ב-Select/Switch באופן שדורש hacks > 30 שורות → fallback native, דווח.
- מיזוג AgentOptionsPanel דורש שינוי ב-AgentSession API (לא רק UI) → עצור.
- ה-3 toggles דורשים שינוי ב-Speaker pipeline מעבר ל-9a §4 (skip logic) → עצור.
- carMode placeholder "מתפתה" לחווט ל-Bluetooth → זה slice 7, עצור.

## §8 — Complexity score
**7/10 → light.** commits 5 (+1), שכבות: settings components + ui wrappers (+1), Bits UI חדש (+1),
מיזוג AgentOptionsPanel = refactor consumer (+2), Speaker pipeline change (+2). ≈7. בדיקה runtime
(toggles משפיעים על הקראה, dropdowns עובדים) — light מספיק, אבל **אם executor מתקשה עם Bits RTL —
שקול phase-verifier אחרי Commit 3.**

## §9 — שאלות פתוחות
| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | Bits UI סגור? | כן (החלטת מרדכי+משתמשת) — אשר לפני Commit 3 | 🟡 חוסם את Commit 3 |
| 2 | Switch — Bits או custom .toggle? | נסה Bits; אם מסורבל, custom .toggle (כבר ב-app.css) | ❌ |
| 3 | "בחר תיקייה" בכרטיס חיבור — מחווט? | placeholder; FolderPicker ב-redesign-6 | ❌ |
| 4 | VoicePicker — reuse או Select חדש? | Select חדש (אחיד); מחק VoicePicker אם מוחלף | ❌ |
