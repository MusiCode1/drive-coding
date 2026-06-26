# Slice reconnect-warm-attach — חיבור-מחדש מהווידג'ט ל-agent חי (warm) במקום spawn חדש — ‏בריף

> ✅ **בוצע · אומת · מוזג ל-dev.** אורכב ב-2026-06-27 (הסטטוס אומת מול היסטוריית git/roadmap; פרטי הביצוע והאימות בהמשך הקובץ).

> **‏תאריך**: 2026-06-15
> **‏סוג מסמך**: ‏בריף ביצועי לסלייס
> **‏סטטוס**: ‏הושלם (2026-06-15) — ‏ממתין ל-calev + merge
> **‏אימות אביגיל**: ✅ **READY** (round 2, 2026-06-15). round 1 — 3 findings (🔴 error לא מאופס; 🟡 no-guard מכוון; 🟢 anchors); round 2 — READY. ‏דוח: `reports/drive-coding/slice-reconnect-warm-attach-avigail.md`
> **Dispatch**: ✅ ‏מותר (‏אביגיל READY).
> **Complexity**: 6/10 (verifier: light + phase על commit 1 — ‏נגיעה ב-reconnect flow)
> **‏תלויות (`depends_on`)**: [slice-active-agents-widget]
> **‏Base**: ‏branch `slice-active-agents-widget` (‏שרשור — ‏ה-fix מתקן את ה-`handleReconnect` שלו)

---

## §0 — Pre-flight

> ‏ה-"התחבר מחדש" בווידג'ט התהליכים הפעילים **‏נכשל** ‏כי הוא קורא ל-`loadSession` (‏cold:
> ‏spawn agent **‏חדש** + ACP `session/load`), ‏וה-process החדש **‏לא מכיר** ‏את ה-session →
> `session/load` → "Resource not found". ‏ה-fix: ‏להתחבר ל-agent ה**‏חי** ‏הקיים ב-BE (‏warm-attach),
> ‏שמחזיק את ה-session בזיכרון — `session/load` ‏עליו מצליח.

### ‏רקע — ‏אבחון מאושש (חי, 2026-06-15)

- ה-bridge החי קיים: `GET /api/agents` ‏מראה agent (claude/opencode) `status:ready`, ‏עם `pid` ‏ו-`acpSessionId`.
- **‏אימות WS ישיר**: ‏פתיחת WS ל-`/ws/agent/<agentId>` ‏החי + `initialize` + `session/load` ‏של ה-`acpSessionId` → **‏הצליח** (‏החזיר sessionId+modes). ‏על process **‏חדש** (cold) → "Resource not found".
- ‏המסקנה: ‏ה-process החי מכיר את ה-session in-memory; ‏רק warm-attach מצליח. ‏cold תלוי ב-disk-persistence שה-CLI עושה רק אחרי turn מוצלח.

### ‏סביבה: **Windows-native**

- ‏של: PowerShell. BE: `bun src/server.ts` ‏ישירות (port 4000; onecli על Windows לא מריץ bun). FE: `pnpm --filter @drive-coding/frontend-v2 dev`.
- ‏טסטים: `pnpm test` ‏מהשורש (‏ל-frontend-v2 יש `test`; ‏ל-core/backend אין — ‏ראה windows-adaptation).
- ‏**‏בדיקה חית מקצה-לקצה** (reconnect) ‏דורשת agent חי שעלה ל-ready → ‏צריך גם `fix-cwd-validate-windows` + `slice-windows-adaptation` (opencode plugin). ‏כלב יצרף אותם (‏או יבדוק עם claude שלא תלוי בהם).

### Worktree

```powershell
cd d:\UserProjects\AI\drive-coding
git worktree add .worktrees\slice-reconnect-warm-attach -b slice-reconnect-warm-attach slice-active-agents-widget
cd .worktrees\slice-reconnect-warm-attach
pnpm install ; pnpm hooks:install
```

### Reading list

