# Slice offline-page — דף fallback למצב לא-מקוון — בריף

> **תאריך**: 2026-07-10
> **סוג מסמך**: בריף ביצועי לסלייס
> **סטטוס**: מאושר לתכנון / ממתין לביצוע
> **אימות אביגיל**: READY (סבב 2; דוח לא נכתב בגלל sandbox)
> **Dispatch**: מותר לאליעזר רק אם `אימות אביגיל = READY`; אחרת זה בריף לא-גמור.
> **Complexity**: 4/10 (verifier: calev light)
> **תלויות (`depends_on`)**: []
> **Base**: `dev`
> **Dev tip**: `6d99dcbf5e3750f637a0549e7658a1e0dbe39be7`
> **Source branch**: `origin/feat/offline-page`

---

## §0 — Pre-flight

### תלויות

slice זה מבוסס ישירות על `dev`; אין תלויות ב-slices אחרים.

יש ענף מקור קיים, `origin/feat/offline-page`, שמכיל את רוב המימוש:
- `packages/frontend/src/service-worker.ts`
- `packages/frontend/static/offline.html`
- רשומת `docs/walkthrough.md`

הענף מבוסס על `dev` ישן. נכון ל-dev tip של הבריף, מיזוג נאיבי יוצר conflict ב-`docs/walkthrough.md`.

### Worktree

```bash
cd /home/user/Projects/drive-coding/dev
git worktree add ../.worktrees/offline-page-fix -b slice/offline-page dev
cd ../.worktrees/offline-page-fix
git cherry-pick db302adb
```

לא לבצע cherry-pick של קומיט ה-walkthrough (`a029fc57`) כפי שהוא; הוא מתנגש עם `dev` ומכיל משפט שכבר לא נכון ("מקומי בלבד"). כתוב רשומת walkthrough חדשה/מתוקנת כחלק מהסלייס.

### איך להריץ

בסביבה הזו `pnpm` לא זמין, אבל `bun` זמין. לכן verification של הסלייס משתמש ב-Bun:

```bash
bun run --filter @drive-coding/frontend typecheck
bun run --filter @drive-coding/frontend build
bun run lint:i18n
git diff --check dev...HEAD
```

אם עובדים בסביבה עם `pnpm`, מותר להריץ את המקבילות דרך `pnpm`; תעד בפלט הביצוע באיזה package manager השתמשת.

### Browser

אימות ידני דרך Chrome/DevTools:
1. פתח production build או preview מקומי.
2. טען את האפליקציה פעם אחת אונליין כדי שה-service worker יותקן ויקדים-מטמון את `/offline.html`.
3. ב-DevTools עבור ל-Network offline.
4. בצע navigation חדש לאפליקציה.
5. ודא שמופיע דף ה-offline ולא error page של הדפדפן.

### OneCLI agent

לא רלוונטי לסלייס הזה. אין BE, אין proxy, אין TTS/STT, ואין צורך בהרצת OneCLI.

### Reading list

must-read:
- `AGENTS.md` — stack, פקודות, טקס preview/merge, כללי worktree.
- `packages/frontend/AGENTS.md` — גבולות frontend ו-i18n.
- `packages/frontend/svelte.config.js` — adapter-static + fallback.
- `packages/frontend/src/app.html` — כדי לוודא שאין service worker אחר או head conflict.
- `docs/plans/archive/slice-pwa-installable.md` — ההחלטה הישנה ש-PWA installable היה ללא offline.
- `docs/decisions/voice-acp.md` §2026-06-04 — הרציונל הישן "בלי service worker".

reference:
- תיעוד SvelteKit service workers: `src/service-worker` נבנה ונרשם אוטומטית; `$service-worker.version` מיועד לשמות cache.

---

## §1 — מטרה

