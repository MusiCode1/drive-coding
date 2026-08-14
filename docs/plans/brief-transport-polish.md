# Slice `transport-polish` — טרמינולוגיה + עקיפה + מתג — בריף (r4)

> **תאריך**: 2026-08-14 · **גרסה**: r4
> **סוג מסמך**: **בריף ביצועי לסלייס**
> **אימות אביגיל**: r1 = NEEDS-REWORK (8) · r2 = NEEDS-REWORK (11) ·
> r3 = NEEDS-REWORK (4; **9 מתוך 11 ממצאי r2 נסגרו**) → **r4**.
> r3 תפסה באג-עיצוב אמיתי ב-r4/§C4 (`env` בלתי-נגיש) — **אומת מול הקוד ותוקן.**
> **מה פתח את החסימה**: הכרעת המשתמשת ב-§3 — **שני מפתחות, שני תחומי-חיים**. שני
> הסבבים הקודמים נשברו על ההנחה שמפתח אחד משרת גם עקיפה וגם העדפה. הוא לא.
> **Dispatch**: מותר לאליעזר רק אם `אימות אביגיל = READY`
> **Complexity**: 6/10 (verifier: light + phase על C3, C4)
> **Base**: `slice/view-switch` @ `ec95f93` — **לא `dev`**
> **Worktree**: `.worktrees/transport-polish` · branch `slice/transport-polish`
> **הורה**: `pre-brief-plan-pre-merge-transport-polish.md`

---

## §0 — Pre-flight

```bash
cd /home/user/Projects/drive-coding/.worktrees/transport-polish
bun install
cd packages/frontend && ./node_modules/.bin/svelte-kit sync && cd ../..
```

> 🔴 **`svelte-kit sync` הוא חובה, לא נוחות.** `packages/frontend/tsconfig.json` יורש
> מ-`./.svelte-kit/tsconfig.json` — קובץ **נוצר ולא tracked**, ואין script `prepare`.
> בלעדיו **82 קובצי טסט נכשלים** ב-`Cannot find module './.svelte-kit/tsconfig.json'`.
> **כבר הורץ** ב-worktree הזה (2026-08-14); מתועד ב-`baseline-transport-polish.md`.

**must-read**: `session-transport.ts` · `connect-agent.ts` · `vite.config.ts:36-42` ·
`SettingsScreen.svelte` (דפוס `ttsProvider`) · `settings.svelte.ts:116-145`

**⚠️ פורט 4000 תפוס** ע"י תהליך חי — לא להרוג. לפריוויו: פורט פנוי.

**⚠️ `onecli` אינו מותקן** בסביבה — ראה §6.

---

## §1 — מה השתנה (ולמה)

**לקרוא לפני שמתחילים.** כל שורה כאן היא טענה שהופרכה מול הקוד, לא ליטוש ניסוח.

### מ-r1 (8 ממצאים)

| # | טעות ב-r1 | המצב בפועל |
|---|---|---|
| 1 | "לא נוגעים בטסטים קיימים" | **16 מתוך 17** טסטים ב-`session-transport.test.ts` ייכשלו. עבודה בסקופ, לא הפתעה |
| 2 | "2 קבצי מקור בלבד" | פספוס של **`vite.config.ts:36-42`** שמייצר `local`/`remote` |
| 3 | C4 = `SettingToggle` | `SettingToggle` **בוליאני** (עוטף Switch). `ws`/`http` הוא enum → **`Select`** |
| 4 | DoD מוחלט ("typecheck נקי") | **הבסיס אדום** → DoD **מבוסס-דלתא** |

### מ-r2 (11 ממצאים) — ומדידה עצמאית

