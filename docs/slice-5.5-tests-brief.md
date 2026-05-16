# Slice 5.5 — Frontend store tests + schema contract

> **מטרה:** סגירת פער ה-frontend testing שגרם לבאג trivial (`agentId === undefined`) לעבור 4 שינויי ארכיטקטורה ולהיתפס רק בדפדפן ע"י המשתמש. + לבסס תרגול TDD בכל קוד frontend מכאן והלאה.
> **תלות:** commit `a5f1e41` (slice-5.5 part 1).
> **CWD:** `/home/user/projects/voice-acp-v2`
> **מבצע:** Yolo (Sonnet 4-6)
> **לא חוסם:** Tama עובדת במקביל על Slice 6 brief. סנכרון: לא לערוך `docs/slice-6*`, לא לערוך `packages/backend/src/`, לא לערוך `packages/core/src/`.

---

## 0. ⚠️ TDD חובה — אופן עבודה

**כל שורת test וכל שורת implementation שאתה כותב בslice הזה — חייבת לעבור את ה-loop:**

1. כתוב **test failing** (red)
2. הרץ `pnpm test` — וודא שזה fail מהסיבה שציפית (לא שגיאת syntax / import / setup — fail אמיתי על האסרשן)
3. כתוב **implementation מינימלי** שיעבור את ה-test (green)
4. הרץ שוב — וודא שזה passes
5. refactor אם צריך — וודא שעדיין passes
6. עבור ל-test הבא

**אסור:**
- לכתוב 5 tests בבת אחת ואז implementation
- לכתוב implementation לפני test
- לכתוב test + implementation במחזור אחד בלי הרצה ביניהם
- לדלג על שלב "וודא שזה fail מהסיבה הנכונה"

**זה תופס גם:**
- כשאתה מוסיף `AgentSessionPublic` interface — כתוב test ראשון שדורש `store.agentId === "x"`, ראה שזה לא קומפל (אין `.agentId`), ואז הוסף את ה-interface ואת ה-`agentId` ל-return
- כשאתה כותב schema contract test — קודם כתוב את ה-test, ראה אם הוא fail (אם הקוד הקיים עומד בschema — הוא יעבור, וזה גם תוצאה תקפה. אבל הtest **חייב** להיכתב לפני שינוי הקוד)

**למה זה חשוב:**
ה-bug של `agentId === undefined` עבר 4 שינויים כי לא היה test שהריץ אותו. ה-TDD לא רק "best practice" — הוא ה-only thing שמבטיח שכל מסלול קוד נחשף לפני שמשתמש פוגש אותו.

---

## 1. הבעיה שמתקנים

ב-`voice-session.svelte.ts`:
```ts
agentSession.sendRaw({ type: "audio", agentId: agentSession.agentId, ... })
```

ב-`agent-session.svelte.ts` ה-store **לא חשפה** `agentId` עד לתיקון של היום. TypeScript לא צעק כי ה-`AgentSessionLike` interface ב-voice-session **מצהיר** `agentId: string` אבל ה-store לא נדרשה לעמוד באותו interface (אין `satisfies` / חתימה משותפת).

תוקן ידנית ב-`a5f1e41`. עכשיו נסגור את ה-loop כדי שלא יקרה שוב.

---

## 2. מה לבנות — סדר TDD

### 2.0 Vitest setup ל-frontend (10 דק', לא TDD — infrastructure)

**בדוק קיום:**
```bash
cat packages/frontend/package.json | grep -E '"vitest"|"jsdom"|"happy-dom"'
```

צריך להוסיף ל-deps: `vitest`, `happy-dom` (קל יותר מ-jsdom ל-Svelte 5).

**קובץ חדש:** `packages/frontend/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config"
import { sveltekit } from "@sveltejs/kit/vite"

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
})
```

הוסף ל-`package.json`:
```json
"scripts": { "test": "vitest run" }
```

**עדכן root `package.json`** ש-`pnpm test` יכלול את ה-frontend (אם כבר `pnpm -r test` — וודא).

**הרץ smoke:** צור `src/lib/_smoke.test.ts` עם `expect(1+1).toBe(2)`. הרץ `pnpm --filter @drive-coding/frontend test`. ירוק → מחק קובץ smoke והמשך.

**אם vitest+sveltekit לא קולט `.svelte.ts`** — נסה `happy-dom` במקום `jsdom`. אם עדיין נכשל אחרי 20 דקות — דווח, אל תתקע 2 שעות.

### 2.1 TDD #1 — `AgentSessionPublic` interface

