# Slice V4b — בורר-קול Gemini פר-ספק — תוכנית

> **תאריך**: 2026-06-28
> **סטטוס**: טיוטה
> **Complexity**: 4/10 (verifier: light)
> **תלות**: V4a (Gemini TTS — ✅ מוזג ל-dev). `depends_on: []` (כל ה-symbols קיימים ב-dev).

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/V4b-gemini-voice-picker -b slice/V4b-gemini-voice-picker dev
cd .worktrees/V4b-gemini-voice-picker
pnpm install && pnpm hooks:install
```

### Run
- ‏BE: `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (port 4000)
- ‏FE: `pnpm --filter @drive-coding/frontend dev` (port: OS-assigned)
- ‏Tests: `pnpm --filter @drive-coding/frontend test`
- ‏Typecheck: `pnpm typecheck` · Lint: `pnpm lint && pnpm lint:i18n`

### Browser
- ‏Chrome רגיל על `http://localhost:<vite-port>` מספיק (אין secure-context API חדש כאן). לבדיקת-קול חיה: לבחור Google ב-TTS provider, לבחור קול, לשלוח prompt ולהאזין.

### OneCLI agent
- ‏שם: `voice-acp` — חובה ל-BE (מזריק `x-goog-api-key` ל-`generativelanguage.googleapis.com`). בלעדיו כל קריאת Gemini TTS תיכשל 401/400.

### Reading list
**‏must-read לפני**:
- ‏`packages/frontend/AGENTS.md` — חמשת כללי-הזהב של ה-FE (שכבות).
- ‏`docs/conventions/parallel-safe-code.md` §הוספת-שדה-Settings — הדפוס המדויק להוספת שדה שמור (טיפוס `Persisted` → `DEFAULTS` → `$state`+setter+`#persist`).

**‏reference בזמן עבודה**:
- ‏`packages/frontend/src/lib/adapters/voice/tts-resolve.ts` — נקודת-השינוי המרכזית (הקול מקובע ל-"Kore" כאן).
- ‏`packages/frontend/src/lib/components/chat/VoicePicker.svelte` — הדפוס של בורר-קול ElevenLabs (להעתיק את הצורה, **לא** את ה-`loadVoices` async — Gemini סטטי).
- ‏`packages/frontend/src/lib/components/ui/Select.svelte` — תומך כבר ב-`SelectOption.description` (תיאורי-אופי).

## §1 — מטרה

‏היום משתמשת שבוחרת ספק-TTS = Google מקבלת קול יחיד מקובע (`"Kore"`), בלי דרך לשנותו. אחרי ה-slice: ב-מסך ההגדרות, כשספק-ה-TTS הוא Google, מופיע בורר-קול שני (לצד בורר-ElevenLabs הקיים) עם **30 קולות ה-prebuilt של Gemini**, כל אחד עם **תיאור-אופי** (Bright/Upbeat/Firm…) מתחת לשם. הבחירה נשמרת ל-localStorage ומוזרמת לכל קריאת Gemini TTS (גם Speaker וגם BubblePlayer).

## §2 — Scope: מה כן, מה לא

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ‏בורר-קול Gemini סטטי + תיאורים + persist + חיווט ל-`resolveTts` | ✅ | ‏ה-slice הזה |
| ‏שליפת קולות מ-endpoint חי | ❌ | ‏**אין endpoint** — אומת 2026-06-28 (תיעוד Google + `/v1beta/voices`=404 + SDK `@google/genai` 2.3.0 בלי method + `models.list` בלי voices). הרשימה סטטית בקוד. |
| ‏תיאורי-אופי **דו-לשוניים** (אנגלית + עברית) | ✅ | ‏ה-slice הזה — דרך i18n catalog. עברית **חייבת** לשבת בקטלוג (ה-lint מתיר עברית רק ב-`i18n/catalogs/*` + טסטים). he="`Firm · תקיף`" (גם וגם), en="`Firm`". |
| ‏voice-config מלא פר-ספק (אובייקט מקונן) | ❌ | ‏מיותר — שני שדות שטוחים נפרדים (`voiceId` ל-ElevenLabs, `geminiVoice` ל-Gemini) מספיקים. |
| ‏preview/השמעת-דגימה של קול בבורר | ❌ | ‏גל עתידי. |
| ‏שינוי ברירת-המחדל מ-"Kore" | ❌ | ‏נשאר `"Kore"` (זהה למקובע היום — שינוי מינימלי). |

