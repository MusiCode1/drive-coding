# Slice 15c — Adapter Migration to beUrl() — תוכנית

> **‏תאריך**: 2026-05-29
> **‏סטטוס**: ‏מאושר — ‏פאזה 3 ‏מתוך 4 ‏של slice 15 (CF deployment family)
> **‏Complexity**: 4/10 (verifier: ‏אין — ‏נכלל ב-verifier-slice-light בסוף slice 15)
> **‏תלות**: 15a (CORS — ‏נדרש להבחירה Cross-origin בפועל), 15b (Settings.beUrl)
> **‏מתבסס על**: `docs/plans/README.md`, `packages/frontend/AGENTS.md`

---

## §0 — Pre-flight

‏⚠️ **‏אתה ה-executor** — ‏אל תdelegate. ‏ראה `EXECUTOR_DISPATCH.md §0`.

‏ממשיך באותו worktree `.worktrees/slice-15-cf-deployment/`. ‏15a + 15b ‏כבר ב-commits ‏לפני.

```bash
# ‏BE על port 4002 (לבדיקת cross-origin אמיתי דרך Vite proxy של ה-FE עצמו לא מספיק — צריך לעקוף)
cd packages/backend
CORS_ORIGINS="*" PORT=4002 onecli run --agent voice-acp -- bun --watch src/server.ts &

# FE
cd packages/frontend
BE_PORT=4002 pnpm --filter @drive-coding/frontend-v2 dev
```

