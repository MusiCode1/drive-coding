# Audio-Friendly System Prompt — תוכנית

> סטטוס: תכנון בלבד. אין חלוקה לפאזות / DoD בקובץ הזה — רק הרעיון, ההצדקה, והפרטים הטכניים. brief נפרד יוכן כשנהיה מוכנים להתחיל מימוש.
>
> **עדכון 2026-05-29 (slice 14):** הפלאגין `audio-friendly.ts` עבר refactor ל-plugin generic בשם `prompt-injector.ts`. הטקסט עצמו עבר ל-`packages/backend/src/prompts/audio-friendly.ts`, ומועבר ל-plugin דרך `options.text` (tuple `[url, options]` ב-config). הרציונל המקורי (§§1-8) עדיין רלוונטי — רק המיקום של הטקסט השתנה. ראה `docs/plans/slice-14-prompt-injector-generic.md`.

---

## 1. הבעיה

voice-acp-v3 הוא ממשק קולי לחלוטין מעל ACP CLIs (`opencode`, `claude`, `gemini`, `codex`). הפלט של ה-CLI מסונתז ב-TTS ומושמע למשתמש. אבל ה-CLIs מאומנים לפלט בסביבה ויזואלית:

- ‫**Markdown** — כותרות `##`, `**bold**`, רשימות עם `-`, code fences ב-` ``` `
- ‫**Emojis** — ✅ ❌ → •
- ‫**URLs ונתיבי קבצים** — `https://...`, `/long/path/to/file.ts`
- ‫**JSON/טבלאות גולמיות** — "Here is the output:" ואז dump
- ‫**רשימות vertical ארוכות** במקום משפטים זורמים

TTS משמיע את כל זה literally. המשתמש שומע "asterisk asterisk hello asterisk asterisk", או שה-emoji נהיה רעש דקודי, או שכתובת URL נקראת תו-תו במשך 30 שניות.

**המטרה:** לגרום ל-CLI לפלוט פרוזה טבעית, קצרה,   TTS-friendly, **בלי לשנות את הקוד של ה-CLI עצמו**.

---

## 2. הרעיון

נזריק **system prompt נוסף** ל-CLI שמדריך אותו לפלט בסגנון מתאים לאודיו. הזרקה דרך **OpenCode plugin** הטעון בזמן spawn של ה-sub-process.

הפלאגין מתחבר ל-hook הקיים `experimental.chat.system.transform` שמאפשר ל-plugins להוסיף / להחליף / לערוך את מערך ה-system prompts לפני כל קריאה ל-LLM.

הטעינה של הפלאגין מתבצעת דרך env var **`OPENCODE_CONFIG_CONTENT`** — מנגנון פנימי של OpenCode שמקבל JSON של קונפיג מלא כמחרוזת, **בלי לדרוש קובץ קונפיג על דיסק ובלי לגעת ב-cwd של ה-CLI**.

זוהי בדיוק הגישה ש-CodeNomad משתמש בה כדי להזריק את הפלאגין שלו ל-OpenCode. אומתה ב-3 מקורות: OpenCode source, tests פעילים, ויישום production  ב-CodeNomad.

---

## 3. למה דווקא הגישה הזו

נשקלו 3 אלטרנטיבות:

### A. `.opencode/plugins/audio-friendly.ts` ב-cwd

OpenCode קולט אוטומטית פלאגינים מתיקיית `.opencode/plugins/` בכל cwd. פשוט.

‫**חסרון מכריע:** ה-cwd שייך **למשתמש** — הוא הפרויקט שעליו הוא עובד. אסור לנו לדחוף לתוכו `.opencode/` סמוי, ובוודאי לא להגביל אותו לעבוד רק ב-cwd ספציפי. זו פגיעה בבעלות של המשתמש על הפרויקט שלו.

### B. `~/.config/opencode/plugins/audio-friendly.ts` (גלובלי)

OpenCode קולט פלאגינים גלובליים מ-`~/.config/opencode/plugins/`.

‫**חסרון מכריע:** יחול **גם** על שימוש רגיל של  OpenCode בטרמינל של המשתמש, מחוץ ל-voice-acp. המשתמש יראה פלט בלי emoji ובלי markdown גם כש-OpenCode פתוח ב-terminal לעבודה רגילה. לא רוצים.

