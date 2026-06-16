# Slice win-home-env-driveroot — homedir מ-env + תיקון browse של drive-root — ‏בריף

> **‏תאריך**: 2026-06-15
> **‏סוג מסמך**: ‏בריף ביצועי (‏2 ‏תיקונים קטנים)
> **‏סטטוס**: ‏plan-verified — ‏מוכן לביצוע (‏אחרי אישור משתמש)
> **‏אימות אביגיל**: ✅ **READY** (round 2, 2026-06-15). round 1 — 4 findings; round 2 — READY. ‏דוח: `reports/drive-coding/slice-win-home-env-driveroot-avigail.md`
> **‏מבצע**: ‏מרדכי עצמו (‏המשתמש אישר — ‏לא אליעזר). ‏אחרי אישור.
> **Complexity**: 4/10 (verifier: light)
> **‏תלויות (`depends_on`)**: [slice-windows-adaptation]
> **‏Base**: ‏branch `slice-windows-adaptation` (‏כולל cwd-fix + http-history + http-options)

---

## §0 — Pre-flight

> ‏המשך ל-windows-adaptation. ‏סבב בדיקה חי (2026-06-15) ‏גילה 2 ‏פגמים:
> ‏(1) ‏תיקיית הבית נשלפת מ-`os.homedir()` ‏בלבד (‏המשתמש רוצה גם מ-env vars).
> ‏(2) **‏בורר התיקיות נתקע ב-drive root** (`D:\`) — ‏אי אפשר לבחור תיקייה מחוץ ל-home.

### ‏אבחון מאושש (חי, bun)

- **‏בעיה 1**: `http-options.ts` ‏משתמש ב-`os.homedir()` ‏ל-`homeDir` ‏ול-`listProjectDirs`.
- **‏בעיה 2 (root cause מדויק)**: `fs/browse` ‏(`http-history.ts`) ‏עושה `real = await realpath(normalized)`
  ‏ואז `readdir(real,...)`. ‏על drive-root, **`realpath` ה-async של bun מחזיר `"D:"` ‏(בלי backslash)**
  ‏מ-`"D:\"`, ‏ואז `readdir("D:")` ‏נכשל ב-`ENOENT` → "cannot read directory". ‏הוכח חי:
  `realpathSync("D:\\")`→`"D:\"` ‏תקין; `await realpath("D:\\")`→`"D:"` ‏שבור. ‏תוצאה: ‏ניווט up
  ‏מ-`D:\Users\User` ל-`D:\` ‏(בדרך ל-`D:\UserProjects`) ‏נכשל → ה-picker תקוע.

### ‏סביבה: Windows-native

- BE: `bun src/server.ts` (4000). ‏טסטים: `pnpm test` ‏מהשורש. typecheck: `pnpm --filter @drive-coding/backend typecheck`.
- ‏אימות חי: `Invoke-RestMethod "http://localhost:4000/api/fs/browse?path=D:\"` ‏צריך entries (‏לא 500).

### Reading list

- `packages/backend/src/delivery/http-history.ts` — `registerFsBrowseHttp`: `resolve(rawPath)`, `await realpath(normalized)` (**~142**), containment (**~150-159**), `readdir(real,{withFileTypes:true})` (**~163**). ‏(‏אביגיל: ‏anchors מדויקים — ‏אמת ב-grep לפני עריכה.) ‏ה-fix: ‏נרמול `real` ‏ל-drive-root לפני containment+readdir.
- `packages/backend/src/delivery/http-options.ts` — `listProjectDirs` (`os.homedir()`@71), handler `/api/options` homeDir (**~113**, `os.homedir()`). ‏מחליפים ל-`getHomeDir()`.
- `packages/core/src/cwd-validate.ts` — ‏דפוס Windows-drive regex (`^[a-zA-Z]:[\\/]`).

---

## §1 — ‏מטרה

‏(1) ‏תיקיית הבית מ-env (`HOME`/`USERPROFILE`) ‏עם fallback ל-`os.homedir()`. ‏(2) **‏בורר התיקיות
‏מנווט דרך drive-root** (`D:\`) ‏ללא שגיאה — ‏המשתמש עולה מה-home ל-`D:\` ‏ובוחר כל תיקייה
‏(`D:\UserProjects\AI\drive-coding`). ‏"לא הצלחתי לבחור תיקייה" ‏נפתר.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|------|------|------|
| helper `getHomeDir()` (env-first) + ‏שימוש ב-`listProjectDirs`+`homeDir` | ✅ | Commit 0 |
| ‏תיקון `fs/browse` ‏drive-root (`"D:"`→`"D:\"`) | ✅ | Commit 1 |
| ‏שינוי cwd-validate / FolderPicker FE | ❌ | ‏הבעיה ב-BE realpath |
| drive selector / נרמול separator גורף | ❌ | ‏עתידי / ‏לא נדרש |

---

## §3 — Architecture diagram

```
http-options.ts
  getHomeDir() = process.env.HOME || process.env.USERPROFILE || os.homedir()   ← Commit 0
  listProjectDirs + /api/options homeDir: os.homedir() → getHomeDir()

http-history.ts (registerFsBrowseHttp)
  real = await realpath(normalized)
  + if (/^[a-zA-Z]:$/.test(real)) real += "\\"   ← Commit 1: bun async realpath מסיר
  │   backslash מ-drive-root; readdir("D:") נכשל ENOENT. (לפני containment + readdir + return)
  readdir(real, ...)
```

---

## §4 — Commits ‏בסדר

### Commit 0 — `getHomeDir()` env-first (approach: tdd)

**‏קובץ**: `packages/backend/src/delivery/http-options.ts`.

```ts
/** תיקיית הבית: env (HOME/USERPROFILE) קודם, ואז os.homedir() fallback.
 *  || (לא ??) — כך HOME="" ריק נופל ל-fallback. */
function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir()
}
```
- `listProjectDirs` (~71): `const home = getHomeDir()`.
- handler `/api/options` (~108): `homeDir: getHomeDir()`.

**Tests** (tdd) — `tests/http-options.test.ts`: `vi.stubEnv("HOME","/x")`→`/x`; ‏בלי HOME + `USERPROFILE`→אותו; ‏בלי שניהם→`os.homedir()`. ‏(‏אם private — ‏בדוק דרך `/api/options.homeDir` + stubEnv.)

**Verification**: `pnpm test`.

---

### Commit 1 — `fs/browse` drive-root fix (approach: tdd)

**‏קובץ**: `packages/backend/src/delivery/http-history.ts`.

‏אחרי `real = await realpath(normalized)` (**~142**), ‏לפני containment (~150-159) ו-readdir (~163):

```ts
// bun async realpath מחזיר "D:" (בלי separator) מ-drive-root "D:\" → readdir("D:")
// נכשל ENOENT. הוסף trailing separator. (anchor $ → רק "X:" מדויק, לא "D:\Users".)
if (/^[a-zA-Z]:$/.test(real)) real += "\\"
```

> ⚠️ ‏**‏לפני** ‏בדיקת ההכלה ו-readdir (‏שניהם משתמשים ב-`real`), ‏ולפני ה-`return c.json({path:real})`
> ‏(‏כך ה-FE מקבל `D:\` ‏מנורמל).

**Tests** (tdd) — ‏⚠️ **‏אביגיל 🟡: ‏ה-mock חייב isolation** — ‏בקובץ `http-history.test.ts` ‏יש ~9 ‏טסטי
‏real-FS (`tmpdir`); `vi.mock("node:fs/promises")` ‏גלובלי ישבור אותם. ‏לכן: ‏השתמש ב-**`vi.spyOn`** ‏על
‏`realpath` ‏בתוך `describe` ‏ייעודי בלבד, ‏עם `afterEach(() => vi.restoreAllMocks())` (‏או `mockRestore`),
‏כך שהטסטים האחרים נשארים על real-FS. ‏ה-spy מחזיר `"D:"` ‏ל-input drive-root; ‏ודא ש-`readdir` ‏(spy/real)
‏נקרא עם `"D:\\"`. **‏אלטרנטיבה אם spy מסובך**: ‏extract את ה-normalization ל-helper טהור
‏`normalizeRealpath(real): string` ‏ו-unit-test אותו ישירות (`"D:"→"D:\\"`, `"D:\\Users"→"D:\\Users"`, `"/home"→"/home"`) — ‏**‏מועדף** (‏אפס mock, ‏cross-platform, ‏לא נוגע ב-9 הטסטים).

**Verification**: `pnpm test` + ‏חי: `Invoke-RestMethod "http://localhost:4000/api/fs/browse?path=D:\"` → entries.

---

### Commit 2 — Docs (approach: none)

- walkthrough + ‏סטטוס brief.

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | typecheck + `pnpm test` | ‏0 ‏כשלונות מלבד pre-existing |
| 2 | `getHomeDir` env-first | ‏stubEnv test |
| 3 | **fs/browse drive-root** | `.../fs/browse?path=D:\` → entries (‏לא 500) |
| 4 | **picker עד drive-root** (חי FE) | ‏picker → up מ-home ל-`D:\` → תיקיות → `D:\UserProjects` → בחר. screenshot |
| 5 | regression browse בתוך home | `D:\Users\User`, `D:\UserProjects\AI` ‏עובדים |
| 6 | lint:i18n | `pnpm lint:i18n` |

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| ‏regex תופס לא-root | `^[a-zA-Z]:$` | `$` ‏anchor → ‏רק `X:` ‏מדויק. `D:\Users`→לא match. |
| ‏טסט drive-root ב-CI לינוקס | platform | ‏extract `normalizeRealpath` helper טהור + unit-test ישיר (‏cross-platform, ‏אפס mock — ‏הגישה המועדפת ב-Commit 1). |
| HOME ריק | env | `||` ‏(לא `??`) → `""` ‏נופל ל-fallback. |
| path בתשובה לא מנורמל | http-history return | ‏fix לפני return → `path:real`=`D:\`. |
| `os` ‏לא מיובא | http-options | ‏כבר מיובא. |

---

## §7 — Escalation triggers

- ‏ה-drive-root fix לא פותר את ה-picker → ‏אבחן navigateUp ב-FE (‏בעיה נוספת).
- bun realpath מחזיר `D:\` ‏תקין בגרסה אחרת → ‏ה-fix idempotent (‏regex לא תופס), ‏אבל דווח.
- `getHomeDir` ‏דורש שינוי ב-cli-config-file (resolveCliSpecsPath) → ‏מחוץ ל-scope.

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|------|------|
| 2 ‏תיקונים קטנים, backend | +1 |
| Pure logic | +1 |
| ‏בדיקה חית (picker) | +1 |
| TDD | -1 |
| ‏בסיס glue | +2 |

**Score**: 4/10 → **`calev` (light)**. ‏אין verifier-phase.

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | `getHomeDir` `||` ‏או `??`? | `||` (‏גם ריק→fallback) | ❌ |
| 2 | drive-root fix גם ל-UNC? | ‏לא — ‏רק drive-letter | ❌ |
| 3 | drive selector ל-picker? | ‏לא — ‏ניווט up מספיק | ❌ |

---

## ‏סטיות (‏מתעדכן ע"י המבצע)

- ...
