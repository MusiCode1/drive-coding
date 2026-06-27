# Slice — https-local — תוכנית

> **תאריך**: 2026-06-28
> **סטטוס**: טיוטה (טרם אביגיל)
> **Complexity**: 5/10 (verifier: light + phase על commit ה-serve)
> **תלויות (`depends_on`)**: [config-unified]
> **Base**: `slice/config-unified` @ `8db1b47` (טרם מוזג ל-dev)
> **Dev tip**: dev @ `5df7459`

---

## §0 — Pre-flight

### תלויות (חובה!)

slice זה **מבוסס על** `slice-config-unified` (verified GO, טרם merged):
- `loadConfig()` כותב `DRIVE_CODING_HTTPS = JSON.stringify(config.https)` ל-`process.env` ([load-config.ts:231-232](packages/backend/src/config/load-config.ts#L231)). הערך הוא `true` (self-signed) או `{"key":"<path>","cert":"<path>"}`. **ה-slice הזה הוא הצרכן.**
- `getStateDir()`/`ensureStateSubdir()` ([paths.ts](packages/backend/src/paths.ts), slice-state-dir merged) — לאחסון cert עצמי-חתום.

> ⚠️ ה-base הוא הענף `slice/config-unified`, **לא** dev.

### Worktree

```bash
cd D:/UserProjects/AI/drive-coding
git worktree add D:/UserProjects/AI/drive-coding/.worktrees/https-local -b slice/https-local slice/config-unified
cd D:/UserProjects/AI/drive-coding/.worktrees/https-local
pnpm install && pnpm hooks:install
```

### איך להריץ

- BE HTTPS (dev): `cd packages/backend && PORT=4011 DRIVE_CODING_HTTPS=true bun src/server.ts` → `https://localhost:4011`.
- Tests: מה-root — `npx vitest run packages/backend/...`.
- typecheck: `pnpm typecheck`. lint: `bash ./scripts/lint-no-hebrew-in-code.sh`.
- **בדיקת secure-context**: דפדפן ל-`https://localhost:4011` (אשר את אזהרת ה-cert), פתח DevTools console → `window.isSecureContext` === `true`, ו-`navigator.mediaDevices` מוגדר.

### Browser

linux-gui / מכונה אמיתית. הבדיקה המהותית: secure-context + ניגישות מיקרופון. self-signed → צריך לאשר אזהרה פעם אחת.

### Reading list

**must-read**:
- `packages/backend/src/server.ts:164-180` — `const httpServer = serve({ fetch: app.fetch, port })` + `httpServer.on("upgrade", …)` (WS). **זו נקודת השינוי.**
- `packages/backend/src/config/load-config.ts:231-232` — מיפוי `https → DRIVE_CODING_HTTPS` (JSON).
- `node_modules/.pnpm/@hono+node-server@2.0.3*/…/dist/index.d.cts:20-33` — `serve()` מקבל `createServer?: typeof createServer` + `serverOptions?` (כולל variant מאובטח). **HTTPS = להעביר `createServer` מ-`node:https` + `serverOptions:{key,cert}`.**

**reference**:
- AGENTS.md §"Running & serving locally" — "HTTPS is mandatory" (secure-context ל-getUserMedia/AudioWorklet).
- הפרונט כבר protocol-aware: `location.protocol === "https:" ? "wss:" : "ws:"` ([be-url.ts:45](packages/frontend/src/lib/util/be-url.ts#L45)) — **אפס שינוי FE**; WSS אוטומטי.

---

## §1 — מטרה

אחרי ה-slice: `drive-coding --https` (או `DRIVE_CODING_HTTPS=true`) מרים את השרת מעל **HTTPS מקומי** — כך שאפשר לגשת לבינארי **מהטלפון/מכשיר אחר ב-LAN** והמיקרופון עובד (secure-context). אפשר להביא cert משלך (`https: {key,cert}` paths, למשל מ-mkcert) או לתת לבינארי לייצר self-signed אוטומטית (נשמר ב-state-dir, idempotent). ברירת-מחדל: HTTP (תאימות לאחור; localhost עובד כמו שהוא). WSS עובד אוטומטית — הפרונט כבר protocol-aware.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| `DRIVE_CODING_HTTPS={key,cert}` (path-ים שלך) → HTTPS | ✅ | ה-slice הזה |
| `DRIVE_CODING_HTTPS=true` → self-signed (ל-state-dir, idempotent) | ✅ | ה-slice הזה |
| ברירת-מחדל HTTP (אין `DRIVE_CODING_HTTPS`) | ✅ | ה-slice הזה |
| WS→WSS על https.Server | ✅ (אימות; הקוד כבר עובד) | ה-slice הזה |
| local CA (mkcert-style mgmt) | ❌ | המשתמש מביא path-ים שלו; mgmt עתידי |
| auto-redirect HTTP→HTTPS | ❌ | עתידי |
| שינוי FE | ❌ | כבר protocol-aware |

---

## §3 — Architecture

```
DRIVE_CODING_HTTPS (env, JSON) ──▶ resolveTls(env)  ← חדש (tls.ts)
   undefined/false → null
   {key,cert}      → readFileSync(key), readFileSync(cert)
   true            → state-dir/tls/{key,cert}.pem (קיים? קרא : selfsigned.generate→כתוב)
                              │ {key,cert} | null
                              ▼
server.ts:                                                  ← משתנה
   const tls = resolveTls(process.env)
   const httpServer = tls
     ? serve({ fetch, port, createServer: httpsCreateServer, serverOptions: tls })
     : serve({ fetch, port })                               ← ללא שינוי כשאין TLS
   httpServer.on("upgrade", …)  ← עובד זהה על https.Server (WSS)
```

---

## §4 — Commits בסדר

### Commit 0 — selfsigned dependency + tls resolver (approach: tdd)

**קבצים חדשים**:
- `packages/backend/src/tls.ts`
- `packages/backend/tests/tls.test.ts`

**קבצים שמשתנים**:
- `packages/backend/package.json` — הוסף `"selfsigned": "^2"` ל-dependencies (pure-JS, מתבנדל ב-`bun --compile`).

**API skeleton**:
```ts
export type TlsMaterial = { key: string; cert: string }
/**
 * פותר חומר-TLS מ-DRIVE_CODING_HTTPS (JSON ב-env).
 * - undefined / "false" / שבור → null (HTTP).
 * - {"key":path,"cert":path} → readFileSync(path, "utf8") של שניהם → TlsMaterial.
 * - true → self-signed: getStateDir()/tls/key.pem + cert.pem.
 *     קיימים → קרא. חסרים → selfsigned.generate (CN=localhost, ימי-תוקף ארוכים,
 *     altNames: localhost + 127.0.0.1) → כתוב (0600 אם אפשר) → החזר.
 *     idempotent (כמו plugin extraction).
 */
export function resolveTls(env: NodeJS.ProcessEnv): TlsMaterial | null
```

> ⚠️ **TLS material כ-string**: `TlsMaterial.key`/`cert` הם `string` (תוכן PEM), לכן **`readFileSync(path, "utf8")`** — לא `readFileSync(path)` הגולמי (שמחזיר `Buffer`). `selfsigned.generate(...)` מחזיר `{ private, cert }` כ-strings (PEM) — מתאים ישירות. `node:https` `serverOptions` מקבל `key`/`cert` כ-`string | Buffer`, אז string תקין.

**Verification**:
```bash
npx vitest run packages/backend/tests/tls.test.ts
```
כיסוי: אין env→null · `"false"`→null · JSON שבור→null+warn · `true`→מייצר key+cert תקפים (PEM, `-----BEGIN`) · `true` פעם שנייה→קורא קיים (idempotent, אותו cert) · `{key,cert}` path-ים→קורא קבצים · path חסר→null+warn (לא קורס).

### Commit 1 — serve over HTTPS (approach: integration) ⚠️ phase-check אחרי

**קבצים שמשתנים**:
- `packages/backend/src/server.ts` — הוסף `import { createServer as httpsCreateServer } from "node:https"` + `import { resolveTls } from "./tls.js"`. החלף את `serve({ fetch: app.fetch, port })` (שורה 164) ב-conditional (ראה §3). **שמור את `httpServer.on("upgrade", …)` ללא שינוי** (עובד על https.Server).

**הערות מימוש**:
- ⚠️ **typing — ה-options של `serve` הם union לא-discriminated** (`ServerOptions$3` ב-2.0.3): TS עלול **לא לצמצם** ל-variant ה-https רק מהעברת `serverOptions:{key,cert}`, וה-typecheck עלול להיכשל. הדפוס המומלץ — **לבנות את אובייקט ה-options מוקלד מראש** ולהעביר אותו:
  ```ts
  import { serve, type ServerType } from "@hono/node-server"
  import { createServer as httpsCreateServer } from "node:https"

  const tls = resolveTls(process.env)
  const httpServer: ServerType = tls
    ? serve({ fetch: app.fetch, port, createServer: httpsCreateServer, serverOptions: tls })
    : serve({ fetch: app.fetch, port })
  ```
  אם TS עדיין לא מצמצם — cast **ממוקד** של אובייקט ה-options בלבד (למשל `... satisfies Parameters<typeof serve>[0]`, או cast מינימלי מתועד ל-type ה-https-serve), **לא** `any` רחב, ולא cast על תוצאת ה-serve. זו הנקודה היחידה שעלולה לדרוש התערבות-typing.
- `serve` מ-`@hono/node-server` מאזין על כל ה-interfaces (`0.0.0.0`) כברירת-מחדל → נגיש מ-LAN. (אם לא — זה finding ל-escalation, אבל לא צפוי.)

**Verification (phase-check ע"י calev mode:phase)**:
```bash
pnpm typecheck
# HTTP (ברירת-מחדל, regression):
PORT=4011 bun src/server.ts &  # → http://localhost:4011, GET / → 200
# HTTPS (self-signed):
PORT=4012 DRIVE_CODING_HTTPS=true bun src/server.ts &  # → https://localhost:4012
curl -k https://localhost:4012/api/agents  # → {"agents":[]}
# WSS: לקוח ws מול wss://localhost:4012/ws/echo (rejectUnauthorized:false) → hello+pong
# secure-context: דפדפן https://localhost:4012 → window.isSecureContext===true
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck + tests | `pnpm typecheck` נקי · `npx vitest run packages/backend` ירוק |
| 2 | lint:i18n | `bash ./scripts/lint-no-hebrew-in-code.sh` → 0 |
| 3 | **regression: HTTP ברירת-מחדל** | בלי `DRIVE_CODING_HTTPS` → `http://localhost:PORT`, `GET /` 200, WS עובד (זהה להיום) |
| 4 | HTTPS self-signed עולה | `DRIVE_CODING_HTTPS=true` → `https://`, `curl -k /api/agents` → 200; cert נוצר ב-`~/.config/drive-coding/tls/` |
| 5 | cert idempotent | הרצה שנייה → אותו cert (לא מייצר מחדש) |
| 6 | BYO cert (path-ים) | `DRIVE_CODING_HTTPS={key,cert}` עם path-ים תקפים → השרת משתמש בהם |
| 7 | WSS עובד | לקוח wss מול `/ws/echo` (`rejectUnauthorized:false`) → hello+pong |
| 8 | secure-context | דפדפן https → `window.isSecureContext===true`, `navigator.mediaDevices` מוגדר |
| 9 | self-signed מתבנדל בבינארי | `node packages/release/scripts/build-binary.mjs` → `.exe --https` עולה ב-HTTPS (selfsigned לא נשבר ב-`bun --compile`) |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| **regression: HTTP נשבר** | שינוי ב-serve boot | DoD #3 חובה; ה-conditional שומר את הענף הקיים בדיוק כשאין TLS |
| `selfsigned` לא מתבנדל ב-`bun --compile` | ספרייה חדשה בבינארי | DoD #9 — בדיקה בבינארי בפועל; selfsigned הוא pure-JS (אין native) → צפוי לעבוד. ראה memory `bun-compile-embed-fe-findings` |
| WS upgrade לא עובד על https.Server | שינוי transport | DoD #7; `https.Server` פולט `upgrade` כמו `http.Server` — הקוד הקיים אמור לעבוד; אַמֵּת |
| iOS Safari דורש trust ידני ל-self-signed | טבע self-signed | מתועד; ה-slice תומך גם ב-BYO cert (path-ים, למשל mkcert) שפותר את זה. לא חוסם את ה-slice |
| typing של `serve` https overload | @hono/node-server | cast מינימלי מתועד אם צריך, לא `any` |
| Hardcoded Hebrew | i18n hook | קוד+warnings באנגלית; `pnpm hooks:install` |

---

## §7 — Escalation triggers

- `serve` לא בוחר את ה-https overload / לא מקבל `createServer` כצפוי → עצור ושאל מרדכי (אולי צריך `Bun.serve` ישיר לבינארי).
- `httpServer.on("upgrade")` לא נורה על https.Server → עצור (WSS שבור = בעיית transport מהותית).
- `selfsigned` נשבר ב-`bun --compile` → עצור (אולי צריך אסטרטגיית cert אחרת).
- רוצה לסטות מ-testing strategy → עצור.

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| ספרייה חיצונית חדשה (`selfsigned`) | +2 |
| Refactor של boot (serve) | +1 |
| Streaming/transport (WSS over TLS) | +1 |
| Deploy-critical (boot — אם נשבר, השרת לא עולה) | +2 |
| TDD ב-Commit 0 (tls resolver) | -1 |

**Score**: 5 / 10 → **light + phase**. **Verifier-phase אחרי Commit 1** (ה-serve — נקודת ה-boot + WSS).

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | self-signed: ימי-תוקף + altNames? | 825 ימים, altNames=[localhost, 127.0.0.1] | ❌ |
| 2 | `node:https` createServer (HTTP/1.1) או `createSecureServer` (http2)? | `node:https` — http2+WS upgrade מסובך, HTTP/1.1 בטוח | ❌ |
| 3 | להוסיף altName ל-IP של ה-LAN? | לא ב-slice הזה (IP דינמי); self-signed עם CN=localhost מספיק לאישור-ידני, BYO cert לטלפון | ❌ |

---

## סטיות מהתכנון (מתעדכן ע"י executor)

- (אין עדיין)
