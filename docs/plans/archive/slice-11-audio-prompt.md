# Slice 11 — Audio-Friendly Prompt Injection — תוכנית

> **תאריך**: 2026-05-28
> **סטטוס**: ✅ הושלם — 2026-05-29
> **Complexity**: 5/10 (verifier: light)
> **תלות**: ‏אין — ‏BE-only, ‏עצמאי לחלוטין מ-slices אחרות. ‏יכול לרוץ במקביל ל-slice 3.
> **מתבסס על**: ‏`docs/audio-friendly-prompt-plan.md` (design מלא — ‏396 שורות, ‏פירוט מלא של ה-rationale, ‏ה-alternatives, ‏הgotchas)
>
> ‏ה-brief הזה הוא **‏יישום** ‏של ה-design. ‏אל ‏תכתוב מחדש את ה-rationale — ‏הפנה לdesign doc.

---

## §0 — Pre-flight

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-11-audio-prompt -b slice-11-audio-prompt dev
cd .worktrees/slice-11-audio-prompt
pnpm install
pnpm hooks:install
```

### איך להריץ

| ‏מה | ‏פקודה | ‏Port |
|---|---|---|
| ‏BE | `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` | 4000 |
| ‏FE | `pnpm --filter @drive-coding/frontend-v2 dev` ‏(רק לבדיקה ידנית בסוף) | OS-assigned |

**Note**: ‏ה-slice הזה BE-only ‏עד הבדיקה הידנית בDoD. ‏רוב העבודה ‏(commits 0-2) ‏יכולה לרוץ ‏עם BE לבד.

### OneCLI agent

‏שם: ‏`voice-acp`. ‏לא נדרש ‏ל-slice הזה (אין קריאה ל-Google/ElevenLabs מהפלאגין). ‏אבל ‏ה-BE כן צריך אותו כי המטרה הסופית היא ‏שspawn יהיה ‏עם ‏הplugin תקין ‏ולא ‏יקרוס.

### Reading list

**must-read לפני** (~‎15 ‏דקות):

1. ‏`docs/audio-friendly-prompt-plan.md` — **‏מסמך ה-design המלא**. ‏קרא ‏את §1 (problem), ‏§2 (idea), ‏§4 (how OpenCode works), ‏§5 (plugin file), ‏§6 (prompt content), ‏§7 (integration).
2. ‏`docs/conventions/parallel-safe-code.md` §1, §2, §4 — ‏החוקים על שינויים בקבצים משותפים
3. ‏`AGENTS.md` (root) §Worktrees, §Backend MUST run through OneCLI
4. ‏`packages/backend/src/acp/bridge-manager.ts` (160 ‏שורות) — ‏ה-spawn logic שבה ‏נוסיף את ה-env var

**reference בזמן עבודה**:

- ‏`docs/audio-friendly-prompt-plan.md` §9 (gotchas, ‏risks)
- ‏`docs/audio-friendly-prompt-plan.md` §10 (success criteria — ‏מקור לDoD)
- ‏`~/.config/opencode/learnings.md` — ‏gotchas רוחביים

---

## §1 — מטרה

‏אחרי slice 11: ‏כשהמשתמשת מתחברת ל-`opencode` ‏ושולחת prompt, ‏הסוכן עונה ב**‏פרוזה ידידותית לאודיו** — ‏בלי markdown headings, ‏בלי `**bold**`, ‏בלי emojis, ‏בלי vertical lists. ‏הקול ב-TTS נשמע ‏טבעי ‏ולא ‏מקוטע ע"י קריאה ‏לפסיקים סינטקטיים.

‏ההשפעה: ‏בכל ספאון ‏של `opencode` ‏מתוך voice-acp, ‏מועבר ‏`OPENCODE_CONFIG_CONTENT` ‏עם plugin שמזריק ‏system prompt דרך ‏ה-hook `experimental.chat.system.transform`.

‏בקלות-ים: ‏אישה מבקשת "‏הראי לי את הסשנים שלי" → ‏במקום:
```
## Sessions

