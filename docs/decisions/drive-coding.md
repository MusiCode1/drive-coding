# Decisions — drive-coding

## 2026-06-16 — slice-npm-publish: אריזה ל-npm כ-tarball self-contained

### רציונל

המשך ישיר ל-slice-bunx-single-command (depends_on). המטרה: `bunx drive-coding`
מ-npm. הבדיקה הראתה ששני deps לא יושבים ב-registry — `@drive-coding/core` (workspace,
private, exports ל-`src/*.ts`) ו-`provider-contract` (git dep, 404 ב-npm, אבל בנוי עם
`dist/`). ההכרעה: **`bundledDependencies`** לשניהם — נארזים פנימה ל-tarball, בלי לפרסם
אותם בנפרד ובלי לדרוש git מהמשתמש הקצה.

ה-package המתפרסם = `packages/backend` ששמו משתנה ל-`drive-coding` (כבר מחזיק את ה-bin
ואת כל ה-runtime deps; אביגיל אימתה שאף אחד לא תלוי ב-`@drive-coding/backend` כ-import).
ה-FE build מועתק לתוך החבילה ב-`prepack` (`frontend-dist/`), וה-bin בוחר בין dev-path
ל-packaged-path לפי קיום הקובץ.

**Scope עד tarball שמתקין ורץ מקומית** — `npm publish` ל-registry הוא הצעד האנושי האחרון
(credentials + שם + אישור), מחוץ ל-slice.

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX (5 findings, 2 🔴). הקריטי (#1): `bundledDependencies` אורז את
**קבצי** core אבל לא את עץ ה-deps שלו — core מייבא `pino`/`pino-pretty`/`marked` שלא
מוצהרים ב-backend → התקנה נקייה קורסת ב-boot עם `Cannot find module 'pino'`, וזה נראה
מטעה כמו בעיית symlink. #2: ה-base branch (התלות) עדיין לא קיים. #4: `npm pack` מסרב
לארוז `private` bundledDependency. r2 = READY (נותר רק ה-gate התזמוני המתועד).

### שינויי-כיוון

- **הכרזת transitive deps על פני bundling רקורסיבי:** `pino`/`pino-pretty`/`marked`
  הוכרזו כ-`dependencies` של ה-package (מותקנים מ-registry), במקום לנסות לבנדל את כל
  עץ ה-deps של core. פשוט יותר ועמיד.
- **core הופך packable** (הסרת `private`, version 0.1.0) — בלי לפרסמו בנפרד.
- **gate תזמוני מפורש** ב-§0: ה-slice לא מתחיל לפני שה-branch של התלות קיים או נמרג ל-dev.

### רעיונות שנדחו

- **פרסום `@drive-coding/core` ו-`provider-contract` כ-packages נפרדים ל-npm:** "נכון"
  ל-monorepo אבל דורש תיאום-גרסאות ופרסום של 3 packages. נדחה לטובת bundledDependencies
  (חבילה אחת self-contained).
- **`npm publish` בתוך ה-slice:** נדחה — צעד אנושי אחרון אחרי merge.

## 2026-06-16 — slice-bunx-single-command: הרצה בפקודה אחת דרך bunx

> **2026-06-17 — מוזג ל-dev** (merge commit `ea7726f`, `--no-ff`). כלב: GO (light, 0 findings).
> מרדכי אימת runtime נוסף מעבר ל-DoD: `bun link` חשף את ה-`bin` כ-`drive-coding` גלובלי,
> הרצה מ-`/tmp` כפקודה עירומה → HTTP 200 + FE + API. אומת גם ש-`FE_STATIC_DIR ??=`
> מכבד env מפורש על פני ה-default (env precedence) כפי שתוכנן. אישור מיזוג מפורש מהמשתמשת.

### רציונל

המשתמש ביקש להריץ את הפרויקט "מ-npx בפקודה אחת". הפרויקט הוא monorepo (pnpm) עם
backend (Hono), frontend (SvelteKit/adapter-static), ו-core. הבדיקה הראתה ש**הבעיה
אינה ה-runtime** אלא אריזה: ה-backend כבר משתמש ב-`@hono/node-server` (אין `Bun.serve`
בקוד — ה-comment בטסט התיישן) ויודע להגיש את ה-FE הבנוי דרך `FE_STATIC_DIR` (single-origin).
מה שחסר: `bin` entry שמחבר את שני אלה בפקודה אחת.

**ההכרעה: `bunx` — לא Node, לא bundling.** שלוש עובדות הכריעו:
1. `tsconfig.base.json` עם `moduleResolution: "Bundler"` — הקוד מתוכנן ל-Bun/bundler,
   לא ל-`tsc → node`.
2. ה-plugin `packages/backend/plugins/prompt-injector.ts` **חייב להישאר .ts נגיש
   ב-runtime** — OpenCode טוען אותו דרך `file://` באמצעות Bun. bundling היה שובר אותו.
3. production (Dockerfile, systemd) כבר רץ עם Bun.

bunx מריץ את ה-TS ישירות כמו production — אפס מרחק בין dev ל-prod, ואפס עבודת bundling.

**Scope מצומצם בכוונה (JIT):** ה-slice הזה הוא ה-**mechanism** המקומי בלבד —
`bin/drive-coding.ts` שמגדיר `FE_STATIC_DIR`+`PORT` ומייבא את server.ts, launcher
שבונה FE אם חסר, ו-preflight. **פרסום ל-npm בפועל** (הסרת `private`, פתרון
`@drive-coding/core` workspace + `provider-contract` git dependency, `prepublishOnly`)
נדחה ל-slice המשך נפרד (`slice-npm-publish`), כדי ללמוד מה-mechanism לפני ה-publish.

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX (4 findings). כל ההנחות הארכיטקטוניות הקריטיות אומתו — במיוחד
ש-`server.ts` הוא **self-starting on-import** (אין `startServer()`; `serve()` ב-top-level),
שעליה נשען כל ה-API skeleton. שני פערי-אימות אמיתיים: (1) `bin/` מחוץ ל-`src/` היה גורם
ל-`pnpm typecheck` לדלג עליו בשקט (false-positive ל-DoD); (3) פקודות האימות היו bash-only
בעוד סביבת ה-dev היא Windows/PowerShell. r2 = READY, 0 findings.

### שינויי-כיוון

לפי ממצא #1 — ה-bin הועבר מ-`packages/backend/bin/` אל **`packages/backend/src/bin/`**,
כך שהוא נכלל אוטומטית ב-`include: ["src/**/*"]` ו-typecheck מכסה גם אותו וגם את ה-`import`,
**בלי לגעת ב-`rootDir`/`outDir`**. זה עדיף על הרחבת ה-tsconfig (שהיתה משנה מבנה output).
כל פקודות האימות הומרו ל-PowerShell.

### רעיונות שנדחו

- **bundling ל-JS יחיד (node-compatible):** היה מאפשר `npx` על Node טהור ומעלים את ה-git/
  workspace deps — אבל שובר את טעינת ה-plugin דרך `file://` ומנוגד ל-`moduleResolution: Bundler`
  ולכל ה-production stack שרץ Bun. נדחה לטובת bunx.
- **פרסום ל-npm בתוך ה-slice הזה:** נדחה ל-slice נפרד (JIT — לא לבנות publish לפני
  שה-mechanism עובד ונבדק).

## 2026-06-18 — slice-release-package: package נפרד מבונדל ל-bunx (החליף את slice-npm-publish)

### רציונל

המטרה: `bunx drive-coding` עובד מהתקנה נקייה מ-npm. הדרך לשם התבררה רק אחרי
שלוש גישות שנפלו אחת-אחת באימות אמפירי (spikes):

1. **`bundledDependencies` (slice-npm-publish, נזרק):** ארז את core+provider-contract
   כקבצים בתוך ה-tarball. **עובד עם npm, נשבר עם bun** — `bun add`/`bunx` מתעלמים משדה
   `bundledDependencies` ומנסים לפתור מחדש את ה-specs המקוריים: `@drive-coding/core@workspace:*`
   (לא קיים מחוץ ל-monorepo) ו-`provider-contract@git+...` (repo **פרטי** → 404 ל-bun הלא-מאומת).
   מאחר שה-headline הוא `bunx`, זו חסימה.
2. **devDependencies:** הרעיון — להוציא את core/provider-contract מ-`dependencies` כדי ש-bun
   לא ינסה לפתור. אבל `bundledDependencies` **חייב להיות תת-קבוצה של `dependencies`** — npm
   הפסיק לארוז אותם (457→89 קבצים), וה-runtime קרס `Cannot find module @drive-coding/core`.
3. **git URL ציבורי / auth:** bun **יודע** git+https; ה-404 הוא כי ה-repo פרטי. אבל חבילה
   ציבורית לא יכולה לתלות ב-repo פרטי, ו-`workspace:*` של core אין לו git URL בכלל.

**ההכרעה: package נפרד `packages/release/` שמבונדל בזמן build.** `bun build` של ה-bin
מטמיע (inline) את core+provider-contract לתוך JS אחד → הם **נעלמים מגרף התלויות** → אין
מה לפתור, לא משנה איזה installer. external רק ל-`pino`/`pino-pretty` (worker-thread, לא
ניתנים ל-bundling — נשארים deps ציבוריים ש-bun פותר). ה-packages הקיימים
(backend/core/provider-contract) **לא נגעו** — נשארים workspace/git/private (זמני, יהפכו
ל-public בעתיד). זה היפוך מודע של ההחלטה של slice-bunx ("no bundling") — שתי הסיבות שלה
פגו: (א) אומת שה-plugin (`file://` ע"י תהליך opencode נפרד) **לא** מבונדל ולכן לא נשבר;
(ב) `bundledDependencies` ⊥ bun הוכח אמפירית. בחירת המשתמשת: package נפרד על-פני עריכת
ה-monorepo "הזמני".

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX (4 findings). שני 🔴 חשובים: (#1) ה-brief תיאר את ה-bin של
slice-npm-publish (dual-layout) במקום את ה-bin האמיתי של dev (single-line) — ה-spike
רץ על הבסיס הלא-נכון; (#2) ה-script `build` היה נתפס ע"י `pnpm -r run build` ומפעיל
build כבד לא-מכוון. תוקנו: ה-script שונה ל-`bundle`, וה-Commit עודכן ל-bin האמיתי
(single-line + הוספת `existsSync`). r2 = READY, 0 findings.

### שינויי-כיוון

- **הנגיעה היחידה ב-backend**: ה-FE cascade ב-`src/bin/drive-coding.ts` שונה ל-2-candidate
  (`../frontend-dist` ל-bundle, `../../../frontend/build` ל-dev) — שיפור path-resolution
  כללי, לא מחיקת תלויות. אומת לשני ה-layouts.
- **guard ל--sourcemap**: התגלה באג ב-bun 1.3.14 — `bun build --sourcemap --outfile` מתעלם
  מ-`--outfile` ופולט לתיקיית ה-entry. נוגע רק ל-build של release (לא ל-dev, ששם אין
  bundling). הוגן guard דו-שכבתי: `files` מצומצם ל-`dist/drive-coding.js` בלבד + assertion
  ב-build.mjs שמפיל את ה-build אם `.map` מופיע או אם הבאנדל חסר. מאומת ששתי השכבות תופסות.

### רעיונות שנדחו

- **`bundledDependencies` (slice-npm-publish):** נזרק — ⊥ bun (ראה רציונל). ה-worktree
  וה-branch נמחקו (לא merged).
- **bundling בתוך backend (טיוטת slice-bundle-single-artifact):** היה דורש מחיקת deps
  ושכתוב prepack של backend. נדחה לטובת package נפרד — additive, הפיך, בלי לגעת ב-monorepo
  "הזמני" (בקשת המשתמשת).
- **release-own bin shim (אפס נגיעה ב-backend):** היה מונע את הנגיעה ב-bin, אבל משכפל את
  לוגיקת ה-preflight/URL. נדחה — ה-cascade הוא שיפור כללי ובטוח ממילא.
