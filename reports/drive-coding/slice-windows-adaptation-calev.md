---
project: "drive-coding"
slice: "slice-windows-adaptation"
verifier: "calev"
mode: "heavy"
tier: "opus"
date: "2026-06-14"
base: "fix-cwd-validate-windows @ 940d222"
range: "940d222..a88abec (6 commits)"
environment: "Windows-native (PowerShell + Git-Bash), bun direct, opencode 1.2.27, no onecli"
verdict: "GO-WITH-NOTE"
dod:
  - id: 1
    name: "typecheck נקי (3 packages)"
    status: "PASS"
  - id: 2
    name: "0 כשלונות בטסטים (מלבד pre-existing)"
    status: "PASS"
  - id: 3
    name: "fs/browse — ניווט בתוך home"
    status: "PASS"
  - id: 4
    name: "fs/browse — allow-all default + opt-in restriction (Q1)"
    status: "PASS"
  - id: 5
    name: "folder picker בדפדפן"
    status: "PASS-WITH-BUG"
  - id: 6
    name: "projects list נקי (אין \\tmp לינוקסי)"
    status: "PASS"
  - id: 7
    name: "agent עולה ל-ready (opencode crash fix)"
    status: "PASS"
  - id: 8
    name: "reconnect E2E דרך הווידג'ט"
    status: "OUT-OF-SCOPE (widget בslice נפרד)"
  - id: 9
    name: "lint:i18n"
    status: "PASS"
  - id: 10
    name: "regression — אין שבירה (cross-platform tests)"
    status: "PASS"
findings:
  - id: F1
    severity: "minor-functional"
    category: "Hardcoded-null / Spec-drift"
    title: "FolderPicker פתיחה ראשונה (localStorage ריק) — דיאלוג ריק ולא-נווט"
  - id: F2
    severity: "cosmetic"
    category: "Spec-drift"
    title: "placeholder של cwd input נשאר Unix-style (/home/user/projects/X)"
  - id: F3
    severity: "non-blocking / deviation-ok"
    category: "Deviation"
    title: "OPENCODE_ARGS env override ב-cli-config.ts — לגיטימי, test-only, opt-in"
  - id: F4
    severity: "info"
    category: "Pre-existing (verified)"
    title: "lint-no-hebrew-in-code.test.mjs כשל pre-existing — אומת עצמאית מול base"
  - id: F5
    severity: "info / flake"
    category: "Test-infra"
    title: "2 bridge-manager טסטים נכשלו ב-full-run תחת עומס — flake (עוברים בבידוד)"
---

# Heavy Verification — slice-windows-adaptation (calev / Opus)

> **Brief**: `docs/plans/slice-windows-adaptation.md`
> **Base**: `fix-cwd-validate-windows @ 940d222` (validateCwd cross-platform; טרם מוזג ל-dev)
> **Range**: `940d222..a88abec` — 6 commits (Commit 0–4 + docs)
> **Environment**: Windows-native. BE: `bun src/server.ts` (port 4000). FE: vite dev (5173). opencode 1.2.27 (Anthropic oauth). אין onecli.
> **Verdict**: 🟢 **GO-WITH-NOTE** — כל מטרות-הליבה של ה-slice עובדות חי על Windows (כולל ה-blocker הקריטי opencode→ready). ממצא פונקציונלי קטן אחד ב-FolderPicker (פתיחה ראשונה).

## תקציר מנהלים

ה-slice משיג את מטרתו: **הפרויקט רץ ומתפקד על Windows-native**. אומת חי מקצה-לקצה:
המשתמש בוחר תיקייה (picker גרפי בנתיבי Windows), יוצר agent opencode ש**עולה ל-ready
עם acpSessionId** (ה-handshake המלא עובר — לא קורס code 9), ומדפדף ב-filesystem.
ה-blocker הקריטי (Commit 3 — opencode plugin tuple→string) **אומת חי**: opencode spawn,
נטען (424 MB), נשאר חי, ואין שום `Configuration is invalid` בלוג. agent שנוצר דרך
הדפדפן הגיע ל-`status:ready` + `acpSessionId:ses_13c70d...`.

