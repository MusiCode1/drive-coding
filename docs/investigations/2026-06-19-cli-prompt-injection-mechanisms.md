# הזרקת system prompt לכל CLI — מנגנונים פר-CLI

> **תאריך:** 2026-06-19 (מרדכי) · **סוג:** מחקר/ממצאים (לא תוכנית-מימוש)
> **הקשר:** הרחבת מנגנון ה-audio-friendly prompt מ-OpenCode (ממומש, slice 14) לכל
> שאר ה-ACP CLIs. ראה `docs/audio-friendly-prompt-plan.md` §8 (הטבלה שם — "טרם נחקר"
> — מוחלפת על-ידי המסמך הזה).
> **שורה תחתונה:** לכל CLI יש מנגנון *append* (הוספה בלי דריסה) שעובד בלי לגעת בקוד
> ה-CLI. אבל המנגנונים **אינם אחידים** ונחלקים ל-3 משפחות. opencode + claude מתאימים
> להעדפת ה-env; codex + qoder נשענים על argv flag; gemini נשען על קובץ (הכי בעייתי).
> שני spikes פתוחים: claude (`CLAUDE_CONFIG_DIR`) ו-gemini (בידוד מ-cwd המשתמש).

---

## 1. המטרה והאילוצים

להוסיף (append) הנחיות audio-friendly לכל קריאת LLM של ה-CLI, כך ש:

1. **לא דורסים** את ה-system prompt הבסיסי של ה-CLI (יכולות coding, tools, workflows).
2. **לא נוגעים בקוד ה-CLI** — אנחנו רק spawn-רים אותו כ-subprocess.
3. **לא מזהמים את ה-cwd של המשתמש** — ה-cwd הוא הפרויקט שלו (עיקרון מ-§3 בתוכנית
   הקיימת: אסור לדחוף `.opencode/` או `CLAUDE.md` סמוי לפרויקט שלו).
4. **לא משפיעים על שימוש רגיל** של ה-CLI מחוץ ל-drive-coding (פוסל config גלובלי
   כמו `~/.gemini/GEMINI.md` או `~/.claude/CLAUDE.md` — יחול גם על הטרמינל של המשתמש).

### מה אנחנו שולטים בו בזמן spawn

`bridge-manager.ts` → `spawnInternal` קובע: `bin`, `args` (argv), `env`, `cwd`.
זה **כל** משטח ההזרקה הזמין לנו ב-BE. ה-cwd נקבע על-ידי המשתמש (תיקיית העבודה),
אז למעשה נשארים **argv + env** כמשטח שאנחנו שולטים בו באופן מלא ובטוח.

### מי ה-ACP client — שיקול מכריע

ה-BE הוא **pass-through כמעט-טהור**: ה-FE הוא ה-ACP client (בונה `session/new` ו-
`session/prompt`), וה-BE רק כותב את ה-frames ל-`child.stdin`
(`ws-agent.ts:126`), מסנן רק `$/ping`. הוא **לא** מפענח/עורך את ה-frames.

המשמעות: כל מנגנון מבוסס-`_meta` (protocol-level) דורש או שינוי ב-**FE**, או
interception של ה-frame ב-BE (שובר את ה-pass-through). לכן **מסלולי spawn-time
(env/argv/file) עדיפים ארכיטקטונית** — הם נשארים ב-BE, עקביים עם opencode הקיים,
ושומרים את ה-BE טיפש.

---

## 2. סדר ההעדפה למנגנונים (הכרעת המשתמשת)

מהמועדף לפחות:

1. **משתנה סביבה (env var) עם הערך inline** — הכי נקי. ה-BE כבר בונה את ה-env;
   אפס נגיעה ב-FS; אפס cleanup; stateless.
