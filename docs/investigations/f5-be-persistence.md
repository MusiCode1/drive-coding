# Investigation: f5-be-persistence

> ‏Source finding: ‏`docs/slice-10-exploratory-test-report.md` ‏#F-5 (MAJOR).
> ‏Investigation date: 2026-05-18.
> ‏Mode: code-only (no runtime reproduction).
> ‏**Revision 2** (2026-05-18, ‏post-Avi feedback): ‏עודכן ‏לפי ‏הקונטקסט ‏הארכיטקטוני העדכני ‏וההחלטה ‏שהפתרון ‏יהיה ‏FE-only.

## Bug recap

‏אחרי BE restart ‏(crash או ידני) ‏`GET /api/agents` ‏מחזיר ‏`{"agents":[]}`. ‏Dashboard מציג "אין סוכנים פעילים". ‏ה-FE שעדיין מחזיק `agentId` ישן ‏(bookmark, ‏‏טאב פתוח, ‏PWA shortcut) ‏מקבל 404 ‏ומציג שגיאה גנרית. ‏‏ה-bridges הישנים גם נעלמים בפועל ‏‏כי ‏הם רצים ‏כ-child processes ‏ישירים של ‏BE — ‏‏‏מתים יחד איתו.

## Architectural context (‏חשוב לפני root cause)

‏ההחלטה ‏הארכיטקטונית ‏(אבי, ‏2026-05-18): ‏**BE כעת ‏מריץ את ‏ה-CLI ‏ישירות ‏ומחבר ‏ל-WebSocket — ‏‏לא ‏‏‏עוטף ‏ב-stdio-to-ws ‏‏עם `--persist`.** ‏זה ‏שינוי ‏יחסית ל-`docs/vnext-architecture.md:710-716` ‏(שמתאר ‏‏את ‏ה-wrapper ‏‏‏הישן ‏ש-`--persist` ‏בו). ‏‏השינוי ‏בוצע ‏‏כתגובה ל-F-1 ‏(BE ‏‏‏‏‏שורד spawn failures).

**משמעות:** ‏ה-bridges ‏‏‏לא ‏אמורים ‏לשרוד BE crash — ‏זה ‏‏ההתנהגות ‏הנכונה ‏‏‏לפי ‏‏ההחלטה ‏החדשה. ‏‏הbug ‏הוא ‏לא ‏"BE איבד ‏state ‏שהיה ‏‏צריך לשמור" ‏אלא ‏"FE ‏‏לא ‏‏‏מטפל ‏בגרציה ‏‏‏במצב ‏ש-agentId ‏‏הישן ‏‏לא קיים יותר".

## Root cause

### ‏‏1. ‏‏State ‏in-memory ב-BE — ‏**by design**

‏`packages/backend/src/agents/registry.ts:10-56` — ‏`createInMemoryAgentRegistry` ‏‏מחזיק ‏`store = new Map<string, Agent>()`. ‏מודה ‏בcomment שורה 7: ‏"נאבד ב-restart (D8 — acceptable ל-MVP)".
‏`packages/backend/src/app/agent-orchestrator.ts:85-89` — ‏`bridgePorts` + ‏`stderrGetters` ‏‏in-memory.
‏`packages/backend/src/server.ts:52` — ‏אינסטנס יחיד ב-boot, ‏ללא load מ-disk.

‏זה ‏‏‏מותאם ל-D8 ‏(‏`docs/vnext-architecture.md:167` — ‏"‏אין DB משלנו").

### ‏‏2. ‏ה-CLI children מתים ‏עם BE — ‏**by design (post-F-1)**

‏`packages/backend/src/acp/bridge-manager.ts:52-56`:

```ts
child = spawn(cli.bin, [...cli.args], {
  cwd: input.cwd,
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
})
```

‏ו-`cli-config.ts:22-25` — ‏`bin = "opencode acp"` ‏ישיר, ‏‏ללא `stdio-to-ws --persist`. ‏‏כש-BE מת: ‏stdin EOF → ‏ה-CLI children ‏יוצאים. ‏זה ‏ההתנהגות הנכונה ‏לפי ‏ההחלטה החדשה.

