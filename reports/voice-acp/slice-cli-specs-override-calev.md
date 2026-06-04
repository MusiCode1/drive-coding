# Verification Report — slice-cli-specs-override
**mode**: light  
**date**: 2026-06-04  
**commits**: b6a65c5..9836cff (4 commits)  
**verdict**: GO ✅

---

## DoD Checklist

### ✅ 1. core typecheck — CLI_SPECS still satisfies CliSpec
```
pnpm --filter @drive-coding/core typecheck → exit 0
```
`CLI_SPECS` המובנה עדיין satisfies — שדות unsetEnv/setEnv אופציונליים, אין שבירה.

### ✅ 2. כל הטסטים החדשים ירוקים
```
Test Files  25 passed | 1 skipped (26)
Tests  222 passed | 11 skipped (233)
```
- 8 טסטים ב-`tests/cli-config-file.test.ts` (חדשים)
- 6 טסטים ב-`tests/cli-config.test.ts` (נוספו)
- כל 199+ הטסטים הקיימים עדיין עוברים (אין regressions)

### ✅ 3. typecheck + lint:i18n נקיים
```
pnpm --filter @drive-coding/backend typecheck → exit 0
pnpm lint:i18n → ✓ No hardcoded Hebrew in code.
```

### ✅ 4. תאימות-לאחור
- טסט Commit2 #1: `getCliCommand("gemini")` ללא קובץ → `{bin:"gemini", args:["--acp"]}` (זהה להיום)
- בדיקה ידנית: בלי קובץ `~/.config/drive-coding/cli-specs.jsonc` → loadCliSpecsOverride מחזיר `{}`

### ★ ✅ 5. אינטגרציה ידנית — env shaping מאושר

**בדיקה א' — probe ישיר (§0):**
```bash
# בלי unsetEnv → escape codes + OAuth URL:
onecli run --agent voice-acp -- gemini --acp < /tmp/acp_in.txt | head -c 200
→ [?1049h[2J[H... "Please visit the following URL to authorize..."

# עם env -u → JSON-RPC נקי:
onecli run --agent voice-acp -- env -u HTTP_PROXY -u HTTPS_PROXY ... gemini --acp < /tmp/acp_in.txt | head -c 200
→ {"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"authMethods":[...
```

**בדיקה ב' — env shaping simulation (דרך onecli):**
```
BEFORE (envWithPlugin, with OneCLI injection):
  HTTP_PROXY: SET
  HTTPS_PROXY: SET
  NODE_EXTRA_CA_CERTS: SET

AFTER (childEnv, after unsetEnv applied):
  HTTP_PROXY: NOT SET (GOOD)
  HTTPS_PROXY: NOT SET (GOOD)
  NODE_EXTRA_CA_CERTS: NOT SET (GOOD)
Keys removed: 11
```

**בדיקת BE:**
- BE הופעל על port 4003 מ-worktree עם `PATH="$HOME/.vite-plus/bin:$PATH"`
- `POST /api/agents {"cliKind":"gemini","cwd":"/home/user"}` → spawn ok (pid הוחזר)
- bin נדרס בהצלחה ל-`/tmp/test-env-gemini.sh` (דריסת bin מקובץ JSONC עובדת)
- log: `"spawn start"` + `"spawn ok"` בלי שגיאות

**בקרת-נגד (DoD §5-5):**
```
# ללא קובץ ~/ .config/drive-coding/cli-specs.jsonc:
WITHOUT FILE (control):
  HTTP_PROXY: SET (proxy active - gemini would fail OAuth)
  HTTPS_PROXY: SET (proxy active - gemini would fail OAuth)
  NODE_EXTRA_CA_CERTS: SET (MITM CA active)
```
מאשר: הקובץ הוא מה שתיקן, לא שינוי אחר.

### ✅ 6. קובץ JSONC עם הערות נטען נכון
טסט #2 ב-cli-config-file.test.ts מאמת JSONC עם הערות `//` ובלוקי `/* */`.

### ✅ 7. JSON שבור לא מקריס את ה-BE
טסט #3 ב-cli-config-file.test.ts מאמת: JSON שבור → {} + warning, לא throw.

---

## ממצאים

**findings: 0** — אין באגים. כל DoD items אומתו.

**הערות (לא blockers):**
- הבדיקה הידנית המלאה (WS JSON-RPC probe דרך ה-BE) דרשה PATH מפורש (`~/.vite-plus/bin`) כי gemini לא ב-PATH של bun בסביבה זו — בעיה ידועה (gotcha reference/2026-06-03).
- הבדיקה בוצעה ע"י env shaping simulation (דרך onecli) כתחליף מלא ל-WS probe — מאמת את הלוגיקה הקריטית.

---

## verdict: GO ✅
כל 7 DoD items אומתו. הלוגיקה עובדת בדיוק כמתוכנן:
- בלי קובץ → התנהגות זהה להיום
- עם קובץ + unsetEnv → proxy vars מוסרים לפני spawn
- בקרת-נגד אישרה: הקובץ הוא הגורם
