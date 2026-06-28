# Slice V4a-unify — tts-playback-unification — תוכנית

> **תאריך**: 2026-06-27
> **סטטוס**: הושלם (אליעזר 2026-06-27, 3 commits: c58fe2d..2ab4f98)
> **Complexity**: 5/10 (verifier: light)
> **תלות**: `depends_on: [V4a]`. **base = ענף `slice/V4a-gemini-tts-pcm-playback`** @ e9e3655 (שרשור V1→V3→V4a→V4a-unify).

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/V4a-unify -b slice/V4a-unify slice/V4a-gemini-tts-pcm-playback
cd .worktrees/V4a-unify
pnpm install && pnpm hooks:install
```

### Run / Browser / OneCLI
- BE: `cd packages/backend && PORT=4004 onecli run --agent voice-acp -- bun src/server.ts` (ports 4000-4003 אולי תפוסים; **onecli חובה**).
- אימות חי דרך **build** (לא vite-dev): `pnpm --filter @drive-coding/frontend-v2 build` → BE עם `FE_STATIC_DIR=<build>` → tunnel.
- שם החבילה `@drive-coding/frontend-v2`; typecheck FE = `--filter frontend-v2 typecheck`.
- WebAudio = secure-context + user-gesture (voice-mode / tap-to-play).

### Reading list
**must-read** (נתיבים מוחלטים — uncommitted/לא בענף V4a):
- `/home/user/projects/drive-coding/dev/docs/decisions/voice-acp.md` (entries V4a + V3) — ה-seam.
- `packages/frontend/src/lib/engines/routing-audio-sink.ts` + `audio-sink.ts` — שכבת-הנגינה המאוחדת (קיים מ-V4a).
- `packages/frontend/AGENTS.md` §golden rules (**שכבות**: adapter < engine < view-model — אדפטר לא מייבא VM).

## §1 — מטרה

איחוד נתיב-ההקראה. היום יש **שני צרכני-TTS** עם **לוגיקה כפולה ונתיבי-נגינה מפוצלים**:
ה-`Speaker` (הקראה אוטומטית) מנתב נכון דרך `RoutingAudioSink`, אבל ה-`BubblePlayer` (הקשה על
בועה) עדיין רץ דרך `playAgentText` → `<audio>` blob **מקובע ל-ElevenLabs** → ב-Gemini הוא נשבר
(PCM גולמי לא מתנגן ב-`<audio>`; וגם הבורר לא נכבד). **התיקון**: **שתי שכבות יחידות** ששני הצרכנים
נשענים עליהן — `resolveTts()` (בחירת-ספק) + `RoutingAudioSink` (נגינה לפי format). אפס מנגנון חדש.
מנקודת-מבט המשתמשת: הקשה על בועה מכבדת את בורר-הספק (Gemini מתנגן), בדיוק כמו ההקראה האוטומטית.

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| `resolveTts()` — מקור-אמת יחיד לבחירת ספק/voice/model | ✅ | — |
| `Speaker` עובר ל-`resolveTts()` (zero-behavior-change) | ✅ | — |
| `BubblePlayer` (TTS) עובר ל-`RoutingAudioSink` + `resolveTts()` | ✅ | — (זה גם תיקון ה-bug של Gemini בבועה) |
| מחיקת `playAgentText` (נתיב ה-`<audio>` blob ל-TTS) | ✅ | — |
| `playUserRecording` (השמעת הקלטת-משתמש) | ❌ נשאר על `<audio>` | — (קובץ-מדיה אמיתי, לא TTS) |
| בחירת-voice פר-ספק (Gemini voices) | ❌ | V4b (אבל "Kore" מתרכז ב-`resolveTts` — נקודת-שינוי יחידה) |
| שינוי ה-`RoutingAudioSink`/`AudioStream`/`PcmAudioStream` | ❌ | נשארים כמו ב-V4a |

## §3 — Architecture diagram

```
                resolveTts(ttsProvider, voiceId) → { provider, voiceId, modelId }   ← שכבה 1 (adapter)
                                  │ provider.synthesize(...)
                                  ▼
                      RoutingAudioSink → AudioStream(mp3) | PcmAudioStream(pcm)      ← שכבה 2 (engine, קיים)
                       ▲                                   ▲
              Speaker (Player+queue)              BubblePlayer (one-shot, segment יחיד)

packages/frontend/src/lib/
  adapters/voice/
    tts-resolve.ts   ← חדש   resolveTts() — ממפה (ttsProvider, voiceId) → {provider, voiceId, modelId}
                             (מייבא elevenLabsTts + geminiTts; מקבל primitives, לא את ה-Settings VM — שכבות)
    play-bubble.ts   ← שינוי  מוחק playAgentText; משאיר playUserRecording בלבד
  view-models/
    speaker.svelte.ts     ← שינוי  ~400: מחליף את ה-3 שורות inline ב-resolveTts(...) (zero-behavior-change)
    bubble-player.svelte.ts ← שינוי  TTS דרך RoutingAudioSink + resolveTts; user-recording נשאר על <audio>
