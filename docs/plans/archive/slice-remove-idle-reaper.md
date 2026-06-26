# Slice — ביטול ה-idle-reaper (מחיקת תהליכים ישנים) — תוכנית

> ✅ **בוצע · אומת · מוזג ל-dev.** אורכב ב-2026-06-27 (הסטטוס אומת מול היסטוריית git/roadmap; פרטי הביצוע והאימות בהמשך הקובץ).

> **תאריך**: 2026-06-16
> **סטטוס**: ✅ הושלם + מוזג ל-dev (calev GO 8/8; אומת ויזואלית 2026-06-16)
> **Complexity**: 3/10 (verifier: light)
> **תלויות (`depends_on`)**: [] — בנוי על dev **אחרי מיזוג** active-agents
> **Base**: dev אחרי מיזוג `integration-active-agents`
> **Dev tip**: dev=`b2c2349` (active-agents כבר מוזג)

> 🎯 זהו מימוש **תנאי-המחיקה** של [slice-26-bridge-idle-reaper.md](archive/slice-26-bridge-idle-reaper.md) §7: "כשייכנס מנגנון ניהול agents-ברקע (future A) — יש למחוק את כל הקוד המתויג `TEMPORARY (slice 26)`". מנגנון active-agents הוא אותו future A.

---

## §0 — Pre-flight

### בסיס האימות

מיזוג active-agents **כבר בוצע ל-dev** (tip `b2c2349`). כל הסמלים (`reap-idle.ts`, `getRuntimeInfo`, `persistent`, `reapIdleBridges`, בלוק ה-reaper ב-server.ts) נמצאים ב-dev. בנה ואמת ישירות מול dev. אומת בסבב אביגיל 2: אפס צרכן יתום של listIdle/getCreatedAt, אפס regression ל-`attached`.

### תלויות (חובה!)

- מיזוג active-agents → dev — **בוצע** (b2c2349). ה-slice מנקה את ה-reaper מתוך הבסיס המאוחד.

`depends_on: []`.

### Worktree

```bash
cd D:/UserProjects/AI/drive-coding
git worktree add .worktrees/slice-remove-idle-reaper -b slice-remove-idle-reaper dev
cd .worktrees/slice-remove-idle-reaper
pnpm install && pnpm hooks:install
```

> סביבה: Windows 11 + PowerShell. bare repo — השתמש ב-absolute paths. base=`dev` (b2c2349) — המיזוג כבר בוצע.

### איך להריץ

- BE tests: `pnpm --filter @drive-coding/backend test`
- כללי: `pnpm typecheck` ; `pnpm lint:i18n`
- הרצה חיה (אופציונלי, לאימות ידני): `PORT=4001 onecli run --agent voice-acp -- bun --watch src/server.ts`

### Reading list

**must-read**:
1. [bridge-manager.ts](../../packages/backend/src/acp/bridge-manager.ts) — ה-store; השדות והמתודות הזמניים שיוסרו, מול אלה שיישארו לתצוגה.
2. [server.ts](../../packages/backend/src/server.ts) — בלוק ה-reaper + ה-import של `reapIdleBridges`.
3. `packages/backend/src/acp/reap-idle.ts` — הקובץ שיימחק.
4. [ws-agent.ts](../../packages/backend/src/delivery/ws-agent.ts) — קריאות `markAttached`/`markDetached` (נשארות; ההערות יתעדכנו).

**reference**:
- [slice-26-bridge-idle-reaper.md](archive/slice-26-bridge-idle-reaper.md) §7 — תנאי-המחיקה המקורי.

---

## §1 — מטרה

