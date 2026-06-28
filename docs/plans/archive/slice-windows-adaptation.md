# Slice windows-adaptation — התאמת הפרויקט להרצה על Windows — ‏בריף

> ✅ **בוצע · אומת · מוזג ל-dev.** אורכב ב-2026-06-27 (הסטטוס אומת מול היסטוריית git/roadmap; פרטי הביצוע והאימות בהמשך הקובץ).

> **‏תאריך**: 2026-06-14
> **‏סוג מסמך**: ‏בריף ביצועי לסלייס
> **‏סטטוס**: **הושלם** (2026-06-14, אליעזר, branch: slice-windows-adaptation, commits: dac3f54..c0a567f)
> **‏אימות אביגיל**: ✅ **READY** (round 3, 2026-06-14). round 1 — 6 findings (base/cwd-fix dep, מקור projects, prompt-injector env, framing); round 2 — verification commands; round 3 — READY. ‏דוח: `reports/drive-coding/slice-windows-adaptation-avigail.md`
> **Dispatch**: ✅ ‏מותר (‏רצוי לקבל הכרעת §9 Q1 — allowedBase — ‏לפני).
> **Complexity**: 8/10 (verifier: **heavy** — ‏2 packages, opencode חי, ‏שיקול אבטחה)
> **‏תלויות (`depends_on`)**: [fix-cwd-validate-windows] — ‏בוצע (940d222) אך **‏טרם מוזג ל-dev**
> **‏Base**: ‏branch `fix-cwd-validate-windows` (‏שרשור — `validateCwd` ‏cross-platform נחוץ ל-Commit 2; ‏אינו ב-dev). ‏dev tip: `2aa9307`

---

## §0 — Pre-flight

> ‏הפרויקט עבר מלינוקס ל-Windows ‏(2026-06-13). ‏סבב debug חי (2026-06-14) ‏זיהה **‏6 חסמים**
> ‏להרצה תקינה על Windows native. `validateCwd` ‏כבר תוקן בנפרד (`fix-cwd-validate-windows`,
> ‏940d222). ‏ה-slice הזה מטפל ביתר: fs-browse, folder picker, projects-registry,
> ‏opencode plugin compat, ‏וטסטים מקובעי-Unix. ‏**‏המטרה: ‏המשתמש יכול לבחור תיקייה, ‏ליצור
> ‏agent חי, ‏ולדפדף ב-filesystem — ‏הכל על Windows.**

### ‏סביבה: **Windows-native**

- ‏של ראשי: **PowerShell**. ‏Git-Bash (MINGW64) ‏זמין ל-bash scripts.
- BE: `bun src/server.ts` ‏ישירות (port 4000). ‏**‏onecli על Windows לא מריץ bun** ("not supported")
  ‏— ‏אז אין הזרקת credentials; ‏זה לא נדרש לבדיקות ה-slice (fs/opencode-spawn, ‏לא TTS).
- FE: `pnpm --filter @drive-coding/frontend-v2 dev` (‏**‏שם ה-package הוא `frontend-v2`**, ‏לא `frontend`; port OS-assigned, ‏ברירת מחדל 5173→5174).
- opencode מותקן (1.2.27) ‏ומחובר (`opencode auth list` → Anthropic oauth). ‏ה-ACP handshake עובד.

### Worktree

```powershell
cd d:\UserProjects\AI\drive-coding
git worktree add .worktrees\slice-windows-adaptation -b slice-windows-adaptation dev
cd .worktrees\slice-windows-adaptation
pnpm install ; pnpm hooks:install
```

### ‏איך להריץ + לבדוק