נמצא ממצא פונקציונלי **קטן אחד** (F1): פתיחה ראשונה של ה-FolderPicker כשה-localStorage
ריק (משתמש חדש שטרם התחבר) מציגה דיאלוג ריק ולא-נווט. הניווט עצמו תקין לחלוטין —
זה רק bootstrap של נתיב-ברירת-המחדל. לא חוסם GO (יש workaround: הקלדה ידנית; וברגע
שיש lastCwd ה-picker עובד מושלם), אבל **כדאי לתקן** כי הוא חוצה את הכוונה המפורשת של
§4 Commit 1.

---

## DoD — אימות מפורט

### DoD#1 — typecheck נקי (3 packages) — ✅ PASS

`pnpm -r typecheck` → exit 0. core: Done, backend: Done, frontend: `4962 FILES 0 ERRORS
0 WARNINGS`. אין שגיאות בשום package.

### DoD#2 — 0 כשלונות בטסטים (מלבד pre-existing) — ✅ PASS

`pnpm test` מהשורש: **700 passed, 14 skipped**. הכשלים:
- `lint-no-hebrew-in-code.test.mjs` — **pre-existing** (ראה F4, אומת עצמאית מול base).
- 2 טסטי bridge-manager — **flake תחת עומס** (ראה F5, עוברים בבידוד 19/19).

אין כשל-אמת מבית ה-slice.

### DoD#3 — fs/browse ניווט בתוך home — ✅ PASS

`GET /api/fs/browse?path=D:\Users\User\Documents` → **HTTP 200** + entries (תיקיות עבריות
ואנגליות). זה היה ה-403-bug (separator `/` קשיח) — מתוקן. Commit 0 אומת חי.

### DoD#4 — allow-all default + opt-in restriction (Q1) — ✅ PASS

- **allow-all (ברירת-מחדל, ללא env)**: `path=D:\UserProjects` (מחוץ ל-home) → **200** + entries.
- **opt-in restriction**: BE עם `FS_BROWSE_ALLOWED_BASE=D:\Users\User\Documents`:
  - בתוך הבסיס (`...\Documents\Arduino`) → **200**.
  - הבסיס עצמו → **200**.
  - מחוץ לבסיס (`D:\UserProjects`) → **403 access denied**.
  - **path traversal escape** (`...\Documents\..\Downloads`) → **403** (realpath מנרמל,
    אז path.relative תופס את ה-escape).
- **realpath/symlink protection נשמר תמיד**: נתיב לא-קיים → 404 (realpath נכשל); param חסר → 400.

הכרעת Q1 (allow-all default + opt-in env restriction + realpath תמיד) ממומשת במדויק.

### DoD#5 — folder picker בדפדפן — ✅ PASS-WITH-BUG (ראה F1)

אומת חי בדפדפן (Chrome + playwright-cli, desktop 1280×800 + mobile 390×844):
- **navigate INTO**: `D:\Users\User` → `Documents` → breadcrumb `D: / Users / User / Documents`, רשימה מתעדכנת. ✅
- **navigateUp (`..`)**: חזרה ל-`D:\Users\User`. ✅
- **breadcrumb-jump**: לחיצה על crumb "Users" → `D:\Users` (רשימה: CodeShark200, User). ה-Windows-drive logic (`crumbs[0]='D:' + sep`) עובד. ✅
- **select**: "בחר תיקייה זו" על `D:\Users\User` → input של ה-connect form התעדכן ל-`D:\Users\User`. ✅
- **mobile (390px)**: picker נטען מאוכלס, breadcrumb `D: / UserProjects / AI / drive-coding`, layout רספונסיבי נקי, RTL תקין. ✅

ה-separator handling cross-platform עובד מצוין. **אבל** — ראה F1: בפתיחה ראשונה
(localStorage ריק) הדיאלוג ריק.

### DoD#6 — projects list נקי — ✅ PASS