לבטל לחלוטין את מנגנון ה-idle-reaper (ה-interval שהורג bridges מנותקים אחרי timeout). מאחר שפאנל "תהליכים פעילים" כבר מציג את כל התהליכים ומאפשר סגירה ידנית (Kill), אין יותר סכנת "דליפת תהליכים" — כל תהליך מיותר נסגר ידנית ע"י המשתמש. אחרי ה-slice: שום תהליך לא נהרג אוטומטית; הבקרה מלאה בידי המשתמש.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| מחיקת `reap-idle.ts` + בלוק ה-reaper ב-server.ts | ✅ | ה-slice הזה |
| מחיקת `listIdle` + `getCreatedAt` + השדות `createdAt`/`lastDetachedAt` | ✅ | ה-slice הזה |
| מחיקת טסטי ה-reaper (`bridge-manager.idle.test.ts`, `reaper-pin.test.ts`) | ✅ | ה-slice הזה |
| **השארת** `hasActiveWs` / `markAttached` / `markDetached` / `getRuntimeInfo` | ✅ | נחוצים לתצוגה (`attached`) — **לא** למחוק |
| **השארת** ה-pin כ-no-op (endpoint `/persistent`, schema, UI 📌) | ✅ | החלטת המשתמש — לא נוגעים |
| מחיקת ה-pin / schema `persistent` / endpoint | ❌ | לא — נשאר no-op בכוונה |
| busy/idle indicator | ❌ | slice-agent-busy-indicator |
| תיקון layout הפאנל | ❌ | slice-active-processes-layout |

> **תובנת-מפתח**: `hasActiveWs` משרת גם את `getRuntimeInfo()` → השדה `attached` בתצוגה, לא רק את ה-reaper. ההסרה כירורגית — לא מחיקת-בלוק עיוורת.

---

## §3 — Architecture diagram

```text
לפני:
  server.ts ──setInterval──> reapIdleBridges() ──> listIdle() ──> deleteAndKill()
                                   │
                                   └─ skip if registry.persistent === true

  bridge-manager Entry: { handle, child, stderrLines,
                          hasActiveWs, lastDetachedAt, createdAt }   ← כולם זמניים
  bridge-manager API:   markAttached, markDetached, listIdle,
                        getCreatedAt, getRuntimeInfo

אחרי:
  server.ts ── (אין reaper)

  bridge-manager Entry: { handle, child, stderrLines, hasActiveWs }  ← רק hasActiveWs נשאר
  bridge-manager API:   markAttached, markDetached, getRuntimeInfo   ← listIdle/getCreatedAt הוסרו

  markDetached(id): e.hasActiveWs = false            ← השורה lastDetachedAt=Date.now() הוסרה
  getRuntimeInfo(id): { pid: e.handle.pid, attached: e.hasActiveWs }   ← ללא שינוי
```

---

## §4 — Commits בסדר

### Commit 1 — מחיקת ה-reaper (server.ts + reap-idle.ts + טסט) (approach: none)

**קבצים שנמחקים**:
- `packages/backend/src/acp/reap-idle.ts` — כל הקובץ.
- `packages/backend/tests/reaper-pin.test.ts` — כל הקובץ (בודק רק את `reapIdleBridges`).

**קבצים שמשתנים**:
- [server.ts](../../packages/backend/src/server.ts):
  - הסר את ה-import `import { reapIdleBridges } from "./acp/reap-idle.js"`.
  - מחק את כל בלוק ה-reaper: `BRIDGE_IDLE_TIMEOUT_MS`, `REAP_INTERVAL_MS`, `const reaper = setInterval(...)`, `reaper.unref()`, וההערה `TEMPORARY (slice 26 ...)` שמעליו.
  - ודא ש-`bridgeManager`/`orchestrator`/`registry` עדיין בשימוש במקומות אחרים (כן — רישום HTTP/WS). אל תסיר אותם.

**Verification**:
```bash
pnpm --filter @drive-coding/backend test   # אין import שבור ל-reap-idle
pnpm typecheck
```

### Commit 2 — ניקוי כירורגי ב-bridge-manager (approach: none)

**קבצים שנמחקים**:
- `packages/backend/src/acp/bridge-manager.idle.test.ts` — כל הקובץ (בודק רק `listIdle`).

