# Slice — grok-acp — רישום Grok Build כספק ACP

> **תאריך**: 2026-07-11
> **סטטוס**: טיוטה (ממתין לאביגיל)
> **Complexity**: 5/10 (verifier: light + phase אחרי commit 1)
> **תלות (`depends_on`)**: [] — בנוי ישירות על `dev` (לא תלוי ב־`cursor-acp`; שכבת auth גנרית נכנסת כאן)
> **Base**: `dev`
> **Dev tip**: `6d99dcb`
> **מקור**: מחקר + smoke חי מול `grok agent stdio` (2026-07-10/11); docs xAI Headless & Scripting; registry Zed

### Grok ACP (נמדד חי, 2026-07-10 — Grok Build 0.2.93)

| שדה | ערך |
|-----|-----|
| CLI | `grok --no-auto-update agent stdio` |
| Binary (Windows) | `%USERPROFILE%\.grok\bin\grok.exe` (לרוב **לא** ב־PATH) |
| **protocolVersion** | **1** |
| authMethods | `cached_token` (default), `grok.com` |
| loadSession | `true` (`session/load` עבד ב־smoke) |
| promptCapabilities | `embeddedContext: true`, `image: false`, `audio: false` |
| mcpCapabilities | `http: true`, `sse: true` |
| model default | `grok-4.5` (context 500k ב־`_meta`) |
| session/update שנצפו | `agent_message_chunk`, `agent_thought_chunk`, `user_message_chunk`, `available_commands_update` |
| extensions | המון notifications `_x.ai/*` (extensibility חוקי — client חייב להתעלם) |
| subscription (smoke) | `Free` — stderr אפשרי `402 spending-limit` (ר' §6) |

**אימות argv ל־`--model` (חי):**

| argv | תוצאה |
|------|--------|
| `grok agent stdio --model grok-4.5` | **FAIL** exit 2 — unexpected argument |
| `grok agent --model grok-4.5 stdio` | **OK** |

לכן `supportsModelFlag: true` עם המימוש הנוכחי של `getCliCommand` (מוסיף `--model` **בסוף**) **אסור** ל־Grok.

---

## §0 — Pre-flight

### תלויות

slice זה **מבוסס על**:
- _אין תלויות (בנוי ישירות על dev)_

> **למה לא `depends_on: [cursor-acp]`**: branch `slice/cursor-acp` קיים ותיכנן auth גנרי, אבל **לא מוזג ל־`dev`** ו־`CLI_SPECS` על tip זה עדיין בלי `cursor`.  
> ה־brief הזה **מממש את שכבת `authenticate` הגנרית בעצמו** (commit 1). אחרי המיזוג, `cursor-acp` יוכל להישען על אותה שכבה / להיות מצומצם לרישום בלבד.  
> אביגיל: ודאי שאין הנחה ש־`conn.authenticate` כבר קיים ב־`client.ts` — **היום אין**.

### Worktree

> **נתיב worktrees בפרויקט**: `D:\UserProjects\AI\drive-coding\.worktrees\` (ברבים — **לא** `.worktree`).  
> ה־bare repo בשורש `drive-coding/`; `dev/` ו־`main/` הם worktrees ארוכי־טווח בשורש.  
> Convention: dir = `.worktrees/grok-acp`, branch = `slice/grok-acp`.

```bash
cd D:\UserProjects\AI\drive-coding
git worktree add .worktrees/grok-acp -b slice/grok-acp dev
cd .worktrees/grok-acp
pnpm install && pnpm hooks:install
```

### איך להריץ

```bash
# BE (Grok לא צריך OneCLI ל-TTS; ל-preview מלא עם TTS — onecli)
cd packages/backend
PORT=4000 bun src/server.ts
# או עם TTS proxy:
# PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts

# FE (dev — executor inner loop)
pnpm --filter @drive-coding/frontend dev

# production-like (חובה ל-runtime-gate / preview למשתמשת):
pnpm --filter @drive-coding/frontend build
FE_STATIC_DIR="<abs>/packages/frontend/build" PORT=4000 bun packages/backend/src/server.ts
```

### Pre-requisite חיצוני (חובה ל-runtime-gate)

```bash
# Windows — נתיב טיפוסי:
"%USERPROFILE%\.grok\bin\grok.exe" --version
# חייב: grok login (cached_token ב-~/.grok/auth.json) — או מנוי/קרדיטים פעילים
# בלי login / בלי קרדיטים: handshake עלול להיכשל או prompt יחזיר 402
```

### Browser

Preview מקומי `http://localhost:4000` (tunnel HTTPS — לא חובה לסלייס זה).

### Reading list

**must-read**:
- `packages/core/src/schemas/agent.ts` — `CLI_SPECS` (מקור־אמת יחיד)
- `packages/provider/src/config/cli-config.ts` — `getCliCommand` / `supportsModelFlag` append
- `packages/provider/src/client/client.ts` — `createAcpClient` (initialize בלבד היום; **כאן** נוסף authenticate)
- `packages/provider/src/client/client-impl.ts` — `extNotification` כבר בולע unknown methods
- `packages/backend/src/acp/connection-registry.ts` — routing: claude/codex in-process, **else spawn**
- `docs/plans/slice-cursor-acp.md` — precedence (אותו דפוס; auth עדיין לא ב־dev)
- `docs/archive/reviews/acp-conformance.md` §B — `authMethods` / `authenticate`

**reference**:
- [xAI Headless & Scripting](https://docs.x.ai/build/cli/headless-scripting) — `grok agent stdio`
- [Zed ACP registry — Grok Build](https://zed.dev/acp/agent/grok-build)
- `deploy/cli-specs.jsonc` — override bin/env פר־מכונה
- `docs/running-locally.md`

---

## §1 — מטרה

אחרי הסלייס, במסך הפתיחה יופיע **`grok`** ב־dropdown של הספקים. בחירת תיקייה + `grok` → spawn של Grok Build ב־ACP stdio → שיחה (קול/טקסט) דרך drive-coding, כמו opencode/gemini — אחרי login מקומי ל־Grok.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|--------|--------|-----|
| רשומה `grok` ב־`CLI_SPECS` (`--no-auto-update agent stdio`) | ✅ | commit 0 |
| TDD: `getCliCommand("grok")` + arktype `CliKind` כולל `grok` | ✅ | commit 0 |
| `staticCapsFor` / הערת registry | ✅ | commit 0 (מינימלי) |
| `authenticate` גנרי אחרי `initialize` כש־`authMethods` לא ריק | ✅ | commit 1 |
| העדפת `cached_token` / `xai.api_key` אם קיימים | ✅ | commit 1 |
| דוגמת override ב־`deploy/cli-specs.jsonc` (Windows `~/.grok/bin`) | ✅ | commit 2 |
| docs: `running-locally.md` + entry ב־`docs/decisions/drive-coding.md` | ✅ | commit 2 |
| runtime-gate חי: prompt → תשובה | ✅ | DoD |
| `supportsModelFlag: true` / תיקון מיקום `--model` ב־argv | ❌ | slice עתידי (מיקום flag) — MVP: `false` |
| בחירת מודל Grok ב־UI (effort high/medium/low) | ❌ | backlog |
| UI ל־`_x.ai/*` (queue, goal, announcements) | ❌ | backlog |
| הזרקת audio-friendly system prompt ל־Grok | ❌ | track prompt-injection |
| in-process host ל־Grok | ❌ | spawn מספיק |
| fork / patch ל־Grok CLI | ❌ | |
| רישום `cursor` (גם אם auth גנרי נכנס) | ❌ | `slice-cursor-acp` נפרד |

---

## §3 — Architecture

```
┌──────────────┐     WS      ┌─────────────┐    stdio NDJSON    ┌──────────────────┐
│  FE (browser)│ ◄──────────►│  BE spawn   │ ◄─────────────────►│ grok agent stdio │
│ createAcpClient              connectSpawn                   Grok Build (child) │
│  initialize                                                    │
│  + authenticate ← חדש      cliKind=grok                      │
│  session/new · prompt      (not in-process)                  │
└──────────────┘             └─────────────┘                    └──────────────────┘
         │
         ▼
   extNotification("_x.ai/…")  → ignore (כבר קיים ב-client-impl)
```

**נתיב**: `grok` → `connectSpawn` (כמו opencode/gemini/qoder), **לא** in-process.

**חסם ידוע היום**:
1. `getCliCommand(kind)` זורק אם `kind ∉ CLI_SPECS` — override JSONC **לא מספיק** בלי רשומה ב־core.
2. `createAcpClient` לא קורא `authenticate` — Grok (ו־Cursor) דורשים אחרי `initialize` כש־`authMethods` לא ריק.

**מקור־אמת UI**: `CLI_KINDS` מ־core → `packages/frontend/src/routes/+page.svelte`  
`options={CLI_KINDS.map(...)}` — **אין** רשימת FE נפרדת לעדכן.

---

## §4 — Commits בסדר

### Commit 0 — רישום ספק Grok (approach: tdd)

**קבצים חדשים**: אין.

**קבצים שמשתנים**:
- `packages/core/src/schemas/agent.ts` — הוסף ל־`CLI_SPECS`:
  ```ts
  grok: {
    bin: "grok",
    args: ["--no-auto-update", "agent", "stdio"],
    supportsModelFlag: false, // חובה false — ר' §0 טבלת argv
  },
  ```
- `packages/core/tests/agent-schema.test.ts` — הרחב `accepts all valid cliKinds` לכלול לפחות `"grok"` ו־`"qoder"` (הטסט הנוכחי עדיין רשימה ישנה בלי qoder/grok):
  ```ts
  for (const kind of CLI_KINDS) { ... }  // עדיף: לולאה על CLI_KINDS מה-core
  ```
  או הרחבה מפורשת של המערך. הוסף assertion ש־`CLI_KINDS` כולל `"grok"`.
- `packages/provider/cli-config.test.ts` (ו/או `packages/backend/tests/cli-config.test.ts` אם עדיין משכפלים):
  - `getCliCommand("grok")` → `{ bin: "grok", args: ["--no-auto-update", "agent", "stdio"] }`
  - עם `modelOverride: "grok-4.5"` → **אותם** args (אין `--model` כי `supportsModelFlag: false`)
- `packages/provider/src/connection/capabilities-static.ts` — **אופציונלי**:
  ```ts
  case "grok":
    return {
      mcp: true, // smoke: mcpCapabilities.http+sse
      compact: false,
      commands: false,
      usage: false,
      configOptions: false,
      rename: false,
      thinkingTokens: false, // thought chunks runtime; flag זה static/MVP
    }
  ```
  אם לא מוסיפים case — `default` מספיק ל־MVP (התנהגות זהה כמעט; רק `mcp` יהיה false סטטית).
- `packages/backend/src/acp/connection-registry.ts` — עדכן הערת שורה ~110 לכלול `grok` ברשימת spawn cliKinds.

**אל תשנה**:
- routing ב־`connection-registry` — `grok` נופל ל־`connectSpawn` אוטומטית (רק `claude`/`codex` in-process).
- `supportsModelFlag` logic ב־`getCliCommand` — **אל** תנסה "לתקן" מיקום flag ב־slice הזה.

**Verification**:

```bash
pnpm typecheck
pnpm test --filter @drive-coding/core
pnpm test --filter @drive-coding/provider -- cli-config
```

---

### Commit 1 — ACP authenticate גנרי (approach: tdd)

**בעיה**: Grok מחזיר `authMethods` לא־ריק ומצפה ל־`authenticate` לפני/סביב `session/new`.  
היום `createAcpClient` עושה רק `initialize` (ר' גם `acp-conformance.md` §B deliberate-skip).

**קבצים שמשתנים**:
- `packages/provider/src/client/client.ts` — אחרי `initialize` מוצלח, **לפני** `return buildAcpClientFacade(...)`:

  1. קרא `initResult.authMethods` (מערך; default `[]` / undefined → דלג).
  2. אם אורך > 0:
     - בחר `methodId`:
       ```ts
       const PREFERRED = ["cached_token", "xai.api_key", "cursor_login"] as const
       const ids = new Set((initResult.authMethods ?? []).map((m) => m.id))
       const methodId =
         PREFERRED.find((id) => ids.has(id)) ??
         initResult.authMethods![0]!.id
       ```
     - `await conn.authenticate({ methodId })`  
       אופציונלי: `_meta: { headless: true }` אם ה־SDK/types מאפשרים (Grok docs משתמשים בזה; לא חובה אם types צרים — אל תכריח `as any` רחב; השתמש ב־params החוקיים של ה־SDK).
  3. אם `authenticate` נכשל — סגור transport וזרוק error ברור (שמור/הרחב `kind: "auth_required"` כשמתאים).
  4. **אין** authenticate כש־`authMethods` ריק/חסר — opencode/gemini/qoder לא נשברים.

- שמור את טיפול `auth_required` הקיים ב־catch של initialize (~שורות 271–280).

**קבצים חדשים**:
- `packages/provider/src/client/client.authenticate.test.ts` — mock transport / writable capture:
  1. כש־initialize response כולל `authMethods: [{ id: "cached_token", ... }]` → נכתב frame `authenticate` עם `methodId: "cached_token"`.
  2. כש־`authMethods: []` / חסר → **אין** frame `authenticate`.
  3. כש־רק `[{ id: "other_login" }]` → authenticate עם `other_login` (fallback לראשון).
  4. regression: עדיין נשלח `initialize` עם `protocolVersion: 1`.

**API skeleton** — לא לשנות חתימות public של `AcpClient`; רק פנימי ב־`createAcpClient`.

**אל תיגע**:
- `createAttachedAcpClient` (warm reattach) — **בלי** initialize/authenticate מחדש.
- `client-impl` requestPermission — כבר auto-allow.

**Verification**:

```bash
pnpm test --filter @drive-coding/provider -- client.authenticate
pnpm typecheck
```

**Verifier-phase** (אחרי commit זה): smoke ידני או סקריפט — `createAcpClient` מול `grok agent stdio` (או wire mock) מוכיח authenticate נשלח; ר' DoD #4–5.

---

### Commit 2 — deploy docs + override (approach: manual)

**קבצים שמשתנים**:
- `deploy/cli-specs.jsonc` — הוסף דוגמה **מוערה** (לא path אישי hard-coded פעיל אלא אם כבר יש convention במכונה):
  ```jsonc
  // Grok Build — binary often under ~/.grok/bin (not always on PATH)
  // "grok": {
  //   "bin": "C:/Users/<you>/.grok/bin/grok.exe"
  // }
  ```
  אם בשרת/מכונת dev כבר ידוע path יציב — מותר רשומה פעילה עם path כללי (`%USERPROFILE%` **לא** עובד ב־JSON; path מלא או הסתמכות על PATH אחרי install script).

- `docs/running-locally.md` — פסקה קצרה:
  - התקנה / `grok login`
  - בחירת `grok` ב־FE
  - override bin ב־`cli-specs.jsonc` אם לא ב־PATH
  - הערת מנוי/קרדיטים (402)

- `docs/decisions/drive-coding.md` — entry מרדכי (אחרי READY מאביגיל / לפני dispatch):
  ```markdown
  ## 2026-07-11 — grok-acp: spawn + authenticate גנרי
  ### רציונל
  Grok Build חושף ACP נייטיב (`grok agent stdio`). רישום ב-CLI_SPECS + authenticate
  כש-authMethods לא ריק (cached_token). supportsModelFlag=false בגלל מיקום --model ב-argv.
  ```

**Verification**: `pnpm lint:i18n` (אין מחרוזות עברית חדשות **בקוד** — docs בעברית OK).

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|--------|-----|
| 1 | typecheck + tests | `pnpm typecheck && pnpm test` |
| 2 | lint:i18n | `pnpm lint:i18n` |
| 3 | `grok` ב־dropdown | פתח `/`, ראה `grok` ברשימת הספקים |
| 4 | spawn + auth | בחר `grok` + cwd → סטטוס `ready` (לא `crashed`); wire/log מראה `authenticate` אחרי `initialize` |
| 5 | prompt חי | שלח "Reply with exactly: ACP_SMOKE_OK" → בועת תשובה (דורש login + קרדיטים) |
| 6 | regression opencode | חיבור `opencode` עדיין `ready` + prompt קצר |
| 7 | auth חסר / פג | בלי `~/.grok/auth.json` תקין → הודעת auth ברורה (לא crash אילם) |
| 8 | modelOverride לא שובר argv | unit: `getCliCommand("grok", "x")` ללא `--model` בסוף |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|--------|------|----------|
| `grok` לא ב־PATH | Windows install | `cli-specs.jsonc` override; DoD #4 |
| 402 spending-limit / Free tier | smoke stderr | תעד ב־running-locally; runtime-gate דורש קרדיטים; PARTIAL מותר אם handshake+auth OK אבל prompt נחסם — **רק** עם דחייה מפורשת בדוח כלב |
| `authenticate` שובר ספקים אחרים | regression | authenticate **רק** אם `authMethods?.length > 0` + טסט #2 ב־commit 1 |
| SDK בלי `conn.authenticate` | dependency | escalate (bump `@agentclientprotocol/sdk`); אל תמציא JSON-RPC ידני אלא אם brief יעודכן |
| `_x.ai/*` flood | smoke | כבר `extNotification`; אל תוסיף handlers ב־MVP |
| מישהו "מתקן" `supportsModelFlag: true` | argv bug | brief + unit test #8; הערה ב־CLI_SPECS |
| עברית בקוד | i18n hook | UI strings רק ב־catalogs; labels = kind name |
| worktree על `dev` מאחורי origin | git status | אחרי create worktree: `git fetch && git merge origin/dev` אם צריך tip טרי |

---

## §7 — Escalation triggers

עצור ושאל מרדכי/משתמשת אם:

- `@agentclientprotocol/sdk` לא חושף `authenticate` על `ClientSideConnection`
- Grok דורש `authenticate` **עם** params נוספים (api key body) מעבר ל־`methodId` וה־docs לא מספיקים
- 3+ ניסיונות spawn נכשלים עם stderr לא מובן
- רוצים `supportsModelFlag` / מיקום argv ב־slice הזה (מחוץ ל־scope)
- brief סותר את הקוד אחרי rebase גדול

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|--------|--------|
| Protocol (`authenticate` + authMethods) | +2 |
| >2 packages (core + provider + docs/deploy) | +1 |
| Spawn path קיים | −1 |
| TDD מתוכנן (commits 0–1) | −1 |
| Greenfield CLI entry (דפוס מוכר מ־qoder/cursor) | −1 |
| Live external CLI / billing flake | +1 |

**Score**: 5/10

**Tier**: `calev` light  
**Verifier-phase אחרי**: commit 1 (auth path)

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|------------|--------|
| Q1 | `depends_on` על cursor-acp? | **לא** — auth ממומש כאן | ❌ |
| Q2 | `supportsModelFlag` | `false` | ❌ |
| Q3 | `--no-auto-update` ב־args? | **כן** (CI/spawn בטוח יותר) | ❌ |
| Q4 | שם ב־dropdown | `"grok"` (מ־CLI_KINDS) | ❌ |
| Q5 | `_meta.headless` ב־authenticate? | אם types מאפשרים — כן; אחרת methodId בלבד | ❌ |
| Q6 | האם Free tier חוסם DoD #5? | אם 402 עקבי — כלב PARTIAL + דחייה מתועדת על prompt בלבד; handshake+dropdown חובה GO | ❌ |

---

## סטיות מהתכנון (מתעדכן ע״י executor)

- (ריק)