- Typecheck: `pnpm --filter @drive-coding/backend typecheck ; pnpm --filter @drive-coding/core typecheck ; pnpm --filter @drive-coding/frontend-v2 typecheck`
- Tests: `pnpm test` ‏מהשורש (vitest run — ‏מכסה את כל ה-packages). ‏הערה: `frontend-v2` ‏יש לו `test: vitest run`; ‏ל-**core** ‏אין `test` script פר-package → ‏הרץ מהשורש או `pnpm exec vitest run <path>`.
- lint:i18n: `pnpm lint:i18n` (‏דרך Git-Bash; ‏fallback `bash ./scripts/lint-no-hebrew-in-code.sh`).
- BE חי: `cd packages/backend ; $env:PORT=4000 ; bun src/server.ts`.
- בדיקת endpoints: PowerShell `Invoke-RestMethod`.
- Browser: skill `playwright-cli` (Chrome `--remote-debugging-port=9222` + CDP attach).

### Reading list

**must-read**:
- `packages/backend/src/delivery/http-history.ts` — `registerFsBrowseHttp` (106-158). **‏הבאג**: ‏שורה 133 `real.startsWith(`${safeBase}/`)` — `/` ‏קשיח שובר ניווט-בתוך-home על Windows; ‏שורה 113 `allowedBase ?? homedir()` ‏מגביל ל-home.
- `packages/frontend/src/lib/components/modals/FolderPickerDialog.svelte` — ‏בנוי כולו על נתיבי Unix: ‏default `/home/user` (24), `breadcrumbs` split `/` (44-46), `navigateTo`/`navigateToDepth`/`navigateUp` (73-86) ‏בונים עם `/`, ‏בדיקת root `currentPath !== "/"` (153).
- `packages/backend/src/plugin-config.ts` — `buildOpencodeConfigContent` (19-68). **‏הבאג**: ‏שורה 53 `ourEntry: [pluginUrl, ourOptions]` (tuple) — **opencode 1.2.27 דורש `plugin: string[]`** (`"Invalid input: expected string, received array plugin.0"`), ‏לא tuple.
- `packages/backend/plugins/prompt-injector.ts` — ‏מקבל `options.text` (33). ‏אם נעבור ל-string-plugin, ‏צריך מסלול חלופי להעברת ה-text (env var — ‏ראה Commit 3).
- ‏ה-projects-registry (‏שמזין `GET /api/options.projects`) — ‏מאתר ע"י grep `projects-registry` / `homedir`. ‏מחזיר נתיבים פסולים: `D:\Users\User\%userprofile%`, `D:\Users\User\~`, `\tmp\...` (‏נתיבי `/tmp` ‏לינוקסיים).
- `packages/backend/src/delivery/http-options.ts` — `homeDir = os.homedir()` (70, 108).

**reference**:
- `packages/core/src/cwd-validate.ts` — ‏הדפוס cross-platform שכבר אומץ ב-940d222 (Unix + Windows-drive + UNC). ‏לחקות לגישת זיהוי-נתיב.
- `tests/` ‏של http-options + http-history — ‏3 הטסטים שנכשלים על Windows (assertions מקובעי-Unix).

---

## §1 — ‏מטרה

‏אחרי הסלייס, ‏הפרויקט **‏רץ ומתפקד מלא על Windows native**: ‏המשתמש פותח את `/`, ‏בוחר תיקייה
‏(דרך ה-picker הגרפי **‏או** ‏קלט ידני), ‏יוצר agent ש**‏עולה ל-ready** (‏opencode acp לא קורס),
‏ומדפדף ב-filesystem. ‏כל הטסטים ירוקים על Windows. ‏`pnpm test` ‏נקי.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|------|------|------|
| fs/browse: ‏תיקון separator (path-aware, ‏לא `/` קשיח) | ✅ | Commit 0 |
| fs/browse: ‏הרחבת allowedBase (‏לאפשר ניווט מעבר ל-home) | ✅ | Commit 0 (‏ראה §9 Q1 — ‏שיקול אבטחה) |
| FolderPickerDialog: ‏path handling cross-platform | ✅ | Commit 1 |
| projects-registry: ‏סינון/תיקון נתיבים פסולים (`%userprofile%`,`~`,`\tmp`) | ✅ | Commit 2 |
| opencode plugin: tuple→string compat (‏מתקן crash code 9) | ✅ | Commit 3 |
| http-options + http-history: ‏טסטים cross-platform | ✅ | Commit 4 |
| `validateCwd` | ❌ | ‏כבר תוקן (940d222, ‏תלות) |
| onecli+bun על Windows (‏הרצת BE עם credentials) | ❌ | ‏מחוץ ל-scope — onecli upstream; ‏ל-slice מספיק `bun` ישיר |
| TTS/STT/voice על Windows | ❌ | ‏עתידי — ‏תלוי ב-onecli credentials |
| ‏החלפת separators בכל ה-codebase (sweep גורף) | ❌ | ‏רק האתרים שה-debug זיהה כשבורים |

