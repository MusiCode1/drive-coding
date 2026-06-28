# Brief: slice-restore-last-config — שחזור agent+mode מהסשן האחרון

> סטטוס: **plan-verified** (constructor-injection לפי החלטת המשתמשת · אביגיל READY,
> 0 findings מהותיים · 2026-06-27).
> base: `dev` (b816803). depends_on: **[]**.
> ⚠️ **INVASIVE — לא parallel-safe** (בכוונה, בבחירת המשתמשת). ראה §0 "merge-watch".
> complexity: **5/10** → calev (mode: light).
> ✅ **scope נעול (המשתמשת, 2026-06-27)**: גנרי — **כל** ציר-קונפיג (mode + model +
> ציר-agent-משני של claude + toggles), מנגנון אחד `setLastConfig(cliKind, configId, value)`.
> keying **per-cliKind**. FE-טהור (אופציה 1 — לא per-cwd/BE/sync; ראה decisions).

---

## 0. הקשר וסביבה

**הבקשה:** "סשן חדש יטען את ה-agent וה-mode שהיו בסשן האחרון."

**מצב קיים (מאומת בקוד):**
1. **cliKind (opencode/claude/gemini/...) כבר נשמר** ב-localStorage:
   `settings.svelte.ts` — `STORAGE_KEY="drive-coding-v2-settings"` (L21), שדה
   `cliKind` (L26,L110), default `"opencode"` (L50), נטען ב-load (L153).
   טופס-החיבור מאכלס ממנו. → ברמה הזו "load last agent" **כבר עובד**.
2. **צירי-הקונפיג שבתוך הסשן מתאפסים** בכל `newSession`. ב-`agent-session.svelte.ts`:
   - `configOptions` (L102), `models` (L104), `modes` (L106) — `$state`.
   - `#captureSessionConfig(result)` (L1005-1013) מציב אותם **מתשובת ה-CLI**
     (`session/new` או `session/load`) — כלומר ברירות-המחדל של ה-CLI, ללא override.
   - שינוי ע"י המשתמשת: `applyConfigOption(configId, value)` (L869) — מסלולים לפי
     id (L874), category `model` (L885), category `mode` (L899). מעדכן
     `configOptions`/`models`/`modes` מהתגובה.
   - **אין persistence** של הבחירות; כל סשן חדש = ברירות-מחדל של ה-CLI.
3. ה-UI: `SessionOptionsPanel.svelte` — picker ל-mode (שני מסלולים:
   `session.modes` ב-L232-242, או fallback ל-`configOptions` עם `category==="mode"`
   ב-L243-257), model, וצירים נוספים.

**🔑 עיקרון-תכנון: הזרקת `settings` ל-`AgentSession` (החלטת המשתמשת).**
ה-VM הוא הבעלים של הלוגיקה — הוא מחזיק `this.#settings` ומבצע גם persist וגם apply.
הזרקה ב-`+layout.svelte:66`, באותו דפוס כמו `BubblePlayer({ session, settings })` (L81):
```ts
const session = new AgentSession({ cues, settings })   // ← היום: { cues }
```
`settings` **אופציונלי** בקונסטרקטור (אם נעדר → persist/apply הם no-op חינני) — כדי
שטסטים קיימים שבונים `new AgentSession({ cues })` ימשיכו לעבור בלי שינוי.

**⚠️ merge-watch — INVASIVE במכוון.** זו אינה בחירה parallel-safe: היא משנה את
signature הקונסטרקטור של `AgentSession` ואת `+layout.svelte:66`. יש worktrees פעילים
שנוגעים באותם קבצים. **בעת merge ל-dev, מרדכי בודק ידנית את שלוש הנקודות:**
1. `+layout.svelte:66` — שורת `new AgentSession(...)`.
2. `agent-session.svelte.ts` — הקונסטרקטור (פרמטר `settings`), `applyConfigOption`
   (קריאת persist), ו-`newSession` (קריאת apply).
3. `recordings-save-retry` / `R1-inline-acp-slice` / `slice-input-autogrow` נוגעים
   ב-agent-session/+layout → אם אחד מהם נמזג לפני slice זה, יש לבדוק semantic-conflict
   בנקודות הנ"ל. המשתמשת אישרה את המחיר הזה במודע (ראה decisions/drive-coding.md).

