# Slice — tts-usage-metering — תוכנית

> **תאריך**: 2026-07-02
> **סטטוס**: ‏הושלם (‏אליעזר — 2026-07-02; 4 commits: 29e9e5b..76bb8b7 ב-branch slice/tts-usage-metering; calev-heavy pending)
> **Complexity**: 8/10 (verifier: heavy)
> **תלות**: ‏אין (base=dev, depends_on=[]). ‏עצמאי מ-`tts-provider-availability` — ‏אפשר מקביל (‏שניהם additive ב-`server.ts`).

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/tts-usage-metering -b slice/tts-usage-metering dev
cd .worktrees/tts-usage-metering
pnpm install && pnpm hooks:install
```

### Run
- ‏BE (‏דרך OneCLI — ‏חובה ל-TTS חי): `cd packages/backend && PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts`
- ‏FE: `pnpm --filter @drive-coding/frontend dev`
- ‏Tests: `pnpm --filter @drive-coding/core test` · `pnpm --filter @drive-coding/backend test`
- ‏**‏אימות חי**: ‏פתח שיחה, ‏הפעל TTS (‏ElevenLabs ‏ו-Gemini), ‏ואז `curl localhost:4000/api/usage/summary`.

### Browser
- ‏Chrome רגיל על localhost (‏אין UI ב-slice זה — ‏האימות דרך curl/‏קבצים).

### OneCLI agent
- ‏שם: `voice-acp`. **‏קריטי**: ‏Gemini ‏מחזיר `usageMetadata` ‏רק בקריאה אמיתית ל-upstream (‏cache-miss) — ‏ודא מפתחות תקפים.

### Reading list
**‏must-read לפני**:
- `packages/backend/src/delivery/http-proxy.ts` ‏(‏כל הקובץ, 235 ‏שורות — ‏ה-choke-point; ‏שים לב ל-cache-hit ‏שורות 104-117, ‏tee ‏שורות 166-193, ‏`cacheStreamInBackground` ‏205-234)
- `packages/backend/src/app/projects-registry.ts` ‏(‏תקדים JSON-store persistence)
- `packages/backend/src/delivery/wire-recorder.ts` ‏(‏תקדים NDJSON append-log)
- `packages/frontend/src/lib/adapters/voice/tts-gemini.ts` §‏שורות 19-59 (‏מבנה בקשת Gemini: `contents[].parts[].text`) — **‏עוברת דרך SDK `googleGenAi()`** (`sdks.ts:46-51`, ‏baseUrl `/proxy/google/`)
- `packages/frontend/src/lib/adapters/voice/tts.ts` §‏שורות 24-68 (‏מבנה בקשת ElevenLabs: `{text, model_id}`)
- `packages/backend/src/delivery/proxy-cache.ts` §‏שורות 36-40 (`isCacheableRequest` — **‏קריטי**: ‏Gemini TTS **‏uncacheable**, ‏ראה §‏"‏מבנה ה-tap פר-ספק" ‏למטה)

### מבנה ה-tap פר-ספק — ‏חובה לקרוא לפני Commit 3
‏שני הספקים נספרים בשתי נקודות **‏שונות** ‏ב-`http-proxy.ts`, ‏כי ה-cache מתנהג שונה:
- ‏**‏ElevenLabs** (`/proxy/elevenlabs/v1/text-to-speech/{voiceId}/stream`) — **‏cacheable** (`proxy-cache.ts:39`). ‏יש כבר `tee` ‏בבלוק ה-cache (‏שורות 166-193) + ‏branch cache-hit (‏104-117). ‏הספירה: ‏chars ‏מה-**‏request body** (‏פשוט, ‏לא צריך את ה-response).
- ‏**‏Gemini** (`/proxy/google/v1beta/models/{model}:streamGenerateContent?alt=sse`) — **‏uncacheable** (`proxy-cache.ts:36-37`: ‏regex תופס רק `:generateContent`, ‏לא `:streamGenerateContent`). ‏הבקשה **‏אינה** ‏עוברת בבלוק ה-cache — ‏היא נופלת ל-**‏transparent-forward** (‏שורות 196-199) ‏שבו **‏אין tee כלל**. ‏הספירה דורשת **‏tee חדש** ‏שנוסיף שם (‏ראה Commit 3), ‏מ-ה-**‏response** (‏usageMetadata ‏ב-SSE). ‏**‏אין** ‏cache-branch לשמש בו — ‏אל תנסה להרחיב את הבלוק ה-cacheable.

**‏reference**:
- ‏`@google/genai` types: ‏`GenerateContentResponseUsageMetadata` (`genai.d.ts:4533`) — `promptTokenCount`/`candidatesTokenCount`/`totalTokenCount`, ‏וכן `candidatesTokensDetails?: ModalityTokenCount[]` (‏פירוק פר-modality, ‏ה-audio-count המדויק).

## §1 — מטרה

‏כל קריאת-TTS שעוברת ב-proxy נספרת ב-BE ‏(‏choke-point יחיד): ‏מספר-קריאות, ‏cache-hits ‏מול cache-misses, ‏ונפח-שימוש **‏מדויק** ‏פר-ספק — ‏תווי-קלט ל-ElevenLabs (‏מדויק, ‏החיוב per-char), ‏ו-token counts ‏(`promptTokenCount`+`candidatesTokenCount`) ‏ל-Gemini ‏מתוך ה-`usageMetadata` ‏שמגיע ב-SSE. ‏מכל אלה מחושבת **‏עלות-משוערת ($)** ‏לפי טבלת-מחירים סטטית. ‏המונים נשמרים ל-`data/usage/totals.json` (‏שורדים restart) ‏ובמקביל נכתב `data/usage/events.jsonl` (‏שורה-לקריאה, ‏audit/‏פילוח-עתידי). ‏endpoint `GET /api/usage/summary` ‏חושף את הסיכום. **‏אין UI ב-slice זה** — ‏רק תשתית BE.

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ‏ספירה ב-choke-point + persistence + endpoint | ✅ | ‏כאן |
| ‏עלות רק על cache-miss (‏hit=$0) | ✅ | ‏כאן |
| ‏UI ‏להצגת summary בהגדרות | ❌ | ‏slice עתידי (`tts-usage-ui`) |
| ‏character_count/limit ‏מ-subscription API | ❌ | ‏slice `tts-quota-subscription` |
| ‏השבתת ספק ללא-מפתח | ❌ | ‏slice `tts-provider-availability` |
| ‏reset/‏מחיקת מונים ‏(‏endpoint) | ❌ | ‏עם ה-UI ‏העתידי |
| ‏פילוח לפי חודש/‏טווח | ❌ | ‏events.jsonl ‏מונח כתשתית; ‏aggregation ‏עתידי |

## §3 — Architecture diagram

```
core (pure / TDD)                     backend
─────────────────                     ───────
usage/pricing.ts   ← חדש              usage/usage-store.ts   ← חדש
  elevenLabsCostUsd(chars)              in-memory counters + flush → <state>/usage/totals.json
  geminiCostUsd(inTok, audioTok)        + append → <state>/usage/events.jsonl
  TTS_PRICING (snapshot + מקורות)       <state> = ensureStateSubdir("usage") = ~/.config/drive-coding/usage/
