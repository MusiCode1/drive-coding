# Slice wire-observability-bridge — בריף

> **תאריך**: 2026-06-19
> **סוג מסמך**: בריף ביצועי לסלייס — לא תוכנית טרום-בריף
> **סטטוס**: **מוזג ל-dev (2026-06-19)** — אביגיל ×2 (READY) → אליעזר (2 commits) → כלב GO (DoD 9/9) → בדיקה חיה ידנית (245 wire frames אחרי detach) → merge מאושר
> **אימות אביגיל**: **READY** (`reports/drive-coding/slice-wire-observability-bridge-avigail.md`) — 5 findings תוקנו ואומתו; 2 נותרו 🟢 cosmetic
> **Dispatch**: בוצע (Mode 1). commits: `cb4d5aa` (Commit 0), `bf28c70` (Commit 1).
> **Complexity**: 5/10 (verifier: light + phase על Commit 0)
> **תלויות (`depends_on`)**: [] — בנוי ישירות על dev. (קשור רעיונית ל-`slice-ws-error-survival` שכבר מוזג, אך לא תלוי בו טכנית.)
> **Base**: dev
> **Dev tip**: `ca330b3`

---

## §0 — Pre-flight

### תלויות (חובה!)

אין תלויות — בנוי ישירות על `dev`.

> **הקשר**: `slice-ws-error-survival` (כבר מוזג, `ca330b3` ומטה) תיקן שה-child **שורד** ניתוק
> דפדפן. אבל גילינו (דיבוג חי, 19/6) שכל ה-wire observability (`backend.ws.wire` של `LOG_WIRE`
> + `WIRE_RECORD`) חי **בתוך `ws-agent.ts`**, ב-`onLine` callback וב-message handler — שניהם
> מתבטלים ב-`detach()` (`unsub()` + `rec.close()`). כלומר **ברגע שאין דפדפן, אנחנו עיוורים** —
> בדיוק כשצריך לראות מה ה-agent עושה. זה ה-gap ש-Commit 3 של אותו slice לא כיסה.

> אביגיל בודקת שסעיף זה עקבי עם `depends_on=[]` ב-state.json.

### Worktree

bare repo → absolute path:

```bash
git worktree add /home/user/projects/drive-coding/dev/.worktrees/slice-wire-observability-bridge -b slice-wire-observability-bridge dev
cd /home/user/projects/drive-coding/dev/.worktrees/slice-wire-observability-bridge
pnpm install && pnpm hooks:install
```

> ⚠️ **כל העבודה ב-worktree הזה בלבד.** המופע החי (`voice-acp-dev.service`, port 4001) לא נוגעים בו.
> אין `pnpm build`/restart על השירות הרץ. הטסטים רצים מתוך ה-worktree על פורט שאינו 4001.

### איך להריץ

- **BE** (לטסטים ידניים — לא חובה): `cd packages/backend && PORT=4002 bun src/server.ts`.
  התיקון לא נוגע ב-proxy/TTS → **אין צורך ב-OneCLI**. (הרצה מלאה עם proxy:
  `PORT=4002 onecli run --agent voice-acp -- bun src/server.ts`.)
- **Tests (כל ה-backend)**: `pnpm --filter @drive-coding/backend test`
- **קובץ בודד**: `cd packages/backend && bunx vitest run tests/<file>.test.ts`
- **typecheck**: `pnpm typecheck`
- **lint:i18n**: `pnpm lint:i18n` — חוסם עברית **בתוך string literals בלבד**; הערות בעברית **מותרות**.
  הקוד הקיים מלא הערות עברית — אל תתרגם. string literals חדשים באנגלית בלבד.

### Browser

לא נדרש לטסטים (unit + integration עם child אמיתי). אימות ידני של ה-wire log אופציונלי בלבד
(ראה §4 Commit 0 Verification → "ידני").

### Reading list

**must-read** (לפני שמתחילים):
- `packages/backend/src/delivery/ws-agent.ts` — מקור ה-wire observability הנוכחי שיורד מכאן.
  שים לב: `wireLog` (27), `logWire()` (60-69), `rec` (92), והקריאות בשורות 102-107, 118-128, 160.
