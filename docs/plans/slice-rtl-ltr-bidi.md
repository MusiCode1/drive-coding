# Slice rtl-ltr-bidi — תמיכה דו-כיוונית מלאה (he/en ↔ rtl/ltr) — ‏תוכנית

> **‏תאריך**: 2026-06-03
> **‏סטטוס**: הושלם (2026-06-03)
> **Complexity**: 3/10 (verifier: light)
> **‏תלויות (`depends_on`)**: []
> **‏Base**: dev
> **‏Dev tip**: `8f59ec3`

---

## §0 — Pre-flight

> ‏הקדמה חשובה למבצע: ה-FE **‏כבר RTL-clean כמעט לחלוטין**. סריקה (2026-06-03) מצאה 0 physical Tailwind classes, ו-CSS שכבר משתמש ב-logical properties (`padding-inline-start`, `border-inline-start`, `inset-inline-start`, `border-start-start-radius`, `border-s`). ה-`dir` attributes כבר נכונים (Switch=ltr, code/terminal=ltr, bubbles=auto). **‏אל תעשה "המרה גדולה" — היא כבר נעשתה.** ה-slice הזה סוגר את החור היחיד שמונע דו-כיווניות: ה-`<html dir>` קבוע ל-`rtl` ולא מגיב לשפה. בנוסף — בורר שפה + lint שמגן על הניקיון הקיים.

### ‏תלויות (‏חובה!)

‏slice זה **‏אין לו תלויות** — ‏בנוי ישירות על dev (`8f59ec3`).

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-rtl-ltr-bidi -b slice-rtl-ltr-bidi dev
cd .worktrees/slice-rtl-ltr-bidi
pnpm install && pnpm hooks:install
```

### ‏איך להריץ

- BE: ‏לא נדרש לרוב הבדיקה (זה FE-only). ‏אם בכל זאת: `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (port 4000).
- FE: `pnpm --filter @drive-coding/frontend dev` (port: OS-assigned, ראה startup log).
- ‏Tests: `pnpm test` (כל החבילות) ‏או `pnpm --filter @drive-coding/frontend test`.
- ‏Typecheck: `pnpm --filter @drive-coding/frontend typecheck`.
- ‏lint:i18n: `pnpm lint:i18n` (‏חוסם מחרוזות עברית בקוד).

### Browser

‏בדיקה ב-linux-gui Chrome :9222 profile voice-acp:
`playwright-cli -s=vacp attach --cdp=http://localhost:9222`.
‏⚠️ ‏תמיד `-s=vacp` (default session שייך לסוכן אחר). ‏אין DISPLAY במכונה — ‏רק linux-gui.
‏הבדיקה הקריטית: ‏טען `/chat`, ‏החלף שפה ל-English, ‏וודא ש-`document.documentElement.dir === "ltr"` ‏ושהפריסה מתהפכת ויזואלית; ‏חזרה לעברית → `rtl`.

### Reading list

**must-read** (‏לפני שמתחילים):
- ‏`packages/frontend/AGENTS.md` — ‏5 חוקי הזהב + ‏מבנה 5 השכבות. ‏קריטי: `+layout.svelte` ‏הוא **‏המקום היחיד** שיוצר VMs ‏ומחזיק side-effects של אתחול.
- ‏`packages/frontend/src/lib/view-models/i18n.svelte.ts` — ‏ה-VM שמחזיק `locale` + `setLocale` (28 שורות, ‏קרא במלואו).
- ‏`packages/frontend/src/lib/view-models/settings.svelte.ts` — ‏דפוס persisted field (איך מוסיפים שדה נשמר; ‏הוראות בראש הקובץ שורות 6-13).

**reference** (‏בזמן עבודה):
- ‏`packages/core/src/i18n/index.ts` (detectLocale, ‏שורות 48-52) ו-`keys.ts` (`type Locale = "he" | "en"`, ‏שורה 18).
- ‏`packages/frontend/src/lib/components/ui/Select.svelte` — ‏בורר רספונסיבי לשימוש חוזר (props: `value`, `options: SelectOption[]`, `title`). ‏לבורר השפה.
- ‏`packages/frontend/src/lib/components/settings/SettingsScreen.svelte` — ‏לאן מוסיפים את בורר השפה.

---

## §1 — ‏מטרה

