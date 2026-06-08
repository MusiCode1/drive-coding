# Slice new-session-warm — "סשן חדש" על החיבור הקיים (ללא respawn) — תוכנית

> **תאריך**: 2026-06-08
> **סטטוס**: brief-ready (ממתין לאביגיל)
> **Complexity**: 3/10 (verifier: calev light + phase על Commit 1)
> **תלויות (`depends_on`)**: [] — אין. בנוי על קוד שכבר ב-`dev` (switchSession + replace-flag כבר merged).
> **Base**: `dev` (tip `17a8d17`) — branch חדש `slice-new-session-warm`.
> **Dev tip**: `17a8d17`

---

## §0 — Pre-flight

> זהו slice עצמאי קטן. הקוד שעליו הוא נשען (`switchSession`, `notifySessionAttached` עם
> `replace`, ה-guard MED-9) **כבר קיים ב-`dev`** — ראה §1.1. אין תלות ב-slice לא-merged.

### Worktree (חדש)

```bash
cd /home/user/projects/voice-acp/dev
git worktree add .worktrees/slice-new-session-warm -b slice-new-session-warm dev
cd .worktrees/slice-new-session-warm
git log --oneline -1   # ודא tip == 17a8d17
```

### איך להריץ

| מה | פקודה |
|---|---|
| typecheck | `pnpm --filter @drive-coding/frontend-v2 typecheck` (אם TS6305: `find packages -name '*.tsbuildinfo' -delete` + `pnpm --filter @drive-coding/core build`) |
| tests FE | `pnpm --filter @drive-coding/frontend-v2 test` |
| build | `pnpm --filter @drive-coding/frontend-v2 build` |
| lint:i18n | `pnpm lint:i18n` (חובה לפני commit) |

> ⚠️ שם package ה-FE: `@drive-coding/frontend-v2`.

### סביבה

- **BE**: רץ עם OneCLI (agent `voice-acp`), מגיש גם FE סטטי מ-`packages/frontend/build`.
- ⚠️ אחרי build חדש של ה-FE: ה-BE מגיש את ה-`build/` — צריך **rebuild FE** כדי שהשינוי ייראה דרך ה-tunnel (אין HMR — production-mode).
- ⚠️ אל תהרוג את ה-BE/tunnel. אם צריך restart — דווח למרדכי.
- נתיב/port/tunnel מדויקים: יתרו/מרדכי ימסרו ב-dispatch (תלוי בסביבה החיה באותו לילה).

### Browser

- בדיקה דרך ה-tunnel ב-linux-gui Chrome (session `vacp`). ראה skill `linux-gui-browser`.
- אם אין גישה ל-linux-gui — דווח למרדכי לאימות ידני.

---

## §1 — מטרה

### התנהגות היום (הבאג)

הכפתור "סשן חדש" (`onNewSession` ב-`SessionOptionsPanel.svelte`) עושה:
```ts
function onNewSession() {
  session.detach()   // הורג bridge + WS, מאפס status→idle
  goto("/")          // זורק חזרה למסך החיבור
}
```
התוצאה: המשתמש נזרק למסך בחירת cwd/cliKind/קול, ה-bridge נהרג, ובהתחברות הבאה
נעשה **respawn** מלא של ה-CLI + handshake. כל זה כדי לפתוח סשן ריק — בזבזני ומנתק חוויה.

### התנהגות אחרי ה-slice

"סשן חדש" פותח **סשן ACP ריק חדש על החיבור הנוכחי** — אותו agent-process, אותו WS,
אותו bridge. בלי respawn, בלי handshake מחדש, בלי חזרה למסך החיבור. נשאר באותה תיקייה
(`session.cwd`) ובאותו CLI. המסך עובר/נשאר ב-`/chat` עם בועות ריקות, מוכן לפרומפט.

---

### §1.1 — ⭐ הממצא הארכיטקטוני (השאלה: "אין מצב בלי לאתחל פרוסס חדש?")

**התשובה: כן — אפשר, בלי שום process חדש. זה גם הנתיב הזול והנכון.**

הוכחה מהקוד (אומת, לא הסקה):

