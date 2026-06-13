# Slice PWA — Installable (Add to Home Screen) — תוכנית

> **תאריך**: 2026-06-04
> **סטטוס**: טיוטה
> **Complexity**: 2/10 (verifier: light)
> **תלות**: אין (depends_on: [])

## §1 — מטרה

המשתמשת פותחת את `https://drive-coding-dev.example.com` בדפדפן הנייד (או דסקטופ),
ומקבלת הצעת "התקן אפליקציה" / "הוסף למסך הבית". אחרי ההתקנה, ה-app נפתח
**fullscreen standalone** — בלי שורת-כתובת של הדפדפן, עם האייקון של drive-coding
על מסך-הבית, צבע-מערכת (status bar / splash) תואם לפלטה ember. זהו הבסיס ל-car mode
על נייד (שימוש hands-free תוך נהיגה). **אין offline** — האפליקציה חיה על חיבור חי
(WS ל-agent, TTS/STT דרך רשת), ולכן service worker לא בתחום ה-slice הזה.

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| `manifest.webmanifest` + icons + meta tags | ✅ | כאן |
| התקנה standalone (Add to Home Screen) | ✅ | כאן |
| favicon | ✅ | כאן |
| **Service Worker / offline / app-shell cache** | ❌ | slice עתידי נפרד (אם בכלל) |
| **Install-prompt UI מותאם** (`beforeinstallprompt` button) | ❌ | slice עתידי — כרגע מסתמכים על ה-UI המובנה של הדפדפן |
| **Media Session ב-lock screen / car mode** | ❌ | slice car-mode (7) — ה-PWA הזה רק *מאפשר* אותו בעתיד |
| **עיצוב לוגו סופי** | ❌ | האייקונים שב-`static/icons/` הם placeholder שנוצר ב-PIL; החלפה עתידית בנכס מעוצב = drop-in (אותם שמות קבצים) |
| **theme-color דינמי לפי palette נבחר** | ❌ | slice עתידי — manifest מחייב צבע יחיד סטטי, נשתמש ב-ember |

## §3 — Architecture diagram

```
static/                          ← כל מה שב-slice הזה הוא static, אין קוד-לוגיקה
├── icons/                       ← כבר קיים (נוצר ב-PIL placeholder)
│   ├── icon-192.png             ✅ קיים
│   ├── icon-512.png             ✅ קיים
│   ├── icon-512-maskable.png    ✅ קיים
│   ├── apple-touch-icon.png     ✅ קיים (180×180)
│   └── favicon-64.png           ✅ קיים
└── manifest.webmanifest         ← חדש (Commit 0)

src/
└── app.html                     ← שינוי (Commit 1): <link rel="manifest"> + meta tags

routes/  view-models/  engines/  adapters/  actions/   ← לא נגעים. אפס קוד-לוגיקה.
```

> ה-slice הזה לא נוגע באף שכבה מה-5. הוא כולו static assets + `<head>` של app.html.
> זו הסיבה ש-complexity = 2.

## §4 — Commits

### Commit 0 — manifest.webmanifest (approach: manual)

**קבצים חדשים**:
- `packages/frontend/static/manifest.webmanifest`

**תוכן מדויק** (להעתיק verbatim):

```json
{
  "name": "drive-coding",
  "short_name": "drive-coding",
  "description": "Voice-first hands-free interface for ACP CLI agents",
  "lang": "he",
  "dir": "rtl",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#16130f",
  "theme_color": "#16130f",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

> **הערות על ערכים**:
> - `background_color` + `theme_color` = `#16130f` = `--bg` של פלטה ember (app.css:20).
> - `display: standalone` — fullscreen בלי address-bar, עם status-bar מערכת.
> - `start_url` + `scope` = `/` — ה-app מוגש מ-root (same-origin דרך BE `FE_STATIC_DIR` או Vite).
> - `lang`/`dir` תואמים ל-app.html (he/rtl).
> - אין `id` מפורש — הדפדפן גוזר מ-`start_url`; מספיק ל-MVP.

**Verification**:
```bash
cd packages/frontend
# JSON תקין:
python3 -c "import json; json.load(open('static/manifest.webmanifest')); print('manifest OK')"
# כל ה-icons שמוזכרים קיימים:
for f in icon-192 icon-512 icon-512-maskable; do test -f static/icons/$f.png && echo "  $f.png OK" || echo "  MISSING $f.png"; done
```

### Commit 1 — קישור manifest + meta tags ב-app.html (approach: manual)