**קבצים שמשתנים**:
- [bridge-manager.ts](../../packages/backend/src/acp/bridge-manager.ts):
  - **הסר מ-`Entry`**: השדות `lastDetachedAt` ו-`createdAt`. **השאר** `hasActiveWs`.
  - **הסר את אתחולם** ב-`store.set(...)` (השאר `hasActiveWs: false`).
  - **הסר מהטיפוס המוחזר** של `createBridgeManager`: `listIdle(...)` ו-`getCreatedAt(...)`. **השאר** `markAttached`/`markDetached`/`getRuntimeInfo`.
  - **הסר את המימושים** של `listIdle` ו-`getCreatedAt` מתוך ה-`return { ... }`.
  - **שנה את `markDetached`**: הסר את השורה `e.lastDetachedAt = Date.now()`. ישאר רק `if (e) e.hasActiveWs = false`.
  - **עדכן הערות**: ההערות `TEMPORARY (slice 26)` שמעל `markAttached`/`markDetached`/`hasActiveWs` → הסבר שהם כעת משרתים את `getRuntimeInfo` (תצוגת active-agents), ולא זמניים. הסר את הערת `// TEMPORARY (fix-idle-flaky)`.
- [ws-agent.ts](../../packages/backend/src/delivery/ws-agent.ts): עדכן את **שלוש** ההערות `// ← TEMPORARY (slice 26)` (בשורות ~45, ~83, ~140 — בהגדרת ה-deps type + ליד `markAttached`/`markDetached`) → "תצוגת active-agents (attached)". הקריאות עצמן **לא** משתנות.

**API skeleton** (הטיפוס המוחזר אחרי השינוי):
```ts
export function createBridgeManager(): BridgeManager & {
  spawnWithStderr(bridgeId: string, input: SpawnBridgeInput): Promise<BridgeHandleWithStderr>
  getChild(bridgeId: string): ChildProcessWithoutNullStreams | null
  markAttached(bridgeId: string): void
  markDetached(bridgeId: string): void
  getRuntimeInfo(bridgeId: string): { pid: number; attached: boolean } | null
}
```

> ⚠️ אל תיגע ב-`getRuntimeInfo` — הוא קורא `e.handle.pid` ו-`e.hasActiveWs`, ששניהם נשארים.

**Verification**:
```bash
pnpm --filter @drive-coding/backend test
pnpm typecheck   # מוודא שאין צרכן יתום של listIdle/getCreatedAt
pnpm lint:i18n
```

### Commit 3 — Docs (approach: manual)