`GET /api/options` → 50 projects. **אפס** נתיבי `\tmp` / `/tmp` לינוקסיים. נתיבי tmp עכשיו
נפתרים ל-`D:\Users\User\AppData\Local\Temp\...` (Windows tmp אמיתי, absolute, תקף) — תיקון
`os.tmpdir()` עובד. `%userprofile%` ו-`~` **נשארו** — וזה **מצופה ומתועד** ב-§4 Commit 2
שורה 171 (נתיבים absolute תקפים; רק רעש ה-`\tmp` היה היעד).

### DoD#7 — agent עולה ל-ready (opencode crash fix) — ✅ PASS (קריטי, verifier-phase)

ה-blocker שכל ה-slice סובב סביבו — אומת בשלוש שכבות:

1. **Process layer (live)**: `POST /api/agents` (opencode, cwd Windows) → spawn ok (pid 9376),
   opencode נטען (424 MB RSS), **נשאר חי**. אפס שורות `crash`/`invalid`/`config`/`expected
   string` בלוג ה-BE. (לפני Commit 3: crash code 9 מיידי עם `Configuration is invalid at
   OPENCODE_CONFIG_CONTENT ↳ expected string, received array plugin.0`.)
2. **Config layer (isolated harness)**: `buildOpencodeConfigContent(undefined)` → `plugin:
   [string]` (לא tuple). מיזוג legacy tuple `[["url",{}],"keep"]` → flatten ל-`["old","keep",
   "ours"]` — **כל הרשומות strings, ה-plugin של המשתמש נשמר** (אין איבוד נתונים).
3. **End-to-end (browser-driven)**: חיבור דרך הדפדפן → agent הגיע ל-**`status:"ready"` +
   `acpSessionId:"ses_13c70d1cdffeb6S7bvmG2Q3Pvn"`**. ה-session client עבר connecting→connected→idle.
   זהו ה-ACP handshake המלא (initialize→session/new) **חי עם opencode על Windows-native**.

זה סוגר את החסם שתועד ב-lessons-learned (`e2e-on-windows-blockers`): "ל-opencode חי צריך
לתקן את #3 קודם". תוקן ואומת.

### DoD#8 — reconnect E2E דרך הווידג'ט — ⏭️ OUT-OF-SCOPE

הווידג'ט (ActiveProcessesPanel) שייך ל-slice נפרד (`active-agents-widget`) שאינו ב-branch זה.
לא נבדק, לא נכשל — ייבדק ב-integration. (תואם ההנחיה ב-prompt.)

### DoD#9 — lint:i18n — ✅ PASS

`bash ./scripts/lint-no-hebrew-in-code.sh` → `✓ No hardcoded Hebrew in code.` exit 0.
שינויי FolderPicker (Commit 1) לא הכניסו hardcoded strings — pitfall נמנע.

### DoD#10 — regression (cross-platform, אין שבירה) — ✅ PASS

- **connect רגיל לא נשבר**: חיבור opencode דרך הדפדפן עבד מלא (connecting→connected→idle,
  agent ready). זהו ה-flow המרכזי — לא נשבר.
- הטסטים cross-platform (os.homedir/os.tmpdir/path.join, לא קשיח-Unix) → ירוקים על Windows;
  אמורים לעבור גם ב-Linux CI (השתמשו ב-`os.*`/`path.*`).

---

## ממצאים

### F1 — 🟡 minor-functional — FolderPicker פתיחה ראשונה: דיאלוג ריק ולא-נווט

**קטגוריה**: Hardcoded-null / Spec-drift (אחד מה-3-שתמיד-נשכחים).

**מה קורה**: כשמשתמש חדש (localStorage ריק — `settings.lastCwd === ""`) פותח את ה-FolderPicker
בפעם הראשונה, הדיאלוג נפתח **ריק לחלוטין** — אין breadcrumb, אין רשימת תיקיות, אין כפתור up.
המשתמש לא יכול לדפדף בכלל (רק לסגור או לבחור-תיקייה-ריקה).