‏Reading list (must-read, ~‎15 ‏דק'):

‏- `packages/frontend/AGENTS.md` — ‏5 חוקי הזהב
‏- `packages/frontend/src/lib/adapters/voice/sdks.ts` — **‏לקרוא כל הקובץ (42 שורות)**. ‏שני SDKs נפרדים עם שני casing שונים (`baseURL` vs `httpOptions.baseUrl`)
‏- `packages/frontend/src/lib/adapters/voice/transcribe.ts:22,47` — ‏משתמש ב-`googleGenAi` (SDK שני)
‏- `packages/frontend/src/lib/adapters/voice/translate.ts` — ‏משתמש ב-`googleAi`
‏- `packages/frontend/src/lib/adapters/agents-api.ts:24,37,45,53` — ‏4 ‏fetch calls
‏- `packages/frontend/src/lib/adapters/sessions.ts:49` (WS URL)
‏- `packages/frontend/src/lib/adapters/voice/tts.ts:11,26`
‏- `packages/frontend/src/lib/adapters/voice/voices.ts:11,31`
‏- `packages/frontend/src/lib/view-models/agent-session.svelte.ts:83,184` (WS URLs)
‏- `packages/frontend/src/lib/view-models/settings.svelte.ts` — ‏לראות את `beUrl` ‏שנוסף ב-15b

‏reference:

‏- ‏slice 15a brief (CORS endpoint behavior)
‏- ‏slice 15b brief (Settings.beUrl shape)
‏- ‏learnings 2026-05-16 "OneCLI + AI SDK = placeholder apiKey pattern"

---

## §1 — מטרה

‏אחרי 15c: ‏כל קריאות ה-FE ל-BE עוברות דרך פונקציה אחת `beUrl(path)`. ‏אם Settings.beUrl ריק → ‏URL יחסי (כמו עכשיו, Vite proxy ב-dev). ‏אם Settings.beUrl מלא → ‏fetch לכתובת המלאה (cross-origin, CORS פעיל מ-15a).

‏החוויה: ‏המשתמש פותח /settings ‏מ-CF, ‏מקליד `https://my-be.example.com`, ‏חוזר ל-/, ‏הconnect form עובד מול ה-BE המרוחק. ‏TTS, ‏Gemini, ‏WS — ‏כולם מצביעים לBE המרוחק.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
‏| `util/be-url.ts` ‏עם module-level state + 3 exports | ✅ | Commit 1 |
‏| ‏Settings VM ‏חיווט ל-`setBeUrlBase()` ב-constructor + setBeUrl | ✅ | Commit 1 |
‏| ‏Tests ל-util (TDD) ~‎10 | ✅ | Commit 1 |
‏| ‏Migration של 3 ‏HTTP adapters (agents-api, tts, voices) | ✅ | Commit 2 |
‏| ‏Refactor sdks.ts ל-factory pattern (2 SDKs) | ✅ | Commit 2 |
‏| ‏transcribe.ts ‏caller update (`googleGenAi()` עם סוגריים) | ✅ | Commit 2 |
‏| ‏Migration של WS URLs (agent-session + sessions) | ✅ | Commit 3 |
‏| ‏Backward compat: ‏empty beUrl → ‏location.origin (Vite proxy) | ✅ | Commit 1 |
‏| ‏Reactivity ‏על שינוי Settings.beUrl בruntime | ✅ | Commit 1 (`setBeUrlBase` מעדכן) |
‏| ‏הודעת שגיאה ידידותית כש-BE URL לא נגיש | ❌ | future |

---

## §3 — Architecture

‏**מפתח: ‏module-level `_beUrl` ‏variable**, ‏לא Svelte context API.

‏Svelte context (`getSettings()`) ‏זמין רק בתוך component setup. ‏ב-module init של adapters (sdks.ts ‏רץ מודלוד) — ‏זה זורק `lifecycle_outside_component`. ‏לכן: ‏`util/be-url.ts` ‏מחזיק module variable, ‏Settings VM ‏מעדכן אותו ב-constructor ‏ו-ב-`setBeUrl`. ‏adapters קוראים ל-`beUrl(path)` ‏בכל call (לא ב-module init).

```
‏לפני:                                  ‏אחרי:
fetch("/api/agents")                    fetch(beUrl("/api/agents"))
                                         ↓ _beUrl === ""
                                        fetch("http://localhost:5173/api/agents")
                                         ↓ _beUrl === "https://be.example.com"
                                        fetch("https://be.example.com/api/agents")

new WsAcpTransport(                     new WsAcpTransport(beWsUrl(`/ws/agent/${id}`))
  `${proto}//${location.host}/ws         ↓ _beUrl === ""
   /agent/${id}`)                       ws://localhost:5173/ws/...
                                         ↓ _beUrl === "https://..."
                                        wss://be.example.com/ws/...

‏SDKs (sdks.ts) — ‏factory pattern:
  export const googleAi = createGoogleGenerativeAI({...})  // ‏module init, _beUrl ‏לא מוכן
                                         ↓
  export function googleAi(model: string) {              // ‏לכל call
    return createGoogleGenerativeAI({...baseURL: beUrl("/proxy/google/v1beta")})(model)
  }

  export const googleGenAi = new GoogleGenAI({...})       // ‏module init
                                         ↓
  export function googleGenAi() {                         // ‏לכל call
    return new GoogleGenAI({...httpOptions: { baseUrl: beUrl("/proxy/google/") }})
  }
```

‏**Settings updates _beUrl** (slice 15b כבר נכתב ככה, ‏אבל 15c ‏מקשר):
‏- ‏Settings constructor: ‏אחרי `this.beUrl = loaded.beUrl`, ‏קורא ‏`setBeUrlBase(this.beUrl)`
‏- ‏Settings.setBeUrl: ‏אחרי `this.beUrl = trimmed`, ‏קורא `setBeUrlBase(this.beUrl)`

---

## §4 — Commits

### Commit 1 — `util/be-url.ts` + Settings wiring + tests (approach: TDD)

‏**מטרה**: ‏module-level state + 3 ‏exports. ‏Settings ‏מ-15b ‏מחווט אליו.

‏**קבצים חדשים**:

| ‏קובץ | ‏מטרה |
|---|---|
‏| `packages/frontend/src/lib/util/be-url.ts` | `setBeUrlBase()` + `beUrl(path)` + `beWsUrl(path)` |
‏| `packages/frontend/src/lib/util/be-url.test.ts` | TDD: ~‎10 ‏tests |

‏**קבצים שמשתנים** (חיווט מ-Settings):

| ‏קובץ | ‏שינוי |
|---|---|
‏| `packages/frontend/src/lib/view-models/settings.svelte.ts` | (1) import `setBeUrlBase`. ‏(2) ‏ב-constructor אחרי `this.beUrl = loaded.beUrl`: `setBeUrlBase(this.beUrl)`. ‏(3) ‏ב-setBeUrl אחרי `this.beUrl = trimmed`: `setBeUrlBase(this.beUrl)` |

‏**API skeleton**:

```ts
// util/be-url.ts — ‏לא משתמש ב-Svelte context (הוא לא יכול ב-module init של adapters)

let _beUrl = ""

/**
 * Called by Settings VM on load + on user save.
 * Module-level state — outside Svelte context API, so adapters can read it
 * during their module init (sdks.ts) without lifecycle errors.
 */
export function setBeUrlBase(value: string): void {
  _beUrl = value.replace(/\/$/, "")
}

/**
 * Build absolute BE URL for fetch().
 *
 * Empty _beUrl → uses location.origin (Vite proxy handles same-origin paths).
 * Set _beUrl → uses that base (cross-origin, needs CORS).
 * SSR → returns path as-is (no fetch in SSR).
 */
export function beUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`
  if (_beUrl !== "") return `${_beUrl}${normalized}`
  if (typeof location === "undefined") return normalized  // SSR
  return `${location.origin}${normalized}`
}

