# Slice fix-switch-session-warm — החלפת סשן על החיבור הקיים (ללא WS חדש) — תוכנית

> **תאריך**: 2026-06-03
> **סטטוס**: הושלם ✅ (אליעזר, 2026-06-03, calev phase GO) — ממתין ל-merge
> **Complexity**: 4/10 (verifier: calev light + phase על Commit 1)
> **תלויות (`depends_on`)**: [slice-sessions-inline-transcribe-resilience] — בנוי על אותו worktree/branch
> **Base**: branch `slice-sessions-inline` (tip `1a28601`) — **תוספת לאותו slice**, לא branch חדש
> **Dev tip**: `9eb3ea2`

---

## §0 — Pre-flight

> זהו **תיקון המשך** ל-slice-sessions-inline (חלק A). עובדים **באותו worktree הקיים**,
> מוסיפים commits לאותו branch `slice-sessions-inline`. אין worktree חדש.

### תלויות (חובה!)

slice זה הוא תיקון של חלק A ב-`slice-sessions-inline-transcribe-resilience` (כבר בוצע,
calev GO, **לא merged**). הקוד שמתקנים כבר קיים ב-worktree:
- `AgentSession.loadSession()` הכבד (createAgent+WS) — `agent-session.svelte.ts:212-275`.
- `AgentSession.#client` (AcpClient הקיים) — שורה 90.
- `selectSession()` ב-`SessionOptionsPanel.svelte:108-117` — קורא detach+loadSession.

### Worktree

**אין יצירת worktree חדש.** עבוד ב-worktree הקיים:
```bash
cd /home/user/projects/voice-acp/.worktrees/slice-sessions-inline
git log --oneline -1   # ודא tip == 1a28601
```

### איך להריץ

| מה | פקודה |
|---|---|
| typecheck | `pnpm --filter @drive-coding/frontend-v2 typecheck` (אם TS6305: `find packages -name '*.tsbuildinfo' -delete` + `pnpm --filter @drive-coding/core build`) |
| tests FE | `pnpm --filter @drive-coding/frontend-v2 test` |
| build | `pnpm --filter @drive-coding/frontend-v2 build` |
| lint:i18n | `pnpm lint:i18n` (חובה לפני commit) |

> ⚠️ שם package ה-FE: `@drive-coding/frontend-v2`.

### סביבה (כבר מורמת)

- **BE**: רץ על port **4011** עם OneCLI (agent `voice-acp`), מגיש גם FE סטטי מ-`packages/frontend/build`.
- **Tunnel**: `https://musicode-sessions-inline.tuns.sh` → BE 4011 (same-origin, יציב).
- ⚠️ אחרי build חדש של ה-FE: ה-BE מגיש את ה-`build/` — צריך **rebuild FE** (`pnpm --filter @drive-coding/frontend-v2 build`) כדי שהשינוי ייראה דרך ה-tunnel. (אין HMR — זה production-mode.)
- ⚠️ אל תהרוג את ה-BE/tunnel. אם צריך restart BE — דווח למרדכי.

### Browser

- בדיקה דרך ה-tunnel ב-linux-gui Chrome (session `vacp`):
  `playwright-cli -s=vacp goto https://musicode-sessions-inline.tuns.sh`. ראה skill `linux-gui-browser`.
- אם אין גישה ל-linux-gui — דווח למרדכי לאימות ידני.

---

## §1 — מטרה

היום החלפת סשן (`selectSession` ב-SessionOptionsPanel) קוראת `detach()` ואז
`loadSession()`. ה-`loadSession` הוא **כבד**: הורג את ה-bridge הקיים, יוצר agent
חדש (`createAgent`), פותח WS חדש. זה גורם ל-**באג "WS closed (1005): no reason"**
(race בין onClose האסינכרוני של ה-WS הישן ל-`#detached` שמתאפס ב-loadSession),
וגם בזבזני (spawn ~300-700ms + הריגת bridge).

**אחרי ה-slice**: החלפת סשן כשיש חיבור פעיל (`#client !== null`) משתמשת ב-`#client.loadSession()`
**על אותו WS/bridge הקיים** — בלי createAgent, בלי detach, בלי WS חדש. מיידי, ללא race.

