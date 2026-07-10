# Slice CUT-3a — package reorg: per-provider folders (mechanical, exports-preserving) — בריף

> **תאריך**: 2026-06-28 · **סטטוס**: הושלם · **branch**: slice/cutover-migration (ממשיך אחרי EXT-SCHEMA)
> **Complexity**: 5/10 (verifier: light — מכני, exports-preserving) · **depends_on**: [EXT-SCHEMA] · **Base**: `slice/cutover-migration` @ `10c36e6`
> **לא ממזגים — ‏נצבר על cutover-migration.**

---

## §0 — context

המבנה היום מארגן לפי **מנגנון-חיבור** (`host/in-process/`, `host/spawn-core.ts`). ההכרעה (המשתמש): הציר הוא
**הספק**, לא המנגנון. CUT-3a הוא **reorg מכני בלבד** — מעביר קבצים לתיקיות-ספק + `shared/`, **בלי שינוי
התנהגות, בלי interface חדש, בלי registry** (אלה CUT-3b). additive-במובן: אותו קוד, מיקום אחר.

> ⚠️ זה churn על קוד calev-GO. לכן: **exports-preserving** הוא ה-DoD המרכזי. אביגיל/calev מאמתים שאף
> import חי לא נשבר ושכל הטסטים עוברים. ה-interface האחיד + registry + routing = **CUT-3b** (מתעצבים יחד עם הנתיב החי).

## §1 — מטרה

reorg: `host/spawn-core.ts` → `shared/`, `host/in-process/claude/*` → `providers/claude/*`, `host/types.ts` →
`types.ts` (top-level). **כל ה-exports הציבוריים נשמרים זהים** (`./host` barrel ממשיך לעבוד). 0 שינוי התנהגות.

## §2 — Scope

| כן | לא |
|---|---|
| `host/spawn-core.ts` → `shared/spawn-core.ts` (כלי-עזר) | `Provider` interface (CUT-3b) |
| `host/in-process/claude/*` → `providers/claude/*` | `registry.ts` (CUT-3b) |
| `host/in-process/host.ts` → `providers/claude/in-process-host.ts` | routing חי / נגיעה ב-BE (CUT-3b) |
| `host/in-process/client-bridge.ts` → `providers/claude/client-bridge.ts` | שינוי התנהגות/לוגיקה |
| `host/types.ts` (AdapterHost, NormalizedCapabilities) → `types.ts` top-level | מימוש codex |
| עדכון imports פנימיים (ESM `.js`) + **שימור exports map** | — |

## §3 — מימוש: מפת ההעברה

**כל 11 הקבצים תחת `host/` (מ-`find` — מלא, אביגיל r1 תפסה 4 חוסרים):**

| מ- | אל- |
|---|---|
| `host/spawn-core.ts` | `shared/spawn-core.ts` |
| `host/spawn-core.test.ts` | `shared/spawn-core.test.ts` |
| `host/in-process/host.ts` | `providers/claude/in-process-host.ts` |
| `host/in-process/host.test.ts` | `providers/claude/in-process-host.test.ts` |
| `host/in-process/client-bridge.ts` | `providers/claude/client-bridge.ts` |
| `host/in-process/claude/capabilities.ts` | `providers/claude/capabilities.ts` |
| `host/in-process/claude/rename.ts` | `providers/claude/rename.ts` |
| `host/in-process/claude/query-access.ts` | `providers/claude/query-access.ts` |
| `host/in-process/claude/query-access.test.ts` 🔴 | `providers/claude/query-access.test.ts` |
| `host/in-process/live/host.live.test.ts` 🔴 | `providers/claude/live/host.live.test.ts` |
| `host/types.ts` (AdapterHost, NormalizedCapabilities) | `types.ts` (top-level — החוזה האחיד) |
| `host/index.ts` (barrel) | **נשאר** — re-export מהמיקומים החדשים |

**שני תיקונים שנגררים מה-mv (אביגיל r1):**
1. **`host.live.test.ts`**: מייבא `../host.js` (host/in-process/live → host/in-process/host.ts). אחרי ה-mv ל-`providers/claude/live/`, ה-host.ts הוא `providers/claude/in-process-host.ts` → עדכן ל-`../in-process-host.js` (אותו עומק, שם חדש).
2. **`package.json` `test:live`**: `"RUN_LIVE=1 vitest run --dir src/host/in-process/live"` → `--dir src/providers/claude/live`. **חובה** — אחרת `pnpm test:live` שובר.

