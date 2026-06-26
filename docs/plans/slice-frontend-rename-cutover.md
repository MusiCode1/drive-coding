# Slice frontend-rename-cutover — `@drive-coding/frontend-v2` → `@drive-coding/frontend` — תוכנית

> **תאריך**: 2026-06-25
> **סטטוס**: טיוטה (אביגיל טרם)
> **Complexity**: 3/10 (verifier: light)
> **תלות (depends_on)**: `[]` — שינוי שם-חבילה + הפניות. אין תלות בסלייס אחר.
> **Base**: `dev` HEAD (גזור מ-`dev` עדכני).

---

## §0 — Pre-flight

### רקע — ה-cutover כבר ברובו בוצע
הספרייה **כבר** שמה `packages/frontend/` (שונתה מ-`frontend-v2/` עם מחיקת ה-legacy, 2026-05-28).
מה שנשאר הוא **שם החבילה** ב-`package.json` שעדיין `@drive-coding/frontend-v2`, וההפניות אליו.
זה הסבב שסוגר את ה-cutover: השם → `@drive-coding/frontend`.

### עובדות שאומתו (חוסך לך חיפוש — אל תניח אחרת בלי לאמת)
- **pnpm-lock.yaml לא מכיל `frontend-v2`** — pnpm ממפתח workspace-importers לפי **נתיב** (`packages/frontend`), לא לפי שם. → השינוי לא נוגע ב-lockfile; `pnpm install` יהיה no-op/טריוויאלי.
- **נתיבי ה-build דירקטוריוניים** — `packages/frontend/build` (svelte adapter-static `pages:"build"`) מועתק ל-`release/frontend-dist`. **לא** תלויים בשם החבילה. → rename לא שובר build paths.
- **אין** turbo/nx/CI-workflows/root-scripts שתלויים בשם. `pnpm-workspace.yaml` = glob `packages/*` (נתיב).
- **אף package.json אחר לא תלוי** ב-`@drive-coding/frontend-v2` (אומת `git grep` — רק ההגדרה-העצמית).

### Worktree
```bash
git worktree add .worktrees/slice-frontend-rename-cutover -b slice-frontend-rename-cutover dev
cd .worktrees/slice-frontend-rename-cutover
pnpm install && pnpm hooks:install
```