/**
 * Build BE WebSocket URL. Same logic but http → ws, https → wss.
 */
export function beWsUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`
  if (_beUrl !== "") return _beUrl.replace(/^http/, "ws") + normalized
  if (typeof location === "undefined") return `ws://ssr-stub${normalized}`
  const proto = location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${location.host}${normalized}`
}

/** Testing only — reset internal state between tests. */
export function _resetForTests(): void {
  _beUrl = ""
}
```

‏**Tests skeleton**:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { beUrl, beWsUrl, setBeUrlBase, _resetForTests } from "./be-url"

describe("be-url", () => {
  beforeEach(() => {
    _resetForTests()
    vi.stubGlobal("location", { origin: "http://localhost:5173", protocol: "http:", host: "localhost:5173" })
  })

  it("empty base → uses location.origin", () => {
    expect(beUrl("/api/agents")).toBe("http://localhost:5173/api/agents")
  })
  it("set base → uses base", () => {
    setBeUrlBase("https://be.example.com")
    expect(beUrl("/api/agents")).toBe("https://be.example.com/api/agents")
  })
  it("strips trailing slash from base", () => {
    setBeUrlBase("https://be.example.com/")
    expect(beUrl("/api/agents")).toBe("https://be.example.com/api/agents")
  })
  it("normalizes path without leading slash", () => {
    expect(beUrl("api/agents")).toBe("http://localhost:5173/api/agents")
  })

  it("beWsUrl empty base → ws://", () => {
    expect(beWsUrl("/ws/agent/abc")).toBe("ws://localhost:5173/ws/agent/abc")
  })
  it("beWsUrl https base → wss://", () => {
    setBeUrlBase("https://be.example.com")
    expect(beWsUrl("/ws/agent/abc")).toBe("wss://be.example.com/ws/agent/abc")
  })
  it("beWsUrl http base → ws://", () => {
    setBeUrlBase("http://localhost:4002")
    expect(beWsUrl("/ws/agent/abc")).toBe("ws://localhost:4002/ws/agent/abc")
  })
  it("SSR safe — beUrl without location", () => {
    vi.unstubAllGlobals()
    expect(beUrl("/api/x")).toBe("/api/x")
  })
})
```

‏**Verification**:

```bash
pnpm test  # be-url.test.ts + settings.test.svelte.ts (15b הקיים)
pnpm --filter @drive-coding/frontend-v2 typecheck
```

---

### Commit 2 — Migration של HTTP adapters + SDK factories (approach: manual)

‏**מטרה**: ‏החלפת fetch URL ב-3 ‏HTTP adapters + ‏הפיכת sdks.ts ל-factory pattern (שני SDKs).

‏**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי | ‏מיקומים |
|---|---|---|
‏| `packages/frontend/src/lib/adapters/agents-api.ts` | 4 ‏fetch calls — ‏עטוף ב-`beUrl(...)` + ‏import | ‏שורות 24, 37, 45, 53 |
‏| `packages/frontend/src/lib/adapters/voice/tts.ts` | `fetch(beUrl("/proxy/elevenlabs/v1/text-to-speech/${voiceId}/stream"))` | ‏שורות 13, 26 (PROXY_BASE → ‏inline בfetch) |
‏| `packages/frontend/src/lib/adapters/voice/voices.ts` | ‏אותו דבר | ‏שורות 11, 31 |
‏| `packages/frontend/src/lib/adapters/voice/sdks.ts` | ‏refactor מ-consts ל-functions (factory). ‏שני SDKs נפרדים, ‏casing שונה | ‏כל הקובץ |
‏| `packages/frontend/src/lib/adapters/voice/transcribe.ts` | ‏שורה 47: `googleGenAi.models.generateContent(...)` → `googleGenAi().models.generateContent(...)` | ‏שורה 47 |

‏**הערה — ‏translate + narrate לא משתנים**: ‏הם משתמשים ב-`googleAi("model-name")`. ‏הsignature נשמר זהה (function שמקבלת model string ‏ומחזירה model object). ‏שום שינוי בcallers.

‏**SDK factory skeleton — `sdks.ts` החלפה מלאה**:

```ts
// adapters/voice/sdks.ts (after migration)
/**
 * Two SDKs, two casing conventions (CRIT-1 from audit):
 *   @ai-sdk/google  → baseURL  — for generateText (translate, narrate)
 *   @google/genai   → httpOptions.baseUrl — for generateContent + multimodal (STT)
 *
 * Both are now factories: created on each call with current beUrl().
 * This ensures Settings.beUrl changes are picked up without restart.
 *
 * apiKey "browser-placeholder" is intentional — OneCLI proxy replaces it.
 * See learnings 2026-05-16: "OneCLI + AI SDK = placeholder apiKey pattern"
 */
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { GoogleGenAI } from "@google/genai"
import { beUrl } from "$lib/util/be-url"

