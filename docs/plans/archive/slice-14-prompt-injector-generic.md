# Slice 14 — Generic Prompt Injector Plugin — תוכנית

> **תאריך**: 2026-05-29
> **סטטוס**: ‏הושלם ✅ (worktree `slice-14-prompt-injector`, 3 commits, smoke passed)
> **Complexity**: 4/10 (verifier: light)
> **תלות**: ‏slice 11 ✅ (audio-friendly plugin ‏קיים — ‏זה ‏refactor + ‏הכללה ‏שלו)
> **מתבסס על**: ‏`docs/plans/README.md`, ‏`docs/plans/EXECUTOR_DISPATCH.md`, ‏`docs/audio-friendly-prompt-plan.md` (design ‏מקורי)

---

## §0 — Pre-flight

‏לפי `docs/plans/EXECUTOR_DISPATCH.md` — ‏worktree, ‏ports, ‏OneCLI, ‏verifier, ‏escalation. ‏מצוין ‏כאן ‏רק ‏הספציפי ‏ל-slice:

- ‏Worktree: ‏`.worktrees/slice-14-prompt-injector`
- ‏Port: ‏4000 ‏אם ‏פנוי, ‏אחרת ‏4001+
- ‏BE-only ‏slice — ‏FE רק ‏לבדיקת DoD ‏בסוף

### Reading list

**must-read** (~‎15 ‏דקות):

1. ‏`packages/backend/plugins/audio-friendly.ts` — ‏ה-plugin ‏הנוכחי ‏(50 ‏שורות, ‏ספציפי) ‏שעובר ‏refactor
2. ‏`packages/backend/src/plugin-config.ts` — ‏ה-config builder ‏שהbridge-manager משתמש בו
3. ‏`packages/backend/src/acp/bridge-manager.ts` — ‏שורות 50-60, ‏ה-spawn ‏עם env
4. ‏`docs/audio-friendly-prompt-plan.md` §4-§7 — ‏ה-design ‏של slice 11 ‏(plugin loading mechanism)
5. ‏`docs/plans/EXECUTOR_DISPATCH.md` — ‏convention משותפת

**reference**:

- ‏סשן ‏ses_18c390ebdffeA9mzRfj8jdVkTY (chat history) — ‏אישור ‏שmaybe ‏ה-pattern עם `options` ‏שונה ממה ‏ש-slice 11 ‏עשה. **‏חובה ‏לוודא ‏ב-`@opencode-ai/plugin` types** ‏לפני ‏implementation.

---

## §1 — מטרה

‏הפלאגין ‏הנוכחי ‏ב-`audio-friendly.ts` ‏מכיל ‏את ‏טקסט ‏הפרומפט ‏hardcoded. ‏זה ‏אומר:
- ‏כל ‏שינוי ‏בtext ‏דורש ‏edit ‏לקוד ‏הפלאגין + ‏rebuild + ‏restart
- ‏אי ‏אפשר ‏לטעון ‏את ‏אותו ‏פלאגין ‏עם prompts ‏שונים ‏לתסריטים ‏שונים ‏(לדוגמה: ‏voice + ‏coding + ‏tutoring)
- ‏אי ‏אפשר ‏לעדכן ‏prompts ‏ב-runtime ‏בלי ‏רעיון rebuild

**‏אחרי slice 14**: ‏פלאגין ‏generic ‏בשם `prompt-injector` ‏שמקבל ‏את ‏טקסט ‏הprompt ‏דרך ‏plugin options. ‏voice-acp BE ‏מעביר ‏את ‏הטקסט ‏(כרגע: ‏audio-friendly) ‏בעת ‏ה-spawn. ‏ה-architecture ‏פותח דלת ‏לprompts ‏מרובים ‏בעתיד (slice 9 ‏Settings ‏יוכל ‏לתת ‏picker, ‏או slice ‏עתידי ‏עם ‏פרופילים ‏מרובים).

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ‏Generic prompt-injector ‏plugin (text via options) | ✅ | ‏commit 1 |
| ‏BE ‏מעביר ‏prompt text דרך plugin options ‏בעת spawn | ✅ | ‏commit 2 |
| ‏רנimuname `audio-friendly.ts` → `prompt-injector.ts` | ✅ | ‏commit 1 |
| ‏טקסט audio-friendly ‏עובר ל-BE constants (לא ‏בplugin) | ✅ | ‏commit 2 |
| ‏Behavior parity ‏עם slice 11 — ‏אותו prompt, ‏אותו ‏upstream behavior | ✅ | ‏DoD |
| ‏UI לבחירת prompt | ❌ | ‏future (slice 9 ‏extension) |
| ‏פרופילים ‏מרובים ‏(audio/coding/tutoring) | ❌ | ‏future. ‏MVP: ‏רק audio-friendly |
| ‏Loading prompts מ-DB / ‏file ‏חיצוני | ❌ | ‏future. ‏MVP: ‏constants ‏ב-BE |
| ‏התאמה ‏ל-CLIs ‏אחרים ‏(Claude, ‏Gemini, ‏Codex) | ❌ | ‏future slices ‏לפי ‏slice 11 §8 |
| ‏שינוי בUI ‏או FE | ❌ | ‏BE-only |