> **אימות אמפירי שבוצע (מרדכי, opencode acp חי + DB)**:
> 1. `session/load` עובד על אותו bridge גם כשה-cwd של הסשן שונה מ-cwd של ה-bridge
>    (cross-cwd SUCCESS). bridge יחיד טוען **כל** סשן ברשימה — אין צורך ב-bridge-per-cwd.
> 2. **opencode מזהה פרויקט לפי root-commit hash של ה-git repo** (לא לפי path/שם תיקייה).
>    טבלת `project` ב-opencode.db: `id = <root-commit>`, ועוקבת אחרי נתיבים חלופיים ב-`sandboxes`.
>    לכן rename של תיקייה (anat→persona-lab) = **אותו projectID**, ו-`session/list` מחזיר
>    סשנים מ**שני** הנתיבים (אותו פרויקט). זה גם אומר ש-`session/list` כבר **מסונן per-project**
>    ע"י opencode — ה-FE **לא צריך** ולא יכול לסנן נכון (אין projectID ב-ACP listSessions).

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| `AgentSession.switchSession(input)` — מתודה חדשה, warm reload על `#client` הקיים | ✅ | Commit 1 |
| `selectSession` ב-panel קורא `switchSession` (כשיש חיבור) במקום detach+loadSession | ✅ | Commit 1 |
| fallback: אם אין `#client` → נופל ל-`loadSession` הכבד הקיים | ✅ | Commit 1 |
| תיקון ה-race ב-`#detached` (generation token) ב-loadSession הכבד | ❌ | **לא** — אחרי התיקון, נתיב ה-detach+loadSession לא נקרא יותר מ-selectSession. ה-loadSession הכבד נשאר רק לדף-החיבור (שם אין race כי אין detach קודם). תיקון ה-race המלא נדחה (לא רלוונטי אחרי שמסירים את הקריאה הבעייתית). |
| סינון רשימת הסשנים לפי cwd | ❌ | **לא צריך** — `session/list` כבר מסונן per-project ע"י opencode (לפי root-commit). סינון נאיבי לפי path אף *יזיק* (יסתיר היסטוריה מנתיב ישן אחרי rename, אותו פרויקט). |
| שינוי `loadSession` הכבד (דף-חיבור) | ❌ | לא נוגעים — עובד כמו שהוא לתרחיש דף-החיבור. |

---

## §3 — Architecture

```
selectSession(info)  [SessionOptionsPanel.svelte]
   │
   ├─ אם session.isConnected (#client !== null)  ──►  session.switchSession(info)
   │                                                     │ warm: #client.loadSession()
   │                                                     │ אותו WS/bridge/agentId
   │                                                     │ bubbles=[], replay history
   │                                                     ▼ (אין createAgent/detach/WS)
   │
   └─ אחרת (אין חיבור — תרחיש נדיר מ-panel)  ──►  detach() + loadSession()  [קוד קיים]
```

**למה fallback?** ה-panel מוצג רק כשיש חיבור פעיל, אבל הגנה דפנסיבית: אם משום-מה
`#client === null`, ליפול לנתיב הכבד הקיים במקום no-op שקט.

---

## §4 — Commits

### Commit 1 — switchSession warm reload (approach: integration)

**קבצים שמשתנים**:
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — מתודה חדשה `switchSession`.
- `packages/frontend/src/lib/components/layout/SessionOptionsPanel.svelte` — `selectSession` קורא לה.

**4.א — `AgentSession.switchSession` (מתודה חדשה, תוספתי)**

מקם **מיד אחרי `loadSession`** (אחרי שורה 275, סוף ה-method הקיים), באותו בלוק
"התמדת סשן". חתימה זהה ל-`loadSession` (קל לקרוא ל-fallback):

```ts
/**
 * החלפת סשן על החיבור הקיים — warm reload.
 * דורש #client פעיל. קורא ל-loadSession של ACP על אותו WS/bridge (ללא createAgent/WS חדש).
 * אם אין #client — נופל ל-loadSession הכבד (יצירת agent חדש).
 *
 * למה לא detach+loadSession: detach הורג את ה-bridge וגורם ל-race של WS closed (1005)
 * + spawn מיותר. כאן משתמשים בחיבור הקיים — מיידי, ללא race.
 * (אומת: opencode session/load עובד cross-cwd על אותו bridge.)
 */
switchSession = async (input: {
  sessionId: string
  cwd: string
  cliKind: CliKind
}): Promise<void> => {
  // אין חיבור פעיל → נתיב כבד (דפנסיבי; ה-panel מוצג רק עם חיבור)
  if (this.#client === null) {
    return this.loadSession(input)
  }
  // לא להחליף באמצע thinking/connecting
  if (this.status !== "connected") {
    throw new Error(`cannot switchSession in status ${this.status}`)
  }
  // DEV mock: עדיין דרך הנתיב הכבד (mock לא רץ על #client חי)
  if (import.meta.env.DEV && input.sessionId.startsWith("mock:")) {
    return this.loadSession(input)
  }

  this.#setStatus("connecting")
  this.error = null
  this.bubbles = []

  try {
    this.isLoadingHistory = true
    try {
      const loadResult = await this.#client.loadSession({
        sessionId: input.sessionId,
        cwd: input.cwd,
      })
      this.#captureSessionConfig(loadResult)
    } finally {
      this.isLoadingHistory = false
    }
    this.#sessionId = input.sessionId
    this.cwd = input.cwd

    // הודע ל-BE על הסשן החדש (best-effort, אותו agentId הקיים)
    if (this.agentId) {
      await notifySessionAttached(this.agentId, input.sessionId).catch(() => {})
    }

    this.#setStatus("connected")
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    this.error = `switchSession failed: ${msg}`
    this.#setStatus("error")
    // לא #cleanup — החיבור עדיין תקין; רק הטעינה נכשלה. השאר את ה-#client חי.
  }
}
```