1. **`AcpClient.newSession` רץ על אותו `ClientSideConnection`/transport.**
   `dev/packages/core/src/acp/client.ts:135-137` — `newSession(opts)` קורא
   `conn.newSession({ cwd, mcpServers: [] })` על ה-`conn` שנבנה פעם אחת ב-`createAcpClient`
   מעל ה-transport הקיים. אין שם spawn, אין handshake — `initialize` כבר רץ פעם אחת
   בבניית ה-client. כל `newSession`/`loadSession`/`prompt` הם RPC-ים על אותו צינור.

2. **ה-bridge הוא per-agentId, לא per-session.** `bridge-manager.ts` — process יחיד
   (`child`) ל-`bridgeId`, מחזיק `store: Map<bridgeId, Entry>`. אין קישור bridge↔sessionId.
   process אחד מטפל ב-N סשנים סדרתיים (זה בדיוק מה ש-opencode עושה — `session/new`,
   `session/load`, `session/list` כולם על אותו child).

3. **התשתית ל-warm reuse כבר קיימת ועובדת** — `switchSession`
   (`agent-session.svelte.ts:288-337`) כבר עושה את אותו דבר עבור **טעינת** סשן קיים:
   קורא `this.#client.loadSession(...)` על ה-`#client` הקיים, **בלי** `createAgent`/WS/detach.
   ה-slice הזה הוא תאום שלו: `this.#client.newSession(...)` במקום `loadSession`.

4. **ה-BE כבר תומך ב-re-attach של אותו agent ל-sessionId אחר.**
   `http-agents.ts:99-134` — `POST /api/agents/:id/session-attached` עם `replace:true`
   עוקף את guard MED-9 ומעדכן `acpSessionId` של אותו agentId. `notifySessionAttached`
   כבר תומך ב-`{ replace: true }` (`agents-api.ts:61-77`). אותו מנגנון בדיוק ש-`switchSession`
   משתמש בו (`agent-session.svelte.ts:325-327`).

**מסקנה**: אין שום סיבה ל-respawn. הגישה = מתודה `newSession` חדשה על `AgentSession`,
זהה במבנה ל-`switchSession`, שקוראת `this.#client.newSession({ cwd })` על החיבור הקיים.

> **trade-off שנשקל ונדחה — "respawn מלא" (detach+attach)**: זה הקוד היום. עלות:
> ~300-700ms spawn + הריגת bridge + race של "WS closed (1005)" (אותו באג ש-switchSession
> תיקן עבור החלפת סשן) + חזרה למסך החיבור. אין לזה שום יתרון על הנתיב ה-warm. נדחה.
>
> **trade-off שנשקל ונדחה — "להישאר במסך החיבור אבל לדלג על הבחירה"**: עדיין respawn.
> נדחה מאותה סיבה.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| `AgentSession.newSession()` — מתודה חדשה, warm new-session על `#client` הקיים | ✅ | Commit 1 |
| `onNewSession` ב-panel קורא `session.newSession()` + `goto("/chat")` במקום detach+goto("/") | ✅ | Commit 1 |
| fallback: אם אין `#client` (status idle) → נופל ל-`attach` (יצירת agent חדש) עם `cwd`/`cliKind` הנוכחיים | ✅ | Commit 1 |
| שמירת `cwd`/`cliKind` הנוכחיים לשימוש ב-fallback | ✅ | Commit 1 (קיים — `session.cwd`, `settings.cliKind`) |
| שינוי שם המתודה `attach`/`loadSession`/`switchSession` הקיימות | ❌ | לא נוגעים — additive בלבד |
| שינוי ה-state machine / שדות `$state` | ❌ | לא — מתודה ציבורית חדשה היא ADDITIVE (ראה הערת parallel-safe בראש הקובץ) |
| שינוי מסך החיבור (`+page.svelte`) | ❌ | לא — "סשן חדש" כבר לא מנווט לשם |
| מחיקת סשן ישן ב-ACP/DB | ❌ | לא בscope — הסשן הישן נשאר בהיסטוריה, פשוט פותחים חדש לידו |

---

## §3 — Architecture

```
onNewSession()  [SessionOptionsPanel.svelte]
   │
   ├─ session.newSession()
   │     │
   │     ├─ #client !== null (status connected) ──► warm: #client.newSession({ cwd })
   │     │                                            אותו WS/bridge/agentId
   │     │                                            bubbles=[], sessionId חדש
   │     │                                            notifySessionAttached(replace:true)
   │     │                                            ▼ (אין createAgent/detach/WS)
   │     │
   │     └─ #client === null (דפנסיבי) ──► attach({ cwd, cliKind })  [קוד קיים]
   │
   └─ goto("/chat")   [נשאר בצ'אט, לא חוזר ל-"/"]
```