---

## §3 — Architecture

```
‏לפני (slice 11):
  packages/backend/plugins/audio-friendly.ts
    ├─ AUDIO_PROMPT constant (50 שורות טקסט inline)
    └─ exports plugin: () => ({transform: push(AUDIO_PROMPT)})

  packages/backend/src/plugin-config.ts
    └─ JSON config: { plugin: ["file://path/audio-friendly.ts"] }

‏אחרי (slice 14):
  packages/backend/plugins/prompt-injector.ts (renamed + generic)
    └─ exports plugin module שמקבל options.text
       └─ transform: push(options.text) — ‏no hardcoded prompt

  packages/backend/src/prompts/audio-friendly.ts (חדש)
    └─ export const AUDIO_FRIENDLY_PROMPT = `...`

  packages/backend/src/plugin-config.ts
    └─ JSON config: { plugin: [["file://path/prompt-injector.ts", { text: AUDIO_FRIENDLY_PROMPT }]] }
```

‏העיקרון: ‏הפלאגין ‏הופך "‏מנגנון", ‏הטקסט ‏הופך "‏נתון" — ‏הפרדה ‏ברורה. ‏BE controls ‏איזה ‏טקסט ‏בכל ‏spawn.

---

## §4 — Commits

### Commit 1 — Generic prompt-injector plugin (approach: **manual**)

‏רenaming + refactor.

**‏API אומת ‏מראש** (לא ‏דורש ‏commit ‏נפרד): ‏ה-`@opencode-ai/plugin@1.15.12` (גרסה ‏המותקנת ‏ב-`packages/backend/devDependencies`) ‏יציא ‏את ‏הtypes ‏הבאים ‏ב-`dist/index.d.ts:47-56`:

```ts
export type PluginOptions = Record<string, unknown>;
export type Config = Omit<SDKConfig, "plugin"> & {
  plugin?: Array<string | [string, PluginOptions]>;
};
export type Plugin = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>;
export type PluginModule = {
  id?: string;
  server: Plugin;
  tui?: never;
};
```

‏המשמעות: ‏אפשר ‏לכתוב ‏plugin ‏עם `PluginModule` (מומלץ — ‏ה-id ‏עוזר ‏לזיהוי) ‏או ‏עם ‏`Plugin` ‏פשוט. ‏ה-options ‏אופציונליים ‏בשני ‏הpatterns. ‏הconfig ‏מקבל ‏tuple `[url, options]`.

**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
| ‏`packages/backend/plugins/audio-friendly.ts` | ‏**‏מחק** |
| ‏`packages/backend/plugins/prompt-injector.ts` | ‏**‏חדש** — ‏generic plugin שמקבל options.text |
| ‏`packages/backend/plugins/README.md` | ‏עדכן ‏הוראות ‏(שם ‏הplugin + ‏מה ‏הplugin ‏עושה) |

**API skeleton** (לפי ‏ה-pattern ‏ש-sonnet ‏מצא — ‏אם commit 0 ‏אישר):

```ts
import type { Hooks, PluginInput, PluginModule } from "@opencode-ai/plugin"

const plugin: PluginModule = {
  id: "prompt-injector",
  async server(_input: PluginInput, options?: Record<string, unknown>): Promise<Hooks> {
    const text = typeof options?.text === "string" ? options.text : ""
    return {
      "experimental.chat.system.transform": async (_input, output) => {
        if (text.length > 0) output.system.push(text)
      },
    }
  },
}

export default plugin
```