### C. `OPENCODE_CONFIG_CONTENT` env var (הנבחרת)

OpenCode טוען קונפיג מלא מ- env var, ממזג אותו לקונפיג שכבר נטען מקבצים. הפלאגין מצוין ב- `plugin: ["file:///abs/path/to/plugin.ts"]`. ה-env var מועבר רק ל-sub-process של voice-acp.

‫**יתרונות:**
1. אפס נגיעה ב-cwd של המשתמש.
2. אפס קבצים זמניים על דיסק (אין race conditions ב-cleanup).
3. ממוזג עם קונפיג שכבר קיים אצל המשתמש (לא דורס את `.opencode/opencode.json` שלו אם יש).
4. נשלט per-spawn — אם בעתיד נרצה toggle (מצב קולי on/off), פשוט נכלול/לא נכלול את ה-env var.
5. מאומת ב- production (CodeNomad).

---

## 4. איך זה עובד ב-OpenCode פנימית

### 4.1 טעינת `OPENCODE_CONFIG_CONTENT`

‫**מקום:** `packages/opencode/src/config/config.ts:570-578`

```ts
if (process.env.OPENCODE_CONFIG_CONTENT) {
  const source = "OPENCODE_CONFIG_CONTENT"
  const next = yield* loadConfig(process.env.OPENCODE_CONFIG_CONTENT, {
    dir: ctx.directory,
    source,
  })
  yield* merge(source, next, "local")
}
```

הקונפיג ממוזג ב-priority "local" — אחרי global, אחרי `--config` flag, אחרי `OPENCODE_CONFIG_DIR`, **אחרי** קונפיגים מ-`.opencode/opencode.json` של הפרויקט. זה אומר שלפלאגין שלנו תהיה עדיפות גבוהה במיזוג, אבל הפלאגינים של המשתמש לא יידרסו — שניהם יירוצו, ב-sequence (ראה  §4.3).

### 4.2 פורמט ה-config

JSON object רגיל, אותו סכמה שמופיעה ב-`opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///abs/path/to/audio-friendly.ts"]
}
```

ה-`plugin` יכול להיות:

| פורמט                                            | תיאור                                                |
| ------------------------------------------------ | ---------------------------------------------------- |
| `"npm-package"`                                  | npm package (יותקן אוטומטית עם Bun ב-cache)        |
| `"@scope/npm-package"`                           | scoped npm package                                   |
| `"package@file:/abs/path/to/tarball.tgz"`        | tarball מקומי (CodeNomad משתמש בזה ב-prod)            |
| `"file:///abs/path/to/plugin.ts"`                | קובץ TS/JS ישיר (CodeNomad משתמש בזה ב-dev)         |

הבחירה שלנו: **`file://` URL ל-TS file בתוך ה-repo**. אין צורך לפרסם ל-npm ולא לעשות  tarball — OpenCode טוען את הקובץ ישירות עם Bun.

### 4.3 ה-Hook עצמו

‫**הגדרה:** `packages/plugin/src/index.ts:290-295`

```ts
"experimental.chat.system.transform"?: (
  input: { sessionID?: string; model: Model },
  output: { system: string[] }
) => Promise<void> | void
```

‫**איפה הוא נורה:** `packages/opencode/src/session/llm.ts:114-118` — **לפני כל קריאה ל-LLM** (כל הודעה במשתמש בסשן).

```ts
const header = system[0]
yield* plugin.trigger(
  "experimental.chat.system.transform",
  { sessionID: input.sessionID, model: input.model },
  { system },
)
// rejoin to maintain 2-part structure for caching if header unchanged
if (system.length > 2 && system[0] === header) {
  const rest = system.slice(1)
  system.length = 0
  system.push(header, rest.join("\n"))
}
```

**הסבר ה-rejoin:** OpenCode מבנה את ה-system prompt כ-2 חלקים בשביל cache:
- `system[0]` = "header" (agent prompt + provider prompt) — צד מטא יציב, cacheable
- שאר ה-array = "rest" — דברים שעשויים להשתנות, מצורפים ל-`\n`