**מקור ה-cwd/cliKind ל-fallback**: `this.cwd` נשמר ב-`attach`/`loadSession`/`switchSession`
(שדה `$state`, שורה 69). ה-`cliKind` לא נשמר על ה-session — ה-panel מעביר אותו מ-`settings.cliKind`
(אותו מקור ש-`selectSession` משתמש בו, שורה 112). לכן ה-fallback מקבל `cliKind` כפרמטר.

**למה fallback?** ה-panel מוצג רק כשיש חיבור, אבל הגנה דפנסיבית: אם `#client === null`
(status idle איכשהו), ליפול ל-`attach` במקום no-op שקט. ה-fallback צריך `cwd`+`cliKind`.

---

## §4 — Commits

### Commit 1 — newSession warm + חיווט הכפתור (approach: integration)

**קבצים שמשתנים**:
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — מתודה חדשה `newSession`.
- `packages/frontend/src/lib/components/layout/SessionOptionsPanel.svelte` — `onNewSession` קורא לה.

**4.א — `AgentSession.newSession` (מתודה חדשה, ADDITIVE)**

מקם **מיד אחרי `switchSession`** (אחרי שורה 337, סוף ה-method), באותו בלוק
"החלפת סשן". חתימה: `cwd` אופציונלי (ברירת מחדל `this.cwd`), `cliKind` חובה (ל-fallback):

```ts
/**
 * פתיחת סשן ACP חדש **על החיבור הקיים** — warm new-session.
 * דורש #client פעיל. קורא ל-newSession של ACP על אותו WS/bridge (ללא createAgent/WS חדש).
 * אם אין #client — נופל ל-attach הכבד (יצירת agent חדש) עם ה-cwd/cliKind שהועברו.
 *
 * שונה מ-switchSession: זה newSession (סשן ריק) ולא loadSession (היסטוריה קיימת).
 * אותה לוגיקת warm: אותו #client, אותו agentId, ללא detach/respawn.
 * למה לא detach+attach: detach הורג bridge + גורם ל-race "WS closed (1005)" + spawn מיותר.
 */
newSession = async (input: { cwd?: string; cliKind: CliKind }): Promise<void> => {
  const cwd = input.cwd ?? this.cwd
  // אין חיבור פעיל → נתיב כבד (דפנסיבי; ה-panel מוצג רק עם חיבור)
  if (this.#client === null) {
    if (!cwd) throw new Error("newSession: no cwd available for fallback attach")
    return this.attach({ cwd, cliKind: input.cliKind })
  }
  // לא לפתוח סשן חדש באמצע thinking/connecting
  if (this.status !== "connected") {
    throw new Error(`cannot newSession in status ${this.status}`)
  }
  if (!cwd) throw new Error("newSession: no cwd")

  this.#setStatus("connecting")
  this.error = null
  this.bubbles = []

  try {
    const result = await this.#client.newSession({ cwd })
    const newId = (result as { sessionId?: string }).sessionId ?? null
    if (!newId) throw new Error("newSession returned no sessionId")
    this.#sessionId = newId
    this.cwd = cwd
    this.#captureSessionConfig(result)

    // הודע ל-BE על הסשן החדש (best-effort, אותו agentId הקיים).
    // replace:true — מעבר מכוון לסשן אחר על אותו agent, עוקף guard MED-9.
    if (this.agentId) {
      await notifySessionAttached(this.agentId, newId, { replace: true }).catch(() => {})
    }

    this.#setStatus("connected")
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    this.error = `newSession failed: ${msg}`
    this.#setStatus("error")
    // לא #cleanup — החיבור עדיין תקין; רק יצירת הסשן נכשלה. השאר את ה-#client חי.
  }
}
```

**דרישות מימוש (חשוב)**:
- **אסור `#cleanup()` ב-catch** — להבדיל מ-`attach`. כאן ה-WS/bridge תקין; כשל ב-newSession
  לא צריך להרוג את החיבור. רק `error` + status. (זהה לעיקרון של `switchSession`.)