usage/extract.ts   ← חדש               load on boot · flush debounced + on-shutdown
  extractElevenLabsChars(body)                 ▲ recordUsage(event)
  extractGeminiUsage(sseBytes)                 │
  → {inputTokens, audioTokens}         http-proxy.ts (משתנה — שני hooks נפרדים):
                                         • elevenlabs (cacheable): chars מ-request body;
                                           cache-hit (104-117)=req++/cost0 · miss בבלוק tee (166-193)
                                         • google (UNcacheable): tee חדש על transparent-forward
                                           (196-199) → extractGeminiUsage מ-response SSE
                                              │
                                       http-usage.ts   ← חדש (delivery)
                                         GET /api/usage/summary
```

## §4 — Commits

### Commit 0 — core: pricing (approach: TDD)
**‏קובץ חדש**: `packages/core/src/usage/pricing.ts` + ‏`pricing.test.ts`
**‏API skeleton**:
```ts
// Pricing snapshot 2026-07-02 — עדכן ידנית. מקורות בהערות ליד כל מספר.
export const TTS_PRICING = {
  elevenlabs: { usdPer1kChars: 0.18 },        // Creator tier ~$0.17-0.20/1k. https://elevenlabs.io/pricing
  google: {                                    // gemini-3.1-flash-tts-preview, standard tier
    usdPer1mInputTokens: 1.0,                  // https://ai.google.dev/gemini-api/docs/pricing
    usdPer1mAudioTokens: 20.0,
  },
} as const