- ✅ session-alpha
- ✅ session-beta
```
‏מקבלת:
```
‏יש לך שלוש סשנים פתוחים: ‏alpha, ‏beta, ‏ו-gamma.
```

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ‏Audio-friendly prompt plugin | ✅ | ‏commit 1 |
| ‏Injection דרך OPENCODE_CONFIG_CONTENT | ✅ | ‏commit 2 |
| ‏Merge עם existing user config | ✅ | ‏commit 2 (לפי §7 בdesign) |
| ‏רק ‏ל-opencode CLI | ✅ | ‏MVP |
| ‏Plugin ל-claude, gemini, codex | ❌ | ‏slices עתידיות (לפי §8 בdesign) |
| ‏Per-session toggle ‏(`VOICE_ACP_AUDIO_MODE`) | ❌ | ‏לפי §9.7 — ‏נדחה |
| ‏TTS preprocessor כsafety net | ❌ | ‏לפי §9.8 — ‏נדחה |
| ‏UI לעריכת הפרומפט | ❌ | ‏slice עתידי |
| ‏Iteration על תוכן הפרומפט | 🟡 | ‏גרסה ‏ראשונה ‏מ-§6 ‏בdesign. ‏Tama ‏יחליט אחרי בדיקה אקוסטית |

---

## §3 — Architecture diagram

```
ChatInput → sendPrompt → AgentSession (FE)
                          │  WS
                          ▼
                    BridgeManager (BE) — bridge-manager.ts
                          │
                  ┌───────┴───────┐
                  │ spawnInternal │ ← ‏שינוי כאן
                  │  if cliKind = "opencode":                          │
                  │    env.OPENCODE_CONFIG_CONTENT = buildPluginConfig() │
                  │  spawn(cli.bin, args, { env })                     │
                  └───────┬───────┘
                          ▼
                     opencode subprocess
                          │ ‏טוען config מ-env
                          │ ‏מוסיף plugin ל-config
                          ▼
                  ‏OpenCode plugin loader
                          │ ‏מפעיל hook
                          ▼
            experimental.chat.system.transform
                          │ ‏מוסיף AUDIO_PROMPT ל-system[]
                          ▼
                  ‏LLM call (Claude/GPT/Gemini)
                          │
                          ▼
            ‏פלט פרוזה ידידותית-לאודיו → ACP chunks → ‏FE Speaker

‏קבצים חדשים:
  packages/backend/plugins/audio-friendly.ts   ← ‏הpcin עצמו
  packages/backend/src/plugin-config.ts        ← ‏עוזר build config

‏קבצים שמשתנים (additive):
  packages/backend/src/acp/bridge-manager.ts   ← ‏הזרקת env var
  packages/backend/package.json                 ← ‏@opencode-ai/plugin בdevDeps
```

---

## §4 — Commits

### Commit 0 — תלות + ‏מבנה תיקייה (approach: **manual**)

**קבצים שמשתנים**:
- ‏`packages/backend/package.json` — ‏הוספת ‏`@opencode-ai/plugin` ‏ל-`devDependencies` (type-only, ‏לטעון types ‏ב-plugin file)

**קבצים חדשים**:
- ‏`packages/backend/plugins/` — ‏יצירת ‏התיקייה (אין קבצים בה עדיין)
- ‏`packages/backend/plugins/README.md` — ‏הסבר קצר: ‏"‏פלאגינים ‏שמוזרקים ל-CLI sub-processes דרך OPENCODE_CONFIG_CONTENT. ‏ה-files חייבים להישאר נגישים ב-runtime כקבצי TS — ‏OpenCode טוען אותם ישירות עם Bun. ‏ראה ‏`docs/audio-friendly-prompt-plan.md` §5"

**Verification**:
```bash
pnpm install   # ‏לעדכן lockfile
pnpm --filter @drive-coding/backend typecheck
```

---

### Commit 1 — הפלאגין עצמו (approach: **manual**)

‏יישום של §5+§6 ‏מ-design doc.

**קבצים חדשים**:
- ‏`packages/backend/plugins/audio-friendly.ts`

**מבנה**:
```ts
import type { Plugin } from "@opencode-ai/plugin"