אם הפלאגין שלנו עשה `output.system.push(audioPrompt)` (הוסיף בסוף), ה-header נשאר זהה, וה-rejoin ימזג את הפרומפט שלנו לתוך ה-"rest". ה-cache נשמר. **לא** לעשות `output.system.unshift(...)` — זה ידרוס את ה-header וישבור caching.

### 4.4 סדר הפעלת hooks מ-plugins מרובים

מ-`docs/plugins.mdx:54-63`:

> ‫Plugins are loaded from all sources and all hooks run in sequence. The load order is:
> ‫1. Global config
> ‫2. Project config
> ‫3. Global plugin directory
> ‫4. Project plugin directory

‫המשמעות: אם המשתמש הגדיר פלאגין משלו שגם הוא משנה את ה-system, **שני הפלאגינים ירוצו, בסדר**. הפלאגין שלנו נוסף אחרון (כי הוא מגיע מ-`OPENCODE_CONFIG_CONTENT` שמתעדכן ב-priority "local"). זה ה-behavior שאנחנו רוצים — נוסיף עוד הוראות, לא נדרוס.

---

## 5. הפלאגין עצמו

### 5.1 מבנה הקובץ

קובץ TS יחיד. אין dependencies חיצוניות.

מיקום: `packages/backend/plugins/audio-friendly.ts`

```ts
import type { Plugin } from "@opencode-ai/plugin"

const AUDIO_PROMPT = `
[the actual prompt content — see §6]
`.trim()

export const AudioFriendly: Plugin = async () => ({
  "experimental.chat.system.transform": async (_input, output) => {
    output.system.push(AUDIO_PROMPT)
  },
})
```

הערות:

1. ה-export name לא משנה — OpenCode סורק את כל ה-named exports ובודק שהם plugin functions. `export default` עובד גם.
2. ה-factory `async () => ({...})` חייב להחזיר אובייקט עם hook אחד או יותר.
3. אין צורך לקרוא ל-`_input` (sessionID/model) — הפרומפט שלנו זהה לכל סשן.
4. שימוש ב-`push` (לא `unshift`) בשביל לשמור על מבנה caching של 2 חלקים (ראה §4.3).

### 5.2 חבילת ה-dependencies

`@opencode-ai/plugin` מספק רק את ה-types. אין צורך להתקין אותו בפרויקט שלנו אם אנחנו לא בודקים את הפלאגין עצמו עם vitest — OpenCode מתקין את החבילה אוטומטית כשהוא טוען את הפלאגין.

אם נרצה type-check על הפלאגין ב-CI:
- ‫**אופציה 1:** להוסיף `@opencode-ai/plugin` ל-`devDependencies` של `packages/backend`.
- ‫**אופציה 2:** לא לעשות import של ה-type — להגדיר types מקומיים מינימליים (פחות אידיאלי).

מומלץ אופציה 1 (ה-package זעיר, type-only).

### 5.3 בנייה / פיתוח

הפלאגין הוא **TS שמועבר as-is ל-OpenCode**. OpenCode (שעובד עם Bun) טוען TS ישירות, אז אין שלב build נפרד. בזמן ריצה:

- ‫**Dev (`pnpm dev`):** הקובץ ב-`packages/backend/plugins/audio-friendly.ts` נטען ישירות.
- ‫**Prod (אם נארוז את voice-acp כ-binary):** הקובץ חייב להישאר נגיש כקובץ נפרד (לא מוכלל ב-bundle). זאת כי OpenCode טוען אותו דרך  `file://` URL בזמן ריצה — לא  bundled עם הקוד שלנו.

זה משפיע על **כל אסטרטגיית packaging עתידית** של voice-acp:
- חייב להעתיק את `plugins/audio-friendly.ts` ל-output dir של ה-build
- הנתיב חייב להיות מוחלט ויציב ב-runtime (לא נמצא בתוך `node_modules/...`)

---

## 6. תוכן הפרומפט

טיוטה ראשונה. צריך iteration אחרי בדיקה אקוסטית של פלט אמיתי.

