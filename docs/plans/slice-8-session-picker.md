# Slice 8 — Session Picker (inline ב-connect) — תוכנית

> **תאריך**: 2026-05-29
> **סטטוס**: ‏הושלם — 2026-05-29 (4 commits, slice-8-session-picker branch)
> **Complexity**: 5/10 (verifier: light)
> **תלות**: ‏slice 0.5 (i18n) ✅. ‏slice 3 (Mic+VoiceMode) ✅ — ‏לא ‏ממש ‏תלוי בו, ‏אבל ‏שיחה ‏טעונה מצריכה ‏שאת ‏המיקרופון ‏פעיל ‏לhandle ‏המשך.
> **מתבסס על**: ‏`docs/plans/README.md` (מבנה), ‏`docs/conventions/parallel-safe-code.md` (additive)
> **‏שינוי ‏מהroadmap המקורי**: ‏ה-roadmap ‏ב-`packages/frontend/docs/slices.md` ‏מציין `/sessions` route ‏נפרד. ‏ה-brief הזה מחליף ב-**inline ב-connect form**, ‏לפי ‏בקשת ‏המשתמש ‏(התנהגות ‏מגרסה ‏ראשונה ‏שעבדה ‏טוב).

---

## §0 — Pre-flight

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-8-session-picker -b slice-8-session-picker dev
cd .worktrees/slice-8-session-picker
pnpm install
pnpm hooks:install
```

### Ports

‏ה-slice הזה עצמאי. ‏אם רץ ‏לבד: ‏BE 4000 (default). ‏אם במקביל ל-slice ‏אחר: ‏עקוב ‏אחרי ‏convention ב-`AGENTS.md §Running parallel worktrees`.

### איך להריץ

| ‏מה | ‏פקודה |
|---|---|
| ‏BE (OneCLI) | `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` |
| ‏FE | `pnpm --filter @drive-coding/frontend-v2 dev` |
| ‏Tunnel ‏(אם נדרש לטסט ‏על mobile) | `ssh -i ~/.ssh/pico -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15 -R drive-coding:80:localhost:<vite-port> tuns.sh http` → ‏`https://your-app.tuns.sh` |

### Reading list

**must-read לפני** (~‎15 ‏דקות):

1. ‏`docs/conventions/parallel-safe-code.md` §1, §2 — ‏additive vs invasive
2. ‏`packages/frontend/AGENTS.md` — ‏5 ‏חוקי זהב + ‏מבנה 5 ‏שכבות
3. ‏`packages/frontend/src/lib/view-models/agent-session.svelte.ts` — ‏ה-VM ‏שיוסיף `loadSession` (section "session persistence" ‏סומנה ‏כ-stub)
4. ‏`packages/frontend/src/routes/+page.svelte` — ‏ה-connect form הקיים. ‏הוסף ‏כאן UI חדש
5. ‏`packages/core/src/acp/client.ts` — ‏ל-`createAcpClient` + ‏`listSessions` ‏methods (אמורות ‏להיות)
6. ‏`AGENTS.md` (root) §Worktrees, §Ports, §Backend MUST run through OneCLI

**reference — ‏המקור ‏מ-main (FE הישן)**:

- ‏`/home/user/projects/voice-acp/main/packages/frontend/src/lib/api/sessions-ws.ts` (75 שורות) — ‏היישום ‏הקודם ‏עם ‏שני strategies. ‏לא ‏copy ‏מילולי — ‏לאדפט ‏ל-structure ‏החדש ‏(adapters/, ‏לא api/).
- ‏`/home/user/projects/voice-acp/main/packages/frontend/src/lib/api/sessions-ws.test.ts` — ‏tests ‏שכדאי ‏לבדוק ‏לאוסף ‏ספציפי שצריך לבדוק

---

## §1 — מטרה

‏אחרי slice 8: ‏ב-connect form יש ‏אופציה ‏לטעון ‏סשן ‏קיים ‏במקום ‏ליצור ‏חדש.

