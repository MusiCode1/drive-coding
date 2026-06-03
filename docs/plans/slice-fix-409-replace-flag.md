# Slice fix-409-replace-flag — דגל replace ל-session-attached (warm switch) — תוכנית

> **תאריך**: 2026-06-03
> **סטטוס**: הושלם ✅ (אליעזר, 2026-06-03) — branch fix-409-replace-flag, 2 commits (cad822d, 70bf7ce), calev pending
> **Complexity**: 3/10 (verifier: calev light + phase על Commit 1)
> **תלויות (`depends_on`)**: [] — בנוי ישירות על dev (switch-session כבר merged)
> **Base**: dev (`91654d3` — docs-only מעל 53a5db1; 3 קבצי היעד לא נגעו, line numbers תקפים)
> **Dev tip**: `91654d3`

---

## §0 — Pre-flight

### תלויות (חובה!)

slice זה **אין לו תלויות** — בנוי על dev. כל מה שצריך כבר merged:
- `AgentSession.switchSession()` — קיים (`agent-session.svelte.ts:288-336`, קורא `notifySessionAttached` ב-326).
- `notifySessionAttached(agentId, sessionId)` — `adapters/agents-api.ts:61`.
- `POST /api/agents/:id/session-attached` + guard MED-9 — `backend/src/delivery/http-agents.ts:98-133`.
- `AgentRegistry.update(id, { ...acpSessionId })` — `core/ports.ts:25-28` (כבר תומך, ללא שינוי).

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/fix-409-replace -b fix-409-replace dev
cd .worktrees/fix-409-replace
pnpm install && pnpm hooks:install
pnpm --filter @drive-coding/frontend-v2 exec svelte-kit sync
```

### איך להריץ

| מה | פקודה |
|---|---|
| typecheck FE | `pnpm --filter @drive-coding/frontend-v2 typecheck` (TS6305: `find packages -name '*.tsbuildinfo' -delete` + `pnpm --filter @drive-coding/core build`) |
| typecheck BE | `pnpm --filter @drive-coding/backend typecheck` |
| tests | `pnpm test` מה-root (כולל core+BE). FE: `pnpm --filter @drive-coding/frontend-v2 test` |
| build | `pnpm --filter @drive-coding/frontend-v2 build` |
| lint:i18n | `pnpm lint:i18n` (חובה לפני commit) |

> ⚠️ שם package ה-FE: `@drive-coding/frontend-v2`.

### סביבה לאימות runtime (Commit 1)

צריך BE עם OneCLI + tunnel (כמו ב-slice-sessions-inline). אם לא מורם — הרם:
```bash
# BE על port פנוי (4011 אם פנוי) + מגיש FE build (same-origin)
cd packages/backend
FE_STATIC_DIR=$PWD/../frontend/build \
  CORS_ORIGINS="https://musicode-fix409.tuns.sh,http://localhost:4011" \
  PORT=4011 onecli run --agent voice-acp -- bun src/server.ts
# tunnel:
ssh -i ~/.ssh/pico -R fix409:80:localhost:4011 tuns.sh
# build FE קודם: pnpm --filter @drive-coding/frontend-v2 build
```
> אם אין גישה ל-tunnel/דפדפן — דווח למרדכי לאימות ידני.

### Reading list

**must-read**:
- `packages/backend/src/delivery/http-agents.ts:98-133` — ה-endpoint + guard MED-9 (שורה 117).
- `packages/frontend/src/lib/adapters/agents-api.ts:61-73` — `notifySessionAttached` (הדפוס לחיקוי).
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts:326` — קריאת switchSession.
- `docs/decisions/voice-acp.md` (entry 2026-06-03 sessions-inline) — רקע על ה-409.

**reference**:
- `packages/core/src/ports.ts:14-32` — AgentRegistry interface (update כבר תומך ב-acpSessionId).
- `packages/backend/src/app/agent-orchestrator.ts:117-136` — איפה acpSessionId נצרך (dedup, כרגע B2-dead).

---

## §1 — מטרה

**הבאג**: כל `switchSession` (warm) קורא `notifySessionAttached(agentId, newSessionId)`, אבל
ה-BE guard MED-9 (`http-agents.ts:117`) מחזיר **409** כש-agent כבר "ready" עם sessionId אחר.
התוצאה: ה-`.catch(()=>{})` בולע את ה-409, המשתמשת לא רואה, אבל **ה-BE registry נשאר עם
ה-sessionId הישן** → סיכון ש-recovery עתידי (slice 10) ישחזר את הסשן הלא-נכון.