**דרישות מימוש (חשוב)**:
- **אסור `#cleanup()` ב-catch** — להבדיל מ-loadSession הכבד. כאן ה-WS/bridge תקין;
  כשל ב-loadSession לא צריך להרוג את החיבור. רק `error` + status. (אם תהרוג, חוזרים לבאג.)
- **`#sessionId` מתעדכן רק בהצלחה** (אחרי ה-await), כמו ב-loadSession הכבד (sessionId מ-input).
- אין נגיעה ב-`#detached` — אין detach כאן.
- `notifySessionAttached` עם ה-`agentId` הקיים (לא חדש).

**4.ב — `selectSession` ב-SessionOptionsPanel (שינוי שורות 108-117)**

החלף את הגוף:
```ts
async function selectSession(info: { sessionId: string; cwd: string }) {
  await session.switchSession({
    sessionId: info.sessionId,
    cwd: info.cwd,
    cliKind: settings.cliKind,
  })
  uiShell.closeSheet()
  await goto("/chat")
}
```
- הסר את `session.detach()` — `switchSession` מטפל בהכל (ויש fallback פנימי).
- שאר השורות (closeSheet, goto) ללא שינוי.

> **הערה**: אין צורך לבדוק `isConnected` ב-panel — ה-fallback בתוך `switchSession` מטפל.

**Verification (Commit 1)**:
```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 test
pnpm lint:i18n
pnpm --filter @drive-coding/frontend-v2 build   # כדי שה-tunnel יציג את השינוי
```

### Commit 2 — walkthrough + decision update (approach: none/docs)

- עדכן `docs/walkthrough.md` — entry קצר על התיקון.
- **אל תיגע ב-`docs/decisions/voice-acp.md`** — מרדכי כותב decisions.

---

## §5 — Definition of Done

1. typecheck נקי (פרט ל-narrate.test.ts pre-existing — לא שלנו).
2. build נקי.
3. כל הטסטים הקיימים עוברים (אין רגרסיה).
4. lint:i18n נקי.
5. `switchSession` קיים ב-AgentSession עם החתימה לעיל.
6. `switchSession` כש-`#client === null` → קורא `loadSession` (fallback).
7. `switchSession` כש-`status !== "connected"` → זורק (לא מחליף באמצע thinking).
8. `switchSession` **לא** קורא `#cleanup` ב-catch (החיבור נשאר חי).
9. `selectSession` ב-panel קורא `switchSession` (לא detach+loadSession).
10. **אימות runtime (calev)**: החלפת סשן דרך ה-UI (tunnel) — **אין "WS closed (1005)"**,
    ההיסטוריה נטענת, וה-BE log מראה **שלא נוצר createAgent חדש ולא נהרג הקיים** בעת
    ההחלפה — calev יגרפ היעדר של **שני** המרקרים: `createAndSpawn` **וגם** `deleteAndKill`
    (רק `session/load` על ה-bridge הקיים אמור להופיע).
11. **בדיקת cross-rename**: בחירת סשן שמופיע עם נתיב "ישן" (אחרי rename) נטענת בהצלחה
    על אותו bridge (זה מה שהאימות האמפירי הראה — אותו bridge טוען cross-cwd).
12. רגרסיה: התחברות ראשונה מדף-החיבור (`attach`) עדיין עובדת; loadSession מדף-חיבור עדיין עובד.

---

## §6 — סיכונים

- **ACP loadSession פעמיים על אותו client**: אומת אמפירית שעובד (probe). אם בכל זאת
  ה-CLI מסרב loadSession שני על אותו חיבור — ה-catch לא הורג את החיבור, המשתמש רואה
  error אבל הסשן הקודם עדיין פעיל. עצור ודווח למרדכי אם זה קורה.
- **bubbles replay כפול**: `bubbles = []` לפני ה-load מנקה; ה-history מנוגן מ-`#onSessionUpdate`.
  ודא שאין כפילות (אותו דפוס כמו loadSession הכבד שכבר עובד).
- **status guard**: אם המשתמש לוחץ החלפה באמצע thinking — נזרק. שקול אם ה-UI צריך
  לחסום את הכפתור במצב thinking (לא בscope — רק לוודא שלא קורס).

---

## §7 — בדיקה ידנית (לאחר build + rebuild)

1. פתח `https://musicode-sessions-inline.tuns.sh` → Connect ל-cwd כלשהו.
2. sidebar → Sessions → Refresh → רשימה נטענת.
3. בחר סשן אחר → **ההיסטוריה מתחלפת מיד, אין "WS closed", אין הבהוב**.
4. בדוק BE log: אין `createAndSpawn` / `deleteAndKill` בעת ההחלפה (רק בהתחברות ראשונה).
5. בחר סשן עם נתיב "ישן" (rename) → נטען בהצלחה.
6. שלח פרומפט אחרי החלפה → עובד (החיבור חי).

---

## §8 — Complexity

4/10. שינוי ממוקד בקובץ אחד עיקרי (AgentSession) + שורות בודדות ב-panel. הסיכון
העיקרי הוא runtime (race/ACP semantics), לכן verifier = **calev light + phase על Commit 1**
(לא heavy — אין edge-case-hunting כבד; האמת ב-runtime, אומתה אמפירית מראש).