### ‏‏3. ‏FE ‏‏לא ‏מטפל ב-404 ‏על ‏agent

‏`packages/frontend/src/lib/stores/agent-session.svelte.ts:438`:

```ts
const agentRes = await fetch(`/api/agents/${agentId}`)
const agentData = (await agentRes.json()) as { agent?: { cwd?: string; acpSessionId?: string } }
```

‏‏אין בדיקה ‏ל-`!agentRes.ok`. ‏אם BE ‏החזיר ‏404, ‏`agentData.agent` ‏יהיה ‏`undefined`, ‏`agentCwd = "/"` ‏(fallback ‏גנרי) ‏וה-flow ‏ימשיך ‏לקרוס בהמשך. ‏זה ‏ה-root cause ‏האמיתי ‏של ‏הסימפטום שתועד.

‏`packages/frontend/src/lib/api/agents.ts:38-42`:

```ts
export async function getAgent(id: string): Promise<{ agent: AgentPublic }> {
  const res = await fetch(`${API_BASE}/api/agents/${id}`)
  if (!res.ok) throw new Error(`getAgent failed: ${res.status}`)
  return res.json()
}
```

‏‏‏‏‏הwrapper ‏הזה ‏כן ‏זורק, ‏אבל `agent-session.svelte.ts:438` ‏‏‏עוקף ‏אותו ‏(fetch ‏ידני) — ‏כנראה ‏‏שיירים מ-iteration קודמת.

### ‏‏4. ‏Dashboard ‏לא ‏מציע ‏‏‏המשך עבודה ‏מ-`/api/projects`

‏`packages/frontend/src/routes/+page.svelte:32` — ‏אם ‏`listAgents()` ‏מחזיר `[]`, ‏ה-dashboard ‏מציג ‏ריק. ‏הוא ‏לא ‏פונה ל-`/api/projects` ‏(‏שכן ‏מותמד ‏ב-`data/cache/projects-registry.json`) ‏‏כ-fallback ‏‏לרשימת ‏פרויקטים ‏זמינים ‏‏להמשך.

## Affected files

‏FE only (BE ‏הוא ‏by design):
- ‏`packages/frontend/src/lib/stores/agent-session.svelte.ts:438-489` — ‏אין ‏טיפול ‏ב-404
- ‏`packages/frontend/src/lib/api/agents.ts:38-42` — ‏`getAgent` ‏זורק ‏ב-404, ‏אבל ‏לא ‏מבחין ‏בינו ‏ל-500
- ‏`packages/frontend/src/routes/+page.svelte:32-40` — ‏אין fallback ‏ל-`/api/projects` ‏כש-agents ריקה
- ‏`packages/frontend/src/routes/agent/[id]/+page.svelte` — ‏ה-host ‏שמרים את ‏ה-store; ‏ייתכן ‏צריך ‏‏לתפוס ‏שגיאה ‏ב-`onMount`

‏BE (‏לקריאה ‏בלבד, ‏‏לא ‏‏לשינוי):
- ‏`packages/backend/src/agents/registry.ts:10-56` — ‏in-memory ‏מכוון
- ‏`packages/backend/src/acp/bridge-manager.ts:52-56` — ‏spawn ‏ישיר ‏מכוון
- ‏`packages/backend/src/app/projects-registry.ts:1-78` — ‏**יסוד ‏‏‏‏‏ה-recovery**: ‏מכיל ‏`{cwd, kind, lastSeen, lastSessionId?}` ‏לכל ‏פרויקט. ‏FE ‏ניגש דרך `/api/projects`.

## Reproduction

‏לא ‏שוחזר ‏(read-only). ‏העדויות ב-F-5 ‏מספיקות. ‏הקוד מאשר חד-משמעית את ‏הסיבה.

## Proposed fix — ‏FE auto-recovery on 404

‏‏ההחלטה ‏(אבי, 2026-05-18): ‏BE ‏לא ‏צריך ‏להיות mutated. ‏FE ‏צריך ‏לזהות 404 ‏על agent, ‏לבקש re-spawn ‏אוטומטית. ‏אם ‏ה-spawn ‏נכשל ‏(נתיב ‏נמחק, ‏‏שגיאה אחרת) — ‏הצג ‏הודעה ‏למשתמש.

