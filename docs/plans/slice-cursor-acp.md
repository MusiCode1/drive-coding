# Slice — cursor-acp — רישום Cursor + Grok כספקי ACP + סטנדרט הוספת-ספק

> **תאריך**: 2026-07-08 (מקורי) · **עודכן**: 2026-07-11 — אוחד עם `slice-grok-acp` (בוטל, ר' §0)
> **סטטוס**: **הושלם** — כל 4 ה-commits (0/1/2/3) בוצעו + calev phase-verification GO אחרי Commit 1 (סבב שני, אחרי תיקון רגרסיית opencode). ממתין ל-verifier-slice סופי + מרדכי למיזוג.
> **Complexity**: 6/10 (verifier: light + phase אחרי commit 1)
> **תלות (`depends_on`)**: [] — בנוי ישירות על `dev`
> **Base**: `dev`
> **Dev tip**: `bce9ecd` (⚠️ ה-worktree הקיים `.worktrees/cursor-acp` על tip ישן `1292765` — ר' §0 Pre-flight, חובה merge לפני המשך)
> **מקור**: בקשת משתמשת (cursor) + מחקר/smoke חי (grok, 2026-07-10/11) + בקשת משתמשת לסטנדרט הוספת-ספקים (2026-07-11)

## §-1 — למה מאוחד (רקע להחלטה)

שני ה-briefs המקוריים (`slice-cursor-acp`, `slice-grok-acp`) נכתבו בנפרד אבל נוגעים **באותם קבצים בדיוק**:
`packages/core/src/schemas/agent.ts` (`CLI_SPECS`), `packages/provider/src/client/client.ts`,
`packages/provider/src/client/client-impl.ts`, `packages/backend/src/acp/connection-registry.ts`,
`packages/provider/src/connection/capabilities-static.ts`. שניהם גם מימשו **את אותה שכבת
`authenticate` גנרית** (אחרי `initialize`, כש-`authMethods` לא ריק) — ה-brief של grok אף תיעד
זאת במפורש: "אחרי המיזוג, `cursor-acp` יוכל להישען על אותה שכבה / להיות מצומצם לרישום בלבד".
הרצה נפרדת = כפל-מימוש + קונפליקטים ודאיים. **איחוד = שכבת auth אחת, PREFERRED-list אחת, ext-handlers משותפים.**

בנוסף — מחקר-רוחב (ר' §4 Commit 3) הראה ש-`CliKind` הוא union סגור בזמן-קומפילציה
(`packages/core/src/schemas/agent.ts:47`) הנצרך בכל שכבות ה-FE/BE — **הוספת ספק "טהורה" דרך
JSON runtime בלי קוד תדרוש להחליש את `CliKind` ל-`string`** (union סגור, `agent.ts` — `CLI_KINDS`/`CliKind`), מה שסותר את עקרון-הפרויקט
("No `any`", ArkType בכל מקום). המשתמשת אישרה (2026-07-11): **לא** להפוך את זה למנוע-config
מלא בסלייס הזה — רק **לתעד את המתכון המינימלי הקיים כסטנדרט כתוב** (Commit 3) + **לרשום את
רעיון ה-registry המלא ל-roadmap** כפריט עתידי נפרד (בוצע, ר' `docs/roadmap.md` Track F).

### Cursor ACP (נמדד חי, 2026-07-08 — Cursor CLI 2026.07.01-41b2de7)

| שדה | ערך |
|-----|-----|
| CLI | `agent acp` (`D:\Users\User\AppData\Local\cursor-agent\agent.cmd`) |
| protocolVersion | **1** |
| authMethods | `[{ id: "cursor_login", … }]` |
| loadSession | `true` (אבל upstream bug ב-`session/load` — ר' §6) |
| mcp | `http` + `sse` |
| prompt image | `true` |

### Grok ACP (נמדד חי, 2026-07-10 — Grok Build 0.2.93)

| שדה | ערך |
|-----|-----|
| CLI | `grok --no-auto-update agent stdio` |
| Binary (Windows) | `%USERPROFILE%\.grok\bin\grok.exe` (לרוב **לא** ב-PATH) |
| protocolVersion | **1** |
| authMethods | `cached_token` (default), `grok.com` |
| loadSession | `true` (עבד ב-smoke) |
| promptCapabilities | `embeddedContext: true`, `image: false`, `audio: false` |
| mcpCapabilities | `http: true`, `sse: true` |
| model default | `grok-4.5` |

**אימות argv ל-`--model` (חי, Grok):**

| argv | תוצאה |
|------|--------|
| `grok agent stdio --model grok-4.5` | **FAIL** exit 2 |
| `grok agent --model grok-4.5 stdio` | **OK** |

לכן `supportsModelFlag: true` עם המימוש הנוכחי של `getCliCommand` (מוסיף `--model` **בסוף**) **אסור** ל-Grok. Cursor פשוט לא תומך ב-`--model` דרך argv בכלל.

---

## §0 — Pre-flight

### תלויות

_אין תלויות (בנוי ישירות על dev)_

### Worktree — **כבר קיים, לא ליצור מחדש**

```bash
cd D:\UserProjects\AI\drive-coding\.worktrees\cursor-acp
git fetch . dev:dev-sync 2>/dev/null || true   # אם צריך; לרוב מספיק:
git merge dev                                   # ⚠️ יש שינויים לא-מקומטים — בדוק git status קודם
```

**מצב ידוע נכון ל-2026-07-11** (ר' git status ב-worktree): יש כבר עבודה **לא-מקומטת** שמכסה את
רוב Commit 0 + Commit 1 עבור **cursor בלבד** (7 קבצים שונו: `connection-registry.ts`,
`agent.ts`, `agent-schema.test.ts`, `cli-config.test.ts`, `client-impl.ts`, `client.ts`,
`capabilities-static.ts`). **אל תזרוק את זה** — זו נקודת-התחלה טובה ל-Commit 0+1 המאוחד;
העבודה הנדרשת היא **הרחבה** (הוספת grok לאותם מקומות + הכללת ה-PREFERRED-list), לא כתיבה
מחדש. אחרי ה-`git merge dev` ודאי שהקונפליקטים (אם יש) נפתרים בהתאם ל-brief הזה, ואז המשך
מ-Commit 0.

### איך להריץ

```bash
# BE
cd packages/backend && PORT=4000 bun src/server.ts

# FE (dev)
pnpm --filter @drive-coding/frontend dev

# production-like (מומלץ ל-runtime-gate):
pnpm --filter @drive-coding/frontend build
FE_STATIC_DIR="<abs>/packages/frontend/build" PORT=4000 bun packages/backend/src/server.ts
```

### Pre-requisite חיצוני (חובה ל-runtime-gate)

```bash
# Cursor
agent login
agent --version

# Grok
"%USERPROFILE%\.grok\bin\grok.exe" --version
# grok login (cached_token ב-~/.grok/auth.json) — או מנוי/קרדיטים פעילים
```

### Browser

Preview מקומי `http://localhost:4000`.

### Reading list

**must-read**:
- `packages/core/src/schemas/agent.ts` — `CLI_SPECS` (מקור-אמת), `CLI_KINDS`/`CliKind` (union סגור — ר' §-1)
- `packages/provider/src/config/cli-config.ts` — `getCliCommand`/`getCliSpec` (**זורק** אם kind ∉ `CLI_SPECS` — override JSONC לא מספיק לבד)
- `packages/provider/src/client/client.ts` — `createAcpClient` (initialize בלבד היום)
- `packages/provider/src/client/client-impl.ts` — `requestPermission` auto-allow, `extNotification`
- `packages/backend/src/acp/connection-registry.ts` — routing: claude/codex in-process, השאר spawn (אוטומטי, אין לגעת)
- `packages/frontend/src/routes/+page.svelte` — dropdown נגזר מ-`CLI_KINDS` (אין רשימת FE נפרדת)

**reference**:
- [Cursor ACP docs](https://cursor.com/docs/cli/acp) · [xAI Headless & Scripting](https://docs.x.ai/build/cli/headless-scripting) · [Zed ACP registry — Grok Build](https://zed.dev/acp/agent/grok-build)
- `docs/archive/reviews/acp-conformance.md` §B — `authMethods`/`authenticate`
- `deploy/cli-specs.jsonc` — override bin/env פר-מכונה

---

## §1 — מטרה

אחרי הסלייס: (א) `cursor` ו-`grok` מופיעים ב-dropdown הספקים; בחירת תיקייה + ספק → spawn + handshake (כולל `authenticate` אוטומטי) → שיחה קולית/טקסטואלית, כמו opencode/codex. (ב) קיים מסמך `docs/adding-a-provider.md` שמתעד את המתכון המדויק להוספת ספק ACP-spawn חדש עתידי — כך שההוספה הבאה (ספק שלישי/רביעי) היא checklist ולא מחקר-מחדש.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|--------|--------|-----|
| רשומת `cursor` ב-`CLI_SPECS` (`agent acp`) | ✅ | commit 0 |
| רשומת `grok` ב-`CLI_SPECS` (`--no-auto-update agent stdio`) | ✅ | commit 0 |
| `staticCapsFor("cursor")` / `staticCapsFor("grok")` | ✅ | commit 0 |
| TDD: `getCliCommand("cursor"/"grok")` + arktype `CliKind` כולל שניהם | ✅ | commit 0 |
| `authenticate` **גנרי** אחרי `initialize` כש-`authMethods` לא ריק (PREFERRED: `cached_token`/`grok.com`/`cursor_login`, אחרת ראשון-ברשימה) | ✅ | commit 1 |
| תשובות safe ל-blocking Cursor extensions (`cursor/ask_question`, `cursor/create_plan`) | ✅ | commit 1 |
| דוגמת override ב-`deploy/cli-specs.jsonc` (Windows paths, שני הספקים) | ✅ | commit 2 |
| `docs/adding-a-provider.md` — סטנדרט כתוב להוספת ספק spawn חדש | ✅ | commit 3 |
| runtime-gate חי: prompt → תשובה, שני הספקים | ✅ | DoD |
| **מנגנון config-driven מלא (ספק חדש = JSON בלי קוד)** | ❌ | נדחה במפורש — דורש `CliKind: string` (פגיעה ב-type-safety). נרשם ל-roadmap Track F כרעיון עתידי נפרד |
| UI אישור הרשאות (permission UI) | ❌ | Track C backlog |
| `cursor/update_todos`/`cursor/task`/`cursor/generate_image`, `_x.ai/*` UI | ❌ | backlog |
| in-process host לאף אחד מהשניים | ❌ | spawn מספיק |
| `supportsModelFlag: true` ל-Grok / תיקון מיקום `--model` ב-argv | ❌ | slice עתידי (MVP: `false`) |
| בחירת מודל Grok/Cursor ב-UI | ❌ | backlog |
| תיקון באג upstream `session/load` ב-Cursor | ❌ | known limitation |

---

## §3 — Architecture

```
┌──────────────┐     WS      ┌─────────────┐    stdio NDJSON    ┌──────────────────┐
│  FE (browser)│ ◄──────────►│  BE spawn   │ ◄─────────────────►│ agent acp        │
│ createAcpClient              connectSpawn                   Cursor CLI (child) │
│  + authenticate (גנרי, חדש) cliKind=cursor|grok               או grok agent stdio│
│  session/new · prompt      (not in-process)                    │
└──────────────┘             └─────────────┘                    └──────────────────┘
         │
         ▼
   extNotification("_x.ai/…" / cursor blocking-ext) → auto-answer / ignore
```

**נתיב**: `cursor`/`grok` → `connectSpawn` (כמו opencode/gemini/qoder), **לא** in-process.

**חסמים ידועים (שניהם)**:
1. `getCliCommand(kind)` זורק אם `kind ∉ CLI_SPECS` — override ב-`cli-specs.jsonc` **לא מספיק** בלי רשומה ב-core.
2. `createAcpClient` לא קורא `authenticate` היום — שני הספקים דורשים את זה אחרי `initialize` כש-`authMethods` לא ריק.

**מקור-אמת UI**: `CLI_KINDS` מ-core → `packages/frontend/src/routes/+page.svelte` (`options={CLI_KINDS.map(...)}`) — אין רשימת FE נפרדת לעדכן.

---

## §4 — Commits בסדר

### Commit 0 — רישום שני הספקים (approach: tdd)

**קבצים חדשים**: אין.

**קבצים שמשתנים**:
- `packages/core/src/schemas/agent.ts` — הוסף ל-`CLI_SPECS`:
  ```ts
  cursor: { bin: "agent", args: ["acp"], supportsModelFlag: false },
  grok: {
    bin: "grok",
    args: ["--no-auto-update", "agent", "stdio"],
    supportsModelFlag: false, // חובה false — ר' טבלת argv ב-§-1
  },
  ```
- `packages/core/tests/agent-schema.test.ts` — הרחב `accepts all valid cliKinds` ללולאה על `CLI_KINDS` (לא רשימה קשיחה); הוסף assertion ש-`CLI_KINDS` כולל `"cursor"` וגם `"grok"`.
- `packages/provider/src/connection/capabilities-static.ts` — הוסף `case "cursor"` ו-`case "grok"`, **שניהם** `mcp: true` (שני הספקים נמדדו §-1 תומכים `http`+`sse`); שאר השדות `false` כמו `default`. אופציונלי לבהירות — `default` כבר מכסה MVP פונקציונלית (רק `mcp` יהיה `false` סטטית אם לא מוסיפים case).
- `packages/backend/src/acp/connection-registry.ts` — עדכן הערת routing לכלול `cursor`+`grok` ברשימת spawn cliKinds.
- `packages/provider/cli-config.test.ts` —
  - `getCliCommand("cursor")` → `{ bin: "agent", args: ["acp"] }`
  - `getCliCommand("grok")` → `{ bin: "grok", args: ["--no-auto-update", "agent", "stdio"] }`
  - `getCliCommand("grok", "grok-4.5")` → **אותם** args (אין `--model` כי `supportsModelFlag: false`)

**אל תשנה**: routing ב-`connection-registry.ts` — שני ה-kinds נופלים ל-`connectSpawn` אוטומטית.

**Verification**:
```bash
pnpm typecheck
pnpm test --filter @drive-coding/core
pnpm test --filter @drive-coding/provider -- cli-config
```

---

### Commit 1 — ACP authenticate גנרי + Cursor blocking-ext (approach: tdd)

**בעיה**: שני הספקים דורשים `authenticate` אחרי `initialize` כש-`authMethods` לא ריק. Cursor: `methodId: "cursor_login"`. Grok: מעדיף `cached_token`/`grok.com`.

**קבצים שמשתנים**:
- `packages/provider/src/client/client.ts` — אחרי `initialize` מוצלח, **לפני** `return buildAcpClientFacade(...)`:
  ```ts
  // סדר-עדיפות לפי המדידה החיה ב-§-1: grok = cached_token/grok.com, cursor = cursor_login.
  // אין xai.api_key בפועל — לא להוסיף methodId שלא נצפה.
  const PREFERRED = ["cached_token", "grok.com", "cursor_login"] as const
  export function resolveAuthMethodId(
    authMethods: ReadonlyArray<{ id: string }> | undefined,
  ): string | undefined {
    if (!authMethods?.length) return undefined
    const ids = new Set(authMethods.map((m) => m.id))
    return PREFERRED.find((id) => ids.has(id)) ?? authMethods[0]?.id
  }
  ```
  קרא `resolveAuthMethodId(initResult.authMethods)`; אם מוגדר → `await conn.authenticate({ methodId })`.

  > 🔴 **תוקן אחרי calev phase-verification NO-GO (2026-07-11, ר' `reports/drive-coding/cursor-acp-calev.md`)**:
  > הגרסה המקורית סגרה את ה-transport וזרקה `auth_required` על **כל** כישלון `authenticate` —
  > זה שבר את opencode בפועל (חי, 2/2): opencode מפרסם `authMethods: [{id:"opencode-login"}]`
  > לא-ריק (אז `resolveAuthMethodId` מחזיר ערך ו-`authenticate` נשלח), אבל ה-RPC בפועל **לא
  > מיושם** אצלו — מחזיר `{code:-32603, message:"Internal error", data:{details:"Authentication
  > not implemented"}}`. ה-guard `authMethods?.length > 0` (§6 המקורי) לא הספיק — הוא בודק
  > "יש הכרזה על authMethods?" ולא "ה-authenticate RPC באמת מיושם?".
  >
  > **התיקון**: להבחין בין שגיאת-authenticate **מסוג auth_required אמיתי** (אותה צורה בדיוק
  > שכבר מזוהה ב-catch של `initialize`: `err?.data?.code === "auth_required"`) לבין **כל שגיאה
  > אחרת** (כמו `-32603`/"not implemented" של opencode). מיצוי ה-classifier לפונקציה משותפת
  > `isAuthRequiredError(err): boolean` (משמשת גם את ה-catch של `initialize` וגם את זה של
  > `authenticate` — DRY, ולא לשכפל את הבדיקה):
  > ```ts
  > function isAuthRequiredError(e: unknown): e is { data?: { code?: string }; message?: string } {
  >   const err = e as { data?: { code?: string } }
  >   return err?.data?.code === "auth_required"
  > }
  > ```
  > ב-catch של `authenticate`:
  > - אם `isAuthRequiredError(e)` → **פאטלי** (כמו קודם): סגור transport, זרוק error עם
  >   `kind: "auth_required"` — שומר על DoD #9 (cursor/grok באמת-לא-מחוברים עדיין מקבלים
  >   הודעה ברורה).
  > - **אחרת** (כל שגיאה אחרת, כולל "not implemented") → **לא-פאטלי**: `console.warn`/logger
  >   עם ה-methodId וה-error, **המשך** ל-`return buildAcpClientFacade(...)` כאילו `authenticate`
  >   לא נקרא בכלל. מונע רגרסיה בכל CLI שמכריז authMethods בלי ליישם את ה-RPC בפועל.
  >
  > **טסט-רגרסיה חדש חובה** (הוסף ל-`client.authenticate.test.ts`, §"קבצים לטסטים" למטה):
  > mock-transport שמחזיר ל-`authenticate` שגיאת JSON-RPC `-32603` (**לא** `auth_required`
  > ב-`data.code`) → הקוד **לא** זורק, `createAcpClient` מסתיים בהצלחה (מדמה את opencode
  > בדיוק). טסט נפרד: שגיאה עם `data.code === "auth_required"` בפועל → עדיין זורק/סוגר
  > transport כמו קודם.

  **אין** authenticate כש-`authMethods` ריק/חסר — providers שלא מכריזים authMethods בכלל
  (claude/codex/gemini/qoder ללא declaration) לא נוגעים כלל.
  שמור התנהגות `auth_required` קיימת בכ-catch של initialize (~שורות 273-281) — עכשיו דרך
  אותו `isAuthRequiredError`.
  **אל תיגע**: `createAttachedAcpClient` (warm reattach) — בלי initialize/authenticate מחדש.
- `packages/provider/src/client/client-impl.ts` — handlers ל-blocking Cursor extensions:
  - `cursor/ask_question` → `{ outcome: { outcome: "skipped" } }`
  - `cursor/create_plan` → `{ outcome: { outcome: "accepted" } }`
  > ⚠️ אם ה-SDK לא חושף `extMethod`/מקביל על `Client` — spike קודם, אל תנחש.

**קבצים לטסטים** (dedicated files, כמו שאר ה-client tests; אם ה-WIP הקיים כבר הרחיב inline — להעביר ל-קבצים ייעודיים כאן לעקביות):
- `packages/provider/src/client/client.authenticate.test.ts` — mock transport:
  1. `authMethods: [{ id: "cached_token" }]` → נשלח `authenticate` עם `methodId: "cached_token"`.
  2. `authMethods: [{ id: "cursor_login" }]` → נשלח `authenticate` עם `methodId: "cursor_login"`.
  3. `authMethods: []`/חסר → **אין** frame `authenticate`.
  4. `[{ id: "other_login" }]` (לא ב-PREFERRED) → fallback לראשון.
  5. regression: `initialize` עדיין נשלח עם `protocolVersion: 1`.
  6. 🆕 **opencode-regression**: `authMethods: [{ id: "opencode-login" }]`, ותגובת `authenticate`
     היא error `{code:-32603, data:{details:"Authentication not implemented"}}` (**בלי**
     `data.code === "auth_required"`) → `createAcpClient` **לא** זורק, מסתיים בהצלחה
     (`buildAcpClientFacade` מוחזר). מדמה חי את opencode.
  7. 🆕 **auth_required אמיתי**: תגובת `authenticate` היא error עם `data.code === "auth_required"`
     → `createAcpClient` **כן** זורק עם `kind: "auth_required"`, וסוגר את ה-transport (`transport.close()` נקרא).
- `packages/provider/src/client/client.cursor-ext.test.ts` — blocking ext לא תוקע (unit).

**API skeleton** — לא לשנות חתימות `AcpClient` public; רק פנימי ב-`createAcpClient`.

**Verification**:
```bash
pnpm test --filter @drive-coding/provider -- client.authenticate client.cursor-ext
pnpm typecheck
```

**Verifier-phase** (אחרי commit זה): smoke ידני מול לפחות ספק אחד (cursor או grok) — מוכיח `authenticate` נשלח אחרי `initialize`.

---

### Commit 2 — deploy docs + override (approach: manual)

**קבצים שמשתנים**:
- `deploy/cli-specs.jsonc` — הוסף (מוערה):
  ```jsonc
  // "cursor": { "bin": "C:/Users/<you>/AppData/Local/cursor-agent/agent.cmd" }
  // Grok Build — binary often under ~/.grok/bin (not always on PATH)
  // "grok": { "bin": "C:/Users/<you>/.grok/bin/grok.exe" }
  ```
- `docs/running-locally.md` — פסקה קצרה לכל ספק: login, env vars, בחירה ב-FE, הערת 402/קרדיטים (grok).
- `docs/decisions/drive-coding.md` — entry (ר' תבנית ב-agents/mordechai.md — נכתב ע"י מרדכי אחרי READY מאביגיל, לא ע"י אליעזר).

**Verification**: `pnpm lint:i18n`.

---

### Commit 3 — `docs/adding-a-provider.md` (approach: manual) 🆕

**מטרה**: לתעד את המתכון המינימלי שכבר קיים בקוד (הוכח פעמיים — cursor + grok) כ-checklist כתוב, כך שהוספת ספק ה-spawn הבאה לא דורשת מחקר מחדש. **זה לא מנגנון-קונפיגורציה חדש** — זה תיעוד של מה שכבר עובד + הסבר מפורש *למה* זה לא runtime-config (ר' §-1).

**קובץ חדש**: `docs/adding-a-provider.md` —
- Checklist בסדר: (1) `CLI_SPECS` entry ב-`packages/core/src/schemas/agent.ts` (bin/args/supportsModelFlag — עם אזהרה על מיקום `--model` ב-argv כמו Grok) → (2) `staticCapsFor` case אופציונלי (`default` מכסה MVP) → (3) בדיקה אם ה-CLI דורש `authenticate` (authMethods לא ריק) — אם כן, להוסיף methodId ל-PREFERRED-list ב-`client.ts` **רק אם** יש עדיפות ספציפית; אחרת fallback-לראשון כבר עובד ללא שינוי → (4) אם יש blocking extensions דמויי-Cursor — handler ב-`client-impl.ts` → (5) `deploy/cli-specs.jsonc` override לדוגמה + `docs/running-locally.md` פסקה → (6) טסטים (`agent-schema.test.ts`, `cli-config.test.ts`).
- **מה כבר אוטומטי, בלי לגעת בקוד**: ניתוב spawn (`connection-registry.ts` — כל kind שהוא לא `claude`/`codex`), `authenticate` (גנרי מ-commit 1), FE dropdown (`CLI_KINDS` נגזר מ-`CLI_SPECS`).
- **סעיף "למה לא config-driven מלא"**: הסבר קצר — `CliKind` union סגור, נצרך ב-arktype validation + FE VMs (`permission-mode.ts`, `agent-session.svelte.ts`) — לינק ל-`docs/roadmap.md` Track F לרעיון העתידי אם מישהו ירצה לשקול מחדש.

**Verification**: `pnpm lint:i18n` (מסמך בעברית — מותר, זה docs לא קוד).

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|--------|-----|
| 1 | typecheck + tests | `pnpm typecheck && pnpm test` |
| 2 | lint:i18n | `pnpm lint:i18n` |
| 3 | `cursor` + `grok` ב-dropdown | פתח `/`, ראה את שניהם ברשימה |
| 4 | spawn+auth cursor | בחר `cursor` + cwd → `ready`; wire מראה `authenticate` אחרי `initialize` |
| 5 | spawn+auth grok | בחר `grok` + cwd → `ready`; wire מראה `authenticate` אחרי `initialize` |
| 6 | prompt חי cursor | "Say hello in one sentence" → בועת תשובה |
| 7 | prompt חי grok | "Reply with exactly: ACP_SMOKE_OK" → בועת תשובה (דורש login+קרדיטים; 402 מותר PARTIAL מתועד) |
| 8 | regression opencode | חיבור opencode עדיין עובד |
| 9 | auth חסר | בלי login (אחד מהשניים) → הודעת `auth_required` ברורה |
| 10 | modelOverride לא שובר argv (grok) | unit: `getCliCommand("grok", "x")` ללא `--model` |
| 11 | `docs/adding-a-provider.md` קיים וקריא | code-review ידני — checklist ברור, מפנה ל-§-1 להסבר ה-type-safety wall |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|--------|------|----------|
| `agent`/`grok` לא ב-PATH | spawn ENOENT | `cli-specs.jsonc` override; DoD #4-5 |
| `session/load` שבור ב-Cursor upstream | Cursor forum | MVP = `newSession`; תיעוד ב-decisions |
| blocking `cursor/ask_question` תוקע turn | Cursor ext docs | auto-answer ב-commit 1 |
| `authenticate` שובר ספקים אחרים | regression | ~~authenticate רק אם authMethods?.length > 0~~ **לא הספיק** (calev NO-GO חי — opencode מכריז authMethods בלי ליישם authenticate). **תוקן**: catch מבחין `isAuthRequiredError` — פאטלי רק על `data.code === "auth_required"`, אחרת לא-פאטלי (log+המשך). ר' Commit 1 |
| 402 spending-limit / Free tier (grok) | smoke stderr | PARTIAL מותר עם דחייה מפורשת בדוח כלב — handshake+auth+dropdown חובה GO |
| SDK בלי `conn.authenticate`/`extMethod` | dependency | escalate; אל תמציא JSON-RPC ידני |
| worktree קיים אחורה מול dev (5+ commits) | git status | `git merge dev` לפני המשך — ר' §0 |
| מישהו "מתקן" `supportsModelFlag: true` ל-grok | argv bug | brief + unit test #10 |
| עברית בקוד | i18n hook | UI strings בקטלוגים בלבד; `docs/adding-a-provider.md` מותר בעברית (docs) |

---

## §7 — Escalation triggers

- SDK לא חושף `conn.authenticate`/blocking-ext handler → escalate (bump `@agentclientprotocol/sdk`)
- 3+ ניסיונות spawn נכשלים עם stderr לא מובן (אחד הספקים) → עצור, דווח
- brief סותר את הקוד אחרי ה-`git merge dev` ב-worktree הקיים → עדכן brief, אל תנחש

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|--------|--------|
| Protocol (authenticate גנרי + Cursor ext) | +2 |
| >2 packages | +1 |
| שני ספקים חיים חיצוניים (billing/PATH flake) | +1 |
| Spawn path קיים | −1 |
| TDD מתוכנן (commits 0-1) | −1 |
| Greenfield entries (דפוס מוכר מ-qoder) | −1 |
| Commit 3 (docs בלבד, סיכון נמוך) | +0 |

**Score**: 6/10

**Tier**: `calev` light + **verifier-phase אחרי commit 1**

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|------------|--------|
| Q1 | `authenticate` גם עם `CURSOR_API_KEY`/קרדנציאלים דרך env? | כן — קרא ל-authenticate אם מוצע ב-init, בלי תלות איך המפתח סופק | ❌ |
| Q2 | `supportsModelFlag` (שניהם) | `false` | ❌ |
| Q3 | `session/load` ב-MVP? | נסה; אם נכשל — known bug | ❌ |
| Q4 | שם ב-dropdown | `"cursor"` / `"grok"` (מ-`CLI_KINDS`) | ❌ |
| Q5 | האם Free tier grok חוסם DoD #7? | אם 402 עקבי — PARTIAL מתועד; handshake+dropdown חובה GO | ❌ |
| Q6 | לתקן WIP הקיים (inline tests) או לכתוב קבצים ייעודיים? | קבצים ייעודיים (עקביות עם שאר ה-client tests) — ר' commit 1 | ❌ |

---

## סטיות מהתכנון (מתעדכן ע"י executor)

- (ה-WIP הקיים מ-cursor-acp המקורי כבר תועד ב-§0 כנקודת-התחלה, לא כסטייה)
- **2026-07-11 — calev phase-verification NO-GO אחרי Commit 1**: התיקון המתוכנן במקור
  (`authenticate` פאטלי + guard `authMethods?.length > 0`) שבר את opencode חי (WS closed
  1005, 2/2). שורש: opencode מכריז `authMethods` לא-ריק אבל לא מיישם את ה-RPC בפועל
  (`-32603` "not implemented"). תוקן ב-Commit 1 (`isAuthRequiredError` classifier, פאטלי רק
  על auth_required אמיתי) — ר' §4 Commit 1 וטבלת סיכונים §6. דוח מלא:
  `reports/drive-coding/cursor-acp-calev.md`. DoD #4/#5 (cursor+grok authenticate) עברו
  במלואם באותה בדיקה — הבלוקר הוא **רק** ה-opencode-regression.
