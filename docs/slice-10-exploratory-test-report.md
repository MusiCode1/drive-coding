# Slice 10 — Exploratory Test Report
> ‏‏תאריך: 2026-05-18T08:43Z → 09:06Z
> ‏Branch: `vnext-fe-orchestrated`
> ‏HEAD: `de59622`
> ‏‏זמן בדיקה: ‏~25 דקות
> ‏tester: ‏exploratory tester (general sub-agent, Opus 4.7)
> ‏Browser: ‏‏linux-gui Chrome via pw-clean.sh (CDP attach, port 9333)

---

## TL;DR

| ‏מדד | ‏מספר |
|------|------|
| ‏SWEEPS בוצעו | 12/12 |
| ‏Findings | 12 |
| ‏Blockers | **2** |
| ‏Major | **3** |
| ‏Minor | **3** |
| ‏Cosmetic | **4** |

‏ה-app **עובד יפה ברמת flow ראשי**: ‏יצירת agent, ‏prompt → response, ‏TTS streaming, ‏STT עברית, ‏multi-tab guard, ‏bridge crash UI, ‏settings ‏persistence — ‏כולם פועלים נכון. ‏ה-architecture של slice 10 ‏(FE-orchestrated, ‏BE כ-transparent proxy) ‏מוכחת ב-DevTools — ‏עשרות calls ל-`/proxy/google/...` ‏ו-`/proxy/elevenlabs/.../stream` ‏עם status 200.

**אבל**: ‏יש שני **blockers** סביב יצירת agent עם ‏cwd ‏לא-תקין שמפילים את כל ה-BE process (uncaught ENOENT exception על `npx`), ‏ובאג של ‏double-URL-encoding ‏ש-FE שולח ל-BE ‏בעקבות ניווט ‏מ-/sessions ל-/session/[hash]/[id]. ‏אחד הbugs הללו ‏‏גם הוא secondary trigger ל-BE crash.

---

## ‏סטטוס תיקונים (2026-05-18)

‏כל finding מכיל בלוק `> **‏סטטוס תיקון**` בסוף הסעיף שלו עם פירוט מה נעשה. ‏טבלת סיכום:

| # | Severity | Status | Commit / הערה |
|---|----------|--------|----------------|
| F-1 | blocker | ✅ נסגר | `4fd3b30` → `a9efb22` → `a997017` (in-process spawn, ‏הסרת stdio-to-ws) |
| F-2 | blocker | ✅ נסגר | `c5a69d4` (cwd-hash + cwd-validate ספריות core) |
| F-3 | major | 🔓 פתוח | user_message_chunk ב-session/load — Open Q-4 |
| F-4 | major | 🔓 פתוח | reload mid-streaming → איבוד response |
| F-5 | major | 🔓 פתוח | BE persistence — Open Q-6 (חשיבות פחתה אחרי F-1) |
| F-6 | minor | ✅ נסגר | `c5a69d4` (route דוחה hash לא-מוכר) |
| F-7 | minor | ❓ החלטה | Markdown rendering — Open Q-2 |
| F-8 | minor | 🔓 פתוח | crashReason — bridge-manager החדש מאפשר חשיפה |
| F-9 | cosmetic | ✅ נסגר (עקיף) | `c5a69d4` (BE דוחה cwd עם %XX) |
| F-10 | cosmetic | 🔓 פתוח | קיצור `/home/user/` ב-display — by design? |
| F-11 | cosmetic | 🔓 פתוח | favicon 404 — תיקון של דקה |
| F-12 | cosmetic | 🔓 פתוח | RLM ב-directory name — דורש החלטה |

**סיכום**: 5 נסגרו (2 blockers + 1 minor + 2 cosmetic), 5 פתוחים, 2 ממתינים להחלטה.

---

## Findings

### F-1 (BLOCKER): BE process קורס בעקבות ‏ENOENT על `npx` ‏ב-`spawnAndWaitForPort`

- **Severity**: blocker
- **SWEEP**: 2 + 6
- **Trigger**:
  - ‏POST `/api/agents` ‏עם ‏cwd ‏שלא קיים (e.g. `/nonexistent/path`), ‏או
  - ‏ניווט ‏ל-`/session/INVALID_HASH/INVALID_ID` (FE ‏שולח cwd ‏לא-‏תקני), ‏או
  - ‏בכל ‏ניסיון ליצור agent **בפעם השלישית-רביעית** ‏באותו session של ה-BE (אפילו ‏עם cwd ‏תקין — ‏ראה ‏Open Question 1)
- **Expected**: ‏ש-BE ‏יחזיר ‏4xx/5xx ‏error JSON, ‏יישאר חי, ‏וימשיך לטפל ‏בבקשות נוספות.
- **Actual**: ‏ה-BE Bun process **קורס לחלוטין** ‏עם uncaught exception. ‏pnpm חוזר עם `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`. ‏כל ה-agents שהיו ‏בזכרון נמחקים. ‏ה-FE רואה WS code 1006 ‏(abnormal close) ‏ומציג "‏חיבור נפל — ‏רענן את הדף".
- **Evidence** (BE log `/tmp/be-v3.log`):
  ```
  ENOENT: no such file or directory, posix_spawn 'npx'
        path: "npx",
     syscall: "spawn npx",
       errno: -2,
   spawnargs: [ "-y", "@rebornix/stdio-to-ws", "opencode acp", "--port", "51132", "--persist",
    "--grace-period", "-1"
  ],
        code: "ENOENT"
        at spawn (node:child_process:667:35)
        at spawnAndWaitForPort (/home/user/projects/voice-acp-v3/packages/backend/src/acp/bridge-spawn.ts:49:17)
        at spawnInternal (.../bridge-manager.ts:53:26)
        at spawnWithStderr (.../bridge-manager.ts:96:14)
        at createAndSpawn (.../agent-orchestrator.ts:149:45)
        at async <anonymous> (.../delivery/http-agents.ts:49:46)
  /home/user/projects/voice-acp-v3/packages/backend:
   ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @drive-coding/backend@0.0.0 dev: `bun --watch src/server.ts`
   Exit status 1
  ```
- **Repro steps**:
  1. ‏BE עולה, ‏יוצרים agent #1 ל-`/home/user/projects/voice-acp-v3` — ‏‏עובד.
  2. ‏‏Reload page, ‏יוצרים agent #2 ‏לאותו ‏cwd — ‏עובד.
  3. ‏‏מנסים ‏‏ליצור agent #3 ‏‏עם `cwd=/nonexistent/path` ‏‏‏‏‏(או ‏‏‏‏‏ב-fast follow ‏לאחר ‏‏ש-#2 קרס) — ‏BE ‏process מת.