‏אחרי ה-slice, ‏המשתמשת יכולה להחליף את שפת הממשק בין עברית לאנגלית מתוך מסך ההגדרות. ‏ההחלפה **‏מתהפכת מיידית בכל הממשק** — ‏לא רק המחרוזות (i18n כבר עובד), ‏אלא גם **‏כיוון הפריסה**: עברית → RTL (סיידבר ימין, ‏טקסט מיושר לימין), ‏אנגלית → LTR (סיידבר שמאל, ‏טקסט מיושר לשמאל). ‏הבחירה נשמרת ושורדת reload. ‏ברירת המחדל ‏בטעינה ראשונה נגזרת משפת הדפדפן (כמו היום). ‏כל הרכיבים הקיימים (toggles, ‏code blocks, ‏terminal, ‏file paths) ‏שומרים על הכיוון הנכון שלהם בשתי השפות (לא מתהפכים בטעות).

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|------|------|------|
| ‏חיווט `dir`/`lang` דינמי על `<html>` לפי locale | ✅ | ‏בslice הזה (הליבה) |
| `locale` ‏כ-persisted field ב-Settings (שורד reload) | ✅ | ‏בslice הזה |
| `I18nVM.locale` ‏נגזר מ-Settings (מקור-אמת אחד) | ✅ | ‏בslice הזה (refactor קטן) |
| ‏בורר שפה ב-SettingsScreen | ✅ | ‏בslice הזה |
| ‏lint test: ‏אין physical Tailwind classes ב-`.svelte` | ✅ | ‏בslice הזה (הגנת רגרסיה) |
| ‏lint test: ‏אין physical CSS props ב-`<style>` | ✅ | ‏בslice הזה |
| ‏המרת physical→logical בקוד קיים | ❌ | ‏**אין מה להמיר** — ‏הקוד כבר נקי. ‏ה-lint רק מוודא שיישאר כך |
| ‏הוספת שפות נוספות (ar וכו') | ❌ | ‏עתידי — ‏ה-Locale type הוא `"he"\|"en"` בלבד |
| ‏תרגום מחרוזות חסרות ב-en.ts | ❌ | ‏אם המבצע מגלה מפתח חסר ב-en → ‏מתעד ב-§סטיות, ‏לא מתרגם הכל |
| ‏שינוי ה-`.toggle::after` (right physical) | ❌ | ‏**לא צריך** — ‏ה-Switch נושא `dir="ltr"` ‏אז ה-toggle לא מתהפך (visual-only). ‏לא לגעת |

> ‏זו לא טבלת TODO. ‏זו הגנה מ-scope creep.

---

## §3 — Architecture diagram

```
                     ┌──────────────────────────┐
   localStorage  ◄───┤  Settings (VM)           │ ← ‏משתנה: +locale field
   (persisted)       │   locale: $state<Locale> │    + setLocale() + persist
                     └────────────┬─────────────┘
                                  │ getSettings().locale
                                  ▼
                     ┌──────────────────────────┐
                     │  I18nVM (VM)             │ ← ‏משתנה: locale נגזר
                     │   locale ← settings      │    מ-Settings (לא detectLocale)
                     │   t(key) (כבר ריאקטיבי)  │
                     └────────────┬─────────────┘
                                  │
        ┌─────────────────────────┼──────────────────────────┐
        ▼                         ▼                          ▼
┌───────────────┐    ┌─────────────────────────┐   ┌──────────────────┐
│ LanguageSelect│    │ +layout.svelte          │   │ ‏כל הרכיבים       │
│  (component)  │    │  $effect: sync           │   │ (כבר logical/dir)│
│  ← ‏חדש        │    │  documentElement.dir+lang│   │ ‏ללא שינוי        │
│  ב-Settings   │    │  ← ‏חדש (effect בלבד)     │   └──────────────────┘
│  Screen       │    └─────────────────────────┘
└───────────────┘
```

‏(ASCII. ‏המהות: Settings = ‏מקור-אמת persisted. I18nVM נגזר. `+layout` ‏מסנכרן את ה-DOM `dir`/`lang`. רכיב בורר חדש ב-Settings. ‏שאר הקוד — ‏0 שינוי, ‏כבר נקי.)

---

## §4 — Commits ‏בסדר

### Commit 0 — locale ‏כ-persisted field ב-Settings (approach: manual)

> ‏מטרה: ‏לעשות את `locale` ‏שדה נשמר ב-Settings, ‏כדי שהבחירה תשרוד reload ‏ותהיה מקור-אמת אחד. ‏ברירת מחדל נגזרת מ-`detectLocale()` (התנהגות נוכחית) ‏בטעינה ראשונה.

**‏קבצים שמשתנים**:
- `packages/frontend/src/lib/view-models/settings.svelte.ts` — ‏מוסיף שדה `locale` ‏לפי הדפוס בראש הקובץ (שורות 6-13): (1) ‏הוסף ל-`Persisted` type, (2) ‏הוסף ל-`DEFAULTS`, (3) `$state` + ‏ctor load + `setLocale` ‏שקורא `#persist()`.

**‏פרטי מימוש**:
- `import type { Locale } from "@drive-coding/core/i18n"` (‏הטיפוס מיוצא משם — ‏אומת ב-keys.ts:18).
- ‏ב-`Persisted`: ‏הוסף `locale: Locale` ‏בבלוק domain חדש `// ─── שפה ───`.
- ‏ב-`DEFAULTS`: `locale: detectLocale()` — **‏זהירות**: `DEFAULTS` ‏הוא const ברמת module. ‏אם `detectLocale()` ‏נקרא שם, ‏הוא ירוץ פעם אחת ב-import-time (navigator זמין ב-SPA, `ssr=false`). ‏זה תקין. ‏אם המבצע מעדיף — ‏אפשר `locale: DEFAULT_LOCALE` ‏ב-DEFAULTS ‏ולגזור detectLocale ‏רק כש-localStorage ריק. ‏**ברירת מחדל מומלצת**: ‏ב-DEFAULTS ‏שים `DEFAULT_LOCALE` (קבוע "he"), ‏וב-`load()` ‏כש-`!raw` (אין ערך שמור) ‏החזר `{ ...DEFAULTS, locale: detectLocale() }`. ‏כך detectLocale ‏רץ רק כשבאמת אין העדפה שמורה.
- ‏שדה: `locale = $state<Locale>(DEFAULTS.locale)`, ‏ctor: `this.locale = loaded.locale`, ‏setter: `setLocale = (l: Locale): void => { this.locale = l; this.#persist() }`.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck
# ‏ידני: ‏ב-devtools console — localStorage.getItem("drive-coding-v2-settings") ‏מכיל locale אחרי setLocale
```

### Commit 1 — I18nVM ‏נגזר מ-Settings (approach: manual)

> ‏מטרה: ‏מקור-אמת אחד ל-locale. ‏היום I18nVM ‏מחזיק locale ‏עצמאי (detectLocale ‏ב-init). ‏אחרי: I18nVM ‏מקבל Settings ‏וה-locale שלו נגזר ממנו. ‏מבטל את הכפילות.

**‏קבצים שמשתנים**:
- `packages/frontend/src/lib/view-models/i18n.svelte.ts` — ‏refactor (28 שורות, ‏שינוי קטן).
- `packages/frontend/src/routes/+layout.svelte` — ‏סדר אתחול: `settings` ‏לפני `i18n`, ‏והעברת settings ל-ctor.

**API skeleton** (‏החתימה החדשה של I18nVM):
```ts
import type { Settings } from "./settings.svelte"

export class I18nVM {
  #settings: Settings
  constructor(opts: { settings: Settings })  // ← ‏חדש: ‏מקבל settings
  // locale ‏נגזר: get locale() { return this.#settings.locale }  (או $derived)
  // setLocale ‏מאציל ל-settings: setLocale = (l) => this.#settings.setLocale(l)
  t: (key: MessageKey) => string  // ‏ללא שינוי בחתימה
}
```

**‏פרטי מימוש**:
- ‏הסר `detectLocale` ‏מ-I18nVM (עובר ל-Settings/Commit 0). ‏הסר `locale = $state(...)`.
- `get locale(): Locale { return this.#settings.locale }` — ‏או `locale = $derived(this.#settings.locale)`. **‏העדפה**: getter פשוט (`get locale()`) — ‏פחות מנגנון, ‏ו-`#i18n = $derived(createI18n({ locale: this.locale }))` ‏עדיין ריאקטיבי כי הוא קורא getter שקורא $state של settings.
- `setLocale = (locale: Locale): void => { this.#settings.setLocale(locale) }` — ‏שמירת ה-API החיצוני (קוראים קיימים, ‏אם יש, ‏לא נשברים).
- ‏ב-`+layout.svelte`: ‏ודא ש-`const settings = new Settings()` ‏מופיע **‏לפני** `const i18n = new I18nVM({ settings })`. ‏היום settings ‏מוגדר בשורה 36, i18n ‏בשורה 33 → ‏צריך להעביר את i18n ‏אחרי settings, ‏או להעביר settings ‏למעלה. ‏שמור על בלוקי ה-`// ─── domain ───` (parallel-safe convention) — ‏זה שינוי invasive לקובץ משותף, ‏מותר כי ‏הוא הכרחי וקטן; ‏תעד ב-commit message.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck
# ‏ידני: t() ‏עדיין מתרגם; ‏החלפת settings.locale ‏(console) → ‏המחרוזות מתחלפות ריאקטיבית
```

### Commit 2 — סנכרון `dir`/`lang` ל-DOM ב-`+layout` (approach: manual, **‏הליבה**)

> ‏מטרה: ‏הקסם. `$effect` ‏שמסנכרן את `<html dir>` ‏ו-`<html lang>` ‏ל-locale. ‏זה מה שהופך את התמיכה לדו-כיוונית באמת.

**‏קבצים שמשתנים**:
- `packages/frontend/src/routes/+layout.svelte` — ‏מוסיף `$effect` ‏ובלוק `// ─── dir/lang sync ───`.
- `packages/frontend/src/app.html` — ‏אופציונלי: ‏ה-`dir="rtl"` ‏הקבוע יכול להישאר כ-default טעינה (FOUC minimal כי he ‏הוא ברירת המחדל). ‏**העדפה**: ‏השאר את `app.html` ‏כמו שהוא (`lang="he" dir="rtl"`) — ‏ה-effect ידרוס בזמן ריצה. ‏אם המבצע רוצה להימנע מ-flash ב-en — ‏לא חוסם, ‏אבל לא נדרש.

**‏פרטי מימוש** (‏בלוק חדש ב-`+layout.svelte` ‏אחרי ה-setContext):
```ts
// ─── dir/lang sync ─── (rtl-ltr-bidi)
// ‏RTL_LOCALES — ‏מאיזה locale ‏ה-document עובר ל-rtl. ‏היום רק he.
const RTL_LOCALES: Locale[] = ["he"]
$effect(() => {
  const loc = i18n.locale  // ‏קריאה ריאקטיבית
  const dir = RTL_LOCALES.includes(loc) ? "rtl" : "ltr"
  document.documentElement.dir = dir
  document.documentElement.lang = loc
})
```
- `import type { Locale } from "@drive-coding/core/i18n"`.
- ‏ה-`$effect` ‏ב-`+layout.svelte` ‏מותר (זה ה-composition root, ‏וזה side-effect של אתחול/סנכרון גלובלי — ‏שייך כאן לפי AGENTS.md "side effects שייכים ל-owner; ‏effects שצריכים DOM גלובלי נשארים ב-shell"). ‏ה-`<html>` ‏אינו DOM-node של component ספציפי → ‏layout ‏הוא המקום הנכון.
- ‏⚠️ ‏Svelte gotcha (memory `$effect that reads+writes same $state`): ‏ה-effect כאן ‏**‏קורא** `i18n.locale` ‏(state) ‏ו**‏כותב** ל-`document.documentElement` (DOM, ‏לא $state) → ‏**‏אין infinite loop**. ‏בטוח.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck && pnpm --filter @drive-coding/frontend build
# ‏ידני (linux-gui): ‏טען /chat. ‏console: document.documentElement.dir === "rtl".
#   ‏הרץ getSettings().setLocale("en") (דרך __session? ‏או דרך הבורר ב-Commit 3) →
#   document.documentElement.dir === "ltr", ‏הסיידבר עובר צד, ‏הטקסט מיושר לשמאל.
```

### Commit 3 — בורר שפה ב-SettingsScreen (approach: manual)

> ‏מטרה: ‏UI להחלפה. ‏רכיב קטן שמשתמש ב-`Select` הקיים, ‏בכרטיס חדש ב-SettingsScreen.

**‏קבצים חדשים**:
- `packages/frontend/src/lib/components/settings/LanguageSelect.svelte` — ‏component (leaf). `getI18n()` ‏ל-locale נוכחי + `setLocale`. ‏מציג `Select` ‏עם 2 אפשרויות.

**‏קבצים שמשתנים**:
- `packages/frontend/src/lib/components/settings/SettingsScreen.svelte` — ‏מוסיף `<SettingsCard>` ‏עם `<LanguageSelect />`.
- ‏i18n keys: `packages/core/src/i18n/keys.ts` + `catalogs/he.ts` + `catalogs/en.ts` — ‏מפתחות חדשים: `settings.language.label`, `settings.language.he`, `settings.language.en`. ‏(he ‏חובה, en ‏placeholder/אנגלית.)

**API skeleton** (LanguageSelect):
```svelte
<script lang="ts">
import { getI18n } from "$lib/context"
import Select from "$lib/components/ui/Select.svelte"
import type { Locale } from "@drive-coding/core/i18n"
const i18n = getI18n()
const t = i18n.t
// Select ‏עובד עם string value; ‏ה-Locale ‏הוא "he"|"en" ‏אז cast בטוח.
// ‏אין bind:value/​$effect — ‏מקור-האמת הוא i18n.locale (נגזר מ-Settings),
// ‏ו-onchange ‏מאציל ישירות ל-setLocale. ‏הריאקטיביות מגיעה מ-value={i18n.locale}.
</script>

<Select
  value={i18n.locale}
  options={[
    { value: "he", label: t("settings.language.he") },
    { value: "en", label: t("settings.language.en") },
  ]}
  title={t("settings.language.label")}
  onchange={(v) => i18n.setLocale(v as Locale)}
/>
```
- ‏**Select API (‏אומת ע"י אביגיל מול Select.svelte:38-49)**: ה-props הם `value?: string`, `options?: SelectOption[]`, `title?: string`, **`onchange?: (value: string) => void`** — ‏**‏לא** `onValueChange` ‏ו**‏לא** `bind:value`+callback. ‏הדפוס הקנוני הוא `onchange={(v) => ...}` (ראה VoicePicker.svelte:56 ‏לדוגמה זהה). `SelectOption = { value: string; label: string; disabled?: boolean }` (module block ב-Select.svelte:2).
- ‏⚠️ ‏i18n lint: ‏אסור מחרוזות עברית בקוד. ‏שמות השפות ("עברית"/"English") ‏הם **‏מחרוזות UI** → ‏חייבים לעבור דרך i18n keys, ‏לא hardcoded. (‏לכן `settings.language.he`/`settings.language.en`.)

**Verification**:
```bash
pnpm lint:i18n          # ‏אסור עברית בקוד
pnpm --filter @drive-coding/frontend typecheck
# ‏ידני (linux-gui): ‏פתח /settings (או /chat → ‏הגדרות), ‏ראה את בורר השפה.
#   ‏בחר English → ‏הממשק עובר ל-LTR + ‏אנגלית. reload → ‏נשאר English.
#   ‏בחר עברית → ‏חוזר ל-RTL.
```

### Commit 4 — lint protection tests (approach: manual)

> ‏מטרה: ‏הגנת רגרסיה. ‏הקוד נקי היום — ‏lint שנכשל אם מישהו יכניס physical class/property בעתיד.

**‏קבצים חדשים**:
- `scripts/lint-no-physical-classes.mjs` (‏ב-**root** scripts/, ‏לא packages/frontend) — ‏סורק `packages/frontend/src/**/*.svelte` ‏ל-physical Tailwind classes ו-physical CSS props. ‏exit 1 ‏אם נמצא (עם allow-list). ‏**עקביות**: ‏ה-lint הקיים `scripts/lint-no-hebrew-in-code.mjs` ‏הוא Node `.mjs` ‏ב-root scripts/ ‏(עם wrapper bash דק `scripts/lint-no-hebrew-in-code.sh`). ‏חקה את אותו מבנה: `.mjs` ‏ב-root scripts/.

**‏פרטי מימוש** (‏הסקריפט):
- ‏Tailwind physical: ‏regex ל-`\b(pl|pr|ml|mr|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br)-` ‏בתוך `class=`/`class:`. **Allow-list**: `left-1/2`/`right-1/2` ‏(centering), `text-left`/`text-right` ‏רק אם בתוך `dir="ltr"` ‏context (פשוט יותר: ‏אסור `text-left|text-right` ‏לגמרי — ‏אין כיום, ‏ואין צורך).
- ‏CSS physical (בתוך `<style>`): `padding-left|padding-right|margin-left|margin-right|border-left|border-right|float:\s*(left|right)`. **Allow-list**: `text-align: center` (סימטרי), `right:`/`left:` ‏בתוך `.toggle::after` (visual toggle, `dir=ltr`). ‏הדרך הפשוטה: ‏allow-list ‏לפי שם קובץ+תבנית (app.css ‏toggle), ‏או הערה מיוחדת `/* rtl-allow */` ‏בשורה.
- **‏המלצה**: ‏שמור את הסקריפט פשוט ועקבי עם `scripts/lint-no-hebrew-in-code.sh` ‏הקיים (אותו סגנון exit codes + ‏הדפסת קובץ:שורה). ‏קרא אותו לדפוס.
- ‏הוסף ל-`package.json` (root או frontend): `"lint:rtl": "bash packages/frontend/scripts/lint-no-physical-classes.sh"`.
- ‏הוסף ל-`package.json` (root): `"lint:rtl": "node scripts/lint-no-physical-classes.mjs"` (‏עקבי עם `lint:i18n`).
- ‏**‏אל תוסיף ל-pre-commit hook** ‏ב-slice הזה (כדי לא לשבור commits של סוכנים אחרים שלא מודעים) — ‏רק script נפרד. ‏אם רוצים hook → ‏slice עתידי / ‏החלטת מרדכי.

**Verification**:
```bash
pnpm lint:rtl    # ‏עובר על dev הנוכחי (הקוד נקי → exit 0)
# ‏negative test: ‏הוסף זמנית class="pl-4" ‏לקובץ → ‏הרץ → exit 1 → ‏הסר.
```

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | typecheck + build נקיים | `pnpm --filter @drive-coding/frontend typecheck && pnpm --filter @drive-coding/frontend build` |
| 2 | ‏כל הטסטים עוברים | `pnpm test` |
| 3 | lint:i18n ‏עובר | `pnpm lint:i18n` |
| 4 | lint:rtl ‏עובר על הקוד הנקי | `pnpm lint:rtl` → exit 0 |
| 5 | lint:rtl ‏תופס physical class | ‏הוסף `class="pr-4"` ‏זמני → exit 1 → ‏הסר |
| 6 | ‏החלפה ל-English הופכת ל-LTR | linux-gui: ‏בחר English בבורר → `document.documentElement.dir === "ltr"` ‏+ ‏הסיידבר עובר צד |
| 7 | ‏חזרה לעברית הופכת ל-RTL | ‏בחר עברית → `dir === "rtl"` ‏+ ‏הסיידבר חוזר |
| 8 | ‏הבחירה שורדת reload | ‏בחר English → reload → ‏עדיין LTR + ‏אנגלית; localStorage ‏מכיל locale |
| 9 | ‏ברירת מחדל מהדפדפן | ‏נקה localStorage → reload → ‏locale = ‏שפת הדפדפן (he ‏אם navigator.language=he-IL) |
| 10 | ‏toggles/code/terminal לא מתהפכים | ‏ב-LTR: ‏Switch עדיין נראה תקין, code blocks LTR, file paths LTR |
| 11 | mobile + desktop | screenshot ‏של ‏שני viewports בשתי השפות (4 צילומים) |
| 12 | regression: i18n ‏עדיין עובד | ‏המחרוזות הקיימות מתורגמות נכון בשתי השפות |

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| Hardcoded Hebrew strings (שמות שפות) | learnings + AGENTS.md | ‏שמות השפות דרך i18n keys (`settings.language.he/en`), ‏לא בקוד. ‏pre-commit hook חוסם. ‏ודא `pnpm hooks:install`. |
| Svelte 5 $effect ‏read+write same $state = loop | memory 2026-05-16 | ‏ה-effect ב-Commit 2 ‏קורא $state ‏וכותב ל-DOM (לא $state) → ‏בטוח. ‏ה-effect ב-LanguageSelect ‏מסנכרן value ‏רק כש-`value !== locale`. |
| ‏סדר אתחול ב-+layout (settings ‏לפני i18n) | ‏refactor Commit 1 | ‏ודא `new Settings()` ‏מופיע לפני `new I18nVM({ settings })`. typecheck ‏יתפוס אם חסר arg. |
| ‏שינוי invasive ל-+layout.svelte (קובץ משותף) | parallel-safe-code.md | ‏השינוי הכרחי וקטן (סדר + arg + effect block). ‏עבוד בבלוקי `// ─── domain ───`, ‏תעד ב-commit. ‏אין slice מקביל פעיל שנוגע ב-+layout. |
| ‏מפתח חסר ב-en.ts ‏(מחרוזות שלא תורגמו) | i18n catalogs | ‏ה-slice לא אחראי לתרגם הכל. ‏אם מתגלה מפתח עברי-בלבד → ‏תעד ב-§סטיות. **‏אביגיל אימתה: אין parity test בין he/en** — ‏לכן הוספת המפתחות החדשים לא תשבור טסט קיים. ‏פשוט הוסף את 3 המפתחות לשני הקטלוגים. |
| FOUC ‏ב-en (html טוען rtl ‏ואז מתהפך) | app.html ‏קבוע | ‏מקובל (he ‏ברירת מחדל; en ‏פלאש קצר). ‏לא חוסם. ‏אם מפריע → ‏slice עתידי עם inline script ב-app.html. |

> ‏3 שתמיד נשכחים:
> 1. Hardcoded strings → i18n ✅ (‏שמות שפות)
> 2. Reactivity gotchas ✅ (‏effect read/write)
> 3. OneCLI placeholder — ‏לא רלוונטי (FE-only, ‏אין proxy call חדש)

---

## §7 — Escalation triggers

> ‏אם X — ‏עצור ושאל את מרדכי:

- ‏ה-`$effect` ‏ב-+layout ‏לא רץ (locale ‏לא ריאקטיבי דרך getter) — ‏שקול `$derived` ‏במקום getter.
- ‏(‏הוסר ע"י אביגיל: ‏החתימה של Select ‏אומתה — `onchange`, ‏לא loop-risk. ‏ו-I18nVM ‏אין לו קוראים חיצוניים — ‏ה-refactor zero-risk. ‏ואין parity test.)
- ‏Brief סותר את עצמו / ‏אתה רוצה לסטות מ-approach.

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|------|------|
| Refactor של קוד קיים (I18nVM + +layout) | +1 |
| >5 files ‏ב->2 packages (frontend + core i18n) | +1 |
| ‏Greenfield component (LanguageSelect, lint script) | -1 |
| ‏אין IO / ‏אין streaming / ‏אין protocol | 0 |
| ‏אין state machine / async | 0 |
| ‏שינוי קובץ משותף רגיש (+layout) | +1 |
| ‏בסיס: glue + UI | +1 (base) |

**Score**: 3 / 10

**Tier**: 0-3 → `calev` (verifier-slice-light) ‏בלבד. ‏אין verifier-phase.

**‏Verifier-phase**: ‏אין (slice קטן ורציף).

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | ‏איפה בדיוק בורר השפה — ‏כרטיס נפרד ב-SettingsScreen ‏או בתוך כרטיס "קול ודיבור"? | ‏כרטיס נפרד חדש (`settings.language.label`) ‏בראש המסך | ❌ |
| 2 | ‏האם להוסיף את lint:rtl ‏ל-pre-commit hook? | ‏לא ב-slice הזה (script נפרד בלבד) — ‏מונע שבירת commits של סוכנים אחרים | ❌ |
| 3 | FOUC ‏ב-en בטעינה — ‏לטפל עכשיו (inline script ב-app.html) ‏או לדחות? | ‏לדחות — he ‏ברירת מחדל, ‏הפלאש מינורי | ❌ |
| 4 | ‏מקור-אמת ל-locale — Settings ‏(persisted) ‏או I18nVM? | Settings = ‏מקור-אמת, I18nVM ‏נגזר (Commit 0+1) | ❌ (‏הוכרע) |

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor ‏תוך כדי)

> ‏ה-executor מתעד פה כל סטייה ‏מה-brief ‏ולמה.

- ...