const AUDIO_PROMPT = `<תוכן מ-§6 ב-design doc — copy literal>`.trim()

export const AudioFriendly: Plugin = async () => ({
  "experimental.chat.system.transform": async (_input, output) => {
    output.system.push(AUDIO_PROMPT)
  },
})
```

**‏תוכן הפרומפט**: ‏copy literal מ-`docs/audio-friendly-prompt-plan.md` §6 (10 ‏rules, ‏מתחיל ב"You are talking to a user through a voice-only interface..."). **‏אל תשנה ‏מילים** — ‏Tama יעדכן אחרי בדיקה ‏אקוסטית.

**Critical**: ‏השתמש ב-`output.system.push(...)` ‏(הוסף בסוף). **‏לא** ‏`output.system.unshift(...)` ‏(ידרוס את header של OpenCode וישבור caching). ‏ראה §4.3 ‏ב-design.

**Verification**:
```bash
pnpm --filter @drive-coding/backend typecheck
```

‏typecheck יוודא שhthe-type מ-`@opencode-ai/plugin` ‏מתאים לhook signature.

---

### Commit 2 — Integration ב-bridge-manager (approach: **manual**)

‏יישום של §7 ‏מ-design doc.

**קבצים חדשים**:
- ‏`packages/backend/src/plugin-config.ts` — ‏פונקציה שבונה ‏את ה-config JSON

**API skeleton**:
```ts
import { pathToFileURL } from "node:url"
import path from "node:path"

/**
 * Builds OPENCODE_CONFIG_CONTENT for spawning opencode with the
 * audio-friendly plugin injected. Merges with user's existing
 * OPENCODE_CONFIG_CONTENT if any (§7 of design doc).
 */
export function buildOpencodeConfigContent(
  existingEnv: string | undefined,
): string {
  // ‏ה-plugin file חי במיקום קבוע יחסי לbackend root
  // ‏Development: ‏`packages/backend/plugins/audio-friendly.ts`
  // ‏Use path.resolve from import.meta.dirname (השב mainland לbuildy בעתיד)
  const pluginPath = path.resolve(
    import.meta.dirname,
    "../plugins/audio-friendly.ts",
  )
  const pluginUrl = pathToFileURL(pluginPath).href

  // Merge with existing config if any (לפי CodeNomad pattern, §7 בdesign)
  const config = existingEnv?.trim()
    ? JSON.parse(existingEnv) as Record<string, unknown>
    : {}
  const existingPlugins = Array.isArray(config.plugin)
    ? [...config.plugin]
    : typeof config.plugin === "string"
      ? [config.plugin]
      : []
  if (!existingPlugins.includes(pluginUrl)) {
    existingPlugins.push(pluginUrl)
  }

  return JSON.stringify({
    ...config,
    $schema: (config.$schema as string) ?? "https://opencode.ai/config.json",
    plugin: existingPlugins,
  })
}
```

**קבצים שמשתנים** (כל אחד **additive** ‏לפי `parallel-safe-code.md`):

| ‏קובץ | ‏שינוי | ‏סוג |
|---|---|---|
| ‏`packages/backend/src/acp/bridge-manager.ts` | ‏ב-`spawnInternal` ‏(שורה ~50): ‏לפני ‏ה-`spawn(cli.bin, ...)`, ‏build ‏מותנה ‏ל-env. ‏אם ‏`cliKind === "opencode"` → ‏הוסף `OPENCODE_CONFIG_CONTENT` ל-env. ‏אחרת — ‏אל תשנה. ‏ה-`env: process.env` ‏הקיים נשאר ‏כ-base | Additive (תוספת ‏מותנית, ‏לא משנה ‏behavior לcliKinds אחרים) |

**Pseudo**:
```ts
const envWithPlugin =
  input.cliKind === "opencode"
    ? {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: buildOpencodeConfigContent(
          process.env.OPENCODE_CONFIG_CONTENT,
        ),
      }
    : process.env