**מסקנה:** העבודה = לשמור פר-`cliKind` את ערכי-הקונפיג האחרונים שהמשתמשת בחרה
(ב-`applyConfigOption` של ה-VM), ולהחיל אותם מחדש אחרי `#captureSessionConfig` בסשן
חדש — **בתנאי** שהערך עדיין תקף מול ה-options שה-CLI מחזיר (ה-CLI עלול לשנות את הסט).

**✅ scope נעול (המשתמשת, 2026-06-27):** הפרשנות הרחבה — גנרי על **כל** ציר-קונפיג,
per-cliKind, FE-טהור. **לא** per-cwd/BE/sync (זה ה-roadmap-item הנפרד `session-prefs-per-cwd`,
שנבחר לא לעשות עכשיו). cliKind כבר נשמר ממילא — ה-slice מוסיף את שאר הצירים.

**שם package FE:** `@drive-coding/frontend-v2`.

**worktree:**
```bash
git worktree add .worktrees/slice-restore-last-config -b slice-restore-last-config dev
cd .worktrees/slice-restore-last-config && pnpm install && pnpm hooks:install
```

**איך מריצים:**
```bash
cd packages/backend
PORT=4013 onecli run --agent voice-acp -- bun --watch src/server.ts
BE_PORT=4013 pnpm --filter @drive-coding/frontend-v2 dev
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 test
pnpm lint:i18n
```
**Browser:** linux-gui Chrome :9222 profile voice-acp.

**מקורות-אמת:** `packages/frontend/AGENTS.md` (5 שכבות).

---

## 1. Commits

### Commit 1 — persist: שמירת בחירות-קונפיג פר-cliKind ב-Settings (testing: tdd)
1. ב-`settings.svelte.ts` הוסף שדה persisted:
   ```ts
   // מפה: cliKind → { configId/category → value }
   lastConfig: Record<string, Record<string, string | boolean>>
   ```
   - הוסף ל-`STORAGE_KEY` shape (ליד `cliKind`/`lastCwd`, L26-27), ל-`DEFAULTS`
     (`{}`, L50 region), ל-`$state` (L110), ולטעינה ב-load (L153 region).
   - **תאימות-לאחור (מאומת)**: `load()` עושה `return { ...DEFAULTS, ...parsed }`
     (`settings.svelte.ts:93`) → storage ישן בלי `lastConfig` יקבל את ברירת ה-DEFAULTS
     (`{}`) אוטומטית. אין צורך במיגרציה ידנית.
   - setter: `setLastConfig(cliKind, key, value)` שממזג ושומר (קרא ל-`#persist`).
   - ⚠️ `#persist()` (L355) **מונה את כל שדות-ה-Persisted ידנית** — חובה להוסיף שם גם
     `lastConfig` אחרת הוא לא יישמר (typecheck יתפוס אם ה-shape דורש זאת, אבל אל תסמוך —
     הוסף מפורשות). אמת את גוף `#persist` והוסף את השדה.
2. **הזרקה לקונסטרקטור** (`agent-session.svelte.ts` + `+layout.svelte`):
   - הוסף לקונסטרקטור של `AgentSession` (~L72) פרמטר אופציונלי `settings?: Settings` ושמור
     ב-`#settings` (private). אם נעדר → no-op בהמשך. ⚠️ דורש `import type { Settings }
     from "...settings.svelte"` ל-`agent-session.svelte.ts` (ל-VM אין היום reference
     ל-Settings — זו תוספת-import). ודא שאין circular-import (Settings לא מייבא את ה-VM).
   - ב-`+layout.svelte:66` שנה `new AgentSession({ cues })` → `new AgentSession({ cues, settings })`
     (ה-`settings` כבר קיים שם, L56).
