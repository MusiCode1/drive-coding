# Slice — wake-lock — ‏בריף

> **‏תאריך**: 2026-06-22
> **‏סוג מסמך**: ‏בריף ביצועי לסלייס
> **‏סטטוס**: ‏מאושר (‏plan-verified, ‏מוכן ל-dispatch)
> **‏אימות אביגיל**: READY (‏r1, ‏3 findings, ‏כולן 0-min · ‏דוח: `reports/drive-coding/slice-wake-lock-avigail.md`)
> **Dispatch**: ‏מותר לאליעזר רק אם `אימות אביגיל = READY`.
> **Complexity**: 3/10 (verifier: light — `calev`)
> **‏תלויות (`depends_on`)**: [] — ‏בנוי ישירות על dev
> **‏Base**: dev
> **‏Dev tip**: `7444c85`

---

## §0 — Pre-flight

### ‏תלויות (‏חובה!)

‏slice זה **‏אין לו תלויות** — ‏בנוי ישירות על `dev` (tip `7444c85`). ‏כל הקבצים שהוא
‏נוגע בהם קיימים ויציבים ב-dev: `Settings` VM, `+layout.svelte` (composition root),
‏`SettingsScreen.svelte`, ‏קטלוגי i18n. ‏אין שום slice לא-merged שהוא נשען עליו.

> ‏`depends_on: []` ‏ב-state (‏אין state.json מרכזי ל-drive-coding — ‏מתועד כאן ובכותרת).

### Worktree

```bash
cd /home/user/projects/drive-coding/dev
git worktree add /home/user/projects/drive-coding/.worktrees/slice-wake-lock -b slice-wake-lock dev
cd /home/user/projects/drive-coding/.worktrees/slice-wake-lock
pnpm install && pnpm hooks:install
```

‏(‏הפרויקט הוא bare repo — ‏חובה absolute path ל-`git worktree add`.)

### ‏איך להריץ

- BE: ‏לא נדרש לסלייס הזה (‏אין נגיעה ב-BE / ‏פרוקסי). ‏אם בכל זאת מריצים FE מלא:
  `cd packages/backend && PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts`
- FE: `pnpm --filter @drive-coding/frontend dev` (port: OS-assigned, ‏ראה לוג ה-startup)
- Tests: `pnpm --filter @drive-coding/frontend test` ‏(ל-settings) · `pnpm --filter @drive-coding/core test`
- Typecheck/lint: `pnpm typecheck && pnpm lint && pnpm lint:i18n`

### Browser

‏ה-Wake Lock API ‏דורש **secure context** (‏HTTPS ‏או `localhost`). ‏ב-`localhost`
‏עובד ישירות בכרום. ‏אימות בכרום דסקטופ: ‏ניתן לצפות ב-`navigator.wakeLock` ‏וב-sentinel
‏שנוצר/משוחרר; ‏אפשר לדמות `visibilitychange`. ‏האישור ה**‏אמיתי** (‏מסך נייד לא נכבה)
‏נעשה ע"י המשתמשת על טלפון אמיתי דרך tunnel HTTPS — ‏ראה DoD #6.

### OneCLI agent

‏לא רלוונטי — ‏אין קריאות פרוקסי בסלייס.

### Reading list

**must-read** (‏לפני שמתחילים):
- `packages/frontend/AGENTS.md` — ‏חמשת חוקי הזהב. **‏חוק 1** (‏אין `$effect` ‏עם side
  effects ב-route — ‏wake-lock נזכר שם מפורשות) ו**‏חוק 4** (side effect שייך ל-owner
  ‏של ה-state) ‏רלוונטיים ישירות.
- `docs/design-principles.md §1.3` — ‏ההגדרה החד-משמעית של "engine" (imperative
  resource owner, browser-only, ‏ללא reactive state). ‏`WakeLockEngine` ‏הוא בדיוק זה.
- `docs/conventions/parallel-safe-code.md` — ‏חובה לפני נגיעה ב-`+layout.svelte`
  ‏וב-`i18n/keys.ts` (‏קבצים משותפים — additive only, ‏בתוך ה-section שלך).

**reference** (‏בזמן עבודה):
- `packages/frontend/src/lib/engines/cues.ts` — ‏דפוס engine קיים (owner של resource,
  ‏guard ל-SSR `typeof X === "undefined"`, ‏`dispose`/`close`).
- `packages/frontend/src/lib/view-models/settings.svelte.ts` — ‏דפוס `muted` ‏(שדה
  ‏בוליאני persisted מלא: `Persisted`→`DEFAULTS`→`$state`→`set*`→`#persist`→ctor).