```

> שכבות (AGENTS.md): `resolveTts` ב-**adapter** מקבל `ttsProvider`+`voiceId` כ-primitives — **לא** מייבא את `Settings` (VM מעל adapter). ה-VMs מעבירים את הערכים.

## §4 — Commits בסדר

### Commit 0 — adapter: resolveTts (approach: **TDD**)
**קבצים חדשים**: `packages/frontend/src/lib/adapters/voice/tts-resolve.ts` + `tts-resolve.test.ts`
```ts
import type { TtsProvider } from "@drive-coding/core/voice/tts-types"
import { elevenLabsTts } from "./tts"
import { geminiTts } from "./tts-gemini"

export interface ResolvedTts { provider: TtsProvider; voiceId: string; modelId: string }

/** מקור-אמת יחיד: ספק TTS פעיל + voice + model לפי ההגדרה. "Kore" מתרכז כאן (→ V4b). */
export function resolveTts(ttsProvider: "elevenlabs" | "google", elevenVoiceId: string): ResolvedTts {
  if (ttsProvider === "google") {
    return { provider: geminiTts, voiceId: "Kore", modelId: "gemini-3.1-flash-tts-preview" }
  }
  return { provider: elevenLabsTts, voiceId: elevenVoiceId, modelId: "eleven_v3" }
}
```
**Tests**: `"google"` → geminiTts + Kore + gemini-model · `"elevenlabs"` → elevenLabsTts + מועבר-voiceId + eleven_v3 · ה-`provider.format` תואם ("pcm"/"mp3").
**Verification**: `npx vitest run tts-resolve` (מ-root).

### Commit 1 — Speaker → resolveTts (approach: **manual**, zero-behavior-change)
**שינויים** `speaker.svelte.ts` (~400): החלף את הבלוק
```ts
const isGemini = this.#settings.ttsProvider === "google"
const provider = isGemini ? geminiTts : elevenLabsTts
const voiceId  = isGemini ? "Kore" : this.#settings.voiceId
const modelId  = isGemini ? "gemini-3.1-flash-tts-preview" : "eleven_v3"
```
ב-
```ts
const { provider, voiceId, modelId } = resolveTts(this.#settings.ttsProvider, this.#settings.voiceId)
```
- הסר imports עודפים אם geminiTts/elevenLabsTts לא נצרכים ישירות יותר (resolveTts עוטף אותם). שאר הקוד (textHash, synthesize, prepareSegment עם format) **ללא שינוי**.
**Verification**: `--filter frontend-v2 typecheck` + `test` — אותה התנהגות (zero-change).

### Commit 2 — BubblePlayer → sink + resolveTts; מחיקת playAgentText (approach: **manual** + runtime-verify)
**שינויים `bubble-player.svelte.ts`**:
- הוסף sink משלו: `readonly #sink = new RoutingAudioSink(new AudioStream(), new PcmAudioStream())` + `#segId: string | null = null`.
- ה-`abortCtrl` כבר נלכד היום בשורה 58 (`const abortCtrl = this.#abortCtrl`) **לפני** הענפים — שמור על הלכידה הזו; ה-`run()` סוגר עליו.
- ענף ה-TTS (**שורות 77-87**, ה-`else` של message/thought) — במקום `playAgentText(...)` (84):
  ```ts
  const { provider, voiceId, modelId } = resolveTts(this.#settings.ttsProvider, this.#settings.voiceId)
  this.#segId = bubbleId
  const run = async () => {
    const stream = await provider.synthesize({ text, voiceId, modelId, signal: abortCtrl.signal })
    await this.#sink.prepareSegment(bubbleId, stream, abortCtrl, { format: provider.format })
    await this.#sink.play(bubbleId)
  }
  void run().then(cleanup).catch(cleanup)
  ```
- ה-`<audio>` (`new Audio()`, שורה 61-62) **נשאר** — הוא נחוץ לענף ה-user-recording (`playUserRecording(recordingId, audioEl)`). אל תיצור/תשתמש ב-audioEl בענף ה-TTS, **אבל אל תסיר אותו** — ה-recording תלוי בו.
- **`cleanup()` (64-68)**: הוסף `this.#segId = null` — אבל **שמור** את איפוס `playingBubbleId`/`#audioEl`/`#abortCtrl` הקיים (cleanup משרת את **שני** הענפים).
- ⚠️ **`stop()` (91-105) — קריטי (finding אביגיל #1): חייב לשמר את שני מנגנוני-העצירה**:
  - ענף recording נעצר דרך **`#audioEl.pause()`** הקיים (96-103) — `playUserRecording` **אין לו signal**, אז זו הדרך היחידה לעצור אותו. **אל תסיר/תשבור את זה.**
  - ענף TTS נעצר דרך ה-sink: הוסף `if (this.#segId) { this.#sink.cancel(this.#segId); this.#segId = null }`.
  - שמור גם את `#abortCtrl.abort()` (92-95). ה-stop מטפל ב-**שניהם** — לא להחליף, להוסיף.

**docstrings (finding #3)**: עדכן את `bubble-player.svelte.ts:6` ("message/thought → playAgentText" → דרך sink) ואת `play-bubble.ts:4-6` (שמתאר נתיב `<audio>` ל-TTS) — שלא יתארו קוד שנמחק.

**שינויים `play-bubble.ts`**: **מחק** את `playAgentText` (כלל-זהב #5 — אין נתיב כפול; אומת: צרכן יחיד = bubble-player). `playUserRecording` נשאר ללא שינוי. עדכן את ה-import ב-bubble-player (להסיר `playAgentText`, להוסיף resolveTts + engines).

**Verification (runtime, calev light)**:
- בורר=Gemini → הקש בועת-תשובה → מתנגן בקול Gemini (PCM/WebAudio), **לא** בקשה ל-elevenlabs (בדוק BE log: `provider:"google"`).
- בורר=ElevenLabs → אם יש קרדיטים, MP3 מתנגן; אם אין — 401 נקי, לא crash.
- toggle על אותה בועה עוצר; stop באמצע עוצר מיד; ניגון הקלטת-משתמש עדיין עובד.

## §5 — DoD verifiable

| בדיקה | איך |
|---|---|
| `resolveTts` TDD ירוק | `npx vitest run tts-resolve` |
| typecheck FE + root | `--filter frontend-v2 typecheck` + `pnpm typecheck` |
| כל הטסטים ירוקים (אפס regression) | `pnpm test` (root) |
| lint (i18n) | `pnpm lint` |
| vite build | `--filter frontend-v2 build` |
| `playAgentText` נמחק (אין נתיב כפול) | `grep -rn "playAgentText" packages/frontend/src` → **0** |
| בחירת-ספק לא משוכפלת | `grep -rn 'ttsProvider === "google"' packages/frontend/src` → **רק** ב-`tts-resolve.ts` (לא ב-Speaker/BubblePlayer) |
| **בועת-תשובה ב-Gemini** | runtime: בורר=Gemini → tap → BE log `provider:"google"`, קול Gemini (calev) |
| **השמעת הקלטת-משתמש** לא נשברה | runtime: tap על בועת-user → ההקלטה מתנגנת (`<audio>`) |

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| BubblePlayer sink נפרד מ-Speaker → 2 AudioContext | §1 design | תקין (Speaker + BubblePlayer לא חופפים — BubblePlayer guarded ב-`turnState==="idle"`); 2 contexts בגבול הסביר |
| stop()/cancel לא עוצר WebAudio | engine | `RoutingAudioSink.cancel` → `PcmAudioStream.cancel` עוצר sources + abort; calev מאמת stop באמצע |
| regression בהשמעת הקלטת-משתמש | מחיקת playAgentText | playUserRecording **לא נגעים**; ה-`<audio>` נשאר לו; DoD מאמת חי |
| שכבות: adapter מייבא VM | AGENTS.md | `resolveTts` מקבל primitives (`ttsProvider`,`voiceId`), לא את `Settings` |
| Speaker zero-behavior-change נשבר | Commit 1 | resolveTts מחזיר בדיוק אותם ערכים שהיו inline; `pnpm test` + השוואת BE log |

## §7 — Escalation triggers
- אם BubblePlayer דורש Player/OrderedQueue (לא אמור — segment יחיד) → שאל.
- אם sink נפרד ל-BubblePlayer גורם לקונפליקט AudioContext עם ה-Speaker (לא צפוי) → שאל.
- אם מחיקת `playAgentText` חושפת צרכן נוסף (מעבר ל-BubblePlayer) → עצור (`grep playAgentText`).

## §8 — Complexity score
**5/10** — verifier: **light** (calev mode: light).
- commits: 3 · שכבות חדשות: 0 (resolveTts=adapter קטן; sink קיים מ-V4a) · API חיצוני חדש: 0
- refactor + bug-fix; reuse של PcmAudioStream/AudioStream המאומתים. הסיכון הוא lifecycle של BubblePlayer (stop/cancel) — calev light מאמת חי.

## §9 — שאלות פתוחות

| # | שאלה | הכרעה | חוסם? |
|---|---|---|---|
| 1 | BubblePlayer — sink נפרד או משותף עם Speaker? | **נפרד** (כל VM בעל sink משלו; פשוט, בלי קונפליקט queue) | ❌ |
| 2 | resolveTts ב-adapter או core? | **adapter** — מייבא את ה-providers הקונקרטיים (elevenLabsTts/geminiTts), שהם adapters; core לא יודע על מימושים | ❌ |
| 3 | segmentId ל-BubblePlayer | **`bubbleId`** (ייחודי, וטבעי ל-cancel ב-stop) | ❌ |