**exports-preserving** — שתי אפשרויות, בחר את הנקייה:
- **A (מומלץ)**: `./host` barrel נשאר ב-`src/host/index.ts`, אבל **re-export מהמיקומים החדשים** (`export { createSpawnCore } from "../shared/spawn-core.js"` וכו'). ה-consumer היחיד (`bridge-manager.ts:29 createSpawnCore`) + הטסטים לא משתנים.
- B: עדכן את ה-exports map ל-subpaths חדשים + עדכן את ה-consumer. יותר נקי אך יותר churn — **לא** ל-slice הזה (CUT-3b יסדר subpaths חדשים עם ה-registry).

> בחר **A**. ה-barrel `./host` נשאר חוזה-יציב; הקוד מאחוריו זז. NormalizedCapabilities מיוצא מ-`types.js` החדש (barrel re-export).

## §4 — Commits

1. העברת קבצים (git mv לשימור היסטוריה) + עדכון imports פנימיים (ESM `.js`) + `./host` barrel re-exports מהמיקומים החדשים + `types.ts` top-level. typecheck.
2. אימות: `pnpm --filter @drive-coding/provider test` ירוק (כולל ה-live-tests — הם רק collected, skipIf). findings + walkthrough.

## §5 — DoD

| # | בדיקה |
|---|------|
| 1 | typecheck ירוק (כל ה-packages — הנתיב החי מייבא `createSpawnCore` מ-`./host`, חייב להמשיך לעבוד) |
| 2 | `pnpm test` ירוק — אותם טסטים, מיקום אחר (0 רגרסיה) |
| 3 | **exports זהים**: `git show HEAD~N:packages/provider/package.json` exports == אחרי; `./host` barrel מייצא **אותם** symbols (grep diff) |
| 4 | `bridge-manager.ts` (consumer חי) **לא שונה** — `createSpawnCore` עדיין נפתר מ-`@drive-coding/provider/host` |
| 5 | אין `host/in-process/` או `host/spawn-core.ts` — הקבצים זזו (git mv); `providers/claude/` + `shared/` + `types.ts` קיימים |
| 6 | diff = **rename + import-path בלבד** (אין שינוי לוגיקה — `git diff -M` מראה renames) |
| 7 | additive — רק `packages/provider/**` + `docs/**` |
| 8 | **`test:live` script עודכן** ל-`--dir src/providers/claude/live`; `RUN_LIVE=1 pnpm test:live` עדיין מריץ (live, אם CLI זמין) — לפחות collected ולא שבור |
| 9 | **כל 11 הקבצים** הועברו (אין יתום ב-`host/` פרט ל-`index.ts` barrel); `query-access.test.ts` + `host.live.test.ts` עברו ו-imports שלהם תוקנו |

## §6 — Risks

| סיכון | מיטיגציה |
|---|---|
| שבירת import חי (`createSpawnCore` ב-bridge-manager) | DoD#1+#4 — ה-`./host` barrel re-export שומר על הנתיב; typecheck תופס |
| circular imports אחרי reorg | סדר: shared/ ← providers/claude/ ← host barrel; ללא מעגלים. typecheck תופס |
| live-test paths נשברים (rename-smoke וכו' כבר נמחקו; live.test.ts) | עדכן את ה-imports בקובץ ה-live.test; DoD#2 |
| ESM `.js` בייבוא אחרי mv | ידני-זהיר; typecheck verbatimModuleSyntax תופס |
| git mv לא נתפס כ-rename | `git mv` + `git diff -M`; DoD#6 |

> 3 שנשכחים: ESM `.js` · lint:i18n · git **mv** (לא delete+create — לשמר blame).

## §7 — Escalation
- אם ה-reorg חושף תלות-סמויה שלא מתפרקת נקי (circular / type שמודלף) → עצור ותעד. אל תשנה לוגיקה כדי "לתקן" reorg.

## §8 — Complexity: 5/10 → calev light (מכני; האמת מ-typecheck + test-suite זהה + exports-diff).

## §9 — שאלות פתוחות

| # | שאלה | ברירת-מחדל | חוסם? |
|---|------|----------|------|
| 1 | barrel `./host` נשאר או subpaths חדשים? | barrel נשאר (A) — subpaths חדשים ב-CUT-3b עם registry | ❌ |
| 2 | `types.ts` top-level או `extensions/` ליד? | top-level `src/types.ts` (החוזה האחיד הכללי; extensions/ הוא ל-ext methods) | ❌ |
| 3 | להעביר client/transport/config/spawn גם הם? | לא — הם shared אגנוסטיים, נשארים. רק host/in-process zז ל-providers/ | ❌ |
