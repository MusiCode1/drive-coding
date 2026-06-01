# Slice 24 — Client-Keyed Proxy Cache — ‏תוכנית

> **‏תאריך**: 2026-06-01
> **‏סטטוס**: ‏מאושר (‏אביגיל: READY, 2026-06-01)
> **Complexity**: 5/10 (verifier: light + phase על Commit 1)
> **‏תלויות (`depends_on`)**: []
> **‏Base**: dev
> **‏Dev tip**: `62b41a0`

---

## §0 — Pre-flight

> ‏סוכן חדש בלי context: ‏אחרי הסעיף הזה אתה יודע להריץ הכל ולהבין את הבעיה.

### ‏תלויות (‏חובה!)

‏slice זה **‏אין לו תלויות** — ‏בנוי ישירות על dev (`62b41a0`).
‏הוא נוגע בקבצים שנוצרו ב-Slice 10 (proxy-cache, http-proxy) ‏אבל אלה כבר ב-dev (merged).

### ‏רקע — ‏למה ה-slice הזה קיים (‏קרא לפני הכל)

‏ה-proxy-cache הנוכחי (`packages/backend/src/delivery/proxy-cache.ts`) ‏ממפתח כל
‏רשומה לפי `sha256(method | path | body)`. ‏זה עובד מצוין ל-**translate** ו-**tts**
‏(‏ה-body דטרמיניסטי לפי הטקסט), ‏אבל **‏שובר ל-narrate**:

‏ה-prompt של narrate (`packages/core/src/voice/narration-prompt.ts:buildNarratePrompt`)
‏כולל `ctx.recentMessages` — ‏רשימת ההודעות האחרונות, ‏שהיא **‏תלוית-זמן**. ‏אותו
‏tool-call בדיוק, ‏כשמנוסח מחדש אחרי reload, ‏מקבל `recentMessages` ‏שונה → ‏גוף בקשה
‏שונה → `sha256` ‏שונה → **cache miss** → ‏קריאה חוזרת ל-Gemini → ‏נרטיב **‏שונה**
‏(LLM ‏לא-דטרמיניסטי). ‏המשתמשת שומעת נרטיב אחר ב-reload לאותה פעולה.

‏**ה-fix**: ‏לתת ל-**‏לקוח** (FE) ‏לקבוע את מפתח-הקאש דרך header `x-cache-key`, ‏במקום
‏שה-BE יגזור אותו מהגוף. ‏הלקוח הוא היחיד שיודע מהו ה-identity ‏היציב של כל רשומה:
- narrate → `toolCallId` (‏יציב; ‏ה-prompt התלוי-זמן נשאר בגוף אבל **‏לא** ‏במפתח)
- translate / tts → `sha256(text)` (‏הטקסט הוא ה-input היציב)