- **Notes**:
  - ‏ב-source code `packages/backend/src/acp/bridge-spawn.ts:49` — ‏ה-spawn ‏נראה ‏‏ללא try/catch סביב ‏ה-exception async ‏(‏the ENOENT ‏הוא error event ‏‏על ‏ה-child, ‏‏‏לא thrown ‏מ-spawn() ‏עצמו, ‏אבל ‏‏הוא bubble-ה ‏‏לpromise rejection ‏‏‏‏ולא ‏‏‏‏נתפס).
  - ‏ה-`npx` ENOENT עצמו ‏הוא בעיית ‏‏‏‏‏environment: ‏OneCLI/Bun ‏‏לא ‏‏מורישים ‏את ‏‏‏ה-fnm PATH ‏ל-child processes ‏אחרי N spawn cycles, ‏או ‏‏ש-stdio-to-ws ‏‏‏מתנתק ‏מ-cached ‏‏npm exe ‏לאחר זמן.
  - ‏‏ה-‏‏סיבה הראשונית: ‏יצירת ‏agent ‏עם ‏‏cwd ‏‏לא-קיים ‏‏(/nonexistent) ‏ש-spawn ‏‏‏מקבל ‏‏‏‏אבל ‏‏‏ה-bridge child ‏מת, ‏גוררת flow ‏שמדליק את ה-ENOENT bug ‏‏‏בbubble ‏הבא.
  - ‏**ההמלצה (לא מבצע)**: ‏עטיפת ‏`spawnAndWaitForPort` ‏ב-try/catch ‏שיעלה ל-HTTP 500 ‏‏ולא ‏יפיל ‏‏‏את ‏‏ה-process.

> **‏סטטוס תיקון** (2026-05-18): ✅ **נסגר** — commits `4fd3b30` → `a9efb22` → `a997017` (סוכן מקביל, Slice 10 F-1 brief).
> שכבת `stdio-to-ws` הוסרה לחלוטין; bridge-manager עובר ל-`node:child_process.spawn` ישיר עם error listener נרשם לפני async tick. ה-WS עובר מ-`Bun.serve` ל-`@hono/node-server` + `ws.WebSocketServer`.
> 3 integration tests שהיו אדומים → ירוקים.

---

### F-2 (BLOCKER): ‏ניווט ‏‏מ-/sessions ל-/session/[cwdHash]/[id] ‏שולח cwd double-encoded

- **Severity**: blocker
- **SWEEP**: 6
- **Trigger**: ‏כל session ‏ב-/sessions list — ‏click → ‏redirect ל-`/session/%252Fhome%252Fuser%252Fprojects%252Fvoice-acp-v3/ses_XXX?cli=opencode`
- **Expected**: ‏ה-FE ‏מנווט ל-agent קיים ‏‏‏(אם זמין) ‏‏‏‏‏או ‏יוצר agent ‏חדש ‏עם cwd **decoded פעם אחת** ‏(`/home/user/projects/voice-acp-v3`) ‏ו-ACP יבצע ‏`session/load` ‏ל-sessionId.
- **Actual**: ‏ה-FE שולח POST ל-`/api/agents` ‏עם ‏cwd=`/%2Fhome%2Fuser%2Fprojects%2Fvoice-acp-v3` ‏‏(double-encoded). ‏BE ‏מנסה לspawn ‏‏‏ב-cwd ‏זה, ‏נכשל. ‏FE ‏מציג ‏alert: ‏"שגיאה: spawn failed for agent <id>: spawn returned no pid" ‏עם link "← ‏חזרה ‏להיסטוריה". ‏בנוסף, ‏‏‏(F-1) ‏ה-BE קורס.
- **Evidence**:
  - ‏URL ‏בbrowser: ‏`/session/%252Fhome%252Fuser%252Fprojects%252Fvoice-acp-v3/ses_1c5b46f31ffek1TAD98YTl0zMD?cli=opencode`
  - ‏BE log:
    ```
    [08:58:45.422] INFO: createAndSpawn start
        ns: "backend.orchestrator"
        cliKind: "opencode"
        cwd: "/%2Fhome%2Fuser%2Fprojects%2Fvoice-acp-v3"
    ```
- **Repro steps**:
  1. ‏ניווט ‏ל-`/sessions`
  2. ‏Click ‏‏‏‏על ‏‏session ‏עדכני
  3. ‏‏‏‏רואים ‏את ‏ה-URL ‏עם `%252F` ‏‏‏(double-encode of `/`)
  4. ‏‏‏FE ‏שולח cwd ‏עם ‏encoding ‏אחד, ‏‏ה-BE ‏‏מפענח ‏‏פעם ‏‏‏‏אחת, ‏‏ונשאר ‏‏עם ‏`%2F` ‏לא-מפוענח.
- **Notes**:
  - ‏סביר ‏‏‏שhe-‏cwdHash ‏בpath ‏‏‏‏הוא ‏encodeURIComponent של ‏ה-‏cwd (`/home/user/projects/voice-acp-v3` → `%2Fhome%2Fuser%2Fprojects%2Fvoice-acp-v3`), ‏‏‏ואז SvelteKit ‏‏‏‏מעטף ‏אותו ‏‏‏שוב ‏(% → %25). ‏ה-FE ‏לא ‏‏‏‏מבצע decode סופי לפני ‏‏‏ה-POST.
  - ‏‏‏המסלול ‏הוא probably ‏לא ‏‏לעבור ‏דרך ‏‏‏‏‏create agent ‏‏בכלל — ‏‏אלא ‏‏‏‏לחפש agent ‏‏קיים ‏עם ‏‏‏‏‏אותו cwd+sessionId ‏‏‏ולעשות resume.
  - ‏Trigger ‏‏גם ל-F-1 (BE crash).

> **‏סטטוס תיקון** (2026-05-18): ✅ **נסגר** — commit `c5a69d4`.
> נוספו 2 ספריות core: `cwd-hash` (Web Crypto, זהה ל-BE ו-FE) ו-`cwd-validate` (Result, דוחה `%XX` / NUL / לא-מוחלט). ה-FE עכשיו מחשב `cwdHash` לכל session בזמן load ושולח hash אמיתי ב-URL — אין יותר fallback של `encodeURIComponent(cwd)`. BE דוחה cwd לא-תקין ב-HTTP 400 לפני spawn.

---

### F-3 (MAJOR): ‏‏Reload דף — ‏user bubbles ‏מההיסטוריה ‏לא ‏‏טוענים