**‏אם** commit 0 ‏גילה ‏שה-API ‏הוא ‏הsimple ‏של slice 11 ‏(`() => Hooks`, ‏בלי options) — ‏Escalate ‏ל-Tama. ‏הלוגיקה ‏של slice 14 ‏מבוססת ‏על ‏options.

**Verification**:
```bash
pnpm --filter @drive-coding/backend typecheck
```

‏אין consumer ‏עדיין — ‏רק typecheck.

---

### Commit 2 — BE wires the prompt text (approach: **manual**)

**קבצים ‏חדשים**:
- ‏`packages/backend/src/prompts/` — ‏תיקייה ‏חדשה
- ‏`packages/backend/src/prompts/audio-friendly.ts` — ‏copy literal ‏של ‏ה-AUDIO_PROMPT ‏שהיה ‏בaudio-friendly.ts. ‏exports: ‏`export const AUDIO_FRIENDLY_PROMPT = "..."`
- ‏`packages/backend/src/prompts/index.ts` — ‏re-export, ‏הכנה ל-prompts ‏עתידיים

**קבצים שמשתנים** (additive):

| ‏קובץ | ‏שינוי |
|---|---|
| ‏`packages/backend/src/plugin-config.ts` | ‏עדכן ‏ה-config builder — ‏ה-`plugin` ‏רשומה ‏עכשיו ‏בפורמט ‏`[["file://...", { text: AUDIO_FRIENDLY_PROMPT }]]` ‏במקום ‏`["file://..."]`. ‏גם: ‏imports ‏ל-`AUDIO_FRIENDLY_PROMPT`. ‏גם: ‏שינוי ‏`pluginUrl` ‏מ-`audio-friendly.ts` ‏ל-`prompt-injector.ts` |
| ‏`packages/backend/src/acp/bridge-manager.ts` | ‏אין ‏שינוי (call ל-`buildOpencodeConfigContent(...)` ‏נשאר) |

**Pseudo** ל-plugin-config.ts:

```ts
import { AUDIO_FRIENDLY_PROMPT } from "../prompts/index.js"

type PluginEntry = string | [string, Record<string, unknown>]

export function buildOpencodeConfigContent(existing: string | undefined): string {
  const pluginPath = path.resolve(import.meta.dirname, "../plugins/prompt-injector.ts")
  const pluginUrl = pathToFileURL(pluginPath).href

  const config = existing?.trim()
    ? (JSON.parse(existing) as Record<string, unknown>)
    : {}

  // ‏plugin ‏שדה ‏יכול ‏להיות: ‏Array<PluginEntry>, ‏string ‏(plugin יחיד), ‏או missing
  let existingPlugins: PluginEntry[] = []
  if (Array.isArray(config.plugin)) {
    existingPlugins = [...(config.plugin as PluginEntry[])]
  } else if (typeof config.plugin === "string") {
    existingPlugins = [config.plugin]
  }

  // ‏plugin entry שלנו ‏(tuple ‏עם options)
  const ourEntry: PluginEntry = [pluginUrl, { text: AUDIO_FRIENDLY_PROMPT }]

  // Dedup לפי ה-URL (entry יכול להיות string או [string, options])
  const filtered = existingPlugins.filter((p) =>
    Array.isArray(p) ? p[0] !== pluginUrl : p !== pluginUrl,
  )
  filtered.push(ourEntry)

  return JSON.stringify({
    ...config,
    $schema: (config.$schema as string | undefined) ?? "https://opencode.ai/config.json",
    plugin: filtered,
  })
}
```

**‏Notes**:
- ‏ה-`string` ‏branch ‏חיוני: ‏OpenCode ‏מאפשר ‏`plugin: "single-name"` ‏במקום ‏array. ‏המקור (slice 11) ‏טיפל ‏בזה. ‏אסור ‏להפיל ‏את ‏זה ב-refactor.
- ‏ה-`as string | undefined` cast ‏ל-`$schema` ‏נדרש ‏ב-strict mode ‏(`unknown` ‏לא ‏satisfies bare `??`).
- ‏ב-spread `...config` ‏מופיע ‏לפני ‏ה-overrides — ‏ה-overrides ‏לקרבל ‏(זהה ‏ל-pattern ‏המקורי).

**Verification**:
```bash
pnpm --filter @drive-coding/backend typecheck
pnpm test
pnpm lint:i18n
```