**Red:**
- צור `packages/frontend/src/lib/stores/agent-session.test.ts`
- כתוב test יחיד:
  ```ts
  import { describe, it, expect } from "vitest"
  import { createAgentSessionStore, type AgentSessionPublic } from "./agent-session.svelte"
  
  describe("createAgentSessionStore", () => {
    it("exposes agentId on the public store", () => {
      const store: AgentSessionPublic = createAgentSessionStore("agent-123")
      expect(store.agentId).toBe("agent-123")
    })
  })
  ```
- הרץ. צפוי: TS error כי `AgentSessionPublic` לא ייצוא, או runtime fail אם הinterface לא דורש agentId.

**Green:**
- ב-`agent-session.svelte.ts` הוסף:
  ```ts
  export interface AgentSessionPublic {
    readonly agentId: string
    readonly messages: ChatMessage[]
    readonly status: AgentSessionStatus
    readonly error: string | null
    readonly isConnected: boolean
    connect(): void
    disconnect(): void
    sendPrompt(text: string): void
    sendRaw(payload: unknown): boolean
    cancel(): void
    setVoiceMessageHandler(handler: (raw: string) => void): void
  }
  
  export function createAgentSessionStore(agentId: string): AgentSessionPublic {
    // ... existing impl, but explicit return type
  }
  ```
- הרץ. ירוק.

### 2.2 TDD #2 — voice-session uses AgentSessionPublic

**Red:**
- ב-`voice-session.test.ts` (קובץ חדש), כתוב test:
  ```ts
  import { createVoiceSessionStore } from "./voice-session.svelte"
  import type { AgentSessionPublic } from "./agent-session.svelte"
  
  it("accepts AgentSessionPublic as parameter (compile contract)", () => {
    // אם voice-session דורש local interface, זה לא יקמפל
    const fake: AgentSessionPublic = {
      agentId: "x", messages: [], status: "connected", error: null,
      isConnected: true,
      connect: () => {}, disconnect: () => {}, sendPrompt: () => {},
      sendRaw: () => true, cancel: () => {}, setVoiceMessageHandler: () => {},
    }
    const store = createVoiceSessionStore(fake)
    expect(store.voiceState).toBe("idle")
  })
  ```
- הרץ. אם voice-session מגדיר local interface שונה — TS יצעק.

**Green:**
- ב-`voice-session.svelte.ts` החלף `AgentSessionLike` ב-`import type { AgentSessionPublic }` והשתמש בו ב-parameter type.

### 2.3 TDD #3 — agentId יוצא ב-audio payload (זה ה-bug שתפסנו ידנית)

**Red:**
```ts
it("stopRec sends audio payload with agentId === store agentId", async () => {
  const sent: unknown[] = []
  const fake: AgentSessionPublic = makeMockSession({
    agentId: "real-agent-id",
    sendRaw: (p) => { sent.push(p); return true },
  })
  const store = createVoiceSessionStore(fake)
  await store.startRec()
  await store.stopRec()
  await flushAsync()
  
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatchObject({
    type: "audio",
    agentId: "real-agent-id",
    mimeType: expect.stringMatching(/audio\/webm/),
  })
})
```

צריך helpers: `makeMockSession`, MockMediaRecorder, mock navigator.mediaDevices.getUserMedia. כתוב אותם בתוך `voice-session.test.ts` במקום נפרד.

**Green:** הקוד כבר עובד אחרי שלב 2.2. ה-test צריך לעבור. אם נכשל — בעיה אמיתית, חקור.

### 2.4 TDD #4 — Schema contract: כל payload יוצא תואם ל-`ClientMessage`

**🔴 זה החלק הקריטי שמונע באגים מסוג ה-`agentId`.**

**Red:**
```ts
import { ClientMessage } from "@drive-coding/core"
import { type } from "arktype"

it("every payload sent through sendRaw passes ClientMessage schema", async () => {
  const sent: unknown[] = []
  const fake = makeMockSession({ sendRaw: (p) => { sent.push(p); return true } })
  const store = createVoiceSessionStore(fake)
  await store.startRec()
  await store.stopRec()
  await flushAsync()
  
  for (const payload of sent) {
    const result = ClientMessage(payload)
    if (result instanceof type.errors) {
      throw new Error(`payload נכשל ClientMessage:\n${JSON.stringify(payload, null, 2)}\nשגיאות: ${result.summary}`)
    }
  }
})
```

זה ה-test שהיה תופס את ה-`agentId` bug — `ClientMessage` schema דורש `agentId: string` עבור AudioMessage. אם חסר → fail immediate.

הוסף את זה גם ל-`agent-session.test.ts` עבור `sendPrompt` ו-`cancel`:
```ts
it("sendPrompt produces ClientMessage-conforming payload", () => {
  const store = createAgentSessionStore("a")
  store.connect()
  const ws = MockWebSocket.instances[0]!
  store.sendPrompt("hello")
  const payload = JSON.parse(ws.sent[0]!)
  const result = ClientMessage(payload)
  expect(result instanceof type.errors).toBe(false)
})

it("cancel produces ClientMessage-conforming payload", () => {
  // ...
})
```

