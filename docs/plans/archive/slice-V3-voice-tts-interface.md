# Slice V3 — voice-tts-interface — תוכנית

> **תאריך**: 2026-06-27
> **סטטוס**: הושלם (2026-06-27, אליעזר, commits 7f23aeb..7719b68 branch slice/V3-voice-tts-interface)
> **Complexity**: 5/10 (verifier: light)
> **תלות**: `depends_on: [V1]` (סדר roadmap). **base = ענף `slice/V1-voice-config-core`** (V1 טרם ממוזג → שרשור).
>   הערה: צימוד-הקוד ל-V1 הוא **אפסי** (V3 לא משתמש ב-select/VoiceConfig) — השרשור הוא לסדר-merge לינארי בלבד.

## §0 — Pre-flight

### Worktree
```bash
# base = ענף V1 (לא dev) — שרשור
git worktree add .worktrees/V3-voice-tts-interface -b slice/V3-voice-tts-interface slice/V1-voice-config-core
cd .worktrees/V3-voice-tts-interface
pnpm install && pnpm hooks:install
```

### Run
- BE: `cd packages/backend && PORT=4001 onecli run --agent voice-acp -- bun --watch src/server.ts`
  ⚠️ **port 4000 תפוס** — השתמש ב-4001. **חובה onecli** (TTS → `/proxy/elevenlabs/*`; בלי onecli → 401).
- FE: `BE_PORT=4001 pnpm --filter @drive-coding/frontend-v2 dev` (port: OS-assigned)
- ⚠️ **שם החבילה: `@drive-coding/frontend-v2`** (לא `frontend`) — קריטי לכל `--filter`.

### Browser
- HTTPS חובה ל-TTS streaming (MediaSource) — אם בודקים runtime מהדפדפן: Chrome על `localhost` או tunnel.
  אבל ה-DoD הליבתי הוא zero-behavior-change → static+wiring (ראה §5). runtime-TTS חי = אופציונלי.

### OneCLI agent
- `voice-acp` (מזריק ElevenLabs + Google keys).