**קבצים**:
- `docs/walkthrough.md` — רשומת ביצוע (שיטת `update-walkthrough`): "ה-idle-reaper הוסר; תנאי §7 של slice-26 מומש; הבקרה עברה למשתמש דרך פאנל active-agents".
- `docs/plans/archive/slice-26-bridge-idle-reaper.md` — עדכון סטטוס ל"הוסר ב-slice-remove-idle-reaper".
- **הערות תיעוד stale נוספות שמזכירות "reaper"** (אביגיל r2 — לא לוגיקה, רק ניסוח):
  - [agent-session.svelte.ts](../../packages/frontend/src/lib/view-models/agent-session.svelte.ts) שורות ~258 ("סך ~31s << חלון reaper") ו-~320 ("יתום קבוע (reaper לא נוגע ב-hasActiveWs=true)"). עדכן שלא יפנו ל-reaper. ההגנה עצמה (BE דוחה WS כפול ב-1008 כש-`hasActiveWs=true`) עדיין תקפה.
  - [agent.ts schema](../../packages/core/src/schemas/agent.ts) שורה ~75: ההערה על `persistent` ("true = ה-reaper לא יהרוג") → עדכן ל"נשמר לתאימות; ה-reaper הוסר — כרגע ללא אפקט (no-op)".
  - [cli-config.ts](../../packages/backend/src/acp/cli-config.ts) שורה ~74: הערה על "idle-reaper tests" → עדכן/הסר (הטסטים נמחקו).
  - [slices.md](../../packages/frontend/docs/slices.md) שורה ~78: רשומת slice 26 ("⚠️ זמני, למחיקה ב-future A") → עדכן ל"✅ הוסר ב-slice-remove-idle-reaper".

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|---|---|
| 1 | BE tests ירוקים | `pnpm --filter @drive-coding/backend test` |
| 2 | Typecheck ירוק (אין צרכן יתום) | `pnpm typecheck` |
| 3 | אין עברית קשיחה | `pnpm lint:i18n` |
| 4 | `grep "reapIdle\|listIdle\|getCreatedAt\|reap-idle"` ב-`packages/backend/src` → אפס | חיפוש |
| 5 | `grep "TEMPORARY (slice 26)"` ב-`packages` (כולל ws-agent.ts) → אפס | חיפוש |
| 5b | `grep -ri "reaper"` ב-`packages` → אין הפניה ל-reaper **פעיל**. ארבעת אתרי-התיעוד (agent-session.svelte.ts, agent.ts, cli-config.ts, slices.md) עודכנו בהתאם ל-Commit 3 | חיפוש |
| 6 | הפאנל עדיין מציג `attached`/`pid` נכון | runtime: GET `/api/agents` מחזיר pid+attached |
| 7 | Regression: agent מנותק **לא** נהרג אחרי 5 דק' | runtime: צור agent, סגור טאב, המתן >5 דק', עדיין ב-`/api/agents` |
| 8 | Regression: שיחה רגילה + Kill ידני עובדים | connect → prompt → תשובה → Kill מהפאנל |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| מחיקת `hasActiveWs` בטעות → `attached` בתצוגה נשבר | בלבול בין "זמני" ל"נחוץ לתצוגה" | §2 + §3 מדגישים: `hasActiveWs` נשאר. רק `createdAt`/`lastDetachedAt` הוסרים |
| צרכן יתום של `listIdle`/`getCreatedAt` אחרי מחיקה | call-site שלא אותר | `pnpm typecheck` יתפוס; DoD #4 |
| ws-agent-pipe.test.ts mock נשבר | ה-mock כולל markAttached/markDetached | הם **נשארים** — הטסט תקין. listIdle לא ב-mock |
| בסיס אימות שגוי (dev במקום integration) | המיזוג טרם בוצע | §0 — אביגיל בודקת מול `integration-active-agents` |
| מחרוזות עברית | pre-commit hook | ה-slice מסיר קוד + הערות בלבד; אין UI strings |

---

## §7 — Escalation triggers

- מתברר ש-`getRuntimeInfo` או `attached` תלויים ב-`createdAt`/`lastDetachedAt` (לא רק `hasActiveWs`) — עצור, דווח ל-Tama.
- מתגלה צרכן נוסף של `listIdle`/`getCreatedAt` מחוץ ל-reaper/טסטים — עצור.
- המיזוג של active-agents שינה את ה-reaper בצורה שלא תואמת ל-§3 — עצור, עדכן את ה-brief.

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|---|---:|
| Refactor של קוד קיים (כירורגי) | +1 |
| מחיקה > יצירה, אין לוגיקה חדשה | -1 |
| Regression surface ממוקד (BE bridge lifecycle) | +1 |
| מעורבות runtime (לוודא שלא נהרג + attached) | +1 |
| Pure-ish, אין IO חדש | -1 |
| נטו בסיס | +2 |

**Score**: 3/10
**Tier**: `calev` mode: light בלבד (אין wiring חדש; בעיקר מחיקה + regression).

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | להשאיר את ה-pin כ-no-op או למחוק? | no-op (החלטת משתמש 2026-06-16) | ❌ |
| 2 | למחוק את השדה `persistent` מ-schema? | לא — נשאר עם ה-pin | ❌ |

---

## סטיות מהתכנון (מתעדכן ע"י executor)

- ...
