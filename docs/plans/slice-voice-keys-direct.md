# Slice — voice-keys-direct — תוכנית

> **תאריך**: 2026-06-28
> **סטטוס**: טיוטה (טרם אביגיל)
> **Complexity**: 4/10 (verifier: light)
> **תלויות (`depends_on`)**: [config-unified]
> **Base**: `slice/config-unified` @ `8db1b47` (טרם מוזג ל-dev)
> **Dev tip**: dev @ `5df7459` (config-unified מסתעף מ-`5df7459`)

---

## §0 — Pre-flight

### תלויות (חובה!)

slice זה **מבוסס על** `slice-config-unified` (status: verified GO, טרם merged):
- `loadConfig()` כותב `ELEVENLABS_API_KEY` / `GEMINI_API_KEY` ל-`process.env` (מקובץ/JSON/flag/env). **בלי התלות הזו אין מאיפה לקרוא את המפתחות.** ה-slice הזה הוא ה**צרכן** של המפתחות.

> ⚠️ ה-base הוא הענף `slice/config-unified`, **לא** dev. צור את ה-worktree ממנו.

### Worktree

```bash
cd D:/UserProjects/AI/drive-coding
git worktree add D:/UserProjects/AI/drive-coding/.worktrees/voice-keys-direct -b slice/voice-keys-direct slice/config-unified
cd D:/UserProjects/AI/drive-coding/.worktrees/voice-keys-direct
pnpm install && pnpm hooks:install
```

### איך להריץ