2. **קובץ הגדרות** (settings/config) — מובנה, אבל דורש כתיבת קובץ.
3. **פלאג CLI** (argv) — נקי ו-stateless, אבל פחות "רשמי" מקובץ הגדרות.
4. **קובץ memory/context** (כמו `CLAUDE.md` / `GEMINI.md`) — **אחרון**: מזהם FS,
   דורש cleanup, ורגיש למיקום (cwd המשתמש).
   - **חריג שמעלה את הדירוג:** אם אפשר להעביר את **נתיב הקובץ כ-env var**
     (config-dir מבודד), הקובץ עולה משמעותית — כי הוא מבודד מ-cwd המשתמש ונשלט
     לחלוטין על-ידינו. זה הופך "קובץ" ל"env שמצביע על קובץ מבוקר".

> הערה: ה-`-c key=value` של codex הוא טכנית argv flag (דרגה 3), אבל בפועל הוא
> מזריק *ערך inline* בלי קובץ ובלי FS — כלומר נקי כמו env. לכן בטבלה הוא מדורג
> כבחירה מועדפת ל-codex על-פני כתיבת `config.toml`, חרף הדירוג הפורמלי.

---

## 3. ממצאים פר-CLI

כל הממצאים מאומתים-במקור (קריאת dist/source) אלא אם צוין אחרת.

### 3.1 opencode — ✅ ממומש (env inline, דרגה 1)

| | |
|---|---|
| **הרצה** | `opencode acp` |
| **מנגנון** | `OPENCODE_CONFIG_CONTENT` (env) = JSON config עם `plugin: [<url>]`; הטקסט עובר ב-`PROMPT_INJECTOR_TEXT` (env) |
| **append?** | append — הפלאגין דוחף ל-`output.system` דרך hook `experimental.chat.system.transform` (`push`, לא `unshift` — שומר caching) |
| **מימוש** | `bridge-manager.ts:71-81`, `plugin-config.ts`, `plugins/prompt-injector.ts`, `prompts/audio-friendly.ts` |
| **דרגה** | 1 (env inline) — הבחירה האידיאלית |

זהו ה-baseline. ה-injector כבר גנרי (מקבל טקסט, לא hardcoded) — מוכן לשימוש חוזר.

### 3.2 claude — env→isolated path (דרגה גבוהה לפי החריג) ⚠️ spike

| | |
|---|---|
| **הרצה** | `npx -y @agentclientprotocol/claude-agent-acp@latest` (wrapper מעל Claude Code SDK) |
| **מנגנון מומלץ** | `CLAUDE_CONFIG_DIR` (env) → תיקייה מבודדת שבה `CLAUDE.md` עם ההנחיות |
| **append?** | append — נטען כ-user-memory לכל turn (ה-wrapper מפעיל `settingSources: ["user","project","local"]`) |
| **מקור** | `acp-agent.js:12` (`CLAUDE_CONFIG_DIR ?? ~/.claude`), `acp-agent.js:2265` (`settingSources`) |
| **דרגה** | env→path מבודד — מתאים לחריג בסעיף 2 (נשלט, מבודד מ-cwd המשתמש) |

**מסלול עתיד — claude-code native (Track A, wire-level) — הכי נקי, וכבר מחווט:**
ה-claude-code adapter ב-`provider-abstraction` מדבר את הפרוטוקול הנייטיב
(stream-json **control protocol**), לא דרך CLI. הוא שולח בעצמו
`control_request{initialize}` (`ClaudeCodeSession.ts:124-137`), וה-`initOptions`
שלו כבר כולל **`appendSystemPrompt?: string`** (`session/types.ts:44`,
`protocol/messages.ts:90`) שנשפך ל-wire ב-spread (שורה 134). append, sticky
לכל ה-session, **אפס קבצים/argv/env**. מאומת ש-זה wire ולא CLI:
`docs/research/provider-protocols/claude-code-stream-json/notes.md:38`. VS Code
משתמש באותו שדה ממש להזרקת הנחיות-לקוח (`claude-code-acp/PROTOCOL.md:227-232`) —
אותו use-case. **הקוד כבר מעביר את זה לחוט; צריך רק לאכלס את הערך.** במסלול הזה
spike S-claude מתייתר.