### Run / Verify
- `pnpm install` (אחרי rename — מאמת שה-workspace עדיין נפתר)
- `pnpm --filter @drive-coding/frontend build` (השם החדש — חייב להיתפס ולבנות)
- `node packages/release/scripts/build.mjs` (ה-release build המלא — FE build + copy ל-frontend-dist)
- `node scripts/dc-launch.mjs --help` או ריצה חלקית (ר' §5 — לפחות לוודא שה-`--filter` נפתר, לא "No projects matched")

### OneCLI / Browser
- **לא דרוש** — אין נגיעת proxy/TTS/UI; זה refactor של שמות.

### Reading list
**must-read לפני**:
- `packages/frontend/package.json` (שורה 2 — מקור-האמת לשם).
- §"מה משתנה" למטה — רשימת ה-file:line המדויקת.

**reference**:
- `AGENTS.md` (section Worktrees / Running parallel worktrees — שם יושבות פקודות ה-`--filter`).

---

## §1 — מטרה

לסגור את ה-cutover ההיסטורי `frontend-v2 → frontend`: שם החבילה יהיה `@drive-coding/frontend`
(עקבי עם הדירקטוריה `packages/frontend/`), וכל ההפניות הפונקציונליות והתיעוד-החי יצביעו לשם
החדש. אחרי הסבב אין יותר `@drive-coding/frontend-v2` בקוד או בפקודות שסוכן/מפתח מריץ — שם-החבילה
מפסיק לבלבל.

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| שם החבילה `package.json` → `@drive-coding/frontend` | ✅ | Commit 1 |
| 2 קריאות `--filter @drive-coding/frontend-v2` פונקציונליות (build.mjs, dc-launch.mjs) | ✅ | Commit 1 |
| הערות-קוד שמזכירות את השם (build.mjs:4, smoke:26) | ✅ | Commit 1 |
| docs **חיים** שסוכנים מריצים מהם פקודות `--filter` | ✅ | Commit 2 |
| **archives / reports / briefs שהושלמו-ומוזגו** — רשומה היסטורית | ❌ | נשארים כפי שהם (ר' §9 Q1) — שכתוב רשומה היסטורית = רעש + מטעה ("אז זה היה frontend-v2") |
| שינוי נתיבי build / שם-דירקטוריה | ❌ | כבר נעשה (2026-05); דירקטוריוני, אין צורך |
| מחיקת `packages/frontend` legacy ב-main | ❌ | main נשאר reference (AGENTS.md) |

## §3 — Architecture diagram

```
packages/frontend/package.json   "name": "@drive-coding/frontend-v2"  ← מקור-האמת (Commit 1)
        │
        ├─ packages/release/scripts/build.mjs:40   pnpm --filter <name> build   ← Commit 1
        ├─ scripts/dc-launch.mjs:18                pnpm --filter <name> build   ← Commit 1
        └─ (build output = packages/frontend/build — דירקטוריוני, לא נוגעים)

docs חיים (Commit 2): AGENTS.md · packages/frontend/AGENTS.md · docs/running-locally.md ·
  packages/frontend/docs/slices.md · docs/plans/EXECUTOR_DISPATCH.md · tests/smoke/README.md ·
  docs/roadmap.md · docs/vnext-spec.md · docs/deploy-cf-pages.md · docs/behaviors-coverage.md ·
  docs/plans/redesign-chain-dispatch.md
היסטורי — לא נוגעים: walkthrough.md · decisions/voice-acp.md · reports/** · docs/reports/** ·
  redesign-vnext-mockup.html · archive/**
```

## §4 — Commits

### Commit 1 — rename פונקציונלי (approach: manual — הרצת ה-build pipelines)

**קבצים שמשתנים** (החלפה מדויקת `@drive-coding/frontend-v2` → `@drive-coding/frontend`):
- `packages/frontend/package.json:2` — `"name": "@drive-coding/frontend-v2"` → `"@drive-coding/frontend"`.
- `packages/release/scripts/build.mjs:40` — `execFileSync("pnpm", ["--filter", "@drive-coding/frontend-v2", "build"], …)` → השם החדש. (וגם ההערה :4.)
- `scripts/dc-launch.mjs:18` — `["--filter", "@drive-coding/frontend-v2", "build"]` → השם החדש.
- `tests/smoke/chat-roundtrip.mjs:26` — הערה בלבד (`pnpm --filter … dev`) → השם החדש.

> **למה לא `sed -i` עיוור על כל הריפו**: כדי לא לסחוף את 90+ ההפניות ב-archives/reports/briefs
> היסטוריים. ב-Commit 1 נוגעים **רק** ב-4 הקבצים האלה — מדויק.
>
> **occurrence שביעי שאינו `.md` — לא לגעת** (אביגיל r1 #3): `docs/plans/redesign-vnext-mockup.html:524`
> מכיל דגימת `package.json` קשיחה בתוך mockup **סטטי** — לא-פונקציונלי, **נשאר**. לכן ה-DoD grep
> כולל `':!*.html'` (ר' §5).

**Verification**:
```bash
pnpm install                                          # workspace נפתר; pnpm-lock ללא שינוי (path-keyed)
pnpm --filter @drive-coding/frontend build            # נבנה עם השם החדש (FE build → packages/frontend/build)
pnpm --filter @drive-coding/frontend-v2 build 2>&1 | grep -i "No projects matched" && echo "OK: השם הישן כבר לא תופס"
node packages/release/scripts/build.mjs               # release build מלא עובר (FE build + copy → frontend-dist)
pnpm typecheck && pnpm lint:i18n                      # נקי
```

### Commit 2 — סנכרון docs חיים (approach: manual — mechanical sweep)

**מה**: החלף `@drive-coding/frontend-v2` → `@drive-coding/frontend` ב-docs ה**חיים** בלבד
(שסוכנים/מפתחים מעתיקים מהם פקודות). **לא** לגעת ב-`docs/plans/archive/**`, `reports/**`,
`docs/archive/**`, או ב-briefs של slices שכבר מוזגו.

**קבצים שכן מעדכנים** (אומתו עם `git grep -l` — כולם docs חיים שמריצים מהם `--filter`):
`AGENTS.md`, `packages/frontend/AGENTS.md`, `docs/running-locally.md`,
`packages/frontend/docs/slices.md`, `docs/plans/EXECUTOR_DISPATCH.md`,
`tests/smoke/README.md`, `docs/roadmap.md`, `docs/vnext-spec.md`,
`docs/deploy-cf-pages.md`, `docs/behaviors-coverage.md`,
**`docs/plans/redesign-chain-dispatch.md`** (אביגיל r1 #2 — dispatch-prompt חי בתיקיית `plans/` עם פקודות `--filter` רצות; השרשרת מוזגה אבל הקובץ בתיקייה החיה → מעדכנים את הפקודה, אין סיבה להשאיר פקודה שגויה).

**קבצי-גבול — מַשאירים כפי שהם (רשומה היסטורית, אל תיגע)** — הוכרעו מראש כדי שלא תתלבט:
- `docs/walkthrough.md` — changelog append-only מתוארך (כל entry מתאר מצב בזמנו).
- `docs/decisions/voice-acp.md` — rationale-log מתוארך (entries היסטוריים; ה-rename ייכנס כ-entry חדש ב-`docs/decisions/drive-coding.md` של מרדכי, לא ע"י עריכת הישנים).
- `docs/reports/**`, `reports/**` — דוחות verifier (חומר-גלם היסטורי).
- `docs/plans/redesign-vnext-mockup.html` — mockup סטטי (§4 Commit 1 הערה).
- `docs/plans/archive/**`, `docs/archive/**` — ארכיון.

> **briefs ב-`docs/plans/*.md` (pending ו-merged) — נשארים** (אביגיל r2 #5): brief הוא
> ארטיפקט-תכנון היסטורי (מתאר את הסלייס בזמן התכנון, כמו report). ~24 briefs מזכירים
> `frontend-v2` ב-§0 — **לא לסחוף אותם**. הפקודות הרצות שמהן עובדים בפועל הן ברשימה המתוחמת
> למעלה; וכש-מרדכי ידispatch brief עתידי, הוא נותן את שם-החבילה הנכון ב-prompt (לא מהקובץ).

**Verification** — בדיקת ה**רשימה המתוחמת** (לא grep גלובלי, שמתנגש עם ה-briefs ההיסטוריים):
```bash
# כל 11 קבצי ה-docs-החיים נקיים אחרי הסוויפ:
git grep -l "frontend-v2" -- \
  AGENTS.md packages/frontend/AGENTS.md docs/running-locally.md \
  packages/frontend/docs/slices.md docs/plans/EXECUTOR_DISPATCH.md \
  tests/smoke/README.md docs/roadmap.md docs/vnext-spec.md \
  docs/deploy-cf-pages.md docs/behaviors-coverage.md docs/plans/redesign-chain-dispatch.md
#   → צפוי: ריק (כל 11 עודכנו).
pnpm lint:i18n   # docs בלבד — לא אמור להישבר
```

## §5 — DoD

| בדיקה | איך |
|---|---|
| `package.json` name = `@drive-coding/frontend` | code review + `grep '"name"' packages/frontend/package.json` |
| `pnpm install` נקי (workspace נפתר, lockfile ללא drift לא-צפוי) | הרצה; `git diff pnpm-lock.yaml` ≈ ריק |
| `pnpm --filter @drive-coding/frontend build` בונה בהצלחה | הרצה → `packages/frontend/build/index.html` קיים |
| השם הישן `@drive-coding/frontend-v2` כבר **לא** תופס שום project | `pnpm --filter @drive-coding/frontend-v2 build` → "No projects matched" |
| `node packages/release/scripts/build.mjs` — release build מלא עובר | הרצה → `packages/release/frontend-dist/` מאוכלס |
| `scripts/dc-launch.mjs` נפתר ל-build (לא "No projects matched") | הרצת ה-build step / קריאת הקוד |
| אין `frontend-v2` בקוד פונקציונלי | `git grep "frontend-v2" -- ':!*.md' ':!*.html'` → רק comments שעודכנו / ריק (ה-`.html` mockup מוחרג) |
| 11 קבצי docs-החיים נקיים | `git grep -l "frontend-v2" -- <11 הקבצים מרשימת Commit 2>` → ריק (ר' הפקודה המלאה ב-§4 Commit 2 Verification) |
| briefs היסטוריים ב-`docs/plans/*.md` — נשארו ללא שינוי (לא נסחפו) | code review: ה-diff נוגע רק ב-4 קבצי-קוד + 11 docs-חיים; שום brief אחר לא ב-diff |
| typecheck + lint:i18n נקיים | הפקודות |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| `--filter` פונקציונלי שנשכח → build pipeline נשבר עם "No projects matched the filters" | טבע ה-slice | §5 בודק את שני ה-pipelines (release build + dc-launch) במפורש; חיפוש `git grep "frontend-v2" -- ':!*.md'` סוגר |
| `sed -i` עיוור סחף archives/reports → רעש ענק ב-diff + שכתוב רשומה היסטורית | — | Commit 1 = 4 קבצים נקובים בלבד; Commit 2 = רשימת docs-חיים מפורשת + exclude מפורש של archive/reports |
| pnpm-lock drift לא-צפוי | learnings (`pnpm update -r` הסיר `#main` בעבר) | **לא** מריצים `pnpm update`; רק `pnpm install`. בודקים `git diff pnpm-lock.yaml` ≈ ריק. אם יש drift גדול — §7 escalation |
| מחרוזת עברית קשיחה | pre-commit hook | אין מחרוזות חדשות (rename בלבד) |
| הסרת `-v2` תשבור deploy שמריץ build ל-CF Pages | `docs/deploy-cf-pages.md` | אין CI workflow בריפו (אומת — `.github/workflows` ריק); ה-deploy ידני ומריץ `pnpm --filter … build` — מתעדכן ב-Commit 2 |

## §7 — Escalation triggers

עצור ושאל את מרדכי (parent task) אם:
- `git diff pnpm-lock.yaml` מראה drift גדול (לא ריק) אחרי `pnpm install` — לא צפוי (path-keyed).
- מצאת הפניה **פונקציונלית** ל-`@drive-coding/frontend-v2` מחוץ ל-4 הקבצים ב-§4 (למשל ב-vite/svelte config, CI, או import ב-TS) — ה-mapping לא שלם.
- אתה לא בטוח אם קובץ docs ספציפי הוא "חי" או "ארכיון" → אל תנחש, שאל.
- `node packages/release/scripts/build.mjs` נכשל מסיבה שקשורה לשם (לא לבעיית build כללית).

## §8 — Complexity score

- commits: 2 (נמוך)
- שכבות חדשות: 0
- APIs חיצוניים: 0
- streaming/async: לא
- refactor state model: לא
- שינוי protocol BE↔FE: לא
- ריבוי קבצים (docs sweep) + נגיעה ב-build/release/launch → +1 ערנות

**Score ≈ 3/10 → verifier `calev` mode: light.** הדגש: להריץ בפועל את שני ה-build pipelines (release + dc-launch), לא רק typecheck.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל מוצעת | חוסם? |
|---|---|---|---|
| 1 | "rename גורף" — האם לכלול גם archives/reports/briefs-שמוזגו + קבצי-הגבול (walkthrough, voice-acp.md, .html mockup)? | **לא** — להשאיר כרשומה היסטורית; לעדכן רק קוד פונקציונלי + docs חיים. קבצי-הגבול הוכרעו מראש ב-§4 Commit 2 (רשימת "מעדכנים" מול "משאירים"). שכתוב ארכיון מטעה ("אז זה היה frontend-v2") ויוצר diff ענק. | ❌ (אם המשתמשת רוצה הכל — Commit 3 = `sed -i` גורף, טריוויאלי להוסיף) |
| 2 | האם לפצל ל-2 commits (קוד / docs) או commit אחד? | 2 commits — מפריד functional מ-cosmetic, קל ל-revert של ה-docs sweep | ❌ |