**must-read**:
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts`:
  - **`#warmReconnect(agentId)`** (~327-392) — **‏הלב הקיים**: WS חדש ל-agentId, `Promise.race` ל-MED-8 (1008→retry), `createAcpClient`, `#client.loadSession({sessionId: this.#sessionId!, cwd: this.cwd!})` (~374), `notifySessionAttached(agentId, this.#sessionId!, {replace:true})` (~380), `#setStatus("connected")` → `true`; ‏כשל → `false`. **‏מסתמך על `this.#sessionId`/`this.cwd` ‏הפנימיים.**
  - `loadSession` (~508) — ‏ה-cold path (`createAgent` חדש @531 + session/load). **‏זה מה שהווידג'ט קורא היום (הבאג).**
  - `reconnect()` (~582) — warm-first אבל `return` ‏אם `#sessionId===null` (‏לא רלוונטי מ-state נקי).
  - ‏שדות: `#sessionId`, `cwd` ($state), `#cliKind`, `#client`, `#transport`, `agentId`, `#detached`. `#setStatus`. `closeAndWait` ‏על `#transport`.
- `packages/frontend/src/routes/+page.svelte` — `handleReconnect(agent)` (~102-114): ‏היום `await session.loadSession({sessionId: agent.acpSessionId, cwd: agent.cwd, cliKind: agent.cliKind})`. **‏זה ה-call-site לתיקון.**
- `packages/frontend/src/lib/components/connect/ActiveProcessesPanel.svelte` — `onReconnect(agent)` (14,17,136), `isReconnectDisabled` (77-79: `!acpSessionId || attached===true`). **‏לא משתנה** — ‏רק מספק את ה-callback.
- `packages/core/src/schemas/agent.ts` — `AgentPublic`: `{ id, cliKind, cwd, status, createdAt, acpSessionId?, pid?, attached?, persistent? }`. **`id` ‏הוא ה-agentId** (‏נדרש ל-warm-attach).

**reference**:
- `docs/plans/archive/slice-ws-reconnect-infra.md` — ‏ה-design של warm/cold (§3). `#warmReconnect` ‏נוצר שם.
- `switchSession`/`newSession` (~601/663) — ‏warm על `#client` **‏קיים** (‏לא רלוונטי מ-state נקי, אבל דגם).

---

## §1 — ‏מטרה

‏אחרי הסלייס, ‏לחיצה על "התחבר מחדש" בווידג'ט התהליכים הפעילים **‏מתחברת ל-agent החי הקיים**
‏(‏warm — WS לאותו `agentId`, ‏בלי spawn), ‏טוענת את ההיסטוריה דרך `session/load` ‏על ה-process
‏שמחזיק אותה, ‏ועוברת ל-`/chat` ‏עם השיחה משוחזרת. ‏אם ה-agent מת בינתיים — ‏שגיאה ברורה
‏(‏לא spawn חדש שייכשל). ‏הבאג הנוכחי (cold-spawn → "Resource not found") ‏נפתר.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|------|------|------|
| ‏מתודה ציבורית `attachToLiveAgent({agentId, sessionId, cwd, cliKind})` ב-VM | ✅ | Commit 0 |
| ‏`handleReconnect` ‏קורא ל-`attachToLiveAgent` ‏במקום `loadSession` | ✅ | Commit 1 |
| ‏fallback: warm נכשל → ‏שגיאה ברורה (‏**‏לא** ‏cold-spawn) | ✅ | Commit 0/1 |
| ‏סגירת `#client`/`#transport` קיים לפני warm (‏דפנסיבי, אם המשתמש מחובר) | ✅ | Commit 0 |
| ‏שינוי `#warmReconnect` ‏הקיים (‏רק reuse) | ❌ | ‏לא נוגעים — ‏רק קוראים לו |
| ‏שינוי `reconnect()`/auto-reconnect/`switchSession` | ❌ | ‏מחוץ ל-scope |
| ‏שינוי ה-cold `loadSession` | ❌ | ‏נשאר (‏עדיין בשימוש ל-connect/SessionPicker) |
| ‏שינוי `ActiveProcessesPanel` / BE / reaper | ❌ | ‏לא נדרש |
| ‏שינוי `isReconnectDisabled` (‏כבר חוסם `!acpSessionId`/`attached`) | ❌ | ‏נשאר |

---

## §3 — Architecture diagram