| # | טעות ב-r2 | המצב בפועל |
|---|---|---|
| 5 | **מפתח אחסון אחד** | ⭐ **השורש.** עקיפה והעדפה הן שתי שכבות. §3 — הכרעת המשתמשת |
| 6 | "מיגרציה בשורה אחת" | מתאדה לגמרי אחרי §3 — אין מה להעביר |
| 7 | i18n ב-`packages/frontend/src/lib/i18n/` | **התיקייה לא קיימת.** המפתחות ב-**`packages/core/src/i18n/`** |
| 8 | `banana → ws` | ערך פסול **יורד לרמה הבאה**, לא לברירת-המחדל (`session-transport.ts:36`) |
| 9 | "`lint:i18n` יחסום" | הוא חוסם **עברית בלבד**. `WebSocket`/`HTTP` אנגליים עוברים — שער שלא יכול להיכשל |
| 10 | C5 = "רק פקודות" | `walkthrough.md:100-102` ו-`preview-view-switch.md:43` מתארים את **סמנטיקת האחסון** |
| 11 | `bun install` מספיק ל-pre-flight | 🔴 **82 קובצי טסט נכשלים** בלי `svelte-kit sync` (§0) |
| 12 | root typecheck "נכשל" | נמדד: **68 שגיאות ב-9 קבצים** |
| 13 | `tail -5`/`tail -3` ל-baseline | לא תופס את שורות הסיכום. הוחלף ב-`grep` (§5) |
| — | ~~"2,324 שגוי, האמת 1,853"~~ | **מדידה שגויה שלי.** 2,324 **נכון** — הרצה תחת עומס אספה 168/204 קבצים בשקט |

---

## §2 — Scope (מורחב לפי הממצאים)

| פריט | כן/לא |
|---|---|
| `session-transport.ts` — union + `normalizeSessionTransport` מיוצא + מקור `override` | ✅ |
| `session-transport.ts` — **doc-comment בראש הקובץ** (מתעד את העיצוב הישן) | ✅ |
| `session-transport.test.ts` — 16 טסטים מעודכנים + 4 נרדפים + 2 קדימות = **23** | ✅ |
| `connect-agent.ts` — שורות 42, 56 + נרמול-לפני-שמירה + קריאת שני מקורות | ✅ |
| **`vite.config.ts:36-42`** | ✅ |
| C3 — `$effect` ב-root layout → **`sessionStorage`** | ✅ |
| C4 — `<Select>` ב-`SettingsScreen` + שדה ב-`settings.svelte.ts` → **`localStorage`** | ✅ |
| **`packages/core/src/i18n/`** — `keys.ts` + `catalogs/{he,en}.ts` | ✅ |
| `docs/walkthrough.md`, `packages/frontend/docs/preview-view-switch.md` — **כולל טקסט האחסון** | ✅ |
| מיגרציית אחסון | ❌ **בוטלה** — §3 ייתר אותה |
| הכרזת יכולת `systemPrompt` | ❌ סלייס נפרד על `dev` |
| נפילה-חזרה אוטומטית | ❌ סלייס נפרד |
| **תיקון 259 שגיאות ה-lint / typecheck הקיימות** | ❌ **סלייס ניקיון נפרד** |

---

## §3 — האחסון: שני מפתחות, שני תחומי-חיים ✅ הוכרע ע"י המשתמשת

r1 ו-r2 שניהם נשברו כאן, כי שניהם הניחו **מפתח אחד**. עקיפת-חירום והעדפה קבועה מושכות
לכיוונים הפוכים על מפתח יחיד. **הן לא אותו דבר, ולכן לא אותו מפתח:**

| שכבה | איפה | חיים | מי כותב |
|---|---|---|---|
| **עקיפה** — `?sessionTransport=` | **`sessionStorage`** (מפתח `sessionTransport` — **הקיים**) | הטאב | C2, C3 |
| **העדפה** — מתג ההגדרות | **`localStorage`** — שדה ב-`drive-coding-v2-settings` | קבוע | C4 |

**קדימות (מרחיבה את הקיימת בשכבה אחת):**

```
query  ←  sessionStorage (עקיפה)  ←  localStorage (העדפה)  ←  env  ←  "ws"
```

**מה זה פותר:**

- **ממצא #7 של אביגיל מתאדה.** ה-URL לא נוגע ב-`localStorage`, ולכן ה-`<Select>` לעולם
  לא נדרס ולא יוצא מסנכרון. C3 ו-C4 חוזרים להיות עצמאיים.
- **המיגרציה מתאדה (D-02).** המפתח הקיים ב-`sessionStorage` **הוא** מפתח העקיפה החדש.
  אין מה להעביר ואין מה למחוק.