- `packages/backend/src/acp/bridge-manager.ts` — היעד. ה-reader הקבוע `stdoutRl.on("line")` (150-161)
  הוא הבעלים של `child.stdout` ושורד את ה-detach. שם נכנס ה-in-path. ה-`kill()` (213-224) + `child.on("exit")` (137-143).
- `packages/backend/src/delivery/wire-recorder.ts` — `WireRecorder`/`WireSession` API; `open()`/`record()`/`close()`.
- `packages/backend/src/delivery/wire-decode.ts:9-24` — `WireSummary` (`method`/`sessionUpdate`/`id`/`responseKind`/`unparsed`/`parsed`).
- `packages/backend/src/server.ts:76,87-88,126` — חיווט `createBridgeManager()` + `createWireRecorder()` + `createAgentWsHandler()`.
- `packages/core/src/log/config.ts:104-116` — mapping של `LOG_WIRE`: `acp→backend.acp.wire.*`, `ws→backend.ws.wire.*`, `1→שניהם`.

**reference** (בזמן עבודה):
- `packages/backend/tests/ws-agent-pipe.test.ts` — **ישתנה (קריטי!)**. **3 call-sites** של `createAgentWsHandler`
  (7 קריאות: 104,121,143,171,189,211,229), mock `makeMockBridgeManager` (74-95), וטסט שבודק `child.stdin` (116-135).
- `packages/backend/tests/ws-agent-error-survival.test.ts` — **ישתנה** (ראה Commit 0). תבנית spawn child אמיתי.
- `packages/backend/src/acp/bridge-manager.runtime.test.ts` — תבנית לטסט spawn child אמיתי.

---

## §1 — מטרה

כשנדבג קריסה/תקיעה של ריצת agent — **גם כשאין דפדפן מחובר** — ה-journal יראה את כל זרם ה-wire
(שני הכיוונים: מה ה-agent שולח, ומה נכתב אליו), ברציפות דרך כל מחזור disconnect→reconnect, בלי
פערים עיוורים. נקודת התצפית עוברת מהשכבה שמתנתקת (`ws-agent`) לשכבה שמחזיקה את ה-child ושורדת
(`bridge-manager`). אין יותר "מצב שבו ה-agent עובד אבל אנחנו לא רואים כלום".

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| wire log (live) של stdout מ-child → ב-`bridge-manager.stdoutRl` | ✅ | Commit 0 |
| `bridgeManager.writeStdin()` שכותב ל-child.stdin **ומתעד** את כיוון ה-out | ✅ | Commit 0 |
| `WIRE_RECORD` (file recorder) עובר ל-bridge — recording session לכל חיי ה-child | ✅ | Commit 0 |
| הסרת כל ה-wire observability מ-`ws-agent.ts` (`wireLog`/`logWire`/`rec`) | ✅ | Commit 0 |
| ns חדש `backend.acp.wire` (במקום `backend.ws.wire`) — סמנטי לשכבת ה-CLI↔BE | ✅ | Commit 0 |
| עדכון deploy units + dropin מ-`LOG_WIRE=ws` ל-`LOG_WIRE=acp` | ✅ | Commit 1 |
| תיעוד ה-`$/ping`/`$/pong` keepalive ב-wire | ❌ | הוא transport, לא ACP wire — יורד מהתיעוד (ראה §9 Q1) |
| לוגיקת lifecycle של `ws-agent` (connect/disconnect/error/detach ב-`backend.ws.agent`) | ❌ | נשארת ב-`ws-agent` ללא שינוי — זה lifecycle, לא wire |
| איתור/תיקון הבאג של "הריצה נעצרת" עצמו | ❌ | slice נפרד — בריף זה רק **נותן את העיניים** לאבחן אותו |

> זו לא טבלת TODO — זו הגנה מ-scope creep. הבריף הזה **מעביר נקודת-תצפית**; הוא לא מתקן את התקיעה.

