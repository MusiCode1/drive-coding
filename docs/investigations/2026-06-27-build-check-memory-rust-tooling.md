# זיכרון ב-build/typecheck וכלי Rust חלופיים — מדידה על drive-coding

> **תאריך:** 2026-06-27 · **סוג:** מחקר/ממצאים (לא תוכנית-מימוש)
> **הקשר:** מדי פעם נגמר זיכרון RAM בקונטיינר שמריץ את ה-CLI (agents שמריצים
> `build`/`typecheck` במקביל בכמה worktrees). השערה ראשונית: כלי JS/Svelte זוללים
> זיכרון. נבחנו שני חלופים מבוססי-Rust ל-`svelte-check`
> ([`svelte-check-rs`](https://github.com/pheuter/svelte-check-rs),
> [`svelte-check-native`](https://github.com/harshmandan/svelte-check-native))
> ו-build מבוסס-Rust דרך [`rolldown-vite`](https://voidzero.dev/posts/announcing-vite-plus-alpha)
> (מנוע Vite 8).
> **שורה תחתונה:** הזולל הגדול ביותר הוא **`vite build` (1.38GB), לא ה-checker.**
> שני ה-Rust checkers מהירים פי 28–77 וקלים בזיכרון, **אבל שניהם מייצרים
> false-positives על הקודבייס הזה** ולא בשלים להחליף את ה-gate. `rolldown-vite`
> עובד כ-drop-in וחוסך ~21% RAM ב-build. הפתרון המיידי ל-OOM הוא הגבלת concurrency
> + `--max-old-space-size`, ולא החלפת כלים.

---

## 1. תנאי המדידה

- סביבה: Windows 11, Node v25.8.1, ענף `dev`, `packages/frontend`.
- Stack בפועל: Vite 6, Svelte 5, SvelteKit 2.8, svelte-check 4, Tailwind 4, pnpm@10.
- **peak RAM = working-set של כל עץ התהליכים** (כולל ה-child של tsgo/rolldown),
  בדגימה כל 40ms דרך `Win32_Process` רקורסיבי — לא רק התהליך הראשי. זה המספר
  הרלוונטי ל-OOM בקונטיינר.
- כל ה-checkers הורצו עם אותו `--tsconfig ./tsconfig.json` אחרי `svelte-kit sync`.
- הכלים הותקנו זמנית (pnpm) והוסרו אחרי המדידה; הפרויקט הוחזר למצבו (vite 6.4.2,
  אין שינויים tracked).

## 2. תוצאות

| כלי | זמן | peak RAM | קבצים שנסרקו | שגיאות שדווחו | מול baseline |
|---|---|---|---|---|---|
| **svelte-check** (baseline) | 193.7s | 738MB | 5008 | 0 | הרפרנס |
| **svelte-check-rs** 0.10.1 | 6.7s | 551MB | (4) | **14** | 14 false-positives |
| **svelte-check-native** 0.9.5 | 2.5s | 298MB | **36** | **3** | 3 false-positives + סרק subset |
| **vite build** (Vite 6.4) | 57.9s | **1380MB** | — | — | baseline build |
| **vite build** (rolldown-vite 7.3.1) | 52.6s | **1094MB** | — | — | build תקין, **−21% RAM** |

## 3. ניתוח — ה-checkers

### 3.1 svelte-check-native (Rust + tsgo)
- מהיר פי **77** וצורך **40%** מהזיכרון של ה-baseline — מרשים על הנייר.
- **אבל סרק 36 קבצים בלבד מתוך 5008** — הוא לא בודק את כל ה-program closure, ולכן
  אינו שקול ל-baseline. רוב החיסכון בזמן/זיכרון נובע מכך שהוא עושה הרבה פחות עבודה.
- דיווח 3 שגיאות `implicit any` על קוד תקין:
  `getKey={(b) => b.id}` ב-`ChatBubbles.svelte:40`. הוא לא הצליח לפתור את הטיפוס
  הגנרי של קומפוננטת `Virtualizer` (מ-`virtua`), והפרמטר נפל ל-`any`.
  ה-baseline מאשר את אותו קוד עם 0 שגיאות → **false-positive**.

### 3.2 svelte-check-rs (Rust + tsgo)
- מהיר פי **28**, RAM נמוך מעט מה-baseline.
- מייצר **14 false-positives** ממנגנון ה-overlay-cache: הוא מעתיק קבצים ל-
  `node_modules/.cache/svelte-check-rs/<hash>/` ואז אותו טיפוס (`Settings`) נחשב
  "לא תואם לעצמו" כי הוא נפתר משני נתיבים שונים (ts2322).

### 3.3 מסקנה על ה-checkers
שניהם **drop-in למחצה**: מצוינים כ-fast-feedback מקומי, אך אף אחד מהם אינו
byte-identical ל-`svelte-check` על הקוד שלנו, ולכן **לא בשלים להחליף את ה-gate**
(`pnpm typecheck`). נקודה חשובה: שניהם נשענים על **tsgo** (`@typescript/native-preview`)
לבדיקת הטיפוסים — החיסכון בזיכרון מקורו ב-tsgo (זריקת tsc מ-Node heap), לא ב-Rust עצמו.

## 4. ניתוח — ה-build (החשוד המרכזי ל-OOM)

- `vite build` הוא הזולל הגדול ביותר: **1.38GB peak**, ~פי 2 מ-`svelte-check`.
- בקונטיינר שמריץ כמה worktrees/agents במקביל: שני builds ≈ 2.7GB,
  build+check ≈ 2.1GB → **OOM**. זה ההסבר הסביר ל"מדי פעם נגמר זיכרון".
- **`rolldown-vite` (מנוע Vite 8) עובד כ-drop-in** דרך `pnpm.overrides`:
  ```jsonc
  // dev/package.json
  "pnpm": { "overrides": { "vite": "npm:rolldown-vite@latest" } }
  ```
  ה-build עבר (exit 0, output תקין) והוריד את ה-RAM ל-**1094MB (−21%)**.
- אזהרות לא-קריטיות: `Invalid output options ... "codeSplitting"` — אי-תאימות
  מינורית של `@sveltejs/vite-plugin-svelte@5` עם ה-API החדש. תנוקה כששדרגים את
  ה-plugin לגרסה שתומכת Vite 7/8.

## 5. המלצות (לפי עלות/תועלת)

1. **הכי זול, לעשות קודם — מגביל את ה-OOM ישירות:** לוודא ש-yetro/eliezer
   **לא מריצים שני `build`/`typecheck` במקביל** באותו קונטיינר, ולהגדיר
   `NODE_OPTIONS=--max-old-space-size=2048`. סביר שזה לבדו פותר את הבעיה.
2. **build:** מעבר ל-`rolldown-vite` (override) → −21% RAM מיידי, build תקין.
   זו הדרך הבטוחה ל-Rust build היום; Vite 8 מלא כש-`vite-plugin-svelte` יבשיל.
   קשור לפריט F בroadmap ("בילד FE בלי ריסטארט" / single-binary).
3. **check:** להשאיר את `svelte-check` כ-gate (בגלל ה-false-positives של החלופים),
   ולכל היותר להוסיף `svelte-check-rs`/`-native` כ-pre-check מהיר מקומי בלבד.

## 6. שחזור / מתודולוגיה

המדידה בוצעה עם helper PowerShell (`Start-Process -PassThru` + polling רקורסיבי של
`Win32_Process` לפי `ParentProcessId`, peak של סכום ה-`WorkingSet64`). הכלים הותקנו
זמנית דרך `pnpm add -D` (ה-workspace הוא pnpm — npm נכשל על `workspace:*`), והוסרו
ב-`git checkout` + `pnpm install`. אין שאריות בקוד או ב-tracked files.