3. **טריגר-שמירה — wrapper סביב `applyConfigOption`** (`agent-session.svelte.ts:869`):
   ⚠️ **🔴 אזהרה (אביגיל)**: למתודה יש **5 מסלולי-הצלחה עם `return`** (L880/891/896/905/910)
   ועוד מסלול not-found ללא return (L914). הוספת persist "בסוף המתודה" תיתפס **רק** בנתיב
   ה-not-found → הפיצ'ר לא ישמור כלום. **חובה דפוס wrapper:**
   - שנה את הגוף הקיים למתודה פרטית `#applyConfigToClient(configId, value): Promise<boolean>` —
     `return true` ב-5 מסלולי-ההצלחה (L880/891/896/905/910), `return false` ב-not-found (L914).
     את שתי בדיקות-ה-guard (`status`/`#client`) השאר ב-wrapper.
   - ה-`applyConfigOption` הציבורי הופך לדק:
   ```ts
   applyConfigOption = async (configId: string, value: string | boolean): Promise<void> => {
     if (this.status !== "connected") return
     if (!this.#client || !this.#sessionId) return
     const applied = await this.#applyConfigToClient(configId, value)
     const cli = this.#cliKind   // כבר נשמר ב-VM (L163)
     if (applied && this.#settings && cli) this.#settings.setLastConfig(cli, configId, value)
   }
   ```
   כך persist יורה על **כל** מסלול-הצלחה, ולא על not-found.

**testing (tdd):** טסט ל-`setLastConfig` (merge + persist + round-trip מ-localStorage);
טסט תאימות-לאחור (storage ישן בלי השדה).

**DoD Commit 1:** typecheck ✓, טסטים ירוקים, בחירת-קונפיג נשמרת ושורדת reload.

---

### Commit 2 — apply: החלת בחירה אחרונה בסשן חדש (testing: tdd + manual)
> ממומש **ב-VM** (`agent-session.svelte.ts`). ל-VM יש `this.#settings` (הוזרק ב-Commit 1).
>
> **🔴 שתי מלכודות שאביגיל תפסה — קרא לפני שאתה כותב:**
> 1. **תזמון**: `applyConfigOption` (L870) פותח ב-`if (this.status !== "connected") return`.
>    `#captureSessionConfig` רץ **לפני** ש-`#setStatus("connected")` נקרא. לכן אם תקרא
>    ל-`#applyRememberedConfig` מיד אחרי ה-capture — כל `applyConfigOption` יהיה **no-op
>    שקט** והשחזור לא יקרה. **חובה לקרוא אחרי `this.#setStatus("connected")`.**
> 2. **כיסוי**: יש **שני** נתיבי סשן-חדש, לא אחד. גם `newSession` (כפתור "סשן חדש")
>    וגם `attach` (החיבור הראשון — הנתיב הכי שכיח!) יוצרים סשן חדש. שניהם צריכים apply.
1. הוסף מתודה פרטית `#applyRememberedConfig()`, וקרא לה (`await`) **מיד אחרי**
   `this.#setStatus("connected")` ב**שני** המקומות:
   - **`attach`** — אחרי `this.#setStatus("connected")` (~L528, בסוף ה-try לפני ה-catch).
   - **`newSession`** — אחרי `this.#setStatus("connected")` (~L836).
   (לא ב-`#captureSessionConfig` עצמו — הוא משותף גם ל-loadSession/reconnect/switchSession.)
   המתודות:
   ```ts
   // value עדיין בחירה חוקית אצל ה-CLI הנוכחי? (בודק ערך, לא רק קיום-option)
   // מבנים מאומתים מול dev: modes.availableModes[].id ; models.availableModels[].modelId ;
   // SessionConfigOption = discriminated union {type:"select"}|{type:"boolean"} + id/category.
   #isValidChoice(key: string, value: string | boolean): boolean {
     if (key === "mode" && this.modes)
       return this.modes.availableModes.some((m) => m.id === value)
     if (key === "model" && this.models)
       return this.models.availableModels.some((m) => m.modelId === value)   // .modelId, לא .id!
     const opt = this.configOptions.find((o) => o.id === key || o.category === key)
     if (!opt) return false
     if (opt.type === "select" && typeof value === "string") {
       // flatten זהה ללוגיקה של flattenSelectOptions (SessionOptionsPanel:55), inline ב-VM:
       const flat = opt.options.flatMap((i) => ("options" in i ? i.options : [i]))
       return flat.some((c) => c.value === value)
     }
     if (opt.type === "boolean") return typeof value === "boolean"
     return true
   }

   async #applyRememberedConfig(): Promise<void> {
     const cli = this.#cliKind
     const remembered = cli ? this.#settings?.lastConfig[cli] : undefined
     if (!remembered) return
     for (const [key, value] of Object.entries(remembered)) {
       if (this.#isValidChoice(key, value)) await this.applyConfigOption(key, value)
     }
   }
   ```
   ⚠️ **אל תקרא ל-applyConfigOption עם ערך-רפאים** — הבדיקה מאמתת **ערך** (לא רק קיום
   option): כיסוי סימטרי mode+model (model נשמט אם בודקים רק mode), ובדיקת value⊂choices
   ל-select (ערך-stale). ⚠️ `applyConfigOption` קורא ל-`setLastConfig` (Commit 1) — אבל
   זה idempotent (כותב את אותו ערך שכבר שמור), אז אין לולאה. אמת את ה-shape של
   `SessionConfigOption.options` מול ה-SDK לפני שמסתמך על `i.options`.