---

## §3 — Architecture diagram

```
backend/delivery/http-history.ts  (registerFsBrowseHttp)
  allowedBase: homedir() → drive-roots או opt-out (§9 Q1)         ← Commit 0
  containment check: startsWith(`${base}/`) → path.relative-based  ← Commit 0 (cross-platform)

frontend/.../modals/FolderPickerDialog.svelte
  default path: "/home/user" → server homeDir (מ-GET /api/options)  ← Commit 1
  breadcrumb/navigate: split("/") → separator-aware (\ ו-/)         ← Commit 1

backend/.../projects-registry (+ http-options homeDir)
  סינון נתיבים פסולים: %userprofile% / ~ / \tmp                    ← Commit 2

backend/plugin-config.ts  (buildOpencodeConfigContent)
  plugin: [[url, {text}]]  →  plugin: [url]  + העברת text דרך env   ← Commit 3
backend/plugins/prompt-injector.ts
  options.text  →  fallback ל-process.env.PROMPT_INJECTOR_TEXT      ← Commit 3

tests: http-options.test + http-history.test
  assertions מקובעי-Unix → cross-platform (os.homedir/path.sep)     ← Commit 4
```

---

## §4 — Commits ‏בסדר

### Commit 0 — fs/browse cross-platform (separator + allowedBase) (approach: tdd)

**‏קובץ**: `packages/backend/src/delivery/http-history.ts` (`registerFsBrowseHttp`).

