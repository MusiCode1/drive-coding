# Slice — options-trim — תוכנית

> **תאריך**: 2026-07-10
> **סטטוס**: 📝 טיוטה — טרם אביגיל
> **Complexity**: 3/10 (verifier: **light / calev**)
> **תלות**: `depends_on: [be-crash-hardening, be-diag-harness]` (⚠️ **תלות-שרשור/baking, לא תלות-קוד** — ר' §0) · **base**: `slice/be-diag-harness` @ `585ea804`
> **מקור**: `docs/investigations/2026-07-06-project-wide-bug-review.md` §🟠 **ממצא #4** (`/api/options` חוסם event-loop).
>   **מחליף את התוכנית הישנה `options-async-cache`** — חקירה חיה (2026-07-10) הראתה ש-#4 נפתר **במחיקה, לא ב-cache**:
>   ה-FE צורך **רק** את `homeDir`; `models` + `projects` (החישובים היקרים) הם **dead payload — 0 צרכנים**.

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/options-trim -b slice/options-trim slice/be-diag-harness
cd .worktrees/options-trim
bun install          # ⚠️ שרת bun-only — אין pnpm/node אמיתי. install דרך bun (קורא bun.lock).
```
- env הפרויקט (ports/OneCLI/commands): `AGENTS.md`. פרוטוקול executor: הגדרת הסוכן **eliezer** + סקיל brief-driven-slices.
- ⚠️ **סביבת-הרצה bun-only**: **אין `pnpm`/`node` אמיתי — רק `bun`**. `pm.mjs` מזהה bun אוטומטית תחת `bun run`.
  השתמש בפקודות-bun למטה, **לא** ב-`pnpm`.

> **⚠️ למה `depends_on` על השרשרת אם אין חפיפת-קוד?** ה-slice הזה נוגע ב-`http-options.ts` + FE `options.ts` —
> **אף אחד מהם לא נגע** ב-crash-hardening/diag-harness. אין תלות-קוד. ה-`base = slice/be-diag-harness` הוא **החלטת-שרשור
> מכוונת**: (א) השרשרת חיה כרגע ("baking") וזה הענף שבו בונים; (ב) ה-`be-diag-harness` נותן את ה**עיניים** לאמת חי
> שה-blocker נעלם — ה-`/api/diag` (event-loop histogram) + `watch.mjs` מודדים בדיוק את מה שה-slice מתקן (ר' §4 DoD).
> merge-order: crash-hardening → diag-harness → **options-trim** (`--no-ff`, בסדר). **אין קונפליקט-מיזוג צפוי** — קבצים זרים.

### Verification (build-gate) — **bun**
```bash
cd /path/to/worktree
CI=true bunx vitest run packages/backend      # http-options.test.ts (trimmed) — Commit 1
#   ↑ ל-packages/backend אין `test` script פר-חבילה — הטסטים רצים מה-root דרך vitest (בדוק חי, אל תנחש).
bun run typecheck                              # root — backend+frontend, exit 0 (ה-FE type-trim חייב לקמפל נקי)
bun run lint:i18n                              # אין מחרוזות-עברית בקוד (מחרוזות-לוג/הערות באנגלית; הערות-עברית קיימות מותרות)
```
> **baseline pre-existing** (environmental, לא רגרסיה שלך — אל תתקן/תחקור): `formatting` · `https-serve` (נתיב-bun קשיח
> ל-Windows) · typecheck-diagnostics מ-`http-proxy.ts`/`http-tts-capabilities.ts` (@types/bun web-api gap, זהה ב-dev).
> תפוס baseline לפני שינוי (`CI=true bunx vitest run 2>&1 | tail -5`) והשווה מונה אחרי — לא מונה קשיח.
> **הערה**: `http-options` **היה** ב-baseline-האדום (`projects list uses os.tmpdir()`) — ה-slice הזה **מוחק** את הטסט הזה,
> אז הכשל ההוא **נעלם**. זה צפוי ורצוי (פחות אדום), לא רגרסיה.

### Reading list
**must-read**:
- `docs/investigations/2026-07-06-project-wide-bug-review.md` — **§🟠 #4** (מקור-האמת: `execFileSync` + `readdirSync` חוסמים-loop).
- `packages/backend/src/delivery/http-options.ts` — **כל הקובץ** (126 שורות). ה-target המרכזי. שים לב לגבולות:
  - `:14-28` `MODEL_FALLBACKS` · `:30-68` `listOpencodeModels` (`execFileSync` ב-`:32`) · `:79-110` `listProjectDirs`
    (`readdirSync` `:87` · `statSync` `:95`) → **כל אלה נמחקים**.
  - `:75-77` `getHomeDir` → **נשאר חי** (מיוצא; משמש `paths.ts` + טסטים). **אל תמחק/תשנה חתימה.**
  - `:112-125` `registerHttpOptions` → מצטמצם ל-`homeDir` בלבד.
- `packages/backend/tests/http-options.test.ts` — **רשימת ה-cases** (§3 Commit 1 מפרט מה נמחק/נשאר). ה-`getHomeDir` describe (`:167`) **נשאר**.
- `packages/backend/src/paths.ts` — **:3,:7** צורך `getHomeDir` → **חייב להישאר עובד** (regression-guard).
- `packages/frontend/src/lib/adapters/options.ts` — **:10-14** `ServerOptions` type · **:19-23** `fetchServerOptions`. ה-target של Commit 2.
- `packages/frontend/src/routes/+page.svelte` — **:41** `cwd = opts.homeDir` (הצרכן היחיד #1). `packages/frontend/src/lib/components/modals/FolderPickerDialog.svelte` — **:61** `start = opts.homeDir` (הצרכן היחיד #2). **שניהם קוראים רק `homeDir`.**

**reference**:
- `docs/decisions/drive-coding.md` — 2026-07-05 (`claude-executable-from-specs`): `ServerOptions.models` **כבר סומן dead-code**
  ("אף צרכן FE") — ה-slice הזה מבצע את המחיקה שנדחתה שם.

## §1 — מטרה

**להסיר את ה-event-loop-blocker של `/api/options` על-ידי מחיקת העבודה היקרה שאיש לא צורך** — לא לְקַשׁ אותה.

היום `GET /api/options` מחשב **סינכרונית בכל בקשה** שלושה שדות:
1. `models` — `execFileSync("opencode",["models"],{timeout:5000})` → **חוסם את ה-event-loop עד 5 שניות**.
2. `projects` — `readdirSync`+`statSync` על 3 שורשים (`$HOME/projects`, `$HOME`, `os.tmpdir()`) → 50–300ms (יותר על FS איטי).
3. `homeDir` — `process.env.HOME || … || os.homedir()` → <1ms.

**חקירה חיה (2026-07-10) הוכיחה**: ה-FE צורך **רק `homeDir`** (שני צרכנים: default-cwd + folder-picker-start).
`models` ו-`projects` הם **payload מת — 0 קוראים** (ה-dropdown של המודלים משתמש ב-`session.models` מה-ACP החי;
התיקיות-האחרונות מגיעות מ-`/api/projects` הנפרד — לא מכאן). ה-endpoint נורה ב-`+page.svelte` onMount **בטעינת מסך-הפתיחה**
→ כל טעינת-מסך משלמת את ה-`execFileSync` היקר על תוצאה שנזרקת.

אחרי ה-slice: `/api/options` מחזיר `{ homeDir }` בלבד. **ה-blocker נעלם לגמרי** (לא נדחה ל-cache), פחות קוד, **אפס-שינוי-התנהגות ב-FE**.

> ⚠️ **מה ה-slice הזה עושה — ומה לא**:
> - ✅ מוחק את `listOpencodeModels` (`execFileSync`) + `listProjectDirs` (`readdirSync`/`statSync`) + `MODEL_FALLBACKS` המת.
> - ✅ מצמצם את תגובת `/api/options` ל-`{ homeDir }`; מצמצם את `ServerOptions` ב-FE בהתאם.
> - ❌ **אינו** מוסיף cache/async (התוכנית הישנה `options-async-cache` — מיותרת אחרי המחיקה).
> - ❌ **אינו** משנה שם endpoint / route (`/api/options` נשאר; ר' §8 Q1 — שם-legacy מתועד, לא scope creep).
> - ❌ **אינו** נוגע ב-`getHomeDir` (נשאר מיוצא — `paths.ts` תלוי בו) ולא ב-`/api/projects` (נפרד).

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| מחיקת `listOpencodeModels` + `MODEL_FALLBACKS` + `listProjectDirs` מ-`http-options.ts` | ✅ | Commit 1 |
| ניקוי imports מיותמים (`execFileSync`, `existsSync/readdirSync/statSync`, `path`, `validateCwd`) | ✅ | Commit 1 |
| `registerHttpOptions` → `c.json({ homeDir: getHomeDir() })` בלבד | ✅ | Commit 1 |
| עדכון `http-options.test.ts` — מחיקת cases של models/projects, שמירת homeDir + getHomeDir | ✅ | Commit 1 |
| שמירת `getHomeDir` מיוצא (חתימה זהה) — regression-guard ל-`paths.ts` | ✅ | Commit 1 |
| `ServerOptions` type → `{ homeDir: string }` (מחיקת `models`, `projects`) | ✅ | Commit 2 |
| **הוספת cache/async** (התוכנית הישנה) | ❌ | מיותר — המחיקה פותרת את #4 בשורש |
| שינוי שם endpoint / route (`/api/options` → `/api/home`) | ❌ | §8 Q1 — legacy-name מתועד |
| נגיעה ב-`getHomeDir` / `/api/projects` / `session.models` | ❌ | מחוץ-scope |

## §3 — Commits

### Commit 1 — backend: trim `/api/options` ל-homeDir-בלבד (approach: **integration test על ה-endpoint**)
**קבצים**: `packages/backend/src/delivery/http-options.ts` · `packages/backend/tests/http-options.test.ts`

**`http-options.ts` — אחרי הצמצום** (הקובץ כולו מצטמצם ל-~רבע):
```ts
import * as os from "node:os"

/**
 * getHomeDir: env (HOME/USERPROFILE) קודם, ואז os.homedir() כ-fallback.
 * `||` (לא `??`) — HOME="" ריק נופל ל-fallback ולא מוחזר כמחרוזת ריקה.
 */
export function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir()
}