- ‏ה-`$effect` ‏הקיים של dir/lang ב-`+layout.svelte` (‏שורות ~101-107) — ‏אותו דפוס בדיוק
  ‏שבו נחבר את ה-wake-lock.

---

## §1 — ‏מטרה

‏מנקודת מבט המשתמשת: ‏בהגדרות יש מתג חדש "**‏השאר מסך דלוק**". ‏כשהוא דלוק, ‏מסך הטלפון
‏לא יכבה כל עוד האפליקציה פתוחה וגלויה — ‏גם בזמן שהסוכן עובד, ‏גם בזמן שמקשיבים לתשובה,
‏גם בזמן נהיגה hands-free. ‏כשהוא כבוי, ‏ההתנהגות חוזרת לרגיל (‏המסך נכבה לפי הגדרות
‏המערכת). ‏הבחירה נשמרת בין רענונים.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|------|------|------|
| ‏מתג persisted "‏השאר מסך דלוק" ‏בהגדרות | ✅ | ‏בסלייס הזה |
| ‏`WakeLockEngine` ‏שמבקש/משחרר נעילה לפי המתג + visibility | ✅ | ‏בסלייס הזה |
| ‏תפיסה-מחדש אחרי `visibilitychange` (‏ה-gotcha המרכזי) | ✅ | ‏בסלייס הזה |
| ‏נעילה רק בזמן turn פעיל (‏חיסכון סוללה) | ❌ | ‏עידון עתידי — ‏ראה §9 #1 |
| ‏Media Session / car-mode chrome | ❌ | slice נפרד (Track C) |
| ‏כפתור reset שמאפס גם את המתג הזה | ❌ | ‏לא — ‏עקבי עם `muted` (‏גם הוא לא ב-reset) |

> ‏זו לא טבלת TODO — ‏זו הגנה מ-scope creep. ‏אפס נגיעה ב-`agent-session.svelte.ts`.

---

## §3 — Architecture diagram

```
                ‏(persisted toggle)
┌──────────────────────────────┐
│ Settings VM                  │  ← ‏קיים, ‏משתנה (additive)
│  screenWakeLock: boolean     │     ‏שדה+setter כמו muted
└───────────────┬──────────────┘
                │ ‏נקרא ע"י $effect
                ▼
┌──────────────────────────────┐
│ +layout.svelte (comp. root)  │  ← ‏קיים, ‏משתנה (additive section)
│  $effect: read settings →    │     ‏אותו דפוס כמו dir/lang effect
│           wakeLock.setEnabled│
└───────────────┬──────────────┘
                │ ‏imperative call
                ▼
┌──────────────────────────────┐
│ WakeLockEngine               │  ← ‏חדש (engines/, browser-only, ‏ללא $state)
│  setEnabled(bool) / dispose()│
│  #sentinel: WakeLockSentinel │     owner ‏של resource הדפדפן
│  visibilitychange → reconcile│     ‏תופס-מחדש כשהטאב חוזר
└───────────────┬──────────────┘
                │ navigator.wakeLock.request("screen")
                ▼
        Browser Screen Wake Lock
```

‏זרימת import: `+layout` (route/comp-root) → `engines/wake-lock` → ‏(‏ללא תלות). ‏חוקי.
‏ה-engine **‏לא** ‏ב-`context.ts` — ‏אף component/VM ‏לא צורך אותו (‏רק `+layout` ‏מזין אותו),
‏ולכן context pair ‏היה dead code. ‏זה שונה מ-`CuesEngine` (‏שכן ב-context כי VMs צורכים).

---

## §4 — Commits ‏בסדר

### Commit 0 — engine + persisted setting (approach: tdd ‏ל-persist, ‏manual/runtime ל-engine)

**‏קבצים חדשים**:
- `packages/frontend/src/lib/engines/wake-lock.ts`

**‏קבצים שמשתנים** (‏כולם additive):
- `packages/frontend/src/lib/view-models/settings.svelte.ts` — ‏הוסף `screenWakeLock`
  ‏ל-`Persisted` (‏סוף הטיפוס) + `DEFAULTS` (`false`) + `$state` + `setScreenWakeLock` +
  ‏שורה ב-`#persist()` + ‏שורה ב-constructor. **‏לפי דפוס `muted` ‏בדיוק** (‏ה-setter קורא
  ‏ל-`#persist()` ‏הפרטי, ‏לא `save()`).