1. **separator bug** (‏שורה 133): ‏החלף את `real.startsWith(`${safeBase}/`)` ‏בבדיקת-הכלה
   ‏עצמאית-פלטפורמה. ‏מומלץ: `path.relative(safeBase, real)` — ‏בתוך הבסיס ⇔ ‏ה-relative
   ‏אינו מתחיל ב-`..` ‏ואינו absolute. ‏מטפל גם ב-`\` וגם ב-`/`.
2. **allowedBase** (‏שורה 113): ‏**‏הוכרע (משתמש 2026-06-14): ‏ברירת-מחדל = ‏מאפשר הכל, ‏ניתן
   ‏להגביל בהגדרה.** ‏מימוש: ‏ברירת-מחדל **‏ללא הגבלת-הכלה** (‏דילוג על בדיקת ה-403 — ‏מאפשר
   ‏דפדוף בכל ה-filesystem). ‏הגבלה היא **opt-in** ‏דרך `opts.allowedBase` ‏מפורש **‏או** ‏env
   ‏(`FS_BROWSE_ALLOWED_BASE`). ‏כש-מוגדר → ‏בדיקת ההכלה הקודמת חלה (‏path.relative-based, ‏סעיף 1).
   ‏**`realpath` (‏הגנת symlink) ‏נשמר תמיד**, ‏גם ב-allow-all. ‏(‏כלי dev מקומי, ‏לא חשוף לאינטרנט.)

**Tests** (tdd) — `packages/backend/tests/http-history.test.ts` (‏או fs-browse test ייעודי):
- ‏ניווט ל-**subdir בתוך** allowedBase → ‏מצליח (‏כיום נכשל ב-403 על Windows בגלל ה-`/`).
- ‏נתיב מחוץ לבסיס → ‏לפי ההכרעה ב-Q1.
- ‏path traversal (`..`) → ‏עדיין נחסם (‏realpath מנרמל).
- **‏לרוץ עם נתיבי Windows וגם Unix** (‏בנה את ה-fixtures מ-`os.tmpdir()` + `path.join`, ‏לא `/tmp` קשיח).

**Verification**: `pnpm test` (‏מהשורש — ‏ל-backend **‏אין** `test` script; ‏או `pnpm exec vitest run packages/backend/tests/http-history.test.ts`) + ‏ידני: `Invoke-RestMethod "http://localhost:4000/api/fs/browse?path=D:\Users\User\Documents"`.

---

### Commit 1 — FolderPickerDialog cross-platform (approach: manual)

**‏קובץ**: `packages/frontend/src/lib/components/modals/FolderPickerDialog.svelte`.

- **default path** (24): ‏במקום `"/home/user"` — ‏אתחל מ-server homeDir (`getSettings().lastCwd` ‏או
  ‏ה-homeDir מ-`GET /api/options`, ‏שכבר נטען). ‏אל תקשיח Unix.
- **breadcrumb** (44-46): ‏פצל על `[\\/]` (‏גם `\` וגם `/`); ‏שמר drive-letter prefix (`D:`) ‏כ-crumb ראשון.
- **navigateTo / navigateToDepth / navigateUp** (73-86): ‏בנה נתיבים עם הפרדה עקבית. ‏עבור
  ‏drive-letter: ‏root הוא `D:\`. ‏שקול `import path from "path-browserify"` ‏או הלפר מקומי קטן
  ‏(executor בוחר — ‏אבל **‏בלי תלות כבדה** ‏אם הלפר 10 שורות מספיק).
- **root check** (153): ‏`currentPath !== "/"` → ‏זהה גם drive-root (`/^[a-zA-Z]:[\\/]?$/`).
- ‏שמור על `dir="ltr"` ‏לנתיבים (‏כבר קיים).

> ‏ה-BE `fs/browse` ‏מחזיר `path` ‏מנורמל (realpath) — ‏ה-FE צריך לכבד אותו (‏כבר עושה: `currentPath = result.path`).

**Verification**: `pnpm --filter @drive-coding/frontend-v2 typecheck && build && pnpm lint:i18n` + ‏ידני בדפדפן: ‏פתח picker, ‏נווט פנימה/החוצה, ‏בחר תיקייה (‏screenshot).

---

### Commit 2 — `listProjectDirs`: ‏מקור candidates cross-platform + סינון (approach: tdd)

> **‏תיקון מאביגיל**: ‏המקור הוא `listProjectDirs` ב-**`packages/backend/src/delivery/http-options.ts:69`**
> (‏נקרא ב-`/api/options`, ‏שורה 106 — ‏**‏לא** projects-registry). ‏הנתיבים הפסולים מגיעים מ-2 ‏מקורות:
> ‏(א) `candidates` (‏שורה 71) ‏כולל `"/tmp"` ‏קשיח-לינוקס → ‏על Windows מצרף `\tmp\...` ‏(נתיב ללא drive);
> ‏(ב) ‏סריקת `os.homedir()` ‏מחזירה subdirs אמיתיים עם שמות מוזרים (`%userprofile%`, `~` — ‏תיקיות
> ‏שנוצרו בטעות במכונה). ‏(‏אם קיים גם `GET /api/projects` ‏ב-`http-history.ts` ‏עם אותו דפוס — ‏תקן גם שם.)

**‏קובץ**: `packages/backend/src/delivery/http-options.ts` (`listProjectDirs`, 69-96).

- **candidates** (71): ‏החלף `"/tmp"` ב-`os.tmpdir()` (cross-platform).
- **‏סינון**: ‏לפני `dirs.push(full)` (85) — ‏סנן עם `validateCwd(full)` ‏מ-core (‏cross-platform, ‏זמין מ-base
  ‏branch `fix-cwd-validate-windows`). ‏רשומה ש-`validateCwd` ‏דוחה (‏למשל `\tmp\x` ‏— `\` בודד, ‏לא absolute) → ‏לא נכנסת.
  ‏(`%userprofile%`/`~` ‏הם נתיבים אבסולוטיים תקפים → ‏יישארו; ‏זה מקובל, ‏הם תיקיות אמיתיות. ‏ה-`os.tmpdir()` ‏מתקן את עיקר הרעש.)

**Tests** (tdd) — ‏ב-`tests/http-options.test.ts`: ‏mock `os.homedir`/`os.tmpdir` + fs, ‏ודא ש-`listProjectDirs`
‏מחזיר רק נתיבים שעוברים `validateCwd`, ‏ושנתיב פסול (`\tmp\x`) ‏מסונן.

**Verification**: `pnpm test` + ‏ידני: `Invoke-RestMethod .../api/options | % projects` ‏— ‏אין `\tmp`.

---

### Commit 3 — opencode plugin tuple→string compat (approach: integration) ⚠️ verifier-phase

> **‏הבאג הקריטי** (crash code 9): `buildOpencodeConfigContent` ‏מייצר `plugin: [[url, {text}]]`,
> ‏אבל opencode 1.2.27 ‏דורש `plugin: string[]`. ‏זה מפיל **‏כל** ‏agent. ‏אומת חי ב-stderr:
> `Configuration is invalid at OPENCODE_CONFIG_CONTENT ↳ expected string, received array plugin.0`.

**‏קבצים**: `packages/backend/src/plugin-config.ts` + `packages/backend/plugins/prompt-injector.ts`.

- **plugin-config.ts**: ‏שנה את הרשומה מ-tuple ל-**string** (`pluginUrl` ‏בלבד). ‏העבר את ה-text
  ‏(וה-debugWritePath) ‏דרך **env var** ‏שה-spawn מזריק (‏ה-bridge-manager כבר בונה `childEnv`):
  ‏`PROMPT_INJECTOR_TEXT` + `PROMPT_INJECTOR_DEBUG_PATH` (‏האחרון כבר נקרא מ-env ב-prompt-injector!).
  ‏שמור על dedup ‏ומיזוג plugins קיימים (‏string-only עכשיו).
- **prompt-injector.ts** (33-37): ‏**‏כיום קורא רק `options.text`/`options.debugWritePath`** (‏לא env —
  ‏תיקון מאביגיל: ‏ה-env read הקיים נמצא ב-`plugin-config.ts:50`, ‏לא בתוך ה-plugin). ‏הוסף fallback ל-env
  ‏בתוך ה-plugin: `text = options?.text ?? process.env.PROMPT_INJECTOR_TEXT ?? ""` (‏ובדומה ל-debugWritePath).
  ‏כך ה-plugin עובד גם כש-opencode טוען אותו כ-string-URL ‏בלי options.
- ‏ה-spawn ב-`bridge-manager.ts` ‏מעביר `childEnv` ‏ל-opencode — ‏הוסף שם את `PROMPT_INJECTOR_TEXT`
  ‏(‏מקור: `AUDIO_FRIENDLY_PROMPT`), ‏או הזרק אותו ב-`buildOpencodeConfigContent` ‏caller. (executor
  ‏בוחר את נקודת ההזרקה הנקייה — ‏אבל ‏ה-text **‏חייב** ‏להגיע ל-child env.)

> ⚠️ **‏אימות חי חובה**: ‏צור agent (`POST /api/agents` cwd Windows) → ‏ודא `status` ‏מגיע ל-`ready`
> ‏(‏לא `crashed`). ‏ה-handshake המלא (initialize→session/new) ‏חייב לעבור. ‏זה ה-commit שמתקן את
> ‏ה-blocker לבדיקה חיה. **verifier-phase כאן.**

**Verification**: `pnpm --filter @drive-coding/backend typecheck ; pnpm test` (‏typecheck פר-package; ‏test **‏מהשורש**) + ‏**‏BE חי**:
`Invoke-RestMethod -Method Post .../api/agents -Body '{"cliKind":"opencode","cwd":"D:\\..."}'` → ‏המתן 5ש' → `GET .../api/agents` ‏מראה `status:ready` + `acpSessionId`.

---

### Commit 4 — השלמת טסטים cross-platform (approach: tdd)

> **‏תיקון מאביגיל לחלוקת ה-3 כשלונות**: ‏טסטי `fs/browse` (ב-`http-history`) **‏כבר** ‏משתמשים
> ‏ב-`tmpdir()`/`path.join` — ‏הם נכשלים מ-**‏באג ה-separator** ‏ולכן **‏Commit 0 ‏מתקן אותם** (‏ירוקים
> ‏אחרי תיקון ההכלה). ‏Commit 4 ‏מטפל ביתרה: ‏assertions מקובעי-Unix שנותרו (‏בעיקר `http-options`
> ‏homeDir / `/tmp` ‏בציפיות).

**‏קבצים**: ‏הטסטים שנותרו אדומים אחרי Commit 0 (‏ברובם `http-options.test.ts`; ‏אמת עם `pnpm test`).

- ‏החלף assertions מקובעי-Unix (`/home/...`, `/tmp`) ‏ב-`os.homedir()` / `os.tmpdir()` / `path.join`.
  ‏הטסט צריך לעבור על Windows **‏וגם** ‏על לינוקס (CI).
- ‏אל תשבור כיסוי — ‏רק הפוך fixtures/assertions לעצמאי-פלטפורמה.

> ‏סדר: ‏אחרי Commit 0 ‏הרץ `pnpm test`, ‏ראה אילו נשארו אדומים, ‏ותקן רק אותם כאן.

**Verification**: `pnpm test` ‏מהשורש — ‏0 ‏כשלונות (‏היו 3 pre-existing).

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | typecheck נקי (3 packages) | `pnpm -r typecheck` |
| 2 | **‏0 ‏כשלונות בטסטים** (‏היו 3 pre-existing) | `pnpm test` ‏מהשורש |
| 3 | fs/browse — ניווט בתוך home עובד | `Invoke-RestMethod ".../fs/browse?path=D:\Users\User\Documents"` → entries (‏לא 403) |
| 4 | fs/browse — ‏גישה לפי הכרעת Q1 | ‏ראה §9 Q1 |
| 5 | folder picker עובד בדפדפן | ‏פתח picker, ‏נווט פנימה+החוצה, ‏בחר → cwd מתעדכן (screenshot) |
| 6 | projects list נקי | `GET .../api/options` ‏— ‏אין `%userprofile%`/`~`/`\tmp` |
| 7 | **agent עולה ל-ready (‏לא crashed)** | `POST .../api/agents` cwd Windows → `status:ready` + `acpSessionId` ‏תוך ~5ש' |
| 8 | reconnect E2E חי | ‏בדפדפן: ‏צור agent → ‏חזור ל-`/` → ‏הווידג'ט מציג → reconnect → /chat (‏warm) |
| 9 | lint:i18n | `pnpm lint:i18n` |
| 10 | regression: ‏אין שבירה בלינוקס | ‏הטסטים cross-platform (‏לא Windows-only) |

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| ‏הרחבת allowedBase ‏פותחת את כל ה-FS ל-browse | Commit 0 / ‏אבטחה | §9 Q1 — ‏הכרעה מפורשת. ‏שמור `realpath` (symlink). ‏כלי dev מקומי, ‏לא חשוף לאינטרנט. |
| opencode plugin: ‏ה-text לא מגיע ל-child env | Commit 3 | ‏אמת חי שה-prompt מוזרק (debugWritePath) + agent ל-ready. verifier-phase. |
| ‏שינוי plugin format שובר משתמשי opencode-config קיימים | Commit 3 | ‏שמר מיזוג plugins קיימים (string-only); ‏אל תמחק רשומות משתמש. |
| FolderPicker: ‏path-browserify מוסיף תלות | Commit 1 | ‏העדף הלפר מקומי קטן (split על `[\\/]`); ‏תלות רק אם באמת נחוץ. |
| ‏טסטים cross-platform נשברים בלינוקס CI | Commit 4 | ‏השתמש ב-`os.*`/`path.*`, ‏לא בקשיח-פלטפורמה. DoD#10. |
| `pnpm test` ‏לא קיים פר-package (core/frontend) | ‏מבנה monorepo | ‏הרץ מהשורש (`vitest run`). ‏מתועד ב-§0. |

> ‏3 ‏שתמיד נשכחים:
> 1. Hardcoded strings → ‏FE Commit 1 ‏עלול להוסיף טקסט; ‏הכל דרך `t()`. `lint:i18n` ‏חוסם.
> 2. Reactivity → FolderPicker `$state`/`$derived` ‏קיימים; ‏שמור על ה-`untrack` ‏ב-effect (30-41).
> 3. OneCLI placeholder → ‏על Windows `bun` ‏ישיר (‏לא onecli). ‏אין שינוי spawn logic.

---

## §7 — Escalation triggers

- ‏הרחבת allowedBase דורשת שינוי ‏ארכיטקטוני רחב מ-`registerFsBrowseHttp` (‏לא רק ההכלה).
- opencode 1.2.27 ‏לא מקבל את ה-text דרך env **‏וגם** ‏לא דרך string-plugin (‏צריך מנגנון אחר לגמרי).
- ‏תיקון projects-registry דורש לשנות את **‏מקור** ‏הסריקה (‏לא רק סינון פלט).
- ‏אתה רוצה לסטות מ-approach שה-brief קבע ל-commit.
- ‏ה-slice מתנפח מעבר ל-5 commits / 2 packages (‏שקול פיצול — §9 Q3).

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|------|------|
| 2 packages (backend + frontend + core-reuse) | +1 |
| ‏שיקול אבטחה (allowedBase) | +1 |
| ‏אינטגרציה עם כלי חיצוני חי (opencode acp) | +2 |
| Cross-platform path logic (‏מועד לבאגים) | +1 |
| UI (folder picker) | +1 |
| 5 commits | +1 |
| ‏בסיס glue | +2 (base) |
| TDD על 0/2/4 | -1 |

**Score**: 8 / 10

**Tier**: 8+ → **`calev-heavy`** (Opus) + `verifier-phase` ‏על **commit 3** (opencode crash — ‏ה-blocker הקריטי, ‏אינטגרציה חיה).

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | fs/browse allowedBase — ‏להגביל ל-home, ‏לאפשר כל הדרייבים, ‏או opt-in? | ✅ **‏הוכרע (‏משתמש 2026-06-14): ‏ברירת-מחדל מאפשר הכל, ‏הגבלה opt-in דרך `FS_BROWSE_ALLOWED_BASE`/`opts.allowedBase`. realpath נשמר תמיד.** | ❌ |
| 2 | ‏העברת prompt-text ל-opencode — env var ‏או config אחר? | `PROMPT_INJECTOR_TEXT` env (‏ה-prompt-injector כבר תומך ב-env ל-debugWritePath) | ❌ |
| 3 | ‏לפצל ל-2 slices (fs/picker ‏מול opencode/tests)? | ‏לא — ‏נושא אחד (Windows-port); ‏אבל אם אליעזר מאבד פוקוס → ‏פצל ב-commit 3 | ❌ |
| 4 | projects-registry — ‏לסנן בפלט ‏או לתקן את הסורק? | ‏לסנן בפלט (‏זול, ‏ממוקד) עם `validateCwd` | ❌ |

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor ‏תוך כדי)

- ...