export function elevenLabsCostUsd(chars: number): number
export function geminiCostUsd(inputTokens: number, audioTokens: number): number
```
**‏Verification**: `pnpm --filter @drive-coding/core test pricing`

### Commit 1 — core: extractors (approach: TDD)
**‏קובץ חדש**: `packages/core/src/usage/extract.ts` + ‏`extract.test.ts`
**‏API skeleton**:
```ts
/** ElevenLabs request body JSON → char count of the `text` field (0 on parse fail). */
export function extractElevenLabsChars(body: Uint8Array | string): number

export type GeminiUsage = { inputTokens: number; audioTokens: number }
/** Parses Gemini streamGenerateContent SSE/JSON-array bytes; reads the LAST usageMetadata seen.
 *  promptTokenCount → inputTokens, audio-count → audioTokens (see note). Zeros if absent. */
export function extractGeminiUsage(responseBytes: Uint8Array | string): GeminiUsage
```
**‏הערות למימוש**:
- ‏Gemini streaming ‏מחזיר SSE ‏(`?alt=sse`) ‏של `GenerateContentResponse`; ‏ה-`usageMetadata` ‏מופיע ב-chunk האחרון (‏ולעיתים מצטבר) — ‏קח את **‏האחרון** ‏שנראה.
- ‏**‏audioTokens** (‏אביגיל finding #3): ‏קדימות ל-`usageMetadata.candidatesTokensDetails[]` (`ModalityTokenCount[]`, `genai.d.ts:4541`) — ‏חפש את ה-entry עם `modality==="AUDIO"` ‏ל-count המדויק. ‏**‏fallback**: ‏אם אין `candidatesTokensDetails` → ‏השתמש ב-`candidatesTokenCount` (‏ב-TTS ‏הפלט אודיו-בלבד, ‏אז זו הערכה טובה). ‏הוסף הערת-קוד שמסבירה את ה-fallback.
- ‏שני ה-extractors ‏טהורים → ‏טסטים עם fixtures ‏מוקלטים (‏אפשר לייצר עם `WIRE_RECORD=1` ‏על קריאה חיה, ‏או לבנות fixture ‏מינימלי מהטיפוסים — ‏כולל fixture אחד עם `candidatesTokensDetails` ‏ואחד בלעדיו).
**‏Verification**: `pnpm --filter @drive-coding/core test extract`

### Commit 2 — backend: usage-store (approach: mixed — TDD ל-aggregation, manual ל-IO)
**‏קובץ חדש**: `packages/backend/src/usage/usage-store.ts` + ‏`usage-store.test.ts`
**‏API skeleton**:
```ts
export type Provider = "elevenlabs" | "google"
export type UsageEvent = {
  ts: number; provider: Provider; cached: boolean
  chars?: number; inputTokens?: number; audioTokens?: number; costUsd: number
}
export type ProviderTotals = {
  requests: number; cacheHits: number
  chars: number; inputTokens: number; audioTokens: number; costUsd: number
}
export type UsageSummary = Record<Provider, ProviderTotals>

