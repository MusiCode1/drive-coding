# C3-host-session — Session Round-Trip: Findings

**Date:** 2026-06-28
**Slice:** slice-C3-host-session
**Verdict:** GO

---

## Summary

The InProcessHost now supports a full session round-trip: `newSession` → `prompt` → streamed
updates → `end_turn`. Claude responded via the in-process host with the word "hello" as
requested. Streaming is confirmed (8 updates including `agent_message_chunk`).

---

## Smoke Test Result (live claude)

```
[smoke] start complete. capabilities: {"mcp":true,"compact":false,"commands":false,"usage":false,"configOptions":false}
[smoke] newSession complete. sessionId: 1e54103c-7ef6-422d-8f83-53cd2034c5b4
[smoke] prompting...
[smoke] update #1: sessionUpdate=available_commands_update
[smoke] update #2: sessionUpdate=usage_update
[smoke] update #3: sessionUpdate=agent_message_chunk
[smoke] update #4: sessionUpdate=agent_message_chunk
[smoke] update #5: sessionUpdate=agent_message_chunk
[smoke] update #6: sessionUpdate=usage_update
[smoke] update #7: sessionUpdate=usage_update
[smoke] update #8: sessionUpdate=usage_update
[smoke] prompt complete. stopReason: end_turn
[smoke] received 8 updates
[smoke] collected text: "hello"
[smoke] PASS — claude responded via in-process host
```

Prompt: `"Reply with exactly the word: hello"`
Response: `"hello"` (3 agent_message_chunk updates, stopReason=end_turn)

---

## Key Technical Findings

### 1. Single-connection architecture is required for streaming

**Problem:** The initial implementation used two independent connections:
- `agentApp.connect(clientApp)` → AgentConnection with AgentContext for ClaudeAcpAgent
- `clientApp.connect(agentApp)` → ClientConnection with ClientContext for buildSession()

Each `connect()` call creates a new `memoryStreamPair()`. The `SessionUpdateRouter`
(a `withHandler` middleware installed by the `ClientApp` constructor) is bound to its
own connection's stream. When ClaudeAcpAgent sends `sessionUpdate` via the AgentContext
from connection 1, the SessionUpdateRouter of connection 2's ClientApp never sees it.
Result: 0 updates received, `ActiveSession.nextUpdate()` drains immediately to "stop".

**Solution:** Single connection pair via `clientApp.connect(agentApp)`. The
`agentApp.onConnect()` handler captures the peer `AgentConnection`, which is the same
stream pair as the `ClientContext` returned from `clientApp.connect()`. ClaudeAcpAgent
uses this AgentContext, so `sessionUpdate` notifications flow through the same stream
pair to the ClientApp's SessionUpdateRouter, reaching the `ActiveSession` queue.

### 2. `agentApp.onConnect()` fires during `clientApp.connect(agentApp)`

From SDK source (`ClientApp.connectConnection`):
```js
target[runAgentConnectHandlers](peerConnection)  // agentApp.onConnect runs here
this[runClientConnectHandlers](state.connection)  // clientApp.onConnect runs here
```

So `onConnect` on the agentApp IS called when the clientApp connects to it.
`claudeAgent` is set before any request is processed. ✓

### 3. `forkSession` is `unstable_forkSession` in ClaudeAcpAgent

The public method name in `@agentclientprotocol/claude-agent-acp` is
`unstable_forkSession`, not `forkSession`. The ACP method name is still `session/fork`.

### 4. `clientApp.onNotification(session/update)` not needed

The `SessionUpdateRouter` middleware handles `session/update` notifications internally
(via `withHandler` in the ClientApp constructor). No explicit `onNotification` handler
is required. The SDK silently drops unhandled notifications.

### 5. Streaming update shape

Updates are raw `SessionUpdate` objects (not normalized). Shape observed:
- `available_commands_update` — commands available in this session
- `usage_update` — token usage stats
- `agent_message_chunk` — text streaming chunks (has `.content.text`)

Normalization is deferred to cutover/features per brief §2.

### 6. Permission requests: not triggered by text-only prompt

The prompt "Reply with exactly the word: hello" generated 0 permission requests.
The `requestPermission` handler (returns `cancelled`) was registered but never called.
This confirms the brief's assertion: text-only prompts don't trigger permissions.

---

## DoD Verification

| # | Check | Result |
|---|-------|--------|
| 1 | typecheck provider | PASS — `pnpm --filter @drive-coding/provider typecheck` ✓ |
| 2 | integration tests (newSession+prompt wiring) | PASS — 63/63 tests |
| 3 | prompt live — claude responded | PASS — "hello", stopReason=end_turn |
| 4 | streaming — onUpdate called ≥1 | PASS — 8 updates received |
| 5 | zero sdk@1.0.0 leak in public interface | PASS — InProcessHost uses string/Record only |
| 6 | additive — zero live file touched | PASS — only packages/provider/ + docs/ |
| 7 | close() after session — no hang | PASS — smoke test closes cleanly |