משתמש שפתח את drive-coding לפחות פעם אחת אונליין יקבל דף fallback ברור בעברית כאשר הוא מנסה לנווט לאפליקציה בלי חיבור רשת. הדף לא מנסה להפעיל את האפליקציה במצב offline מלא, לא מטמן app shell, ולא מסתיר את העובדה שהמוצר עדיין תלוי ב-WS/TTS/STT אונליין.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| `src/service-worker.ts` שמקדים-מטמון רק `/offline.html` | ✅ | בסלייס הזה |
| `static/offline.html` עצמאי, ללא assets חיצוניים | ✅ | בסלייס הזה |
| intercept רק ל-navigation שנכשל ברשת | ✅ | בסלייס הזה |
| ניקוי Cache Storage מוגבל ל-`offline-*` בלבד | ✅ | בסלייס הזה |
| תיקון/סנכרון walkthrough מול `dev` | ✅ | בסלייס הזה |
| app-shell offline מלא | ❌ | מחוץ ל-scope |
| caching של JS/CSS/assets/API responses | ❌ | מחוץ ל-scope |
| שינוי manifest / install prompt / icons | ❌ | מחוץ ל-scope |
| שינוי BE/OneCLI/proxy | ❌ | מחוץ ל-scope |

---

## §3 — Architecture diagram

```text
Browser navigation request
        |
        v
SvelteKit service worker                 חדש: packages/frontend/src/service-worker.ts
        |
        +-- fetch(request) succeeds ----> network response, no caching of app shell
        |
        +-- fetch(request) throws ------> Cache Storage: offline-${version}
                                               |
                                               v
                                      /offline.html
                                      חדש: packages/frontend/static/offline.html

Cache lifecycle:
install   -> cache.add("/offline.html")
activate  -> delete only old caches with prefix "offline-"
fetch     -> handle only GET navigation requests
```

---

## §4 — Commits בסדר

### Commit 0 — קיבוע offline fallback מתוך הענף הקיים (approach: manual)

**קבצים חדשים**:
- `packages/frontend/src/service-worker.ts`
- `packages/frontend/static/offline.html`

**מקור**:
- cherry-pick של `db302adb` מ-`origin/feat/offline-page`, או העתקה מדויקת של שני הקבצים מהענף אם cherry-pick מסתבך.

**דרישות התנהגות**:
- service worker מקדים-מטמון רק `OFFLINE_URL = "/offline.html"`.
- אין caching של app shell, assets, API responses או WS.
- fetch handler מטפל רק ב-`request.method === "GET"` וגם `request.mode === "navigate"`.
- `offline.html` עצמאי לחלוטין: inline CSS, inline SVG, ללא CSS/JS/פונט/תמונה חיצוניים.

**Verification**:

```bash
git diff --check dev...HEAD
bun run --filter @drive-coding/frontend typecheck
```

### Commit 1 — הגבלת ניקוי Cache Storage ל-offline caches בלבד (approach: manual)

**קבצים שמשתנים**:
- `packages/frontend/src/service-worker.ts`

**שינוי מדויק**:

ב-`activate`, לא למחוק כל cache שאינו `CACHE`. למחוק רק caches שה-service worker הזה יצר:

```ts
keys.filter((k) => k.startsWith("offline-") && k !== CACHE)
```

הערת הקוד צריכה להיות מדויקת: "Drop previous offline caches", לא ניסוח שמרמז על מחיקת כל caches של ה-origin.

**למה**:
`caches.keys()` מחזיר את כל Cache Storage buckets של אותו origin. מחיקה ללא prefix עלולה למחוק caches עתידיים/אחרים כמו app assets או API caches אם יתווספו בהמשך.

**Verification**:

```bash
bun run --filter @drive-coding/frontend typecheck
bun run --filter @drive-coding/frontend build
```

### Commit 2 — walkthrough + אימות build artifacts (approach: manual)

**קבצים שמשתנים**:
- `docs/walkthrough.md`

**דרישות**:
- להוסיף רשומת walkthrough חדשה בראש הקובץ או לשלב את הרשומה מהענף כך שלא תדרוס את הרשומות החדשות של `dev`.
- לא להשאיר את המשפט "הבראנץ' מקומי בלבד, לא נדחף ל-origin" כי `feat/offline-page` כבר קיים ב-origin.
- לציין שבוצע תיקון cache cleanup scoped ל-`offline-*`.
- לציין את תוצאות הבדיקות בפועל ואת package manager ששימש (`bun` או `pnpm`).

**בדיקת artifacts**:

אחרי build, ודא שהקבצים קיימים ב-output:

```bash
test -f packages/frontend/build/offline.html
find packages/frontend/build -maxdepth 2 -type f | grep -E 'service-worker|offline'
```