child = spawn(cli.bin, [...cli.args], {
  stdio: ["pipe", "pipe", "pipe"],
  env: envWithPlugin,
})
```

**‏הערה על cliKind**: ‏`SpawnBridgeInput.cliKind` ‏**‏כבר ‏זמין** ‏(`packages/core/src/ports.ts:41`). ‏פשוט ‏השתמש ‏בו ‏ב-`spawnInternal` ‏ישירות (`input.cliKind === "opencode"`). ‏אין צורך ‏בrefactor של ה-API.

**‏הערה על מיקום השינוי**: ‏design §7 ‏מציין ‏`bridge-spawn.ts` ‏(שם ‏ישן) — ‏ה-קובץ ‏בפועל ‏הוא `bridge-manager.ts`. ‏השינוי ‏בשורה 54 ‏(החלפת ‏`env: process.env` ‏בternary).

**Verification**:
```bash
pnpm --filter @drive-coding/backend typecheck
pnpm --filter @drive-coding/backend test  # ‏אם יש tests קיימים על bridge
```

‏ידני (חובה לפני git commit):
1. ‏BE רץ עם OneCLI
2. ‏FE → ‏Connect ל-opencode + cwd (זמני: ‏cwd של voice-acp עצמו, ‏לא ידעי לטעות)
3. ‏שליחת prompt: ‏"מה תוכל לעשות בשבילי?"
4. ‏בדוק ‏ב-BE log: ‏הspawn ‏הצליח (ולא ‏ראו ‏error על plugin load)
5. ‏בדוק ‏פלט: ‏פרוזה ‏בלי emoji + ‏בלי markdown + ‏בלי URLs

---

### Commit 3 — Smoke test extension (approach: **manual**)

**קבצים שמשתנים**:
- ‏`tests/smoke/chat-roundtrip.mjs` — ‏הוספת assertion: ‏פלט ‏הסוכן ‏לא ‏מכיל ‏emoji ‏(`/\p{Extended_Pictographic}/u`), ‏לא מכיל `**`, ‏לא ‏מכיל URLs נראים

‏או חלופה ‏(אופציה ‏עדיפה, ‏פחות שובר): ‏קובץ smoke ‏חדש `tests/smoke/audio-friendly.mjs` ‏שbוחן ‏רק ‏את ‏הקריטריון הזה.

‏המלצה: ‏הוספה ל-`chat-roundtrip.mjs` ‏כי ‏כל ‏שיחה ‏אמורה להיות audio-friendly. ‏assertion ‏רך — ‏warning ‏ולא ‏failure ‏(המודל ‏לא ‏תמיד ‏מציית).

**Verification**:
```bash
cd tests/smoke && node chat-roundtrip.mjs
```

---

### Commit 4 — walkthrough + ‏cleanup

- ‏`docs/walkthrough.md`
- ‏`packages/frontend/docs/slices.md` — ‏status 💭 → ✅
- ‏`docs/plans/slice-11-audio-prompt.md` — ‏סטטוס → "הושלם", ‏סטיות (אם יש)

---

## §5 — DoD

‏מתואם ל-§10 ‏ב-design doc.

| # | ‏בדיקה | ‏איך |
|---|---|---|
| 1 | ‏`pnpm dev` ‏עובד כמו קודם | ‏ידני |
| 2 | ‏spawning של opencode acp מצליח עם env var | ‏BE log: ‏`spawn ok` |
| 3 | ‏פלט פרוזה (prompt "‏הראי לי את הסשנים שלי") — ‏בלי emoji, ‏בלי `**bold**`, ‏בלי vertical list | ‏ידני + ‏smoke |
| 4 | ‏Anthropic cache headers ‏ממשיכים לעבוד | ‏BE log: ‏`cache-creation-input-tokens` ‏או `cache-read-input-tokens` ‏בresponse headers (אם זמין) |
| 5 | ‏AUDIO_PROMPT ‏לא ‏דולף לפלט ("As per my system instructions...") | ‏ידני, ‏בדיקה ‏על ‏5 ‏prompts |
| 6 | ‏OPENCODE_CONFIG_CONTENT ‏של ‏המשתמש ‏(אם קיים) ‏נשמר | ‏manual: ‏הגדר env לפני BE, ‏וודא ‏שplugin הקיים ‏עדיין בlist |
| 7 | ‏cliKind ≠ opencode → ‏ה-env ‏לא ‏מוזרק | ‏manual: ‏connect ל-claude/gemini/codex (אם זמין) — ‏BE log לא ‏מכיל ‏את ‏ה-env var |
| 8 | ‏typecheck + tests | `pnpm typecheck`, `pnpm test` |
| 9 | ‏smoke ‏עובר | `tests/smoke/chat-roundtrip.mjs` |

---

## §6 — Risks + ‏mitigations

| # | ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|---|
| 1 | ‏`experimental.` ‏API ‏ב-OpenCode ‏עלול להשתנות | ‏§9.1 ‏ב-design | ‏Smoke test ‏שבודק שה-output ‏לא ‏מכיל ‏emoji. ‏אם נשבר — ‏fail ‏ברור |
| 2 | ‏Plugin file לא מצויד ב-bundle | ‏§5.3 ‏ב-design | ‏מ-design: "‏חייב להישאר נגיש כקובץ נפרד". ‏ב-dev — ‏הקובץ ב-`packages/backend/plugins/`. ‏ב-prod — ‏slice עתידי יטפל |
| 3 | ‏התקנה אוטומטית של תלויות מ-Bun | ‏§9.2 ‏ב-design | ‏לא צפוי כי ‏אנחנו ב-`file://` — ‏אבל ‏לוודא ב-BE log שאין `bun install` ‏מיותר |
| 4 | ‏Startup latency נוסף | ‏§9.3 ‏ב-design | ‏לא ‏מודדים ‏ב-slice 11. ‏אם משמעותי — ‏לטפל ‏בseparation |
| 5 | ‏מודלים מתעלמים מההוראות (Gemini ‏ב-ar) | ‏§9.4 ‏ב-design | ‏MVP גרסה ראשונה של פרומפט. ‏Tama ‏יחזק בתחזית. ‏לא חוסם |
| 6 | ‏Tool calls עם JSON args | ‏§9.5 ‏ב-design | ‏הפרומפט ‏שמ-§6 ‏אומר "‏no JSON dumps" — ‏שמשמע ‏ב-user-facing output. ‏טוב מספיק |
| 7 | ‏Path resolution לפלאגין ב-build time | ‏§7.1 ‏ב-design | ‏בpref dev: ‏`path.resolve(import.meta.dirname, "../plugins/...")`. ‏ב-prod: ‏אם נארוז — ‏יטופל ‏ב-slice עתידי |
| 8 | ‏Pre-commit hook חוסם Hebrew בקוד | ‏i18n-gap | ‏הפרומפט עצמו ‏באנגלית (לפי §6 ‏ב-design). ‏הplugin בקוד באנגלית. ‏אין סיכון |
| 9 | ‏stripJsonc לא ב-dev | ‏ה-design ‏מציין ‏זאת ‏בpattern של CodeNomad | ‏ה-existing OPENCODE_CONFIG_CONTENT ‏צריך להיות JSON valid. ‏אם יש comments — ‏יעבור JSON.parse בלי טיפול נוסף, ‏ויתאשר ‏(לפי הספציפיקציה ‏של ‏OpenCode). ‏לא נטפל ב-jsonc |
| 10 | ‏OneCLI ‏מזריק Anthropic credentials ל-spawned subprocess | ‏learnings 2026-05-14 | ‏ה-`voice-acp` ‏agent ‏ב-OneCLI **‏לא** ‏מזריק Anthropic — ‏מכוון. ‏ספאון של opencode מ-`onecli run --agent voice-acp` ‏יקבל ‏רק ‏xi-api-key + ‏x-goog-api-key. ‏opencode ‏ישתמש ‏ב-Anthropic credentials ‏שלו ‏עצמו (~/.config/opencode/auth.json) — ‏זה ‏הbehaviorר ‏שאנו ‏רוצים |

