# חקירה — הרצת drive-coding ב-Termux/Android: codex ו-claude לא מתחברים

> **תאריך**: 2026-07-01 · **כותב**: מרדכי (לבקשת המשתמשת — "מנסה להריץ בטרמוקס")
> **סטטוס**: שורש מאומת · **פתרון עוקף מאומת מקצה-לקצה** (config בלבד, ללא שינוי קוד)
> **סביבה**: Termux על Android (aarch64/bionic), Node 26.3.1, Bun 1.3.14, pnpm
> **רלוונטי ל**: Track F — Infrastructure & Packaging (תמיכת-פלטפורמה חדשה)

## TL;DR

‏drive-coding רץ ב-Termux אחרי `pnpm install` (על f2fs — **לא** על shared-storage, שאין בו symlinks),
אבל **שני ה-CLIs נכשלים בהתחברות**, כל אחד משורש שונה:

- **‏codex** — קורס מיד (`bridge crashed`, exit 1). **שתי תקלות מצטברות**: (א) `spawn("npx")`
  בשם-בלבד נשבר ב-Termux; (ב) ה-bridge הדיפולטי `@zed-industries/codex-acp` לא תומך ב-android.
- **‏claude** — עולה ל-`starting` אך נכשל ב-`session/new`: ה-SDK מחפש בינארי-native ל-`linux-arm64`
  שלא קיים ב-Termux.

**‏הפתרון** (config בלבד, ללא נגיעה בקוד; מאומת ב-WS handshake מלא לשני ה-CLIs):
- **‏codex** → `~/.config/drive-coding/cli-specs.jsonc` (override: `bin` נתיב-מלא ל-npx + bridge מתוחזק + `CODEX_PATH`).
- **‏claude** → `.env` בשורש: `CLAUDE_CODE_EXECUTABLE` המצביע על ה-claude CLI של Termux.

## איך נאספו הנתונים (שיטת-האבחון)

‏ה-`stderr` של ה-bridge-children **לא מופיע בלוג של ה-BE** — `spawn-core` אוסף אותו פנימית
(`stderrLines`, `getStderr()`) ומשתמש בו רק ל-`describeCrash`; ה-`crashReason` הגולמי שמגיע ל-orchestrator
הוא רק `"Exited with code 1"`. לכן ה-stderr האמיתי חולץ ע"י **שחזור ה-spawn בדיוק כמו ה-BE**:
טעינת `getCliCommand`+`getCliSpec` (אותו resolution), בניית `childEnv` זהה, `child_process.spawn` עם
`stdio:["pipe","pipe","pipe"]`, והדפסת ה-stderr המלא ב-exit. בלי זה הקריסה הייתה אטומה.

‏האימות הסופי נעשה ב-**instance טרי** (`PORT` נפרד) + **WS client** מינימלי שמדמה את ה-FE כ-ACP-client
(`/ws/agent/:id` → pipe ישיר ל-stdin/stdout של ה-bridge), ושולח `initialize` ואז `session/new`.

---

## שורש #1 — codex

### ‏1א. `spawn("npx")` בשם-בלבד נשבר ב-Termux

‏ה-stderr הגולמי של ה-child:

```
Error: Cannot find module '/data/data/com.termux/files/home/projects/drive-coding/npx'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1519:15)
    ...
Node.js v26.3.1
```

**‏המנגנון**: ב-Termux `npx` הוא symlink → `../lib/node_modules/npm/bin/npx-cli.js`, עם shebang
`#!/data/data/com.termux/files/usr/bin/env node`. כש-`spawn-core` מריץ `spawn("npx", args)`
(`packages/provider/src/shared/spawn-core.ts:107`) **בלי shell ועם שם-בלבד**, מנגנון ה-shebang
מעביר ל-node את `argv[0]="npx"` (יחסי), ו-node מנסה לטעון `"npx"` כמודול מתוך ה-`cwd` (תיקיית הפרויקט)
→ `MODULE_NOT_FOUND`.

**‏למה זה לא נתפס ב-Linux/Windows**: מ-shell, ה-shell פותר את `npx` לנתיב-מלא לפני ההרצה, אז
`argv[0]` הוא הנתיב המלא וה-require הפנימי נפתר נכון. גם הרצה ידנית (`npx ...` מ-zsh) עובדת —
**ההבדל היחיד הוא spawn-ישיר מול shell**. זו הסיבה שהבאג חבוי: בפלטפורמות הנתמכות הרשמיות `spawn("npx")` עובד.

‏**אימות הפתרון**: `spawn("/data/data/com.termux/files/usr/bin/npx", args)` — נתיב מלא — מריץ את ה-bridge
תקין (תגובת `initialize` מלאה).

### ‏1ב. ה-bridge הדיפולטי לא תומך ב-android

