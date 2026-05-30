# Slice 15a — BE CORS — תוכנית

> **‏תאריך**: 2026-05-29
> **‏סטטוס**: ‏בוצע — ‏פאזה 1 ‏מתוך 4 ‏של slice 15 (CF deployment family)
> **‏Complexity**: 2/10 (verifier: ‏אין — ‏נכלל ב-verifier-slice-light הכולל בסוף slice 15)
> **‏תלות**: ‏אין
> **‏מתבסס על**: `docs/plans/README.md`, `docs/plans/EXECUTOR_DISPATCH.md`

---

## §0 — Pre-flight

‏⚠️ **‏אתה ה-executor** — ‏אל תdelegate ל-sub-agent מסוג executor. ‏רק verifier-phase ‏במקומות הקבועים. ‏ראה `EXECUTOR_DISPATCH.md §0`.

‏זו הפאזה הראשונה ב-slice 15. ‏ה-worktree המשותף ל-4 פאזות:

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-15-cf-deployment -b slice-15-cf-deployment dev
cd .worktrees/slice-15-cf-deployment
pnpm install
pnpm hooks:install
```

‏Port: ‏BE 4002 (4000 + 4001 ‏תפוסים על ידי Tama + executor של slice 4). FE — ‏OS-assigned.

```bash
# BE
cd packages/backend
PORT=4002 onecli run --agent voice-acp -- bun --watch src/server.ts

# ‏לבדיקת CORS: ‏לא צריך FE — curl ‏מספיק
```

‏Reading list (must-read, ~‎5 ‏דק'):

‏- `packages/backend/src/server.ts` ‏(או ‏המקום שמרכיב את ה-Hono app — ‏לזהות איפה רושמים middlewares)
‏- `packages/backend/src/delivery/http-agents.ts:26-100` (דוגמה ל-route group `/api`)
‏- `packages/backend/src/delivery/http-proxy.ts` (שורה 1-30 — ‏route `/proxy`)
‏- ‏Hono CORS docs: `node_modules/hono/dist/cjs/middleware/cors/index.js` ‏או [hono.dev/middleware/builtin/cors](https://hono.dev/docs/middleware/builtin/cors)

---

## §1 — מטרה

‏BE כבר חושף CORS על `*` ‏עם רשימה קבועה (`["http://localhost:5173"]`, ‏ב-`server.ts:49`). ‏הסבב הזה מחליף את הקבוע ב-env-var-driven config: ‏רשימה ‏או `*`, ‏עם default לאחור-תאימות (`["http://localhost:5173"]`).

‏החוויה: ‏אחרי הסבב, ‏הרצת BE עם `CORS_ORIGINS=https://voice-acp.example.com,http://localhost:5173` ‏או `CORS_ORIGINS=*` — ‏BE עונה ‏ל-origins ‏המתאימים. ‏בלי env var — ‏ההתנהגות הקיימת (localhost:5173 ‏בלבד).

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
‏| ‏החלפת הline `app.use("*", cors(...))` ‏ב-`server.ts:49` ‏עם config מ-env | ✅ | Commit 1 |
‏| `CORS_ORIGINS` env var — comma-separated או `*` | ✅ | Commit 1 |
‏| ‏Default (env var חסר) — ‏שמירת ‏ההתנהגות הקיימת (`["http://localhost:5173"]`) | ✅ | Commit 1 |
‏| `credentials: true` ‏נשמר — ‏השתנה רק origin list | ✅ | Commit 1 |
‏| ‏Fail-fast על env var לא תקני | ✅ | Commit 1 |
‏| Unit test ל-CORS parsing | ✅ | Commit 1 |
‏| ‏CORS על WebSocket `/ws/*` | ❌ | WS handshake check ‏ע"י Origin header, ‏Hono cors לא רלוונטי |
‏| Walkthrough entry | ❌ | ‏נכנס ‏ב-walkthrough של slice 15 ‏הכולל (פאזה אחרונה) |

---

## §3 — Architecture diagram

```
‏BE (Hono) — server.ts:49
‏  לפני:  app.use("*", cors({ origin: ["http://localhost:5173"], credentials: true }))
‏  אחרי:  app.use("*", cors({
‏           origin: parseCorsOrigins(process.env.CORS_ORIGINS),
‏           credentials: true,
‏         }))

‏parseCorsOrigins (חדש, ‏ב-delivery/cors-config.ts):
  - undefined / "" → ["http://localhost:5173"]  (default — backward compat)
  - "*"            → "*"
  - "a,b,c"        → ["a", "b", "c"]  (after validation + trim)
  - malformed      → throw at startup (fail-fast)
```

---

## §4 — Commits

### Commit 1 — CORS config מ-env (approach: mixed)

‏**מטרה**: ‏החלפת ה-array הקבוע ב-`server.ts:49` ‏ב-parser שקורא env.