**Reproduction (אומת חי)**:
1. localStorage נקי (משתמש חדש). connect form מציג `D:\Users\User` ב-input (מ-`/api/options`
   homeDir, מוצב ל-local `cwd` ב-`+page.svelte:42`).
2. לחיצה על כפתור התיקייה → דיאלוג נפתח עם 2 כפתורים בלבד (סגור + "בחר תיקייה זו"), אפס entries.
3. eval מאשר: `settings.lastCwd === ""` בעוד שה-input מציג `D:\Users\User`.

**גורם שורש (איתור קוד)**:
- `FolderPickerDialog.svelte:27`: `currentPath = $state(settings.lastCwd || "")` → `""`.
- `:45`: `void loadFolder(currentPath || settings.lastCwd || "")` → `loadFolder("")`.
- `:48-51`: ה-guard החדש `if (!path) { return }` → יוצא מיד, לא טוען כלום.
- **שורש**: ב-`+page.svelte:42` ה-homeDir מ-`/api/options` מוצב ל-**local `cwd`** בלבד,
  **לא** ל-`settings.lastCwd`. אז ה-picker (שקורא רק `settings.lastCwd`) לא רואה אותו.

**מול ה-brief**: §4 Commit 1 שורה 143-144 הורה במפורש: "default (24): במקום `/home/user` —
אתחל מ-server homeDir (`getSettings().lastCwd` **או** ה-homeDir מ-`GET /api/options`)".
המימוש השמיט את ה-fallback ל-`/api/options` homeDir והשאיר רק `settings.lastCwd` (שריק עד
ההתחברות הראשונה). זו **spec drift** — הדרישה התקיימה חלקית.

**חומרה**: minor — לא חוסם GO. workaround: הקלדה ידנית של נתיב; וברגע שיש lastCwd (אחרי
חיבור אחד, או localStorage קיים) ה-picker עובד **מושלם** (אומת: navigate in/up/breadcrumb/select
כולם תקינים). אבל זו חוויית-משתמש-ראשונה שבורה ופספוס של ה-spec.

**כיוון תיקון (לא מימוש)**: או (א) ב-`+page.svelte` לכתוב את ה-homeDir גם ל-`settings.lastCwd`
(או למקור שה-picker קורא), או (ב) ב-FolderPicker להוסיף fallback ל-homeDir מ-`/api/options`
כשה-currentPath ריק (כפי שה-brief תיאר). executor יבחר.

### F2 — 🟢 cosmetic — placeholder Unix-style

ה-`input` של cwd ב-connect form עדיין עם `placeholder="/home/user/projects/X"` (נתיב Unix).
ה-**value** תקין (`D:\Users\User`), רק ה-placeholder cosmetic. לא ב-scope המפורש של ה-brief
(שעסק ב-default-path, לא placeholder), אבל נראה לא-מותאם על Windows. nice-to-have.

### F3 — 🟢 deviation-ok — OPENCODE_ARGS env override (cli-config.ts)

סטיית אליעזר שנבדקה: `cli-config.ts` הוסיף override של args דרך `OPENCODE_ARGS` env
(JSON array). **הערכה: לגיטימי ולא-מזיק**:
- **opt-in**: פעיל רק כש-`OPENCODE_ARGS` env מוגדר **וגם** `kind==="opencode"`. אחרת
  מחזיר את ה-`args` המקוריים — אפס שינוי התנהגות בפרודקשן.
- **מטרה**: tests cross-platform (idle-reaper משתמש ב-bun כ-"sleep binary" במקום נתיב Unix קשיח).
- מתועד inline (Commit 4). הרחבה סבירה ל-test-infra. לא חוסם.

### F4 — ℹ️ pre-existing (אומת עצמאית) — lint-no-hebrew-in-code.test.mjs

