# Investigation: f5-be-persistence

> Source finding: `docs/slice-10-exploratory-test-report.md` #F-5 (MAJOR).
> Investigation date: 2026-05-18.
> Mode: code-only (no runtime reproduction).
>
> **הוראה לכל סוכן שמעדכן את המסמך הזה:** אל תמחק טקסט קיים. הוסף Revision חדש בסוף הקובץ עם תאריך ועם ציון אילו סעיפים מהקודמים לא רלוונטיים יותר. הטקסט הישן נשאר כדי שיהיה קל להבין את ההקשר וההתפתחות של ההחלטה.
>
> **Revision 2** (2026-05-18, post-Avi feedback): עודכן לפי הקונטקסט הארכיטקטוני העדכני וההחלטה שהפתרון יהיה FE-only.
> **Revision 3** (2026-05-18, post-code-read): מתחת — Proposed fix ממוקד עם localStorage cache מלא, מבוסס בדיקה מעמיקה של ה-FE flow. סעיף "Proposed fix" ב-Revision 2 (אופציות A/B/C) אינו רלוונטי יותר — בחירת אבי היא Option A מורחבת (cache מלא, לא רק cwd+sessionId).

## Bug recap

אחרי BE restart (crash או ידני) `GET /api/agents` מחזיר `{"agents":[]}`. Dashboard מציג "אין סוכנים פעילים". ה-FE שעדיין מחזיק `agentId` ישן (bookmark, טאב פתוח, PWA shortcut) מקבל 404 ומציג שגיאה גנרית. ה-bridges הישנים גם נעלמים בפועל כי הם רצים כ-child processes ישירים של BE — מתים יחד איתו.

## Architectural context (חשוב לפני root cause)

ההחלטה הארכיטקטונית (אבי, 2026-05-18): **BE כעת מריץ את ה-CLI ישירות ומחבר ל-WebSocket — לא עוטף ב-stdio-to-ws עם `--persist`.** זה שינוי יחסית ל-`docs/vnext-architecture.md:710-716` (שמתאר את ה-wrapper הישן ש-`--persist` בו). השינוי בוצע כתגובה ל-F-1 (BE שורד spawn failures).

**משמעות:** ה-bridges לא אמורים לשרוד BE crash — זה ההתנהגות הנכונה לפי ההחלטה החדשה. הbug הוא לא "BE איבד state שהיה צריך לשמור" אלא "FE לא מטפל בגרציה במצב ש-agentId הישן לא קיים יותר".

## Root cause

### 1. State in-memory ב-BE — **by design**

`packages/backend/src/agents/registry.ts:10-56` — `createInMemoryAgentRegistry` מחזיק `store = new Map<string, Agent>()`. מודה בcomment שורה 7: "נאבד ב-restart (D8 — acceptable ל-MVP)".
`packages/backend/src/app/agent-orchestrator.ts:85-89` — `bridgePorts` + `stderrGetters` in-memory.
`packages/backend/src/server.ts:52` — אינסטנס יחיד ב-boot, ללא load מ-disk.

זה מותאם ל-D8 (`docs/vnext-architecture.md:167` — "אין DB משלנו").

### 2. ה-CLI children מתים עם BE — **by design (post-F-1)**

`packages/backend/src/acp/bridge-manager.ts:52-56`:

```ts
child = spawn(cli.bin, [...cli.args], {
  cwd: input.cwd,
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
})
```

ו-`cli-config.ts:22-25` — `bin = "opencode acp"` ישיר, ללא `stdio-to-ws --persist`. כש-BE מת: stdin EOF → ה-CLI children יוצאים. זה ההתנהגות הנכונה לפי ההחלטה החדשה.

### 3. FE לא מטפל ב-404 על agent

`packages/frontend/src/lib/stores/agent-session.svelte.ts:438`:

```ts
const agentRes = await fetch(`/api/agents/${agentId}`)
const agentData = (await agentRes.json()) as { agent?: { cwd?: string; acpSessionId?: string } }
```

אין בדיקה ל-`!agentRes.ok`. אם BE החזיר 404, `agentData.agent` יהיה `undefined`, `agentCwd = "/"` (fallback גנרי) וה-flow ימשיך לקרוס בהמשך. זה ה-root cause האמיתי של הסימפטום שתועד.