/**
 * GET /api/options — מחזיר { homeDir } בלבד.
 * homeDir משמש את ה-FE ל-default של שדה cwd (connect page) ול-start של folder-picker.
 * (היסטורי: החזיר גם models+projects — נמחקו 2026-07-10, היו dead payload שחסם את ה-event-loop
 *  דרך execFileSync("opencode models") + readdirSync. ר' decisions/drive-coding.md.)
 */
export function registerHttpOptions(app: Hono): void {
  app.get("/api/options", (c) => c.json({ homeDir: getHomeDir() }))
}
```
> ⚠️ **imports**: השאר **רק** `os` (ל-`getHomeDir`) ו-`type { Hono }`. **מחק**: `execFileSync` (node:child_process),
> `existsSync/readdirSync/statSync` (node:fs), `path` (node:path), `validateCwd` (@drive-coding/core) — כולם התייתמו.
> typecheck (`verbatimModuleSyntax`/strict) ייכשל על import לא-בשימוש — ודא ניקוי מלא.

**testing (integration)** — עדכון `http-options.test.ts`:
- **מחק** את ה-cases שנשענים על models/projects (כל אלה חוקרים קוד שנמחק):
  `:36` models-keys · `:51` opencode-fallback · `:63` claude-fallback · `:72` projects-array · `:88` projects-cap ·
  `:113` `projects list uses os.tmpdir()` (**זה ה-baseline-האדום — נעלם, טוב**) · `:125` projects-validateCwd · `:147` opencode-prefixes.
- **עדכן** `:26` `"returns 200 + { models, projects }"` → `it("returns 200 + { homeDir } only")`:
  ```ts
  const res = await app.request("/api/options")
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(typeof body.homeDir).toBe("string")
  expect(body.homeDir.length).toBeGreaterThan(0)
  // regression-guard: העבודה היקרה נמחקה — אין יותר models/projects על ה-wire
  expect(body.models).toBeUndefined()
  expect(body.projects).toBeUndefined()
  ```
- **שמור** `:96` homeDir-field · `:138` homeDir=os.homedir · `:167` `describe("getHomeDir")` (2 cases).
- **⚠️ ניקוי mock מיותם (חובה — אחרת typecheck/lint על symbol לא-בשימוש)**: אחרי מחיקת ה-cases של opencode,
  ה-mock של `child_process` מתייתם. מחק במפורש:
  - **`:5-10`** — כל block ה-`vi.mock("node:child_process", …)` + `const execFileSyncMock = vi.fn()` (`:7`).
  - **כל שימוש שאריתי ב-`execFileSyncMock`** ב-cases שנשמרו וב-`beforeEach` (למשל `execFileSyncMock.mockReturnValue("")` /
    `.mockClear()`) — הסר. אם `beforeEach` **רק** איפס את ה-mock → מחק גם אותו; אם הוא עושה `vi.stubEnv`/reset אחר → השאר.
  - **וודא ש-`vi` עדיין נצרך** (כן — `vi.stubEnv` ב-`describe("getHomeDir")`) → **אל תמחק** את `vi` מ-import השורה `:3`.
    בדוק גם `beforeEach`/`describe`/`expect`/`it` — מחק מה-import רק את מה שבאמת התייתם.
- **`:2`** — `import * as path from "node:path"` **כבר יתום** (pre-existing, 0 `path.` בטסט) → מחק אותו תוך-כדי הניקוי.
- **`:1`** — `import * as os` **נשאר** (נצרך ב-`:138` `os.homedir()`).

### Commit 2 — frontend: צמצום `ServerOptions` type (approach: **typecheck-gate, none**)
**קובץ**: `packages/frontend/src/lib/adapters/options.ts`

```ts
export type ServerOptions = {
  homeDir: string
}
```
(מחק `models` + `projects` מה-type. `fetchServerOptions` נשאר **ללא שינוי** — עדיין `fetch(beUrl("/api/options"))` →
`res.json()`.) שני הצרכנים (`+page.svelte:41`, `FolderPickerDialog.svelte:61`) קוראים **רק `opts.homeDir`** → מקמפלים נקי,
**אפס שינוי-התנהגות**.

**testing (none)**: אין לוגיקה חדשה — הגייט הוא `bun run typecheck` (strict-TS מוודא שאף צרכן לא נשען על השדות שנמחקו).

## §4 — DoD

| בדיקה | איך |
|---|---|
| **חי: `/api/options` מחזיר `{homeDir}` בלבד** | הרם BE (OneCLI, `:4000`), `curl -s localhost:4000/api/options` → `{"homeDir":"/home/…"}`, **בלי** `models`/`projects` |
| **חי: ה-blocker נעלם (עדות דרך diag-harness)** | הרם `watch.mjs` (ר' `scripts/watch.mjs`), ואז hammer: `for i in $(seq 1 30); do curl -s localhost:4000/api/options >/dev/null; done` → ה-`/api/diag` `eventLoop.maxMs` **נשאר נמוך** (לפני התיקון: spike של עשרות–מאות ms על ה-`execFileSync`/`readdirSync`; אחרי: שטוח). זו העדות ש-#4 מת. |
| **חי: FE לא נשבר** | preview build (per `docs/running-locally.md`) → מסך-הפתיחה נטען, שדה ה-cwd מקבל default (homeDir), folder-picker נפתח ב-homeDir |
| **integration: endpoint test** | `http-options.test.ts` (trimmed) ירוק — כולל regression-guard ש-`models`/`projects` `undefined` |
| **regression: getHomeDir + paths** | `describe("getHomeDir")` ירוק; `paths.test.ts` ירוק (`getHomeDir` עדיין עובד) |
| **אפס רגרסיה כללית** | כל טסטי backend+frontend מול baseline; **מונה-האדום קטן ב-1** (טסט ה-`os.tmpdir` נמחק) — ודא שזו הסיבה, לא כשל חדש |
| build-gate | `bun run typecheck` exit 0 (backend+frontend) · `bun run lint:i18n` עובר |

## §5 — Risks

| סיכון | מיטיגציה |
|---|---|
| import מיותם שנשאר → typecheck נכשל (`verbatimModuleSyntax`) | §3 מפרט בדיוק מה למחוק (`execFileSync`/fs/`path`/`validateCwd`) ומה להשאיר (`os`); ה-typecheck-gate תופס |
| `getHomeDir` נשבר בטעות → `paths.ts` (config dir) קורס | §2/§3 מסמנים "שמור חתימה"; DoD כולל `paths.test.ts` + `getHomeDir` describe |
| טסט/מוק שמניח `child_process` (למשל `tls.test.ts:19` "getHomeDir uses execFileSync") | ההערה ההיא **מיושנת** (getHomeDir לא משתמש ב-execFileSync — זה היה ב-listOpencodeModels). אחרי המחיקה, מוק-ל-`child_process` ב-`tls.test.ts` הופך ל-no-op בלתי-מזיק. **אל תמחק את המוק** (הוא בטסט אחר, ייתכן שנצרך שם ל-import-side-effects) — רק ודא שהטסט עדיין ירוק. **nice-to-have (0 דק', לא חוסם)**: תקן את ה**הערה** ב-`tls.test.ts:19` כך שלא תטען יותר ש-getHomeDir קורא execFileSync (למשל: "mock child_process — http-options module import used to pull it in"). |
| צרכן-FE נסתר של `models`/`projects` (deployed/future) שהחקירה פספסה | החקירה כיסתה `opts.models`/`opts.projects`/`options.*` בכל `packages/frontend/src` → **0 hits**; `session.models` (ה-dropdown) הוא מקור אחר לגמרי. הסיכון שאריתי — DoD כולל preview-חי שמאמת שהמסך עובד |
| מישהו יצפה בעתיד לקטלוג-מודלים מ-`/api/options` | §8 Q1 + decisions: קטלוג-מודלים אמיתי, אם יידרש, יבוא כ-endpoint **on-demand נפרד** (לא eager במסך-הפתיחה) |

## §6 — Escalation triggers

- אם typecheck נכשל אחרי הצמצום על **צרכן-FE** שקורא `opts.models`/`opts.projects` (כלומר החקירה פספסה צרכן) → **עצור**,
  תעד את הצרכן ושאל מרדכי (ההנחה המרכזית של ה-slice קרסה — אולי צריך async-cache במקום trim).
- אם הסרת `models`/`projects` שוברת טסט **מחוץ** ל-`http-options.test.ts` → תעד, שאל (ייתכן צרכן-BE נסתר).
- אם ה-`execFileSync` בכלל לא היה חוסם ב-repro (למשל opencode לא-מותקן → fallback מיידי) → זה **בסדר**; ה-`readdirSync` וה-eager-fetch עדיין מוצדקים למחיקה. תעד ובצע.

## §7 — Complexity score

3/10: 2 קבצי-מקור (backend×1 + frontend×1) + טסט אחד. **מחיקה ברובה** (מוריד קוד, לא מוסיף) → blast-radius קטן;
ה-FE type-trim מגובה ב-typecheck; אין לוגיקה חדשה, אין FE-visual מעבר ל-preview-smoke, אין E2E. חוצה-חבילות רק שֵם-endpoint
(חוזה קבוע, לא לוגיקה משותפת). **verifier: light (calev)** — ה-DoD המרכזי (`/api/diag` שטוח תחת hammer) ממוקד ומדיד.

## §8 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | ה-endpoint נקרא `/api/options` אבל מחזיר רק `homeDir` — לשנות שם ל-`/api/home`? | **לא בסלייס הזה** — שינוי-שם מרחיב blast-radius (route + FE adapter + imports) בלי תועלת. `/api/options` נשאר; ה-שם legacy מתועד ב-decisions. קטלוג עתידי = endpoint on-demand נפרד. | ❌ |
| 2 | למחוק את קובץ ה-adapter `options.ts` ולהחליף ב-`fetchHomeDir`? | **לא** — שמירת `fetchServerOptions`/`ServerOptions` = מינימום-שינוי; שני הצרכנים כבר מחווטים אליו. שינוי-שם = רעש. | ❌ |
| 3 | להעביר `homeDir` לתוך `/api/projects` ולבטל endpoint שלם? | **לא** — coupling מיותר + עוד שינוי-FE; ה-trim לבד כבר מסיר את כל העלות. אם ירצו איחוד-endpoints בעתיד — slice נפרד. | ❌ |

## §9 — יחס לסלייסים אחרים

| ממצא/סלייס | יחס |
|---|---|
| **#4** (`/api/options` חוסם-loop) | **נפתר כאן — במחיקה, לא ב-cache.** התוכנית הישנה `options-async-cache` **מבוטלת** (מיותר לְקַשׁ עבודה מתה). |
| `be-crash-hardening` / `be-diag-harness` | base-של-השרשרת (baking). **אין חפיפת-קוד** (§0). diag-harness = ה-עיניים שמודדות את התיקון (§4). |
| הסרת רשימת-הסשנים במסך-הפתיחה (מוזג 2026-06-28) | **אותו anti-pattern** (עבודה יקרה במסך-הפתיחה שלא-נחוצה). ה-slice הזה מנקה מופע נוסף שנשאר. |
| `ServerOptions.models` dead-code (decisions 2026-07-05) | ה-slice מבצע את המחיקה שסומנה-ונדחתה שם. |

**סדר-מיזוג בשרשרת**: be-crash-hardening → be-diag-harness → **options-trim** (`--no-ff`, אחד-אחד, אחרי אישור-משתמשת).
