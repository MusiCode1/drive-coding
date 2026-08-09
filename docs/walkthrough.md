# Walkthrough — drive-coding

## 2026-08-11 10:20

### slice session-host-http — C1: הרחבת S3 + AgentSessionRegistry + PatchesBroadcaster (TDD)

C1 מרחיב את slice session-host-core (S3) ב-3 methods ל-`ExtendedSessionHost`, מוסיף `AgentSessionRegistry` (lazy creation agentId→{host,broadcaster}) ו-`PatchesBroadcaster` (fan-out/tee עם ring-buffer).

#### מה בוצע?

**1. packages/backend/src/session-host/session-host.ts (עדכון C1/S4)**

- `ExtendedSessionHost` מורחב: `setMode(modeId)` + `setConfigOption(configId, value: string|boolean)` + `extMethod(method, params)`
- `setMode`/`setConfigOption` כוללים null-guard: זורקים 'No session' אם `currentState.sessionId === null`
- `newSession`/`loadSession` עדכנו `currentState.sessionId` מהתוצאה (כנדרש לnull-guard לעבוד)
- `extMethod` ללא guard (לא דורש sessionId)

**2. packages/backend/src/session-host/patches-broadcaster.ts (חדש)**

- `PatchesBroadcaster` — fan-out/tee מעל `ReadableStream<Patch>`
- `subscribe()` מחזיר ReadableStream חדש לכל client
- `unsubscribe(stream)` מסיר client וסוגר stream
- ring-buffer של 64 patches אחרונים (late subscribers מקבלים replay)
- drain loop ב-background מהמקור (fire & forget)

**3. packages/backend/src/session-host/registry.ts (חדש)**

- `AgentSessionRegistry` — ממפה agentId → {host, broadcaster}
- `getOrCreateHost(agentId)` async lazy: מאחזר connection מ-connectionRegistry, יוצר host + broadcaster
- `getHost`, `getBroadcaster`, `unregisterHost`
- injectable `_createHostFn` + `_createBroadcasterFn` לtest isolation

**4. טסטים (TDD)**

- `session-host.integration.test.ts` — הרחבה: 7 tests ל-setMode/setConfigOption/extMethod
- `registry.test.ts` — 11 tests: lifecycle, lazy creation, idempotency, unregister
- `patches-broadcaster.test.ts` — fan-out, unsubscribe, buffering, constructor

#### נתונים
- Tests: 67 passed (6 files)
- typecheck: clean (0 errors)
- lint:i18n: clean

---

## 2026-08-09 09:28

### slice session-host-core — C4: אינטגרציה + סיום סליס (TDD + integration)

C4 משלים את slice session-host-core עם `createSessionHostFromConnection` — factory שמחבר את כל הרכיבים: `InProcessAcpTransport` + `AcpClient` + `PendingRequests` + `SessionHost`.

#### מה בוצע?

**1. packages/backend/src/session-host/session-host.ts (עדכון C4)**

- `createSessionHostFromConnection(conn: ProviderConnection, opts?)` — factory חדש לשימוש ב-production
- מחבר: InProcessAcpTransport (מ-conn.wire + conn.onCrash) + AcpClient + PendingRequests
- PendingRequests לpermission (timeout → defaultValue: `{outcome:{outcome:"cancelled"}}`) ו-elicitation (timeout → `{action:"cancel"}`)
- `respondPermission(requestId, response)` + `respondElicitation(requestId, response)` ל-UI
- transport.onClose רשום → מעדכן status ל-"disconnected" בstate
- `_createAcpClient` injectable dep (לbריד בדיקות)

**2. packages/backend/src/session-host/session-host.integration.test.ts (חדש)**

- 11 integration tests: wiring, state updates, user message synthesis, meta passthrough, permission/elicitation PendingRequests

#### סיכום slice session-host-core