## §3 — Architecture diagram

```
routes / components ── SettingsScreen.svelte ───────────────┐ (← משבץ GeminiVoicePicker, conditional על ttsProvider==="google")
                       GeminiVoicePicker.svelte  ← חדש       │
view-models ────────── Settings (settings.svelte.ts)         │ (← geminiVoice $state + setGeminiVoice + persist)
actions ────────────── (אין שינוי)                           │
engines ────────────── (אין שינוי)                           │
adapters ───────────── tts-resolve.ts (resolveTts)           │ (← פרמטר geminiVoice, מחליף "Kore" קבוע)
                       voices-gemini.ts  ← חדש (רשימה סטטית)  │
core ───────────────── (אין שינוי)                           │
```

‏שני צרכני `resolveTts` (`speaker.svelte.ts:399`, `bubble-player.svelte.ts:96`) מעבירים את `settings.geminiVoice` כפרמטר השלישי.

## §4 — Commits בסדר

### Commit 0 — רשימת-קולות סטטית + `resolveTts(geminiVoice)` (approach: TDD)

**‏קבצים חדשים**:
- ‏`packages/frontend/src/lib/adapters/voice/voices-gemini.ts` — רשימת 30 הקולות (id + descKey).

**‏שינויים**:
- ‏`packages/frontend/src/lib/adapters/voice/tts-resolve.ts` — הוספת פרמטר שלישי `geminiVoice` (מחליף את הקבוע `"Kore"`).
- ‏`packages/frontend/src/lib/adapters/voice/tts-resolve.test.ts` — עדכון הקריאות הקיימות + מקרים חדשים (ראה verification).

**‏API skeleton**:
```ts
// voices-gemini.ts
import type { MessageKey } from "@drive-coding/core/i18n"
export interface GeminiVoice {
  /** voiceName ל-prebuiltVoiceConfig (למשל "Kore"). data, אנגלית. */
  id: string
  /** מפתח i18n לתיאור-האופי הדו-לשוני. literal → תואם MessageKey (type-safe). */
  descKey: MessageKey
}
/** 30 קולות prebuilt של Gemini TTS. מקור: ai.google.dev/gemini-api/docs/speech-generation. */
export const GEMINI_VOICES: readonly GeminiVoice[]
export const DEFAULT_GEMINI_VOICE = "Kore"

// tts-resolve.ts — חתימה חדשה (geminiVoice עם default לתאימות-לאחור)
export function resolveTts(
  ttsProvider: "elevenlabs" | "google",
  elevenVoiceId: string,
  geminiVoice?: string,   // ← חדש; ברירת מחדל DEFAULT_GEMINI_VOICE
): ResolvedTts
```
> ‏ב-`resolveTts`, ענף ה-google מחזיר `voiceId: geminiVoice ?? DEFAULT_GEMINI_VOICE` במקום הקבוע `"Kore"`.
> ‏ה-`descKey` הוא literal מסוג `MessageKey` (לא מחרוזת דינמית) — כך `t(v.descKey)` עובר typecheck (ה-keys הם union, מפתח דינמי היה נשבר).

**‏מקור-אמת לרשימה (לאמת בעת המימוש)**: 30 הקולות מ-`https://ai.google.dev/gemini-api/docs/speech-generation`:
> ‏Kore · Puck · Charon · Fenrir · Leda · Orus · Aoede · Callirrhoe · Autonoe · Enceladus · Iapetus · Umbriel · Algieba · Despina · Erinome · Algenib · Rasalgethi · Laomedeia · Achernar · Alnilam · Schedar · Gacrux · Pulcherrima · Achird · Zubenelgenubi · Vindemiatrix · Sadachbia · Sadaltager · Sulafat · Zephyr

‏**חובה**: לאמת את 30 השמות **והתיאורים פר-קול** מול התיעוד הרשמי בזמן המימוש (WebFetch). אל תמציא תיאורים/תרגומים. (התרגום העברי נוצר ב-Commit 2 בקטלוג.)

**‏Verification**:
```bash
pnpm --filter @drive-coding/frontend test -- tts-resolve
pnpm typecheck
```
‏טסטים שחייבים לעבור: (א) `resolveTts("google", x)` בלי geminiVoice → voiceId="Kore" (תאימות-לאחור); (ב) `resolveTts("google", x, "Puck")` → voiceId="Puck"; (ג) ענף elevenlabs לא הושפע; (ד) `GEMINI_VOICES.length === 30` וכולל "Kore".

