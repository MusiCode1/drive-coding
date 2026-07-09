# Slice — dc-launch-version-check — תוכנית

> **תאריך**: 2026-07-03
> **סטטוס**: מאושר (אביגיל READY r2, 2 findings 🟢 שולבו — `reports/drive-coding/slice-dc-launch-version-check-avigail.md`)
> **Complexity**: 3/10 (verifier: light — calev)
> **תלות**: אין (base=dev). בונה מעל `fe-build-decouple` (מוזג — `dc-build-fe.mjs` קיים).
> **מקור**: אבחון חי בטלפון (2026-07-03) — ר' §רקע.

## §רקע (למה הסבב הזה קיים)

בטלפון (termux) הופיע "אי אפשר לחזור לקודקס" + לולאת-סוקטים. השורש בשני שלבים:

1. **הבאג עצמו** — warm reattach שולח `initialize` חוזר ל-Codex → `Already initialized` →
   לולאת-reconnect. **כבר תוקן** ב-`slice-warm-reattach-skip-init` (מוזג `d74ff49`, v0.9.0).
2. **למה התיקון לא הגיע לטלפון** — נתיבי הבנייה מדלגים על rebuild כשה-build כבר קיים, בלי
   לבדוק אם הוא **עדכני**. אחרי `git pull` המקור מתעדכן אבל ה-`build/` הישן נשאר מוגש →
   הדפדפן מקבל bundle ישן בלי התיקון. במחשב עבד רק כי שם בנו FE טרי ידנית.

יש **שלושה** נתיבי-בנייה, ושלושתם סובלים מ-"skip-if-exists" בלי version-check:
- `scripts/dc-launch.mjs` — עושה build **inline** (לא-אטומי!) רק אם `build/index.html` חסר.
- `scripts/dc-build-fe.mjs --if-missing` — הנתיב הקנוני (atomic swap), מדלג אם קיים.
- `deploy/systemd/voice-acp-{dev,main}.service` `ExecStartPre` — קורא `dc-build-fe --if-missing`.

**התיקון**: בדיקת-גרסה תיכנס ל-**`dc-build-fe.mjs`** (מצב חדש `--if-stale`) — שם הבנייה
כבר קורית, אטומית. `--if-stale` = build אם `index.html` חסר **או** הגרסה המוטבעת ב-build
שונה מהצפויה. הגרסה הצפויה מחושבת כמו ב-`svelte.config.js`: `v${rootPkg.version} (${short-sha})`.
`dc-launch.mjs` **יאציל** ל-`dc-build-fe --if-stale` (במקום ה-inline הכפול), ו-systemd יעבור
מ-`--if-missing` ל-`--if-stale`. כך כל שלושת הנתיבים מתוקנים, וה-inline הלא-אטומי נעלם.

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/dc-launch-version-check -b slice/dc-launch-version-check dev
cd .worktrees/dc-launch-version-check
pnpm install && pnpm hooks:install
```

### Run
- אין BE/FE להרצה בשביל הליבה. הבדיקה היא של סקריפטי-הבנייה:
  ```bash
  node scripts/dc-build-fe.mjs --if-stale     # הליבה
  node scripts/dc-launch.mjs --help           # מאציל ל-dc-build-fe ואז spawn
  ```
- בנייה מלאה (לאיפוס תרחישים): `node scripts/dc-build-fe.mjs`
- lint: `pnpm lint` (Biome על ה-.mjs). typecheck לא חל על JS — ר' §6.

### Browser
לא רלוונטי — שינוי בסקריפטי-תשתית (Node) בלבד. אין UI.

### OneCLI agent
לא רלוונטי — אין proxy בסבב.

### Reading list
**must-read לפני**:
- `scripts/dc-build-fe.mjs` — **הקובץ המרכזי** (61 שורות). ה-`--if-missing` guard בשורות 21,28-32;
  atomic swap בשורות 49-59; `FE_BUILD_OUT=.build-staging` **מקובע פנימית** (שורה 40) — זה
  detail של ה-swap, **לא** knob חיצוני. ה-build הסופי תמיד ב-`packages/frontend/build/`.
- `scripts/dc-launch.mjs` — 38 שורות. ה-build ה-**inline** בשורות 12-22 (`const feIndexHtml` בשורה 12 + guard 14-22; שניהם יוסרו בהאצלה).
- `packages/frontend/svelte.config.js` שורות 1-11, 23 — **מקור-האמת לחישוב `appVersion`**
  שאותו משכפלים **מילולית**: `import pkg from "../../package.json"` (root), `sha =
  execSync("git rev-parse --short HEAD").toString().trim()` fallback `"nogit"`,
  `appVersion = \`v${pkg.version} (${sha})\``. (`out = process.env.FE_BUILD_OUT ?? "build"` —
  לכן ה-build-output של dc-build-fe יורד ל-`.build-staging` בזמן ה-swap, ואז עובר ל-`build`.)