**קבצים שמשתנים**:
- `packages/frontend/src/app.html` — הוספת tags ב-`<head>`, **additive בלבד** (לא נוגעים בקיים)

**מצב נוכחי של `<head>`** (app.html:3-8):
```html
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>drive-coding v2</title>
  %sveltekit.head%
</head>
```

**אחרי** — להוסיף את השורות הבאות **בין** `<title>` ל-`%sveltekit.head%` (לא לגעת בשורות הקיימות):
```html
    <title>drive-coding v2</title>

    <!-- PWA -->
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#16130f" />
    <link rel="icon" href="/icons/favicon-64.png" sizes="64x64" type="image/png" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="drive-coding" />
    <meta name="mobile-web-app-capable" content="yes" />

    %sveltekit.head%
```

> **הערות**:
> - `apple-mobile-web-app-capable` + `apple-mobile-web-app-status-bar-style` — iOS Safari לא קורא display:standalone מה-manifest באופן מלא, צריך את ה-meta הללו לחוויית standalone ב-iOS. זה הקריטי ליעד (car mode על נייד).
> - `black-translucent` — ה-status bar שקוף וה-app נמתח מאחוריו (משתלב עם `viewport-fit=cover` שכבר קיים → אין רצועה לבנה ב-notch).
> - `mobile-web-app-capable` — הגרסה הסטנדרטית (לא-apple) של אותו דבר.
> - אסור לשנות את `lang="he" dir="rtl"` ב-`<html>` (כבר נכון).

**Verification**:
```bash
cd packages/frontend
grep -q 'rel="manifest"' src/app.html && echo "manifest link OK"
grep -q 'apple-touch-icon' src/app.html && echo "apple-touch OK"
grep -q 'apple-mobile-web-app-capable' src/app.html && echo "apple-capable OK"
grep -q 'theme-color' src/app.html && echo "theme-color OK"
# הקיים לא נשבר:
grep -q 'viewport-fit=cover' src/app.html && echo "viewport preserved OK"
pnpm --filter @drive-coding/frontend-v2 build  # build נקי — adapter-static מעתיק static/ ל-build/
test -f build/manifest.webmanifest && echo "manifest in build OK"
test -f build/icons/icon-512.png && echo "icons in build OK"
```

## §5 — DoD