**מסלול חלופי (ACP wrapper, לא מומלץ):** `_meta.claudeCode.options.systemPrompt =
{ type:"preset", preset:"claude_code", append:"…" }` ב-`session/new` — אבל דורש
שה-**FE** יזריק את ה-`_meta` (ה-ACP client), או interception ב-BE. שובר את ה-pass-through.

**מה לא עובד:** ל-wrapper **אין** argv flag ל-system-prompt (בניגוד ל-claude CLI הגולמי — `--append-system-prompt` שלו לא מועבר דרך ה-wrapper). אין env var ייעודי לתוכן system-prompt.

> **⚠️ spike נדרש (S-claude):** לאמת בריצה אמיתית ש-`CLAUDE_CONFIG_DIR/CLAUDE.md`
> אכן נטען כ-user-memory (הסוכן מצא את ה-flag אך לא הוכחה ישירה שקובץ memory נטען
> *מ-config-dir*; ה-SDK טוען זאת דרך user settingSource). לבדוק גם
> `CLAUDE_CODE_DISABLE_AUTO_MEMORY` (auto-memory דלוק כברירת-מחדל — טוב לנו).

### 3.3 codex — argv flag inline (דרגה 3, נקי כמו env)

| | |
|---|---|
| **הרצה** | `npx -y @zed-industries/codex-acp@latest` (launcher דק → binary של codex-rs) |
| **מנגנון מומלץ** | `-c developer_instructions="<text>"` ב-argv |
| **append?** | append — "developer instructions inserted as a developer-role message", לצד ה-system prompt המובנה, לא דורס |
| **מקור** | `config_toml.rs:221-223`, `config/mod.rs:673,3492`; ה-wrapper מעביר `-c` דרך `CliConfigOverrides::parse()` (`main.rs:8`, `lib.rs:35-55`) |
| **דרגה** | 3 (argv) — אך stateless, ללא FS |

**חלופה (env→config-file):** `CODEX_HOME` (env) → `config.toml` עם `developer_instructions`. דרגה 2 פורמלית, אך דורש כתיבת קובץ. ה-`-c` עדיף בפועל.

**מלכודות — לא להשתמש:** `instructions` ו-`model_instructions_file` **דורסים** את ה-base prompt (`model_instructions_file` אף מתועד כ-"STRONGLY DISCOURAGED"). רק `developer_instructions` הוא additive טהור. אין env var ישיר למפתחי-ההוראות (רק `CODEX_HOME`). אין מסלול `_meta` דרך **עטיפת ה-ACP** (ה-wrapper זורק את `_meta` ב-`new_session`).

**מסלול עתיד — codex app-server (Track A, wire-level):** כשנדבר ישירות עם
`codex app-server` (ספק שלישי, לא דרך עטיפת ACP), אפשר להזריק דרך ה-wire ב-method
`thread/start` (v2; `newConversation` ב-v1 ישן) בשדה **`developerInstructions`** —
additive, יציב (לא experimental), sticky לכל ה-thread, **אפס argv/env/קובץ**. זהו
**אותו שדה core** (`developer_instructions`) שה-`-c` flag מגיע אליו — רק transport
שונה. מאומת-במקור: `app-server-protocol/.../v2/thread.rs:94`,
`thread_processor.rs:1294-1328`, `core/src/session/mod.rs:3059-3064`. אזהרה: ב-
resume/fork של thread קיים השדה **מתעלם** (`thread_processor.rs:131-139`) — רק
ב-`thread/start` הראשוני. ראה סעיף 5.2 (שתי שכבות הזרקה).

### 3.4 qoder — argv flag ייעודי (דרגה 3)

| | |
|---|---|
| **הרצה** | `qodercli --acp` (fork/וריאנט של Claude Code; config dir `~/.qoder`) |
| **מנגנון מומלץ** | `--append-system-prompt "<text>"` ב-argv |
| **append?** | append — ה-flag מתועד מפורשות כ-"Append to the default system prompt" |
| **מקור** | `qodercli --help` (v1.0.10, מקומי) + binary strings; [zed.dev/acp/agent/qoder-cli] |
| **דרגה** | 3 (argv) — נקי וייעודי |