- `deploy/systemd/voice-acp-dev.service` + `voice-acp-main.service` — שורת `ExecStartPre` עם `--if-missing`.

**reference**:
- `docs/investigations/2026-07-01-warm-reattach-initialize.md` — הבאג שהסטייל-בילד הסתיר (רקע).
- `package.json` scripts `fe:build` / `fe:build:if-missing` (שורות 23-24).
- `build/_app/version.json` אחרי build — shape `{"version":"v0.9.0 (d74ff49)"}`.

## §1 — מטרה

אחרי הסבב: **כל שלושת נתיבי-ההרצה** (`pnpm start`/dc-launch, `dc-build-fe`, systemd deploy)
בונים אוטומטית FE טרי — אטומית — אם ה-build המוגש לא תואם ל-`HEAD`/הגרסה הנוכחית, ומדלגים
כשהוא עדכני. אחרי `git pull` הדפדפן תמיד מקבל bundle שתואם למקור, בלי צעד ידני, בלי חלון
של FE חצי-בנוי.

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| מצב `--if-stale` ב-dc-build-fe (version-check + build אטומי) | ✅ | הסבב הזה |
| dc-launch מאציל ל-dc-build-fe `--if-stale` (הסרת ה-inline הכפול) | ✅ | הסבב הזה |
| systemd dev+main: `--if-missing` → `--if-stale` | ✅ | הסבב הזה |
| `package.json`: script `fe:build:if-stale` | ✅ | הסבב הזה |
| שינוי סמנטיקת `--if-missing` הקיים | ❌ | נשאר legacy (missing-only); לא נוגעים — מוסיפים flag חדש |
| rebuild רק כשקבצי-FE השתנו (git diff paths) | ❌ | over-engineering; SHA-compare מספיק |
| ריבילד "חם" בלי ריסטארט BE | ❌ | כבר קיים (atomic swap ב-dc-build-fe) |
| מנגנון גרסאות / bump | ❌ | `scripts/bump-version.mjs` — לא נוגעים |

## §3 — Architecture diagram

```
svelte.config.js  ──(מקור-אמת לנוסחה)──►  appVersion = `v${root pkg.version} (${short-sha})`
        │                                          מוטבע ב-build/_app/version.json בזמן vite build
        ▼
scripts/dc-build-fe.mjs           (סקריפט תשתית — כאן נכנס ה-version-check)
  ├─ computeExpectedVersion(repoRoot)   ← חדש: משכפל את נוסחת svelte.config מילולית
  ├─ readBuiltVersion()                 ← חדש: build/_app/version.json → .version (או null)
  ├─ mode:
  │    (ברירת-מחדל)  → תמיד build
  │    --if-missing  → skip אם build/index.html קיים            (קיים, ללא שינוי)
  │    --if-stale    → skip רק אם index.html קיים AND built===expected   ← חדש
  └─ build → .build-staging → atomic swap ל-build/              (קיים, ללא שינוי)

scripts/dc-launch.mjs
  └─ execFileSync("node", [dcBuildFe, "--if-stale"])  ← מחליף את ה-build ה-inline (שורות 14-22)
        ואז spawn("bun", [binEntry, ...])              (ללא שינוי)

deploy/systemd/voice-acp-{dev,main}.service
  └─ ExecStartPre: node scripts/dc-build-fe.mjs --if-stale   ← היה --if-missing
```
(אין שכבות FE — סקריפטי תשתית. אין נגיעה ב-core/backend/frontend src.)