### ‏‏‏החלק החסר: ‏איך FE ‏‏יודע ‏‏`{cwd, cliKind, acpSessionId}` ‏‏‏אחרי ‏ש-agentId ‏אבוד?

‏‏זו ‏‏‏‏השאלה ‏המרכזית. ‏ה-route `/agent/[id]` ‏‏מקבל ‏רק UUID — ‏‏‏‏אין ‏בו ‏‏הקשר ‏לcwd. ‏3 ‏אופציות:

#### Option A — ‏localStorage ‏cache

‏בכל `createAgent` ‏(`api/agents.ts:25`) — ‏write ‏ל-`localStorage["agent:" + agentId] = {cwd, cliKind, acpSessionId, savedAt}`. ‏‏ב-404 — ‏FE ‏שולף, ‏שולח POST ‏חדש ‏עם ‏אותו ‏`existingSessionId`, ‏‏מחליף את ‏‏ה-agentId ‏ב-URL ‏ב-`goto(replaceState: true)`. ‏אם ‏localStorage ריק (browser ‏‏אחר, ‏cleared) — ‏fall to ‏Option C.

‏✅ ‏‏פשוט, ‏‏‏0 ‏שינוי ‏לroutes, ‏‏ידידותי ‏‏‏ל-PWA / bookmarks ‏‏על ‏אותו ‏device.
‏❌ ‏‏לא ‏עובד ‏cross-device. ‏אם ‏המשתמש ‏‏פתח ‏‏‏‏‏שני ‏טאבים ‏ועשה ‏actions בשניהם, ‏ייתכן ‏ש-localStorage לא ‏‏‏סנכרני ‏עם ‏מה ‏ש-BE ראה ‏אחרון.

#### Option B — ‏‏שינוי URL pattern ל-`/session/[cwdHash]/[sessionId]`

‏ה-route ‏הזה ‏‏‏כבר ‏קיים ‏(`packages/frontend/src/routes/session/[cwdHash]/[id]/+page.svelte`) ‏עם ‏exact flow ‏‏שצריך: ‏‏מחפש cwd ‏ב-`/api/projects` ‏לפי hash, ‏שולח POST ‏עם `existingSessionId`. ‏‏‏‏האפשרות: ‏‏‏לסמן ‏את ‏`/agent/[id]` ‏‏כ-deprecated, ‏‏לשנות את ה-redirect ‏ב-`session/[cwdHash]/[id]/+page.svelte:47` ‏‏‏‏‏שיישאר ‏‏‏באותה ‏route ‏‏‏(לא ‏‏עובר ‏ל-`/agent/<id>`), ‏ולוודא ‏שכל ‏‏‏‏הקישורים ‏ל-agent ‏‏‏‏עוברים ‏‏לpattern הקבוע.

‏✅ ‏cross-device, ‏‏עמיד ל-BE restart, ‏‏לא ‏צריך client-side cache, ‏URL ‏הוא source of truth.
‏❌ ‏שינוי ‏‏בינוני ‏(routing migration, ‏עדכון ‏לינקים בכל מקום), ‏cwdHash ‏לפעמים ‏‏‏ארוך ‏ב-URL.

#### Option C — ‏Dashboard ‏fallback ‏עם ‏הודעה למשתמש

‏‏‏ב-404, ‏FE ‏‏מציג טוסט "‏הסוכן ‏נסגר — ‏בחר ‏פרויקט להמשך" ‏ומנווט ‏ל-`/` ‏(dashboard). ‏ה-dashboard ‏‏ירחיב ‏‏לכלול section "‏פרויקטים אחרונים" ‏שמושך מ-`/api/projects` ‏(‏‏עם lastSessionId). ‏המשתמש ‏‏בוחר ‏ידנית — ‏‏‏ה-FE ‏‏שולח POST ‏עם `existingSessionId`.