**‏ה-UX (לפי בקשת ‏המשתמש)**:
1. ‏Connect form נטען עם השדות הקיימים: ‏CLI + ‏cwd + ‏Voice
2. ‏אחרי ‏שcwd ‏מולא: ‏כפתור **"טען סשנים ‏אחרונים"** ‏פעיל
3. ‏לחיצה: ‏spinner קצר (~‎300-700ms — ‏spawn ‏temp agent), ‏אז:
   - ‏אם ‏נמצאו ‏sessions: ‏dropdown ‏עם ‏רשימה (title + ‏updatedAt)
   - ‏אם ‏ריק: ‏הודעה ‏"אין סשנים ‏קודמים"
   - ‏אם ‏ה-CLI ‏לא ‏תומך (Gemini): ‏הודעה ‏"ה-CLI ‏לא תומך בהיסטוריה"
4. ‏בחירה ‏ב-dropdown ‏(אופציה ‏"חדש" ‏ברירת מחדל ‏או ‏אחת ‏מהקיימות)
5. ‏Connect ‏רגיל → ‏אם נבחר session ‏קיים, ‏טוען ‏אותו ‏(loadSession) ‏במקום ‏newSession

**‏המטרה**: ‏אישה ‏חוזרת ‏לעבודה ‏אחרי שעה — ‏לא ‏רוצה ‏להתחיל ‏מאפס, ‏רוצה ‏להמשיך ‏מאיפה ‏הפסיקה.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ‏`listSessionsForCwd` ‏adapter | ✅ | ‏commit 0 |
| ‏`AgentSession.loadSession()` ‏API ‏חדש | ✅ | ‏commit 1 |
| ‏UI: ‏button + dropdown ‏ב-connect | ✅ | ‏commit 2 |
| ‏Wiring: ‏Connect → ‏load (אם נבחר) / ‏new (אם לא) | ✅ | ‏commit 3 |
| ‏Loading state + ‏error handling | ✅ | ‏commit 2 |
| ‏`/sessions` route ‏נפרד | ❌ | ‏מבוטל — ‏ה-UX inline פחות חיכוך |
| ‏Auto-load ‏ב-app start | ❌ | ‏המשתמש ‏מטריגר ידנית עם button |
| ‏localStorage cache ‏של sessions | ❌ | ‏יקרא ‏מ-ACP ‏בכל ‏פעם. ‏future ‏אם slow |
| ‏Resume session ‏(continued) ‏vs ‏fork | ❌ | ‏MVP: ‏loadSession ‏בלבד. ‏fork — ‏future |
| ‏Search/filter ‏ב-dropdown | ❌ | ‏MVP: ‏רשימה ‏פשוטה. ‏אם נצטרך — ‏slice עתידי |
| ‏Delete session ‏מהרשימה | ❌ | ‏לא ‏ב-scope. ‏המשתמש ‏ימחק ‏ב-CLI עצמו |

---

## §3 — Architecture

```
+page.svelte (connect form)
  ├─ CLI dropdown        (קיים)
  ├─ cwd input           (קיים)
  ├─ Voice picker        (קיים — slice 9a)
  ├─ ⬇️ ‏חדש:
  ├─ [Load sessions] button   (enabled when cwd filled)
  ├─ Sessions dropdown        (visible after click)
  │   ├─ "Start new session" (default)
  │   └─ <Each session>     (title + updatedAt)
  └─ Connect button      (קיים — ‏modified to use loadSession if selected)

‏New adapter:
  packages/frontend/src/lib/adapters/sessions.ts
    listSessionsForCwd(cwd, cliKind): Promise<SessionInfo[]>
    — ‏spawns temp agent, ‏calls ACP listSessions, ‏deletes agent

‏Modified VM:
  packages/frontend/src/lib/view-models/agent-session.svelte.ts
    + loadSession(sessionId, cwd, cliKind): Promise<void>
      — ‏similar ‏ל-attach() ‏אבל ‏קורא ‏ל-loadSession ‏על ‏ה-ACP ‏במקום ‏newSession

‏Modified action (optional):
  packages/frontend/src/lib/actions/connect-agent.ts (קיים)
    + ‏אופציה ‏ל-sessionId
    OR: ‏בroute ישירות ‏החלטה ‏בין session.attach() ‏ל-session.loadSession()
```