‏ב-`packages/core/src/schemas/agent.ts:38-42` מוגדר:

```ts
codex: {
  bin: "npx",
  args: ["-y", "@zed-industries/codex-acp@latest"],
  supportsModelFlag: true,
},
```

‏שני דברים:
- **‏`@zed-industries/codex-acp`** מודפס `npm warn deprecated ... replaced by @agentclientprotocol/codex-acp`,
  ובהרצה נופל מיד על `Unsupported platform: android`.
- **‏הגרסה המתוחזקת** `@agentclientprotocol/codex-acp` עובדת ברמת-ACP, אבל כברירת-מחדל מנסה להריץ את
  codex **הרשמי** של OpenAI (`@openai/codex`), שמחפש בינארי `@openai/codex-linux-arm64` (glibc) שלא
  רץ ב-Termux (bionic):
  ```
  Error: Missing optional dependency @openai/codex-linux-arm64. Reinstall Codex: npm install -g @openai/codex@latest
  ```
  ‏ה-bridge החדש מכבד `CODEX_PATH` (`dist/index.js`: `const codexPath = process.env["CODEX_PATH"] ?? "codex"`
  → `spawn(codexPath, ["app-server"])`), ולכן הפניה ל-codex המקומי של Termux (`@mmmbuto/codex-cli-termux`,
  מותקן ב-`/data/data/com.termux/files/usr/bin/codex`) פותרת זאת. אומת: `initialize` → תקין (Codex 1.0.2).

---

## שורש #2 — claude

‏claude **לא** עובר spawn — הוא רץ **in-process** (`packages/provider/src/connection/connect-in-process.ts:20`,
`import { ClaudeAcpAgent } from "@agentclientprotocol/claude-agent-acp"`), בתוך אותו תהליך כמו ה-BE.
לכן הוא לא קורס כמו codex אלא נשאר `starting` עד ה-handshake, ונכשל רק ב-`session/new`:

```
session/new ERROR: {"code":-32603,"message":"Internal error","data":{"details":
"Claude native binary not found for linux-arm64. Reinstall @anthropic-ai/claude-agent-sdk
without --omit=optional, or set CLAUDE_CODE_EXECUTABLE."}}
```

**‏המנגנון** (מתוך `@agentclientprotocol/claude-agent-acp@0.52.0/dist/acp-agent.js`):
- `claudeCliPath()` (שורות 50–86): מחזיר `process.env.CLAUDE_CODE_EXECUTABLE` אם קיים; אחרת מנסה
  `require.resolve("@anthropic-ai/claude-agent-sdk-linux-<arch>[-musl]/claude")`. ב-Termux `process.platform="linux"`,
  `arch="arm64"` — והחבילה האופציונלית הזו לא קיימת/לא הותקנה (וגם אם כן, הבינארי glibc/musl לא תואם bionic).
- ‏בבניית ה-options ל-SDK `query` (שורה 2445): `pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE ?? (await claudeCliPath())`.

**‏הפתרון**: `CLAUDE_CODE_EXECUTABLE=/data/data/com.termux/files/usr/bin/claude` (ה-claude CLI של Termux —
bash script שמריץ את גרסת claude-code המקומית). אומת: `session/new` → `sessionId` תקין.

---

## ממצא נוסף — האם אפשר להעביר נתיב-בינארי לאדפטר claude דרך ה-API?

**‏לא. רק דרך `process.env.CLAUDE_CODE_EXECUTABLE`.** למרות שה-SDK עצמו (`@anthropic-ai/claude-agent-sdk`)
מקבל option `pathToClaudeCodeExecutable`, **האדפטר לא חושף אותו דרך פרוטוקול ה-ACP**:

‏ב-`acp-agent.js:2445` הערך נקבע מ-env בלבד, **והשורה הזו יושבת אחרי** ה-spread `...userProvidedOptions`
(שמקורו ב-`params._meta.claudeCode.options` של `session/new`). לכן גם אם FE ישלח
`_meta.claudeCode.options.pathToClaudeCodeExecutable`, השורה דורסת אותו — **אין pass-through**.

‏מסקנה ל-drive-coding: `.env`/env-var הוא הדרך היחידה (בלי fork לאדפטר). זה **לא** ניתן להגדרה דרך
`cli-specs.jsonc` — גם כי claude in-process מתעלם מ-`bin/args/setEnv`, וגם כי ברמת-הפרוטוקול האדפטר מתעלם מהנתיב.

---

## הפתרון המאומת (config בלבד)

### ‏1. `~/.config/drive-coding/cli-specs.jsonc` (codex)

```jsonc
{
  "codex": {
    "bin": "/data/data/com.termux/files/usr/bin/npx",
    "args": ["-y", "@agentclientprotocol/codex-acp@latest"],
    "setEnv": { "CODEX_PATH": "/data/data/com.termux/files/usr/bin/codex" }
  }
}
```