- **Severity**: major
- **SWEEP**: 5
- **Trigger**: ‏שליחת prompt → ‏‏קבלת assistant ‏response → ‏reload (F5).
- **Expected**: ‏אחרי reload, ‏‏היסטוריה ‏מלאה ‏‏טוענת ‏מ-`session/load` ‏‏(user prompt + assistant response).
- **Actual**: ‏‏‏רק ‏ה-‏‏assistant ‏bubbles ‏טוענות. ‏‏ה-user bubbles **חסרות**. ‏ה-conversation ‏נראית לא-‏הגיונית — ‏‏פתאום ‏מופיע ‏מענה ‏ללא ‏שאלה.
- **Evidence**:
  - ‏Snapshot ‏לפני reload: ‏2 ‏bubbles (user "‏‏תגיד שלום" + assistant "‏‏שלום! ‏מה ‏אפשר ‏לעשות בשבילך?").
  - ‏Snapshot ‏אחרי reload: ‏רק 1 bubble (assistant "‏‏שלום! ...").
  - ‏Source code `packages/frontend/src/lib/stores/agent-session.svelte.ts:395-398`:
    ```ts
    default:
      // user_message_chunk, plan, available_commands_update, current_mode_update, etc.
      // → currently not surfaced in UI (future slice if needed)
      break
    ```
- **Repro steps**:
  1. ‏‏ניווט ‏‏ל-agent ‏‏‏‏ready
  2. ‏‏שלח prompt
  3. ‏‏‏המתן ל-response
  4. ‏Reload (F5)
  5. ‏‏‏בדוק ‏רשימת bubbles
- **Notes**:
  - ‏ה-comment ב-`agent-session.svelte.ts:396` ‏‏מאשר ‏שזה known limitation: ‏`user_message_chunk` (ACP event ‏‏שמייצג user ‏‏‏prompt ‏‏בsession load) ‏‏‏‏אינו ‏מטופל.
  - ‏‏‏‏יכול ‏‏‏להיות classify-able ‏‏כ-"minor / planned future" ‏אבל ‏UX-‏wise ‏‏זה ‏פוגע חזק ‏‏בreadability ‏ולכן ‏major.

> **‏סטטוס תיקון** (2026-05-18): 🔓 **פתוח** — ממתין להחלטה (Open Q-4).
> ה-handler של `user_message_chunk` ב-`agent-session.svelte.ts:395-398` עדיין `default → break`. נדרש מימוש: לפענח את ה-content ולהוסיף bubble user כש-event כזה מגיע מ-session/load.

---

### F-4 (MAJOR): ‏Reload ‏‏באמצע streaming response → ‏assistant text bubble ‏‏לא ‏‏מסיים

- **Severity**: major
- **SWEEP**: 5
- **Trigger**: ‏שלח ‏prompt → ‏‏המתן 2-3 ‏שניות → ‏reload ‏בזמן ‏שopencode ‏עוד ‏יוצר response.
- **Expected**: ‏אחרי reload, ‏‏ה-‏‏‏response ‏‏‏המלא ‏‏יטען ‏‏מ-`session/load` ‏‏(opencode ‏‏‏ממשיך ‏‏ב-background ‏‏ושומר ‏‏‏את ‏‏ה-state).
- **Actual**: ‏‏אחרי reload, ‏רואים ‏רק ‏‏‏‏‏‏את ה-tool calls (`glob`, `read README.md`) ‏‏שכבר ‏‏הסתיימו ‏‏לפני ‏‏‏ה-reload. ‏‏‏‏ה-final assistant text bubble ‏‏‏עם ‏ה-summary ‏‏‏‏‏‏‏לא ‏‏‏‏‏מופיע ‏‏‏‏‏אפילו ‏‏אחרי 15 ‏שניות ‏המתנה.
- **Evidence**:
  - ‏‏Snapshot ‏15s ‏אחרי ‏reload:
    ```
    button "שלום! מה אפשר לעשות בשבילך?" [ref=e59]
    button "glob" [ref=e61]
    button "read README.md" [ref=e68]
    (אין assistant text bubble אחרון)
    ```
- **Repro steps**:
  1. ‏שלח "‏‏תאר ‏לי ‏בקצרה ‏‏את ‏‏‏התוכן ‏‏‏‏של README"
  2. ‏‏המתן 3 ‏שניות (tool calls ‏רצים)
  3. ‏Reload
  4. ‏‏בדוק 15s אחרי
- **Notes**:
  - ‏‏ייתכן ‏‏ש-opencode ‏‏‏אכן ‏המשיך, ‏‏ו-ACP session/load מציג ‏את ‏ה-events ‏‏שהוקלטו ‏לפני ‏ה-reload, ‏‏אבל ‏‏ה-final ‏assistant_message ‏‏‏‏שעבר ‏אחרי ה-reload ‏‏נשלח ‏‏‏לconnection ‏‏‏‏שמת ‏‏ולא ‏‏נחזר ‏ב-load.
  - ‏‏‏בדומה ‏‏ל-F-3 — ‏‏‏איבוד ‏‏מידע ‏בreload ‏‏‏‏‏‏באמצע ‏response.

> **‏סטטוס תיקון** (2026-05-18): 🔓 **פתוח**.
> דורש חקירה מעמיקה: האם opencode באמת ממשיך לעבד אחרי disconnect של ה-WS? אם כן — איך ה-FE יכול לאסוף את ה-events שהוחמצו אחרי reconnect (לא רק `session/load` הראשוני אלא buffer של מה שקרה בין disconnect ל-reconnect).

---

### F-5 (MAJOR): ‏‏BE crash ‏מאבד ‏‏‏‏את ‏‏‏‏כל ‏ה-agents state ‏(no persistence)

- **Severity**: major
- **SWEEP**: 2
- **Trigger**: ‏‏‏BE קורס ‏(F-1) ‏‏או ‏‏מופעל ‏‏‏מחדש ‏‏ידנית.
- **Expected**: ‏‏Sub-‏‏optimal ‏‏אבל acceptable: ‏‏‏‏ה-agents שהיו ‏‏ready ‏יחזרו ‏‏ל-state respawning ‏(re-‏‏‏‏‏הקמה ‏אוטומטית) ‏‏‏או ‏‏ל-state crashed (‏‏‏‏עם option ‏‏‏‏ל-recreate ‏‏‏‏‏‏‏‏ע''י ‏‏‏אותו cwd).
- **Actual**: ‏‏GET `/api/agents` ‏‏מחזיר `{"agents":[]}` ‏‏‏אחרי ‏‏‏restart. ‏‏Dashboard מציג "‏אין סוכנים פעילים". ‏‏‏‏ה-FE עוד ‏מחזיק ‏‏‏‏את ‏ה-agentId ‏‏הישן ‏‏‏‏‏‏‏ומראה ‏‏‏‏שגיאה ‏(‏‏F-6).
- **Evidence**:
  - ‏לפני crash: ‏‏‏`{"agents":[{"id":"0599db5a...","status":"ready"...}]}`
  - ‏‏‏אחרי restart: `{"agents":[]}`
