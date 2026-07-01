# Slice — warm-reattach-skip-init — תוכנית

> **תאריך**: 2026-07-01
> **סטטוס**: הושלם (commits: 9ff9717..92d0b07; calev light — ממתין לאימות חי)
> **Complexity**: 4/10 (verifier: light — calev)
> **תלות**: אין (base=dev). קשור: `docs/investigations/2026-07-01-warm-reattach-initialize.md`

## רקע (למה הסבב הזה קיים)

כפתור "Reconnect" בפאנל התהליכים נכשל מול **Codex** ACP. `#warmReconnect` (FE) קורא
ל-`createAcpClient()`, שתמיד שולח `initialize`. Codex, על process שכבר אותחל, מחזיר
`error: Already initialized`. הכשל נתפס ב-`catch`, קורא ל-`transport.close()`, שמצית
`#handleUnexpectedClose` → auto-reconnect → warm שוב → כשל שוב → **סוקטים חוזרים ברצף**
(המשתמשת ראתה 3). ראיות wire מלאות: `docs/investigations/2026-07-01-warm-reattach-initialize.md`.

**התיקון**: נתיב יצירת-client שמדלג על `initialize` עבור warm reattach — `loadSession`
לבדו עובד על process חי (מאומת חי במסמך החקירה, §"בדיקה חיה ללא שינוי קוד").

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/warm-reattach-skip-init -b slice/warm-reattach-skip-init dev
cd .worktrees/warm-reattach-skip-init
pnpm install && pnpm hooks:install
```

### Run
- provider tests: `pnpm --filter @drive-coding/provider test`
- FE tests: `pnpm --filter @drive-coding/frontend-v2 test`
- typecheck: `pnpm typecheck`
- BE (לבדיקה חיה — **חייב OneCLI**): `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (port 4000)
- FE dev: `pnpm --filter @drive-coding/frontend-v2 dev`

### בדיקה חיה — סביבה
הבאג הוא **Codex-specific**. הבדיקה החיה המשמעותית דורשת agent codex חי:
1. חבר codex, שלח prompt קצר, ודא תשובה.
2. לחץ "צא — השאר רץ" (leave running) → חוזר לרשימת התהליכים, ה-agent נשאר חי.
3. לחץ "Reconnect" על אותו agent.
4. צפוי: נכנס ל-chat עם היסטוריה, **בלי** לולאת-סוקטים, בלי error.