```
ActiveProcessesPanel  (ללא שינוי)
  onReconnect(agent)  →  +page.svelte handleReconnect(agent)

+page.svelte handleReconnect(agent):          ← משתנה (Commit 1)
  היום:  session.loadSession({sessionId, cwd, cliKind})   ← COLD (spawn חדש) ❌
  חדש:   await session.attachToLiveAgent({                 ← WARM ✅
            agentId: agent.id, sessionId: agent.acpSessionId!,
            cwd: agent.cwd, cliKind: agent.cliKind })
         if (session.status === "connected") goto("/chat")
         else  (שגיאה מוצגת ע"י ה-VM — לא goto)

agent-session.svelte.ts:                       ← מוסיף (Commit 0)
  attachToLiveAgent({agentId, sessionId, cwd, cliKind}): Promise<void>
    ├── this.error = null                                   ← נקה error קודם (🔴)
    ├── (דפנסיבי) אם #transport → closeAndWait; #client=null; #transport=null
    ├── this.#sessionId = sessionId; this.cwd = cwd; this.#cliKind = cliKind
    ├── const ok = await this.#warmReconnect(agentId)   ← הלב הקיים (WS+load+MED-8)
    └── if (!ok) { this.error = "..."; this.#setStatus("error") }   ← לא cold
```

> **‏עיקרון**: ‏אפס לוגיקת WS/handshake חדשה — `#warmReconnect` ‏כבר עושה הכל. ‏המתודה החדשה
> ‏רק **‏מזריקה את ה-state** (sessionId/cwd/cliKind) ‏ומפעילה אותו עם agentId מבחוץ.

---

## §4 — Commits ‏בסדר

### Commit 0 — `attachToLiveAgent` ב-VM (approach: tdd)

**‏קובץ**: `packages/frontend/src/lib/view-models/agent-session.svelte.ts`.

‏הוסף מתודה ציבורית (ADDITIVE, ‏ליד `reconnect`, ‏בבלוק "מחזור חיי חיבור"):

```ts
/**
 * חיבור-מחדש ל-agent חי קיים בצד-השרת (warm-attach), מ-state נקי (מהווידג'ט).
 * שונה מ-reconnect(): מקבל את ה-agentId/sessionId/cwd/cliKind מבחוץ (ה-VM לא מחזיק
 * אותם אחרי refresh). מזריק אותם וקורא ל-#warmReconnect הקיים (WS לאותו agentId +
 * session/load על ה-process החי + MED-8). אם warm נכשל — שגיאה (לא cold-spawn, כי
 * cold ייכשל על session שה-CLI לא persisted).
 */
attachToLiveAgent = async (input: {
  agentId: string
  sessionId: string
  cwd: string
  cliKind: CliKind
}): Promise<void> => {
  this.error = null   // ⚠️ אביגיל 🔴: #warmReconnect מאפס bubbles אך לא error — נקה כאן כדי
                      // שלא יישאר error ישן אחרי re-attach מוצלח.
  // דפנסיבי: סגור חיבור קיים (אם המשתמש כבר מחובר ל-agent אחר)
  if (this.#transport) {
    await this.#transport.closeAndWait()
    this.#client = null
    this.#transport = null
  }
  this.#sessionId = input.sessionId
  this.cwd = input.cwd
  this.#cliKind = input.cliKind
  const ok = await this.#warmReconnect(input.agentId)
  if (!ok) {
    this.error = "reconnect failed: agent no longer available"   // ⚠️ ראה §6 — אסור עברית בקוד
    this.#setStatus("error")
  }
}
```

