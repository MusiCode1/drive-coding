# Slice 20 — Local Prod Service (BE serves static FE + systemd unit) — תוכנית

> **‏תאריך**: 2026-05-29
> **‏סטטוס**: ‏מאושר
> **‏Complexity**: 4/10 (verifier: light)
> **‏תלות**: slice 15a (CORS env var — merged), FE build (adapter-static — קיים)
> **‏מתבסס על**: `docs/plans/EXECUTOR_DISPATCH.md`, scheduler skill (systemd user-unit conventions), `packages/backend/AGENTS.md`/root AGENTS.md

---

## §0 — Pre-flight

‏⚠️ **‏אתה ה-executor** — ‏אל תdelegate ל-sub-agent מסוג executor. ‏רק `verifier-slice-light` בסוף (§8). ‏ראה `EXECUTOR_DISPATCH.md §0`.

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-20-local-prod -b slice-20-local-prod dev
cd .worktrees/slice-20-local-prod
pnpm install
pnpm hooks:install
```

‏Base: dev tip `e9a857f`.

### ‏הערה קריטית — ‏היכן יושב כל דבר

‏ה-slice נוגע בשני מקומות:
‏1. **‏קוד ב-repo** (Commit 1-2): `packages/backend/src/server.ts` + תיעוד.
‏2. **‏קבצי systemd מחוץ ל-repo** (Commit 3): `~/.config/systemd/user/*.service`. ‏אלה **‏לא** ב-git — ‏הם נכתבים ישירות ל-`~/.config/systemd/user/`. ‏ה-brief מתעד אותם, ‏וה-commit ב-repo כולל **‏עותק** שלהם תחת `deploy/systemd/` ‏לתיעוד + ‏reproducibility.

### Ports

| מה | פקודה |
|---|---|
‏| BE (dev test) | `cd packages/backend && PORT=4001 onecli run --agent voice-acp -- bun --watch src/server.ts` |

‏**‏אל תהרוג** ‏שום BE/FE/tunnel קיים. ‏השתמש ב-4001+ ‏לבדיקות. ‏את ה-systemd service **‏אל תפעיל על 4000** ‏אם 4000 תפוס — ‏בדוק ‏עם `ss -tln | grep :4000` ‏לפני enable.

### ‏Reading list (must-read, ~‎15 ‏דק')

‏1. `packages/backend/src/server.ts` — **‏כל הקובץ (122 שורות)**. ‏נקודות מפתח:
   ‏- שורה 48: `const app = new Hono()`
   ‏- שורה 50: CORS middleware (`parseCorsOrigins(process.env.CORS_ORIGINS)`)
   ‏- שורות 64-75: רישום HTTP routes (`/api`, `/proxy`, וכו')
   ‏- שורה 99: `serve({ fetch: app.fetch, port })` — **‏node-server, ‏לא bun-native**
   ‏- שורות 101-120: WS upgrade handler
‏2. `packages/frontend/svelte.config.js` — adapter-static, output `packages/frontend/build/`, fallback `index.html`.
‏3. scheduler skill (כבר נטען) — ‏קונבנציות systemd user units (`~/.config/systemd/user/`, `daemon-reload`, `systemctl --user`). **‏הערה**: ‏זה **‏לא timer** — ‏זה `Type=simple` long-running + `Type=oneshot` build.
‏4. learnings: `reference/2026-04-29-environment-non-interactive-bash-misses-shared-env-bun-path.md` — ‏ב-systemd אין PATH אינטראקטיבי. ‏**‏חובה נתיבים מוחלטים** ל-onecli/bun/pnpm.

### ‏נתיבים מוחלטים (אומתו)

| כלי | נתיב מוחלט |
|---|---|
‏| onecli | `/home/user/.local/bin/onecli` |
‏| bun | `/home/user/.bun/bin/bun` |
‏| pnpm | **‏לא יציב** (fnm/corepack ב-`/run/user/...`). ‏ל-build service: ‏השתמש ב-`bash -lc 'source ~/.config/shell/shared-env.sh && pnpm ...'` ‏כדי לקבל PATH תקין |
‏| systemctl | `/usr/bin/systemctl` |

---

## §1 — מטרה

‏אחרי slice 20: ‏ה-BE ‏(Hono) ‏מגיש **‏גם** ‏את ה-FE הסטטי ‏(single origin, ‏אפס CORS) **‏וגם** ‏ממשיך לאפשר חיבור cross-origin מ-FE שמתארח ב-Cloudflare Pages (`drive-coding.pages.dev`). ‏ה-BE רץ כ-systemd user service יציב, ‏ופקודת build ידנית אחת בונה את הכל ‏ומפעילה אותו מחדש.

‏**‏שני המצבים עובדים בו-זמנית**:
‏- ‏**‏מקומי**: ‏דפדפן → `http://<host>:4000/` → ‏BE מגיש `index.html` + assets, ‏ו-`/api`,`/ws`,`/proxy` same-origin.
‏- ‏**‏CF**: ‏דפדפן → `https://drive-coding.pages.dev` → static מ-CF, ‏`Settings.beUrl` ‏מצביע ל-BE, ‏cross-origin עם CORS (slice 15a) ‏שמאשר את ה-origin.

‏החוויה (developer):
```bash
systemctl --user enable --now voice-acp-be        # ‏מפעיל את ה-BE
# ‏אחרי שינוי קוד:
systemctl --user start voice-acp-build            # ‏build → restart אוטומטי של BE
```

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
‏| ‏BE מגיש static FE (serveStatic, ‏node-server adapter) + SPA fallback | ✅ | Commit 1 |
‏| ‏Guard: ‏static רק אם `FE_STATIC_DIR` ‏מוגדר (dev mode לא נשבר) | ✅ | Commit 1 |
‏| ‏CORS מאפשר ‏גם CF origin ‏וגם local (slice 15a — ‏כבר configurable) | ✅ | Commit 3 (env בלבד) |
‏| `deploy/systemd/*.service` ‏ב-repo (תיעוד + reproducibility) | ✅ | Commit 2 |
‏| `voice-acp-be.service` (Type=simple, long-running) ‏ב-`~/.config/systemd/user/` | ✅ | Commit 3 |
‏| `voice-acp-build.service` (Type=oneshot → build → restart BE) | ✅ | Commit 3 |
‏| ‏Build ידני (`systemctl start voice-acp-build`) | ✅ | Commit 3 |
‏| `.path` auto-watcher (build אוטומטי) | ❌ | ‏future — ‏המשתמש בחר build ידני |
‏| ‏חשיפת BE ל-internet (HTTPS tunnel ל-CF connect מרחוק) | ❌ | ‏future — ‏ה-CF connect עובד מקומית/דרך tunnel קיים |
‏| ‏שינוי ה-FE build process | ❌ | `pnpm build` ‏הקיים מספיק |

---

## §3 — Architecture

```
‏BE (Hono, node-server, port 4000):
  app.use("*", cors(...))            ← ‏קיים (15a)
  registerHttp / agents / proxy ...  ← ‏קיים (/api, /ws, /proxy)
  ↓ ← ‏חדש: serveStatic בסוף, אחרי כל ה-API routes
  if (FE_STATIC_DIR) {
    app.use("/*", serveStatic({ root: FE_STATIC_DIR }))                  ← assets
    app.get("/*", serveStatic({ path: `${FE_STATIC_DIR}/index.html` }))  ← SPA fallback
  }

‏שני מצבי גישה (בו-זמנית):
  http://host:4000/        → static FE (same-origin /api /ws /proxy)
  https://drive-coding.pages.dev → static מ-CF → beUrl → cross-origin (CORS allows)

systemd (~/.config/systemd/user/):
  voice-acp-be.service     (simple)   → onecli run -- bun server.ts, PORT+FE_STATIC_DIR+CORS_ORIGINS env
  voice-acp-build.service  (oneshot)  → pnpm build  +  ExecStartPost: systemctl restart voice-acp-be
```

‏**‏סדר רישום קריטי**: ‏ה-`serveStatic` ‏חייב להירשם **‏אחרי** כל ‏ה-API routes (אחרי שורה 75) ‏אבל **‏לפני** ‏ה-`serve(...)` (שורה 99). ‏ה-catch-all `/*` ‏יבלע הכל אם יירשם לפני ה-API. ‏ה-WS לא מושפע (הוא ב-`httpServer.on("upgrade")`, ‏ערוץ נפרד).

---

## §4 — Commits

### Commit 1 — BE serves static FE (approach: integration)

‏**מטרה**: ‏הוספת serveStatic מאחורי guard של env var.

‏**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
‏| `packages/backend/src/server.ts` | ‏(a) import `serveStatic` מ-`@hono/node-server/serve-static`. (b) אחרי שורה 75 (אחרי registerProxyHttp), ‏לפני ה-WS section — ‏הוסף את ה-block המותנה (skeleton למטה) |

‏**Skeleton** (server.ts — ‏אחרי שורה 75):

```ts
import { serveStatic } from "@hono/node-server/serve-static"
// ... (ה-import ‏למעלה ‏עם שאר ה-imports)

// Slice 20: serve the built static FE (single-origin local prod).
// Guarded by FE_STATIC_DIR — when unset (dev mode), Vite serves the FE
// and this block is skipped, so the BE stays API/WS/proxy-only.
const feStaticDir = process.env.FE_STATIC_DIR
if (feStaticDir) {
  // Assets first (js/css/etc), then SPA fallback to index.html for any
  // unmatched path (client-side routing). Registered AFTER all /api,/proxy
  // routes so it never shadows them.
  app.use("/*", serveStatic({ root: feStaticDir }))
  app.get("/*", serveStatic({ path: `${feStaticDir}/index.html` }))
  log.info({ feStaticDir }, "serving static FE")
}
```

‏**גוטשה — root vs path ב-serveStatic**: `serveStatic({ root })` ‏מגיש קבצים יחסית ל-`root` ‏לפי ה-URL path. `serveStatic({ path })` ‏מגיש קובץ קבוע (ל-SPA fallback). ‏אם ‏ה-`root` ‏צריך להיות **‏יחסי ל-cwd** — `FE_STATIC_DIR` ‏הוא נתיב מוחלט, ‏זה אמור לעבוד. **‏אם serveStatic ‏מתנהג מוזר עם נתיב מוחלט** — ‏בדוק את docs של `@hono/node-server/serve-static` ‏(`rewriteRequestPath` ‏או `root` ‏יחסי). ‏אם נתקעת — Escalate.

‏**גוטשה — node-server, ‏לא bun**: ‏ה-import חייב להיות מ-`@hono/node-server/serve-static` (אומת ב-package exports). **‏אל** ‏תשתמש ב-`hono/bun` ‏(ה-BE רץ דרך `@hono/node-server` ‏גם כשמריצים עם bun runtime).

‏**Verification**:
```bash
pnpm --filter @drive-coding/backend typecheck

# ‏בנה FE קודם:
pnpm --filter @drive-coding/frontend-v2 build   # → packages/frontend/build/

# ‏הרץ BE עם FE_STATIC_DIR (port 4001 לבדיקה):
cd packages/backend
FE_STATIC_DIR=/home/user/projects/voice-acp/.worktrees/slice-20-local-prod/packages/frontend/build \
  PORT=4001 onecli run --agent voice-acp -- bun src/server.ts &
sleep 3
curl -sI http://localhost:4001/ | grep -i "content-type"        # ‏ציפייה: text/html
curl -s http://localhost:4001/ | grep -i "drive-coding"          # ‏ציפייה: ‏ה-title
curl -sI http://localhost:4001/api/agents | head -1              # ‏ציפייה: ‏לא 404 (API עדיין עובד)
curl -sI http://localhost:4001/some/spa/route | grep -i content-type  # ‏ציפייה: text/html (SPA fallback)
kill %1

# ‏בלי FE_STATIC_DIR — ‏אין static (dev mode):
PORT=4001 onecli run --agent voice-acp -- bun src/server.ts &
sleep 3
curl -sI http://localhost:4001/ | head -1     # ‏ציפייה: 404 (אין static, ‏כמו dev)
curl -sI http://localhost:4001/api/agents | head -1   # ‏ציפייה: ‏עובד
kill %1
```

‏**DoD**:
‏- [ ] typecheck נקי
‏- [ ] עם `FE_STATIC_DIR` — `/` ‏מחזיר HTML, ‏`/api/*` ‏עדיין עובד, ‏SPA route מחזיר index.html
‏- [ ] בלי `FE_STATIC_DIR` — `/` ‏מחזיר 404 (dev mode unchanged), ‏`/api/*` ‏עובד

---

### Commit 2 — systemd unit files in repo + docs (approach: none)

‏**מטרה**: ‏עותק של ה-units ב-repo (reproducibility) + ‏תיעוד deploy.

‏**קבצים חדשים**:

| ‏קובץ | ‏מטרה |
|---|---|
‏| `deploy/systemd/voice-acp-be.service` | ‏עותק תיעודי (§5) |
‏| `deploy/systemd/voice-acp-build.service` | ‏עותק תיעודי (§5) |
‏| `docs/deploy-local-service.md` | ‏הוראות התקנה + ‏שימוש |

‏**DoD**:
‏- [ ] שני ה-`.service` ‏ב-`deploy/systemd/`
‏- [ ] `docs/deploy-local-service.md` ‏מלא (install, enable, build, logs, troubleshooting)

---

### Commit 3 — install + activate systemd units (approach: manual)

‏**מטרה**: ‏התקנה בפועל ל-`~/.config/systemd/user/`, enable, ‏ובדיקה חיה.

‏**‏זה לא commit ב-repo** (קבצים מחוץ ל-repo) — ‏אבל ‏הצעדים מתועדים ‏ב-commit message ‏וב-`docs/deploy-local-service.md`. ‏ה-"commit" ‏הוא רק עדכון docs/walkthrough אם צריך; ‏ההתקנה היא פעולת מערכת.

‏**צעדים**:

‏1. ‏העתק את שני ה-`.service` מ-`deploy/systemd/` ל-`~/.config/systemd/user/`:
```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/voice-acp-be.service ~/.config/systemd/user/
cp deploy/systemd/voice-acp-build.service ~/.config/systemd/user/
```

‏2. ‏**‏בדוק port 4000 פנוי** (`ss -tln | grep :4000`). ‏אם תפוס (Tama מריצה dev) — ‏או עצור את שלה, ‏או שנה ל-PORT אחר ב-service ‏ותעד. **‏Escalate ל-Tama אם 4000 תפוס** — ‏אל תהרוג את ה-dev שלה.

‏3. `systemctl --user daemon-reload`

‏4. `systemctl --user enable --now voice-acp-be.service`

‏5. ‏בדיקה חיה:
```bash
systemctl --user status voice-acp-be.service       # active (running)
sleep 3
curl -sI http://localhost:4000/ | grep -i content-type    # text/html
curl -sI http://localhost:4000/api/agents | head -1        # ‏עובד
# ‏build + reload:
systemctl --user start voice-acp-build.service
systemctl --user status voice-acp-build.service     # ‏ראה שרץ + ExecStartPost restart
journalctl --user -u voice-acp-be.service -n 10 --no-pager   # ‏ראה restart + "serving static FE"
```

‏6. ‏בדיקת CORS ל-CF origin:
```bash
curl -sI -X OPTIONS http://localhost:4000/api/agents \
  -H "Origin: https://drive-coding.pages.dev" \
  -H "Access-Control-Request-Method: GET" | grep -i access-control-allow-origin
# ‏ציפייה: access-control-allow-origin: https://drive-coding.pages.dev
```

‏**DoD**:
‏- [ ] `voice-acp-be` ‏active, ‏מגיש FE + API על 4000 (או port מתועד)
‏- [ ] `voice-acp-build` ‏בונה ‏ומפעיל מחדש את ה-BE (journalctl מאשר)
‏- [ ] CORS מאשר ‏גם `drive-coding.pages.dev` ‏וגם same-origin local
‏- [ ] walkthrough מעודכן

---

## §5 — תוכן קבצי systemd

### `deploy/systemd/voice-acp-be.service`

```ini
[Unit]
Description=voice-acp backend (Hono + static FE, via OneCLI gateway)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/user/projects/voice-acp/dev
Environment=PORT=4000
Environment=FE_STATIC_DIR=/home/user/projects/voice-acp/dev/packages/frontend/build
Environment=CORS_ORIGINS=https://drive-coding.pages.dev,http://localhost:4000
ExecStart=/home/user/.local/bin/onecli run --agent voice-acp -- /home/user/.bun/bin/bun packages/backend/src/server.ts
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
```

‏**‏הערה**: ‏ה-service מצביע על `dev` worktree (`/home/user/projects/voice-acp/dev`), ‏לא על worktree של ה-slice. ‏אחרי merge ל-dev, ‏ה-build יבנה את הקוד החדש שם.

### `deploy/systemd/voice-acp-build.service`

```ini
[Unit]
Description=voice-acp build (FE + BE) then restart backend
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/home/user/projects/voice-acp/dev
# ‏pnpm דרך fnm/corepack — ‏צריך PATH אינטראקטיבי. ‏source את shared-env.
ExecStart=/bin/bash -lc 'source /home/user/.config/shell/shared-env.sh && pnpm build'
ExecStartPost=/usr/bin/systemctl --user restart voice-acp-be.service
# ‏אין [Install] — ‏ה-unit מופעל ידנית (systemctl --user start voice-acp-build), ‏לא enable.
```

‏**‏גוטשה — pnpm path מ-fnm לא יציב**: `shared-env.sh` ‏מריץ `eval "$(fnm env)"` ‏שמייצר נתיב `/run/user/1000/fnm_multishells/<PID>_<TS>/bin/pnpm` — ‏משתנה בין sessions. ‏בדרך כלל עובד (ה-eval מרענן בכל הפעלה), ‏אבל ‏**‏אם ה-build service נכשל עם "pnpm not found"** — ‏fallback: ‏השתמש ב-`corepack pnpm` ‏או ב-`node_modules/.bin/pnpm` ‏ישיר (מ-WorkingDirectory). ‏תעד מה עבד.

‏**‏גוטשה — `bash -lc` + shared-env**: ‏לפי ה-learning, ‏ב-bash non-interactive ה-`~/.bun/bin` ‏עלול לחסר. ‏`source shared-env.sh` ‏מתקן. ‏אם `pnpm` ‏עדיין לא נמצא — ‏בדוק עם `bash -lc 'which pnpm'` ‏ידנית ‏והתאם (אולי `corepack` ‏או נתיב node מוחלט). **‏אם נתקעת על PATH — Escalate.**

---

## §6 — `docs/deploy-local-service.md` תוכן נדרש

‏1. **‏Overview**: ‏BE מגיש FE מקומית (single origin) + ‏מאפשר CF connect.
‏2. **‏Build**: `pnpm build` → FE ל-`packages/frontend/build/`, BE ל-dist.
‏3. **‏Install**: ‏העתקת `.service` ל-`~/.config/systemd/user/` + `daemon-reload` + `enable --now`.
‏4. **‏שימוש יומיומי**: `systemctl --user start voice-acp-build` (build + reload).
‏5. **‏מצב מקומי**: `http://<host>:4000`.
‏6. **‏מצב CF**: `https://drive-coding.pages.dev` + `Settings.beUrl` ‏מצביע ל-BE (‏מקומי דרך אותו מחשב, ‏או דרך tunnel ‏אם נחשף). ‏ראה slice 15d ל-PNA/mixed-content limitation.
‏7. **‏Logs**: `journalctl --user -u voice-acp-be -f`. ‏עם `LOG_WIRE=ws` ‏ב-Environment — ‏גם wire traffic (slice 18).
‏8. **‏Troubleshooting**: 401 על proxy → OneCLI לא מזריק (בדוק agent). port תפוס → שנה PORT.

---

## §7 — Risks + mitigations

| # | ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|---|
‏| 1 | `serveStatic` ‏catch-all בולע את `/api`,`/ws`,`/proxy` | ‏סדר routes | ‏רישום **‏אחרי** ‏שורה 75 (אחרי כל ה-API). DoD Commit 1 ‏בודק ש-`/api` עדיין עובד |
‏| 2 | ‏import שגוי (`hono/bun` ‏במקום node-server) | stack | ‏ה-BE ‏הוא node-server (שורה 99 `serve` מ-`@hono/node-server`). ‏import מ-`@hono/node-server/serve-static` ‏(אומת ב-exports) |
‏| 3 | ‏systemd לא מוצא bun/onecli/pnpm (PATH) | learnings 2026-04-29 | ‏נתיבים מוחלטים ל-onecli/bun; `bash -lc + source shared-env` ל-pnpm |
‏| 4 | ‏port 4000 תפוס ע"י dev של Tama | env | Commit 3 ‏מורה לבדוק `ss -tln` ‏ולא להרוג; Escalate |
‏| 5 | ‏SPA fallback לא עובד (404 על client routes) | adapter-static | `app.get("/*", serveStatic({ path: `${feStaticDir}/index.html` }))` ‏(נתיב מוחלט!) ‏אחרי ה-assets. DoD בודק route מדומה |
‏| 6 | ‏dev mode נשבר (Vite + serveStatic מתנגשים) | guard | ‏ה-block מותנה ב-`FE_STATIC_DIR`. ‏ב-dev ‏(Vite) ‏ה-env לא מוגדר → ‏skip. DoD בודק בלי env |
‏| 7 | ‏OneCLI ב-systemd לא מזריק credentials | OneCLI | ‏ה-service קורא ל-`onecli run --agent voice-acp` ‏(אותו mechanism כמו dev). ‏אם 401 — ‏בדוק שה-onecli מאותחל ל-user. ‏Escalate אם לא |

---

## §8 — Escalation triggers

‏עצור ושאל את Tama אם:
‏1. ‏port 4000 תפוס (dev של Tama) — ‏אל תהרוג, ‏שאל
‏2. `serveStatic` ‏לא מגיש נכון עם נתיב מוחלט (root behavior)
‏3. ‏systemd לא מוצא pnpm גם אחרי `source shared-env.sh`
‏4. ‏OneCLI ב-service מחזיר 401 על proxy (credentials injection ב-systemd context)

‏אחרת: ‏החלט והמשך, ‏תעד.

---

## §9 — Complexity score: 4/10

| ‏פקטור | ‏ניקוד |
|---|---|
‏| ‏commits (3) | +1 |
‏| ‏שינוי delivery (serveStatic) | +1 |
‏| ‏systemd integration (סביבה מחוץ ל-repo) | +2 |
‏| ‏סה"כ | **4** |

‏**Verifier**: `verifier-slice-light`. ‏brief לverifier:
```
‏בדוק slice 20 ב-branch slice-20-local-prod, worktree .worktrees/slice-20-local-prod.
‏Brief: docs/plans/slice-20-local-prod-service.md. Base: e9a857f.
‏בדוק DoD §4. ‏typecheck. ‏בנה FE, ‏הרץ BE עם FE_STATIC_DIR על port 4001 →
‏ודא / מחזיר HTML, /api עובד, SPA fallback. ‏בלי env → 404 על / (dev mode).
‏CORS: OPTIONS עם Origin של CF → allow-origin תואם.
‏(systemd install — ‏בדיקה ידנית, ‏לא חובה ל-verifier אם 4000 תפוס.)
‏GO / NEEDS REVISION.
```

---

## §10 — שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
‏| 1 | `FE_STATIC_DIR` ‏מצביע ל-dev worktree קבוע? | ‏כן — `/home/user/projects/voice-acp/dev/packages/frontend/build`. ‏ה-service רץ מול dev, ‏לא מול worktrees | ❌ |
‏| 2 | ‏גם LOG_WIRE ב-service? | ‏לא כברירת מחדל (רועש). ‏אפשר להוסיף ‏ידנית ל-Environment כשצריך debug | ❌ |
‏| 3 | ‏BE ‏גם על IPv6/0.0.0.0 ‏לגישה מהרשת? | ‏node-server default מאזין על כל ה-interfaces. ‏אם רק localhost רצוי — ‏future. ‏לא חוסם | ❌ |
‏| 4 | ‏חשיפת BE ל-CF דרך tunnel קבוע? | ‏future — ‏ה-slice מאפשר את ה-connect, ‏לא מקים tunnel. ‏ה-tunnel הקיים (pico) ‏או slice עתידי | ❌ |

---

## §11 — מה הלאה

‏אחרי merge: ‏ה-BE רץ כשירות יציב שמגיש את הכל. ‏future: `.path` auto-build watcher, ‏HTTPS tunnel קבוע ל-BE לחיבור CF מרחוק, ‏הגבלת bind ל-localhost אם רצוי.