`packages/frontend/src/lib/api/agents.ts:38-42`:

```ts
export async function getAgent(id: string): Promise<{ agent: AgentPublic }> {
  const res = await fetch(`${API_BASE}/api/agents/${id}`)
  if (!res.ok) throw new Error(`getAgent failed: ${res.status}`)
  return res.json()
}
```

הwrapper הזה כן זורק, אבל `agent-session.svelte.ts:438` עוקף אותו (fetch ידני) — כנראה שיירים מ-iteration קודמת.

### 4. Dashboard לא מציע המשך עבודה מ-`/api/projects`

`packages/frontend/src/routes/+page.svelte:32` — אם `listAgents()` מחזיר `[]`, ה-dashboard מציג ריק. הוא לא פונה ל-`/api/projects` (שכן מותמד ב-`data/cache/projects-registry.json`) כ-fallback לרשימת פרויקטים זמינים להמשך.

## Affected files

FE only (BE הוא by design):
- `packages/frontend/src/lib/stores/agent-session.svelte.ts:438-489` — אין טיפול ב-404
- `packages/frontend/src/lib/api/agents.ts:38-42` — `getAgent` זורק ב-404, אבל לא מבחין בינו ל-500
- `packages/frontend/src/routes/+page.svelte:32-40` — אין fallback ל-`/api/projects` כש-agents ריקה
- `packages/frontend/src/routes/agent/[id]/+page.svelte` — ה-host שמרים את ה-store; ייתכן צריך לתפוס שגיאה ב-`onMount`

BE (לקריאה בלבד, לא לשינוי):
- `packages/backend/src/agents/registry.ts:10-56` — in-memory מכוון
- `packages/backend/src/acp/bridge-manager.ts:52-56` — spawn ישיר מכוון
- `packages/backend/src/app/projects-registry.ts:1-78` — **יסוד ה-recovery**: מכיל `{cwd, kind, lastSeen, lastSessionId?}` לכל פרויקט. FE ניגש דרך `/api/projects`.

## Reproduction

לא שוחזר (read-only). העדויות ב-F-5 מספיקות. הקוד מאשר חד-משמעית את הסיבה.

## Proposed fix — FE auto-recovery on 404

ההחלטה (אבי, 2026-05-18): BE לא צריך להיות mutated. FE צריך לזהות 404 על agent, לבקש re-spawn אוטומטית. אם ה-spawn נכשל (נתיב נמחק, שגיאה אחרת) — הצג הודעה למשתמש.

### החלק החסר: איך FE יודע `{cwd, cliKind, acpSessionId}` אחרי ש-agentId אבוד?

זו השאלה המרכזית. ה-route `/agent/[id]` מקבל רק UUID — אין בו הקשר לcwd. 3 אופציות:

#### Option A — localStorage cache

בכל `createAgent` (`api/agents.ts:25`) — write ל-`localStorage["agent:" + agentId] = {cwd, cliKind, acpSessionId, savedAt}`. ב-404 — FE שולף, שולח POST חדש עם אותו `existingSessionId`, מחליף את ה-agentId ב-URL ב-`goto(replaceState: true)`. אם localStorage ריק (browser אחר, cleared) — fall to Option C.

✅ פשוט, 0 שינוי לroutes, ידידותי ל-PWA / bookmarks על אותו device.
❌ לא עובד cross-device. אם המשתמש פתח שני טאבים ועשה actions בשניהם, ייתכן ש-localStorage לא סנכרני עם מה ש-BE ראה אחרון.

#### Option B — שינוי URL pattern ל-`/session/[cwdHash]/[sessionId]`

ה-route הזה כבר קיים (`packages/frontend/src/routes/session/[cwdHash]/[id]/+page.svelte`) עם exact flow שצריך: מחפש cwd ב-`/api/projects` לפי hash, שולח POST עם `existingSessionId`. האפשרות: לסמן את `/agent/[id]` כ-deprecated, לשנות את ה-redirect ב-`session/[cwdHash]/[id]/+page.svelte:47` שיישאר באותה route (לא עובר ל-`/agent/<id>`), ולוודא שכל הקישורים ל-agent עוברים לpattern הקבוע.

