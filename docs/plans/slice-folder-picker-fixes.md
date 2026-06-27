# Slice folder-picker-fixes — שני תיקוני בורר התיקיות (מסך החיבור) — בריף

> **תאריך**: 2026-06-27
> **סוג מסמך**: בריף ביצועי לסלייס — לא תוכנית טרום-בריף
> **סטטוס**: ממתין לאימות אביגיל
> **אימות אביגיל**: (טרם — הרץ אחרי כתיבה)
> **Dispatch**: מותר לאליעזר רק אם `אימות אביגיל = READY`; אחרת זה בריף לא-גמור.
> **Complexity**: 3/10 (verifier: light → `calev`)
> **תלויות (`depends_on`)**: [] — בנוי ישירות על dev
> **Base**: dev
> **Dev tip**: `88d447b`

---

## §0 — Pre-flight

### תלויות (חובה!)

slice זה **אינו תלוי** באף slice אחר. בנוי ישירות על `dev` (`88d447b`). נשען על תשתית קיימת:
- בורר התיקיות `FolderPickerDialog.svelte` (קיים, redesign-6) + ה-adapter `fs-browse.ts`.
- ה-endpoint `GET /api/fs/browse` ב-`http-history.ts` (קיים) + ה-integration test שלו.
- ה-modals VM (`modals.folderOpen` / `openFolder()` / `closeFolder()`).

> ⚠️ **שים לב לשרשרת**: סלייס `slice-connect-recent-projects` יבנה **מעל** הסלייס הזה
> (`depends_on: [folder-picker-fixes]`). הוא יישען על ה-prop החדש `startPath` שמועבר
> ל-`<FolderPickerDialog/>` (Commit 2). אל תשנה את החתימה הזו בלי לעדכן את מרדכי.

### Worktree

```bash
cd /home/user/projects/drive-coding
git worktree add /home/user/projects/drive-coding/.worktrees/folder-picker-fixes -b slice/folder-picker-fixes dev
cd /home/user/projects/drive-coding/.worktrees/folder-picker-fixes
pnpm install && pnpm hooks:install
```
(bare repo — נתיב אבסולוטי חובה. ה-branch הוא `slice/folder-picker-fixes`, ה-dir בלי הקידומת.)

### איך להריץ

- **BE** (port 4000; אם תפוס → `PORT=4002`):
  ```bash
  cd packages/backend
  onecli run --agent voice-acp -- bun --watch src/server.ts
  ```
  (בורר התיקיות לא דורש credentials — גם `bun src/server.ts` עובד לבדיקה זו.)
- **FE dev**: `pnpm --filter @drive-coding/frontend dev` (Vite בוחר port; אם BE לא על 4000 → `BE_PORT=<n>`).
- **Tests BE**: `pnpm vitest run packages/backend` (מה-root). ⚠️ **לא** `pnpm --filter
  @drive-coding/backend test` — ל-`packages/backend` **אין** script `test` (no-op שמסיים 0 בלי
  להריץ כלום). ה-runner היחיד הוא ה-root vitest (`vitest.config.ts` עם `projects`). לקובץ בודד:
  `pnpm vitest run packages/backend/tests/http-history.test.ts`.
- **Typecheck**: `pnpm -r typecheck`
- **Lint i18n**: `pnpm lint:i18n` (חוסם עברית בקוד — הסלייס הזה לא מוסיף מחרוזות UI, כך שאמור לעבור).

### Browser

באג #1 (פתיחת הבורר בנתיב שהוזן) ובאג #2 (הסתרת תיקיות מוסתרות) נבדקים **ידנית בדפדפן** —
זו UI integration, לא בדיקה אוטומטית. השתמש ב-`playwright-cli` (skill) או דפדפן רגיל מול ה-FE dev.
לבאג #2 יש גם integration test ב-BE (אמת אוטומטית בנוסף).

### Reading list

