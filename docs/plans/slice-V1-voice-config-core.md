# Slice V1 — voice-config-core — תוכנית

> **תאריך**: 2026-06-27
> **סטטוס**: הושלם (אליעזר, 2026-06-27) — 3 commits: 88d447b..2290b2f, branch slice/V1-voice-config-core
> **Complexity**: 4/10 (verifier: light)
> **תלות**: אין (`depends_on: []`) — הבסיס של מסלול B (Voice)

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/V1-voice-config-core -b slice/V1-voice-config-core dev
cd .worktrees/V1-voice-config-core
pnpm install && pnpm hooks:install
```

### Run
- BE: `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (port 4000)
  ⚠️ **חובה onecli** — translate/narrate קוראים ל-`/proxy/google/*`; בלי onecli → 401.
- FE: `pnpm --filter @drive-coding/frontend-v2 dev` (port: OS-assigned, proxy → BE 4000)
- Tests: `pnpm --filter @drive-coding/core test` (core, vitest) · `pnpm typecheck` · `pnpm lint`

### Browser
- Chrome רגיל על `http://localhost:<vite-port>` מספיק (V1 לא נוגע ב-getUserMedia/AudioWorklet).
  אימות הקול עצמו: לפתוח voice-mode, לדבר/להפעיל כלי — ראה §5.

### OneCLI agent
- שם: `voice-acp` · שימוש: `onecli run --agent voice-acp -- <cmd>` (מזריק Google + ElevenLabs keys).

### Reading list
**must-read לפני**:
- `packages/frontend/AGENTS.md` — חמשת כללי-הזהב של ה-FE (שכבות).
- `docs/plans/voice-provider-abstraction-roadmap.md` §C-§E — ההכרעות וההקשר של V1 בשרשרת.
- `packages/core/AGENTS.md` (אם קיים) / `AGENTS.md` §Conventions — ArkType לכל schema, `Result` לפעולות fallible, אין `any`.

**reference בזמן עבודה**:
- `packages/frontend/src/lib/adapters/voice/sdks.ts` — `googleAi(model, headers)` factory.
- `packages/core/src/voice/translation-prompt.ts` — דוגמה לקובץ core/voice קיים (סגנון).

## §1 — מטרה

לאחר V1, **בחירת המודל לכל שירות-קול עוברת דרך שכבה טהורה אחת** (`select()` ב-core) במקום
מחרוזת קשיחה בכל adapter. מנקודת-מבט המשתמש — **שום דבר לא משתנה** (אותם מודלים, אותה
התנהגות). זהו slice-תשתית: הוא פותח את ה-seam ש-V2 (ספק טקסטואלי שני) ו-V3/V4 (TTS) ייתלו בו.

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| `VoiceConfig` + `select()` טהור ב-core (TDD) | ✅ | — |
| הסבת `translate.ts` + `narrate.ts` לקבל מודל מ-`select()` | ✅ | — |
| ברירת-מחדל = Gemini הנוכחי (zero-behavior-change) | ✅ | — |
| ספק טקסטואלי שני (OpenAI) + provider-branch ב-adapter | ❌ | V2 |
| הסבת STT (`transcribe.ts`) ל-`select()` | ❌ | V2 |
| `TtsProvider` interface + הסבת TTS | ❌ | V3 |
| Settings-UI לבחירת ספק פר-שירות + persistence ל-localStorage | ❌ | slice Settings-UI (§E) |
| שינוי כלשהו בהתנהגות/מודלים/latency | ❌ | — (אם משתנה — באג) |

## §3 — Architecture diagram

```
packages/core/src/voice/            (טהור — אין IO)
  capabilities.ts   ← חדש   VoiceProvider | VoiceModelRef | VoiceService | VoiceConfig
                            + DEFAULT_VOICE_CONFIG (ArkType schemas)
  select.ts         ← חדש   select(service, config) → VoiceModelRef   [pure, TDD]
  translation-prompt.ts / narration-prompt.ts   [קיימים — לא נגעים]

packages/frontend/src/lib/
  adapters/voice/   (shell דק)
    translate.ts    ← שינוי  מקבל ref: VoiceModelRef (במקום מחרוזת קשיחה), קורא googleAi(ref.model)
    narrate.ts      ← שינוי  כנ"ל
    sdks.ts         [קיים — לא נגע; googleAi() כבר עוטף את ה-proxy+placeholder]
  view-models/
    speaker.svelte.ts ← שינוי  שתי קריאות: select(...) → מעביר ref ל-translate()/narrate()
```