### Commit 1 — שדה `geminiVoice` ב-Settings (approach: manual)

**‏שינויים** (לפי `parallel-safe-code.md`, 3 הצעדים):
- ‏`packages/frontend/src/lib/view-models/settings.svelte.ts`:
  - ‏טיפוס `Persisted`: הוספת `geminiVoice: string` **בסוף** (אחרי `suppressLeaveWarning`).
  - ‏`DEFAULTS`: `geminiVoice: DEFAULT_GEMINI_VOICE` (import מ-`voices-gemini.ts`).
  - ‏`$state` + `setGeminiVoice` (קורא `#persist`) + שורה ב-constructor + שורה ב-`#persist()`.

**‏API skeleton**:
```ts
geminiVoice = $state<string>(DEFAULTS.geminiVoice)
setGeminiVoice = (v: string): void => { this.geminiVoice = v; this.#persist() }
```

**‏Verification**:
```bash
pnpm typecheck && pnpm --filter @drive-coding/frontend test
```

### Commit 2 — בורר UI + חיווט צרכנים + i18n (approach: manual)

**‏קבצים חדשים**:
- ‏`packages/frontend/src/lib/components/chat/GeminiVoicePicker.svelte` — `<Select>` חשוף מעל `GEMINI_VOICES`, מחובר ל-`settings.geminiVoice`. כל option: `{ value: v.id, label: v.id, description: t(v.descKey) }`. (לפי VoicePicker, **בלי** `loadVoices`/`$effect` — הרשימה סטטית.)

**‏שינויים**:
- ‏`packages/frontend/src/lib/components/settings/SettingsScreen.svelte` — מתחת לבורר ה-TTS provider, להוסיף `{#if settings.ttsProvider === "google"}` עם `<label>` + `<GeminiVoicePicker />` (אותו דפוס-`<label>` כמו VoicePicker, key `settings.geminiVoice.label`).
- ‏`packages/frontend/src/lib/view-models/speaker.svelte.ts:~399` — `resolveTts(settings.ttsProvider, settings.voiceId, settings.geminiVoice)`.
- ‏`packages/frontend/src/lib/view-models/bubble-player.svelte.ts:~96` — אותו שינוי.
- ‏`packages/core/src/i18n/keys.ts` + `catalogs/he.ts` + `catalogs/en.ts` — **בלוק domain חדש** (append בסוף, parallel-safe) עם **31 מפתחות**:
  - ‏`settings.geminiVoice.label` — he="קול Gemini" / en="Gemini voice".
  - ‏`settings.geminiVoice.desc.<Id>` ×30 (אחד פר קול) — **דו-לשוני**: ב-`he.ts` = "`<En> · <תרגום-עברי>`" (למשל `"Firm · תקיף"`), ב-`en.ts` = "`<En>`" (למשל `"Firm"`).

> ‏**i18n חובה** (gotcha): כל 30 המפתחות חייבים להופיע ב-`keys.ts` **וגם** ב-`he.ts` **וגם** ב-`en.ts` — אחרת `typecheck` נשבר (`Catalog` = `Record<MessageKey, string>`, מפתח חסר = שגיאת-טיפוס). העברית נמצאת **רק** בקטלוגים (ה-lint חוסם אותה בכל קובץ אחר).
> ‏את 30 התרגומים העבריים יוצר ה-executor מתוך התיאורים האנגליים שאומתו ב-Commit 0 (תרגום קצר, מילה–שתיים).

**‏Verification**:
```bash
pnpm typecheck && pnpm lint && pnpm lint:i18n
pnpm --filter @drive-coding/frontend test
# חי: בחר Google → בורר-הקול מופיע עם 30 קולות+תיאורים → בחר Puck → רענן → הבחירה נשמרה → prompt → קול שונה
```

## §5 — DoD