---

## §3 — Architecture diagram

```
                לפני (היום)                                    אחרי (slice זה)

  child.stdout                                       child.stdout
     │ (bridge הוא הבעלים — reader קבוע)                 │ (bridge הוא הבעלים — reader קבוע)
     ▼                                                  ▼
  ┌──────────────────────┐                          ┌────────────────────────────────────┐
  │ bridge.stdoutRl.line │                          │ bridge.stdoutRl.line                 │
  │  → subscribers(cb)    │                          │  → subscribers(cb)  → feWs.send      │
  │  → tracker.observe    │                          │  → wireLog("in") + rec("in")  ← חדש  │
  └──────────┬───────────┘                          │  → tracker.observe                   │
             │ cb                                    └──────────────────────────────────────┘
             ▼                                          ▲ שורד detach! תמיד-פעיל
  ┌──────────────────────┐                              │
  │ ws-agent.onLine cb    │                          ┌────────────────────────────────────┐
  │  → feWs.send          │                          │ ws-agent.onLine cb → feWs.send בלבד  │
  │  → logWire("in")  ◄───┼─ מת ב-detach              └────────────────────────────────────┘
  │  → rec("in")      ◄───┤  (unsub + rec.close)
  └──────────────────────┘

  feWs.message                                       feWs.message
     │                                                  │
     ▼                                                  ▼
  ┌──────────────────────┐                          ┌────────────────────────────────────┐
  │ ws-agent.message      │                          │ ws-agent.message                     │
  │  → child.stdin.write  │                          │  → bridgeManager.writeStdin(id,line) │
  │  → logWire("out") ◄───┼─ מת ב-detach              └─────────────────┬────────────────────┘
  │  → rec("out")     ◄───┤                                            │
  └──────────────────────┘                          ┌─────────────────▼────────────────────┐
                                                     │ bridge.writeStdin                     │
  recorder: open ב-WS-connect, close ב-detach        │  → child.stdin.write                  │
  ns: backend.ws.wire                                │  → wireLog("out") + rec("out")  ← חדש │
                                                     └────────────────────────────────────────┘
                                                     recorder: open ב-spawn, close ב-child-exit
                                                     ns: backend.acp.wire (CLI↔BE)
```

---

## §4 — Commits בסדר

### Commit 0 — wire observability עובר ל-bridge-manager + הסרה מ-ws-agent (approach: integration)

> **למה commit אטומי אחד ולא שניים**: ה-in-path (stdout) וה-out-path (stdin) וה-recorder
> חולקים מצב (אותו `WireSession` per child). פיצול ל"הוסף ל-bridge" ואז "הסר מ-ws-agent" היה
> יוצר **double-logging / double-recording** זמני (שתי נקודות מתעדות את אותו frame). לכן הכל זז
> יחד. הטסטים (להלן) מאמתים שאין regression.

**קבצים שמשתנים**:

**א. `packages/backend/src/acp/bridge-manager.ts`** — הופך לבעלים היחיד של ה-wire observability:

1. ייבוא טיפוס (ה-`decodeWireLine` כבר מיובא, שורה 7):
   ```ts
   import type { WireRecorder, WireSession } from "../delivery/wire-recorder.js"
   ```
2. logger חדש ברמת module (ליד `log`, שורה 11):
   ```ts
   const wireLog = createLogger("backend.acp.wire")
   ```
