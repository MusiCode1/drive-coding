# פרסום גרסה חדשה ל-npm

תהליך ידני — מהמחשב המקומי, אין CI אוטומטי.

## ⚠️ תמיד מהתיקייה הזו

גם `package.json` בשורש המונו-רפו וגם זה שכאן נקראים `"drive-coding"`. הרצת
`npm publish` משורש המונו-רפו תארוז את **כל עץ המקורות** (docs/, כל packages/*/src,
walkthrough) במקום את ה-bundle הבנוי — ה-`files` whitelist קיים רק כאן.

**תמיד `cd packages/release` לפני `npm publish`.**

## Checklist

1. **Bump גרסה** לפי convention קיים — מעדכן 3 קבצים יחד (root, `packages/frontend`,
   `packages/release`):
   ```bash
   node scripts/bump-version.mjs <patch|minor|major> [pkg...]
   git commit -am "chore(release): vX.Y.Z"
   ```
2. **Build נקי**: `cd packages/release && node scripts/build.mjs` (רץ גם אוטומטית
   כ-`prepack`). מוודא ש-`dist/drive-coding.js` נוצר, בלי sourcemap שדלף (יש
   guard מובנה שנכשל בקול אם זה קורה).
3. **בדיקת תוכן**: `npm pack --dry-run` — לוודא שהרשימה מכילה `dist/drive-coding.js`,
   `plugins/*`, `frontend-dist/*`, `README*.md`, `LICENSE` — **לא** מאות קבצי
   `.ts`/`.svelte`/`docs/*.md` (סימן שרצת מהתיקייה הלא-נכונה).
4. **בדיקה פונקציונלית**: `bun dist/drive-coding.js --port <פנוי>` ולוודא שהשרת
   עולה ומגיש UI תקין (`curl localhost:<port>`).
5. **`npm login`** אם עדיין לא מחובר (`npm whoami` לבדיקה).
6. **`npm publish --access public`** — מתוך `packages/release` בלבד.
7. **אימות אחרי פרסום**: `npm view drive-coding version` מחזיר את הגרסה החדשה.
   בדיקה חד-פעמית מלאה: `bunx drive-coding@latest --version` בתיקייה זמנית
   מחוץ למונו-רפו.
8. **Git tag**: `git tag vX.Y.Z && git push origin vX.Y.Z`.

---

## ⚠️ שני ה-builds מוחקים את `dist/` זה של זה

`scripts/build.mjs` ו-`scripts/build-binary.mjs` שניהם מריצים
`rmSync(releaseDist, { recursive: true })` בתחילתם.
⇒ **כל build מוחק את התוצר של האחר.**

### הסדר המחייב: בנדל קודם, בינארי אחריו

```bash
cd packages/release

# 1. בנה את הבנדל (dist/drive-coding.js) ופרסם ל-npm
node scripts/build.mjs
npm publish --access public          # dist/drive-coding.js קיים כאן

# 2. רק אחרי npm publish — בנה את הבינארי (מוחק את dist/ ובונה מחדש)
node scripts/build-binary.mjs
./dist/drive-coding --version        # צריך להחזיר את הגרסה מ-package.json
```

**אסור לבנות בינארי לפני `npm publish`** — זה ימחק את `dist/drive-coding.js`
שה-`files` whitelist מצפה לו, ו-`npm publish` יכשל (או יפרסם חבילה ריקה).