## §4 — Commits

### Commit 0 — dc-build-fe: `--if-stale` version-aware mode (approach: manual — script glue, 4 תרחישים ב-DoD)

**קובץ**: `scripts/dc-build-fe.mjs` (שינוי)

**שינויים**:
1. import: הוסף `readFileSync` ל-import הקיים מ-`node:fs` (`existsSync, renameSync, rmSync` כבר שם).
2. הוסף שתי פונקציות-עזר + זיהוי `--if-stale`; **החלף** את בלוק ה-skip הקיים (שורות 28-32) בלוגיקה שמכסה גם missing וגם stale.
3. שמור על atomic swap (שורות 34-61) **ללא שינוי**.
4. עדכן את comment-ה-Usage בראש הקובץ (שורות 4-6) עם `--if-stale`.

**API skeleton** (מדויק — executor לא משנה חתימות/נוסחה):
```js
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs"
// ...
const ifMissing = process.argv.includes("--if-missing")
const ifStale = process.argv.includes("--if-stale")

/** משכפל svelte.config.js מילולית: v${rootPkg.version} (${short-sha|nogit}). */
function computeExpectedVersion() {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"))
  let sha = "nogit"
  try {
    sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot }).toString().trim()
  } catch {}
  return `v${pkg.version} (${sha})`
}

/** הגרסה המוטבעת ב-build הפעיל, או null אם חסר/לא-תקין. */
function readBuiltVersion() {
  const vj = path.join(buildDir, "_app", "version.json")
  if (!existsSync(vj)) return null
  try {
    return JSON.parse(readFileSync(vj, "utf8")).version ?? null
  } catch {
    return null
  }
}

const indexExists = existsSync(path.join(buildDir, "index.html"))

// --if-missing: skip רק אם ה-build קיים (legacy, ללא version-check)
if (ifMissing && indexExists) {
  console.log("[dc-build-fe] build exists — skipping (--if-missing)")
  process.exit(0)
}

// --if-stale: skip רק אם ה-build קיים AND הגרסה תואמת
if (ifStale && indexExists) {
  const expected = computeExpectedVersion()
  const built = readBuiltVersion()
  if (built === expected) {
    console.log(`[dc-build-fe] build up-to-date (${built}) — skipping (--if-stale)`)
    process.exit(0)
  }
  console.log(`[dc-build-fe] build stale (built=${built}, expected=${expected}) — rebuilding`)
}
// (נופל לבנייה: default / missing / stale)
console.log("[dc-build-fe] starting FE build...")
// ...(atomic swap הקיים ללא שינוי)
```
> הערה: `buildDir` כבר מוגדר בקובץ (שורה 24 = `packages/frontend/build`). `version.json` תמיד תחת ה-`build/` הסופי (ה-swap מעביר staging→build), לכן קוראים מ-`buildDir`, **לא** מ-`.build-staging`.

**Verification**:
```bash
node -c scripts/dc-build-fe.mjs
pnpm lint
node scripts/dc-build-fe.mjs                 # בנייה מלאה → build/_app/version.json תואם ל-HEAD
node scripts/dc-build-fe.mjs --if-stale       # מיד אחרי → "up-to-date — skipping"
```

### Commit 1 — dc-launch: delegate to dc-build-fe --if-stale (approach: manual — glue)