> כלל-זהב D5 (functional core): בחירת-המודל היא **פונקציה טהורה ב-core**; ה-IO (קריאת ה-SDK)
> נשאר ב-shell. select() לא יודע על fetch/proxy/SDK — רק ממפה (service, config) → ref.

## §4 — Commits בסדר

### Commit 0 — core: VoiceConfig + select() (approach: **TDD**)

**קבצים חדשים**:
- `packages/core/src/voice/capabilities.ts`
- `packages/core/src/voice/select.ts`
- `packages/core/src/voice/select.test.ts`

**API skeleton** (executor לא משנה חתימות ציבוריות):
```ts
// capabilities.ts — ArkType (עקבי עם conventions; אין any)
import { type } from "arktype"

export const voiceProvider = type("'google' | 'openai' | 'elevenlabs'")
export type VoiceProvider = typeof voiceProvider.infer

export const voiceModelRef = type({ provider: voiceProvider, model: "string" })
export type VoiceModelRef = typeof voiceModelRef.infer

export const voiceService = type("'translate' | 'narrate' | 'stt' | 'tts'")
export type VoiceService = typeof voiceService.infer

export const voiceConfig = type({
  translate: voiceModelRef,
  narrate: voiceModelRef,
  stt: voiceModelRef,
  tts: voiceModelRef,
})
export type VoiceConfig = typeof voiceConfig.infer

// ברירות-מחדל = בדיוק המודלים הקשיחים היום (zero-behavior-change). אל תשנה ערכים.
export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  translate: { provider: "google", model: "gemini-flash-lite-latest" },
  narrate:   { provider: "google", model: "gemini-flash-lite-latest" },
  stt:       { provider: "google", model: "gemini-flash-latest" },   // לא נצרך ב-V1 (V2)
  tts:       { provider: "elevenlabs", model: "eleven_v3" },          // לא נצרך ב-V1 (V3)
}
```
```ts
// select.ts
import type { VoiceConfig, VoiceModelRef, VoiceService } from "./capabilities"

/** מחזיר את ה-{provider, model} שמוגדר ל-service ב-config. פונקציה טהורה. */
export function select(service: VoiceService, config: VoiceConfig): VoiceModelRef {
  return config[service]
}
```

**Tests (select.test.ts)** — כותבים אדום→ירוק:
- `select("translate", DEFAULT_VOICE_CONFIG)` → `{ provider: "google", model: "gemini-flash-lite-latest" }`
- `select("narrate", DEFAULT_VOICE_CONFIG)` → אותו ref.
- `select("stt", …)` / `select("tts", …)` → מחזיר את ה-ref המתאים (covers all 4).
- config מותאם (provider="openai") → select מחזיר אותו כמו-שהוא (לא ממיר/לא ברירת-מחדל-מחדש).
- (אופציונלי) `voiceConfig(...)` של ArkType דוחה shape לא-תקין (provider לא ידוע).

**Verification**:
```bash
pnpm --filter @drive-coding/core test   # select.test ירוק
pnpm typecheck                            # אין any/שגיאות טיפוס
```

### Commit 1 — adapters: translate.ts + narrate.ts מקבלים VoiceModelRef (approach: **manual**)

**שינויים (קוד)**:
- `translate.ts`: הוסף פרמטר `ref: VoiceModelRef` (לפני `signal`). הקריאה הקיימת היא
  `model: googleAi("gemini-flash-lite-latest", cacheHeaders)` — property בתוך ה-object של
  `generateObject({...})` (שורה ~89). החלף את המחרוזת הקשיחה ל-`ref.model`:
  `model: googleAi(ref.model, cacheHeaders)`. **V1: provider תמיד "google"** — בלי branch;
  הוסף הערה `// V2: switch on ref.provider (google|openai)` בנקודת ה-googleAi.
- `narrate.ts`: כנ"ל — הקריאה היא `model: googleAi(...)` בתוך `generateText({...})` (שורה ~42).
- אל תיגע ב-cacheHeaders, withTimeout, schema, prompt — רק במקור-המודל ובחתימה.