- **Repro steps**:
  1. ‏‏יצירת 2 agents
  2. ‏‏BE crash (via F-1 ‏‏‏‏או pkill)
  3. ‏‏‏‏tmux restart ‏‏ל-be-v3
  4. ‏‏‏בדוק `/api/agents`
- **Notes**:
  - ‏‏‏‏‏‏‏ייתכן ‏‏שזה ‏‏‏‏by design (drive-coding ‏‏הוא ephemeral) ‏‏‏‏אבל ‏אם ‏BE crash הוא ‏‏יכולת ‏(blocker ‏‏F-1), ‏‏‏‏‏‏‏‏‏אז ‏‏‏אי-persistence ‏מ-‏‏‏‏‏‏‏מערה את ‏הנזק.

> **‏סטטוס תיקון** (2026-05-18): 🔓 **פתוח** — ממתין להחלטה (Open Q-6).
> חשיבות הבעיה ירדה משמעותית אחרי תיקון F-1: BE כבר לא קורס על cwd פגום (שורד spawn failures), אז persistence פחות קריטי. רלוונטי רק ל-OOM / process killer / restart ידני.

---

### F-6 (MINOR): ‏‏ניווט ‏‏ל-/session/INVALID_HASH/INVALID_ID ‏‏‏‏‏מנסה ‏‏לspawn ‏ב-cwd שגוי

- **Severity**: minor (security/robustness)
- **SWEEP**: 6
- **Trigger**: ‏‏‏ניווט ‏‏ידני ל-`https://.../session/INVALID_HASH/INVALID_ID`
- **Expected**: ‏FE ‏מציג ‏‏שגיאה "‏session ‏‏לא ‏‏‏קיים" ‏ללא ‏‏ניסיון ‏לcreate ‏agent.
- **Actual**: ‏‏‏FE ‏‏שולח POST ל-`/api/agents` ‏‏עם cwd=`/INVALID_HASH` (‏‏‏FE ‏מנסה ‏‏‏‏‏לפענח ‏‏‏‏את ‏ה-cwdHash ‏ע''י decodeURIComponent, ‏‏‏‏‏‏‏גם ‏‏על מחרוזת ‏‏‏שאינה ‏‏‏path), ‏BE ‏מנסה ‏לspawn ‏שם → crash ‏(F-1).
- **Evidence**:
  - ‏BE log:
    ```
    [08:59:20.401] INFO: createAndSpawn start
        cwd: "/INVALID_HASH"
    ```
  - ‏FE alert: "‏‏‏‏שגיאה: spawn failed for agent 62980235-...: spawn returned no pid"
- **Repro steps**:
  1. ‏‏ניווט ‏‏ידני ‏‏ל-`/session/INVALID_HASH/INVALID_ID`
- **Notes**:
  - ‏‏‏ייתכן ‏‏שזה ‏מצביע ‏על ‏בעיית ‏design: ‏ה-route ‏‏לא ‏‏‏אמור לcreate agents ‏‏‏‏‏על ‏‏סמך ‏פרמטרים ‏‏מ-URL ‏ללא validate.

> **‏סטטוס תיקון** (2026-05-18): ✅ **נסגר** — commit `c5a69d4`.
> ב-`/session/[cwdHash]/[id]/+page.svelte` נמחק ה-fallback `/${cwdHash}` המסוכן. אם ה-hash לא מופיע ב-`/api/projects` → המסך מציג "פרויקט לא נמצא — הנתיב לא רשום במערכת" ואינו מנסה לbuild agent. בנוסף, BE דוחה ב-400 (validateCwd) אם בכל זאת מגיע cwd כמו `/INVALID_HASH`.

---

### F-7 (MINOR): ‏Markdown ‏ב-assistant bubbles ‏‏‏‏לא ‏‏‏rendered