‏✅ ‏פשוט ביותר, ‏0 ‏cache, ‏0 ‏routing. ‏‏מטפל ‏גם ב-edge cases ‏(cwd ‏‏‏‏שנמחק — ‏פשוט ‏לא ‏יוצג).
‏❌ ‏‏‏לא ‏אוטומטי לגמרי — ‏‏‏המשתמש ‏‏‏צריך ‏click ‏אחד. ‏לאבי ‏‏‏לפי ‏ה-feedback ‏שלו ‏רצוי auto-recovery, ‏אז ‏זה ‏טיפה ‏פחות ‏אליגנטי.

### ‏‏המלצה: ‏A + C ‏‏בשילוב

1. **‏ראשי**: ‏`agent-session.svelte.ts` ‏ב-404 ‏מנסה ‏localStorage cache ‏→ ‏אם ‏יש — ‏re-spawn ‏שקט ‏(`Option A`), ‏‏מחליף agentId ‏ב-URL.
2. **‏Fallback**: ‏אם ‏localStorage ריק או ‏ה-spawn ‏‏‏‏נכשל (‏cwd ‏נמחק, ‏ENOENT, ‏‏וכו') → ‏טוסט + ‏ניווט ‏ל-`/` (`Option C`).
3. **Dashboard ‏הרחבה (`Option C` ‏חלקי)**: ‏אם ‏`listAgents() === []` ‏‏ו-`/api/projects` ‏לא ‏ריק — ‏הצג ‏section "‏‏‏פרויקטים ‏אחרונים" ‏עם ‏[‏המשך] לכל אחד.

‏Option B ‏‏(routing migration) ‏‏‏שווה ‏שיקול ‏‏‏בעתיד ‏אם ‏הצורך ‏ב-cross-device URL stability ‏‏‏‏‏יעלה, ‏אבל לא ‏‏‏‏ב-scope ‏של ‏הbug ‏‏הזה.

### Pseudo-code

```ts
// api/agents.ts — wrap createAgent to cache
export async function createAgent(input: CreateAgentInput): Promise<CreateAgentResponse> {
  const res = await fetch(`${API_BASE}/api/agents`, { ... })
  if (!res.ok) { ... }
  const data = await res.json()
  // NEW: cache for recovery
  localStorage.setItem(`agent:${data.agentId}`, JSON.stringify({
    cwd: data.cwd,
    cliKind: data.cliKind,
    acpSessionId: data.acpSessionId,
    savedAt: Date.now(),
  }))
  return data
}

// agent-session.svelte.ts — recovery on 404
const agentRes = await fetch(`/api/agents/${agentId}`)
if (agentRes.status === 404) {
  const cached = localStorage.getItem(`agent:${agentId}`)
  if (cached) {
    const { cwd, cliKind, acpSessionId } = JSON.parse(cached)
    try {
      const fresh = await createAgent({ cwd, cliKind, existingSessionId: acpSessionId })
      // Replace URL with new agentId, restart this flow
      goto(`/agent/${fresh.agentId}`, { replaceState: true })
      return
    } catch (e) {
      // cwd deleted / spawn failed — fall through to dashboard
      showToast(`לא ניתן לשחזר את הסוכן: ${e.message}`)
      goto("/")
      return
    }
  }
  // No cache — go to dashboard
  showToast("הסוכן נסגר — בחר פרויקט להמשך")
  goto("/")
  return
}
```

## Risks

- ‏**localStorage cache stale**: ‏אם BE ‏עבר rotation ‏על opencode session IDs (‏cleanup ‏‏פנימי ‏שלו) — ‏ה-`existingSessionId` ‏ייכשל ‏ב-loadSession. ‏‏‏הקוד ‏ב-`agent-session.svelte.ts:457-464` ‏כבר ‏עושה fallback ‏ל-newSession, ‏‏אז ‏‏בtechnical level ‏זה ‏‏מטופל. ‏‏UX-wise: ‏המשתמש ‏‏‏יראה ‏‏שיחה ‏ריקה ‏ולא יבין ‏שזה ‏סשן ‏‏חדש. ‏‏‏‏‏שווה ‏banner קטן "‏סשן ‏ישן ‏לא ‏‏זמין — ‏‏מתחילים ‏‏חדש".
- ‏**localStorage quota**: ‏‏כל ‏agent ‏‏מוסיף ‏‏‏~200 ‏בתים. ‏‏שווה ‏cleanup ‏periodic (TTL 30 ‏ימים ‏‏או ‏delete ‏ב-`deleteAgent` ‏‏בinitiation ‏מהמשתמש).
- ‏**Race condition**: ‏אם ‏‏‏המשתמש ‏‏‏לוחץ ‏refresh ‏‏בדיוק כש-BE ‏רץ מחדש ‏ועדיין ‏בstartup — ‏ייתכן 503 ‏או ‏connection refused, ‏לא 404. ‏צריך retry ‏קצר ‏לפני ‏‏‏הtreating as 404.
- ‏**Multi-tab**: ‏‏‏שני ‏טאבים פתוחים, ‏BE crash, ‏‏שניהם ‏‏מקבלים 404, ‏‏שניהם ‏עושים re-spawn ‏‏‏עם ‏אותו ‏existingSessionId. ‏BE ‏יש dedup ‏ב-`agent-orchestrator.ts:118-138` — ‏השני ‏יקבל ‏את ‏‏ה-agent ‏שהראשון יצר. ‏טוב.

## Open questions for Avi

1. **‏Option ‏לבחור**: ‏אישרת ‏אוטומטיזציה ‏(לא ‏רק ‏Option ‏C ‏ידני). ‏‏‏עדיף ‏Option A ‏(localStorage cache) ‏או ‏‏‏שווה ‏לשקול ‏‏Option ‏B ‏(routing migration ‏‏‏‏ל-`/session/[cwdHash]/[id]`) ‏בתור ‏fix ‏‏‏מהותי יותר? ‏ההמלצה ‏שלי: ‏A + ‏‏fallback ל-C, ‏ולשמור ‏B ‏‏ל-slice עתידי.

2. **‏Banner ‏"סשן ‏ישן ‏אבוד"**: ‏‏כש-loadSession ‏‏נכשל ‏ו-fallback ל-newSession — ‏‏האם ‏‏להציג ‏‏‏banner ‏שהמשתמש ‏‏יבין ‏שהוא ‏לא ‏‏‏ממשיך ‏שיחה, ‏או ‏‏לדלג בשקט?

3. **Dashboard ‏"פרויקטים ‏אחרונים"**: ‏‏‏רוצה ‏שזה ‏יהיה ‏בscope ‏של ‏‏הbug ‏הזה, ‏‏‏או ‏slice ‏‏נפרד? ‏זה ‏~30 ‏שורות FE ‏נוספות.

4. **Cleanup ‏ל-localStorage**: ‏‏TTL ‏(‏30 ‏ימים?) ‏או ‏‏cleanup רק ‏ב-`deleteAgent` ‏מפורש? ‏אם ‏המשתמש ‏מוחק 50 ‏agents ‏בלי refresh — ‏הcache ‏‏יגדל. ‏לא קריטי ‏אבל ‏שווה ‏‏‏החלטה.

## Estimated effort

| חלק | LoC | קבצים | Tests | זמן |
|-----|-----|--------|-------|-----|
| localStorage cache ב-`createAgent` | ~15 | 1 (api/agents.ts) | 1 unit | 30 ‏דקות |
| 404 handler ב-`agent-session.svelte.ts` | ~30 | 1 | 1 unit + 1 e2e | 1-2 ‏שעות |
| Toast component (אם ‏‏לא ‏קיים) | ~40 | 1-2 | 1 | 1 ‏שעה |
| Dashboard ‏"פרויקטים ‏אחרונים" (Option C ‏extension) | ~50 | 1 | 1 e2e | 1-2 ‏שעות |
| ‏סה"כ (‏לא ‏כולל ‏Dashboard) | ~85 | 3-4 | 3 | **2-3 ‏שעות** |
| ‏סה"כ (כולל ‏Dashboard) | ~135 | 4-5 | 4 | **‏יום עבודה** |