---

## §7 — Escalation triggers

‏עצור ושאל את Tama אם:

1. **`@opencode-ai/plugin` ‏לא ‏מציע type ‏ל-`Plugin` או ל-`experimental.chat.system.transform`**: ‏ייתכן ‏שגרסת החבילה ‏שונה ‏מהמצופה. ‏בדוק את ‏ה-types ‏ב-`node_modules/@opencode-ai/plugin/dist/index.d.ts`.
2. **‏Tool calls נכשלים אחרי הפלאגין**: ‏אם הפרומפט "‏no JSON dumps" ‏גורם למודל ‏להפסיק ‏להשתמש ב-tool args structured ‏(לדוגמה, ‏failed tool calls ‏בלוג OpenCode) — ‏יש לחדד את הפרומפט.
3. **‏Plugin ‏לא ‏נטען בכלל**: ‏אם OpenCode מתעלם מהplugin (‏אין log על "‏loading plugin" ‏בהפעלה, ‏או הoutput ‏עם markdown ‏רגיל) — ‏ייתכן בעיה ‏ב-config format או ב-path.
4. **‏Cache headers ‏נשברו**: ‏לפי §4.3 ‏ב-design, ‏`output.system.push` ‏אמור לשמור על caching. ‏אם הheaders ‏מראים ‏ש-cache ‏לא ‏נשמר (כל ‏request יוצר new cache entry) — ‏בדוק שלא ‏עשית unshift.