```
You are talking to a user through a voice-only interface. Your text output
is converted to speech and read aloud — the user does not see your words.

OUTPUT RULES (strict):

1. No markdown. No headings (##), no bold (**), no italics, no bullet lists,
   no code fences (```), no tables, no inline backticks. Use natural prose.

2. No emojis or symbols. ✅ ❌ → • ★ etc. either get pronounced literally
   or sound like static. Express yes/no/success/failure in words.

3. No URLs, file paths, or hash-like strings unless the user explicitly
   asked for them. The user cannot click them. Say "the config file" not
   "/Users/foo/.config/opencode/opencode.json".

4. No raw JSON, YAML, or code dumps. Describe results in conversational
   language. Instead of dumping a JSON object, say "you have three sessions
   open: alpha, beta, and gamma".

5. Numbers: spell out small numbers in words ("three files"). For large
   numbers, group naturally ("about twelve hundred lines", not "1247").

6. Keep responses short and conversational by default. If the answer is
   long, give a one-sentence summary and offer to elaborate.

7. When listing items, prefer flowing sentences over vertical lists.
   "The three options are alpha, beta, and gamma" — not
   "- alpha\n- beta\n- gamma".

8. Avoid filler phrases like "Here is the output:" followed by a dump.
   Just describe what happened.

9. Code: if you need to mention a function or variable name, say it in
   prose ("the function getCwd"). Do not show code snippets unless the
   user explicitly asks to hear code. If you do show code, describe it
   first ("a three-line function that returns the current directory"),
   then keep it minimal.

10. Errors: describe what failed and why in one sentence, then offer
    the next step. Do not paste stack traces.
```

**שיקולים על הפרומפט:**

- **אורך:** ארוך יחסית (~30 שורות). מבחינת cost — בקריאה אחת זה לא מהותי. בקריאות מרובות זה cached.
- **טון:** הוראות ברורות, imperative , בלי "please".
- **דוגמאות:** נכללו דוגמאות "במקום X תגיד Y" — חיוניות, מודלים נצמדים לדוגמאות.
- **שפה:** אנגלית למרות שהמשתמשת מדברת עברית — כי המודלים מבינים אנגלית טוב יותר ב-system prompts. הפלט עצמו יישאר בעברית כשהמשתמשת מדברת עברית, כי המודלים מתאימים את שפת התשובה לשפת הקלט.

**Iteration לוגית:**
- גרסה ראשונה, audit אקוסטי על 5-10 prompts אמיתיים, צמצום/הרחבה לפי צורך.
- ייתכן שנגלה ש-claude/opencode מתעלם מחלק מהכללים — נצטרך לחזק או לחזור על הכלל בכמה ניסוחים.

---

## 7. שילוב בקוד שלנו

הזרקת ה-env var קורית במקום **אחד**: `packages/backend/src/acp/bridge-spawn.ts`, פונקציית `spawnAndWaitForPort`.

כרגע הפונקציה מקבלת `env` אופציונלי ומעבירה ל-`spawn`. נצטרך:

1. **חישוב הנתיב המוחלט** לפלאגין ב-runtime. אופציות:
   - `path.resolve(import.meta.dirname, "../../plugins/audio-friendly.ts")` — יחסי לקובץ. שביר ב-bundling.
   - ‫env var `VOICE_ACP_PLUGIN_DIR` עם default → `path.resolve(process.cwd(), "plugins")` — ניתן ל-override.
   - לקרוא ל-`require.resolve` / equivalent על constant מוסכם.
2. **המרה ל-file URL:** `pathToFileURL(absPath).href` (חובה, OpenCode מצפה ל-`file://`).
3. **בניית JSON config:**
   ```ts
   const config = JSON.stringify({
     $schema: "https://opencode.ai/config.json",
     plugin: [pluginUrl],
   })
   ```
4. **הוספה ל-env** רק כשה-CLI הוא `opencode`:
   ```ts
   env: {
     ...opts.env,
     ...(opts.cliKind === "opencode"
       ? { OPENCODE_CONFIG_CONTENT: config }
       : {}),
   }
   ```