- **`#sessionId` מתעדכן רק בהצלחה**, מתוך תגובת ה-ACP (לא קלט — ל-newSession אין sessionId
  בקלט). זה ההבדל מ-`loadSession`/`switchSession` ששם ה-sessionId מגיע מ-input.
- אין נגיעה ב-`#detached` — אין detach כאן.
- `notifySessionAttached` עם `{ replace: true }` (כמו `switchSession`) — אחרת guard MED-9
  מחזיר 409 כי ה-agent כבר ready עם sessionId אחר.
- `bubbles = []` — סשן חדש מתחיל ריק. אין `isLoadingHistory` (אין היסטוריה לנגן).

**4.ב — `onNewSession` ב-SessionOptionsPanel (שינוי שורות 122-125)**

החלף את הגוף:
```ts
async function onNewSession() {
  await session.newSession({ cliKind: settings.cliKind })
  uiShell.closeSheet()
  await goto("/chat")
}
```
- הסר את `session.detach()` ו-`goto("/")`.
- `cwd` לא מועבר — `newSession` משתמש ב-`session.cwd` הנוכחי כברירת מחדל.
- `cliKind` מ-`settings.cliKind` (אותו מקור כמו `selectSession`).
- `closeSheet()` (מובייל) + `goto("/chat")` — להתיישר עם `selectSession`.
- עדכן את הערת ה-JSDoc מעל `onNewSession` (שורות 118-121) שמתארת detach+goto("/") — כבר לא נכון.

> **i18n**: המפתח `sidebar.newSession` כבר קיים (`he.ts:137`, `en.ts:142`) — אין מפתח חדש.

**Verification (Commit 1)**:
```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 test
pnpm lint:i18n
pnpm --filter @drive-coding/frontend-v2 build   # כדי שה-tunnel יציג את השינוי
```

### Commit 2 — walkthrough (approach: none/docs)

- עדכן `docs/walkthrough.md` — entry קצר: "סשן חדש" עכשיו warm (ללא respawn).
- **אל תיגע ב-`docs/decisions/voice-acp.md`** — מרדכי כותב decisions.

---

## §5 — Definition of Done

1. typecheck נקי (פרט ל-pre-existing failures שאינם שלנו — דווח אם יש).
2. build נקי.
3. כל הטסטים הקיימים עוברים (אין רגרסיה).
4. lint:i18n נקי.
5. `newSession` קיים ב-`AgentSession` עם החתימה לעיל, ממוקם אחרי `switchSession`.
6. `newSession` כש-`#client === null` → קורא `attach({ cwd, cliKind })` (fallback) עם ה-cwd/cliKind שהועברו.
7. `newSession` כש-`status !== "connected"` ויש `#client` → זורק (לא פותח באמצע thinking).
8. `newSession` **לא** קורא `#cleanup` ב-catch (החיבור נשאר חי).
9. `newSession` מעדכן `#sessionId` מתגובת ה-ACP (לא מ-input), ורק בהצלחה.
10. `newSession` קורא `notifySessionAttached(..., { replace: true })` (לא בלי replace).
11. `onNewSession` ב-panel קורא `session.newSession(...)` + `goto("/chat")` — **לא** `detach()` ו-**לא** `goto("/")`.
12. **אימות runtime (calev)**: לחיצה על "סשן חדש" דרך ה-UI (tunnel) →
    א. ה-UI נשאר ב-`/chat` (לא חוזר ל-`/`).
    ב. הבועות מתרוקנות; אפשר לשלוח פרומפט מיד והוא נענה.
    ג. ה-BE log מראה **שלא נוצר createAgent חדש ולא נהרג bridge** בעת הלחיצה —
       calev יגרפ **היעדר** של `createAndSpawn` **וגם** `deleteAndKill`; אמור להופיע
       **רק** `session/new` על ה-bridge הקיים.
    ד. אין "WS closed (1005)".
13. רגרסיה: התחברות ראשונה מדף-החיבור (`attach`) ו-`switchSession` (בחירת סשן קיים) עדיין עובדים.

---

## §6 — סיכונים

- **`session/new` שני על אותו client**: אנלוגי ל-`loadSession` שני, שאומת אמפירית ב-slice
  switch-session-warm שעבד. אם בכל זאת ה-CLI מסרב `session/new` שני על אותו חיבור —
  ה-catch לא הורג את החיבור; המשתמש רואה error והסשן הקודם נשאר פעיל. **עצור ודווח למרדכי**
  אם זה קורה (זה היה משנה את הממצא הארכיטקטוני).
