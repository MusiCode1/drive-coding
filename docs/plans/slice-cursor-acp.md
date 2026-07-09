# Slice — cursor-acp — רישום Cursor CLI כספק ACP

> **תאריך**: 2026-07-08
> **סטטוס**: מאומת (אביגיל READY)
> **Complexity**: 5/10 (verifier: light + phase אחרי commit 1)
> **תלות (`depends_on`)**: [] — בנוי ישירות על `dev`
> **Base**: `dev`
> **Dev tip**: `1292765`
> **מקור**: בקשת משתמשת — drive-coding כבר ACP-native; Cursor CLI (`agent acp`) זמין במכונה (Windows: `agent.cmd`, גרסה **2026.07.01-41b2de7**)

### Cursor ACP (נמדד חי, 2026-07-08)

| שדה | ערך |
|-----|-----|
| CLI | `agent acp` (`D:\Users\User\AppData\Local\cursor-agent\agent.cmd`) |
| **protocolVersion** | **1** (תגובת `initialize`) |
| authMethods | `[{ id: "cursor_login", … }]` |
| loadSession | `true` (אבל upstream bug ב-`session/load` — ר' §6) |
| mcp | `http` + `sse` |
| prompt image | `true` |
| session list | `true` |

---

## §0 — Pre-flight

### תלויות

slice זה **מבוסס על**:
- _אין תלויות (בנוי ישירות על dev)_

> אביגיל בודקת שסעיף זה עקבי עם `depends_on=[]`.

### Worktree

> **נתיב worktrees בפרויקט**: `D:\UserProjects\AI\drive-coding\.worktrees\` (ברבים — **לא** `.worktree`).
> ה-bare repo בשורש `drive-coding/`; `dev/` ו-`main/` הם worktrees ארוכי-טווח בשורש.

```bash
cd D:\UserProjects\AI\drive-coding
git worktree add .worktrees/cursor-acp -b slice/cursor-acp dev
cd .worktrees/cursor-acp
pnpm install && pnpm hooks:install
```

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
agent login          # או CURSOR_API_KEY / CURSOR_AUTH_TOKEN ב-env של תהליך ה-BE
agent --version      # חייב להצליח
```

### Browser

Preview מקומי `http://localhost:4000` (tunnel HTTPS — לא חובה לסלייס זה).

### Reading list

**must-read**:
- `packages/core/src/schemas/agent.ts` — `CLI_SPECS` (מקור-אמת)
- `packages/provider/src/client/client.ts` — `createAcpClient` (initialize בלבד היום)
- `packages/provider/src/client/client-impl.ts` — `requestPermission` auto-allow
- `packages/backend/src/acp/connection-registry.ts` — routing: claude/codex in-process, השאר spawn

**reference**:
- [Cursor ACP docs](https://cursor.com/docs/cli/acp)
- `docs/archive/reviews/acp-conformance.md` §B — `authMethods` ב-`InitializeResponse`, `conn.authenticate`
- `deploy/cli-specs.jsonc` — override ל-bin/env פר-מכונה

---

## §1 — מטרה

אחרי הסלייס, במסך הפתיחה יופיע **`cursor`** ב-dropdown של הספקים. בחירת תיקייה + `cursor` → חיבור ל-`agent acp` → שיחה קולית/טקסטואלית דרך drive-coding, כמו opencode/codex.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|--------|--------|-----|
| רשומה `cursor` ב-`CLI_SPECS` (`agent acp`) | ✅ | commit 0 |
| `staticCapsFor("cursor")` | ✅ | commit 0 |
| TDD: `getCliCommand("cursor")` + arktype `CliKind` | ✅ | commit 0 |
| `authenticate` אחרי `initialize` (`cursor_login`) | ✅ | commit 1 |
| תשובות safe ל-blocking Cursor extensions | ✅ | commit 1 |
| דוגמת override ב-`deploy/cli-specs.jsonc` (Windows path) | ✅ | commit 2 |
| runtime-gate חי: prompt → תשובה | ✅ | DoD |
| UI אישור הרשאות (permission UI) | ❌ | Track C backlog |
| `cursor/update_todos` / `cursor/task` / `cursor/generate_image` (notifications) | ❌ | slice עתידי |
| in-process (כמו codex) | ❌ | spawn מספיק |
| תיקון באג upstream `session/load` ב-Cursor | ❌ | known limitation |
| fork של Cursor CLI | ❌ | |

---

## §3 — Architecture

```
┌──────────────┐     WS      ┌─────────────┐    stdio NDJSON    ┌─────────────┐
│  FE (browser)│ ◄──────────►│  BE spawn   │ ◄─────────────────►│ agent acp   │
│ createAcpClient              connectSpawn                   Cursor CLI      │
│  + authenticate (חדש)      cliKind=cursor                   (child proc)  │
└──────────────┘             └─────────────┘                    └─────────────┘
```

**נתיב**: `cursor` → `connectSpawn` (כמו opencode/gemini), **לא** in-process.

**חסם ידוע היום**: `getCliCommand(kind)` זורק אם `kind ∉ CLI_SPECS` (`packages/provider/src/config/cli-config.ts:44-46`) — override ב-`cli-specs.jsonc` **לא מספיק** בלי רשומה ב-core.

---

## §4 — Commits בסדר

### Commit 0 — רישום ספק (approach: tdd)

**קבצים חדשים**: אין.

**קבצים שמשתנים**:
- `packages/core/src/schemas/agent.ts` — הוסף ל-`CLI_SPECS`:
  ```ts
  cursor: { bin: "agent", args: ["acp"], supportsModelFlag: false },
  ```
- `packages/core/tests/agent-schema.test.ts` — הרחב `accepts all valid cliKinds` לכלול `"cursor"` ו-`"qoder"` (אם חסר); הוסף assertion על `CLI_KINDS`
- `packages/provider/src/connection/capabilities-static.ts` — (אופציונלי) case `"cursor"`; ה-`default` כבר מחזיר אותם ערכים — הוסף רק לבהירות/תיעוד
- `packages/backend/src/acp/connection-registry.ts` — עדכן הערת שורה 110 לכלול `cursor` ברשימת spawn cliKinds
- `packages/provider/cli-config.test.ts` — `getCliCommand("cursor")` → `{ bin: "agent", args: ["acp"] }`

**אל תשנה**: `packages/backend/src/acp/connection-registry.ts` — `cursor` נופל ל-`connectSpawn` אוטומטית (רק `claude`/`codex` in-process).

**Verification**:

```bash
pnpm typecheck
pnpm test --filter @drive-coding/core
pnpm test --filter @drive-coding/provider -- cli-config
```

---

### Commit 1 — ACP handshake מלא ל-Cursor (approach: tdd)

**בעיה**: Cursor דורש `authenticate { methodId: "cursor_login" }` אחרי `initialize` (ראה Cursor ACP docs). drive-coding עושה רק `initialize` → `session/new` עלול להיכשל.

**קבצים שמשתנים**:
- `packages/provider/src/client/client.ts` — אחרי `initialize` מוצלח:
  1. קרא `initResult.authMethods` (`InitializeResponse.authMethods`, ר' `acp-conformance.md` §B)
  2. אם `authMethods` לא ריק ויש `methodId === "cursor_login"` → `await conn.authenticate({ methodId: "cursor_login" })`
  3. **כללי**: אם `authMethods` לא ריק — authenticate עם ה-`methodId` הראשון (עתידי); ל-Cursor מספיק `cursor_login`
  4. שמור התנהגות `auth_required` קיימת (`client.ts` ~271-280)
- `packages/provider/src/client/client-impl.ts` — הוסף handlers ל-**blocking** Cursor extensions (אם ה-SDK דורש methods על `Client`):
  - `cursor/ask_question` → `{ outcome: "skipped" }` (או בחירת אפשרות ראשונה אם `skipped` לא נתמך)
  - `cursor/create_plan` → `{ outcome: "accepted" }`
  > ⚠️ לפני מימוש: בדוק ב-SDK האם blocking extensions מגיעים כ-`extRequest` / method אחר על `Client`. אל תנחש — spike ב-commit אם חסר.

**קבצים חדשים**:
- `packages/provider/src/client/client.authenticate.test.ts` — mock transport: אחרי initialize נשלח authenticate כשמוצע
- `packages/provider/src/client/client.cursor-ext.test.ts` — blocking ext לא תוקע (unit)

**API skeleton** — לא לשנות חתימות `AcpClient` public; רק פנימי ב-`createAcpClient`.

**Verification**:

```bash
pnpm test --filter @drive-coding/provider -- client.authenticate client.cursor-ext
```

---

### Commit 2 — deploy docs + override (approach: manual)

**קבצים שמשתנים**:
- `deploy/cli-specs.jsonc` — הוסף (מוערה, לא path אישי בקוד):
  ```jsonc
  // "cursor": { "bin": "C:/Users/<you>/AppData/Local/cursor-agent/agent.cmd" }
  ```
- `docs/running-locally.md` — פסקה קצרה: `agent login`, env vars, בחירת `cursor` ב-FE

**Verification**: `pnpm lint:i18n` (אין מחרוזות עברית חדשות בקוד).

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|--------|-----|
| 1 | typecheck + tests | `pnpm typecheck && pnpm test` |
| 2 | lint:i18n | `pnpm lint:i18n` |
| 3 | `cursor` ב-dropdown | פתח `/`, ראה `cursor` ברשימה |
| 4 | spawn עובד | בחר `cursor` + cwd → סטטוס `ready` (לא `crashed`) |
| 5 | prompt חי | שלח "Say hello in one sentence" → בועת תשובה |
| 6 | regression opencode | חיבור opencode עדיין עובד |
| 7 | auth חסר | בלי login → הודעת `auth_required` ברורה |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|--------|------|----------|
| `agent` לא ב-PATH | spawn ENOENT | `cli-specs.jsonc` override ל-bin מלא; DoD #4 |
| `session/load` שבור ב-Cursor upstream | Cursor forum | MVP = `newSession`; תיעוד ב-decisions |
| blocking `cursor/ask_question` תוקע turn | Cursor ext docs | auto-answer ב-commit 1 |
| `authenticate` שובר ספקים אחרים | regression | קרא auth methods מ-init; authenticate **רק** אם מוצע |
| עברית בקוד | i18n hook | UI ב-catalogs בלבד |

---

## §7 — Escalation triggers

- SDK לא חושף `conn.authenticate` → בדוק גרסת `@agentclientprotocol/sdk`; escalate אם צריך bump
- Cursor דורש handler שלא קיים ב-`Client` interface → spike + עדכון brief
- 3+ ניסיונות spawn נכשלים → עצור, דווח עם stderr מה-wire

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|--------|--------|
| Protocol (authenticate + ext) | +2 |
| >2 packages | +1 |
| Spawn path קיים | -1 |
| TDD מתוכנן | -1 |

**Score**: 5/10

**Tier**: calev light + **verifier-phase אחרי commit 1**

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|------------|--------|
| Q1 | `authenticate` גם עם `CURSOR_API_KEY`? | כן — קרא ל-authenticate אם מוצע ב-init | ❌ |
| Q2 | `supportsModelFlag` | `false` | ❌ |
| Q3 | `session/load` ב-MVP? | נסה; אם נכשל — known bug | ❌ |
| Q4 | שם ב-dropdown | `"cursor"` | ❌ |

---

## סטיות מהתכנון (מתעדכן ע"י executor)

- (ריק)