### Reading list
**must-read לפני**:
- `packages/frontend/AGENTS.md` — חמשת כללי-הזהב (בפרט **כלל #5: אין backward-compat-in-place** — ממירים כל consumer במלואו).
- `docs/plans/voice-provider-abstraction-roadmap.md` §D (ארכיטקטורת-יעד) + §E (V3 שורה).

**reference בזמן עבודה**:
- `packages/frontend/src/lib/adapters/voice/tts.ts` — ה-fetch הקיים של ElevenLabs.
- `packages/core/src/async/with-timeout.ts` — precedent ל-`AbortSignal` ב-core (type-only).

## §1 — מטרה

הוצאת ElevenLabs מאחורי **interface `TtsProvider`** טהור ב-core. במקום ש-2 הצרכנים יקראו
ישירות לפונקציה הקונקרטית `synthesizeStreaming`, הם יקראו דרך `TtsProvider`. מנקודת-מבט
המשתמש — **שום דבר לא משתנה** (אותו ElevenLabs, אותו MP3, אותו streaming). זה ה-seam ש-V4
(Gemini-TTS, שעליו עשינו ספייק) יתחבר אליו: ספק שני שמממש את אותו interface.

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| `TtsProvider` interface + `TtsRequest` ב-core | ✅ | — |
| ElevenLabs כ-`TtsProvider` (מימוש קיים מאחורי ה-interface) | ✅ | — |
| המרת 2 הצרכנים (`speaker`, `play-bubble`) לקרוא דרך ה-interface | ✅ | — |
| zero-behavior-change (ElevenLabs/MP3/streaming זהים) | ✅ | — |
| **בחירת-ספק לפי config** (`tts/index.ts` selector, `select("tts")`) | ❌ | V4 (יש רק ספק אחד עכשיו) |
| ספק TTS שני (Gemini) + נתיב PCM→WebAudio | ❌ | V4 (ר' `v4-gemini-tts-pre-brief.md`) |
| `TtsChunk` (chunk-level type) | ❌ | V4 (נדרש ל-PCM chunking; היום הצרכנים מקבלים `ReadableStream<Uint8Array>` גולמי) |
| שינוי כלשהו בהתנהגות/latency/פורמט | ❌ | — (אם משתנה — באג) |

## §3 — Architecture diagram

```
packages/core/src/voice/            (טהור)
  tts-types.ts      ← חדש   TtsRequest + interface TtsProvider   [type-only, אין IO]
  capabilities.ts / select.ts   [קיימים מ-V1 — לא נגעים]

packages/frontend/src/lib/
  adapters/voice/
    tts.ts          ← שינוי  ה-fetch הקיים נחשף כ-`elevenLabsTts: TtsProvider`
                             (synthesizeStreaming הופך לגוף של .synthesize; TtsOptions → TtsRequest)
  view-models/
    speaker.svelte.ts  ← שינוי  שורה ~386: elevenLabsTts.synthesize(req) במקום synthesizeStreaming(req)
  adapters/voice/
    play-bubble.ts     ← שינוי  שורה ~44: כנ"ל
```

> D5: ה-interface הוא **type טהור ב-core**; ה-IO (fetch ל-proxy) נשאר ב-shell (tts.ts).
> כלל-זהב #5: **אין** להשאיר את `synthesizeStreaming` כ-alias — להמיר את כל הצרכנים ולהסיר.

## §4 — Commits בסדר

### Commit 0 — core: TtsProvider interface (approach: **manual** — type-only, אין לוגיקה ל-TDD)

**קבצים חדשים**: `packages/core/src/voice/tts-types.ts`

**API skeleton** (חתימות ציבוריות — executor לא משנה):
```ts
// tts-types.ts — type-only. AbortSignal + ReadableStream הם standard-lib (DOM+Node);
// AbortSignal כבר בשימוש ב-core (with-timeout.ts:21). אין browser-global runtime.
export interface TtsRequest {
  text: string
  voiceId: string
  modelId?: string
  messageId?: string | null
  signal?: AbortSignal
}

export interface TtsProvider {
  /** טקסט → זרם בייטים של אודיו (היום: MP3 מ-ElevenLabs). */
  synthesize(req: TtsRequest): Promise<ReadableStream<Uint8Array>>
}
```
> מיוצא אוטומטית כ-`@drive-coding/core/voice/tts-types` (wildcard `"./voice/*"` ב-core exports — אומת ב-V1).

**Verification**:
```bash
pnpm typecheck   # tsc --build core — ירוק
```

### Commit 1 — adapter: ElevenLabs כ-TtsProvider (approach: **manual**)

**שינויים** ב-`packages/frontend/src/lib/adapters/voice/tts.ts`:
- מחק את ה-`interface TtsOptions` המקומי; ייבא `TtsRequest` מ-`@drive-coding/core/voice/tts-types`
  (הם זהים שדה-לשדה — אמת: text/voiceId/modelId?/messageId?/signal?).
- עטוף את גוף ה-fetch הקיים ב-`export const elevenLabsTts: TtsProvider = { async synthesize(req) { …גוף קיים… } }`.
  הגוף **זהה** (eleven_v3 default, cacheHeaders, withTimeout, response.body) — רק עובר ל-method.
- **הסר** את ה-export של `synthesizeStreaming` (כלל #5 — בלי alias).

**שינויים (טסטים — חובה באותו commit):** `tts.test.ts` מכיל **10 קריאות** ל-`synthesizeStreaming`.
המר את כולן ל-`elevenLabsTts.synthesize(...)` (אותם args בדיוק). ודא שאין mock על השם הישן.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 typecheck   # svelte-check — tts.test + tts.ts
pnpm --filter @drive-coding/frontend-v2 test        # tts.test ירוק אחרי ההמרה
```

### Commit 2 — consumers: speaker + play-bubble דרך ה-interface (approach: **manual**)

**שינויים**:
- `speaker.svelte.ts` (call-site שורה ~386): החלף `synthesizeStreaming({...})` ב-`elevenLabsTts.synthesize({...})`.
  עדכן את ה-import בשורה ~46 (`synthesizeStreaming` → `elevenLabsTts`). args ללא שינוי.
- `play-bubble.ts` (שורה ~44): `elevenLabsTts.synthesize({ text, voiceId, signal })`. עדכן import (שורה ~10).
- **אל תיגע** ב-AudioStream / MediaSource / blob-path — רק במקור-הקריאה.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 typecheck   # 0 errors
pnpm --filter @drive-coding/frontend-v2 test         # 319+ ירוק
pnpm typecheck                                        # root core+backend ירוק
pnpm lint                                             # Biome + אין עברית בקוד
pnpm --filter @drive-coding/frontend-v2 build         # vite build ירוק
```

## §5 — DoD verifiable

| בדיקה | איך |
|---|---|
| `TtsProvider`/`TtsRequest` ב-core, typecheck נקי | `pnpm typecheck` + `pnpm --filter @drive-coding/frontend-v2 typecheck` |
| `tts.test.ts` ירוק אחרי המרת 10 ה-refs | `pnpm --filter @drive-coding/frontend-v2 test` |
| כל טסטי frontend ירוקים | אותה פקודה — 319+/0 |
| lint נקי (אין עברית בקוד) | `pnpm lint` |
| vite build ירוק | `pnpm --filter @drive-coding/frontend-v2 build` |
| `synthesizeStreaming` הוסר לגמרי (אין alias) | `grep -rn "synthesizeStreaming" packages/frontend/src` → **0 תוצאות** |
| **zero-behavior-change** | קריינות/הקראת-בועה עובדות כמקודם: voice-mode → תשובת-סוכן מוקראת (ElevenLabs MP3, זהה); נגן בועה בודדת עובד |

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| טסטים שוברים על rename (כמו V1) | אביגיל V1 (10 call-sites) | Commit 1 כולל המרת 10 ה-refs ב-`tts.test.ts` כמשימת-חובה; DoD מריץ `--filter frontend-v2 test` |
| `--filter @drive-coding/frontend` no-op | אביגיל V1 finding #5 | כל ה-filters כאן הם `@drive-coding/frontend-v2` (אומת) |
| root `pnpm typecheck` לא כולל frontend | אביגיל V1 finding #2 | typecheck של FE = `--filter frontend-v2 typecheck` (svelte-check) |
| AbortSignal/ReadableStream ב-core = "browser global"? | AGENTS.md "No browser globals in core" | type-only; `AbortSignal` כבר ב-`core/async/with-timeout.ts:21`. `ReadableStream<Uint8Array>` standard-lib (DOM+Node), והוא ה-type ש-§D מציין במפורש |
| mock נסתר על `synthesizeStreaming` בטסט אחר | — | DoD: `grep synthesizeStreaming` = 0; אם נשאר mock → ייתפס |
| OneCLI placeholder (ElevenLabs key) | learnings 2026-05-16 | לא נגעים ב-fetch headers; placeholder נשמר |

## §7 — Escalation triggers

עצור ושאל את מרדכי ב-parent task אם:
- `synthesizeStreaming` נקרא ממקום **נוסף** מעבר ל-3 הידועים (speaker:386, play-bubble:44, tts.test ×10).
- `TtsOptions` הקיים **אינו** זהה שדה-לשדה ל-`TtsRequest` המוצע (יש שדה נוסף/חסר).
- ה-המרה דורשת שינוי ב-AudioStream/MediaSource/blob-path (לא אמורה — רק מקור-הקריאה).
- שינוי כלשהו שובר zero-behavior-change (פורמט/latency/voice).

## §8 — Complexity score

**5/10** — verifier: **light** (calev mode: light).
- commits: 3 · שכבות חדשות: 0 (core/voice + adapters קיימים) · API חיצוני חדש: 0 (אותו ElevenLabs)
- streaming: לא-חדש (reuse) · state-refactor: לא · protocol: לא
- מעט גבוה מ-V1 כי נוגע ב-2 צרכנים + interface חוצה-shell, אבל עדיין refactor טהור zero-change.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל מוצעת | חוסם? |
|---|---|---|---|
| 1 | להוסיף `tts/index.ts` selector כבר ב-V3, או ב-V4? | **V4** — יש רק ספק אחד; selector בלי בחירה הוא ceremony. V3 = הצרכנים מפנים ל-`elevenLabsTts` קונקרטי; V4 מחליף ל-selector | ❌ |
| 2 | `TtsRequest` לשאת `VoiceModelRef` (מ-V1) במקום `voiceId`+`modelId`? | **לא** — שומר zero-change (voiceId הוא של ElevenLabs); מיפוי ref→voiceId הוא החלטת V4 כשיש בחירת-ספק | ❌ |
| 3 | `TtsChunk` עכשיו או ב-V4? | **V4** — נדרש רק ל-PCM chunking של Gemini; היום הצרכנים מקבלים `ReadableStream<Uint8Array>` | ❌ |
| 4 | base = ענף V1 (שרשור) או dev (מקבילי)? | **ענף V1** — שומר על שרשרת לינארית V1→V3→V4 ל-merge מסודר בסוף; צימוד-קוד ל-V1 אפסי בכל מקרה | ❌ |