‏**קבצים חדשים**:

| ‏קובץ | ‏מטרה |
|---|---|
‏| `packages/backend/src/delivery/cors-config.ts` | ‏פונקציה טהורה `parseCorsOrigins(raw): string \| string[]`. ‏default ל-`["http://localhost:5173"]` ‏(כפי שעכשיו). ‏Throws על input לא תקני |
‏| `packages/backend/src/delivery/cors-config.test.ts` | TDD: ~‎7 tests — ‏undefined → default, ‏`""` → default, ‏`"*"` → `"*"`, ‏list, ‏whitespace trim, ‏trailing slash strip, ‏fail על URL חסר scheme |

‏**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
‏| `packages/backend/src/server.ts` | ‏שורה 49: ‏החלפת `origin: ["http://localhost:5173"]` ‏ב-`origin: parseCorsOrigins(process.env.CORS_ORIGINS)`. ‏שורת import חדשה (line 26-ish): `import { parseCorsOrigins } from "./delivery/cors-config.js"` |

‏**API skeleton**:

```ts
// delivery/cors-config.ts
const DEFAULT_ORIGINS = ["http://localhost:5173"]

export function parseCorsOrigins(raw: string | undefined): string | string[] {
  if (raw === undefined || raw.trim() === "") return DEFAULT_ORIGINS
  const trimmed = raw.trim()
  if (trimmed === "*") return "*"
  const origins = trimmed
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter((s) => s.length > 0)
  for (const o of origins) {
    let u: URL
    try {
      u = new URL(o)
    } catch {
      throw new Error(`Invalid CORS_ORIGINS entry "${o}": not a valid URL`)
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error(`Invalid CORS_ORIGINS entry "${o}": scheme must be http/https`)
    }
    if (u.pathname !== "/" && u.pathname !== "") {
      throw new Error(`Invalid CORS_ORIGINS entry "${o}": must not include path`)
    }
  }
  return origins.length === 1 ? origins[0] : origins
}
```

```ts
// server.ts — ‏החלפת שורה 49 בלבד
// ‏לפני:
app.use("*", cors({ origin: ["http://localhost:5173"], credentials: true }))
// ‏אחרי:
import { parseCorsOrigins } from "./delivery/cors-config.js"  // ← ‏הוסף ל-imports למעלה
// ...
app.use("*", cors({
  origin: parseCorsOrigins(process.env.CORS_ORIGINS),
  credentials: true,
}))
```

‏**הערה ל-Hono cors origin types**: ‏Hono ‏מקבל `string | string[] | (origin) => string | null`. ‏הקוד הקיים משתמש ב-array (`["http://localhost:5173"]`) — ‏עובד. ‏לכן `parseCorsOrigins` ‏מחזיר `string | string[]` ‏בלי שום צורך ב-function variant.

‏**גוטשה — ‏סדר**: ‏ה-`app.use("*", cors(...))` ‏רשום בשורה 49 ‏לפני `registerHttp` ‏(שורה 64). ‏זה הסדר הנכון.

‏**Verification**:

```bash
pnpm test  # cors-config.test.ts
pnpm --filter @drive-coding/backend typecheck

# ‏ידני — ‏default (localhost:5173 בלבד, כמו עכשיו):
cd packages/backend
PORT=4002 onecli run --agent voice-acp -- bun --watch src/server.ts &
sleep 3
curl -sI -X OPTIONS http://localhost:4002/api/agents \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" 2>&1 | grep -i "access-control"
# ‏צפוי: ‏access-control-allow-origin: http://localhost:5173

# ‏עם origin לא מורשה (default):
curl -sI -X OPTIONS http://localhost:4002/api/agents \
  -H "Origin: https://random.com" \
  -H "Access-Control-Request-Method: POST" 2>&1 | grep -i "access-control"
# ‏צפוי: ‏אין access-control-allow-origin (Hono לא מחזיר עבור origin לא רשום)

# ‏ידני — ‏רשימה:
kill %1
CORS_ORIGINS="http://localhost:5173,https://voice-acp.example.com" PORT=4002 onecli run --agent voice-acp -- bun --watch src/server.ts &
sleep 3
curl -sI -X OPTIONS http://localhost:4002/api/agents \
  -H "Origin: https://voice-acp.example.com" \
  -H "Access-Control-Request-Method: POST" 2>&1 | grep -i "access-control"
# ‏צפוי: ‏access-control-allow-origin: https://voice-acp.example.com

# ‏ידני — ‏wildcard:
kill %1
CORS_ORIGINS="*" PORT=4002 onecli run --agent voice-acp -- bun --watch src/server.ts &
sleep 3
curl -sI -X OPTIONS http://localhost:4002/api/agents \
  -H "Origin: https://random.com" \
  -H "Access-Control-Request-Method: POST" 2>&1 | grep -i "access-control"
# ‏צפוי: ‏access-control-allow-origin: *

# ‏ידני — ‏invalid env (fail-fast):
kill %1
CORS_ORIGINS="not-a-url" PORT=4002 onecli run --agent voice-acp -- bun --watch src/server.ts
# ‏צפוי: ‏BE לא עולה, error message ברור
```