**must-read**:
- `packages/frontend/src/lib/components/modals/FolderPickerDialog.svelte` — כל הקובץ (~257 שורות).
  קריטי: `currentPath` (28), ה-`$effect` על `modals.folderOpen` (37-45), `openAtStart()` (49-61),
  `loadFolder()` (80-96), `onToggleHidden()` (98-101).
- `packages/backend/src/delivery/http-history.ts` שורות 101-192 — `HIDDEN_PREFIXES` (103),
  `registerFsBrowseHttp` והפילטר (178-179).
- `packages/backend/tests/http-history.test.ts` שורות 209-249 — הטסטים הקיימים של hidden folders.
- `packages/frontend/src/routes/+page.svelte` שורות 24-25 (`cwd` state), 192-203 (כפתור התיקייה →
  `modals.openFolder()`), 236 (`<FolderPickerDialog />`).

> ⚠️ **mount כפול של `FolderPickerDialog`** (אביגיל finding #1): הרכיב מרונדר ב**שני** מקומות —
> `+page.svelte:236` (מסך החיבור, לא עטוף ב-AppShell) **וגם** `packages/frontend/src/lib/components/layout/AppShell.svelte:345`
> (משרת `/chat` + `/settings`). **רק** ה-mount של `+page.svelte` בסקופ הסלייס הזה. ה-prop `startPath`
> אופציונלי עם default `""`, כך שה-mount של AppShell ימשיך לעבוד ללא שינוי — **השאר אותו כפי שהוא**
> (אל תוסיף `startPath` שם). שני ה-mounts בתתי-עצים נפרדים של routes → אין התנגשות runtime. כשתריץ
> `grep` על `FolderPickerDialog` ותראה 2 hits — זה תקין ובמכוון.

**reference**:
- `packages/frontend/src/lib/adapters/fs-browse.ts` — חתימת `browseFolder(path, showHidden)`.
- `docs/conventions/parallel-safe-code.md` — דפוס "תוספתי".

---

## §1 — מטרה

אחרי הסלייס, בורר התיקיות במסך החיבור מתנהג נכון בשני מצבים שהיום שבורים: (א) כשמזינים נתיב
ידנית בשדה ה-cwd ואז פותחים את בורר התיקיות — הבורר **נפתח בנתיב שהוזן** (ולא בנתיב שמור/בית
ישן); (ב) כשתיבת הסימון "הצג תיקיות מוסתרות" **אינה** מסומנת — הבורר **מסתיר את כל התיקיות
המוסתרות** (כל שם שמתחיל ב-`.`, לא רק חמש תיקיות מתוך allowlist קשיח).

---

## §2 — Scope: מה כן, מה לא

| לא בסקופ (בכוונה) | היכן יטופל |
|---|---|
| הסרת בורר הסשן ממסך הפתיחה + רשימת תיקיות אחרונות | `slice-connect-recent-projects` (השרשרת מעל) |
| שינוי דפדוף קבצים (לא תיקיות) / בחירת קבצים | — (הבורר מציג תיקיות בלבד, נשאר) |
| הסתרת קבצים מוסתרים (לא תיקיות) | — (הבורר מסנן `isDir` ב-FE ממילא) |
| **זיהוי תכונת-hidden של Windows** (`FILE_ATTRIBUTE_HIDDEN`) | `slice-windows-hidden-attr` (slice המשך). הסלייס הזה רק **מכין** את נקודת-ההרחבה (`isHiddenEntry` async, מקבל dirent+fullPath). המימוש בפועל דורש הכרעת-תלות (מודול native `winattr`/`fswin` **או** shell-out ל-`attrib`) + קריאת-IO per-entry — מחוץ לסקופ של תיקון-באג. |
| מנגנון אבטחה `allowedBase` / symlink | — (קיים, לא נוגעים) |
| הוספת תיקיית-בית כברירת-מחדל למשתמש חדש | — (כבר קיים ב-`openAtStart` fallback) |

---

## §3 — Architecture diagram

```
routes (+page.svelte)            ← משתנה: מעביר startPath={cwd} ל-<FolderPickerDialog/>
   │
components/modals
   └─ FolderPickerDialog.svelte  ← משתנה: prop חדש startPath; openAtStart משתמש בו
        │ browseFolder(path, showHidden)
adapters (fs-browse.ts)          ← ללא שינוי
        │ GET /api/fs/browse?path=&showHidden=
backend/delivery
   └─ http-history.ts            ← משתנה: פילטר async isHiddenEntry(dirent,fullPath) — dot-prefix + noise
                                    + נקודת-הרחבה ל-Windows-attr (לא ממומשת כאן)
```

ללא שכבות חדשות. שני קבצי-קוד משתנים (FE component אחד, BE delivery אחד) + שני קבצי-טסט.

---

## §4 — Commits בסדר

### Commit 1 — BE: הסתרת **כל** התיקיות המוסתרות (לא allowlist קשיח)

- **Approach**: `mixed` (TDD על ה-integration test: red→green; הלוגיקה ב-delivery layer).
- **שורש הבאג**: `http-history.ts:178-179` מסנן ב-**prefix-match** מול 5 קידומות בלבד:
  `HIDDEN_PREFIXES.some((prefix) => d.name.startsWith(prefix))`, כש-`HIDDEN_PREFIXES = [".git",
  ".opencode", ".svelte-kit", "node_modules", ".pnpm"]`. כלומר היום מוסתר רק מה שמתחיל באחת מ-5
  הקידומות (גם `.gitignore`/`.github` מוסתרים — מתחילים ב-`.git`). אבל כל dot-folder אחר (`.config`,
  `.cache`, `.ssh`, `.vscode`, `.claude`, `.npm`, `.local` ...) **עובר את הפילטר ומוצג** גם
  כש-`showHidden=false`. בתיקיית-בית טיפוסית יש עשרות כאלה → בדיוק התלונה.
- **קבצים שמשתנים**:
  - `packages/backend/src/delivery/http-history.ts`:
    - החלף את `HIDDEN_PREFIXES` (שורה 103) ב-helper **async** `isHiddenEntry(dirent, fullPath)` שמגדיר
      "מוסתר" = מתחיל ב-`.` (Unix) **או** שם-רעש מוכר. ה-helper הוא **נקודת-ההרחבה היחידה** שאליה
      ייכנס בעתיד זיהוי תכונת-hidden של Windows (slice נפרד — ראה §2).
    - עדכן את הפילטר (179): כעת async → `Promise.all` שמחשב את דגלי-ה-hidden ואז מסנן.
    - הוסף `import { join } from "node:path"` (כיום מיובאים רק `relative, resolve` — שורה ~17).
  - `packages/backend/tests/http-history.test.ts`:
    - **קודם** (TDD red): הוסף ל-`it("hides hidden folders by default ...")` (209) תיקיית
      `.config` (dot-folder שאינו ב-all-list הישן) ו-assert `expect(names).not.toContain(".config")`.
      ודא שהטסט **נכשל** על הקוד הנוכחי לפני התיקון.
    - הוסף `.config` גם ל-`it("shows hidden folders when showHidden=true ...")` (229) ו-assert
      `expect(names).toContain(".config")`.
- **API skeleton** (executor לא משנה את החתימה):
  ```ts
  // packages/backend/src/delivery/http-history.ts
  import { join } from "node:path"   // נוסף ליד relative, resolve הקיימים

  // שמות-רעש שאינם מתחילים בנקודה אך נחשבים "מוסתרים" כברירת-מחדל.
  const NOISE_DIRS = new Set<string>(["node_modules"])

  /**
   * "מוסתר" = שם שמתחיל בנקודה (קונבנציית Unix) או שם-רעש מוכר.
   *
   * ⚠️ נקודת-הרחבה (כוונת-תכנון): החתימה async ומקבלת dirent+fullPath **בכוונה** — כדי
   * שזיהוי תכונת-hidden של Windows (FILE_ATTRIBUTE_HIDDEN, שאינה נגזרת מהשם) ייכנס כאן
   * בעתיד בלי לגעת בלולאת-הסינון. כיום אין IO בפועל; ה-Promise נפתר מיד.
   * ה-Windows-detection עצמו = slice נפרד (`slice-windows-hidden-attr`, ראה §2) כי הוא
   * דורש תלות native / shell-out per-entry — הכרעה שלא שייכת לתיקון-הבאג הזה.
   */
  async function isHiddenEntry(dirent: import("node:fs").Dirent<string>, fullPath: string): Promise<boolean> {
    if (dirent.name.startsWith(".")) return true   // Unix convention
    if (NOISE_DIRS.has(dirent.name)) return true
    // ── extension point: Windows FILE_ATTRIBUTE_HIDDEN ──
    // TODO(slice-windows-hidden-attr): קרא את תכונת ה-hidden של ה-OS על fullPath כאן.
    // כיום no-op על שמות שאינם dot → תיקיות מוסתרות-ב-attribute ב-Windows עדיין מוצגות.
    void fullPath
    return false
  }
  ```
  הפילטר (async — מחשב דגלים ב-`Promise.all`, ואז מסנן):
  ```ts
  // showHidden=true → דלג לגמרי (אין צורך לחשב hidden, ובעתיד גם חוסך IO)
  const visibleDirents = showHidden
    ? dirents
    : (
        await Promise.all(
          dirents.map(async (d) => ({ d, hidden: await isHiddenEntry(d, join(real, d.name)) })),
        )
      )
        .filter((x) => !x.hidden)
        .map((x) => x.d)

  const entries = visibleDirents
    .map((d) => ({ name: d.name, isDir: d.isDirectory() || d.isSymbolicLink() }))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  ```
  > הערה: ארבעת הערכים הישנים שמתחילים ב-`.` (`​.git`/`.opencode`/`.svelte-kit`/`.pnpm`) מכוסים
  > כעת ע"י כלל ה-dot; `node_modules` (לא dot) נשאר ב-`NOISE_DIRS`. ההתנהגות = **על-קבוצה** של
  > הקיים → הטסטים הקיימים (שמצפים ש-`.git`/`node_modules` מוסתרים) ממשיכים לעבור.
  > הסטייה היחידה (אביגיל finding #4, זניחה): הישן הסתיר גם שם כמו `node_modules.bak` (prefix),
  > החדש מסתיר `node_modules` מדויק בלבד. אין טסט/שימוש כזה בפועל → לא רלוונטי.
  > **למה async עכשיו אם אין IO?** הכנת-תשתית מכוונת (בקשת המשתמשת): ה-Windows-slice יוסיף קריאת
  > stat/attrib **בתוך** `isHiddenEntry` בלבד — לולאת-הסינון כבר async-ready, כך שלא תיגע בה שוב.
  > זה לא over-engineering מקרי; זו נקודת-הרחבה מתועדת.
- **Verification**:
  ```bash
  pnpm vitest run packages/backend/tests/http-history.test.ts   # כולל .config החדש — ירוק
  pnpm vitest run packages/backend                              # כל סוויטת ה-BE — אין רגרסיה
  pnpm -r typecheck
  ```

### Commit 2 — FE: בורר התיקיות נפתח בנתיב שהוזן ידנית

- **Approach**: `manual` (UI integration — אימות בדפדפן + calev).
- **שורש הבאג**: `FolderPickerDialog.svelte` קורא נקודת-פתיחה מ-`currentPath`/`settings.lastCwd`
  בלבד (`openAtStart`, שורות 49-61). הוא **אינו רואה** את הערך החי של שדה ה-cwd ב-`+page.svelte`
  (`cwd`, שורה 25). בנוסף `currentPath` שורד בין פתיחות (הרכיב לא מתפרק) → פתיחה חוזרת מתחילה
  במיקום-הניווט הקודם ולא בקלט.
- **תיקון**: הוסף prop `startPath` ל-`FolderPickerDialog`, והשתמש בו כעדיפות-ראשונה ב-`openAtStart`.
  `+page.svelte` יעביר `startPath={cwd}`.
- **קבצים שמשתנים**:
  - `packages/frontend/src/lib/components/modals/FolderPickerDialog.svelte`:
    - הוסף `$props()` עם `startPath` (אופציונלי, default `""`).
    - ב-`openAtStart` (49): שנה את שורת ה-priority כך שתעדיף `startPath`.
  - `packages/frontend/src/routes/+page.svelte`:
    - שורה 236: `<FolderPickerDialog startPath={cwd} />`.
- **API skeleton**:
  ```svelte
  <!-- FolderPickerDialog.svelte (ראש ה-<script>) -->
  let { startPath = "" }: { startPath?: string } = $props()
  ```
  ```ts
  // openAtStart — סדר עדיפויות חדש: הקלט החי (startPath) → lastCwd → homeDir
  async function openAtStart() {
    let start = startPath.trim() || settings.lastCwd
    if (!start) {
      try {
        const opts = await fetchServerOptions()
        start = opts.homeDir
      } catch {
        // נשאר ריק; loadFolder יציג error ולא יקרוס
      }
    }
    currentPath = start || ""
    await loadFolder(currentPath)
  }
  ```
  > **למה זה תקין ל-reactivity**: `openAtStart` נקרא בתוך `untrack(...)` (שורה 39) → קריאת
  > `startPath` שם **לא** הופכת אותו ל-dependency של ה-`$effect`. ה-effect ממשיך לעקוב רק אחרי
  > `modals.folderOpen` (edge false→true). `startPath` נקרא סינכרונית בראש הפונקציה (לפני כל
  > `await`), כך שהוא תמיד הערך החי בעת הפתיחה. אל תוסיף `startPath` ל-tracked-deps של ה-effect.
- **Verification** (ידני בדפדפן):
  1. פתח את מסך החיבור. הקלד נתיב קיים בשדה (למשל `/home/user/projects/drive-coding`).
  2. לחץ על כפתור התיקייה. ✅ הבורר נפתח **בנתיב שהוקלד** (ה-breadcrumb וה-footer מציגים אותו).
  3. נווט החוצה ובחר תיקייה. שנה ידנית את השדה לנתיב אחר. פתח שוב → ✅ מתחיל בנתיב החדש.
  ```bash
  pnpm -r typecheck
  ```

---

## §5 — DoD verifiable

| בדיקה | איך מבצעים |
|---|---|
| תיקיות מוסתרות (כל dot-folder) מוסתרות כברירת-מחדל | `pnpm vitest run packages/backend/tests/http-history.test.ts` — הטסט עם `.config` ירוק |
| `node_modules` עדיין מוסתר כברירת-מחדל | ה-assertion `not.toContain("node_modules")` בטסט `hides hidden ... by default` (שורה 222) ירוק |
| כל המוסתרות מוצגות כש-`showHidden=true` | הטסט הקיים + `.config` ירוק |
| בדפדפן: לא מופיעות `.config`/`.cache`/`.ssh` כשהתיבה לא מסומנת | ידני — פתח בורר בתיקיית-בית, ודא שאין dot-folders |
| בדפדפן: סימון התיבה מציג מחדש את כל המוסתרות | ידני — סמן את התיבה, ודא שמופיעות |
| בורר נפתח בנתיב שהוזן ידנית | ידני — §4 Commit 2 Verification |
| typecheck נקי | `pnpm -r typecheck` |
| אין רגרסיה ב-FolderPicker (ניווט up/breadcrumb/בחירה) | ידני — נווט מעלה/מטה, לחץ breadcrumb, "בחר תיקייה זו" |

---

## §6 — Risks + mitigations

- **סיכון: שינוי סמנטיקת הפילטר שובר טסטים קיימים.** ההגדרה החדשה היא על-קבוצה של הישנה (כל
  הערכים הישנים נשארים מוסתרים) → הטסטים הקיימים אמורים לעבור. *מיטיגציה*: הרץ את כל סוויטת ה-BE,
  לא רק את הטסט החדש.
- **סיכון: ה-refactor ל-async (`Promise.all` בפילטר) משנה את ה-shape של ה-handler.** ה-handler כבר
  `async` (יש בו `await readdir`/`await realpath`), כך שתוספת `await` נוספת אינה משנה את החתימה החיצונית.
  *מיטיגציה*: ודא ש-`showHidden=true` **מדלג** על `Promise.all` (מחזיר `dirents` כמו-שהוא) — שומר על
  ה-fast-path וה-perf. ודא ש-`join` מיובא. הטסטים הקיימים (211-249) מאמתים את ההתנהגות end-to-end.
- **סיכון: over-engineering נתפס כמקרי.** ה-async ללא-IO-עדיין נראה מיותר במבט ראשון. *מיטיגציה*: זו
  הכנת-תשתית **מכוונת ומתועדת** (בקשת המשתמשת — נקודת-הרחבה ל-Windows). ה-doc-comment על `isHiddenEntry`
  מסביר זאת מפורשות כך שאביגיל/reviewer לא יסירו אותה. אל תהפוך אותה חזרה ל-sync.
- **סיכון: `startPath` הופך ל-dependency של ה-`$effect` → re-run בכל הקלדה בשדה (גם כשהבורר סגור).**
  *מיטיגציה*: הקריאה נשארת בתוך `untrack` (§4). אל תקרא `startPath` מחוץ ל-`untrack`/מחוץ
  ל-`openAtStart`. אמת ש-`folderOpen` הוא ה-dependency היחיד.
- **סיכון: עברית בקוד (`lint:i18n`).** הסלייס לא מוסיף מחרוזות UI. *מיטיגציה*: הרץ `pnpm lint:i18n`
  לפני commit; הערות-קוד בעברית מותרות (הלינט חוסם מחרוזות UI, לא הערות).
- **סיכון: `pnpm hooks:install` לא הורץ → pre-commit לא רץ.** *מיטיגציה*: הרץ אותו אחרי
  `pnpm install` (§0).

---

## §7 — Escalation triggers

עצור ושאל את מרדכי ב-parent task אם:
- מתברר ש-`showHidden` **כן** מגיע נכון ל-BE אבל התיקיות עדיין מוצגות (כלומר שורש-באג שונה ממה
  שמופה כאן) — אל תנחש, דווח את הממצא.
- ה-prop `startPath` גורם ל-`$effect` ללולאה/re-run לא צפוי שלא נפתר ע"י `untrack`.
- מתגלה שדפדוף תיקיות-מוסתרות נשבר בפלטפורמת Windows (separator) עקב השינוי.
- **מתעורר פיתוי לממש את זיהוי תכונת-ה-hidden של Windows כאן** — אל תעשה זאת. זה slice נפרד עם
  הכרעת-תלות (native vs `attrib`). הכן רק את נקודת-ההרחבה (async + `void fullPath`). אם נראה שאי-אפשר
  להכין אותה בלי לממש — דווח למרדכי.
- צריך החלטה ארכיטקטונית שלא מכוסה ב-D1-D50.

---

## §8 — Complexity score + verifier choice

**Score: 3/10** (ה-async extension-point מוסיף מעט קוד אך לא סיכון — עדיין 3).
- Commits: 2 (נמוך).
- שכבות חדשות: 0 (משנה קיים בלבד).
- APIs חיצוניים: 0 (נקודת-ההרחבה ל-Windows-attr **לא ממומשת** כאן — slice נפרד).
- TDD: Commit 1 (integration, כולל ה-async filter). UI manual: Commit 2.
- סיכון רגרסיה: נמוך — שינויים מקומיים, מכוסים בטסט + בדיקה ידנית. ה-async filter מאומת ע"י אותם
  integration tests קיימים (end-to-end דרך ה-Hono app).

**Verifier: `calev` (mode: light).** אין צורך ב-heavy (סף 8+). הבדיקה היא runtime פשוט: שני
happy paths בדפדפן + הרצת סוויטת ה-BE.