- `packages/frontend/src/lib/view-models/settings.test.svelte.ts` — describe block חדש
  (‏round-trip, ‏default, ‏backward-compat) ‏בדפוס בלוק ה-`muted` ‏(שורות ~146-185).
- `packages/core/src/i18n/keys.ts` — ‏2 keys חדשים ל-union `MessageKey` (‏אחרי
  `settings.toggle.carMode`, ‏section settings).
- `packages/core/src/i18n/catalogs/he.ts` — ‏2 ערכים (‏עברית, ‏חובה).
- `packages/core/src/i18n/catalogs/en.ts` — ‏2 ערכים (‏אנגלית).
- `packages/frontend/src/routes/+layout.svelte` — ‏import + ‏instance + `$effect`
  ‏(section חדש `// ─── wake-lock ───`, additive — ‏לא לערוך sections קיימים).
- `packages/frontend/src/lib/components/settings/SettingsScreen.svelte` — ‏`SettingsCard`
  ‏חדש "‏מסך" ‏עם `SettingToggle` ‏אחד.

**API skeleton** (‏ה-executor אסור לשנות את החתימות):

```ts
// engines/wake-lock.ts
export class WakeLockEngine {
  /** ‏אידמפוטנטי. true → ‏מאזין ל-visibilitychange + ‏מבקש נעילה (‏אם גלוי).
   *  false → ‏מסיר listener + ‏משחרר. ‏לעולם לא זורק. */
  setEnabled(enabled: boolean): void
  /** ‏ניקוי ב-teardown (‏שקול ל-setEnabled(false)). */
  dispose(): void
}
```