**חלופות:** `--system-prompt` (דורס — פסול), `AGENTS.md` ב-cwd/`~/.qoder` (קובץ), `--agents '<json>'` + `--agent` (persona מלא). `QODER_CONFIG_DIR` (env) לבידוד config.

> **⚠️ אי-ודאות (כנות):** האימות הוא ברמת ה-flag definition + binary strings, **לא**
> ריצת session ACP חיה. לאמת ש-`--append-system-prompt` משתלב עם `--acp` בפועל
> (ודאות "סביר-גבוה", לא "מאומת-runtime"). qoder הוא CLI שולי — עדיפות נמוכה.

### 3.5 gemini — קובץ בלבד (הכי בעייתי) ⚠️ spike

| | |
|---|---|
| **הרצה** | `gemini --acp` |
| **מנגנון** | קובץ `GEMINI.md` (context/memory) — משורשר **אחרי** ה-base prompt, **תמיד** |
| **append?** | append אמיתי — `renderFinalShell(basePrompt, userMemory, …)` (`promptProvider.ts:268-272`, `snippets.ts:175-185`). ההנחיות גוברות על behavior אך לא על Core Mandates (`snippets.ts:531`) — מושלם |
| **מקור** | `~/vendor/gemini-cli/.../promptProvider.ts`, `snippets.ts`, `memoryTool.ts:40-61`, `config.ts:599-600` |
| **דרגה** | 4 (קובץ) — אין מסלול env-inline ולא argv flag |

**מלכודת מרכזית — לא להשתמש:** `GEMINI_SYSTEM_MD` (env) **דורס** את כל ה-system prompt (מאבד יכולות coding/tools); ה-`else` של ה-Standard Composition לא רץ כלל (`promptProvider.ts:53-132`). זהו env→path, אבל לא-additive → פסול ל-append.

**אופציות לבידוד מ-cwd המשתמש:**
- `settings.context.fileName` תומך ב-**מערך** שמות קבצים (`["GEMINI.md","AUDIO.md"]`) — דרך קובץ settings. עדיין דורש שתילת קובץ נגיש.
- שתילת `GEMINI.md` ב-cwd → מזהם הפרויקט (פסול לפי אילוץ 3).
- `~/.gemini/GEMINI.md` גלובלי → מזהם שימוש רגיל (פסול לפי אילוץ 4).

> **⚠️ spike נדרש (S-gemini):** למצוא env שמגדיר **gemini config/home dir מבודד**
> (אנלוג ל-`CLAUDE_CONFIG_DIR`/`CODEX_HOME`) כך שנשתול `GEMINI.md` בתיקייה מבוקרת
> בלי לזהם את ה-cwd או את ה-`~/.gemini` של המשתמש. אם אין כזה — gemini נשאר
> הפינה הקשה ביותר, ואולי נדרש שרשור ידני (`GEMINI_WRITE_SYSTEM_MD` לכתוב את
> ה-default + צירוף + `GEMINI_SYSTEM_MD`) — שביר ולא מומלץ.

---

## 4. טבלת סיכום

| CLI | מנגנון נבחר | סוג | append? | דרגת-העדפה | סטטוס |
|-----|-------------|-----|---------|------------|--------|
| opencode | `OPENCODE_CONFIG_CONTENT` + plugin + `PROMPT_INJECTOR_TEXT` | env inline | ✅ | 1 | ✅ ממומש |
| claude | `CLAUDE_CONFIG_DIR` → `CLAUDE.md` | env→path | ✅ | גבוה (חריג) | ⚠️ spike S-claude |
| codex | `-c developer_instructions="…"` | argv inline | ✅ | 3 (נקי) | מאומת-מקור |
| qoder | `--append-system-prompt "…"` | argv | ✅ | 3 | סביר-גבוה (לא runtime) |
| gemini | `GEMINI.md` בתיקייה מבודדת | קובץ | ✅ | 4 | ⚠️ spike S-gemini |

**שלוש משפחות מנגנונים:** env-inline (opencode) · env→path/argv-inline (claude, codex) · argv-flag (qoder) · file (gemini).