לכידת wire לאימות (ר' AGENTS.md §"Wire tracing"):
```bash
WIRE_RECORD=1 PORT=4000 onecli run --agent voice-acp -- bun src/server.ts
# ניתוח: אין initialize חוזר אחרי החיבור הראשון, יש session/load
jq -r 'select(.raw|fromjson|.method) | (.dir+" "+(.raw|fromjson|.method))' ~/.config/drive-coding/wire-recordings/*.jsonl | grep -E "initialize|session/load"
```
> הערה למריצים על termux/phone (שם התגלה הבאג): recordings תחת `~/.config/drive-coding/wire-recordings/`.

### Browser
Chrome רגיל / linux-gui / phone — כל אחד מספיק. הבאג לא תלוי-פלטפורמה (התגלה בטלפון, שורש כללי).

### Reading list
**must-read לפני**:
- `docs/investigations/2026-07-01-warm-reattach-initialize.md` — כל הרציונל + ראיות wire.
- `packages/provider/src/client/client.ts` — `createAcpClient` הקיים (השורש: `conn.initialize` שורה 112; ה-facade שורות 154-251).
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` שורות 482-552 — `#warmReconnect`.

**reference**:
- `packages/provider/src/client/client.extmethod.test.ts` — דפוס בדיקת client (createClientImpl).
- `packages/backend/src/delivery/ws-agent.ts` שורות 82-88 — ה-BE שולח `_drive/capabilities` על connect.

## §1 — מטרה

אחרי הסבב: לחיצה על "Reconnect" ל-agent codex חי מחזירה אותך לשיחה עם ההיסטוריה,
מיידית, דרך חיבור-WS **אחד**, בלי `initialize` חוזר ובלי לולאת-reconnect. (claude/opencode
ממשיכים לעבוד כרגיל.)

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| נתיב client שמדלג על initialize (`createAttachedAcpClient`) | ✅ | הסבב הזה |
| `#warmReconnect` משתמש בנתיב החדש | ✅ | הסבב הזה |
| **תיקון conflation של 1008** ("agent not found" מתחזה ל-MED-8 second-tab) | ❌ | known-issue נפרד — קוד ייעודי ל-not-found. לא נוגעים כאן. |
| **refactor מבנה provider** (backend/, capabilities/normalize, מחיקת host/) | ❌ | `docs/investigations/2026-07-01-provider-package-organization.md` — אחרי הבאג |
| שינוי נתיב cold (`createAcpClient` הרגיל) | ❌ | נשאר זהה התנהגותית (רק extraction של ה-facade) |
| multi-client / replay / id-NAT | ❌ | future |

## §3 — Architecture diagram

```
attachToLiveAgent        (FE VM — ספציפי)
  → #warmReconnect        (FE VM — ספציפי)
      → createAttachedAcpClient(transport, cb, {capabilities})   ← משתנה: היה createAcpClient
          → ndJsonStream → ClientSideConnection                  ← ללא conn.initialize
          → buildAcpClientFacade(...)                            ← חדש: משותף לשני הנתיבים
      → client.loadSession({sessionId, cwd})                     ← עובד על process חי
      → notifySessionAttached(agentId, sessionId, {replace:true})
      → status = connected

createAcpClient (cold — ללא שינוי התנהגותי)
  → conn.initialize(...)                                         ← נשאר
  → buildAcpClientFacade(...)                                    ← אותו helper משותף

capabilities:
  NormalizedCapabilities  ← מגיע כמו היום מ-_drive/capabilities (ws-agent.ts:87), לא מושפע
  raw agentCapabilities   ← warm מקבל fallback סטטי (משמש רק supportsImageInput הרדום)
```

## §4 — Commits

### Commit 0 — provider: extract facade + createAttachedAcpClient (approach: TDD)

**קובץ**: `packages/provider/src/client/client.ts` (שינוי) · `packages/provider/src/client/index.ts` (שינוי) · `packages/provider/src/client/client.attached.test.ts` (חדש)

**שינויים ב-client.ts**:
1. **חילוץ** ה-return-object הקיים (שורות 154-251) לפונקציה פרטית `buildAcpClientFacade(conn, transport, capabilities)` — **ללא שינוי לוגי**. `createAcpClient` קורא לה אחרי initialize עם `initResult.agentCapabilities`. cold-path נשאר זהה בהתנהגות.
2. **הוספת** `createAttachedAcpClient` — בונה stream + `ClientSideConnection` + facade, **בלי** `conn.initialize`. מקבל `capabilities` מבחוץ.

**index.ts** — additive; לייצא גם את הטיפוס החדש (מקביל ל-`AcpClientOptions` הקיים):
```ts
export type { AcpClient, AcpClientOptions, AttachedAcpClientOptions } from "./client.js"
export { createAcpClient, createAttachedAcpClient } from "./client.js"
```
(השורה הקיימת מייצאת `AcpClient, AcpClientOptions` — להוסיף `AttachedAcpClientOptions` + `createAttachedAcpClient`, לא לדרוס.)

**API skeleton**:
```ts
// חדש — helper פרטי (extraction; אין שינוי לוגי בתוכו)
function buildAcpClientFacade(
  conn: ClientSideConnection,
  transport: AcpTransport,
  capabilities: AcpClient["capabilities"],
): AcpClient { /* גוף = ה-return הנוכחי משורות 154-251, מילולית */ }

// חדש — נתיב warm reattach (בלי initialize)
export type AttachedAcpClientOptions = {
  /** capabilities ידועות מבחוץ. warm reattach אין לו תגובת initialize לשאוב ממנה.
   *  משמש רק supportsImageInput (רדום). ברירת-מחדל: אובייקט ריק בטוח. */
  capabilities?: AcpClient["capabilities"]
}

export function createAttachedAcpClient(
  transport: AcpTransport,
  onUpdateOrCallbacks: ((n: SessionNotification) => void) | AcpClientCallbacks,
  options: AttachedAcpClientOptions = {},
): AcpClient {
  const callbacks: AcpClientCallbacks =
    typeof onUpdateOrCallbacks === "function" ? { onUpdate: onUpdateOrCallbacks } : onUpdateOrCallbacks
  const stream = ndJsonStream(transport.writable, transport.readable)
  const client = createClientImpl({ onUpdate: callbacks.onUpdate, onExtNotification: callbacks.onExtNotification })
  const conn = new ClientSideConnection((_agent) => client, stream)
  const capabilities = options.capabilities ?? ({} as AcpClient["capabilities"])
  return buildAcpClientFacade(conn, transport, capabilities)
}
```
> הערה: `createAttachedAcpClient` **סינכרוני** (אין await על initialize). זה תקין — ה-WS כבר OPEN (ה-caller המתין ל-waitForOpen).

**Tests (`client.attached.test.ts`)** — ⚠️ **בניית ה-transport-double היא עיקר העבודה ב-Commit 0**. אין תקדים בקוד: `client.extmethod.test.ts` בודק את `createClientImpl` ישירות (בלי transport), לא round-trip דרך `AcpTransport`. צריך לבנות `AcpTransport` בזיכרון שלוכד frames שנכתבו וניתן להזין לו frames נכנסים.

`AcpTransport` (`packages/provider/src/transport/types.ts:25-30`) = `{ readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>; close(): void; onClose(cb: (code: number, reason: string) => void): void }` — **4 חברים** (כל double חייב לספק את כולם). skeleton מוצע ל-double:
```ts
function makeTransportDouble() {
  const written: string[] = []
  const dec = new TextDecoder()
  const writable = new WritableStream<Uint8Array>({
    write(chunk) { written.push(dec.decode(chunk)) },
  })
  let pushIn!: (line: string) => void
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder()
      pushIn = (line) => c.enqueue(enc.encode(line.endsWith("\n") ? line : `${line}\n`))
    },
  })
  // ⚠️ AcpTransport דורש 4 חברים (transport/types.ts:25-30): readable, writable,
  // close(): void, onClose(cb: (code, reason) => void): void.
  // ה-facade קורא transport.close() (client.ts:200), וגם createAcpClient במסלולי
  // timeout/auth (client.ts:147,150). בלי ה-no-ops → TypeError בזמן ריצה שיסווה כשל.
  const transport: AcpTransport = {
    readable,
    writable,
    close() {},
    onClose(_cb) {},
  }
  return { transport, written, pushIn }
}
```
> `ndJsonStream` מפרק לפי `\n` — לכן ה-double מוסיף `\n`. שים לב: `AcpTransport` מוגדר כ-`interface` מלא (readable + writable + close + onClose) — הסקלטון מספק את כל הארבעה, בלי `as` שמסתיר חסרים. הפעולות ב-`AcpClient` (`loadSession` וכו') async ומחזירות Promise שמתמתן על תגובה — לטסט של "מה נכתב" אפשר לבדוק את `written` בלי להמתין לתשובה (או להזין תשובה דרך `pushIn` אם רוצים round-trip מלא).

בדיקות:
- `createAttachedAcpClient(transport, () => {})` — **אף frame ב-`written` לא מכיל `"initialize"`** (הליבה).
- קריאה ל-`loadSession({sessionId,cwd})` → `written` מכיל frame עם `"session/load"` (לא צריך להמתין ל-resolve; אפשר לזרוק את ה-Promise).
- `capabilities` שהועברו ב-options מוחזרים ב-`client.capabilities`; ברירת-מחדל (ללא options) לא זורקת.
- **regression**: `createAcpClient(transport, () => {})` **כן** כותב frame `"initialize"` (round-trip: להזין תגובת initialize דרך `pushIn` כדי שה-Promise יתמתן, או להשתמש ב-`initTimeoutMs` קצר ולבדוק את `written` לפני ה-timeout). אם קשה — לפחות לוודא שה-frame נכתב.

**Verification**:
```bash
pnpm --filter @drive-coding/provider test
pnpm --filter @drive-coding/provider typecheck
```

### Commit 1 — FE: #warmReconnect uses createAttachedAcpClient (approach: manual — glue, אומת חי)

**קובץ**: `packages/frontend/src/lib/view-models/agent-session.svelte.ts`

**שינויים**:
1. import: `import { createAcpClient, createAttachedAcpClient, type AcpClient } from "@drive-coding/provider/client"`.
2. קבוע ברמת-מודול (ליד `IMAGE_INPUT_ENABLED`): fallback ל-raw capabilities ל-warm.
   ```ts
   // warm reattach אין לו תגובת initialize. raw capabilities משמש רק supportsImageInput
   // (רדום מאחורי IMAGE_INPUT_ENABLED). NormalizedCapabilities מגיע מ-_drive/capabilities.
   const ATTACHED_CAPS_FALLBACK = {} as AcpClient["capabilities"]
   ```
3. בתוך `#warmReconnect` (שורה ~525) — החלף **רק** את קריאת יצירת-הלקוח:
   ```ts
   // לפני:
   this.#client = await createAcpClient(transport, { onUpdate: ..., onExtNotification: ... })
   // אחרי:
   this.#client = createAttachedAcpClient(transport, { onUpdate: this.#onSessionUpdate, onExtNotification: this.#onExtNotification }, { capabilities: ATTACHED_CAPS_FALLBACK })
   ```
   שאר הבלוק (בניית `#ext`, `loadSession`, `notifySessionAttached`, `setStatus`) — **ללא שינוי**.

> **חשוב**: לא לגעת בנתיבי ה-cold — `initialize` נכון ונחוץ שם. קריאות `createAcpClient` שנשארות ללא שינוי:
> - `attach` — קריאת `createAcpClient` בשורה **590** (שורה 578 היא `new WsAcpTransport`).
> - `loadSession` — קריאת `createAcpClient` בשורה **757** (שורה 745 היא `new WsAcpTransport`).
> - `#coldReconnect` — **אינו קורא ל-`createAcpClient` ישירות**; הוא קורא ל-`this.loadSession(...)` בשורה 466, שמגיעה ל-757. לא לגעת.
> (הנתיב היחיד שמשתנה הוא `#warmReconnect`, קריאת `createAcpClient` בשורה **525**.)

**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 test    # אין רגרסיה בטסטי reconnect/capabilities הקיימים
pnpm typecheck
```

## §5 — DoD

| בדיקה | איך |
|---|---|
| `createAttachedAcpClient` לא שולח initialize | טסט Commit 0 ירוק (assert אין frame `initialize`) |
| `loadSession` עובד דרך הנתיב החדש | טסט Commit 0 ירוק (frame `session/load` נכתב) |
| cold path ללא שינוי התנהגותי | טסטי provider קיימים ירוקים + regression-test ל-createAcpClient |
| טסטי FE הקיימים ירוקים | `pnpm --filter @drive-coding/frontend-v2 test` (reconnect + capabilities suites) |
| typecheck נקי | `pnpm typecheck` = 0 |
| **חי**: codex leave-running → reconnect → נכנס ל-chat עם היסטוריה | ידני לפי §0 "בדיקה חיה" |
| **חי**: wire — אין `initialize` חוזר אחרי חיבור ראשון, יש `session/load` | `jq` על ה-recording לפי §0 |
| **חי**: אין לולאת-סוקטים (חיבור WS אחד) | תצפית ב-Network tab / BE log ("WS connect → pipe attached" פעם אחת) |
| claude reconnect עדיין עובד (לא רגרסיה) | חי — claude leave-running → reconnect |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| חילוץ ה-facade משנה בטעות התנהגות cold | refactor של קוד יציב | ה-extraction **מילולי** — אותו גוף בדיוק; regression-test ל-createAcpClient + טסטי provider קיימים |
| type של `AcpClient["capabilities"]` דורש שדות חובה → `{}` לא מטפחת | TS strict | אם `{}` לא עובר — cast מפורש `{} as AcpClient["capabilities"]` (כבר בסקלטון); השדה נקרא רק ב-supportsImageInput הרדום |
| `createAttachedAcpClient` סינכרוני אך caller עושה `await` | חתימה שונה מ-createAcpClient | `await` על ערך לא-Promise תקין ב-JS; להשאיר או להסיר — שקול. אין תקלה פונקציונלית |
| Svelte 5 reactivity | glue ב-VM | לא נוגעים ב-$state arrays — לא רלוונטי |
| i18n hardcoded Hebrew | pre-commit hook | אין מחרוזות UI חדשות בסבב |
| OneCLI חסר בבדיקה חיה | AGENTS.md | ה-reconnect עצמו לא דורש proxy; אבל להריץ BE דרך onecli כרגיל |

## §7 — Escalation triggers

עצור ושאל את מרדכי (parent task) אם:
- Codex מחזיר שגיאה על `session/load` **בלי** initialize (סותר את ראיית מסמך החקירה) — יתכן שינוי גרסת codex-acp.
- `createAttachedAcpClient` מחייב fs handshake / frame נוסף כדי ש-`ClientSideConnection` יתפקד.
- טסט ה-transport-double דורש תשתית שלא קיימת (אין דרך פשוטה ללכוד writes) — יתכן שצריך helper משותף.
- הסרת ה-initialize חושפת שה-FE נשען על `#client.capabilities` (raw) במקום שלא ציפינו (מעבר ל-supportsImageInput).

## §8 — Complexity score

- commits: 2 (נמוך)
- שכבות חדשות: 0 (פונקציה בשכבת client קיימת + glue ב-VM)
- APIs חיצוניים: 0
- streaming/async pipeline: משיק (WS) אבל לא חדש
- refactor state model: לא (extraction מקומי בלבד)
- protocol BE↔FE: לא (BE כבר שולח _drive/capabilities)

**Score: 4/10 → verifier: light (calev)**. הבדיקה החיה (codex) היא הליבה — calev יריץ אותה.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | פונקציה נפרדת (`createAttachedAcpClient`) מול flag (`skipInitialize`) ב-createAcpClient | **נפרדת** (הוכרע עם המשתמשת — קריא, לא מסכן cold) | ❌ (הוכרע) |
| 2 | האם להשאיר `createAttachedAcpClient` סינכרוני או לעטוף ב-`async` לאחידות חתימה | סינכרוני; ה-caller יכול `await` בלי נזק | ❌ |
| 3 | capabilities fallback — `{}` ריק מול static-per-cliKind | `{}` ריק (raw caps משמש רק image רדום; Normalized מגיע מ-_drive/capabilities) | ❌ |