/**
 * For translation + narration — `generateText` / `generateObject` from `@ai-sdk/google`.
 * Callers use: googleAi("gemini-flash-lite-latest")
 * Same signature as before (was const, now function). No caller changes needed.
 */
export function googleAi(model: string) {
  const provider = createGoogleGenerativeAI({
    apiKey: "browser-placeholder",
    baseURL: beUrl("/proxy/google/v1beta"),
  })
  return provider(model)
}

/**
 * For STT — `@google/genai` multimodal.
 * Note `httpOptions.baseUrl` (lowercase u) AND trailing slash — required.
 * Callers use: googleGenAi().models.generateContent(...)
 * Caller change: googleGenAi → googleGenAi() (one call site: transcribe.ts:47)
 */
export function googleGenAi(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: "browser-placeholder",
    httpOptions: { baseUrl: beUrl("/proxy/google/") },
  })
}
```

‏**גוטשה — ‏`@google/genai` ‏דורש absolute URL**: ‏ה-SDK עושה `new URL(httpOptions.baseUrl)` eagerly. ‏`beUrl()` ‏שלנו תמיד מחזיר absolute (בdev: ‏`http://localhost:5173/proxy/google/`, ‏בprod: ‏`https://be.example.com/proxy/google/`). ‏עובד.

‏**גוטשה — ‏cost של factory**: ‏כל call ל-`googleAi(model)` יוצר provider חדש. ‏ב-translate/narrate ‏זה ~‎10 calls בdebug session. ‏overhead זניח (~‎0.1ms). ‏אם בעיה בperf — ‏slice עתידי יכול ל-cache.

‏**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 build
pnpm lint:i18n
# ‏ידני:
# ‏1. ‏Settings.beUrl ‏ריק — ‏connect + chat + TTS + STT עובדים כרגיל
# ‏2. ‏BE על port 4002 עם CORS_ORIGINS=* + Settings.beUrl=http://localhost:4002:
#    - ‏connect → ‏עובד cross-origin
#    - ‏TTS → ‏עובד (audio playback)
#    - ‏STT (slice 3) → ‏עובד (record + transcribe)
# ‏3. ‏smoke chat-roundtrip.mjs ‏עובר ‏בdefault (beUrl ריק)
```

---

### Commit 3 — Migration של WS URLs (approach: manual)

‏**מטרה**: ‏החלפת WS URL ב-2 מקומות.

‏**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי | ‏שורות מקור |
|---|---|---|
‏| `packages/frontend/src/lib/view-models/agent-session.svelte.ts` | 2 ‏מקומות בונים URL — ‏עטוף ב-`beWsUrl("/ws/agent/${agentId}")` | ‏שורות 83, 184 |
‏| `packages/frontend/src/lib/adapters/sessions.ts` | ‏אותו דבר | ‏שורה 49 |

‏**Skeleton**:

```ts
// agent-session.svelte.ts (before)
const transport = new WsAcpTransport(`${proto}//${location.host}/ws/agent/${agentId}`)

