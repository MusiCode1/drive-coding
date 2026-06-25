# slice-fe-build-decouple — ניתוק בילד-FE מ-restart של הסרוויס

> ‏**סוג**: infra / ops (לא פיצ'ר UI — חמש-השכבות לא רלוונטיות)
> ‏**base**: `dev` (`c28f4e3`) · **depends_on**: `[]` · **Complexity**: 4 → `calev` (mode: light)
> ‏**Planner**: מרדכי · **תאריך**: 2026-06-25

---

## §0 — Pre-flight

### ‏מה הבעיה (context בפסקה)

‏היום, ‏כדי לרענן את ה-FE ‏בפריסה המקומית, ‏מריצים `systemctl --user restart voice-acp-<dev|main>`.
‏ה-`ExecStartPre` ‏של כל unit מריץ `pnpm install --frozen-lockfile && pnpm build`, ‏וה-restart
‏שולח SIGTERM ‏לתהליך ה-bun — ‏מה שמפיל את כל סוכני ה-ACP ‏ש-spawned תחתיו (הם children של
‏ה-BE). ‏כלומר: ‏רענון FE = ‏הרג כל הסוכנים החיים + ‏בילד מלא איטי.

‏**עובדה ארכיטקטונית מאומתת** (server.ts:109-117): ‏ה-BE ‏מגיש את ה-FE ‏מ-`FE_STATIC_DIR`
‏דרך Hono `serveStatic`, ‏שקורא מהדיסק **בכל request** — ‏אין קאש בזיכרון. ‏לכן בילד FE ‏לתוך
‏אותה תיקייה תוך-כדי שה-BE ‏רץ → ‏ה-request הבא מקבל את החדש. ‏אין צורך ב-restart ‏בכלל לשינויי FE.

### ‏המטרה בקצרה

‏שלושה תוצרים:
1. **‏סקריפט בילד-FE** ‏אטומי שאפשר להריץ בזמן שה-BE ‏חי (בלי restart, ‏בלי הרג סוכנים).
2. **‏עדכון קבצי הסרוויס** — ‏להסיר את הבילד הכפוי מ-`ExecStartPre`; ‏להשאיר רשת-ביטחון
   "build-if-missing" ‏בלבד (לבוט/קלון טרי).
3. **‏עדכון הסרוויסים החיים + ‏התיעוד** — ‏נוהל התקנה מחודש + ‏עדכון `deploy-local-service.md`.

### ‏Worktree + ‏איך מריצים

```bash
cd /home/user/projects/drive-coding
git worktree add .worktrees/slice-fe-build-decouple -b slice-fe-build-decouple dev
cd .worktrees/slice-fe-build-decouple
pnpm install && pnpm hooks:install
```

- ‏**שם חבילת ה-FE** (אמת ב-`packages/frontend/package.json`): `@drive-coding/frontend-v2`.
- ‏**בילד FE ידני**: `pnpm --filter @drive-coding/frontend-v2 build` (vite build → `packages/frontend/build/`).
- ‏**אין כאן BE/HTTPS/tunnel לבדיקה** — ‏זו עבודת ops. ‏הבדיקות הן: ‏הרצת הסקריפט,
  ‏בדיקת תוכן `build/`, ‏ו-`systemd-analyze verify` ‏על ה-unit. **‏אין לגעת ב-units החיים** (ראה §7).

### ‏Reading list (priority)

- ‏**must-read לפני**: `deploy/systemd/voice-acp-dev.service` + `deploy/systemd/voice-acp-main.service`
  (שני ה-units — ‏ה-`ExecStartPre`/`ExecStart` ‏המדויקים), `scripts/dc-launch.mjs` (התקדים ל-build-if-missing),
  `docs/deploy-local-service.md` (נוהל ההתקנה).
- ‏**reference**: `packages/frontend/svelte.config.js` (adapter-static), `packages/backend/src/server.ts:106-117`
  (serveStatic), ‏שורש `package.json` (scripts).

> ‏**שים לב** (ממצא אביגיל #1): ‏קיים drop-in `deploy/systemd/voice-acp-dev.service.d/10-logging.conf`
> ‏שמנקה `LOG_WIRE` ‏ופותח לוגים — ‏**אל תיגע בו**, ‏הוא מחוץ ל-scope. ‏השינוי היחיד ב-units הוא שורת
> ‏ה-`ExecStartPre` ‏בשני קבצי ה-`.service` ‏עצמם.

---

## §1 — מטרה (חוויית-המשתמשת)

‏אחרי הסבב: ‏המשתמשת משנה קוד FE, ‏מריצה פקודה אחת (`pnpm fe:build` ‏בתוך ה-worktree של הפריסה)
‏ותוך כמה שניות הדפדפן (אחרי refresh) ‏מציג את החדש — ‏**בלי שאף סוכן ACP ‏חי נהרג**. ‏restart
‏של הסרוויס שמור אך-ורק לשינויי BE. ‏בקלון/בוט טרי, ‏עליית הסרוויס עדיין מבטיחה שיש FE ‏בנוי
‏(build-if-missing), ‏אבל היא לא בונה מחדש סתם בכל restart.

---

## §2 — Scope: מה כן, מה לא

| ‏בכוונה **לא** בסבב | ‏למה / ‏איפה יטופל |
|---|---|
| ‏שינוי `bun src/server.ts` ל-`--watch` | ‏היה גורם ל-restart-on-change → ‏שוב הרג children. ‏BE ‏מתרענן רק ב-restart מפורש. |
| ‏הוספת `Cache-Control: no-cache` ל-index.html | ‏slice נפרד (`slice-cache-headers-version` ‏קיים). ‏כאן רק מתעדים את ההמלצה. |
| ‏Hot-reload / HMR ‏של FE ‏מול הסרוויס | ‏מחוץ ל-scope; ‏ה-flow הוא build-then-refresh. |
| ‏מעבר ל-symlink-based atomic deploy | ‏ראה §9 (open) — ‏ברירת-מחדל: ‏swap בשני `mv`. |
| ‏הסרת `pnpm install --frozen-lockfile` מ-ExecStartPre | ‏נשאר — ‏שינויי תלות BE ‏עדיין נדרשים בעליית הסרוויס. |
| ‏בילד של core/backend (`tsc --build`) כשער-טייפצ'ק בפריסה | ‏ראה §6/§9 — ‏מאבדים את שער-הטייפצ'ק בכוונה; ‏ה-BE ‏רץ מ-src ‏עם bun. |

---

## §3 — ‏רקע ארכיטקטוני (מה הבילד באמת נחוץ בו)

‏`pnpm build` = `pnpm -r run build`. ‏מה כל חבילה מייצרת ‏ומה **‏נדרש בזמן ריצה**:

```
core      → tsc --build → dist/      ❌ לא בשימוש בריצה (exports map → ./src/index.ts; bun רץ מ-src)
backend   → tsc --build → dist/      ❌ לא בשימוש בריצה (ExecStart = bun packages/backend/src/server.ts)
frontend  → vite build  → build/     ✅ נדרש! ה-BE מגיש את זה מ-FE_STATIC_DIR
release   → (אין build script)        — pnpm -r דולג עליו
```

‏מסקנה: ‏התוצר היחיד של `pnpm build` ‏שנדרש לריצת הסרוויס הוא **‏בילד ה-FE**. ‏ה-`tsc --build`
‏של core/backend הם artifacts לטייפצ'ק בלבד (אומת: `packages/core/package.json` exports → `./src/index.ts`;
‏`packages/backend/package.json` start = `bun src/server.ts`). ‏ה-FE build ‏אינו תלוי ב-dist של core —
‏הוא מייבא `@drive-coding/core` ‏ש-vite ‏מתרגם מ-src דרך ה-exports map. ‏לכן build-if-missing ‏של ה-FE
‏לבד מספיק כרשת-ביטחון.

```
[systemctl restart]                         [pnpm fe:build  ← חדש, ידני]
      │                                            │
      ▼                                            ▼
ExecStartPre:                              dc-build-fe.mjs (always)
  pnpm install --frozen-lockfile             1. vite build → .build-staging/
  node scripts/dc-build-fe.mjs --if-missing  2. swap אטומי → packages/frontend/build/
      │  (בונה FE רק אם build/ חסר)                │
      ▼                                            ▼
ExecStart: bun server.ts (children חיים)   ה-BE החי מגיש מיד את build/ המעודכן
```

---

## §4 — Commits בסדר

### Commit 1 — `scripts/dc-build-fe.mjs` (סקריפט הבילד האטומי) + ‏alias

**Approach**: manual (סקריפט ops; ‏אין core logic ל-TDD).

**קובץ חדש**: `scripts/dc-build-fe.mjs`

**מה הוא עושה**:
- ‏פותר את שורש-הריפו מ-`import.meta.dirname` (כמו `dc-launch.mjs`) → ‏עובד בכל worktree (dev/main).
- ‏דגל `--if-missing`: ‏אם `packages/frontend/build/index.html` ‏קיים → ‏`exit 0` ‏בלי לבנות. ‏אחרת בונה.
- ‏בילד לתיקיית-staging דרך env: ‏`FE_BUILD_OUT=packages/frontend/.build-staging` ‏(נתיב יחסי לשורש-FE — ‏ראה Commit 2).
  ‏פקודה: `execFileSync("pnpm", ["--filter", "@drive-coding/frontend-v2", "build"], { env: { ...process.env, FE_BUILD_OUT: ".build-staging" }})`.
- ‏**swap אטומי** ‏אחרי בילד מוצלח בלבד (אם vite נכשל → ‏זורק, ‏build/ ‏הקיים לא נגעים):
  ```
  buildDir   = packages/frontend/build
  stagingDir = packages/frontend/.build-staging
  oldDir     = packages/frontend/.build-old
  // ודא ש-staging/index.html קיים אחרי הבילד, אחרת throw
  rmSync(oldDir, {recursive:true, force:true})
  if (existsSync(buildDir)) renameSync(buildDir, oldDir)   // mv #1 (metadata-only)
  renameSync(stagingDir, buildDir)                          // mv #2 (metadata-only)
  rmSync(oldDir, {recursive:true, force:true})
  ```
  ‏(חלון בין שני ה-`rename` ‏הוא syscall של metadata בלבד — ‏תת-מילישנייה; ‏ראה §9 ‏לחלופת-symlink.)
- ‏stdio `inherit`, ‏הדפסות `[dc-build-fe] ...` ‏ברורות.

**API skeleton** (Node ESM, ‏ללא תלויות חיצוניות):
```js
#!/usr/bin/env node
import { existsSync, renameSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const repoRoot   = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ifMissing  = process.argv.includes("--if-missing")
const feRoot     = path.join(repoRoot, "packages/frontend")
const buildDir   = path.join(feRoot, "build")
const stagingDir = path.join(feRoot, ".build-staging")
const oldDir     = path.join(feRoot, ".build-old")

if (ifMissing && existsSync(path.join(buildDir, "index.html"))) {
  console.log("[dc-build-fe] build exists — skipping (--if-missing)")
  process.exit(0)
}
// 1) build → staging   2) verify staging/index.html   3) atomic swap (rm old; mv build→old; mv staging→build; rm old)
```

**שינוי קובץ**: שורש `package.json` — ‏הוסף ל-`scripts`:
```jsonc
"fe:build": "node scripts/dc-build-fe.mjs",
"fe:build:if-missing": "node scripts/dc-build-fe.mjs --if-missing",
```

**Verification**:
```bash
cd /home/user/projects/drive-coding/.worktrees/slice-fe-build-decouple
node scripts/dc-build-fe.mjs                 # בונה; build/index.html קיים אחרי
test -f packages/frontend/build/index.html && echo "OK build present"
node scripts/dc-build-fe.mjs --if-missing    # ידלג (build קיים) — מדפיס "skipping"
rm -rf packages/frontend/build
node scripts/dc-build-fe.mjs --if-missing    # יבנה (build חסר)
test ! -d packages/frontend/.build-staging && echo "OK staging cleaned"
git status --porcelain packages/frontend/    # build/ ו-.build-* לא מופיעים (gitignored — ראה Commit 2)
```

---

### Commit 2 — ‏פרמטריזציית outDir + ‏gitignore ל-staging

**Approach**: manual (config). **‏הכרחי ל-Commit 1** — ‏בלי זה vite בונה ל-`build/` ‏ישירות ‏(אין staging).

**שינוי**: `packages/frontend/svelte.config.js` — ‏הפוך את נתיב הפלט ל-env-driven (additive, ‏ברירת-מחדל זהה):
```js
// before:
adapter: adapter({ pages: "build", assets: "build", fallback: "index.html", precompress: false }),
// after:
const out = process.env.FE_BUILD_OUT ?? "build"
adapter: adapter({ pages: out, assets: out, fallback: "index.html", precompress: false }),
```
‏(שמור את `fallback`/`precompress` ‏כמות שהם. ‏ברירת-המחדל `"build"` ‏זהה → ‏אפס שינוי התנהגות
‏ל-`pnpm build`/`pnpm --filter ... build` ‏הרגיל.)

**שינוי**: `.gitignore` (שורש) — ‏הוסף את תיקיות ה-staging הזמניות (כי הדפוס `build/` ‏לא תופס אותן):
```
packages/frontend/.build-staging/
packages/frontend/.build-old/
```

**Verification**:
```bash
FE_BUILD_OUT=.build-staging pnpm --filter @drive-coding/frontend-v2 build
test -f packages/frontend/.build-staging/index.html && echo "OK staging build works"
rm -rf packages/frontend/.build-staging
pnpm --filter @drive-coding/frontend-v2 build   # ברירת מחדל עדיין → build/
test -f packages/frontend/build/index.html && echo "OK default still build/"
git check-ignore packages/frontend/.build-staging packages/frontend/.build-old  # שניהם ignored
```

---

### Commit 3 — ‏עדכון שני קבצי ה-unit: ‏בלי בילד כפוי

**Approach**: manual (systemd). **‏לא נוגע ב-units החיים** — ‏רק בקבצי המקור ב-`deploy/systemd/`.

**שינוי**: `deploy/systemd/voice-acp-dev.service` **‏וגם** `deploy/systemd/voice-acp-main.service`
— ‏שורת `ExecStartPre`:
```
# before:
ExecStartPre=/bin/bash -lc 'source /home/user/.config/shell/shared-env.sh && pnpm install --frozen-lockfile && pnpm build'
# after:
ExecStartPre=/bin/bash -lc 'source /home/user/.config/shell/shared-env.sh && pnpm install --frozen-lockfile && node scripts/dc-build-fe.mjs --if-missing'
```
‏עדכן גם את שורת-ההערה מעל `ExecStartPre` ‏בשני הקבצים — ‏שתסביר שהבילד הוא build-if-missing
‏בלבד ושרענון-FE ‏נעשה דרך `pnpm fe:build` ‏בלי restart.

**Verification** (ללא נגיעה ב-live units):
```bash
systemd-analyze --user verify deploy/systemd/voice-acp-dev.service   # אין שגיאות תחביר
systemd-analyze --user verify deploy/systemd/voice-acp-main.service
grep -c "pnpm build" deploy/systemd/*.service                        # 0 בשני הקבצים
grep "dc-build-fe.mjs --if-missing" deploy/systemd/voice-acp-dev.service deploy/systemd/voice-acp-main.service
```

---

### Commit 4 — ‏עדכון `docs/deploy-local-service.md`

**Approach**: manual (docs).

**שינוי**: `docs/deploy-local-service.md`:
1. **‏Daily Use** — ‏הפרד בין שני סוגי רענון:
   - ‏**רענון FE ‏(נפוץ)**: `cd <worktree> && pnpm fe:build` — ‏הסוכנים החיים שורדים, ‏אין restart, ‏refresh בדפדפן.
   - ‏**רענון BE ‏(נדיר)**: `systemctl --user restart voice-acp-<dev|main>` — ‏זה כן מפיל children, ‏בכוונה.
2. **‏Install / ‏ExecStartPre** — ‏עדכן את הסעיף (שורה ~60): ‏ExecStartPre ‏עכשיו `install + build-if-missing`,
   ‏לא בילד מלא בכל restart.
3. **‏Troubleshooting** — ‏שורת "Static files 404": ‏החלף `run pnpm build` ב-`pnpm fe:build`.
4. **‏תקן נתיבים מיושנים**: ‏הטבלה (שורות 14-15) ‏ושורה 74 ‏אומרות `/home/user/projects/voice-acp/...`
   ‏בעוד שה-units האמיתיים מצביעים ל-`/home/user/projects/drive-coding/...`. ‏יישר לנתיבי `drive-coding`.
   ‏**‏שים לב** (ממצא אביגיל #2): ‏התיקון הוא **‏רק לנתיבים** ‏שמתחילים ב-`voice-acp/`. ‏**‏אל תשנה את שמות
   ‏ה-units** (`voice-acp-dev.service` / `voice-acp-main.service`) — ‏הם נכונים ‏ובמקף, ‏ושינוי שלהם ישבור
   ‏גם את ההתקנה החיה וגם את אימות ה-`grep` ‏למטה (התבנית `voice-acp/` ‏עם לוכסן לא תופסת אותם בכוונה).
5. **‏הוסף סעיף "Apply unit changes (post-merge)"** — ‏הנוהל להחלת ה-ExecStartPre ‏החדש על ה-units החיים
   ‏(זהו צעד deploy שמרדכי/המשתמשת מריצים **אחרי merge ובאישור מפורש** — ‏ראה §7):
   ```bash
   cp deploy/systemd/voice-acp-dev.service  ~/.config/systemd/user/
   cp deploy/systemd/voice-acp-main.service ~/.config/systemd/user/
   systemctl --user daemon-reload
   # restart אחד-אחרון כדי לטעון את ה-ExecStartPre החדש (מפיל children פעם אחת):
   systemctl --user restart voice-acp-dev.service
   systemctl --user restart voice-acp-main.service
   ```

**Verification**:
```bash
grep -c "voice-acp/" docs/deploy-local-service.md     # 0 — אין נתיבי voice-acp מיושנים
grep "pnpm fe:build" docs/deploy-local-service.md      # מופיע ב-Daily Use + Troubleshooting
```

---

## §5 — DoD verifiable

| ‏# | ‏בדיקה | ‏איך |
|---|---|---|
| 1 | ‏`pnpm fe:build` ‏בונה ‏ומחליף אטומית | ‏מריץ; `build/index.html` ‏עדכני; `.build-staging`/`.build-old` ‏לא נשארים |
| 2 | ‏build-if-missing מדלג כשיש build | ‏`node scripts/dc-build-fe.mjs --if-missing` ‏עם build קיים → ‏"skipping", ‏exit 0 |
| 3 | ‏build-if-missing בונה כשחסר | ‏`rm -rf packages/frontend/build` ‏ואז `--if-missing` → ‏בונה; index.html ‏חוזר |
| 4 | ‏ברירת-מחדל לא השתנתה | ‏`pnpm --filter @drive-coding/frontend-v2 build` ‏(בלי env) → ‏עדיין `build/` |
| 5 | ‏שני ה-units תקינים ‏ובלי `pnpm build` | ‏`systemd-analyze --user verify` ‏עובר; `grep -c "pnpm build"` = 0 |
| 6 | ‏staging gitignored | ‏`git check-ignore` ‏על שתי התיקיות; ‏`git status` ‏נקי אחרי בילד |
| 7 | ‏בילד-בזמן-ריצה לא מפיל את ה-BE ‏(אימות חי — calev) | ‏BE ‏חי על port; ‏הרץ `pnpm fe:build`; ‏ה-PID ‏של ה-BE ‏לא משתנה; ‏refresh מגיש חדש |
| 8 | ‏תיעוד מעודכן ‏ונתיבים תוקנו | ‏`pnpm fe:build` ‏ב-Daily Use; ‏אין `voice-acp/` ‏ב-doc |

---

## §6 — Risks + mitigations

1. **‏איבוד שער-הטייפצ'ק בפריסה** — ‏`pnpm build` ‏הנוכחי הריץ `tsc --build` ‏על core/backend, ‏מה
   ‏שחסם deploy עם שגיאת-טיפוס. ‏אחרי השינוי אין שער כזה ‏(ה-BE ‏רץ מ-src עם bun ‏ללא בדיקת טיפוסים,
   ‏וגם `vite build` ‏לא מטייפצ'ק). **‏מיטיגציה**: ‏זו הכרעה מודעת (§9 ש"ב). ‏הטייפצ'ק נשאר באחריות
   ‏לולאת-הפיתוח (`pnpm typecheck`) ‏ולא חוסם רענון. ‏לתעד ב-decisions.
2. **‏חלון לא-אטומי בזמן ה-swap** — ‏בין שני ה-`rename` ‏אין `build/` ‏לרגע → ‏request יכול לקבל 404.
   **‏מיטיגציה**: ‏שני renames הם metadata-only (תת-מילישנייה) ‏על אותה מערכת-קבצים; ‏ה-vite build עצמו
   ‏(האיטי) ‏רץ ל-staging ‏בלי לגעת ב-`build/` ‏החי. ‏לפריסה אישית — ‏זניח. ‏חלופת-symlink ב-§9.
3. **‏קלון/בוט טרי בלי FE** — ‏אם נסיר בילד לגמרי, ‏מכונה נקייה תגיש 404. **‏מיטיגציה**: ‏`--if-missing`
   ‏ב-ExecStartPre בונה אם חסר ‏(תקדים: `dc-launch.mjs`).
4. **‏קאש דפדפן על index.html** — ‏לא קשור ל-restart, ‏אבל אחרי בילד הדפדפן עלול להגיש index ‏ישן ‏(נכסים
   ‏עם content-hash מתבטלים אוטומטית; ‏אין service-worker בפרויקט — ‏אומת). **‏מיטיגציה**: ‏מחוץ ל-scope;
   ‏הפניה ל-`slice-cache-headers-version` ‏ב-doc. ‏hard-refresh עוקף בינתיים.
5. **‏שם ה-filter שגוי** — ‏ה-package הוא `@drive-coding/frontend-v2` ‏למרות שהתיקייה `frontend/`.
   **‏מיטיגציה**: ‏אומת ב-`packages/frontend/package.json`; ‏ה-executor יאמת שוב לפני שמקודד.
6. **‏Hardcoded Hebrew / ‏pre-commit hook** — ‏הסקריפט הוא ops (לוגים באנגלית); ‏אין מחרוזות UI. ‏לא רלוונטי.

---

## §7 — Escalation triggers

‏עצור ושאל את מרדכי ב-parent task אם:
- **‏נדרשת נגיעה ב-units החיים** (`~/.config/systemd/user/`, `systemctl restart/daemon-reload`) —
  **‏אסור לבצע במסגרת הסבב**. ‏זה שינוי-שירות-חי שדורש אישור מפורש (SOUL.md). ‏הסבב מסתיים בקבצי-מקור
  ‏ב-`deploy/systemd/` + ‏נוהל מתועד; ‏ההתקנה החיה היא צעד post-merge של מרדכי/המשתמשת.
- ‏`adapter-static` ‏לא מכבד `FE_BUILD_OUT` ‏(או דורש נתיב מוחלט/יחסי שונה) — ‏עצור, ‏אל תמציא מנגנון אחר.
- ‏`vite build` ‏נכשל ל-staging dir באופן שלא קורה ל-`build/` ‏הרגיל.
- ‏הסקריפט צריך לבנות גם core/backend כדי שה-FE ‏ייבנה ‏(לא צפוי — ‏FE ‏מייבא core מ-src).

---

## §8 — Complexity score

| ‏פרמטר | ‏ניקוד |
|---|---|
| ‏commits (4) | ‏סביר |
| ‏שכבות חדשות (0 — ‏ops) | 0 |
| ‏APIs חיצוניים | 0 |
| ‏streaming/async | 0 |
| ‏state model refactor | 0 |
| ‏protocol BE↔FE | 0 |
| ‏נגיעה בקובצי-פריסה של prod + ‏build pipeline | +2 |
| ‏סינון אטומי בזמן-ריצה (file ops עדינים) | +2 |
| **‏סה"כ** | **~4** |

→ ‏**`calev` (mode: light)**. ‏האימות הקריטי הוא חי-בזמן-ריצה (DoD #7): ‏בילד בזמן שה-BE ‏רץ
‏לא מפיל את ה-PID ‏ומגיש חדש. ‏שאר ה-DoD ‏ניתנים לאימות בסקריפט/grep.

---

## §9 — שאלות פתוחות

1. **‏להשאיר טייפצ'ק כשער-פריסה?** ‏ברירת-מחדל מוצעת: ‏**לא** — ‏מסירים את הבילד הכפוי לטובת מהירות
   ‏רענון; ‏הטייפצ'ק נשאר בלולאת-הפיתוח. *‏לא חוסם.* (מחליט: ‏מרדכי. ‏אם רוצים שער קל — ‏אפשר `pnpm -r --filter !@drive-coding/frontend-v2 run build`
   ‏ב-ExecStartPre, ‏שמטייפצ'ק core+backend בלי הבילד האיטי של FE. ‏לא ברירת-המחדל.)
2. **‏swap אטומי: ‏שני-mv מול symlink?** ‏ברירת-מחדל: **‏שני-mv** ‏(פשוט, ‏בלי שינוי FE_STATIC_DIR/gitignore נוסף).
   ‏חלופה אטומית-לחלוטין: ‏`build` ‏הופך ל-symlink → ‏`build-<ts>/`, ‏ו-`ln -sfn` ‏(rename אטומי של symlink).
   ‏עולה: ‏ניהול גרסאות + ‏ניקוי ישנות + ‏ודאות ש-serveStatic עוקב symlink. ‏לפריסה אישית — ‏overkill. *‏לא חוסם.*
3. **‏האם calev צריך סביבת-BE ‏חיה לאימות DoD #7?** ‏calev ‏יכול להרים BE ‏זמני (port פנוי, ‏`FE_STATIC_DIR`
   ‏לתיקיית ה-worktree) ‏בלי OneCLI ‏(ה-static serving לא דורש credentials) ‏ולוודא PID-stability. *‏לא חוסם.*