- **guard MED-9 (409)**: אם שוכחים `replace:true` → ה-BE מחזיר 409 וה-`acpSessionId` ב-registry
  לא מתעדכן (אך הקריאה היא best-effort/catch, אז ה-UI לא קורס — רק ה-registry מתפספס). חובה `replace:true`.
- **bubbles**: `bubbles = []` לפני ה-`newSession`. אין history replay (סשן ריק) → אין סיכון כפילות.
- **status guard באמצע thinking**: אם המשתמש לוחץ "סשן חדש" באמצע תגובה — נזרק (status!=="connected").
  לא בscope לחסום את הכפתור ויזואלית — רק לוודא שלא קורס (ה-throw נתפס? לא — `onNewSession`
  הוא async ללא try; **דרישה**: ודא שה-throw לא מפיל את ה-UI. אם צריך — עטוף ב-try/catch ב-panel
  שמדפיס ל-console, כמו דפוסים קיימים. ציין החלטה ב-walkthrough.)
- **DEV mock**: בניגוד ל-`switchSession`, אין כאן ענף `mock:` — `newSession` תמיד דורש `#client`
  אמיתי. אם המשתמש על mock-session (אין `#client`) → ה-fallback ל-`attach` ייצור agent אמיתי.
  זה התנהגות מקובלת (יציאה מ-mock לחיבור אמיתי). לא צריך טיפול מיוחד.

---

## §7 — בדיקה ידנית (לאחר build + rebuild)

1. פתח את ה-tunnel → Connect ל-cwd כלשהו → צ'אט נטען.
2. שלח פרומפט אחד → קבל תשובה (יש היסטוריה).
3. sidebar/sheet → לחץ "＋ סשן חדש".
4. **נשאר ב-`/chat`** (לא חוזר למסך החיבור), הבועות נעלמו.
5. בדוק BE log: **אין** `createAndSpawn` / `deleteAndKill` בעת הלחיצה (רק `session/new` על ה-bridge הקיים).
6. שלח פרומפט בסשן החדש → עובד (החיבור חי, סשן טרי).
7. רגרסיה: Sessions → בחר סשן קיים (`switchSession`) → עדיין עובד; Disconnect → עדיין עובד.

---

## §8 — Complexity

**3/10.** שינוי ADDITIVE ממוקד: מתודה אחת חדשה (תאום מבני של `switchSession` שכבר עובד
בפרודקשן) + שינוי 4 שורות ב-panel. אין שינוי state, אין מפתח i18n חדש, אין שינוי BE
(ה-`replace` flag והמנגנון כבר קיימים ומאומתים). הסיכון היחיד הוא runtime-semantics
(`session/new` שני על אותו client) — אנלוגי ל-`loadSession` שאומת. לכן:

**verifier = `calev` (light) + phase על Commit 1.** לא heavy — אין edge-case-hunting,
אין שינוי חוצה-שכבות. האמת היחידה שצריך לאמת היא ב-runtime (BE log: אין respawn), וזה
מה ש-DoD §12 מכוון אליו.

### Testing strategy פר commit

| Commit | approach | מה נבדק |
|--------|----------|---------|
| 1 — newSession + חיווט | integration (+ runtime calev) | ה-unit הקלאסי ל-`newSession` חסום: `$effect`/`#client` לא רצים תחת vitest SSR (ראה memory: vitest-effects-ssr-limitation). לכן: (א) typecheck + build כ-gate סטטי; (ב) אם קיים test שמוקק את `#client` ב-`agent-session.test.ts` — הוסף case ל-fallback ול-`replace:true`; (ג) **האמת העיקרית = runtime calev** (DoD §12) — log אין-respawn. |
| 2 — walkthrough | none (docs) | קריאה ידנית |

> **הערה ל-calev**: ה-DoD החשוב הוא §12.ג — גריפ ב-BE log שאין `createAndSpawn`/`deleteAndKill`
> בעת לחיצת "סשן חדש". זה ההוכחה לממצא הארכיטקטוני (אין respawn). אם המרקרים האלה כן מופיעים —
> זה NO-GO ודיווח למרדכי.