> ‏**‏הערה שמית (Avigail #2)**: ה-engine היחיד הקיים (`cues.ts`) ‏חושף `close()` ‏**‏אסינכרוני**
> (‏סוגר `AudioContext`, ‏מחזיר `Promise`). ‏כאן `dispose()` ‏הוא **‏סינכרוני** (‏רק
> `setEnabled(false)`) — ‏שם שונה במכוון כי הסמנטיקה שונה. ‏אל תהפוך אותו ל-`close()`/async.

**‏דרישות התנהגות מה-engine** (‏אלה ה-DoD של הקוד — ‏ה-executor חייב לעמוד בכולן):
1. ‏`#sentinel: WakeLockSentinel | null` ‏פרטי. ‏`#acquire` ‏לא תופס פעמיים (`if !== null return`).
2. ‏guard SSR / ‏לא-נתמך: `typeof navigator === "undefined" || !("wakeLock" in navigator)` → no-op.
3. ‏`navigator.wakeLock.request("screen")` ‏עטוף ב-try/catch — ‏דחייה (‏סוללה/לא-גלוי) = ‏no-op שקט.
4. ‏**race-guard אחרי ה-await**: ‏אם `enabled` ‏התהפך או הטאב הוסתר בזמן ה-`await request()` —
   ‏שחרר מיד את ה-sentinel שהתקבל ואל תשמור אותו.
5. ‏האזן ל-`release` ‏event של ה-sentinel → ‏אפס `#sentinel = null` (‏המערכת משחררת לבד כשהטאב
   ‏מוסתר; ‏צריך לתפוס-מחדש בפעם הבאה).
6. ‏`visibilitychange` → `reconcile`: ‏אם `enabled && visibilityState === "visible"` → acquire,
   ‏אחרת release. ‏ה-listener מאוגד פעם אחת (‏אותה הפניה ל-add/removeEventListener).
7. ‏`setEnabled(false)` ‏מסיר את ה-listener ‏ומשחרר נעילה קיימת.

**‏חיווט ב-`+layout.svelte`** (‏דפוס זהה ל-dir/lang effect הקיים):

```ts
// ‏בלוק ה-imports (section engines):
import { WakeLockEngine } from "$lib/engines/wake-lock"

// ‏section חדש אחרי ה-VMs (‏לפני בלוק ה-setContext):
// ─── wake-lock ─── (Track C — drive-first chrome)
const wakeLock = new WakeLockEngine()
$effect(() => {
  wakeLock.setEnabled(settings.screenWakeLock) // ‏קריאה ריאקטיבית של $state
  return () => wakeLock.dispose()
})
```

> ‏**‏הערה ל-Avigail על חוק הזהב 1+4**: ה-`$effect` ‏יושב ב-`+layout.svelte` ‏(composition
> root), ‏לא ב-route shell. ‏זה עקבי עם חוק 1 (‏שאוסר effects ב-**routes**, ‏לא בנקודת
> ‏ההרכבה) ‏ועם ה-`$effect` ‏הקיים של dir/lang ‏שכבר שם. ‏חוק 4 ("side effect שייך
> ‏ל-owner של ה-state"): ‏ה-state הוא `settings.screenWakeLock`, ‏אבל ה-**‏מטרה** ‏(‏המסך)
> ‏היא app-global — ‏בדיוק כמו ש-dir/lang קורא `i18n.locale` ‏אבל יושב ב-layout כי
> `<html>` ‏הוא app-global. ‏`Settings` ‏הוא VM persistence טהור ‏ללא effects — ‏לא ‏בעליו הנכון.

**i18n keys** (‏ערכים מדויקים):

| key | he | en |
|-----|-----|-----|
| `settings.screen.label` | ‏מסך | Screen |
| `settings.toggle.keepScreenOn` | ‏השאר מסך דלוק | Keep screen on |

**UI ב-`SettingsScreen.svelte`** (‏כרטיס חדש, ‏אחרי כרטיס "‏קול ודיבור"). ‏ה-toggles
‏הקיימים עטופים ב-`<div class="flex flex-col divide-y">` ‏בשביל קווי-הפרדה בין מספר
‏פריטים; ‏כאן יש toggle **‏בודד** ‏→ ‏אין צורך ב-wrapper (Avigail #3). ‏הצב ישירות:

```svelte
<SettingsCard title={t("settings.screen.label")}>
  <SettingToggle
    label={t("settings.toggle.keepScreenOn")}
    checked={settings.screenWakeLock}
    onCheckedChange={(v) => settings.setScreenWakeLock(v)}
  />
</SettingsCard>
```

**Verification**:

```bash
pnpm --filter @drive-coding/core test       # i18n catalogs
pnpm --filter @drive-coding/frontend test    # settings persist round-trip
pnpm typecheck && pnpm lint && pnpm lint:i18n
# ‏manual (‏כרום דסקטופ, localhost): ‏פתח הגדרות → ‏הדלק "‏השאר מסך דלוק" →
#   ‏ב-DevTools console: navigator.wakeLock ‏קיים, ‏ואין שגיאות. ‏רענן → ‏המתג נשאר דלוק.
```

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | typecheck + build + tests | `pnpm typecheck && pnpm build && pnpm test` ‏ירוקים |
| 2 | lint + lint:i18n | `pnpm lint && pnpm lint:i18n` (‏אין מחרוזת עברית בקוד) |
| 3 | ‏persist round-trip | ‏טסט: `setScreenWakeLock(true)` → localStorage; `new Settings()` ‏קורא חזרה |
| 4 | ‏מתג עובד ב-UI | ‏הגדרות → ‏כרטיס "‏מסך" → ‏toggle נראה, ‏נלחץ, ‏משנה ערך; ‏רענון שומר |
| 5 | ‏engine acquire/release | ‏כרום: ‏הדלק → ‏נוצר sentinel (‏`navigator.wakeLock` ‏פעיל, ‏אין error); ‏כבה → ‏שוחרר |
| 6 | ‏**re-acquire אחרי visibility** | ‏הסתר טאב (‏או `visibilitychange`) ‏→ ‏שוחרר; ‏חזור → ‏נתפס מחדש |
| 7 | ‏regression: ‏הגדרות אחרות | muted/speakThoughts/locale ‏עוד נשמרים ופועלים |
| 8 | ‏(‏משתמשת) ‏טלפון אמיתי | ‏דרך tunnel HTTPS: ‏הדלק → ‏המסך לא נכבה אחרי זמן ה-timeout של המערכת |

> #6 ‏הוא ה-gotcha הקריטי — ‏בלי תפיסה-מחדש הנעילה אובדת בשקט אחרי כל הסתרה.
> #8 ‏הוא האישור הסופי ‏(‏אי-אפשר לאמת "‏מסך נייד נכבה" ‏בכרום דסקטופ) — ‏כלב מאמת 1-7,
> ‏המשתמשת מאשרת 8.

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| ‏Hardcoded Hebrew strings | ‏learnings (‏i18n lint) | ‏כל מחרוזת דרך `t(...)`; `pnpm lint:i18n` ‏ב-pre-commit חוסם |
| ‏נעילה אובדת בשקט אחרי הסתרת טאב | Wake Lock API spec | ‏`visibilitychange` listener + reconcile (‏דרישת engine #6); DoD #6 ‏מאמת |
| `$effect` ‏שכותב state שהוא קורא = ‏לולאה | gotcha 2026-05-16 | ‏ה-effect קורא `settings.screenWakeLock` ‏וכותב ל-engine (‏IO), ‏לא ל-$state → ‏אין לולאה |
| ‏race: toggle/הסתרה תוך כדי `await request()` | async | ‏race-guard אחרי await (‏דרישת engine #4) |
| ‏API לא נתמך / ‏לא secure-context | ‏דפדפן ישן / http | ‏feature-detect (`"wakeLock" in navigator`) + try/catch → ‏no-op שקט, ‏לא קורס |
| ‏נגיעה בקובץ משותף (`+layout`, `keys.ts`) | parallel-safe-code.md | ‏additive בלבד, ‏בתוך section ‏ייעודי; ‏לא לערוך sections קיימים |

> ‏3 ‏שתמיד נשכחים: (1) i18n — ‏מכוסה. (2) Svelte 5 reactivity — ‏ה-effect קורא `$state`
> ‏ריאקטיבית, ‏בטוח. (3) OneCLI — ‏לא רלוונטי (‏אין proxy).

---

## §7 — Escalation triggers

> ‏אם X — ‏עצור ושאל את מרדכי:

- ‏ה-`$effect` ‏ב-`+layout` ‏מתנהג לא צפוי (‏רץ פעמיים / ‏לא מגיב ל-toggle) — ‏ייתכן צורך
  ‏ב-`untrack` ‏או בהעברת ה-wiring ל-VM; ‏החלטה ארכיטקטונית.
- ‏מתברר ש-`SettingToggle` ‏לא תומך ב-API ש-§4 ‏מניח (‏props `label`/`checked`/`onCheckedChange`).
- ‏ה-engine דורש state ל-UI (‏למשל "‏נעילה פעילה?" ‏לחיווי) — ‏זה חורג מ-scope; ‏שאל לפני הוספה.
- ‏רוצה לסטות מ-Testing strategy (‏למשל להוסיף jsdom unit-test ל-engine) — ‏ה-brief קבע
  ‏runtime-only ל-engine; ‏סטייה דורשת אישור.

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|------|------|
| >5 files ‏ב->2 packages (frontend + core, ‏8 ‏קבצים) | +1 |
| State machine / async coordination (‏reconcile + visibility + race-guard) | +2 |
| ‏Greenfield engine, ‏אין call sites קיימים | -1 |

**Score**: 2-3 / 10

**Tier**: `calev` (light, Sonnet) — ‏slice end check בלבד. ‏אין phase-verifier (‏commit יחיד).

**‏הערה לכלב**: ‏הליבה (acquire/release/re-acquire) ‏מאומתת בכרום דסקטופ על `localhost`
(secure context). ‏DoD #1-7 ‏בני-אימות שם. ‏DoD #8 (‏מסך נייד אמיתי) ‏מואצל למשתמשת —
‏ציין זאת בדוח כ-"‏ממתין לאישור-טלפון של המשתמשת", ‏לא כ-fail.

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | ‏סמנטיקה: ‏נעילה כל-עוד-גלוי **‏או** ‏רק-בזמן-turn-פעיל? | ‏**‏כל-עוד-גלוי** — ‏צפוי למתג מפורש, ‏מתאים ל-hands-free, ‏בלי כיבוי מפתיע באמצע קריאה. ‏עידון "‏רק בזמן פעילות" ‏(‏חיסכון סוללה) ‏אפשרי בסלייס עתידי שמגדיר "‏פעילות" (turn/mic/speaker). | ❌ (‏החלטת מרדכי; ‏המשתמשת יכולה לוּטו ב-review) |
| 2 | ‏ברירת המחדל של המתג | ‏`false` (‏opt-in; ‏לא לבזבז סוללה כברירת מחדל) | ❌ |
| 3 | ‏מיקום ה-toggle | ‏כרטיס "‏מסך" ‏חדש (‏לא בכרטיס "‏קול ודיבור" — ‏לא קולי תמטית) | ❌ |

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor ‏תוך כדי)

- אין סטיות. הביצוע עקב אחרי §4 במדויק.
- הוקים biome organizeImports תוקנו אוטומטית (סדר imports ב-+layout.svelte).
- calev GO, 0 findings, DoD #1-7 אומתו. DoD #8 ממתין לאישור-טלפון.

> **‏סטטוס ביצוע**: ‏הושלם (commit e4f78b9, calev GO, 2026-06-22)