2. **רק בנתיבי סשן-חדש** (`attach` + `newSession`), **לא** ב-resume.
   `#captureSessionConfig` נקרא מ-5 מקומות (L461 attach, L523 attach-newSession,
   L653 loadSession, L767 switchSession, L1129 mock) — אבל `#applyRememberedConfig`
   מתחבר **רק** אחרי ה-`connected` של attach ו-newSession. loadSession/switchSession
   (resume של סשן קיים) — ה-CLI כבר מחזיק את ה-mode שלו, **לא דורסים**.
   > הערה: ב-attach, `#captureSessionConfig(sessionResult)` ב-L523 + `#setStatus("connected")`
   > מיד אחרי `notifySessionAttached`. ה-apply נכנס שם, בתוך אותו try.

**testing (tdd):** ב-`agent-session.test.ts` — בנה `AgentSession` עם `settings` mock
שבו `lastConfig` מאוכלס + mock client שמחזיר `modes`/`configOptions` ידועים. אמת:
- **attach** (חיבור ראשון) מחיל את ה-remembered אחרי connected — `applyConfigOption`
  נקרא עם הערך הנכון (זה הנתיב הכי שכיח — אל תדלג עליו בטסט!).
- **newSession** מחיל גם כן.
- ערך לא-תקף **נדלג**; אין settings → no-op; **loadSession לא מחיל**.
- (אם אפשר) אמת שהקריאה היא אחרי `status==="connected"` — אחרת היא no-op שקט.
**manual:** opencode — שנה persona/mode, "סשן חדש" → ה-mode חוזר; claude — שנה
mode + agent-subtype, "סשן חדש" → שניהם חוזרים.

**DoD Commit 2:** typecheck ✓, טסטים ירוקים, mode+agent משוחזרים בסשן חדש פר-CLI.

---

### Commit 3 — calev light (testing: none — verifier)
מרדכי מפעיל את כלב (mode: light). אליעזר לא ממזג.

---

## 8. Complexity
**5/10.** שכבת persistence ב-`settings.svelte.ts` (field+setter) + הזרקת `settings`
ל-VM (constructor + `+layout`) + apply-on-new-session עם guard-תקפות ב-VM. שני סיכונים:
(א) **merge** — שינוי invasive מול worktrees פעילים (ראה §0 merge-watch; המשתמשת אישרה);
(ב) להחיל ערך לא-תקף → ממותן ב-guard + tdd. → calev mode: light.

## 9. Q&A / החלטות
- **Q: per-cliKind או per-cwd?** A: per-cliKind. mode/agent הם תכונות של ה-CLI,
  לא של התיקייה. (registry ב-BE כבר מחזיק per-cwd lastSessionId; לא מערבבים.)
- **Q: למה לא ב-BE registry?** A: זו העדפת-UI של המשתמשת, מקומה ב-Settings (FE),
  עקבי עם `cliKind`/voice-settings שכבר שם.
- **Q: load-session דורס?** A: לא. רק newSession מחיל remembered. סשן קיים שומר
  את ה-mode שלו.
- **Q: ערך שלא קיים יותר ב-CLI?** A: דלג בשקט (guard-תקפות).

## depends_on
**[]** — עצמאי. נוגע ב-Settings VM + AgentSession VM (FE בלבד).