---

## §5 — DoD

| # | ‏בדיקה | ‏איך |
|---|---|---|
‏| 1 | typecheck (backend) | ‏אוטומטי |
‏| 2 | tests עוברים (לפחות 356 + ~‎6 חדשים של cors-config) | ‏אוטומטי |
‏| 3 | lint:i18n | ‏אוטומטי |
‏| 4 | smoke `chat-roundtrip.mjs` ‏עובר (אין רגרסיה ב-default mode) | `node tests/smoke/chat-roundtrip.mjs` |
‏| 5 | ‏בלי env — ‏אין CORS headers | ‏curl לעיל |
‏| 6 | ‏עם env list — ‏מחזיר ‏origin תואם בלבד | ‏curl לעיל |
‏| 7 | ‏עם `*` — ‏מחזיר wildcard | ‏curl לעיל |
‏| 8 | ‏env לא תקני — ‏BE נכשל ב-startup עם error ברור | ‏curl לעיל |

---

## §6 — Risks + mitigations

| # | ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|---|
‏| 1 | ‏סדר middleware — CORS אחרי routes → ‏OPTIONS ייפול | ‏Hono general | ‏רישום לפני `app.route(...)`. ‏מצוין בskeleton |
‏| 2 | ‏Hono cors ‏עם `origin: string[]` ‏מחזיר echo של ‏origin תואם, ‏לא list | ‏Hono behavior | ‏לפי docs — ‏אם list, ‏מחזיר רק את ה-Origin שהגיע אם הוא ברשימה. ‏זו ההתנהגות הרצויה. ‏לאמת ‏ב-test |
‏| 3 | ‏BE proxy stream (TTS) — ‏CORS עם stream response | ‏general | ‏Hono cors מטפל אוטומטית גם ב-stream. ‏ההתנהגות זהה ל-JSON |
‏| 4 | `Access-Control-Allow-Credentials` — ‏אם בעתיד נצטרך cookies | ‏future | ‏לא ב-MVP. ‏אם נדרש — ‏slice עתידי |

---

## §7 — Escalation triggers

‏עצור ושאל את Tama אם:

‏1. ‏Hono cors ‏לא תומך ב-pattern שנדרש (`origin: string[]` ‏לא עובד כפי שתואר)
‏2. ‏BE לא מעלה גם בלי env var (רגרסיה)
‏3. ‏OPTIONS preflight חוזר 404 ‏גם אחרי רישום middleware (סדר?)

‏אחרת: ‏החלט והמשך.

---

## §8 — Complexity score: 2/10

| ‏פקטור | ‏ניקוד |
|---|---|
‏| ‏מספר commits (1) | 0 |
‏| ‏שכבות חדשות (אין — ‏רק delivery middleware) | 0 |
‏| ‏APIs חיצוניים | 0 |
‏| ‏Streaming | 0 |
‏| ‏Refactor state | 0 |
‏| ‏Library חיצוני (hono/cors כבר ב-deps) | +1 |
‏| ‏Env var parsing + ‏validation | +1 |
‏| ‏סה"כ | **2** |

‏**Verifier**: ‏אין verifier-phase ייעודי. ‏ה-DoD checklist + ‏smoke chat-roundtrip מבטיחים שלא נשבר משהו. ‏verifier-slice-light הכולל בסוף slice 15 (אחרי 15d) יכסה גם את זה.

---

## §9 — שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
‏| 1 | `allowHeaders` — ‏מה לכלול? | `["Content-Type", "Authorization"]` — ‏מינימום. ‏ניתן להרחיב ‏לפי הצורך | ❌ |
‏| 2 | `allowMethods` — ‏רק שמושים בפועל? | ‏רשימה מלאה (GET/POST/PUT/DELETE/OPTIONS) — ‏future-proof, ‏עלות 0 | ❌ |
‏| 3 | `maxAge` (preflight cache) | ‏default (Hono = 5s). ‏אם הצורך — ‏ב-slice עתידי | ❌ |
‏| 4 | ‏איפה ‏מתחיל ‎ה-Hono app | ‏`server.ts` ‏הוא כנראה — ‏executor יוודא בעת קריאה | ❌ |

---

## §10 — מה הלאה

**‏הפאזה הבאה: ‏slice 15b** (`docs/plans/slice-15b-settings-page.md`). ‏Settings page shell עם שדה BE URL בלבד. ‏FE-only.

‏לא לעבור ל-15b לפני ש-15a עבר את ה-DoD שלו.