| בדיקה | איך |
|---|---|
| `manifest.webmanifest` JSON תקין | `python3 -c "import json; json.load(open('packages/frontend/static/manifest.webmanifest'))"` exit 0 |
| כל 3 ה-icons שב-manifest קיימים | `ls packages/frontend/static/icons/{icon-192,icon-512,icon-512-maskable}.png` ללא שגיאה |
| app.html מקשר manifest + apple meta | 4 ה-grep מ-Commit 1 מחזירים שורה |
| app.html הקיים לא נשבר | `grep viewport-fit=cover` עדיין מחזיר; `lang="he" dir="rtl"` עדיין שם |
| `build` מכיל את ה-manifest וה-icons | אחרי `pnpm build`: `build/manifest.webmanifest` + `build/icons/icon-512.png` קיימים |
| typecheck נקי | `pnpm --filter @drive-coding/frontend-v2 typecheck` exit 0 |
| lint:i18n נקי | `pnpm lint:i18n` exit 0 (אין מחרוזות עברית בקוד — אין קוד חדש בכלל) |
| **Lighthouse PWA — installable** | בדסקטופ Chrome מול ה-tunnel: DevTools → Application → Manifest מציג name/icons ללא warnings; "Installability" ללא errors |
| **התקנה בפועל** (ידני, calev) | פתיחת ה-tunnel ב-Chrome → סמל "התקן" בשורת-הכתובת → התקנה → ה-app נפתח standalone עם האייקון |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| **manifest לא נטען (404)** כי לא הוגש מ-root | זרימת BE `FE_STATIC_DIR` (server.ts:86-87) | adapter-static מעתיק `static/*` ל-`build/` root; ה-BE `serveStatic({root})` מגיש מ-root. `scope:/` ו-`start_url:/` תואמים. ה-Verification בודק `build/manifest.webmanifest` קיים |
| **`.webmanifest` MIME type** — חלק מהשרתים מגישים כ-`text/plain` | gotcha כללי | `@hono/node-server serve-static` מזהה `.webmanifest` → `application/manifest+json`. אם calev רואה warning ב-DevTools על MIME — escalate (לא לשנות סיומת ל-.json בלי אישור, כי `.webmanifest` הוא הסטנדרט) |
| **iOS לא נכנס standalone** | archive/v1/future-features §14 (הסיבה שהפיצ'ר נדחה) | זו בדיוק הסיבה ל-`apple-mobile-web-app-capable` + `status-bar-style` ב-Commit 1. ב-iOS Safari: "שתף → הוסף למסך הבית". בדיקה אמיתית ב-iOS = nice-to-have, לא חוסם merge (אין מכשיר iOS זמין כרגע — ראה §9) |
| **Hardcoded Hebrew** | pre-commit hook | אין קוד חדש כלל. ה-manifest הוא JSON (לא קוד TS) — ה-lint לא סורק אותו. `name`/`description` באנגלית בכוונה (שם מותג) |
| **Svelte 5 reactivity** | learnings | לא רלוונטי — אין `$state`, אין components חדשים |
| **OneCLI SDK** | learnings | לא רלוונטי — אין קריאות proxy |
| **build מוחק icons** | — | adapter-static מעתיק `static/` as-is. ה-Verification מאמת קיום ב-build |

## §7 — Escalation triggers

עצור ושאל את מרדכי ב-parent task אם:
- DevTools מציג warning על **MIME type** של ה-manifest (אל תשנה סיומת ל-`.json` עצמאית).
- Chrome מסרב להציג "Installability" עם error שלא קשור ל-icons/manifest (למשל דורש HTTPS — ה-tunnel אמור לספק).
- ה-build **לא** מעתיק את `static/icons/` או את ה-manifest ל-`build/` (זה יסמן בעיה ב-adapter-static config שלא ציפינו לה).
- מתברר שצריך service worker כדי ש-Chrome יסמן installable (לא אמור — manifest+icons+https מספיקים ל-`display:standalone`; אם Chrome דורש SW → זה שינוי scope, escalate).

## §8 — Complexity score

- מספר commits: 2 → נמוך
- שכבות חדשות: 0 (static + `<head>` בלבד) → נמוך
- APIs חיצוניים: 0
- Streaming/async: לא
- Refactor state model: לא
- שינוי protocol BE↔FE: לא

**Score: 2/10 → verifier-slice-light.**
ה-light מתאים: אין לוגיקה לבדוק, רק נכסים סטטיים והתקנה בפועל. ה-DoD הקריטי
(installability) נבדק ידנית מול ה-tunnel ב-Chrome DevTools.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | בדיקת iOS אמיתית (Add to Home Screen + standalone) | אין מכשיר iOS זמין כעת. הבדיקה ב-Chrome desktop installability מספיקה ל-merge; iOS = follow-up כשיהיה מכשיר | ❌ |
| 2 | `theme_color` יחיד = ember, גם כשהמשתמשת בוחרת palette אחר | ember (ברירת המחדל). manifest תומך רק בצבע סטטי אחד. dynamic theme-color = slice עתידי | ❌ |
| 3 | האם להוסיף `screenshots` ל-manifest (משפר את חווית ההתקנה ב-Chrome/Android — "rich install UI") | לא ב-slice הזה. דורש צילומי-מסך מעוצבים. follow-up | ❌ |
| 4 | סיומת `.webmanifest` מול `.json` | `.webmanifest` (הסטנדרט הרשמי). אם MIME בעייתי ב-prod → escalate, לא להחליף עצמאית | ❌ |

---

## הערה ל-executor — שם ה-package

⚠️ שם ה-package של ה-FE הוא **`@drive-coding/frontend-v2`** (ראה `package.json:2`),
למרות ששם **התיקייה** הוא `packages/frontend/` ו-AGENTS.md כותב `frontend`.
כל פקודות `pnpm --filter` ב-brief משתמשות ב-`-v2` — **אל תוריד את ה-`-v2`**.
`pnpm --filter @drive-coding/frontend ...` (בלי `-v2`) מחזיר exit 0 בשקט ולא מריץ כלום.

## הערה ל-executor — האייקונים כבר קיימים

האייקונים ב-`packages/frontend/static/icons/` **כבר נוצרו** (placeholder ב-PIL,
קונספט: equalizer קולי מעל נתיב-כביש בפרספקטיבה, פלטה ember). **אל תייצר אותם מחדש
ואל תמחק אותם.** ה-slice רק מוסיף את ה-manifest שמצביע עליהם ואת ה-`<link>`/meta
ב-app.html. אם חסר icon כלשהו מהרשימה — עצור ושאל (לא לייצר עצמאית).
