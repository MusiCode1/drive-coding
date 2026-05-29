# Slice 15d — Cloudflare Pages Deployment — תוכנית

> **‏תאריך**: 2026-05-29
> **‏סטטוס**: ‏מאושר — ‏פאזה 4 ‏מתוך 4 ‏של slice 15 (CF deployment family)
> **‏Complexity**: 3/10 (verifier: ‏אין — ‏נכלל ב-verifier-slice-light הכולל בסוף slice 15)
> **‏תלות**: 15a (CORS env var), 15b (Settings.beUrl), 15c (adapter migration ל-beUrl)
> **‏מתבסס על**: `docs/plans/EXECUTOR_DISPATCH.md`, `packages/frontend/AGENTS.md`

---

## §0 — Pre-flight

‏⚠️ **‏אתה ה-executor** — ‏אל תdelegate ל-sub-agent מסוג executor. ‏ראה `EXECUTOR_DISPATCH.md §0`.

‏רץ באותו worktree של 15a/b/c: `.worktrees/slice-15-cf-deployment/`. ‏לפני שמתחילים, ‏וודא ש-15a + 15b + 15c כבר ב-commits ‏בbranch הזה.

‏Reading list (must-read, ~‎10 ‏דק'):

‏- `packages/frontend/svelte.config.js` — ‏כבר `adapter-static` ‏עם `pages: "build", assets: "build", fallback: "index.html"` (SPA mode — ‏מתאים ל-Pages). ‏ה-output dir ‏הוא `build/`.
‏- `packages/frontend/package.json` — ‏`build` script = `vite build`, ‏package name `@drive-coding/frontend-v2`.
‏- `packages/frontend/vite.config.ts` — ‏ה-proxy ל-`/api`, `/proxy`, `/ws` (dev-only, ‏לא משפיע על build)
‏- `packages/backend/src/delivery/cors-config.ts` — ‏מ-15a, ‏ה-`CORS_ORIGINS` ‏parser
‏- `packages/frontend/src/lib/view-models/settings.svelte.ts` — `Settings.beUrl` ‏מ-15b/15c

‏**‏הערת שמות**: `@drive-coding/frontend-v2` ‏הוא ה-npm package scope; `drive-coding` ‏הוא ה-CF Pages project name. ‏שניהם נכונים — ‏לא להתבלבל.

---

## §1 — מטרה

‏מודל הפריסה: **‏"bring your own backend"**.

‏- ה-FE ‏נבנה כ-static SPA ‏ונפרס ל-**Cloudflare Pages** ‏תחת ה-domain הדיפולטי `drive-coding.pages.dev` (‏לא subdomain של example.com, ‏לא DNS/tunnel config).
‏- ה-BE ‏נשאר **‏מקומי לחלוטין** (`localhost:4000`), ‏לא נחשף לאינטרנט בסבב הזה.
‏- ‏כל משתמש שרוצה לחבר BE ‏מקליד את ה-URL ‏שלו ב-`/settings` (‏התשתית שנבנתה ב-15b/15c). ‏עבור ה-developer: `http://localhost:4000` ‏עובד מהדפדפן המקומי בלבד.

‏החוויה: ‏אחרי 15d, ‏הפקודה `pnpm --filter @drive-coding/frontend-v2 build` ‏מייצרת `build/` ‏שניתן לפרוס ל-CF Pages; ‏הוראות הפריסה מתועדות; ‏וה-BE ‏המקומי, ‏כשמריצים אותו עם `CORS_ORIGINS=https://drive-coding.pages.dev,http://localhost:5173`, ‏מאשר קריאות cross-origin מה-FE ‏המפורס.

‏**הבהרה חשובה (‏תיעוד בלבד, ‏לא מימוש)**: ‏ה-FE ‏הציבורי ב-`pages.dev` ‏לא יוכל להגיע ל-`localhost:4000` ‏של אף אחד מלבד מי שמריץ את ה-BE ‏על אותו מחשב שבו פתוח הדפדפן. ‏וגם אז — ‏ראה §3.6 (Private Network Access). ‏זה תרחיש מודע. ‏חשיפת BE לאינטרנט = ‏slice עתידי.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
‏| ‏וידוא ש-`pnpm --filter @drive-coding/frontend-v2 build` ‏עובד ‏ומפיק SPA static | ✅ | Commit 1 |
‏| ‏תיעוד פריסה (`docs/deploy-cf-pages.md`) — ‏build dir, ‏פקודות wrangler/dashboard | ✅ | Commit 1 |
‏| `wrangler.toml` ‏ל-CF Pages | ⚠️ ‏אופציונלי | Commit 1 — ‏ראה §3.5 ‏לפני שיוצרים |
‏| ‏עדכון `CORS_ORIGINS` ‏המקומי לכלול `https://drive-coding.pages.dev` (‏תיעוד הרצה) | ✅ | Commit 2 |
‏| ‏Walkthrough entry ‏של slice 15 ‏הכולל (15a-d) | ✅ | Commit 3 |
‏| ‏עדכון status ‏ב-`packages/frontend/docs/slices.md` ‏ו-בbriefs (15a-d) | ✅ | Commit 3 |
‏| ‏פריסה בפועל ל-CF (push ל-Cloudflare) | ❌ | ‏Tama ‏מבצעת ידנית / ‏מאשרת — ‏לא executor |
‏| ‏חשיפת BE לאינטרנט (tunnel/DNS) | ❌ | ‏slice עתידי |
‏| ‏subdomain תחת example.com | ❌ | ‏לא בסבב הזה (‏default pages.dev) |

---

## §3 — Architecture

```
‏build:
  pnpm --filter @drive-coding/frontend-v2 build
    → vite build → adapter-static (fallback: index.html)
    → packages/frontend/build/   (static SPA)

‏deploy (‏ידני ‏ע"י Tama, ‏מתועד ‏ב-docs/deploy-cf-pages.md):
  npx wrangler pages deploy packages/frontend/build --project-name=drive-coding
    → https://drive-coding.pages.dev

‏runtime:
  Browser (drive-coding.pages.dev)
    → Settings.beUrl = "http://localhost:4000"   (‏המשתמש מקליד)
    → fetch beUrl("/api/...")  (‏מ-15c)
    → BE ‏מקומי (localhost:4000) ‏עם CORS_ORIGINS שכולל drive-coding.pages.dev
    → ‏(‏ראה §3.6 — ‏מגבלת Private Network Access)
```

‏אין שינוי קוד ב-FE/BE ‏לוגי בסבב הזה — ‏רק build verification, ‏תיעוד, ‏ועדכון מתועד ל-`CORS_ORIGINS`. ‏(`wrangler.toml` — ‏ראה §3.5, ‏אופציונלי.)

### §3.5 — `wrangler.toml`: ‏אופציונלי, ‏ולמה

‏ל-**Direct Upload** (‏הגישה כאן — ‏executor/Tama ‏מפעילים `wrangler pages deploy <dir>` ‏ידנית, ‏בלי Git integration) — **‏אין צורך ב-`wrangler.toml` כלל**. ‏הפקודה מקבלת את הdir ‏ואת ה-project name ‏מ-CLI flags.

‏ה-key `pages_build_output_dir` ‏רלוונטי בעיקר ל-**Git-integrated / CI flow** ‏(CF ‏בונה מ-repo). ‏אם מוסיפים `wrangler.toml` ‏עם ה-key הזה, CF ‏עלול לנעול את ה-build configuration ‏ל-config-as-code ‏ולמנוע עריכה ב-dashboard, ‏ודורש wrangler ≥3.45.

‏**החלטה לbrief**: ‏בסבב הזה **‏לא** ‏יוצרים `wrangler.toml`. ‏ה-deploy ‏הוא Direct Upload ‏ידני, ‏מתועד ב-`docs/deploy-cf-pages.md`. ‏אם בעתיד נרצה Git integration — ‏slice ‏נפרד שיוסיף את הקובץ ‏עם ההסבר. ‏(אם ה-executor ‏בכל זאת רואה צורך — Escalation, ‏לא להחליט לבד.)

### §3.6 — מגבלה: Private Network Access (PNA) + mixed-content

‏FE ‏על HTTPS (`drive-coding.pages.dev`) ‏שמנסה לקרוא ל-`http://localhost:4000`:

‏1. **Mixed-content**: ‏HTTPS→HTTP ‏נחסם כברירת מחדל; ‏חלק מהדפדפנים מאפשרים override ‏ב-site settings.
‏2. **Private Network Access (PNA / CORS-RFC1918)**: ‏Chrome 94+ ‏חוסם אקטיבית בקשות מ-public origin ל-`localhost`/LAN ‏גם כש-mixed-content ‏אושר. ‏זו החסימה הכבדה יותר. ‏דורש header `Access-Control-Allow-Private-Network: true` ‏מה-BE ‏בתשובת ה-preflight.

‏שתי המגבלות מתועדות ב-`docs/deploy-cf-pages.md`. ‏הטיפול בהן (BE ‏מחזיר PNA header, ‏או חשיפת BE ‏דרך HTTPS) — **‏slice עתידי**, ‏מחוץ ל-scope. ‏ה-deliverable של 15d ‏הוא ה-deploy ‏עצמו + ‏התיעוד, ‏לא חיבור FE↔BE ‏ציבורי עובד.

---

## §4 — Commits

### Commit 1: docs(deploy): CF Pages deploy guide + build verification

‏**Approach**: manual (‏build artifact + docs — ‏אין logic לtest)

‏**קבצים**:
‏- ‏חדש: `docs/deploy-cf-pages.md`

‏**מה לעשות**:

‏1. ‏הרץ `pnpm --filter @drive-coding/frontend-v2 build` ‏וודא הצלחה. ‏אם נכשל — ‏זה Escalation (build שבור = ‏רגרסיה מ-15a-c, ‏לא scope של deploy).
‏2. ‏אמת ש-`packages/frontend/build/index.html` ‏קיים ‏וש-`build/` ‏מכיל את ה-assets.
‏3. ‏כתוב `docs/deploy-cf-pages.md` (‏ראה §5 ‏לתוכן). ‏**‏אל תיצור `wrangler.toml`** (‏§3.5).

‏**Verify**:
```bash
pnpm --filter @drive-coding/frontend-v2 build
test -f packages/frontend/build/index.html && echo OK
```

‏**DoD**:
‏- [ ] build ‏מצליח ‏ומפיק `build/index.html`
‏- [ ] `docs/deploy-cf-pages.md` ‏קיים ‏ומלא
‏- [ ] ‏אין `wrangler.toml` ‏חדש

---

### Commit 2: docs(backend): CORS for CF Pages origin

‏**Approach**: manual (‏תיעוד + ‏אימות ידני ב-curl)

‏**מה לעשות**:

‏ה-`CORS_ORIGINS` parser ‏מ-15a ‏כבר תומך ברשימה. ‏אין שינוי קוד ב-`cors-config.ts`. ‏הסבב הזה:

‏1. ‏תעד ב-`AGENTS.md` (root, §Ports ‏או §Backend) + ‏ב-`docs/deploy-cf-pages.md` ‏את פקודת ההרצה המומלצת של ה-BE ‏המקומי כשעובדים מול ה-FE ‏המפורס:

```bash
CORS_ORIGINS="https://drive-coding.pages.dev,http://localhost:5173" \
  PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts
```

‏2. ‏אימות ידני (‏הפעל BE ‏זמני על 4002 ‏עם ה-env): ‏הרץ preflight curl ‏וודא ‏שה-origin מאושר:

```bash
CORS_ORIGINS="https://drive-coding.pages.dev,http://localhost:5173" PORT=4002 \
  onecli run --agent voice-acp -- bun --watch src/server.ts &
sleep 3
curl -sI -X OPTIONS http://localhost:4002/api/agents \
  -H "Origin: https://drive-coding.pages.dev" \
  -H "Access-Control-Request-Method: GET" 2>&1 | grep -i "access-control"
# ‏ציפייה: access-control-allow-origin: https://drive-coding.pages.dev
```

‏3. ‏תעד את תוצאת ה-curl ‏ב-commit message.

‏**DoD**:
‏- [ ] ‏פקודת הרצה מתועדת ב-AGENTS.md + deploy doc
‏- [ ] curl preflight ‏מחזיר את ה-Allow-Origin ‏הנכון (‏מתועד ב-commit msg)

---

### Commit 3: docs: slice 15 walkthrough + status

‏**Approach**: none (docs/status)

‏**מה לעשות**:

‏1. ‏Walkthrough entry ‏אחד ‏שמסכם את כל slice 15 (15a CORS env, 15b Settings page, 15c adapter migration, 15d CF Pages deploy). ‏השתמש ב-skill `update-walkthrough` ‏אם קיים `docs/walkthrough.md`.
‏2. ‏עדכן status ל-✅/Done ‏ב-`packages/frontend/docs/slices.md` ‏עבור slice 15.
‏3. ‏עדכן את ה-`> **‏סטטוס**` ‏ב-‏ראש כל אחד מ-4 ה-briefs (15a-d) ‏ל-"‏בוצע".

‏> **‏הערה**: ‏אם 15c ‏כבר עדכן walkthrough/slices.md/status (‏בדוק `git log` ‏של ה-branch) — ‏אל תכפיל. ‏השלם רק את מה שחסר (‏בעיקר 15d ‏עצמו).

‏**DoD**:
‏- [ ] walkthrough ‏מעודכן (‏ללא כפילות)
‏- [ ] slices.md ‏מעודכן
‏- [ ] 4 briefs ‏סטטוס מעודכן

---

## §5 — `docs/deploy-cf-pages.md` ‏תוכן נדרש

‏המסמך חייב לכלול:

‏1. **‏Build**: `pnpm --filter @drive-coding/frontend-v2 build` → ‏output ב-`packages/frontend/build/`.
‏2. **‏Deploy ‏אופציה A (wrangler Direct Upload — ‏מומלץ)**:
   ```bash
   npx wrangler pages deploy packages/frontend/build --project-name=drive-coding
   ```
   ‏(‏אם ה-project טרם נוצר — ‏wrangler ‏יציע ליצור אותו אינטראקטיבית, ‏או ‏ליצור מראש ב-dashboard.)
‏3. **‏Deploy ‏אופציה B (CF dashboard / Git integration)**: ‏build command `pnpm --filter @drive-coding/frontend-v2 build`, ‏output dir `packages/frontend/build`, ‏root dir `/` (monorepo root). ‏(‏זה ה-flow ‏שבו `wrangler.toml` ‏יהיה רלוונטי — ‏slice עתידי.)
‏4. **‏URL**: `https://drive-coding.pages.dev`.
‏5. **‏מודל BYO-backend**: ‏הסבר ש-FE ‏ציבורי + BE ‏מקומי, ‏המשתמש מקליד BE URL ‏ב-`/settings`, ‏ושזה עובד רק כשה-BE ‏נגיש מהדפדפן (‏localhost ‏באותו מחשב).
‏6. **‏CORS**: ‏פקודת ההרצה של ה-BE ‏עם `CORS_ORIGINS=https://drive-coding.pages.dev,http://localhost:5173`.
‏7. **‏מגבלות ידועות (‏§3.6)**:
   ‏- ‏Mixed-content: ‏HTTPS FE → HTTP localhost BE ‏חסום בחלק מהדפדפנים.
   ‏- ‏Private Network Access (Chrome 94+): ‏חוסם public→localhost ‏גם אחרי mixed-content override; ‏דורש `Access-Control-Allow-Private-Network: true` ‏מה-BE.
   ‏- ‏הטיפול = ‏slice עתידי (BE ‏מחזיר PNA header ‏או חשיפת BE ‏ב-HTTPS).

---

## §6 — Risks

| ‏סיכון | ‏הסתברות | ‏מיטיגציה |
|---|---|---|
‏| `adapter-static` ‏fallback לא יוצר SPA תקין ל-Pages | ‏נמוך (`fallback: index.html` ‏כבר מוגדר) | ‏אם routing נשבר — ‏Pages ‏מגיש index.html ל-404; ‏מתועד ב-deploy doc |
‏| ‏HTTPS FE → HTTP localhost BE ‏חסום (mixed-content + PNA) | ‏גבוה | ‏מתועד כמגבלה ידועה (§3.6). ‏לא חוסם את ה-slice — ‏ה-deliverable הוא ה-deploy + ‏התיעוד |
‏| executor ‏יוצר `wrangler.toml` ‏מיותר שנועל dashboard config | ‏בינוני | ‏§3.5 ‏אומר במפורש לא ליצור; DoD Commit 1 ‏בודק שאין |
‏| build ‏שבור ‏בגלל 15c | ‏בינוני | ‏אם build נכשל — Escalation (‏רגרסיה, ‏לא scope) |
‏| ‏duplicate walkthrough ‏אם 15c ‏כבר עדכן | ‏בינוני | Commit 3 ‏הערה: ‏בדוק git log, ‏אל תכפיל |

---

## §7 — Escalation triggers

‏רק ‏אם:
‏- `pnpm build` ‏של ה-FE ‏נכשל (‏רגרסיה מ-15a-c, ‏לא scope של deploy)
‏- ‏`adapter-static` ‏מייצר output ‏שלא תואם ל-SPA (‏צריך adapter ‏אחר — ‏החלטה ארכיטקטונית)
‏- ‏נראה צורך ב-`wrangler.toml` / Git integration כדי שה-slice ‏יהיה useful (‏מחוץ ל-scope — ‏שאל את Tama)
‏- ‏צריך לחשוף BE ‏לאינטרנט כדי שה-slice ‏יהיה useful (‏מחוץ ל-scope — ‏שאל את Tama)

---

## §8 — Definition of Done (slice 15d)

‏- [ ] `pnpm --filter @drive-coding/frontend-v2 build` ‏מצליח ‏ומפיק `build/index.html`
‏- [ ] ‏אין `wrangler.toml` ‏חדש (‏§3.5)
‏- [ ] `docs/deploy-cf-pages.md` ‏מלא ‏עם build/deploy/CORS/limitations (‏כולל PNA)
‏- [ ] `CORS_ORIGINS` ‏עם `https://drive-coding.pages.dev` ‏מתועד ‏ואומת ב-curl
‏- [ ] walkthrough + slices.md + 4 briefs status ‏מעודכנים (‏ללא כפילות מ-15c)
‏- [ ] typecheck + lint:i18n clean (‏validation על 15c, ‏אין קוד חדש ב-15d)
‏- [ ] ‏פריסה בפועל **‏לא** ‏בוצעה ע"י executor (‏Tama ‏מבצעת/‏מאשרת)