‏מנגנון ה-override: `cli-config-file.ts` (נטען מ-`CLI_SPECS_FILE` env או `~/.config/drive-coding/cli-specs.jsonc`),
ממוזג ב-`cli-config.ts`. ה-`bin` override גובר על הכל (`cli-config.ts:63-65`); ה-`setEnv` מיושם ב-spawn
(`spawn-core.ts:92-100`, `Object.assign(baseEnv, spec.setEnv)`). **חל רק על CLIs מבוססי-spawn** (codex/opencode/gemini/qoder).

### ‏2. `.env` בשורש הפרויקט (claude)

```
CLAUDE_CODE_EXECUTABLE=/data/data/com.termux/files/usr/bin/claude
```

‏bun טוען `.env` אוטומטית (וגם יש `--env-file` ב-bin). מכיוון ש-claude רץ in-process, האדפטר קורא את
`process.env` של ה-BE — לכן `.env` שנטען בעלייה מספיק. `.env` הוא gitignored (לא נכנס ל-git).

> **‏שים לב — restart**: `loadCliSpecsOverride` הוא memoized (פר-תהליך), ו-`.env` נטען בעלייה.
> אחרי שינוי שני הקבצים → **חובה `pnpm start` מחדש**.

## אימות מקצה-לקצה

‏על instance טרי, דרך WS handshake מלא (`initialize` → `session/new`), בלי שום env inline (רק הקבצים לעיל):

```
[claude] session/new OK sessionId=247ca59a-9914-4f49-853a-329a51714b91
[codex]  session/new OK sessionId=019f1a67-c5ed-7bc1-a5f0-27b807aa592b
```

---

## המלצות לתיקוני-קוד (אם רוצים תמיכת-Termux "מהקופסה")

‏מדורג לפי ערך. **אף אחד לא חובה** למכשיר הנוכחי — ה-config לעיל מספיק.

1. **‏[כללי, מומלץ] עדכון ה-codex bridge הדיפולטי** — `agent.ts:40`: `@zed-industries/codex-acp` → `@agentclientprotocol/codex-acp`.
   מתקן deprecation **לכל הפלטפורמות**, ומסיר את כשל-ה-android. ⚠️ לבדו לא מספיק ל-Termux (עדיין צריך `CODEX_PATH`).

2. **‏[Termux] resolution של `bin` לנתיב-מלא לפני spawn** — `spawn-core.ts:107`. הוא השורש האמיתי של 1א.
   לפתור `cli.bin` ל-absolute path (PATH lookup, כמו `which`) לפני `spawn` — מתקן את codex **וכל** CLI מבוסס-npx
   ב-Termux, בלי `cli-specs.jsonc`. (חלופה: `shell:true` — פחות מומלץ, escaping/security.)

3. **‏[עקביות] החלת `setEnv` של ה-spec גם על claude in-process** — `connect-in-process.ts`: לקרוא
   `getCliSpec("claude").setEnv` ולהחיל על `process.env` לפני יצירת `ClaudeAcpAgent`. יאפשר להגדיר את
   `CLAUDE_CODE_EXECUTABLE` דרך `cli-specs.jsonc` כמו כל CLI. **חיסרון**: מוטציה גלובלית של `process.env` —
   `.env` נקי יותר ממילא.

> **‏הערה ל-1+2**: גם אחרי תיקון 1, ה-bridge החדש מוריד את `@openai/codex` הרשמי (glibc) אם `CODEX_PATH`
> לא מוגדר — אז ל-Termux עדיין צריך להפנות ל-codex המקומי. כלומר תמיכת-Termux מלאה "מהקופסה" דורשת
> גם default-bridge מתוחזק, גם bin-resolution, וגם זיהוי-codex-מקומי (או הישארות עם ה-config הידני).

## נספח — נתיבים ופקודות

- **‏מכשיר**: `ssh myphone -o ProxyCommand=None -p 8022 -o Hostname=<ip>`
- **‏פרויקט בטלפון**: `~/projects/drive-coding` (f2fs; **לא** `~/storage/shared/...` — אין שם symlinks → `ERR_PNPM_EACCES`).
- **‏CLIs מקומיים**: `claude` 2.1.195 (bash script), `codex` 0.142.2 (`@mmmbuto/codex-cli-termux`), שניהם ב-`/data/data/com.termux/files/usr/bin/`.
- **‏קבצי-קוד שנגעו בחקירה (קריאה בלבד)**: `packages/core/src/schemas/agent.ts`, `packages/provider/src/{shared/spawn-core.ts,config/cli-config.ts,config/cli-config-file.ts,connection/connect-in-process.ts}`.