---

## §4 — Commits

### Commit 0 — Sessions adapter + ‏prep `deleteAgent` (approach: **manual** — ‏copy מ-main + ‏adapt)

**מקור**: ‏`/home/user/projects/voice-acp/main/packages/frontend/src/lib/api/sessions-ws.ts` (82 ‏שורות)

**קבצים ‏שמשתנים** (prep additive):
- ‏`packages/frontend/src/lib/adapters/agents-api.ts` — ‏**הוסף ‏`deleteAgent`** ‏(לא קיים ‏ב-dev — ‏רק createAgent, getAgent, notifySessionAttached). ‏ההוספה אדיטיב — ‏3-5 שורות. ‏copy ‏מ-main: ‏`/home/user/projects/voice-acp/main/packages/frontend/src/lib/api/agents.ts` ‏ראה ‏את ה-deleteAgent ‏שם.

**קבצים ‏חדשים**:
- ‏`packages/frontend/src/lib/adapters/sessions.ts`

**Adaptations מ-main**:
- ‏ה-import של ‏`createAcpClient` ‏מ-`$lib/acp/client` ‏(main) → ‏ב-dev ‏זה ‏ב-`@drive-coding/core/acp/client`
- ‏ה-import של ‏`createAgent`, ‏`deleteAgent` ‏מ-`$lib/api/agents` ‏(main) → ‏ב-dev ‏זה ‏ב-`$lib/adapters/agents-api` ‏(אחרי שהוספת ‏את deleteAgent — ‏ראה ‏מעלה)
- ‏ה-WS transport — ‏ב-main זה ‏inline ב-acp/client. ‏ב-dev ‏יש ‏`WsAcpTransport` ‏ב-`$lib/engines/ws-transport`. ‏אדפט ‏accordingly: ‏אחרי `createAgent`, ‏צור `new WsAcpTransport(url)`, ‏`waitForOpen()`, ‏אז ‏`createAcpClient(transport, () => {})`
- ‏`$lib/log` ‏לא קיים → ‏console.warn

**API skeleton**:

```ts
import type { CliKind } from "@drive-coding/core"

export type SessionInfo = {
  sessionId: string
  cwd: string
  title: string         // ‏אם ה-CLI ‏מחזיר, אחרת ‏ריק
  updatedAt: string     // ISO timestamp
}

/**
 * List sessions for a (cwd, cliKind) combo by spawning a throwaway agent,
 * calling ACP listSessions, then deleting the agent.
 *
 * Cost: ~300-700ms (spawn + ACP handshake + listSessions + delete).
 * Always shows a loading state to the user before calling.
 *
 * Returns [] if:
 *   - CLI doesn't support session/list (-32601 — e.g. Gemini)
 *   - No previous sessions for this cwd
 *
 * Throws on:
 *   - Failed spawn (cwd doesn't exist, bin missing)
 *   - Network errors
 */
export async function listSessionsForCwd(
  cwd: string,
  cliKind: CliKind,
): Promise<SessionInfo[]>
```

**Verification**: ‏typecheck. ‏אין consumer ‏עדיין.

---

### Commit 1 — AgentSession.loadSession (approach: **manual**, ‏additive)

**קבצים ‏שמשתנים** (additive):

| ‏קובץ | ‏שינוי | ‏סוג |
|---|---|---|
| ‏`packages/frontend/src/lib/view-models/agent-session.svelte.ts` | ‏ב-section ‏`// ─── session persistence ───` (stub ‏סומן ‏ב-slice 2): ‏הוסף `loadSession` method | Additive |