---

### Commit 3 — Smoke + walkthrough

**קבצים ‏שמשתנים**:
- ‏`tests/smoke/chat-roundtrip.mjs` — ‏ה-3 ‏soft assertions ‏הקיימות מ-slice 11 ‏(אין emoji, ‏אין **bold**, ‏אין URLs) ‏אמורות ‏לעבור ‏אותו ‏דבר. ‏ודא ‏שעדיין ‏עוברות.
- ‏`docs/walkthrough.md` — ‏רשומה חדשה
- ‏`packages/frontend/docs/slices.md` — ‏עדכון: ‏slice 14 ‏הוסף, ‏status ✅
- ‏`docs/plans/slice-14-prompt-injector-generic.md` (זה) — ‏סטטוס → "‏הושלם"

‏(‏לא ‏מוסיף smoke ‏חדש — ‏ה-behavior ‏אמור ‏להיות ‏זהה ל-slice 11. ‏ה-smoke ‏הקיים ‏מאמת.)

---

## §5 — DoD

| # | ‏בדיקה | ‏איך |
|---|---|---|
| 1 | ‏typecheck + build | `pnpm typecheck`, ‏`pnpm --filter backend build` |
| 2 | ‏tests ‏עוברים | `pnpm test` (356 → ‏לא ‏יותר מ-1 ‏שינוי) |
| 3 | ‏lint:i18n | `pnpm lint:i18n` |
| 4 | ‏Smoke ‏עוברת | `cd tests/smoke && node chat-roundtrip.mjs` |
| 5 | ‏Behavior parity: ‏שלוח ‏prompt ‏ל-opencode, ‏וודא ‏פלט ‏פרוזה ‏(זהה ל-slice 11) | ‏ידני |
| 6 | ‏BE log: ‏ה-spawn ‏עובד, ‏ה-plugin ‏נטען (אין ‏log על "‏plugin failed to load") | ‏BE log |
| 7 | ‏`packages/backend/plugins/audio-friendly.ts` ‏נמחק (אין residue) | `find ... -name "audio-friendly*"` |
| 8 | ‏Existing user OPENCODE_CONFIG_CONTENT (`plugin: [...]`, ‏array) ‏נשמר (לא ‏דורס) | ‏manual: ‏export `OPENCODE_CONFIG_CONTENT='{"plugin":["other-plugin"]}'` ‏בrun + ‏בדוק שה-config ‏ה-merged ‏מכיל ‏את ‏שניהם |
| 8b | ‏Existing user config ‏עם **string plugin** ‏(`plugin: "single-name"`) ‏נשמר | ‏manual ‏או ‏unit test: ‏`buildOpencodeConfigContent('{"plugin":"single-name"}')` ‏מחזיר ‏config ‏עם `plugin: ["single-name", [pluginUrl, {text:...}]]` |

---

## §6 — Risks + ‏mitigations

| # | ‏סיכון | ‏מיטיגציה |
|---|---|---|
| 1 | ‏ה-`@opencode-ai/plugin` ‏הגרסה ‏המותקנת ‏לא ‏תומך ‏ב-`PluginModule` + ‏options | ‏commit 0 ‏מאמת ‏לפני ‏כל ‏שינוי. ‏אם ‏לא נתמך — ‏Escalate |
| 2 | ‏ה-id field ‏ב-`PluginModule` ‏לא קיים בגרסה הזו | ‏commit 0 ‏יראה. ‏fallback: ‏plugin בלי id |
| 3 | ‏Config format ‏עם options ‏שונה ‏ממה ‏שsonnet ‏הציג | ‏commit 0 ‏מאמת. ‏ה-OpenCode source יכול ‏לאמת: ‏`packages/opencode/src/config/config.ts` |
| 4 | ‏Cache headers ‏של Anthropic נשברים ‏(שינוי ב-system prompt structure) | ‏לא נוגעים ‏ב-push order — ‏`output.system.push` ‏אותו ‏דבר. ‏בכל מקרה ‏מאומת ‏ב-BE log |
| 5 | ‏Existing user plugin conflict | ‏plugin-config.ts ‏ממזג ‏(לפי slice 11), ‏לא דורס. ‏Dedup לפי URL |
| 6 | ‏Hebrew strings ‏בקוד | ‏הplugin נשאר ‏באנגלית. ‏הprompt נשאר ‏באנגלית. ‏אין ‏סיכון |
| 7 | ‏ה-smoke ‏soft assertions ‏ייכשלו (regression) | ‏אם ‏ה-prompt text זהה — ‏אותו ‏behavior. ‏אם ‏executor ‏שינה ‏את ‏הטקסט בטעות — ‏fix |
| 8 | ‏Path resolution ‏ל-prompt-injector.ts | ‏אותו ‏מנגנון של slice 11 — ‏`import.meta.dirname` + ‏`../plugins/prompt-injector.ts`. ‏אם slice 11 ‏עבד, ‏זה ‏יעבוד |