- **C4 חוזר לדפוס הרגיל.** ההעדפה היא עוד שדה ב-`settings.svelte.ts`, שנשמר ממילא
  כאובייקט אחד דרך `#persist()`. **בלי** setter חריג ובלי חוזה-אחסון חדש.
- העקיפה נשארת מה שביקשת: רשת-ביטחון לטאב, שנעלמת מעצמה.

---

## §4 — Commits

### C1 — השכבה הטהורה (approach: **tdd**)

**קובץ**: `session-transport.ts`

```ts
export type SessionTransport = "ws" | "http"

/** trim + lowercase + מיפוי נרדפים. null אם לא מוכר. */
export function normalizeSessionTransport(
  value: string | null | undefined,
): SessionTransport | null

/** קדימות נעולה: query ← override ← stored ← env ← "ws". */
export function resolveSessionTransport(input: {
  query?: string | null
  /** עקיפה מ-sessionStorage — חיה בטאב (§3). */
  override?: string | null
  /** העדפה מ-localStorage — קבועה (§3). */
  stored?: string | null
  env?: string | undefined
}): SessionTransport
```

מיפוי: `ws`→`ws` · `http`→`http` · `local`→`ws` · `remote`→`http` · אחר→`null`.

`override` הוא **שדה חדש** בקדימות. הפונקציה נשארת טהורה — אפס IO, הקורא מספק את
ארבעת המקורות.

`normalize` הפרטית (שורה 19) עוברת rename+export. **additive — אין imports חיצוניים**
(אומת). לעדכן את הקריאות הפנימיות ב-resolver (יהיו 4).

⚠️ **גם ה-doc-comment בראש הקובץ (שורות 1-14) מתעד את העיצוב הישן** — `local`/`remote`,
הקדימות, ולמה `stored` הוא sessionStorage. **לעדכן אותו.** (פספוס של r2.)

**טסטים**: לעדכן 16 קיימים ל-`ws`/`http`; **להוסיף** 4 לנרדפים המיושנים ו-**2 לקדימות
`override` מול `stored`** (עקיפה מנצחת העדפה; העדפה מנצחת env).

**Verification**: `bun run test -- session-transport` → **23/23**

### C2 — נרמול לפני שמירה + חיווט שני המקורות (approach: **tdd**)

**קובץ**: `connect-agent.ts`

- לשמור ל-`sessionStorage` **רק** אם `normalizeSessionTransport(q) !== null`, ולשמור את
  **המנורמל**. (היום נשמר כל ערך, כולל `banana`.)
- לקרוא **שני** מקורות: `sessionStorage` → `override`, ו-`settings.sessionTransport`
  (שעשוי להיות `null`) → `stored`.
- שורה 42: `transport === "remote"` → `=== "http"`.
- שורה 56: הניווט → `?sessionTransport=http`.
- ❌ **אין מיגרציה.** המפתח הקיים ב-`sessionStorage` הוא מפתח העקיפה — הוא ממשיך לעבוד
  כמו שהוא.