**API skeleton** ‏(מלא — ‏copy ‏מ-attach ‏עם 3 ‏שינויים מסומנים):

```ts
loadSession = async (input: {
  sessionId: string
  cwd: string
  cliKind: CliKind
}): Promise<void> => {
  if (this.status === "connecting" || this.status === "connected") {
    throw new Error(`cannot loadSession in status ${this.status}`)
  }
  this.status = "connecting"
  this.error = null
  this.bubbles = []
  this.#detached = false

  try {
    // 1. createAgent (זהה ‏ל-attach)
    const { agentId } = await createAgent({ cwd: input.cwd, cliKind: input.cliKind })
    this.agentId = agentId
    this.cwd = input.cwd

    // 2. WS transport + onClose (זהה ‏ל-attach)
    const proto = location.protocol === "https:" ? "wss:" : "ws:"
    const transport = new WsAcpTransport(`${proto}//${location.host}/ws/agent/${agentId}`)
    transport.onClose((code, reason) => {
      if (this.#detached) return
      if (code !== 1000 && code !== 1001) {
        this.error = `WS closed (${code}): ${reason || "no reason"}`
        this.status = "error"
      }
    })
    await transport.waitForOpen()

    // 3. ACP handshake (זהה ‏ל-attach)
    this.#client = await createAcpClient(transport, this.#onSessionUpdate)

    // ── ‏שינוי ‏ראשון מ-attach: ‏loadSession ‏במקום newSession ──
    await this.#client.loadSession({ sessionId: input.sessionId, cwd: input.cwd })
    this.#sessionId = input.sessionId

    // ── ‏שינוי ‏שני: ‏אין צורך ‏בvalidation ‏של sessionId (ה-input ‏מגיע מהuser) ──

    // 4. Notify BE (זהה ‏ל-attach)
    await notifySessionAttached(agentId, this.#sessionId).catch(() => {})

    this.status = "connected"
  } catch (e) {
    // ── ‏שינוי ‏שלישי: ‏error message ‏מציין loadSession ──
    const msg = e instanceof Error ? e.message : String(e)
    this.error = `loadSession failed: ${msg}`
    this.status = "error"
    this.#cleanup()
  }
}
```

**Imports**: ‏לוודא ‏ש-`createAgent`, ‏`notifySessionAttached`, ‏`createAcpClient`, ‏`WsAcpTransport` ‏כבר ‏מיובאים ‏(הם ‏ב-attach — ‏אז ‏כן).

**Refactor option**: ‏יש ‏overlap ‏גדול ‏עם attach (~‎18 ‏שורות duplicated — ‏steps 1-3 + ‏onClose closure). ‏אפשר ‏לחלץ ‏private `#setupTransport(input): Promise<{client, agentId}>` ‏ולקרוא ‏לו ‏משניהם — ‏invasive ‏קל. ‏המלצה: ‏לא ‏לrefactor ‏ב-slice ‏הזה. ‏cleanup ‏ב-follow-up אם ‏slice 10 ‏יוסיף ‏עוד method ‏דומה.

**Verification**: ‏typecheck. ‏אם ‏יש ‏tests ל-AgentSession — ‏לעדכן.

---

### Commit 2 — UI: ‏button + ‏dropdown (approach: **manual**)

**קבצים ‏שמשתנים**:

| ‏קובץ | ‏שינוי | ‏סוג |
|---|---|---|
| ‏`packages/frontend/src/routes/+page.svelte` | ‏הוסף ‏button "טען ‏סשנים" + ‏dropdown ‏אחרי cwd ולפני voice picker (או ‏לפני submit). ‏State: ‏`sessions = $state([])`, ‏`loading = $state(false)`, ‏`error = $state(null)`, ‏`selectedSessionId = $state<string | null>(null)` | UI extension |
| ‏`packages/core/src/i18n/keys.ts` + ‏catalogs | ‏הוסף ‏section `// ─── sessions picker ───`: ‏`sessions.loadButton`, ‏`sessions.loading`, ‏`sessions.error`, ‏`sessions.empty`, ‏`sessions.notSupported`, ‏`sessions.startNew` | Additive |