// (after)
import { beWsUrl } from "$lib/util/be-url"
const transport = new WsAcpTransport(beWsUrl(`/ws/agent/${agentId}`))
```

‏**גוטשה — ‏בדיקה ידנית של WS**: ‏ב-dev עם Vite proxy, ‏ה-WS עובד דרך Vite. ‏ב-cross-origin (BE על port אחר) — ‏Vite proxy עוקף, ‏הfetch הולך ישיר. ‏Hono cors מטפל אוטומטית גם ב-upgrade. ‏אם WS לא עובד — ‏לבדוק ב-DevTools Network → WS tab.

‏**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 build
# ‏ידני:
# ‏1. ‏Settings.beUrl ‏ריק → ‏chat WS עובד (Vite proxy)
# ‏2. ‏Settings.beUrl = http://localhost:4002 → ‏chat WS עובד cross-origin
# ‏3. ‏F5 → ‏reconnect → ‏עדיין עובד עם Settings.beUrl ‏שנשמר
```

---

### Commit 4 — Walkthrough + slices.md status (approach: manual)

‏**מטרה**: ‏עדכון יומן הפיתוח, ‏סטטוס slice 15 ‏ל-✅ ‏ב-slices.md.

‏**קבצים שמשתנים**:

‏- ‏`docs/walkthrough.md` — ‏רשומה חדשה ב-Top (slice 15: CF deployment family — ‏פירוט 4 פאזות)
‏- ‏`packages/frontend/docs/slices.md` — ‏פוסל "slice 15 — Backend URL config + CF deployment" ‏אחרי slice 14 ‏בטבלה, ‏סטטוס ✅
‏- ‏`docs/plans/slice-15{a,b,c,d}-*.md` — ‏סטטוס → "‏הושלם"

---

## §5 — DoD

| # | ‏בדיקה | ‏איך |
|---|---|---|
‏| 1 | typecheck FE + BE | ‏אוטומטי |
‏| 2 | tests עוברים + ~‎10 ‏חדשים ל-be-url | ‏אוטומטי |
‏| 3 | build FE | ‏אוטומטי |
‏| 4 | lint:i18n | ‏אוטומטי |
‏| 5 | smoke `chat-roundtrip.mjs` ‏עובר ב-default mode (beUrl ריק) | `node tests/smoke/chat-roundtrip.mjs` |
‏| 6 | ‏Settings.beUrl ריק → chat עובד כרגיל | ‏ידני |
‏| 7 | ‏Settings.beUrl = http://localhost:4002 → ‏chat עובד cross-origin (BE עם CORS_ORIGINS=*) | ‏ידני (BE על 4002, FE על 4000 Vite מצביע ל-4000 ‏אבל fetch הולך ישיר ל-4002) |
‏| 8 | ‏TTS עובד cross-origin | ‏ידני: ‏לחץ Speaker, ‏שמע אודיו |
‏| 9 | ‏WS עובד cross-origin | ‏ידני: ‏שלח prompt, ‏ראה chunks חוזרים |
‏| 10 | ‏Settings.beUrl ‏invalid → ‏שגיאה ברורה ב-console (לא קריסה) | ‏ידני |

---

## §6 — Risks + mitigations

| # | ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|---|
‏| 1 | SDKs (Google AI) ‏לא reactive על Settings.beUrl | architecture | factory pattern ‏ב-sdks.ts (יוצר ‏כל call) — ‏מומלץ. ‏Alt: ‏לעדכן ‏רק בreconnect |
‏| 2 | WS URL ‏מעבר ל-wss בcross-origin | TLS | ‏אם BE על http (לוקאלי) → ‏Settings.beUrl = http://... → wsUrl = ws://... (לא wss). ‏רק ב-https → wss. ‏OK |
‏| 3 | ‏CORS preflight על TTS stream | learnings | ‏Hono cors ‏מטפל. ‏אם בעיה — ‏slice 15a פירוט |
‏| 4 | localStorage Settings.beUrl ‏לא zamloaded ב-time לCall ‏ראשון | timing | ‏Settings.constructor ‏קורא ‏ב-`#load()`. ‏זה רץ ‏בlayout setup ‏לפני שroutes מתחילים fetch. ‏OK |
‏| 5 | Vite proxy ‏עובר על URLs מוחלטים? | Vite | ‏Vite proxy ‏רק על URLs יחסיים. ‏מוחלטים → ‏fetch ‏ישיר. ‏זה הרצוי |
‏| 6 | ‏SSR crash (browser-only context) | ‏Svelte | ‏ה-`browser` guard ‏ב-`util/be-url.ts` + ‏Settings VM כבר עוטף |
‏| 7 | OneCLI placeholder pattern נשבר על baseUrl ‏שונה | learnings 2026-05-16 | OneCLI ‏מזריק לפי host של ה-request. ‏אם beUrl מצביע ל-host שלא רשום ב-OneCLI agent — ‏401. ‏רק לוקאלי דרך onecli proxy. ‏ב-CF deployment, ‏BE מקבל credentials ‏ב-spawn (כפי שהיום), ‏FE ‏לא מזריק |