- BE (dev): `cd packages/backend && PORT=4011 bun src/server.ts` (4000/4002/4003 תפוסים ע"י המשתמשת — **אל תהרוג**; השתמש ב-4011+).
- Tests: מה-root — `npx vitest run packages/backend/...` (**לא** מתוך packages/backend — workspace config).
- typecheck: `pnpm typecheck`. lint: `bash ./scripts/lint-no-hebrew-in-code.sh`.

### OneCLI agent — קריטי לתאימות

היום שירותי הקול עובדים **רק** דרך OneCLI (`onecli run --agent voice-acp`), שמזריק `xi-api-key`/`x-goog-api-key` בשכבת HTTPS_PROXY. **ה-slice הזה לא מבטל את OneCLI — הוא מוסיף מסלול ישיר חלופי.** המבחן הקריטי: **כשאין מפתח מוגדר, ההתנהגות חייבת להיות זהה לחלוטין להיום** (placeholder עובר as-is, OneCLI מזריק).

### Reading list

**must-read**:
- `packages/backend/src/delivery/http-proxy.ts` — ה-proxy. `registerProxyHttp`, בניית `headers` (שורות 75-77: `new Headers(...)` + `delete("host")`), ה-`fetch` (126-131). **נקודת ההזרקה: בין בניית ה-headers ל-fetch.**
- `packages/backend/src/config/load-config.ts:218-224` — איך `voice.*Key` נכתב ל-`ELEVENLABS_API_KEY`/`GEMINI_API_KEY` (config-unified).

**reference**:
- AGENTS.md §"Backend MUST run through OneCLI" — דפוס ה-placeholder + מה OneCLI מזריק.
- `packages/frontend/src/lib/adapters/voice/tts.ts:44` — הפרונט שולח `xi-api-key: "browser-placeholder"`.

---

## §1 — מטרה

אחרי ה-slice: הבינארי העצמאי (או כל הרצה בלי OneCLI) יכול **לספק את המפתחות שלו** ל-ElevenLabs/Gemini דרך הקונפיג המאוחד (`--env-file keys.env` / config / env). ה-proxy מזריק אותם לבקשות ה-upstream, ושירותי הקול עובדים **בלי OneCLI**. כשאין מפתח — ההתנהגות זהה להיום (OneCLI ממשיך לעבוד), אפס regression.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| הזרקת `xi-api-key` (ElevenLabs) ב-proxy מ-`ELEVENLABS_API_KEY` | ✅ | ה-slice הזה |
| הזרקת `x-goog-api-key` (Google) מ-`GEMINI_API_KEY` | ✅ | ה-slice הזה |
| passthrough כשאין מפתח (תאימות OneCLI) | ✅ | ה-slice הזה |
| קריאת המפתחות מהקונפיג | ❌ (כבר ב-config-unified) | config-unified |
| ספק נוסף / מפתחות אחרים | ❌ | עתידי |
| הזרקה דרך query-param (`?key=`) | ❌ | header מספיק (Google מקבל `x-goog-api-key`) |

---

## §3 — Architecture

```
FE ──xi-api-key: browser-placeholder──▶ /proxy/elevenlabs/*
                                          │
                          ┌───────────────▼────────────────┐
                          │ http-proxy.ts registerProxyHttp │ ← משתנה
                          │  headers = new Headers(req)      │
                          │  headers.delete("host")          │
                          │  ┌──────────────────────────┐   │
                          │  │ resolveProviderAuth(      │   │ ← חדש (proxy-auth.ts)
                          │  │   provider, process.env)  │   │
                          │  │ → {name,value} | null     │   │
                          │  └──────────┬───────────────┘   │
                          │  if (auth) headers.set(…)        │ ← מפתח מוגדר → דורס placeholder
                          │  fetch(upstream, {headers})      │ ← אין מפתח → placeholder עובר (OneCLI)
                          └──────────────────────────────────┘
```

---

## §4 — Commits בסדר

### Commit 0 — proxy-auth helper (approach: tdd)

**קבצים חדשים**:
- `packages/backend/src/delivery/proxy-auth.ts`
- `packages/backend/tests/proxy-auth.test.ts`

**API skeleton** (טהור — env מוזרק, אין קריאה גלובלית):
```ts
export type ProviderAuth = { name: string; value: string }
/**
 * מחזיר את ה-auth header להזרקה ל-upstream, או null אם אין מפתח מוגדר.
 * elevenlabs → xi-api-key מ-ELEVENLABS_API_KEY. google → x-goog-api-key מ-GEMINI_API_KEY.
 * provider לא-מוכר או מפתח חסר/ריק → null (passthrough).
 */
export function resolveProviderAuth(
  provider: string,
  env: NodeJS.ProcessEnv,
): ProviderAuth | null
```

**Verification**:
```bash
npx vitest run packages/backend/tests/proxy-auth.test.ts
```
כיסוי: elevenlabs+key→`{xi-api-key,…}` · google+key→`{x-goog-api-key,…}` · אין key→null · key ריק `""`→null · provider לא-מוכר→null.

### Commit 1 — wire into http-proxy (approach: integration)

**קבצים שמשתנים**:
- `packages/backend/src/delivery/http-proxy.ts` — הזרק **בדיוק לפני** ה-`fetch` (סביב שורה 124), **אחרי** ה-cache-hit early-return (104-116) — כדי לא לבזבז הזרקה על cache hits:
  ```ts
  const auth = resolveProviderAuth(provider, process.env)
  if (auth) headers.set(auth.name, auth.value)
  // ...מיד אחרי זה: res = await fetch(targetUrl, { method, headers, body, signal })
  ```
  (ה-`headers` נבנה בשורה 76 ומשמש **רק** ב-`fetch`; ההזרקה בכל מקום בין הבנייה ל-fetch נכונה פונקציונלית — אבל לפני ה-fetch ואחרי ה-cache-return זה המיקום הנקי.)
- **חדש** `packages/backend/tests/http-proxy.test.ts` — ⚠️ ה-`http-proxy.test.ts` הקיים בודק **רק** את פונקציות ה-cache הטהורות ב-import ישיר; **אין בו harness של fetch-mock / mount של Hono**. ל-DoD #3/#4 צריך **לבנות harness חדש**: `vi.stubGlobal("fetch", …)` (או `vi.spyOn`) + mount של ה-app (`registerProxyHttp` על Hono test-instance) + `app.request("/proxy/elevenlabs/...")`, ולבדוק את ה-`headers` שב-`fetch` mock נקרא איתם.

**הערות**:
- `headers.set` **דורס** את ה-placeholder הקיים (התנהגות רצויה). אין מפתח → לא קוראים set → placeholder עובר → OneCLI מזריק (זהה להיום).
- **לא לוֹגֵג את המפתח.** ה-log הקיים (`log.info({provider, path})`) לא כולל headers — אל תוסיף.
- ההזרקה **לא** משנה את ה-cache key (מחושב מ-method|path|body, לא מ-headers — `proxy-cache.ts`). אין דליפה למטמון.

**Verification**:
```bash
pnpm typecheck
npx vitest run packages/backend/tests/http-proxy.test.ts packages/backend/tests/proxy-auth.test.ts
bash ./scripts/lint-no-hebrew-in-code.sh
# manual: PORT=4011 ELEVENLABS_API_KEY=test-xyz bun src/server.ts ; ואז curl ל-/proxy/elevenlabs/v1/voices ולוודא בלוג שאין דליפה
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck + tests | `pnpm typecheck` נקי · `npx vitest run packages/backend` ירוק (חדשים + קיימים) |
| 2 | lint:i18n | `bash ./scripts/lint-no-hebrew-in-code.sh` → 0 |
| 3 | ElevenLabs key מוזרק | unit/integration: `ELEVENLABS_API_KEY=X` + בקשה ל-`/proxy/elevenlabs/*` → ה-`fetch` נקרא עם `xi-api-key: X` |
| 4 | Gemini key מוזרק | `GEMINI_API_KEY=Y` + `/proxy/google/*` → `fetch` עם `x-goog-api-key: Y` |
| 5 | **regression: אין key → passthrough** | בלי env → ה-header שנשלח ל-upstream זהה לקלט (placeholder), אין `set`. **המבחן הקריטי לתאימות OneCLI.** |
| 6 | המפתח לא בלוג | grep בלוג של הרצה עם key → אין הופעה של הערך |
| 7 | provider לא-מוכר | `/proxy/unknown/*` → 404 כמקודם. (ה-404 נורה ב-`http-proxy.ts:65-67` **לפני** שמגיעים בכלל ל-auth — אז ההזרקה לא רלוונטית; הבדיקה רק מוודאת שלא נשבר) |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| **שבירת מסלול OneCLI** (regression שקט — TTS מפסיק לעבוד למשתמשי OneCLI) | זה השינוי המסוכן | DoD #5 חובה: בלי key, אפס שינוי בהתנהגות. `if (auth)` מגן |
| דליפת מפתח ללוג | proxy logs | DoD #6; אל תוסיף headers ללוג; ה-log הקיים בטוח |
| המפתח נכנס ל-cache key / נשמר במטמון | proxy-cache | cache key = method\|path\|body בלבד (ראה proxy-cache.ts) — אין דליפה. אַמֵּת |
| Hardcoded Hebrew | i18n hook | קוד באנגלית; `pnpm hooks:install` |

---

## §7 — Escalation triggers

- מתברר ש-Google דורש `?key=` query-param ולא מקבל `x-goog-api-key` header → עצור ושאל (אולי צריך גם query injection).
- ההזרקה משנה את cache key / שוברת cache hits קיימים → עצור.
- רוצה לסטות מ-testing strategy (tdd 0, integration 1) → עצור.

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| Refactor של קוד קיים (http-proxy) | +1 |
| Streaming/proxy path | +1 |
| Pure helper בליבה | -2 |
| TDD מלא ב-Commit 0 | -1 |
| Greenfield helper, call-site יחיד | -1 |
| Deploy-critical (proxy — אם נשבר, אין קול) | +2 |

**Score**: ~4 → **light**. (verifier-phase לא נדרש — slice קטן בקובץ אחד; DoD #5 הוא ה-gate.)

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | Google — header `x-goog-api-key` מספיק, או צריך `?key=` query? | header מספיק (זה מה ש-OneCLI מזריק היום) | ❌ |
| 2 | מיקום ה-helper — `delivery/proxy-auth.ts` או core? | backend/delivery (קורא env, צמוד ל-proxy) | ❌ |

---

## סטיות מהתכנון (מתעדכן ע"י executor)

- (אין עדיין)