**Skeleton ל-UI** (פסאודו):

```svelte
<label>
  <span>{t("sessions.loadButton")}</span>
  <button
    type="button"
    disabled={!cwd.trim() || loading}
    onclick={async () => {
      loading = true; error = null
      try {
        sessions = await listSessionsForCwd(cwd.trim(), cliKind)
        if (sessions.length === 0) {
          // ‏לא error — ‏פשוט אין
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      } finally { loading = false }
    }}
  >
    {loading ? t("sessions.loading") : t("sessions.loadButton")}
  </button>
</label>

{#if sessions.length > 0}
  <label>
    <span>{t("sessions.label")}</span>
    <select bind:value={selectedSessionId}>
      <option value={null}>{t("sessions.startNew")}</option>
      {#each sessions as s (s.sessionId)}
        <option value={s.sessionId}>
          {s.title || s.sessionId.slice(0, 8)} ({formatDate(s.updatedAt)})
        </option>
      {/each}
    </select>
  </label>
{:else if error !== null}
  <div class="error">{t("sessions.error")}: {error}</div>
{/if}
```

**i18n keys מינימליים**:
- ‏`sessions.loadButton`: "טען ‏סשנים ‏אחרונים" / "Load recent sessions"
- ‏`sessions.loading`: "‏טוען..." / "Loading..."
- ‏`sessions.label`: "‏סשן ‏קיים" / "Existing session"
- ‏`sessions.startNew`: "‏חדש" / "New"
- ‏`sessions.error`: "‏שגיאה ‏בטעינה" / "Failed to load"
- ‏`sessions.empty`: ‏לא ‏נדרש ‏(אם empty — ‏הdropdown ‏פשוט ‏לא ‏מופיע)

**Verification**: ‏typecheck. ‏Lint:i18n.

---

### Commit 3 — Wire connect (approach: **manual**)

**קבצים ‏שמשתנים**:
- ‏`packages/frontend/src/routes/+page.svelte` — ‏מודיפיקציה ל-onSubmit:

```ts
async function onSubmit(e: SubmitEvent) {
  e.preventDefault()
  if (!cwd.trim()) return
  if (selectedSessionId !== null) {
    await session.loadSession({
      sessionId: selectedSessionId,
      cwd: cwd.trim(),
      cliKind,
    })
  } else {
    await connectAgent({ cliKind, cwd: cwd.trim(), session, settings })
  }
  // ‏שני המסלולים ‏אמורים ‏לגרום ‏ל-navigation ל-/chat ‏(connectAgent ‏עושה ‏את ‏זה, ‏loadSession לא — ‏ניווט ידני אם status === "connected")
}
```

**Optional**: ‏אם connect-agent.ts ‏(action) ‏מצליח לקבל ‏optional sessionId — ‏עדיף ‏לעבור ‏דרכו ‏במקום ‏if/else. ‏אבל ‏אם הaction ‏לא ‏פתוח לזה — ‏duplicate הloop ב-route fine.

**Verification**:
- ‏typecheck + ‏build
- ‏ידני: ‏connect ‏רגיל ‏עובד (regression)
- ‏ידני: ‏טען sessions → ‏בחר אחד → ‏connect → ‏טוען ל-/chat ‏עם sessionId הקיים

---

### Commit 4 — walkthrough + ‏cleanup

- ‏`docs/walkthrough.md`
- ‏`packages/frontend/docs/slices.md` — ‏status 💭 → ✅, ‏הערה ‏שהUX שונה ‏מהroadmap המקורי (inline במקום ‏route ‏נפרד)
- ‏`docs/plans/slice-8-session-picker.md` (זה) — ‏סטטוס → ‏"הושלם"
- ‏Smoke test ‏מומלץ: ‏`tests/smoke/session-picker.mjs` (אופציונלי — ‏ב-follow-up)

---

## §5 — DoD

