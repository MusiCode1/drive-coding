# Decisions — voice-acp

## 2026-06-28 — code-syntax-highlight (slice D): highlight.js ב-pass-שלישי-מבודד (לא Shiki)

### רציונל
המשתמשת ביקשה צביעת-קוד צבעונית (req #7). האילוץ שמכריע הכל: מודל-האבטחה הוא
secure-by-construction — `MARKDOWN_ALLOW` בלי `span`/`style`/`class` (הגנה מ-overlay-phishing
דרך prompt-injection). כל highlighter מוסיף markup בתוך הקוד → מתנגש. הפתרון: **pass-שלישי-מבודד**
— בדיוק התקדים שכבר עובד ל-KaTeX. בלוק-הקוד כולו מרונדר ל-fragment, מאוחסן עם sentinel נפרד
(`U+E002`), ומסונן ב-allowlist צר משלו (`CODE_ALLOW = {pre,code,span} + {class}`, **בלי style**).
`MARKDOWN_ALLOW` נשאר נקי לחלוטין.

### החלטה: highlight.js, לא Shiki
- **highlight.js** — פלט class-בלבד (`<span class="hljs-*">`), **סינכרוני**, ללא WASM, רץ ב-node
  (SSR-safe כמו `katex.renderToString`). מתלבש 1:1 על המסלול-המבודד. `core` + רישום ~15 שפות ידני
  (tree-shaking) → bundle נשלט. **נבחר.**
- **Shiki נדחה** — פלט inline-`style` (הוקטור שאנחנו מוציאים), async, ו-WASM/grammars כבדים.
  איכות-VSCode לא שווה את עלות-האבטחה/bundle/async לאפליקציית-צ'אט voice-first.
- **Prism נדחה** — class-based כמו hljs, אך hljs נקי יותר ב-node ובזיהוי-שפה.
- theme = `.hljs-*` → CSS vars (`--hl-*`) פר-פלטה, מתחלף עם ערכת-העיצוב.

### גוטשה שנתפסה בתכנון (לפני אביגיל)
`MARKDOWN_ATTR` לא כולל `class`. אם רק ה-spans נכנסים ל-fragment וה-עוטף `<pre><code class="hljs">`
נשאר בנתיב-המרקדאון — pass-2 ימחק את ה-class מהעוטף → theme שבור. תוקן: **הבלוק כולו** (pre+code+spans)
נכנס ל-fragment המבודד. זה גם מדויק יותר לתקדים KaTeX (שמאחסן בלוק שלם).

### ממצאי אביגיל (סבב 1 → מאושר-מותנה)
- **כל 6 הטענות הטכניות + 5 מוקדי-הסיכון אומתו נכונים** מול הקוד: two-pass, currentMap/sentinels,
  marked v18 `renderer.code({lang,text})`, ש-`marked.use({renderer})` **לא** שובר את ה-extensions של
  ה-math (שדות נפרדים ב-MarkedExtension), ש-`class` באמת לא ב-MARKDOWN_ATTR, ש-`U+E002` לא מתנגש,
  ש-`ignoreIllegals` קיים ב-hljs, ו-SSR/tree-shaking תקינים. **אפס findings טכניים.**
- 3 ה-findings כולם שורש אחד: **base/dependency על A** (branch של A לא קיים עדיין; Commit 2 מכוון
  ל-MarkdownContent שנוצר ב-A). הוכרע: **base=dev, gated על merge של A** (D לא מדאספטצ'ת לפני A).

### שינויי-כיוון
ה-base הוכרע מ"שרשור על branch של A" ל-**dev-לאחר-מיזוג-A** — מבטל מורכבות chain-merge ומבטיח
שיעדי Commit 2 (MarkdownContent) קיימים. D נשאר gated עד ש-A על dev.

## 2026-06-28 — markdown-content-unify (slice A): קומפוננטת-מרקדאון יחידה במקום 4 משטחים משוכפלים

### רציונל
המשתמשת ביקשה 7 שיפורי-מרקדאון בצד-לקוח (קוד no-wrap+copy+syntax-highlight, מרקדאון בהודעות-משתמש
ובמחשבות, באג רשימות-ממוספרות, `dir=auto` פר-פסקה). החקירה גילתה ש-4 משטחים מרנדרים מרקדאון
בנפרד: `MessageBubble`+`UserBubble` (משכפלים ~40 שורות CSS זהות), `ThoughtBubble` (טקסט גולמי,
**בלי** מרקדאון בכלל), ו-`ContentViewerDialog` (עותק רביעי של אותו CSS). במקום לתקן 4 פעמים,
מחלצים **`MarkdownContent.svelte`** יחיד שכולם מאצילים אליו → כל 7 הדרישות נוחתות במקום אחד עקבי.
זו slice A — הבסיס; B (dir פר-פסקה), C (כפתור copy), D (syntax-highlight) נבנות מעליה.

**שני באגים ששורשם אומת בחקירה:**
- **רשימות (#5)**: marked מפיק `<ol><li>` תקין; השובר הוא Tailwind v4 preflight (`@layer base`)
  שמאפס `list-style:none`, וה-CSS הקיים שחזר `padding` אך לא `list-style-type`. התיקון מנצח
  לא ב-specificity אלא ב-**cascade-layer order** (Svelte `:global` unlayered גובר על `@layer`).
- **קוד (#1)**: `pre` היה `white-space:pre-wrap` → שבירת-שורות; שונה ל-`pre`+`overflow-x:auto`.

### החלטה ארכיטקטונית
A הוא **CSS+composition בלבד** — לא נוגעים ב-`markdown.ts`/`markdown-parse.ts` (ה-pipeline).
שינויי-pipeline (dir פר-פסקה, syntax-highlight) שמורים ל-B/D. זה שומר על blast-radius קטן
ועל מודל-האבטחה (two-pass DOMPurify) ללא שינוי. `variant="bubble"|"viewer"` ב-MarkdownContent
משמר את הכותרות-הגדולות של ה-fullscreen.

### ממצאי אביגיל (2 סבבים → READY)
- **r1 USABLE-AFTER-FIX (3)**: (א) `ContentViewerDialog` הוא משטח-מרקדאון **רביעי** עם אותם 2
  באגים — וכפתור expand ב-MessageBubble פותח אותו → הבאג שורד קליק; (ב) רציונל ה-list-fix ייחס
  ניצחון ל-specificity, אך המנגנון האמיתי הוא cascade-layer order; (ג) חסר §0 Pre-flight.
- **r2 READY (1×🟢)**: viewer h4-h6 איבדו `1em` מפורש אך יורשים אותו — שקול. נוסף note.

### שינויי-כיוון לפי אביגיל
ה-scope הורחב ממ-3 משטחים ל-**4** (נוסף `ContentViewerDialog`, Commit 3) — בלי finding #1 היו
שני באגים שורדים את כפתור ה-expand. דוגמה לערך ה-plan-gate: התרחבות-scope מדויקת לפני ביצוע.

### רעיונות שנדחו
- **Shiki ל-syntax-highlight (#7)**: פולט inline-`style` שמתנגש ב-allowlist secure-by-construction
  (אין span/style ב-MARKDOWN_ALLOW). הכיוון המומלץ ל-slice D: highlight.js (class-based) ב-pass
  שלישי מבודד — אותו דפוס כמו KaTeX. נשמר ל-decision של D.
- **תיקון-במקום ב-4 בועות בלי refactor**: היה מנציח את השכפול ומוסיף נקודת-באג חמישית בעתיד.

## 2026-06-27 — V4a-unify / tts-playback-unification: שתי שכבות יחידות במקום שלושה מנגנונים

### רציונל
V4a בנה את נתיב ה-Speaker נכון (RoutingAudioSink), אבל ה-**BubblePlayer** (הקשה על בועה) נשאר
על `playAgentText` → `<audio>` blob **מקובע ל-ElevenLabs** → ב-Gemini נשבר (PCM גולמי לא מתנגן
ב-`<audio>`, והבורר לא נכבד). **התגלה חי** ב-preview ע"י המשתמשת (runtime-gate בפעולה): הגדירה
Gemini אך הבקשה הלכה ל-elevenlabs.

המשתמשת עצרה תיקון-במקום (WAV-wrap ב-play-bubble) כי **הוא היה יוצר מנגנון רביעי**. הדרישה:
**מנגנון אחיד**, לא שלושה נפרדים. הפתרון — **שתי שכבות יחידות** ששני הצרכנים נשענים עליהן:
1. `resolveTts(ttsProvider, voiceId) → {provider, voiceId, modelId}` — מקור-אמת יחיד לבחירת-ספק
   (adapter; מקבל primitives, לא את Settings VM — שכבות). **"Kore" מתרכז כאן** (נקודת-שינוי יחידה ל-V4b).
2. `RoutingAudioSink` (קיים מ-V4a) — שכבת-הנגינה היחידה לפי `format`. גם BubblePlayer עובר דרכה
   (one-shot, segment יחיד) → PCM עובד אצלו **אוטומטית**, בלי WAV-wrap, בלי קוד חדש.

ה-`Player`/OrderedQueue הוא תוספת-תזמור של ה-Speaker בלבד (ריבוי segments), לא חלק מהנגינה.
`playUserRecording` (קובץ-מדיה אמיתי) **נשאר על `<audio>`** — לא TTS. `playAgentText` נמחק (כלל #5).

### ממצאי אביגיל (2 סבבים → READY)
ר1 (4): 🔴 `stop()` חייב לשמר **שני** מנגנוני-עצירה (`#audioEl.pause()` ל-recording שאין-לו-signal +
`#sink.cancel` ל-TTS) — קל לשבור בשקט · line 78→77 · docstrings מיושנים (bubble-player:6, play-bubble:4-6) ·
cleanup חייב לאפס #segId+#audioEl. ר2: 0 — נקי.

### לקח-שיטה
תיקון שיוצר מנגנון מקביל = ריח. כשהמשתמשת תפסה את ה-WAV-wrap כ"מנגנון רביעי" — זו הייתה הקריאה
הנכונה. עצירה + רידזיין לשכבה משותפת > תיקון-נקודתי. (ה-bug עצמו הוא גם פער-תכנון של brief V4a:
לא כללתי את ה-BubblePlayer בבחירת-הספק — נקלט רק ב-runtime-gate החי.)

### Complexity
5/10, verifier light. 3 commits (resolveTts TDD · Speaker zero-change · BubblePlayer→sink).


## 2026-06-27 — V4a / gemini-tts-pcm-playback: נתיב Gemini-TTS חי (PCM→WebAudio) + ElevenLabs מת על קרדיטים

### רציונל
מימוש הנתיב המלא של Gemini-TTS שספייקנו: ספק `geminiTts` (SDK `@google/genai generateContentStream`,
מאומת חי מחזיר l16/24kHz, 0 preamble) מאחורי `TtsProvider` (V3), + נתיב-השמעה חדש `PcmAudioStream`
(WebAudio, BufferSource queue) לצד נתיב ה-MP3/MediaSource הקיים (sibling, לא תחליף), + בחירת sink לפי
`format`. ה-PCM-parsing (`splitInt16LE`) טהור ב-core (TDD).

**טריגר מכריע — ElevenLabs מת**: אומת חי (2026-06-27) ש-ElevenLabs מחזיר `quota_exceeded` (0 credits;
`/v1/user/subscription`=200 active → האינטגרציה תקינה, רק החיוב מת). פלט-הקול **מת** עד Gemini.
זה מעלה את V4a מ"ספק שני" ל**נתיב-הקול העובד**.

### אימותים חיים (לפני כתיבת ה-brief — לא הנחות)
- `@google/genai generateContentStream` ל-`gemini-3.1-flash-tts-preview` → 72 chunks PCM, first-audio 1.66s, mime `audio/l16; rate=24000`, 0 text parts. דרך onecli (key injection). ⚠️ **לא** אומת דרך `googleGenAi()` proxy-baseUrl בדפדפן → צעד ראשון של Commit 2.
- ElevenLabs: 200 על subscription, 401 `quota_exceeded` על synth → אינטגרציה תקינה, חיוב מת.

### החלטות-תכנון
- **sink נבחר לפי `format` של הספק** (`"mp3"|"pcm"`), לא לפי שם — הספק מצהיר על פלטו, ה-Speaker ממפה.
- **תור AudioBufferSourceNode** (לא AudioWorklet) — sample-accurate דרך `nextStartTime` cursor; Worklet=fallback אם jank.
- **קליטה דרך SDK קיים** (`@google/genai`, כבר dependency) — אפס SSE parsing ידני, אפס dep חדשה.
- Gemini=`"google"` ב-`voiceProvider` (אין literal "gemini"); voice="Kore" קבוע ב-V4a (פר-ספק → V4b).
- **base = ענף V3** (שרשור V1→V3→V4a).

### Q1 — הוכרע (המשתמשת, 2026-06-27): **אין flip של ברירת-מחדל**
ברירת-המחדל נשארת ElevenLabs. במקום זה — **בורר ספק-TTS בהגדרות** (`Settings.ttsProvider`, default
elevenlabs; `<Select>` ב-`SettingsScreen.svelte`) שהמשתמשת מדליקה ידנית כדי לנסות Gemini. אפס
regression, `DEFAULT_VOICE_CONFIG`/`select.test` לא נגעים. בחירת-sink בלי לגעת ב-Player: **`RoutingAudioSink`**
(מנתב פר-segment לפי `format`). אימות לאחר build → preview דרך pico tunnel (המשתמשת תבדוק ותחליף בבורר).

### ממצאי אביגיל (3 סבבים → READY טכני; 8 findings)
ר1 (6): Q1 שובר `select.test.ts` (לא ב-DoD) · "gemini" לא ב-voiceProvider union (provider="google") · core אין test script · must-read docs uncommitted לא יגיעו ל-worktree · optional-chain מקוצר · for-await ב-pull במקום start.
ר2 (2): **`base64ToBytes` לא קיים** (תיקון ר1 שלי הכניס טענה שגויה — base64.ts רק encode) → הוסף decode · `cacheKeyFor` מקובע ל-eleven_v3 בנתיב Gemini.
ר3: 0 — נקי.

### Complexity
8/10, calev-heavy, phase-verify אחרי Commit 4 (PcmAudioStream).

## 2026-06-27 — V3 / voice-tts-interface: TtsProvider interface (ElevenLabs מאחוריו, seam ל-V4)

### רציונל
הוצאת ElevenLabs מאחורי interface `TtsProvider` טהור ב-core (`tts-types.ts`), כך שהצרכנים
(speaker + play-bubble) קוראים דרך ה-interface ולא דרך הפונקציה הקונקרטית `synthesizeStreaming`.
zero-behavior-change (אותו ElevenLabs/MP3/streaming). זה ה-seam ש-V4 (Gemini-TTS, שספייקנו)
מתחבר אליו כספק שני.

**החלטות-תכנון (§9 ב-brief, כולן non-blocking):**
- **בחירת-ספק (`tts/index.ts` selector + `select("tts")`) נדחית ל-V4** — יש ספק אחד עכשיו; selector
  בלי בחירה הוא ceremony. V3 = הצרכנים מפנים ל-`elevenLabsTts` קונקרטי; V4 מחליף ל-selector.
- `TtsRequest` נושא `voiceId`+`modelId` (לא `VoiceModelRef` מ-V1) — שומר zero-change; מיפוי ref→voiceId הוא של V4.
- `TtsChunk` נדחה ל-V4 (נדרש רק ל-PCM chunking של Gemini; היום הצרכנים מקבלים `ReadableStream<Uint8Array>`).
- **base = ענף `slice/V1-voice-config-core`** (שרשור) — צימוד-קוד ל-V1 אפסי, אבל שומר שרשרת לינארית
  V1→V3→V4 ל-merge מסודר בסוף (החלטת המשתמשת: "ממשיכים לבצע, אבדוק בסוף" → אין merge עד הסקירה).

### ממצאי אביגיל (סבב 1 → READY)
**READY מהסבב הראשון** — שיפור מובהק מול V1 (3 סבבים). הלקחים מ-V1 הוטמעו מראש ב-brief:
שמות `@drive-coding/frontend-v2` (לא `frontend`), `--filter frontend-v2 typecheck`=svelte-check,
DoD מריץ frontend test, והמרת 10 ה-call-sites ב-`tts.test.ts` נכנסה כמשימת-חובה ב-Commit 1.
2 findings יחידים — שניהם 🟢 cosmetic (הסטת שורות של ~2 שV1 יצר ב-speaker.svelte.ts; תוקנו ל-~386/~46).

### Complexity
5/10 (verifier: light). 3 commits, 0 שכבות חדשות, refactor טהור zero-change.

## 2026-06-27 — V1 / voice-config-core: שכבת בחירת-ספק טהורה ב-core (seam ל-V2/V3/V4)

### רציונל
הסלייס הראשון של מסלול B. במקום מחרוזת-מודל קשיחה בכל adapter (`googleAi("gemini-flash-lite-latest")`),
בחירת המודל פר-שירות עוברת ל**פונקציה טהורה אחת** `select(service, config) → VoiceModelRef` ב-core
(D5 functional-core). V1 מחווט רק את הטקסטואליים (translate+narrate), עם **zero-behavior-change**
(אותם מודלים בדיוק). זה ה-seam ש-V2 (OpenAI, provider-branch) ו-V3/V4 (TTS) ייתלו בו בלי reshape.

**החלטות-תכנון (כולן non-blocking, נרשמו ב-§9 של ה-brief):**
- `VoiceConfig` מגדיר את כל 4 השירותים (translate/narrate/stt/tts) כבר עכשיו — type יציב קדימה;
  V2/V3 מוסיפים wiring בלבד. (stt/tts מוגדרים אך לא-נצרכים ב-V1.)
- translate/narrate מקבלים `VoiceModelRef` **מלא** (לא רק model:string) — V2 צריך `provider` ל-branch → אפס reshape.
- מקור ה-config ב-V1 = קבוע `DEFAULT_VOICE_CONFIG`; שדה-Settings + persistence + UI נדחים ל-slice Settings-UI.

### ממצאי אביגיל (3 סבבים → READY)
track record ממשיך (100%): 5 בעיות אמיתיות נתפסו לפני dispatch —
1. 🔴 10 call-sites בטסטים (`translate.test`/`narrate.test`) שיישברו כש-`ref` נעשה חובה — ה-brief לא עדכן אותם.
2. 🟡 root `pnpm typecheck` = `tsc --build` על core+backend בלבד; **frontend לא בגרף** → צריך `--filter frontend-v2 typecheck` (svelte-check).
3. 🟡 §5 DoD הריץ רק core test → ה-regression בטסטי frontend היה עובר silent.
4. 🟢 תיאור הקריאה הוצג כ-bare `googleAi(...)` במקום `model: googleAi(...)` בתוך object literal.
5. 🔴 (סבב 2) שם החבילה הוא **`@drive-coding/frontend-v2`**, לא `frontend` — `--filter @drive-coding/frontend` היה no-op שקט (exit 0) → כל פקודות-האימות שתיקנו את #1–#3 לא היו תופסות כלום.

### שינויי-כיוון
ה-brief תוקן: עדכון הטסטים נכנס כמשימת-חובה ב-Commit 1; כל פקודות typecheck/test/build הוסבו
ל-`@drive-coding/frontend-v2` (svelte-check ל-typecheck, vitest ל-test). בלי תיקון #5, שני התיקונים
הקודמים היו אשליה — בדיוק סוג ה-silent-gap שה-runtime/build gates נועדו למנוע.

### Complexity
4/10 (verifier: light / calev mode:light). 3 commits, 0 שכבות חדשות, אין streaming/protocol/state-refactor.


## 2026-06-27 — V4 / voice-tts-provider-2: Gemini-TTS חוזר למרוץ — `gemini-3.1-flash-tts-preview` עם HTTP-streaming

### רציונל
ה-spike של §F (`voice-provider-abstraction-roadmap.md`, 2026-06-16) **פסל את Gemini-TTS**
כמועמד streaming — אבל הדחייה כיסתה רק את מודלי **2.5** (`*-preview-tts`): buffer בלבד,
3.5–5.7s שתיקה למשפט, generation איטי מה-playback. הדחייה הייתה נכונה לזמנה.

מאז שוחרר מודל חדש — **`gemini-3.1-flash-tts-preview`** — שתומך **streaming אמיתי**
(2.5 עדיין לא; אומת מול docs Google 2026-06-27). הוא לא היה קיים בזמן ה-spike, אז §F
מעולם לא בדק אותו. זה משנה את הנחת-היסוד של ההכרעה הפתוחה ב-§H (ספק-TTS-שני ל-V4).

**הממצא הקריטי — ה-transport מתאים לארכיטקטורה הקיימת:** הסטרימינג של 3.1 רץ דרך
**HTTP POST chunked** (`generativelanguage.googleapis.com`, header `x-goog-api-key`,
תגובה `--no-buffer`) — **לא gRPC** (סיבת הפסילה של Cloud-TTS ב-§F) ו**לא WebSocket**
(שדורש הזרקת-key ל-WS שאין כיום). זה בדיוק מה ש-OneCLI כבר מזריק ל-host הזה, ונגיש
מה-FE דרך ה-proxy הקיים `/proxy/google/*`.

### השוואה למועמד הקיים (Gemini-Live)
3.1 עוקף את **שני** החסרונות הכבדים של Gemini-Live בבת אחת:

| ממד | Gemini-Live (WS) | **3.1-flash-tts streaming** |
|------|------------------|------------------------------|
| transport | WebSocket (חיווט חדש) | **HTTP POST chunked (proxy קיים)** |
| הזרקת key | צריך WS injection (אין) | **`x-goog-api-key` — מוזרק כיום** |
| verbatim | ⚠️ dialog-model, לא מובטח | ✅ מודל TTS טהור |
| פלט | PCM 24kHz | PCM (נתיב PCM→WebAudio משותף לשניהם) |

### שינויי-כיוון
§H מקבל **מועמד רביעי** ל-V4 (`gemini-3.1-flash-tts-preview`) — כנראה המוביל, כי הכי
זול-לחיווט *וגם* בלי סיכון verbatim. §F עודכן עם הממצא. master roadmap (Track B / V4)
עודכן אף הוא.

### ✅ אומת חי בספייק ידני (2026-06-27, דרך onecli `voice-acp` + BE proxy)
ספייק חי מלא **בלי brief** (לבקשת המשתמשת), דרך הזרקת-ה-key של onecli `voice-acp` —
**נתיב הפרודקשן עצמו**. כל הממצאים אומתו מול ה-API החי:

| מה | תוצאה (חי) |
|----|------------|
| **קיום המודל** | ✅ `gemini-3.1-flash-tts-preview` ב-list models החי |
| **streaming endpoint** | ✅ `…:streamGenerateContent?alt=sse` → HTTP 200, **SSE** (לא gRPC, לא WS) |
| **first-audio (TTFB)** | ✅ **~0.7–1.0s** (נמדד; ישיר 0.98s, דרך ה-proxy 0.70s) — סדר-גודל כמו Gemini-Live |
| **פלט** | PCM 16-bit 24kHz (`audio/l16; rate=24000; channels=1`), 106 chunks ל-~4.2s אודיו |
| **preamble/thinking** | ✅ אין — זרם audio-only, ה-`text` part ריק (אף שה-metadata מסמן `thinking:true`) |
| **verbatim עברי** | ✅ STT round-trip החזיר **בדיוק** את הקלט ("שלום, מה שלומך…") — אפס סטייה |
| **דרך ה-BE proxy `/proxy/google/*`** | ✅ HTTP 200, TTFB 0.70s, SSE זורם — **end-to-end production path עובד** |
| **proxy מזרים שקוף** | ✅ code-read (`http-proxy.ts`: `new Response(res.body)`/`tee()`) — לא מבאפר |

**תיקון לטענת ה-docs:** WebFetch טען streaming דרך `/v1beta/interactions`+`stream:true` —
**שגוי**. המשטח האמיתי הוא ה-`streamGenerateContent?alt=sse` הסטנדרטי. בנוסף,
`supportedGenerationMethods` ב-metadata **לא** מפרט `streamGenerateContent`, אבל הוא עובד
אמפירית — ה-metadata לא-שלם. **הספייק ניצח את ה-docs ואת ה-metadata — בדיוק הסיבה שמאמתים חי.**

### מסקנה
`gemini-3.1-flash-tts-preview` הוא **המועמד המוביל ל-V4** — אומת end-to-end דרך נתיב הפרודקשן:
streaming אמיתי, ~1s first-audio, verbatim עברי, דרך ה-proxy הקיים בלי תשתית חדשה. caveat
יחיד שנותר: נתיב PCM→WebAudio (משותף לכל מועמד Gemini, לא חדש). **ה-brief של V4 ייכתב על
בסיס מאומת.** ⚠️ JIT: V4 תלוי ב-V1→V3 (TtsProvider interface) שטרם נבנו — ר' §E ב-roadmap.

---

## 2026-06-18 — fix-claude-duplicate-bubbles: בועת-תשובה כפולה של claude — fork + תיקון-שורש (תכנון slice יחיד)

### רציונל
תופעה: בכל session של claude כל תשובת ה-agent מוצגת **פעמיים** — שתי בועות `message`
זהות. אובחן ב-`WIRE_RECORD=1` (ר' `AGENTS.md` §Wire tracing).

**ראיית-חוט:** התשובה מגיעה פעמיים — (1) **deltas** של streaming **בלי** `messageId`;
(2) **assembled** — chunk יחיד **עם** `messageId` (msg_xxx), טקסט **זהה-בייט** (אומת:
concat=403B === assembled=403B). ה-FE `#appendChunk` מקבץ לפי messageId: deltas(null)→בועה
אחת, assembled(msg_xxx)→בועה שנייה. ה-FE **נכון** — ה-adapter שובר את החוזה "הודעה=id יחיד".

**השורש המדויק (מאומת מקוד ה-fork `src/acp-agent.ts@v0.47.0`, לא השערה):**
`resetTurnScratch()` (≈975) מכיל `currentStreamMessageId = undefined`. הוא נקרא מ-`activateTurn`
כש-ה-SDK משחזר את ה-user-echo — וזה קורה **באמצע ה-stream** (ה-SDK פולט stream-events *לפני*
ה-echo; מתועד ב-#785 עצמו). רצף בהודעה הראשונה של תור: `message_start(msg_X)` קובע id →
ה-echo→`resetTurnScratch()` מאפס ל-undefined → ה-text deltas שאחריו יוצאים בלי id **וגם** לא
נכנסים ל-`streamedTextIds` → ב-consolidation `streamedTextIds.has(msg_X)=false` → ה-assembled
לא מסונן ונשלח ככפילות.

- **מסביר הכול:** רק ההודעה ה**ראשונה** של תור נשברת (ה-reset פעם אחת/תור; הבאות מקבלות
  message_start חדש); thinking נשא id ו-text לא (ה-reset נפל ביניהם); "לסירוגין" = תלוי
  אם ה-echo נחת לפני/אחרי שה-text התחיל.
- **#785 = חצי תיקון:** PR `12d34e6` תיקן case אחר ב**אותה** פונקציה (הוציא את איפוס ה-`Set`ים)
  אבל **השאיר** את `currentStreamMessageId = undefined`. **0.47.0** (האחרון ב-npm, מה שאנחנו
  מריצים דרך `npx @latest`) כבר מכיל את #785 — ועדיין משכפל (הקלטות 06-17/06-18, *אחרי* שחרור 0.47.0).
- **pre-existing**, עצמאי מ-slice-claude-thinking-meta. קשור ל-[[wire-recorder-debug-mode]].

### ההכרעה — fork מקומי + תיקון-שורש שורה-אחת (לא FE, לא BE, לא PR-כרגע)
**fork** של `claude-agent-acp` (GitHub fork מלא, אישור משתמש), מ-`v0.47.0`, עם **הסרת השורה
היחידה** `currentStreamMessageId = undefined` מ-`resetTurnScratch()`. build → `dist/`, וחיווט
ל-drive-coding דרך קובץ override מקומי `~/.config/drive-coding/cli-specs.jsonc`
(`claude → {bin:node, args:[fork/dist/index.js]}`) — **אפס שינוי בקוד drive-coding**.

- **למה fork ולא shim ב-FE:** אילוץ המשתמש — לא לגעת בקוד שלנו; ה-fork גם **מוכיח** את
  השורש (TDD חי: red→fix→green). זה תיקון-שורש אמיתי, לא הסתרת-סימפטום.
- **למה הסרה ולא תיקון אחר:** `currentStreamMessageId` נקבע מחדש בכל `message_start`, אז
  איפוסו ב-turn-activation מיותר ומזיק (נופל mid-stream). המשך ישיר של #785.
- **claude-only:** opencode/gemini משתמשים ב-adapters אחרים → לא מושפעים. ה-fork תחום-בזמן
  (claude עובר ל-native), אבל ACP נשאר חי לשאר ה-CLIs.
- **TDD חי:** ל-upstream יש harness לטסט חי (`RUN_INTEGRATION_TESTS` → `"ACP subprocess
  integration"`, spawn אמיתי + prompt מול claude); ה-`TestClient` כבר צובר את כל
  ה-`agent_message_chunk` → בגרסה הבאגית `receivedText` כפול. נרחיב אותו + נוסיף mock
  דטרמיניסטי (ECHO לפני ה-textDelta הראשון).

### רעיונות שנדחו
- **FE de-dup shim** (הגרסה הקודמת של ה-brief) — נדחה לטובת תיקון-שורש; אילוץ "לא לגעת בקוד שלנו".
- **לחכות ל-0.48.0 / git-npx** — נדחה: 0.47.0 הוא האחרון ו-main==release שלו (אין קוד חדש
  למשוך); git-install בכלל לא בונה (`prepare:null` → אין dist).
- **PR upstream עכשיו** — נדחה ("לעת עתה רק מקומי"); אפשרי אחר-כך (GitHub fork כבר מאפשר).

### ממצאי אביגיל
**סבב 1 (USABLE-AFTER-FIX, 3 findings, אפס blockers):** אביגיל אימתה דרך `gh` את **כל**
טענות-המפתח על ה-fork (קיום `resetTurnScratch`+השורה, ש-#785 השאיר אותה ב-0.47.0, ה-harness
החי + ה-helpers) ואת מנגנון ה-override שלנו (`override.bin/args` גוברים עבור claude). 3 הממצאים
היו שוליים: 🟡 Dev tip מיושן (→`3812e4f`), 🟡 ניסוח `npm run dev`=`build && start`, 🟢 שם
ה-bin key. **סבב 2 (READY, 0 findings)** — תוקנו ואומתו מול המקור. הלוגיקה (הסרת השורה →
green) אושרה.

> **היסטוריית-אימות הגרסה הקודמת (FE-shim, נזנחה):** אביגיל אימתה את ה-brief של ה-FE-shim
> עד READY ב-3 סבבים (findings על שמות-package/פקודות, לא על הלוגיקה). הפיבוט ל-fork קרה
> אחרי דיון עם המשתמש שחשף שהבאג ב-adapter (לא אצלנו) ושעדיף תיקון-שורש בלי לגעת בקוד שלנו.

## 2026-06-17 — wire-recorder-jsonl: הקלטת תעבורת WS לקובץ NDJSON — תכנון slice יחיד

### רציונל
המשתמש דיווח שתשובות ה-agent מגיעות ריקות — frame `agent_thought_chunk` עם
`content.text:""`. אבחנה ראשונית (מרדכי): ה-BE הוא **byte-pipe שקוף** (`ws-agent.ts`
מעביר כל שורה כפי שהיא), אז ה-`text` הריק מגיע ככה מה-CLI child עצמו (claude), לא נוצר
אצלנו; ובנוסף ה-FE כבר מסנן chunks ריקים (`agent-session.svelte.ts:1131 — if (!text) return`).
המסקנה: צריך **הקלטה גולמית של החוט** כדי לאמת אם ה-`text:""` כבר מגיע ריק מ-claude
(סביר — רגרסיה upstream) או נוצר אצלנו, וכדי לאתר כפילויות/ריקים שיטתית.

**הכרעות-מוצר (אושרו ע"י המשתמש דרך AskUserQuestion):**
- **Recorder ייעודי ל-JSONL** (ולא הפעלת ה-wire-logger הקיים): קובץ `.jsonl` נקי
  פר-session, ניתן-לניתוח טריוויאלי ב-`jq`/`grep`, במקום frames מעורבבים ב-stdout של pino.
- **"רק ההקלטה"**: בלי סקריפט ניתוח ובלי אימות-גרסה בסלייס הזה — תשתית בלבד.

**חיתוך**: slice יחיד, 3 commits — מודול `wire-recorder.ts` (factory + serialize טהור,
TDD) → חיווט ב-`ws-agent.ts` + הזרקה ב-`server.ts` עם env flag `WIRE_RECORD` → docs.
ה-tap נוסף **אחרי** ה-send/write/logWire הקיימים, try/catch סביב כל IO, no-op מוחלט
כש-`WIRE_RECORD` לא מוגדר — אפס השפעה על הזרם (אותו עיקרון פסיבי כמו slice-18 wire-logger).

### ממצאי אביגיל (2 סבבים → READY)
- **סבב 1 (USABLE-AFTER-FIX, 4 findings, אפס blockers)**: brief מדויק חריג — כל ה-symbols,
  נקודות החיווט (`ws-agent.ts:54/99/112/118/140`), ה-deps ב-`server.ts:96`, ו-`data/`
  ב-`.gitignore` אומתו. הבעיות cosmetic: (1) dev tip מיושן `848cf44`→`fb8c522` (2 commits
  קדימה, אף אחד לא נוגע בקבצי הסלייס); (2) line 113→112 לענף ה-$/ping; (3) אי-עקביות
  ב-arg של ה-$/ping record; (4) `noUncheckedIndexedAccess` יצריך guard בטסטים שאליעזר יכתוב.
- **סבב 2 (READY, 0 findings)**: כל 4 התיקונים אומתו מול הקוד.

### שינויי-כיוון
- אין שינוי סקופ/ארכיטקטורה — רק תיקוני דיוק טקסטואליים מסבב אביגיל.
- הובהר: בענף ה-$/ping ה-recorder מקליט את ה-`text` הגולמי (נאמן לחוט), לא את summary
  ה-`logWire` (`"$/ping → $/pong"`).

### רעיונות שנדחו
- **הפעלת ה-wire-logger הקיים (`LOG_WIRE=ws`) במקום recorder**: נדחה — הפלט מעורבב
  בשאר לוגי pino וקשה יותר לניתוח אוטומטי של כפילויות/ריקים. (עדיין זמין לאבחון מהיר.)
- **סקריפט ניתוח / אימות-גרסת-claude בסלייס**: נדחו ל-future לפי בחירת "רק ההקלטה".

## 2026-06-08 — active-agents: ווידג'ט תהליכים פעילים + נעיצה (Pin) — תכנון 2 slices

### רציונל
המשתמש ביקש ווידג'ט בטופס החיבור שמציג את כל ה-agents החיים בצד-השרת (CLI, תיקייה,
סשן, סטטוס, גיל, pid), כדי "לא לדאוג מתהליכים דולפים" ולהשאיר תהליכים רצים גם כשה-UI סגור.
רוב התשתית כבר קיימת (`GET /api/agents`, `bridge-manager`, נתיב warm-reconnect מ-slice
ws-reconnect). החסם היחיד: ה-idle-reaper (slice 26) הורג תהליך מנותק אחרי 5 דק'.

**הכרעות-מוצר (אושרו ע"י המשתמש):**
- **Pin פר-תהליך** (לא toggle גלובלי ולא הסרת reaper): ה-reaper ממשיך לנקות דליפות
  מקריות (reload/טאב שנסגר), אבל תהליך עם `persistent=true` שורד ללא הגבלה. שילוב של
  ניקוי-אוטומטי-בטוח + שליטה ידנית. זה **כן** ה-"future slice A" שהערות ה-TEMPORARY צופות —
  אבל הוא **מאלף** את ה-reaper (מחריג נעוצים), לא מוחק אותו.
- **פעולות לכל שורה**: חיבור-מחדש (דרך `session.loadSession` הקיים — warm-first, אפס קוד
  reconnect חדש) + הריגה (`deleteAgent` קיים) + Pin.

**חיתוך**: 2 slices משורשרים — `active-agents-backend` (שדה persistent, endpoint,
reaper-respects-pin, העשרת pid/attached) ואז `active-agents-widget` (VM+רכיב+חיווט).
ה-backend ניתן לאימות יחידתי ועומד בפני עצמו; הווידג'ט נשען עליו.

### ממצאי אביגיל (2 סבבים → READY)
- **backend** (סבב 1: 3 findings, אפס blockers): `bridgeManager` כשדה-חובה ב-deps של
  `registerAgentsHttp` היה שובר 2 call-sites בטסט (`http-agents.test.ts:34,150`) →
  **הוכרע: אופציונלי + guard `?.`**. גם: `persistent` חייב להיות **אופציונלי** בסכמה
  (אחרת `agent-schema.test.ts:88 toEqual` ו-`Agent({...})` בלי persistent נשברים) —
  אומץ דפוס conditional-copy כמו `crashReason`/`acpSessionId`.
- **widget** (סבב 1: 6 findings, אפס blockers): הטענה "lint:i18n אוכף שלמות קטלוגים"
  שגויה — **typecheck** אוכף (`Catalog = Record<MessageKey,string>`); lint:i18n אוכף רק
  עברית-קשיחה. בנוסף: `+page.svelte` כבר **316 שורות** (מעל ספיק ה-150) → הוכרע **לקבל
  כ-debt קיים, לא לחלץ בסלייס הזה**.

### שינויי-כיוון
- `bridgeManager` ב-deps: חובה → אופציונלי (לשמירת טסטים קיימים ירוקים).
- ספיק ה-150 ל-route ירד מקריטריון-dispatch להבהרה ("אין לוגיקה כבדה **חדשה**") לאור
  ה-debt הקיים של 316 שורות.

### רעיונות שנדחו
- **toggle גלובלי / הסרת reaper מלאה**: נדחו לטובת Pin פר-תהליך (לא מבחין בין תהליך
  שרצינו להשאיר לבין דליפה / מודל מנטלי גס מדי).
- **שמות-סשן אנושיים בווידג'ט**: דורש `listSessions` יקר (spawn) → מציגים sessionId קצר.
- **polling אוטומטי**: refresh ב-mount + כפתור ידני מספיק ל-v1.
- **הישרדות חוצת-restart של ה-BE** (daemon אמיתי): מחוץ ל-scope — registry בזיכרון,
  children מתים עם ה-BE (D8). "UI סגור" (דפדפן) כבר נתמך.

## 2026-06-08 — merge slice-ws-reconnect-infra → dev (תשתית auto-reconnect)

### רציונל
‏ה-slice עבר runtime-gate: כלב **GO** + calev-heavy ל-infra, ו-fix-nbug2 כלב **GO (7/8)**.
‏מוזג ל-dev עם `git merge --no-ff` (merge commit `f5b50ba`, base `f060fd3`). אישור מיזוג
‏מפורש מהמשתמשת.

### ממצאי אימות
‏NBug1+NBug2 (onClose תקוע ב-cold teardown; WS חי שלא נסגר לפני warm) — תוקנו ואומתו.
‏טסטים אחרי merge: typecheck ✓ | 677 passed / 12 skipped | lint:i18n ✓.

### שינויי-כיוון בזמן ה-merge
‏- **קונפליקט יחיד** ב-`docs/walkthrough.md` (changelog) — נפתר ע"י שמירת שני הבלוקים
‏  (ערכי dev החדשים + ערכי ws-reconnect). `agent-session.svelte.ts` (הקובץ המרכזי)
‏  התמזג אוטומטית למרות שינוי דו-צדדי (dev:new-session-warm + branch:reconnect).
‏- **i18n gate** חסם את הקומיט: כפתור ה-TEMP החזיק 2 מחרוזות עברית מקודדות-קשיח.
‏  הוחלט (משתמשת) ל-i18n כמו שצריך → מפתחות `record.reconnect/reconnecting/reconnectAttempt`
‏  (he+en), במקום לעקוף עם `--no-verify`.

### Known-debt (להסרה בסליס הבא)
‏- **כפתור reconnect ידני TEMP** ב-`RecordFooter.svelte` (commit `23e4a57`, מסומן
‏  `<!-- TEMP-RECONNECT-BUTTON -->`) — נשאר זמנית בהחלטת המשתמשת לצורך בדיקה ידנית.
‏  ה-UI הקבוע = `slice-ws-reconnect-ui` עוקב (`depends_on: [ws-reconnect-infra]`).
‏  **לא לשכוח להסיר** את הכפתור + 3 מפתחות ה-i18n כשה-UI הקבוע נכנס.

### נ"ב — fix-null-msgid-grouping
‏ה-branch `fix-null-msgid-grouping` **אינו** ממתין למיזוג: תיקון הקוד כבר ב-dev
‏(commit `47f9ad7`); ה-branch סוחב רק דוח calev ישן. מועמד למחיקת worktree.

## 2026-06-04 — slice pwa-installable: רמה A בלבד (installable), בלי service worker

### רציונל — למה אין offline/SW
‏האפליקציה חיה על חיבור חי (WS ל-agent, TTS/STT דרך רשת). offline חסר-משמעות —
‏בלי רשת אין שיחה. הערך האמיתי של PWA כאן הוא **התקנה למסך-בית + standalone
‏fullscreen** (בסיס ל-car mode על נייד, היעד שנדחה ב-archive/v1/future-features §14).
‏SW מוסיף סיכון של stale-cache + versioning bugs בלי ערך מיידי, ובמיוחד עלול
‏**להחמיר** debug של נפילות-WS (תועד ב-handoff "WS נופל לעיתים קרובות"). לכן: רמה A
‏(manifest + icons + meta) עכשיו; SW = slice עתידי נפרד רק אם יוכח צורך.

### החלטות-עיצוב
‏- **theme_color יחיד = ember `#16130f`** (manifest תומך רק בצבע סטטי). dynamic
‏  theme-color לפי palette נבחר = future.
‏- **iOS meta tags** (`apple-mobile-web-app-capable` + `status-bar-style:black-translucent`)
‏  נכללים — iOS Safari לא קורא display:standalone מלא מה-manifest. זו הסיבה שהפיצ'ר
‏  נדחה ב-v1; כאן נפתר. בדיקת iOS אמיתית = follow-up (אין מכשיר זמין) — לא חוסם merge.
‏- **לוגו placeholder** נוצר ב-PIL (equalizer קולי מעל נתיב-כביש בפרספקטיבה, פלטה ember).
‏  החלפה עתידית בנכס מעוצב = drop-in (אותם שמות קבצים ב-static/icons/).

### ממצאי אביגיל (USABLE-AFTER-FIX → תוקן → READY)
‏blocker יחיד: ה-brief השתמש ב-`--filter @drive-coding/frontend` אך שם ה-package הוא
‏`@drive-coding/frontend-v2` (התיקייה `frontend/` אך שם ה-package נשאר `-v2`). pnpm
‏מחזיר exit 0 **בשקט** על filter שלא תואם → build+typecheck לא היו רצים כלל וה-DoD
‏הקריטי לא נבדק. אותו דפוס תוקן ב-redesign-1 ו-wake-word-infra. תוקן ב-3 מקומות +
‏הוספת הערת-אזהרה מפורשת ל-executor. כל שאר הניתוח הטכני (serveStatic order לא בולע
‏את ה-manifest, MIME `application/manifest+json` נכון, adapter-static מעתיק `.webmanifest`,
‏Vite dev מגיש static, lint:i18n לא סורק .webmanifest) — אומת אמפירית ע"י אביגיל.

## 2026-06-04 — slice cli-specs-override: קובץ קונפיג חיצוני ל-CLI_SPECS + env-shaping ל-child

### רקע — gemini נשבר תחת OneCLI
‏ה-BE רץ דרך `onecli run` (חובה — ל-proxy של ElevenLabs/TTS). OneCLI מזריק
‏`HTTP(S)_PROXY` + `NODE_EXTRA_CA_CERTS` שמנתבים את **כל** תעבורת ה-child דרך ה-MITM
‏gateway. gemini-cli (child של ה-BE) יורש את זה, מנסה OAuth refresh מול Google, נכשל,
‏ונופל ל-login אינטראקטיבי שמדפיס escape-codes + OAuth URL ל-stdout ומזהם את ערוץ ה-ACP.
‏הוכח חד-משמעית: `onecli run -- gemini --acp` נשבר; אותו דבר עם `env -u HTTP_PROXY ...`
‏מחזיר ACP נקי. (opencode/claude/codex לא נפגעים — אין להם OAuth refresh כזה.)

### רציונל — למה קובץ קונפיג ולא hardcode
‏שתי חלופות נדחו: (א) סינון non-JSON-RPC ב-ws-agent.ts — מטפל בתסמין, לא בשורש;
‏(ב) hardcode של unsetEnv ל-gemini ב-CLI_SPECS — **נדחה במפורש ע"י המשתמשת**: "ישבש
‏אנשים שלא יבינו למה". הפתרון: קובץ JSONC חיצוני (`~/.config/drive-coding/cli-specs.jsonc`,
‏נתיב דריס דרך `CLI_SPECS_FILE`) שדורס/מרחיב את CLI_SPECS ומאפשר פר-CLI `unsetEnv`/`setEnv`.
‏**בלי הקובץ — התנהגות זהה להיום בדיוק** (opt-in מפורש). הטיפוס (CliSpec) מורחב ב-core
‏(טהור); הקריאה-מקובץ + מיזוג + env-shaping ב-backend (IO) — לפי AGENTS "no IO in core".

### ממצאי אביגיל (round 1 → USABLE-AFTER-FIX, round 2 → READY)
- 🔴 **new-CLI-from-file לא runnable**: `POST /api/agents` מוודא cliKind דרך ArkType enum →
  kind לא-ב-enum מקבל 400 לפני spawn. test#6 שדרש "getCliCommand מריץ CLI חדש" היה dead-code
  שסותר את §2 scope. **תוקן**: הוסר test#6 + לוגיקת fallback-to-run; CLI-חדש נגיש רק דרך
  getCliSpec ל-env-shaping (רלוונטי ל-CLIs שכבר ב-enum, כמו gemini). runnability עתידי = slice נפרד.
- 🟡 קובץ הטסט: `tests/cli-config.test.ts` כבר קיים → טסטים נוספים לשם, לא קובץ חדש.
- 🟢 risk lint:i18n מיותר (linter מתיר הערות).

### רעיון שנדחה
- **hardcode unsetEnv כברירת-מחדל מובנית** — נדחה (מבלבל משתמשים). הקובץ הוא ה-opt-in.

---

## 2026-06-03 — slice ws-reconnect-fix-nbug2: סגור-והמתן לפני warm (תיקון השורש)

### רקע — סבב ראשון נכשל (flag #tearingDown)
‏הניסיון הראשון תיקן את NBug2 כ"onClose ישן מקבל 1005 → לולאת reconnect שנייה", עם flag
‏`#tearingDown` שמשתיק את ה-onClose. **calev החזיר NO-GO (n=3 agents)** — ה-flag טיפל בתסמין
‏הלא-נכון. ה-`#tearingDown` נשאר בקוד (לא מזיק, מכסה 1005), אבל הוא לא השורש.

### השורש האמיתי (אובחן בקוד + לוג BE)
‏`reconnect()` על WS **חי** מדליף agent יתום **קבוע** (לא 5 דק'):
1. ‏`reconnect()` (`:534`) לא סוגר את ה-`#client` החי לפני warm.
2. ‏`#warmReconnect` עושה `this.#client = null` (`:289`) — **דורס את ה-handle ל-WS חי בלי
   ‏לסגור**. ה-WS נשאר פתוח ב-BE, בלי reference.
3. ‏warm פותח WS שני → ה-BE דוחה ב-**1008 "second tab"** (`ws-agent.ts:69`) → נופל ל-cold →
   ‏`createAgent` חדש. n≥2.
4. ‏ה-WS היתום לא נסגר → `feWs.on("close")` לא נורה → `markDetached` לא נקרא → `hasActiveWs`
   ‏נשאר `true` → **ה-reaper לעולם לא מנקה** (`bridge-manager.ts:210`: `if hasActiveWs continue`).
   ‏**יתום קבוע.**

### למה זה לא נגיש בייצור היום
‏רענון דף (הדפדפן סוגר WS → `idle` → `goto("/")`) ונפילת חיבור אמיתית (warm/cold נקיים) —
‏**שניהם לא מדליפים**. רק `reconnect()` על WS חי מדליף, וזה נקרא היום רק דרך API שעוד לא
‏מחובר לכפתור. אבל זה השער שכפתור ה-reconnect העתידי יפתח — לכן סוגרים עכשיו.

### ההכרעה — סגור-והמתן לפני warm (`closeAndWait`)
- ‏מוסיפים `closeAndWait(timeoutMs=1000)` ל-`WsAcpTransport`: סוגר את ה-WS וממתין ל-close
  ‏event (או timeout fallback). ה-VM שומר `#transport` ref (3 מקומות יצירה, 4 מקומות ניקוי),
  ‏ו-`#doReconnect` קורא `closeAndWait` לפני warm. כך ה-BE עיבד `markDetached` לפני שה-WS
  ‏החדש מגיע → אין 1008 → אין יתום.
- ‏**נדחה** רק-`close()` בלי await — מחזיר את ה-race (ה-close אסינכרוני).

### race שיורי (הודאה כנה — finding אביגיל)
‏ה-FE close וה-BE `markDetached` הם **שני צידי TCP** — לא קוֹזָליים. `closeAndWait` **מצמצם
‏מאוד** את החלון אבל לא מאפס אותו מתמטית. רשת הביטחון: לולאת MED-8 (3×250ms) בולעת 1008
‏בודד אם בכל זאת קורה. **הוודאות הסופית = calev בשטח (n=1).** שכבה שלישית אפשרית בעתיד:
‏`expose-has-active-ws` (slice נפרד) יאפשר לוודא מול ה-BE ישירות לפני warm.

### Complexity 4 → calev (light), re-verify ממוקד DoD#6/#7
‏האמת ש-NBug2 נסגר = **calev בשטח**: reconnect() על WS חי → n=1, detach→0, warm-fail→cold → n=1,
‏נפילה אמיתית עדיין נקייה (רגרסיה).

---

## 2026-06-03 — slice rtl-ltr-bidi: תמיכה דו-כיוונית מלאה (he/en ↔ rtl/ltr)

### רציונל
‏הבקשה הייתה "תמיכה מלאה ב-RTL/LTR, קלאסים לוגיים בכל הממשק". סריקת קוד גילתה שה-FE
‏**‏כבר RTL-clean כמעט לחלוטין** — נבנה מאפס ב-redesign עם convention שאוסר physical
‏classes: 0 physical Tailwind classes, CSS עם logical properties (`padding-inline-start`,
‏`border-inline-start`, `border-start-start-radius`, `border-s`), ו-`dir` attributes נכונים
‏(Switch=ltr, code/terminal=ltr, bubbles=auto). ה-BottomSheet משתמש ב-`translateY` (ציר
‏אנכי, לא מושפע מ-RTL). **‏אין "המרה גדולה" לעשות — היא כבר נעשתה.**

### הבעיה האמיתית — מוטה ל-RTL
‏החור היחיד שמונע דו-כיווניות: `<html lang="he" dir="rtl">` **קבוע** ב-app.html ולא מגיב
‏לשפה. יש כבר `I18nVM.locale` + `setLocale()` + קטלוג `en.ts` מלא — אבל החלפה ל-en
‏מחליפה רק את המחרוזות, **‏לא את כיוון הפריסה**. הממשק נשאר RTL גם באנגלית.

### ההכרעה — מקור-אמת אחד + effect גלובלי
- **`locale` = persisted field ב-Settings** (לא ב-I18nVM). ‏היום I18nVM מחזיק locale עצמאי
  ‏(detectLocale ב-init) — כפילות פוטנציאלית. ‏אחרי: Settings = מקור-אמת ששורד reload,
  ‏I18nVM.locale **נגזר** ממנו (getter). ‏ברירת מחדל בטעינה ראשונה (localStorage ריק) =
  ‏`detectLocale()` (שפת דפדפן), אחרת = הערך השמור.
- **`$effect` ב-`+layout.svelte`** (composition root) מסנכרן `document.documentElement.dir`+`lang`
  ‏ל-locale. ‏`RTL_LOCALES=["he"]`. ‏זה ה-side-effect שהופך את התמיכה לדו-כיוונית באמת.
  ‏ה-`<html>` אינו DOM-node של component → layout הוא המקום הנכון (לפי FE golden rule 4).
- **בורר שפה** ב-SettingsScreen דרך ה-`Select` הקיים (`onchange`, לא bind:value).
- **lint protection** (`lint:rtl`, script נפרד) שמגן על הניקיון הקיים — נכשל אם מישהו יכניס
  ‏physical class/property בעתיד. ‏**לא** ב-pre-commit hook (לא לשבור commits של סוכנים אחרים).

### רעיונות שנדחו
- **לתקן את `.toggle::after` (right physical)** — נדחה. ה-Switch נושא `dir="ltr"` אז ה-toggle
  ‏לא מתהפך (visual-only). ‏שינוי מיותר. ‏ב-allow-list של ה-lint.
- **inline script ב-app.html למניעת FOUC ב-en** — נדחה ל-slice עתידי. he ברירת מחדל, הפלאש מינורי.
- **locale כמקור-אמת ב-I18nVM** — נדחה לטובת Settings (persisted, מקור-אמת אחד).

### ממצאי אביגיל
‏Verdict READY (סבב ראשון). ‏4 findings: 🟡 אחד אמיתי — ה-prop של `Select` הוא `onchange`
‏ולא `onValueChange` (תוקן ב-skeleton של Commit 3, גם פישט את הקוד — ביטל bind:value+$effect).
‏3 minors אינפורמטיביים: ה-lint script הקיים הוא `.mjs` ב-root scripts/ (תוקן הנתיב); I18nVM
‏refactor zero-risk (אין קוראים חיצוניים ל-.locale/setLocale — escalation הוסר); אין parity
‏test he/en (הוספת מפתחות לא תשבור טסט). ‏כל ה-line numbers + APIs + §0 אומתו ב-tip 8f59ec3.

### Complexity / tier
‏3/10 → calev light בלבד, ‏אין verifier-phase. ‏5 commits: (0) Settings.locale persisted ·
‏(1) I18nVM נגזר · (2) $effect dir/lang ב-+layout [הליבה] · (3) LanguageSelect · (4) lint:rtl.

---

## 2026-06-03 — slice fix-409-replace-flag: דגל replace ל-warm switch

### רציונל
‏ב-warm switch (מעבר בין סשנים על אותו agent) `notifySessionAttached` קיבל 409 כי
‏guard MED-9 (`http-agents.ts`) חוסם update של `acpSessionId` כש-agent כבר "ready" עם
‏sessionId אחר. ה-`.catch(()=>{})` בלע את השגיאה — המשתמשת לא ראתה, אבל ה-registry
‏של ה-BE נשאר עם sessionId **ישן**, סיכון ל-reconnect/recovery עתידי (slice 10/recovery)
‏שישחזר לסשן הלא-נכון.

### ההכרעה — דגל מפורש, לא ביטול ה-guard
‏הוספנו `replace?: boolean` ל-`notifySessionAttached`. ה-guard מדלג **רק** כש-`replace===true`
‏(strict — לא `!replace`, כדי שערך לא-בוליאני ייחשב false). `switchSession` שולח `replace:true`;
‏`attach`/`loadSession` (חיבור ראשון) נשארים בלי הדגל → ה-guard MED-9 עדיין מגן עליהם מפני
‏"agent in use by another tab". כלומר: שמרנו על ההגנה לחיבור ראשון, התרנו same-agent update
‏מפורש בלבד. אדיטיבי לחלוטין — אין שינוי התנהגות למסלולים קיימים.

### ממצאי אביגיל
‏Verdict READY מהסבב הראשון. כל ה-API ומספרי השורות אומתו ב-tip האמיתי (ה-Base ב-brief היה
‏stale ב-commit אחד של docs בלבד — אישרה שזה ancestor ושכל מספרי השורות תקפים). אישרה שה-body
‏המצורף-לסשן הוא raw cast (אין ArkType schema לעדכן), ושיש כבר טסט 409 קיים שמשמש תבנית.

### אימות + merge
‏calev GO, 0 findings, 11/11 DoD. אומת e2e דרך tunnel ע"י המשתמשת ("זה עובד"). מוזג ל-dev
‏ב-`1fbab1c` (merge commit).

### באג שהתגלה בבדיקה (לא חלק מה-slice) — קריינות כלים במצב מושתק
‏בבדיקה הידנית התגלה: כש-Speaker מושתק כללית (`enabled=false`), קריינות **כלים** עדיין
‏מושמעת. הסיבה: `Speaker.#processToolBubbles` בודק רק את `narrateTools` ולא את `enabled`
‏(בניגוד ל-`#processBubbles` שכן בודק `enabled` ב-`speaker.svelte.ts:246`). תועד כ-known bug
‏לתכנון slice נפרד (`docs/future-features.md`). לא תוקן כאן — מחוץ ל-scope.

## 2026-06-03 — slice ws-reconnect-infra: שחזור WS עצמי-מרפא (warm-first, תשתית בלבד)

### רציונל
‏נפילת WS השאירה את המשתמש תקוע — `status="error"`, "WS closed (...)" אדום, והדרך
‏היחידה חזרה הייתה רענון מלא של הדף ואיבוד כל השיחה. זה החסם שהמשתמשת דיווחה עליו.
‏ה-slice מוסיף ל-`AgentSession` יכולת **לשחזר את עצמו**: ב-`onClose` לא-מכוון, אם הדף
‏בפוקוס → לולאת backoff (1+2+4+8+16s≈31s, 5 ניסיונות); אם ברקע → מצב `disconnected`
‏שממתין ל-`reconnect()` יזום. מתודה ציבורית `reconnect()` נחשפת ל-UI עתידי.

### ההכרעה הארכיטקטונית המרכזית — warm-first עם cold fallback
‏reconnect הוא **warm-first**: קודם `GET /api/agents` (`listAgents` adapter חדש) → אם יש
‏agent חי עם אותו `acpSessionId`+`cwd` (status לא crashed/closed) → **warm**: WS חדש
‏לאותו agentId + `loadSession` ACP (בלי `createAgent`/spawn, חוסך ~300-700ms). אם לא
‏נמצא / warm נכשל → **cold**: `loadSession` מאפס (agent חדש). זו בחירת המשתמשת: "אם יש
‏אחד קיים, עדיף להתחבר אליו — לא תמיד לפתוח חדש כי זה לוקח זמן". (בתחילה תכננתי cold-only;
‏המשתמשת ביקשה במפורש להכניס את ה-warm ללב התכנון ולא להדביק אותו אח"כ.)

‏**למה גם warm קורא `loadSession`**: ה-bubbles ב-FE אבדו עם ה-WS, אז גם warm חייב לטעון
‏היסטוריה. החיסכון היחיד מ-cold = דילוג על spawn. ה-warm מחקה את הדגם של `switchSession`
‏(שכבר עושה loadSession-on-existing-client), רק עם WS חדש לפניו.

‏**אין buffer/diff צד-שרת** (שאלת המשתמשת): ה-BE הוא pure pipe — `historyBuffer` הוסר
‏ב-slice 9 (`agent-orchestrator.ts:14`). המקור-אמת היחיד של השיחה הוא הסוכן עצמו, ו-`loadSession`
‏מושך ממנו הכל. buffer אמיתי (לשחזר updates *תוך-כדי* נתק) = future slice נפרד, מתועד.

### MED-8 race + ה-deadlock (תפיסת אביגיל)
‏warm מתחבר לאותו agentId → אם ה-BE עוד לא עיבד את ה-`close` הישן, ה-WS נדחה ב-1008
‏("agent in use by another tab"). הפתרון: retry קצר (250ms ×3) ואז fallback ל-cold.
‏**אביגיל תפסה deadlock קריטי**: `WsAcpTransport.waitForOpen` מאזין רק `open`+`error`,
‏**לא** `close` — וסגירת 1008 היא `close` event → `waitForOpen` נתקע לנצח. התיקון:
‏`Promise.race([waitForOpen, closeOutcome])` כך שה-close זוכה במרוץ. **לא נגענו ב-BE**
‏(הפתרון כולו ב-FE).

### הפרדה infra/UI לפי בקשת המשתמשת
‏המשתמשת ביקשה לפצל: **כל תשתית ה-VM קודם, אפס נגיעה ב-UI** ("ככה נוכל בשלב הבא להחליט
‏איך זה ייראה"). ה-slice הוא pure VM+adapter, נבדק דרך `window.__session` ב-console
‏(DoD #17: `git diff --stat` רק `agent-session.svelte.ts`+`agents-api.ts`+טסט+docs).
‏ה-UI (כפתור + חיווי) הוא `slice-ws-reconnect-ui` עוקב, JIT, `depends_on: [ws-reconnect-infra]`.

### הקשר ל-decisions ההיסטוריות (גישה A/B)
‏ב-slice 25/26 הפרדנו: **גישה B** (עצירת דימום + reaper, merged) מול **גישה A** (reconnect
‏אמיתי + agents-ברקע + ממשק ניהול, נדחתה). slice זה הוא **החלק של reconnect מתוך A** —
‏בלי agents-ברקע / multi-agent. התשתית שהושארה בכוונה ל-A (`ws-agent.ts:127` — child שורד
‏WS close; reaper 5 דק' כחלון reconnect) **עובדת בדיוק בשבילנו**. סך backoff (~31s) << reaper.

### ממצאי אביגיל (3 סבבים — דוגמה לערך plan-gate)
- ‏**סבב 1 (cold-only)**: READY — אבל ה-base שלי היה מיושן (`6e8b504` במקום `8f59ec3`).
- ‏**סבב 2 (warm-first)**: USABLE-AFTER-FIX. תפסה 5 בעיות אמיתיות: (1) ה-**deadlock** ב-`waitForOpen`
  ‏(blocker — היה שובר את כל ה-warm-path); (2) forward-reference (`#handleUnexpectedClose`
  ‏נקרא ב-Commit 2 אבל הוגדר ב-Commit 3 → typecheck שבור); (3) `notifySessionAttached` **כן**
  ‏תומך ב-`replace` (ה-base המיושן שלי); (4) `switchSession` הוא דגם warm קיים שהתעלמתי ממנו;
  ‏(5) מספרי שורות off-by-1-2.
- ‏**סבב 3 (READY)**: התיקון של fix#1 (warm קובע `connecting`) יצר blocker חדש — warm-fail
  ‏השאיר `connecting`, ואז `#coldReconnect`→`loadSession` guard:217 זורק → ה-fallback שבור.
  ‏תוקן: `#coldReconnect` מאפס `connecting`→`disconnected` (עובר את ה-guard) לפני `loadSession`.
  ‏finding יחיד נותר ירוק (pre-existing: `#client=null` בלי `.close()`, מחוץ ל-scope).

### רעיונות שנדחו
- ‏**cold-only** (התכנון המקורי) — נדחה לבקשת המשתמשת לטובת warm-first (חיסכון spawn).
- ‏**buffer/diff צד-שרת** — מיותר (`loadSession` מושך הכל מהסוכן). buffer-תוך-כדי-נתק = future.
- ‏**שינוי BE ל-MED-8** (שחרור `activeFeWs` סינכרוני) — נדחה; retry+fallback ב-FE מספיק.
- ‏**reconnect אוטומטי בחזרה-לפוקוס** — ברירת-מחדל "לא" (אושר). הפעלה = שורה אחת (§9 Q1).

## 2026-06-02 — slice fix-idle-flaky: ייצוב flaky test ב-bridge-manager.idle.test.ts

### רציונל
‏אחרי merge של integration-all (dev `266322f`), `bridge-manager.idle.test.ts` test 4
‏נכשל **אקראית** ב-`pnpm test` מלא (עומס scheduler) ועבר 12/12 לבד. שורש: הטסט קורא
‏`createdAt = Date.now()` *אחרי* `await spawnBridge`, אבל ה-`e.createdAt` האמיתי נקבע
‏*בתוך* spawn (bridge-manager.ts:143). ה-`await spawnBridge` היקר מכניס drift → `now`
‏שהטסט בונה (`createdAt_test + timeout*2 - 1`) נמדד מול `e.createdAt` קטן יותר → delta
‏בפועל ≥ `timeout*2` → ה-bridge מוחזר → `not.toContain` נכשל. **קוד הפרודקשן `listIdle`
‏תקין** (אומת בלוג חי + 5 ריצות).

### הכרעה — getter ולא hack
‏חשיפת getter `getCreatedAt(id)` שמחזיר את ה-`createdAt` האמיתי מה-store, והטסטים 4+5
‏מודדים ממנו (לא מ-`Date.now()`). נדחתה החלופה "ללכוד `Date.now()` לפני spawn + שוליים"
‏— hack עם שוליים שרירותיים. ה-getter מסיר את כל אי-הוודאות: טסט וקוד מודדים מאותו ערך.
‏**אסור לגעת ב-`listIdle` עצמו.** הקובץ + getter מסומנים TEMPORARY slice 26, יימחקו
‏עם נחיתת background-agent management.

### ממצאי אביגיל
‏READY סבב 1. 2 findings לא-חוסמים: 🟡 ה-brief נימק שטסטים 2/3/6 לא-flaky כי "הטסט
‏שולט בנקודת הזמן" — אביגיל הצביעה שזה לא מדויק מכניזמית (`lastDetachedAt` נקבע בקוד
‏בדיוק כמו `createdAt`); הסיבה האמיתית = אין `await` יקר בין `markDetached` ל-`listIdle`
‏בטסט (אותו tick, drift≈0). המסקנה זהה (לא צריך לתקן 2/3/6), רק הנימוח עודכן ב-§3.
‏🟢 הערת `sleep 100` מיושנת בטסט — לא מה-brief.

### שינויי-כיוון
‏אין. תיקון נימוח-בלבד ב-§3 לפי finding 🟡. ה-verdict היה READY מלכתחילה.

---

## 2026-06-02 — slice review-fixes-2: timeout בכל ה-FE adapters (sequel ל-helper)

### רציונל
אחרי ש-review-fixes-1 הוסיף את `withTimeout`, סרקנו את כל הקוד למקומות שצריכים timeout.
מצאנו: agents-api (createAgent/notifySessionAttached/deleteAgent — 0 timeout), voices+tts
(F7 — picker/TTS נתקעים), narrate (timeout ידני — כפילות). מחילים את ה-helper על כולם.

### היקף — מה בפנים ומה בחוץ
**בחוץ במכוון**: (א) **BE proxy streaming** (`http-proxy.ts`) — timeout על stream הוא
בעיה שונה (connect-vs-stream), סבב נפרד. (ב) **getAgent** — אין לו צרכן בקוד (grep);
החלטת המשתמשת: לא לגעת, רק הערת TODO שמפנה תשומת לב. לא לתקן F4 כאן.

### הנקודה העדינה — tts connect-timeout בלי לקטוע streaming
`synthesizeStreaming` מחזיר ReadableStream. `fetch()` resolve על קבלת ה-headers (לפני
צריכת הגוף), אז `withTimeout` עוטף רק את ה-connect+first-response; ה-stream שמוחזר נצרך
אחרי שה-helper הסתיים והטיימר נוקה → הזרמת אודיו ארוכה לא נקטעת. אביגיל אישרה טכנית.

### שרשור
depends_on=[slice-review-fixes-1]. base = branch slice-review-fixes-1 (לא dev, ה-helper
עוד לא merged). סדר merge: review-fixes-1 → dev, ואז review-fixes-2 → dev.

### ממצאי אביגיל
READY סבב 1 (נדיר). 2 minors 🟢: caller שלישי של createAgent (sessions.ts:42 — signal
additive בטוח), narrate block 32-51 (לא 32-54). שניהם תוקנו.

## 2026-06-02 — slice review-fixes-1: F1+F3 (לא T6), ו-Promise.race ל-transcribe

### רציונל
מתוך ה-code review (2026-06-01) בחרנו לאגד 3 באגים ל-slice "review-fixes" אחד.
אחרי חקירה — **T6 (cache-key sanitization) ירד**: הוא כבר מומש ומחווט בתוך slice 24
(`sanitizeCacheKey` = sha256 ב-proxy-cache.ts:63, נקרא ב-http-proxy.ts:97). ה-review
נכתב על tip 115419d, לפני שהקוד הזה נכתב. נשארו F1+F3 — שניהם FE, קצרים, depends_on=[].

### ההכרעה הקריטית — `withTimeout` helper ב-core (לא inline Promise.race)
בתחילה תכננו Promise.race inline בתוך transcribe. המשתמשת שאלה אם עדיף helper משותף —
ובדיקה הראתה 3+ צרכנים (F3 transcribe, F7 voices+tts, ו-translate שעושה ידנית) → abstraction
מוצדק. נכתב `withTimeout(fn, ms, opts?)` ב-`core/src/async/with-timeout.ts` (export חדש `/async/*`).

**הסמנטיקה**: ה-helper **תמיד** עושה `Promise.race` (משחרר את ה-await ללא תלות ב-SDK)
**וגם** תמיד מספק `AbortSignal` (ביטול-רשת אמיתי כש-SDK תומך, כמו ה-`ai` SDK של translate).
שני העולמות בפונקציה אחת — הקורא בוחר אם להעביר את ה-signal ל-SDK שלו.

**שני מלכודות שה-helper מטפל בהן מפורשות** (המשתמשת זיהתה את הראשונה):
- **unhandled rejection**: כשה-timeout מנצח, הצד המפסיד (ה-fn) עלול לדחות מאוחר (AbortError)
  כשאף אחד כבר לא עושה לו await → `void work.catch(()=>{})` בולע (בלי לגזול מהקורא — ה-reference
  המקורי עדיין ב-race).
- **timer leak**: `clearTimeout` ב-finally לכל כיוון. כש-work מנצח → ה-timeout Promise נשאר
  pending לנצח (לא reject) → GC, לא unhandled.

**למה helper ולא 4 inline copies**: בדיוק 2 המלכודות האלה קל לשכוח בהעתקה ידנית (כמו שראינו
ב-slice 26 עם mock לא מעודכן). פונקציה אחת מטופלת-היטב + טסטים = מקור-אמת יחיד.

מבנה: Commit 0 helper (TDD, כולל טסט no-unhandled-rejection ו-timer-cleanup), Commit 1 F3,
Commit 2 F1, Commit 3 יישור translate.ts ל-helper. T6 ירד (כבר ב-slice 24).

### ממצאי אביגיל
סבב 1: USABLE-AFTER-FIX, 4 findings. הקריטי (1+2): ה-brief נתן לאליעזר **שתי גישות
סותרות** (abortSignal-only ב-§4/§6/DoD מול Promise.race ב-§9), וה-brief עצמו הודה
ש-abortSignal-only עלול לא לתקן את הבאג. תוקן ע"י בחירת Promise.race וסנכרון כל הסעיפים.
minors: line numbers של mic.svelte.ts הם reference (slice 6 עשוי להזיז), טענת "טסטים
negative" ל-T6 לא אומתה (הוסרה). סבב 2: **READY** (1 minor — ASCII diagram stale, תוקן).

### שינויי-כיוון
F3 timeout שונה מהתקן-זהב translate.ts ב-2 דברים מתועדים: (א) Promise.race ולא
abortSignal-only, (ב) זורק ולא מחזיר null (כי ה-Mic VM כבר תופס ב-catch).

### רעיונות שנדחו
abortSignal-only (כמו translate) — נדחה כי ה-SDK לא מבטיח שמכבד אותו → לא עמיד.

## 2026-06-01 — redesign vNext: חלוקה ל-slices + foundation-first

### רציונל החלוקה
שיפוץ העיצוב (spec: `docs/plans/redesign-vnext.md`, anchor: `redesign-vnext-mockup.html`)
מפורק לפי עיקרון מנחה: **הפרדה בין "custom UI" ל-"primitives"**. ה-foundation ראשון
(תשתית בלבד), ואחריו ה-slices מסודרים כך שכל מה ש-headless component-lib *לא* נוגעת בו
(layout shell, mic, bubbles, avatars, header) בא **לפני** מה שכן (Settings=Switch/Select,
Modals=Dialog/Sheet). זה לא שרירותי — זה מתזמן את ההכרעה על ה-component-lib לרגע שבו
יהיה הכי הרבה מידע (קוד אמיתי, RTL נבדק), בעלות-טעות מינימלית.

הפירוק (JIT — רק foundation נכתב כ-brief מלא כעת; השאר כותרות):
1. **redesign-1 foundation** (complexity 5, depends_on []) — Tailwind 4 + 4 themes + Lucide. תשתית שקופה, לא נוגע במסכים.
2. **redesign-2 layout shell** (depends_on [1]) — AppShell/AppHeader/Sidebar+BottomSheet (A1/A2/A3/A4/A5/H). custom לגמרי. ה-BottomSheet drag → אולי vaul-svelte, נבדק שם.
3. **redesign-3 settings** (depends_on [1,2]) — SettingsScreen (D1/D2). **כאן ההכרעה על component-lib** (Switch/Select). חופף ל-slice 9a (speech toggles) — לתאם, לא לכפול.
4. **redesign-4 input+mic** (depends_on [1,2]) — RecordFooter, toggle הקלדה/הקלטה, mic 110px (B1/B2/B3/B4). custom.
5. **redesign-5 bubbles** (depends_on [1,2]) — ToolBubble align (C2), avatars (C3), פלטה על בועות (C4). **כולל באג segments C1 — slice ייעודי עם plan-verify** (data-model).
6. **redesign-6 modals** (depends_on [1,2,3]) — SessionsScreen (E1) + FolderPicker (E2) + Dialog. תלוי בהכרעת component-lib מ-3.
7. **redesign-7 smart-scroll** (depends_on [1,2]) — G1 (jump-down) + A5. ♻️ מ-v1.

C1 (באג segments) ו-C2 (tool align) הם תיקוני-באג שאפשר לשחרר מוקדם — אבל **לא לפני foundation**
(שניהם נוגעים בקומפוננטות שייכתבו מחדש; פיצול מהקשר העיצובי = עבודה כפולה). לכן נשארים תחת redesign-5.

### ההכרעה על component-lib — מתוזמנת, לא פתוחה-באוויר
**Bits UI כמוביל; הכרעה סופית ב-redesign-3 (Settings).** רציונל: ה-foundation לא צריך ספרייה
(Tailwind+themes+icons בלבד), אז המתנה חינמית; וה-primitives (Sheet/Select/Dialog/Switch)
מרוכזים ב-2 slices בלבד (3+6) → עלות-אימוץ ועלות-החלפה נמוכות. הערך של headless lib הוא
**ההתנהגות הבלתי-נראית** (a11y/aria, focus-trap+restore, ניהול-מקלדת, scroll-lock, click-outside,
positioning) — לא העיצוב (שאנחנו עושים מצוין ב-Tailwind, כפי שהמוקאפ מוכיח). Bits מנצח על Melt
כי הוא קומפוננטות-מוכנות runes-native (Melt = builders low-level; אנחנו בונים אפליקציה, לא ספרייה).
**סייג**: אם Bits נלחם ב-RTL/עיצוב על Select — חזרה ל-native styled `<select>` היא תשובה לגיטימית.

### redesign-2: multi-route + AppShell-as-component (לא single-page/route-group)
המוקאפ הוא single-page (`data-view` שמתחלף ב-JS) — זה **artifact של HTML סטטי**, לא הוראת-מימוש.
במוצר נשארים **multi-route** (`/`, `/chat`, `/settings`), וה-shell המשותף הוא **קומפוננטה עוטפת**
(`AppShell` ב-lib/components/layout) עם `{@render children()}`, **לא** route-group (`(name)/`) ו**לא**
nested `+layout`. רציונל: route-group = הזזת קבצים invasive; AppShell-component = אפס הזזה, שומר
חוק-זהב #1 (לא route ענק), משותף ל-chat+settings. (אביגיל אישרה: תבנית Svelte 5 ישימה, אין מלכוד.)

### redesign-2: scroll ownership עובר ל-AppShell (תיקון double-scroll)
אביגיל תפסה: ChatBubbles **כבר** scroll-container (overflow-y:auto + auto-scroll $effect), וה-AppShell
עוטף ב-scroll נוסף → double-scroll ששובר את הגלילה. **הכרעה**: ה-scroll עובר ל-AppShell; ChatBubbles
מאבד את ה-overflow+bind:this+$effect (הופך ל-content בלבד). ה-auto-scroll $effect עובר ל-AppShell
(חוק-זהב #4 — owner של ה-DOM node). redesign-7 (smart-scroll) יושב על אותו scroll-container.

### redesign-2: disconnect + audio-master עוברים ל-AppHeader (מניעת רגרסיה)
ChatHeader הנמחק החזיק `onDisconnect` (session.detach) + audio-toggle (speaker.enabled/toggle).
ה-AppHeader של המוקאפ לא כולל אותם. כדי לא לאבד פונקציונליות: שניהם נשמרים ב-AppHeader כאייקונים
(LogOut + Volume2/VolumeX). **ימוקמו מחדש ב-redesign-3**: disconnect→SessionOptionsPanel, audio-master→
SettingsScreen ליד 3 ה-toggles המפורטים. (אביגיל #1.)

### redesign-3: Bits UI Switch ✅, native Select (fallback) ✅ — מתועד

בוחרים **Bits UI Switch** (Root+Thumb) עם ה-`.toggle` CSS helper מ-app.css — RTL-safe, a11y מובנה.
**Native styled `<select>`** (לא Bits Select): Bits Select דורש Portal + JS overhead + RTL quirks שמסובכים לצרוך. ה-brief (§7) אישר: "fallback native styled select — לגיטימי". SelectOpts מוחזרים כ-props פשוטים. תועד ב-`components/ui/Select.svelte` (comment).

### redesign-3: בולע את slice 9a (לא מבוצע בנפרד)
slice 9a (speech toggles, plan-verified, base dev) נבלע ל-redesign-3 כדי לא לעצב toggles פעמיים
(פעם CSS גלם ב-9a, פעם Bits/Tailwind ב-redesign-3). הלוגיקה זהה (Settings fields + Speaker getters,
processedSegments מונע בליעה), העיצוב לפי המוקאפ. **9a מסומן superseded — לא יבוצע.**
VoicePicker **לא נמחק** (connect route משתמש בו, +page.svelte:92) — reuse בתוך SettingsScreen.

### redesign-5: C1 (segments bug) = rendering-only, לא data-model refactor
ה-spec רמז "אולי slice עם data-model refactor". אחרי בדיקת קוד: **לא צריך.** ה-Speaker צורך
`bubble.segments` כ-buffer ומריץ splitIntoSentences בעצמו (לא מסתמך על segment=משפט); MessageBubble
כבר עושה join לטקסט רץ. רק **ThoughtBubble** עושה div-per-segment (זה הבאג). התיקון: ThoughtBubble
מרנדר טקסט-רץ (מקור) / per-משפט (מתורגם). ה-data-model של segments **נשאר** — Speaker+thought-translation
תלויים בו. (חוסך slice שלם של refactor מסוכן.)

### foundation = תשתית שקופה (לא ממיר קומפוננטות)
ה-foundation **לא** ממיר את 14 הקומפוננטות הקיימות ל-Tailwind ולא משנה אף מסך. הוא מגדיר את
אותם שמות-tokens (`--bg`/`--fg`/`--accent`...) שהקומפוננטות כבר צורכות דרך `var()`, כך שהן
ממשיכות לעבוד זהה. המיגרציה בפועל קורית slice-by-slice כשכל אזור נכתב-מחדש מהמוקאפ. זה מכבד
חוק-זהב #5 (אסור backward-compat-in-place — או refactor מלא של אזור, או לא לגעת). DoD דורש
ש-/chat ייראה **זהה** לפני/אחרי (regression check ויזואלי).

### ממצאי אביגיל (foundation, 2 סבבים)
- סבב 1: USABLE-AFTER-FIX. blocker #1: כל פקודות `pnpm --filter @drive-coding/frontend` נכשלות —
  שם ה-package הוא `@drive-coding/frontend-v2` (התיקייה `frontend/` אך השם הפנימי נשאר -v2 מה-cutover).
  +2 בלבולים: גרסת Lucide שגויה (`^0.500.0` — `@lucide/svelte@next`=1.3.x), נתיבי `var(--muted)` חסרי `chat/`.
- spot-check מלא עבר: context.ts createContext, +layout additive, SPA-only, token-coverage, plugin-order, חוק-זהב #4.
- סבב 2 אחרי תיקון: **READY**. findings #4 (Icon value-export — fallback מכסה) ו-#5 (Heebo לא נטען — regression-neutral) התקבלו כ-wontfix מתועדים.

### רעיונות שנדחו
- **מיגרציה הדרגתית של Tailwind** (page-by-page side-by-side): נדחה — המשתמשת הכריעה מיגרציה מלאה. אבל "מלאה" ≠ "במכה אחת": ה-foundation תשתית, ההמרה slice-by-slice.
- **לכתוב את 5 ה-primitives ידנית** (בלי component-lib): נדחה כברירת-מחדל — a11y+focus-trap עבודה אמיתית עם סיכון-באגים. נשאר כ-fallback ל-Select אם Bits נלחם ב-RTL.
- **לפצל C1/C2 ל-slices מוקדמים עצמאיים** (לפני foundation): נדחה — שניהם נוגעים בקומפוננטות שייכתבו מחדש; פיצול = עבודה כפולה.
- **Skeleton UI**: נדחה (§1.2 spec) — opinionated, "look" גנרי, מתנגש בפלטה הייחודית.
## 2026-06-02 — redesign debug: סטיות מהתוכנית בדיבוג ההרכבה המצטברת (worktree redesign-7)

אחרי שכל 7 ה-slices של ה-redesign בוצעו (calev GO בבידוד) אך לא מוזגו, ההרכבה
המצטברת (tip redesign-7) נבדקה במובייל אמיתי והתגלו באגים שאף slice לא תפס
בבידוד. התיקונים בוצעו ישירות ב-worktree redesign-7 (לא brief/executor — באגי
layout שאובחנו במדויק), בשיטת "מרדכי מבצע + verifier אחרי". להלן כל הסטיות מהתוכנית.

### למה הבאגים נפלו בין הכיסאות
calev בדק כל slice בבידוד — שם כל אחד תקין. הבאגים נולדו מ-**ההרכבה** + מ-**נתונים
אמיתיים** (שיחה ארוכה עם בלוקי קוד), שלא נבדקו ב-isolation. זה חיזק את הצורך
בכלי ה-mock (ר' למטה) ובבדיקה על נתונים אמיתיים, לא רק happy-path ריק.

### B1 — RecordFooter: child בתוך scroll → footer slot כ-sibling shrink-0
**תוכנית (redesign-4/7):** RecordFooter רונדר בתוך `children` של ה-scroll → נגלל וצף
באמצע בסשן ריק. **תיקון:** AppShell חושף snippet slot נפרד `footer`, sibling של
`.chat-scroll`, מעוגן `shrink-0` בתחתית (כמו ChatColumn במוקאפ). `chat/+page.svelte`
מעביר RecordFooter דרך `{#snippet footer()}`. הוסר `onDisconnect` prop drilling.

### B2 — disconnect+audio: חוב מ-redesign-2 שלא נפדה → הועברו ל-SessionOptionsPanel
**שורש:** redesign-2 מחק את ChatHeader אך השאיר disconnect+audio ב-AppHeader זמנית
(הערת "ימוקם מחדש ב-redesign-3"). redesign-3 לא קלט את ה-chit ל-DoD שלו → 4 פקדים
ב-header → הכותרת הממורכזת (absolute) חופפת את הסטטוס במובייל צר. **תיקון:** הוסרו
מ-AppHeader, הועברו ל-SessionOptionsPanel (disconnect = `session.detach()`+`goto("/")`
ישירות, audio דרך `getSpeaker()` — לא prop drilling). header נקי = 2 פקדים כמו מוקאפ.
**ביקורת חובות מלאה:** מתוך 6 chits בשרשרת — 5 נפדו (SessionOptionsPanel מחווט,
AgentOptionsPanel מוזג+נמחק, FolderPicker מחווט, proof-Lucide הוסר, carMode placeholder
מכוון). רק disconnect+audio נשאר — תוקן כאן.

### B3 — mic-card גולש 682px: flexbox min-w-0 חסר
**שורש:** ה-flex item של עמודת התוכן (AppShell) חסר `min-w-0` → התרחב ל-min-content
(714) במקום להתכווץ ל-390 (flexbox gotcha). `overflow-hidden` חתך ויזואלית אבל המרכוז
חושב לפי 714 → mic גלש שמאלה. **התגלה רק עם session אמיתי** (תוכן עברי ארוך מעלה את
ה-min-content). **תיקון:** `min-w-0` על עמודת התוכן.

### B4 — bubbles+בלוקי קוד גולשים: min-w-0 בשרשרת הבועות
אותו שורש משפחתי כמו B3, בכל רמה. `truncate font-mono` (ToolBubble) ו-inline code
(MessageBubble) דחפו את ה-min-content. **תיקון:** `min-w-0`+`break-words` על 4 הבועות
(wrapper + inner container), `overflow-wrap:anywhere` ל-inline `code`.

### B5 — vh במובייל אמיתי: BottomSheet height מ-vh ל-{sheetPx}px
**שורש (נמדד על CPH2747 דרך Edge+CDP):** `vh`/`lvh`=752 (large viewport, כולל סרגלי
דפדפן) אך `dvh`/`svh`/`innerHeight`=625. ה-sheet `height:80vh` חושב 601px (צריך 500) →
הידית צפה על המיקרופון. **תיקון:** height מ-`{SHEET_VH*100}vh` ל-`{sheetPx}px` (JS
`window.innerHeight` = dvh מדויק ב-Edge Android). `bottom:1098` נשאר מתחת למסך אך לא
מזיק (רק top קובע את ה-peek הנראה).

### UX-1 — RTL: physical → logical classes
האפליקציה כבר RTL (`<html dir="rtl">` + dir attributes קיימים). רק 3 physical classes
נותרו ולא התהפכו: UserBubble `rounded-bl-sm`→`rounded-es-sm`, MessageBubble
`rounded-br-sm`→`rounded-ee-sm`, mic-card logical corners, Switch קיבל `dir="ltr"`
(toggle ויזואלי — חריג שלא מתהפך). `left-1/2 -translate-x-1/2` (centering) נשאר — לא RTL.

### UX-2 — מובייל: fade במקום כרטיס
**מוקאפ:** במובייל אין mic-card — הרקע שטוח וההודעות נמוגות דרך chat-fade. **תיקון:**
class `.mic-plain` (כש-`responsive.isMobile`) מאפס border/radius/shadow/bg של ה-mic-card,
footer מקבל `background:var(--bg)`.

### UX-3 — chat-fade: wrapper סביב הגלילה (תוצר-לוואי של B1)
**שורש:** אחרי B1 (footer הפך sibling), ה-chat-fade (`absolute bottom-0` של העמודה)
נתקע מתחת ל-footer האטום ונעלם → פס חד. **תיקון:** אזור הגלילה עטוף ב-wrapper
`relative flex-1`, ה-fade `bottom-0` בתוכו → נצמד לגבול גלילה/footer (המוקאפ עושה זאת
ב-JS עם `footer.offsetHeight`; אנחנו ב-CSS נקי). JumpDown הוזז `bottom-20`→`bottom-4`.

### UX-4 — BottomSheet: גרירה רציפה + 3 detents
**תוכנית:** sheet בינארי (peek↔open, snap ±30px). **בקשת משתמשת:** גרירה עם האצבע +
לקבוע כמה ייפתח. **תיקון:** UiShellVM קיבל `sheetDetent` ("peek"|"half"|"full") +
`sheetDragPx` (גובה רציף בזמן גרירה), `sheetOpen` הפך getter (peek=סגור, לתאימות
openSheet/closeSheet). BottomSheet: pointermove רציף, pointerup snap ל-detent קרוב,
רקע/opacity interpolated לפי הגובה הגלוי. peek=28px (רק הידית, היה 60px עם תוכן בולט),
grip `w-12 h-1.5` `var(--border-str)` (היה `w-10 h-1` `var(--border)` — כמעט בלתי-נראה).

### UX-5 — מעבר Type↔Record: opacity-crossfade מוערם + רגע ריק
**תוכנית (redesign-4):** `{#if mode}` + `transition:fade` של Svelte → הוספה/הסרה של DOM,
out+in במקביל, reflow → קפיצה. **תיקון (לפי מוקאפ 443-467 שמשתמש ב-`hidden` toggle לא
`{#if}`):** שני panes תמיד ב-DOM, מוערמים באותו תא grid (`grid-row/column:1`), מעבר
ב-opacity+visibility בלבד. **timing:** 0.3s לכל שלב + `transition-delay:0.3s` ל-pane
הנכנס → היוצא דוהה לגמרי, רגע ריק ~300ms (שניהם opacity 0), אז הנכנס עולה. סה"כ ~600ms.

### כלי DEV-only — Mock sessions (flow C, נאמן ל-ACP)
**צורך:** לדבג עיצוב בלי לטעון שיחות אמיתיות (כל loadSession = bridge ~300MB דולף;
ניקינו 11 bridges = 3.4GB). **החלטה — flow C (הכי נאמן, בחירת המשתמשת):** ה-fixtures
הם **ACP updates גולמיים** (לא Bubble[]), וה-mock מזרים אותם דרך **אותו `#onSessionUpdate`**
האמיתי → תופס גם באגי המרה/מיזוג chunks. נדחו flow A (ממלא bubbles ישירות) ו-B (route).
- **חילוץ:** `/tmp/fixtures/extract-raw.py` — מדבר ACP stdio ישירות (`opencode acp`:
  initialize → `session/load` עם **`mcpServers:[]`** חובה → אוסף `session/update`). תהליך
  חד-פעמי, מת מיד — אפס bridges. (נדחו: חילוץ דרך DOM/browser, חילוץ דרך BE endpoint.)
- **אחסון:** `static/fixtures/*.json` (fetch בזמן ריצה, מחוץ ל-bundle). 6 fixtures:
  greeting(5u)/tool-spill/phone-tunnel/mitm(259u)/salary-prev/salary-attendance. tool
  results ארוכים קוצצו ל-~2KB (`[truncated for fixture]`) — 41MB→512KB.
- **הזרקה:** `loadSession` ב-`import.meta.env.DEV` מזהה `mock:<name>` → `#loadMockSession`
  fetch+מזרים. **trigger:** URL `?mock=<name>` (+`&stream=<ms>` ל-delay) דרך `location.search`
  (לא `$page` store — לא מוכן ב-init), או picker (`🧪 MOCK:` מוזרק ב-DEV). `window.__session`
  חשוף ב-DEV. הכל tree-shaken מ-prod.
- **באג שנחשף ותוקן (timing):** הלולאה הסינכרונית דחפה את כל ה-bubbles בבת אחת, וה-`$effect`
  של ה-Speaker רץ רק אחרי שכבר `isLoadingHistory=false` → הקריא הכל ב-TTS. **תיקון:**
  `await tick()` אחרי הלולאה (בעוד `isLoadingHistory=true`) מאלץ flush → replay-quiet עובד.
  (ACP אמיתי לא סובל מזה — updates אסינכרוניים.)

### סטטוס
כל הבאגים תוקנו, typecheck 0, 49 tests, i18n נקי. עדיין **לא merged** — ממתין לאישור
משתמשת. merge יחיד של redesign-7 מביא את כל 1-7 (שרשרת לינארית) + תיקוני הדיבוג.

## 2026-06-02 — redesign-6: Modals — Bits Dialog ✅

### הכרעת Dialog

**Bits Dialog** (bits-ui@2.18.1 — כבר מותקן מ-redesign-3): focus-trap, Esc, click-outside, scroll-lock מובנים.
- בדיקת RTL: Bits Dialog משתמש ב-Portal על `document.body` — עובד ב-RTL (dir לא חשוב ל-Dialog עצמו).
- לא נוצר `ui/Dialog.svelte` wrapper (אין צורך — Bits Dialog משומש ישירות ב-modals).
- אם RTL נשבר > 30 שורות hacks → custom modal (focus-trap ידני), בהתאם ל-§7.

## 2026-06-02 — redesign-3: Settings — Bits Switch + native Select fallback

### הכרעת component-lib

**Switch → Bits UI** (`bits-ui Switch.Root + Switch.Thumb`):
- תומך RTL + a11y מובנה (aria-checked, keyboard, focus-trap)
- עובד עם `.toggle` CSS helper מ-app.css (RTL-safe: `right: 3px` / `right: calc(100% - 23px)`)
- שלוש שכבות disabled: `pointer-events-none` על label, `aria-disabled`, `onCheckedChange={disabled ? undefined : handler}`

**Select → native `<select>` מעוצב בTailwind** (fallback, לא Bits Select):
- Bits Select דורש: Portal + JS overhead + Trigger/Content/Item composition + RTL quirks
- native styled `<select>` — RTL-safe בדפדפן, מינימל, תואם לVoicePicker הקיים
- אשר גם ב-§7 של ה-brief: "fallback native styled select — לגיטימי"
- תועד גם ב-`components/ui/Select.svelte` (comment)

### ממצאי אביגיל (redesign-3)

ר' `reports/voice-acp/slice-redesign-3-settings-avigail.md` — USABLE-AFTER-FIX (2 סבבים). כל findings תוקנו לפני handoff לאליעזר.

### ממצאי calev (redesign-3)

calev light: PARTIAL→GO (2 findings, שניהם תוקנו):
- F1: translateThoughts disabled לוגי — תוקן ב-SettingToggle (aria-disabled + onCheckedChange guard)
- F2: decisions entry — entry זה

## 2026-06-01 — convention: הערות בקוד בעברית

### רציונל
המשתמשת ביקשה במפורש שהערות בקוד (code comments) יהיו **בעברית** — לאורך כל
ה-codebase, לקוד חדש ולהערות אנגלית קיימות כשנוגעים בקובץ. זה תואם את העובדה
שרוב ה-VMs כבר כתובים עם הערות עברית (Mic, Speaker, AgentSession וכו').

### למה זה לא מתנגש עם lint:i18n
ה-`scripts/lint-no-hebrew-in-code.sh` חוסם עברית **ב-runtime strings** (מחרוזות
שמגיעות למשתמש — חייבות לעבור i18n catalog, D10). אבל ה-state machine שלו **מנקה
הערות לפני הסריקה** → הערות עברית מותרות במפורש ועוברות. אין התנגשות בין שתי הדרישות.

### היקף ואופן יישום
~610 שורות הערות אנגלית בקוד (frontend ~265, core ~224, backend ~122). לא מתורגם
במכה אחת — **opportunistic**: כל slice/תיקון שנוגע בקובץ מתרגם את ההערות בו תוך כדי.
הכלל עצמו (התקף, לא הרציונל) נשמר כ-convention; לא נכתב ב-AGENTS.md לפי בקשת המשתמשת.

## 2026-06-01 — slice 9a (speech toggles): ההעדפה ב-Settings, ה-Speaker קורא וקוצר ב-pipeline קיים

### רציונל
שלושת ה-toggles (הקראת מחשבות / קריינות כלים / תרגום מחשבות) הם **העדפות מתמשכות**
→ שייכים ל-`Settings` (entity persisted, לא state חולף). ה-`Speaker` הוא ה-owner של
החלטת "מה להקריא", ולכן הוא **קורא** את ה-flags מ-`this.#settings` בתוך ה-`$effect`
הקיים שלו ומקצר את ה-pipeline (`if (!flag) skip`). אין VM חדש, אין engine חדש, אין
`$effect` חדש — owner-correct לפי חוק זהב #4, ועקבי עם ההערה שהייתה ב-Speaker מ-slice 2
("Slice 9 יחבר אותו דרך Settings").

### החלטה: speech toggles עכשיו (9a), cue toggles אחר כך (9b)
slice 9 המקורי כלל גם "audio cues toggles". פיצלתי: 9a = speech toggles + voice picker
(נשען כולו על קוד merged), 9b = cue toggles (volume/mute) שיבוא **אחרי** slice 6 — כי
ה-`CuesEngine` (שעליו ה-toggle יקשור) עדיין לא merged. אין על מה לקשור toggle שלא קיים.

### תלות UI בין הגדרה 1 ל-3
"תרגום מחשבות" הגיוני רק כש"הקראת מחשבות" דלוקה (אם לא מקריאים — אין מה לתרגם).
ההחלטה (עם המשתמשת): שתי בוליאניות **עצמאיות ב-state** (נשמרות בנפרד), אבל ה-toggle
של התרגום **מנוטרל ויזואלית** ב-UI כשהקראת מחשבות כבויה (`disabled` + עמעום). לא מאפסים
את הערך — חוזר פעיל כשמדליקים שוב הקראה. נקי יותר ל-drive-first מאשר עצמאי-לגמרי.

### עדינות: מתי כל flag נקרא (א-סימטריה מכוונת)
speakThoughts/narrateTools נקראים בזמן **enqueue** (ב-`$effect`, tracked) → סימון
`processedSegments` בדילוג מונע בליעת היסטוריה אחרי הדלקת toggle (עקבי עם טיפול `!enabled`).
translateThoughts נקרא בזמן **fetch** (ב-`#fetchJob`, async, לא tracked) → משפיע על jobs
שמתבצעים מרגע השינוי, לא רטרואקטיבית. אביגיל אישרה ששתי הגישות נכונות.

### ממצאי אביגיל (READY, סבב 1)
brief יוצא-דופן באיכותו. המבחן הקריטי — ה-tip זז מ-56139d7 ל-7859964 אחרי merge של
design-principles — עבר במלואו: כל 13 מספרי השורות ב-Speaker מדויקים. החור שחששתי ממנו
(בליעת thoughts אחרי הדלקת toggle) — אין: ה-skip זהה בדיוק ל-`!enabled` הקיים. finding
יחיד קל: §3 כתב "8 מפתחות" במקום "6" → תוקן.

## 2026-06-01 — slice 25 (bridge leak fix): FE cleanup הורג bridge, לא נוגעים ב-BE

### רציונל
כל מחזור connect→disconnect (וכן reload / שגיאת חיבור) השאיר תהליך CLI יתום וחי
ב-BE לנצח. הסיבה ארכיטקטונית ובכוונה: `ws-agent.ts:126` **לא** הורג את ה-child
בסגירת WS, כדי לאפשר reconnect עתידי (future "agents-ברקע", גישה A). אבל ה-FE
מעולם לא ביקש מחיקה מפורשת. הבחירה: **תיקון עצירת-דימום (גישה B)** — `#cleanup`
ב-`AgentSession` שולח `DELETE /api/agents/:id` (fire-and-forget) לפני איפוס ה-agentId.
שלושת מסלולי ה-cleanup (detach, attach-catch, loadSession-catch) מקבלים את התיקון
בחינם כי כולם עוברים דרך `#cleanup`. **לא נוגעים ב-BE/ws-agent** — התשתית ל-future A
נשארת שלמה; agents-ברקע עם ממשק ניהול הוא slice עתידי נפרד.

### ממצאי אביגיל
- **סבב 1: USABLE-AFTER-FIX.** ה-brief הזהיר שוב-ושוב ש-`lint:i18n` חוסם הערות עברית
  ומורה לאליעזר לתרגם — **הפוך מהמציאות**: ה-lint מנקה את כל ההערות (state machine)
  לפני סריקה, והערות עברית מותרות במפורש (כל ה-VM כבר כתוב בעברית ועובר). אזהרה הפוכה
  שהייתה גורמת לתרגום מיותר / רעש בשאלה פתוחה #3.
- **סבב 2: READY.** האזהרה הוסרה, ה-After נשאר עברית (הנכון), ומספרי השורות סונכרנו
  ל-dev tip חדש (dev התקדם מ-`62b41a0` ל-`7859964` בין הסבבים — slices 22+23 מוזגו;
  `#cleanup` זז מ-~254 ל-335, import מ-16 ל-21). אין מסלול cleanup רביעי; תוספות
  slice 23 (`#detached`, `#captureSessionConfig`) לא מתנגשות.

### רעיונות שנדחו
- **גישה A (agents-ברקע + ממשק)** — נדחתה לעתיד. עצירת הדימום דחופה ופשוטה (6 שורות);
  reconnect-by-session + רשימת agents פעילים זה scope גדול בנפרד.
- **timeout/GC ל-bridges יתומים ב-BE** — נדחה. רשת-ביטחון מיותרת כש-FE מנקה נכון.

## 2026-06-01 — slice 6 (audio cues): owner-driven, אפס $effect

### רציונל
ה-brief המקורי (29/5) הניח ש-slice 3 (VoiceMode) לא merged, ולכן בחר **מנגנון חיצוני**
("Cues VM") שמנחש מתי לנגן cue מתוך `VoiceMode.state` ה-`$derived`, וה-integration נדחה
ל-follow-up. כשחזרנו ל-slice 6 התברר ש-slice 3 כבר ב-dev → ההצדקה לגישה החיצונית
(להישאר additive בזמן מקביליות) נעלמה. שוכתב ל-**owner-driven (חוק זהב #4)**: כל cue
מנוגן ע"י ה-VM שמחזיק את ה-state שעובר transition — Mic (recordingStart/Stop),
Speaker (speaking), AgentSession (thinking/error).

### שינוי-כיוון תוך כדי תכנון: effect → מתודה מפורשת
הגרסה הראשונה של ה-rewrite השתמשה ב-`$effect` לזיהוי transitions (גם ב-Speaker וגם
ב-AgentSession). המשתמשת הטילה ספק: `$effect` הוא reactive-magic פחות יציב ומפורש ממתודה.
צדקה. שונה לשלושה פתרונות מפורשים לפי המבנה של כל VM:
- **Mic** — transition אחד מקומי → קריאה ישירה ב-`toggle()`.
- **Speaker/Player** — Player מקבל `onPlaybackStart?` callback גנרי (לא יודע על cues),
  קורא לו ב-`#playLoop` כש-`state="playing"`. Speaker מספק את ה-callback.
- **AgentSession** — `status` נכתב ב-12 מקומות מפוזרים → **setter מרכז `#setStatus()`**
  שכל ה-writes עוברים דרכו. זה refactor INVASIVE (מאושר: slice 3 merged → אין מקביליות)
  שגם מנקה code smell קיים (12 writes ללא נקודת-mutation אחת).

### החלטה: CuesEngine הוא engine, לא VM
owner של AudioContext ללא `$state` ריאקטיבי — בדיוק כמו Recorder/Player/AudioStream.
ב-FE הזה "engine" = imperative resource owner של הדפדפן (browser-only), לא shared
client/server. ה-shared layer הוא `core/`. Web Audio → client-only → engine.

### ממצאי אביגיל (3 סבבים — דוגמה לערך plan-gate)
- **סבב 1 (USABLE-AFTER-FIX)**: תפסה שה-`#playing` guard ב-Player מונע רק `#playLoop`
  מקבילי, לא re-entry סדרתי. עם LOOKAHEAD=2 ו-fetch אסינכרוני התור מתרוקן בין משפטים →
  cue "speaking" היה חוזר באמצע הדיבור.
- **סבב 2 (NEEDS-REWORK)**: התיקון הראשון שלי (reset של `#spokeThisTurn` ב-`#stopAndClear`)
  הפך את הבאג — `#stopAndClear` לא רץ בסוף תור רגיל (רק toggle-off/cancel/destroy), אז
  הדגל נשאר `true` וה-cue נבלע מתור 2 ואילך. אביגיל הצביעה על נקודת ה-reset הנכונה.
- **סבב 3 (READY)**: reset עבר ל-`#handleStatusTransition` על מעבר `→ thinking` (תחילת תור),
  שרץ לפני עדכון `#prevStatus`. reset-on-turn-start עדיף על reset-on-turn-end (נקודה אחת
  ודאית מול זיהוי כל מסלולי הסיום כולל error).

### החלטות-משנה לעתיד
- ההבחנה primary/derived VMs לא מיושמת (derived/ עם דייר אחד — VoiceMode). נשארת פתוחה.
- עלה צורך במסמך `design-principles.md` מרכז + סטנדרט reactivity ($effect מתי/לא) +
  סטנדרט state-machine (`#setStatus`-style). מתוכנן כ-session נפרד (consolidation + review).

## 2026-06-01 — refactor: מקור-אמת אחד ל-CLIs

### רציונל
היו 3 מקורות חופפים ולא-מסונכרנים לרשימת ה-CLIs: `BridgeKind` (core/ports, 5 סוגים),
`CliKind` (core/schemas, 4 — בלי qoder), ו-bin/args (backend). תוצאה: qoder היה ב-types
וב-bin אבל לא ב-FE dropdown ולא ב-schema; וב-cli-config היה dead-code switch אחרי return.
אוחד הכל לרשומה אחת `CLI_SPECS` ב-core/schemas/agent.ts — שם + bin/args + supportsModelFlag
באותו מקום. כל השאר (CLI_KINDS, CliKind arktype, BridgeKind alias, FE dropdown) נגזר.

### ההכרעה הארכיטקטונית
**bin/args יושבים ב-core למרות ש-spawn הוא IO** — כי bin/args הם נתונים סטטיים (מחרוזות),
לא IO בעצמם; ה-IO (spawn) חי ב-backend. ההפרדה: *הגדרה* (סטטית) → core; *resolution*
תלוי-סביבה (OPENCODE_BIN מ-process.env, הוספת --model) → backend (shell). זה לא מפר את
"no IO in core" כי core רק מחזיק מחרוזות.

### באג שנחשף
`OPENCODE_BIN` נקרא במקור eager (בזמן טעינת המודול) → טסט שמגדיר env אחרי טעינה נכשל.
תוקן ל-lazy (בזמן getCliCommand). תואם את ה-service file (OPENCODE_BIN=opencode-clean.sh).

### טסטים מיושנים שתוקנו
3 טסטי gemini ציפו ל-`npx @google/gemini-cli --experimental-acp`. אומת מול ה-binary
המותקן (~/.vite-plus/bin/gemini): הפקודה הנכונה היא `gemini --acp`, ו-`--experimental-acp`
deprecated ("use --acp instead"). הקוד היה נכון, הטסט מיושן — יושר למציאות.

## 2026-06-01 — slice-26: Temporary Bridge Idle-Reaper (BE)

### ‏רציונל
‏slice 25 (FE cleanup) ‏לא מכסה מקרה אחד: ‏**‏reload סתמי / ‏טאב שנסגר** ‏— ‏שם ה-FE ‏מת בלי ש-`#cleanup` ‏רץ, ‏וה-bridge ‏נשאר יתום. ‏לפי בקשת המשתמשת הוספנו **‏רשת-ביטחון זמנית בצד שרת**: ‏reaper תקופתי שהורג bridges ‏ללא WS ‏מחובר אחרי timeout (‏ברירת מחדל 5min, `BRIDGE_IDLE_TIMEOUT_MS`).

‏ההחלטה הקריטית בעיצוב: ‏**‏מדד ה-idle ‏הוא "זמן מאז ניתוק ה-WS ‏האחרון", ‏לא "מאז יצירה" ‏ולא "מאז פעילות"**. ‏הסיבה — ‏ה-BE ‏משאיר bridges חיים בכוונה (`ws-agent.ts:126`) ‏כדי לאפשר reconnect ‏(future A). ‏מדד מבוסס-יצירה היה הורג גם סוכן שרץ משימה ארוכה ‏וגם סוכן שמחכה ל-reconnect לגיטימי. ‏הכלל: ‏`hasActiveWs===true` → ‏**‏לעולם לא נאסף**. ‏זה גם תואם-קדימה ל-future A (‏reconnect ‏בתוך החלון "מנצל" ‏את הסוכן ‏ומאפס את הטיימר).

‏grace period פי-2 ‏לסוכן שמעולם לא נפתח לו WS — ‏מגן מפני race ‏בין `createAgent` ל-WS open ‏(לא להרוג סוכן בן-שנייה שעומד להתחבר).

‏ה-reaper ‏קורא ל-`orchestrator.deleteAndKill` ‏(נתיב מאוחד: ‏kill + ‏registry.delete), ‏לא ל-`bridgeManager.kill` ‏ישירות — ‏אחרת `/api/agents` ‏היה מציג סוכן מת.

### ‏זמניות (‏קריטי)
‏זה סלייס **‏זמני**. ‏כל הקוד מתויג `// TEMPORARY (slice 26)` ‏ויש §7 ‏עם תנאי-מחיקה מפורש (`grep -rn "TEMPORARY (slice 26)"`). ‏יימחק כשייכנס מנגנון ניהול agents-ברקע מסודר (future A) ‏שיחליף את ה-reaper ‏ב-lifecycle ‏מנוהל (‏reconnect מפורש + ‏רשימת agents + ‏סגירה יזומה).

### ‏ממצאי אביגיל
‏Verdict: READY (‏ללא תיקון מהותי). ‏כל 8 ‏נקודות האימות עברו: ‏מספרי שורות מדויקים, ‏לוגיקת `listIdle` ‏ללא חור, `reaper.unref()` ‏תקף, `deleteAndKill` ‏מנקה registry, ‏race ‏מטופל סבירות. ‏2 ‏ממצאי minor: ‏(1) ‏הבהרה ש-server.ts ‏אין בו shutdown handler → `unref()` ‏מספיק (‏תוקן); ‏(2) ‏פקודת `bun --watch` ‏ידנית בעוד ה-BE ‏רץ Node — ‏לא משפיע.

### ‏רעיונות שנדחו
- ‏**‏מדד idle מבוסס "מאז יצירה" ‏או "מאז פעילות אחרונה"** — ‏יהרוג סוכנים פעילים. ‏נדחה לטובת "מאז ניתוק WS".
- ‏**‏shutdown handler ‏עם clearInterval** — ‏מיותר; `unref()` ‏מספיק ‏ו-server.ts ‏ממילא אין בו graceful shutdown ‏היום.

---

## 2026-06-01 — slice-25: Bridge Process Leak Fix

### ‏רציונל
‏אבחון מצא דליפת תהליכים: ‏כל מחזור connect→disconnect/reload/error ‏משאיר תהליך CLI ‏(opencode/claude/gemini) ‏יתום וחי ב-BE ‏לנצח. ‏שורש הבעיה — ‏עיצוב חצי-גמור: ‏ה-BE ‏בכוונה לא הורג את ה-child ‏בסגירת WS (`ws-agent.ts:126`, ‏כדי לאפשר reconnect עתידי), ‏אבל הצד השני של הגשר מעולם לא חובר: ‏ה-FE ‏לא קורא ל-`deleteAgent` ‏ב-`#cleanup`/`detach`, ‏ולא מבצע reconnect אמיתי (‏מנגנון הדה-דופ ‏בצד שרת מנותק כי ה-FE ‏לא שולח `existingSessionId`).

‏בחרנו **‏גישה B ‏(תיקון מיידי)**: ‏`#cleanup` ‏קורא `deleteAgent(agentId)` ‏כ-fire-and-forget → ‏ה-BE ‏הורג את ה-bridge (SIGTERM→SIGKILL). ‏שורה אחת, ‏סיכון נמוך, ‏עוצר את הדימום. ‏מסלול רשימת הסשנים (`listSessionsForCwd`) ‏כבר נקי (spawn→delete מסודר) — ‏לא נגענו בו.

‏**‏גישה A ‏(reconnect אמיתי + ‏agents-ברקע) ‏נדחתה לסלייס עתידי** ‏לפי החלטת המשתמשת: ‏היא רוצה מנגנון שמשאיר סוכנים חיים ברקע (‏ממשיכים לרוץ גם כשהחלון נסגר), ‏עם ממשק ניהול לראות/לסגור agents פעילים. ‏זה דורש תכנון UX + ‏חיווט `existingSessionId` + ‏רשימת agents — ‏לא תיקון-דחוף. ‏לכן הפרדנו: B ‏עכשיו, A ‏כסלייס מתוכנן.

### ‏ממצאי אביגיל
‏Verdict: USABLE-AFTER-FIX (‏אין blocker). ‏כל הסמלים, ‏מספרי השורות, ‏וה-import אומתו מדויקים; ‏אין מסלול cleanup שלישי שעוקף את התיקון; `depends_on=[]`/`base=dev` ‏נכונים. ‏הבעיה היחידה: ‏האזהרה שלי על `lint:i18n` ‏הייתה **‏הפוכה** — ‏טענתי שה-lint ‏עלול לחסום עברית בהערות, ‏אבל ה-state machine ‏מנקה הערות לפני סריקה (‏וכל הקובץ כבר כתוב בהערות עברית). ‏תוקן: ‏הוסרה הוראת התרגום המיותרת ‏מ-§5/§6/§9.

### ‏שינויי-כיוון
‏אין — ‏רק תיקון תיעוד פנימי ב-brief. ‏הליבה (‏גישה B, ‏שורה אחת ב-`#cleanup`) ‏נשארה.

### ‏רעיונות שנדחו
- ‏**‏timeout/GC ‏ל-bridges יתומים בצד BE** — ‏רשת-ביטחון; ‏לא נדרש כש-FE ‏מנקה. future.
- ‏**‏שינוי `ws-agent.ts` ‏שיהרוג child ‏ב-WS close** — ‏היה הורס את התשתית ל-future A (agents-ברקע). ‏השארנו את "child שורד WS close" ‏שלם.

---

## 2026-05-31 — slice-6: Audio Cues engine

### ‏רציונל
‏הוספת חיווי קולי (cues) חיונית לחוויית drive-first כדי לאפשר למשתמשת לדעת מתי המערכת מקשיבה, חושבת או מדברת מבלי להביט במסך. בחרנו במימוש מבוסס Web Audio API (oscillators) ולא קבצי אודיו כדי לשמור על גמישות בתדרים, זמני טעינה אפסיים ומינימום bundle size.

### ‏ממצאי אביגיל
‏אביגיל זיהתה שתי בעיות קריטיות במימוש ה-Web Audio:
1. ‏העדר `setValueAtTime` לפני `linearRampToValueAtTime` ב-glides, מה שהיה גורם לצלילים להתחיל מתדר ברירת המחדל.
2. ‏צורך ב-`AudioContext.resume()` כדי להתמודד עם Autoplay Policy של Chrome גם בתוך user gesture.

### ‏שינויי-כיוון
‏ה-brief עודכן לכלול את התיקונים הטכניים שאביגיל הציעה. בנוסף, הובהר שהפרויקט מתבסס על `dev` שכבר כולל את מבנה Slice 3.

---

## 2026-06-01 — slice-23: Agent Options Panel

### ‏רציונל
‏בחרנו להוסיף ווידג'ט אפשרויות סוכן שמבוסס כולו על ACP `session/set_config_option` — לא דרך CLI flags ולא דרך discovery session זמני. הסיבה: `opencode acp` לא מקבל `--model`/`--agent`; session זמני ישאיר סשנים יתומים. ה-ACP מחזיר `configOptions/models/modes` מיד אחרי `session/new` — זה מספיק להחלת בחירות.

‏עיצוב cache: אפשרויות נשמרות לפי `cliKind|normalizedCwd` ב-localStorage, כך שמהחיבור השני dropdowns אמיתיים מופיעים לפני פתיחת הסשן.

### ‏ממצאי אביגיל (round 2 — NO-GO, round 3 — PASS)
‏4 blockers שזוהו ב-round 2:
1. ‏`SetSessionConfigOptionRequest` הוא discriminated union — boolean דורש `{ type:"boolean", value }`. תוקן ב-Commit 1.
2. ‏`models/modes` נשמרים ב-snapshot אך לא שימשו לרנדרינג; agents שמחזירים `models` בלי `configOptions` מתאים לא קיבלו dropdown. תוקן ב-rendering rules (3 מסלולים: `snapshot.models`, `configOptions.category`, fallback ידני).
3. ‏זיהוי model/mode לפי `id === "model"` שגוי — `id` הוא arbitrary. תוקן לשימוש ב-`category === "model"/"mode"`.
4. ‏`throw` על option חסר היה חוסם מעבר בין פרויקטים. תוקן ל-`console.warn` + skip.

### ‏שינויי-כיוון
- ‏`#applyConfigSelection` כולל עכשיו 3 מסלולים: `optionById` → `optionByCategory` → fallback method.
- ‏Cache key מנורמל (`.replace(/\/+$/, "")`) כדי לתאים ל-BE `validateCwd`.

### ‏רעיונות שנדחו
- ‏Discovery session זמני: נדחה — יוצר סשנים יתומים בגלל שOpenCode לא מפרסם `session/close`.
- ‏MCP servers / Additional directories בווידג'ט: נדחו ל-slice עתידי; לא מוסיפים מורכבות ל-MVP.

## 2026-06-01 — slice-24: Client-Keyed Proxy Cache

### ‏רציונל
‏ה-proxy-cache ‏ממפתח ‏לפי `sha256(method|path|body)`. ‏זה ‏שובר ‏ל-narrate ‏כי ‏ה-prompt
‏כולל `recentMessages` ‏תלוי-זמן → ‏אותו ‏tool-call ‏מקבל ‏hash ‏שונה ‏ב-reload → cache miss →
‏Gemini ‏מנוסח ‏מחדש → ‏נרטיב ‏**‏שונה** (LLM ‏לא-דטרמיניסטי). ‏הפתרון: ‏ה-FE ‏(‏הצד ‏היחיד ‏שיודע
‏את ה-identity ‏היציב) ‏קובע ‏את ‏מפתח-הקאש ‏דרך ‏header `x-cache-key`, ‏ולא ‏ה-BE ‏מהגוף.

‏**‏אין persistence ‏חדש** — ‏הקאש ‏הקיים ‏(disk) ‏הוא ‏ה-"DB". ‏המפתח ‏הדטרמיניסטי ‏מאפשר
‏re-fetch ‏ב-reload ‏ללא ‏שמירה ‏נוספת ‏מעבר ‏לטקסט ‏הגולמי ‏(‏שמשוחזר ‏ע"י ‏opencode ‏ב-session/load).

‏מפתחות: narrate=`narrate:<toolCallId>`, translate=`translate:<sha256(text+lang)>`,
‏tts=`tts:<voiceId>:<sha256(text+model)>`. ‏הסיבה ‏ש-narrate ‏שונה: ‏ה-input ‏שלו ‏(prompt+context)
‏לא-יציב, ‏אבל `toolCallId` ‏יציב; ‏ב-translate/tts ‏ההפך — ‏ה-input (text) ‏יציב, ‏אבל messageId ‏לא.

### ‏ממצאי אימות (‏בריצה ‏חיה, opencode 1.15.13)
- opencode ‏שולח `messageId` ‏גם ‏בזמן ‏חי (24/24 chunks, ‏UUID ‏יציב), ‏**‏משותף** ‏ל-thought+message
  ‏של ‏אותו ‏turn. ‏לכן messageId ‏לבדו ‏לא ‏מבחין ‏בין ‏סגמנטים → ‏לא ‏יכול ‏להיות ‏מפתח ‏יחיד.
- ‏ה-tool ‏ID (`toolu_...`, ‏ממרחב Anthropic) ‏**‏נפרד ‏לגמרי** ‏מ-messageId. ‏ל-`ToolCall` ‏schema
  ‏אין ‏בכלל ‏שדה ‏messageId.
- `messageId` ‏מסומן ‏**UNSTABLE** ‏ב-ACP spec ‏ו-**‏אופציונלי** (`required: ["content"]`) → ‏לבנות
  ‏עליו ‏מפתח ‏= ‏חול. ‏לכן ‏הוא ‏metadata ‏best-effort ‏בלבד, ‏אף ‏פעם ‏לא ‏במפתח.

### ‏ממצאי אביגיל
- ‏סבב 1: USABLE-AFTER-FIX — blocker: ה-brief ‏ציטט `sha256Key` ‏ב-`core/voice/cache-key.ts`,
  ‏אבל ‏שם ‏יש ‏רק `cacheKeyFor` (‏חתימה ‏אחרת); ‏הגנרי ‏יושב ‏ב-backend (‏ה-FE ‏לא ‏יכול ‏לייבא).
- ‏תיקון: Commit 0.5 ‏מעביר `sha256Key` ‏ל-core (additive). ‏סבב 2: READY.

### ‏רעיונות שנדחו
- ‏BE persistence (index ‏שמקשר session+message→audio): ‏נדחה — ‏שובר D8, ‏ומיותר ‏כי ‏ה-hash
  ‏הדטרמיניסטי ‏מספיק. ‏המשתמשת ‏זיהתה ‏נכון: "‏כמו ‏שבפעם ‏הראשונה ‏נוצר ‏ה-hash, ‏אפשר ‏לחשב ‏מחדש".
- ‏cache סמנטי ב-localStorage ‏(FE): ‏נדחה ‏לטובת `x-cache-key` header — ‏שומר ‏את ‏הקאש ‏במקום ‏אחד (BE disk),
  ‏בלי persistence ‏כפול.
- ‏מחיקת ‏query layer / index ‏לפי messageId: ‏נדחה (YAGNI) — ‏ה-metadata ‏נשמר, ‏אבל ‏ה-query ‏יבוא ‏עם ‏פיצ'ר ‏אמיתי.
- ‏"‏החזרת ‏קריאות ‏ל-BE" (‏במקום FE): ‏נשקל ‏ונדחה ‏לעת ‏עתה — ‏שובר ‏את slice 10, ‏מחזיר 600+ ‏שורות ‏ל-BE.
  ‏נשמר ‏כתוכנית-מגירה ‏אם `@ai-sdk/google` header passthrough ‏ייכשל ‏ב-Commit 0.

## 2026-06-02 — slice-sessions-inline-transcribe-resilience: סשנים inline + עמידות תמלול

### רציונל
brief מאוחד, שני נושאים בלתי-תלויים שעלו מבדיקת UI ידנית + אבחון תשתית:

**עמידות תמלול** — אבחון (סקר תשתית `infra-survey.sh`, 2026-06-02): התמלול נכשל
לסירוגין עם `socket connection closed unexpectedly` → 502. **לא** billing ולא מודל
(בקשה בודדת מצליחה; `gemini-flash-latest`=`gemini-3.5-flash` תקין). הסיבה: חוסר
יציבות transport ל-Google דרך OneCLI תחת עומס. בנוסף: `flash-latest` איטי (5-10s
ל-"hi" בגלל thinking) — קרוב ל-timeout 15s. הפתרון: timeout 15s→30s + retry עם
exponential backoff (helper אחיד חדש `with-retry` ב-core) + שמירת blob + כפתור
"נסה שוב" (כש-הכל נכשל, אפשר בעוד כמה דקות). **לא מחליפים מודל** (החלטת משתמשת).

**סשנים inline** — היום רשימת הסשנים ב-SessionOptionsPanel ריקה, וטעינתה פותחת
**סוכן חד-פעמי חדש** (spawn יקר ~300-700ms + סיכון bridge-leak כמו slice 25) גם
כשכבר יש סשן פעיל עם ערוץ ACP פתוח. ההחלטה: כשיש חיבור פעיל, לטעון דרך
`session.listSessions()` (החיבור הקיים, `AcpClient.listSessions` שכבר קיים) — **בלי
spawn**. cache + רענון מפורש. ה-spawn (`listSessionsForCwd`) נשאר כ-fallback לדף
החיבור (שם אין חיבור). SessionsDialog המיותר נמחק (הרשימה inline מחליפה אותו).

### החלטות-מפתח
- **base = dev** (`266322f`) ולא שרשור — סוכן אחר השלים merge של כל האינטגרציה
  (redesign + BE + review-fixes) ל-dev, אז הכל זמין. depends_on=[].
- **helper retry אחיד** ב-core (`with-retry`) — ממש את ה-TODO שנרשם אחרי תיקון
  ה-DDoS של loadVoices. ישמש transcribe; איחוד voices.loadVoices אליו דחוי לסבב נפרד.
- **INVASIVE state ב-2 VMs** (Mic: #lastBlob; AgentSession: sessions/cache) — אושר
  ע"י משתמשת. תוספתי בלבד (שדות+מתודות, לא שינוי state קיים).
- **$effect auto-load** בדסקטופ vs מובייל: `shouldLoad = isMobile ? sheetOpen : true`
  + untrack (gotcha: $effect קורא+כותב state → DDoS). idempotent+cache מונע לולאה.

### ממצאי אביגיל
round 1: USABLE-AFTER-FIX, 4 findings (כולם 🟡): line numbers ב-Commit 4 (off ~50),
detach שורה 150 לא 142, נתיב טסט core (tests/async/ לא src/async/), ו-$effect
auto-load לא ירוץ בדסקטופ (sheet לא נפתח שם). round 2 (אחרי תיקון): READY, 0 findings.
כל ה-APIs/return-types/i18n/DELETE-callers אומתו מדויק.

### רעיונות שנדחו
- החלפת מודל התמלול (flash-latest→2.5-flash/lite) — נדחה (משתמשת): נשארים flash-latest.
- איחוד voices.loadVoices ל-with-retry בסבב הזה — נדחה (scope creep), סבב נפרד.
- NotificationsVM (טיפול שגיאות מרכזי) — slice עתידי נפרד (כבר מתועד).

## 2026-06-02 — ניקוי queue: fix-idle-flaky + slice-9a נזרקו, sessions-inline נשאר

### רציונל
מעבר על ה-briefs הפתוחים ב-`docs/plans/` מול מצב dev בפועל (tip 718be28). שלוש החלטות:

1. **slice-fix-idle-flaky → DISCARDED (נסגר בינתיים)**. הטסט `bridge-manager.idle.test.ts`
   test 4 היה flaky תחת עומס scheduler: קורא `Date.now()` *אחרי* `await spawnBridge`
   ומניח שהוא שווה ל-`createdAt` שנקבע *בתוך* spawn → drift חורג מה-grace (ה-`-1`
   מחדד את התנאי). הקוד (`listIdle`) תקין. במקום התיקון המלא (getter `getCreatedAt`),
   סומן `it.skip` על test 4 בלבד עם הערה מפנה. עוצר את ההבהוב בלי לגעת בקוד הייצור.

2. **slice-9a-speech-toggles → DISCARDED (מומש אחרת)**. ה-redesign כבר מימש את כל ה-slice:
   3 ה-toggles (`speakThoughts`/`narrateTools`/`translateThoughts`) קיימים ב-Settings VM
   (שורות 229-260, setters + persist), וה-UI ב-`SettingsScreen.svelte` (VoicePicker
   שורה 72, toggles 78-90, לוגיקת `translateDisabled` כש-speakThoughts כבוי 26/30-31).
   אפילו carMode נוסף. ה-brief מיותר — אומת מול dev.

3. **slice-sessions-inline-transcribe-resilience → נשאר (טרם בוצע)**. אומת מול dev שאף
   חלק לא קיים: `with-retry` חסר ב-core, `listSessions` חסר ב-AgentSession,
   SessionOptionsPanel placeholder בלבד, SessionsDialog עדיין קיים, mic בלי
   retryTranscribe/lastBlob. זה ה-slice הפתוח היחיד שצריך ביצוע. ה-base בכותרת
   (`266322f`) ישן — dev התקדם ל-718be28, צריך אימות line-numbers/rebase לפני dispatch.

### החלטות-מפתח
- "לסגור flaky בינתיים" = `it.skip` ממוקד + הערה, **לא** מחיקת טסט ולא שינוי קוד ייצור.
  שומר את הכוונה לתיקון עתידי (אם slice-A של background-agents ינחת ויחליף את כל הבלוק).
- אימות מול dev בפועל (grep על קוד) לפני זריקת brief — לא להניח "כנראה מומש".

### רעיונות שנדחו
- ביצוע התיקון המלא של ה-flaky (getCreatedAt getter) — נדחה (משתמשת): לא שווה את ה-slice
  על טסט TEMPORARY שעתיד להימחק. skip מספיק.

## 2026-06-02 — slices AB + C: בקרת סוכן, חיווי, ופלייליסט replay

### רקע
המשתמשת ביקשה 3 יכולות אחרי שלא יכלה לעצור סוכן באמצע ריצה: (1) נגן/השמעה-חוזרת
(שיחה מלאה + הודעה בודדת + התחל-מנקודה), (2) עצירת סוכן בריצה, (3) חיווי סטטוס בזמן אמת.

### ממצאי סקר קוד (קובעים את התכנון)
- **ACP cancel כבר קיים** (`AcpClient.cancel` core/acp/client.ts:161) — אף אחד לא קורא לו.
- **הבאג "X מהבהב לנצח"**: `VoiceMode.cancel()` עוצר mic+speaker אבל לא את הסוכן →
  status נשאר "thinking" → ה-$effect (voice-mode:55-64) לא מאפס isCancelling (תנאי
  status!=="thinking" לא מתקיים) → FSM תקוע ב-cancelling, כפתור flash-state מהבהב.
  בקשה 2a (עצירה) והבאג = **אותו תיקון** (cancelTurn→ACP cancel→status חוזר).
- **חיווי סטטוס — i18n כבר קיים במלואו**: voiceMode.status.* (he.ts:40-45). חלק 3a ≈ UI בלבד.
- **TTS cache קיים ועובד** (BE proxy-cache, data/cache/proxy מלא, hit ~0.004s) →
  replay של בועת-סוכן = synthesizeStreaming מחדש = חינם+מהיר. **אין צורך לשמור אודיו TTS.**
- **הקלטות משתמש — BE store מלא וקיים** (http-history POST/GET /api/recordings, דיסק),
  אבל ה-FE **מנותק**: transcribe.ts מחזיר recordingId:"" קשיח (stub). data/recordings ריק.
- **Player engine קיים** (engines/player.svelte.ts, jumpToSegment "שמור ל-slice 10").
  הוא engine נמוך-רמה (segmentId+orderKey, streaming TTS). **אין VM שמתרגם "בועה"→"השמע".**

### חלוקה: AB (מאוחד) + C (נפרד)
המשתמשת ביקשה לאחד A+B כדי לחסוך תקורה. הוסכם: **slice AB** (A=commits 1-2 עצירה+חיווי,
B=commits 3-5 הקלטות+בועה-בודדת) — brief אחד, סבב verify אחד, אבל A קודם כך שהבאג
המיידי מתוקן ראשון גם אם B יסתבך. **slice C נפרד** (פלייליסט מלא) — הגדול, נשען על
מקור-האודיו ש-B מוכיח.

### החלטות-מפתח
- **base AB = dev אחרי merge sessions-inline** (אופציית המשתמשת). שניהם נוגעים ב-transcribe.ts
  → sessions-inline ראשון, אחרת merge conflict. depends_on מוצהר.
- **השמעת בועה בודדת ב-`<audio>`** (blob/objectURL), **לא** Player/AudioStream engine.
  סיבה: השמעה חד-פעמית; ה-Player בנוי ל-streaming חי עם orderKey — תקורה מיותרת.
  C ממשיך באותו נתיב `<audio>` (native ended/pause/seek מתאים לפלייליסט).
- **בועה בודדת = ללא לוגיקת הגדרות** — בחרת בועה → מתנגנת. speakThoughts/narrateTools
  רלוונטיים רק לפלייליסט המלא (C, buildPlaylist מסנן).
- **replay הוא VM חדש** (BubblePlayer, נולד ב-AB כ"בועה בודדת", מורחב ב-C לפלייליסט) —
  לא הרחבת Speaker (ערבוב חי+replay) ולא הרחבת Player (engine נמוך-רמה). entity לפי חוק זהב #2.
- **guard thinking**: replay חסום כשהסוכן עונה (החלטת משתמשת). לא באמצע ריצה, כן בכל זמן אחר.
- **C INVASIVE על BubblePlayer** (שדות $state: isReplaying/loop/position) — אושר מראש.
- **replay על snapshot** של רגע ה-playAll, לא חי (thinking חסום ממילא).

### ממצאי verification
- **AB**: אביגיל round 1 USABLE-AFTER-FIX, 5 findings. הקריטי (🔴): POST /api/recordings
  דורש JSON `{audioBase64,mimeType}` (201), לא body גולמי — ה-skeleton המקורי היה גורם 400.
  תוקן (bytesToBase64 קיים). round 2: READY, 0 findings.
- **C**: נכתב לפני ש-B נחת. כל הפניה ל-BubblePlayer/play-bubble מסומנת ⏳ "לאמת אחרי B".
  אביגיל תרוץ רק אחרי merge AB (אז המבנה האמיתי ידוע).

### נדחו
- שמירת אודיו TTS (זיכרון/IndexedDB) — מיותר, ה-BE cache מכסה.
- ייצור TTS-מחדש כברירת מחדל לכל replay — לא, cache hit עושה את זה ממילא בחינם.
- Player engine ל-replay — נדחה לטובת `<audio>` פשוט.
- replay חי (מגיב ל-bubbles חדשים תוך כדי) — snapshot מספיק (thinking חסום).

## 2026-06-03 — sessions-inline + switch-session warm: merged ל-dev + חקירת זהות-פרויקט

### רקע
slice-sessions-inline (חלק B transcribe-resilience + חלק A sessions-inline) בוצע (calev GO 17/17).
באימות runtime ע"י המשתמשת התגלה באג: החלפת סשן הציגה "WS closed (1005): no reason".

### שורש הבאג (chain מלא)
`selectSession` עשה `detach()` + `loadSession()` כבד. ה-loadSession היה שכפול של attach:
createAgent → WS חדש → ACP handshake. detach הרג את ה-bridge הקיים וסימן `#detached=true`;
loadSession אִפֵּס `#detached=false` *לפני* שה-onClose האסינכרוני של ה-WS הישן הגיע →
ה-guard `if (#detached) return` לא תפס → "WS closed (1005)" מזויף על הסשן החדש.

### החקירה הארכיטקטונית (מה ש-המשתמשת הובילה אליו)
שאלת המשתמשת "למה צריך לסגור WS? אפשר אותו אחד" הובילה לאימות אמפירי מול opencode acp חי:
1. **`session/load` עובד על אותו bridge** (גם cross-cwd) — אין צורך ב-WS/agent חדש להחלפת סשן.
2. **opencode מזהה פרויקט לפי root-commit hash של ה-git repo** (לא path/שם תיקייה).
   טבלת `project` ב-opencode.db: `id=<root-commit>`, עוקבת אחרי נתיבים חלופיים ב-`sandboxes`.
   לכן rename של תיקייה (anat→persona-lab) = אותו projectID; `session/list` מחזיר סשנים
   משני הנתיבים (אותו פרויקט). זה הסביר למה ראינו רק persona-lab+anat (לא גלובלי) — הם
   אותו repo. תועד ב-memory (global): 2026-06-03-fact-opencode-project-id-is-git-root-commit.

### התיקון
`AgentSession.switchSession(info)` — warm reload: `#client.loadSession()` על ה-WS/bridge הקיים,
בלי createAgent/detach/WS חדש. fallback ל-loadSession הכבד אם `#client===null`. **אסור #cleanup
בשגיאה** — החיבור נשאר חי. `selectSession` קורא לו במקום detach+loadSession.
calev GO 12/12, אומת e2e דרך tunnel כולל cross-rename (סשן מ-salary-reports).

### החלטות-מפתח
- **לא לסנן רשימת סשנים לפי cwd** — opencode כבר מסנן per-project (root-commit). סינון נאיבי
  לפי path אף יזיק (יסתיר היסטוריה מנתיב ישן אחרי rename).
- warm switch על אותו bridge, לא bridge-per-cwd — מאומת ש-loadSession cross-cwd עובד.

### known issue (slice נפרד מתוכנן)
- **409 על notifySessionAttached ב-warm switch**: guard MED-9 (http-agents.ts:117) חוסם update
  של acpSessionId כשהagent כבר "ready" עם sessionId אחר — בדיוק מה ש-warm switch עושה.
  `.catch(()=>{})` בולע; המשתמש לא רואה. אבל ה-BE registry נשאר עם sessionId ישן → סיכון
  ל-reconnect/recovery עתידי (slice 10) שישחזר לסשן הישן. תיקון: BE יתיר same-agent update.

## 2026-06-28 — slice-image-paste: הדבקת/גרירת/בחירת תמונות בתיבת הפרומפט (brief READY, merge מוקפא)

### רציונל
המשתמשת ביקשה לאפשר בצד הלקוח הדבקת תמונות, במקביל לסוכן שעובד על תמיכת ACP מלאה ב-`provider-contract`.
מיפוי הקוד הראה ש-drive-coding ה-FE מדבר ACP **ישירות** דרך `AcpClient.prompt(sessionId, text: string)` —
טקסט-בלבד (client.d.ts:45). ה-BE הוא dumb-pipe שקוף → אפס שינוי. החוזה המנורמל כבר חושף
`PromptContent = string | PromptContentPart[]` (events.d.ts:160), אך השכבה ש-drive-coding משתמש בה
(`AcpClient`) עדיין טקסט-בלבד. לכן הפיצ'ר מתחלק לשני חלקים: לכידה/preview/דחיסה/gating (FE-טהור, זמין
היום) מול שליחה מולטימודלית (תלוי bump של `AcpClient.prompt` → blocks).

### ההכרעה: brief אחד, 4 commits, merge-gate ממוקד
החלטת המשתמשת: לכתוב brief ואולי לבצע, **אך לא למזג לפני שצד ה-ACP יתמוך**. במקום פיצול ל-2 slices
(שמטרתו מקביליות-merge — לא רלוונטית כשלא ממזגים), נבחר brief יחיד עם commits מסודרים:
Commit 0 (core/TDD: `resize-plan` טהור) → Commit 1 (FE engine: דחיסת canvas) → Commit 2 (TypeArea:
paste/drop/picker + tray + gating) → Commit 3 (UserBubble image render) — **כולם בְּני-ביצוע עכשיו** —
ו-Commit 4 (שליחה מולטימודלית) **GATED** על ה-contract bump. כך "אולי נבצע" מתקדם על 0–3 בלי להיחסם.

### חובת-spec: capability gating
ACP spec: *"Clients MUST restrict content per Prompt Capabilities"*. `AcpClient.capabilities` (=agentCapabilities
מ-initialize) כבר נחשף → gating דרך getter `supportsImageInput` (`promptCapabilities.image`). בלי image-cap
על ה-agent הנוכחי — הלכידה מושבתת.

### חלוקת core/engine (No browser globals in core)
החלטת ה-resize (scale-to-fit) טהורה → `packages/core/src/image/resize-plan.ts` (TDD). קידוד canvas בפועל
(`createImageBitmap`/`OffscreenCanvas`) → FE engine `image-attachment.ts`. שמירה על כלל AGENTS.md.

### ממצאי אביגיל
- **r1 (USABLE-AFTER-FIX, 3)**: (א) i18n חי ב-`packages/core/src/i18n/` ולא ב-frontend — תוקן; (ב) tip
  התיישן 3208427→3bb36a9 + sendPrompt §559 — תוקן; (ג) שתי גרסאות `provider-contract` ב-.pnpm — חודד
  לגרסה ש-ה-FE פותר (`f034...`).
- **r2 (READY, 1×🟢)**: ה-guard `if (!text.trim()) return` (שורה 562) יזרוק בשקט שליחת **תמונה-בלבד** —
  שולב ב-Commit 4 (`!text.trim() && !attachments.length`) + DoD ייעודי.

### רעיונות שנדחו (Scope)
קבצים לא-תמונה (PDF/resource), draft-persistence, `@`mentions/slash/shell-mode, ו-`local-file-proxy`
(רינדור `file://`) — כולם slices נפרדים. ה-MVP: תמונות בלבד, paste+drop+picker, דחיסה ≤2048px/JPEG/8MB.

### מצב
brief READY (אביגיל r2). **merge מוקפא** עד ש-`AcpClient.prompt` יקבל `PromptContent`/blocks (Track A,
הסוכן השני). Commits 0–3 ניתנים ל-dispatch מיידי; runtime-gate (calev-heavy) רק אחרי Commit 4 חי.