---

## §7 — Escalation triggers

‏עצור ‏ושאל את Tama אם:

1. **‏commit 0 ‏גילה ‏API ‏שונה ‏ממה ‏שמוצב ‏ב-brief**. ‏המבנה ‏של ‏plugin עם options ‏הוא ‏תלוי-גרסה — ‏אם ‏הוא ‏שונה, ‏הbrief ‏צריך ‏עדכון.
2. **‏ה-`@opencode-ai/plugin` ‏לא ‏תומך ‏ב-options ‏בכלל**. ‏אז ‏ה-architecture ‏צריך alternative (e.g. ‏env var ‏שהפלאגין קורא, ‏או ‏generic plugin עם ‏hardcoded text ‏שמוחלף ‏באמצעות ‏string replace).
3. **‏smoke ‏fails ‏אחרי ‏refactor** ‏עם ‏פלט markdown/emoji — ‏סימן ‏ש-prompt ‏לא ‏מועבר ‏נכון, ‏או ‏ה-merging ב-plugin-config ‏שגוי.
4. **‏Cache headers נשברו** (אם בודקים) — ‏סימן ‏ש-system structure ‏השתנה ‏באופן ‏שדורש ‏investigation.

‏אחרת: ‏החלט סבירות, ‏רשום בcommit message, ‏המשך.

---

## §8 — Complexity score: 4/10

| ‏פקטור | ‏ניקוד |
|---|---|
| ‏מספר commits (3) | ‏נמוך |
| ‏שכבות חדשות (prompts/ ‏folder) | +1 |
| ‏Refactor של state model | 0 |
| ‏API ‏חיצוני | 0 |
| ‏Refactor + ‏API change ‏ב-plugin | +2 (חוסר ‏ודאות ‏על ‏ה-API גרסה) |
| ‏Behavior parity required (regression risk) | +1 |
| ‏סה"כ | **4** |

**Verifier**: ‏`verifier-slice-light` ‏בלבד.

---

## §9 — שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏שם הplugin: ‏`prompt-injector` ‏או ‏אחר? | `prompt-injector` (generic, ‏ברור) | ❌ |
| 2 | ‏מיקום הprompts: ‏`src/prompts/` ‏או ‏`prompts/` ‏ב-root של backend? | ‏`src/prompts/` (כי ‏זה ‏קוד TypeScript) | ❌ |
| 3 | ‏index.ts ‏ב-prompts/ ‏צריך re-export או ‏רק ‏לעתיד? | ‏re-export ‏(הכנה ‏לpicker) | ❌ |
| 4 | ‏לdocument ‏ב-`docs/audio-friendly-prompt-plan.md` ‏שהפלאגין ‏עבר refactor? | ‏כן — ‏הוסף הערה ‏בראש ‏המסמך | ❌ |

---

## §10 — מה אחרי slice 14

‏הplumbing ‏מוכן ‏ל:
- ‏slice עתידי: ‏Settings page (slice 9 ‏extension) — ‏picker ‏לפרופיל prompt
- ‏slice עתידי: ‏פרופילים ‏מרובים (audio / coding / tutoring) — ‏הוספת קבצים ב-`prompts/`
- ‏slice עתידי: ‏per-session prompt override (דורש ‏שינוי ‏ב-bridge-manager לקבל ‏prompt name פר agent spawn)
- ‏Future ‏בלתי ‏נדחה: ‏התאמה ‏ל-CLIs ‏אחרים (Claude, ‏Gemini, ‏Codex) — ‏לא ‏פלאגין ‏ל-opencode, ‏אלא ‏מנגנון ‏מקביל ‏לכל ‏CLI ‏(לפי slice 11 §8)