אם `FE_BUILD_OUT` משנה יעד build, השתמש ביעד המתאים ותעד אותו.

**Verification**:

```bash
bun run lint:i18n
git diff --check dev...HEAD
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|---|---|
| 1 | Typecheck frontend עובר | `bun run --filter @drive-coding/frontend typecheck` |
| 2 | Build frontend עובר | `bun run --filter @drive-coding/frontend build` |
| 3 | i18n lint עובר | `bun run lint:i18n` |
| 4 | אין whitespace/conflict artifacts | `git diff --check dev...HEAD` |
| 5 | `offline.html` נכלל ב-build | `test -f packages/frontend/build/offline.html` |
| 6 | service worker נבנה | `find packages/frontend/build -maxdepth 2 -type f | grep -E 'service-worker'` |
| 7 | cache cleanup לא מוחק caches זרים | קוד מכיל `startsWith("offline-") && k !== CACHE` |
| 8 | fallback עובד ידנית | Chrome DevTools: load online -> Network offline -> navigation -> דף offline מוצג |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| מחיקת caches שלא שייכים לפיצ'ר | `caches.keys()` הוא origin-wide | לסנן רק `offline-*` |
| service worker ייצור תחושה שהאפליקציה עובדת offline | המוצר תלוי WS/TTS/STT | לא לטמון app shell/assets; להציג רק דף שגיאה ידידותי |
| hardcoded Hebrew | `offline.html` סטטי בעברית | מותר כחריג: asset עצמאי ללא app JS/i18n; לא להוסיף עברית ל-`.ts`/`.svelte` |
| stale app אחרי deploy | service workers נוטים לגרום caching אגרסיבי | לא cache app shell; רק `/offline.html` |
| בדיקה ידנית לא משקפת התקנה ראשונה | service worker חייב להירשם לפני offline | DoD דורש load אונליין לפני מצב offline |
| ענף ישן מול `dev` | `feat/offline-page` נפתח לפני slash/agnostic changes | לעבוד מ-`dev` חדש ול-cherry-pick רק הקוד הנדרש |

---

## §7 — Escalation triggers

- אם `bun run --filter @drive-coding/frontend build` נכשל בגלל בעיות שאינן קשורות לשני קבצי הסלייס.
- אם SvelteKit לא מייצר service worker artifact למרות `src/service-worker.ts`.
- אם צריך לשנות `svelte.config.js`, manifest, app shell caching, או routing כדי לגרום לזה לעבוד.
- אם האימות הידני מראה שהדף לא נטען offline אחרי service worker activation.
- אם יש רצון להפוך את האפליקציה ל-offline-capable מעבר לדף fallback.

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|---|---:|
| Service worker / async browser lifecycle | +2 |
| Cache Storage / persistent browser state | +2 |
| Frontend static artifact only | -1 |
| אין BE / אין protocol / אין state machine אפליקטיבי | -1 |
| בדיקה ידנית נדרשת בדפדפן | +2 |

**Score**: 4/10

**Tier**: `calev light`.

**Verifier-phase אחרי commit/phase**: לא נדרש. מספיק runtime-gate בסוף הסלייס.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | האם לעשות version bump כ-minor או patch במיזוג? | minor, כי זו יכולת frontend חדשה | ❌ |
| 2 | האם להוסיף בדיקת Playwright אוטומטית ל-offline navigation? | לא בסלייס הזה; ידני מספיק | ❌ |
| 3 | האם לעדכן decision שמבטל את ההחלטה הישנה "אין offline/SW"? | כן, אם הסלייס עובר ומיועד למיזוג | ❌ |

---

## סטיות מהתכנון

- 2026-07-11 — אביגיל סבב 1 החזירה `USABLE-AFTER-FIX`: נתיב ה-worktree ב-state לא תאם לפקודת ה-worktree ב-brief.
- 2026-07-11 — מרדכי תיקן `worktree` ב-`docs/plans/slice-offline-page.state.json` ל-`../.worktrees/offline-page-fix`.
- 2026-07-11 — אביגיל סבב 2 החזירה `READY`, findings: 0. דוח לא נכתב בגלל מגבלת sandbox.