**קובץ**: `scripts/dc-launch.mjs` (שינוי)

**שינויים**:
1. **הסר** את בלוק ה-build ה-inline (שורות 12-22) ואת `import { existsSync }` אם לא נחוץ עוד.
2. **החלף** בהאצלה ל-dc-build-fe:
   ```js
   const dcBuildFe = path.join(repoRoot, "scripts/dc-build-fe.mjs")
   execFileSync("node", [dcBuildFe, "--if-stale"], { stdio: "inherit", cwd: repoRoot })
   ```
   (`execFileSync`,`spawn` כבר מיובאים; `path`,`repoRoot` קיימים.)
3. עדכן את comment הראש (שורה 3): "builds/refreshes the FE if stale, then starts the bin entry."
4. ה-`spawn("bun", [binEntry, ...])` (שורות 24-38) — **ללא שינוי**.

**Verification**:
```bash
node -c scripts/dc-launch.mjs && pnpm lint
```

### Commit 2 — systemd + package.json + docs: switch to --if-stale (approach: manual)

**קבצים**: `deploy/systemd/voice-acp-dev.service`, `deploy/systemd/voice-acp-main.service`, `package.json`, `docs/deploy-local-service.md`

**שינויים**:
1. בשני ה-`.service`: ב-`ExecStartPre` החלף `dc-build-fe.mjs --if-missing` → `dc-build-fe.mjs --if-stale`. עדכן את הערת-העברית מעל השורה ("בונה את ה-FE רק אם חסר" → "בונה את ה-FE אם חסר או לא-עדכני").
2. `package.json` scripts: הוסף `"fe:build:if-stale": "node scripts/dc-build-fe.mjs --if-stale"` (ליד `fe:build:if-missing` בשורה 24; additive — לא לדרוס).
3. `docs/deploy-local-service.md` (שורות 60, 99, 101) — עדכן את התיאור מ-`--if-missing` ל-`--if-stale` והסבר "builds FE if missing **or stale**" (שורה 99), + עדכן שורה 101 (guard מרענן גם על גרסה שונה, לא רק חסר). התיעוד חייב לשקף את ה-ExecStartPre המעודכן.

**Verification**:
```bash
grep -rn "if-stale" deploy/systemd/*.service package.json docs/deploy-local-service.md    # ≥4 מופעים חדשים
grep -rn "if-missing" deploy/systemd/*.service docs/deploy-local-service.md               # 0 ב-.service; docs מעודכן
pnpm lint
```

## §5 — DoD