---

## 5. שיקול ארכיטקטוני — אבסטרקציית הזרקה אחידה

כיום ההזרקה hardcoded ב-`bridge-manager.ts:71-81` (`if cliKind === "opencode"`).
עם 4 CLIs נוספים זה חייב להפוך ל-**strategy per cliKind**, ברוח `CLI_SPECS`
(מקור-אמת אחד):

```ts
// injection-strategy.ts — טהור (core) או backend
type InjectionPlan = {
  envPatch?: Record<string, string>     // claude: CLAUDE_CONFIG_DIR; opencode: OPENCODE_CONFIG_CONTENT
  extraArgs?: string[]                  // codex: ["-c","developer_instructions=…"]; qoder: ["--append-system-prompt","…"]
  tempFiles?: { path: string; content: string }[]  // claude/gemini: CLAUDE.md/GEMINI.md בתיקייה מבודדת
}
function planInjection(cliKind: CliKind, promptText: string, ctx): InjectionPlan
```

ה-spawn ב-bridge-manager צורך `InjectionPlan` אחיד: ממזג `envPatch` ל-childEnv,
מצרף `extraArgs` ל-args, כותב `tempFiles` (עם cleanup ב-`exit`). כל CLI = רשומה
אחת. זה גם מנקה את ה-`if opencode` הנוכחי לכדי רשומה רגילה אחת.

**שאלת מיקום פתוחה:** האם `planInjection` שייך ל-`CLI_SPECS` (core, טהור) או
ל-backend (כי `tempFiles` דורש IO ו-path). הצעה: ה-*תיאור* (איזה מנגנון לכל CLI)
ב-core/spec; ה-*ביצוע* (כתיבת קבצים, מיזוג env) ב-backend — עקבי עם הפרדת
bin/args (נתונים) מ-spawn (IO) שכבר קיימת ב-D6/D24.

### 5.1 דפוס מאומת — תוכנית הקנוניזציה של brief-driven-slices

הדפוס "מקור-אמת קנוני אחד → renderer פר-CLI" כבר קיים ומוכח ב-skill
brief-driven-slices: `scripts/generate-cli-configs.py` מתרגם
`agent-definitions/agents.json` + `prompts/*.md` ל-format של כל CLI
(OpenCode → Markdown frontmatter; Codex → TOML). ה-`InjectionPlan` שלנו הוא
אנלוג ישיר (canonical audio-prompt → מנגנון פר-CLI).

**אישוש חוצה-מקורות:** ה-renderer של codex שם כותב את ה-prompt כ-
`developer_instructions = """…"""` — **אותו מנגנון** שהמחקר שלנו מצא באופן עצמאי
ל-codex (סעיף 3.3). שני מקורות בלתי-תלויים מתכנסים לאותה מסקנה → ודאות גבוהה.

**הבדל מהותי — לא להשתמש בתשתית עצמה:** ה-cli-configs ההוא הוא **static
install-time** (כותב קבצים מתמשכים פעם אחת; agents קבועים). שם codex משתמש
ב-config-file (`developer_instructions` ב-TOML). המנגנון שלנו הוא **dynamic
spawn-time** (env/argv פר-process, בלי קבצים מתמשכים) — ולכן ל-codex עדיף
ה-`-c developer_instructions=` flag על-פני כתיבת `config.toml`. מאמצים את
ה*דפוס* (canonical → per-CLI) ואת ה*מיפויים*, לא את הסקריפט.

---

### 5.2 שתי שכבות הזרקה — spawn-time מול wire-level

מסתמנת הבחנה שמארגנת את כל הממצאים:

| שכבה | מתי זמין | מנגנונים | נקיון |
|------|----------|----------|-------|
| **spawn-time** (argv/env/file) | היום — דרך עטיפות ACP, ה-FE הוא ה-client | opencode env · codex `-c` · qoder `--append` · claude/gemini קובץ | תלוי-CLI |
| **wire/session-level** (protocol params) | כשאנחנו ה-client הישיר (Track A / שינוי FE) | **codex app-server `developerInstructions`** · **claude native `appendSystemPrompt`** (ב-`initialize`, כבר מחווט ב-adapter) | **הכי נקי** — אפס FS/argv |