- **Severity**: minor
- **SWEEP**: 3
- **Trigger**: ‏שלח prompt "‏‏תכתוב לי ‏‏‏דוגמה ‏‏קצרה ‏‏של ‏‏קוד JS ‏ב-block ‏עם hello world".
- **Expected**: ‏ה-‏‏‏‏‏‏response ‏‏מציג ‏‏‏את ‏ה-code block ‏‏‏עם syntax highlighting ‏‏או ‏‏‏לפחות ‏‏‏monospace formatting.
- **Actual**: ‏ה-‏response ‏‏מוצג ‏‏‏כ-‏‏‏‏‏plain text ‏עם 3 backticks ‏‏‏גלויים: ` ```js console.log("Hello, World!"); ``` ` (‏ראה screenshot `/tmp/agent-page.png`).
- **Evidence**:
  - ‏Screenshot ‏מצורף: `/tmp/agent-page.png`
  - ‏Snapshot:
    ```
    button "```js console.log(\"Hello, World!\"); ```" [ref=e1093]
    ```
- **Repro steps**:
  1. ‏שלח prompt ‏‏‏שמבקש markdown content
  2. ‏‏בדוק ‏‏‏‏את ‏‏ה-bubble
- **Notes**:
  - ‏‏‏‏ב-spec ‏לא ‏מצוין ‏‏‏‏שbubbles צריכים ‏‏‏לעשות ‏Markdown rendering, ‏‏אבל ‏סביר ‏‏‏‏שopencode ‏‏מחזיר ‏‏md ‏‏ולא ‏plain text.
  - ‏‏‏אבי ‏יכול ‏‏‏‏להחליט: ‏(a) ‏‏‏‏זה ‏‏מכוון ‏‏(הbubbles ‏‏מיועדות ל-TTS, ‏‏‏‏לא ‏ל-‏reading), ‏(b) ‏‏‏לא ‏‏‏פותר ‏‏‏בlice 10. ‏‏‏ראה ‏Open Q-2.

> **‏סטטוס תיקון** (2026-05-18): ❓ **ממתין להחלטה** (Open Q-2).
> drive-coding הוא voice-first — ייתכן שהבועות הן לדיבוג בלבד וה-Markdown מיותר. אם תתקבל החלטה ש-rendering נדרש: יש כבר `@drive-coding/core/ui/markdown` (marked) שאפשר לחבר ל-bubble components.

---

### F-8 (MINOR): ‏‏אגנט שcrashed ‏‏‏מציג ‏‏‏ב-dashboard ‏ללא crashReason

- **Severity**: minor
- **SWEEP**: 2, 10
- **Trigger**: ‏‏agent ‏‏שbridge ‏שלו ‏‏‏מת.
- **Expected**: ‏Dashboard / agent page ‏‏מציגים ‏את ‏הסיבה ‏‏‏לcrash (e.g. "exit code 137 / SIGKILL" ‏‏‏‏‏‏‏‏או ‏‏‏‏"spawn ENOENT npx").
- **Actual**: ‏‏FE ‏‏מציג "Bridge נכשל: bridge closed" ‏(generic). ‏‏BE API מחזיר agent ‏עם `status: "crashed"` ‏ללא ‏‏שדה ‏‏crashReason ‏‏ב-`/api/agents/:id`. ‏‏Dashboard ‏‏מציג ‏‏‏‏רק "‏‏‏‏‏קרס" ‏ב-badge.
- **Evidence**:
  - ‏‏API: ‏`{"agent":{"id":"...","cliKind":"opencode","cwd":"...","status":"crashed",...}}` (‏‏אין crashReason).
- **Repro steps**:
  1. ‏‏יצירת agent
  2. `pkill -f "opencode acp"`
  3. ‏‏‏‏בדוק dashboard + API
- **Notes**:
  - ‏‏‏בbrief MED-8 ‏‏‏‏‏מצוין ‏‏‏שcrashReason ‏צריך להופיע — ‏‏‏האם ‏‏‏‏זה ‏מיושם ‏אבל ‏מסונן? ‏‏‏אבדוק ‏‏‏בbrief.

> **‏סטטוס תיקון** (2026-05-18): 🔓 **פתוח**.
> ה-bridge-manager החדש (Phase 2 של F-1) יכול עכשיו לחשוף `exitCode` / `signal` מ-`child.on("exit")` ו-`error.message` מ-`child.on("error")`. נדרש: להוסיף שדה `crashReason: string | null` ל-Agent schema, להעביר אותו ב-`registry.update()` עם פרטי ה-exit, ולהציג ב-FE dashboard + agent page.

---

### F-9 (COSMETIC): ‏‏ה-cwd ‏ב-dashboard ‏‏מוצג ‏‏url-encoded ‏‏‏לאגנט crashed

- **Severity**: cosmetic
- **SWEEP**: 2
- **Trigger**: ‏‏מציאת ‏agent ‏‏שcwd ‏שלו ‏‏‏הוא URL-encoded ‏(נוצר ‏מ-‏‏F-2 ‏‏אולי).
- **Expected**: ‏‏ה-cwd ‏‏‏‏‏‏‏מוצג decoded — ‏`/home/user`.
- **Actual**: ‏Dashboard ‏מציג ‏‏‏‏את ‏‏ה-cwd ‏כ-`/%2Fhome%2Fuser`.
- **Evidence**:
  - ‏‏API response: `{"id":"43d937ce-...", "cwd":"/%2Fhome%2Fuser", "status":"crashed", ...}`
  - ‏‏ה-dashboard ‏‏מציג ‏‏‏את ‏ה-raw value.
- **Notes**:
  - ‏‏‏‏ה-‏‏cosmetic מצביע ‏על ‏‏F-2 — ‏‏‏ייתכן ‏‏ש-agent ‏שcrashed ‏‏‏נוצר ‏‏‏‏‏בdouble-encoded ‏cwd ‏‏‏‏‏‏‏‏‏‏ולא נמחק.
  - ‏‏‏‏‏‏‏‏‏הצעת ‏‏‏fix: ‏BE ‏‏צריך ‏‏‏‏‏‏‏‏לעשות normalize/path.resolve על ‏ה-cwd ‏לפני ‏‏‏שמירה (‏‏‏או ‏‏לדחות ‏בכלל path עם `%`).

> **‏סטטוס תיקון** (2026-05-18): ✅ **נסגר עקיף** — commit `c5a69d4`.
> אגנטים חדשים עם cwd פגום כבר לא ייווצרו — `validateCwd` ב-`http-agents.ts` ו-`registry.ts` דוחים כל cwd שמכיל `%XX`. אגנטים קיימים עם cwd מעוות שכבר ב-registry: יאוחו ב-restart הבא (אין persistence — F-5).

---

### F-10 (COSMETIC): ‏Sessions list ‏‏מציג cwds ‏‏מקוצצים (‏‏‏‏ללא ‏ה-/home/user prefix)

- **Severity**: cosmetic
- **SWEEP**: 6
- **Trigger**: ‏ניווט ‏‏ל-`/sessions`.
- **Expected**: ‏cwd ‏‏מלא ‏(`/home/user/projects/voice-acp-v2`)
- **Actual**: ‏‏‏מוצג `/projects/voice-acp-v2` (‏‏‏ללא `/home/user/`).
- **Evidence**:
  - ‏API: `cwd=/home/user/projects/voice-acp-v3`
  - ‏FE snapshot: `generic: /projects/voice-acp-v3`
  - ‏יוצא דופן: ‏cwds ‏שמתחילים ‏ב-`/tmp` ‏‏או ‏`/home/user` (‏‏ישירות) ‏‏מוצגים ‏מלא.
- **Notes**:
  - ‏‏‏‏‏ה-FE ‏עושה ‏replace ‏על ‏‏‏‏prefix `/home/user` ‏‏ב-display, ‏‏רק לpaths ‏‏‏שמתחתיו.
  - ‏‏‏‏‏ייתכן ‏‏שזה ‏מכוון ‏ל-readability ‏‏‏(החזרת ‏paths ‏יחסיים ‏ל-home), ‏אבל ‏‏יוצר ‏confusion ‏‏‏‏‏‏‏‏‏‏ייתכן.

> **‏סטטוס תיקון** (2026-05-18): 🔓 **פתוח** — ככל הנראה by design.
> ה-`/home/user/` prefix מוסר בכוונה ב-display ל-readability. אם רוצים שינוי: להוסיף הצגת tooltip עם ה-cwd המלא, או להציג כל ה-cwd כשאין יותר מ-N תווים.

---

### F-11 (COSMETIC): ‏Favicon 404 ‏‏ב-‏‏‏console ‏‏‏‏בכל page

- **Severity**: cosmetic
- **SWEEP**: 12
- **Trigger**: ‏‏‏טעינת ‏‏‏‏כל ‏page.
- **Expected**: ‏favicon ‏‏‏שקיים.
- **Actual**: ‏‏‏‏console error: ‏`Failed to load resource: the server responded with a status of 404 () @ favicon.ico:0`. ‏‏‏‏‏FE log: ‏`[404] GET /favicon.ico` ‏‏‏אחרי ‏כל ‏‏טעינה.
- **Notes**: ‏‏‏‏‏‏cosmetic ‏ובסיסי. ‏‏‏הוסף static/favicon.ico.

> **‏סטטוס תיקון** (2026-05-18): 🔓 **פתוח**.
> תיקון של דקה: הוספת `packages/frontend/static/favicon.ico` (כל קובץ ICO תקני). SvelteKit עם adapter-static יגיש אותו אוטומטית.

---

### F-12 (COSMETIC): "‏‏‏תיקיה חדשה" ‏ב-file picker ‏‏‏מכילה 2 ‏RLM ‏‏‏בתחילה

- **Severity**: cosmetic
- **SWEEP**: 11
- **Trigger**: ‏‏file picker ‏מציג directory ‏‏‏‏בשם "‏‏‏‏תיקיה חדשה" (‏‏‏‏ב-bottom).
- **Expected**: ‏‏שם ‏directory ‏ללא ‏בקרים ‏‏‏בלתי-‏נראים.
- **Actual**: ‏‏‏שם ‏‏directory ‏הוא `\u200F\u200Fתיקיה חדשה` (2 RLM ‏‏‏‏‏‏בתחילה). ‏‏‏‏‏‏ה-‏directory ‏‏‏‏‏באמת ‏‏קיים ‏‏‏ב-fs ‏‏‏(`ls -la` ‏‏מאשר).
- **Evidence**:
  - `od -c`:
    ```
    342 200 217 342 200 217 327 252 327 231 327 247 327 231 327 224 ...
    (\u200F \u200F ת   י   ק   י   ה ...)
    ```
- **Notes**:
  - ‏‏‏ה-directory ‏‏‏‏נוצר ‏‏‏‏על-ידי ‏‏‏ה-app ‏‏‏‏‏(או ‏‏בעבר, ‏או ‏‏‏‏עכשיו). ‏‏‏‏‏‏‏‏‏‏לא ‏‏‏ניסיתי "‏‏‏‏צור ‏‏‏‏‏תיקיה ‏‏חדשה" button ‏‏‏‏לוודא ‏‏‏‏אם ‏‏‏‏‏‏‏הוא ‏יוצר 2 ‏‏RLM ‏‏בעצמו.
  - ‏‏‏Path ‏פוטנציאלי ‏לBE ‏panic ‏‏אם ‏מועבר ‏‏‏בURL ‏ללא ‏encoding (‏‏‏לא ‏‏‏‏נבדק).

> **‏סטטוס תיקון** (2026-05-18): 🔓 **פתוח**.
> ה-cwd עצמו (`\u200F\u200Fתיקיה חדשה`) הוא string ASCII חוקי לחלוטין מבחינת `validateCwd` (אין `%XX`, אין NUL, אין control chars — RLM הוא U+200F, מעל U+001F). אם רוצים לחסום — להוסיף ב-`validateCwd` rule שדוחה Unicode bidi controls (`\u200E`, `\u200F`, `\u202A-\u202E`, `\u2066-\u2069`) בתחילת path segments. צריך להחליט אם זו הגנה רצויה — RTL filename חוקי אבל הוא מבלבל ב-UI.

---

## ‏Flows ‏שעבדו ‏ללא ‏בעיה

- ✅ ‏**Dashboard ‏טעינת ‏agents** — ‏‏רשימה ‏נטענת, ‏‏‏סטטוס (ready/crashed) ‏‏‏מוצג, ‏‏‏‏cwd ‏‏מוצג.
- ✅ ‏**File picker — ‏ניווט עמוק** — ‏ניווט מ-`/home/user` → ‏`projects` → ‏`voice-acp-v3` → ‏`docs` ‏עובד יפה. ‏‏‏‏מציג רק ‏directories (‏‏‏ללא ‏files — ‏‏סביר). ‏‏‏‏‏‏‏‏‏‏‏‏‏Access denied ‏ל-`/root`, ‏`/etc`, `/home/user/../etc` (path ‏traversal ‏‏מנוע).
- ✅ ‏**Create agent → ‏ACP handshake** — ‏‏יצירת agent חדש, ‏‏‏ניווט אוטומטי ‏ל-`/agent/<id>`, ‏‏‏ACP connect, ‏‏‏‏status עובר connecting→ready ‏בכ-5-10 שניות.
- ✅ ‏**Text prompt → ‏assistant response** — ‏prompt ‏קצר ‏("‏היי") ‏‏וprompt ‏עם XSS ‏‏("`<script>alert(1)</script>` ‏מה זה?") ‏שניהם מטופלים נכון. ‏ה-`<script>` ‏מוצג ‏כ-‏‏text (Svelte ‏מאסקייפ).
- ✅ ‏**Empty prompt** — ‏form ‏‏‏‏מונע submit; ‏אין ‏fetch ‏ל-ACP.
- ✅ ‏**STT עברית** — ‏upload `/tmp/test-hebrew.mp3` ‏("‏‏‏‏כמה ‏קבצים יש ‏בתיקייה ‏הזאת?") → ‏FE שולח ‏ל-`/proxy/google/v1beta/models/gemini-flash-lite-latest:generateContent` → ‏‏מקבל back **בעברית מלאה** ‏(לא transliterated). ‏‏‏ה-prompt ‏‏עובר ‏ל-opencode → ‏‏response ‏‏מצטרף ל-context הקודם ("‏‏‏‏‏כבר ספרנו...").
- ✅ ‏**TTS streaming** — ‏עשרות ‏calls ‏ל-`/proxy/elevenlabs/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL/stream` ‏עם status 200, ‏‏size 20-150KB ‏לכל response. ‏‏‏‏Voice הוא Sarah (‏default).
- ✅ ‏**Replay button** — ‏‏‏אחרי ‏‏‏‏‏‏response, ‏‏מופיע ‏‏‏‏כפתור "‏‏השמע ‏מחדש" ‏(לא ‏‏בדקתי ‏‏‏שמיעה ‏‏‏‏‏בפועל).
- ✅ ‏**Settings ‏‏שמירה** — ‏‏בחירת ‏Rachel ‏‏ב-`/settings`, ‏reload, ‏‏‏הבחירה נשמרת (localStorage). ‏Reset button ‏‏מאפס ‏‏ל-Sarah.
- ✅ ‏**Multi-tab guard (MED-8)** — ‏tab ‏שני ‏לאותו agentId ‏‏מקבל close 1008, ‏‏מציג ‏alert "‏‏סוכן ‏בשימוש ‏ב-tab ‏‏‏אחר", ‏‏status="crashed". ‏‏Tab ‏‏ראשון ‏ממשיך ‏לעבוד. ‏BE log: ‏"second tab rejected".
- ✅ ‏**Bridge crash UI** — `pkill -f "opencode acp"` → ‏‏FE רואה ‏‏close 1011 → ‏‏‏‏מציג ‏alert "Bridge ‏‏‏נכשל: bridge closed", ‏status="crashed". ‏‏BE: ‏`bridge closed — closing feWs`.
- ✅ ‏**Sessions list ‏‏טעינה** — ‏50 sessions ‏נטענים, ‏‏‏ממוינים ‏‏לפי ‏‏‏זמן, ‏‏מציגים ‏‏‏title + cwd + timestamp ‏בעברית ‏‏‏(e.g. "18 ‏‏‏במאי 2026, 08:57"). ‏‏‏‏‏‏‏‏‏‏‏‏‏‏‏יש 2 tabs: ‏‏‏"כל ‏‏‏השיחות" ‏‏ו-"‏‏‏‏לפי ‏‏פרויקט".
- ✅ ‏**Car mode** — `?car=1` query ‏‏מציג ‏‏‏‏‏‏‏את ‏העמוד ‏‏עם ‏‏כפתור ‏‏‏‏"🚗 ‏‏‏הפעל בקרת ‏רכב" ‏‏‏‏ייעודי. ‏‏‏‏‏‏‏אחרי click — ‏‏‏‏‏הכפתור ‏נעלם ‏‏‏וה-mic ‏‏ENABLED. ‏‏‏‏‏‏‏‏layout ‏‏‏‏לא ‏‏‏שונה ‏‏‏מהותית (‏‏‏‏‏ראה ‏‏‏Open Q-3).
- ✅ ‏**FS browse security** — `/root`, `/etc`, `/home/user/../etc` → ‏`{"error":"access denied"}`. ‏‏‏✅
- ✅ ‏**Proxy architecture** — ‏‏‏FE עושה fetch ‏ישיר ‏‏‏ל-`/proxy/google/...` ‏‏וl-`/proxy/elevenlabs/...`. ‏‏BE ‏‏מטפל ‏‏‏‏בtransparent forward. ‏‏‏‏‏‏0 errors, ‏‏עשרות calls ‏‏‏ב-Network tab.
- ✅ ‏**ACP session/load** — ‏‏reload ‏טעין ‏‏‏את ‏‏אותו sessionId (no 409, no recreate). ‏‏ACP ‏‏‏מתחבר ‏‏מחדש ‏‏בנוסף ‏‏‏עם ‏same sessionId.

---

## ‏הערות ‏‏‏‏כלליות

### ‏ביצועים
- ‏Gemini ‏calls: ‏100-300ms ‏טיפוסי, ‏מעט outliers ‏עד ‏~1s.
- ‏ElevenLabs ‏stream: ‏280-650ms ‏לחתיכה ‏טיפוסית, ‏עם ‏outliers ‏עד 3s.
- ‏ACP ‏prompt → ‏first response chunk: ‏~10-20 ‏‏שניות ‏‏ל-opencode ‏‏עם ‏tool calls, ‏‏~3-5 ‏‏שניות ‏ל-simple greeting.
- ‏‏STT (audio 31KB) → ‏prompt: ‏‏‏‏‏~40-45 ‏שניות ‏עד ‏‏ה-response ‏‏‏המלא (כולל opencode tools). ‏‏‏ההMtnnה ‏‏נסבלת ‏‏אבל ‏‏‏‏‏‏‏יורגש ‏‏‏ב-mobile.

### ‏UX
- ‏‏Mic button ‏‏היה ‏disabled ‏‏בstate "‏connecting" ‏‏ועבר ‏‏‏ל-enabled ‏‏‏אחרי "connected" — ‏‏‏עדכון בזמן אמת ‏‏‏‏‏עובד.
- ‏Status label ‏ב-‏‏header (e.g. "connected") ‏‏הוא ‏‏באנגלית. ‏‏‏‏מומלץ "‏‏מחובר".
- ‏Status label ‏ב-sidebar ‏‏הוא ‏בעברית ‏‏("‏‏‏‏מוכן"). ‏‏‏‏אי-עקביות.
- ‏‏‏הbubbles ‏‏‏הם clickable buttons — ‏‏‏‏לא ‏ברור ‏‏‏‏מה ‏הclick ‏‏‏‏עושה (‏‏‏‏‏‏ייתכן ‏replay, ‏‏‏‏אבל ‏‏‏אין affordance ‏visual).
- ‏‏‏‏‏‏‏"‏‏השמע מחדש" ‏הוא ‏‏‏כפתור ‏‏‏‏יחיד ‏‏לconversation ‏(‏‏‏‏‏‏מה ‏הוא ‏‏‏משמיע — ‏‏‏‏רק ‏‏‏את ‏‏ה-‏‏‏‏response ‏האחרון? ‏‏‏‏‏‏את ‏‏‏הכול?).

### ‏RTL ‏וHebrew
- ‏ה-RTL ‏‏‏‏מעולה: ‏Textbox מיושר ‏ימין, ‏bubbles ‏‏מימין ‏ל-user ‏‏ומשמאל ‏ל-assistant (chat ‏‏‏סטנדרטי). ‏‏‏Headers, ‏Sidebar, ‏Settings — ‏‏הכל RTL.
- ‏‏‏‏‏‏העברית רנדור נכון. ‏‏‏אין reverse parentheses, ‏‏אין mojibake.
- ‏‏‏יוצא דופן: ‏"connected" ‏ו-"connecting" ‏‏מוצגים ‏ב-‏‏‏‏‏‏‏אנגלית. ‏‏‏גם status labels ‏‏ב-banner (cosmetic minor).

### ‏Console / Logs
- ‏‏Console ‏‏FE: ‏‏רק 1 error (favicon 404), ‏0 warnings, ‏‏מספר ‏info ‏messages ‏‏(pino ‏‏‏‏‏‏‏ב-fe.session ‏‏‏ו-fe.voice).
- ‏‏‏‏‏‏ה-pino messages ‏‏‏בbrowser ‏מציגים ‏‏‏‏‏את ‏ה-prefix ‏‏‏‏ה-vite proxy ‏-‏‏‏‏ניקוד אינטרני, ‏‏‏‏מה ‏‏‏שמקשה ‏‏על ‏קריאת ‏stack trace.
- ‏‏BE ‏log: ‏ברור ‏‏ומאורגן, ‏‏‏עם ‏ns ‏prefix. ‏‏‏‏‏‏‏‏‏‏‏‏הexceptions ‏‏‏‏מLog ‏‏‏אבל ‏ה-process מת ‏‏(F-1).

---

## ‏Open Questions ‏ל-Avi

1. **‏ה-ENOENT npx ‏בBE — ‏האם ידוע?** ‏‏‏ה-BE רץ ‏‏מ-OneCLI, ‏ו-onecli-‏‏voice-acp ‏אגנט ‏‏הוא selective ‏עם ElevenLabs + ‏Google ‏‏בלבד. ‏ייתכן ‏‏שonecli ‏‏‏לא ‏‏מעביר את ‏‏ה-fnm PATH ‏ל-child processes? ‏‏‏‏‏‏‏ה-‏‏‏‏ראשונים מצליחים — ‏‏‏‏אז ‏‏‏‏ייתכן ‏‏שhe-PATH ‏‏‏נטען ‏‏‏מאוחר ‏‏או ‏‏ש-bun --watch ‏‏‏‏‏‏מאבד ‏את ‏ה-context ‏‏אחרי N reloads.

2. **‏‏Markdown rendering ‏ב-bubbles ‏— ‏‏האם מכוון?** ‏‏‏‏ה-‏‏‏‏‏drive-coding ‏הוא voice-first ‏— ‏ייתכן ‏‏שhe-bubbles ‏‏‏מיועדים ‏‏‏‏רק ‏‏לדיבוג ‏‏‏‏(‏‏‏‏‏‏הtext עובר TTS). ‏‏‏אם ‏‏כן — ‏‏‏F-7 ‏‏הוא ‏‏‏cosmetic. ‏‏‏‏אם ‏לא — ‏‏‏‏זה ‏major UX miss.

3. **‏‏‏Car mode — ‏‏‏איזה ‏שינוי visible ‏‏‏צריך ‏‏‏לקרות?** ‏‏ב-`?car=1` ‏‏‏ראיתי ‏‏רק ‏‏כפתור "‏‏הפעל בקרת ‏‏‏‏רכב". ‏‏אחרי click — ‏‏הכפתור ‏‏נעלם ‏‏‏וhe-‏‏‏‏‏mic enabled. ‏‏האם ‏‏‏‏מצופה ‏layout ‏‏עם ‏buttons ‏‏‏‏‏ענקיים, ‏‏או ‏שhe-‏‏‏car mode ‏‏‏‏‏מפעיל wake lock + auto-listen ‏‏‏‏ולא ‏ה-layout?

4. **‏‏‏user_message_chunk ‏‏‏ב-session/load — ‏‏‏‏בrice ‏עתידי?** ‏‏‏ב-comment ‏ב-`agent-session.svelte.ts:396` ‏‏‏‏‏מצוין ‏‏‏שhandling ‏‏‏‏הוא future slice. ‏‏‏‏‏‏‏‏האם זה ‏acceptable ‏‏‏לpublic release, ‏‏או blocker ‏‏‏‏‏לpolish?

5. **‏‏‏‏Bubble click — ‏מה ‏‏‏הbehavior?** ‏‏‏‏‏‏‏הbubbles ‏‏‏הן `<button>` ‏‏עם cursor=pointer, ‏אבל ‏‏לחיצה ‏‏‏‏לא ‏‏‏‏מציגה ‏‏‏‏פעולה ‏visible. ‏‏‏האם ‏replay ‏מ-cache? ‏‏‏‏‏‏tooltip / ‏visual ‏‏feedback ‏‏‏‏‏‏מקסם UX?

6. **‏‏‏‏‏BE crash recovery (F-5) — ‏‏האם persistence ‏‏לagents ‏‏‏ב-roadmap?** ‏‏אם BE crash הוא ‏‏‏unrecoverable, ‏זה ‏‏‏מגדיל ‏‏‏‏את ‏הנזק ‏‏של ‏F-1.

---

## ‏‏מה ‏לא ‏נבדק (out of scope ל-pw-clean)

- ‏TTS audio playback ‏שמיעה ‏‏בפועל (‏אין ‏speakers ‏‏‏ב-headless Chrome)
- ‏Mic recording (‏‏אין mic permission ‏‏ב-pw-clean)
- ‏Mobile / iOS Safari ‏(‏‏‏לא ‏‏‏‏ניסיתי)
- ‏Real human in-the-loop ‏voice flow ‏(אין user ‏‏אמיתי)
- ‏Long ‏prompt (>200 ‏תווים) — ‏‏לא ‏‏‏מבוצע ‏‏‏‏מהבעיה ‏‏שהBE קרס באמצע
- ‏‏‏‏‏‏ה-cache ‏ב-proxy — ‏‏‏‏‏‏לא ‏‏ניסיתי ‏‏‏‏‏שני ‏‏prompts ‏‏זהים ‏‏‏‏‏‏‏ולחפש cache hit ‏ב-headers
- ‏‏Wake lock ‏(car mode) — ‏‏‏‏לא ‏‏‏‏ניתן ‏‏‏‏לבדוק ב-pw-clean
- ‏Mic device picker ‏‏‏‏‏אם ‏‏יש כזה
- ‏‏‏‏‏‏‏‏‏הbutton "‏השמע ‏מחדש" — ‏‏‏לא ‏לחצתי כדי ‏לוודא ‏מה ‏‏הוא ‏עושה ‏בפועל

---

## ‏Evidence Files

| ‏‏‏מטרה | ‏Path |
|------|------|
| ‏Screenshot agent page (markdown rendering) | `/tmp/agent-page.png` |
| ‏Dashboard snapshot | `/tmp/dash-loaded.yml` (‏לא נשמר ‏לdisk — ‏‏‏stdout בלבד) |
| ‏Picker snapshot | `/tmp/picker-snap.yml` |
| ‏Console log | `/tmp/agent-console.log`, `/tmp/agent-console-2.log`, `/tmp/agent2-console.log` |
| ‏BE log | `/tmp/be-v3.log` |
| ‏FE log | `/tmp/fe-v3.log` |

‏‏‏‏‏מסכם.