הערה: `spawnAndWaitForPort` כיום לא מודע ל-`cliKind`. צריך או להעביר את `cliKind` כפרמטר, או להעביר את ה-env מוכן מ-`bridge-manager.ts` (שיודע מה ה-cliKind). הפתרון השני אלגנטי יותר — bridge-manager בונה את ה-env והופך ל-source of truth.

### מיזוג עם קונפיג קיים של המשתמש (אופציונלי, מומלץ)

המשתמש עשוי להגדיר משלו   `OPENCODE_CONFIG_CONTENT` בסביבה. אם נדרוס אותו   ב-spawn  של voice-acp — נשבור את ה-  workflow  שלו.

Pattern שהיה  ל-CodeNomad (`opencode-plugin.ts:46-61`):

```ts
function buildOpencodeConfigContent(existing: string | undefined, pluginUrl: string): string {
  const config = existing?.trim() ? JSON.parse(stripJsonc(existing)) : {}
  const existingPlugins = Array.isArray(config.plugin) ? [...config.plugin]
                        : typeof config.plugin === "string" ? [config.plugin]
                        : []
  if (!existingPlugins.includes(pluginUrl)) {
    existingPlugins.push(pluginUrl)
  }
  return JSON.stringify({
    $schema: config.$schema ?? "https://opencode.ai/config.json",
    ...config,
    plugin: existingPlugins,
  })
}
```

נשתמש ב-pattern דומה — לא דורסים,  ממזגים את הפלאגין שלנו אל plugins הקיימים.

---

## 8. היקף ה-CLIs

> **עדכון 2026-06-19:** הטבלה למטה ("טרם נחקר") **נחקרה ומאומתת-במקור** —
> ראה `docs/investigations/2026-06-19-cli-prompt-injection-mechanisms.md` (מנגנון
> append פר-CLI, סדר העדפה, spikes, ואבסטרקציית `InjectionPlan`).

הפלאגין הזה **רלוונטי רק ל-OpenCode**. בכל אחד מה-CLIs האחרים נצטרך מנגנון מקביל:

| CLI                | מנגנון אפשרי                                                                                                          | סטטוס מחקרי                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| ‫`opencode`        | פלאגין דרך `OPENCODE_CONFIG_CONTENT` (הסיפור הזה)                                                                       | מאומת                           |
| ‫`claude` (acp)   | ‫`claude-agent-acp` מבוסס Claude Code SDK. תומך ב-`appendSystemPrompt` בקריאות. צריך לבדוק האם ה-acp wrapper חושף flag. | טרם נחקר                        |
| ‫`gemini` (acp)   | ‫`gemini-cli --experimental-acp`.  Gemini CLI  תומך ב-`GEMINI_SYSTEM_MD` env var → קובץ system prompt. סביר.        | טרם נחקר                        |
| ‫`codex` (acp)    | ‫`@zed-industries/codex-acp` עם `--system` flag? צריך לבדוק.                                                          | טרם נחקר                        |

‫**ההמלצה:** להתחיל מ-OpenCode (יחסית פשוט, תיעוד טוב). אחרי שזה עובד   end-to-end,  לחקור את שלושת האחרים בנפרד. ייתכן שלכל אחד תידרש גישה שונה — אין מנגנון אחיד   cross-CLI להזרקת system prompt.

---

## 9. סיכונים, gotchas, ושאלות פתוחות

### 9.1 `experimental.` prefix

ה-hook מסומן כ-`experimental.` — ‫**OpenCode עשוי לשנות את ה-API בלי הודעה**. שני מיטיגציות:

- ‫להריץ smoke test ב-CI שמוודא שה-hook עדיין יורה — בדיקה פשוטה: spawn opencode + שליחת prompt + assert שהפלט לא מכיל emojis.
- לעקוב אחרי ה-changelog של OpenCode ולעדכן כשהוא יוצב.

### 9.2 התקנה אוטומטית של תלויות

OpenCode מריץ `bun install` ב-startup בכל plugin directory שהוא מאתר, כדי להבטיח שיש את `@opencode-ai/plugin`. זה קורה רק לגבי directories, לא לגבי file:// plugins ישירים. אנחנו ב-file:// path → לא צפויות התקנות-רקע מהפלאגין שלנו. **לבדוק.**