‏אחרת: ‏החלט סבירות, ‏רשום בcommit message, ‏המשך.

---

## §8 — Complexity score: 5/10

| ‏פקטור | ‏ניקוד |
|---|---|
| ‏מספר commits (4) | ‏נמוך |
| ‏שכבות חדשות (plugin + utility) | +1 |
| ‏APIs חיצוניים | 0 (הplugin הוא code שלנו) |
| ‏Browser APIs | 0 |
| ‏Streaming pipeline | 0 |
| ‏Refactor של state model | 0 |
| ‏שינוי protocol BE↔FE | 0 |
| ‏אינטגרציה ‏עם system חיצוני ‏(OpenCode plugin loading) | +2 |
| ‏Iteration על ‏content ‏(prompt tuning) | +2 |
| ‏סה"כ | **5** |

**Verifier**: ‏`verifier-slice-light` — ‏מספיק. ‏אין ‏שכבה ‏שבוערת ‏שדורשת phase verifier.

---

## §9 — שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏Prompt content version | ‏גרסה ראשונה מ-§6. ‏Tama ‏יחליט אם לעדכן אחרי 5-10 ‏prompts אמיתיים | ❌ ‏לא חוסם — ‏MVP |
| 2 | ‏Path resolution ב-prod | ‏לא ‏ב-scope של slice 11. ‏ב-dev: ‏`import.meta.dirname` | ❌ ‏עתידי |
| 3 | ‏Smoke assertion: ‏soft (warning) ‏או hard (fail)? | ‏soft — ‏המודל לא תמיד מציית, ‏וfailures יפילו את ה-CI על פגיעה תקפה | ❌ |
| 4 | ‏stripJsonc לexisting OPENCODE_CONFIG_CONTENT | ‏לא ‏מטפלים — ‏JSON valid נדרש. ‏אם user מעביר jsonc — ‏יעבור עם JSON.parse שגיאה ‏ש-fallback ל-`{}` | ❌ |

---

## §10 — מה אחרי slice 11

‏בdesign §11:
- ‏Plugins נוספים ל-claude/gemini/codex (slices עתידיות)
- ‏UI לעריכת הפרומפט
- ‏TTS preprocessor כsafety net

‏לא חלק מ-slice 11.