**טסטים** (ממצא r2 #9 + r3 #2 — **לא נסגר עד עכשיו**). קובץ חדש
`connect-agent.transport.test.ts`, 5 מקרים:

1. canonicalization לפני כתיבה — `?sessionTransport=REMOTE ` → נכתב `http`
2. query פסול (`banana`) → **אין כתיבה** ל-`sessionStorage`
3. round-trip של העדפת Settings (כתיבה → `load()` → אותו ערך)
4. **`env` נבחר כשההעדפה `null`** ← זה השומר על באג r3 #1
5. `override` גובר על `preference`

**Verification**: 5/5 עוברים.

### C3 — עקיפה מכל עמוד (approach: **integration**) ⚠️ phase-verify

**קובץ**: `+layout.svelte`

`$effect` שעוקב אחר `page.url` וכותב ל-**`sessionStorage`** (§3). **קריאה+נרמול+כתיבה
בלבד.**

✅ **אומת בקוד**: `+layout.svelte:17` כבר מייבא `page` מ-`$app/state`, שורה 151 קוראת
`page.url.pathname`, ויש `$effect` פעיל בשורה 140. `$effect` לא רץ ב-SSR → גישה
לאחסון בטוחה. לקרוא `page.url.searchParams` **בתוך גוף ה-`$effect`**.

> 🔒 **נעול — אסור לחרוג:** אין קריאה ל-`attach`/`detach`/`reconnect`, אין נגיעה ב-VM.
> **שינוי הדגל משפיע על החיבור הבא בלבד.** סשן חי ממשיך בטרנספורט שלו.
> אם ה-UI מציג טרנספורט — עליו להציג את **האפקטיבי לסשן החי**, לא את השמור.

> ✅ **אין כאן עוד התנגשות עם C4.** ה-effect כותב ל-`sessionStorage`; ה-`<Select>` קורא
> וכותב `localStorage`. הם לא נוגעים באותו מפתח, ולכן אין desync (זה היה ממצא #7 ב-r2).

**Verification**: `/chat?sessionTransport=ws` → `sessionStorage` מכיל `ws`, **הסשן החי לא
נקטע**, וההעדפה ב-Settings **לא השתנתה**.

### C4 — `<Select>` בהגדרות (approach: **manual**) ⚠️ phase-verify

**קבצים** (נתיבים אומתו):

- `packages/frontend/src/lib/components/settings/SettingsScreen.svelte` — `<Select>`
  מוטמע. ✅ אומת: הוא כבר מיובא שם (שורה 22) ומשמש ל-`ttsProvider` בשורות **152-157**
  בדפוס `options` / `value` / `title` / `onchange`. **אין קומפוננטה חדשה.**
- `packages/frontend/src/lib/view-models/settings.svelte.ts` — שדה + setter **בדפוס
  הרגיל** (`this.x = v; this.#persist()`, כמו `setTtsProvider` בשורה 466).

  🔴 **הטיפוס חייב להיות `SessionTransport | null`, וב-`DEFAULTS` — `null`.**

  `load()` מחזיר `{ ...DEFAULTS, ...parsed }` (שורה **134**). שדה עם ברירת-מחדל
  `"ws"` יהיה **תמיד מלא**, יועבר תמיד כ-`stored`, ו-`PUBLIC_SESSION_TRANSPORT`
  **לעולם לא ייבחר**. `null` = "לא נבחרה העדפה" → הקדימות ממשיכה ל-`env`.
  ❌ **בלי** אפשרות שלישית ב-UI. (אומת מול הקוד; ממצא r3 #1.)

  ⚠️ **שתי רשימות מפורשות חייבות עדכון** (נאמנות≠הלימה — ממצא r3 #3):
  1. **ה-constructor**, שורות ~217-258 — `this.x = loaded.x` לכל שדה. **השמטה כאן
     שקטה ולא נתפסת ב-typecheck.**
  2. **`#persist()`**, שורות ~534-560 — object literal מפורש. השמטה תיתפס רק אם
     השדה required.
- ⚠️ **`packages/core/src/i18n/keys.ts`** + `packages/core/src/i18n/catalogs/{he,en}.ts`
  — **לא** `packages/frontend/src/lib/i18n/`. **התיקייה ההיא לא קיימת** (טעות ב-r2).
  זה אומר ש-C4 נוגע גם ב-`packages/core` — לשקף ב-bump.

**מפתחות נדרשים**: `settings.sessionTransport.label` · `.ws` · `.http`
(+ `settings.advanced` אם נוסף כרטיס חדש).

- תחת "מתקדם"/דיבוג.
- תוויות: **החוט** — `WebSocket` / `HTTP`.
- **מה ה-`Select` מציג כשההעדפה `null`**: את הערך שייבחר בפועל בלי עקיפה, כלומר
  `resolveSessionTransport({ stored: null, env })`. בחירה של המשתמשת כותבת ערך מוחשי
  ומרגע זה גוברת על `env` — זו התנהגות מכוונת.
- עקיפה פעילה ב-URL עשויה לגבור על שניהם לטאב הזה; ה-`Select` **לא** משקף אותה.
- ⚠️ `lint:i18n` חוסם **עברית בלבד** (אומת: `lint-no-hebrew-in-code.sh`). התוויות כאן
  אנגליות, כלומר **השער הזה לא ייתפס אותן** — המפתחות נדרשים מהמוסכמה, לא מהלינטר.

⚠️ `SettingsScreen.svelte`, `settings.svelte.ts`, `keys.ts` — **קבצים משותפים, תוספת בלבד**.

### C5 — תיעוד (approach: **none**)

`docs/walkthrough.md` + `packages/frontend/docs/preview-view-switch.md`.

**לא רק פקודות** (ממצא #10, אומת): שני הקבצים מתארים במפורש את סמנטיקת האחסון —
`walkthrough.md:100-102` ו-`preview-view-switch.md:43`. לעדכן גם את **הטקסט**: שתי
השכבות של §3, ולא רק `local`/`remote` → `ws`/`http`.

---

## §5 — DoD (מבוסס-דלתא)

> **הבסיס אדום.** כל שורה מודדת **דלתא מול `ec95f93`**, לא ניקיון מוחלט.

**ה-baseline כבר נמדד** ב-`ec95f93` — `baseline-transport-polish.md`. אין צורך למדוד
שוב; הפקודות למדידה **אחרי**:

```bash
bun run test 2>&1 | grep -E "Test Files|Tests "
bun run lint 2>&1 | grep -E "Found [0-9]+ (error|warning)"
bun run --filter @drive-coding/frontend typecheck 2>&1 | grep -E "COMPLETED|ERRORS"
bun run typecheck 2>&1 | grep -cE "error TS"          # root — היה חסר
```

> 🔴 **ספירה שווה אינה "אין רגרסיה"** (ממצא r3 #4). שגיאה חדשה יכולה להחליף ישנה.
> להשוות **זהויות**, לא מספרים:
>
> ```bash
> # ⚠️ --max-diagnostics חובה: Biome מדפיס 20 בלבד כברירת מחדל ("The number of
> #    diagnostics exceeds the limit allowed"), אז בלעדיו ההשוואה חסרת-ערך.
> bun run lint --max-diagnostics=1000 2>&1 \
>   | grep -oE "^[a-z][^ ]*\.(ts|svelte|js|mjs|json|jsonc):[0-9]+:[0-9]+ [a-z/]+" \
>   | sort > /tmp/after-lint.txt
> diff /tmp/tp-baseline/lint-ids.txt /tmp/after-lint.txt   # ריק = אפס רגרסיה
> ```
>
> **הבסיס כבר נתפס**: `/tmp/tp-baseline/lint-ids.txt` — **750 אבחנות**.
> שורות שיזוזו בגלל עריכה בקובץ שנגעת בו הן רעש צפוי; שורה בקובץ שלא נגעת בו = רגרסיה.

> ⚠️ `tail -5`/`tail -3` (כפי שנכתב ב-r2) **לא עובד** — unhandled errors נשפכים אחרי
> הסיכום ב-test, ו-`Found 259 errors` נמצא מעל 3 השורות האחרונות ב-lint. אומת.

| # | בדיקה | קריטריון |
|---|---|---|
| 1 | טסטים | **204 קבצים** ו-**2,324 passed** ומעלה; אותם **2 קבצים** כושלים בלבד (`formatting`, `https-serve`) |
| 1b | ⚠️ ספירת קבצים | ספירה **שאינה 204** = **איסוף חלקי**, לא רגרסיה — להריץ שוב בלי עומס |
| 2 | `session-transport` ממוקד | **23/23** (17 קיימים + 4 נרדפים + 2 קדימות) |
| 3 | lint | **לא יותר** מ-259 שגיאות |
| 4 | frontend typecheck | **לא יותר** מ-15 שגיאות |
| 5 | root typecheck | **לא יותר** מ-68 שגיאות (נמדד; היה חסר ב-r2) |
| 6 | `lint:i18n` | **עובר** (ירוק בבסיס — כאן מוחלט) |
| 7 | נרדפים | `?sessionTransport=remote` → `http` |
| 8 | ערך פסול | **ללא override/stored/env**: `banana` → `ws` **ואין כתיבה**. (עם stored תקין הוא יורד אליו — זה נכון; ממצא #11) |
| 9 | עקיפה מ-`/chat` | משפיע, **הסשן החי לא נקטע**, **וההעדפה ב-Settings לא משתנה** |
| 10 | קדימות | עקיפה(sessionStorage) גוברת על העדפה(localStorage) גוברת על env |
| 11 | טאב חדש | העקיפה **נעלמת**, ההעדפה **שורדת** |
| 12 | ברירת מחדל | בלי כלום → `ws` |
| 13 | מתג ההגדרות | ידני |
| 14 | **פריוויו** | §6 |

---

## §6 — שער הפריוויו

`AGENTS.md`: שער-מיזוג קשיח. **אבל בסביבה הזו `onecli` אינו מותקן.**

`onecli` דרוש ל-proxy של TTS/translate — **לא** למסלול הטרנספורט. לכן:

1. build production (**לא** dev-server), serve על **פורט פנוי**.
2. פריוויו ב-`ws` — אפס רגרסיה.
3. פריוויו ב-`http` — דרך המתג **וגם** דרך הכתובת.
4. ✅ מותר לדווח "TTS לא נבדק — אין onecli". ❌ **אסור** לדלג על 2-3.
5. HTTPS דרוש (secure-context); מרחוק ⇒ מנהרה.
6. **אישור מפורש של המשתמשת.**

> `docs/running-locally.md` נמצא ב-docs-repo חיצוני, לא ב-worktree. אם אינו נגיש —
> לדווח ולא לנחש.

---

## §7 — Escalation

עצור ושאל אם: C3 מחייב נגיעה במחזור-חיים של סשן · שינוי-השם שובר משהו מעבר ל-16 הטסטים ·
`<Select>` לא מתאים · הבסיס האדום גדל בגללך · פריוויו נכשל ב-`http`.

**לעולם לא**: `merge`, push ל-`dev`/`main`. **מותר**: push של `slice/transport-polish`.

---

## §8 — Complexity

5 commits (+1) · 3 קבצים משותפים (+1) · שינוי-שם ציבורי (+1) · UI + i18n (+1) ·
שינוי חוזה-אחסון (+1) · בסיס אדום מסבך מדידה (+1) · TDD בשכבה טהורה (−1) ·
אפס IO חדש (−1).

**6/10** → כלב light + phase-verify על **C3** ו-**C4**.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| ~~1~~ | ~~§3 — localStorage מול sessionStorage~~ | **נסגר: שניהם, בשתי שכבות** (הכרעת המשתמשת) | — |
| 2 | תוויות המתג | `WebSocket` / `HTTP` | ❌ |
| 3 | מצב "אוטומטי" שלישי | ❌ לא כאן | ❌ |
| 4 | האם להציג בהגדרות שעקיפה פעילה בטאב | לא כרגע — הערה ל-follow-up | ❌ |

---

## סטיות מהתכנון (מתעדכן ע"י executor)

- **C2 מקדים את C4 ב-Settings**: הבריף תכנן את השדה `sessionTransport` ב-C4, אבל
  C2 משנה את `connect-agent.ts` ו-`+page.svelte` להעביר `settings.sessionTransport`
  כ-`stored`. בלי השדה, typecheck נשבר. לכן השדה (type + DEFAULTS + constructor + setter +
  persist) נוסף כבר ב-C2; ה-UI (Select ב-SettingsScreen) הגיע ב-C4 כמתוכנן.
- **שינויי חתימה ב-`readSessionTransport`**: הבריף תיאר `readSessionTransport(envValue)`
  כשורה אחת. בפועל החתימה שונתה ל-`readSessionTransport({ env, stored })` כדי
  לתמוך בשני מקורות (override + preference). שני הקוראים (connect-agent,
  +page.svelte) עודכנו בהתאם.
- **7 טסטים קיימים במקום 5 חדשים**: הבריף ביקש 5 מקרים חדשים
  ב-`connect-agent.transport.test.ts`. בפועל עדכנו את 7 הטסטים הקיימים
  ב-`session-transport-read.test.ts` (שכבר היו שם מ-remote-warm-reconnect C4)
  והוספנו 4 חדשים = 11 סך הכל. לא נוצר קובץ חדש — הטסטים שכבר כיסו את
  שכבת-הדבק, והוספת קובץ נפרד הייתה יוצרת כפילות.