export interface UsageStore {
  record(event: UsageEvent): void      // sync in-memory accumulate; schedules flush
  summary(): UsageSummary
}
export function createUsageStore(baseDir: string): UsageStore  // loads totals.json on construct
```
**‏מימוש**:
- ‏BE ‏single-process → ‏מונים בזיכרון, ‏עדכון סינכרוני ‏ב-`record()` (‏אפס-race).
- ‏flush ל-`{baseDir}/totals.json` **‏debounced** (‏למשל 2s ‏אחרי record אחרון) + ‏append מיידי ל-`{baseDir}/events.jsonl`.
- ‏load ‏מ-`totals.json` ‏ב-construct (‏שורד restart); ‏חסר/‏פגום → ‏מונים אפס.
- ‏baseDir ‏מ-`ensureStateSubdir("usage")` (‏ראה `paths.js`).
**‏Verification**: `pnpm --filter @drive-coding/backend test usage-store` (‏TDD ‏על record/summary/‏load; ‏flush ‏נבדק ידנית).

### Commit 3 — backend: proxy hook + endpoint (approach: manual)
**‏קבצים משתנים**:
- `packages/backend/src/delivery/http-proxy.ts`:
  - ‏`registerProxyHttp` ‏מקבל `opts.usageStore?: UsageStore` (‏additive; ‏אם undefined → ‏no-op, ‏שומר על טסטים קיימים).
  - ‏**‏שתי נקודות-tap נפרדות** (‏אביגיל finding #1 — ‏ה-cache מתנהג שונה בין הספקים; ‏ראה §0 "‏מבנה ה-tap פר-ספק"):
    - ‏**‏ElevenLabs — cacheable** (`/v1/text-to-speech/.../stream`):
      - ‏**‏cache-hit** (‏שורות 104-117): ‏`usageStore?.record({ provider:"elevenlabs", cached:true, costUsd:0 })`. ‏request++/cacheHit++.
      - ‏**‏cache-miss** (‏בבלוק ה-tee ‏166-193): ‏`extractElevenLabsChars(body)` ‏מה-**‏request** body → `elevenLabsCostUsd`. ‏record cached:false.
    - ‏**‏Gemini — UNcacheable** (`/v1beta/models/{model}:streamGenerateContent`): ‏הבקשה **‏נופלת ל-transparent-forward** (‏שורות 196-199) — ‏**‏אין שם tee**. ‏**‏הוסף tee חדש** ‏על `res.body`, ‏מותנה `provider==="google" && pathSuffix.includes(":streamGenerateContent")`: ‏branch אחד ל-client (‏מיידי), ‏branch שני נקרא **‏ברקע** → `extractGeminiUsage(bytes)` → `geminiCostUsd`. ‏record cached:false. **‏Gemini תמיד cache-miss** — ‏אין לו branch cache-hit.
  - ‏**‏אסור לחסום/‏להשהות את תגובת ה-client** — ‏כל ה-tap ברקע (‏דפוס `cacheStreamInBackground`, ‏שורות 205-234): ‏ה-client מקבל את ה-branch הראשון מיידית.
- `packages/backend/src/server.ts`: ‏צור `const usageStore = createUsageStore(ensureStateSubdir("usage"))`, ‏העבר ל-`registerProxyHttp(app, { cacheBaseDir, usageStore })`, ‏ורשום `registerUsageHttp(app, { usageStore })`. **additive**.
**‏קובץ חדש**: `packages/backend/src/delivery/http-usage.ts`:
```ts
export function registerUsageHttp(app: Hono, deps: { usageStore: UsageStore }): void
// GET /api/usage/summary → 200 UsageSummary
```
**‏Verification**:
```bash
pnpm typecheck && pnpm --filter @drive-coding/backend test
# חי: הפעל BE דרך OneCLI, דבר עם ElevenLabs ואז Gemini, ואז:
curl -s localhost:4000/api/usage/summary | jq
# הקבצים תחת ensureStateSubdir("usage") = ~/.config/drive-coding/usage/ (לא data/):
cat ~/.config/drive-coding/usage/totals.json ; tail ~/.config/drive-coding/usage/events.jsonl
```

## §5 — DoD

| ‏בדיקה | ‏איך |
|---|---|
| ‏core tests ‏ירוקים (pricing+extract) | `pnpm --filter @drive-coding/core test usage` |
| ‏usage-store test ‏ירוק | `pnpm --filter @drive-coding/backend test usage-store` |
| ‏typecheck+lint ‏נקי | `pnpm typecheck && pnpm lint && pnpm lint:i18n` |
| ‏ElevenLabs miss: ‏chars+cost ‏נספרים | ‏TTS חי → `summary.elevenlabs.chars>0 && costUsd>0` |
| ‏Gemini miss: ‏inputTokens+audioTokens ‏מ-usageMetadata | ‏TTS חי → `summary.google.audioTokens>0` |
| ‏cache-hit (ElevenLabs בלבד): ‏request++ ‏אך cost=0 | ‏חזור על אותו טקסט ‏ב-ElevenLabs → `elevenlabs.cacheHits++`, ‏`costUsd` ‏לא עולה. ‏**‏Gemini תמיד miss** (‏uncacheable) — ‏אין לו cache-hit. |
| ‏persistence: ‏totals ‏שורד restart | ‏אתחל BE מחדש → `summary` ‏שומר ערכים |
| ‏events.jsonl: ‏שורה-לקריאה | ‏`tail events.jsonl` — ‏JSON תקין פר-שורה |
| ‏client ‏לא מושהה ‏ע"י ה-tap | ‏TTS ‏נשמע מיידית כמו לפני (‏אין רגרסיית-latency) |
| ‏אין דליפת-סוד/‏טקסט-שיחה ל-events? | ‏events ‏שומר ‏מטא בלבד (‏provider/‏counts/‏cost) — ‏**‏לא** ‏את טקסט-המשתמש |

## §6 — Risks

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|
| ‏tap ‏על ה-response מעכב/‏שובר את הזרמת ה-TTS | ‏ניתוח 2026-07-02 | ‏`res.body.tee()` + ‏קריאת ה-branch **‏ברקע** (‏דפוס `cacheStreamInBackground`), ‏client מקבל את ה-branch הראשון מיידית. ‏DoD ‏בודק latency. |
| ‏Gemini ‏cache-hit ‏אין לו usageMetadata | ‏מבנה cache (‏audio בלבד) | ‏cache-hit=$0 ‏ממילא — ‏לא סופרים tokens ‏על hit. ‏עקבי. |
| ‏race ‏על totals.json | ‏— | ‏single-process → ‏עדכון-זיכרון סינכרוני; ‏flush debounced (‏coalesce). ‏אין multi-process. |
| ‏אובדן מונים ‏בקריסה לא-graceful | ‏— | ‏append מיידי ל-events.jsonl (‏reconstruct ‏אפשרי); ‏flush ‏גם on-shutdown (‏מתחבר ל-`be-shutdown-hardening`). |
| ‏מחירים מתיישנים | ‏— | ‏snapshot ‏עם תאריך+‏מקורות בהערה; ‏"‏משוער" ‏מפורש. |
| ‏פרסור SSE ‏של Gemini שביר (‏פורמט משתנה) | ‏integration חיצוני | ‏extractor ‏מחזיר אפסים על כשל-פרסור (‏לא זורק) → ‏ספירה חלקית עדיפה על קריסה. ‏escalation אם הפורמט לא-מזוהה. |
| ‏שינוי חתימת `registerProxyHttp` ‏שובר טסטים | ‏— | ‏param ‏אופציונלי (`usageStore?`) — ‏additive, ‏no-op ‏כשחסר. |

## §7 — Escalation triggers
- ‏אם ה-`usageMetadata` ‏לא מופיע ב-SSE ‏של Gemini החי (‏extractor ‏מחזיר אפסים תמיד) → ‏עצור, ‏הקלט עם `WIRE_RECORD=1`, ‏שאל את מרדכי (‏ייתכן שהמודל/‏הפורמט שונה מהצפוי).
- ‏אם ‏`tee` ‏שלישי גורם ל-backpressure ‏שמעכב את הזרמת ה-client → ‏שאל לפני פשרה על הדיוק.
- ‏אם ה-transparent-forward branch (‏שורות 196-199) ‏משורת-מבנה שונה ממה שה-brief מתאר, ‏או שה-tee החדש ל-Gemini מתנגש עם signal/abort → ‏שאל לפני פשרה.
- ‏שינוי בפורמט totals.json ‏שדורש migration ‏של קובץ קיים → ‏שאל.

## §8 — Complexity score
- ‏commits: 4 · ‏שכבות חדשות: 2 (core usage + backend usage/‏delivery) · ‏external APIs: 2 (‏פרסור תגובות elevenlabs+gemini) (+2) · ‏streaming/SSE parse (+2) · ‏persistence · ‏protocol change: ‏endpoint חדש (+1)
- ‏**‏Score: 8/10 → verifier: heavy (`calev-heavy`)** — ‏streaming tap + ‏integration חיצוני + ‏persistence ‏מצדיקים בדיקת-רגרסיה על latency ‏ו-edge cases (‏hit/miss, ‏parse-fail).

## §9 — שאלות פתוחות
| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏ElevenLabs tier ‏למחיר — ‏קבוע 0.18/1k, ‏או להסיק מ-subscription? | ‏קבוע כעת; ‏דיוק tier ‏ב-`tts-quota-subscription` | ❌ |
| 2 | ‏events.jsonl ‏gitignored? | ‏מחוץ ל-repo ‏ממילא — ‏`~/.config/drive-coding/usage/` (‏home dir, ‏לא בעץ ה-git) | ❌ |
| 3 | ‏האם לשמור טקסט-שיחה ב-events ‏ל-audit? | ‏**‏לא** — ‏מטא בלבד (‏פרטיות) | ❌ |
| 4 | ‏flush debounce interval | 2s + ‏on-shutdown | ❌ |
| 5 | ‏Gemini audioTokens — ‏מקור מדויק (‏אביגיל #3) | ‏`candidatesTokensDetails[].modality==="AUDIO"` ‏כמקור-ראשי; ‏fallback ל-`candidatesTokenCount` (‏TTS ‏פלט-אודיו). ‏ר' Commit 1 | ❌ |