**הפתרון (גישה B — דגל מפורש)**: warm switch מצהיר על כוונתו עם `replace: true`. ה-BE
מאפשר update כשהדגל מורם; ה-guard MED-9 **נשאר אפקטיבי** ל-attach/loadSession רגיל (בלי
הדגל) — כך ההגנה מפני דריסה לא-מכוונת נשמרת בדיוק במקום הנכון.

> **למה גישה B ולא A (החלטת משתמשת)**: לא לזרוק את ה-guard. attach רגיל שנתקל ב-agent
> ready עם סשן אחר = עדיין אנומליה ראויה ל-409. רק warm switch (פעולה מכוונת) מצהיר replace.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| BE: body מקבל `replace?: boolean`; guard MED-9 מדלג כש-replace===true | ✅ | Commit 1 |
| FE adapter: `notifySessionAttached(agentId, sessionId, opts?: {replace?})` | ✅ | Commit 1 |
| FE VM: `switchSession` שולח `{ replace: true }` | ✅ | Commit 1 |
| attach/loadSession הקיימים — **ללא שינוי** (replace=false ברירת-מחדל) | ✅ | (לא נוגעים) |
| הסרת guard MED-9 לגמרי | ❌ | **לא** — זו גישה A שנדחתה. הדגל שומר את ה-guard. |
| recovery flow / שימוש ב-acpSessionId המעודכן | ❌ | slice עתידי (10). כאן רק מתקנים את ה-staleness. |
| client-token / זהות-קורא אמיתית | ❌ | over-engineering ל-slice הזה. replace-flag מספיק. |

---

## §3 — Architecture

```
FE switchSession (warm)            FE attach / loadSession (חיבור ראשון)
   │ replace: true                    │ (ללא replace → false)
   ▼                                  ▼
notifySessionAttached(id, sess, {replace:true})    notifySessionAttached(id, sess)
   │                                  │
   └──────────────┬───────────────────┘
                  ▼
   POST /api/agents/:id/session-attached  { sessionId, replace? }
                  │
   guard MED-9:  if (!replace && status===ready && acpSessionId && acpSessionId!==sessionId)
                  │                                              → 409 (רק כש-replace=false)
                  ▼
   registry.update(id, { status:"ready", acpSessionId: sessionId })  ← תמיד מתעדכן
   projectsRegistry.recordSession(cwd, sessionId)                    ← הסשן החדש נרשם
```

---

## §4 — Commits

### Commit 1 — replace flag דרך 3 השכבות (approach: integration)

**קבצים שמשתנים** (3):
1. `packages/backend/src/delivery/http-agents.ts`
2. `packages/frontend/src/lib/adapters/agents-api.ts`
3. `packages/frontend/src/lib/view-models/agent-session.svelte.ts`

**4.א — BE endpoint (`http-agents.ts`)**

חלץ `replace` מה-body (שורה 108) + עדכן את ה-guard (שורה 117):
```ts
const { sessionId, replace } = body as Record<string, unknown>
if (typeof sessionId !== "string" || !sessionId) {
  return c.json({ error: "sessionId is required" }, 400)
}

const agent = await deps.registry.get(agentId)
if (!agent) return c.json({ error: "agent not found" }, 404)

// שומר MED-9: חוסם דריסה לא-מכוונת. warm switch מצהיר replace:true ועוקף ביודעין.
if (replace !== true && agent.status === "ready" && agent.acpSessionId && agent.acpSessionId !== sessionId) {
  return c.json({ error: "agent already attached to a different session" }, 409)
}

// מסמן ready + מעדכן acpSessionId (גם בהחלפה — זה מה שמתקן את ה-staleness)
await deps.registry.update(agentId, { status: "ready", acpSessionId: sessionId })
// ... projectsRegistry.recordSession כפי שהוא (שורות 124-130, ללא שינוי) ...
```
- **דרישה**: `replace !== true` (לא `!replace`) — כדי שערך לא-בוליאני (undefined/string) ייחשב כ-false. שמרני.
- עדכן את ה-doc-comment (שורה 93-96): `Body: { sessionId, replace? }` + הסבר ה-flag.

**4.ב — FE adapter (`agents-api.ts:61-73`)**

הרחב את החתימה (additive, opts אופציונלי):
```ts
export async function notifySessionAttached(
  agentId: string,
  sessionId: string,
  opts?: { replace?: boolean },
): Promise<void> {
  await withTimeout(
    (s) =>
      fetch(beUrl(`/api/agents/${agentId}/session-attached`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, ...(opts?.replace ? { replace: true } : {}) }),
        signal: s,
      }),
    AGENTS_API_TIMEOUT_MS,
    { label: "notifySessionAttached" },
  )
}
```
- **תאימות לאחור**: 2 הקוראים הקיימים (attach `agent-session.svelte.ts:147`, loadSession `:266`)
  לא משתנים — בלי opts → body בלי replace → guard פעיל אצלם. **אל תיגע בהם.**