| בדיקה | איך |
|---|---|
| `computeExpectedVersion` = בדיוק כמו svelte.config | `node scripts/dc-build-fe.mjs`; `cat packages/frontend/build/_app/version.json` ⇔ נוסחת הפונקציה (כולל sha) זהים |
| `--if-stale`: build תואם → **לא** בונה | build טרי + HEAD ללא שינוי → `node scripts/dc-build-fe.mjs --if-stale` → "up-to-date — skipping", אין vite |
| `--if-stale`: version שונה → בונה מחדש | ערוך `build/_app/version.json` ל-`v0.0.0 (deadbee)` → `--if-stale` → "build stale (built=v0.0.0..., expected=v0.9.0 ...)" + rebuild אטומי |
| `--if-stale`: build חסר → בונה | `rm -rf packages/frontend/build` → `--if-stale` → בונה (index.html חסר) |
| `--if-missing` legacy ללא שינוי | build קיים → `--if-missing` → "build exists — skipping" (לא נוגע בגרסה) |
| אין git → fallback "nogit" בלי crash | PATH בלי git → `--if-stale` על build עם `(nogit)` → משווה, לא זורק |
| dc-launch מאציל ולא בונה inline | `node scripts/dc-launch.mjs` (build תואם) → לוג של dc-build-fe "up-to-date", ואז ה-bin עולה; אין `pnpm ... build` ישיר מ-dc-launch |
| atomic swap נשמר (build/ לא נעלם בכשל) | ה-swap הקיים ללא שינוי (regression: `node scripts/dc-build-fe.mjs` מלא עדיין עובד) |
| systemd + package.json מצביעים ל-`--if-stale` | `grep -n "if-stale" deploy/systemd/*.service package.json` = 3 שורות |
| lint נקי | `pnpm lint` = 0 |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| drift מ-svelte.config (אם ישונה שם נוסחת `appVersion`) | שכפול לוגיקה | הערת-קוד ב-**שני** הקבצים ("כל שינוי בנוסחה — עדכן גם את השני"); ה-DoD משווה מול version.json אמיתי → תופס drift |
| קריאה מ-`.build-staging` במקום מ-`build/` הסופי | atomic swap: version.json מיוצר ב-staging ואז עובר | `readBuiltVersion` קורא מ-`buildDir` (=build/) בלבד — נבדק **לפני** ה-build; אחרי swap הוא ה-build הבא |
| קוד-FE לא-מקומיט → sha לא זז → build לא מתרענן | git-clean assumption | out-of-scope: זה launch-after-pull, לא dev-loop (vite dev מטפל). §9#1 |
| rebuild על כל commit (גם BE-only) → +~60ש' | SHA-compare | מקובל בכוונה (correctness > 60ש'); atomic swap → אין downtime. §9#3 |
| `.mjs` לא ב-`pnpm typecheck` | JS | `node -c` + `pnpm lint` (Biome) בגייטים; לוגיקה טהורה |
| שבירת `--if-missing` הקיים (systemd main עדיין משתמש?) | שינוי מרובה-קבצים | לא נוגעים בסמנטיקת `--if-missing`; מוסיפים `--if-stale`. אחרי הסבב אף caller שלנו לא משתמש ב-`--if-missing`, אך הוא נשאר עובד |
| Hardcoded Hebrew | pre-commit hook | אין מחרוזות UI; רק `console.log` אנגלי (מותר) + הערות עברית ב-.service (לא קוד) |

## §7 — Escalation triggers

עצור ושאל את מרדכי (parent task) אם:
- `svelte.config.js` **לא** משתמש עוד ב-`v${pkg.version} (${sha})` — צריך ליישר מקור-אמת.
- `build/_app/version.json` לא קיים אחרי build תקין (adapter-static שינה מבנה / `version.name` לא מיוצר).
- ה-atomic swap ב-dc-build-fe דורש שינוי כדי לתמוך ב-version-check (לא אמור — הבדיקה קורית **לפני** ה-swap).
- מתגלה caller נוסף של `dc-build-fe --if-missing` מחוץ ל-systemd+package.json (למשל bunx/binary path) שצריך גם הוא `--if-stale`.

## §8 — Complexity score

- commits: 3 (נמוך)
- שכבות חדשות: 0 (סקריפטי תשתית, לא נוגע ב-5 השכבות)
- APIs חיצוניים: 0
- streaming/async: לא
- refactor state model: לא
- protocol BE↔FE: לא

**Score: 3/10 → verifier: light (calev)**. הבדיקה = תרחישי-בנייה (§5); calev יריץ אותם.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | staleness כשקוד-FE לא מקומיט (sha לא זז) | מחוץ ל-scope — launch-after-pull, לא dev-loop | ❌ |
| 2 | flag חדש `--if-stale` מול שדרוג `--if-missing` | **flag חדש** — לא משנה סמנטיקה קיימת, migrate callers; `--if-missing` נשאר legacy | ❌ (הוכרע) |
| 3 | השוואת string מלא (semver+sha) מול semver-בלבד | **string מלא** — ה-sha כבר ב-version.json, חינם, קולט commit-שונה-באותה-גרסה. (bump-בכל-merge → semver לבד היה מספיק ל-merges; full-string strictly safer) | ❌ (הוכרע — לאשר עם המשתמשת) |