**שינויים (טסטים — חובה באותו commit, אחרת אדום):** הוספת `ref` כפרמטר-חובה שוברת
**10 call-sites בטסטים קיימים**. עדכן אותם להעביר ref:
- `packages/frontend/src/lib/adapters/voice/translate.test.ts` — 5 קריאות (שורות ~44,52,60,70,80):
  הוסף ארגומנט ref, למשל `select("translate", DEFAULT_VOICE_CONFIG)` או literal
  `{ provider: "google", model: "gemini-flash-lite-latest" }`, **במיקום הנכון** (לפני ה-signal).
- `packages/frontend/src/lib/adapters/voice/narrate.test.ts` — 5 קריאות (שורות ~56,69,77,87,98).
  ⚠️ שים לב ל-`narrate.test.ts:98` — `narrate(ctx, tool, ac.signal)`: בלי תיקון, `ac.signal` ייתפס
  כ-`ref`. ודא שה-ref נכנס לפני ה-signal.
- אם mock של `googleAi`/SDK קיים בטסטים — ודא שהוא עדיין תופס `ref.model` (string).

**חתימות after**:
```ts
// translate.ts
export async function translate(
  text: string, targetLang: "he" | "en", ref: VoiceModelRef,
  signal?: AbortSignal, messageId?: string | null,
): Promise<TranslateResult | null>

// narrate.ts
export async function narrate(
  ctx: NarrateContext, tool: ToolCallForNarrate, ref: VoiceModelRef,
  signal?: AbortSignal,
): Promise<string | null>
```
> import: `import type { VoiceModelRef } from "@drive-coding/core/voice/capabilities"` (subpath wildcard — מיוצא אוטומטית, אין צורך לערוך package.json).

**Verification**:
```bash
# frontend לא בגרף של root tsc --build → typecheck של frontend הוא svelte-check נפרד:
pnpm --filter @drive-coding/frontend-v2 typecheck   # svelte-check — תופס adapters+טסטים+speaker
pnpm --filter @drive-coding/frontend-v2 test        # vitest — translate.test/narrate.test ירוקים אחרי עדכון ה-ref
```
> הערה: `speaker.svelte.ts` עוד לא חוּוט (Commit 2) → ה-svelte-check עשוי לסמן את 2 ה-call-sites
> שם כ-missing-arg עד Commit 2. זה צפוי; הטסטים של ה-adapters (translate/narrate) **חייבים** לעבור כבר כאן.

### Commit 2 — speaker.svelte.ts: חיווט select() לשתי הקריאות (approach: **manual**)

**שינויים** ב-`packages/frontend/src/lib/view-models/speaker.svelte.ts`:
- import: `select` + `DEFAULT_VOICE_CONFIG` מ-`@drive-coding/core/voice/select` + `…/capabilities`.
- שורה ~359: `translate(text, TARGET_LANG, select("translate", DEFAULT_VOICE_CONFIG), job.abort.signal, job.messageId)`
- שורה ~489: `narrate(ctx, tool, select("narrate", DEFAULT_VOICE_CONFIG), job.abort.signal)`
- מקור ה-config ב-V1 = הקבוע `DEFAULT_VOICE_CONFIG` (Settings-field נדחה — §9 Q1).