3. חתימת ה-factory מקבלת recorder אופציונלי (**אופציונלי בכוונה** — call-sites בטסטים קוראים `createBridgeManager()` ללא args; ברירת מחדל no-op):
   ```ts
   export function createBridgeManager(opts?: { wireRecorder?: WireRecorder }): /* ...הטיפוס המוחזר האינליין... */ {
     const wireRecorder = opts?.wireRecorder
   ```
   > **חשוב (תוקן לפי אביגיל #3)**: ה-return type של `createBridgeManager` הוא **object inline** בשורות 20-30,
   > **לא** alias נפרד. ה-`BridgeManager` interface ב-`core/ports.ts:99-114` כולל רק `spawn/get/list/kill/onCrash`
   > ו**אינו** נושא את `getChild`/`onLine`/`markAttached`/`writeStdin` — אלה חיים רק בבלוק האינליין. **אין שום שינוי
   > ב-`core/ports.ts`.** כל method חדש (`writeStdin`) נכנס לבלוק האינליין (20-30) **וגם** ל-`return {...}`.
4. הרחבת `Entry` ב-recording session:
   ```ts
   type Entry = {
     // ...הקיים...
     rec: WireSession   // ← חדש: recording session לכל חיי ה-child (no-op כש-WIRE_RECORD כבוי)
   }
   ```
5. ב-`spawnInternal`, בעת `store.set(...)` (שורה 178): לפתוח session ולשמור ב-entry:
   ```ts
   const rec = wireRecorder?.open(bridgeId) ?? { record() {}, close() {} }
   store.set(bridgeId, { /* ...הקיים... */, rec })
   ```
6. ב-`stdoutRl.on("line")` (150-161) — **אחרי** לולאת ה-subscribers (כדי לא לעכב את ה-send),
   ולפני/אחרי `tracker.observe`, להוסיף תיעוד כיוון **"in"** (decode פעם אחת — מותר לאחד עם ה-observe הקיים):
   ```ts
   stdoutRl.on("line", (line) => {
     const entry = store.get(bridgeId)
     if (!entry) return
     // (1) subscribers (ws-agent → feWs.send) — קודם, ללא שינוי
     for (const cb of entry.lineSubscribers) {
       try { cb(line) } catch { /* subscriber לא יכול לשבור את ה-pipe */ }
     }
     // (2) wire observability (in) — non-critical, מבודד, לעולם לא שובר את ה-pipe
     try {
       const s = decodeWireLine(line)
       const type = s.sessionUpdate ?? s.method ?? s.responseKind ?? (s.unparsed ? "unparsed" : "unknown")
       wireLog.debug({ bridgeId, dir: "in", type, id: s.id }, "wire")
       if (!s.unparsed) wireLog.trace({ bridgeId, dir: "in", frame: s.parsed }, "wire-full")
       entry.tracker.observe(s, Date.now())   // ← decode אחד משמש גם את ה-tracker
     } catch { /* silent */ }
     entry.rec.record("in", line)
   })
   ```
   > ⚠️ שמור על העיקרון הקיים: **subscribers לפני decode/observe**. ה-`tracker.observe` כבר היה
   > כאן — רק אחדנו את ה-decode (במקום decode כפול: פעם ל-tracker, פעם ל-wireLog).
7. method חדש `writeStdin` ב-**בלוק האינליין** של ה-return type (ליד `getChild`, שורות 22-29) **וגם** ב-`return {...}` (אין נגיעה ב-core/ports.ts — ראה הערת #3 למעלה):
   ```ts
   /** כותב שורה ל-child.stdin ומתעד את כיוון ה-out. מחזיר false אם ה-bridge לא קיים. */
   writeStdin(bridgeId: string, line: string): boolean
   ```
   מימוש:
   ```ts
   writeStdin(bridgeId, line) {
     const entry = store.get(bridgeId)
     if (!entry) return false
     entry.child.stdin.write(line)   // המתודה כבר נקראת בתוך try/catch ב-ws-agent
     try {
       const s = decodeWireLine(line.endsWith("\n") ? line.slice(0, -1) : line)
       const type = s.sessionUpdate ?? s.method ?? s.responseKind ?? (s.unparsed ? "unparsed" : "unknown")
       wireLog.debug({ bridgeId, dir: "out", type, id: s.id }, "wire")
       if (!s.unparsed) wireLog.trace({ bridgeId, dir: "out", frame: s.parsed }, "wire-full")
     } catch { /* silent */ }
     entry.rec.record("out", line.endsWith("\n") ? line.slice(0, -1) : line)
     return true
   }
   ```
8. סגירת ה-recording session כשה-child מת — ב-`child.on("exit")` (137-143) **וגם** ב-`kill()` (213-224),
   באופן idempotent (`WireSession.close()` כבר idempotent לפי החוזה). הוסף `store.get(bridgeId)?.rec.close()`
   **לפני** ה-`store.delete(bridgeId)` בשני המקומות.
   > **אין מסלול שלישי (אומת ע"י אביגיל #4)**: מסלול ה-spawn-fail `child.on("error")` עם `!child.pid` (110-125)
   > רץ **לפני** ש-`store.set`/`rec.open` בכלל קרו (ה-pid guard בשורה 163) → אין `entry.rec` לדלוף שם.
   > **אל תוסיף** `rec.close()` ב-`child.on("error")` — אין מה לסגור.

**ב. `packages/backend/src/delivery/ws-agent.ts`** — מסיר את כל ה-wire, נשען על bridge:

- **DELETE**: `wireLog` (27), `childWireLog` (58), כל הפונקציה `logWire` (60-69), `rec` (92), `rec.close()` (160).
- **DELETE imports** שכבר לא בשימוש: `decodeWireLine` (23), `WireRecorder` (24).
- הרחב את ה-deps interface (`bridgeManager`, שורות 43-50) — הסר את `wireRecorder` ממקום אחר והוסף:
  ```ts
  writeStdin(bridgeId: string, line: string): boolean
  ```
- הסר את `wireRecorder` מ-deps של `createAgentWsHandler` (51).
- `onLine` callback (99-108) → רק `feWs.send`:
  ```ts
  const unsub = deps.bridgeManager.onLine(agentId, (line) => {
    if (line.length === 0) return
    try { feWs.send(`${line}\n`) } catch { /* feWs נסגר */ }
  })
  ```
- message handler (111-132): החלף `child.stdin.write(line)` ב-`deps.bridgeManager.writeStdin(agentId, line)`,
  והסר את `logWire`/`rec` סביבו. ה-`$/ping`→`$/pong` נשאר **אבל בלי** `logWire`/`rec` (ראה §9 Q1):
  ```ts
  feWs.on("message", (data) => {
    try {
      const text = data.toString()
      if (text.includes('"$/ping"')) {
        feWs.send(`${JSON.stringify({ jsonrpc: "2.0", method: "$/pong" })}\n`)
        return   // keepalive transport — לא עובר ל-child, לא חלק מ-acp.wire
      }
      const line = text.endsWith("\n") ? text : `${text}\n`
      deps.bridgeManager.writeStdin(agentId, line)
    } catch (err) {
      childLog.warn({ err }, "stdin write failed")
    }
  })
  ```
  > הערה: `child` עדיין דרוש ב-ws-agent ל-`onChildExit`/`child.once("exit")`/`child.off` (134-143, 161) —
  > **אל תסיר** את `getChild`/`child`. רק ה-`stdin.write` הישיר עובר ל-`writeStdin`.

**ג. `packages/backend/src/server.ts`** — מעביר את ה-recorder מ-handler ל-bridge:
- שורה 76: `const bridgeManager = createBridgeManager({ wireRecorder })`
  ⚠️ סדר: `wireRecorder` מוגדר בשורה 87 — **הזז את הגדרת `wireRecorder` למעלה, לפני `createBridgeManager`**.
- שורה 126: `createAgentWsHandler({ orchestrator, bridgeManager })` — בלי `wireRecorder`.

**ד. `packages/backend/tests/ws-agent-pipe.test.ts`** — ⚠️ **call-site קריטי (אביגיל #1+#2)**. **3 קבצי טסט
נוגעים ב-`createAgentWsHandler`** (לא רק error-survival!) — זה אחד מהם, עם 7 קריאות:
- **הסר `wireRecorder: noopWireRecorder`** מכל 7 ה-call-sites (104,121,143,171,189,211,229) →
  `createAgentWsHandler({ orchestrator, bridgeManager })`. (excess-property ייכשל ב-typecheck אחרת.)
- **הסר** את ה-import של `createWireRecorder` ואת `const noopWireRecorder = ...` (24,27) אם נותרו ללא שימוש.
- **הוסף `writeStdin` ל-mock** `makeMockBridgeManager` (78-87). חובה — אחרת (א) typecheck נופל (missing property
  מול ה-deps interface החדש), ו(ב) הטסט "FE message forwarded to child.stdin" (116-135) **נשבר ב-runtime**:
  הוא דוחף `ws.emit("message")` ו-asserts ש-`child.stdin` קיבל — אבל ה-handler עכשיו קורא `bridgeManager.writeStdin`,
  שאין לו מימוש ב-mock → ההודעה לא תגיע ל-stdin. ה-mock חייב לכתוב ל-`child.stdin` בעצמו:
  ```ts
  const bridgeManager = {
    getChild: vi.fn(() => child),
    markAttached: vi.fn(),
    markDetached: vi.fn(),
    onLine: vi.fn((_id: string, cb: (line: string) => void) => { registeredLineCallback = cb; return () => { registeredLineCallback = null } }),
    writeStdin: vi.fn((_id: string, line: string) => { child?.stdin.write(line); return child !== null }),  // ← חדש
  }
  ```
  (שים לב: `child` יכול להיות `null` ב-call-site 104 → `child?.stdin` + `return child !== null`.)
- הטסט "$/ping → does NOT forward to child.stdin" (138-160) **ממשיך לעבוד** ללא שינוי: ה-handler לא קורא
  `writeStdin` על `$/ping` (return מוקדם), אז `child.stdin` לא מקבל אותו — בדיוק מה שה-assertion דורש.
- **אל תשנה** את מהות הטסטים — רק החתימות + ה-mock.

**ה. `packages/backend/tests/ws-agent-error-survival.test.ts`** — עדכון לחתימות החדשות:
- שורת `createAgentWsHandler({ orchestrator, bridgeManager, wireRecorder })` → בלי `wireRecorder`
  (excess property ייכשל ב-typecheck אחרת). ה-`noopWireRecorder`/import של `createWireRecorder` — מחק אם נותר ללא שימוש.
- הטסט משתמש ב-`createBridgeManager()` אמיתי → `writeStdin` כבר קיים, אין שינוי ל-mock שם.
- **אל תשנה** את מהות הטסט (child survival על feWs 'error'). רק החתימות.

**טסט חדש** `packages/backend/tests/bridge-writestdin.test.ts` (integration):
- spawn child אמיתי לפי תבנית `bridge-manager.runtime.test.ts`, אבל סקריפט echo:
  `OPENCODE_ARGS='["-e","process.stdin.on(\"data\",d=>process.stdout.write(d))"]'` (echo stdin→stdout).
- הירשם `onLine`, קרא `bm.writeStdin(id, "hello\n")`, assert שה-subscriber קיבל `"hello"` (round-trip
  דרך child אמיתי — מוכיח ש-`writeStdin` כותב ל-stdin בפועל).
- assert ש-`writeStdin("nonexistent", ...)` מחזיר `false`.
- ניקוי children ב-`afterEach` (כמו ב-runtime test).

**Verification**:
```bash
pnpm typecheck
pnpm --filter @drive-coding/backend test
pnpm lint:i18n
# ידני (אופציונלי — מאשש את ה-gap שנסגר): הרץ BE על PORT=4002 עם LOG_WIRE=acp,
#   חבר agent, שלח prompt, ואז "נתק" (סגור את ה-WS client). ודא ש-backend.acp.wire
#   ממשיך להירשם (dir:"in") גם אחרי הניתוק — בניגוד למצב היום.
```

### Commit 1 — עדכון config/deploy ל-ns החדש + תיעוד (approach: manual)

ה-ns עבר מ-`backend.ws.wire` ל-`backend.acp.wire`. כל מי שהפעיל `LOG_WIRE=ws` יקבל עכשיו ns ריק.

**קבצים שמשתנים**:
- `deploy/systemd/voice-acp-dev.service` + `voice-acp-main.service` — **אומת ע"י אביגיל #5: אין בהם `LOG_WIRE`**
  (`grep LOG_WIRE deploy/systemd/*` → ריק). **אין שינוי כאן** — מחק את הסעיף הזה אם רוצים, ההערה נשארת בלבד.
- `docs/deploy-local-service.md:99` — **כאן** מופיע `LOG_WIRE=ws` (אביגיל #5). עדכן ל-`LOG_WIRE=acp`.
- `AGENTS.md` (root) — סעיף "Wire tracing & recording (debug)": עדכן `LOG_WIRE=ws` →
  `LOG_WIRE=acp`, וההסבר ש-ns הוא `backend.acp.wire.*` (CLI↔BE) ושהוא **שורד detach** (תמיד-פעיל
  לכל חיי ה-child, לא תלוי בחיבור דפדפן). `WIRE_RECORD` — אותו דבר, מתועד ב-bridge עכשיו.

> **תיעוד drop-in/units חיים (לא בקוד — הערה ל-מרדכי לפני merge)**: ה-unit החי
> `~/.config/systemd/user/voice-acp-dev.service` מגדיר `LOG_WIRE=ws` אך ה-dropin
> `10-logging.conf` מבטל אותו ועובד עם `LOG_NS=backend.*` (יקלוט `backend.acp.wire` אוטומטית).
> ה-prod (`voice-acp-main`) עדיין על `LOG_WIRE=ws` → **אחרי merge+redeploy יפסיק לראות wire**
> עד שיעודכן ל-`acp`. זו פעולת-deploy ידנית, לא חלק מה-worktree.

**Verification**:
```bash
pnpm typecheck   # config/docs בלבד — אין שינוי קוד; ודא שאין רגרסיה
# manual reasoning: LOG_WIRE=acp → backend.acp.wire.* (כבר ממופה ב-core/log/config.ts).
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck + tests עוברים | `pnpm typecheck && pnpm --filter @drive-coding/backend test` |
| 2 | lint:i18n נקי | `pnpm lint:i18n` |
| 3 | `ws-agent.ts` נקי מ-wire | `grep -nE "wireLog|logWire|wireRecorder|decodeWireLine|\.rec\b" packages/backend/src/delivery/ws-agent.ts` → **אפס תוצאות** |
| 4 | `writeStdin` כותב ל-stdin בפועל | טסט חדש: echo child מחזיר את מה ש-`writeStdin` שלח (round-trip) |
| 5 | wire in-path נרשם ברמת bridge | טסט/ידני: `backend.acp.wire` `dir:"in"` נפלט מ-`stdoutRl` (לא מ-ws-agent) |
| 6 | regression — pipe E2E עובד | phase verify: agent מקבל prompt (out) ומגיב (in); FE רואה תשובה |
| 7 | regression — child שורד disconnect | `ws-agent-error-survival.test.ts` עדיין ירוק אחרי השינוי |
| 8 | regression — pipe test ירוק | `ws-agent-pipe.test.ts` ירוק: "FE message forwarded to child.stdin" + "$/ping does NOT forward" עוברים עם mock.writeStdin |
| 9 | recorder per-child-lifetime | עם `WIRE_RECORD=1`: קובץ JSONL אחד לכל child, מכיל גם in וגם out, **לא** נסגר ב-disconnect |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| `LOG_WIRE=ws` בפרוד יפסיק לראות wire | שינוי ns | Commit 1 מעדכן units/docs ל-`acp`; הערה מפורשת ל-merge על ה-prod unit |
| double-logging זמני אם מפצלים commit | refactor | Commit 0 אטומי — in+out+recorder זזים יחד (ראה §4) |
| `writeStdin` על bridge מת → throw | child exit race | `store.get` guard → מחזיר `false`; ws-agent עוטף ב-try/catch ממילא (130) |
| decode כפול / overhead | אוחדנו decode ל-tracker+wire | decode **פעם אחת** ב-`stdoutRl`; הכל ב-`debug`/`trace` (לא `info`), מבודד ב-try/catch |
| `$/ping` נעלם מהתיעוד | הוסר מ-ws-agent | מכוון — הוא transport keepalive, לא ACP wire (§9 Q1). lifecycle יכול לחזור ב-slice נפרד אם יידרש |
| Hebrew ב-string literals חדשים | AGENTS lint:i18n | string literals באנגלית; message strings כמו `"wire"` נשמרים זהים |
| שבירת `tracker.observe` עקב איחוד decode | refactor | `observe` מקבל את אותו `WireSummary` כמו היום; הסדר subscribers→observe נשמר |

> 3 שתמיד נשכחים: (1) i18n — אין strings עברית חדשים; (2) reactivity — לא רלוונטי (backend); (3) OneCLI — לא רלוונטי (אין proxy).

---

## §7 — Escalation triggers

עצור ושאל את מרדכי אם:
- מסתבר ש-`writeStdin` צריך להיות async / להחזיר Result (backpressure על stdin) — החלטת חוזה.
- ה-`tracker.observe` שבור אחרי איחוד ה-decode בצורה שמשפיעה על `getRuntimeInfo(busy)` — חוזה תצוגה.
- מתגלה מקור wire נוסף (echo socket? bridge אחר?) שלא נספר ב-§2.
- שינוי ה-ns שובר טסט/צרכן שלא זוהה ב-Reading list.
- אתה רוצה לסטות מ-approach (integration) שנקבע, או לפצל את Commit 0.

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| Streaming/real-time (WS + stdio pipe) | +2 |
| State machine / async coordination (recording lifecycle open/close, idempotency מול child exit/kill) | +2 |
| Refactor של קוד קיים (העברת אחריות בין שכבות) | +1 |
| Pure logic extract (decode מאוחד) | -1 |

**Score**: 4 / 10 (מעוגל מ-§8; +1 על רגישות ה-pipe החי → **5** לצורך ה-tier)

**Tier**: light (`calev` mode: light) + **phase verify על Commit 0** (refactor של ה-pipe החי —
regression ב-E2E הוא הסיכון המרכזי; DoD #6/#7 הם ה-gating).

**Verifier-phase אחרי commit**: 0

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | לתעד את `$/ping`/`$/pong` keepalive ב-wire? | **לא** — הוא transport (BE↔FE NAT), לא עובר ל-child, לא ACP wire. יורד מהתיעוד. | ❌ |
| 2 | לאחד את ה-decode (tracker + wireLog) או להשאיר כפול? | **לאחד** — decode פעם אחת ב-`stdoutRl`, נמסר גם ל-`observe`. חוסך overhead, אותו `WireSummary`. | ❌ |
| 3 | recording session per-WS-connection (היום) או per-child (אחרי)? | **per-child** — קובץ רציף דרך reconnects; נסגר ב-child exit/kill. (semantics משתנה — מתועד) | ❌ |
| 4 | `writeStdin` sync (כמו היום `child.stdin.write`) או async? | **sync** — שמירה על ההתנהגות הקיימת; backpressure על stdin לא נצפה כבעיה. שדרוג = escalation. | ❌ |
| 5 | להשאיר `backend.ws.wire` כ-alias ל-backward compat? | **לא** — אין צרכן ל-`ws.wire` אחרי השינוי; `LOG_WIRE=acp` מכסה. פחות בלבול. | ❌ |

---

## סטיות מהתכנון (מתעדכן ע"י executor תוך כדי)

ללא סטיות. ה-brief בוצע לפי המפרט:
- Commit 0: refactor אטומי כמפורט ב-§4.א-ה, כולל טסט חדש bridge-writestdin.test.ts
- Commit 1: עדכון deploy-local-service.md:99 + AGENTS.md — deploy/systemd files לא עודכנו (ריקים מ-LOG_WIRE כאשר אביגיל #5 אמתה)
- Phase verify (calev mode: phase) אחרי Commit 0: verdict GO, 0 findings
- Final verify (calev mode: light): ראה תוצאות למטה