**4.ג — FE VM (`agent-session.svelte.ts:326`)**

בתוך `switchSession` בלבד, הוסף `{ replace: true }`:
```ts
await notifySessionAttached(this.agentId, input.sessionId, { replace: true }).catch(() => {})
```
- רק השורה הזו. שאר switchSession ללא שינוי.

**Verification (Commit 1)**:
```bash
pnpm --filter @drive-coding/backend typecheck
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm test                     # core + BE + FE
pnpm lint:i18n
pnpm --filter @drive-coding/frontend-v2 build
```

### Commit 2 — טסט BE ל-replace (approach: integration/tdd)

**קובץ**: טסט קיים ל-session-attached (אם יש) או חדש.
- מצא: `grep -rln "session-attached" packages/backend/**/*.test.ts`.
- הוסף 2 טסטים:
  1. **replace=false (ברירת מחדל)**: agent ready עם sessionId="A", POST {sessionId:"B"} (בלי replace) → **409**, registry נשאר "A".
  2. **replace=true**: agent ready עם sessionId="A", POST {sessionId:"B", replace:true} → **200 ok:true**, registry מתעדכן ל-"B".
- אם אין טסט קיים ל-endpoint — צור `http-agents` integration test לפי הדפוס בקבצי הטסט הקיימים ב-`packages/backend/`.

### Commit 3 — walkthrough (approach: docs)
- עדכן `docs/walkthrough.md` — entry קצר.
- **אל תיגע ב-`docs/decisions/voice-acp.md`** — מרדכי כותב decisions.

---

## §5 — Definition of Done

1. BE typecheck נקי.
2. FE typecheck נקי.
3. build נקי.
4. lint:i18n נקי.
5. כל הטסטים עוברים (אין רגרסיה).
6. BE: body מקבל `replace?`; guard מדלג רק כש-`replace===true`.
7. BE: `replace !== true` (לא `!replace`) — ערך לא-בוליאני נחשב false.
8. FE adapter: `notifySessionAttached` מקבל `opts?.replace`, body כולל replace רק כשמורם.
9. attach (`:147`) + loadSession (`:266`) — **ללא שינוי** (בלי replace).
10. `switchSession` (`:326`) שולח `{ replace: true }`.
11. טסט BE: replace=false → 409 + registry לא משתנה; replace=true → 200 + registry מתעדכן.
12. **runtime (calev)**: warm switch דרך ה-UI (tunnel) — **אין 409 בלוג BE** (היה 409 לפני);
    החלפת סשן עובדת; ה-BE registry מתעדכן ל-sessionId החדש (אם ניתן לאמת — דרך לוג/state).
13. רגרסיה: חיבור ראשון (attach) עדיין עובד; אין 409 לא-צפוי בחיבור רגיל.

---

## §6 — סיכונים

- **`replace` כ-`unknown` מ-body**: ה-cast הוא `Record<string, unknown>`. השוואת `replace !== true`
  בטוחה (boolean strict). אל תשתמש ב-`!replace` (יתפוס גם undefined כ-truthy-negation, אבל גם
  string ריק וכו' — `!== true` חד-משמעי).
- **recordSession בהחלפה**: שורה 129 תרשום את ה-sessionId החדש ב-projectsRegistry. זה רצוי
  (מתקן את ה-staleness). ודא שזה לא שובר recovery קיים (אין recovery מומש עדיין — בטוח).
- **2 הקוראים הקיימים**: אם בטעות תוסיף replace ל-attach/loadSession → תשבור את ההגנה.
  ה-DoD#9 בודק שהם ללא שינוי.

---

## §7 — בדיקה ידנית (אחרי build)

1. tunnel → Connect ל-cwd. שלח פרומפט (כדי שה-agent יהיה "ready" עם sessionId).
2. פתח panel → Sessions → Refresh → בחר סשן אחר.
3. **BE log**: לפני התיקון היה 409 על `/session-attached`. אחרי — **אין 409**, ה-update עובר.
4. (אם אפשר) בדוק שה-registry/state מציג את ה-sessionId החדש, לא הישן.
5. רגרסיה: התנתק, התחבר מחדש (attach) → אין 409.

---

## §8 — Complexity

3/10. שינוי additive ב-3 קבצים (שורות בודדות בכל אחד) + 2 טסטים. הסיכון העיקרי
הוא נכונות ה-guard ו-runtime (שה-409 באמת נעלם), לכן verifier = **calev light + phase על
Commit 1**. לא heavy — אין edge-case-hunting כבד.