> ⚠️ ‏ה-`#warmReconnect` ‏כבר קובע `#setStatus("connected")` ‏בהצלחה. ‏המתודה רק מטפלת בכשל.
> ⚠️ **‏אביגיל 🟡**: `#warmReconnect` ‏קובע `#setStatus("connecting")` ‏**‏ישירות** (‏אין status-guard, ‏בניגוד ל-`loadSession`/`attach`/`switchSession`). ‏זה **‏מכוון** — `attachToLiveAgent` **‏לא** ‏צריך guard משלו, ‏ו-**‏אל תוסיף** ‏guard מיותר.
> ⚠️ **‏אין מחרוזת UI חדשה** — `this.error` ‏הוא מחרוזת טכנית (‏כמו `loadSession failed: ...` @569).
> ‏אם `lint:i18n` ‏חוסם — ‏חקה את הפורמט הקיים של `this.error` ב-`loadSession`/`switchSession` (‏אנגלית, ‏לא דרך `t()`; ‏ה-error מוצג ע"י שכבת ה-UI, ‏לא קשיח-עברית).

**Tests** (tdd) — `agent-session.reconnect.test.svelte.ts` (‏או קובץ test קיים ל-VM):
- mock `#warmReconnect` (‏דרך `_setFindReusableForTest`-style helper, ‏או stub `WsAcpTransport`/`createAcpClient` ‏כמו טסטי reconnect הקיימים) — ‏או טסט שמוודא ש-`attachToLiveAgent` ‏מזריק `#sessionId`/`cwd`/`#cliKind` ‏וקורא warm. ‏בדוק: ‏הצלחה → לא זורק; ‏כשל warm → `status==="error"` + `error` ‏מאוכלס.
- ‏השתמש בדפוס הטסטים הקיים (`agent-session.reconnect.test.svelte.ts` ‏מ-ws-reconnect-infra; `_setStatusForTest` helpers).

**Verification**: `pnpm --filter @drive-coding/frontend-v2 typecheck && pnpm test`.

---

### Commit 1 — חיווט `handleReconnect` (approach: manual) ⚠️ verifier-phase

**‏קובץ**: `packages/frontend/src/routes/+page.svelte` (`handleReconnect`, ~102-114).

```ts
// Before:
async function handleReconnect(agent: AgentPublic) {
  if (!agent.acpSessionId) return
  settings.setCliKind(agent.cliKind)
  settings.setLastCwd(agent.cwd)
  await session.loadSession({ sessionId: agent.acpSessionId, cwd: agent.cwd, cliKind: agent.cliKind })
  if (session.status === "connected") { await goto("/chat") }
}

// After:
async function handleReconnect(agent: AgentPublic) {
  if (!agent.acpSessionId) return
  settings.setCliKind(agent.cliKind)
  settings.setLastCwd(agent.cwd)
  await session.attachToLiveAgent({
    agentId: agent.id,
    sessionId: agent.acpSessionId,
    cwd: agent.cwd,
    cliKind: agent.cliKind,
  })
  if (session.status === "connected") { await goto("/chat") }
  // אם status==="error" — נשארים ב-/, ה-error מוצג (ה-VM קבע אותו)
}
```

> `agent.id` ‏הוא ה-agentId (‏מ-`AgentPublic`). `agent.acpSessionId` ‏מובטח לא-null (‏guard @103 + `isReconnectDisabled`).

**Verification**:
```
pnpm --filter @drive-coding/frontend-v2 typecheck && build && pnpm lint:i18n
```
‏**‏ידני (BE+FE חי)**: ‏צור agent, ‏שלח הודעה (‏כדי שיהיה turn), ‏חזור ל-`/`, ‏לחץ "התחבר מחדש" →
‏עובר ל-`/chat`, ‏השיחה משוחזרת, ‏**‏ב-BE log אין `createAgent`/spawn חדש** (warm), ‏אותו pid.

> **verifier-phase כאן** (calev mode:phase) — ‏זה ה-commit שמחבר reconnect אמיתי. ‏בדוק warm (אין spawn) + agent מת (שגיאה, לא קריסה).

---

### Commit 2 — Docs (approach: none)

- `docs/walkthrough.md` + ‏סטטוס brief.

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | typecheck + build נקי | `pnpm --filter @drive-coding/frontend-v2 typecheck && build` |
| 2 | tests ירוקים | `pnpm test` ‏מהשורש (‏כולל הטסט החדש) |
| 3 | lint:i18n | `pnpm lint:i18n` |
| 4 | **warm reconnect חי** | BE+FE חי: ‏צור agent + הודעה → `/` → "התחבר מחדש" → `/chat`, ‏שיחה חוזרת, **‏אין createAgent בלוג BE**, ‏אותו pid/agentId |
| 5 | **session/load מצליח** (‏לא "not found") | ‏ב-BE log / FE: ‏אין error -32002 ב-reconnect |
| 6 | agent מת → ‏שגיאה ברורה | ‏הרוג agent (kill בווידג'ט מאגent אחר) ‏או reaper → reconnect → `status:error`, ‏לא קריסה, ‏לא spawn |
| 7 | reconnect מושבת נכון | `!acpSessionId` ‏או `attached` → ‏כפתור disabled (‏ללא שינוי) |
| 8 | regression: connect רגיל + SessionPicker | ‏connect דרך הטופס + בחירת סשן → `loadSession` (cold) ‏עדיין עובד (‏לא שונה) |

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| **‏מחרוזת עברית קשיחה ב-`this.error`** | lint:i18n hook | ‏חקה את `this.error` ‏הקיים (`loadSession failed: ...` @569 — ‏אנגלית טכנית, ‏לא `t()`). ‏ה-error מוצג ע"י שכבת UI. DoD#3. |
| **warm-fail נופל ל-cold בטעות** | ‏העתקת דפוס `#doReconnect` | `attachToLiveAgent` ‏**‏לא** ‏קורא `#coldReconnect` — ‏רק `#warmReconnect` + שגיאה. ‏מכוון (cold ייכשל על session לא-persisted). |
| `#warmReconnect` ‏מסתמך על `this.#sessionId`/`this.cwd` | ‏מימוש קיים | ‏המתודה מזריקה אותם **‏לפני** ‏הקריאה. ‏אומת בקוד (374,380 קוראים `this.#sessionId!`/`this.cwd!`). |
| **MED-8 (טאב כפול)** ב-warm | ‏ws-agent 1008 | `#warmReconnect` ‏כבר מטפל (retry ×3 → false → שגיאה). `isReconnectDisabled` ‏כבר חוסם `attached===true`. |
| `#transport` ‏קיים (‏משתמש מחובר) → ‏WS דולף | state | ‏סגירת `closeAndWait` ‏דפנסיבית בתחילת המתודה (‏כמו `#doReconnect`@269). |
| `agent.id` ‏לא ה-agentId | schema | ‏אומת: `AgentPublic.id` = agentId (‏ה-`#warmReconnect` ‏בונה `/ws/agent/${agentId}`). |
| Svelte reactivity | `status`/`error` $state | ‏ללא שינוי — `#setStatus`/`error` ‏קיימים. |

> 3 ‏שתמיד נשכחים: (1) Hardcoded strings → `this.error` ‏אנגלית טכני (‏כמו קיים). ✅ (2) Reactivity → ‏ללא שינוי state model. ✅ (3) OneCLI → ‏לא רלוונטי (FE).

---

## §7 — Escalation triggers

- `#warmReconnect` ‏מצליח (`true`) ‏אבל ה-bubbles לא חוזרים / `session/load` ‏מחזיר ריק — ‏בעיה ב-CLI, ‏דווח.
- ‏claude `session/load` ‏על process חי **‏נכשל** ‏בכל זאת (‏בניגוד לאימות) — ‏עצור ושאל (‏אולי גרסת CLI שונה).
- ‏רוצה לשנות את `#warmReconnect` ‏עצמו (‏לא רק לקרוא לו) — ‏עצור (‏מחוץ ל-scope, ‏רגיש).
- ‏המתודה דורשת לשנות את חתימת `loadSession`/`reconnect` — ‏עצור (invasive).

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|------|------|
| ‏נגיעה ב-reconnect/WS flow (רגיש) | +2 |
| ‏reuse של לוגיקה קיימת (`#warmReconnect`) — ‏לא חדשה | -1 |
| VM method + 1 call-site (FE-only) | +1 |
| TDD על Commit 0 | -1 |
| ‏בדיקה חית מקצה-לקצה (WS, agent חי) | +1 |
| ‏בסיס glue | +2 (base) |
| ‏שרשור על תלות לא-merged | +1 |

**Score**: 5 / 10 (‏עוגל ל-6 בכותרת — ‏רגישות ה-reconnect).

**Tier**: `calev` (light) + `verifier-phase` ‏על **commit 1** (‏חיווט reconnect אמיתי).

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | warm נכשל → ‏שגיאה בלבד, ‏או ניסיון cold כ-fallback? | ‏**‏שגיאה בלבד** (cold ייכשל על session לא-persisted; ‏מטעה). | ❌ |
| 2 | ‏האם להציג toast/banner על שגיאת reconnect? | ‏לא בסלייס הזה — `this.error` ‏מספיק; ‏UI banner = ‏עתידי. | ❌ |
| 3 | ‏reconnect כש-`status` ‏כבר `connected` (‏משתמש מחובר ל-agent אחר)? | `closeAndWait` ‏דפנסיבי סוגר את הקיים. ‏מהווידג'ט ב-`/` ‏בד"כ idle. | ❌ |

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor)

- **בדיקה חית חסומה**: slice-active-agents-widget (base) אינו כולל cwd-fix-validate-windows. יצירת agent חי ב-Windows נכשלת ב-400. תועד כ-blocked-on-base — ייבדק ב-integration. הfix עצמו אומת מראש חי (WS ישיר, §0).
- **mock helper מורחב**: _mockWarmReconnectForTest גם מגדיר status="connected" בהצלחה (מחקה #warmReconnect האמיתי) — נדרש לhirautz tests נכונים.