‏בנוסף: ‏הלקוח מצרף `x-cache-meta` (JSON) ‏עם metadata ‏לתיוג הרשומה. ‏ה-BE שומר אותו
‏ליד ה-body. ‏זה הופך את הקאש למאגר ניתן-למחיקה-סלקטיבית (`type:tts` ‏וכו') ‏בלי לבנות
‏query layer עכשיו.

### ‏Precondition ‏(‏חשוב!)

‏ה-slice מניח ש-`session/load` ‏של opencode עושה **replay מלא** ‏של ההיסטוריה
‏(`user_message_chunk` / `agent_message_chunk` / `agent_thought_chunk` / `tool_call`).
‏**‏נכון לעכשיו זה שבור ב-opencode 1.15.13** (`replayMessage` ‏שולח ‏רק `tool_call`) —
‏‏זו רגרסיה ב-opencode שמתוקנת ‏במסלול נפרד (fork ‏ב-`~/vendor/opencode`). ‏ה-slice הזה
‏מתוכנן מול ההתנהגות **‏הנכונה** של ACP. ‏אל תנסה לתקן את ה-replay כאן — ‏זה מחוץ ל-scope.
‏ה-cache-keying ‏עובד גם בלי replay (‏הוא רק לא **‏ייהנה** ‏ממנו עד שה-replay יחזור).

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-24-client-keyed-cache -b slice-24-client-keyed-cache dev
cd .worktrees/slice-24-client-keyed-cache
pnpm install && pnpm hooks:install
```

### ‏איך להריץ

- BE: ‏מ-`packages/backend` —
  `PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts`
  (‏**‏חובה OneCLI** — ‏אחרת כל proxy call ‏מחזיר 401. ‏ראה AGENTS.md §"Backend MUST run through OneCLI")
- FE: `BE_PORT=4000 pnpm --filter @drive-coding/frontend dev` (port: OS-assigned, ‏Vite מדפיס)
- Tests: `pnpm test --filter @drive-coding/backend` ‏ו-`--filter @drive-coding/frontend`
- ‏Smoke ל-proxy: `curl` ‏ישיר ל-`http://localhost:4000/proxy/...` (‏ראה Commit 1 verification)

### Browser

‏Chrome רגיל מקומי דרך Vite dev URL. ‏אין צורך ב-linux-gui ‏ל-slice הזה (‏אין UI חדש).
‏הבדיקה האמיתית היא **‏Network tab** + `x-cache` response header + ‏בדיקת disk cache.

### OneCLI agent

‏שם: `voice-acp`
‏שימוש: `onecli run --agent voice-acp -- <cmd>` — ‏מזריק `xi-api-key` ‏ל-elevenlabs
‏ו-`x-goog-api-key` ‏ל-google. **‏לא** ‏מזריק Anthropic (‏מכוון).

### Reading list

**must-read** ‏(לפני שמתחילים):
- `packages/backend/src/delivery/http-proxy.ts` — ‏ה-proxy שמשתנה (Commit 1)
- `packages/backend/src/delivery/proxy-cache.ts` — ‏ה-cache store שמשתנה (Commit 1)
- `packages/frontend/src/lib/adapters/voice/{narrate,translate,tts}.ts` — ‏3 ה-adapters (Commit 2)
- `packages/frontend/src/lib/adapters/voice/sdks.ts` — ‏איך נבנה ה-google provider (‏קריטי ל-header)
- `packages/frontend/src/lib/view-models/speaker.svelte.ts:313-366` — ‏מאיפה נקרא narrate (toolCallId זמין)

**reference** (‏בזמן עבודה):
- `docs/conventions/parallel-safe-code.md` — ‏לפני נגיעה בקבצים משותפים
- `packages/core/src/voice/cache-key.ts` — `cacheKeyFor(text,voiceId,modelId)` ‏קיים; `sha256Key` ‏ייווסף ‏פה ‏ב-Commit 0.5
- `packages/core/src/cwd-hash.ts` — ‏דוגמה ל-sha256 ב-FE (crypto.subtle, ‏זמין ‏בדפדפן)

> **⚠️ ‏הבהרה (‏תוקן ‏אחרי ‏אביגיל):** `sha256Key(input: string)` ‏הגנרי ‏**‏לא** ‏קיים ‏ב-core —
> ‏הוא ‏יושב ‏ב-`packages/backend/src/voice/cache-keys.ts` (‏חבילת backend, ‏ה-FE ‏לא ‏יכול ‏לייבא).
> ‏ב-core ‏יש ‏רק `cacheKeyFor(text, voiceId, modelId)` (‏חתימה ‏ספציפית, ‏לא ‏מתאימה ‏ל-narrate/translate).
> ‏לכן **Commit 0.5** ‏מעביר ‏את `sha256Key` ‏ל-core ‏לפני ‏שה-FE ‏משתמש ‏בו.

---

## §1 — ‏מטרה

‏אחרי ה-slice הזה: ‏כשהמשתמשת טוענת מחדש שיחה (reload), ‏הנרטיב של כל קריאת-כלי
‏וה-TTS של כל הודעה/מחשבה **‏זהים** ‏למה שנשמע במקור, ‏בלי קריאה חוזרת ל-Gemini/ElevenLabs.
‏ה-FE קובע את מפתח-הקאש לפי ה-identity ‏היציב של כל רשומה (toolCallId / textHash),
‏ולא לפי גוף-הבקשה התלוי-זמן. ‏בנוסף, ‏כל רשומת קאש מתויגת ב-metadata ‏שמאפשר מחיקה
‏סלקטיבית עתידית.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|------|------|------|
‏| `x-cache-key` header ‏קובע מפתח ב-BE | ✅ | ‏בslice הזה |
‏| `x-cache-meta` JSON ‏נשמר כ-metadata | ✅ | ‏בslice הזה |
‏| ‏מחיקת `x-cache-*` ‏לפני forward ל-upstream | ✅ | ‏בslice הזה |
‏| narrate/translate/tts ‏שולחים headers ‏מה-FE | ✅ | ‏בslice הזה |
‏| fallback ל-sha256(body) ‏כשאין header | ✅ | ‏בslice הזה |
‏| ‏מחיקה סלקטיבית בפועל (API/UI ‏ל-clear) | ❌ | slice ‏עתידי (‏ה-metadata ‏מכין קרקע) |
‏| query layer / index ‏לפי messageId | ❌ | slice ‏עתידי (YAGNI) |
‏| ‏תיקון replay ‏של opencode | ❌ | fork ‏ב-`~/vendor/opencode`, ‏מסלול נפרד |
‏| eviction / TTL ‏לקאש | ❌ | slice ‏עתידי (‏הקאש גדל בלי גבול היום, ‏נשאר ככה) |
‏| ‏החזרת קריאות ל-BE (‏במקום FE) | ❌ | ‏נשקל בעתיד (decision ‏רשום) |
‏| STT (`generateContent` ‏מולטימודלי) | ❌ | ‏לא cacheable ‏היום, ‏לא נוגעים |

> ‏זו לא טבלת TODO. ‏הגנה מ-scope creep.

---

## §3 — Architecture diagram

```
FE adapters (voice/)                       BE delivery/
┌────────────────────┐                     ┌──────────────────────────┐
│ narrate.ts      ←  │ x-cache-key:        │ http-proxy.ts        ←   │ ‏משתנה
│   generateText     │ narrate:<toolId>    │  1. ‏יש x-cache-key?      │
│   + headers   ─────┼────────────────────▶│     → ‏מפתח = ‏הערך         │
├────────────────────┤ x-cache-meta:{...}  │     ‏אחרת → sha256(body)   │
│ translate.ts    ←  │                     │  2. ‏מחק x-cache-* ‏לפני   │
│   generateObject   │ translate:<hash>    │     forward ל-upstream   │
│   + headers   ─────┼────────────────────▶│  3. ‏שמור meta ‏עם body    │
├────────────────────┤                     └────────────┬─────────────┘
│ tts.ts          ←  │ tts:<voice>:<hash>               │
│   fetch ‏ישיר  ─────┼─────────────────────▶             ▼
│   + headers        │                     ┌──────────────────────────┐
└────────────────────┘                     │ proxy-cache.ts       ←   │ ‏משתנה
         ▲                                 │  set(key, {body,         │
         │ ‏מפתח נבנה ‏ב-FE                   │    headers, meta})       │
┌────────┴───────────┐                     │  {key}        = body     │
│ cache-key util  ←  │ ‏חדש (‏או core/)      │  {key}.headers= ct+meta  │
│ buildCacheKey()    │                     └──────────────────────────┘
│ buildCacheMeta()   │
└────────────────────┘
```

‏(‏אין שכבת UI חדשה. ‏הכל adapters + delivery.)

---

## §4 — Commits ‏בסדר

### Commit 0 — Phase 0: ‏אימות passthrough ‏של header (approach: manual)

> ‏**‏קריטי לפני קוד.** ‏אם header `x-cache-key` ‏לא עובר דרך OneCLI ‏או דרך ה-AI SDK,
> ‏כל ה-slice לא ישים בצורתו הנוכחית. ‏שני אימותים — ‏ידניים, ‏בלי לכתוב קוד production.

**‏אימות 1 — OneCLI ‏מעביר x-* header as-is:**

‏הרץ BE עם OneCLI (‏פקודה ב-§0). ‏שלח curl ‏עם header מותאם דרך הפרוקסי, ‏וודא שה-upstream
‏מקבל אותו (‏או לפחות שה-בקשה לא נכשלת). ‏פשוט יותר: ‏הוסף ‏זמנית `log.info` ‏ב-`http-proxy.ts`
‏שמדפיס את כל ה-headers הנכנסים, ‏שלח translate מה-FE, ‏וודא ש-headers ‏מותאמים מגיעים.

```bash
# ‏מ-FE Network tab: ‏שלח translate, ‏ראה אם x-cache-key ‏יוצא ‏מה-browser
# ‏וב-BE log: ‏ראה אם הוא מגיע
```

**‏אימות 2 — `@ai-sdk/google` ‏מאפשר header ‏פר-קריאה:**

‏ב-`sdks.ts`, ‏ה-provider נבנה **‏פר-קריאה** ‏ב-factory `googleAi()`. ‏בדוק אם
`createGoogleGenerativeAI({ headers: {...} })` ‏מקבל headers ‏סטטיים ‏שעוברים לכל בקשה.
‏(‏סביר שכן — ‏זה האופציה הסטנדרטית ב-AI SDK.) ‏אם **‏לא** — ‏רשום סטייה ‏ועצור, ‏שאל את Tama
‏(escalation: ‏ייתכן שצריך לעבור ל-fetch ‏ישיר גם ל-translate/narrate, ‏או למודל "‏קריאות ב-BE").

**Verification**:
```bash
# ‏ידני: ‏שני האימותים למעלה ‏עברו → ‏תעד ב-§"‏סטיות" ‏את התוצאה (‏איזו header API ‏עבדה)
# ‏אם אימות 2 ‏נכשל → STOP, ‏escalate ל-Tama (‏אל תמשיך ל-Commit 1)
```

> ‏Commit 0 ‏הוא **‏ספייק** — ‏ייתכן שלא יישאר בו קוד production. ‏המטרה: ‏הכרעה האם
> ‏הגישה ישימה, ‏ובאיזו header API ‏להשתמש ב-Commit 2.

---

### Commit 0.5 — ‏העברת `sha256Key` ל-core (approach: tdd)

> ‏**‏למה**: ‏ה-FE ‏צריך `sha256(text)` ‏ל-translate/tts keys, ‏אבל `sha256Key` ‏הגנרי ‏יושב
> ‏היום ‏ב-`packages/backend/src/voice/cache-keys.ts` (‏ה-FE ‏לא ‏יכול ‏לייבא ‏מ-backend).
> ‏ב-core ‏יש ‏רק `cacheKeyFor` ‏(‏חתימה ‏ספציפית ‏ל-TTS). ‏מעבירים ‏את ‏הגנרי ‏ל-core.

**‏קבצים שמשתנים**:
- `packages/core/src/voice/cache-key.ts` — ‏מוסיף `sha256Key(input: string): Promise<string>`
  ‏לצד `cacheKeyFor` ‏הקיים (‏לא ‏משנה ‏את `cacheKeyFor`). ‏הקובץ ‏כבר ‏מיוצא ‏דרך `core/index.ts:6`.

**API skeleton**:

```ts
// packages/core/src/voice/cache-key.ts — ‏מוסיף (‏ה-impl ‏זהה ‏ל-backend/voice/cache-keys.ts:7):
export async function sha256Key(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest("SHA-256", buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
```

**‏קבצים ‏למחיקה**:
- `packages/backend/src/voice/cache-keys.ts` — `sha256Key` ‏שם ‏**‏לא ‏בשימוש ‏באף ‏מקום**
  (‏אומת: `grep sha256Key packages/backend/src` ‏מחזיר ‏רק ‏את ‏ההגדרה). ‏מחק ‏את ‏הקובץ,
  ‏או ‏השאר ‏ריק. ‏אם ‏יש ‏import ‏ממנו ‏(‏אין) — ‏הפנה ‏ל-core.

**Verification** (TDD — ‏פונקציה ‏טהורה):
```bash
pnpm test --filter @drive-coding/core
# test: sha256Key("abc") === ‏ערך ‏hex ‏ידוע ‏וקבוע (64 ‏תווים, ‏דטרמיניסטי)
pnpm typecheck   # ‏ודא ‏שמחיקת cache-keys.ts ‏לא ‏שברה import
```

---

### Commit 1 — BE: x-cache-key + meta + strip (approach: integration)

**‏קבצים שמשתנים**:
- `packages/backend/src/delivery/http-proxy.ts` — ‏מוסיף: ‏קריאת `x-cache-key`,
  ‏מחיקת `x-cache-*` ‏מ-headers ‏לפני forward, ‏העברת meta ל-cache.set
- `packages/backend/src/delivery/proxy-cache.ts` — ‏מרחיב `CachedEntry` ‏ו-`set`/`get`
  ‏לשמור `meta` (JSON) ‏ליד ה-headers

**API skeleton** (proxy-cache.ts):

```ts
export type CachedEntry = {
  body: Uint8Array
  headers: { contentType: string }
  meta?: Record<string, unknown>   // ‏חדש — ‏metadata ‏שהלקוח שלח (x-cache-meta)
}
// get(): ‏קורא ‏גם {key}.meta ‏אם קיים → entry.meta
// set(): ‏כותב {key}.meta = JSON.stringify(entry.meta) ‏אם קיים
```

**‏לוגיקה ב-http-proxy.ts** (‏פסאודו, ‏בתוך ה-handler ‏הקיים):

```ts
// ‏אחרי ‏קריאת body (‏שורה ~75), ‏לפני ‏בדיקת מטמון:
const clientKey = c.req.header("x-cache-key")          // ‏אופציונלי
const clientMetaRaw = c.req.header("x-cache-meta")     // ‏אופציונלי JSON

// ‏מחק את ה-headers ‏שלנו ‏מ-forward (‏כמו host ‏בשורה 69):
headers.delete("x-cache-key")
headers.delete("x-cache-meta")

// ‏קביעת מפתח:
let cacheKey: string | null = null
if (clientKey) {
  // ‏לקוח קבע מפתח — ‏עדיין ‏רק ‏אם הבקשה cacheable (‏מגן מ-cache ‏של מה שאסור)
  if (isCacheableRequest(c.req.method, pathSuffix, body)) {
    cacheKey = sanitizeCacheKey(clientKey)   // ‏ראה ‏הערת ‏אבטחה ‏למטה
  }
} else if (isCacheableRequest(c.req.method, pathSuffix, body)) {
  cacheKey = await computeCacheKey(c.req.method, pathSuffix, body)  // ‏fallback ‏קיים
}

// ‏ב-cache.set ‏(‏בתוך cacheStreamInBackground), ‏העבר ‏גם meta:
let meta: Record<string, unknown> | undefined
if (clientMetaRaw) { try { meta = JSON.parse(clientMetaRaw) } catch { /* ‏התעלם */ } }
```

> **‏הערת אבטחה (‏חובה ב-`sanitizeCacheKey`)**: ‏מפתח שמגיע ‏מהלקוח ‏הופך ‏לשם-קובץ
> ‏ב-`{baseDir}/proxy/{key}` (`cache.ts:filePath`). ‏לקוח ‏זדוני/‏באגי ‏יכול לשלוח
> `../../etc/...` → **path traversal**. ‏חובה ‏לחטא: ‏החלף ‏כל ‏תו ‏שאינו `[a-zA-Z0-9:_-]`
> ‏ב-`_`, ‏או hash ‏את ה-clientKey ‏עצמו (`sha256(clientKey)`) ‏כדי ‏שהקובץ ‏תמיד ‏בטוח.
> **‏המלצה: hash ‏את ה-clientKey** — ‏מבטל traversal ‏לגמרי ‏ושומר ‏על ‏אורך-קובץ ‏אחיד.
> ‏(‏המפתח הקריא נשמר ב-meta ‏לצורך ‏מחיקה ‏סלקטיבית ‏עתידית.)

**‏קבצים חדשים (‏אופציונלי)**:
- ‏אם ‏`sanitizeCacheKey` ‏לוגיקה ‏טהורה → `packages/core/src/cache/sanitize-key.ts` + ‏TDD test

**Verification** (integration test ‏ב-`packages/backend/tests/`):
```bash
pnpm test --filter @drive-coding/backend
# ‏טסטים ‏חדשים:
#  1. ‏בקשה ‏עם x-cache-key=A ‏ו-body=X → ‏נשמר ‏תחת ‏מפתח(A); ‏בקשה ‏שנייה ‏עם ‏אותו A ‏ו-body=Y(‏שונה!) → hit
#  2. ‏בקשה ‏בלי x-cache-key → ‏fallback ‏ל-sha256(body) (‏התנהגות ‏קיימת ‏לא ‏נשברה)
#  3. x-cache-meta ‏נשמר ‏ו-get ‏מחזיר ‏אותו
#  4. x-cache-key ‏עם ../ → ‏לא ‏בורח ‏מ-baseDir (‏path traversal ‏חסום)
#  5. x-cache-key / x-cache-meta ‏לא ‏מגיעים ‏ל-upstream (‏mock fetch, ‏בדוק headers)
```

---

### Commit 2 — FE: ‏3 adapters ‏שולחים headers (approach: integration + manual)

**‏קבצים חדשים**:
- `packages/frontend/src/lib/adapters/voice/cache-headers.ts` — ‏builders ‏ל-key+meta

**API skeleton** (cache-headers.ts):

```ts
import { sha256Key } from "@drive-coding/core"  // ‏נוסף ‏ב-Commit 0.5, ‏מיוצא ‏דרך core/index.ts

// ‏בונה ‏את ‏זוג ה-headers ‏לכל ‏ערוץ. ‏מחזיר {} ‏אם ‏אין ‏מספיק ‏מידע (‏הגנה).
export async function narrateCacheHeaders(
  toolCallId: string, toolKind: string | undefined,
): Promise<Record<string, string>>
// key = `narrate:${toolCallId}`
// meta = { type: "narrate", toolCallId, toolKind, createdAt: Date.now() }

export async function translateCacheHeaders(
  text: string, targetLang: string, messageId: string | null,
): Promise<Record<string, string>>
// key = `translate:${await sha256Key(text + "|" + targetLang)}`
// meta = { type: "translate", messageId, textHash, targetLang, createdAt }

export async function ttsCacheHeaders(
  text: string, voiceId: string, modelId: string, messageId: string | null,
): Promise<Record<string, string>>
// key = `tts:${voiceId}:${await sha256Key(text + "|" + modelId)}`
// meta = { type: "tts", messageId, voiceId, textHash, createdAt }
```

> ‏**‏מפתחות — ‏מאומת ‏מול ‏schema+DB ‏של ACP (2026-06-01):**
> - `toolCallId` (‏למשל `toolu_018b...`) — ‏ID ‏ייחודי ‏גלובלית, ‏ממרחב-שמות ‏נפרד ‏מ-messageId. ‏מושלם ‏כמפתח narrate.
> - `messageId` (‏למשל `msg_e829...`) — ‏**‏משותף** ‏ל-thought+message ‏של ‏אותו turn (‏לא ‏מבחין ‏בין ‏סגמנטים), ‏**UNSTABLE** ‏ב-ACP spec, ‏**‏אופציונלי** (`null` ‏חוקי). ‏לכן **‏metadata ‏בלבד**, ‏אף ‏פעם ‏לא ‏במפתח. ‏שום ‏לוגיקה ‏לא ‏נשענת ‏על ‏קיומו.
> - `textHash` — ‏ה-anchor ‏היציב ‏ל-translate/tts (‏הטקסט ‏משוחזר ‏זהה ‏ב-replay).

**‏קבצים שמשתנים**:
- `narrate.ts` — ‏מעביר headers ‏ל-`generateText` (‏או ‏ל-provider, ‏לפי ‏הכרעת Commit 0)
- `translate.ts` — ‏מעביר headers ‏ל-`generateObject`
- `tts.ts` — ‏מוסיף headers ‏ל-`fetch` ‏הישיר ‏(‏הכי ‏פשוט — ‏שליטה ‏מלאה)
- `sdks.ts` — ‏אם Commit 0 ‏קבע ש-headers ‏עוברים ‏רק ‏דרך ‏ה-provider: ‏`googleAi()` ‏מקבל
  ‏param ‏אופציונלי `headers` ‏ומעביר ‏ל-`createGoogleGenerativeAI`
- `speaker.svelte.ts` — ‏מעביר `messageId` ‏(‏מה-job/‏bubble) ‏ל-translate/tts headers builder

> **‏Parallel-safe**: `narrate.ts`/`translate.ts`/`tts.ts` ‏הם adapters ‏ייעודיים — ‏שינוי
> ‏בהם ‏additive (‏הוספת headers). `speaker.svelte.ts` ‏הוא ‏קובץ ‏גדול ‏יותר — ‏עבוד ‏רק
> ‏בנקודות ‏הקריאה ‏ל-adapters (‏שורות 279, 295, 350). ‏אל ‏תיגע ‏בלוגיקת ‏ה-effect.

**Verification** (manual ‏ב-browser + integration):
```bash
pnpm typecheck && pnpm test --filter @drive-coding/frontend
pnpm lint:i18n   # ‏וודא ‏אין ‏מחרוזות ‏עברית ‏בקוד ‏חדש

# manual (‏הלב ‏של ‏ה-slice):
# 1. ‏הרץ BE+FE, ‏פתח ‏שיחה, ‏שלח prompt ‏שמפעיל tool (‏למשל "‏רשום ‏את ‏הקבצים ‏בתיקייה")
# 2. ‏Network tab: ‏וודא ‏ש-narrate/translate/tts ‏יוצאים ‏עם x-cache-key + x-cache-meta
# 3. ‏response header x-cache: miss (‏פעם ‏ראשונה)
# 4. ‏reload ‏(‏או ‏שלח ‏שוב ‏אותו ‏prompt) → x-cache: hit, ‏הנרטיב ‏זהה
# 5. ‏בדוק disk: ls data/cache/proxy/ → ‏יש ‏קבצי {key}, {key}.headers, {key}.meta
```

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | typecheck + build + tests (‏כולל core ‏אחרי ‏מעבר sha256Key) | `pnpm typecheck && pnpm build && pnpm test` |
| 2 | lint:i18n ‏נקי | `pnpm lint:i18n` |
| 2.5 | `sha256Key` ‏מ-core ‏זמין ‏ל-FE ‏ול-BE | `pnpm test --filter @drive-coding/core` ‏(‏טסט ‏דטרמיניזם) |
| 3 | x-cache-key ‏קובע ‏מפתח | integration test: ‏אותו key + body ‏שונה → hit |
| 4 | fallback ‏עובד | integration test: ‏בלי key → sha256(body), ‏התנהגות ‏ישנה |
| 5 | x-cache-* ‏לא ‏ל-upstream | integration test: mock fetch, ‏headers ‏נקיים |
| 6 | path traversal ‏חסום | integration test: key=`../x` ‏לא ‏בורח ‏מ-baseDir |
| 7 | meta ‏נשמר | integration test: set+get ‏מחזיר meta; ls disk ‏מראה {key}.meta |
| 8 | 3 ‏adapters ‏שולחים headers | Network tab: narrate+translate+tts ‏עם x-cache-key |
| 9 | reload → ‏נרטיב ‏זהה | manual: ‏שלח prompt ‏עם tool, reload, ‏אותו ‏נרטיב, x-cache:hit |
| 10 | regression: ‏השמעה ‏רגילה ‏עובדת | manual: ‏שיחה ‏קולית ‏חדשה, TTS ‏מתנגן ‏כרגיל |

‏לא "‏הכל עובד" — ‏checkbox ‏עם ‏פקודה ‏לכל ‏אחד.

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| Path traversal ‏מ-client key | client ‏קובע ‏שם-קובץ | `sanitizeCacheKey` = hash ‏את ‏ה-key. DoD #6 ‏בודק |
| `@ai-sdk/google` ‏לא ‏מעביר ‏header ‏פר-קריאה | AI SDK ‏API | Commit 0 ‏אימות 2. ‏אם ‏נכשל → escalate (‏tts ‏עדיין ‏עובד ‏עם fetch ‏ישיר) |
| OneCLI ‏חוסם x-* header | gateway ‏באמצע | Commit 0 ‏אימות 1. ‏אם ‏נחסם → escalate |
| `x-cache-meta` ‏עם ‏תווים ‏מיוחדים ‏שובר header | JSON ‏ב-header | meta ‏לא ‏מכיל ‏עברית/‏טקסט-‏חופשי (‏רק IDs+hashes+enums). ‏אם ‏בעתיד ‏כן → base64 |
| ‏Hardcoded Hebrew strings | ‏convention | pre-commit hook; `pnpm hooks:install` |
| ‏הקאש ‏גדל ‏בלי ‏גבול (‏אין eviction) | ‏קיים ‏היום, ‏לא ‏רגרסיה | ‏מחוץ ‏ל-scope. ‏לא ‏מחמיר ‏(‏אותו ‏מספר ‏רשומות, ‏פשוט ‏ממופתח ‏אחרת) |
| messageId ‏שונה/null ‏בין live ‏ל-reload | ACP UNSTABLE + opencode | ‏מובנה ‏בתכנון: messageId ‏רק metadata. ‏המפתח ‏לא ‏תלוי ‏בו |

> ‏3 ‏שתמיד נשכחים:
> 1. Hardcoded strings → i18n (‏ה-meta ‏enums ‏באנגלית — ‏ok, ‏לא ‏UI)
> 2. Reactivity gotchas — ‏לא ‏רלוונטי (‏אין ‏state ‏חדש ‏ב-VM)
> 3. OneCLI placeholder pattern — ‏רלוונטי! ‏ה-headers ‏נוספים ‏ליד ‏ה-placeholder keys ‏הקיימים

---

## §7 — Escalation triggers

> ‏אם X — ‏עצור ושאל את Tama:

- ‏Commit 0 ‏אימות 2 ‏נכשל (`@ai-sdk/google` ‏לא ‏מעביר ‏header ‏פר-קריאה) → ‏זו ‏הכרעה
  ‏ארכיטקטונית (‏אולי ‏"‏קריאות ‏ב-BE")
- OneCLI ‏מסיר/‏חוסם x-* header → BE proxy ‏לא ‏מועבר ‏כצפוי
- ‏גילית ‏ש-`isCacheableRequest` ‏צריך ‏שינוי ‏כדי ‏לתמוך ‏ב-client key (‏הוא ‏לא ‏אמור — ‏המפתח ‏משתנה, ‏לא ‏ה-cacheability)
- ‏ה-brief ‏סותר ‏את ‏עצמו
- ‏אתה ‏רוצה ‏לסטות ‏מ-Testing strategy (integration ‏ל-BE, manual ‏ל-FE)

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|------|------|
| Protocol contract ‏חדש (x-cache-key/meta header) | +2 |
| Cross-store data flow (FE adapter → BE proxy → disk) | +2 |
| Refactor ‏של ‏קוד ‏קיים (http-proxy, proxy-cache) | +1 |
| >5 files ‏ב->2 packages | +1 |
| ‏ספרייה ‏חיצונית (AI SDK header API — ‏unknown) | +1 |
| Pure logic ‏חלקי (sanitize-key, builders ‏טהורים) | -1 |
| Greenfield ‏חלקי (cache-headers.ts ‏חדש) | -1 |

**Score**: 5 / 10

**Tier**: 4-7 → `verifier-slice-light` + `verifier-phase` ‏על Commit 1 (‏ה-BE — ‏לב ‏האבטחה ‏וה-fallback)

**‏Verifier-phase ‏אחרי**: Commit 1 (‏לוודא path-traversal ‏חסום, fallback ‏לא ‏נשבר, headers ‏לא ‏דולפים ‏ל-upstream — ‏לפני ‏שה-FE ‏נבנה ‏עליו)

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | `sanitizeCacheKey` = hash ‏או ‏regex-replace? | hash(clientKey) — ‏בטוח ‏יותר | ❌ |
| 2 | ‏האם ‏לשמור ‏את ‏ה-key ‏הקריא ‏ב-meta (‏אם ‏מ-hash-ים)? | ‏כן — ‏ל-‏מחיקה ‏סלקטיבית ‏עתידית | ❌ |
| 3 | ‏tts ‏כבר ‏כמעט-דטרמיניסטי — ‏צריך ‏client-key? | ‏כן, ‏לאחידות + meta ‏tagging | ❌ |
| 4 | Commit 0: ‏איזו header API ‏ב-`@ai-sdk/google`? | ‏יוכרע ‏בספייק | ✅ (‏ספייק ‏מכריע) |

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor ‏תוך כדי)

> ‏ה-executor ‏מתעד ‏פה ‏כל ‏סטייה ‏מה-brief ‏ולמה.

- ...