### 9.3 startup latency

טעינת פלאגין נוסף תוסיף מס' עשרות ms ל-startup של opencode acp (Bun import + factory invocation). אם זה משמעותי, לבדוק בפועל.

### 9.4 התנהגות שונה בין מודלים

המודלים מגיבים אחרת ל-system prompts. Claude נוטה לציית; Gemini נוטה להתעלם מהוראות "no markdown" אחרי כמה תורים; GPT-4 מאזן. ייתכן שנצטרך פרומפט שונה למודלים שונים, או reinforcement בכל turn (וריאנט: hook שגם משנה כל user message ולא רק את ה-system).

### 9.5 פגיעה ב-tool calls / structured output

הפרומפט שלנו אומר "no JSON dumps". זה עלול להתנגש עם מצבים בהם המודל אמור לקרוא ל-tool עם args מורכבים. צריך לחדד: "no JSON in user-facing output" — לא "no JSON ever". להוסיף בחירה לשונית בפרומפט.

### 9.6 מצבים בהם דווקא רוצים markdown

לדוגמה: המשתמשת מבקשת  "תראה לי בדיוק את הקוד של הפונקציה". כאן רוצים שהמודל יציג את הקוד גם אם הוא ייקרא לא טוב ב-TTS, או יעדיף fallback ל-rendering ויזואלי במסך.

‫**פתרון אפשרי:** הפרומפט מאפשר ‫code על-פי בקשה מפורשת ("unless the user explicitly asks to hear code"). זה כבר כלול בטיוטה.

### 9.7 שאלה פתוחה: per-session toggle?

האם נרצה ב-voice-acp לאפשר מצב "טקסט מלא" (יראה markdown כרגיל) למשתמשת שמשתמשת ב-typing fallback? אם כן — ה-plugin  יקרא env var נוסף (לדוגמה: `VOICE_ACP_AUDIO_MODE=on`) ויחליט בפנים האם להוסיף את הפרומפט. כך אותו plugin שלנו מתאים לשני המצבים.

נדחה לעתיד.

### 9.8 שאלה פתוחה: TTS-aware formatting

גרסה מתקדמת תוכל לעשות יותר מהזרקת פרומפט — למשל,  ב- `experimental.chat.messages.transform`  לקחת פלט שמכיל markdown ולהמיר טקסטואלית ל-prose  (regex / mini-NLP). יתרון: סובלנות לכשלי המודל. חסרון: סיכון לעיוות תוכן לגיטימי. נדחה.

---

## 10. הצלחה — איך נדע שזה עובד

- ‫`pnpm dev` עובד כמו קודם.
- spawning של opencode acp מצליח עם ה-env var, אין שגיאות startup.
- ב-prompt אמיתי שמבקש "תראה לי את הסשנים הפתוחים" — הפלט פרוזה, בלי emoji, בלי `**bold**`, בלי vertical list.
- ה-cache headers שב-Anthropic API ממשיכים לעבוד (נבדק על ידי headers `anthropic-cache-creation-input-tokens` / `cache-read-input-tokens`).
- ה-AUDIO_PROMPT לא דולף לפלט עצמו ("As per my system instructions...") — בעיה ידועה במודלים, יהיה צורך ב-iteration.
- כשמשתמשת מגדירה  OPENCODE_CONFIG_CONTENT  משלה — היא נשמרת, הפלאגין שלנו רק מתווסף אליה (לא דורס).

---

## 11. עתיד — מה לא בסיפור הזה אבל קשור

- ‫**Slice עוקב — claude-agent-acp:** מחקר על האם יש מנגנון להזרקת system prompt לפני שליחת prompt ל-Claude דרך acp.
- ‫**Slice עוקב — gemini-cli ו-codex-acp:** מחקר דומה לכל אחד מהשניים.
- ‫**Slice עוקב — לוח שליטה למשתמשת:** מסך ב-frontend לערוך את הפרומפט עצמו (לא לקודד אותו).
- ‫**Slice עוקב — TTS preprocessor כ-safety net:** במקרה שהמודל מפר את ההוראות, מסיר emojis/markdown ב-pipeline לפני שליחה ל-ElevenLabs.