| Checkpoint | Commits | Tests |
|---|---|---|
| C1: InProcessAcpTransport | bb92dec | 10 TDD |
| C2: SessionHost | 03d4b8a | 14 TDD |
| C3: PendingRequests | 4bd38ce | 7 TDD |
| C4: Integration | f2b17c3 | 11 integration |

**סה"כ**: 42 טסטים חדשים, 0 errors typecheck, 0 רגרסיות

#### בדיקות

- `bunx vitest run packages/core`: 499 passed ✅
- `bunx vitest run packages/backend`: 344 passed + 14 skipped ✅ (https-serve failure pre-existing — Windows bun path)
- `bunx tsc --noEmit`: 0 errors ✅

## 2026-08-09 09:20

### slice session-host-core — C3: PendingRequests (TDD)

C3 מממש `PendingRequests` — רג'יסטרי ממתין גנרי ל-request_permission / elicitation/create עם timeout ו-default value.

#### מה בוצע?

**1. packages/backend/src/session-host/pending-requests.ts (חדש)**

- `createPendingRequests<T>({ timeoutMs, defaultValue? })` — factory גנרי
- `request(requestId: number): Promise<T>` — רושם בקשה ממתינה
- `respond(requestId: number, result: T): void` — פותר את הbקשה
- Timeout: אם `respond` לא נקרא תוך `timeoutMs`:
  - ללא `defaultValue` → rejects עם `Error("Request N timeout")`
  - עם `defaultValue` → resolves עם ה-default
- `settled` flag מונע double-resolve אחרי timeout
- `respond` על id לא-ידוע הוא no-op (לא זורק)

**2. packages/provider/src/client/index.ts (שונה)**

- הוספת export של `AcpClientCallbacks` (נדרש ל-session-host.ts + בדיקות C2)

#### בדיקות

- `pending-requests.test.ts`: 7 טסטים עוברים ✅
  - request + respond: resolves עם תוצאה
  - respond על id לא-ידוע: no-op ✅
  - timeout: rejects עם Error כשאין defaultValue
  - אין reject לפני timeout
  - ignore respond אחרי timeout (ללא double-resolve)
  - multiple concurrent requests — כל אחד עצמאי
  - default value: resolves במקום לזרוק בtimeout
- typecheck נקי ✅

## 2026-08-09 09:15

### slice session-host-core — C1: InProcessAcpTransport (TDD)

C1 מממש את `InProcessAcpTransport` — byte-transport מעל `conn.wire` שמחבר בין SessionHost ל-ProviderConnection.

#### מה בוצע?

**1. packages/backend/src/session-host/in-process-acp-transport.ts (חדש)**

- מממש `AcpTransport` מ-`@drive-coding/provider/transport` (byte-transport, לא facade)
- `readable`: subscribes ל-`conn.wire.onLine` → מוסיף `"\n"` לכל שורה → ממיר ל-Uint8Array (TextEncoder)
- `writable`: מקבל Uint8Array → line-buffer/split על `"\n"` → שולח שורות ל-`conn.wire.write`
- `close()`: סוגר את ה-ReadableStream (ReadableStreamDefaultController.close)
- `onClose(cb)`: adapter — `conn.onCrash` (BridgeCrashInfo) → `(code, reason)` שהAcpTransport מצפה לו
  - code = exitCode ?? 1; reason = signal ?? ""

#### בדיקות

- `in-process-acp-transport.test.ts`: 10 טסטים עוברים ✅
  - readable: שורות מ-onLine מגיעות כ-Uint8Array עם `\n` suffix
  - writable: כתיבת Uint8Array מפעילה `conn.wire.write`
  - writable: line-buffering — chunks חלקיים נצברים עד `\n`
  - writable: מספר שורות בchunk אחד מתפצלות נכון
  - close(): מבטל את readable
  - onClose: adapter מ-BridgeCrashInfo ל-(code, reason) — exitCode, signal, clean exit
- typecheck נקי ✅ (0 errors חדשים)