---

## §7 — Escalation triggers

‏עצור ושאל את Tama אם:

‏1. ‏SDK factory pattern (`googleAi(...)`) ‏יוצר infinite loop ‏ב-`$state` (sdk.create קורא ל-beUrl שקורא ל-getSettings → ‏אם בתוך $effect, ‏tracking יחזור)
‏2. ‏WS cross-origin נכשל באופן עקבי גם עם CORS פתוח
‏3. ‏OneCLI proxy לא תופס בקשות שעוקפות את Vite proxy (כל cross-origin → ‏FE ישיר → BE → ‏proxy)
‏4. ‏Vite מתעקש לעקוף URLs מוחלטים ‏(אמור לא — ‏לפי docs)

‏אחרת: ‏החלט והמשך.

---

## §8 — Complexity score: 4/10

| ‏פקטור | ‏ניקוד |
|---|---|
‏| ‏מספר commits (4) | +1 |
‏| ‏שכבות (util + adapters + VM) | +1 |
‏| ‏Mass migration (8 ‏קבצים) | +1 |
‏| ‏SDK reactivity refactor | +1 |
‏| ‏סה"כ | **4** |

‏**Verifier**: ‏בסוף slice 15c — ‏`verifier-slice-light` ‏על כל slice 15 ‏(a+b+c). ‏15d נפרד.

‏**brief לverifier**:

```
‏בדוק slice 15 ‏שלבים a+b+c בbranch slice-15-cf-deployment ב-worktree
.worktrees/slice-15-cf-deployment/. ‏Briefs:
- ‏docs/plans/slice-15a-be-cors.md
- ‏docs/plans/slice-15b-settings-page.md
- ‏docs/plans/slice-15c-adapter-migration.md
‏Base commit: <commit hash של dev tip בעת התחלת ה-worktree>
‏בדוק את ה-DoDs של 3 הbriefs. ‏הרץ smoke + ‏חוויה ידנית עם BE על port אחר + Settings.beUrl.
‏אם NEEDS REVISION — ‏פירוט. ‏אם GO — ‏מוכן ל-merge.
```

---

## §9 — שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
‏| 1 | SDK reactivity — factory ‏או cached? | factory ‏(כל call ‏יוצר provider). ‏עלות זניחה | ❌ |
‏| 2 | ‏מה ‏אם user מקליד `http://` ‏ב-Settings.beUrl ‏מ-CF (mixed content)? | Browser יחסום אוטומטית. ‏אזהרה ‏ב-help text ‏של ה-input | ❌ |
‏| 3 | ‏WS reconnect אחרי שינוי Settings.beUrl ‏ב-runtime | ‏לא בscope. ‏המשתמש F5 ‏לקבל transport חדש. ‏slice עתידי | ❌ |
‏| 4 | ‏אזכור Settings.beUrl ‏גם ב-VM ‏אחרים (Mic? Speaker?) | ‏לא — ‏רק adapters. ‏VMs לא יודעים על BE URL | ❌ |

---

## §10 — מה הלאה

**‏הפאזה הבאה: ‏slice 15d** (CF deployment). ‏ייכתב אחרי שיחה עם Tama על:

‏- ‏CF account (יש לה wrangler מותקן? ‏מחובר?)
‏- ‏Domain (`voice-acp.example.com` ‏או אחר?)
‏- ‏בחירה: ‏CF Pages או CF Tunnel?

‏עד שיש החלטות, ‏15d בdraft.

‏**Verifier-slice-light עכשיו**: ‏לפני slice 15d, ‏אחרי 15c עבר verifier — ‏Tama תעשה merge של branch slice-15-cf-deployment ל-dev. ‏15d ‏ייעשה ב-worktree נפרד.