**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 typecheck   # svelte-check ירוק (כולל 2 ה-call-sites המחווטים)
pnpm typecheck                                    # root tsc --build (core+backend) — ירוק
pnpm --filter @drive-coding/frontend-v2 test         # vitest frontend ירוק
pnpm lint                                         # אין עברית בקוד, Biome נקי
pnpm --filter @drive-coding/frontend-v2 build        # vite build ירוק (ודא שאין שבירת-import)
```

## §5 — DoD verifiable

| בדיקה | איך |
|---|---|
| select() טהור, מכוסה TDD | `pnpm --filter @drive-coding/core test` — select.test ירוק |
| **טסטי frontend ירוקים (תופס את regression ה-call-sites)** | `pnpm --filter @drive-coding/frontend-v2 test` — translate.test/narrate.test ירוקים אחרי עדכון ה-ref |
| typecheck frontend נקי (svelte-check) | `pnpm --filter @drive-coding/frontend-v2 typecheck` — frontend **לא** בגרף של root `tsc --build` |
| typecheck root נקי | `pnpm typecheck` (core+backend) |
| lint נקי (אין עברית בקוד) | `pnpm lint` |
| vite build ירוק | `pnpm --filter @drive-coding/frontend-v2 build` |
| **תרגום עובד כמקודם** | voice-mode פעיל, הודעת-סוכן באנגלית → מתורגמת לעברית ומוקראת (זהה להיום) |
| **קריינות-כלים עובדת כמקודם** | סוכן מריץ כלי → narrate מפיק משפט עברי בבועה (זהה להיום) |
| **zero-behavior-change** | אותם מודלים נשלחים: ב-DevTools Network, הבקשות ל-`/proxy/google/...` נושאות את אותו model כמו לפני (`gemini-flash-lite-latest`) |

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| שינוי שובר zero-behavior-change (מודל אחר נשלח) | יעד הסבב | DEFAULT_VOICE_CONFIG חייב להכיל בדיוק `gemini-flash-lite-latest` ל-translate+narrate; DoD מאמת ב-Network |
| OneCLI placeholder pattern | learnings 2026-05-16 / README §6 | לא נגעים ב-sdks.ts; googleAi() כבר מטפל ב-placeholder+proxy. אם BE לא תחת onecli → 401 (לא באג של הסבב) |
| subpath export חדש שובר build | memory `provider-contract /acp barrel breaks FE build` | מכוסה: `"./voice/*"` ב-core exports הוא wildcard → קבצים חדשים מיוצאים אוטומטית. עדיין מריצים `vite build` ב-DoD לוודא |
| ArkType `any`/casing | AGENTS.md conventions | schemas עם `type(...)`, `typeof X.infer` ל-types; אין `any` |
| הרחבת-scope: "כבר נחבר ל-Settings" | template §2 | Settings-field מפורשות **מחוץ ל-scope** (§9 Q1) — V1 משתמש בקבוע בלבד |

## §7 — Escalation triggers

עצור ושאל את מרדכי ב-parent task אם:
- מתברר ש-translate/narrate צריכים provider-branch כבר ב-V1 (לא אמורים — google בלבד).
- **call-sites ידועים** (production: `speaker.svelte.ts` ×2 · טסטים: `translate.test.ts` ×5 + `narrate.test.ts` ×5).
  אם מתגלה call-site **נוסף** מעבר ל-12 האלה (production או טסט) — עצור ושאל.
- `select()` הטהור מתגלה כצריך IO / Result / async (לא אמור — זו מפה טהורה).
- vite build נשבר על ה-subpath import (בניגוד לציפייה מה-wildcard export).

## §8 — Complexity score

**4/10** — verifier: **light** (calev mode: light).
- commits: 3 (נמוך) · שכבות חדשות: 0 (core/voice קיים, adapters קיימים) · API חיצוני חדש: 0
- streaming/async pipeline: לא · state-model refactor: לא · protocol BE↔FE: לא
- הליבה היחידה ב-core היא TDD טהור; שאר השינויים glue קטן עם אימות-Network ידני.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל מוצעת | חוסם? |
|---|---|---|---|
| 1 | מקור ה-`VoiceConfig` ב-runtime ב-V1 — קבוע או שדה ב-Settings? | **קבוע** `DEFAULT_VOICE_CONFIG`; שדה-Settings + persistence נדחים ל-slice Settings-UI (§E). שומר את V1 מינימלי ו-zero-change | ❌ |
| 2 | להגדיר `stt`/`tts` ב-`VoiceConfig` כבר עכשיו (לא-נצרכים) או רק ב-V2/V3? | **להגדיר את כל ה-4 עכשיו** — type יציב קדימה; V2/V3 מוסיפים רק wiring, לא reshape | ❌ |
| 3 | translate/narrate מקבלים `VoiceModelRef` מלא או רק `model: string`? | **ref מלא** — V2 צריך את `provider` ל-branch; מעביר ref עכשיו = אפס reshape ב-V2 | ❌ |
| 4 | ערכי ברירת-המחדל ל-stt/tts (לא נצרכים ב-V1) — מדויקים? | `stt: gemini-flash-latest` (transcribe.ts:58), `tts: eleven_v3` (tts.ts:31) — מאומתים מהקוד; לא משפיעים על התנהגות V1 | ❌ |