אליעזר דיווח על כשל זה כ-pre-existing. **אימות עצמאי** (לא הסתמכתי על דיווחו):
- הקובץ `scripts/lint-no-hebrew-in-code.test.mjs` **קיים ב-base 940d222** (`git cat-file -e`).
- `scripts/` **לא שונה** ב-slice (`git diff --name-only 940d222..HEAD -- scripts/` = ריק).
- הרצתי אותו **ב-base worktree** (`fix-cwd-validate-windows @ 940d222`) → אותו כשל בדיוק:
  `SyntaxError: Invalid or unexpected token` (vitest מנסה לפרסר סקריפט Hebrew-detection
  כקובץ-טסט). **אישור מוחלט: pre-existing, לא regression.**

### F5 — ℹ️ flake — 2 bridge-manager טסטים נכשלו ב-full-run

ב-`pnpm test` המלא (תחת עומס — typecheck רץ במקביל, transform 53s/import 127s) 2 טסטים
נכשלו ב-**timeout 5000ms** (`bridge-manager.test.ts > spawns...` ו-`bridge-failure-modes.ts >
rejects cleanly...`). הרצה חוזרת **בבידוד** של שני הקבצים → **19/19 passed ב-2.9s**. אלו
**flakes הנגרמים מעומס** (timeout, לא לוגיקה), לא regression. (הערה ל-test-infra: שווה
testTimeout גבוה יותר, או הרצת typecheck/test לא במקביל ב-CI איטי.)

---

## נקודות heavy שנבדקו במפורש

| נקודה | ממצא |
|------|------|
| Bubble grouping | N/A (אין שינוי chat bubbles ב-slice) |
| Cross-store data | cwd: local state ↔ settings.lastCwd ↔ /api/options — **כאן בדיוק F1** (אי-סנכרון homeDir→lastCwd) |
| Hardcoded nulls | F1 (default path ריק → guard מחזיר ריק); F2 (placeholder Unix קשיח) |
| Spec drift ("הסר X") | default `/home/user` הוסר ✅; אבל ה-fallback שנדרש לא נוסף במלואו (F1) |
| Mobile + Desktop | שניהם אומתו (picker + connect) ✅ |
| Reload / reconnect | reload שמר localStorage; connect→ready עבד; reconnect-widget = OUT-OF-SCOPE (#8) |
| RTL/LTR mixing | breadcrumb RTL + path LTR (`dir=ltr`) — נכון, אומת בצילומים |
| Edge: path traversal | `..` נחסם תחת restriction (403); תחת allow-all נפתר ל-real parent (התנהגות מכוונת) |
| Edge: empty/null input | param חסר→400; נתיב לא-קיים→404; **path ריק ב-picker→F1** |

---

## Evidence (screenshots)

`$TEMP/verify-wa/` (Windows temp):
- `03-picker-open.png` — **הבאג F1**: דיאלוג ריק בפתיחה ראשונה.
- `04-picker-populated.png` — picker מאוכלס (breadcrumb `D: / Users / User`, footer `D:\Users\User`).
- `06-connected-idle.png` — connect הצליח (status idle).
- `07-home-mobile.png` / `08-picker-mobile.png` — mobile 390px, picker מאוכלס breadcrumb `D: / UserProjects / AI / drive-coding`.

---

## Verdict

🟢 **GO-WITH-NOTE**

כל מטרות-הליבה של ה-slice עובדות חי על Windows-native, כולל ה-blocker הקריטי
(DoD#7 — opencode agent → ready עם acpSessionId, ה-ACP handshake המלא חי). 9/9 ה-DoD
שב-scope עברו (DoD#8 out-of-scope כמתוכנן). typecheck נקי, טסטים נקיים (כשלים = pre-existing
+ flake, אומתו), lint:i18n נקי, fs/browse cross-platform + security guards מאומתים, projects
list נקי.

הערה אחת (F1): FolderPicker בפתיחה ראשונה (localStorage ריק) מציג דיאלוג ריק ולא-נווט —
spec-drift קטן מ-§4 Commit 1 (ה-fallback ל-`/api/options` homeDir לא הושלם). **לא חוסם**
(workaround קיים, והניווט עצמו תקין לחלוטין), אך **מומלץ לתקן** לפני merge ל-dev כי הוא
פוגע בחוויית-משתמש-ראשונה.