**Green:** הקוד כבר נכון אחרי תיקון `a5f1e41`. אם משהו לא תואם schema — fix את ה-store, לא את ה-test.

### 2.5 TDD #5 — Inbound: כל ServerMessage variant מטופל

**Red:**
```ts
import { ServerMessage } from "@drive-coding/core"

it("handles every ServerMessage variant without throwing", () => {
  const store = createAgentSessionStore("a")
  store.connect()
  const ws = MockWebSocket.instances[0]!
  
  const variants: Array<unknown> = [
    { type: "hello", version: "0.1.0" },
    { type: "pong", echoOf: "x", serverTime: 0 },
    { type: "connected", agentId: "a" },
    { type: "thinking" },
    { type: "text_chunk", kind: "message", text: "hi" },
    { type: "text_chunk", kind: "thought", text: "thinking..." },
    { type: "tool_call", toolCallId: "t1", title: "read" },
    { type: "tool_call", toolCallId: "t1", title: "read", kind: "read", status: "completed", locations: ["/x"], content: "abc" },
    { type: "done", stopReason: "end_turn" },
    { type: "error", code: "X", message: "y" },
    { type: "stt_partial", text: "שלום" },
    { type: "audio_chunk", mp3Base64: "abc" },
    { type: "translation", original: "hi", translated: "שלום" },
  ]
  
  for (const v of variants) {
    // וודא שזה ServerMessage תקין (catch test bugs)
    const parsed = ServerMessage(v)
    if (parsed instanceof type.errors) {
      throw new Error(`test variant לא תואם ServerMessage: ${JSON.stringify(v)}\n${parsed.summary}`)
    }
    // וודא שה-store קולט בלי לזרוק
    expect(() => ws.onmessage?.({ data: JSON.stringify(v) })).not.toThrow()
  }
})
```

**Green:** הקוד כבר אמור לטפל ב-default → no-op. אם משהו זורק — fix the store.

### 2.6 TDD #6 — tool_call merge

**Red:**
```ts
it("merges tool_call updates by toolCallId into a single message", () => {
  const store = createAgentSessionStore("a")
  store.connect()
  const ws = MockWebSocket.instances[0]!
  
  ws.onmessage?.({ data: JSON.stringify({
    type: "tool_call", toolCallId: "t1", title: "Reading...", kind: "read", status: "pending"
  })})
  expect(store.messages).toHaveLength(1)
  expect(store.messages[0]).toMatchObject({ toolStatus: "pending" })
  
  ws.onmessage?.({ data: JSON.stringify({
    type: "tool_call", toolCallId: "t1", title: "Reading...", kind: "read", status: "completed", content: "data"
  })})
  expect(store.messages).toHaveLength(1)  // לא 2!
  expect(store.messages[0]?.toolStatus).toBe("completed")
  expect(store.messages[0]?.toolContent).toBe("data")
})
```

**Green:** הקוד כבר עושה את זה אחרי `a5f1e41`. רץ → אמור לעבור.

### 2.7 TDD #7 — Disconnect + reconnect-friendly state

**Red:**
```ts
it("sendRaw returns false when WS not open", () => {
  const store = createAgentSessionStore("a")
  expect(store.sendRaw({ type: "ping" })).toBe(false)
})

it("status returns to disconnected on WS close", () => {
  const store = createAgentSessionStore("a")
  store.connect()
  expect(store.status).not.toBe("disconnected")
  const ws = MockWebSocket.instances[0]!
  ws.close()
  expect(store.status).toBe("disconnected")
})
```

**Green:** קיים. אמור לעבור.

### 2.8 TDD #8 — Voice: state machine basics

```ts
it("starts in idle state", () => {
  const store = createVoiceSessionStore(makeMockSession())
  expect(store.voiceState).toBe("idle")
})

it("startRec moves to recording", async () => {
  const store = createVoiceSessionStore(makeMockSession())
  await store.startRec()
  expect(store.voiceState).toBe("recording")
})

it("audio_chunk inbound → AudioQueue (smoke — לא בודקים playback)", () => {
  const fake = makeMockSession()
  const store = createVoiceSessionStore(fake)
  // capture the voice handler
  let handler: ((raw: string) => void) | null = null
  fake.setVoiceMessageHandler = (h) => { handler = h }
  // re-init (or use freshly created store)
  // ... trigger handler with audio_chunk, וודא שאין throw
})
```

---

## 3. Mocks reusable

צור `packages/frontend/src/lib/stores/__test-helpers__.ts`:

```ts
import { vi } from "vitest"
import type { AgentSessionPublic } from "./agent-session.svelte"

export class MockWebSocket {
  static instances: MockWebSocket[] = []
  readyState = 1 // OPEN
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {
    MockWebSocket.instances.push(this)
    queueMicrotask(() => this.onopen?.())
  }
  send(data: string) { this.sent.push(data) }
  close() { this.readyState = 3; this.onclose?.() }
}

export function installWebSocketMock() {
  MockWebSocket.instances = []
  vi.stubGlobal("WebSocket", MockWebSocket)
}

export function makeMockSession(overrides: Partial<AgentSessionPublic> = {}): AgentSessionPublic {
  return {
    agentId: "test-agent",
    messages: [],
    status: "connected",
    error: null,
    isConnected: true,
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendPrompt: vi.fn(),
    sendRaw: vi.fn(() => true),
    cancel: vi.fn(),
    setVoiceMessageHandler: vi.fn(),
    ...overrides,
  }
}

export class MockMediaRecorder {
  static last: MockMediaRecorder | null = null
  state = "inactive"
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  stream = { getTracks: () => [{ stop: vi.fn() }] }
  constructor(_stream: unknown) { MockMediaRecorder.last = this }
  start() { this.state = "recording" }
  stop() {
    this.state = "inactive"
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(["fake"], { type: "audio/webm" }) })
      this.onstop?.()
    })
  }
}

export function installMediaMocks() {
  vi.stubGlobal("MediaRecorder", MockMediaRecorder)
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
  })
}

export const flushAsync = () => new Promise((r) => setTimeout(r, 50))
```

---

## 4. Definition of Done

1. ✅ TDD process עוקב — לכל test יש commit הוכחה / log שהוא נכשל לפני (אופציונלי לתעד ב-commit message)
2. ✅ `AgentSessionPublic` interface exported מ-`agent-session.svelte.ts`
3. ✅ `createAgentSessionStore: AgentSessionPublic` חתימה מפורשת
4. ✅ `voice-session.svelte.ts` importing `AgentSessionPublic` (לא local interface)
5. ✅ `packages/frontend/vitest.config.ts` קיים, runner עובד
6. ✅ `agent-session.test.ts` — מינימום 6 cases (כולל schema contract)
7. ✅ `voice-session.test.ts` — מינימום 4 cases (כולל schema contract של audio payload)
8. ✅ `__test-helpers__.ts` עם MockWebSocket / MockMediaRecorder / makeMockSession
9. ✅ Schema contract test לכל message type שיוצא — ClientMessage assert
10. ✅ Schema variants test לכל ServerMessage type שנכנס
11. ✅ `pnpm test` מ-root כולל את ה-frontend tests
12. ✅ הכל ירוק: typecheck + lint + tests
13. ✅ commit: `(slice-5.5): frontend TDD — store contract + schema conformance tests`

---

## 5. אם נתקעת

- **Svelte 5 runes ב-vitest:** ה-runes דורשים compilation מיוחד. נסה `happy-dom` במקום `jsdom`. אם הקוד שלנו מ-`.svelte.ts` (לא `.svelte`) — vitest+sveltekit אמור לטפל. אם לא — דווח אחרי 20 דקות, נטפל ב-Slice 6.
- **`vitest run` כושל בimport של `@drive-coding/core`:** ייתכן שצריך alias ב-vitest.config.ts או שה-pnpm workspace links לא עובדים ב-vitest. השתמש ב-resolve.alias.
- **MediaRecorder mock לא מספיק:** כתוב fake רק ל-API שנדרש (start/stop/ondataavailable/onstop).
- **כל בעיה אחרת:** דווח, אל תהמרצ.

---

## 6. הוראות פעולה

1. קרא את ה-brief — הכל, כולל סעיף 0.
2. קרא 3 קבצים:
   - `packages/frontend/src/lib/stores/agent-session.svelte.ts`
   - `packages/frontend/src/lib/stores/voice-session.svelte.ts`
   - `packages/core/src/schemas/ws-messages.ts`
3. הקם vitest (סעיף 2.0).
4. עבוד **בזה אחר זה** סעיפים 2.1 → 2.8. לכל אחד: red → green. אל תיקם 2 sections בלי הרצה.
5. הרץ `pnpm typecheck` + `pnpm lint` + `pnpm test` בסוף.
6. commit אחד.

**אסור לערוך:**
- `packages/backend/src/**`
- `packages/core/src/**`
- `docs/slice-6*`
- `docs/agents/**`

**Timeline:** 90-120 דק' עם TDD (לעומת 60-90 שאני אמרתי קודם — TDD איטי יותר אבל יציב יותר). אם 150+ — דווח ועצור.

בהצלחה.