| ‏בדיקה | ‏איך |
|---|---|
| ‏`resolveTts` מחזיר את הקול הנבחר ל-google | `pnpm --filter @drive-coding/frontend test -- tts-resolve` ירוק |
| ‏תאימות-לאחור: קריאה ללא geminiVoice → "Kore" | ‏טסט (א) ירוק |
| ‏הרשימה = 30 קולות עם תיאורים מאומתים | ‏בדיקת `voices-gemini.ts` מול התיעוד |
| ‏בורר מופיע **רק** כש-provider=google | ‏ידני: החלף provider, ראה הופעה/היעלמות |
| ‏בחירה נשמרת אחרי רענון | ‏ידני: בחר Puck, רענן, הבורר על Puck |
| ‏הקול הנבחר נשמע בפועל (Speaker + בועה) | ‏ידני חי: prompt עם Puck → קול שונה מ-Kore |
| ‏תיאורי-אופי מוצגים בבורר, **דו-לשוני** | ‏ידני (locale=he): פתח הבורר, כל קול עם "`Firm · תקיף`" מתחת |
| ‏locale=en מציג רק אנגלית | ‏ידני: החלף שפה לאנגלית, התיאור = "`Firm`" |
| ‏gates ירוקים | `pnpm typecheck && pnpm lint && pnpm lint:i18n` נקי |

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|
| ‏עברית מקודדת בקוד → pre-commit חוסם | ‏learnings (gotcha קבוע) | ‏כל העברית (label + 30 תיאורים) **רק** בקטלוגים `i18n/catalogs/{he,en}.ts`. `voices-gemini.ts` מחזיק `descKey` (אנגלית) בלבד. הרץ `pnpm lint:i18n`. |
| ‏מפתח i18n חסר מקטלוג → typecheck נשבר | ‏`Catalog`=`Record<MessageKey,string>` | ‏לוודא ש-כל 31 המפתחות ב-keys.ts מופיעים **גם** ב-he.ts **וגם** ב-en.ts. `pnpm typecheck` תופס. |
| ‏מפתח דינמי ל-`t()` שובר טיפוס | ‏keys = union literal | ‏`descKey: MessageKey` literal בקובץ ה-data → `t(v.descKey)` type-safe (לא `t(\`...${id}\`)`). |
| ‏Svelte 5 reactivity על מערך | ‏learnings | ‏`GEMINI_VOICES` קבוע (לא `$state`) → ה-`{#each}` בטוח; אין mutation. |
| ‏תיאורים מומצאים/שגויים | — | ‏לאמת כל 30 התיאורים מול התיעוד הרשמי (WebFetch) — לא מהזיכרון. |
| ‏שכחת חיווט אחד משני הצרכנים → קול לא משתנה בבועות | ‏שני call-sites | ‏לעדכן **גם** speaker **וגם** bubble-player; ה-DoD בודק בועה במפורש. |
| ‏שבירת תאימות-לאחור ל-`resolveTts` | — | ‏הפרמטר השלישי אופציונלי עם default → קריאות ישנות לא נשברות (טסט א). |

## §7 — Escalation triggers

‏אם X — עצור ושאל את מרדכי ב-parent task:
- ‏מתברר ש-Gemini **כן** דורש פורמט voiceName שונה ממה שכתוב (קול נבחר → 400 מה-proxy).
- ‏ה-`Select` לא מרנדר `description` כמצופה (gotcha ברכיב UI).
- ‏OneCLI לא מזריק את `x-goog-api-key` (כל קול → 401).
- ‏החלטה ארכיטקטונית מעבר ל-D1-D50.

## §8 — Complexity score

‏**4/10** → `calev` (light).
- ‏commits: 3 (נמוך) · שכבות חדשות: 0 (קובץ-data + רכיב-leaf בשכבות קיימות) · APIs חיצוניים: 0 (רשימה סטטית, אין fetch חדש) · streaming: 0 · state-refactor: 0 · protocol: 0.
- ‏הוספת 1/10 על נפח ה-i18n הידני (31 מפתחות ×3 קבצים + תרגום + אימות מול תיעוד) — מכני אך נוטה-לטעות (מפתח חסר → typecheck).
- ‏הליבה (`resolveTts`) טהורה → TDD. השאר glue/UI/i18n → manual + בדיקה חיה.

## §9 — שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏להציג תיאורי-אופי בבורר? | ‏**כן** (הוכרע ע"י המשתמשת — דרך `SelectOption.description`) | ❌ |
| 2 | ‏ברירת-מחדל לקול Gemini? | ‏**Kore** (הוכרע — זהה למקובע היום) | ❌ |
| 3 | ‏לתרגם את התיאורים לעברית? | ‏**כן — דו-לשוני** (הוכרע ע"י המשתמשת). he="`<En> · <עברית>`", en="`<En>`". כל העברית בקטלוגים בלבד (lint). | ❌ |
| 4 | ‏בורר תמיד-גלוי או רק כש-provider=google? | ‏רק כש-google (conditional `{#if}`) — פחות עומס-ויזואלי | ❌ |