שתי תובנות:

1. **codex מגיע לאותו יעד משני מסלולים.** ה-`-c developer_instructions=` (spawn) וה-
   `developerInstructions` ב-`thread/start` (wire) שניהם נשפכים לאותו
   `ConfigOverrides.developer_instructions` ב-core. המיפוי הסמנטי ("codex append =
   developer_instructions") יציב; ה-`InjectionPlan` רק מחליף transport. זה מאשר
   שהאבסטרקציה הנכונה היא **(cliKind, transport) → מנגנון**, לא רק cliKind.

2. **wire-level הוא משפחה אחת חוצה-CLI.** claude (`_meta`) ו-codex (app-server) שניהם
   נקיים יותר מ-spawn-time — אבל **שניהם** דורשים שאנחנו ה-client הישיר. זה מקשר את
   המנגנון הזה ל-**Track A** (ProviderSession ב-backend): כשנעבור לדבר ישירות עם
   הספקים, שכבת ה-wire נפתחת ומייתרת את הקבצים/flags עבור claude ו-codex כאחד. עד
   אז — spawn-time הוא הדיפולט (ה-BE נשאר pass-through, ה-FE הוא ה-ACP client).

## 6. spikes ושאלות פתוחות

- **S-claude (חוסם את claude):** אימות-runtime ש-`CLAUDE_CONFIG_DIR/CLAUDE.md` נטען
  כ-user-memory. אם נכשל → מסלול `_meta` דרך FE.
- **S-gemini (חוסם את gemini):** איתור env לבידוד config-dir של gemini. אם אין →
  הכרעה בין cwd (מזהם) לשרשור ידני שביר.
- **toggle עתידי (§9.7 בתוכנית):** מצב audio on/off פר-session. ה-`InjectionPlan`
  כבר מאפשר את זה (לא לבנות plan כשהמצב כבוי). נדחה לעתיד.
- **שונות בין מודלים (§9.4):** ייתכן שיידרש reinforcement פר-turn (לא רק system),
  או נוסח פר-CLI. נדחה — קודם append בסיסי.

---

## 7. הצעת slices (JIT)

- **Slice A:** אבסטרקציית `InjectionPlan` + strategy map + הגירת opencode אליו +
  **codex & qoder** (argv — קל, מוכיח את האבסטרקציה, סיכון נמוך). ערך מיידי.
- **Slice B:** **gemini** (file-based) — אחרי S-gemini.
- **Slice C:** **claude** (env→path) — אחרי S-claude. ה-CLI העיקרי, אך התלוי-spike.

> סדר מומלץ: A קודם (קל + מבסס תשתית). את claude (C) אפשר להקדים אם נחשב לעיקרי —
> אך הוא חסום-spike. ההכרעה הסופית של מרדכי + המשתמשת.

---

## מקורות

- `~/vendor/gemini-cli/packages/core/src/prompts/{promptProvider,snippets,utils}.ts`, `tools/memoryTool.ts`, `utils/memoryDiscovery.ts`, `cli/src/config/config.ts`, `core/src/core/client.ts`
- `@agentclientprotocol/claude-agent-acp@0.48.0` dist: `acp-agent.js`, `index.js`; `@anthropic-ai/claude-agent-sdk@0.3.183` `sdk.d.ts`; docs.claude.com (agent-sdk, settings)
- `@zed-industries/codex-acp@0.16.0` src + `openai/codex` codex-rs: `config/mod.rs`, `config_toml.rs`, `agents_md.rs`; developers.openai.com/codex/config-reference
- `qodercli --help` (v1.0.10) + binary strings; zed.dev/acp/agent/qoder-cli
- קוד drive-coding: `bridge-manager.ts`, `plugin-config.ts`, `cli-config.ts`, `cli-config-file.ts`, `ws-agent.ts`, `core/src/schemas/agent.ts` (`CLI_SPECS`)
</content>
</invoke>