✅ cross-device, עמיד ל-BE restart, לא צריך client-side cache, URL הוא source of truth.
❌ שינוי בינוני (routing migration, עדכון לינקים בכל מקום), cwdHash לפעמים ארוך ב-URL.

#### Option C — Dashboard fallback עם הודעה למשתמש

ב-404, FE מציג טוסט "הסוכן נסגר — בחר פרויקט להמשך" ומנווט ל-`/` (dashboard). ה-dashboard ירחיב לכלול section "פרויקטים אחרונים" שמושך מ-`/api/projects` (עם lastSessionId). המשתמש בוחר ידנית — ה-FE שולח POST עם `existingSessionId`.

✅ פשוט ביותר, 0 cache, 0 routing. מטפל גם ב-edge cases (cwd שנמחק — פשוט לא יוצג).
❌ לא אוטומטי לגמרי — המשתמש צריך click אחד. לאבי לפי ה-feedback שלו רצוי auto-recovery, אז זה טיפה פחות אליגנטי.

### המלצה: A + C בשילוב

1. **ראשי**: `agent-session.svelte.ts` ב-404 מנסה localStorage cache → אם יש — re-spawn שקט (`Option A`), מחליף agentId ב-URL.
2. **Fallback**: אם localStorage ריק או ה-spawn נכשל (cwd נמחק, ENOENT, וכו') → טוסט + ניווט ל-`/` (`Option C`).
3. **Dashboard הרחבה (`Option C` חלקי)**: אם `listAgents() === []` ו-`/api/projects` לא ריק — הצג section "פרויקטים אחרונים" עם [המשך] לכל אחד.

Option B (routing migration) שווה שיקול בעתיד אם הצורך ב-cross-device URL stability יעלה, אבל לא ב-scope של הbug הזה.

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

- **localStorage cache stale**: אם BE עבר rotation על opencode session IDs (cleanup פנימי שלו) — ה-`existingSessionId` ייכשל ב-loadSession. הקוד ב-`agent-session.svelte.ts:457-464` כבר עושה fallback ל-newSession, אז בtechnical level זה מטופל. UX-wise: המשתמש יראה שיחה ריקה ולא יבין שזה סשן חדש. שווה banner קטן "סשן ישן לא זמין — מתחילים חדש".
- **localStorage quota**: כל agent מוסיף ~200 בתים. שווה cleanup periodic (TTL 30 ימים או delete ב-`deleteAgent` בinitiation מהמשתמש).
- **Race condition**: אם המשתמש לוחץ refresh בדיוק כש-BE רץ מחדש ועדיין בstartup — ייתכן 503 או connection refused, לא 404. צריך retry קצר לפני הtreating as 404.
- **Multi-tab**: שני טאבים פתוחים, BE crash, שניהם מקבלים 404, שניהם עושים re-spawn עם אותו existingSessionId. BE יש dedup ב-`agent-orchestrator.ts:118-138` — השני יקבל את ה-agent שהראשון יצר. טוב.

## Open questions for Avi

1. **Option לבחור**: אישרת אוטומטיזציה (לא רק Option C ידני). עדיף Option A (localStorage cache) או שווה לשקול Option B (routing migration ל-`/session/[cwdHash]/[id]`) בתור fix מהותי יותר? ההמלצה שלי: A + fallback ל-C, ולשמור B ל-slice עתידי.

2. **Banner "סשן ישן אבוד"**: כש-loadSession נכשל ו-fallback ל-newSession — האם להציג banner שהמשתמש יבין שהוא לא ממשיך שיחה, או לדלג בשקט?

3. **Dashboard "פרויקטים אחרונים"**: רוצה שזה יהיה בscope של הbug הזה, או slice נפרד? זה ~30 שורות FE נוספות.

4. **Cleanup ל-localStorage**: TTL (30 ימים?) או cleanup רק ב-`deleteAgent` מפורש? אם המשתמש מוחק 50 agents בלי refresh — הcache יגדל. לא קריטי אבל שווה החלטה.

## Estimated effort

| חלק | LoC | קבצים | Tests | זמן |
|-----|-----|--------|-------|-----|
| localStorage cache ב-`createAgent` | ~15 | 1 (api/agents.ts) | 1 unit | 30 דקות |
| 404 handler ב-`agent-session.svelte.ts` | ~30 | 1 | 1 unit + 1 e2e | 1-2 שעות |
| Toast component (אם לא קיים) | ~40 | 1-2 | 1 | 1 שעה |
| Dashboard "פרויקטים אחרונים" (Option C extension) | ~50 | 1 | 1 e2e | 1-2 שעות |
| סה"כ (לא כולל Dashboard) | ~85 | 3-4 | 3 | **2-3 שעות** |
| סה"כ (כולל Dashboard) | ~135 | 4-5 | 4 | **יום עבודה** |

---

# Revision 3 — פתרון ממוקד עם localStorage cache מלא

> תאריך: 2026-05-18.
> ההחלטה של אבי: localStorage cache מלא (כל הנתונים שצריך לrecover), לא רק cwd+sessionId. אופציות B ו-C מ-Revision 2 לא נבחרו.
> הסעיפים הבאים מ-Revision 2 אינם רלוונטיים יותר: "Proposed fix — FE auto-recovery on 404" (כולל Options A/B/C וההמלצה). סעיפי Risks/Open questions/Effort מ-Revision 2 בעלי ערך רקע אבל מוחלפים בסעיפים המקבילים למטה.

## ממצאים חדשים מבדיקת הקוד

### 1. cwdHash הוא דטרמיניסטי

`packages/core/src/cwd-hash.ts:29` — `cwdToHash(cwd) = SHA-256(cwd)` base64url, מחושב בFE ובBE. אין צורך לשמור מיפוי בשום מקום — כל מי שיש לו cwd, יש לו hash, ולהיפך הוא לפי `/api/projects` (שמותמד ב-`data/cache/projects-registry.json`). זה מבטל את הדאגה שאבי העלה לגבי Option B (שלא מצריך מימוש מצדנו בכל מקרה).

### 2. יש תבנית localStorage קיימת ב-FE

`packages/frontend/src/lib/stores/playback-storage.ts` — רשום ב-key `voice-acp:playback:<agentId>`, TTL 24h, load/save/clear עם try/catch ל-quota. אעשה fileחדש `agent-storage.ts` לפי אותה תבנית.

### 3. ה-trigger האמיתי הוא WS close 1008, לא HTTP 404

ב-`agent-session.svelte.ts:404-435` ה-`createAcpClient(agentId)` רץ **ראשון** (שורה 435). רק אחריו (שורה 438) בא ה-fetch ל-`/api/agents/<id>`. אחרי BE restart:

- WS מתחבר ל-`/ws/agent/<oldId>`
- BE: `ws-agent.ts:56-60` — `bridgeManager.getChild(<oldId>)` מחזיר `null` → `feWs.close(1008, "agent not found")`
- FE: `handleWsClose(1008, "agent not found")` שורות 417-421 מטפל ב-1008 אבל **לא בודק reason** — מציג "סוכן בשימוש ב-tab אחר" גם כש-reason הוא "agent not found". זה bug בפני עצמו שגם הוא צריך לטיפול ב-fix.

ה-recovery לכן חייב להיות מבוסס על ה-WS close 1008 עם reason "agent not found" — לא על HTTP 404 שמגיע מאוחר מדי.

### 4. ה-route מטפל אוטומטית בשינוי agentId

`packages/frontend/src/routes/agent/[id]/+page.svelte:47-59` יש `$effect` שעוקב אחרי `agentId` (מ-`page.params.id`). כשהוא משתנה — הוא עושה `session.disconnect()` ויוצר stores חדשים. זה אומר ש-`goto(/agent/<newId>, { replaceState: true })` מהrecovery יביא אוטומטית לחיבור מחדש עם ה-agentId החדש, ללא שום שינוי בקוד ה-route עצמו.

## פתרון מפורט

### שלב 1 — קובץ חדש: `packages/frontend/src/lib/stores/agent-storage.ts`

```ts
/**
 * agent-storage.ts — localStorage cache של נתוני agent ל-recovery אחרי BE restart.
 * 
 * Key: "voice-acp:agent:<agentId>"
 * TTL: 7 ימים (ארוך מדי עבור opencode שעלול לעשות session rotation, אבל סביר עבור bookmarks)
 */

const KEY_PREFIX = "voice-acp:agent:"
const TTL_MS = 7 * 24 * 60 * 60 * 1000

export type AgentMetadata = {
  agentId: string
  cwd: string
  cliKind: string
  acpSessionId: string | null
  modelOverride: string | null
  savedAt: number
}

export function saveAgentMetadata(meta: Omit<AgentMetadata, "savedAt">): void {
  try {
    localStorage.setItem(
      KEY_PREFIX + meta.agentId,
      JSON.stringify({ ...meta, savedAt: Date.now() }),
    )
  } catch {
    // quota — ignore
  }
}

export function loadAgentMetadata(agentId: string): AgentMetadata | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + agentId)
    if (!raw) return null
    const meta = JSON.parse(raw) as AgentMetadata
    if (Date.now() - meta.savedAt > TTL_MS) {
      localStorage.removeItem(KEY_PREFIX + agentId)
      return null
    }
    return meta
  } catch {
    return null
  }
}

export function clearAgentMetadata(agentId: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + agentId)
  } catch {}
}
```

### שלב 2 — עדכון `api/agents.ts:createAgent`

אחרי הצלחת POST: שמור meta ל-localStorage. גם ב-`deleteAgent` — מחק את ה-cache.

```diff
// api/agents.ts:25
export async function createAgent(input: CreateAgentInput): Promise<CreateAgentResponse> {
  const res = await fetch(`${API_BASE}/api/agents`, { method: "POST", ... })
  if (!res.ok) { ... }
  const data = await res.json()
+ saveAgentMetadata({
+   agentId: data.agentId,
+   cwd: data.cwd,
+   cliKind: data.cliKind,
+   acpSessionId: data.acpSessionId ?? null,
+   modelOverride: input.modelOverride ?? null,
+ })
  return data
}

// api/agents.ts:44
export async function deleteAgent(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agents/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(`deleteAgent failed: ${res.status}`)
+ clearAgentMetadata(id)
}
```

הערה: גם ה-acpSessionId מתעדכן אחרי ה-handshake (ב-`session-attached`). צריך לעדכן את ה-cache גם שם — אחרת ב-recovery נחזור לסשן ישן שלא מתאים. אפשרות 1: לקרוא ל-`saveAgentMetadata` גם ב-`sessionAttached`. אפשרות 2: ב-recovery, לשלוף את ה-`lastSessionId` העדכני מ-`/api/projects` (שמותמד בdisk) לפי ה-cwd מ-cache. **המלצה: אפשרות 2** — מקור אמת יחיד, ופחות write races.

### שלב 3 — עדכון `agent-session.svelte.ts:handleWsClose`

```diff
const handleWsClose = (code: number, reason: string) => {
-  if (code === 1008) {
+  if (code === 1008 && reason === "agent in use by another tab") {
     error = "סוכן בשימוש ב-tab אחר"
     status = "crashed"
     acpClient = null
+  } else if (code === 1008 && reason === "agent not found") {
+    // BE restart — try recovery
+    void recoverAgent(agentId)
   } else if (code === 1011) {
     ...
```

### שלב 4 — פונקצית `recoverAgent`

יכולה לחיות ב-`agent-session.svelte.ts` או לעבור ל-`agent-recovery.ts` נפרד. המלצה: נפרד, יותר קל לבדוק.

```ts
// packages/frontend/src/lib/stores/agent-recovery.ts
export async function recoverAgent(oldAgentId: string): Promise<void> {
  const meta = loadAgentMetadata(oldAgentId)
  if (!meta) {
    // No cache — go to dashboard with toast
    showToast("הסוכן נסגר ולא ניתן לשחזרו אוטומטית. חזרה ל-dashboard.")
    await goto("/")
    return
  }

  try {
    // Get latest acpSessionId from projects-registry (more reliable than cache)
    const projects = await listProjects()
    const project = projects.find((p) => p.cwd === meta.cwd)
    const existingSessionId = project?.lastSessionId ?? meta.acpSessionId ?? undefined

    const fresh = await createAgent({
      cwd: meta.cwd,
      cliKind: meta.cliKind as CreateAgentInput["cliKind"],
      existingSessionId,
      modelOverride: meta.modelOverride,
    })

    // Cleanup old cache entry (a new one was just saved by createAgent)
    clearAgentMetadata(oldAgentId)

    // Replace URL — the $effect in /agent/[id]/+page.svelte will rebuild stores
    await goto(`/agent/${fresh.agentId}`, { replaceState: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    showToast(`שחזור סוכן נכשל: ${msg}. חזרה ל-dashboard.`)
    clearAgentMetadata(oldAgentId)
    await goto("/")
  }
}
```

### שלב 5 — Toast (אם לא קיים)

בדיקה מהירה בtask הבא: אם אין Toast component ב-`packages/frontend/src/lib/components/` — לכתוב אחד פשוט (banner עליון, 3-5 שניות, auto-dismiss). אם יש — להשתמש בקיים.

### שלב 6 — Tests

- `agent-storage.test.ts` — unit: save → load → expire → clear (לפי תבנית של `playback-storage.test.ts:18-113`).
- `agent-recovery.test.ts` — unit עם mocks: cache hit + success path, cache miss → toast, createAgent failure → toast.
- e2e (optional, אם יש זמן): playwright שמדמה BE restart (לעצור ולהפעיל BE) ובודק שה-`/agent/<id>` מתאושש.

## Affected files (Revision 3)

חדשים:
- `packages/frontend/src/lib/stores/agent-storage.ts` — ~60 שורות
- `packages/frontend/src/lib/stores/agent-recovery.ts` — ~50 שורות
- `packages/frontend/src/lib/stores/agent-storage.test.ts` — ~80 שורות
- `packages/frontend/src/lib/stores/agent-recovery.test.ts` — ~60 שורות
- (אולי) `packages/frontend/src/lib/components/Toast.svelte` — ~50 שורות

מתעדכנים:
- `packages/frontend/src/lib/api/agents.ts:25,44` — save/clear ב-create/delete (~5 שורות כל אחד)
- `packages/frontend/src/lib/stores/agent-session.svelte.ts:417-421` — פיצול 1008 לפי reason וקריאה ל-`recoverAgent` (~10 שורות)

## Risks (Revision 3)

- **Stale acpSessionId**: אם opencode ניקה את הסשן בinterval שבין ה-crash ל-recovery — ה-`loadSession` ייכשל. הקוד ב-`agent-session.svelte.ts:457-464` כבר עושה fallback ל-`newSession`. המשתמש יראה שיחה ריקה בלי אינדיקציה. שיפור אפשרי: banner "סשן קודם לא זמין — מתחילים חדש" (פתח).
- **localStorage ב-tab אחר**: אם המשתמש פתח את ה-URL בtab/דפדפן אחר (שלא עשה createAgent אצלו) — אין cache, ייפול ל-fallback toast. זה acceptable.
- **Recovery loop**: אם ה-createAgent החדש גם נופל מיד (cwd נמחק, OneCLI לא רץ וכו') — ה-toast יתפס את השגיאה, אין לולאה.
- **Multi-tab race**: שני tabs על אותו agentId, BE crash, שניהם מקבלים 1008 וקוראים ל-recoverAgent. אבי, זה סציוריו שלא בדקתי: שני POSTs ל-`/api/agents` ייצרו שני agentId שונים — אלא אם ה-dedup ב-orchestrator (`agent-orchestrator.ts:118-138`) מזהה לפי `existingSessionId`. יזהה, אבל רק אם ה-`existingSessionId` לא null. אחרת יווצרו שני agents מקבילים (orphan).

## Open questions for Avi (Revision 3)

1. **Banner "סשן אבוד"**: האם ה-recovery ש-ends עם newSession (כי loadSession נכשל) צריך banner גלוי, או שקט?
2. **Dashboard "פרויקטים אחרונים"**: עדיין ב-scope או slice נפרד? מהמעבר בקוד ראיתי ש-Dashboard כיום רק מציג agents — גישה ל-`/api/projects` היא fixe בinterface, לא שדרוג גדול. המלצה: לכלול. (~50 שורות, שעה עבודה)
3. **Multi-tab edge case**: האם שווה לטפל ב-MVP, או לתעד כידוע? הfix הוא לוודא ש-`existingSessionId` מועבר (תמיד יש לנו אותו מ-`/api/projects`) — בעצם זה מטופל אוטומטית בתכנון.
4. **Toast component**: לכתוב מינימליסטי בתוך ה-fix, או שיש Toast שכבר קיים שלא מצאתי? (ה-executor יבדוק ב-`lib/components/` לפני שיכתוב חדש)

## Estimated effort (Revision 3)

| חלק | LoC | קבצים | Tests | זמן |
|-----|-----|--------|-------|-----|
| `agent-storage.ts` + test | ~140 | 2 | 1 | 1 שעה |
| `agent-recovery.ts` + test | ~110 | 2 | 1 | 1-2 שעות |
| עדכון `api/agents.ts` (save+clear) | ~10 | 1 | (cover ב-recovery tests) | 15 דקות |
| עדכון `agent-session.svelte.ts` (1008 split) | ~10 | 1 | 1 | 30 דקות |
| Toast component (אם לא קיים) | ~50 | 1 | (manual) | 30 דקות |
| **סה"כ (ללא Dashboard)** | **~320** | **6-7** | **3-4** | **3-4 שעות** |
| Dashboard "פרויקטים אחרונים" (אם בscope) | +50 | +1 | +1 | +1 שעה |
| **סה"כ (כולל)** | **~370** | **7-8** | **4-5** | **יום עבודה** |

---

# Revision 4 — שינוי סדר ה-flow: HTTP GET לפני WS

> תאריך: 2026-05-18.
> הקשר: דיון ארכיטקטוני עם אבי על מה ה-trigger הנכון ל-recovery. הגענו להחלטה: לעשות `GET /api/agents/<id>` לפני פתיחת WS, ולא להסתמך על WS close 1008 עם reason string כדי להבחין בין סוגי שגיאות.
> הסעיפים הבאים מ-Revision 3 אינם רלוונטיים יותר: "שלב 3 — עדכון `agent-session.svelte.ts:handleWsClose`" (ה-split לפי reason בוטל). שאר סעיפי הפתרון מ-Revision 3 (agent-storage, agent-recovery, עדכון api/agents.ts) עדיין בתוקף.

## רקע ההחלטה

שקלנו שלוש אופציות לזיהוי "agent לא קיים":

| אופציה | רעיון | בעיה |
|--------|---------|--------|
| A | האזנה ל-`close(1008, "agent not found")` | מסתמך על reason string שעלול להשתנות; מערבב שני מצבי 1008 בקוד זהה |
| B | GET לפני WS | RTT נוסף (~10-50ms מקומי) |
| C | 4xx על ה-handshake עצמו | Browser API לא חושף HTTP status לכישלון upgrade — פחות אינפורמטיבי מ-A |

גם שקלנו לתוכף אובייקט JSON ב-reason של ה-close (לקודד עוד מידע מובנה) — לא תקין:

- RFC 6455 §5.5.1 מגביל reason ל-123 בתים
- ה-spec מציין שהtext הוא "human-readable", לא מציע מבנה
- הסטנדרט בכל המימושים (SDK, debug tools, DevTools) הוא מחרוזת פשוטה
- היה מתעתע את מי שיעבוד על הקוד אחרינו

**בחירה: B**. עלות RTT זניחה בהשוואה ל-clarity. בונוס: גם מנקה את הbug הקיים שבו ה-FE מציג "סוכן בשימוש ב-tab אחר" לכל 1008 — עכשיו 1008 יכול להיות רק המקרה הזה, כי את ה-"not found" תפסנו קודם ב-HTTP.

## עדכון פתרון

### שלב 3 (מעודכן) — GET לפני WS ב-`connect()`

ב-`agent-session.svelte.ts:404`:

```diff
async function connect(): Promise<void> {
  if (status === "connecting" || status === "connected") return
  status = "connecting"
  error = null
  log.info({}, "ACP connect start")

  try {
+   // 0. Verify agent exists — if not, try recovery from localStorage cache
+   const agentRes = await fetch(`/api/agents/${agentId}`)
+   if (agentRes.status === 404) {
+     log.warn({ agentId }, "agent not found in BE — attempting recovery")
+     await recoverAgent(agentId)
+     return  // recoverAgent either navigates away or throws
+   }
+   if (!agentRes.ok) {
+     throw new Error(`getAgent failed: ${agentRes.status}`)
+   }
+   const agentData = (await agentRes.json()) as {
+     agent?: { cwd?: string; acpSessionId?: string }
+   }
+   const agentCwd = agentData.agent?.cwd ?? "/"
+   const existingSessionId = agentData.agent?.acpSessionId
+
    // 1. Create ACP client (WS handshake)
    const handleWsClose = (code: number, reason: string) => {
-     if (code === 1008) {
+     if (code === 1008) {
+       // After the GET-first check above, 1008 can now only mean "in use by another tab"
        error = "סוכן בשימוש ב-tab אחר"
        status = "crashed"
        acpClient = null
      } else if (code === 1011) {
        ...
      }
    }
    acpClient = await createAcpClient(agentId, handleSessionUpdate, handleWsClose)

-   // 2. Fetch agent details to get cwd + existing acpSessionId (if any)
-   const agentRes = await fetch(`/api/agents/${agentId}`)
-   const agentData = (await agentRes.json()) as { ... }
-   const agentCwd = agentData.agent?.cwd ?? "/"
-   const existingSessionId = agentData.agent?.acpSessionId

    // 3. Either load existing session or create new
    let sessionId: string | null = null
    if (existingSessionId) {
      ...
```

### שלב 4 (מ-Revision 3, ללא שינוי) — `recoverAgent`

אותו קוד כמו ב-Revision 3 §"שלב 4". מקבל `oldAgentId`, שולף מ-`localStorage`, שולח POST חדש, עושה `goto(/agent/<newId>, { replaceState: true })`.

הבדל יחיד: עכשיו הוא נקרא ישירות מ-`connect()` ולא מ-`handleWsClose` — זרימה פשוטה יותר.

### הסרת בעיה: 1008 ambiguity

ב-Revision 3 הצעתי לפצל את ה-1008 לפי reason. ב-Revision 4 אין צורך — המסלול היחיד שמוביל ל-1008 הוא "agent in use by another tab", כי את "agent not found" תפסנו ב-HTTP לפני ה-WS נפתח בכלל. ה-error message ב-FE הופך לתקין אוטומטית.

## ארכיטקטורה (הבהרה מ-discussion)

לתיעוד: ה-BE שולח ל-CLI subprocess **כלום** מעבר ל-`spawn()`. ה-initialize ACP מגיע מה-FE דרך ה-WS pipe (`client.ts:92-98`), ו-newSession מגיע אחריו (`agent-session.svelte.ts:467`). זה תקין לפי ACP — אגנט יכול לחיות בלי סשן עד שמתחברים אליו.

המשמעות ל-recovery: ה-POST ל-`/api/agents` בrecovery יוצר agent חדש שאין לו סשן עדיין. ה-FE אחר כך יקרא ל-`loadSession({ sessionId: existingSessionId })` וזה מה שמחבר את הצדדים. אותו flow כמו ב-`/session/[cwdHash]/[id]/+page.svelte` הקיים.

## Estimated effort (Revision 4)

זהה ל-Revision 3 - ~10 שורות. לא מוסיפים Toast nor `agent-storage` נוספים — זה רק אילו שורות יושבות בקובץ שונה.

| שינוי מ-Revision 3 | הפרש LoC | זמן |
|----------------------|-----------|------|
| העברת ה-fetch ל-`/api/agents` לפני ה-WS | 0 (move) | 10 דקות |
| הוספת if 404 → recoverAgent | +5 | 10 דקות |
| הסרת ה-`reason` split מ-handleWsClose | -5 | 0 |
| **סה"כ הפרש** | **~0** | **20 דקות** |

סה"כ מצטבר לעבודה: **3-4 שעות** (ללא Dashboard) / **יום** (כולל).

## Open questions שעדיין פתוחים (מ-Revision 3)

1. Banner "סשן אבוד" כש-loadSession נכשל?
2. Dashboard "פרויקטים אחרונים" — בscope או נפרד?
3. Toast component — יש קיים או לכתוב חדש?

**שאלת Multi-tab** (מ-Revision 3) ירדה מהsider: הdedup ב-`agent-orchestrator.ts:118-138` מטפל בה כי הdetermined `existingSessionId` מתקבל מ-`/api/projects` (source of truth).