| # | ‏בדיקה | ‏איך |
|---|---|---|
| 1 | ‏Button "‏טען סשנים" ‏מופיע ‏אחרי cwd ‏מולא | ‏ידני |
| 2 | ‏לחיצה ‏על button: ‏spinner ‏מופיע, ‏אז ‏dropdown ‏עם sessions קיימים (לפחות ‏1 ‏אם ‏יש קודמים) | ‏ידני |
| 3 | ‏אם ‏cwd ‏חדש לחלוטין: ‏dropdown ריק, ‏אין שגיאה | ‏ידני |
| 4 | ‏Gemini CLI: ‏dropdown ‏ריק (לא תומך) — ‏אין error UI | ‏ידני (אם זמין) |
| 5 | ‏בחירת session ‏ב-dropdown + ‏Connect → ‏/chat ‏עם sessionId הקיים | ‏ידני |
| 6 | ‏ללא בחירה + ‏Connect → ‏/chat ‏עם session ‏חדש (regression) | ‏ידני |
| 7 | ‏typecheck + ‏build + ‏tests | `pnpm test`, ‏`pnpm typecheck`, ‏`pnpm build` |
| 8 | ‏lint:i18n | `pnpm lint:i18n` |
| 9 | ‏smoke ‏הקיים ‏לא נשבר | `tests/smoke/run-all.mjs` |
| 10 | ‏BE log: ‏proxy לACP listSessions ‏ב-spawn ‏החדש; ‏אז delete ‏מיידי ‏של agent | ‏BE log |

---

## §6 — Risks + ‏mitigations

| # | ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|---|
| 1 | ‏spawn cost ‏(~‎300-700ms) ‏יוצר ‏UX ‏איטי | ‏Inherent | ‏Spinner ‏מפורש. ‏לא ‏אוטומטי — ‏רק ‏על ‏click |
| 2 | ‏ה-CLI לא ‏תומך ב-listSessions ‏(Gemini) | ‏ACP -32601 | ‏Adapter ‏מחזיר ‏[] ‏ב-this case (לפי old code). ‏UI ‏מציג ‏empty state |
| 3 | ‏spawn ‏נכשל (cwd ‏לא קיים, ‏בinari לא ‏מותקן) | ‏BE error | ‏Catch, ‏error state ‏ב-UI |
| 4 | ‏temp agent ‏לא ‏נמחק (זאיל crash) | ‏fire-and-forget DELETE | ‏BE כבר ‏מנקה ‏ב-WS ‏detach. ‏אם DELETE נכשל — ‏BE eventually cleanup ‏ב-pid death |
| 5 | ‏loadSession ‏לא ‏מטעין bubbles (history) | ‏ACP loadSession ‏לא ‏מחזיר ‏history | ‏ידוע. ‏slice 10 ‏יטפל ‏(recordings replay). ‏UI ‏יציג ‏chat ‏ריק ‏שאפשר ‏להמשיך |
| 6 | ‏הfield החדש sessions בroute > 150 ‏שורות (golden rule #1) | ‏route ‏גדל | ‏אם ‏עבר ‏150 — ‏לחלץ ‏components: ‏`<SessionPicker>` |
| 7 | ‏Pre-commit hook חוסם Hebrew בקוד | ‏i18n-gap | ‏כל ‏string ‏חדש → ‏t(key). ‏6 ‏keys חדשים מתועדים ‏ב-commit 2 |
| 8 | ‏Svelte 5 reactivity על ‏sessions[] | ‏general | ‏`sessions = $state([])` + ‏בdom: ‏`{#each sessions as ... (s.sessionId)}` — ‏standard |
| 9 | ‏overlap עם attach() ‏ב-AgentSession (duplicate code) | ‏design | ‏cleanup לעתיד. ‏MVP — ‏duplicate ~‎20 ‏שורות acceptable |

---

## §7 — Escalation triggers

‏עצור ושאל את Tama אם:

1. **‏ACP loadSession signature ‏שונה ממה ‏שה-brief ‏הניח**. ‏אומת: ‏ב-`dev/packages/core/src/acp/client.ts:122` יש ‏`loadSession({sessionId, cwd}): Promise<unknown>` ‏ו-line 130 יש `listSessions(): Promise<unknown>`. ‏אם ‏השדה ‏ב-response ‏שונה ‏ממה ‏שה-skeleton ‏בcommit 2 ‏(`{sessions: [...]}`) ‏ציפה ‏לו — ‏לדון ‏על normalizeSession ‏מתאים.
2. **‏connectAgent action ‏לא ‏תומך ‏בoptional sessionId** ‏וה-refactor שלו ‏גדול מ-20 ‏שורות. ‏עדיף ‏duplicate ‏אם זה ‏המצב.
3. **‏רשימת sessions ‏מ-CLI ‏מחזירה ‏פורמט שונה ‏ממה ‏שה-old ‏normalizeSession ‏ציפה ‏לו** (e.g. ‏fields חסרים) — ‏לדון ‏על fallback (e.g. ‏הצגת sessionId בלבד).
4. **‏ה-spawn אינו נמחק** אחרי delete — ‏סימן ל-issue ב-BE bridge-manager.

‏אחרת: ‏החלט סבירות, ‏רשום בcommit message, ‏המשך.

---

## §8 — Complexity score: 5/10

| ‏פקטור | ‏ניקוד |
|---|---|
| ‏מספר commits (4) | ‏סביר |
| ‏שכבות חדשות (adapter + ‏VM method + ‏UI) | +2 |
| ‏APIs חיצוניים | 0 (רק ACP) |
| ‏Browser APIs | 0 |
| ‏Streaming pipeline | 0 |
| ‏Refactor של state | 0 (loadSession ‏אדיטיב) |
| ‏שינוי protocol BE↔FE | +1 (loadSession path ב-AgentSession) |
| ‏אינטגרציה ‏עם CLI features ‏שלא ‏אחידות בין CLIs | +2 (Gemini ‏לא ‏תומך, ‏אחרים ‏כן) |
| ‏סה"כ | **5** |

**Verifier**: ‏`verifier-slice-light` ‏בלבד.

---

## §9 — שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏Auto-refresh של ‏רשימת sessions ‏אם cwd ‏משתנה ‏אחרי טעינה? | ‏לא ב-MVP — ‏המשתמש ‏לוחץ button שוב | ❌ |
| 2 | ‏Format של ‏ה-updatedAt ‏ב-dropdown | ‏relative time (`לפני שעה`) או absolute? ‏ברירת ‏מחדל: ‏relative ‏עם Intl.RelativeTimeFormat | ❌ |
| 3 | ‏Title ריק ‏(CLI ‏לא ‏שולח) — ‏מה ‏להציג? | ‏sessionId ‏8 ‏תווים ראשונים + ‏updatedAt | ❌ |
| 4 | ‏מה ‏קורה ‏אם ‏בחירת session ‏שלא ‏קיים יותר (deleted ‏מאז list)? | ‏loadSession ‏יזרוק → ‏error state ב-route → ‏המשתמש ‏יכול ‏לטעון ‏רשימה שוב | ❌ |
| 5 | ‏UI ‏לbutton "‏העתק sessionId" ‏או דומה? | ‏לא MVP | ❌ |

---

## §10 — מה אחרי slice 8

‏ה-MVP ‏מאפשר ‏continuation. ‏עתידי:
- ‏slice 10 (Recordings + replay) — ‏יטעין ‏גם bubbles ‏היסטוריים ‏(נטענים ‏מ-disk)
- ‏Search/filter ‏ב-dropdown — ‏אם ‏עולה צורך
- ‏Delete session ‏מתוך ‏הdropdown
- ‏Auto-load ‏על ‏אחרון ‏(ברירת מחדל: ‏המשתמש ‏מתחבר ‏ל-last session ‏אם ‏קיים)
